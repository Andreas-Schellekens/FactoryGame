// scripts/test-bench.mjs — checks the leaderboard test (src/benchmark.js) in Node:
// the same layout always scores the same, bad layouts are refused, and a dense map
// finishes in reasonable time. Writes the cases with their V8 scores to
// api/tests/bench-cases.json for the API's QuickJS check (cargo test).
// Then the weekly challenge (src/challenge.js): fair rules, real week keys, its rules
// enforced, its scores stable; cases in api/tests/challenge-cases.json.
//   node scripts/test-bench.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { runBenchmark, BENCH_VERSION, CHALLENGE_SCORE_VERSION } from '../src/benchmark.js';
import { challengeFor, weekKey, periodBounds, previousPeriod, TARGETS } from '../src/challenge.js';
import { GRID_WIDTH, GRID_HEIGHT } from '../src/config.js';
import * as sim from '../src/grid.js';
import { SMALL, denseLayout } from './bench-cases.mjs';
import { autoLayout } from './challenge-cases.mjs';

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

// The normal leaderboard's scores must not move unless BENCH_VERSION does.
const casesFile = new URL('../api/tests/bench-cases.json', import.meta.url);
const before = existsSync(casesFile) ? JSON.parse(readFileSync(casesFile, 'utf8')) : null;
if (before && before[0]?.expect?.version === BENCH_VERSION) {
    const same = (x, y) => x.perMinute === y.perMinute && JSON.stringify(x.sold) === JSON.stringify(y.sold);
    check(same(before[0].expect, a) && same(before[1].expect, d), `normal scores as before (v${BENCH_VERSION}: small ${before[0].expect.perMinute}, dense ${before[1].expect.perMinute})`);
} else console.log(`note: BENCH_VERSION is ${BENCH_VERSION}, the saved cases were v${before?.[0]?.expect?.version}: a new baseline`);

mkdirSync(new URL('../api/tests/', import.meta.url), { recursive: true });
writeFileSync(casesFile, JSON.stringify([
    { name: 'small', layout: SMALL, expect: a },
    { name: 'dense', layout: dense, expect: d },
]));

// ---- The weekly challenge (src/challenge.js, benchmark.js runChallenge) ------------------------
// Writes api/tests/challenge-cases.json for the API's checks: Rust's week keys, QuickJS's rules
// and scores must match these.
console.log('\nweekly challenge');

// The target table matches the recipes: every building and ore of its chain.
const MAKERS = {};
for (const [type, list] of Object.entries(sim.RECIPES)) for (const r of list) if (r.output && !MAKERS[r.output]) MAKERS[r.output] = { type, inputs: Object.keys(r.inputs) };
const ORE_TYPES = new Set(['ironOre', 'copperOre', 'coalOre', 'sulfurOre']);
function chainOf(item, acc = { buildings: new Set(['extractor']), ores: new Set() }) {
    if (ORE_TYPES.has(item)) acc.ores.add(item);
    else {
        acc.buildings.add(MAKERS[item].type);
        for (const i of MAKERS[item].inputs) chainOf(i, acc);
    }
    return acc;
}
for (const [target, t] of Object.entries(TARGETS)) {
    const c = chainOf(target);
    const same = (a, b) => [...a].sort().join() === [...b].sort().join();
    check(same(c.buildings, t.buildings) && same(c.ores, t.ores), `the ${target} chain matches the recipes`);
}

// Week keys, including the years with a week 53 and the ones that start in the year before.
const WEEK_SAMPLES = [
    [Date.UTC(2026, 10, 24, 12), '2026-W48'], [Date.UTC(2026, 10, 23, 0), '2026-W48'], [Date.UTC(2026, 10, 22, 23, 59, 59, 999), '2026-W47'],
    [Date.UTC(2021, 0, 3), '2020-W53'], [Date.UTC(2020, 11, 31), '2020-W53'], [Date.UTC(2024, 11, 30), '2025-W01'],
    [Date.UTC(2026, 0, 1), '2026-W01'], [Date.UTC(2027, 0, 1), '2026-W53'], [Date.UTC(2027, 0, 4), '2027-W01'],
    [Date.UTC(2032, 11, 31, 18), '2032-W53'], [Date.UTC(2025, 11, 29), '2026-W01'], [Date.UTC(1970, 0, 1), '1970-W01'], [Date.UTC(2099, 5, 15), '2099-W25'],
];
check(WEEK_SAMPLES.every(([ms, key]) => weekKey(ms) === key), 'ISO week keys');
check(WEEK_SAMPLES.every(([ms, key]) => {
    const b = periodBounds(key);
    return b && b.start <= ms && ms < b.end && new Date(b.start).getUTCDay() === 1 && b.end - b.start === 7 * 86400000;
}), 'a week runs Monday 00:00 to Monday 00:00 UTC');
check(previousPeriod('2026-W01') === '2025-W52' && previousPeriod('2027-W01') === '2026-W53' && previousPeriod('2026-11-01') === '2026-10-31', 'the period before');
check(!challengeFor('2026-W54') && !challengeFor('2025-W53') && !challengeFor('nope') && !challengeFor('2026-02-30') && !!challengeFor('2026-02-28'), 'only real periods have a challenge');

