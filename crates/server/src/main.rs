mod admin;
mod auth;
mod mfa;

use std::{
    env,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use atlasio_domain::{Candidate, Finding, Manifest, next_version, qc_findings};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use object_store::{ObjectStore, ObjectStoreExt, PutPayload, path::Path as ObjectPath};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool, Row, types::Json as DbJson};
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    objects: Arc<dyn ObjectStore>,
    db_url: String,
    backup_dir: PathBuf,
    pg_dump: String,
    pg_restore: String,
    object_dir: Option<PathBuf>,
    storage_mode: &'static str,
    app_version: String,
    changelog_path: PathBuf,
    dummy_hash: String,
    mfa_required: bool,
    mfa_key: Option<Vec<u8>>,
    started_at: Instant,
    maintenance: Arc<AtomicBool>,
    admin_job: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Debug)]
struct ApiError(StatusCode, Value);

impl ApiError {
    fn new(status: StatusCode, message: &str) -> Self {
        Self(status, json!(message))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "detail": self.1 }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        eprintln!("database error: {error}");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database operation failed",
        )
    }
}

impl From<object_store::Error> for ApiError {
    fn from(error: object_store::Error) -> Self {
        eprintln!("object storage error: {error}");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Object storage operation failed",
        )
    }
}

type ApiResult = Result<Json<Value>, ApiError>;

fn key_hash(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}

fn static_role(value: &str) -> Option<&'static str> {
    match value {
        "reader" => Some("reader"),
        "importer" => Some("importer"),
        "reviewer" => Some("reviewer"),
        _ => None,
    }
}

async fn role(
    headers: &HeaderMap,
    state: &AppState,
    allowed: &[&str],
) -> Result<&'static str, ApiError> {
    if let Some(account) = auth::session_account(&state.db, headers).await? {
        let current = account.role_label();
        if state.maintenance.load(Ordering::Relaxed) && current != "admin" {
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Maintenance in progress. Try again after the restore completes.",
            ));
        }
        return if allowed.contains(&current) {
            Ok(current)
        } else {
            Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "This role cannot perform this action",
            ))
        };
    }

    let key = headers
        .get("x-atlasio-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if key.is_empty() {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "A valid Atlasio API key or account session is required",
        ));
    }
    if state.maintenance.load(Ordering::Relaxed) {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Maintenance in progress. Try again after the restore completes.",
        ));
    }

    let stored: Option<String> = sqlx::query_scalar(
        "UPDATE access_profiles SET last_used_at = now() WHERE active AND (demo_key = $1 OR key_hash = $2) RETURNING role",
    )
    .bind(key)
    .bind(key_hash(key))
    .fetch_optional(&state.db)
    .await?;
    let Some(current) = stored.as_deref().and_then(static_role) else {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "A valid Atlasio API key is required",
        ));
    };
    if allowed.contains(&current) {
        Ok(current)
    } else {
        Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "This role cannot perform this action",
        ))
    }
}

async fn load_candidates(conn: &mut PgConnection) -> Result<Vec<Candidate>, sqlx::Error> {
    let rows = sqlx::query("SELECT w.id AS well_id, v.name, v.aliases, v.external_id FROM wells w JOIN well_versions v ON v.id = w.current_version_id")
        .fetch_all(conn).await?;
    Ok(rows
        .into_iter()
        .map(|row| Candidate {
            well_id: row.get("well_id"),
            name: row.get("name"),
            aliases: row.get("aliases"),
            external_id: row.get("external_id"),
        })
        .collect())
}

async fn audit(
    conn: &mut PgConnection,
    batch_id: Uuid,
    actor: &str,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO audit_events (batch_id, actor, action, details) VALUES ($1, $2, $3, $4)",
    )
    .bind(batch_id)
    .bind(actor)
    .bind(action)
    .bind(DbJson(details))
    .execute(conn)
    .await?;
    Ok(())
}

