// src/main.js — wires everything together: builds the 3D renderer, UI and
// story director, starts the loop, and translates input (pointer, keys,
// wheel) into grid edits and camera moves. Owns transient UI state, order
// policy, persistence and the campaign flow (title screen → play → ending),
// and tells the sound engine what the player did.
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './style.css';
import {
    GRID_WIDTH, GRID_HEIGHT, TICK_RATE, SINK_VALUE, MAX_TIER, PRODUCT_REWARD,
    ORDER_TARGET, ORDER_TICKS, ORDER_REWARD, ORDER_GRACE_TICKS, ORDER_POOL,
} from './config.js';
import {
    grid, score, tickCount, order, power, research, project, stats, unlockTech, startOrder,
    initGrid, buildMachine, removeMachine, upgradeMachine, upgradeCost, placeBelt, dirBetween,
    serialize, loadState, isBuildingUnlocked, machineCost, machinePorts, machineIO,
    RECIPES, recipeUnlocked, setRecipe, setMachineOn, resetBreaker, machineStatus, machineRates,
    salePrice, flow, UPGRADABLE, SAVE_VERSION, machinesIn, planGroup, applyGroup, removeGroup, setEnding, setCompany,
} from './grid.js';
import { unlockPhaseOf, PHASES } from './campaign.js';
import { BUILDING_NAMES, ITEM_NAMES } from './story.js';
import { createRenderer } from './renderer.js';
import { startGameLoop } from './gameLoop.js';
import { createUI } from './ui.js';
import { createDirector } from './director.js';
import { createAudio, BUILD_SIZE } from './audio.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- Sound (the context starts on the first click or key press) ---
const audio = createAudio();
const unlockAudio = () => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockAudio, true);
    window.removeEventListener('keydown', unlockAudio, true);
};
window.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);

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
const buildableTools = new Set(['belt', 'splitter', 'merger', 'extractor', 'smelter', 'press', 'foundry', 'assembler', 'fabricator', 'mixer', 'generator', 'lab']);
// Machines whose cell opens a panel when clicked (conveyors are laid over instead).
const NO_PANEL = new Set(['belt', 'splitter', 'merger']);
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
    cinematic: false, // the ending is playing: no input, no 3D overlay
    selected: null, // { x, y } of the machine whose panel is open
    selDrag: null, // { from, to } while a selection box is being dragged (select tool)
    sel: null, // { cells: Pos[] } the selected machines
    group: null, // { mode: 'move'|'copy', cells, anchor, rot, plan } while a selection is carried
};
// The recipe last picked per machine type: new machines of that type start on it.
const lastRecipe = {};

// --- World snapshot for the story director (and objectives) ---
function snapshot() {
    const built = Object.fromEntries([...buildableTools].map((t) => [t, 0]));
    const extractorOn = { ironOre: 0, copperOre: 0, coalOre: 0, sulfurOre: 0 };
    let fueledGenerators = 0;
    let upgraded = 0;
    let working = 0;
    const recipes = {};
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const { machine: m, resource } = grid[x][y];
            if (!m || m.type === 'sink') continue;
            built[m.type] = (built[m.type] || 0) + 1;
            if (m.recipe) recipes[`${m.type}:${m.recipe}`] = (recipes[`${m.type}:${m.recipe}`] || 0) + 1;
            if (m.type === 'extractor' && resource) extractorOn[resource]++;
            if (m.type === 'generator' && m.fuelTicks > 0) fueledGenerators++;
            if (m.tier > 1) upgraded++;
            if (m.progress > 0 || m.fuelTicks > 0) working++;
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
        working,
        recipes,
        tripped: power.tripped,
        phaseProgress: (() => {
            const req = Object.entries(PHASES[project.phase]?.requires ?? {});
            const need = req.reduce((a, [, n]) => a + n, 0);
            return need ? req.reduce((a, [k, n]) => a + Math.min(n, project.delivered[k] ?? 0), 0) / need : 1;
        })(),
        ending: project.ending,
        minPrice: Math.min(1, ...Object.keys(SINK_VALUE).map((k) => salePrice(k) / SINK_VALUE[k])),
        order: { status: order.status, startTick: order.startTick },
    };
}

