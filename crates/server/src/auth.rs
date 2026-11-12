use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::{ApiError, ApiResult, AppState, mfa, record_audit, role};

pub(crate) const SESSION_HEADER: &str = "x-atlasio-session";
const SESSION_HOURS: i64 = 12;
const MAX_FAILED_ATTEMPTS: i32 = 5;
const MIN_PASSWORD_CHARS: usize = 8;
const MAX_PASSWORD_CHARS: usize = 128;

#[derive(Debug, Clone)]
pub(crate) struct Account {
    pub id: Uuid,
    pub username: String,
    pub role: String,
    pub must_change_password: bool,
    pub mfa_enabled: bool,
}

impl Account {
    pub(crate) fn role_label(&self) -> &'static str {
        match self.role.as_str() {
            "admin" => "admin",
            _ => "datamgr",
        }
    }
}

pub(crate) struct BootstrapAccount<'a> {
    pub username: &'a str,
    pub password: &'a str,
    pub role: &'a str,
}

pub(crate) fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn unauthorized() -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "Incorrect username or password")
}

async fn record_failure(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE admin_accounts SET failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END, locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + interval '5 minutes' ELSE NULL END WHERE id = $1",
    )
    .bind(id)
    .bind(MAX_FAILED_ATTEMPTS)
    .execute(pool)
    .await?;
    Ok(())
}

/// Hash a password off the async runtime; Argon2 is deliberately slow.
fn hash_password_sync(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Could not hash the password".to_string())
}

pub(crate) async fn hash_password(password: String) -> Result<String, ApiError> {
    tokio::task::spawn_blocking(move || hash_password_sync(&password))
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not hash the password",
            )
        })?
        .map_err(|message| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &message))
}

async fn verify_password(hash: String, password: String) -> bool {
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash)
            .ok()
            .and_then(|parsed| {
                Argon2::default()
                    .verify_password(password.as_bytes(), &parsed)
                    .ok()
            })
            .is_some()
    })
    .await
    .unwrap_or(false)
}

fn check_username(username: &str) -> Result<String, String> {
    let username = username.trim().to_lowercase();
    if username.len() < 3 || username.len() > 32 {
        return Err("Username must be between 3 and 32 characters".into());
    }
    if !username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
    {
        return Err(
            "Username may contain letters, digits, dot, underscore, and hyphen only".into(),
        );
    }
    Ok(username)
}

fn check_password_shape(password: &str) -> Result<(), String> {
    let length = password.chars().count();
    if length < MIN_PASSWORD_CHARS {
        return Err(format!(
            "Password must be at least {MIN_PASSWORD_CHARS} characters"
        ));
    }
    if length > MAX_PASSWORD_CHARS {
        return Err(format!(
            "Password must be at most {MAX_PASSWORD_CHARS} characters"
        ));
    }
    Ok(())
}

