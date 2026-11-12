use std::{path::Path as FsPath, str::FromStr};

use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{
    PgPool, Row,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use tokio::io::AsyncReadExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::{ApiError, ApiResult, AppState, auth, key_hash, migrate, record_audit, role};

const BACKUP_MANIFEST: &str = "manifest.json";
const BACKUP_DUMP: &str = "atlasio.dump";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DatabaseCounts {
    wells: i64,
    well_versions: i64,
    file_assets: i64,
    import_batches: i64,
    migrations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DumpFile {
    file: String,
    sha256: String,
    size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ObjectSet {
    mode: String,
    count: i64,
    bytes: i64,
    copied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupManifest {
    id: String,
    created_at: String,
    app_version: String,
    status: String,
    database: DatabaseCounts,
    dump: DumpFile,
    objects: ObjectSet,
    note: String,
}

pub(crate) async fn demo_profiles(State(state): State<AppState>) -> ApiResult {
    if state.maintenance.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Maintenance in progress",
        ));
    }
    let rows = sqlx::query(
        "SELECT role, label, demo_key FROM access_profiles WHERE kind = 'demo' AND active ORDER BY role",
    )
    .fetch_all(&state.db)
    .await?;
    let profiles: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "role": row.get::<String, _>("role"),
                "label": row.get::<String, _>("label"),
                "key": row.get::<Option<String>, _>("demo_key"),
            })
        })
        .collect();
    Ok(Json(json!(profiles)))
}

pub(crate) async fn status(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    role(&headers, &state, &["admin", "datamgr"]).await?;

    let version: String = sqlx::query_scalar("SELECT version()")
        .fetch_one(&state.db)
        .await?;
    let size_bytes: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())::bigint")
        .fetch_one(&state.db)
        .await?;
    let connections: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()",
    )
    .fetch_one(&state.db)
    .await?;
    let migrations: Vec<String> =
        sqlx::query_scalar("SELECT version FROM schema_migrations ORDER BY version")
            .fetch_all(&state.db)
            .await?;
    let profiles: i64 = sqlx::query_scalar("SELECT count(*) FROM access_profiles")
        .fetch_one(&state.db)
        .await?;
    let counts = db_counts(&state.db).await?;

    let object_bytes: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM file_assets")
            .fetch_one(&state.db)
            .await?;

    let accounts: i64 = sqlx::query_scalar("SELECT count(*) FROM admin_accounts")
        .fetch_one(&state.db)
        .await?;
    let mfa_enabled: i64 =
        sqlx::query_scalar("SELECT count(*) FROM admin_accounts WHERE mfa_enabled")
            .fetch_one(&state.db)
            .await?;
    let pending_password_change: i64 =
        sqlx::query_scalar("SELECT count(*) FROM admin_accounts WHERE must_change_password")
            .fetch_one(&state.db)
            .await?;

    let last_backup = list_backups(&state)
        .await
        .ok()
        .and_then(|items| items.into_iter().next());

    Ok(Json(json!({
        "app_version": state.app_version,
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "maintenance": state.maintenance.load(std::sync::atomic::Ordering::Relaxed),
        "database": {
            "version": version,
            "size_bytes": size_bytes,
            "connections": connections,
            "migrations": migrations,
        },
        "catalog": counts,
        "storage": {
            "mode": state.storage_mode,
            "object_count": counts.file_assets,
            "object_bytes": object_bytes,
        },
        "profiles": profiles,
        "backup_dir": state.backup_dir.display().to_string(),
        "last_backup": last_backup,
        "security": {
            "accounts": accounts,
            "mfa_enabled": mfa_enabled,
            "accounts_awaiting_password_change": pending_password_change,
        }
    })))
}

pub(crate) async fn profiles(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    role(&headers, &state, &["admin", "datamgr"]).await?;
    let rows = sqlx::query(
        "SELECT id, role, label, kind, demo_key, key_prefix, active, created_at, rotated_at, last_used_at, created_by FROM access_profiles ORDER BY role, created_at",
    )
    .fetch_all(&state.db)
    .await?;
    let items: Vec<Value> = rows.into_iter().map(profile_json).collect();
    Ok(Json(json!(items)))
}

