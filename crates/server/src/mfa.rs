use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::Utc;
use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, Mac};
use qrcode::{QrCode, render::svg};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{Value, json};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use sqlx::Row;
use tokio::task;

use super::{
    ApiError, ApiResult, AppState,
    auth::{self, Account},
    record_audit,
};

const RECOVERY_COUNT: usize = 8;
const RECOVERY_CHARS: usize = 10;

/// Parse `ATLASIO_MFA_KEY` as standard or URL-safe base64 for a 32-byte key.
pub(crate) fn decode_key(value: &str) -> Result<[u8; 32], String> {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
    let trimmed = value.trim();
    let bytes = STANDARD
        .decode(trimmed)
        .or_else(|_| URL_SAFE.decode(trimmed))
        .or_else(|_| URL_SAFE_NO_PAD.decode(trimmed))
        .map_err(|_| "ATLASIO_MFA_KEY must be base64 for 32 bytes".to_string())?;
    bytes
        .try_into()
        .map_err(|_| "ATLASIO_MFA_KEY must decode to exactly 32 bytes".to_string())
}

fn cipher(key: &[u8]) -> Result<Aes256Gcm, ApiError> {
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Invalid MFA key"))
}

fn encrypt(key: &[u8], plaintext: &str) -> Result<String, ApiError> {
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let sealed = cipher(key)?
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not protect the authenticator secret",
            )
        })?;
    let mut payload = nonce.to_vec();
    payload.extend(sealed);
    Ok(URL_SAFE_NO_PAD.encode(payload))
}

fn decrypt(key: &[u8], encoded: &str) -> Result<String, ApiError> {
    let payload = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The stored authenticator secret is unreadable",
        )
    })?;
    if payload.len() < 13 {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The stored authenticator secret is unreadable",
        ));
    }
    let (nonce, sealed) = payload.split_at(12);
    let plaintext = cipher(key)?
        .decrypt(Nonce::from_slice(nonce), sealed)
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The stored authenticator secret cannot be decrypted with this server key",
            )
        })?;
    String::from_utf8(plaintext).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The stored authenticator secret is unreadable",
        )
    })
}

fn mfa_key(state: &AppState) -> Result<&[u8], ApiError> {
    state.mfa_key.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "MFA is not configured on this deployment. Set ATLASIO_MFA_KEY.",
        )
    })
}

fn new_secret() -> String {
    let mut bytes = [0u8; 20];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    BASE32_NOPAD.encode(&bytes)
}

fn totp_code(secret: &str, counter: u64) -> Option<String> {
    let key = BASE32_NOPAD.decode(secret.as_bytes()).ok()?;
    let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(&key).ok()?;
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[19] & 0x0f) as usize;
    let binary = ((digest[offset] as u32 & 0x7f) << 24)
        | ((digest[offset + 1] as u32) << 16)
        | ((digest[offset + 2] as u32) << 8)
        | digest[offset + 3] as u32;
    Some(format!("{:06}", binary % 1_000_000))
}

fn verify_totp(secret: &str, code: &str) -> bool {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let step = Utc::now().timestamp() / 30;
    [-1_i64, 0, 1].into_iter().any(|offset| {
        let counter = (step + offset).max(0) as u64;
        totp_code(secret, counter).as_deref() == Some(code)
    })
}

fn otpauth_url(username: &str, secret: &str) -> String {
    let label = urlencode(&format!("Atlasio:{username}"));
    format!(
        "otpauth://totp/{label}?secret={secret}&issuer=Atlasio&algorithm=SHA1&digits=6&period=30"
    )
}

fn urlencode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            b' ' => encoded.push_str("%20"),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn qr_svg(url: &str) -> Result<String, ApiError> {
    QrCode::new(url.as_bytes())
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not render the authenticator QR code",
            )
        })
        .map(|code| {
            code.render::<svg::Color>()
                .min_dimensions(220, 220)
                .quiet_zone(true)
                .build()
        })
}

fn recovery_hashes(codes: &[String]) -> Value {
    Value::Array(
        codes
            .iter()
            .map(|code| Value::String(recovery_hash(code)))
            .collect(),
    )
}

fn recovery_hash(code: &str) -> String {
    let normalized: String = code
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    format!("{:x}", Sha256::digest(normalized.as_bytes()))
}

