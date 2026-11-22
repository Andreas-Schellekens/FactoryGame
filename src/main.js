// src/main.js — wires everything together: builds the 3D renderer, UI and
// story director, starts the loop, and translates input (pointer, keys,
// wheel) into grid edits and camera moves. Owns transient UI state, order
// policy, persistence and the campaign flow (title screen → play → ending).
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './style.css';
import {
    GRID_WIDTH, GRID_HEIGHT, TICK_RATE,
    ORDER_TARGET, ORDER_TICKS, ORDER_REWARD, ORDER_GRACE_TICKS,
} from './config.js';
import {
    grid, score, tickCount, order, power, research, project, stats, unlockTech, startOrder,
    initGrid, buildMachine, removeMachine, upgradeMachine, placeBelt, dirBetween,
    serialize, loadState, isBuildingUnlocked,
} from './grid.js';
import { unlockPhaseOf } from './campaign.js';
import { BUILDING_NAMES } from './story.js';
import { createRenderer } from './renderer.js';
import { startGameLoop } from './gameLoop.js';
import { createUI } from './ui.js';
import { createDirector } from './director.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- 3D view (loads the Kenney models first; the loader shows progress) ---
initGrid();
const view = document.getElementById('view');
const loadingEl = document.getElementById('loading');
let renderer;
try {
    renderer = await createRenderer(view, {
        onProgress: (done, total) => {
            if (loadingEl) loadingEl.textContent = `Unpacking NILE equipment… ${Math.round((done / total) * 100)}%`;
        },
    });
} catch (err) {
    // Don't leave the player staring at a frozen loading line.
    if (loadingEl) loadingEl.textContent = 'Could not load the 3D assets. Check your connection and reload the page.';
    throw err;
}
loadingEl?.remove();
const canvas = renderer.canvas;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// --- Shared UI/input state (kept out of the simulation) ---
const buildableTools = new Set(['belt', 'splitter', 'merger', 'extractor', 'smelter', 'assembler', 'generator', 'lab']);
const rotations = ['right', 'down', 'left', 'up'];
const nextDir = (dir) => rotations[(rotations.indexOf(dir) + 1) % rotations.length] ?? 'right';

const state = {
    tool: 'belt',
    dir: 'right',
    paused: true,   // until the title screen is dismissed
    started: false, // a campaign is running (gates autosave + the director)
    speed: 1,
    hovered: { x: -1, y: -1 },
    lastBuildPulseMs: 0,
    drag: null, // { last: Pos|null, mode: 'lay'|'erase' } while a drag is active
    focus: null, // what the active objective points at ('ironOre', 'sink'…), ringed in 3D
};

// --- World snapshot for the story director (and objectives) ---
function snapshot() {
    const built = Object.fromEntries([...buildableTools].map((t) => [t, 0]));
    const extractorOn = { ironOre: 0, copperOre: 0, coalOre: 0 };
    let fueledGenerators = 0;
    let upgraded = 0;
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const { machine: m, resource } = grid[x][y];
            if (!m || m.type === 'sink') continue;
            built[m.type] = (built[m.type] || 0) + 1;
            if (m.type === 'extractor' && resource) extractorOn[resource]++;
            if (m.type === 'generator' && m.fuelTicks > 0) fueledGenerators++;
            if (m.tier > 1) upgraded++;
        }
    }
    return {
        tick: tickCount,
        phase: project.phase,
        complete: project.complete,
        money: score,
        throttle: power.throttle,
        delivered: project.delivered,
        produced: stats.produced,
        deliveredTotal: stats.delivered,
        researchEarned: stats.researchEarned,
        tech: { ...research.unlocked },
        techCount: Object.values(research.unlocked).filter(Boolean).length,
        built,
        extractorOn,
        fueledGenerators,
        upgraded,
        order: { status: order.status, startTick: order.startTick },
    };
}

// --- Persistence (localStorage I/O is orchestration, not simulation) ---
const SAVE_KEY = 'lifeline.save.v2'; // pre-rename key, kept so existing saves still load
const hasSave = () => {
    try {
        return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
        return false;
    }
};

function saveGame() {
    if (!state.started) return false;
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ ...serialize(), story: director.save(), visual: renderer.saveVisual() }));
        return true;
    } catch {
        return false;
    }
}

function loadGame() {
    let data;
    try {
        data = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    } catch {
        return false;
    }
    const events = loadState(data);
    if (!events) return false; // missing / wrong version
    renderer.reset();
    renderer.loadVisual(data.visual); // concrete scars from earlier builds
    renderer.applyEvents(events, 0); // recreate in-transit sprites at rest
    state.drag = null;
    state.hovered = { x: -1, y: -1 };
    nextOrderTick = null; // let the restored order resume cleanly
    director.load(data.story, tickCount);
    state.started = true;
    return true;
}

// --- Tools (locked buildings can't be selected) ---
function selectTool(tool) {
    if (buildableTools.has(tool) && !isBuildingUnlocked(tool)) {
        ui.toast(`${BUILDING_NAMES[tool]} unlocks after Phase ${unlockPhaseOf(tool) + 1}`);
        return;
    }
    state.tool = tool;
}