fn profile_json(row: sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<Uuid, _>("id"),
        "role": row.get::<String, _>("role"),
        "label": row.get::<String, _>("label"),
        "kind": row.get::<String, _>("kind"),
        "demo_key": row.get::<Option<String>, _>("demo_key"),
        "key_prefix": row.get::<Option<String>, _>("key_prefix"),
        "active": row.get::<bool, _>("active"),
        "created_at": row.get::<Option<DateTime<Utc>>, _>("created_at").map(|value| value.to_rfc3339()),
        "rotated_at": row.get::<Option<DateTime<Utc>>, _>("rotated_at").map(|value| value.to_rfc3339()),
        "last_used_at": row.get::<Option<DateTime<Utc>>, _>("last_used_at").map(|value| value.to_rfc3339()),
        "created_by": row.get::<Option<String>, _>("created_by"),
    })
}

#[derive(Deserialize)]
pub(crate) struct CreateProfile {
    role: String,
    label: Option<String>,
}

pub(crate) async fn create_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateProfile>,
) -> ApiResult {
    let account = auth::require_ready(&headers, &state, &["admin", "datamgr"]).await?;
    let who = account.username.as_str();
    if !matches!(request.role.as_str(), "reader" | "importer" | "reviewer") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Custom keys can be created for viewer, importer, or reviewer only",
        ));
    }
    let label = request
        .label
        .unwrap_or_else(|| format!("{} key", title_role(&request.role)));
    if label.len() > 80 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Profile label must be 80 characters or fewer",
        ));
    }
    let key = custom_key();
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO access_profiles (id, role, label, kind, key_hash, key_prefix, active, created_by) VALUES ($1, $2, $3, 'custom', $4, $5, true, $6)",
    )
    .bind(id)
    .bind(&request.role)
    .bind(&label)
    .bind(key_hash(&key))
    .bind(&key[..12])
    .bind(who)
    .execute(&state.db)
    .await?;
    audit_admin(
        &state,
        who,
        "admin.profile.create",
        json!({ "role": request.role, "label": label }),
    )
    .await?;
    let row = sqlx::query(
        "SELECT id, role, label, kind, demo_key, key_prefix, active, created_at, rotated_at, last_used_at, created_by FROM access_profiles WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "profile": profile_json(row), "key": key })))
}

#[derive(Deserialize)]
pub(crate) struct UpdateProfile {
    label: Option<String>,
    active: Option<bool>,
}

pub(crate) async fn update_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateProfile>,
) -> ApiResult {
    let account = auth::require_ready(&headers, &state, &["admin", "datamgr"]).await?;
    let who = account.username.as_str();
    if let Some(label) = request.label.as_ref() {
        if label.trim().is_empty() || label.len() > 80 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Profile label must be between 1 and 80 characters",
            ));
        }
    }
    let row = sqlx::query(
        "UPDATE access_profiles SET label = COALESCE($1, label), active = COALESCE($2, active) WHERE id = $3 RETURNING id, role, label, kind, demo_key, key_prefix, active, created_at, rotated_at, last_used_at, created_by",
    )
    .bind(request.label)
    .bind(request.active)
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Access profile not found"))?;
    audit_admin(&state, who, "admin.profile.update", json!({ "id": id, "label": row.get::<String, _>("label"), "active": row.get::<bool, _>("active") })).await?;
    Ok(Json(json!(profile_json(row))))
}