pub(crate) async fn record_audit(
    pool: &PgPool,
    actor: &str,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO audit_events (batch_id, actor, action, details) VALUES (NULL, $1, $2, $3)",
    )
    .bind(actor)
    .bind(action)
    .bind(DbJson(details))
    .execute(pool)
    .await?;
    Ok(())
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        .execute(pool).await?;
    let migrations = [
        (
            "001_initial.sql",
            include_str!("../../../migrations/001_initial.sql"),
        ),
        (
            "002_published_immutability.sql",
            include_str!("../../../migrations/002_published_immutability.sql"),
        ),
        (
            "003_access_profiles.sql",
            include_str!("../../../migrations/003_access_profiles.sql"),
        ),
        (
            "004_accounts.sql",
            include_str!("../../../migrations/004_accounts.sql"),
        ),
    ];
    for (version, sql) in migrations {
        let applied: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)")
                .bind(version)
                .fetch_one(pool)
                .await?;
        if !applied {
            let mut tx = pool.begin().await?;
            for statement in split_statements(sql) {
                sqlx::query(statement).execute(&mut *tx).await?;
            }
            sqlx::query("INSERT INTO schema_migrations(version) VALUES ($1)")
                .bind(version)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
        }
    }
    Ok(())
}

/// Split a migration script into individual statements.
///
/// Statements run through `sqlx::query` so the migration future stays `Send`,
/// which axum handlers require. `sqlx::raw_sql` currently trips a rustc
/// higher-ranked lifetime limitation ("implementation of `Executor` is not
/// general enough") when the surrounding future must be `Send`. Semicolons
/// inside quoted strings and dollar-quoted function bodies are preserved.
fn split_statements(script: &str) -> Vec<&str> {
    let bytes = script.as_bytes();
    let mut statements = Vec::new();
    let mut start = 0;
    let mut in_quote = false;
    let mut in_dollar = false;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\'' {
            in_quote = !in_quote;
            index += 1;
        } else if !in_quote && byte == b'$' && bytes.get(index + 1) == Some(&b'$') {
            in_dollar = !in_dollar;
            index += 2;
        } else if !in_quote && !in_dollar && byte == b';' {
            let statement = script[start..index].trim();
            if !statement.is_empty() && !statement.starts_with("--") {
                statements.push(statement);
            }
            start = index + 1;
            index += 1;
        } else {
            index += 1;
        }
    }
    let tail = script[start..].trim();
    if !tail.is_empty() && !tail.starts_with("--") {
        statements.push(tail);
    }
    statements
}

