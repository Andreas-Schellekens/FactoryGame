//! Accounts: a username and a password (Argon2id), a one-time recovery code instead of an
//! e-mail address, and sessions as random tokens in an HttpOnly cookie (only their sha256
//! is stored). Also "download my data" and "delete my account".

use crate::error::{ApiError, ApiResult};
use crate::AppState;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use axum::extract::{FromRequestParts, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const COOKIE_NAME: &str = "selene_session";
const SESSION_DAYS: i64 = 30;

#[derive(Clone, Debug)]
pub struct User {
    pub id: i64,
    pub name: String,
}

// ---- Hashing ------------------------------------------------------------------------------

fn argon() -> Argon2<'static> {
    // OWASP's minimum for Argon2id: 19 MiB, 2 passes, 1 lane.
    Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::new(19_456, 2, 1, None).unwrap())
}

/// Hash off the async threads (it takes a few tens of ms on purpose).
async fn hash_secret(secret: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        argon().hash_password(secret.as_bytes(), &salt).map(|h| h.to_string())
    })
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Hashing failed"))?
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Hashing failed"))
}

async fn verify_secret(secret: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).map(|h| argon().verify_password(secret.as_bytes(), &h).is_ok()).unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// A dummy hash to verify against when the user doesn't exist, so a wrong name takes as
/// long as a wrong password.
async fn waste_time(secret: String) {
    let _ = hash_secret(secret).await;
}

fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn random_token() -> String {
    let mut buf = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

/// A recovery code like `K7QM-2XPA-9RTD-WH4C` (no 0/O, 1/I/L).
fn recovery_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut buf = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    let chars: Vec<char> = buf.iter().map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect();
    chars.chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

fn normalize_code(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect::<Vec<_>>()
        .chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

// ---- Input rules -----------------------------------------------------------------------------

fn check_name(name: &str) -> ApiResult<()> {
    let ok = (3..=20).contains(&name.chars().count())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok { Ok(()) } else { Err(ApiError::bad("Name: 3 to 20 letters, digits, - or _")) }
}

fn check_password(pw: &str) -> ApiResult<()> {
    if (8..=128).contains(&pw.chars().count()) { Ok(()) } else { Err(ApiError::bad("Password: 8 to 128 characters")) }
}

// ---- Sessions and the cookie ---------------------------------------------------------------

fn session_cookie(state: &AppState, token: &str, max_age: i64) -> HeaderValue {
    let secure = if state.cookie_secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{COOKIE_NAME}={token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")).unwrap()
}

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    headers.get_all(COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|part| {
        let (k, v) = part.trim().split_once('=')?;
        (k == COOKIE_NAME && !v.is_empty()).then(|| v.to_string())
    })
}

pub async fn start_session(state: &AppState, user_id: i64) -> ApiResult<HeaderValue> {
    let token = random_token();
    sqlx::query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))")
        .bind(token_hash(&token))
        .bind(user_id)
        .bind(SESSION_DAYS as i32)
        .execute(&state.db)
        .await?;
    Ok(session_cookie(state, &token, SESSION_DAYS * 86_400))
}

pub fn with_cookie(cookie: HeaderValue, body: Value) -> Response {
    let mut res = Json(body).into_response();
    res.headers_mut().insert(SET_COOKIE, cookie);
    res
}

/// The signed-in user (401 otherwise). A session used in its second half is extended.
pub struct AuthUser(pub User);
/// The signed-in user, if any.
pub struct MaybeUser(pub Option<User>);

async fn session_user(parts: &Parts, state: &AppState) -> ApiResult<Option<User>> {
    let Some(token) = cookie_token(&parts.headers) else { return Ok(None) };
    let hash = token_hash(&token);
    let row: Option<(i64, String, bool)> = sqlx::query_as(
        "select u.id, u.name, s.expires_at < now() + make_interval(days => $2) \
         from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()",
    )
    .bind(&hash)
    .bind((SESSION_DAYS / 2) as i32)
    .fetch_optional(&state.db)
    .await?;
    let Some((id, name, renew)) = row else { return Ok(None) };
    if renew {
        sqlx::query("update sessions set expires_at = now() + make_interval(days => $2) where token_hash = $1")
            .bind(&hash)
            .bind(SESSION_DAYS as i32)
            .execute(&state.db)
            .await?;
    }
    Ok(Some(User { id, name }))
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        session_user(parts, state).await?.map(AuthUser).ok_or_else(ApiError::unauthorized)
    }
}

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        Ok(MaybeUser(session_user(parts, state).await?))
    }
}