// --- Story director ---
const director = createDirector({
    // Late-bound: the UI is created below.
    say: (line) => ui.say(line),
    banner: (i) => ui.showBanner(i),
    isBusy: () => ui.isBusy(),
    ending: () => {
        saveGame();
        let machines = 0;
        for (const col of grid) for (const c of col) if (c.machine && c.machine.type !== 'sink') machines++;
        ui.showEnding({
            stats: {
                seconds: tickCount / TICK_RATE,
                delivered: Object.values(stats.delivered).reduce((a, b) => a + b, 0),
                machines,
            },
            onContinue: () => {},
            onNewGame: () => {
                try {
                    localStorage.removeItem(SAVE_KEY);
                } catch { /* ignore */ }
                location.reload();
            },
        });
    },
});

// --- HUD ---
const ui = createUI({
    root: document.getElementById('hud'),
    onToolChange: selectTool,
    onRotate: () => (state.dir = nextDir(state.dir)),
    onTogglePause: () => (state.paused = !state.paused),
    onSpeedChange: (delta) => (state.speed = clamp(state.speed + delta * 0.25, 0.25, 4)),
    onSave: saveGame,
    onLoad: loadGame,
    onUnlock: (id) => unlockTech(id),
    getState: () => {
        const onGrid = state.hovered.x >= 0;
        return {
            money: score,
            tool: state.tool,
            dir: state.dir,
            speed: state.speed,
            paused: state.paused,
            hoverX: state.hovered.x,
            hoverY: state.hovered.y,
            hovered: onGrid ? grid[state.hovered.x][state.hovered.y] : null,
            hoverScreen: onGrid && !state.drag ? renderer.projectCell(state.hovered.x, state.hovered.y) : null,
            order: { ...order, remaining: Math.max(0, order.deadlineTick - tickCount) },
            power: { ...power },
            research: { points: research.points, unlocked: { ...research.unlocked } },
            project: { phase: project.phase, delivered: { ...project.delivered }, complete: project.complete },
            unlocked: Object.fromEntries([...buildableTools].map((t) => [t, isBuildingUnlocked(t)])),
            objectives: director.objectives(),
        };
    },
});

// --- Orders (generation/cadence is policy, so it lives here) ---
// Priority Requests start once the Assembler is unlocked (phase 1 done).
const randInt = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));
const issueOrder = () =>
    startOrder({ target: randInt(ORDER_TARGET), ticks: randInt(ORDER_TICKS), reward: randInt(ORDER_REWARD) });

let nextOrderTick = null; // tickCount at which to issue the next order, or null
function tickOrders() {
    if (project.phase < 1) return;
    if (order.status === 'none' && nextOrderTick === null) nextOrderTick = tickCount + ORDER_GRACE_TICKS * 4;
    if (!order.active && order.status !== 'none' && nextOrderTick === null) {
        nextOrderTick = tickCount + ORDER_GRACE_TICKS; // grace pause after a result
    }
    if (nextOrderTick !== null && tickCount >= nextOrderTick) {
        nextOrderTick = null;
        issueOrder();
    }
}

// --- Campaign flow: director polling + autosave ---
const DIRECTOR_EVERY_MS = 200;
const AUTOSAVE_EVERY_MS = 60_000;
let directorClock = 0;
let autosaveClock = 0;
let lastPhase = project.phase;

function onFrame(dt) {
    if (state.started) {
        tickOrders();
        directorClock += dt;
        if (directorClock >= DIRECTOR_EVERY_MS) {
            directorClock = 0;
            director.update(snapshot());
            state.focus = director.objectives().find((o) => !o.done)?.focus ?? null;
        }
        autosaveClock += dt;
        if (autosaveClock >= AUTOSAVE_EVERY_MS || project.phase !== lastPhase) {
            autosaveClock = 0;
            lastPhase = project.phase;
            saveGame();
        }
    }
    panWithKeys(dt);
    ui.update();
}
startGameLoop(renderer, state, onFrame);
window.addEventListener('beforeunload', saveGame);

ui.showTitle({
    hasSave: hasSave(),
    onNew: () => {
        state.started = true;
        state.paused = false;
        lastPhase = project.phase;
    },
    onResume: () => {
        if (!loadGame()) {
            ui.toast('Saved contract could not be read; starting fresh');
            state.started = true;
        }
        lastPhase = project.phase;
        state.paused = false;
        if (director.ended()) ui.toast('Protocol: Selene is complete. Sandbox mode');
    },
});

// --- Input: build tools ---
function actAt(gx, gy, button) {
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return;

    if (button === 2 || state.tool === 'erase') {
        renderer.applyEvents(removeMachine(gx, gy), 0);
        return;
    }
    if (state.tool === 'upgrade') {
        if (upgradeMachine(gx, gy)) state.lastBuildPulseMs = 120;
        return;
    }
    if (buildableTools.has(state.tool)) {
        if (buildMachine(gx, gy, state.tool, state.dir)) state.lastBuildPulseMs = 120;
    }
}

