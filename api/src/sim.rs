//! The leaderboard's factory test: runs the game's own `src/benchmark.js` (and the
//! `grid.js` simulation it drives) in QuickJS, so the score the server records is
//! computed by exactly the rules the game plays by. Every run gets a fresh runtime
//! (the simulation keeps its state in module globals), a memory cap and a deadline.
//! The weekly challenge's test (`run_challenge`) is the same file with the week's rules.

use rquickjs::loader::{Loader, Resolver};
use rquickjs::module::Declared;
use rquickjs::{CatchResultExt, Context, Ctx, Function, Module, Runtime};
use std::time::{Duration, Instant};

/// The game's simulation sources, baked into the binary at build time.
const SOURCES: &[(&str, &str)] = &[
    ("grid.js", include_str!("../../src/grid.js")),
    ("config.js", include_str!("../../src/config.js")),
    ("campaign.js", include_str!("../../src/campaign.js")),
    ("benchmark.js", include_str!("../../src/benchmark.js")),
    ("challenge.js", include_str!("../../src/challenge.js")),
];

/// Resolves `./grid.js`-style imports to the embedded sources (and nothing else).
struct Embedded;

impl Resolver for Embedded {
    fn resolve<'js>(&mut self, _ctx: &Ctx<'js>, base: &str, name: &str) -> rquickjs::Result<String> {
        let n = name.trim_start_matches("./");
        if SOURCES.iter().any(|(k, _)| *k == n) {
            Ok(n.to_string())
        } else {
            Err(rquickjs::Error::new_resolving(base, name))
        }
    }
}

impl Loader for Embedded {
    fn load<'js>(&mut self, ctx: &Ctx<'js>, name: &str) -> rquickjs::Result<Module<'js, Declared>> {
        let src = SOURCES
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, s)| *s)
            .ok_or_else(|| rquickjs::Error::new_loading(name))?;
        Module::declare(ctx.clone(), name, src)
    }
}

const PRELUDE: &str = "globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));";
const ENTRY: &str = "import { runBenchmark, BENCH_VERSION, CHALLENGE_SCORE_VERSION } from './benchmark.js';\n\
    import { challengeFor } from './challenge.js';\n\
    globalThis.__run = (s) => JSON.stringify(runBenchmark(JSON.parse(s)));\n\
    globalThis.__runChallenge = (s, key) => JSON.stringify(runBenchmark(JSON.parse(s), { challenge: key }));\n\
    globalThis.__rules = (key) => JSON.stringify(challengeFor(key));\n\
    globalThis.__version = BENCH_VERSION;\n\
    globalThis.__challengeVersion = CHALLENGE_SCORE_VERSION;";

/// Run the test on a layout (JSON text, as the client sent it). Returns the JSON text of
/// `runBenchmark`'s result (`{ ok: true, perMinute, … }` or `{ ok: false, error }`), or an
/// error when the engine itself failed (out of memory, past the deadline).
pub fn run_benchmark(layout_json: &str, timeout: Duration) -> Result<String, String> {
    call_with_deadline(timeout, "__run", (layout_json,))
}

/// The weekly challenge's test on a layout for the week `key` ("2026-W48"): the layout is
/// built under that week's rules and scored by its target per minute. Returns the JSON text
/// of the result (`{ ok: true, perMinute, cost, … }` or `{ ok: false, error, rule }`).
pub fn run_challenge(layout_json: &str, key: &str, timeout: Duration) -> Result<String, String> {
    call_with_deadline(timeout, "__runChallenge", (layout_json, key))
}

/// Call one of ENTRY's functions in a fresh runtime with a memory cap and a deadline.
fn call_with_deadline<A: for<'js> rquickjs::function::IntoArgs<'js>>(timeout: Duration, name: &str, args: A) -> Result<String, String> {
    let rt = Runtime::new().map_err(|e| e.to_string())?;
    rt.set_memory_limit(128 * 1024 * 1024);
    rt.set_max_stack_size(2 * 1024 * 1024);
    let deadline = Instant::now() + timeout;
    rt.set_interrupt_handler(Some(Box::new(move || Instant::now() > deadline)));
    rt.set_loader(Embedded, Embedded);
    let ctx = Context::full(&rt).map_err(|e| e.to_string())?;
    let out = ctx.with(|ctx| -> Result<String, String> {
        ctx.eval::<(), _>(PRELUDE).catch(&ctx).map_err(|e| e.to_string())?;
        let done = Module::evaluate(ctx.clone(), "main.js", ENTRY).catch(&ctx).map_err(|e| e.to_string())?;
        done.finish::<()>().catch(&ctx).map_err(|e| e.to_string())?;
        let run: Function = ctx.globals().get(name).map_err(|e| e.to_string())?;
        run.call::<_, String>(args).catch(&ctx).map_err(|e| e.to_string())
    });
    if Instant::now() > deadline {
        return Err("The test ran out of time".into());
    }
    out
}

/// A challenge's rules as challenge.js draws them (JSON text; "null" for a key that isn't one).
#[cfg_attr(not(test), allow(dead_code))] // the tests compare them with Node's
pub fn challenge_rules(key: &str) -> Result<String, String> {
    call_with_deadline(Duration::from_secs(5), "__rules", (key,))
}