// --- The machine panel's data (the HUD renders it; actions come back through callbacks) ---
function selectedInfo() {
    const sel = state.selected;
    const m = sel ? grid[sel.x]?.[sel.y]?.machine : null;
    if (!m) return null;
    const { x, y } = sel;
    if (m.type === 'sink') {
        const items = Object.keys(SINK_VALUE);
        return { x, y, type: 'sink', sig: `sink@${x},${y}`, market: items.map((item) => ({ item, price: salePrice(item), base: SINK_VALUE[item] })) };
    }
    const recipes = RECIPES[m.type]?.map((r) => ({ ...r, unlocked: recipeUnlocked(r), active: m.recipe === r.id }));
    const rates = machineRates(x, y);
    const cost = upgradeCost(x, y);
    let upgrade = null;
    if (cost != null && rates?.next) {
        const [item, now] = Object.entries(rates.outPerMin)[0] ?? [];
        const next = item ? rates.next.outPerMin[item] : null;
        const fmt = (n) => (n >= 10 ? Math.round(n) : n.toFixed(1));
        upgrade = { cost, gain: item ? `${fmt(now)} → ${fmt(next)}/min` : rates.points ? `${fmt(rates.points)} → ${fmt(rates.next.points)} pts/min` : '' };
    }
    const tierCap = UPGRADABLE.has(m.type) && cost == null ? (m.tier >= MAX_TIER ? 'Top tier' : 'Tier 4 needs the Tier 4 research') : null;
    return {
        x, y, type: m.type,
        tier: UPGRADABLE.has(m.type) ? m.tier : null,
        off: !!m.off,
        status: machineStatus(x, y),
        rates,
        throttle: power.throttle,
        recipes,
        buffer: m.buffer,
        upgrade,
        tierCap,
        canToggle: true,
        sig: [m.type, x, y, m.tier, m.recipe, !!m.off, recipes?.map((r) => (r.unlocked ? 1 : 0)).join(''), cost].join('|'),
    };
}
function selectMachine(x, y) {
    const same = state.selected && state.selected.x === x && state.selected.y === y;
    state.selected = same ? null : { x, y };
    audio.cue(same ? 'close' : 'open');
}
function deselect() {
    state.selected = null;
}

// --- Production overview: per-minute rates over the last minute of sim time ---
const flowSamples = [];
let production = null;
const ITEM_ORDER = Object.keys(ITEM_NAMES);
function sampleFlow() {
    const last = flowSamples[flowSamples.length - 1];
    if (!last || tickCount > last.tick) flowSamples.push({ tick: tickCount, made: { ...flow.made }, used: { ...flow.used }, sold: { ...flow.sold } });
    while (flowSamples.length > 2 && tickCount - flowSamples[1].tick >= 60 * TICK_RATE) flowSamples.shift();
    const a = flowSamples[0];
    const dt = tickCount - a.tick;
    const counts = {};
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            if (!m || NO_PANEL.has(m.type) || m.type === 'sink') continue;
            const code = machineStatus(x, y).code;
            counts[code] = (counts[code] || 0) + 1;
        }
    }
    if (dt < 8) {
        production = null;
        return;
    }
    const per = (60 * TICK_RATE) / dt;
    const rate = (book, before, item) => Math.round(((book[item] ?? 0) - (before[item] ?? 0)) * per * 10) / 10;
    const items = new Set([...Object.keys(flow.made), ...Object.keys(flow.used), ...Object.keys(flow.sold)]);
    const rows = [...items]
        .map((item) => ({ item, made: rate(flow.made, a.made, item), used: rate(flow.used, a.used, item), sold: rate(flow.sold, a.sold, item) }))
        .filter((r) => r.made + r.used + r.sold > 0)
        .sort((p, q) => ITEM_ORDER.indexOf(p.item) - ITEM_ORDER.indexOf(q.item));
    production = { rows, counts };
}

