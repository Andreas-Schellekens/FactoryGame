//! Blueprints and shared factories (iteration 7).
//!
//! Blueprints: a player's library of saved machine groups, kept in the browser first and
//! synced here when signed in (last write wins by the client's clock, like settings).
//! Factories: any leaderboard entry's layout, public, so the game can show other players'
//! factories and share a link to one (`/?factory=<id>`).

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

pub const MAX_BLUEPRINTS: i64 = 100;
const MAX_NAME: usize = 40;
/// A blueprint covers at most the whole map (32 × 24); a little room for other versions.
const MAX_MACHINES: usize = 1024;
const MAX_SIDE: i64 = 64;
const MAX_DATA_BYTES: usize = 128 * 1024;
const DIRS: [&str; 4] = ["right", "down", "left", "up"];

fn check_id(id: &str) -> ApiResult<()> {
    let ok = (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(()) } else { Err(ApiError::bad("Bad blueprint id")) }
}

/// The shape the game stores: `{ w, h, machines: [{ x, y, type, dir, recipe?, off? }] }`.
/// The server doesn't know the buildings; it only keeps the size sane.
pub fn check_data(data: &Value) -> Result<(), &'static str> {
    let side = |k: &str| data.get(k).and_then(Value::as_i64).is_some_and(|v| (1..=MAX_SIDE).contains(&v));
    if !data.is_object() || !side("w") || !side("h") {
        return Err("That is not a blueprint");
    }
    let machines = data.get("machines").and_then(Value::as_array).ok_or("That is not a blueprint")?;
    if machines.is_empty() {
        return Err("A blueprint needs at least one machine");
    }
    if machines.len() > MAX_MACHINES {
        return Err("That blueprint is too large");
    }
    for m in machines {
        let coord = |k: &str| m.get(k).and_then(Value::as_i64).is_some_and(|v| (0..MAX_SIDE).contains(&v));
        let short = |k: &str| m.get(k).and_then(Value::as_str).is_some_and(|s| (1..=24).contains(&s.len()));
        let dir = m.get("dir").and_then(Value::as_str).is_some_and(|d| DIRS.contains(&d));
        let recipe = m.get("recipe").is_none_or(|r| r.is_null() || r.as_str().is_some_and(|s| (1..=24).contains(&s.len())));
        if !coord("x") || !coord("y") || !short("type") || !dir || !recipe {
            return Err("That blueprint has a bad machine in it");
        }
    }
    if data.to_string().len() > MAX_DATA_BYTES {
        return Err("That blueprint is too large");
    }
    Ok(())
}

pub fn clean_name(name: &str) -> Option<String> {
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(MAX_NAME).collect();
    if name.is_empty() { None } else { Some(name) }
}

pub async fn list(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, Value, i64, i64)> = sqlx::query_as(
        "select id, name, data, client_ms, (extract(epoch from created_at) * 1000)::bigint from blueprints \
         where user_id = $1 order by created_at",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let list: Vec<Value> = rows
        .into_iter()
        .map(|(id, name, data, at, created)| json!({ "id": id, "name": name, "data": data, "updatedAt": at, "createdAt": created }))
        .collect();
    Ok(Json(json!({ "blueprints": list, "max": MAX_BLUEPRINTS })))
}

#[derive(Deserialize)]
pub struct PutBlueprint {
    name: String,
    data: Value,
    #[serde(rename = "updatedAt")]
    updated_at: i64,
}