/// The client's address as Caddy saw it (the API itself isn't reachable from outside).
pub fn client_ip(headers: &HeaderMap) -> String {
    headers.get("x-client-ip").and_then(|v| v.to_str().ok()).unwrap_or("local").to_string()
}

fn limit(state: &AppState, key: String, max: u32, secs: u64) -> ApiResult<()> {
    if state.allow(&key, max, secs) {
        Ok(())
    } else {
        Err(ApiError::too_many("Too many attempts. Wait a few minutes and try again."))
    }
}

// ---- Handlers -------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct Credentials {
    name: String,
    password: String,
}

pub async fn signup(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Credentials>) -> ApiResult<Response> {
    limit(&state, format!("signup:{}", client_ip(&headers)), 5, 3600)?;
    let name = body.name.trim().to_string();
    check_name(&name)?;
    check_password(&body.password)?;
    let code = recovery_code();
    let pass_hash = hash_secret(body.password).await?;
    let recovery_hash = hash_secret(normalize_code(&code)).await?;
    let id: Option<(i64,)> = sqlx::query_as(
        "insert into users (name, name_key, pass_hash, recovery_hash) values ($1, lower($1), $2, $3) \
         on conflict (name_key) do nothing returning id",
    )
    .bind(&name)
    .bind(pass_hash)
    .bind(recovery_hash)
    .fetch_optional(&state.db)
    .await?;
    let Some((id,)) = id else { return Err(ApiError::new(StatusCode::CONFLICT, "That name is taken")) };
    let cookie = start_session(&state, id).await?;
    Ok(with_cookie(cookie, json!({ "user": { "id": id, "name": name }, "recoveryCode": code })))
}

pub async fn login(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Credentials>) -> ApiResult<Response> {
    let name = body.name.trim().to_lowercase();
    limit(&state, format!("login-ip:{}", client_ip(&headers)), 20, 900)?;
    limit(&state, format!("login-name:{name}"), 10, 900)?;
    let row: Option<(i64, String, String)> = sqlx::query_as("select id, name, pass_hash from users where name_key = $1")
        .bind(&name)
        .fetch_optional(&state.db)
        .await?;
    let Some((id, real_name, hash)) = row else {
        waste_time(body.password).await;
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Wrong name or password"));
    };
    if !verify_secret(body.password, hash).await {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Wrong name or password"));
    }
    let cookie = start_session(&state, id).await?;
    Ok(with_cookie(cookie, json!({ "user": { "id": id, "name": real_name } })))
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    if let Some(token) = cookie_token(&headers) {
        sqlx::query("delete from sessions where token_hash = $1").bind(token_hash(&token)).execute(&state.db).await?;
    }
    Ok(with_cookie(session_cookie(&state, "", 0), json!({ "ok": true })))
}

/// Who is signed in: `{ user }`, or `{ user: null }` (not a 401: the game asks on every start).
pub async fn me(MaybeUser(user): MaybeUser) -> Json<Value> {
    Json(json!({ "user": user.map(|u| json!({ "id": u.id, "name": u.name })) }))
}

#[derive(Deserialize)]
pub struct Recover {
    name: String,
    #[serde(rename = "recoveryCode")]
    recovery_code: String,
    #[serde(rename = "newPassword")]
    new_password: String,
}

/// Forgot the password: the recovery code sets a new one (and is replaced by a new code).
pub async fn recover(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Recover>) -> ApiResult<Response> {
    let name = body.name.trim().to_lowercase();
    limit(&state, format!("recover-ip:{}", client_ip(&headers)), 10, 3600)?;
    limit(&state, format!("recover-name:{name}"), 5, 3600)?;
    check_password(&body.new_password)?;
    let row: Option<(i64, String, String)> = sqlx::query_as("select id, name, recovery_hash from users where name_key = $1")
        .bind(&name)
        .fetch_optional(&state.db)
        .await?;
    let bad = || ApiError::new(StatusCode::UNAUTHORIZED, "Wrong name or recovery code");
    let Some((id, real_name, hash)) = row else {
        waste_time(body.recovery_code).await;
        return Err(bad());
    };
    if !verify_secret(normalize_code(&body.recovery_code), hash).await {
        return Err(bad());
    }
    let code = recovery_code();
    let pass_hash = hash_secret(body.new_password).await?;
    let recovery_hash = hash_secret(normalize_code(&code)).await?;
    sqlx::query("update users set pass_hash = $2, recovery_hash = $3 where id = $1")
        .bind(id)
        .bind(pass_hash)
        .bind(recovery_hash)
        .execute(&state.db)
        .await?;
    sqlx::query("delete from sessions where user_id = $1").bind(id).execute(&state.db).await?;
    let cookie = start_session(&state, id).await?;
    Ok(with_cookie(cookie, json!({ "user": { "id": id, "name": real_name }, "recoveryCode": code })))
}

