// Ingest wizard: upload a CSV or XLSX table, profile its columns, map them,
// clean the rows, and stage them into the governed import flow.
//
// Endpoints:
//   POST /api/ingest/tables           — upload + profile
//   GET  /api/ingest/tables           — list staged tables
//   GET  /api/ingest/tables/{id}      — detail (profile + mapping + row outcomes)
//   PUT  /api/ingest/tables/{id}/mapping  — save ruleset, re-run row cleaning
//   POST /api/ingest/tables/{id}/stage    — stage rows into import_batches
//   GET  /api/ingest/tables/{id}/report    — download error CSV

use std::collections::HashSet;

use crate::{ApiError, AppState, audit, role};
use atlasio_domain::{Finding, Manifest};
use atlasio_domain::condition::{
    build_row, profile, rules_from_profile, suggest_map, Defaults, Rules, TableProfile,
};
use axum::{
    extract::{Json, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use csv::Writer as CsvWriter;
use object_store::{ObjectStoreExt, PutPayload, path::Path as ObjectPath};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Digest;
use sqlx::{Row, types::Json as DbJson};
use uuid::Uuid;

// ── Request / response types ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UploadTableRequest {
    pub name: String,
    pub file_name: String,
    pub file_base64: String,
    pub license: Option<String>,
    pub confidentiality: Option<String>,
}

#[derive(Deserialize)]
pub struct MappingRequest {
    #[serde(default)]
    pub mapping: Value,
    #[serde(default)]
    pub rules: Option<Rules>,
    #[serde(default)]
    pub defaults: Option<Defaults>,
}

fn parse_table(bytes: &[u8], file_name: &str) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let ext = file_name
        .rsplit('.')
        .next()
        .map(|t| t.to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "csv" => parse_csv(bytes),
        "xlsx" => parse_xlsx(bytes),
        _ => Err(format!("Unsupported format: {ext}. Use .csv or .xlsx.")),
    }
}

fn parse_csv(bytes: &[u8]) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let text = String::from_utf8(bytes.to_vec()).map_err(|_| "Not valid UTF-8".to_string())?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .trim(csv::Trim::All)
        .from_reader(text.as_bytes());
    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|h| h.to_string())
        .collect();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| e.to_string())?;
        let row: Vec<String> = record.iter().map(|f| f.to_string()).collect();
        rows.push(row);
    }
    if headers.is_empty() {
        return Err("CSV must have a header row".into());
    }
    Ok((headers, rows))
}

fn parse_xlsx(bytes: &[u8]) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    use calamine::{Data, Reader};
    use std::io::Cursor;

    let cursor = Cursor::new(bytes);
    let mut workbook: calamine::Xlsx<_> =
        calamine::open_workbook_from_rs(cursor).map_err(|e| format!("Cannot open XLSX: {e}"))?;
    let sheet_names: Vec<String> = workbook.sheet_names().to_vec();
    let first = sheet_names
        .first()
        .ok_or("XLSX has no sheets")?
        .clone();
    let range = workbook
        .worksheet_range(&first)
        .map_err(|e| format!("Cannot read sheet: {e}"))?;

    let all_rows: Vec<&[Data]> = range.rows().collect();
    if all_rows.is_empty() {
        return Err("XLSX sheet is empty".into());
    }

    fn data_to_string(cell: &Data) -> String {
        match cell {
            Data::Int(i) => i.to_string(),
            Data::Float(f) => {
                let int = *f as i64;
                if int as f64 == *f {
                    int.to_string()
                } else {
                    f.to_string()
                }
            }
            Data::String(s) => s.clone(),
            Data::Bool(b) => b.to_string(),
            _ => String::new(),
        }
    }

    let headers: Vec<String> = all_rows[0].iter().map(data_to_string).collect();
    if headers.is_empty() {
        return Err("XLSX must have a header row".into());
    }
    let rows: Vec<Vec<String>> = all_rows[1..]
        .iter()
        .map(|row| row.iter().map(data_to_string).collect())
        .collect();
    Ok((headers, rows))
}

// ── Handlers ────────────────────────────────────────────────────────────────