// --- Persistence (localStorage I/O is orchestration, not simulation) ---
const SAVE_KEY = 'lifeline.save.v2'; // pre-rename key, kept so existing saves still load
const hasSave = () => {
    try {
        return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null')?.version === SAVE_VERSION;
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
    state.selected = null;
    flowSamples.length = 0;
    nextOrderTick = null; // let the restored order resume cleanly
    director.load(data.story, tickCount, project.phase, project.ending);
    state.started = true;
    return true;
}

// --- Small actions shared by keys and HUD buttons ---
function rotateDir() {
    state.dir = nextDir(state.dir);
    audio.cue('rotate');
}
function togglePause() {
    state.paused = !state.paused;
    audio.cue(state.paused ? 'pause' : 'resume');
}
function changeSpeed(delta) {
    const next = clamp(state.speed + delta * 0.25, 0.25, 4);
    if (next !== state.speed) audio.cue('speed', { speed: next });
    state.speed = next;
}

// --- Tools (locked buildings can't be selected) ---
function selectTool(tool) {
    if (buildableTools.has(tool) && !isBuildingUnlocked(tool)) {
        ui.toast(`${BUILDING_NAMES[tool]} arrives in Phase ${unlockPhaseOf(tool) + 2}`);
        audio.cue('deny');
        return;
    }
    if (tool !== state.tool) audio.cue('key');
    if (tool !== 'select') {
        state.sel = null;
        state.group = null;
    }
    state.tool = tool;
}

// --- Selections: drag a box (select tool), then move / copy / demolish the lot ---
function finishSelection() {
    const d = state.selDrag;
    state.selDrag = null;
    const cells = machinesIn(d.from.x, d.from.y, d.to.x, d.to.y);
    state.sel = cells.length ? { cells } : null;
    audio.cue(cells.length ? 'open' : 'click');
}
function clearSelection() {
    state.sel = null;
    state.group = null;
    audio.cue('close');
}
/** Pick the selection up: it follows the cursor, anchored on the machine nearest its middle. */
function startGroup(mode) {
    const cells = state.sel.cells;
    const mid = (vals) => (Math.min(...vals) + Math.max(...vals)) / 2;
    const cx = mid(cells.map((c) => c.x));
    const cy = mid(cells.map((c) => c.y));
    const anchor = cells.reduce((a, c) => (Math.hypot(c.x - cx, c.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? c : a));
    state.group = { mode, cells, anchor, rot: 0, plan: null };
    state.selected = null;
    audio.cue('key');
}
function cancelGroup() {
    state.group = null;
    audio.cue('close');
}
function placeGroup() {
    const g = state.group;
    const plan = g.plan;
    if (!plan?.ok) {
        audio.cue('deny');
        renderer.nudgeGhost();
        if (plan && !plan.bad.length && g.mode === 'copy') ui.toast(`This copy costs CR ${plan.cost}`);
        return;
    }
    renderer.quietNext(); // the machines slide over: no demolish/build juice for each one
    renderer.applyEvents(applyGroup(plan, g.mode), 140);
    audio.cue('build', { size: 2 });
    renderer.rig.shake(0.15);
    const at = plan.moves.find((m) => m.from.x === g.anchor.x && m.from.y === g.anchor.y)?.to ?? plan.moves[0].to;
    if (g.mode === 'copy') {
        renderer.floatAt(at.x, at.y, `−${plan.cost}`, SPEND_COLOR); // keep carrying: place another copy
        return;
    }
    state.sel = { cells: plan.moves.map((m) => m.to) };
    state.group = null;
}
function removeSelection() {
    const cells = state.sel.cells;
    const refund = cells.reduce((a, { x, y }) => a + machineCost(grid[x][y].machine?.type), 0);
    renderer.applyEvents(removeGroup(cells), 0);
    audio.cue('demolish');
    const c = cells[Math.floor(cells.length / 2)];
    if (refund) renderer.floatAt(c.x, c.y, `+${refund}`, REFUND_COLOR);
    state.sel = null;
    state.group = null;
}
/** Pipette: build what's under the cursor next, same direction, same recipe. */
function pipette() {
    const h = state.hovered;
    const m = h.x >= 0 ? grid[h.x][h.y].machine : null;
    if (!m || !buildableTools.has(m.type)) return;
    if (!isBuildingUnlocked(m.type)) return;
    selectTool(m.type);
    state.dir = m.dir;
    if (m.recipe) lastRecipe[m.type] = m.recipe;
    ui.toast(`${BUILDING_NAMES[m.type]}${m.recipe && ITEM_NAMES[m.recipe] ? ` · ${ITEM_NAMES[m.recipe]}` : ''} · picked up with F`);
}

// --- Story director ---
const director = createDirector({
    // Late-bound: the UI is created below.
    say: (line) => ui.say(line),
    banner: (i) => ui.showBanner(i),
    isBusy: () => ui.isBusy(),
    ending: () => playEnding(),
});

/** The end: choose the target (unless a save already chose), the cinematic, the report. */
function playEnding() {
    saveGame();
    state.cinematic = true;
    state.drag = null;
    state.sel = null;
    state.group = null;
    state.selected = null;
    held.clear();
    let machines = 0;
    for (const col of grid) for (const c of col) if (c.machine && c.machine.type !== 'sink') machines++;
    ui.showEnding({
        stats: {
            seconds: tickCount / TICK_RATE,
            delivered: Object.values(stats.delivered).reduce((a, b) => a + b, 0),
            machines,
        },
        decided: project.ending,
        onChoose: (kind) => {
            setEnding(kind);
            saveGame();
        },
        onFound: (name) => {
            setCompany(name);
            saveGame();
        },
        // The ending plays in the world: the HUD drives these at its timeline's beats.
        stage: {
            lookAtCannon: () => renderer.lookAtCannon(),
            start: (opts) => renderer.frameCannon(opts),
            charge: (level) => renderer.chargeCannon(level),
            fire: (opts) => renderer.fireCannon(opts),
            muzzle: () => renderer.muzzlePage(),
            end() {
                state.cinematic = false;
                renderer.releaseCinematic();
            },
        },
        onContinue: () => saveGame(),
        onNewGame: () => {
            try {
                localStorage.removeItem(SAVE_KEY);
            } catch { /* ignore */ }
            location.reload();
        },
    });
}

// --- HUD ---
const ui = createUI({
    root: document.getElementById('hud'),
    sound: audio,
    icons: renderer.icons,
    onToolChange: selectTool,
    onRotate: rotateDir,
    onTogglePause: togglePause,
    onSpeedChange: changeSpeed,
    onSave: saveGame,
    onLoad: loadGame,
    onUnlock: (id) => unlockTech(id),
    onSetRecipe: (id) => {
        const sel = state.selected;
        if (!sel || !setRecipe(sel.x, sel.y, id)) return false;
        lastRecipe[grid[sel.x][sel.y].machine.type] = id;
        audio.cue('recipe');
        return true;
    },
    onUpgradeSelected: () => {
        const sel = state.selected;
        if (!sel) return false;
        const cost = upgradeCost(sel.x, sel.y);
        if (!upgradeMachine(sel.x, sel.y)) return false;
        audio.cue('upgrade');
        if (cost) renderer.floatAt(sel.x, sel.y, `−${cost}`, SPEND_COLOR);
        return true;
    },
    onToggleSelected: () => {
        const sel = state.selected;
        const m = sel && grid[sel.x][sel.y].machine;
        if (!m || !setMachineOn(sel.x, sel.y, !!m.off)) return false;
        audio.cue(m.off ? 'pause' : 'resume');
        return true;
    },
    onDeselect: deselect,
    onGroupAction: (action) => {
        if (action === 'cancel') return state.group ? cancelGroup() : clearSelection();
        if (!state.sel) return;
        if (action === 'remove') removeSelection();
        else startGroup(action);
    },
    onResetBreaker: () => {
        if (!resetBreaker()) return false;
        audio.cue('reset');
        return true;
    },
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
            hoveredIO: onGrid && grid[state.hovered.x][state.hovered.y].machine ? machineIO(grid[state.hovered.x][state.hovered.y].machine) : null,
            hoveredPorts: onGrid ? machinePorts(state.hovered.x, state.hovered.y) : null,
            order: { ...order, remaining: Math.max(0, order.deadlineTick - tickCount) },
            power: { ...power },
            selected: selectedInfo(),
            production,
            selection: state.sel || state.group ? {
                count: (state.group?.cells ?? state.sel.cells).length,
                mode: state.group?.mode ?? null,
                cost: state.group?.plan?.cost ?? null,
                ok: state.group?.plan?.ok ?? null,
                blocked: state.group?.plan?.bad.length ?? 0,
            } : null,
            research: { points: research.points, unlocked: { ...research.unlocked } },
            project: { phase: project.phase, delivered: { ...project.delivered }, complete: project.complete, ending: project.ending, company: project.company },
            unlocked: Object.fromEntries([...buildableTools].map((t) => [t, isBuildingUnlocked(t)])),
            objectives: director.objectives(),
        };
    },
});