pub(crate) async fn rotate_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult {
    let account = auth::require_ready(&headers, &state, &["admin", "datamgr"]).await?;
    let who = account.username.as_str();
    let existing = sqlx::query("SELECT role, kind FROM access_profiles WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Access profile not found"))?;
    let profile_role: String = existing.get("role");
    let kind: String = existing.get("kind");
    if !matches!(profile_role.as_str(), "reader" | "importer" | "reviewer") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Bootstrap profiles are managed by environment variables",
        ));
    }

    let (row, key) = if kind == "demo" {
        let key = format!(
            "{}-{}",
            profile_role,
            &Uuid::new_v4().simple().to_string()[..8]
        );
        let row = sqlx::query(
            "UPDATE access_profiles SET demo_key = $1, key_prefix = $2, rotated_at = now() WHERE id = $3 RETURNING id, role, label, kind, demo_key, key_prefix, active, created_at, rotated_at, last_used_at, created_by",
        )
        .bind(&key)
        .bind(&key[..8])
        .bind(id)
        .fetch_one(&state.db)
        .await?;
        (row, key)
    } else {
        let key = custom_key();
        let row = sqlx::query(
            "UPDATE access_profiles SET key_hash = $1, key_prefix = $2, rotated_at = now() WHERE id = $3 RETURNING id, role, label, kind, demo_key, key_prefix, active, created_at, rotated_at, last_used_at, created_by",
        )
        .bind(key_hash(&key))
        .bind(&key[..12])
        .bind(id)
        .fetch_one(&state.db)
        .await?;
        (row, key)
    };

    audit_admin(
        &state,
        who,
        "admin.profile.rotate",
        json!({ "id": id, "kind": kind }),
    )
    .await?;
    Ok(Json(json!({ "profile": profile_json(row), "key": key })))
}

#[derive(Deserialize)]
pub(crate) struct RestoreRequest {
    confirm: String,
}

pub(crate) async fn backups(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    role(&headers, &state, &["admin", "datamgr"]).await?;
    let items = list_backups(&state).await?;
    Ok(Json(json!(items)))
}

pub(crate) async fn create_backup(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let account = auth::require_ready(&headers, &state, &["admin", "datamgr"]).await?;
    let who = account.username.as_str();
    let _guard = state.admin_job.lock().await;
    let manifest = run_backup(&state, who).await?;
    Ok(Json(json!(manifest)))
}

pub(crate) async fn download_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    auth::require_ready(&headers, &state, &["admin", "datamgr"]).await?;
    validate_id(&id)?;
    let manifest = read_manifest(&state, &id).await?;
    let path = state.backup_dir.join(&id).join(&manifest.dump.file);
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "Backup archive not found"))?;
    let stream = ReaderStream::new(file);
    let disposition = format!("attachment; filename=\"atlasio-{}.dump\"", id);
    Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::from_stream(stream))
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not stream backup"))
}

pub(crate) async fn delete_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    let account = auth::require_ready(&headers, &state, &["admin"]).await?;
    let who = account.username.as_str();
    validate_id(&id)?;
    // Wait for an in-flight backup, verification, or restore that may be
    // reading this archive.
    let _guard = state.admin_job.lock().await;
    let dir = state.backup_dir.join(&id);
    if !dir.exists() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Backup not found"));
    }
    tokio::fs::remove_dir_all(&dir)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not delete backup"))?;
    audit_admin(&state, who, "admin.backup.delete", json!({ "id": id })).await?;
    Ok(Json(json!({ "deleted": id })))
}

pub(crate) async fn verify_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    auth::require_ready(&headers, &state, &["admin", "datamgr"]).await?;
    validate_id(&id)?;
    let _guard = state.admin_job.lock().await;
    let manifest = read_manifest(&state, &id).await?;
    let dump_path = state.backup_dir.join(&id).join(&manifest.dump.file);
    let actual_hash = sha256_file(&dump_path).await?;
    if actual_hash != manifest.dump.sha256 {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Backup archive checksum does not match its manifest",
        ));
    }

    let scratch = format!(
        "atlasio_verify_{}",
        &Uuid::new_v4().simple().to_string()[..10]
    );
    let admin_pool = admin_pool(&state).await?;
    create_database(&admin_pool, &scratch).await?;
    let scratch_url = with_database(&state.db_url, &scratch);
    let restore = run_restore(&state, &scratch_url, &dump_path).await;
    if let Err(error) = restore {
        drop_database(&admin_pool, &scratch).await;
        return Err(error);
    }

    let check = async {
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&scratch_url)
            .await?;
        let counts = db_counts(&pool).await?;
        pool.close().await;
        Ok::<DatabaseCounts, ApiError>(counts)
    }
    .await;
    drop_database(&admin_pool, &scratch).await;

    let actual = check?;
    let valid = actual.wells == manifest.database.wells
        && actual.well_versions == manifest.database.well_versions
        && actual.file_assets == manifest.database.file_assets
        && actual.import_batches == manifest.database.import_batches;
    Ok(Json(json!({
        "valid": valid,
        "expected": manifest.database,
        "actual": actual,
        "objects": manifest.objects,
    })))
}