/// The benchmark version baked into this binary (scores of another version aren't comparable).
pub fn bench_version() -> Result<i64, String> {
    global_number("__version")
}

/// The weekly challenge's score version (BENCH_VERSION * 100 + CHALLENGE_VERSION).
pub fn challenge_version() -> Result<i64, String> {
    global_number("__challengeVersion")
}

fn global_number(name: &str) -> Result<i64, String> {
    let rt = Runtime::new().map_err(|e| e.to_string())?;
    rt.set_loader(Embedded, Embedded);
    let ctx = Context::full(&rt).map_err(|e| e.to_string())?;
    ctx.with(|ctx| -> Result<i64, String> {
        ctx.eval::<(), _>(PRELUDE).catch(&ctx).map_err(|e| e.to_string())?;
        let done = Module::evaluate(ctx.clone(), "main.js", ENTRY).catch(&ctx).map_err(|e| e.to_string())?;
        done.finish::<()>().catch(&ctx).map_err(|e| e.to_string())?;
        ctx.globals().get::<_, i64>(name).map_err(|e| e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The layouts and V8 (Node) scores written by `node scripts/test-bench.mjs`.
    const CASES: &str = include_str!("../tests/bench-cases.json");

    fn run(layout: &serde_json::Value) -> serde_json::Value {
        let out = run_benchmark(&layout.to_string(), Duration::from_secs(60)).expect("the engine runs");
        serde_json::from_str(&out).unwrap()
    }

    #[test]
    fn quickjs_scores_like_the_browser() {
        let cases: serde_json::Value = serde_json::from_str(CASES).unwrap();
        let small = &cases.as_array().unwrap()[0];
        let got = run(&small["layout"]);
        assert_eq!(got["ok"], true, "{got}");
        let (a, b) = (got["perMinute"].as_f64().unwrap(), small["expect"]["perMinute"].as_f64().unwrap());
        assert!((a - b).abs() < 0.01, "QuickJS {a} vs Node {b}");
        assert_eq!(got["sold"], small["expect"]["sold"]);
    }

    #[test]
    fn same_layout_same_score() {
        let cases: serde_json::Value = serde_json::from_str(CASES).unwrap();
        let layout = &cases.as_array().unwrap()[0]["layout"];
        assert_eq!(run(layout), run(layout));
    }

    #[test]
    fn refuses_what_cannot_be_built() {
        let got = run(&serde_json::json!({ "machines": [{ "x": 0, "y": 0, "type": "extractor", "dir": "right" }] }));
        assert_eq!(got["ok"], false);
        let got = run(&serde_json::json!({ "machines": "lots" }));
        assert_eq!(got["ok"], false);
    }

    /// The weekly challenge's cases, written by `node scripts/test-bench.mjs`.
    const CHALLENGE_CASES: &str = include_str!("../tests/challenge-cases.json");

    #[test]
    fn quickjs_draws_the_same_challenges() {
        let cases: serde_json::Value = serde_json::from_str(CHALLENGE_CASES).unwrap();
        for case in cases["rules"].as_array().unwrap() {
            let key = case["key"].as_str().unwrap();
            let got: serde_json::Value = serde_json::from_str(&challenge_rules(key).unwrap()).unwrap();
            assert_eq!(got, case["rules"], "the rules of {key}");
        }
        assert_eq!(challenge_rules("2026-W54").unwrap(), "null");
        assert_eq!(challenge_version().unwrap(), cases["version"].as_i64().unwrap());
    }

    #[test]
    fn quickjs_scores_challenges_like_node() {
        let cases: serde_json::Value = serde_json::from_str(CHALLENGE_CASES).unwrap();
        let runs = cases["runs"].as_array().unwrap();
        assert!(runs.len() >= 6, "a scoring case for most targets");
        for case in runs {
            let key = case["key"].as_str().unwrap();
            let out = run_challenge(&case["layout"].to_string(), key, Duration::from_secs(60)).expect("the engine runs");
            let got: serde_json::Value = serde_json::from_str(&out).unwrap();
            assert_eq!(got, case["expect"], "QuickJS vs Node on {key}");
        }
    }

    #[test]
    fn quickjs_refuses_what_the_rules_forbid() {
        let cases: serde_json::Value = serde_json::from_str(CHALLENGE_CASES).unwrap();
        for case in cases["refusals"].as_array().unwrap() {
            let key = case["key"].as_str().unwrap();
            let out = run_challenge(&case["layout"].to_string(), key, Duration::from_secs(60)).expect("the engine runs");
            let got: serde_json::Value = serde_json::from_str(&out).unwrap();
            assert_eq!(got["ok"], false, "{key}: {got}");
            assert_eq!(got["rule"], case["rule"], "{key}: {got}");
        }
        let small = serde_json::from_str::<serde_json::Value>(CASES).unwrap()[0]["layout"].to_string();
        let got: serde_json::Value = serde_json::from_str(&run_challenge(&small, "nope", Duration::from_secs(10)).unwrap()).unwrap();
        assert_eq!(got["ok"], false);
    }

    #[test]
    fn stops_at_the_deadline() {
        let cases: serde_json::Value = serde_json::from_str(CASES).unwrap();
        let dense = cases.as_array().unwrap()[1]["layout"].to_string();
        assert!(run_benchmark(&dense, Duration::from_millis(30)).is_err());
    }
}