fn new_recovery_codes() -> Vec<String> {
    (0..RECOVERY_COUNT)
        .map(|_| {
            let mut bytes = [0u8; 7];
            rand::rngs::OsRng.fill_bytes(&mut bytes);
            let encoded = BASE32_NOPAD.encode(&bytes);
            let plain = &encoded[..RECOVERY_CHARS];
            format!("{}-{}", &plain[..5], &plain[5..])
        })
        .collect()
}

/// Check a login code against the encrypted TOTP secret or the recovery list.
///
/// Returns the updated recovery hashes when a recovery code was consumed, so
/// the caller can persist the one-time use.
pub(crate) async fn verify_login_code(
    state: &AppState,
    encrypted_secret: Option<&str>,
    recovery: &Value,
    code: &str,
) -> Result<Option<Option<Value>>, ApiError> {
    let code = code.trim();
    if code.is_empty() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "An authenticator code is required",
        ));
    }
    let key = mfa_key(state)?.to_vec();
    let secret = encrypted_secret
        .map(|value| decrypt(&key, value))
        .transpose()?;
    if let Some(secret) = secret.clone() {
        let code = code.to_string();
        if task::spawn_blocking(move || verify_totp(&secret, &code))
            .await
            .unwrap_or(false)
        {
            return Ok(Some(None));
        }
    }

    let candidate = recovery_hash(code);
    let stored = recovery.as_array().cloned().unwrap_or_default();
    let Some(index) = stored.iter().position(|value| {
        value
            .as_str()
            .map(|stored| stored == candidate)
            .unwrap_or(false)
    }) else {
        return Ok(None);
    };
    let mut remaining = stored;
    remaining.remove(index);
    Ok(Some(Some(Value::Array(remaining))))
}

#[derive(Deserialize)]
pub(crate) struct StartRequest {
    current_password: String,
}

pub(crate) async fn start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<StartRequest>,
) -> ApiResult {
    let account = auth::require_session(&state.db, &headers).await?;
    if account.mfa_enabled {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MFA is already enabled. Turn it off before enrolling again.",
        ));
    }
    auth::ensure_password(&state.db, account.id, &request.current_password).await?;
    let key = mfa_key(&state)?;
    let secret = new_secret();
    let encrypted = encrypt(key, &secret)?;
    sqlx::query(
        "UPDATE admin_accounts SET mfa_secret = $1, mfa_enabled = false, mfa_recovery_hashes = '[]'::jsonb WHERE id = $2",
    )
    .bind(&encrypted)
    .bind(account.id)
    .execute(&state.db)
    .await?;
    record_audit(
        &state.db,
        &account.username,
        "auth.mfa.start",
        json!({ "role": account.role_label() }),
    )
    .await?;
    let url = otpauth_url(&account.username, &secret);
    let svg = qr_svg(&url)?;
    Ok(Json(json!({
        "secret": secret,
        "otpauth": url,
        "qr_svg": svg,
    })))
}

#[derive(Deserialize)]
pub(crate) struct EnableRequest {
    code: String,
}

pub(crate) async fn enable(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<EnableRequest>,
) -> ApiResult {
    let account = auth::require_session(&state.db, &headers).await?;
    if account.mfa_enabled {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MFA is already enabled for this account",
        ));
    }
    let row = sqlx::query("SELECT mfa_secret FROM admin_accounts WHERE id = $1")
        .bind(account.id)
        .fetch_one(&state.db)
        .await?;
    let encrypted: Option<String> = row.get("mfa_secret");
    let encrypted = encrypted.ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Start the authenticator setup before confirming a code",
        )
    })?;
    let key = mfa_key(&state)?.to_vec();
    let secret = decrypt(&key, &encrypted)?;
    let code = request.code.trim().to_string();
    let valid = task::spawn_blocking(move || verify_totp(&secret, &code))
        .await
        .unwrap_or(false);
    if !valid {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "That code was not accepted. Check the clock on your authenticator and try again.",
        ));
    }
    let codes = new_recovery_codes();
    sqlx::query(
        "UPDATE admin_accounts SET mfa_enabled = true, mfa_recovery_hashes = $1 WHERE id = $2",
    )
    .bind(recovery_hashes(&codes))
    .bind(account.id)
    .execute(&state.db)
    .await?;
    record_audit(
        &state.db,
        &account.username,
        "auth.mfa.enable",
        json!({ "role": account.role_label() }),
    )
    .await?;
    Ok(Json(json!({
        "status": "enabled",
        "recovery_codes": codes,
        "account": account_json(&account, state.mfa_required, true),
    })))
}