pub(crate) async fn restore_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<RestoreRequest>,
) -> ApiResult {
    let account = auth::require_ready(&headers, &state, &["admin"]).await?;
    let who = account.username.as_str();
    validate_id(&id)?;
    if request.confirm.trim() != format!("RESTORE {id}") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            &format!("Type RESTORE {id} to confirm"),
        ));
    }
    if state.maintenance.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "A restore or maintenance operation is already in progress",
        ));
    }

    let _guard = state.admin_job.lock().await;
    let manifest = read_manifest(&state, &id).await?;
    let dump_path = state.backup_dir.join(&id).join(&manifest.dump.file);
    let actual_hash = sha256_file(&dump_path).await?;
    if actual_hash != manifest.dump.sha256 {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Backup archive checksum does not match its manifest",
        ));
    }

    let pre_restore = run_backup(&state, who).await?;
    state
        .maintenance
        .store(true, std::sync::atomic::Ordering::Relaxed);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    if let Err(error) = terminate_connections(&state).await {
        state
            .maintenance
            .store(false, std::sync::atomic::Ordering::Relaxed);
        return Err(error);
    }
    if let Err(error) = run_restore(&state, &state.db_url, &dump_path).await {
        // Keep maintenance on: the live database may be partially restored.
        // The pre-restore backup is available for a retry.
        return Err(error);
    }

    let objects_restored = if manifest.objects.copied {
        if let Some(object_dir) = state.object_dir.clone() {
            let source = state.backup_dir.join(&id).join("objects");
            let destination = object_dir;
            tokio::task::spawn_blocking(move || replace_tree(&source, &destination))
                .await
                .map_err(|_| {
                    ApiError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Object restore task failed",
                    )
                })?
                .map_err(|_| {
                    ApiError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Could not restore original files",
                    )
                })?;
            true
        } else {
            false
        }
    } else {
        false
    };

    if let Err(error) = migrate(&state.db).await {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Database restored, but migrations failed: {error}"),
        ));
    }

    state
        .maintenance
        .store(false, std::sync::atomic::Ordering::Relaxed);
    audit_admin(
        &state,
        who,
        "admin.backup.restore",
        json!({ "id": id, "pre_restore": pre_restore.id, "objects_restored": objects_restored }),
    )
    .await?;

    Ok(Json(json!({
        "status": "restored",
        "backup": id,
        "pre_restore": pre_restore.id,
        "objects_restored": objects_restored,
        "note": if manifest.objects.copied { "Database and local original files restored." } else { "Database restored. Restore the object-store snapshot separately before reopening the workspace." },
    })))
}

pub(crate) async fn audit_log(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    role(&headers, &state, &["admin", "datamgr"]).await?;
    let rows = sqlx::query(
        "SELECT actor, action, details, occurred_at FROM audit_events WHERE batch_id IS NULL ORDER BY occurred_at DESC LIMIT 100",
    )
    .fetch_all(&state.db)
    .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "actor": row.get::<String, _>("actor"),
                "action": row.get::<String, _>("action"),
                "details": row.get::<sqlx::types::Json<Value>, _>("details").0,
                "occurred_at": row.get::<DateTime<Utc>, _>("occurred_at").to_rfc3339(),
            })
        })
        .collect();
    Ok(Json(json!(items)))
}

/// Build history, read from the repository change log at request time so a
/// deployment can update it without rebuilding the server.
pub(crate) async fn changelog(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    role(&headers, &state, &["admin", "datamgr"]).await?;
    let metadata = tokio::fs::metadata(&state.changelog_path)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "The change log is not available on this deployment",
            )
        })?;
    if metadata.len() > 1024 * 1024 {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The change log file is unexpectedly large",
        ));
    }
    let content = tokio::fs::read_to_string(&state.changelog_path)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not read the change log",
            )
        })?;
    let entries = parse_changelog(&content);
    let source = state
        .changelog_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "CHANGELOG.md".to_string());
    let latest = entries.first().map(|entry| entry.version.clone());
    Ok(Json(json!({
        "source": source,
        "app_version": state.app_version,
        "latest": latest,
        "entries": entries,
    })))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct ChangeEntry {
    version: String,
    date: String,
    build: Option<String>,
    kind: Option<String>,
    commit: Option<String>,
    summary: Option<String>,
    highlights: Vec<String>,
}