type StorageSetup = (Arc<dyn ObjectStore>, Option<PathBuf>, &'static str);

fn object_store() -> Result<StorageSetup, Box<dyn std::error::Error>> {
    if let Ok(directory) = env::var("ATLASIO_LOCAL_OBJECT_DIR") {
        let path = PathBuf::from(directory);
        std::fs::create_dir_all(&path)?;
        return Ok((
            Arc::new(object_store::local::LocalFileSystem::new_with_prefix(
                &path,
            )?),
            Some(path),
            "local",
        ));
    }
    let endpoint = env::var("S3_ENDPOINT")?;
    let store = object_store::aws::AmazonS3Builder::new()
        .with_bucket_name(env::var("S3_BUCKET")?)
        .with_region(env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into()))
        .with_endpoint(endpoint.clone())
        .with_access_key_id(env::var("S3_ACCESS_KEY")?)
        .with_secret_access_key(env::var("S3_SECRET_KEY")?)
        .with_allow_http(endpoint.starts_with("http://"))
        .build()?;
    Ok((Arc::new(store), None, "s3"))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_url = env::var("DATABASE_URL")?;
    let pool = PgPool::connect(&db_url).await?;
    migrate(&pool).await?;
    let (objects, object_dir, storage_mode) = object_store()?;
    let backup_dir =
        PathBuf::from(env::var("ATLASIO_BACKUP_DIR").unwrap_or_else(|_| "backups".to_string()));
    tokio::fs::create_dir_all(&backup_dir).await?;
    let app_version = std::fs::read_to_string("VERSION")
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let admin_username = env::var("ATLASIO_ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_string());
    let datamgr_username =
        env::var("ATLASIO_DATAMGR_USERNAME").unwrap_or_else(|_| "datamgr".to_string());
    let admin_initial = env::var("ATLASIO_ADMIN_INITIAL_PASSWORD").map_err(
        |_| "ATLASIO_ADMIN_INITIAL_PASSWORD is required to seed the Administrator account",
    )?;
    let datamgr_initial = env::var("ATLASIO_DATAMGR_INITIAL_PASSWORD").map_err(
        |_| "ATLASIO_DATAMGR_INITIAL_PASSWORD is required to seed the Data Manager account",
    )?;
    let reset_passwords = env::var("ATLASIO_RESET_PASSWORDS")
        .map(|value| value == "1")
        .unwrap_or(false);
    auth::bootstrap_accounts(
        &pool,
        [
            auth::BootstrapAccount {
                username: &admin_username,
                password: &admin_initial,
                role: "admin",
            },
            auth::BootstrapAccount {
                username: &datamgr_username,
                password: &datamgr_initial,
                role: "datamgr",
            },
        ],
        reset_passwords,
    )
    .await?;
    let dummy_hash = auth::hash_password("atlasio-dummy-password-for-timing".to_string())
        .await
        .map_err(|_| "Could not prepare the login timing verifier")?;
    let mfa_required = env::var("ATLASIO_MFA_REQUIRED")
        .map(|value| value == "1")
        .unwrap_or(false);
    let mfa_key = match env::var("ATLASIO_MFA_KEY") {
        Ok(value) => Some(
            mfa::decode_key(&value)
                .map_err(|message| format!("{message} (ATLASIO_MFA_KEY)"))?
                .to_vec(),
        ),
        Err(_) => None,
    };
    if mfa_required && mfa_key.is_none() {
        return Err("ATLASIO_MFA_KEY is required when ATLASIO_MFA_REQUIRED=1".into());
    }

    let state = AppState {
        db: pool,
        objects,
        db_url,
        backup_dir,
        pg_dump: env::var("ATLASIO_PG_DUMP").unwrap_or_else(|_| "pg_dump".to_string()),
        pg_restore: env::var("ATLASIO_PG_RESTORE").unwrap_or_else(|_| "pg_restore".to_string()),
        object_dir,
        storage_mode,
        app_version,
        changelog_path: PathBuf::from(
            env::var("ATLASIO_CHANGELOG").unwrap_or_else(|_| "CHANGELOG.md".to_string()),
        ),
        dummy_hash,
        mfa_required,
        mfa_key,
        started_at: Instant::now(),
        maintenance: Arc::new(AtomicBool::new(false)),
        admin_job: Arc::new(tokio::sync::Mutex::new(())),
    };
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/me", get(me))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/password", post(auth::change_password))
        .route("/api/auth/mfa/start", post(mfa::start))
        .route("/api/auth/mfa/enable", post(mfa::enable))
        .route("/api/auth/mfa/disable", post(mfa::disable))
        .route("/api/demo-profiles", get(admin::demo_profiles))
        .route("/api/dashboard", get(dashboard))
        .route("/api/imports", post(stage).get(imports))
        .route("/api/imports/{id}", get(import_detail).patch(correct))
        .route("/api/imports/{id}/submit", post(submit))
        .route("/api/imports/{id}/review", post(review))
        .route("/api/wells/search", get(search))
        .route("/api/wells/{id}", get(well_detail))
        .route("/api/map/wells", get(map_wells))
        .route("/api/files/{id}", get(download))
        .route("/api/admin/status", get(admin::status))
        .route(
            "/api/admin/profiles",
            get(admin::profiles).post(admin::create_profile),
        )
        .route(
            "/api/admin/profiles/{id}",
            axum::routing::patch(admin::update_profile),
        )
        .route(
            "/api/admin/profiles/{id}/rotate",
            post(admin::rotate_profile),
        )
        .route(
            "/api/admin/backups",
            get(admin::backups).post(admin::create_backup),
        )
        .route("/api/admin/backups/{id}", delete(admin::delete_backup))
        .route(
            "/api/admin/backups/{id}/download",
            get(admin::download_backup),
        )
        .route("/api/admin/backups/{id}/verify", post(admin::verify_backup))
        .route(
            "/api/admin/backups/{id}/restore",
            post(admin::restore_backup),
        )
        .route("/api/admin/audit", get(admin::audit_log))
        .route("/api/admin/changelog", get(admin::changelog))
        .route("/", get(index))
        .route("/favicon.svg", get(favicon))
        .nest_service("/assets", ServeDir::new("web/dist/assets"))
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn index() -> Result<Html<String>, ApiError> {
    let html = tokio::fs::read_to_string("web/dist/index.html")
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Build the web client first",
            )
        })?;
    Ok(Html(html))
}

async fn favicon() -> Response {
    match tokio::fs::read("web/dist/favicon.svg").await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "image/svg+xml")], bytes).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn health(State(state): State<AppState>) -> ApiResult {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await?;
    Ok(Json(json!({ "status": "ok" })))
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let who = role(
        &headers,
        &state,
        &["importer", "reviewer", "reader", "admin", "datamgr"],
    )
    .await?;
    let account = auth::session_account(&state.db, &headers).await?;
    Ok(Json(json!({
        "role": who,
        "account": account.map(|account| mfa::account_json(&account, state.mfa_required, account.mfa_enabled)),
    })))
}

