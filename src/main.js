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
import './menus.css';
import './codex.css';
import {
    GRID_WIDTH, GRID_HEIGHT, TICK_RATE, SINK_VALUE, MAX_TIER, PRODUCT_REWARD,
    ORDER_TARGET, ORDER_TICKS, ORDER_REWARD, ORDER_GRACE_TICKS, ORDER_POOL,
    LICENCE_COST, PLOTS, INFINITE_ORDER_POOL, ORDER_LEVEL_GROWTH,
} from './config.js';
import {
    grid, score, tickCount, order, power, research, project, stats, unlockTech, startOrder,
    initGrid, buildMachine, removeMachine, upgradeMachine, upgradeCost, placeBelt, dirBetween,
    serialize, loadState, isBuildingUnlocked, machineCost, machinePorts, machineIO,
    RECIPES, recipeUnlocked, setRecipe, setMachineOn, resetBreaker, machineStatus, machineRates,
    salePrice, flow, UPGRADABLE, machinesIn, planGroup, applyGroup, removeGroup, setEnding, setCompany,
    game, isInfinite, visualPhase, newGame, licenceAvailable, buyLicence, nextPlotCost, buyPlot, isLoadableSave,
    planStored,
} from './grid.js';
import { unlockPhaseOf, PHASES } from './campaign.js';
import { BUILDING_NAMES, ITEM_NAMES, INFINITE, BUILD_HELP } from './story.js';
import { createRenderer } from './renderer.js';
import { startGameLoop } from './gameLoop.js';
import { createUI } from './ui.js';
import { createDirector, STORY_SCRIPT } from './director.js';
import { createAudio, BUILD_SIZE } from './audio.js';
import { createSettings } from './settings.js';
import { createAccount } from './account.js';
import { createSaves } from './saves.js';
import { createMenus } from './menus.js';
import { createSettingsPanel } from './settingsPanel.js';
import { blueprintThumb } from './blueprint.js';
import { layoutOf, buildLayout, BENCH } from './benchmark.js';
import { history } from './undo.js';
import { createAlerts } from './alerts.js';
import { machineRatios } from './ratios.js';
import { entryForCell } from './codex.js';
import { createBlueprints, fromCells, fromLayout, anchorOf } from './blueprints.js';
import { createBlueprintPanel } from './blueprintPanel.js';
import { createViewBar, linkedFactory, factoryLink, shareLink } from './viewer.js';
import './blueprints.css';
import { createAchievements } from './achievements.js';
import { createProfile, avatarForAchievement } from './profile.js';

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

// --- Settings, account, save slots (iteration 6) ---
// Settings live in settings.js (locally, and in the account when signed in); the sound
// engine keeps its volumes too, so the store starts from them on the first run.
const settings = createSettings({ audioDefaults: audio.settings() });
audio.setSettings(settings.get().audio);
const account = createAccount();
const saves = createSaves({ account, isLoadable: isLoadableSave });
const blueprints = createBlueprints({ account }); // iteration 7: the blueprint library
// Achievements (iteration 7): polled from the world once a second, a toast in the HUD.
const achievements = createAchievements({ account, sound: audio, avatarFor: avatarForAchievement, quiet: () => state.cinematic });

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
    group: null, // { mode: 'move'|'copy', cells, anchor, rot, plan, blueprint? } while a selection (or a blueprint) is carried
    viewing: false, // the factory viewer: another player's factory runs, read-only (no slot, no building)
};
// The recipe last picked per machine type: new machines of that type start on it.
const lastRecipe = {};
// The alerts list (alerts.js): the factory's problems that have lasted a few seconds.
const alerts = createAlerts();
let alertsClock = 0;
/** Alerts list → a group: go to its next machine and open its panel. @returns {boolean} there was one */
function jumpToAlert(key) {
    const t = alerts.next(key);
    if (!t) return false;
    renderer.rig.focusOn(t.x + 0.5, t.y + 0.5);
    state.selected = { x: t.x, y: t.y };
    audio.cue('open');
    return true;
}

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
        // In Infinite the director's "phase" is the stage: licence groups bought (0–4).
        phase: isInfinite() ? infiniteStage() : project.phase,
        complete: !isInfinite() && project.complete,
        mode: game.mode,
        licences: [...game.licences],
        plot: game.plot,
        orderLevel: game.orderLevel,
        submitted: !!state.submitted,
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

/** Infinite: how many of the campaign's unlock groups are fully licensed (0–4). */
function infiniteStage() {
    let n = 0;
    for (const p of PHASES) {
        if (!p.unlocks.length) break;
        if (!p.unlocks.every((t) => game.licences.includes(t))) break;
        n++;
    }
    return n;
}