#[derive(Deserialize)]
pub(crate) struct DisableRequest {
    current_password: String,
    code: Option<String>,
}

pub(crate) async fn disable(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DisableRequest>,
) -> ApiResult {
    let account = auth::require_session(&state.db, &headers).await?;
    auth::ensure_password(&state.db, account.id, &request.current_password).await?;
    if !account.mfa_enabled {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MFA is not enabled for this account",
        ));
    }
    if let Some(code) = request
        .code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
    {
        let row =
            sqlx::query("SELECT mfa_secret, mfa_recovery_hashes FROM admin_accounts WHERE id = $1")
                .bind(account.id)
                .fetch_one(&state.db)
                .await?;
        let encrypted: Option<String> = row.get("mfa_secret");
        let recovery: Value = row.get("mfa_recovery_hashes");
        if verify_login_code(&state, encrypted.as_deref(), &recovery, code)
            .await?
            .is_none()
        {
            return Err(ApiError::new(
                StatusCode::UNAUTHORIZED,
                "That authenticator code was not accepted.",
            ));
        }
    }
    sqlx::query(
        "UPDATE admin_accounts SET mfa_enabled = false, mfa_secret = NULL, mfa_recovery_hashes = '[]'::jsonb WHERE id = $1",
    )
    .bind(account.id)
    .execute(&state.db)
    .await?;
    if let Some(token) = auth::session_token(&headers) {
        sqlx::query("DELETE FROM auth_sessions WHERE account_id = $1 AND token_hash <> $2")
            .bind(account.id)
            .bind(auth::token_hash(&token))
            .execute(&state.db)
            .await?;
    }
    record_audit(
        &state.db,
        &account.username,
        "auth.mfa.disable",
        json!({ "role": account.role_label() }),
    )
    .await?;
    Ok(Json(json!({
        "status": "disabled",
        "account": account_json(&account, state.mfa_required, false),
    })))
}

pub(crate) fn account_json(account: &Account, mfa_required: bool, mfa_enabled: bool) -> Value {
    json!({
        "username": account.username,
        "role": account.role_label(),
        "must_change_password": account.must_change_password,
        "mfa_enabled": mfa_enabled,
        "mfa_required": mfa_required,
        "must_enroll_mfa": mfa_required && !mfa_enabled,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        decode_key, new_recovery_codes, otpauth_url, recovery_hash, totp_code, verify_totp,
    };

    #[test]
    fn totp_matches_rfc_6238_sha1_vector() {
        // RFC 6238 SHA-1 test secret "12345678901234567890" in base32.
        let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        assert_eq!(totp_code(secret, 1).as_deref(), Some("287082"));
        assert_eq!(totp_code(secret, 0).as_deref().map(str::len), Some(6));
    }

    #[test]
    fn recovery_codes_are_formatted_and_hashed() {
        let codes = new_recovery_codes();
        assert_eq!(codes.len(), 8);
        for code in &codes {
            assert_eq!(code.len(), 11);
            assert_eq!(code.chars().nth(5), Some('-'));
            assert_eq!(
                recovery_hash(code),
                recovery_hash(&code.replace('-', "").to_lowercase())
            );
        }
    }

    #[test]
    fn otpauth_url_escapes_the_label() {
        let url = otpauth_url("admin.01", "ABC");
        assert!(url.starts_with("otpauth://totp/Atlasio%3Aadmin.01?"));
        assert!(url.contains("issuer=Atlasio"));
    }

    #[test]
    fn mfa_keys_must_be_32_bytes() {
        assert!(decode_key("YXRsYXNpby1sb2NhbC1tZmEta2V5LTMyLWJ5dGVzISE=").is_ok());
        assert!(decode_key("short").is_err());
    }

    #[test]
    fn totp_rejects_malformed_codes() {
        assert!(!verify_totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "12345"));
        assert!(!verify_totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "abcdef"));
    }
}