#[derive(Deserialize)]
struct DashboardParams {
    well_ids: Option<String>,
    area: Option<bool>,
}

async fn dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<DashboardParams>,
) -> ApiResult {
    let who = role(
        &headers,
        &state,
        &["importer", "reviewer", "reader", "admin", "datamgr"],
    )
    .await?;
    let well_ids = if params.area.unwrap_or(false) {
        Some(
            params
                .well_ids
                .unwrap_or_default()
                .split(',')
                .filter(|id| !id.is_empty())
                .map(str::parse)
                .collect::<Result<Vec<Uuid>, _>>()
                .map_err(|_| {
                    ApiError::new(StatusCode::BAD_REQUEST, "well_ids must contain UUID values")
                })?,
        )
    } else {
        None
    };
    let wells: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM wells w JOIN well_versions v ON v.id=w.current_version_id JOIN file_assets f ON f.batch_id=v.batch_id WHERE ($1 OR f.confidentiality='public') AND ($2::uuid[] IS NULL OR w.id=ANY($2))",
    )
    .bind(who != "reader")
    .bind(&well_ids)
    .fetch_one(&state.db)
    .await?;
    let versions: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM well_versions v JOIN file_assets f ON f.batch_id=v.batch_id WHERE ($1 OR f.confidentiality='public') AND ($2::uuid[] IS NULL OR v.well_id=ANY($2))",
    )
    .bind(who != "reader")
    .bind(&well_ids)
    .fetch_one(&state.db)
    .await?;
    let originals: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM file_assets f JOIN import_batches b ON b.id=f.batch_id WHERE b.status='published' AND ($1 OR f.confidentiality='public') AND ($2::uuid[] IS NULL OR b.well_id=ANY($2))",
    )
    .bind(who != "reader")
    .bind(&well_ids)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({
        "scope": if params.area.unwrap_or(false) { "selected_area" } else { "global" },
        "counts": {
            "wells": { "value": wells, "state": "available" },
            "well_versions": { "value": versions, "state": "available" },
            "original_files": { "value": originals, "state": "available" },
            "ep_projects": { "value": null, "state": "not_cataloged" },
            "logs": { "value": null, "state": "not_cataloged" },
            "formation_tops": { "value": null, "state": "not_cataloged" },
            "interpretations": { "value": null, "state": "not_cataloged" },
            "seismic_surveys": { "value": null, "state": "not_cataloged" },
            "seismic_2d_lines": { "value": null, "state": "not_cataloged" },
            "seismic_3d_cubes": { "value": null, "state": "not_cataloged" },
            "seismic_interpretations": { "value": null, "state": "not_cataloged" },
            "reports": { "value": null, "state": "not_cataloged" },
            "ma_reports": { "value": null, "state": "not_cataloged" },
            "concession_maps": { "value": null, "state": "not_cataloged" },
            "permits_licenses": { "value": null, "state": "not_cataloged" },
            "land_leases": { "value": null, "state": "not_cataloged" },
            "gis_basemaps": { "value": null, "state": "not_cataloged" },
            "drilling_records": { "value": null, "state": "not_cataloged" },
            "completion_records": { "value": null, "state": "not_cataloged" },
            "workover_records": { "value": null, "state": "not_cataloged" },
            "horizontal_wells": { "value": null, "state": "not_cataloged" },
            "production_records": { "value": null, "state": "not_cataloged" },
            "production_tests": { "value": null, "state": "not_cataloged" },
            "injection_records": { "value": null, "state": "not_cataloged" }
        }
    })))
}

#[derive(Deserialize)]
struct StageRequest {
    manifest: Manifest,
    file_name: String,
    file_base64: String,
}

