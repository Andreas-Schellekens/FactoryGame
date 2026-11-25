// src/tutorial.js — the tutorial card and its guides: what the console's "Now" block says, where
// the map shows an example building or belt for the first production chain, and which stuck
// machine is worth explaining. Reads the live simulation (grid.js); no DOM, no Three.js. All the
// words are in story.js (TUTORIAL). main.js builds the card a few times a second while playing.
import {
    grid, RECIPES, machineRecipe, inPlot, canBuildMachine, project, currentPhase, machineStatus, sinkAccepts,
} from './grid.js';
import { GRID_WIDTH, GRID_HEIGHT, PAD_POS } from './config.js';
import { TUTORIAL, ITEM_NAMES, BUILDING_NAMES } from './story.js';

const VEC = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };
const TURNS = ['right', 'down', 'left', 'up'];
const inBounds = (x, y) => x >= 0 && y >= 0 && x < GRID_WIDTH && y < GRID_HEIGHT;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const same = (a, b) => a.x === b.x && a.y === b.y;
/** The direction from `a` toward `b`, along the longer axis. */
const toward = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'down' : 'up';
};
const step = (c, dir, n = 1) => ({ x: c.x + VEC[dir][0] * n, y: c.y + VEC[dir][1] * n });
const free = (c) => inBounds(c.x, c.y) && !grid[c.x][c.y].machine && !grid[c.x][c.y].blocked && !grid[c.x][c.y].water && inPlot(c.x, c.y);
const beltable = (c) => free(c) || (inBounds(c.x, c.y) && grid[c.x][c.y].machine?.type === 'belt');
/** A machine that makes something and sends it out of its front (so its front takes nothing in). */
const hasFront = (m) => m?.type === 'merger' || !!RECIPES[m?.type]?.some((r) => r.output);

/** All machines of a type (optionally: on an ore, with a recipe), nearest `near` (the Dispatch Pad) first. */
function machines(type, test = () => true, near = PAD_POS) {
    const out = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            if (m?.type === type && test(m, grid[x][y])) out.push({ x, y, m, dir: m.dir });
        }
    }
    return out.sort((a, b) => dist2(a, near) - dist2(b, near));
}

/** The free ore cells of `ore` inside the plot, nearest the Dispatch Pad first. */
function oreCells(ore) {
    const out = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) if (grid[x][y].resource === ore && free({ x, y })) out.push({ x, y });
    }
    return out.sort((a, b) => dist2(a, PAD_POS) - dist2(b, PAD_POS));
}

/** An L-shaped run of cells from `from` to the cell next to `to`, each pointing at the next, the last into `to`. */
function tryRoute(from, to, firstAxis) {
    const cells = [];
    let c = { ...from };
    for (let guard = 0; guard < 60; guard++) {
        const dx = to.x - c.x;
        const dy = to.y - c.y;
        if (Math.abs(dx) + Math.abs(dy) <= 1) {
            cells.push({ ...c, dir: toward(c, to) });
            return cells;
        }
        const alongX = firstAxis === 'x' ? dx !== 0 && !(Math.abs(dx) === 1 && dy !== 0) : dy === 0;
        const dir = alongX ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        cells.push({ ...c, dir });
        c = step(c, dir);
        if (!inBounds(c.x, c.y)) return null;
    }
    return null;
}
/** A belt route from `from` into `to` over free cells (or belts), avoiding `avoid`; null when neither L fits. */
function routeInto(from, to, avoid = []) {
    const ok = (cells) => cells && cells.every((c) => beltable(c) && !avoid.some((a) => same(a, c)));
    for (const axis of ['x', 'y']) {
        const r = tryRoute(from, to, axis);
        if (ok(r)) return r;
    }
    return null;
}

/**
 * Where a Smelter should go after an Extractor (`ext`: { x, y, dir }, built or not): a cell its
 * ore can be belted to (never into the Smelter's front), whose front has room to belt on to the
 * Dispatch Pad, all inside the plot. First choice: two to four tiles straight out, facing the same
 * way, the layout the card describes; otherwise (`natural` false) the nearest spot that works.
 */
