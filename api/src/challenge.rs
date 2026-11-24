//! The weekly challenge's board. Every ISO week (UTC, from Monday 00:00) has its own
//! challenge, drawn from the week's key by the game's `src/challenge.js`; a player sends in
//! a factory for the current week, the server rebuilds it under that week's rules and scores
//! it (sim.rs `run_challenge`, the same code the game runs), and keeps each player's best of
//! the week. A week that is over takes no more factories. Boards: the week's top 50 and you,
//! with last week's podium.

use crate::auth::{AuthUser, MaybeUser};
use crate::error::{ApiError, ApiResult};
use crate::{sim, AppState};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 86_400_000;
const MAX_QUEUE: usize = 8;
const BOARD_SIZE: i64 = 50;

// ---- ISO weeks (the same arithmetic as challenge.js weekKey / periodBounds) -------------------
/// Days since 1970-01-01 of a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil year of a day since 1970-01-01.
fn year_of_day(z: i64) -> i64 {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    yoe + era * 400 + if month <= 2 { 1 } else { 0 }
}

/// The ISO week of a time (ms since the epoch, UTC): "2026-W48".
pub fn week_key(ms: i64) -> String {
    let day = ms.div_euclid(DAY_MS);
    let weekday = (day + 3).rem_euclid(7); // Monday = 0
    let thursday = day - weekday + 3; // the ISO year is the year of the week's Thursday
    let year = year_of_day(thursday);
    let jan1 = days_from_civil(year, 1, 1);
    format!("{year}-W{:02}", (thursday - jan1) / 7 + 1)
}