// Five years of weeks: each one fair (its ore is there, its cap and budget fit the chain) and
// different from the one before.
const keys = [];
for (let k = '2026-W01'; keys.length < 260; k = weekKey(periodBounds(k).end)) keys.push(k);
let unfair = [];
let repeats = 0;
let lastTheme = null;
for (const key of keys) {
    const r = challengeFor(key);
    sim.newGame('challenge', { challenge: key });
    const cells = {};
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const c = sim.grid[x][y];
            if (c.resource && !c.water && sim.inPlot(x, y)) cells[c.resource] = (cells[c.resource] ?? 0) + 1;
        }
    }
    const ores = [...TARGETS[r.target].ores, ...(r.buildings.includes('generator') ? ['coalOre'] : [])];
    if (ores.some((t) => (cells[t] ?? 0) < 2) || r.cap < r.minMachines || r.budget < r.minCost) unfair.push(key);
    if (r.theme === lastTheme) repeats++;
    lastTheme = r.theme;
}
check(!unfair.length, `260 weeks, all fair${unfair.length ? ` (not: ${unfair.slice(0, 5).join(', ')})` : ''}`);
check(repeats === 0, 'no theme two weeks running');
check(JSON.stringify(challengeFor('2026-W48')) === JSON.stringify(challengeFor('2026-W48')) && challengeFor('2026-W48') !== challengeFor('2026-W49'), 'one challenge per week');

// Real factories: this builder's layout for one week of each target it can build.
const runs = [];
const wanted = new Set(Object.keys(TARGETS));
for (const key of ['2026-W48', ...keys]) {
    const r = challengeFor(key);
    if (!wanted.has(r.target)) continue;
    const layout = autoLayout(key);
    if (!layout) continue;
    wanted.delete(r.target);
    const one = runBenchmark(layout, { challenge: key });
    const two = runBenchmark(layout, { challenge: key });
    check(one.ok && one.perMinute > 0 && one.target === r.target, `${key} (${r.theme}, ${r.target}): ${one.perMinute}/min, ${one.machines}/${r.cap} machines, CR ${one.cost}/${r.budget}${one.ok ? '' : ` ${one.error}`}`);
    check(JSON.stringify(one) === JSON.stringify(two), `${key}: same layout, same result`);
    runs.push({ key, layout, expect: one });
}
check(wanted.size <= 1, `a scoring factory for every target but ${[...wanted].join(', ') || 'none'}`);

// The rules are enforced: each broken rule is refused, with that rule.
const chRefusals = [];
const refuse = (key, layout, rule, what) => {
    const r = runBenchmark(layout, { challenge: key });
    check(!r.ok && r.rule === rule, `refuses ${what} (${r.error})`);
    chRefusals.push({ key, layout, rule });
};
{
    const { key, layout } = runs[0];
    const r = challengeFor(key);
    const freeCells = [];
    sim.newGame('challenge', { challenge: key });
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const c = sim.grid[x][y];
            if (!c.machine && !c.water && !c.resource && sim.inPlot(x, y) && !layout.machines.some((m) => m.x === x && m.y === y)) freeCells.push({ x, y });
        }
    }
    const banned = ['lab', 'mixer', 'fabricator', 'generator'].find((t) => !r.buildings.includes(t));
    refuse(key, { ...layout, machines: [...layout.machines, { ...freeCells[0], type: banned, dir: 'right', tier: 1 }] }, 'banned', `a ${banned} it doesn't allow`);
    const extra = Array.from({ length: r.cap }, (_, i) => ({ ...freeCells[i], type: 'smelter', dir: 'up', tier: 1, recipe: 'ironIngot' }));
    refuse(key, { ...layout, machines: [...layout.machines, ...extra] }, 'cap', 'more machines than the cap');
    if (r.tierCap < 4) {
        const up = layout.machines.map((m) => (m.type === 'smelter' ? { ...m, tier: r.tierCap + 1 } : m));
        refuse(key, { ...layout, machines: up }, 'tier', 'a tier over the cap');
    }
    check(!runBenchmark(layout, { challenge: 'nope' }).ok, 'refuses an unknown challenge');
    check(!runBenchmark({ machines: [{ ...freeCells[0], type: 'extractor', dir: 'right' }] }, { challenge: key }).ok, 'refuses an extractor off this week\'s ore');
}
{
    // Over budget: a tight-budget week, filled with Assemblers up to its cap.
    const key = keys.find((k) => {
        const r = challengeFor(k);
        return r.buildings.includes('assembler') && r.cap * 30 > r.budget;
    });
    const r = challengeFor(key);
    sim.newGame('challenge', { challenge: key });
    const machines = [];
    for (let x = 0; x < GRID_WIDTH && machines.length < r.cap; x++) {
        for (let y = 0; y < GRID_HEIGHT && machines.length < r.cap; y++) {
            const c = sim.grid[x][y];
            if (!c.machine && !c.water && sim.inPlot(x, y)) machines.push({ x, y, type: 'assembler', dir: 'right', tier: 1 });
        }
    }
    refuse(key, { world: 'valley', machines }, 'budget', `going over CR ${r.budget}`);
}

// The normal test doesn't remember a challenge run before it.
check(JSON.stringify(runBenchmark(SMALL)) === JSON.stringify(a), 'the normal test after a challenge run: unchanged');

const ruleCases = ['2026-W48', ...keys.slice(0, 30), '2026-11-24', '2026-11-25'].map((key) => ({ key, rules: challengeFor(key) }));
writeFileSync(new URL('../api/tests/challenge-cases.json', import.meta.url), JSON.stringify({
    version: CHALLENGE_SCORE_VERSION,
    weeks: WEEK_SAMPLES.map(([ms, key]) => ({ ms, key })),
    rules: ruleCases,
    runs,
    refusals: chRefusals,
}));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
