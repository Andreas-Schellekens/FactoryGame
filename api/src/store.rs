//! Cloud saves (named slots, each with a revision so two devices can't silently overwrite
//! each other) and the player's settings (last write wins, by the client's clock).

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

pub const MAX_SLOTS: i64 = 20;
const MAX_META_BYTES: usize = 96 * 1024;

fn check_slot(slot: &str) -> ApiResult<()> {
    let ok = (1..=64).contains(&slot.len()) && slot.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(()) } else { Err(ApiError::bad("Bad slot id")) }
}

pub async fn list(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, Value, i32, i64)> = sqlx::query_as(
        "select slot, name, meta, rev, (extract(epoch from updated_at) * 1000)::bigint from saves where user_id = $1 order by updated_at desc",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let slots: Vec<Value> = rows
        .into_iter()
        .map(|(slot, name, meta, rev, at)| json!({ "slot": slot, "name": name, "meta": meta, "rev": rev, "updatedAt": at }))
        .collect();
    Ok(Json(json!({ "slots": slots, "max": MAX_SLOTS })))
}

pub async fn get(State(state): State<AppState>, AuthUser(user): AuthUser, Path(slot): Path<String>) -> ApiResult<Json<Value>> {
    check_slot(&slot)?;
    let row: Option<(String, Value, Value, i32, i64)> = sqlx::query_as(
        "select name, meta, data, rev, (extract(epoch from updated_at) * 1000)::bigint from saves where user_id = $1 and slot = $2",
    )
    .bind(user.id)
    .bind(&slot)
    .fetch_optional(&state.db)
    .await?;
    let (name, meta, data, rev, at) = row.ok_or_else(ApiError::not_found)?;
    Ok(Json(json!({ "slot": slot, "name": name, "meta": meta, "data": data, "rev": rev, "updatedAt": at })))
}

#[derive(Deserialize)]
pub struct PutSave {
    name: String,
    meta: Value,
    data: Value,
    /// The revision this write is based on (null: a new slot). A mismatch is a conflict.
    #[serde(rename = "baseRev")]
    base_rev: Option<i32>,
    /// Overwrite whatever is there (after the player chose to).
    #[serde(default)]
    force: bool,
}

pub async fn put(State(state): State<AppState>, AuthUser(user): AuthUser, Path(slot): Path<String>, Json(body): Json<PutSave>) -> ApiResult<Json<Value>> {
    check_slot(&slot)?;
    let name: String = body.name.trim().chars().take(60).collect();
    if name.is_empty() {
        return Err(ApiError::bad("A save needs a name"));
    }
    if !body.data.is_object() || !body.data.get("version").is_some_and(Value::is_number) {
        return Err(ApiError::bad("That is not a save"));
    }
    if !body.meta.is_object() || body.meta.to_string().len() > MAX_META_BYTES {
        return Err(ApiError::bad("Save details too large"));
    }

    let current: Option<(i32, i64)> = sqlx::query_as(
        "select rev, (extract(epoch from updated_at) * 1000)::bigint from saves where user_id = $1 and slot = $2",
    )
    .bind(user.id)
    .bind(&slot)
    .fetch_optional(&state.db)
    .await?;

    let rev = match current {
        None => {
            let (count,): (i64,) = sqlx::query_as("select count(*) from saves where user_id = $1").bind(user.id).fetch_one(&state.db).await?;
            if count >= MAX_SLOTS {
                return Err(ApiError::new(StatusCode::CONFLICT, format!("Your account holds at most {MAX_SLOTS} saves")).with(json!({ "full": true })));
            }
            let (rev,): (i32,) = sqlx::query_as(
                "insert into saves (user_id, slot, name, meta, data) values ($1, $2, $3, $4, $5) \
                 on conflict (user_id, slot) do update set name = excluded.name, meta = excluded.meta, data = excluded.data, \
                 rev = saves.rev + 1, updated_at = now() returning rev",
            )
            .bind(user.id)
            .bind(&slot)
            .bind(&name)
            .bind(&body.meta)
            .bind(&body.data)
            .fetch_one(&state.db)
            .await?;
            rev
        }
        Some((rev, at)) => {
            if !body.force && body.base_rev != Some(rev) {
                return Err(ApiError::new(StatusCode::CONFLICT, "This save changed on another device").with(json!({ "rev": rev, "updatedAt": at })));
            }
            let row: Option<(i32,)> = sqlx::query_as(
                "update saves set name = $3, meta = $4, data = $5, rev = rev + 1, updated_at = now() \
                 where user_id = $1 and slot = $2 and ($6 or rev = $7) returning rev",
            )
            .bind(user.id)
            .bind(&slot)
            .bind(&name)
            .bind(&body.meta)
            .bind(&body.data)
            .bind(body.force)
            .bind(rev)
            .fetch_optional(&state.db)
            .await?;
            row.ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "This save changed on another device"))?.0
        }
    };
    Ok(Json(json!({ "slot": slot, "rev": rev })))
}

pub async fn delete(State(state): State<AppState>, AuthUser(user): AuthUser, Path(slot): Path<String>) -> ApiResult<Json<Value>> {
    check_slot(&slot)?;
    sqlx::query("delete from saves where user_id = $1 and slot = $2").bind(user.id).bind(&slot).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn get_settings(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let row: Option<(Value, i64)> = sqlx::query_as("select data, client_ms from settings where user_id = $1")
        .bind(user.id)
        .fetch_optional(&state.db)
        .await?;
    Ok(Json(match row {
        Some((data, at)) => json!({ "data": data, "updatedAt": at }),
        None => json!({ "data": null, "updatedAt": 0 }),
    }))
}

#[derive(Deserialize)]
pub struct PutSettings {
    data: Value,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
}

pub async fn put_settings(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<PutSettings>) -> ApiResult<Json<Value>> {
    if !body.data.is_object() || body.data.to_string().len() > 32 * 1024 {
        return Err(ApiError::bad("Bad settings"));
    }
    // Last write wins: an older copy (from a device that was offline) doesn't overwrite a newer one.
    sqlx::query(
        "insert into settings (user_id, data, client_ms) values ($1, $2, $3) \
         on conflict (user_id) do update set data = excluded.data, client_ms = excluded.client_ms, updated_at = now() \
         where settings.client_ms <= excluded.client_ms",
    )
    .bind(user.id)
    .bind(&body.data)
    .bind(body.updated_at)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}
