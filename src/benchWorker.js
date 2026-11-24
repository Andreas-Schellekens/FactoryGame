// src/benchWorker.js — runs the leaderboard test (benchmark.js) on a layout in a Web
// Worker: its own copy of the simulation, so the game being played isn't touched. The
// server's score is the one that counts; this is the "test here first" preview.
import { runBenchmark } from './benchmark.js';

self.onmessage = (e) => {
    // A layout, or { layout, options } (options.challenge: the weekly challenge's test).
    const { layout, options } = e.data?.layout ? e.data : { layout: e.data, options: {} };
    let result;
    try {
        result = runBenchmark(layout, options);
    } catch (err) {
        result = { ok: false, error: String(err?.message ?? err) };
    }
    self.postMessage(result);
};
