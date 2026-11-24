//! Profiles and achievements. A profile is an avatar (an id naming one of the game's own
//! pictures: no uploads) and a public switch; achievements are earned on the client and
//! kept here as a union of every device's (they are not verified: they aren't a
//! competition). Other players' profiles are public unless they switch that off, which
//! leaves only their leaderboard row.
//!
//!   GET  /api/profile               your own profile (avatar, public, play time, bests, achievements)
//!   PUT  /api/profile               { avatar?, public? }
//!   GET  /api/achievements          { earned: { id: ms } }
//!   POST /api/achievements          { earned: { id: ms } } → the union
//!   GET  /api/players?names=a,b     the avatars for a leaderboard page
//!   GET  /api/players/{name}        a player's public profile

use crate::auth::{client_ip, AuthUser, MaybeUser};
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const MAX_ACHIEVEMENTS: usize = 300;
const MAX_NAMES: usize = 60;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/profile", get(own).put(update))
        .route("/achievements", get(get_achievements).post(add_achievements))
        .route("/players", get(avatars))
        .route("/players/{name}", get(player))
}

fn limit(state: &AppState, key: String, max: u32, secs: u64) -> ApiResult<()> {
    if state.allow(&key, max, secs) { Ok(()) } else { Err(ApiError::too_many("Too many requests. Wait a minute and try again.")) }
}

/// An avatar id: a short kind, a colon and a name ('b:smelter', 'd:happy', 'm:nihil').
pub fn check_avatar(id: &str) -> bool {
    let Some((kind, name)) = id.split_once(':') else { return false };
    (1..=2).contains(&kind.len())
        && kind.chars().all(|c| c.is_ascii_lowercase())
        && (1..=24).contains(&name.len())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn check_achievement(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

async fn earned_of(state: &AppState, user_id: i64) -> ApiResult<Value> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "select id, (extract(epoch from earned_at) * 1000)::bigint from achievements where user_id = $1 order by earned_at",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    let mut map = Map::new();
    for (id, at) in rows {
        map.insert(id, json!(at));
    }
    Ok(Value::Object(map))
}

/// The player's best on both leaderboards (the valley, the current test version), with the rank.
async fn bests(state: &AppState, user_id: i64) -> ApiResult<Value> {
    let version = state.bench_version as i32;
    let mut out = Map::new();
    for (board, column) in [("throughput", "per_minute"), ("efficiency", "efficiency")] {
        let best: (Option<f64>, Option<i32>) = sqlx::query_as(&format!(
            "select {column}, machines from scores where user_id = $1 and world = 'valley' and bench_version = $2 \
             order by {column} desc, created_at asc limit 1"
        ))
        .bind(user_id)
        .bind(version)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or((None, None));
        let Some(value) = best.0 else {
            out.insert(board.into(), Value::Null);
            continue;
        };
        let (ahead,): (i64,) = sqlx::query_as(&format!(
            "select count(*) from (select user_id, max({column}) as best from scores where world = 'valley' and bench_version = $1 group by user_id) b \
             where b.best > $2 and b.user_id <> $3"
        ))
        .bind(version)
        .bind(value)
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        out.insert(board.into(), json!({ "value": value, "rank": ahead + 1, "machines": best.1 }));
    }
    Ok(Value::Object(out))
}

/// (avatar, public) for a user; no row yet means no avatar and public.
async fn settings_of(state: &AppState, user_id: i64) -> ApiResult<(Option<String>, bool)> {
    let row: Option<(Option<String>, bool)> = sqlx::query_as("select avatar, public from profiles where user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;
    Ok(row.unwrap_or((None, true)))
}

pub async fn own(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let (avatar, public) = settings_of(&state, user.id).await?;
    let (created, play): (i64, i64) = sqlx::query_as(
        "select (extract(epoch from u.created_at) * 1000)::bigint, \
           coalesce((select sum(case when jsonb_typeof(s.meta -> 'playSec') = 'number' then (s.meta ->> 'playSec')::double precision else 0 end) \
                     from saves s where s.user_id = u.id), 0)::bigint \
         from users u where u.id = $1",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({
        "name": user.name,
        "avatar": avatar,
        "public": public,
        "createdAt": created,
        "playSec": play,
        "best": bests(&state, user.id).await?,
        "achievements": earned_of(&state, user.id).await?,
    })))
}

#[derive(Deserialize)]
pub struct Update {
    /// `Some(None)` clears the avatar; a missing field leaves it as it is.
    #[serde(default, deserialize_with = "serde_with_none::deserialize")]
    avatar: Option<Option<String>>,
    public: Option<bool>,
}

/// serde helper: tell a missing field (None) from an explicit null (Some(None)).
mod serde_with_none {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
        Ok(Some(Option::<String>::deserialize(d)?))
    }
}

pub async fn update(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<Update>) -> ApiResult<Json<Value>> {
    limit(&state, format!("profile:{}", user.id), 30, 60)?;
    let (mut avatar, mut public) = settings_of(&state, user.id).await?;
    if let Some(a) = body.avatar {
        if let Some(id) = &a {
            if !check_avatar(id) {
                return Err(ApiError::bad("Unknown avatar"));
            }
        }
        avatar = a;
    }
    if let Some(p) = body.public {
        public = p;
    }
    sqlx::query(
        "insert into profiles (user_id, avatar, public) values ($1, $2, $3) \
         on conflict (user_id) do update set avatar = excluded.avatar, public = excluded.public, updated_at = now()",
    )
    .bind(user.id)
    .bind(&avatar)
    .bind(public)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "avatar": avatar, "public": public })))
}

pub async fn get_achievements(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "earned": earned_of(&state, user.id).await? })))
}