/// Parse a `CHANGELOG.md` whose sections look like:
///
/// ```text
/// ## 0.1.19 — 2026-11-12
/// Build: v0.1.19+2611125
/// Type: feat
/// Commit: 1234abc
/// - A user-visible change.
/// ```
fn parse_changelog(content: &str) -> Vec<ChangeEntry> {
    let mut entries = Vec::new();
    let mut current: Option<ChangeEntry> = None;
    let mut open_bullet: Option<usize> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if let Some((version, date)) = parse_changelog_heading(trimmed) {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(ChangeEntry {
                version,
                date,
                build: None,
                kind: None,
                commit: None,
                summary: None,
                highlights: Vec::new(),
            });
            open_bullet = None;
            continue;
        }
        let Some(entry) = current.as_mut() else {
            continue;
        };
        if trimmed.is_empty() {
            open_bullet = None;
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("Build:") {
            entry.build = non_empty(value);
            open_bullet = None;
        } else if let Some(value) = trimmed.strip_prefix("Type:") {
            entry.kind = non_empty(value).map(|kind| kind.to_lowercase());
            open_bullet = None;
        } else if let Some(value) = trimmed.strip_prefix("Commit:") {
            entry.commit = non_empty(value);
            open_bullet = None;
        } else if let Some(value) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        {
            entry.highlights.push(value.trim().to_string());
            open_bullet = Some(entry.highlights.len() - 1);
        } else if trimmed.starts_with('#') {
            open_bullet = None;
        } else if let Some(index) = open_bullet {
            if let Some(highlight) = entry.highlights.get_mut(index) {
                highlight.push(' ');
                highlight.push_str(trimmed);
            }
        } else if entry.summary.is_none() {
            entry.summary = Some(trimmed.to_string());
        }
    }
    if let Some(entry) = current.take() {
        entries.push(entry);
    }
    entries
}

fn parse_changelog_heading(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix("## ")?;
    let (version, remainder) = rest.split_once(char::is_whitespace)?;
    let version = version.trim_start_matches('v');
    if version.split('.').count() < 2
        || !version
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|digit| digit.is_ascii_digit()))
    {
        return None;
    }
    let date = remainder.split_whitespace().last()?;
    let bytes = date.as_bytes();
    let looks_like_date = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    looks_like_date.then(|| (version.to_string(), date.to_string()))
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::{ChangeEntry, parse_changelog};

    #[test]
    fn parses_sections_metadata_and_bullets() {
        let content = "\
# Atlasio change log

Intro prose is ignored.

## 0.2.0 — 2026-12-01
Build: v0.2.0+2612011
Type: feat
Commit: abc1234
- First change that wraps
  onto a second line.
- Second change.

## 0.1.9 - 2026-11-11
Type: fix
- Older change.
";

        let entries = parse_changelog(content);
        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[0],
            ChangeEntry {
                version: "0.2.0".into(),
                date: "2026-12-01".into(),
                build: Some("v0.2.0+2612011".into()),
                kind: Some("feat".into()),
                commit: Some("abc1234".into()),
                summary: None,
                highlights: vec![
                    "First change that wraps onto a second line.".into(),
                    "Second change.".into()
                ],
            }
        );
        assert_eq!(entries[1].version, "0.1.9");
        assert_eq!(entries[1].kind.as_deref(), Some("fix"));
        assert_eq!(entries[1].highlights, vec!["Older change."]);
    }

    #[test]
    fn keeps_paragraphs_as_summary_and_ignores_other_headings() {
        let content = "\
## 0.3.0 — 2026-12-02
A short summary.

### Details
- One item.
";
        let entries = parse_changelog(content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].summary.as_deref(), Some("A short summary."));
        assert_eq!(entries[0].highlights, vec!["One item."]);
    }

    #[test]
    fn skips_prose_headings_and_accepts_short_versions() {
        let content = "\
## Change log
## Future work
## 0.4 — 2026-12-03
- A release with a major and minor version only.
";
        let entries = parse_changelog(content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].version, "0.4");
        assert_eq!(entries[0].date, "2026-12-03");
    }
}

