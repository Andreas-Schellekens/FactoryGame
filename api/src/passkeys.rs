//! Passkeys (WebAuthn, with webauthn-rs): signed in, a player can add passkeys to their
//! account, list and remove them; signed out, "Sign in with a passkey" asks the browser
//! for any passkey it has for this site (discoverable credentials: no username needed).
//! Only public credentials are stored (the public key, the signature counter and flags).
//! Passwords and the recovery code stay as they were.
//!
//!   POST   /api/passkeys/register/start    (signed in) → creation options
//!   POST   /api/passkeys/register/finish   (signed in) { credential, name? }
//!   GET    /api/passkeys                   (signed in) the list
//!   DELETE /api/passkeys/{id}              (signed in)
//!   POST   /api/passkeys/login/start       → { ticket, options }
//!   POST   /api/passkeys/login/finish      { ticket, credential } → a session, like a password sign-in
//!
//! The relying party comes from the environment: WEBAUTHN_RP_ID (default `localhost`) and
//! WEBAUTHN_ORIGIN (default `http://localhost:5173`; on localhost any port is allowed), plus
//! optional WEBAUTHN_EXTRA_ORIGINS (comma-separated) for more origins under the same RP id.
//! Ceremonies in progress are kept in memory for five minutes (one API instance).

use crate::auth::{client_ip, start_session, with_cookie, AuthUser};
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use webauthn_rs::prelude::*;

const MAX_PASSKEYS: i64 = 10;
const CEREMONY_TTL: Duration = Duration::from_secs(300);
const MAX_PENDING: usize = 10_000;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/passkeys", get(list))
        .route("/passkeys/{id}", delete(remove))
        .route("/passkeys/register/start", post(register_start))
        .route("/passkeys/register/finish", post(register_finish))
        .route("/passkeys/login/start", post(login_start))
        .route("/passkeys/login/finish", post(login_finish))
}

/// The relying party, from the environment (read on first use, after main loaded .env).
static RP: LazyLock<Result<Webauthn, String>> = LazyLock::new(|| {
    let rp_id = std::env::var("WEBAUTHN_RP_ID").unwrap_or_else(|_| "localhost".into());
    let origin = std::env::var("WEBAUTHN_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".into());
    let origin = Url::parse(&origin).map_err(|e| format!("WEBAUTHN_ORIGIN: {e}"))?;
    let mut builder = WebauthnBuilder::new(&rp_id, &origin).map_err(|e| format!("webauthn: {e}"))?.rp_name("Protocol: Selene");
    if rp_id == "localhost" {
        builder = builder.allow_any_port(true);
    }
    for extra in std::env::var("WEBAUTHN_EXTRA_ORIGINS").unwrap_or_default().split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let url = Url::parse(extra).map_err(|e| format!("WEBAUTHN_EXTRA_ORIGINS: {e}"))?;
        builder = builder.append_allowed_origin(&url);
    }
    builder.build().map_err(|e| format!("webauthn: {e}"))
});

fn rp() -> ApiResult<&'static Webauthn> {
    RP.as_ref().map_err(|e| {
        eprintln!("passkeys are not set up: {e}");
        ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "Passkeys are not set up on this server")
    })
}

/// Log the RP at start so a wrong production setting shows in the logs.
pub fn describe() -> String {
    match RP.as_ref() {
        Ok(w) => format!("passkeys for {}", w.get_allowed_origins().iter().map(Url::as_str).collect::<Vec<_>>().join(", ")),
        Err(e) => format!("passkeys off ({e})"),
    }
}

#[derive(Default)]
struct Pending {
    /// One registration at a time per user: (started, state, the user handle it used).
    register: HashMap<i64, (Instant, PasskeyRegistration, Uuid)>,
    /// Sign-ins by ticket (the client sends it back with the answer).
    login: HashMap<String, (Instant, DiscoverableAuthentication)>,
}

static PENDING: LazyLock<Mutex<Pending>> = LazyLock::new(Default::default);

fn sweep(p: &mut Pending) {
    let now = Instant::now();
    p.register.retain(|_, (at, _, _)| now.duration_since(*at) < CEREMONY_TTL);
    p.login.retain(|_, (at, _)| now.duration_since(*at) < CEREMONY_TTL);
}

fn limit(state: &AppState, key: String, max: u32, secs: u64) -> ApiResult<()> {
    if state.allow(&key, max, secs) { Ok(()) } else { Err(ApiError::too_many("Too many attempts. Wait a few minutes and try again.")) }
}