#[derive(Deserialize)]
pub struct AddAchievements {
    earned: HashMap<String, f64>,
}

/// Add achievements (a union: the earliest time wins) and answer with the full set.
pub async fn add_achievements(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<AddAchievements>) -> ApiResult<Json<Value>> {
    limit(&state, format!("achievements:{}", user.id), 30, 60)?;
    if body.earned.len() > MAX_ACHIEVEMENTS || body.earned.keys().any(|id| !check_achievement(id)) {
        return Err(ApiError::bad("Bad achievements"));
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let (ids, times): (Vec<String>, Vec<i64>) = body
        .earned
        .into_iter()
        .map(|(id, ms)| {
            let ms = ms as i64;
            // A clock in the future (or nonsense) counts as now; nothing before the game existed.
            (id, if ms <= 1_700_000_000_000 || ms > now { now } else { ms })
        })
        .unzip();
    if !ids.is_empty() {
        let (count,): (i64,) = sqlx::query_as("select count(*) from achievements where user_id = $1").bind(user.id).fetch_one(&state.db).await?;
        if count as usize + ids.len() > MAX_ACHIEVEMENTS * 2 {
            return Err(ApiError::bad("Too many achievements"));
        }
        sqlx::query(
            "insert into achievements (user_id, id, earned_at) \
             select $1, x.id, to_timestamp(x.ms / 1000.0) from unnest($2::text[], $3::bigint[]) as x(id, ms) \
             on conflict (user_id, id) do update set earned_at = least(achievements.earned_at, excluded.earned_at)",
        )
        .bind(user.id)
        .bind(&ids)
        .bind(&times)
        .execute(&state.db)
        .await?;
    }
    Ok(Json(json!({ "earned": earned_of(&state, user.id).await? })))
}

#[derive(Deserialize)]
pub struct Names {
    names: Option<String>,
}

/// The avatars of up to 60 players by name (the leaderboard draws them on its rows).
pub async fn avatars(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<Names>) -> ApiResult<Json<Value>> {
    limit(&state, format!("players:{}", client_ip(&headers)), 240, 60)?;
    let keys: Vec<String> = q
        .names
        .unwrap_or_default()
        .split(',')
        .map(|n| n.trim().to_lowercase())
        .filter(|n| !n.is_empty() && n.len() <= 20)
        .take(MAX_NAMES)
        .collect();
    let rows: Vec<(String, String)> = if keys.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as(
            "select u.name, p.avatar from users u join profiles p on p.user_id = u.id where u.name_key = any($1) and p.avatar is not null",
        )
        .bind(&keys)
        .fetch_all(&state.db)
        .await?
    };
    let mut map = Map::new();
    for (name, avatar) in rows {
        map.insert(name, json!(avatar));
    }
    Ok(Json(json!({ "avatars": map })))
}

/// A player's public profile: name, avatar, member since, achievements and best scores.
/// A private profile answers with the name and avatar only (what the leaderboard shows).
pub async fn player(State(state): State<AppState>, MaybeUser(me): MaybeUser, headers: HeaderMap, Path(name): Path<String>) -> ApiResult<Json<Value>> {
    limit(&state, format!("players:{}", client_ip(&headers)), 240, 60)?;
    if name.is_empty() || name.len() > 20 {
        return Err(ApiError::not_found());
    }
    let row: Option<(i64, String, i64)> =
        sqlx::query_as("select id, name, (extract(epoch from created_at) * 1000)::bigint from users where name_key = lower($1)")
            .bind(name.trim())
            .fetch_optional(&state.db)
            .await?;
    let Some((id, real_name, created)) = row else { return Err(ApiError::new(axum::http::StatusCode::NOT_FOUND, "No player by that name")) };
    let (avatar, public) = settings_of(&state, id).await?;
    let mine = me.as_ref().map(|u| u.id) == Some(id);
    if !public && !mine {
        return Ok(Json(json!({ "name": real_name, "avatar": avatar, "private": true })));
    }
    Ok(Json(json!({
        "name": real_name,
        "avatar": avatar,
        "public": public,
        "me": mine,
        "createdAt": created,
        "best": bests(&state, id).await?,
        "achievements": earned_of(&state, id).await?,
    })))
}

/// Everything this module (and passkeys.rs) keeps about a user, for "download my data".
pub async fn export(state: &AppState, user_id: i64) -> ApiResult<Value> {
    let (avatar, public) = settings_of(state, user_id).await?;
    let passkeys: Vec<(String, Value, i64, Option<i64>)> = sqlx::query_as(
        "select name, credential, (extract(epoch from created_at) * 1000)::bigint, (extract(epoch from last_used_at) * 1000)::bigint \
         from passkeys where user_id = $1 order by created_at",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(json!({
        "avatar": avatar,
        "public": public,
        "achievements": earned_of(state, user_id).await?,
        "passkeys": passkeys.into_iter().map(|(name, credential, at, used)| json!({ "name": name, "createdAt": at, "lastUsedAt": used, "publicCredential": credential })).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avatar_ids() {
        assert!(check_avatar("b:smelter"));
        assert!(check_avatar("d:happy"));
        assert!(check_avatar("m:nihil"));
        assert!(!check_avatar("smelter"));
        assert!(!check_avatar("b:"));
        assert!(!check_avatar("B:smelter"));
        assert!(!check_avatar("b:<script>"));
        assert!(!check_avatar("abc:x"));
        assert!(!check_avatar(&format!("b:{}", "x".repeat(25))));
    }

    #[test]
    fn achievement_ids() {
        assert!(check_achievement("firstChain"));
        assert!(check_achievement("cpm-250"));
        assert!(!check_achievement(""));
        assert!(!check_achievement("a b"));
        assert!(!check_achievement(&"x".repeat(41)));
    }
}