async fn stage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<StageRequest>,
) -> ApiResult {
    let who = role(&headers, &state, &["importer"]).await?;
    let bytes = STANDARD
        .decode(payload.file_base64)
        .map_err(|_| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "file_base64 is invalid"))?;
    if bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Original file must be between 1 byte and 5 MiB",
        ));
    }
    let file_name = payload.file_name.rsplit(['/', '\\']).next().unwrap_or("");
    if file_name.is_empty() || file_name.contains(['"', '\r', '\n']) {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid file name",
        ));
    }
    let batch_id = Uuid::new_v4();
    let file_id = Uuid::new_v4();
    let key = ObjectPath::from(format!("imports/{batch_id}/{file_id}"));
    let checksum = format!("{:x}", Sha256::digest(&bytes));
    let mut tx = state.db.begin().await?;
    let candidates = load_candidates(&mut tx).await?;
    let findings = qc_findings(&payload.manifest, &candidates);
    state
        .objects
        .put(&key, PutPayload::from(bytes.clone()))
        .await?;
    let result: Result<(), sqlx::Error> = async {
        sqlx::query("INSERT INTO import_batches (id, status, manifest, qc) VALUES ($1, 'staged', $2, $3)")
            .bind(batch_id).bind(DbJson(&payload.manifest)).bind(DbJson(&findings)).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO file_assets (id, batch_id, original_name, object_key, sha256, size_bytes, license, confidentiality) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(file_id).bind(batch_id).bind(file_name).bind(key.to_string()).bind(&checksum).bind(bytes.len() as i64)
            .bind(payload.manifest.license.as_deref().unwrap_or(""))
            .bind(payload.manifest.confidentiality.as_deref().unwrap_or("restricted"))
            .execute(&mut *tx).await?;
        audit(&mut tx, batch_id, who, "staged", json!({ "sha256": checksum })).await?;
        Ok(())
    }.await;
    if let Err(error) = result {
        let _ = state.objects.delete(&key).await;
        return Err(error.into());
    }
    tx.commit().await?;
    Ok(Json(
        json!({ "id": batch_id, "status": "staged", "qc": findings, "file_id": file_id, "sha256": checksum }),
    ))
}

async fn imports(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    role(
        &headers,
        &state,
        &["importer", "reviewer", "admin", "datamgr"],
    )
    .await?;
    let rows = sqlx::query("SELECT id, status, manifest, qc, created_at, reviewer, review_reason, well_id FROM import_batches ORDER BY created_at DESC LIMIT 100")
        .fetch_all(&state.db).await?;
    let values: Vec<Value> = rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid, _>("id"), "status": row.get::<String, _>("status"),
        "manifest": row.get::<DbJson<Manifest>, _>("manifest").0,
        "qc": row.get::<DbJson<Vec<Finding>>, _>("qc").0,
        "created_at": row.get::<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>, _>("created_at"),
        "reviewer": row.get::<Option<String>, _>("reviewer"), "review_reason": row.get::<Option<String>, _>("review_reason"),
        "well_id": row.get::<Option<Uuid>, _>("well_id"),
    })).collect();
    Ok(Json(json!(values)))
}

async fn import_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult {
    role(
        &headers,
        &state,
        &["importer", "reviewer", "admin", "datamgr"],
    )
    .await?;
    let row = sqlx::query("SELECT b.id, b.status, b.manifest, b.qc, b.created_at, b.reviewer, b.review_reason, b.well_id, f.id AS file_id, f.original_name, f.sha256, f.size_bytes, f.license, f.confidentiality FROM import_batches b JOIN file_assets f ON f.batch_id=b.id WHERE b.id=$1")
        .bind(id).fetch_optional(&state.db).await?.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Import batch not found"))?;
    Ok(Json(json!({
        "id": id, "status": row.get::<String,_>("status"), "manifest": row.get::<DbJson<Manifest>,_>("manifest").0,
        "qc": row.get::<DbJson<Vec<Finding>>,_>("qc").0, "created_at": row.get::<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>,_>("created_at"),
        "reviewer": row.get::<Option<String>,_>("reviewer"), "review_reason": row.get::<Option<String>,_>("review_reason"),
        "well_id": row.get::<Option<Uuid>,_>("well_id"),
        "file": { "id": row.get::<Uuid,_>("file_id"), "original_name": row.get::<String,_>("original_name"), "sha256": row.get::<String,_>("sha256"),
            "size_bytes": row.get::<i64,_>("size_bytes"), "license": row.get::<String,_>("license"), "confidentiality": row.get::<String,_>("confidentiality") },
    })))
}

