// scripts/test-bench.mjs — checks the leaderboard test (src/benchmark.js) in Node:
// the same layout always scores the same, bad layouts are refused, and a dense map
// finishes in reasonable time. Writes the cases with their V8 scores to
// api/tests/bench-cases.json for the API's QuickJS check (cargo test).
//   node scripts/test-bench.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { runBenchmark } from '../src/benchmark.js';
import { SMALL, denseLayout } from './bench-cases.mjs';

let failed = 0;
const check = (ok, msg) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
    if (!ok) failed++;
};

const a = runBenchmark(SMALL);
const b = runBenchmark(SMALL);
check(a.ok && a.perMinute > 0, `small factory scores ${a.perMinute} cr/min (${JSON.stringify(a.sold)})`);
check(JSON.stringify(a) === JSON.stringify(b), 'same layout, same result');

const refusals = [
    [{ machines: [] }, 'empty'],
    [{ machines: [{ x: 0, y: 0, type: 'extractor', dir: 'right' }] }, 'extractor off ore'],
    [{ machines: [{ x: 19, y: 12, type: 'belt', dir: 'right' }] }, 'on the pad'],
    [{ machines: [{ x: 1, y: 20, type: 'belt', dir: 'right' }] }, 'in the river'],
    [{ machines: [{ x: 5, y: 5, type: 'belt', dir: 'north' }] }, 'bad direction'],
    [{ machines: [{ x: 5, y: 5, type: 'belt', dir: 'right', tier: 3 }] }, 'tier on a belt'],
    [{ machines: [{ x: 5, y: 8, type: 'smelter', dir: 'right', tier: 9 }] }, 'tier 9'],
    [{ machines: [{ x: 5, y: 8, type: 'smelter', dir: 'right', recipe: 'gold' }] }, 'unknown recipe'],
    [{ machines: [{ x: 5, y: 8, type: 'sink', dir: 'right' }] }, 'a second pad'],
    [{ world: 'moon', machines: [{ x: 5, y: 8, type: 'belt', dir: 'right' }] }, 'unknown world'],
    [{ machines: [{ x: 5, y: 8, type: 'belt', dir: 'right' }, { x: 5, y: 8, type: 'belt', dir: 'up' }] }, 'two on one cell'],
    [null, 'no layout'],
];
for (const [layout, what] of refusals) {
    const r = runBenchmark(layout);
    check(!r.ok, `refuses ${what}${r.ok ? '' : ` (${r.error})`}`);
}

const dense = denseLayout();
const t0 = performance.now();
const d = runBenchmark(dense);
const ms = performance.now() - t0;
check(d.ok, `dense map (${dense.machines.length} machines) runs in ${ms.toFixed(0)} ms, ${d.perMinute} cr/min`);

mkdirSync(new URL('../api/tests/', import.meta.url), { recursive: true });
writeFileSync(new URL('../api/tests/bench-cases.json', import.meta.url), JSON.stringify([
    { name: 'small', layout: SMALL, expect: a },
    { name: 'dense', layout: dense, expect: d },
]));
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