/** Infinite's shop for the console: every licence, owned / buyable now / later. */
function infiniteInfo() {
    return {
        plot: game.plot,
        plots: PLOTS.length,
        nextPlotCost: nextPlotCost(),
        visualPhase: visualPhase(),
        licences: Object.keys(LICENCE_COST).map((type) => ({
            type, cost: LICENCE_COST[type], owned: game.licences.includes(type), available: licenceAvailable(type),
        })),
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
        return { x, y, type: 'sink', sig: `sink@${x},${y}`, infinite: isInfinite(), market: items.map((item) => ({ item, price: salePrice(item), base: SINK_VALUE[item] })) };
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
    const ratios = machineRatios(x, y);
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
        ratios,
        sig: [m.type, x, y, m.tier, m.recipe, !!m.off, recipes?.map((r) => (r.unlocked ? 1 : 0)).join(''), cost, JSON.stringify(ratios)].join('|'),
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

// --- Persistence: save slots (saves.js: localStorage first, the account when signed in) ---
// A game plays in one slot: autosave and Save write to it, "Save as" copies it into a new
// one. Switching to another slot mid-game reloads the page with a boot intent, so every
// game starts from a fresh renderer.
const BOOT_KEY = 'selene.boot';
let activeSlot = null; // the slot card of the running game
let playMs = 0;        // real time played in this slot (paused time doesn't count)

function saveData() {
    return { ...serialize(), story: director.save(), visual: renderer.saveVisual(), playMs: Math.round(playMs), achv: achievements.saveRun() };
}
function slotMeta() {
    let thumb = null;
    try {
        thumb = blueprintThumb();
    } catch { /* no canvas: no picture */ }
    return {
        mode: game.mode, world: game.world, phase: project.phase, plot: game.plot, complete: project.complete,
        playSec: Math.round(playMs / 1000), thumb,
    };
}

/** Save the running game into its slot. `push`: 'now' sends it to the account at once. */
function saveGame(push = 'now') {
    if (!state.started || !activeSlot) return false;
    try {
        const r = saves.write(activeSlot.id, saveData(), slotMeta(), { push });
        if (!r.ok) ui?.toast(r.error);
        return r.ok;
    } catch {
        return false;
    }
}

/** "Save as": the running game into a new slot, which it then plays in. */
function saveGameAs(name) {
    if (!saveGame('later')) return false;
    const copy = saves.duplicate(activeSlot.id, name || null);
    if (!copy) return false;
    activeSlot = copy;
    saves.setActive(copy.id);
    return true;
}

/** Restore a save into the live game (only at boot, before anything was played). */
function applySave(data) {
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
    playMs = data.playMs ?? 0;
    director.load(data.story, tickCount, project.phase, project.ending);
    history.clear();
    alerts.reset();
    achievements.loadRun(data.achv);
    state.started = true;
    return true;
}

/** Leave this game for another slot (or a new game): save, then reload into it. */
function switchTo(intent) {
    saveGame('later');
    try {
        sessionStorage.setItem(BOOT_KEY, JSON.stringify(intent));
    } catch { /* no session storage: the title screen will offer it */ }
    location.reload();
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
        ui.toast(isInfinite() ? `License the ${BUILDING_NAMES[tool]} in the console first` : `${BUILDING_NAMES[tool]} arrives in Phase ${unlockPhaseOf(tool) + 2}`);
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
    const what = g.mode === 'copy' ? BUILD_HELP.what.copy(plan.moves.length) : BUILD_HELP.what.move(plan.moves.length);
    renderer.applyEvents(history.run(what, () => applyGroup(plan, g.mode)), 140);
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
    const one = cells.length === 1 ? grid[cells[0].x][cells[0].y].machine?.type : null;
    renderer.applyEvents(history.run(BUILD_HELP.what.demolish(cells.length, one), () => removeGroup(cells)), 0);
    audio.cue('demolish');
    const c = cells[Math.floor(cells.length / 2)];
    if (refund) renderer.floatAt(c.x, c.y, `+${refund}`, REFUND_COLOR);
    state.sel = null;
    state.group = null;
}
/**
 * Undo (or redo) the last step: machines back as they were, credits reversed exactly (undo.js).
 * Not while a drag is under way; a carried group is let go if its machines changed.
 */
function stepHistory(redo) {
    if (state.drag || state.selDrag || state.cinematic) return;
    const r = redo ? history.redo() : history.undo();
    if (!r.ok) {
        audio.cue('deny');
        const no = redo ? BUILD_HELP.refusedRedo : BUILD_HELP.refused;
        ui.toast(r.error === 'empty' ? BUILD_HELP.nothing[redo ? 'redo' : 'undo'] : r.error === 'broke' ? no.broke(Math.ceil(r.need)) : no[r.error]);
        return;
    }
    if (r.carried) renderer.quietNext(); // moved machines slide back
    renderer.applyEvents(r.events, r.carried ? 140 : 0);
    audio.cue('rotate');
    const credits = redo ? r.step.credits : -r.step.credits;
    const at = r.step.cells[Math.floor(r.step.cells.length / 2)];
    if (Math.round(credits)) renderer.floatAt(at.x, at.y, `${credits > 0 ? '+' : '−'}${Math.abs(Math.round(credits))}`, credits > 0 ? REFUND_COLOR : SPEND_COLOR);
    ui.toast((redo ? BUILD_HELP.redone : BUILD_HELP.undone)(r.step.label ?? BUILD_HELP.what.edit));
    if (state.group && state.group.cells.some(({ x, y }) => !grid[x][y].machine)) state.group = null;
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

// --- Blueprints (blueprints.js, blueprintPanel.js): save a selection, carry one like a copy ---
function openBlueprints() {
    blueprintPanel.open({ onPick: state.started && !state.cinematic ? carryBlueprint : null });
}
function saveSelectionAsBlueprint() {
    const body = fromCells(state.sel.cells);
    if (!body) return;
    blueprintPanel.askName({
        value: `Blueprint ${String(blueprints.list().length + 1).padStart(2, '0')}`,
        hint: `${body.machines.length} machines, ${body.w} × ${body.h} cells. The library is on ${(settings.get().keys.blueprints ?? 'b').toUpperCase()}.`,
        onSave: (name) => {
            const r = blueprints.add(name, body);
            if (!r.ok) return r.error;
            ui.toast(`Saved “${r.blueprint.name}” to your blueprints`);
            audio.cue('check');
            return null;
        },
    });
}
/** Put a blueprint in the player's hand: it follows the cursor like a carried copy. */
function carryBlueprint(bp) {
    state.tool = 'select';
    state.sel = null;
    state.selected = null;
    state.group = { mode: 'copy', blueprint: bp, cells: bp.machines, anchor: anchorOf(bp), rot: 0, plan: null };
}

// --- Story director ---
const director = createDirector({
    // Late-bound: the UI is created below.
    say: (line) => ui.say(line),
    banner: (i) => ui.showBanner(i),
    isBusy: () => ui.isBusy() || menus.isOpen(),
    script: () => (isInfinite() ? INFINITE : STORY_SCRIPT),
    hints: () => settings.get().gameplay.hints,
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
        // A new contract is a new slot; this one stays on file.
        onNewGame: () => switchTo({ action: 'title' }),
    });
}

// --- HUD ---
const ui = createUI({
    root: document.getElementById('hud'),
    sound: audio,
    icons: renderer.icons,
    itemIcons: renderer.itemIcons,
    onToolChange: selectTool,
    onRotate: rotateDir,
    onTogglePause: togglePause,
    onSpeedChange: changeSpeed,
    onSave: () => saveGame('now'),
    onLoad: () => false,
    onOpenSaves: () => openSaves(),
    onOpenSettings: () => settingsPanel.open(),
    onOpenBoard: () => openBoard(),
    onOpenMenu: () => openGameMenu(),
    onBuyLicence: (type) => {
        const cost = LICENCE_COST[type];
        if (!buyLicence(type)) return false;
        audio.cue('upgrade');
        ui.toast(`${BUILDING_NAMES[type]} licensed · CR ${cost}`);
        return true;
    },
    onBuyPlot: () => {
        const cost = nextPlotCost();
        if (!buyPlot()) return false;
        audio.cue('phase', { phase: 0 });
        ui.toast(`Land ${game.plot + 1}/${PLOTS.length} bought · CR ${cost}`);
        saveGame('later');
        return true;
    },
    keyMap: settings.get().keys,
    onUnlock: (id) => unlockTech(id),
    onSetRecipe: (id) => {
        const sel = state.selected;
        if (!sel || !history.run(BUILD_HELP.what.recipe(grid[sel.x][sel.y].machine?.type), () => setRecipe(sel.x, sel.y, id))) return false;
        lastRecipe[grid[sel.x][sel.y].machine.type] = id;
        audio.cue('recipe');
        return true;
    },
    onUpgradeSelected: () => {
        const sel = state.selected;
        if (!sel) return false;
        const cost = upgradeCost(sel.x, sel.y);
        const m = grid[sel.x][sel.y].machine;
        if (!history.run(BUILD_HELP.what.upgrade(m?.type, (m?.tier ?? 0) + 1), () => upgradeMachine(sel.x, sel.y))) return false;
        audio.cue('upgrade');
        if (cost) renderer.floatAt(sel.x, sel.y, `−${cost}`, SPEND_COLOR);
        return true;
    },
    onToggleSelected: () => {
        const sel = state.selected;
        const m = sel && grid[sel.x][sel.y].machine;
        if (!m || !history.run(BUILD_HELP.what.power(m.type, !!m.off), () => setMachineOn(sel.x, sel.y, !!m.off))) return false;
        audio.cue(m.off ? 'pause' : 'resume');
        return true;
    },
    onDeselect: deselect,
    onAlert: (key) => jumpToAlert(key),
    onAlertsOpen: () => alerts.rewind(),
    onGroupAction: (action) => {
        if (action === 'cancel') return state.group ? cancelGroup() : clearSelection();
        if (!state.sel) return;
        if (action === 'remove') removeSelection();
        else if (action === 'blueprint') saveSelectionAsBlueprint();
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
            alerts: { count: alerts.count(), groups: alerts.groups() },
            selection: state.sel || state.group ? {
                count: (state.group?.cells ?? state.sel.cells).length,
                mode: state.group?.mode ?? null,
                cost: state.group?.plan?.cost ?? null,
                ok: state.group?.plan?.ok ?? null,
                blocked: state.group?.plan?.bad.length ?? 0,
                blueprint: state.group?.blueprint?.name ?? null,
            } : null,
            research: { points: research.points, unlocked: { ...research.unlocked } },
            project: { phase: project.phase, delivered: { ...project.delivered }, complete: project.complete, ending: project.ending, company: project.company },
            mode: game.mode,
            infinite: isInfinite() ? infiniteInfo() : null,
            unlocked: Object.fromEntries([...buildableTools].map((t) => [t, isBuildingUnlocked(t)])),
            objectives: director.objectives(),
        };
    },
});

// --- Orders (generation/cadence is policy, so it lives here) ---
// Priority Requests start once the Assembler is unlocked (phase 1 done).
const randInt = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));
// Infinite: what each product needs licensed (and researched) before it can be asked for.
const ORDER_NEEDS = {
    ironPlate: ['press'], circuit: ['press', 'assembler'], steel: ['foundry'],
    capacitor: ['press', 'foundry', 'assembler'], motor: ['press', 'foundry', 'assembler'],
    advancedCircuit: ['press', 'foundry', 'assembler'], explosive: ['mixer'],
};
function infinitePool() {
    const pool = INFINITE_ORDER_POOL.filter((item) => (ORDER_NEEDS[item] ?? []).every((t) => game.licences.includes(t))
        && (item !== 'advancedCircuit' || research.unlocked.advancedProduct)
        && (item !== 'explosive' || game.plot >= PLOTS.length - 1));
    return pool.length ? pool : ['ironIngot', 'copperIngot'];
}
function issueOrder() {
    // A product the factory can make by now; cheap goods in bigger batches, dear ones in smaller.
    if (isInfinite()) {
        // Every request filled makes the next ones bigger (and better paid, with a little more time).
        const pool = infinitePool();
        const productType = pool[Math.floor(Math.random() * pool.length)];
        const worth = Math.sqrt((SINK_VALUE[productType] ?? PRODUCT_REWARD) / PRODUCT_REWARD);
        const grow = (1 + ORDER_LEVEL_GROWTH) ** game.orderLevel;
        const target = Math.min(500, Math.max(2, Math.round((randInt(ORDER_TARGET) / worth) * grow)));
        const ticks = Math.round(randInt(ORDER_TICKS) * Math.sqrt(grow));
        startOrder({ productType, target, ticks, reward: Math.round(randInt(ORDER_REWARD) * Math.sqrt(worth) * grow) });
        return;
    }
    const pool = ORDER_POOL[Math.min(project.phase, ORDER_POOL.length - 1)];
    const productType = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'circuit';
    const worth = Math.sqrt((SINK_VALUE[productType] ?? PRODUCT_REWARD) / PRODUCT_REWARD);
    const target = Math.max(2, Math.round(randInt(ORDER_TARGET) / worth));
    startOrder({ productType, target, ticks: randInt(ORDER_TICKS), reward: Math.round(randInt(ORDER_REWARD) * Math.sqrt(worth)) });
}