/// When a week starts and ends (ms, end exclusive), or None for a key that isn't a week.
pub fn week_bounds(key: &str) -> Option<(i64, i64)> {
    let (y, w) = key.split_once("-W")?;
    if y.len() != 4 || w.len() != 2 || !y.bytes().chain(w.bytes()).all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (year, week): (i64, i64) = (y.parse().ok()?, w.parse().ok()?);
    if !(1..=53).contains(&week) {
        return None;
    }
    let jan4 = days_from_civil(year, 1, 4);
    let monday1 = jan4 - (jan4 + 3).rem_euclid(7);
    let start = (monday1 + (week - 1) * 7) * DAY_MS;
    (week_key(start) == key).then_some((start, start + 7 * DAY_MS))
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// The challenge score version baked into this binary (from benchmark.js; read once, at start).
pub fn version() -> i64 {
    static VERSION: OnceLock<i64> = OnceLock::new();
    *VERSION.get_or_init(|| sim::challenge_version().expect("the simulation does not load"))
}

// ---- Boards ------------------------------------------------------------------------------------
type Row = (i64, String, f64, i32, i32, i64, i64);

fn entry(row: &Row, me: Option<i64>) -> Value {
    let (uid, name, per_minute, cost, machines, at, rank) = row;
    json!({ "rank": rank, "name": name, "perMinute": per_minute, "cost": cost, "machines": machines, "createdAt": at, "me": Some(*uid) == me })
}

/// The board of one week under one version: the top `limit` and the player's own row.
async fn board_rows(db: &PgPool, week: &str, version: i64, limit: i64, me: Option<i64>) -> ApiResult<Vec<Row>> {
    let rows: Vec<Row> = sqlx::query_as(
        "with ranked as (select c.user_id, u.name, c.per_minute, c.cost, c.machines, c.created_at, \
           row_number() over (order by c.per_minute desc, c.cost asc, c.created_at asc) as rank \
           from challenge_scores c join users u on u.id = c.user_id where c.week = $1 and c.version = $2) \
         select user_id, name, per_minute, cost, machines, (extract(epoch from created_at) * 1000)::bigint, rank \
         from ranked where rank <= $3 or user_id = $4 order by rank",
    )
    .bind(week)
    .bind(version as i32)
    .bind(limit)
    .bind(me.unwrap_or(-1))
    .fetch_all(db)
    .await?;
    Ok(rows)
}

/// The version a week's board is read under: this binary's for the current week, else the
/// newest one that week has scores under.
async fn board_version(db: &PgPool, week: &str, current: bool) -> ApiResult<i64> {
    if current {
        return Ok(version());
    }
    let (v,): (Option<i32>,) = sqlx::query_as("select max(version) from challenge_scores where week = $1").bind(week).fetch_one(db).await?;
    Ok(v.map(i64::from).unwrap_or_else(version))
}

#[derive(Deserialize)]
pub struct BoardQuery {
    week: Option<String>,
}

/// GET /api/challenge?week= — a week's board (the current week by default): its top 50 and
/// the signed-in player's row, when the week runs, and the week before's podium.
pub async fn board(State(state): State<AppState>, MaybeUser(me): MaybeUser, Query(q): Query<BoardQuery>) -> ApiResult<Json<Value>> {
    let now = now_ms();
    let this_week = week_key(now);
    let week = q.week.unwrap_or_else(|| this_week.clone());
    let (starts, ends) = week_bounds(&week).ok_or_else(|| ApiError::bad("Not a week"))?;
    let me_id = me.as_ref().map(|u| u.id);
    let current = week == this_week;
    let v = board_version(&state.db, &week, current).await?;
    let rows = board_rows(&state.db, &week, v, BOARD_SIZE, me_id).await?;
    let previous = week_key(starts - 1);
    let pv = board_version(&state.db, &previous, false).await?;
    let podium: Vec<Value> = board_rows(&state.db, &previous, pv, 3, None).await?.iter().map(|r| entry(r, me_id)).collect();
    Ok(Json(json!({
        "week": week,
        "current": current,
        "thisWeek": this_week,
        "startsAt": starts,
        "endsAt": ends,
        "now": now,
        "version": v,
        "entries": rows.iter().filter(|r| r.6 <= BOARD_SIZE).map(|r| entry(r, me_id)).collect::<Vec<_>>(),
        "me": rows.iter().find(|r| Some(r.0) == me_id).map(|r| entry(r, me_id)),
        "previous": { "week": previous, "podium": podium },
    })))
}

// ---- Submissions -------------------------------------------------------------------------------
#[derive(Deserialize)]
pub struct Submit {
    week: String,
    layout: Value,
}

/// POST /api/challenge/submit — `{ week, layout }`: the factory for this week's challenge.
/// Refused when the week isn't the current one or the layout breaks the week's rules.
pub async fn submit(State(state): State<AppState>, AuthUser(user): AuthUser, Json(body): Json<Submit>) -> ApiResult<Json<Value>> {
    let week = body.week;
    let (starts, _) = week_bounds(&week).ok_or_else(|| ApiError::bad("Not a week"))?;
    let this_week = week_key(now_ms());
    if week != this_week {
        let msg = if starts < now_ms() { "That week's challenge is over: its board is closed" } else { "That week's challenge hasn't started yet" };
        return Err(ApiError::new(StatusCode::CONFLICT, msg).with(json!({ "thisWeek": this_week })));
    }
    if !state.allow(&format!("challenge:{}", user.id), 1, 20) {
        return Err(ApiError::too_many("One factory test per 20 seconds"));
    }
    let layout = body.layout.to_string();

    // One test at a time, shared with the leaderboard's (each takes a second or three of CPU).
    if state.bench_waiting.fetch_add(1, Ordering::SeqCst) >= MAX_QUEUE {
        state.bench_waiting.fetch_sub(1, Ordering::SeqCst);
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "The auditors are busy. Try again in a minute."));
    }
    let permit = state.bench.clone().acquire_owned().await;
    state.bench_waiting.fetch_sub(1, Ordering::SeqCst);
    let _permit = permit.map_err(|_| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "Shutting down"))?;
    let key = week.clone();
    let out = tokio::task::spawn_blocking(move || sim::run_challenge(&layout, &key, Duration::from_secs(30)))
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "The test crashed"))?
        .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, format!("The test failed: {e}")))?;
    let result: Value = serde_json::from_str(&out).map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Bad test result"))?;
    if result["ok"] != Value::Bool(true) {
        let msg = result["error"].as_str().unwrap_or("The factory could not be tested").to_string();
        return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, msg).with(json!({ "rule": result["rule"] })));
    }
    let per_minute = result["perMinute"].as_f64().unwrap_or(0.0);
    let cost = result["cost"].as_i64().unwrap_or(0) as i32;
    let machines = result["machines"].as_i64().unwrap_or(0) as i32;
    let cells = result["cells"].as_i64().unwrap_or(0) as i32;
    let v = version();

    // Only a better best is kept: more of the target per minute, or as many for fewer credits.
    let stored = per_minute > 0.0
        && sqlx::query(
            "insert into challenge_scores (user_id, week, version, per_minute, cost, machines, cells, layout) \
             values ($1, $2, $3, $4, $5, $6, $7, $8) \
             on conflict (user_id, week, version) do update set per_minute = excluded.per_minute, cost = excluded.cost, \
               machines = excluded.machines, cells = excluded.cells, layout = excluded.layout, created_at = now() \
             where excluded.per_minute > challenge_scores.per_minute \
                or (excluded.per_minute = challenge_scores.per_minute and excluded.cost < challenge_scores.cost)",
        )
        .bind(user.id)
        .bind(&week)
        .bind(v as i32)
        .bind(per_minute)
        .bind(cost)
        .bind(machines)
        .bind(cells)
        .bind(&body.layout)
        .execute(&state.db)
        .await?
        .rows_affected()
            > 0;
    let rows = board_rows(&state.db, &week, v, 0, Some(user.id)).await?;
    let mine = rows.iter().find(|r| r.0 == user.id).map(|r| entry(r, Some(user.id)));
    Ok(Json(json!({ "result": result, "stored": stored, "best": mine })))
}