async fn correct(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(changes): Json<Value>,
) -> ApiResult {
    let who = role(&headers, &state, &["importer"]).await?;
    let changes = changes.as_object().ok_or_else(|| {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Corrections must be a JSON object",
        )
    })?;
    let allowed = [
        "name",
        "aliases",
        "external_id",
        "source",
        "license",
        "confidentiality",
        "download_allowed",
        "source_crs",
        "x",
        "y",
    ];
    if changes.is_empty() || changes.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only well header and source metadata may be corrected",
        ));
    }
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT status, manifest FROM import_batches WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Import batch not found"))?;
    if row.get::<String, _>("status") != "staged" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Only staged imports can be corrected",
        ));
    }
    let mut value = serde_json::to_value(row.get::<DbJson<Manifest>, _>("manifest").0)
        .expect("manifest serializes");
    let map = value.as_object_mut().expect("manifest is an object");
    for (key, new_value) in changes {
        map.insert(key.clone(), new_value.clone());
    }
    let manifest: Manifest = serde_json::from_value(value).map_err(|_| {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid corrected metadata",
        )
    })?;
    let findings = qc_findings(&manifest, &load_candidates(&mut tx).await?);
    sqlx::query("UPDATE import_batches SET manifest=$1, qc=$2 WHERE id=$3")
        .bind(DbJson(&manifest))
        .bind(DbJson(&findings))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE file_assets SET license=$1, confidentiality=$2 WHERE batch_id=$3")
        .bind(manifest.license.as_deref().unwrap_or(""))
        .bind(manifest.confidentiality.as_deref().unwrap_or("restricted"))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit(
        &mut tx,
        id,
        who,
        "corrected",
        json!({ "fields": changes.keys().collect::<Vec<_>>() }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "id": id, "status": "staged", "qc": findings }),
    ))
}

async fn submit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult {
    let who = role(&headers, &state, &["importer"]).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT status, manifest FROM import_batches WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Import batch not found"))?;
    if row.get::<String, _>("status") != "staged" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Only staged imports can be submitted",
        ));
    }
    let manifest = row.get::<DbJson<Manifest>, _>("manifest").0;
    let findings = qc_findings(&manifest, &load_candidates(&mut tx).await?);
    if findings.iter().any(|finding| finding.severity == "error") {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({ "message": "Resolve blocking QC findings", "qc": findings }),
        ));
    }
    sqlx::query(
        "UPDATE import_batches SET status='submitted', qc=$1, submitted_at=now() WHERE id=$2",
    )
    .bind(DbJson(&findings))
    .bind(id)
    .execute(&mut *tx)
    .await?;
    audit(&mut tx, id, who, "submitted", json!({})).await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "id": id, "status": "submitted", "qc": findings }),
    ))
}

#[derive(Deserialize)]
struct ReviewRequest {
    decision: String,
    identity_resolution: Option<String>,
    reason: Option<String>,
}

async fn review(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(request): Json<ReviewRequest>,
) -> ApiResult {
    let who = role(&headers, &state, &["reviewer"]).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT status, manifest FROM import_batches WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Import batch not found"))?;
    if row.get::<String, _>("status") != "submitted" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Only submitted imports can be reviewed",
        ));
    }
    if request.decision == "reject" {
        let reason = request
            .reason
            .filter(|text| !text.trim().is_empty())
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "A rejection reason is required",
                )
            })?;
        sqlx::query("UPDATE import_batches SET status='rejected', reviewed_at=now(), reviewer=$1, review_reason=$2 WHERE id=$3")
            .bind(who).bind(&reason).bind(id).execute(&mut *tx).await?;
        audit(&mut tx, id, who, "rejected", json!({ "reason": reason })).await?;
        tx.commit().await?;
        return Ok(Json(json!({ "id": id, "status": "rejected" })));
    }
    if request.decision != "approve" {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "decision must be approve or reject",
        ));
    }
    let manifest = row.get::<DbJson<Manifest>, _>("manifest").0;
    let findings = qc_findings(&manifest, &load_candidates(&mut tx).await?);
    if findings.iter().any(|finding| finding.severity == "error") {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({ "message": "Blocking QC findings remain", "qc": findings }),
        ));
    }
    let candidate_ids: Vec<Uuid> = findings
        .iter()
        .filter(|finding| finding.code == "possible_duplicate")
        .filter_map(|finding| finding.well_id)
        .collect();
    let resolution = request.identity_resolution.as_deref().unwrap_or("");
    let well_id = if resolution == "new" {
        Uuid::new_v4()
    } else {
        let selected = Uuid::parse_str(resolution).map_err(|_| ApiError(StatusCode::UNPROCESSABLE_ENTITY, json!({ "message": "Resolve identity as new or one of the candidate well IDs", "candidate_ids": candidate_ids })))?;
        if !candidate_ids.contains(&selected) {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({ "message": "Selected well is not a duplicate candidate", "candidate_ids": candidate_ids }),
            ));
        }
        selected
    };
    if resolution == "new" {
        sqlx::query("INSERT INTO wells(id) VALUES ($1)")
            .bind(well_id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query("SELECT id FROM wells WHERE id=$1 FOR UPDATE")
            .bind(well_id)
            .fetch_one(&mut *tx)
            .await?;
    }
    let versions: Vec<i32> =
        sqlx::query_scalar("SELECT version_no FROM well_versions WHERE well_id=$1")
            .bind(well_id)
            .fetch_all(&mut *tx)
            .await?;
    let version_no = next_version(&versions);
    let version_id = Uuid::new_v4();
    let name = manifest.name.as_deref().unwrap_or("");
    let source = manifest.source.as_deref().unwrap_or("");
    let crs = manifest.source_crs.as_deref().unwrap_or("");
    let x = manifest.x.unwrap_or(0.0);
    let y = manifest.y.unwrap_or(0.0);
    sqlx::query("INSERT INTO well_versions (id, well_id, version_no, batch_id, name, aliases, external_id, source, source_crs, source_x, source_y, display_point, transform_operation, reviewer) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,ST_SetSRID(ST_MakePoint($12,$13),4326),$14,$15)")
        .bind(version_id).bind(well_id).bind(version_no).bind(id).bind(name).bind(&manifest.aliases).bind(&manifest.external_id)
        .bind(source).bind(crs).bind(x).bind(y).bind(x).bind(y).bind("identity:EPSG:4326").bind(who)
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE wells SET current_version_id=$1 WHERE id=$2")
        .bind(version_id)
        .bind(well_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE import_batches SET status='published', reviewed_at=now(), reviewer=$1, review_reason=$2, well_id=$3, qc=$4 WHERE id=$5")
        .bind(who).bind(&request.reason).bind(well_id).bind(DbJson(&findings)).bind(id).execute(&mut *tx).await?;
    audit(
        &mut tx,
        id,
        who,
        "published",
        json!({ "well_id": well_id, "version_id": version_id, "identity_resolution": resolution }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "id": id, "status": "published", "well_id": well_id, "version_id": version_id, "version_no": version_no }),
    ))
}