/// POST /api/ingest/tables — upload a CSV or XLSX, return the profile + suggested mapping.
pub async fn upload_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UploadTableRequest>,
) -> Result<Response, ApiError> {
    let who = role(&headers, &state, &["importer", "admin", "datamgr"])
        .await
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "Authentication required"))?;

    use base64::{Engine, engine::general_purpose::STANDARD};
    let bytes = STANDARD
        .decode(&req.file_base64)
        .map_err(|_| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "file_base64 is invalid"))?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File must be at most 5 MiB",
        ));
    }
    let file_name = req.file_name.clone();
    let (table_headers, rows) = parse_table(&bytes, &file_name)
        .map_err(|msg| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, &msg))?;

    let prof = profile(&table_headers, &rows);
    let suggested = suggest_map(&table_headers);
    let table_id = Uuid::new_v4();
    let key = format!("ingest/{table_id}/{file_name}");
    let checksum = format!("{:x}", sha2::Sha256::digest(&bytes));

    let size = bytes.len();
    let obj_key = ObjectPath::from(key.clone());
    state
        .objects
        .put(&obj_key, PutPayload::from(bytes))
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let table_row_id: Uuid = table_id;
    {
        let mut tx = state.db.begin().await.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        })?;
        sqlx::query(
            "INSERT INTO ingest_tables (id, name, format, profile, rules, defaults, mapping, object_key, sha256, size_bytes, license, confidentiality) \
             VALUES ($1,$2,$3,$4,'{}','{}','{}',$5,$6,$7,$8,$9)"
        )
        .bind(&table_row_id)
        .bind(&req.name)
        .bind(file_name.rsplit('.').next().unwrap_or(""))
        .bind(DbJson(&prof))
        .bind(&key)
        .bind(&checksum)
        .bind(size as i64)
        .bind(req.license.as_deref().unwrap_or(""))
        .bind(req.confidentiality.as_deref().unwrap_or("public"))
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        audit(
            &mut *tx,
            None,
            &who,
            "ingest_table_uploaded",
            json!({ "table_id": table_row_id, "name": req.name, "rows": rows.len() }),
        )
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        tx.commit().await.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        })?;
    }

    Ok(Json(json!({
        "id": table_row_id,
        "profile": prof,
        "suggested_mapping": suggested,
        "rows": rows.len(),
    }))
    .into_response())
}

/// GET /api/ingest/tables — list staged ingest tables.
pub async fn list_tables(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    role(&headers, &state, &["importer", "reviewer", "admin", "datamgr"])
        .await
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "Authentication required"))?;

    let rows = sqlx::query(
        "SELECT id, name, status, format, created_at FROM ingest_tables ORDER BY created_at DESC LIMIT 100",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let values: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "name": row.get::<String, _>("name"),
                "status": row.get::<String, _>("status"),
                "format": row.get::<String, _>("format"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            })
        })
        .collect();
    Ok(Json(json!(values)).into_response())
}

