// src/benchmark.js — the leaderboard's factory test, shared by the game (a preview of
// your score) and the API server (the score that counts: it runs this same file in
// QuickJS, so nobody can send in a number of their own). Pure simulation, no DOM.
//
// A layout is just the machines: { world, machines: [{ x, y, type, dir, tier, recipe, off }] }.
// The test builds it on a fresh Infinite map of that world with everything researched and
// licensed, all land owned, empty buffers, a fresh market and no Priority Requests; runs
// BENCH.warmupTicks to fill the belts, then BENCH.scoreTicks, and scores the credits the
// Dispatch Pad paid in that window, per minute. Market saturation applies, so one product
// spammed earns little: a factory that makes many things scores best.
//
// With `{ challenge: key }` it is the weekly challenge's test instead (challenge.js): the
// layout is built on that week's map under its rules (buildings, machine cap, budget with
// upgrades, tier cap), refused with the rule it breaks, and scored by how many of the week's
// target the pad takes per minute. The normal test above is untouched by it.
//
// It drives the live grid.js module, so it replaces whatever game is loaded: the game
// runs it in a Web Worker (benchWorker.js), the server in a fresh QuickJS runtime.
import { TICK_RATE, GRID_WIDTH, GRID_HEIGHT, MAX_TIER, PLOTS, LICENCE_COST, MACHINE_COST, UPGRADE_COST } from './config.js';
import * as sim from './grid.js';
import { challengeFor, countsTowardCap, CHALLENGE_VERSION } from './challenge.js';

/** Bump when the test's rules change: scores of another version aren't comparable. */
export const BENCH_VERSION = 1;
export const BENCH = {
    warmupTicks: 60 * TICK_RATE, // 1 minute to fill belts and buffers
    scoreTicks: 5 * 60 * TICK_RATE, // then 5 minutes that count
};
export const BENCH_WORLDS = ['valley', 'aftermath'];
/** The version a challenge score is stored under: its rules and the simulation they run on. */
export const CHALLENGE_SCORE_VERSION = BENCH_VERSION * 100 + CHALLENGE_VERSION;
const DIRS = new Set(['right', 'down', 'left', 'up']);

/** The current factory as a benchmark layout (every machine but the pad). */
export function layoutOf() {
    const machines = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = sim.grid[x][y].machine;
            if (!m || m.type === 'sink') continue;
            const entry = { x, y, type: m.type, dir: m.dir, tier: m.tier };
            if (m.recipe) entry.recipe = m.recipe;
            if (m.off) entry.off = true;
            machines.push(entry);
        }
    }
    return { world: sim.game.world, machines };
}

const fail = (error) => ({ ok: false, error });

/**
 * Build a layout on a fresh Infinite map of its world with everything researched, licensed
 * and owned (what the test runs, and what the factory viewer shows). It replaces whatever
 * game the live grid.js holds. Never throws on bad input.
 * @returns {{ ok: true, world: string, machines: number } | { ok: false, error: string }}
 */
export function buildLayout(layout) {
    if (!layout || typeof layout !== 'object' || !Array.isArray(layout.machines)) return fail('No layout');
    const world = layout.world ?? 'valley';
    if (!BENCH_WORLDS.includes(world)) return fail('Unknown world');
    const list = layout.machines;
    if (!list.length) return fail('The factory is empty');
    if (list.length > GRID_WIDTH * GRID_HEIGHT) return fail('Too many machines');

    // A fresh Infinite game with everything open, and more credits than any layout costs.
    sim.loadState({
        version: sim.SAVE_VERSION,
        score: 1e12,
        game: { mode: 'infinite', world, plot: PLOTS.length - 1, licences: Object.keys(LICENCE_COST) },
        research: { points: 0, unlocked: { fastBelts: true, advancedProduct: true, tier4: true } },
        cells: [],
    });

    for (const m of list) {
        if (!m || typeof m !== 'object') return fail('Bad machine entry');
        const { x, y, type, dir } = m;
        if (!Number.isInteger(x) || !Number.isInteger(y)) return fail('Bad coordinates');
        if (typeof type !== 'string' || type === 'sink' || !DIRS.has(dir)) return fail(`Bad machine at ${x},${y}`);
        const recipes = sim.RECIPES[type];
        if (m.recipe != null && !recipes?.some((r) => r.id === m.recipe)) return fail(`Unknown recipe at ${x},${y}`);
        if (!sim.buildMachine(x, y, type, dir, m.recipe ?? null)) return fail(`Can't build ${type} at ${x},${y}`);
        const placed = sim.grid[x][y].machine;
        const tier = m.tier ?? 1;
        if (!Number.isInteger(tier) || tier < 1 || tier > MAX_TIER || (tier > 1 && !sim.UPGRADABLE.has(type))) {
            return fail(`Bad tier at ${x},${y}`);
        }
        placed.tier = tier;
        if (m.off) sim.setMachineOn(x, y, false);
    }
    return { ok: true, world, machines: list.length };
}

/**
 * Run the test. Never throws on bad input: returns { ok: false, error } instead.
 * `options.challenge`: a challenge's period key ("2026-W48"): run that challenge's test.
 * @returns {{ ok: true, version: number, world: string, machines: number, perMinute: number,
 *   efficiency: number, sold: Record<string, number> } | { ok: false, error: string }}
 */