/// The player's challenge scores, for "download my data" (auth.rs export).
pub async fn export_rows(db: &PgPool, user_id: i64) -> ApiResult<Vec<Value>> {
    let rows: Vec<(String, i32, f64, i32, i32, i32, Value, i64)> = sqlx::query_as(
        "select week, version, per_minute, cost, machines, cells, layout, (extract(epoch from created_at) * 1000)::bigint \
         from challenge_scores where user_id = $1 order by week, created_at",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(week, version, pm, cost, machines, cells, layout, at)| {
            json!({ "week": week, "version": version, "perMinute": pm, "cost": cost, "machines": machines, "cells": cells, "layout": layout, "createdAt": at })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../tests/challenge-cases.json");

    #[test]
    fn week_keys_like_the_game() {
        let cases: Value = serde_json::from_str(CASES).unwrap();
        for case in cases["weeks"].as_array().unwrap() {
            let (ms, key) = (case["ms"].as_i64().unwrap(), case["key"].as_str().unwrap());
            assert_eq!(week_key(ms), key, "the week of {ms}");
            let (start, end) = week_bounds(key).unwrap();
            assert!(start <= ms && ms < end, "{key} holds {ms}");
            assert_eq!((start / DAY_MS + 3).rem_euclid(7), 0, "{key} starts on a Monday");
        }
        for case in cases["rules"].as_array().unwrap() {
            let key = case["key"].as_str().unwrap();
            if key.contains("-W") {
                let (start, end) = week_bounds(key).unwrap();
                assert_eq!(week_key(start), key);
                assert_eq!(week_key(end - 1), key);
                assert_ne!(week_key(end), key);
            }
        }
    }

    #[test]
    fn only_real_weeks() {
        for bad in ["2026-W54", "2025-W53", "2026-W00", "2026-w48", "26-W48", "2026-W4", "nope", "", "2026-11-24"] {
            assert!(week_bounds(bad).is_none(), "{bad}");
        }
        assert!(week_bounds("2026-W53").is_some());
        assert!(week_bounds("2020-W53").is_some());
    }
}