#[derive(Deserialize)]
struct SearchQuery {
    #[serde(default)]
    q: String,
}

async fn search(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> ApiResult {
    let who = role(
        &headers,
        &state,
        &["importer", "reviewer", "reader", "admin", "datamgr"],
    )
    .await?;
    let pattern = format!("%{}%", query.q.trim());
    let rows = sqlx::query("SELECT w.id, v.id AS version_id, v.version_no, v.name, v.aliases, v.external_id, v.source, v.source_crs, ST_X(v.display_point) AS longitude, ST_Y(v.display_point) AS latitude FROM wells w JOIN well_versions v ON v.id=w.current_version_id JOIN file_assets f ON f.batch_id=v.batch_id WHERE ($2 OR f.confidentiality='public') AND (v.name ILIKE $1 OR v.external_id ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(v.aliases) a WHERE a ILIKE $1)) ORDER BY v.name LIMIT 100")
        .bind(pattern).bind(who != "reader").fetch_all(&state.db).await?;
    Ok(Json(json!(rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid,_>("id"), "version_id": row.get::<Uuid,_>("version_id"), "version_no": row.get::<i32,_>("version_no"),
        "name": row.get::<String,_>("name"), "aliases": row.get::<Vec<String>,_>("aliases"), "external_id": row.get::<Option<String>,_>("external_id"),
        "source": row.get::<String,_>("source"), "source_crs": row.get::<String,_>("source_crs"),
        "longitude": row.get::<f64,_>("longitude"), "latitude": row.get::<f64,_>("latitude"),
    })).collect::<Vec<_>>())))
}

