// src/ui.js — the HUD, as plain DOM floating over the full-window 3D view
// (design: "D · Mission Control" on the Nile Brand Directions canvas).
// Driven entirely through the callbacks and the getState() pull function
// passed in from main.js; it reads no game state directly.
//
// Layout (all inside `root`, which ignores the pointer except on panels):
//   top bar   — company mark, credits, power gauge, sim speed, save/load/keys
//   ribbon    — the current phase, hanging under the top bar; celebrates completions
//   console   — Protocol: Selene patch, phase requirements, flight plan
//               (objectives), research, priority request
//   keys      — build tools and edit tools as hardware keys
//   comms     — DELTA's CAPCOM terminal (message queue + typewriter + log)
//   tooltip   — the inspector, following the hovered cell
//   panel     — the machine panel (click a machine): recipe, rates, upgrade,
//               on/off; the Dispatch Pad's shows the market
//   production — top bar popover: items made / used / sold per minute
// Title screen and mission report are overlays on <body>; the ending itself
// plays in the 3D world (letterbox, the shot, the Moon breaking, Moon+).
//
// Sound goes through the optional `sound` object (audio.js): the HUD only
// tells it what happened (a comms line starts, a panel opens, the ending
// plays) and reads/writes its settings; it never touches audio itself.
import { MACHINE_COST, TECH_COST, TICK_RATE, OVERLOAD_RATIO, OVERLOAD_TICKS, HQ_FLIGHT_MS } from './config.js';
import { PHASES, unlockPhaseOf } from './campaign.js';
import {
    AI, BOSS, GAME_TITLE, ITEM_NAMES, BUILDING_NAMES, BUILDING_DESC, TECH_TEXT, PHASE_TEXT, ENDING, BRAND, brandFor, RECIPE_NAMES,
    CHOICE, ENDING_HQ, COMPANY, CREDITS, INFINITE_TEXT, BUILD_HELP, CODEX,
} from './story.js';
import { markSVG, patchSVG, deltaSVG, broadcastSVG, memoSVG, bossSVG, companyMarkSVG } from './brand.js';
import { DEFAULT_KEYS, keyLabel } from './settings.js';
import { MADE_BY } from './menus.js';
import { createCodexPanel } from './codexPanel.js';
import { entryForCell } from './codex.js';

const ICON = {
    belt: 'M6 7l5 5-5 5M13 7l5 5-5 5',
    extractor: 'M12 3v10M8 13h8l-4 8z',
    smelter: 'M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-4 3-5 0 2 1 3 2 3 0-3 0-5 0-7z',
    assembler: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
    splitter: 'M4 12h6M10 12l8-6M10 12h10M10 12l8 6',
    merger: 'M4 6l8 6M4 18l8-6M4 12h16',
    generator: 'M13 2L4 14h7l-1 8 9-12h-7z',
    lab: 'M9 3h6M10 3v6L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3',
    fabricator: 'M4 20h16M7 20V12l5-3 5 3v8M12 9V4',
    press: 'M5 4h14M12 4v9M7 13h10M4 20h16',
    foundry: 'M5 20V9l7-5 7 5v11zM9 20v-5h6v5',
    mixer: 'M8 3h8M9 3v6l-4 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-4-9V3',
    select: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
    upgrade: 'M6 13l6-6 6 6M6 19l6-6 6 6',
    erase: 'M3 21l9-9M14.5 3.5l6 6-4 4-6-6z',
    rotate: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
    gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1',
    menu: 'M4 7h16M4 12h16M4 17h16',
    book: 'M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z',
    pause: 'M8 5v14M16 5v14',
    play: 'M7 5l12 7-12 7z',
    faster: 'M6 7l5 5-5 5M13 7l5 5-5 5',
    slower: 'M18 7l-5 5 5 5M11 7l-5 5 5 5',
};

// Build palette order (the hotkeys come from the key bindings in settings.js; main.js handles them).
const BUILD_DEFS = [
    ['belt'], ['splitter'], ['merger'],
    ['extractor'], ['smelter'], ['press'], ['foundry'], ['assembler'],
    ['fabricator'], ['lab'], ['mixer'], ['generator'],
];

const SEGMENTS = 15;
const pad2 = (n) => String(n).padStart(2, '0');
/** Credits as a mono readout: "01 250". */
const credits = (n) => String(Math.max(0, Math.floor(n))).padStart(5, '0').replace(/\B(?=(\d{3})+$)/g, ' ');

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function iconSVG(path, size = 24) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;
}