async fn run_backup(state: &AppState, actor: &str) -> Result<BackupManifest, ApiError> {
    let id = format!(
        "{}_{}",
        Utc::now().format("%Y%m%dT%H%M%S"),
        &Uuid::new_v4().simple().to_string()[..6]
    );
    let dir = state.backup_dir.join(&id);
    tokio::fs::create_dir_all(&dir).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not create the backup directory",
        )
    })?;
    let dump_path = dir.join(BACKUP_DUMP);
    let output = tokio::process::Command::new(&state.pg_dump)
        .arg("--dbname")
        .arg(&state.db_url)
        .arg("--format")
        .arg("custom")
        .arg("--file")
        .arg(&dump_path)
        .output()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Could not run pg_dump: {error}"),
            )
        })?;
    if !output.status.success() {
        let _ = tokio::fs::remove_dir_all(&dir).await;
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!(
                "pg_dump failed: {}",
                terse(&String::from_utf8_lossy(&output.stderr))
            ),
        ));
    }

    let counts = db_counts(&state.db).await?;
    let dump_hash = sha256_file(&dump_path).await?;
    let dump_size = tokio::fs::metadata(&dump_path)
        .await
        .map(|metadata| metadata.len() as i64)
        .unwrap_or(0);
    let object_bytes: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM file_assets")
            .fetch_one(&state.db)
            .await?;

    let (objects, note) = if let Some(object_dir) = state.object_dir.clone() {
        let destination = dir.join("objects");
        let copied = tokio::task::spawn_blocking(move || copy_tree(&object_dir, &destination))
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Object backup task failed",
                )
            })?
            .map_err(|_| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not copy original files into the backup",
                )
            })?;
        (
            ObjectSet {
                mode: "local".to_string(),
                count: copied.0,
                bytes: copied.1,
                copied: true,
            },
            "Database and local original files captured.".to_string(),
        )
    } else {
        (
            ObjectSet {
                mode: "s3".to_string(),
                count: counts.file_assets,
                bytes: object_bytes,
                copied: false,
            },
            "Database captured. S3 objects require a provider snapshot or bucket copy; this archive does not contain their bytes.".to_string(),
        )
    };

    let manifest = BackupManifest {
        id: id.clone(),
        created_at: Utc::now().to_rfc3339(),
        app_version: state.app_version.clone(),
        status: "ready".to_string(),
        database: counts,
        dump: DumpFile {
            file: BACKUP_DUMP.to_string(),
            sha256: dump_hash,
            size_bytes: dump_size,
        },
        objects,
        note,
    };
    let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not serialize the backup manifest",
        )
    })?;
    tokio::fs::write(dir.join(BACKUP_MANIFEST), manifest_json)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not write the backup manifest",
            )
        })?;
    audit_admin(
        state,
        actor,
        "admin.backup.create",
        json!({ "id": id, "objects_copied": manifest.objects.copied }),
    )
    .await?;
    Ok(manifest)
}

async fn list_backups(state: &AppState) -> Result<Vec<BackupManifest>, ApiError> {
    let mut dir = tokio::fs::read_dir(&state.backup_dir).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not read the backup directory",
        )
    })?;
    let mut items = Vec::new();
    while let Some(entry) = dir.next_entry().await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not read the backup directory",
        )
    })? {
        if !entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        if let Ok(manifest) = read_manifest(state, &entry.file_name().to_string_lossy()).await {
            items.push(manifest);
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

async fn read_manifest(state: &AppState, id: &str) -> Result<BackupManifest, ApiError> {
    validate_id(id)?;
    let path = state.backup_dir.join(id).join(BACKUP_MANIFEST);
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "Backup not found"))?;
    serde_json::from_str(&content).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Backup manifest is invalid",
        )
    })
}