/// GET /api/ingest/tables/{id} — detail with profile, mapping, and row outcomes.
pub async fn table_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    role(&headers, &state, &["importer", "admin", "datamgr", "reviewer"])
        .await
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "Authentication required"))?;

    let table = sqlx::query(
        "SELECT name, format, profile, rules, defaults, mapping, status FROM ingest_tables WHERE id = $1",
    )
    .bind(table_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Ingest table not found"))?;

    let row_outcomes: Vec<Value> = sqlx::query(
        "SELECT row_index, manifest, qc, blocked, changes FROM ingest_table_rows WHERE table_id = $1 ORDER BY row_index",
    )
    .bind(table_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .iter()
    .map(|r| {
        json!({
            "row_index": r.get::<i32, _>("row_index"),
            "manifest": r.get::<DbJson<Value>, _>("manifest").0,
            "qc": r.get::<DbJson<Value>, _>("qc").0,
            "blocked": r.get::<bool, _>("blocked"),
            "changes": r.get::<DbJson<Value>, _>("changes").0,
        })
    })
    .collect();

    Ok(Json(json!({
        "id": table_id,
        "name": table.get::<String, _>("name"),
        "format": table.get::<String, _>("format"),
        "profile": table.get::<DbJson<Value>, _>("profile").0,
        "rules": table.get::<DbJson<Value>, _>("rules").0,
        "defaults": table.get::<DbJson<Value>, _>("defaults").0,
        "mapping": table.get::<DbJson<Value>, _>("mapping").0,
        "status": table.get::<String, _>("status"),
        "rows": row_outcomes,
    }))
    .into_response())
}

/// PUT /api/ingest/tables/{id}/mapping — save ruleset, re-run row cleaning.
pub async fn save_mapping(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<Uuid>,
    Json(req): Json<MappingRequest>,
) -> Result<Response, ApiError> {
    let who = role(&headers, &state, &["importer", "admin", "datamgr"])
        .await
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "Authentication required"))?;

    let table = sqlx::query(
        "SELECT object_key FROM ingest_tables WHERE id = $1",
    )
    .bind(table_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Ingest table not found"))?;

    let object_key: String = table.get("object_key");
    let key = ObjectPath::from(object_key.clone());
    let fetched = state
        .objects
        .get(&key)
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let bytes = fetched.bytes().await.map_err(|e| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &format!("Cannot read object: {e}"))
    })?;
    let file_name = object_key.clone();
    let (table_headers, rows) = parse_table(&bytes, &file_name)
        .map_err(|msg| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, &msg))?;

    let mapping_value: serde_json::Value = req.mapping;
    let mapping: std::collections::BTreeMap<String, usize> =
        serde_json::from_value(mapping_value.clone()).unwrap_or_default();
    // When the client does not send an explicit ruleset, derive it from the
    // stored profile so DMS / decimal-comma / embedded-unit columns are
    // cleaned automatically instead of silently passing through untouched.
    let stored_profile: TableProfile = {
        let row = sqlx::query("SELECT profile FROM ingest_tables WHERE id = $1")
            .bind(table_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Ingest table not found"))?;
        serde_json::from_value(row.get::<DbJson<Value>, _>("profile").0)
            .unwrap_or_else(|_| TableProfile { rows: 0, columns: Vec::new() })
    };
    let rules = req.rules.unwrap_or_else(|| rules_from_profile(&stored_profile));
    let defaults = req.defaults.unwrap_or_default();

    let mut seen: HashSet<String> = HashSet::new();
    let mut outcomes = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let outcome = build_row(
            &table_headers,
            row,
            &mapping,
            &rules,
            &defaults,
            &mut seen,
        );
        let changes: Vec<Value> = outcome
            .changes
            .iter()
            .map(|(t, b, a)| json!({ "target": t, "before": b, "after": a }))
            .collect();
        outcomes.push(
            json!({
                "row_index": index,
                "manifest": serde_json::to_value(&outcome.manifest).unwrap(),
                "findings": outcome.findings,
                "blocked": outcome.blocked,
                "changes": changes,
            }),
        );
    }

    let blocked_count = outcomes.iter().filter(|o| o["blocked"] == true).count();
    let status = if blocked_count == 0 {
        "staged"
    } else if blocked_count == outcomes.len() {
        "rejected"
    } else {
        "staged_partial"
    };

    {
        let mut tx = state.db.begin().await.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        })?;
        sqlx::query(
            "UPDATE ingest_tables SET rules = $2, defaults = $3, mapping = $4, status = $5 WHERE id = $1",
        )
        .bind(table_id)
        .bind(DbJson(&rules))
        .bind(DbJson(&defaults))
        .bind(DbJson(&mapping_value))
        .bind(status)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        // Clear and re-insert row outcomes
        sqlx::query("DELETE FROM ingest_table_rows WHERE table_id = $1")
            .bind(table_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        for outcome in &outcomes {
            let row_index = outcome["row_index"].as_u64().unwrap_or(0) as i32;
            let blocked = outcome["blocked"].as_bool().unwrap_or(false);
            let manifest = &outcome["manifest"].clone();
            let qc = &outcome["findings"].clone();
            let changes = &outcome["changes"].clone();
            sqlx::query(
                "INSERT INTO ingest_table_rows (table_id, row_index, manifest, qc, blocked, changes) \
                 VALUES ($1,$2,$3,$4,$5,$6)",
            )
            .bind(table_id)
            .bind(row_index)
            .bind(DbJson(manifest))
            .bind(DbJson(qc))
            .bind(blocked)
            .bind(DbJson(changes))
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
        audit(
            &mut *tx,
            None,
            who,
            "ingest_mapping_saved",
            json!({
                "table_id": table_id,
                "rows": rows.len(),
                "blocked": blocked_count,
                "status": status,
            }),
        )
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        tx.commit().await.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        })?;
    }

    Ok(Json(json!({
        "id": table_id,
        "status": status,
        "total_rows": rows.len(),
        "blocked_rows": blocked_count,
        "outcomes": outcomes,
    }))
    .into_response())
}