// --- Orders (generation/cadence is policy, so it lives here) ---
// Priority Requests start once the Assembler is unlocked (phase 1 done).
const randInt = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));
function issueOrder() {
    // A product the factory can make by now; cheap goods in bigger batches, dear ones in smaller.
    const pool = ORDER_POOL[Math.min(project.phase, ORDER_POOL.length - 1)];
    const productType = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'circuit';
    const worth = Math.sqrt((SINK_VALUE[productType] ?? PRODUCT_REWARD) / PRODUCT_REWARD);
    const target = Math.max(2, Math.round(randInt(ORDER_TARGET) / worth));
    startOrder({ productType, target, ticks: randInt(ORDER_TICKS), reward: Math.round(randInt(ORDER_REWARD) * Math.sqrt(worth)) });
}

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
let lastWorking = 0;
let flowClock = 0;

function onFrame(dt) {
    // A carried group plans where it would land under the cursor; a selection forgets demolished machines.
    if (state.group) {
        const h = state.hovered;
        const g = state.group;
        g.plan = h.x >= 0 && !state.cinematic ? planGroup(g.cells, g.anchor, h, g.rot, g.mode) : null;
    }
    if (state.sel && !state.group) {
        const cells = state.sel.cells.filter(({ x, y }) => grid[x][y].machine);
        state.sel = cells.length ? { cells } : null;
    }
    if (state.selected) {
        const m = grid[state.selected.x][state.selected.y].machine;
        if (!m || NO_PANEL.has(m.type) || state.cinematic) state.selected = null;
    }
    flowClock += dt;
    if (flowClock >= 500) {
        flowClock = 0;
        sampleFlow();
    }
    if (state.started) {
        tickOrders();
        directorClock += dt;
        if (directorClock >= DIRECTOR_EVERY_MS) {
            directorClock = 0;
            const w = snapshot();
            lastWorking = w.working;
            director.update(w);
            state.focus = director.objectives().find((o) => !o.done)?.focus ?? null;
        }
        autosaveClock += dt;
        if (autosaveClock >= AUTOSAVE_EVERY_MS || project.phase !== lastPhase) {
            autosaveClock = 0;
            lastPhase = project.phase;
            saveGame();
        }
    }
    audio.update(dt, {
        // After the NIHIL HQ ending the bright early mood comes back (once the cinematic is over).
        mood: project.complete ? (project.ending === 'hq' && !state.cinematic ? 1 : 5) : project.phase,
        playing: state.started,
        paused: state.paused && state.started,
        throttle: power.throttle,
        working: lastWorking,
        orderStatus: order.status,
        orderStart: order.startTick,
        techCount: Object.values(research.unlocked).filter(Boolean).length,
        overload: power.overload,
        tripped: power.tripped,
    });
    panWithKeys(dt);
    ui.update();
}
startGameLoop(renderer, state, onFrame, (events) => audio.onEvents(events));
window.addEventListener('beforeunload', saveGame);