fn not_verified(e: WebauthnError) -> ApiError {
    eprintln!("passkey not verified: {e}");
    ApiError::bad("The passkey could not be verified")
}

fn ticket() -> String {
    let mut buf = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

/// The user's passkeys as webauthn-rs credentials (skips a row that no longer parses).
async fn passkeys_of(state: &AppState, user_id: i64) -> ApiResult<Vec<Passkey>> {
    let rows: Vec<(Value,)> = sqlx::query_as("select credential from passkeys where user_id = $1").bind(user_id).fetch_all(&state.db).await?;
    Ok(rows.into_iter().filter_map(|(v,)| serde_json::from_value(v).ok()).collect())
}

pub async fn register_start(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    limit(&state, format!("passkey-reg:{}", user.id), 20, 900)?;
    let webauthn = rp()?;
    let (count,): (i64,) = sqlx::query_as("select count(*) from passkeys where user_id = $1").bind(user.id).fetch_one(&state.db).await?;
    if count >= MAX_PASSKEYS {
        return Err(ApiError::bad("That's the most passkeys one account can have. Remove one first."));
    }
    // One random user handle per user, shared by all their passkeys.
    let handle: Option<(String,)> = sqlx::query_as("select handle::text from passkeys where user_id = $1 limit 1").bind(user.id).fetch_optional(&state.db).await?;
    let handle = handle.and_then(|(h,)| Uuid::parse_str(&h).ok()).unwrap_or_else(Uuid::new_v4);
    let exclude: Vec<CredentialID> = passkeys_of(&state, user.id).await?.iter().map(|p| p.cred_id().clone()).collect();
    let (ccr, reg) = webauthn
        .start_passkey_registration(handle, &user.name, &user.name, Some(exclude))
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not start: {e}")))?;
    // Ask for a discoverable credential, so signing in needs no username. (webauthn-rs
    // discourages resident keys to spare old security keys; passkey managers make them anyway.)
    let mut options = serde_json::to_value(&ccr).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not start"))?;
    if let Some(sel) = options.pointer_mut("/publicKey/authenticatorSelection").and_then(Value::as_object_mut) {
        sel.insert("residentKey".into(), json!("required"));
        sel.insert("requireResidentKey".into(), json!(true));
    }
    let mut p = PENDING.lock().unwrap();
    sweep(&mut p);
    p.register.insert(user.id, (Instant::now(), reg, handle));
    Ok(Json(options))
}

#[derive(Deserialize)]
pub struct RegisterFinish {
    credential: RegisterPublicKeyCredential,
    name: Option<String>,
}

pub async fn register_finish(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<RegisterFinish>) -> ApiResult<Json<Value>> {
    let webauthn = rp()?;
    let pending = PENDING.lock().unwrap().register.remove(&user.id);
    let Some((at, reg, handle)) = pending.filter(|(at, _, _)| at.elapsed() < CEREMONY_TTL) else {
        return Err(ApiError::bad("That took too long. Try adding the passkey again."));
    };
    let _ = at;
    let passkey = webauthn.finish_passkey_registration(&body.credential, &reg).map_err(not_verified)?;
    let name: String = body.name.unwrap_or_default().trim().chars().filter(|c| !c.is_control()).take(40).collect();
    let name = if name.is_empty() { "Passkey".to_string() } else { name };
    let credential = serde_json::to_value(&passkey).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Could not store the passkey"))?;
    let row: Option<(i64,)> = sqlx::query_as(
        "insert into passkeys (user_id, cred_id, handle, credential, name) values ($1, $2, $3::uuid, $4, $5) \
         on conflict (cred_id) do nothing returning id",
    )
    .bind(user.id)
    .bind(passkey.cred_id().as_slice())
    .bind(handle.to_string())
    .bind(&credential)
    .bind(&name)
    .fetch_optional(&state.db)
    .await?;
    let Some((id,)) = row else { return Err(ApiError::new(StatusCode::CONFLICT, "That passkey is already registered")) };
    Ok(Json(json!({ "id": id, "name": name })))
}

pub async fn list(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let rows: Vec<(i64, String, i64, Option<i64>)> = sqlx::query_as(
        "select id, name, (extract(epoch from created_at) * 1000)::bigint, (extract(epoch from last_used_at) * 1000)::bigint \
         from passkeys where user_id = $1 order by created_at",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let list: Vec<Value> = rows
        .into_iter()
        .map(|(id, name, at, used)| json!({ "id": id, "name": name, "createdAt": at, "lastUsedAt": used }))
        .collect();
    Ok(Json(json!({ "passkeys": list, "max": MAX_PASSKEYS })))
}

pub async fn remove(State(state): State<AppState>, AuthUser(user): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let done = sqlx::query("delete from passkeys where id = $1 and user_id = $2").bind(id).bind(user.id).execute(&state.db).await?;
    if done.rows_affected() == 0 {
        return Err(ApiError::not_found());
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn login_start(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    limit(&state, format!("passkey-login:{}", client_ip(&headers)), 30, 900)?;
    let webauthn = rp()?;
    let (rcr, auth) = webauthn
        .start_discoverable_authentication()
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not start: {e}")))?;
    let t = ticket();
    let mut p = PENDING.lock().unwrap();
    sweep(&mut p);
    if p.login.len() >= MAX_PENDING {
        return Err(ApiError::too_many("Too many sign-ins at once. Try again in a minute."));
    }
    p.login.insert(t.clone(), (Instant::now(), auth));
    Ok(Json(json!({ "ticket": t, "options": rcr })))
}

#[derive(Deserialize)]
pub struct LoginFinish {
    ticket: String,
    credential: PublicKeyCredential,
}

pub async fn login_finish(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<LoginFinish>) -> ApiResult<Response> {
    limit(&state, format!("passkey-login:{}", client_ip(&headers)), 30, 900)?;
    let webauthn = rp()?;
    let pending = PENDING.lock().unwrap().login.remove(&body.ticket);
    let Some((_, auth)) = pending.filter(|(at, _)| at.elapsed() < CEREMONY_TTL) else {
        return Err(ApiError::bad("That took too long. Try again."));
    };
    let unknown = || ApiError::new(StatusCode::UNAUTHORIZED, "That passkey isn't registered with any account here");
    let (handle, cred_id) = webauthn.identify_discoverable_authentication(&body.credential).map_err(|_| unknown())?;
    let row: Option<(i64, i64, String, Value)> = sqlx::query_as("select id, user_id, handle::text, credential from passkeys where cred_id = $1")
        .bind(cred_id)
        .fetch_optional(&state.db)
        .await?;
    let Some((row_id, user_id, stored_handle, credential)) = row else { return Err(unknown()) };
    if Uuid::parse_str(&stored_handle).ok() != Some(handle) {
        return Err(unknown());
    }
    let mut passkey: Passkey = serde_json::from_value(credential).map_err(|_| unknown())?;
    let result = webauthn.finish_discoverable_authentication_v2(&body.credential, auth, &passkey).map_err(not_verified)?;
    // Keep the signature counter (and backup state) current.
    let changed = passkey.update_credential(&result).unwrap_or(false);
    let credential = if changed { serde_json::to_value(&passkey).ok() } else { None };
    sqlx::query("update passkeys set last_used_at = now(), credential = coalesce($2, credential) where id = $1")
        .bind(row_id)
        .bind(credential)
        .execute(&state.db)
        .await?;
    let (name,): (String,) = sqlx::query_as("select name from users where id = $1").bind(user_id).fetch_one(&state.db).await?;
    let cookie = start_session(&state, user_id).await?;
    Ok(with_cookie(cookie, json!({ "user": { "id": user_id, "name": name } })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localhost_rp_builds() {
        // Defaults (no env): localhost, any port.
        let origin = Url::parse("http://localhost:5173").unwrap();
        let w = WebauthnBuilder::new("localhost", &origin).unwrap().allow_any_port(true).build().unwrap();
        let (ccr, _) = w.start_passkey_registration(Uuid::new_v4(), "tester", "tester", None).unwrap();
        let v = serde_json::to_value(&ccr).unwrap();
        assert!(v.pointer("/publicKey/authenticatorSelection").is_some(), "{v}");
        assert!(v.pointer("/publicKey/challenge").and_then(Value::as_str).is_some());
        let (rcr, _) = w.start_discoverable_authentication().unwrap();
        let v = serde_json::to_value(&rcr).unwrap();
        assert!(v.pointer("/publicKey/challenge").is_some());
    }

    #[test]
    fn tickets_are_random() {
        assert_ne!(ticket(), ticket());
        assert_eq!(ticket().len(), 48);
    }
}