#[derive(Deserialize)]
pub struct ChangePassword {
    password: String,
    #[serde(rename = "newPassword")]
    new_password: String,
}

pub async fn change_password(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<ChangePassword>) -> ApiResult<Json<Value>> {
    limit(&state, format!("password:{}", user.id), 10, 900)?;
    check_password(&body.new_password)?;
    let (hash,): (String,) = sqlx::query_as("select pass_hash from users where id = $1").bind(user.id).fetch_one(&state.db).await?;
    if !verify_secret(body.password, hash).await {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Wrong password"));
    }
    let pass_hash = hash_secret(body.new_password).await?;
    sqlx::query("update users set pass_hash = $2 where id = $1").bind(user.id).bind(pass_hash).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

/// Everything stored about the signed-in user, as one JSON download.
pub async fn export(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Response> {
    let (created,): (i64,) = sqlx::query_as("select (extract(epoch from created_at) * 1000)::bigint from users where id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await?;
    let saves: Vec<(String, String, Value, Value, i32, i64)> = sqlx::query_as(
        "select slot, name, meta, data, rev, (extract(epoch from updated_at) * 1000)::bigint from saves where user_id = $1 order by updated_at",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let settings: Option<(Value,)> = sqlx::query_as("select data from settings where user_id = $1").bind(user.id).fetch_optional(&state.db).await?;
    let scores: Vec<(String, i32, f64, f64, i32, Value, Value, i64)> = sqlx::query_as(
        "select world, bench_version, per_minute, efficiency, machines, sold, layout, (extract(epoch from created_at) * 1000)::bigint \
         from scores where user_id = $1 order by created_at",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let blueprints = crate::blueprints::export(&state.db, user.id).await?;
    let profile = crate::profile::export(&state, user.id).await?;
    let body = json!({
        "exportedFrom": "Protocol: Selene",
        "user": { "name": user.name, "createdAt": created },
        "saves": saves.into_iter().map(|(slot, name, meta, data, rev, at)| json!({ "slot": slot, "name": name, "meta": meta, "data": data, "rev": rev, "updatedAt": at })).collect::<Vec<_>>(),
        "settings": settings.map(|(d,)| d),
        "blueprints": blueprints,
        "profile": profile,
        "scores": scores.into_iter().map(|(world, v, pm, eff, machines, sold, layout, at)| json!({ "world": world, "benchVersion": v, "perMinute": pm, "efficiency": eff, "machines": machines, "sold": sold, "layout": layout, "createdAt": at })).collect::<Vec<_>>(),
        "challengeScores": crate::challenge::export_rows(&state.db, user.id).await?,
    });
    let mut res = Json(body).into_response();
    res.headers_mut().insert("content-disposition", HeaderValue::from_static("attachment; filename=\"selene-account.json\""));
    Ok(res)
}

#[derive(Deserialize)]
pub struct DeleteAccount {
    password: String,
}

/// Delete the account and everything with it (saves, settings, scores, blueprints, sessions,
/// profile, achievements and passkeys: every table cascades from users).
pub async fn delete_account(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<DeleteAccount>) -> ApiResult<Response> {
    limit(&state, format!("delete:{}", user.id), 10, 900)?;
    let (hash,): (String,) = sqlx::query_as("select pass_hash from users where id = $1").bind(user.id).fetch_one(&state.db).await?;
    if !verify_secret(body.password, hash).await {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Wrong password"));
    }
    sqlx::query("delete from users where id = $1").bind(user.id).execute(&state.db).await?;
    Ok(with_cookie(session_cookie(&state, "", 0), json!({ "ok": true })))
}