ui.showTitle({
    hasSave: hasSave(),
    onNew: () => {
        state.started = true;
        state.paused = false;
        lastPhase = project.phase;
        audio.begin(0, { fresh: true });
    },
    onResume: () => {
        if (!loadGame()) {
            ui.toast('Saved contract could not be read; starting fresh');
            state.started = true;
        }
        lastPhase = project.phase;
        state.paused = false;
        audio.begin(project.complete ? (project.ending === 'hq' ? 1 : 5) : project.phase);
        // Saved after the last phase but before choosing the target: choose now.
        if (project.complete && !project.ending) playEnding();
        else if (director.ended()) ui.toast(project.ending === 'hq' ? `${project.company ?? 'Your company'} · the valley is yours` : 'Protocol: Selene is complete. Sandbox mode');
    },
});

// --- Input: build tools ---
function actAt(gx, gy, button) {
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return;

    if (button === 2 || state.tool === 'erase') {
        demolish(gx, gy);
        return;
    }
    if (state.tool === 'upgrade') {
        const cost = upgradeCost(gx, gy);
        if (upgradeMachine(gx, gy)) {
            state.lastBuildPulseMs = 120;
            audio.cue('upgrade');
            if (cost) renderer.floatAt(gx, gy, `−${cost}`, SPEND_COLOR);
        } else audio.cue('deny');
        return;
    }
    if (buildableTools.has(state.tool)) {
        if (buildMachine(gx, gy, state.tool, state.dir, lastRecipe[state.tool])) {
            state.lastBuildPulseMs = 120;
            audio.cue('build', { size: BUILD_SIZE[state.tool] ?? 1 });
            renderer.floatAt(gx, gy, `−${machineCost(state.tool)}`, SPEND_COLOR);
        } else {
            audio.cue('deny');
            renderer.nudgeGhost();
        }
    }
}