/// POST /api/ingest/tables/{id}/stage — stage unblocked rows into import_batches.
pub async fn stage_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let who = role(&headers, &state, &["importer", "admin", "datamgr"])
        .await
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "Authentication required"))?;

    let table = sqlx::query(
        "SELECT object_key, license, confidentiality FROM ingest_tables WHERE id = $1",
    )
    .bind(table_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Ingest table not found"))?;

    let object_key: String = table.get("object_key");
    let license: String = table.get("license");
    let confidentiality: String = table.get("confidentiality");

    let row_outcomes: Vec<Value> = sqlx::query(
        "SELECT row_index, manifest, qc, blocked FROM ingest_table_rows WHERE table_id = $1 AND blocked = false ORDER BY row_index",
    )
    .bind(table_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .iter()
    .map(|r| {
        json!({
            "row_index": r.get::<i32, _>("row_index"),
            "manifest": r.get::<DbJson<Value>, _>("manifest").0,
            "qc": r.get::<DbJson<Value>, _>("qc").0,
        })
    })
    .collect();

    if row_outcomes.is_empty() {
        return Ok(
            Json(json!({
                "staged": 0,
                "message": "No unblocked rows to stage",
            }))
            .into_response(),
        );
    }

    let mut staged_batch_ids: Vec<Value> = Vec::new();
    {
        let mut tx = state.db.begin().await.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        })?;
        for outcome in &row_outcomes {
            let manifest: Manifest = serde_json::from_value(outcome["manifest"].clone()).map_err(|e| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Invalid manifest: {e}"),
                )
            })?;
            let qc: Vec<Finding> = serde_json::from_value(outcome["qc"].clone()).unwrap_or_default();
            let batch_id = Uuid::new_v4();
            let file_id = Uuid::new_v4();
            let row_index = outcome["row_index"].as_u64().unwrap_or(0);
            let batch_key = format!("{}/row-{}", object_key, row_index);

            // The original table file is shared; create a file_asset per batch
            // pointing at the same object key (batch-specific sub-path).
            sqlx::query(
                "INSERT INTO import_batches (id, status, manifest, qc) VALUES ($1, 'staged', $2, $3)",
            )
            .bind(batch_id)
            .bind(DbJson(&manifest))
            .bind(DbJson(&qc))
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
            })?;
            sqlx::query(
                "INSERT INTO file_assets (id, batch_id, original_name, object_key, sha256, size_bytes, license, confidentiality) \
                 VALUES ($1,$2,$3,$4,$5,0,$6,$7)",
            )
            .bind(file_id)
            .bind(batch_id)
            .bind(format!("ingest_row_{row_index}"))
            .bind(&batch_key)
            .bind("ingest")
            .bind(&license)
            .bind(&confidentiality)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
            })?;
            let row_index_i32 = row_index as i32;
            sqlx::query(
                "UPDATE ingest_table_rows SET batch_id = $2 WHERE table_id = $1 AND row_index = $3",
            )
            .bind(table_id)
            .bind(batch_id)
            .bind(row_index_i32)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
            })?;
            staged_batch_ids.push(json!({ "row_index": row_index, "batch_id": batch_id }));
        }
        sqlx::query(
            "UPDATE ingest_tables SET status = 'staged' WHERE id = $1",
        )
        .bind(table_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        audit(
            &mut *tx,
            None,
            &who,
            "ingest_table_staged",
            json!({ "table_id": table_id, "staged": staged_batch_ids.len() }),
        )
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        tx.commit().await.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        })?;
    }

    Ok(Json(json!({
        "staged": staged_batch_ids.len(),
        "batch_ids": staged_batch_ids,
    }))
    .into_response())
}

/// GET /api/ingest/tables/{id}/report — download a CSV of blocked rows.
pub async fn table_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    role(&headers, &state, &["importer", "admin", "datamgr", "reviewer"])
        .await
        .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "Authentication required"))?;

    let table = sqlx::query(
        "SELECT name FROM ingest_tables WHERE id = $1",
    )
    .bind(table_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Ingest table not found"))?;

    let table_name: String = table.get("name");

    let blocked_rows: Vec<Value> = sqlx::query(
        "SELECT row_index, manifest, qc, changes FROM ingest_table_rows \
         WHERE table_id = $1 AND blocked = true ORDER BY row_index",
    )
    .bind(table_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .iter()
    .map(|r| {
        json!({
            "row_index": r.get::<i32, _>("row_index"),
            "manifest": r.get::<DbJson<Value>, _>("manifest").0,
            "qc": r.get::<DbJson<Value>, _>("qc").0,
            "changes": r.get::<DbJson<Value>, _>("changes").0,
        })
    })
    .collect();

    let mut writer = CsvWriter::from_writer(Vec::new());
    let _ = writer.write_record(vec![
        "row_index",
        "error_code",
        "error_message",
        "conditioning_applied",
    ]);
    for row in &blocked_rows {
        let qc: Vec<Value> = row["qc"].as_array().cloned().unwrap_or_default();
        let changes: Vec<Value> = row["changes"].as_array().cloned().unwrap_or_default();
        // Compact summary of what the ruleset changed in this row, so the
        // fix-in-source pass starts from the cleaned view, not the raw bytes.
        let applied = changes
            .iter()
            .map(|change| {
                format!(
                    "{}: {} -> {}",
                    change.get("target").and_then(Value::as_str).unwrap_or(""),
                    change.get("before").and_then(Value::as_str).unwrap_or(""),
                    change.get("after").and_then(Value::as_str).unwrap_or(""),
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        for finding in &qc {
            if finding.get("severity").and_then(Value::as_str) == Some("error") {
                let _ = writer.write_record(vec![
                    row["row_index"].as_i64().unwrap_or(0).to_string(),
                    finding
                        .get("code")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    finding
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    applied.clone(),
                ]);
            }
        }
    }
    let csv_bytes = writer
        .into_inner()
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    Ok((
        [
            (
                header::CONTENT_TYPE,
                "text/csv; charset=utf-8".to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}_blocked.csv\"", table_name.replace('"', "_")),
            ),
        ],
        csv_bytes,
    )
        .into_response())
}