async fn db_counts(pool: &PgPool) -> Result<DatabaseCounts, ApiError> {
    let wells: i64 = sqlx::query_scalar("SELECT count(*) FROM wells")
        .fetch_one(pool)
        .await?;
    let well_versions: i64 = sqlx::query_scalar("SELECT count(*) FROM well_versions")
        .fetch_one(pool)
        .await?;
    let file_assets: i64 = sqlx::query_scalar("SELECT count(*) FROM file_assets")
        .fetch_one(pool)
        .await?;
    let import_batches: i64 = sqlx::query_scalar("SELECT count(*) FROM import_batches")
        .fetch_one(pool)
        .await?;
    let migrations: Vec<String> =
        sqlx::query_scalar("SELECT version FROM schema_migrations ORDER BY version")
            .fetch_all(pool)
            .await?;
    Ok(DatabaseCounts {
        wells,
        well_versions,
        file_assets,
        import_batches,
        migrations,
    })
}

async fn admin_pool(state: &AppState) -> Result<PgPool, ApiError> {
    let options = PgConnectOptions::from_str(&state.db_url)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Invalid database URL"))?
        .database("postgres");
    PgPoolOptions::new()
        .max_connections(2)
        .connect_with(options)
        .await
        .map_err(ApiError::from)
}

async fn create_database(pool: &PgPool, name: &str) -> Result<(), ApiError> {
    sqlx::query(&format!("CREATE DATABASE \"{name}\""))
        .execute(pool)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

async fn drop_database(pool: &PgPool, name: &str) {
    let _ = sqlx::query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    )
    .bind(name)
    .execute(pool)
    .await;
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)"))
        .execute(pool)
        .await;
}

async fn run_restore(
    state: &AppState,
    database_url: &str,
    dump_path: &FsPath,
) -> Result<(), ApiError> {
    let output = tokio::process::Command::new(&state.pg_restore)
        .arg("--dbname")
        .arg(database_url)
        .arg("--clean")
        .arg("--if-exists")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg(dump_path)
        .output()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Could not run pg_restore: {error}"),
            )
        })?;
    if !output.status.success() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!(
                "pg_restore failed: {}",
                terse(&String::from_utf8_lossy(&output.stderr))
            ),
        ));
    }
    Ok(())
}

async fn terminate_connections(state: &AppState) -> Result<(), ApiError> {
    sqlx::query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
    )
    .execute(&state.db)
    .await
    .map_err(ApiError::from)?;
    Ok(())
}

async fn sha256_file(path: &FsPath) -> Result<String, ApiError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "Backup archive not found"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).await.map_err(|_| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not read backup")
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn audit_admin(
    state: &AppState,
    actor: &str,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    record_audit(&state.db, actor, action, details).await
}

fn validate_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty()
        || id.len() > 80
        || !id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid backup id"));
    }
    Ok(())
}

fn custom_key() -> String {
    format!("atl_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn title_role(role: &str) -> &'static str {
    match role {
        "reader" => "Viewer",
        "importer" => "Importer",
        "reviewer" => "Reviewer",
        _ => "Access",
    }
}

fn with_database(url: &str, database: &str) -> String {
    let (base, query) = match url.split_once('?') {
        Some((base, query)) => (base, Some(query)),
        None => (url, None),
    };
    let prefix = match base.rfind('/') {
        Some(index) => &base[..index + 1],
        None => base,
    };
    match query {
        Some(query) => format!("{prefix}{database}?{query}"),
        None => format!("{prefix}{database}"),
    }
}

fn terse(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 400 {
        trimmed.to_string()
    } else {
        format!("{}…", &trimmed[..400])
    }
}

fn copy_tree(source: &FsPath, destination: &FsPath) -> std::io::Result<(i64, i64)> {
    std::fs::create_dir_all(destination)?;
    let mut count = 0;
    let mut bytes = 0;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            let (child_count, child_bytes) = copy_tree(&entry.path(), &target)?;
            count += child_count;
            bytes += child_bytes;
        } else if metadata.is_file() {
            std::fs::copy(entry.path(), &target)?;
            count += 1;
            bytes += metadata.len() as i64;
        }
    }
    Ok((count, bytes))
}

fn replace_tree(source: &FsPath, destination: &FsPath) -> std::io::Result<()> {
    if destination.exists() {
        std::fs::remove_dir_all(destination)?;
    }
    std::fs::create_dir_all(destination)?;
    copy_tree(source, destination)?;
    Ok(())
}