/** A hardware key: number in the corner, the machine's picture (or a glyph), small caption. */
function hwKey({ k, label, iconPath, img = null, sub = '', cls = '', onClick }) {
    const b = el('button', `hwkey ${cls}${img ? ' has-img' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    const picture = img
        ? `<img class="hwkey-img" src="${img}" alt="" draggable="false"><span class="hwkey-lock">${iconSVG(ICON.lock, 13)}</span>`
        : iconSVG(iconPath);
    b.innerHTML = `<span class="hwkey-k">${k}</span>${picture}<span class="hwkey-sub"></span>`;
    b.querySelector('.hwkey-sub').textContent = sub;
    b.addEventListener('click', onClick);
    return b;
}

function textButton(label, onClick, cls = '') {
    const b = el('button', `tbtn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

const fmtTime = (secs) => {
    const s = Math.floor(secs);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
};

/**
 * @param {{
 *   root: HTMLElement,
 *   onToolChange: (tool: string) => void, onRotate: () => void,
 *   onTogglePause: () => void, onSpeedChange: (delta: number) => void,
 *   onSave: () => boolean, onLoad: () => boolean, onUnlock: (techId: string) => boolean,
 *   getState: () => any,
 *   sound?: ReturnType<typeof import('./audio.js').createAudio>,
 * }} opts
 */
export function createUI({
    root, onToolChange, onRotate, onTogglePause, onSpeedChange, onSave, onLoad, onUnlock, getState, sound, icons = {}, itemIcons = {},
    onSetRecipe = () => false, onUpgradeSelected = () => false, onToggleSelected = () => false, onDeselect = () => {}, onResetBreaker = () => false,
    onGroupAction = () => {},
    // Iteration 6: the save slots, settings and leaderboard panels (menus.js), Infinite's shop.
    onOpenSaves = () => {}, onOpenSettings = () => {}, onOpenBoard = () => {}, onBuyLicence = () => false, onBuyPlot = () => false,
    onOpenMenu = () => {},
    // Iteration 7: the alerts list (a group's next machine; the list was opened).
    onAlert = () => false, onAlertsOpen = () => {},
    keyMap = DEFAULT_KEYS,
}) {
    root.innerHTML = '';
    let keysBound = { ...keyMap }; // action → key, from the Controls settings
    const kl = (action) => keyLabel(keysBound[action] ?? DEFAULT_KEYS[action] ?? '');
    let textSpeed = 1; // the Text speed setting
    let uiScale = 1;   // the Interface size setting (#hud is zoomed by CSS)
    let highlights = true; // the Tutorial highlights setting
    const cue = (name) => sound?.cue(name);
    let cinematic = false;   // the ending is playing: HUD hidden, comms held
    let skyOverride = null;  // keeps the sky (and its Moon) up until the shot lands

    // Moon+ lives in the sky (behind the 3D canvas), shown by CSS once the Moon is gone.
    const view = document.getElementById('view');
    const billboard = el('div', 'moonplus');
    billboard.setAttribute('aria-hidden', 'true');
    billboard.append(el('span', 'mp-name', ENDING.billboard.name), el('span', 'mp-tag', ENDING.billboard.tag));
    view?.insertBefore(billboard, view.querySelector('canvas'));
    let phaseShown = -1; // phase the phase-dependent DOM was last built for
    let phaseSig = '';   // phase|ending|company the brand and console were built for
    let brandPhase = 0;  // for comms headers / portraits
    let brandEnding = null;
    let brandCompany = null;

    // ---- Top bar ----------------------------------------------------------------
    const top = el('header', 'topbar');
    const brandCell = el('div', 'tb-cell tb-brand');
    const brandMark = el('span', 'tb-mark');
    const brandWord = el('span', 'tb-word');
    brandCell.append(brandMark, brandWord);

    const creditsCell = el('div', 'tb-cell tb-readout');
    const creditsValue = el('span', 'tb-value credits');
    creditsCell.append(el('span', 'tb-label', 'Credits'), creditsValue);

    const powerCell = el('div', 'tb-cell tb-readout tb-power');
    const powerLabel = el('span', 'tb-label');
    const gauge = el('div', 'gauge');
    const segs = Array.from({ length: SEGMENTS }, () => gauge.appendChild(el('span')));
    // The last segments are the overload zone: past full supply, before the breaker trips.
    const fullAt = Math.round(SEGMENTS / OVERLOAD_RATIO);
    segs.forEach((seg, i) => seg.dataset.zone = i >= fullAt ? 'over' : '');
    const resetBtn = el('button', 'tb-reset hidden', 'Reset breaker');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => {
        if (!onResetBreaker()) cue('deny');
    });
    powerCell.append(powerLabel, gauge, resetBtn);

    const simCell = el('div', 'tb-cell tb-sim');
    const slowerBtn = el('button', 'sqkey');
    slowerBtn.type = 'button';
    slowerBtn.setAttribute('aria-label', 'Slower');
    slowerBtn.innerHTML = iconSVG(ICON.slower, 16);
    slowerBtn.addEventListener('click', () => onSpeedChange(-1));
    const pauseBtn = el('button', 'sqkey');
    pauseBtn.type = 'button';
    pauseBtn.addEventListener('click', onTogglePause);
    const speedLabel = el('span', 'tb-speed');
    const fasterBtn = el('button', 'sqkey');
    fasterBtn.type = 'button';
    fasterBtn.setAttribute('aria-label', 'Faster');
    fasterBtn.innerHTML = iconSVG(ICON.faster, 16);
    fasterBtn.addEventListener('click', () => onSpeedChange(1));
    simCell.append(slowerBtn, pauseBtn, speedLabel, fasterBtn);

    const menuCell = el('div', 'tb-cell tb-menu');
    /** Open one popover (closing the other), or close it if it's already open. */
    function togglePopover(panel) {
        const opening = panel.classList.contains('hidden');
        for (const p of [help, prodPanel, alertsPanel]) p.classList.add('hidden');
        if (opening) {
            panel.classList.remove('hidden');
            onDeselect();
            if (panel === alertsPanel) onAlertsOpen();
        }
        cue(opening ? 'open' : 'close');
    }
    // The game's own panels here; saves, settings, the leaderboard, the account and the way back
    // to the title screen are all behind Menu (menus.js openGameMenu, also on Esc).
    const menuBtn = el('button', 'tbtn tb-menu-btn');
    menuBtn.type = 'button';
    menuBtn.innerHTML = `${iconSVG(ICON.menu, 15)}<span>Menu</span>`;
    menuBtn.title = 'Menu · Esc';
    menuBtn.addEventListener('click', () => {
        for (const p of [help, prodPanel, alertsPanel]) p.classList.add('hidden');
        onOpenMenu();
    });
    // The alerts list: a count of the factory's current problems (alerts.js), the list on a click or N.
    const alertsBtn = textButton('', () => togglePopover(alertsPanel), 'tb-alerts');
    const alertsCount = el('span', 'tb-alerts-n');
    alertsBtn.append(el('span', null, BUILD_HELP.alerts.button), alertsCount);
    // The codex (codexPanel.js): a reference that stays open while the factory runs.
    const codexBtn = el('button', 'tbtn tb-codex-btn');
    codexBtn.type = 'button';
    codexBtn.innerHTML = `${iconSVG(ICON.book, 15)}<span></span>`;
    codexBtn.querySelector('span').textContent = CODEX.title;
    codexBtn.addEventListener('click', () => codex.toggle());
    const prodBtn = textButton('Production', () => togglePopover(prodPanel));
    menuCell.append(
        prodBtn,
        textButton('Keys', () => togglePopover(help)),
        alertsBtn,
        codexBtn,
        menuBtn,
    );
    top.append(brandCell, creditsCell, powerCell, el('div', 'tb-spacer'), simCell, menuCell);
    root.appendChild(top);

    const help = el('div', 'help hidden');
    /** The Keys popover, with the keys as bound in Settings → Controls. */
    function renderHelp() {
        const chain = ['belt', 'extractor', 'smelter', 'press', 'foundry', 'assembler', 'fabricator', 'lab', 'mixer', 'generator'].map(kl).join(' ');
        const rows = [
            ['LMB', 'build · drag to lay belts'], ['Click machine', 'its panel: recipe, speed, upgrade'], ['RMB', 'demolish (refunds cost)'],
            [kl('rotate'), 'rotate before placing'], [chain, 'buildings, in chain order'], [`${kl('splitter')} / ${kl('merger')}`, 'splitter / merger'],
            [`${kl('upgrade')} / ${kl('erase')}`, 'upgrade / demolish tool'], [kl('select'), 'select: drag a box round machines'],
            [`${kl('move')} / ${kl('copy')} / ${kl('erase')}`, 'move / copy / demolish the selection'], [kl('blueprints'), 'blueprints (with a selection: save it as one)'], [kl('pipette'), 'pipette: build what is under the cursor'], ['Esc', 'close panel, drop selection, open the menu'],
            ['WASD', 'move view'], ['Wheel', 'zoom'],
            [`${kl('viewLeft')} / ${kl('viewRight')}`, 'turn view'], [kl('pause'), 'pause'], ['+ / −', 'sim speed'], [kl('mute'), 'sound on / off'],
            ['Ctrl+Z / Y', 'undo / redo'], [kl('alerts'), 'alerts: what needs fixing'],
            [kl('codex'), 'codex: items, recipes, buildings (over a machine: its page)'],
        ];
        help.innerHTML = '';
        for (const [k, v] of rows) {
            const row = el('div');
            row.append(el('b', null, k), el('span', null, v));
            help.appendChild(row);
        }
        // What the arrows on machines mean.
        const legend = el('div', 'help-legend');
        for (const [c, t] of [
            ['lg-in', 'input: things go in here'], ['lg-out', 'output: things come out here'],
            ['lg-off', 'dim: nothing hooked up yet'], ['lg-block', 'red (purple when colour-blind-safe): output blocked'],
        ]) {
            const row = el('div');
            row.append(el('i', `lg ${c}`), el('span', null, t));
            legend.appendChild(row);
        }
        help.appendChild(legend);
        help.appendChild(el('p', 'help-more', 'Change keys in Settings → Controls.'));
    }
    renderHelp();
    root.appendChild(help);

    // ---- Production overview (top bar → Production) ------------------------------
    const prodPanel = el('div', 'prod-panel hidden');
    const prodHead = el('div', 'prod-row prod-head');
    for (const h of ['Item', 'Made', 'Used', 'Sold']) prodHead.appendChild(el('span', null, h));
    const prodRows = el('div', 'prod-rows');
    const prodNote = el('p', 'prod-note');
    const prodMachines = el('p', 'prod-machines');
    prodPanel.append(el('span', 'con-label', 'Production · per minute'), prodHead, prodRows, prodMachines, prodNote);
    root.appendChild(prodPanel);
    let prodSig = '';
    const STATUS_WORDS = { working: 'working', input: 'waiting', blocked: 'blocked', slow: 'slowed', tripped: 'no power', fuel: 'no coal', off: 'off', locked: 'locked' };
    function renderProduction(prod) {
        if (!prod) {
            prodRows.textContent = '';
            prodNote.textContent = 'Measuring…';
            return;
        }
        const sig = JSON.stringify(prod);
        if (sig === prodSig) return;
        prodSig = sig;
        prodRows.innerHTML = '';
        const fmt = (n) => (n >= 10 ? Math.round(n) : n >= 0.05 ? n.toFixed(1) : '·');
        for (const r of prod.rows) {
            const row = el('div', 'prod-row');
            // Short: more is used or sold than made (buffers and belts are draining).
            if (r.used + r.sold > r.made * 1.05 + 0.5) row.classList.add('short');
            else if (r.made > (r.used + r.sold) * 1.25 + 2) row.classList.add('surplus');
            row.append(el('span', 'prod-item', ITEM_NAMES[r.item] ?? r.item), el('span', null, fmt(r.made)), el('span', null, fmt(r.used)), el('span', null, fmt(r.sold)));
            prodRows.appendChild(row);
        }
        if (!prod.rows.length) prodRows.appendChild(el('p', 'prod-note', 'Nothing made yet.'));
        prodMachines.textContent = Object.entries(prod.counts)
            .filter(([, n]) => n > 0)
            .map(([code, n]) => `${n} ${STATUS_WORDS[code] ?? code}`)
            .join(' · ') || 'No machines yet';
        prodNote.textContent = 'Red: more used than made. Mustard: piling up. Measured over the last minute.';
    }

    // ---- Alerts list (top bar → Alerts, or N) ---------------------------------------------
    // Rows are kept per group and updated in place, so a click never lands on a rebuilt button.
    const alertsPanel = el('div', 'alerts-panel hidden');
    const alertsRows = el('div', 'al-rows');
    const alertsNone = el('p', 'prod-note', BUILD_HELP.alerts.none);
    alertsPanel.append(el('span', 'con-label', BUILD_HELP.alerts.title), alertsRows, alertsNone, el('p', 'prod-note al-foot', BUILD_HELP.alerts.foot));
    const alertRows = new Map(); // group key → { row, label, n }
    function alertText(g) {
        const A = BUILD_HELP.alerts;
        switch (g.kind) {
            case 'input': return A.input((g.items ?? []).map((k) => ITEM_NAMES[k] ?? k).join(', '));
            case 'brownout': return A.brownout(g.pct);
            case 'order': return A.order(g.left, g.got, g.need, ITEM_NAMES[g.item] ?? g.item);
            default: return A[g.kind] ?? g.kind;
        }
    }
    function renderAlerts(groups) {
        const keep = new Set(groups.map((g) => g.key));
        for (const [key, r] of alertRows) {
            if (!keep.has(key)) {
                r.row.remove();
                alertRows.delete(key);
            }
        }
        groups.forEach((g, i) => {
            let r = alertRows.get(g.key);
            if (!r) {
                const row = el('button', `al-row${g.quiet ? ' quiet' : ''}`);
                row.type = 'button';
                row.dataset.kind = g.kind;
                const label = el('span', 'al-label');
                const n = el('span', 'al-n');
                row.append(el('i', 'al-dot'), label, n);
                row.addEventListener('click', () => {
                    if (onAlert(g.key)) return;
                    // No machine to go to (the breaker, a brownout): point at the power gauge.
                    bump(powerCell, 'pinged', 900);
                    toast(BUILD_HELP.alerts.gauge);
                });
                r = { row, label, n };
                alertRows.set(g.key, r);
            }
            r.label.textContent = alertText(g);
            r.n.textContent = g.cells.length && g.kind !== 'order' ? BUILD_HELP.alerts.machines(g.cells.length) : '';
            if (alertsRows.children[i] !== r.row) alertsRows.insertBefore(r.row, alertsRows.children[i] ?? null);
        });
        alertsNone.classList.toggle('hidden', groups.length > 0);
    }

    // (The Sound panel lives in Settings → Audio now: settingsPanel.js.)

    // ---- Phase ribbon -------------------------------------------------------------
    const ribbon = el('div', 'ribbon');
    const ribbonKicker = el('span', 'ribbon-kicker');
    const ribbonTitle = el('span', 'ribbon-title');
    const ribbonExtra = el('span', 'ribbon-extra');
    ribbon.append(ribbonKicker, ribbonTitle, ribbonExtra);
    root.appendChild(ribbon);
    let celebrating = false;
    let celebrateTimer = null;

    // ---- Console --------------------------------------------------------------------
    const con = el('aside', 'console');
    const head = el('div', 'con-head');
    const patchBox = el('span', 'con-patch');
    const headText = el('div', 'con-headtext');
    const headTitle = el('span', 'con-title', GAME_TITLE);
    const headSub = el('span', 'con-sub');
    headText.append(headTitle, headSub);
    head.append(patchBox, headText);

    const reqSec = el('div', 'con-sec');
    const reqList = el('div', 'req-list');
    const unlockLine = el('span', 'con-note');
    reqSec.append(reqList, unlockLine);
    /** @type {Record<string, {count: HTMLElement, fill: HTMLElement, n: number}>} */
    let reqRows = {};

    const planSec = el('div', 'con-sec');
    const planList = el('ul', 'plan');
    planSec.append(el('span', 'con-label', 'Flight plan'), planList);
    let planSig = null;

    const researchSec = el('div', 'con-sec');
    const researchPoints = el('span', 'con-points');
    const techGrid = el('div', 'tech-grid');
    researchSec.append(el('span', 'con-label', 'Research'), researchPoints, techGrid);
    const techButtons = {};
    for (const id of Object.keys(TECH_TEXT)) {
        const b = el('button', 'tech');
        b.type = 'button';
        b.title = TECH_TEXT[id].desc;
        b.innerHTML = '<span class="tech-name"></span><span class="tech-cost"></span>';
        b.querySelector('.tech-name').textContent = TECH_TEXT[id].label;
        b.addEventListener('click', () => {
            if (!onUnlock(id)) cue('deny');
        });
        techButtons[id] = b;
        techGrid.appendChild(b);
    }

    const orderSec = el('div', 'con-sec con-order');
    const orderTitle = el('span', 'con-label');
    const orderDemand = el('span', 'order-demand');
    const orderProgress = el('span', 'order-progress');
    orderSec.append(orderTitle, orderDemand, orderProgress);

    con.append(head, reqSec, planSec, researchSec, orderSec);
    root.appendChild(con);

    // ---- Codex (over the console while it is open; the game keeps running) -------------------------
    const codex = createCodexPanel({
        root, icons, itemIcons, cue,
        brand: () => brandFor(brandPhase, brandEnding, brandCompany).name,
        keyLabel: () => kl('codex'),
    });

    // ---- Keys -------------------------------------------------------------------------
    const keys = el('div', 'keys');
    const toolButtons = {};
    for (const [tool] of BUILD_DEFS) {
        toolButtons[tool] = hwKey({
            k: kl(tool), label: `${BUILDING_NAMES[tool]}, key ${kl(tool)}`, iconPath: ICON[tool], img: icons[tool] ?? null,
            onClick: () => onToolChange(tool),
        });
        keys.appendChild(toolButtons[tool]);
        if (tool === 'merger') keys.appendChild(el('span', 'keys-divider')); // logistics | production
    }
    keys.appendChild(el('span', 'keys-divider'));
    toolButtons.upgrade = hwKey({ k: kl('upgrade'), label: `Upgrade, key ${kl('upgrade')}`, iconPath: ICON.upgrade, img: icons.upgrade ?? null, sub: 'UPGRADE', cls: 'edit', onClick: () => onToolChange('upgrade') });
    toolButtons.erase = hwKey({ k: kl('erase'), label: `Demolish, key ${kl('erase')}`, iconPath: ICON.erase, img: icons.erase ?? null, sub: 'DEMOLISH', cls: 'edit', onClick: () => onToolChange('erase') });
    toolButtons.select = hwKey({ k: kl('select'), label: `Select, key ${kl('select')}`, iconPath: ICON.select, img: icons.select ?? null, sub: 'SELECT', cls: 'edit', onClick: () => onToolChange('select') });
    const rotateKey = hwKey({ k: kl('rotate'), label: `Rotate, ${kl('rotate')}`, iconPath: ICON.rotate, img: icons.rotate ?? null, sub: 'ROTATE', cls: 'edit', onClick: onRotate });
    keys.append(toolButtons.upgrade, toolButtons.erase, toolButtons.select, rotateKey);
    /** New key bindings (Settings → Controls): relabel the keycaps and the Keys popover. */
    function setKeys(map) {
        keysBound = { ...map };
        const all = { ...toolButtons, rotate: rotateKey };
        for (const [action, btn] of Object.entries(all)) {
            btn.querySelector('.hwkey-k').textContent = kl(action);
            const name = action === 'rotate' ? 'Rotate' : action === 'erase' ? 'Demolish' : action === 'upgrade' ? 'Upgrade' : action === 'select' ? 'Select' : BUILDING_NAMES[action];
            btn.setAttribute('aria-label', `${name}, key ${kl(action)}`);
        }
        renderHelp();
        selSig = '';
        codexBtn.title = `${CODEX.title} · ${kl('codex')}`;
        codex.refresh();
    }

    // ---- Selection bar: what's selected, and what you can do with it ----------------------
    const selbar = el('div', 'selbar hidden');
    root.appendChild(selbar);
    let selSig = '';
    function renderSelection(sel) {
        const sig = sel ? JSON.stringify(sel) : '';
        if (sig === selSig) return;
        selSig = sig;
        selbar.classList.toggle('hidden', !sel);
        if (!sel) return;
        selbar.innerHTML = '';
        const what = `${sel.count} machine${sel.count === 1 ? '' : 's'}`;
        const info = el('span', 'sel-info');
        const button = (label, key, action, cls = '') => {
            const b = el('button', `sel-btn ${cls}`);
            b.type = 'button';
            b.append(el('b', null, label), el('span', null, key));
            b.addEventListener('click', () => onGroupAction(action));
            return b;
        };
        if (!sel.mode) {
            info.textContent = `${what} selected`;
            selbar.append(info, button('Move', kl('move'), 'move'), button('Copy', kl('copy'), 'copy'), button('Save as blueprint', kl('blueprints'), 'blueprint', 'bp'), button('Demolish', kl('erase'), 'remove', 'danger'), button('Deselect', 'Esc', 'cancel'));
            return;
        }
        const fits = sel.ok === null ? '' : sel.ok ? '' : sel.blocked ? ` · ${sel.blocked} won't fit here` : ' · not enough credits';
        info.textContent = sel.mode === 'move'
            ? `Moving ${what} · click to set down · ${kl('rotate')} turns${fits}`
            : sel.blueprint ? `Blueprint “${sel.blueprint}” · CR ${sel.cost ?? '–'} · click to build · ${kl('rotate')} turns${fits}`
            : `Copying ${what} · CR ${sel.cost ?? '–'} a copy · click to place · ${kl('rotate')} turns${fits}`;
        info.classList.toggle('bad', sel.ok === false);
        selbar.append(info, button(sel.mode === 'move' ? 'Cancel' : 'Done', 'Esc', 'cancel'));
    }
    root.appendChild(keys);

    // ---- Comms (DELTA) --------------------------------------------------------------------
    const comms = el('div', 'comms idle');
    const portrait = el('div', 'comms-portrait');
    const body = el('div', 'comms-body');
    const commsHead = el('div', 'comms-head');
    const commsName = el('span', 'comms-name');
    const commsRole = el('span', 'comms-role');
    const commsMore = el('span', 'comms-more');
    commsHead.append(commsName, commsRole, commsMore);
    const commsText = el('div', 'comms-text');
    body.append(commsHead, commsText);
    const logBtn = el('button', 'comms-log-btn', 'Log');
    logBtn.type = 'button';
    const logPanel = el('div', 'comms-log hidden');
    comms.append(portrait, body, logBtn, logPanel);
    root.appendChild(comms);

    const queue = [];
    const log = [];
    let current = null;
    let typeTimer = null;
    let holdTimer = null;
    let transmitting = false; // a transmission is open (Quindar tone at start and end)
    let voiceEnds = 0;        // performance.now() when the current line's voice clip ends, 0 = no voice

    function speaker(line) {
        const b = brandFor(brandPhase, brandEnding, brandCompany);
        const evil = brandPhase >= 4 && !b.own;
        if (line.who === 'nile') return { name: `${b.name} BROADCAST`, role: 'Office of Planetary Continuity', svg: broadcastSVG(evil) };
        if (line.who === 'memo') return { name: 'INTERCEPTED MEMO', role: `not for ${b.player} eyes`, svg: memoSVG() };
        if (line.who === 'boss') return { name: BOSS.name.toUpperCase(), role: BOSS.title, svg: bossSVG() };
        return { name: AI.name, role: b.own ? `co-founder · ${b.full}` : `${b.name} dispatch AI`, svg: deltaSVG(line.mood) };
    }

    // Typing is time-based (so a throttled timer can't slow DELTA down), then
    // the finished line lingers long enough to read before the next one.
    const CHARS_PER_MS = 0.07;
    const lingerMs = (text) => Math.min(6500, 1000 + text.length * 30) / Math.min(2, Math.max(0.6, textSpeed));

    function stopTimers() {
        clearInterval(typeTimer);
        clearTimeout(holdTimer);
        typeTimer = null;
        holdTimer = null;
    }
    function finishTyping() {
        stopTimers();
        commsText.textContent = current.text;
        // With a voice clip the line stays up until DELTA has finished saying it.
        const voiceLeft = voiceEnds ? Math.max(0, voiceEnds - performance.now()) : 0;
        if (!voiceLeft) comms.classList.remove('speaking');
        holdTimer = setTimeout(endLinger, voiceEnds ? Math.max(900, voiceLeft + 650) : lingerMs(current.text));
    }
    function endLinger() {
        stopTimers();
        sound?.lineStop();
        voiceEnds = 0;
        if (queue.length) nextLine();
        else {
            comms.classList.add('idle');
            comms.classList.remove('speaking');
            if (transmitting) sound?.commsIdle();
            transmitting = false;
        }
    }
    function nextLine() {
        stopTimers();
        current = queue.shift() ?? null;
        updateMore();
        if (!current) {
            comms.classList.add('idle');
            return;
        }
        const fresh = !transmitting;
        transmitting = true;
        const who = speaker(current);
        comms.className = `comms who-${current.who} mood-${current.mood ?? 'neutral'} speaking`;
        portrait.innerHTML = who.svg;
        portrait.classList.remove('pop');
        void portrait.offsetWidth; // restart the pop animation
        portrait.classList.add('pop');
        commsName.textContent = who.name;
        commsRole.textContent = who.role;
        commsText.textContent = '';
        const voiceMs = sound?.lineStart(current, { fresh }) ?? null;
        const start = performance.now();
        voiceEnds = voiceMs ? start + voiceMs : 0;
        // Text types along with the voice (a little ahead of it); without one, at reading pace.
        const rate = voiceMs ? current.text.length / Math.max(300, voiceMs * 0.85) : CHARS_PER_MS * textSpeed;
        typeTimer = setInterval(() => {
            const typed = Math.floor((performance.now() - start) * rate);
            commsText.textContent = current.text.slice(0, typed);
            if (typed >= current.text.length) finishTyping();
        }, 30);
    }
    function updateMore() {
        commsMore.textContent = queue.length ? `${queue.length} queued · click to skip` : '';
    }
    function say(line) {
        queue.push(line);
        log.push({ ...line, label: speaker(line).name }); // header as it was when said
        if (log.length > 80) log.shift();
        if (!typeTimer && !holdTimer && !cinematic) nextLine();
        else updateMore();
    }
    /** Still mid-conversation (typing, lingering or with lines queued)? The ending counts as busy. */
    const isBusy = () => cinematic || !!typeTimer || !!holdTimer || queue.length > 0;

    comms.addEventListener('click', (e) => {
        if (e.target === logBtn || logPanel.contains(e.target)) return;
        if (typeTimer) finishTyping();
        else if (holdTimer) endLinger();
    });
    logBtn.addEventListener('click', () => {
        logPanel.classList.toggle('hidden');
        cue(logPanel.classList.contains('hidden') ? 'close' : 'open');
        if (logPanel.classList.contains('hidden')) return;
        logPanel.innerHTML = '';
        for (const line of log) {
            const p = el('p', `log-line who-${line.who}`);
            p.appendChild(el('b', null, `${line.label}  `));
            p.appendChild(document.createTextNode(line.text));
            logPanel.appendChild(p);
        }
        logPanel.scrollTop = logPanel.scrollHeight;
    });

    // ---- Tooltip + toast -----------------------------------------------------------------
    const tip = el('div', 'tooltip hidden');
    const tipTitle = el('span', 'tip-title');
    const tipBody = el('span', 'tip-body');
    tip.append(tipTitle, tipBody);
    root.appendChild(tip);

    // ---- Machine panel (click a machine) -------------------------------------------------
    const mp = el('div', 'mpanel hidden');
    root.appendChild(mp);
    root.appendChild(alertsPanel); // after the panel: it steps aside when the panel is open (CSS)
    let mpSig = null;
    let mpRefs = {};
    const itemName = (k) => ITEM_NAMES[k] ?? k;
    const perMin = (n) => (n >= 10 ? Math.round(n) : Number(n.toFixed(1)));
    const STATUS_TEXT = {
        working: 'Working',
        input: 'Waiting for',
        blocked: 'Output blocked · nothing takes the product',
        tripped: 'No power · breaker tripped',
        slow: 'Slowed by a brownout',
        fuel: 'No coal',
        off: 'Switched off',
        locked: 'Recipe needs research',
        idle: 'Idle',
    };
    const recipeText = (r) => {
        const ins = Object.entries(r.inputs).map(([k, n]) => `${n}× ${itemName(k)}`).join(' + ');
        return `${ins} → ${r.output ? itemName(r.output) : RECIPE_NAMES[r.id] ?? r.id}`;
    };
    function rateRows(rates, throttle) {
        const box = el('div', 'mp-rates');
        const row = (label, name, value) => {
            const r = el('div', 'mp-rate');
            r.append(el('span', 'mp-k', label), el('span', 'mp-item', name), el('span', 'mp-v', value));
            box.appendChild(r);
        };
        for (const [k, n] of Object.entries(rates.inPerMin ?? {})) row('In', itemName(k), `${perMin(n)}/min`);
        for (const [k, n] of Object.entries(rates.outPerMin ?? {})) row('Out', itemName(k), `${perMin(n)}/min`);
        if (rates.points) row('Out', 'Research points', `${perMin(rates.points)}/min`);
        if (rates.kw > 0) row('Power', `draws ${rates.kw} kW`, throttle < 0.999 ? `at ${Math.round(throttle * 100)}%` : '');
        if (rates.kw < 0) row('Power', `supplies ${-rates.kw} kW`, '');
        return box;
    }
    /** Ratios (ratios.js): how many suppliers keep this machine busy, how many machines it keeps busy. */
    function ratioRows(ratios) {
        const R = BUILD_HELP.ratios;
        const sec = el('div', 'mp-sec mp-ratios');
        sec.appendChild(el('span', 'con-label', R.title));
        const row = (label, item, texts) => {
            const r = el('div', 'mp-ratio');
            const v = el('span', 'mp-v');
            texts.forEach((t, i) => {
                if (i) v.appendChild(el('span', 'mp-or', ` ${R.or} `));
                v.appendChild(el('span', null, t));
            });
            r.append(el('span', 'mp-k', label), el('span', 'mp-item', itemName(item)), v);
            sec.appendChild(r);
        };
        for (const { item, options } of ratios.needs) row(R.needs, item, options.map((o) => R.supply(o.n, o.type, o.tier)));
        for (const { item, options } of ratios.feeds) row(R.feeds, item, options.map((o) => R.feed(o.n, o.type, o.tier, o.product ? itemName(o.product) : null)));
        sec.appendChild(el('p', 'mp-note', R.note));
        return sec;
    }
    function buildPanel(sel) {
        mp.innerHTML = '';
        mpRefs = {};
        const head = el('div', 'mp-head');
        if (icons[sel.type]) {
            const img = el('img', 'mp-img');
            img.src = icons[sel.type];
            img.alt = '';
            head.appendChild(img);
        }
        const titles = el('div', 'mp-titles');
        const name = el('span', 'mp-title', BUILDING_NAMES[sel.type] ?? sel.type);
        if (sel.tier) name.appendChild(el('span', 'mp-tier', `T${sel.tier}`));
        const status = el('span', 'mp-status');
        titles.append(name, status);
        const close = el('button', 'mp-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close panel');
        close.addEventListener('click', () => {
            cue('close');
            onDeselect();
        });
        const toCodex = el('button', 'mp-codex');
        toCodex.type = 'button';
        toCodex.title = `${CODEX.link} · ${BUILDING_NAMES[sel.type] ?? sel.type}`;
        toCodex.setAttribute('aria-label', toCodex.title);
        toCodex.innerHTML = iconSVG(ICON.book, 15);
        toCodex.addEventListener('click', () => codex.open(`building:${sel.type}`));
        head.append(titles, toCodex, close);
        mp.appendChild(head);
        mpRefs.status = status;

        if (sel.type === 'sink') {
            const sec = el('div', 'mp-sec');
            sec.appendChild(el('span', 'con-label', 'Market · credits per item'));
            mpRefs.market = {};
            for (const m of sel.market) {
                const r = el('div', 'mp-market');
                const bar = el('div', 'mp-mbar');
                const fill = el('div', 'mp-mfill');
                bar.appendChild(fill);
                const price = el('span', 'mp-v');
                r.append(el('span', 'mp-item', itemName(m.item)), bar, price);
                sec.appendChild(r);
                mpRefs.market[m.item] = { fill, price };
            }
            sec.appendChild(el('p', 'mp-note', 'Every sale lowers that item’s price; prices recover over time. Priority Requests pay their bonus in full.'));
            mp.appendChild(sec);
            return;
        }

        if (sel.recipes?.length) {
            const sec = el('div', 'mp-sec');
            sec.appendChild(el('span', 'con-label', 'Recipe'));
            mpRefs.recipeSec = sec;
            mpRefs.recipeBtns = {};
            for (const r of sel.recipes) {
                const b = el('button', `mp-recipe${r.active ? ' active' : ''}${r.unlocked ? '' : ' locked'}`);
                b.type = 'button';
                b.appendChild(el('span', null, recipeText(r)));
                if (!r.unlocked) b.appendChild(el('span', 'mp-lock', 'Research'));
                else if (r.active) b.appendChild(el('span', 'mp-lock', 'Active'));
                b.addEventListener('click', () => {
                    if (r.active) return;
                    if (!onSetRecipe(r.id)) cue('deny');
                });
                mpRefs.recipeBtns[r.id] = b;
                sec.appendChild(b);
            }
            mp.appendChild(sec);
        }

        if (sel.rates) {
            const sec = el('div', 'mp-sec');
            sec.appendChild(el('span', 'con-label', 'Per minute · full power'));
            sec.appendChild(rateRows(sel.rates, sel.throttle));
            const holds = el('p', 'mp-note');
            sec.appendChild(holds);
            mpRefs.holds = holds;
            mp.appendChild(sec);
        }
        if (sel.ratios) mp.appendChild(ratioRows(sel.ratios));

        const actions = el('div', 'mp-actions');
        if (sel.upgrade) {
            const up = el('button', 'mp-btn mp-up');
            up.type = 'button';
            const gain = sel.upgrade.gain ? ` · ${sel.upgrade.gain}` : '';
            up.append(el('b', null, `Upgrade → T${sel.tier + 1}`), el('span', null, `CR ${sel.upgrade.cost}${gain}`));
            up.addEventListener('click', () => {
                if (!onUpgradeSelected()) cue('deny');
            });
            actions.appendChild(up);
            mpRefs.up = up;
        } else if (sel.tierCap) {
            actions.appendChild(el('span', 'mp-note', sel.tierCap));
        }
        if (sel.canToggle) {
            const tg = el('button', 'mp-btn mp-toggle', sel.off ? 'Switch on' : 'Switch off');
            tg.type = 'button';
            tg.addEventListener('click', () => onToggleSelected());
            actions.appendChild(tg);
        }
        if (actions.childNodes.length) mp.appendChild(actions);
    }
    function updatePanel(sel, money) {
        if (!sel) {
            if (!mp.classList.contains('hidden')) mp.classList.add('hidden');
            mpSig = null;
            return;
        }
        if (mp.classList.contains('hidden')) {
            for (const pnl of [help, prodPanel]) pnl.classList.add('hidden');
            mp.classList.remove('hidden');
        }
        if (sel.sig !== mpSig) {
            mpSig = sel.sig;
            buildPanel(sel);
        }
        const st = sel.status ?? { code: 'idle' };
        let text = STATUS_TEXT[st.code] ?? st.code;
        if (st.code === 'input') text += ' ' + (st.missing ?? []).map(itemName).join(', ');
        if (st.code === 'slow') text += ` · ${Math.round((sel.throttle ?? 1) * 100)}%`;
        if (sel.type === 'sink') text = sel.infinite ? 'Buys goods at market prices' : 'Takes deliveries for the cannon and buys goods';
        mpRefs.status.textContent = text;
        mpRefs.status.dataset.code = sel.type === 'sink' ? 'working' : st.code;
        if (mpRefs.holds) {
            const buf = Object.entries(sel.buffer ?? {}).filter(([, n]) => n > 0);
            mpRefs.holds.textContent = buf.length ? 'Holds ' + buf.map(([k, n]) => `${itemName(k)} ×${n}`).join(', ') : 'Holds nothing yet';
        }
        if (mpRefs.up) mpRefs.up.classList.toggle('broke', money < sel.upgrade.cost);
        if (mpRefs.market) {
            for (const m of sel.market) {
                const ref = mpRefs.market[m.item];
                if (!ref) continue;
                const frac = m.base ? m.price / m.base : 0;
                ref.fill.style.width = `${Math.round(frac * 100)}%`;
                ref.fill.dataset.low = frac < 0.5 ? '1' : '';
                ref.price.textContent = `${m.price >= 10 ? Math.round(m.price) : m.price.toFixed(1)} / ${m.base}`;
            }
        }
    }

    const toastEl = el('div', 'toast');
    root.appendChild(toastEl);
    let toastTimer = null;
    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.remove('show');
        void toastEl.offsetWidth;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
    }

    /** Phase completion: the ribbon swells into a banner for a few seconds. */
    function showBanner(phaseIndex) {
        const unlocks = PHASES[phaseIndex]?.unlocks ?? [];
        celebrating = true;
        ribbon.classList.add('celebrate');
        // A warm flash at the edges of the screen with the stinger.
        const flash = el('div', 'phase-flash');
        root.appendChild(flash);
        setTimeout(() => flash.remove(), 1600);
        ribbonKicker.textContent = `Phase ${pad2(phaseIndex + 1)} · accomplished`;
        ribbonTitle.textContent = PHASE_TEXT[phaseIndex]?.title ?? '';
        ribbonExtra.textContent = unlocks.length ? `New · ${unlocks.map((t) => BUILDING_NAMES[t]).join(' · ')}` : '';
        clearTimeout(celebrateTimer);
        celebrateTimer = setTimeout(() => {
            celebrating = false;
            ribbon.classList.remove('celebrate');
            phaseShown = -1; // redraw the ribbon for the current phase
            phaseSig = '';
        }, 5500);
    }

    // ---- Title screen + ending (full-screen overlays) ----------------------------------------
    function showTitle({ hasSave, onNew, onResume }) {
        const overlay = el('div', 'overlay title-screen');
        const lockup = el('div', 'lockup');
        const lockMark = el('span', 'lockup-mark');
        lockMark.innerHTML = markSVG(false, 54);
        const lockText = el('div', 'lockup-text');
        lockText.append(el('span', 'lockup-word', BRAND.nile.name), el('span', 'lockup-full', BRAND.nile.full), el('span', 'lockup-motto', BRAND.nile.motto));
        lockup.append(lockMark, lockText);

        const card = el('div', 'title-card');
        const patch = el('div', 'title-patch');
        patch.innerHTML = patchSVG(false, 176);
        const begin = el('button', 'btn-primary', 'Begin onboarding');
        begin.type = 'button';
        begin.addEventListener('click', () => {
            if (hasSave && !confirm('Start a new contract? Your saved contract will be overwritten.')) return;
            overlay.remove();
            onNew();
        });
        const resume = el('button', 'btn-secondary', 'Resume contract');
        resume.type = 'button';
        resume.disabled = !hasSave;
        resume.addEventListener('click', () => {
            overlay.remove();
            onResume();
        });
        const actions = el('div', 'title-actions');
        actions.append(begin, resume);
        card.append(
            patch,
            el('h1', 'title-game', GAME_TITLE),
            el('p', 'title-byline', BRAND.nile.byline),
            el('p', 'title-pitch', 'The Moon is falling. NILE has a plan. You are the plan.'),
            actions,
            el('p', 'fine-print', `By clicking Begin you accept the ${BRAND.nile.name} ${BRAND.nile.player} Agreement (4,812 pages), including Clause 88.`),
        );
        overlay.append(lockup, card);
        document.body.appendChild(overlay);
        begin.focus();
    }

    // ---- The ending: a choice, a cinematic in the world, then the report -----------------------
    // First the player picks the target (CHOICE). Moon timeline (seconds): letterbox and a cut to
    // the cannon (0), countdown and charge (0–3), the shot (3.0), the Moon breaks and the sky turns
    // (3.15), Moon+ switches on (6.0). NIHIL HQ timeline: the same countdown, the shell lands at
    // `hit` (HQ_FLIGHT_MS after the shot), dawn comes at `dawn`. Either way the closing lines run
    // as subtitles, each waiting for the previous voice clip, then the report (and for NIHIL HQ,
    // first: naming your company). audio.js plays the score on the same times.
    const END = { fire: 3.0, hit: 3.15, ad: 6.0, report: 20.0, lines: [0.3, 7.0, 10.4, 13.8, 17.2] };
    const END_HQ = { fire: 3.0, hit: 3.0 + HQ_FLIGHT_MS / 1000, dawn: 5.8, report: 22.0, lines: [0.3, 5.0, 8.4, 11.6, 14.6, 18.0] };

    /**
     * @param {{ stats: any, onChoose?: (kind: 'moon'|'hq') => void, onFound?: (name: string) => void,
     *   onContinue: () => void, onNewGame: () => void, decided?: 'moon'|'hq'|null,
     *   stage?: { lookAtCannon(): void, start(opts: { radius: number, top: number, target?: string }): {x:number,y:number}|null,
     *             charge(level: number): void, fire(opts?: { target?: string }): void, muzzle(): {x:number,y:number}, end(): void } }} opts
     */
    function showEnding({ stats: s, onChoose, onFound, onContinue, onNewGame, stage, decided = null }) {
        cinematic = true;
        // Whatever DELTA was saying waits until after the ending.
        if (current && (typeTimer || holdTimer)) {
            stopTimers();
            sound?.lineStop();
            queue.unshift(current);
        }
        comms.classList.add('idle');
        document.body.classList.add('cinematic');
        skyOverride = 4;
        document.body.dataset.phase = '4';

        const vr = view.getBoundingClientRect();
        const vmin = Math.min(vr.width, vr.height);
        const lb = el('div', 'letterbox');
        const top = el('div', 'lb-bar lb-top');
        const caption = el('span', 'lb-caption', CHOICE.kicker);
        const clock = el('span', 'lb-clock', '');
        top.append(caption, clock);
        const bottom = el('div', 'lb-bar lb-bottom');
        const subWho = el('span', 'lb-who');
        const subText = el('span', 'lb-text');
        bottom.append(subWho, subText);
        lb.append(top, bottom);
        const catcher = el('div', 'end-catch done'); // a click anywhere skips (once the shot is under way)
        document.body.append(catcher, lb);
        requestAnimationFrame(() => lb.classList.add('in'));
        // Sky effects: the Moon's pieces behind the 3D canvas, the beam and the flash in front.
        const back = el('div', 'end-fx end-back');
        view.insertBefore(back, view.querySelector('canvas'));
        const front = el('div', 'end-fx end-front');
        view.appendChild(front);
        const local = (p) => ({ x: p.x - vr.left, y: p.y - vr.top });

        const timers = [];
        const at = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
        let countdown = null;
        let kind = decided;
        let panel = null; // the choice / company panel on screen
        let report = null;
        let skip = () => {};

        function subtitle(line) {
            subWho.textContent = line.who === 'nile'
                ? `${BRAND.nihil.name} BROADCAST`
                : line.who === 'boss' ? BOSS.name.toUpperCase() : AI.name;
            subWho.className = `lb-who who-${line.who}`;
            subText.textContent = line.text;
            bottom.classList.remove('show');
            void bottom.offsetWidth;
            bottom.classList.add('show');
        }
        /** Start times for lines (no earlier than `earliest`), each waiting for the previous voice clip. */
        function spaceLines(lines, earliest) {
            const times = [];
            let free = 0;
            lines.forEach((line, i) => {
                const ms = sound?.clipMs?.(line);
                const t = Math.max(earliest[i] ?? 3 + 3 * i, free);
                times.push(t);
                free = t + (ms ? ms / 1000 + 0.35 : 3.2);
            });
            return { times, free };
        }
        function startCountdown(t0) {
            countdown = setInterval(() => {
                const t = (performance.now() - t0) / 1000;
                if (t >= END.fire) return clearInterval(countdown);
                clock.textContent = `T−${(END.fire - t).toFixed(1).padStart(4, '0')}`;
                stage?.charge(t / END.fire);
            }, 50);
        }

        // ---- 1. The choice --------------------------------------------------------------
        function showChoice() {
            stage?.lookAtCannon?.();
            panel = el('div', 'end-choice');
            panel.append(el('span', 'ec-kicker', CHOICE.kicker), el('span', 'ec-title', CHOICE.title));
            const row = el('div', 'ec-row');
            for (const [k, key] of [['moon', '1'], ['hq', '2']]) {
                const b = el('button', `ec-btn ec-${k}`);
                b.type = 'button';
                b.append(el('span', 'ec-key', key), el('b', null, CHOICE[k].label), el('span', 'ec-note', CHOICE[k].note));
                b.addEventListener('click', () => pick(k));
                row.appendChild(b);
            }
            panel.appendChild(row);
            document.body.appendChild(panel);
            requestAnimationFrame(() => panel.classList.add('in'));
            // Nolan and DELTA weigh in while you decide.
            let t = 0.8;
            for (const line of CHOICE.lines) {
                const when = t;
                at(when, () => {
                    subtitle(line);
                    sound?.lineStart?.(line, { fresh: false });
                });
                t = when + (sound?.clipMs?.(line) ?? 2600) / 1000 + 0.6;
            }
            window.addEventListener('keydown', onChoiceKey, true);
        }
        function onChoiceKey(e) {
            if (e.key === '1' || e.key === '2') {
                e.preventDefault();
                e.stopPropagation();
                pick(e.key === '1' ? 'moon' : 'hq');
            }
        }
        function pick(k) {
            if (kind) return;
            kind = k;
            window.removeEventListener('keydown', onChoiceKey, true);
            timers.forEach(clearTimeout);
            timers.length = 0;
            sound?.lineStop?.();
            cue('click');
            panel.classList.remove('in');
            const old = panel;
            setTimeout(() => old.remove(), 400);
            panel = null;
            onChoose?.(k);
            run();
        }
        function run() {
            catcher.classList.remove('done');
            if (kind === 'hq') runHQ();
            else runMoon();
        }

        // ---- 2a. The Moon ------------------------------------------------------------------
        function runMoon() {
            document.body.classList.add('moonplus-wait');
            caption.textContent = ENDING.caption;
            // Where the Moon hangs in the CSS sky, in page coordinates. The camera cuts to the
            // cannon and finds clear sky along the barrel; the Moon moves there under the cut.
            const cs = getComputedStyle(view);
            let moon = {
                x: vr.left + (vr.width * parseFloat(cs.getPropertyValue('--moon-x'))) / 100,
                y: vr.top + (vr.height * parseFloat(cs.getPropertyValue('--moon-y'))) / 100,
            };
            const aim = stage?.start({ radius: vmin * 0.066, top: vr.top + vr.height * 0.12 + vmin * 0.07 });
            if (aim) {
                moon = aim;
                view.style.setProperty('--moon-x', `${(((aim.x - vr.left) / vr.width) * 100).toFixed(2)}%`);
                view.style.setProperty('--moon-y', `${(((aim.y - vr.top) / vr.height) * 100).toFixed(2)}%`);
                document.body.classList.add('sky-cut'); // the sky's Moon jumps with the cut, not glides
                requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('sky-cut')));
            }
            let fired = false;
            let hitDone = false;
            startCountdown(performance.now());
            function fire(withBeam = true) {
                if (fired) return;
                fired = true;
                clearInterval(countdown);
                clock.textContent = ENDING.status.fire;
                stage?.fire();
                if (!withBeam) return;
                const m = local(stage?.muzzle() ?? moon);
                const target = local(moon);
                const beam = el('div', 'end-beam');
                beam.style.left = `${m.x}px`;
                beam.style.top = `${m.y}px`;
                beam.style.width = `${Math.hypot(target.x - m.x, target.y - m.y)}px`;
                beam.style.transform = `rotate(${Math.atan2(target.y - m.y, target.x - m.x)}rad)`;
                front.appendChild(beam);
            }
            function hit(withShards = true) {
                if (hitDone) return;
                hitDone = true;
                if (withShards) {
                    // The Moon breaks into wedges that tumble away, under a white flash.
                    const p = local(moon);
                    const pieces = el('div', 'moon-shards');
                    pieces.style.left = `${p.x}px`;
                    pieces.style.top = `${p.y}px`;
                    const n = 9;
                    for (let i = 0; i < n; i++) {
                        const a0 = (i / n) * Math.PI * 2 + 0.2;
                        const a1 = ((i + 1) / n) * Math.PI * 2 + 0.2;
                        const am = (a0 + a1) / 2;
                        const pt = (a) => `${(50 + 50 * Math.cos(a)).toFixed(1)}% ${(50 + 50 * Math.sin(a)).toFixed(1)}%`;
                        const shard = el('span', 'shard');
                        shard.style.clipPath = `polygon(50% 50%, ${pt(a0)}, ${pt(am)}, ${pt(a1)})`;
                        const dist = 18 + Math.random() * 22; // vmin
                        shard.style.setProperty('--tx', `${(Math.cos(am) * dist).toFixed(1)}vmin`);
                        shard.style.setProperty('--ty', `${(Math.sin(am) * dist + 6).toFixed(1)}vmin`);
                        shard.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 300)}deg`);
                        pieces.appendChild(shard);
                    }
                    pieces.appendChild(el('span', 'moon-ring'));
                    front.appendChild(pieces);
                    front.appendChild(el('div', 'end-flash'));
                }
                // The sky turns to the aftermath at once (the flash hides the cut).
                document.body.classList.add('sky-cut');
                skyOverride = null;
                document.body.dataset.phase = '5';
                requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('sky-cut')));
                clock.textContent = ENDING.status.hit;
            }
            function ad() {
                document.body.classList.remove('moonplus-wait'); // Moon+ flickers on (CSS)
                clock.textContent = ENDING.status.ad;
            }
            const { times, free } = spaceLines(ENDING.lines, END.lines);
            const reportAt = Math.max(END.report, free + 0.8);
            at(END.fire, () => fire());
            at(END.hit, () => hit());
            at(END.ad, ad);
            ENDING.lines.forEach((line, i) => at(times[i], () => subtitle(line)));
            at(reportAt, () => showReport());
            sound?.ending(ENDING.lines, times, { ...END, report: reportAt });
            skip = () => {
                fire(false);
                hit(false);
                ad();
                subtitle(ENDING.lines[ENDING.lines.length - 1]);
                showReport();
                sound?.endingSkip();
            };
        }

        // ---- 2b. NIHIL HQ ------------------------------------------------------------------
        function runHQ() {
            caption.textContent = ENDING_HQ.caption;
            stage?.start({ radius: vmin * 0.066, top: vr.top + vr.height * 0.12, target: 'hq' });
            let fired = false;
            let dawned = false;
            startCountdown(performance.now());
            function fire() {
                if (fired) return;
                fired = true;
                clearInterval(countdown);
                clock.textContent = ENDING_HQ.status.fire;
                stage?.fire({ target: 'hq' });
            }
            function hit() {
                front.appendChild(el('div', 'end-flash end-flash-warm'));
                clock.textContent = ENDING_HQ.status.hit;
            }
            function dawn() {
                if (dawned) return;
                dawned = true;
                skyOverride = null;
                document.body.dataset.phase = '6';
                document.body.classList.remove('evil');
                clock.textContent = ENDING_HQ.status.free;
            }
            const { times, free } = spaceLines(ENDING_HQ.lines, END_HQ.lines);
            const companyAt = Math.max(END_HQ.report, free + 0.8);
            at(END_HQ.fire, fire);
            at(END_HQ.hit, hit);
            at(END_HQ.dawn, dawn);
            ENDING_HQ.lines.forEach((line, i) => at(times[i], () => subtitle(line)));
            at(companyAt, showCompany);
            sound?.ending(ENDING_HQ.lines, times, { ...END_HQ, report: companyAt, variant: 'hq' });
            skip = () => {
                fire();
                dawn();
                subtitle(ENDING_HQ.lines[ENDING_HQ.lines.length - 1]);
                showCompany();
                sound?.endingSkip('hq');
            };
        }

        // ---- 3. Your company (NIHIL HQ only) ---------------------------------------------
        function showCompany() {
            if (panel || report) return;
            catcher.classList.add('done');
            const C = ENDING_HQ.company;
            panel = el('div', 'end-company');
            const input = el('input', 'ecp-input');
            input.type = 'text';
            input.maxLength = 28;
            input.placeholder = COMPANY.defaultName;
            input.setAttribute('aria-label', C.title);
            const confirm = el('button', 'btn-primary', C.confirm);
            confirm.type = 'button';
            panel.append(el('span', 'ec-kicker', C.kicker), el('span', 'ec-title', C.title), input, el('span', 'ec-note', C.hint), confirm);
            document.body.appendChild(panel);
            requestAnimationFrame(() => panel.classList.add('in'));
            setTimeout(() => input.focus(), 50);
            const found = () => {
                const name = input.value.trim().replace(/\s+/g, ' ') || COMPANY.defaultName;
                cue('click');
                onFound?.(name);
                panel.remove();
                panel = null;
                showReport(name);
            };
            confirm.addEventListener('click', found);
            input.addEventListener('keydown', (e) => {
                e.stopPropagation(); // typing a name must not trigger game keys
                if (e.key !== 'Enter') return;
                e.preventDefault(); // or the same Enter would press the report's first button
                found();
            });
        }

        // ---- 4. The report, in the console's style ----------------------------------------------
        function showReport(company = null) {
            if (report) return;
            const hq = kind === 'hq';
            const R = ENDING.report;
            const RH = ENDING_HQ.report;
            report = el('div', 'report');
            const head = el('div', 'rep-head');
            const patch = el('span', 'rep-patch');
            patch.innerHTML = hq ? companyMarkSVG(company ?? COMPANY.defaultName, 64) : patchSVG(true, 64, { text: false });
            const headText = el('div', 'rep-headtext');
            const sub = hq ? `${company ?? COMPANY.defaultName} · ${COMPANY.byline} · ${COMPANY.motto}` : `${GAME_TITLE} · ${BRAND.nihil.byline} · ${BRAND.nihil.motto}`;
            headText.append(el('span', 'rep-kicker', hq ? RH.kicker : R.kicker), el('span', 'rep-title', hq ? RH.title : R.title), el('span', 'rep-sub', sub));
            head.append(patch, headText);
            const grid = el('div', 'rep-grid');
            const stats = hq
                ? [['seconds', fmtTime(s.seconds)], ['delivered', s.delivered], ['machines', s.machines], ['moons', 0], ['hq', 1]]
                : [['seconds', fmtTime(s.seconds)], ['delivered', s.delivered], ['machines', s.machines], ['moons', 1], ['subscribers', R.subscribers]];
            for (const [key, value] of stats) {
                const cell = el('div', `rep-stat stat-${key}`);
                cell.append(el('span', 'rep-value', String(value)), el('span', 'rep-label', (hq ? RH.labels : R.labels)[key]));
                grid.appendChild(cell);
            }
            const actions = el('div', 'rep-actions');
            const keep = el('button', 'btn-primary', R.keep);
            keep.type = 'button';
            const credits = el('button', 'btn-secondary', R.credits);
            credits.type = 'button';
            const fresh = el('button', 'btn-secondary', R.fresh);
            fresh.type = 'button';
            actions.append(keep, credits, fresh);
            report.append(head, grid, el('p', 'rep-note', hq ? RH.note : R.note), actions);
            document.body.appendChild(report);
            catcher.classList.add('done');
            requestAnimationFrame(() => keep.focus()); // after any key that brought us here has finished
            keep.addEventListener('click', () => {
                finish();
                sound?.afterEnding(hq);
                onContinue();
            });
            credits.addEventListener('click', () => showCredits(kind));
            fresh.addEventListener('click', onNewGame);
        }

        catcher.addEventListener('click', () => {
            if (report || panel || !kind) return;
            timers.forEach(clearTimeout);
            skip();
        });

        function finish() {
            timers.forEach(clearTimeout);
            clearInterval(countdown);
            window.removeEventListener('keydown', onChoiceKey, true);
            lb.classList.remove('in');
            setTimeout(() => lb.remove(), 700);
            for (const n of [catcher, back, front, report, panel]) n?.remove();
            document.body.classList.remove('cinematic', 'moonplus-wait');
            view.style.removeProperty('--moon-x'); // Moon+ goes back to the Moon's usual spot in the sky
            view.style.removeProperty('--moon-y');
            skyOverride = null;
            cinematic = false;
            phaseSig = ''; // repaint the brand, the sky and the console for how it ended
            stage?.end();
            if (queue.length && !typeTimer && !holdTimer) nextLine();
        }

        if (kind) run();
        else showChoice();
    }

    /** The credits roll: console-style names rising up the screen; a click or Esc closes it. */
    function showCredits(kind = 'moon') {
        const roll = el('div', 'credits-roll');
        const inner = el('div', 'cr-inner');
        inner.appendChild(el('span', 'cr-title', CREDITS.title));
        for (const [heading, ...names] of CREDITS.sections) {
            const sec = el('div', 'cr-sec');
            sec.appendChild(el('span', 'cr-head', heading));
            names.forEach((n, i) => sec.appendChild(el('span', i === 0 ? 'cr-name' : 'cr-small', n)));
            inner.appendChild(sec);
        }
        inner.append(el('p', 'cr-end', CREDITS.end[kind === 'hq' ? 'hq' : 'moon']), el('p', 'cr-thanks', CREDITS.thanks));
        // The maker's badge closes the roll (menus.js MADE_BY).
        const badge = el('img', 'cr-made-by');
        badge.src = MADE_BY.src;
        badge.alt = MADE_BY.alt;
        inner.appendChild(badge);
        roll.appendChild(inner);
        document.body.appendChild(roll);
        cue('open');
        const close = () => {
            roll.remove();
            window.removeEventListener('keydown', onKey, true);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close();
            }
        };
        roll.addEventListener('click', close);
        window.addEventListener('keydown', onKey, true);
        inner.addEventListener('animationend', close);
    }

    // ---- Per-frame refresh -------------------------------------------------------------------
    /** Inspector text for a cell, or null when there's nothing worth showing. */
    /** Inspector text for a cell: what a machine takes and makes, what it holds, and how it's hooked up. */
    function describe(cell, io, ports) {
        if (!cell) return null;
        if (cell.blocked) return { title: 'Selene construction site', body: 'Reserved. Deliveries to the pad build the cannon here.' };
        const lines = [];
        let title = null;
        const names = (list) => list.map((k) => (ITEM_NAMES[k] ?? k).toUpperCase()).join(' · ');
        if (cell.machine) {
            const m = cell.machine;
            title = BUILDING_NAMES[m.type] ?? m.type;
            if (m.tier && !['sink', 'belt', 'splitter', 'merger'].includes(m.type)) title += `  T${m.tier}`;
            if (m.off) title += '  · OFF';
            if (m.type === 'extractor' && cell.resource) lines.push(`MAKES ${names([cell.resource])}`);
            if (io?.takes.length) lines.push(`TAKES ${names(io.takes)}`);
            if (io?.makes.length) lines.push(`MAKES ${names(io.makes)}`);
            if (m.type === 'splitter') lines.push('ROUTE 1 IN → 3 OUT, IN TURN');
            if (m.type === 'merger') lines.push('ROUTE 3 IN → 1 OUT, IN TURN');
            const buf = Object.entries(m.buffer || {}).filter(([, n]) => n > 0);
            if (buf.length) lines.push('HOLDS ' + buf.map(([k, n]) => `${(ITEM_NAMES[k] ?? k).toUpperCase()} ×${n}`).join(', '));
            if (m.type === 'generator') lines.push(m.fuelTicks > 0 ? `FUEL  ${m.fuelTicks} TICKS` : 'FUEL  EMPTY');
            // Hook-up state, matching the arrows in the world.
            const outs = (ports ?? []).filter((p) => p.kind === 'out');
            const ins = (ports ?? []).filter((p) => p.kind === 'in');
            if (outs.some((p) => p.blocked)) lines.push(`⚠ OUTPUT BLOCKED · ${(ITEM_NAMES[m.pendingOutput] ?? m.pendingOutput ?? '').toUpperCase()} WAITING`);
            else if (outs.length && !outs.some((p) => p.connected)) lines.push('OUT   NOT CONNECTED');
            if (ins.length && m.type !== 'sink') {
                const fed = ins.filter((p) => p.connected).length;
                lines.push(fed ? `IN    ${fed} OF ${ins.length} SIDES FED` : 'IN    NOTHING CONNECTED');
            }
        }
        if (cell.resource && !cell.machine) {
            title = 'Ore node';
            lines.push(`NODE ${ITEM_NAMES[cell.resource].toUpperCase()}`);
        }
        if (cell.item) lines.push(`ITEM ${(ITEM_NAMES[cell.item.type] ?? cell.item.type).toUpperCase()}`);
        if (cell.machine && !['belt', 'splitter', 'merger'].includes(cell.machine.type)) lines.push('CLICK FOR PANEL');
        if (title && entryForCell(cell)) lines.push(CODEX.tip(kl('codex')));
        return title ? { title, body: lines.join('\n') } : null;
    }

    function buildPhaseDom(phase, complete, ending = null, company = null) {
        phaseShown = phase;
        phaseSig = `${phase}|${ending}|${company}`;
        brandPhase = phase;
        brandEnding = ending;
        brandCompany = company;
        const free = ending === 'hq';
        const evil = phase >= 4 && !free;
        const b = brandFor(phase, ending, company);
        document.body.classList.toggle('evil', evil);
        // Sky layers (style.css): one per phase, the aftermath (5), or the freed valley's dawn (6).
        document.body.dataset.phase = String(skyOverride ?? (free ? 6 : Math.min(phase, 5)));
        brandMark.innerHTML = free ? companyMarkSVG(company, 28) : markSVG(evil, 28);
        brandWord.textContent = b.name;
        brandCell.title = `${b.name} · ${b.full} · ${b.motto}`;
        patchBox.innerHTML = free ? companyMarkSVG(company, 48) : patchSVG(evil, 48, { text: false });
        reqList.innerHTML = '';
        reqRows = {};
        const done = complete || phase >= PHASES.length;
        headSub.textContent = done ? `Complete · ${b.byline}` : `Phase ${pad2(phase + 1)}/${pad2(PHASES.length)} · ${b.byline}`;
        if (!celebrating) {
            ribbonKicker.textContent = done ? 'All phases complete' : `Phase ${pad2(phase + 1)} of ${pad2(PHASES.length)}`;
            ribbonTitle.textContent = done ? 'Selene has fired' : PHASE_TEXT[phase].title;
            ribbonExtra.textContent = '';
        }
        if (done) {
            unlockLine.textContent = free ? ENDING_HQ.report.note : 'The sky is now a subscription. Keep building, if you like.';
            return;
        }
        const def = PHASES[phase];
        for (const [item, n] of Object.entries(def.requires)) {
            const row = el('div', 'req');
            const name = el('span', 'req-name', ITEM_NAMES[item] ?? item);
            const count = el('span', 'req-count');
            const bar = el('div', 'req-bar');
            const fill = el('div', 'req-fill');
            bar.appendChild(fill);
            row.append(name, count, bar);
            reqList.appendChild(row);
            reqRows[item] = { row, count, fill, n, got: -1 };
        }
        unlockLine.textContent = def.unlocks.length
            ? `Unlocks · ${def.unlocks.map((t) => BUILDING_NAMES[t]).join(' · ')}`
            : phase === PHASES.length - 1 ? 'Completes Protocol: Selene' : PHASE_TEXT[phase].blurb;
    }

    // ---- Infinite: the land and licence shop in the console, instead of a phase's requirements ----
    let infSig = null;
    let infRefs = [];
    function buildInfiniteDom(inf) {
        phaseShown = -2;
        phaseSig = 'infinite';
        brandPhase = inf.visualPhase;
        brandEnding = null;
        brandCompany = null;
        const evil = inf.visualPhase >= 4;
        const b = brandFor(inf.visualPhase);
        document.body.classList.toggle('evil', evil);
        document.body.dataset.phase = String(skyOverride ?? Math.min(inf.visualPhase, 5));
        brandMark.innerHTML = markSVG(evil, 28);
        brandWord.textContent = b.name;
        brandCell.title = `${b.name} · ${b.full} · ${b.motto}`;
        patchBox.innerHTML = patchSVG(evil, 48, { text: false });
        headSub.textContent = `Infinite · ${INFINITE_TEXT.byline}`;
        if (!celebrating) {
            ribbonKicker.textContent = INFINITE_TEXT.ribbon(inf.plot, inf.plots);
            ribbonTitle.textContent = INFINITE_TEXT.title;
            ribbonExtra.textContent = '';
        }
        reqList.innerHTML = '';
        reqRows = {};
        infRefs = [];
        const land = el('div', 'inf-row');
        land.appendChild(el('span', 'req-name', `${INFINITE_TEXT.land} ${pad2(inf.plot + 1)}/${pad2(inf.plots)}`));
        if (inf.nextPlotCost != null) {
            const buy = el('button', 'inf-buy', `Buy land · CR ${inf.nextPlotCost}`);
            buy.type = 'button';
            buy.addEventListener('click', () => {
                if (!onBuyPlot()) cue('deny');
            });
            land.appendChild(buy);
            infRefs.push({ btn: buy, cost: inf.nextPlotCost, land: true });
        } else land.appendChild(el('span', 'con-note', INFINITE_TEXT.allLand));
        reqList.appendChild(land);
        reqList.appendChild(el('span', 'con-label', INFINITE_TEXT.licences));
        const lic = el('div', 'inf-lic');
        for (const l of inf.licences) {
            if (l.owned) {
                lic.appendChild(el('span', 'inf-chip', `✓ ${BUILDING_NAMES[l.type]}`));
            } else if (l.available) {
                const buy = el('button', 'inf-buy', `${BUILDING_NAMES[l.type]} · CR ${l.cost}`);
                buy.type = 'button';
                buy.title = BUILDING_DESC[l.type] ?? '';
                buy.addEventListener('click', () => {
                    if (!onBuyLicence(l.type)) cue('deny');
                });
                lic.appendChild(buy);
                infRefs.push({ btn: buy, cost: l.cost, type: l.type });
            } else {
                lic.appendChild(el('span', 'inf-chip locked', BUILDING_NAMES[l.type]));
            }
        }
        reqList.appendChild(lic);
        unlockLine.textContent = inf.licences.every((l) => l.owned) ? INFINITE_TEXT.allLicences : 'Licences open up in the story’s order.';
    }

    let planDone = new Set();
    let planIds = new Set();
    function renderPlan(list) {
        const sig = list.map((o) => `${o.id}:${o.done ? 1 : 0}`).join('|');
        if (sig === planSig) return;
        const fresh = list.some((o) => planIds.has(o.id)); // the same checklist as before (not a new phase or a load)
        planSig = sig;
        planList.innerHTML = '';
        const firstOpen = list.find((o) => !o.done);
        for (const o of list) {
            const justDone = fresh && o.done && !planDone.has(o.id);
            const li = el('li', `${o.done ? 'done' : o === firstOpen ? 'active' : ''}${justDone ? ' just-done' : ''}`);
            if (justDone) cue('check');
            li.appendChild(el('span', 'box'));
            li.appendChild(el('span', 'plan-text', o.text));
            if (o === firstOpen) li.appendChild(el('span', 'plan-now', 'Now'));
            planList.appendChild(li);
        }
        planDone = new Set(list.filter((o) => o.done).map((o) => o.id));
        planIds = new Set(list.map((o) => o.id));
        planSec.classList.toggle('hidden', list.length === 0);
    }

    function renderOrder(o) {
        orderSec.classList.remove('completed', 'failed');
        if (!o || o.status === 'none') {
            orderTitle.textContent = 'Priority request';
            orderDemand.textContent = 'Awaiting request…';
            orderProgress.textContent = '';
            return;
        }
        orderDemand.textContent = `Deliver ${o.target} × ${ITEM_NAMES[o.productType] ?? o.productType}`;
        if (o.status === 'active') {
            orderTitle.textContent = `Priority request · ${Math.ceil(o.remaining / TICK_RATE)} s`;
            orderProgress.textContent = `${o.delivered}/${o.target} · BONUS CR ${o.reward}`;
        } else if (o.status === 'completed') {
            orderTitle.textContent = 'Priority request · completed';
            orderProgress.textContent = `BONUS CR +${o.reward}`;
            orderSec.classList.add('completed');
        } else {
            orderTitle.textContent = 'Priority request · missed';
            orderProgress.textContent = 'NO BONUS';
            orderSec.classList.add('failed');
        }
    }

    let shownMoney = null;
    let lastMoney = null;
    let moneyFlash = null;
    let lastTool = null;
    let lastUpdate = performance.now();
    function bump(node, cls, ms) {
        node.classList.remove(cls);
        void node.offsetWidth; // restart the animation
        node.classList.add(cls);
        clearTimeout(node._bump);
        node._bump = setTimeout(() => node.classList.remove(cls), ms);
    }

    function update() {
        const s = getState();
        if (!s) return;
        const now = performance.now();
        const dt = Math.min(100, now - lastUpdate);
        lastUpdate = now;
        const { project } = s;
        const infinite = s.mode === 'infinite';
        if (infinite) {
            const sig = JSON.stringify([s.infinite.plot, s.infinite.nextPlotCost, s.infinite.licences, s.infinite.visualPhase]);
            if (sig !== infSig || phaseShown !== -2) {
                infSig = sig;
                buildInfiniteDom(s.infinite);
            }
            for (const r of infRefs) r.btn.classList.toggle('broke', s.money < r.cost);
        } else if (`${project.phase}|${project.ending ?? null}|${project.company ?? null}` !== phaseSig && !cinematic) {
            buildPhaseDom(project.phase, project.complete, project.ending ?? null, project.company ?? null);
        }

        // Credits count toward the real value and flash mustard (earned) or red (spent).
        if (shownMoney === null) shownMoney = s.money;
        if (lastMoney !== null && s.money !== lastMoney) {
            creditsCell.classList.remove('earn', 'spend');
            void creditsCell.offsetWidth;
            creditsCell.classList.add(s.money > lastMoney ? 'earn' : 'spend');
            clearTimeout(moneyFlash);
            moneyFlash = setTimeout(() => creditsCell.classList.remove('earn', 'spend'), 500);
        }
        lastMoney = s.money;
        const gap = s.money - shownMoney;
        shownMoney = Math.abs(gap) < 1 ? s.money : shownMoney + gap * (1 - Math.exp(-dt / 70));
        creditsValue.textContent = credits(Math.round(shownMoney));
        const { supply, demand, throttle, overload = 0, tripped = false } = s.power;
        const ratio = supply > 0 ? demand / supply : 9;
        if (tripped) powerLabel.textContent = ratio > OVERLOAD_RATIO ? `Tripped · ${demand}/${supply} kW · lower the load` : `Tripped · ${demand}/${supply} kW · ready to reset`;
        else if (overload > 0.02) powerLabel.textContent = `Overload · trips in ${Math.max(1, Math.ceil(((1 - overload) * OVERLOAD_TICKS) / TICK_RATE))} s`;
        else powerLabel.textContent = `Power kW · ${demand}/${supply}`;
        const lit = Math.min(SEGMENTS, Math.ceil((ratio / OVERLOAD_RATIO) * SEGMENTS));
        const tone = tripped || ratio > OVERLOAD_RATIO ? 'bad' : ratio > 1 ? 'warn' : 'ok';
        segs.forEach((seg, i) => (seg.className = i < lit ? tone : ''));
        powerCell.classList.toggle('alarm', !tripped && throttle < 1 && demand > 0);
        powerCell.classList.toggle('overload', !tripped && overload > 0.02);
        powerCell.classList.toggle('tripped', tripped);
        resetBtn.classList.toggle('hidden', !tripped);
        resetBtn.classList.toggle('hold', tripped && ratio > OVERLOAD_RATIO);
        pauseBtn.innerHTML = iconSVG(s.paused ? ICON.play : ICON.pause, 16);
        pauseBtn.setAttribute('aria-label', s.paused ? 'Resume' : 'Pause');
        speedLabel.textContent = `${s.speed.toFixed(2)}×`;

        for (const [item, row] of Object.entries(reqRows)) {
            const got = Math.min(row.n, project.delivered[item] ?? 0);
            row.count.textContent = `${pad2(got)}/${pad2(row.n)}`;
            row.fill.style.width = `${(got / row.n) * 100}%`;
            if (row.got >= 0 && got > row.got) bump(row.row, 'bump', 380);
            row.row.classList.toggle('met', got >= row.n);
            row.got = got;
        }
        renderPlan(s.objectives ?? []);

        for (const [tool, btn] of Object.entries(toolButtons)) {
            btn.classList.toggle('active', s.tool === tool);
            if (s.tool === tool && lastTool !== null && lastTool !== tool) bump(btn, 'pressed', 160);
            if (!(tool in MACHINE_COST)) continue;
            const unlocked = s.unlocked[tool];
            const sub = btn.querySelector('.hwkey-sub');
            btn.classList.toggle('locked', !unlocked);
            btn.classList.toggle('broke', unlocked && s.money < MACHINE_COST[tool]);
            // unlockPhaseOf is the phase whose completion unlocks it; show the phase it arrives in.
            // In Infinite a locked building is waiting for its licence.
            const arrives = unlockPhaseOf(tool) + 2;
            sub.textContent = !unlocked ? (infinite ? 'LICENCE' : `PH ${pad2(arrives)}`) : s.tool === tool ? BUILDING_NAMES[tool].toUpperCase() : `CR ${MACHINE_COST[tool]}`;
            btn.title = unlocked ? `${BUILDING_NAMES[tool]} · ${BUILDING_DESC[tool]}`
                : infinite ? `${BUILDING_NAMES[tool]} · license it in the console` : `${BUILDING_NAMES[tool]} · arrives in phase ${arrives}`;
            // Pictured keys stay pictured (greyed, with a lock badge, via CSS); glyph keys swap to a lock.
            if (!btn.classList.contains('has-img')) btn.querySelector('svg path').setAttribute('d', unlocked ? ICON[tool] : ICON.lock);
        }

        lastTool = s.tool;
        orderSec.classList.toggle('hidden', infinite ? s.order.status === 'none' : project.phase < 1);
        renderOrder(s.order);

        researchSec.classList.toggle('hidden', !s.unlocked.lab);
        researchPoints.textContent = `${s.research.points} research points`;
        for (const id of Object.keys(TECH_TEXT)) {
            const btn = techButtons[id];
            const unlocked = s.research.unlocked[id];
            btn.classList.toggle('unlocked', unlocked);
            btn.classList.toggle('broke', !unlocked && s.research.points < TECH_COST[id]);
            btn.querySelector('.tech-cost').textContent = unlocked ? 'ONLINE' : `${TECH_COST[id]} RP`;
        }

        if (!prodPanel.classList.contains('hidden')) renderProduction(s.production);
        const nAlerts = s.alerts?.count ?? 0;
        alertsCount.textContent = nAlerts ? String(nAlerts) : '';
        alertsBtn.classList.toggle('has', nAlerts > 0);
        if (!alertsPanel.classList.contains('hidden')) renderAlerts(s.alerts?.groups ?? []);
        updatePanel(s.selected, s.money);
        renderSelection(s.selection);
        codex.update();
        updateHighlights(s);

        // Inspector follows the hovered cell (not over the machine whose panel is open).
        const overSelected = s.selected && s.hoverX === s.selected.x && s.hoverY === s.selected.y;
        const info = s.hoverScreen && !overSelected ? describe(s.hovered, s.hoveredIO, s.hoveredPorts) : null;
        tip.classList.toggle('hidden', !info);
        if (info) {
            tipTitle.textContent = info.title;
            tipBody.textContent = info.body;
            const w = tip.offsetWidth || 240;
            const h = tip.offsetHeight || 80;
            // Page pixels; the HUD is zoomed by the Interface size, so divide back.
            const z = uiScale;
            const x = Math.min(window.innerWidth - w * z - 12, s.hoverScreen.x + 28);
            const y = Math.max(64 * z, Math.min(window.innerHeight - h * z - 120 * z, s.hoverScreen.y - h * z - 12));
            tip.style.transform = `translate(${Math.round(x / z)}px, ${Math.round(y / z)}px)`;
        }
    }

    // ---- Tutorial highlights: where the first open objective wants you to look -------------------
    // Its `key` pulses that building's keycap until you pick the tool; its `ui` glows the HUD
    // element it is about (story.js, "Tutorial highlights"). The rings in the world are the
    // renderer's (state.focus). Reduced motion stills the pulse (menus.css).
    let hintKey = null;
    let hintEl = null;
    function hintTarget(ui, s) {
        const [what, arg] = ui.split(':');
        const panelOpen = !!s.selected && !mp.classList.contains('hidden');
        switch (what) {
            case 'recipe': {
                if (!panelOpen || !mpRefs.recipeBtns) return null;
                if (!arg) return mpRefs.recipeSec ?? null;
                const b = mpRefs.recipeBtns[arg];
                return b && !b.classList.contains('active') ? b : null;
            }
            case 'upgrade': return panelOpen ? mpRefs.up ?? null : null;
            case 'power': return powerCell;
            case 'production': return prodBtn;
            case 'menu': return menuBtn;
            case 'codex': return codexBtn;
            case 'order': return orderSec.classList.contains('hidden') ? null : orderSec;
            case 'research':
                if (researchSec.classList.contains('hidden')) return null;
                return arg && techButtons[arg] && !s.research.unlocked[arg] ? techButtons[arg] : researchSec;
            case 'licence': return infRefs.find((r) => r.type === arg)?.btn ?? null;
            case 'land': return infRefs.find((r) => r.land)?.btn ?? null;
            default: return null;
        }
    }
    function updateHighlights(s) {
        const now = highlights && !cinematic ? (s.objectives ?? []).find((o) => !o.done) : null;
        const key = now?.key && s.tool !== now.key && s.unlocked[now.key] !== false ? toolButtons[now.key] ?? null : null;
        if (key !== hintKey) {
            hintKey?.classList.remove('hint-pulse');
            key?.classList.add('hint-pulse');
            hintKey = key;
        }
        const target = now?.ui ? hintTarget(now.ui, s) : null;
        if (target !== hintEl) {
            hintEl?.classList.remove('hint-glow');
            target?.classList.add('hint-glow');
            hintEl = target;
        }
    }

    update();
    return {
        update, say, isBusy, showBanner, showTitle, showEnding, showCredits, toast,
        setKeys,
        /** Open or close the alerts list (key N). */
        toggleAlerts: () => togglePopover(alertsPanel),
        /** The codex (codexPanel.js): open on an entry ('item:steel', 'building:press'…), K's toggle, Esc's close. */
        openCodex: (id) => codex.open(id),
        toggleCodex: (id) => codex.toggle(id),
        closeCodex: () => codex.close(),
        codexOpen: () => codex.isOpen(),
        /** The Tutorial highlights setting (keycap pulse, HUD glow). */
        setHighlights: (on) => {
            highlights = !!on;
        },
        /** The Text speed setting: 1 normal, higher is faster (99: at once). */
        setTextSpeed: (x) => {
            textSpeed = Math.max(0.3, Number(x) || 1);
        },
        /** The Interface size setting (the CSS zoom on #hud is set by main.js). */
        setUiScale: (z) => {
            uiScale = Math.max(0.5, Number(z) || 1);
        },
    };
}