/// Create the two operational accounts on first run. Once an account exists,
/// the environment password is ignored; `reset` deliberately reissues it.
pub(crate) async fn bootstrap_accounts(
    pool: &PgPool,
    accounts: [BootstrapAccount<'_>; 2],
    reset: bool,
) -> Result<(), String> {
    for account in accounts {
        let username = check_username(account.username)?;
        if account.role != "admin" && account.role != "datamgr" {
            return Err(format!("Unsupported account role: {}", account.role));
        }
        check_password_shape(account.password)?;
        let existing = sqlx::query("SELECT id, role FROM admin_accounts WHERE username = $1")
            .bind(&username)
            .fetch_optional(pool)
            .await
            .map_err(|error| error.to_string())?;
        match existing {
            None => {
                let password = account.password.to_string();
                let hash = tokio::task::spawn_blocking(move || hash_password_sync(&password))
                    .await
                    .map_err(|_| "Could not hash the initial password".to_string())??;
                let id = Uuid::new_v4();
                sqlx::query(
                    "INSERT INTO admin_accounts (id, username, role, password_hash, must_change_password) VALUES ($1, $2, $3, $4, true)",
                )
                .bind(id)
                .bind(&username)
                .bind(account.role)
                .bind(hash)
                .execute(pool)
                .await
                .map_err(|error| error.to_string())?;
                record_audit(
                    pool,
                    "system",
                    "auth.account.bootstrap",
                    json!({ "username": username, "role": account.role }),
                )
                .await
                .map_err(|error| error.to_string())?;
                eprintln!(
                    "atlasio: created {} account '{}' from the initial password; a change is required at first sign-in",
                    account.role, username
                );
            }
            Some(row) => {
                let existing_role: String = row.get("role");
                if existing_role != account.role {
                    return Err(format!(
                        "Account '{}' already exists with role '{}', not '{}'",
                        username, existing_role, account.role
                    ));
                }
                if reset {
                    let id: Uuid = row.get("id");
                    let password = account.password.to_string();
                    let hash = tokio::task::spawn_blocking(move || hash_password_sync(&password))
                        .await
                        .map_err(|_| "Could not hash the initial password".to_string())??;
                    sqlx::query(
                        "UPDATE admin_accounts SET password_hash = $1, must_change_password = true, mfa_secret = NULL, mfa_enabled = false, mfa_recovery_hashes = '[]'::jsonb, failed_attempts = 0, locked_until = NULL, password_changed_at = NULL WHERE id = $2",
                    )
                    .bind(hash)
                    .bind(id)
                    .execute(pool)
                    .await
                    .map_err(|error| error.to_string())?;
                    sqlx::query("DELETE FROM auth_sessions WHERE account_id = $1")
                        .bind(id)
                        .execute(pool)
                        .await
                        .map_err(|error| error.to_string())?;
                    record_audit(
                        pool,
                        "system",
                        "auth.password.reset",
                        json!({ "username": username, "role": account.role }),
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                    eprintln!(
                        "atlasio: reset the {} account '{}' to its initial password and cleared MFA",
                        account.role, username
                    );
                }
            }
        }
    }
    Ok(())
}

pub(crate) struct MfaReset {
    pub username: String,
    pub role: String,
    pub cleared: bool,
}

/// Clear one account's authenticator and recovery codes without touching its
/// password. Used by the explicit `reset-mfa` operator command.
pub(crate) async fn reset_mfa_for_username(
    pool: &PgPool,
    username: &str,
) -> Result<MfaReset, String> {
    let username = check_username(username)?;
    let account = sqlx::query(
        "SELECT id, role, mfa_enabled, (mfa_secret IS NOT NULL) AS has_secret FROM admin_accounts WHERE username = $1",
    )
    .bind(&username)
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("No staff account named '{username}'"))?;
    let id: Uuid = account.get("id");
    let role: String = account.get("role");
    let had_mfa: bool = account.get("mfa_enabled") || account.get("has_secret");
    if had_mfa {
        sqlx::query(
            "UPDATE admin_accounts SET mfa_secret = NULL, mfa_enabled = false, mfa_recovery_hashes = '[]'::jsonb, failed_attempts = 0, locked_until = NULL WHERE id = $1",
        )
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
        sqlx::query("DELETE FROM auth_sessions WHERE account_id = $1")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
        record_audit(
            pool,
            "system",
            "auth.mfa.reset",
            json!({
                "username": username,
                "role": role,
                "source": "reset-mfa command",
            }),
        )
        .await
        .map_err(|error| error.to_string())?;
    }
    Ok(MfaReset {
        username,
        role,
        cleared: had_mfa,
    })
}

pub(crate) async fn session_account(
    pool: &PgPool,
    headers: &HeaderMap,
) -> Result<Option<Account>, sqlx::Error> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    let row = sqlx::query(
        "SELECT a.id, a.username, a.role, a.must_change_password, a.mfa_enabled
         FROM auth_sessions s JOIN admin_accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1 AND s.expires_at > now()",
    )
    .bind(token_hash(&token))
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| Account {
        id: row.get("id"),
        username: row.get("username"),
        role: row.get("role"),
        must_change_password: row.get("must_change_password"),
        mfa_enabled: row.get("mfa_enabled"),
    }))
}