// --- Input: keyboard (tools, rotation, sim speed, camera) ---
const keyTools = { 1: 'belt', 2: 'extractor', 3: 'smelter', 4: 'assembler', 5: 'upgrade', 6: 'erase', 7: 'splitter', 8: 'merger', 9: 'generator', 0: 'lab' };
const PAN_KEYS = {
    w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1],
    a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
};
const held = new Set();
const PAN_SPEED = 0.014; // world units per ms at zoom 1

window.addEventListener('keydown', (e) => {
    if (!state.started || e.target.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k in PAN_KEYS) {
        held.add(k);
        e.preventDefault();
        return;
    }
    if (e.key in keyTools) selectTool(keyTools[e.key]);
    if (k === 'r') state.dir = nextDir(state.dir);
    if (k === 'q') renderer.rig.rotate(-1);
    if (k === 'e') renderer.rig.rotate(1);
    if (e.key === ' ') {
        e.preventDefault();
        state.paused = !state.paused;
    }
    if (e.key === '+' || e.key === '=') state.speed = clamp(state.speed + 0.25, 0.25, 4);
    if (e.key === '-' || e.key === '_') state.speed = clamp(state.speed - 0.25, 0.25, 4);
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

function panWithKeys(dt) {
    if (!held.size) return;
    let rx = 0;
    let uy = 0;
    for (const k of held) {
        rx += PAN_KEYS[k][0];
        uy += PAN_KEYS[k][1];
    }
    const step = (PAN_SPEED * dt) / renderer.rig.zoom;
    renderer.rig.panBy(rx * step, uy * step);
}

// --- Input: pointer (build/erase drags, middle-drag pan, wheel zoom) ---
// Orthogonal unit cells from `last` (exclusive) to `curr` (inclusive). Colinear
// runs fill every intermediate cell; diagonal / off-axis jumps yield nothing.
function stepsBetween(last, curr) {
    const cells = [];
    const dx = curr.x - last.x;
    const dy = curr.y - last.y;
    if (dx !== 0 && dy !== 0) return cells; // diagonal jump → ignore
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    let x = last.x;
    let y = last.y;
    while (x !== curr.x || y !== curr.y) {
        x += sx;
        y += sy;
        cells.push({ x, y });
    }
    return cells;
}

function dragStep(cell) {
    const drag = state.drag;
    if (drag.mode === 'lay') {
        const dir = drag.last ? dirBetween(drag.last, cell) : state.dir;
        if (drag.last) placeBelt(drag.last.x, drag.last.y, dir); // re-point the cell we leave
        if (placeBelt(cell.x, cell.y, dir) === 'built') state.lastBuildPulseMs = 120;
    } else {
        renderer.applyEvents(removeMachine(cell.x, cell.y), 0);
    }
    drag.last = cell;
}

function dragTo(curr) {
    const drag = state.drag;
    if (!drag) return;
    if (!drag.last) {
        dragStep(curr); // first cell of the drag
        return;
    }
    // In the isometric view a fast diagonal mouse move can skip a corner;
    // walk it as an L (x first, then y) so belts stay connected.
    if (curr.x !== drag.last.x && curr.y !== drag.last.y) {
        const elbow = { x: curr.x, y: drag.last.y };
        for (const cell of stepsBetween(drag.last, elbow)) dragStep(cell);
    }
    for (const cell of stepsBetween(drag.last, curr)) dragStep(cell);
}

let panDrag = null; // { x, y } last pointer position while middle-dragging

canvas.addEventListener('pointermove', (e) => {
    if (panDrag) {
        renderer.rig.panPixels(e.clientX - panDrag.x, e.clientY - panDrag.y, canvas.clientHeight);
        panDrag = { x: e.clientX, y: e.clientY };
    }
    const cell = renderer.pickCell(e.clientX, e.clientY);
    state.hovered = cell ?? { x: -1, y: -1 };
    if (state.drag && cell) dragTo(cell);
});

canvas.addEventListener('pointerleave', () => (state.hovered = { x: -1, y: -1 }));

canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) {
        e.preventDefault();
        panDrag = { x: e.clientX, y: e.clientY };
        return;
    }
    if (!state.started) return;
    const cell = renderer.pickCell(e.clientX, e.clientY);
    if (!cell) return;

    if (e.button === 2 || state.tool === 'erase') {
        state.drag = { last: null, mode: 'erase' };
        dragTo(cell);
        return;
    }
    if (e.button !== 0) return;
    if (state.tool === 'belt') {
        state.drag = { last: null, mode: 'lay' };
        dragTo(cell);
        return;
    }
    actAt(cell.x, cell.y, e.button);
});

const endDrag = (e) => {
    state.drag = null;
    panDrag = null;
    if (e?.pointerId != null && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    renderer.rig.zoomBy(Math.exp(-e.deltaY * 0.0012));
}, { passive: false });

// Dev-only debug hooks so tests/tools can observe and drive the live
// simulation (the same module instances the game uses). Stripped from
// production builds.
if (import.meta.env.DEV) {
    window.__grid = grid;
    window.__sim = await import('./grid.js');
    window.__campaign = await import('./campaign.js');
    window.__renderer = renderer;
}