const SPEND_COLOR = '#ff9d7e';
const REFUND_COLOR = '#8ff0de';
const CONVEYOR_TOOLS = new Set(['belt', 'splitter', 'merger']);

function demolish(gx, gy) {
    const type = grid[gx][gy].machine?.type;
    renderer.applyEvents(removeMachine(gx, gy), 0);
    if (type && !grid[gx][gy].machine) {
        audio.cue('demolish');
        // Refunds show for real machines; conveyors are torn up by the dozen.
        if (!CONVEYOR_TOOLS.has(type)) renderer.floatAt(gx, gy, `+${machineCost(type)}`, REFUND_COLOR);
    }
}

// --- Input: keyboard (tools, rotation, sim speed, camera) ---
// Buildings in chain order on the number row; routers, upgrade and demolish on letters.
const keyTools = {
    1: 'belt', 2: 'extractor', 3: 'smelter', 4: 'press', 5: 'foundry', 6: 'assembler', 7: 'fabricator', 8: 'lab', 9: 'mixer', 0: 'generator',
    t: 'splitter', y: 'merger', u: 'upgrade', x: 'erase', delete: 'erase', backspace: 'erase', v: 'select',
};
const PAN_KEYS = {
    w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1],
    a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
};
const held = new Set();
const PAN_SPEED = 0.014; // world units per ms at zoom 1