pub(crate) async fn require_session(
    pool: &PgPool,
    headers: &HeaderMap,
) -> Result<Account, ApiError> {
    session_account(pool, headers)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "Sign in to continue"))
}

/// Re-check the current password before a sensitive account change.
pub(crate) async fn ensure_password(
    pool: &PgPool,
    id: Uuid,
    password: &str,
) -> Result<(), ApiError> {
    let row = sqlx::query("SELECT password_hash FROM admin_accounts WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await?;
    let hash: String = row.get("password_hash");
    if verify_password(hash, password.to_string()).await {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "The current password is incorrect",
        ))
    }
}

/// Mutating administrative work needs a signed-in account whose initial
/// password and required factors are settled.
pub(crate) async fn require_ready(
    headers: &HeaderMap,
    state: &AppState,
    allowed: &[&str],
) -> Result<Account, ApiError> {
    role(headers, state, allowed).await?;
    let account = require_session(&state.db, headers).await?;
    if account.must_change_password {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Change the initial password before making changes",
        ));
    }
    if state.mfa_required && !account.mfa_enabled {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Add an authenticator app before making changes",
        ));
    }
    Ok(account)
}

#[derive(Deserialize)]
pub(crate) struct LoginRequest {
    username: String,
    password: String,
    code: Option<String>,
}

pub(crate) async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> ApiResult {
    let username = request.username.trim().to_lowercase();
    if username.is_empty() || request.password.len() > 512 {
        return Err(unauthorized());
    }
    let row = sqlx::query(
        "SELECT id, username, role, password_hash, must_change_password, mfa_enabled, mfa_secret, mfa_recovery_hashes, locked_until FROM admin_accounts WHERE username = $1",
    )
    .bind(&username)
    .fetch_optional(&state.db)
    .await?;

    let Some(row) = row else {
        // Spend comparable time on a missing user so the response does not
        // reveal which usernames exist.
        let _ = verify_password(state.dummy_hash.clone(), request.password).await;
        return Err(unauthorized());
    };
    let locked: Option<DateTime<Utc>> = row.get("locked_until");
    if locked.map(|until| until > Utc::now()).unwrap_or(false) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Wait a few minutes and try again",
        ));
    }
    let hash: String = row.get("password_hash");
    if !verify_password(hash, request.password).await {
        record_failure(&state.db, row.get::<Uuid, _>("id")).await?;
        return Err(unauthorized());
    }

    if row.get::<bool, _>("mfa_enabled") {
        let code = request.code.as_deref().unwrap_or("").trim();
        if code.is_empty() {
            return Err(ApiError::new(
                StatusCode::PRECONDITION_REQUIRED,
                "Enter the authenticator code for this account",
            ));
        }
        let encrypted: Option<String> = row.get("mfa_secret");
        let recovery: Value = row.get("mfa_recovery_hashes");
        match mfa::verify_login_code(&state, encrypted.as_deref(), &recovery, code).await? {
            Some(Some(remaining)) => {
                sqlx::query("UPDATE admin_accounts SET mfa_recovery_hashes = $1 WHERE id = $2")
                    .bind(remaining)
                    .bind(row.get::<Uuid, _>("id"))
                    .execute(&state.db)
                    .await?;
            }
            Some(None) => {}
            None => {
                record_failure(&state.db, row.get::<Uuid, _>("id")).await?;
                return Err(ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    "That authenticator code was not accepted",
                ));
            }
        }
    }

    let account = Account {
        id: row.get("id"),
        username: row.get("username"),
        role: row.get("role"),
        must_change_password: row.get("must_change_password"),
        mfa_enabled: row.get("mfa_enabled"),
    };
    sqlx::query(
        "UPDATE admin_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1",
    )
    .bind(account.id)
    .execute(&state.db)
    .await?;
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at < now()")
        .execute(&state.db)
        .await?;

    let token = new_token();
    let expires_at = Utc::now() + Duration::hours(SESSION_HOURS);
    sqlx::query(
        "INSERT INTO auth_sessions (id, account_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(account.id)
    .bind(token_hash(&token))
    .bind(expires_at)
    .execute(&state.db)
    .await?;
    record_audit(
        &state.db,
        &account.username,
        "auth.login",
        json!({ "role": account.role_label() }),
    )
    .await?;

    Ok(Json(json!({
        "session": token,
        "expires_at": expires_at.to_rfc3339(),
        "account": mfa::account_json(&account, state.mfa_required, account.mfa_enabled),
    })))
}

