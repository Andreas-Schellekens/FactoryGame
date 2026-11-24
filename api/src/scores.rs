//! The leaderboard. A player sends in their factory's layout, the server runs the game's
//! own test on it (sim.rs) and stores the result when it beats their best on a board.
//! Two boards: throughput (credits per minute) and efficiency (per occupied cell).

use crate::auth::{AuthUser, MaybeUser};
use crate::error::{ApiError, ApiResult};
use crate::{sim, AppState};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::time::Duration;

const WORLDS: [&str; 2] = ["valley", "aftermath"];
const MAX_QUEUE: usize = 8;

#[derive(Deserialize)]
pub struct Submit {
    layout: Value,
}

fn board_column(board: &str) -> ApiResult<&'static str> {
    match board {
        "throughput" => Ok("per_minute"),
        "efficiency" => Ok("efficiency"),
        _ => Err(ApiError::bad("Unknown board")),
    }
}

/// How many players have a better best than `value` on a board (so the rank is this + 1).
async fn players_ahead(state: &AppState, column: &str, world: &str, value: f64, me: i64) -> ApiResult<i64> {
    let sql = format!(
        "select count(*) from (select user_id, max({column}) as best from scores where world = $1 and bench_version = $2 group by user_id) b \
         where b.best > $3 and b.user_id <> $4"
    );
    let (n,): (i64,) = sqlx::query_as(&sql).bind(world).bind(state.bench_version as i32).bind(value).bind(me).fetch_one(&state.db).await?;
    Ok(n)
}

pub async fn submit(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<Submit>) -> ApiResult<Json<Value>> {
    if !state.allow(&format!("score:{}", user.id), 1, 20) {
        return Err(ApiError::too_many("One factory test per 20 seconds"));
    }
    let world = body.layout.get("world").and_then(Value::as_str).unwrap_or("valley").to_string();
    if !WORLDS.contains(&world.as_str()) {
        return Err(ApiError::bad("Unknown world"));
    }
    let layout = body.layout.to_string();

    // One test at a time (each takes a second or three of CPU); a short queue, then "busy".
    if state.bench_waiting.fetch_add(1, Ordering::SeqCst) >= MAX_QUEUE {
        state.bench_waiting.fetch_sub(1, Ordering::SeqCst);
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "The auditors are busy. Try again in a minute."));
    }
    let permit = state.bench.clone().acquire_owned().await;
    state.bench_waiting.fetch_sub(1, Ordering::SeqCst);
    let _permit = permit.map_err(|_| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "Shutting down"))?;
    let out = tokio::task::spawn_blocking(move || sim::run_benchmark(&layout, Duration::from_secs(30)))
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "The test crashed"))?
        .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, format!("The test failed: {e}")))?;
    let result: Value = serde_json::from_str(&out).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Bad test result"))?;
    if result["ok"] != Value::Bool(true) {
        let msg = result["error"].as_str().unwrap_or("The factory could not be tested").to_string();
        return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, msg));
    }
    let per_minute = result["perMinute"].as_f64().unwrap_or(0.0);
    let efficiency = result["efficiency"].as_f64().unwrap_or(0.0);
    let machines = result["machines"].as_i64().unwrap_or(0) as i32;

    let best: (Option<f64>, Option<f64>) = sqlx::query_as(
        "select max(per_minute), max(efficiency) from scores where user_id = $1 and world = $2 and bench_version = $3",
    )
    .bind(user.id)
    .bind(&world)
    .bind(state.bench_version as i32)
    .fetch_one(&state.db)
    .await?;
    let better_throughput = best.0.is_none_or(|b| per_minute > b);
    let better_efficiency = best.1.is_none_or(|b| efficiency > b);
    let stored = per_minute > 0.0 && (better_throughput || better_efficiency);
    let mut id: Option<i64> = None; // the stored entry, to view or share (/api/factories/{id})
    if stored {
        let (new_id,): (i64,) = sqlx::query_as(
            "insert into scores (user_id, world, bench_version, per_minute, efficiency, machines, sold, layout) \
             values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
        )
        .bind(user.id)
        .bind(&world)
        .bind(state.bench_version as i32)
        .bind(per_minute)
        .bind(efficiency)
        .bind(machines)
        .bind(&result["sold"])
        .bind(&body.layout)
        .fetch_one(&state.db)
        .await?;
        id = Some(new_id);
    }
    let rank_throughput = players_ahead(&state, "per_minute", &world, per_minute.max(best.0.unwrap_or(0.0)), user.id).await? + 1;
    let rank_efficiency = players_ahead(&state, "efficiency", &world, efficiency.max(best.1.unwrap_or(0.0)), user.id).await? + 1;
    Ok(Json(json!({
        "result": result,
        "stored": stored,
        "id": id,
        "newBest": { "throughput": stored && better_throughput, "efficiency": stored && better_efficiency },
        "best": { "throughput": per_minute.max(best.0.unwrap_or(0.0)), "efficiency": efficiency.max(best.1.unwrap_or(0.0)) },
        "rank": { "throughput": rank_throughput, "efficiency": rank_efficiency },
    })))
}

#[derive(Deserialize)]
pub struct BoardQuery {
    board: Option<String>,
    world: Option<String>,
}

/// The top 50 players' bests on a board, and the signed-in player's own row.
pub async fn leaderboard(State(state): State<AppState>, MaybeUser(me): MaybeUser, Query(q): Query<BoardQuery>) -> ApiResult<Json<Value>> {
    let board = q.board.unwrap_or_else(|| "throughput".into());
    let column = board_column(&board)?;
    let world = q.world.unwrap_or_else(|| "valley".into());
    if !WORLDS.contains(&world.as_str()) {
        return Err(ApiError::bad("Unknown world"));
    }
    let sql = format!(
        "with best as (select distinct on (user_id) id, user_id, per_minute, efficiency, machines, created_at from scores \
           where world = $1 and bench_version = $2 order by user_id, {column} desc, created_at asc), \
         ranked as (select b.*, u.name, rank() over (order by b.{column} desc) as rank from best b join users u on u.id = b.user_id) \
         select user_id, name, per_minute, efficiency, machines, (extract(epoch from created_at) * 1000)::bigint, rank, id \
         from ranked where rank <= 50 or user_id = $3 order by rank, created_at"
    );
    let rows: Vec<(i64, String, f64, f64, i32, i64, i64, i64)> = sqlx::query_as(&sql)
        .bind(&world)
        .bind(state.bench_version as i32)
        .bind(me.as_ref().map(|u| u.id).unwrap_or(-1))
        .fetch_all(&state.db)
        .await?;
    let me_id = me.as_ref().map(|u| u.id);
    // `id`: the entry's factory, public at /api/factories/{id}.
    let entry = |(uid, name, pm, eff, machines, at, rank, id): &(i64, String, f64, f64, i32, i64, i64, i64)| {
        json!({ "id": id, "rank": rank, "name": name, "perMinute": pm, "efficiency": eff, "machines": machines, "createdAt": at, "me": Some(*uid) == me_id })
    };
    let top: Vec<Value> = rows.iter().filter(|r| r.6 <= 50).map(entry).collect();
    let mine = rows.iter().find(|r| Some(r.0) == me_id).map(entry);
    Ok(Json(json!({ "board": board, "world": world, "version": state.bench_version, "entries": top, "me": mine })))
}