window.addEventListener('keydown', (e) => {
    if (!state.started || e.target.closest?.('textarea, input:not([type="range"])')) return;
    if (state.cinematic) {
        if (e.key.toLowerCase() === 'm') ui.toast(audio.toggleMute() ? 'Sound off · M' : 'Sound on · M');
        return;
    }
    // A focused volume slider keeps its arrow keys; every other game key still works.
    if (e.target.matches?.('input[type="range"]') && e.key.startsWith('Arrow')) return;
    const k = e.key.toLowerCase();
    if (k in PAN_KEYS) {
        held.add(k);
        e.preventDefault();
        return;
    }
    // A carried group and a selection borrow some keys while they're there.
    if (state.group) {
        if (k === 'r') {
            state.group.rot = (state.group.rot + 1) % 4;
            audio.cue('rotate');
            return;
        }
        if (e.key === 'Escape') return cancelGroup();
    }
    if (state.sel && !state.group) {
        if (k === 'g') return startGroup('move');
        if (k === 'c') return startGroup('copy');
        if (k === 'x' || k === 'delete' || k === 'backspace') return removeSelection();
        if (e.key === 'Escape') return clearSelection();
    }
    if (k === 'f') pipette();
    if (k in keyTools) selectTool(keyTools[k]);
    if (e.key === 'Escape' && state.selected) {
        deselect();
        audio.cue('close');
    }
    if (k === 'r') rotateDir();
    if (k === 'q') renderer.rig.rotate(-1);
    if (k === 'e') renderer.rig.rotate(1);
    if (e.key === ' ') {
        e.preventDefault();
        togglePause();
    }
    if (e.key === '+' || e.key === '=') changeSpeed(1);
    if (e.key === '-' || e.key === '_') changeSpeed(-1);
    if (k === 'm') ui.toast(audio.toggleMute() ? 'Sound off · M' : 'Sound on · M');
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
        if (placeBelt(cell.x, cell.y, dir) === 'built') {
            state.lastBuildPulseMs = 120;
            audio.cue('belt');
        }
    } else {
        demolish(cell.x, cell.y);
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
    if (state.selDrag && cell) state.selDrag.to = cell;
});

canvas.addEventListener('pointerleave', () => (state.hovered = { x: -1, y: -1 }));

canvas.addEventListener('pointerdown', (e) => {
    if (state.cinematic) return;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) {
        e.preventDefault();
        panDrag = { x: e.clientX, y: e.clientY };
        return;
    }
    if (!state.started) return;
    const cell = renderer.pickCell(e.clientX, e.clientY);
    if (!cell) return;

    // Carrying a selection: left click puts it down, right click lets go.
    if (state.group) {
        if (e.button === 0) placeGroup();
        else if (e.button === 2) cancelGroup();
        return;
    }
    if (state.tool === 'select' && e.button === 0) {
        state.selDrag = { from: cell, to: cell };
        return;
    }
    if (e.button === 2 || state.tool === 'erase') {
        state.drag = { last: null, mode: 'erase' };
        dragTo(cell);
        return;
    }
    if (e.button !== 0) return;
    // A click on a machine opens its panel (the upgrade tool still upgrades in one click).
    const target = grid[cell.x][cell.y].machine;
    if (target && !NO_PANEL.has(target.type) && state.tool !== 'upgrade') {
        selectMachine(cell.x, cell.y);
        return;
    }
    if (state.tool === 'belt') {
        state.drag = { last: null, mode: 'lay' };
        dragTo(cell);
        return;
    }
    actAt(cell.x, cell.y, e.button);
});

const endDrag = (e) => {
    state.drag = null;
    if (state.selDrag) finishSelection();
    if (panDrag) renderer.rig.endPan(); // let the view glide on
    panDrag = null;
    if (e?.pointerId != null && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.cinematic) return;
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
    window.__audio = audio;
    window.__ui = ui; // e.g. __ui.say({ who: "boss", text }) to preview a line in the comms
    window.__state = state; // the input state: tool, selection, carried group
    if (new URLSearchParams(location.search).has('sounds')) {
        const { mountSoundboard } = await import('./soundboard.js');
        mountSoundboard(audio);
    }
}
