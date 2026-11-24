// scripts/challenge-cases.mjs — a small factory builder for the weekly challenge's tests: given
// a week's key, it lays a working (not clever) factory for that week's target on that week's
// map, within its rules, so the challenge's test (src/benchmark.js runChallenge) has a real
// layout to score. Used by scripts/test-bench.mjs (Node, and through the JSON it writes the
// API's QuickJS check) and by verify-challenge.mjs (it builds this in the browser).
//
// How it builds: the target's maker goes next to the Dispatch Pad, facing it. Each input is
// either "linear" (an ore, maybe smelted, maybe pressed: an extractor with its processors in
// a straight line from the ore) and belted in along the shortest free path, or made by a
// machine with several inputs, which goes right next to its consumer, facing it, and is fed
// the same way. Belts avoid ore cells while they can.
import * as sim from '../src/grid.js';
import { challengeFor } from '../src/challenge.js';
import { GRID_WIDTH, GRID_HEIGHT, PAD_POS } from '../src/config.js';
import { layoutOf } from '../src/benchmark.js';

const STEP = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };
const DIR_NAMES = Object.keys(STEP);
const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };
const ORES = new Set(['ironOre', 'copperOre', 'coalOre', 'sulfurOre']);

// What makes each item: { type, recipe, inputs } from grid.js's RECIPES.
const MAKER = {};
for (const [type, list] of Object.entries(sim.RECIPES)) {
    for (const r of list) if (r.output && !MAKER[r.output]) MAKER[r.output] = { type, recipe: r.id, inputs: Object.keys(r.inputs) };
}

/** An item's straight chain down to its ore ([{ type, recipe }…], extractor first), or null if it needs more than one input. */
function linearChain(item) {
    if (ORES.has(item)) return { ore: item, steps: [] };
    const m = MAKER[item];
    if (!m || m.inputs.length !== 1) return null;
    const below = linearChain(m.inputs[0]);
    return below && { ore: below.ore, steps: [...below.steps, { type: m.type, recipe: m.recipe }] };
}

const inGrid = (x, y) => x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
function free(x, y, { ore = false } = {}) {
    if (!inGrid(x, y)) return false;
    const c = sim.grid[x][y];
    return !c.machine && !c.blocked && !c.water && sim.inPlot(x, y) && (ore || !c.resource);
}

/** Shortest belt path from `start` to a cell next to `to` on one of `sides`, or null. */
function route(start, to, sides, opts) {
    const goal = new Map();
    for (const side of sides) {
        const [dx, dy] = STEP[side];
        goal.set(`${to.x + dx},${to.y + dy}`, OPPOSITE[side]); // the belt there points back into `to`
    }
    if (!free(start.x, start.y, opts)) return null;
    const prev = new Map([[`${start.x},${start.y}`, null]]);
    const queue = [start];
    while (queue.length) {
        const c = queue.shift();
        const k = `${c.x},${c.y}`;
        if (goal.has(k)) {
            const path = [];
            for (let p = k; p; p = prev.get(p)) path.unshift(p.split(',').map(Number));
            return path.map(([x, y], i) => {
                const next = path[i + 1];
                const dir = next ? DIR_NAMES.find((d) => x + STEP[d][0] === next[0] && y + STEP[d][1] === next[1]) : goal.get(`${x},${y}`);
                return { x, y, dir };
            });
        }
        for (const d of DIR_NAMES) {
            const nx = c.x + STEP[d][0];
            const ny = c.y + STEP[d][1];
            const nk = `${nx},${ny}`;
            if (prev.has(nk) || !free(nx, ny, opts)) continue;
            prev.set(nk, k);
            queue.push({ x: nx, y: ny });
        }
    }
    return null;
}

/** The input sides of a placed processor (all but its output). */
const inputSides = (m) => DIR_NAMES.filter((d) => d !== m.dir);

function build(x, y, type, dir, recipe = null) {
    if (!sim.buildMachine(x, y, type, dir, recipe)) throw new Error(`can't build ${type} at ${x},${y}`);
}

/** Bring `item` into the machine at `to` (facing `to.dir`). */
function feed(to, item) {
    const sides = inputSides(to).filter((d) => {
        const [dx, dy] = STEP[d];
        return free(to.x + dx, to.y + dy, { ore: true });
    });
    if (!sides.length) throw new Error(`no free side on ${to.x},${to.y} for ${item}`);
    const chain = linearChain(item);
    if (!chain) {
        // A machine with several inputs: right next to its consumer, facing it.
        const m = MAKER[item];
        for (const side of sides) {
            const [dx, dy] = STEP[side];
            const at = { x: to.x + dx, y: to.y + dy, dir: OPPOSITE[side] };
            if (!free(at.x, at.y)) continue;
            build(at.x, at.y, m.type, at.dir, m.recipe);
            for (const input of new Set(m.inputs)) feed(at, input);
            return;
        }
        throw new Error(`no room for a ${m.type} next to ${to.x},${to.y}`);
    }
    // A straight chain: the extractor on an ore cell, its processors in a line, then belts.
    let best = null;
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            if (sim.grid[x][y].resource !== chain.ore || !free(x, y, { ore: true })) continue;
            for (const d of DIR_NAMES) {
                const [dx, dy] = STEP[d];
                let ok = true;
                for (let i = 1; i <= chain.steps.length && ok; i++) ok = free(x + dx * i, y + dy * i, { ore: true });
                if (!ok) continue;
                const out = { x: x + dx * (chain.steps.length + 1), y: y + dy * (chain.steps.length + 1) };
                const direct = out.x === to.x && out.y === to.y && sides.includes(OPPOSITE[d]);
                const path = direct ? [] : route(out, to, sides, {}) ?? route(out, to, sides, { ore: true });
                if (path && (!best || path.length < best.path.length)) best = { x, y, d, path };
            }
        }
    }
    if (!best) throw new Error(`no way to bring ${item} to ${to.x},${to.y}`);
    const [dx, dy] = STEP[best.d];
    build(best.x, best.y, 'extractor', best.d);
    chain.steps.forEach((s, i) => build(best.x + dx * (i + 1), best.y + dy * (i + 1), s.type, best.d, s.recipe));
    for (const b of best.path) build(b.x, b.y, 'belt', b.dir);
}

/**
 * Lay a working factory for a challenge week on the live simulation and return its layout
 * (layoutOf), or null if this simple builder can't fit one there.
 */
export function autoLayout(key) {
    const rules = challengeFor(key);
    if (!rules) return null;
    sim.newGame('challenge', { challenge: key });
    const maker = MAKER[rules.target];
    for (const side of DIR_NAMES) {
        const [dx, dy] = STEP[side];
        const at = { x: PAD_POS.x + dx, y: PAD_POS.y + dy, dir: OPPOSITE[side] };
        if (!free(at.x, at.y)) continue;
        try {
            build(at.x, at.y, maker.type, at.dir, maker.recipe);
            for (const input of new Set(maker.inputs)) feed(at, input);
            return layoutOf();
        } catch {
            sim.newGame('challenge', { challenge: key }); // try the next side of the pad
        }
    }
    return null;
}
