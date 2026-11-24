//! Protocol: Selene's API: accounts, cloud saves, settings and the leaderboard, on
//! Postgres. It is only reached through the web service (Caddy proxies /api/* to it over
//! Railway's private network), so the browser sees one site and the session cookie works.
//!
//!   selene-api                    serve (DATABASE_URL, HOST, PORT, COOKIE_SECURE)
//!   selene-api bench <cases.json> run the leaderboard test (or the weekly challenge's) on sample layouts and time it

mod auth;
mod blueprints;
mod challenge;
mod error;
mod limits;
mod passkeys;
mod profile;
mod scores;
mod sim;
mod store;

use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub limiter: Arc<limits::Limiter>,
    /// One leaderboard test at a time; `bench_waiting` counts the queue.
    pub bench: Arc<Semaphore>,
    pub bench_waiting: Arc<AtomicUsize>,
    pub bench_version: i64,
    pub cookie_secure: bool,
    /// Multiplies every rate limit (RELAX_LIMITS=1 in local development: tests sign up a lot).
    pub limit_scale: u32,
}

impl AppState {
    /// Count a hit on a rate-limit key; false once it is over `max` per `secs`.
    pub fn allow(&self, key: &str, max: u32, secs: u64) -> bool {
        self.limiter.allow(key, max.saturating_mul(self.limit_scale), Duration::from_secs(secs))
    }
}

/// Requests that change something must carry `X-Selene: 1`. A page on another site can't
/// add that header without the API's permission (it never gives it), so with SameSite
/// cookies this stops cross-site request forgery.
async fn require_header(req: Request, next: Next) -> Response {
    let changes = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if changes && req.headers().get("x-selene").and_then(|v| v.to_str().ok()) != Some("1") {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Missing X-Selene header" }))).into_response();
    }
    let mut res = next.run(req).await;
    res.headers_mut().insert("cache-control", "no-store".parse().unwrap());
    res
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let db = sqlx::query("select 1").execute(&state.db).await.is_ok();
    let status = if db { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (status, Json(json!({ "ok": db, "bench": state.bench_version })))
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/signup", post(auth::signup))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/recover", post(auth::recover))
        .route("/me", get(auth::me).delete(auth::delete_account))
        .route("/me/password", post(auth::change_password))
        .route("/me/export", get(auth::export))
        .route("/saves", get(store::list))
        .route("/saves/{slot}", get(store::get).put(store::put).delete(store::delete))
        .route("/settings", get(store::get_settings).put(store::put_settings))
        .route("/scores", post(scores::submit))
        .route("/leaderboard", get(scores::leaderboard))
        .route("/blueprints", get(blueprints::list))
        .route("/blueprints/{id}", put(blueprints::put).delete(blueprints::delete))
        .route("/factories/{id}", get(blueprints::factory))
        .merge(profile::routes())
        .merge(passkeys::routes())
        .route("/challenge", get(challenge::board))
        .route("/challenge/submit", post(challenge::submit))
        .layer(middleware::from_fn(require_header))
        .layer(DefaultBodyLimit::max(6 * 1024 * 1024))
        .with_state(state);
    Router::new().nest("/api", api).fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))) })
}

async fn connect(url: &str) -> PgPool {
    // The database may still be starting when the API boots (a fresh deploy): retry for a minute.
    let mut wait = Duration::from_millis(500);
    let until = Instant::now() + Duration::from_secs(60);
    loop {
        match PgPoolOptions::new().max_connections(8).acquire_timeout(Duration::from_secs(5)).connect(url).await {
            Ok(pool) => return pool,
            Err(e) if Instant::now() < until => {
                eprintln!("database not ready ({e}); retrying");
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(Duration::from_secs(5));
            }
            Err(e) => panic!("could not connect to the database: {e}"),
        }
    }
}

fn bench_cli(path: &str) {
    let cases: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("read cases")).expect("parse cases");
    // The leaderboard's cases (an array), or the weekly challenge's (tests/challenge-cases.json: `runs`, each with its week).
    let list = cases.get("runs").unwrap_or(&cases);
    for case in list.as_array().expect("an array of cases") {
        let layout = serde_json::to_string(&case["layout"]).unwrap();
        let t0 = Instant::now();
        let out = match case["key"].as_str() {
            Some(week) => sim::run_challenge(&layout, week, Duration::from_secs(60)),
            None => sim::run_benchmark(&layout, Duration::from_secs(60)),
        };
        let ms = t0.elapsed().as_millis();
        match out {
            Ok(text) => {
                let got: serde_json::Value = serde_json::from_str(&text).unwrap();
                println!("{}: {ms} ms, perMinute {} (Node: {})", case.get("name").unwrap_or(&case["key"]), got["perMinute"], case["expect"]["perMinute"]);
            }
            Err(e) => println!("{}: error {e}", case["name"]),
        }
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("bench") {
        bench_cli(args.get(2).map(String::as_str).unwrap_or("tests/bench-cases.json"));
        return;
    }
    // Local development reads ../.env or .env (Railway sets real environment variables).
    let _ = dotenvy::from_filename(".env").or_else(|_| dotenvy::from_filename("../.env"));
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL is not set (see .env.example)");
    let host = std::env::var("HOST").unwrap_or_else(|_| "::".into());
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let cookie_secure = std::env::var("COOKIE_SECURE").map(|v| v == "1" || v == "true").unwrap_or(false);
    let limit_scale = if std::env::var("RELAX_LIMITS").map(|v| v == "1").unwrap_or(false) { 100 } else { 1 };

    // Each start-up step says so, so a deploy that hangs shows where.
    println!("selene-api: connecting to the database");
    let db = connect(&url).await;
    println!("selene-api: running migrations");
    sqlx::migrate!("./migrations").run(&db).await.expect("database migrations failed");
    println!("selene-api: loading the simulation");
    let bench_version = tokio::task::spawn_blocking(sim::bench_version).await.unwrap().expect("the simulation does not load");
    let challenge_version = tokio::task::spawn_blocking(challenge::version).await.unwrap();
    println!("selene-api: starting the server");

    // Expired sessions are swept every hour.
    let sweeper = db.clone();
    tokio::spawn(async move {
        loop {
            let _ = sqlx::query("delete from sessions where expires_at < now()").execute(&sweeper).await;
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });

    let state = AppState {
        db,
        limiter: Arc::new(limits::Limiter::default()),
        bench: Arc::new(Semaphore::new(1)),
        bench_waiting: Arc::new(AtomicUsize::new(0)),
        bench_version,
        cookie_secure,
        limit_scale,
    };
    let addr = if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| panic!("could not listen on {addr}: {e}"));
    println!("selene-api listening on {addr} (benchmark v{bench_version}, weekly challenge v{challenge_version}; {})", passkeys::describe());
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap();
}