function smelterPlan(ext, natural = false) {
    const f = step(ext, ext.dir);
    if (!inBounds(f.x, f.y)) return null;
    const check = (s) => {
        if (!free(s) || same(s, ext) || !canBuildMachine(s.x, s.y, 'smelter')) return null;
        const front = step(s, s.dir);
        if (same(front, ext)) return null; // it would face the Extractor
        const feed = same(f, s) ? [] : routeInto(f, s, [front, ext]);
        if (!feed) return null;
        const out = same(front, PAD_POS) ? [] : routeInto(front, PAD_POS, [ext, s, ...feed]);
        if (!out) return null;
        return { s, cost: feed.length + out.length };
    };
    for (const n of [3, 4, 2]) {
        const r = check({ ...step(ext, ext.dir, n), dir: ext.dir });
        if (r) return { ...r.s, type: 'smelter' };
    }
    if (natural) return null;
    let best = null;
    for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
            for (const dir of TURNS) {
                const r = check({ x: ext.x + dx, y: ext.y + dy, dir });
                if (r && (!best || r.cost < best.cost)) best = r;
            }
        }
    }
    return best && { ...best.s, type: 'smelter' };
}

/** Where to put an Extractor on `ore`: near the pad, facing open ground with room for a Smelter after it. */
function extractorPlan(ore) {
    const cells = oreCells(ore);
    for (const c of cells.slice(0, 16)) {
        const first = toward(c, PAD_POS);
        for (const dir of [first, ...TURNS.filter((d) => d !== first)]) {
            if (smelterPlan({ ...c, dir }, true)) return { ...c, type: 'extractor', dir };
        }
    }
    return cells[0] ? { ...cells[0], type: 'extractor', dir: toward(cells[0], PAD_POS) } : null;
}

/** The middle of a route (where the camera goes), or its start. */
const middle = (path) => path[Math.floor((path.length - 1) / 2)] ?? path[0];

/** A belt from a machine's front into a target machine (never into the target's own front). */
function beltFrom(src, target) {
    if (!src || !target) return null;
    const start = step(src, src.m.dir);
    if (same(start, target)) return null; // already touching
    const avoid = [src, ...(target.m && hasFront(target.m) ? [step(target, target.m.dir)] : [])];
    const path = routeInto(start, target, avoid);
    return path && { path, focus: middle(path) };
}

// The guides only change when the machines do, so they're kept until the layout changes.
let guideKey = '';
let guideValue = null;
function layoutKey(stepId) {
    let k = `${stepId}|${project.phase}|`;
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            if (m) k += `${x},${y}${m.type[0]}${m.type[1]}${m.dir[0]}${m.recipe ?? ''};`;
        }
    }
    return k;
}

/**
 * The first chain's guides (Story, phase 1): an example building, a lit-up machine (`frames`) or
 * a belt route for the open step, built around the player's own machines.
 * @returns {{ ghosts?: object[], frames?: object[], path?: object[], focus?: object } | null}
 */
export function tutorialGuide(stepId) {
    if (project.phase !== 0) return null;
    const key = layoutKey(stepId);
    if (key === guideKey) return guideValue;
    guideKey = key;
    guideValue = buildGuide(stepId);
    return guideValue;
}

function buildGuide(stepId) {
    const ironExt = machines('extractor', (m, cell) => cell.resource === 'ironOre');
    const copperExt = machines('extractor', (m, cell) => cell.resource === 'copperOre');
    const pad = { x: PAD_POS.x, y: PAD_POS.y };
    const smeltersNear = (ext, recipe) => machines('smelter', (m) => !recipe || machineRecipe(m)?.id === recipe, ext ?? PAD_POS);
    const ghost = (g) => g && { ghosts: [g], focus: g };
    // The iron line's Smelter: the iron one nearest the iron Extractor.
    const ironSmelter = () => smeltersNear(ironExt[0], 'ironIngot')[0] ?? null;
    // The copper line's Smelter: a copper one, or (before its recipe is set) the Smelter nearest
    // the copper Extractor that isn't the iron line's.
    const copperSmelter = (anyRecipe) => {
        const c = smeltersNear(copperExt[0], 'copperIngot')[0];
        if (c || !anyRecipe || !copperExt[0]) return c ?? null;
        const iron = ironSmelter();
        return smeltersNear(copperExt[0]).find((s) => !(iron && same(s, iron)) && dist2(s, copperExt[0]) <= 36) ?? null;
    };
    switch (stepId) {
        case 'extractor': return ghost(extractorPlan('ironOre'));
        case 'smelter': return ironExt[0] ? ghost(smelterPlan(ironExt[0])) : null;
        case 'ingot': {
            const s = ironSmelter() ?? smeltersNear(ironExt[0])[0];
            return s ? beltFrom(ironExt[0], s) : null;
        }
        case 'deliver': return beltFrom(ironSmelter(), pad);
        case 'copperExtractor': return ghost(extractorPlan('copperOre'));
        case 'copperRecipe': {
            if (!copperExt[0]) return null;
            const s = copperSmelter(true);
            // Built already (still on iron): light it up; the card says to pick Copper Ingot.
            if (s) return { frames: [{ x: s.x, y: s.y }], focus: s };
            return ghost(smelterPlan(copperExt[0]));
        }
        case 'copper': {
            const s = copperSmelter(false);
            return s ? beltFrom(copperExt[0], s) : null;
        }
        case 'copperDeliver': return beltFrom(copperSmelter(false), pad);
        default: return null;
    }
}