let nextOrderTick = null; // tickCount at which to issue the next order, or null
function tickOrders() {
    // Story: from phase 2. Infinite: once the factory has delivered something.
    if (isInfinite() ? !Object.keys(stats.delivered).length : project.phase < 1) return;
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
let directorClock = 0;
let autosaveClock = 0;
let lastPhase = project.phase;
let lastWorking = 0;
let flowClock = 0;

// Any menu (the in-game menu, saves, settings…) pauses the game; closing the last one restores it.
let menuWasOpen = false;
let pausedBeforeMenu = false;
function pauseForMenus() {
    const open = menus.isOpen() && state.started && !state.cinematic;
    if (open === menuWasOpen) return;
    menuWasOpen = open;
    if (open) {
        pausedBeforeMenu = state.paused;
        state.paused = true;
    } else state.paused = pausedBeforeMenu;
}

function onFrame(dt) {
    pauseForMenus();
    // A carried group plans where it would land under the cursor; a selection forgets demolished machines.
    if (state.group) {
        const h = state.hovered;
        const g = state.group;
        g.plan = h.x >= 0 && !state.cinematic
            ? (g.blueprint ? planStored(g.blueprint.machines, g.anchor, h, g.rot) : planGroup(g.cells, g.anchor, h, g.rot, g.mode))
            : null;
    }
    if (state.viewing) sampleViewer();
    if (state.sel && !state.group) {
        const cells = state.sel.cells.filter(({ x, y }) => grid[x][y].machine);
        state.sel = cells.length ? { cells } : null;
    }
    if (state.selected) {
        const m = grid[state.selected.x][state.selected.y].machine;
        if (!m || NO_PANEL.has(m.type) || state.cinematic) state.selected = null;
    }
    alertsClock += dt;
    if (alertsClock >= 250 && state.started) {
        alertsClock = 0;
        alerts.update();
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
            achievements.update(w);
            state.focus = settings.get().gameplay.highlights ? director.objectives().find((o) => !o.done)?.focus ?? null : null;
        }
        if (!state.paused && document.visibilityState === 'visible') playMs += dt;
        autosaveClock += dt;
        const every = settings.get().gameplay.autosave * 1000; // 0 = off (phase changes still save)
        if ((every > 0 && autosaveClock >= every) || project.phase !== lastPhase) {
            autosaveClock = 0;
            lastPhase = project.phase;
            saveGame('auto');
        }
    }
    const mood = visualPhase();
    audio.update(dt, {
        // Infinite: the valley's own mood. Story: after the NIHIL HQ ending the bright early mood
        // comes back (once the cinematic is over).
        mood: isInfinite() ? Math.min(mood, 5) : project.complete ? (project.ending === 'hq' && !state.cinematic ? 1 : 5) : project.phase,
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
startGameLoop(renderer, state, onFrame, (events) => {
    audio.onEvents(events);
    achievements.onEvents(events);
});
window.addEventListener('beforeunload', () => saveGame('later'));

// --- Menus: title screen, saves, account, leaderboard, settings (menus.js, settingsPanel.js) ---
const menus = createMenus({ account, saves, sound: audio, onOpenSettings: () => settingsPanel.open(), people: () => profile });
const settingsPanel = createSettingsPanel({ settings, sound: audio, menus, account });
const blueprintPanel = createBlueprintPanel({ menus, blueprints, account, sound: audio, unlocked: isBuildingUnlocked });
const profile = createProfile({ account, menus, achievements, saves, icons: renderer.icons, sound: audio, onLeaderboard: () => openBoard() });

/** Start playing (the title screen is gone): a new game in a new slot, or a slot's save. */
function beginNew(mode) {
    if (mode === 'infinite') {
        renderer.reset();
        renderer.applyEvents(newGame('infinite'), 0);
    }
    activeSlot = saves.create({ mode });
    history.clear();
    alerts.reset();
    playMs = 0;
    achievements.loadRun(null);
    state.started = true;
    state.paused = false;
    lastPhase = project.phase;
    audio.begin(visualPhase(), { fresh: true });
    saveGame('now');
}
async function beginSlot(slot) {
    let data = null;
    try {
        data = await saves.read(slot.id);
    } catch (e) {
        ui.toast(e.message);
    }
    if (!data || !applySave(data)) {
        ui.toast('That save could not be read; starting a new game');
        beginNew(slot.mode === 'infinite' ? 'infinite' : 'story');
        return;
    }
    activeSlot = saves.get(slot.id);
    saves.setActive(slot.id);
    lastPhase = project.phase;
    state.paused = false;
    if (isInfinite()) {
        audio.begin(visualPhase());
        return;
    }
    audio.begin(project.complete ? (project.ending === 'hq' ? 1 : 5) : project.phase);
    // Saved after the last phase but before choosing the target: choose now.
    if (project.complete && !project.ending) playEnding();
    else if (director.ended()) ui.toast(project.ending === 'hq' ? `${project.company ?? 'Your company'} · the valley is yours` : 'Protocol: Selene is complete. Sandbox mode');
}
function showTitle() {
    menus.showTitle({
        onNew: (mode) => beginNew(mode),
        onPlay: (slot) => beginSlot(slot),
        onLeaderboard: () => openBoard(),
    });
}
/** The in-game menu: saves, settings, leaderboard, account, and back to the title screen. */
function openGameMenu() {
    menus.openGameMenu({
        slot: activeSlot ? saves.get(activeSlot.id) : null,
        onSave: () => saveGame('now'),
        onSaves: () => openSaves(),
        onSettings: () => settingsPanel.open(),
        onLeaderboard: () => openBoard(),
        onBlueprints: () => openBlueprints(),
        // Saved first; the title screen then offers Continue, Story, Infinite and Load.
        onMainMenu: () => switchTo({ action: 'title' }),
    });
}
function openSaves() {
    menus.openSlots({
        onPlay: (slot) => switchTo({ action: 'load', slot: slot.id }),
        inGame: activeSlot ? { activeId: () => activeSlot?.id, onSave: () => saveGame('now'), onSaveAs: (name) => saveGameAs(name) } : null,
    });
}

// The leaderboard's test runs on a copy of the simulation in a worker (benchWorker.js).
let benchWorker = null;
function previewScore(layout) {
    benchWorker ??= new Worker(new URL('./benchWorker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve) => {
        benchWorker.onmessage = (e) => resolve(e.data);
        benchWorker.onerror = () => resolve({ ok: false, error: 'The test could not run here' });
        benchWorker.postMessage(layout);
    });
}
function openBoard() {
    const playing = state.started;
    menus.openLeaderboard({
        onView: (id) => viewFactory(id),
        onShare: (id) => shareFactory(id),
        submit: !playing ? null : {
            allowed: isInfinite(),
            reason: 'Only Infinite factories go on the leaderboard: start or load an Infinite game.',
            layout: () => {
                state.submitted = true;
                return layoutOf();
            },
            preview: () => previewScore(layoutOf()),
        },
    });
}

// --- The factory viewer (viewer.js): a leaderboard factory, live and read-only ---
// It never touches the player's game: it runs after a reload (boot intent `view`, or a
// share link `/?factory=<id>`), with no slot, no autosave and no building.
let viewBar = null;
const viewSamples = [];
function viewFactory(id) {
    switchTo({ action: 'view', factory: String(id), back: activeSlot ? { action: 'load', slot: activeSlot.id } : { action: 'title' } });
}
/** Share a factory's link. @returns {Promise<string>} 'copied' | 'shared', or the link to show */
async function shareFactory(id) {
    const url = factoryLink(id);
    const how = await shareLink(url, 'A factory on the Protocol: Selene leaderboard');
    return how === 'shown' ? url : how;
}
const VIEW_BACK = 'selene.viewBack'; // where Back goes, kept for a reload while viewing
async function beginView({ factory, back = null }) {
    state.viewing = true;
    state.tool = 'select';
    document.body.classList.add('viewing');
    try {
        window.history.replaceState(null, '', `${location.pathname}?factory=${encodeURIComponent(factory)}`);
        if (back) sessionStorage.setItem(VIEW_BACK, JSON.stringify({ factory, back }));
        else {
            const kept = JSON.parse(sessionStorage.getItem(VIEW_BACK) ?? 'null');
            if (kept?.factory === factory) back = kept.back;
        }
    } catch { /* keep the address */ }
    viewBar = createViewBar({
        onBack: () => {
            try {
                window.history.replaceState(null, '', location.pathname);
                sessionStorage.removeItem(VIEW_BACK);
            } catch { /* ignore */ }
            switchTo(back ?? { action: 'title' });
        },
        onCopy: (f) => blueprintPanel.askName({
            title: 'Copy as blueprint',
            value: `${f.name}'s factory`,
            hint: 'Into your blueprint library. Extractors only work on ore: put it down where the ore lies the same way.',
            onSave: (name) => {
                const r = blueprints.add(name, fromLayout(f.layout));
                if (!r.ok) return r.error;
                viewBar.flash(`Saved “${r.blueprint.name}” to your blueprints`);
                audio.cue('check');
                return null;
            },
        }),
    });
    let f;
    try {
        f = await account.factory(factory);
    } catch (e) {
        viewBar.fail(e.status === 404 ? 'That factory isn’t on the leaderboard (any more).' : e.status === 0 ? 'The server can’t be reached.' : e.message);
        return;
    }
    const built = buildLayout(f.layout);
    renderer.reset(); // the next sync builds the factory without juice
    if (!built.ok) {
        viewBar.fail(`It can’t be built in this version of the game (${built.error}).`);
        return;
    }
    const xs = f.layout.machines.map((m) => m.x);
    const ys = f.layout.machines.map((m) => m.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    renderer.rig.snap({ x: (x0 + x1) / 2 + 0.5, z: (y0 + y1) / 2 + 0.5, zoom: clamp(15 / (Math.max(y1 - y0, (x1 - x0) * 0.6) + 5), 0.4, 1.4) });
    viewBar.show(f);
    state.paused = false;
    audio.begin(visualPhase());
}
/**
 * The viewer's "now" rate: credits per minute over the last minute of sim time, from the end
 * of the test's warm-up on (before that the market is still fresh and pays more).
 */
function sampleViewer() {
    if (tickCount < BENCH.warmupTicks) return;
    const last = viewSamples[viewSamples.length - 1];
    if (last && tickCount - last.tick < TICK_RATE) return;
    viewSamples.push({ tick: tickCount, score });
    while (viewSamples.length > 2 && tickCount - viewSamples[1].tick >= 60 * TICK_RATE) viewSamples.shift();
    const a = viewSamples[0];
    const dt = tickCount - a.tick;
    viewBar?.setLive(dt >= 10 * TICK_RATE ? ((score - a.score) * 60 * TICK_RATE) / dt : null);
}

// Settings take effect here, once at start and on every change.
function applySettings(v) {
    const motionless = v.access.reducedMotion;
    renderer.setGraphics({ ...v.graphics, shake: v.graphics.shake && !motionless, calm: motionless });
    ui.setHighlights(v.gameplay.highlights);
    renderer.setPortPalette(v.access.colorblind);
    audio.setSettings({ voiceOff: !v.gameplay.voice });
    ui.setKeys(v.keys);
    ui.setTextSpeed(v.gameplay.textSpeed);
    ui.setUiScale(v.access.uiScale);
    document.getElementById('hud').style.zoom = String(v.access.uiScale);
    document.body.classList.toggle('reduced-motion', motionless);
    document.body.classList.toggle('cb-safe', v.access.colorblind);
    keyActions = Object.fromEntries(Object.entries(v.keys).map(([action, key]) => [key, action]));
}
let keyActions = {};
applySettings(settings.get());
settings.onChange((v) => {
    applySettings(v);
    if (account.state.user) syncSettingsSoon();
});

// Signed in: settings go to the account (a moment after the last change) and come back from it.
let settingsTimer = null;
function syncSettingsSoon() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => account.putSettings(settings.get(), settings.updatedAt()).catch(() => {}), 1500);
}
let lastUser = null;
account.onChange(async (st) => {
    const id = st.user?.id ?? null;
    if (id === lastUser) return;
    lastUser = id;
    if (!id) return;
    try {
        const remote = await account.getSettings();
        if (!settings.adopt(remote.data, remote.updatedAt)) syncSettingsSoon();
        else audio.setSettings(settings.get().audio);
    } catch { /* offline: next time */ }
    saves.sync();
});
account.refresh();

// Boot: a slot or a new game asked for before the reload, or the title screen.
let boot = null;
try {
    boot = JSON.parse(sessionStorage.getItem(BOOT_KEY) ?? 'null');
    sessionStorage.removeItem(BOOT_KEY);
} catch { /* ignore */ }
const bootSlot = boot?.action === 'load' ? saves.get(boot.slot) : null;
// A share link opens straight into what it points at (`?factory=`; `?player=` is a profile's).
const linked = boot ? null : linkedFactory();
if (boot?.action === 'view') beginView(boot);
else if (bootSlot) beginSlot(bootSlot);
else if (boot?.action === 'new') beginNew(boot.mode);
else if (linked) beginView({ factory: linked });
else showTitle();
// A shared profile link (?player=<name>) opens that player's profile over the title screen.
const sharedPlayer = new URLSearchParams(location.search).get('player');
if (sharedPlayer) {
    profile.openPlayer(sharedPlayer.slice(0, 20));
    window.history.replaceState(null, '', location.pathname + location.search.replace(/([?&])player=[^&]*&?/, '$1').replace(/[?&]$/, '') + location.hash);
}

// --- Input: build tools ---
function actAt(gx, gy, button) {
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return;

    if (button === 2 || state.tool === 'erase') {
        demolish(gx, gy);
        return;
    }
    if (state.tool === 'upgrade') {
        const cost = upgradeCost(gx, gy);
        const m = grid[gx][gy].machine;
        if (history.run(BUILD_HELP.what.upgrade(m?.type, (m?.tier ?? 0) + 1), () => upgradeMachine(gx, gy))) {
            state.lastBuildPulseMs = 120;
            audio.cue('upgrade');
            if (cost) renderer.floatAt(gx, gy, `−${cost}`, SPEND_COLOR);
        } else audio.cue('deny');
        return;
    }
    if (buildableTools.has(state.tool)) {
        if (history.run(BUILD_HELP.what.build(state.tool), () => buildMachine(gx, gy, state.tool, state.dir, lastRecipe[state.tool]))) {
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
    renderer.applyEvents(history.run(BUILD_HELP.what.demolish(1, type), () => removeMachine(gx, gy)), 0);
    if (type && !grid[gx][gy].machine) {
        audio.cue('demolish');
        // Refunds show for real machines; conveyors are torn up by the dozen.
        if (!CONVEYOR_TOOLS.has(type)) renderer.floatAt(gx, gy, `+${machineCost(type)}`, REFUND_COLOR);
    }
}

// --- Input: keyboard (tools, rotation, sim speed, camera) ---
// Keys come from Settings → Controls (settings.js DEFAULT_KEYS: buildings in chain order on the
// number row, routers and tools on letters); `keyActions` maps a key to its action.
const TOOL_ACTIONS = new Set([...buildableTools, 'upgrade', 'erase', 'select']);
const PAN_KEYS = {
    w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1],
    a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
};
const held = new Set();
const VIEW_ACTIONS = new Set(['viewLeft', 'viewRight', 'pause', 'mute']);
const PAN_SPEED = 0.014; // world units per ms at zoom 1

const toggleMute = () => {
    const muted = audio.toggleMute();
    settings.set('audio', { muted });
    ui.toast(muted ? 'Sound off' : 'Sound on');
};
window.addEventListener('keydown', (e) => {
    if (!(state.started || state.viewing) || menus.isOpen() || e.target.closest?.('textarea, input:not([type="range"])')) return;
    const act = keyActions[e.key.toLowerCase()];
    if (state.cinematic) {
        if (act === 'mute') toggleMute();
        return;
    }
    // Undo / redo: Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z (fixed keys, not in the bindings).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        stepHistory(e.key.toLowerCase() === 'y' || e.shiftKey);
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
    // The factory viewer only looks: turn the view, pause, sim speed, sound.
    if (state.viewing && !VIEW_ACTIONS.has(act) && !['+', '=', '-', '_'].includes(e.key)) return;
    // A carried group and a selection borrow some keys while they're there.
    if (state.group) {
        if (act === 'rotate') {
            state.group.rot = (state.group.rot + 1) % 4;
            audio.cue('rotate');
            return;
        }
        if (e.key === 'Escape') return cancelGroup();
    }
    if (state.sel && !state.group) {
        if (act === 'move') return startGroup('move');
        if (act === 'copy') return startGroup('copy');
        if (act === 'erase' || k === 'delete' || k === 'backspace') return removeSelection();
        if (act === 'blueprints') return saveSelectionAsBlueprint();
        if (e.key === 'Escape') return clearSelection();
    }
    if (act === 'pipette') pipette();
    if (act === 'alerts') ui.toggleAlerts();
    // The codex: over something in the world, its page; otherwise open / close.
    if (act === 'codex') ui.toggleCodex(state.hovered.x >= 0 ? entryForCell(grid[state.hovered.x][state.hovered.y]) : null);
    if (act === 'blueprints') openBlueprints();
    if (TOOL_ACTIONS.has(act)) selectTool(act);
    if (k === 'delete' || k === 'backspace') selectTool('erase');
    if (e.key === 'Escape') {
        if (ui.codexOpen()) ui.closeCodex();
        else if (state.selected) {
            deselect();
            audio.cue('close');
        } else openGameMenu(); // nothing to close: Esc opens the menu
    }
    if (act === 'rotate') rotateDir();
    if (act === 'viewLeft') renderer.rig.rotate(-1);
    if (act === 'viewRight') renderer.rig.rotate(1);
    if (act === 'pause') {
        e.preventDefault();
        togglePause();
    }
    if (e.key === '+' || e.key === '=') changeSpeed(1);
    if (e.key === '-' || e.key === '_') changeSpeed(-1);
    if (act === 'mute') toggleMute();
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
        if (drag.last) history.run(BUILD_HELP.what.edit, () => placeBelt(drag.last.x, drag.last.y, dir)); // re-point the cell we leave
        if (history.run(BUILD_HELP.what.edit, () => placeBelt(cell.x, cell.y, dir)) === 'built') {
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
    if (state.viewing && e.button === 0) {
        panDrag = { x: e.clientX, y: e.clientY }; // the viewer: a left drag pans too
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
        history.begin((cells) => BUILD_HELP.what.demolish(cells.length, cells[0]?.before?.spec.type));
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
        history.begin((cells) => BUILD_HELP.what.belts(cells.length));
        dragTo(cell);
        return;
    }
    actAt(cell.x, cell.y, e.button);
});

const endDrag = (e) => {
    if (state.drag) history.end(); // the whole drag is one step
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
    window.__settings = settings; // settings.js store: __settings.set('graphics', { shadows: false })
    window.__saves = saves;
    window.__blueprints = blueprints;
    window.__account = account;
    window.__menus = menus;
    window.__undo = history; // undo.js: __undo.size(), __undo.undo()
    window.__alerts = alerts; // alerts.js: __alerts.groups()
    window.__achievements = achievements; // __achievements.grant('circuit') earns one
    window.__profile = profile;
    if (new URLSearchParams(location.search).has('sounds')) {
        const { mountSoundboard } = await import('./soundboard.js');
        mountSoundboard(audio);
    }
}