pub async fn put(State(state): State<AppState>, AuthUser(user): AuthUser, Path(id): Path<String>, Json(body): Json<PutBlueprint>) -> ApiResult<Json<Value>> {
    check_id(&id)?;
    let name = clean_name(&body.name).ok_or_else(|| ApiError::bad("A blueprint needs a name"))?;
    check_data(&body.data).map_err(ApiError::bad)?;
    if !state.allow(&format!("blueprint:{}", user.id), 120, 60) {
        return Err(ApiError::too_many("Too many blueprint changes; try again in a minute"));
    }
    let exists: Option<(i64,)> = sqlx::query_as("select client_ms from blueprints where user_id = $1 and id = $2")
        .bind(user.id)
        .bind(&id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        let (count,): (i64,) = sqlx::query_as("select count(*) from blueprints where user_id = $1").bind(user.id).fetch_one(&state.db).await?;
        if count >= MAX_BLUEPRINTS {
            return Err(ApiError::new(StatusCode::CONFLICT, format!("Your account holds at most {MAX_BLUEPRINTS} blueprints")).with(json!({ "full": true })));
        }
    }
    // Last write wins: an older copy (from a device that was offline) doesn't overwrite a newer one.
    let stored = sqlx::query(
        "insert into blueprints (user_id, id, name, data, client_ms) values ($1, $2, $3, $4, $5) \
         on conflict (user_id, id) do update set name = excluded.name, data = excluded.data, client_ms = excluded.client_ms, updated_at = now() \
         where blueprints.client_ms <= excluded.client_ms",
    )
    .bind(user.id)
    .bind(&id)
    .bind(&name)
    .bind(&body.data)
    .bind(body.updated_at)
    .execute(&state.db)
    .await?
    .rows_affected()
        > 0;
    Ok(Json(json!({ "id": id, "stored": stored })))
}

pub async fn delete(State(state): State<AppState>, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    check_id(&id)?;
    sqlx::query("delete from blueprints where user_id = $1 and id = $2").bind(user.id).bind(&id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

/// A player's blueprints for "download my data".
pub async fn export(db: &PgPool, user_id: i64) -> ApiResult<Value> {
    let rows: Vec<(String, String, Value, i64)> =
        sqlx::query_as("select id, name, data, client_ms from blueprints where user_id = $1 order by created_at")
            .bind(user_id)
            .fetch_all(db)
            .await?;
    Ok(Value::Array(rows.into_iter().map(|(id, name, data, at)| json!({ "id": id, "name": name, "data": data, "updatedAt": at })).collect()))
}

/// One leaderboard entry, public: who made it, what it scored and when, and its layout.
pub async fn factory(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let id: i64 = id.parse().map_err(|_| ApiError::not_found())?;
    let row: Option<(i64, String, String, i32, f64, f64, i32, Value, Value, i64)> = sqlx::query_as(
        "select s.id, u.name, s.world, s.bench_version, s.per_minute, s.efficiency, s.machines, s.sold, s.layout, \
           (extract(epoch from s.created_at) * 1000)::bigint \
         from scores s join users u on u.id = s.user_id where s.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    let (id, name, world, version, per_minute, efficiency, machines, sold, layout, at) = row.ok_or_else(ApiError::not_found)?;
    Ok(Json(json!({
        "id": id, "name": name, "world": world, "version": version, "current": version as i64 == state.bench_version,
        "perMinute": per_minute, "efficiency": efficiency, "machines": machines, "sold": sold, "layout": layout, "createdAt": at,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_checks() {
        let ok = json!({ "w": 2, "h": 1, "machines": [{ "x": 0, "y": 0, "type": "belt", "dir": "right" }, { "x": 1, "y": 0, "type": "smelter", "dir": "up", "recipe": "ironIngot", "off": true }] });
        assert!(check_data(&ok).is_ok());
        assert!(check_data(&json!({ "w": 1, "h": 1, "machines": [] })).is_err());
        assert!(check_data(&json!({ "w": 1, "h": 1, "machines": [{ "x": 0, "y": 0, "type": "belt", "dir": "sideways" }] })).is_err());
        assert!(check_data(&json!({ "w": 1, "h": 1, "machines": [{ "x": -1, "y": 0, "type": "belt", "dir": "up" }] })).is_err());
        assert!(check_data(&json!({ "w": 99, "h": 1, "machines": [{ "x": 0, "y": 0, "type": "belt", "dir": "up" }] })).is_err());
        let many: Vec<Value> = (0..2000).map(|i| json!({ "x": i % 32, "y": 0, "type": "belt", "dir": "up" })).collect();
        assert!(check_data(&json!({ "w": 32, "h": 1, "machines": many })).is_err());
        assert!(check_data(&json!("belt")).is_err());
    }

    #[test]
    fn names() {
        assert_eq!(clean_name("  Smelter line \n").as_deref(), Some("Smelter line"));
        assert_eq!(clean_name("   "), None);
        assert_eq!(clean_name(&"x".repeat(90)).map(|s| s.len()), Some(MAX_NAME));
    }
}