// ---- Stuck machines worth explaining ------------------------------------------------------------
const seen = new Map(); // problem key → tick first seen (a problem must last a moment to count)
const PROBLEM_DELAY = 8; // ticks (2 s)
const SLOW_DELAY = 24; // a belt that ends short (6 s: it may still be being laid)
// Most important first: the way a machine faces, then what it's set to, then what reaches it.
const RANK = ['wrongSide', 'wrongRecipe', 'wrongItem', 'facesOut', 'deadEnd'];
const ANY_PHASE = new Set(['wrongSide', 'wrongRecipe']); // never meant; the rest only while learning

/** The item a cell is trying to send out of its front right now, or null. */
function waiting(x, y) {
    const cell = grid[x][y];
    const m = cell.machine;
    if (m.type === 'belt' || m.type === 'merger') return cell.item?.type ?? null;
    if (m.type === 'extractor') return machineStatus(x, y).code === 'blocked' ? m.produces : null;
    return m.pendingOutput ?? null;
}

/**
 * The line problems on the map, worst first: something aimed into a machine's front (its output
 * side), an item at a machine set to another recipe, an item at a machine (or the Pad) that has no
 * use for it, a machine facing off the land, a belt that stops short.
 */
function lineProblem(learning) {
    let best = null;
    const offer = (p) => {
        if (!learning && !ANY_PHASE.has(p.kind)) return;
        if (!best || RANK.indexOf(p.kind) < RANK.indexOf(best.kind)) best = p;
    };
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            if (!m || !VEC[m.dir] || m.type === 'splitter' || m.type === 'sink') continue;
            if (!(m.type === 'belt' || m.type === 'extractor' || hasFront(m))) continue; // generators and labs send nothing out
            const at = { x, y };
            const t = step(at, m.dir);
            const tm = inBounds(t.x, t.y) ? grid[t.x][t.y].machine : null;
            if (tm && hasFront(tm) && same(step(t, tm.dir), at)) {
                offer({ kind: 'wrongSide', cell: t, type: tm.type, from: m.type });
                continue;
            }
            const item = waiting(x, y);
            if (!item) continue;
            if (!tm) {
                const edge = !inBounds(t.x, t.y) || !inPlot(t.x, t.y) || grid[t.x][t.y].water || grid[t.x][t.y].blocked;
                if (m.type === 'belt') offer({ kind: 'deadEnd', cell: at, type: 'belt', item, edge });
                else if (edge) offer({ kind: 'facesOut', cell: at, type: m.type });
                // A machine with open ground in front just hasn't been belted on yet: the step says where.
                continue;
            }
            if (tm.type === 'belt' || tm.type === 'splitter' || tm.type === 'merger') continue;
            const wrongItem = { kind: 'wrongItem', cell: at, type: m.type, target: tm.type, item };
            if (tm.type === 'sink') {
                if (!sinkAccepts(item)) offer(wrongItem);
                continue;
            }
            if (tm.type === 'generator') {
                if (item !== 'coalOre') offer(wrongItem);
                continue;
            }
            const recipes = RECIPES[tm.type];
            const now = recipes && machineRecipe(tm);
            if (now && item in now.inputs) continue; // the right thing, just waiting for room
            const right = recipes?.find((r) => item in r.inputs);
            if (right) offer({ kind: 'wrongRecipe', cell: t, type: tm.type, item, now: now?.id ?? null, recipe: right.id });
            else offer(wrongItem);
        }
    }
    return best;
}