pub(crate) async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    if let Some(token) = session_token(&headers) {
        sqlx::query("DELETE FROM auth_sessions WHERE token_hash = $1")
            .bind(token_hash(&token))
            .execute(&state.db)
            .await?;
    }
    Ok(Json(json!({ "status": "signed out" })))
}

#[derive(Deserialize)]
pub(crate) struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

pub(crate) async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ChangePasswordRequest>,
) -> ApiResult {
    let account = require_session(&state.db, &headers).await?;
    let row = sqlx::query("SELECT password_hash FROM admin_accounts WHERE id = $1")
        .bind(account.id)
        .fetch_one(&state.db)
        .await?;
    let current_hash: String = row.get("password_hash");
    if !verify_password(current_hash.clone(), request.current_password).await {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "The current password is incorrect",
        ));
    }
    check_password_shape(&request.new_password)
        .map_err(|message| ApiError::new(StatusCode::BAD_REQUEST, &message))?;
    if request
        .new_password
        .to_lowercase()
        .contains(&account.username)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "The password must not contain the username",
        ));
    }
    if verify_password(current_hash, request.new_password.clone()).await {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Choose a password different from the current one",
        ));
    }
    let hash = hash_password(request.new_password).await?;
    sqlx::query(
        "UPDATE admin_accounts SET password_hash = $1, must_change_password = false, password_changed_at = now() WHERE id = $2",
    )
    .bind(hash)
    .bind(account.id)
    .execute(&state.db)
    .await?;
    // Keep this session, revoke every other one for this account.
    if let Some(token) = session_token(&headers) {
        sqlx::query("DELETE FROM auth_sessions WHERE account_id = $1 AND token_hash <> $2")
            .bind(account.id)
            .bind(token_hash(&token))
            .execute(&state.db)
            .await?;
    }
    record_audit(
        &state.db,
        &account.username,
        "auth.password.change",
        json!({ "role": account.role_label() }),
    )
    .await?;
    let account = Account {
        must_change_password: false,
        ..account
    };
    Ok(Json(json!({
        "status": "changed",
        "account": mfa::account_json(&account, state.mfa_required, account.mfa_enabled),
    })))
}

#[cfg(test)]
mod tests {
    use super::{check_password_shape, check_username, token_hash};

    #[test]
    fn usernames_are_normalized_and_validated() {
        assert_eq!(check_username("  Admin.01 ").unwrap(), "admin.01");
        assert!(check_username("ab").is_err());
        assert!(check_username("bad user").is_err());
        assert!(check_username("bad@user").is_err());
    }

    #[test]
    fn password_length_is_enforced() {
        assert!(check_password_shape("short").is_err());
        assert!(check_password_shape("1234567").is_err());
        assert!(check_password_shape("12345678").is_ok());
        assert!(check_password_shape("correct horse battery staple").is_ok());
        assert!(check_password_shape(&"x".repeat(129)).is_err());
    }

    #[test]
    fn tokens_hash_deterministically_and_differently() {
        assert_eq!(token_hash("abc"), token_hash("abc"));
        assert_ne!(token_hash("abc"), token_hash("abd"));
        assert_eq!(token_hash("abc").len(), 64);
    }
}