export function runBenchmark(layout, options = {}) {
    if (options?.challenge != null) return runChallenge(layout, options.challenge);
    const built = buildLayout(layout);
    if (!built.ok) return built;
    const { world } = built;
    const list = layout.machines;

    for (let i = 0; i < BENCH.warmupTicks; i++) sim.updateFactoryLogic();
    const before = sim.score;
    const soldBefore = { ...sim.stats.delivered };
    for (let i = 0; i < BENCH.scoreTicks; i++) sim.updateFactoryLogic();
    const minutes = BENCH.scoreTicks / TICK_RATE / 60;
    const perMinute = (sim.score - before) / minutes;
    const sold = {};
    for (const [k, n] of Object.entries(sim.stats.delivered)) {
        const d = n - (soldBefore[k] ?? 0);
        if (d > 0) sold[k] = Math.round((d / minutes) * 10) / 10;
    }
    return {
        ok: true,
        version: BENCH_VERSION,
        world,
        machines: list.length,
        perMinute: Math.round(perMinute * 100) / 100,
        // Credits per minute per occupied cell: the compact board.
        efficiency: Math.round((perMinute / list.length) * 1000) / 1000,
        sold,
    };
}

/** A machine entry's shape (coordinates, type, direction, recipe): an error, or null when sound. */
function badEntry(m) {
    if (!m || typeof m !== 'object') return 'Bad machine entry';
    const { x, y, type, dir } = m;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return 'Bad coordinates';
    if (typeof type !== 'string' || type === 'sink' || !DIRS.has(dir)) return `Bad machine at ${x},${y}`;
    if (m.recipe != null && !sim.RECIPES[type]?.some((r) => r.id === m.recipe)) return `Unknown recipe at ${x},${y}`;
    const tier = m.tier ?? 1;
    if (!Number.isInteger(tier) || tier < 1 || tier > MAX_TIER || (tier > 1 && !sim.UPGRADABLE.has(type))) return `Bad tier at ${x},${y}`;
    return null;
}

/**
 * The weekly challenge's test: build the layout on the challenge's map under its rules (the
 * first rule it breaks is the error, with `rule`: 'banned' | 'cap' | 'budget' | 'tier'), then
 * run it like the normal test and count the target delivered per minute in the scored window.
 * @returns {{ ok: true, version: number, challenge: string, target: string, perMinute: number,
 *   machines: number, cells: number, cost: number, sold: Record<string, number> }
 *   | { ok: false, error: string, rule?: string }}
 */
export function runChallenge(layout, key) {
    const rules = challengeFor(key);
    if (!rules) return fail('Unknown challenge');
    if (!layout || typeof layout !== 'object' || !Array.isArray(layout.machines)) return fail('No layout');
    const list = layout.machines;
    if (!list.length) return fail('The factory is empty');
    if (list.length > GRID_WIDTH * GRID_HEIGHT) return fail('Too many machines');

    sim.newGame('challenge', { challenge: key });
    const broke = (rule, error) => ({ ok: false, error, rule });
    let capped = 0;
    for (const m of list) {
        const bad = badEntry(m);
        if (bad) return fail(bad);
        const { x, y, type, dir } = m;
        const tier = m.tier ?? 1;
        if (!rules.buildings.includes(type)) return broke('banned', `No ${type} this week (at ${x},${y})`);
        if (countsTowardCap(type) && ++capped > rules.cap) return broke('cap', `Over this week's cap of ${rules.cap} machines`);
        if (tier > rules.tierCap) return broke('tier', `Tier ${tier} at ${x},${y}: this week's tier cap is ${rules.tierCap}`);
        if (sim.score < (MACHINE_COST[type] ?? 0)) return broke('budget', `Over this week's budget of CR ${rules.budget}`);
        if (!sim.buildMachine(x, y, type, dir, m.recipe ?? null)) return fail(`Can't build ${type} at ${x},${y}`);
        for (let t = 2; t <= tier; t++) {
            if (sim.score < UPGRADE_COST[t]) return broke('budget', `Over this week's budget of CR ${rules.budget}`);
            if (!sim.upgradeMachine(x, y)) return fail(`Can't upgrade ${type} at ${x},${y}`);
        }
        if (m.off) sim.setMachineOn(x, y, false);
    }
    const cost = rules.budget - sim.score;

    for (let i = 0; i < BENCH.warmupTicks; i++) sim.updateFactoryLogic();
    const before = { ...sim.stats.delivered };
    for (let i = 0; i < BENCH.scoreTicks; i++) sim.updateFactoryLogic();
    const minutes = BENCH.scoreTicks / TICK_RATE / 60;
    const sold = {};
    for (const [k, n] of Object.entries(sim.stats.delivered)) {
        const d = n - (before[k] ?? 0);
        if (d > 0) sold[k] = Math.round((d / minutes) * 10) / 10;
    }
    const delivered = (sim.stats.delivered[rules.target] ?? 0) - (before[rules.target] ?? 0);
    return {
        ok: true,
        version: CHALLENGE_SCORE_VERSION,
        challenge: key,
        target: rules.target,
        perMinute: Math.round((delivered / minutes) * 100) / 100,
        machines: capped,
        cells: list.length,
        cost,
        sold,
    };
}