/**
 * While learning: a machine that has some of its ingredients but is still waiting for another (the
 * Assembler with plates and no wire). One with nothing at all yet is just not hooked up: the step
 * covers that. Comes from the alerts list, which already waits a few seconds before it counts.
 */
function missingInput(alertGroups) {
    for (const g of alertGroups) {
        if (g.kind !== 'input') continue;
        for (const c of g.cells ?? []) {
            const m = grid[c.x]?.[c.y]?.machine;
            const r = m && machineRecipe(m);
            if (r && Object.keys(r.inputs).some((k) => (m.buffer[k] || 0) > 0)) {
                return { kind: 'missingInput', cell: { x: c.x, y: c.y }, type: m.type, items: g.items ?? [] };
            }
        }
    }
    return null;
}

/** The problem to explain now, or null. Line problems in any phase (most only while learning: phases 1–2). */
export function tutorialProblem(tick, alertGroups = []) {
    const learning = project.phase <= 1;
    const p = lineProblem(learning) ?? (learning ? missingInput(alertGroups) : null);
    if (!p) {
        seen.clear();
        return null;
    }
    const key = `${p.kind}:${p.cell.x},${p.cell.y}`;
    if (!seen.has(key)) {
        seen.clear();
        seen.set(key, tick);
    }
    return tick - seen.get(key) >= (p.kind === 'deadEnd' ? SLOW_DELAY : PROBLEM_DELAY) ? p : null;
}

// ---- The card ------------------------------------------------------------------------------------
const name = (type) => (type === 'sink' ? 'Dispatch Pad' : BUILDING_NAMES[type] ?? type);
const item = (type) => ITEM_NAMES[type] ?? type;

/** The card's text for a problem, and which HUD element to light up. */
function problemText(p) {
    const P = TUTORIAL.problems;
    const recipeName = (id) => item(RECIPES[p.type]?.find((r) => r.id === id)?.output) ?? id;
    switch (p.kind) {
        case 'wrongRecipe': return { how: P.wrongRecipe(name(p.type), p.now ? recipeName(p.now) : null, item(p.item), recipeName(p.recipe)), ui: `recipe:${p.recipe}` };
        case 'wrongSide': return { how: P.wrongSide(name(p.type), p.from === 'belt' ? 'belt' : name(p.from)), ui: 'turn' };
        case 'wrongItem': return {
            how: P.wrongItem(p.type === 'belt' ? null : name(p.type), item(p.item), name(p.target), p.target === 'sink' && p.item.endsWith('Ore')),
            ui: p.type === 'belt' ? null : 'turn',
        };
        case 'facesOut': return { how: P.facesOut(name(p.type)), ui: 'turn' };
        case 'deadEnd': return { how: P.deadEnd(item(p.item), p.edge), ui: null };
        default: return { how: P.missingInput(name(p.type), p.items.map(item)), ui: null };
    }
}

/**
 * What the console's "Now" block shows: a stuck machine (with a Show me), the open step of the
 * flight plan (step n of m, how to do it, the buildings involved), the deliveries left, or the
 * Confirm delivery prompt. Null when there is nothing to say.
 * @param {{ objectives: any[], mode: string, phaseReady: boolean, problem: any, complete: boolean }} s
 */
export function tutorialCard({ objectives = [], mode, phaseReady, problem, complete }) {
    const T = TUTORIAL;
    if (problem) {
        const { how, ui } = problemText(problem);
        return { kind: 'problem', kicker: T.problemKicker, title: T.problems.title[problem.kind], how, cell: problem.cell, ui };
    }
    if (mode === 'story' && phaseReady) {
        return { kind: 'confirm', kicker: T.confirmKicker, title: T.confirm.title, how: T.confirm.how, ui: 'confirm' };
    }
    const open = objectives.findIndex((o) => !o.done);
    if (open >= 0) {
        const o = objectives[open];
        return {
            kind: 'step', kicker: T.stepKicker(open + 1, objectives.length), title: o.text, how: o.how ?? o.hint ?? '',
            schema: o.schema ?? null, id: o.id, controls: mode === 'story' && project.phase === 0 && open < 3,
        };
    }
    if (mode === 'story' && !complete && currentPhase()) {
        return { kind: 'deliver', kicker: T.deliverKicker, title: T.deliver.title, how: T.deliver.how };
    }
    return null;
}
