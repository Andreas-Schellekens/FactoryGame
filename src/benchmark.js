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
// It drives the live grid.js module, so it replaces whatever game is loaded: the game
// runs it in a Web Worker (benchWorker.js), the server in a fresh QuickJS runtime.
import { TICK_RATE, GRID_WIDTH, GRID_HEIGHT, MAX_TIER, PLOTS, LICENCE_COST } from './config.js';
import * as sim from './grid.js';

/** Bump when the test's rules change: scores of another version aren't comparable. */
export const BENCH_VERSION = 1;
export const BENCH = {
    warmupTicks: 60 * TICK_RATE, // 1 minute to fill belts and buffers
    scoreTicks: 5 * 60 * TICK_RATE, // then 5 minutes that count
};
export const BENCH_WORLDS = ['valley', 'aftermath'];
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
 * Run the test. Never throws on bad input: returns { ok: false, error } instead.
 * @returns {{ ok: true, version: number, world: string, machines: number, perMinute: number,
 *   efficiency: number, sold: Record<string, number> } | { ok: false, error: string }}
 */
export function runBenchmark(layout) {
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
