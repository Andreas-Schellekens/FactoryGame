// src/epilogue.js — the company's first year, after the NIHIL HQ ending (Story only).
// Four goals, one at a time, each paid for with deliveries to the Dispatch Pad and each
// undoing a piece of what NIHIL did to the valley. Deliveries are counted from grid.js
// `stats.delivered` since the goal began, so the pad needs no epilogue logic of its own.
// The state is grid.js `project.epilogue` (saved with the project, plain data):
//   { stage (goals done), base (stats.delivered when the active goal began), startTick,
//     startSold (items delivered before the epilogue), eastRim, river (land changes made),
//     closed (the report has been shown) }
// A finished campaign that chose NIHIL HQ starts it as soon as play resumes, so a save from
// before this existed gets it on load. The valley's changes are drawn by environment.js
// (from `stage`); the sim only reads `eastRim` and `river` (grid.js applyEpilogueLand).
// Text is in story.js EPILOGUE, timing in director.js EPILOGUE_SCRIPT. No DOM.
import { project, stats, grid, isInfinite, applyEpilogueLand } from './grid.js';
import { GRID_WIDTH, GRID_HEIGHT, TICK_RATE } from './config.js';

/**
 * The goals, in order (story.js EPILOGUE.GOALS has their names). Scaled for a factory that has
 * just fired Selene; only goods the pad buys outside the campaign (config.js SINK_VALUE).
 * `land`: the change to the map once done; `clearBed`: nothing of ours may stand in the river bed.
 */
export const GOALS = [
    { id: 'camp', requires: { circuit: 60, ironPlate: 40 } },
    { id: 'compound', requires: { steel: 50, motor: 30 }, land: 'eastRim' },
    { id: 'river', requires: { explosive: 25, capacitor: 40 }, clearBed: true, land: 'river' },
    { id: 'valley', requires: { advancedCircuit: 30, copperWire: 80 } },
];

const sum = (book) => Object.values(book ?? {}).reduce((a, n) => a + n, 0);

/** Does this game get an epilogue: Story, Selene fired, and at NIHIL's headquarters? */
export const epilogueDue = () => !isInfinite() && project.complete && project.ending === 'hq';

/** The live state, or null (not due, or not started yet). */
const state = () => (epilogueDue() ? project.epilogue : null);

function start(tick) {
    project.epilogue = {
        stage: 0, base: { ...stats.delivered }, startTick: tick, startSold: sum(stats.delivered),
        eastRim: false, river: false, closed: false,
    };
}

/** Deliveries toward the active goal since it began: item → count. */
function progress(e) {
    const goal = GOALS[e.stage];
    if (!goal) return {};
    return Object.fromEntries(Object.keys(goal.requires).map((k) => [k, Math.max(0, (stats.delivered[k] ?? 0) - (e.base?.[k] ?? 0))]));
}
const isReady = (goal, got) => !!goal && Object.entries(goal.requires).every(([k, n]) => (got[k] ?? 0) >= n);

/** Our machines still standing in the old river bed. */
export function bedLeft() {
    let n = 0;
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) if (grid[x][y].river && grid[x][y].machine) n++;
    }
    return n;
}

/**
 * Called with the director's poll. Starts the epilogue once it is due (and `hold` is off: not
 * while the ending is still on screen), and finishes the active goal once its deliveries are in
 * (and its condition holds). Returns null, or { goal, stage, events } when a goal was just done;
 * `events` are sprite consumes for anything the returning river took.
 */
export function tickEpilogue(tick, { hold = false } = {}) {
    if (!epilogueDue() || hold) return null;
    if (!project.epilogue) start(tick);
    const e = project.epilogue;
    const goal = GOALS[e.stage];
    if (!isReady(goal, progress(e)) || (goal.clearBed && bedLeft() > 0)) return null;
    e.stage++;
    e.base = { ...stats.delivered };
    let events = [];
    if (goal.land) {
        e[goal.land] = true;
        events = applyEpilogueLand();
    }
    return { goal: goal.id, stage: e.stage, events };
}

/** The director's view (story.js predicates read `w.epilogue`), or null. */
export function epilogueSnapshot() {
    const e = state();
    if (!e) return null;
    const goal = GOALS[e.stage];
    return {
        stage: e.stage, total: GOALS.length, ready: isReady(goal, progress(e)),
        bedLeft: goal?.clearBed ? bedLeft() : 0, closed: !!e.closed,
    };
}

/** The HUD's view: the active goal (null once all are done) and what has come in for it. */
export function epilogueInfo() {
    const e = state();
    if (!e) return null;
    const goal = GOALS[e.stage] ?? null;
    return {
        stage: e.stage, total: GOALS.length, closed: !!e.closed,
        goal: goal && { id: goal.id, requires: goal.requires, clearBed: !!goal.clearBed },
        got: progress(e), bedLeft: goal?.clearBed ? bedLeft() : 0,
    };
}

/** Every goal done and its last lines said? Then the report can be shown. */
export const epilogueFinished = () => !!state() && state().stage >= GOALS.length;

/** The report has been shown: the flight plan clears and the sandbox goes on. */
export function closeEpilogue() {
    if (project.epilogue) project.epilogue.closed = true;
}

/** The closing report's figures. */
export function epilogueStats(tick) {
    const e = project.epilogue;
    return {
        seconds: e ? Math.max(0, tick - e.startTick) / TICK_RATE : 0,
        sold: e ? Math.max(0, sum(stats.delivered) - e.startSold) : 0,
    };
}