async fn well_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult {
    let who = role(
        &headers,
        &state,
        &["importer", "reviewer", "reader", "admin", "datamgr"],
    )
    .await?;
    let current_row = sqlx::query("SELECT w.current_version_id, f.confidentiality FROM wells w JOIN well_versions v ON v.id=w.current_version_id JOIN file_assets f ON f.batch_id=v.batch_id WHERE w.id=$1")
        .bind(id).fetch_optional(&state.db).await?.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Well not found"))?;
    if who == "reader" && current_row.get::<String, _>("confidentiality") != "public" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "This well is restricted",
        ));
    }
    let current: Uuid = current_row.get("current_version_id");
    let rows = sqlx::query("SELECT v.id, v.version_no, v.name, v.aliases, v.external_id, v.source, v.source_crs, v.source_x, v.source_y, ST_X(v.display_point) AS longitude, ST_Y(v.display_point) AS latitude, v.transform_operation, v.reviewer, v.published_at, b.id AS batch_id, b.qc, b.manifest, f.id AS file_id, f.original_name, f.sha256, f.size_bytes, f.license, f.confidentiality FROM well_versions v JOIN import_batches b ON b.id=v.batch_id JOIN file_assets f ON f.batch_id=b.id WHERE v.well_id=$1 AND ($2 OR f.confidentiality='public') ORDER BY v.version_no DESC")
        .bind(id).bind(who != "reader").fetch_all(&state.db).await?;
    let versions: Vec<Value> = rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid,_>("id"), "version_no": row.get::<i32,_>("version_no"), "name": row.get::<String,_>("name"),
        "aliases": row.get::<Vec<String>,_>("aliases"), "external_id": row.get::<Option<String>,_>("external_id"), "source": row.get::<String,_>("source"),
        "source_crs": row.get::<String,_>("source_crs"), "source_x": row.get::<f64,_>("source_x"), "source_y": row.get::<f64,_>("source_y"),
        "longitude": row.get::<f64,_>("longitude"), "latitude": row.get::<f64,_>("latitude"), "transform_operation": row.get::<String,_>("transform_operation"),
        "reviewer": row.get::<String,_>("reviewer"), "published_at": row.get::<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>,_>("published_at"),
        "batch_id": row.get::<Uuid,_>("batch_id"), "qc": row.get::<DbJson<Vec<Finding>>,_>("qc").0,
        "file_id": row.get::<Uuid,_>("file_id"), "original_name": row.get::<String,_>("original_name"), "sha256": row.get::<String,_>("sha256"),
        "size_bytes": row.get::<i64,_>("size_bytes"), "license": row.get::<String,_>("license"), "confidentiality": row.get::<String,_>("confidentiality"),
        "download_allowed": row.get::<DbJson<Manifest>,_>("manifest").0.download_allowed,
    })).collect();
    Ok(Json(
        json!({ "id": id, "current_version_id": current, "versions": versions }),
    ))
}

async fn map_wells(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let who = role(
        &headers,
        &state,
        &["importer", "reviewer", "reader", "admin", "datamgr"],
    )
    .await?;
    let rows = sqlx::query("SELECT w.id, v.id AS version_id, v.name, v.version_no, ST_X(v.display_point) AS longitude, ST_Y(v.display_point) AS latitude FROM wells w JOIN well_versions v ON v.id=w.current_version_id JOIN file_assets f ON f.batch_id=v.batch_id WHERE $1 OR f.confidentiality='public'")
        .bind(who != "reader").fetch_all(&state.db).await?;
    let features: Vec<Value> = rows.into_iter().map(|row| json!({
        "type": "Feature", "id": row.get::<Uuid,_>("id"),
        "geometry": { "type": "Point", "coordinates": [row.get::<f64,_>("longitude"), row.get::<f64,_>("latitude")] },
        "properties": { "well_id": row.get::<Uuid,_>("id"), "version_id": row.get::<Uuid,_>("version_id"),
            "name": row.get::<String,_>("name"), "version_no": row.get::<i32,_>("version_no") },
    })).collect();
    Ok(Json(
        json!({ "type": "FeatureCollection", "features": features }),
    ))
}

async fn download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let who = role(
        &headers,
        &state,
        &["importer", "reviewer", "reader", "admin", "datamgr"],
    )
    .await?;
    let row = sqlx::query("SELECT f.object_key, f.original_name, f.sha256, f.confidentiality, b.manifest, b.status FROM file_assets f JOIN import_batches b ON b.id=f.batch_id WHERE f.id=$1")
        .bind(id).fetch_optional(&state.db).await?.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "File not found"))?;
    let manifest = row.get::<DbJson<Manifest>, _>("manifest").0;
    if row.get::<String, _>("status") != "published"
        || !manifest.download_allowed
        || (who == "reader" && row.get::<String, _>("confidentiality") != "public")
    {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Source license or review status prohibits download",
        ));
    }
    let key = ObjectPath::from(row.get::<String, _>("object_key"));
    let bytes = state.objects.get(&key).await?.bytes().await?;
    let checksum = format!("{:x}", Sha256::digest(&bytes));
    if checksum != row.get::<String, _>("sha256") {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Stored file checksum mismatch",
        ));
    }
    let file_name: String = row.get("original_name");
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/octet-stream"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        header::HeaderValue::from_str(&format!("attachment; filename=\"{file_name}\"")).map_err(
            |_| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Invalid stored file name",
                )
            },
        )?,
    );
    Ok(response)
}
