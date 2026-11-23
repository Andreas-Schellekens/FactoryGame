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
// Title screen and ending are full-screen overlays on <body>.
//
// Sound goes through the optional `sound` object (audio.js): the HUD only
// tells it what happened (a comms line starts, a panel opens, the ending
// plays) and reads/writes its settings; it never touches audio itself.
import { MACHINE_COST, TECH_COST, TICK_RATE } from './config.js';
import { PHASES, unlockPhaseOf } from './campaign.js';
import {
    AI, GAME_TITLE, ITEM_NAMES, BUILDING_NAMES, BUILDING_DESC, TECH_TEXT, PHASE_TEXT, ENDING, BRAND, brandFor,
} from './story.js';
import { markSVG, patchSVG, deltaSVG, broadcastSVG, memoSVG, endingSceneSVG } from './brand.js';

const ICON = {
    belt: 'M6 7l5 5-5 5M13 7l5 5-5 5',
    extractor: 'M12 3v10M8 13h8l-4 8z',
    smelter: 'M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-4 3-5 0 2 1 3 2 3 0-3 0-5 0-7z',
    assembler: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
    splitter: 'M4 12h6M10 12l8-6M10 12h10M10 12l8 6',
    merger: 'M4 6l8 6M4 18l8-6M4 12h16',
    generator: 'M13 2L4 14h7l-1 8 9-12h-7z',
    lab: 'M9 3h6M10 3v6L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
    upgrade: 'M12 19V5M5 12l7-7 7 7',
    erase: 'M6 6l12 12M18 6L6 18',
    rotate: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
    pause: 'M8 5v14M16 5v14',
    play: 'M7 5l12 7-12 7z',
    faster: 'M6 7l5 5-5 5M13 7l5 5-5 5',
    slower: 'M18 7l-5 5 5 5M11 7l-5 5 5 5',
};

// Build palette order + hotkeys (keys are handled in main.js).
const BUILD_DEFS = [
    ['belt', '1'], ['extractor', '2'], ['smelter', '3'], ['assembler', '4'],
    ['splitter', '7'], ['merger', '8'], ['generator', '9'], ['lab', '0'],
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

/** A hardware key: number in the corner, icon, small caption. */
function hwKey({ k, label, iconPath, sub = '', cls = '', onClick }) {
    const b = el('button', `hwkey ${cls}`);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = `<span class="hwkey-k">${k}</span>${iconSVG(iconPath)}<span class="hwkey-sub"></span>`;
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
export function createUI({ root, onToolChange, onRotate, onTogglePause, onSpeedChange, onSave, onLoad, onUnlock, getState, sound }) {
    root.innerHTML = '';
    const cue = (name) => sound?.cue(name);
    let phaseShown = -1; // phase the phase-dependent DOM was last built for
    let brandPhase = 0;  // for comms headers / portraits

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
    powerCell.append(powerLabel, gauge);

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
        for (const p of [help, soundPanel]) p.classList.add('hidden');
        if (opening) {
            panel.classList.remove('hidden');
            if (panel === soundPanel) refreshSoundPanel();
        }
        cue(opening ? 'open' : 'close');
    }
    menuCell.append(
        textButton('Save', () => {
            cue('click');
            toast(onSave() ? 'Contract saved' : 'Save failed');
        }),
        textButton('Load', () => {
            cue('click');
            toast(onLoad() ? 'Contract restored' : 'No saved contract');
        }),
        textButton('Sound', () => togglePopover(soundPanel)),
        textButton('Keys', () => togglePopover(help)),
    );
    top.append(brandCell, creditsCell, powerCell, el('div', 'tb-spacer'), simCell, menuCell);
    root.appendChild(top);

    const help = el('div', 'help hidden');
    help.innerHTML = [
        ['LMB', 'build · drag to lay belts'], ['RMB', 'demolish (refunds cost)'], ['R', 'rotate before placing'],
        ['1–4 7–0', 'buildings'], ['5 / 6', 'upgrade / demolish tool'], ['WASD', 'move view'], ['Wheel', 'zoom'],
        ['Q / E', 'turn view'], ['Space', 'pause'], ['+ / −', 'sim speed'], ['M', 'sound on / off'],
    ].map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('');
    root.appendChild(help);

    // ---- Sound panel -------------------------------------------------------------
    const soundPanel = el('div', 'sound-panel hidden');
    const sliders = {};
    for (const [key, label] of [['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects'], ['voice', 'Voice']]) {
        const row = el('label', 'snd-row');
        const input = el('input');
        input.type = 'range';
        input.min = '0';
        input.max = '100';
        input.step = '1';
        const value = el('span', 'snd-value');
        input.addEventListener('input', () => {
            value.textContent = input.value;
            sound?.setSettings({ [key]: Number(input.value) / 100 });
        });
        // A sample click at the new level, so the effects volume can be judged.
        input.addEventListener('change', () => {
            if (key === 'master' || key === 'sfx') cue('key');
        });
        row.append(el('span', 'snd-label', label), input, value);
        soundPanel.appendChild(row);
        sliders[key] = { input, value };
    }
    const muteBtn = textButton('Mute', () => {
        sound?.toggleMute();
        refreshSoundPanel();
    }, 'snd-mute');
    const voiceNote = el('p', 'snd-note');
    soundPanel.append(muteBtn, voiceNote);
    root.appendChild(soundPanel);

    function refreshSoundPanel() {
        const st = sound?.settings() ?? {};
        for (const [key, { input, value }] of Object.entries(sliders)) {
            const v = Math.round((st[key] ?? 0) * 100);
            input.value = String(v);
            value.textContent = String(v);
        }
        muteBtn.textContent = st.muted ? 'Sound off · M' : 'Sound on · M';
        muteBtn.classList.toggle('off', !!st.muted);
        const lines = sound?.voiceLines() ?? 0;
        voiceNote.textContent = lines ? `DELTA voice · ${lines} recorded lines` : 'DELTA voice · not recorded yet (text only)';
    }

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

    // ---- Keys -------------------------------------------------------------------------
    const keys = el('div', 'keys');
    const toolButtons = {};
    for (const [tool, k] of BUILD_DEFS) {
        toolButtons[tool] = hwKey({
            k, label: `${BUILDING_NAMES[tool]}, key ${k}`, iconPath: ICON[tool],
            onClick: () => onToolChange(tool),
        });
        keys.appendChild(toolButtons[tool]);
    }
    keys.appendChild(el('span', 'keys-divider'));
    toolButtons.upgrade = hwKey({ k: '5', label: 'Upgrade, key 5', iconPath: ICON.upgrade, sub: 'UPGRADE', cls: 'edit', onClick: () => onToolChange('upgrade') });
    toolButtons.erase = hwKey({ k: '6', label: 'Demolish, key 6', iconPath: ICON.erase, sub: 'DEMOLISH', cls: 'edit', onClick: () => onToolChange('erase') });
    const rotateKey = hwKey({ k: 'R', label: 'Rotate, R', iconPath: ICON.rotate, sub: 'ROTATE', cls: 'edit', onClick: onRotate });
    keys.append(toolButtons.upgrade, toolButtons.erase, rotateKey);
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
        const b = brandFor(brandPhase);
        const evil = brandPhase >= 4;
        if (line.who === 'nile') return { name: `${b.name} BROADCAST`, role: 'Office of Planetary Continuity', svg: broadcastSVG(evil) };
        if (line.who === 'memo') return { name: 'INTERCEPTED MEMO', role: `not for ${b.player} eyes`, svg: memoSVG() };
        return { name: `${AI.name} ▸ CAPCOM`, role: `${b.name} dispatch AI`, svg: deltaSVG(line.mood) };
    }

    // Typing is time-based (so a throttled timer can't slow DELTA down), then
    // the finished line lingers long enough to read before the next one.
    const CHARS_PER_MS = 0.07;
    const lingerMs = (text) => Math.min(6500, 1000 + text.length * 30);

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
        commsName.textContent = who.name;
        commsRole.textContent = who.role;
        commsText.textContent = '';
        const voiceMs = sound?.lineStart(current, { fresh }) ?? null;
        const start = performance.now();
        voiceEnds = voiceMs ? start + voiceMs : 0;
        // Text types along with the voice (a little ahead of it); without one, at reading pace.
        const rate = voiceMs ? current.text.length / Math.max(300, voiceMs * 0.85) : CHARS_PER_MS;
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
        if (!typeTimer && !holdTimer) nextLine();
        else updateMore();
    }
    /** Still mid-conversation (typing, lingering or with lines queued)? */
    const isBusy = () => !!typeTimer || !!holdTimer || queue.length > 0;

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

    const toastEl = el('div', 'toast');
    root.appendChild(toastEl);
    let toastTimer = null;
    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
    }

    /** Phase completion: the ribbon swells into a banner for a few seconds. */
    function showBanner(phaseIndex) {
        const unlocks = PHASES[phaseIndex]?.unlocks ?? [];
        celebrating = true;
        ribbon.classList.add('celebrate');
        ribbonKicker.textContent = `Phase ${pad2(phaseIndex + 1)} · accomplished`;
        ribbonTitle.textContent = PHASE_TEXT[phaseIndex]?.title ?? '';
        ribbonExtra.textContent = unlocks.length ? `New · ${unlocks.map((t) => BUILDING_NAMES[t]).join(' · ')}` : '';
        clearTimeout(celebrateTimer);
        celebrateTimer = setTimeout(() => {
            celebrating = false;
            ribbon.classList.remove('celebrate');
            phaseShown = -1; // redraw the ribbon for the current phase
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

    function showEnding({ stats: s, onContinue, onNewGame }) {
        const overlay = el('div', 'overlay ending');
        const card = el('div', 'ending-card');
        const scene = el('div', 'ending-scene');
        scene.innerHTML = endingSceneSVG();
        const lines = el('div', 'ending-lines');
        const delays = [0.6, 7, 10.5, 14];
        ENDING.lines.forEach((line, i) => {
            const p = el('p', `ending-line who-${line.who}`);
            p.style.animationDelay = `${delays[i] ?? 3 * i}s`;
            p.appendChild(el('b', null, `${line.who === 'nile' ? 'NIHIL' : AI.name}  `));
            p.appendChild(document.createTextNode(line.text));
            lines.appendChild(p);
        });
        const final = el('div', 'ending-final');
        final.style.animationDelay = '18s';
        const statRow = el('div', 'ending-stats');
        for (const [label, value] of [
            ['Contract length', fmtTime(s.seconds)],
            ['Items delivered', s.delivered],
            ['Machines built', s.machines],
            ['Moons removed', 1],
        ]) {
            const box = el('div', 'ending-stat');
            box.append(el('span', 'ending-stat-value', String(value)), el('span', 'ending-stat-label', label));
            statRow.appendChild(box);
        }
        const actions = el('div', 'title-actions');
        const keep = el('button', 'btn-primary', 'Keep building');
        keep.type = 'button';
        keep.addEventListener('click', () => {
            overlay.remove();
            sound?.afterEnding();
            onContinue();
        });
        const fresh = el('button', 'btn-secondary', 'New contract');
        fresh.type = 'button';
        fresh.addEventListener('click', onNewGame);
        actions.append(keep, fresh);
        final.append(
            el('span', 'ending-title', 'The end'),
            el('span', 'ending-sub', `${GAME_TITLE} · ${BRAND.nihil.byline}. ${BRAND.nihil.motto}. Thank you for playing.`),
            statRow,
            actions,
        );
        card.append(scene, lines, final);
        overlay.appendChild(card);
        overlay.addEventListener('click', (e) => {
            if (actions.contains(e.target) || overlay.classList.contains('skip')) return;
            overlay.classList.add('skip'); // skip to the final card
            sound?.endingSkip();
        });
        document.body.appendChild(overlay);
        sound?.ending(ENDING.lines, delays);
    }

    // ---- Per-frame refresh -------------------------------------------------------------------
    /** Inspector text for a cell, or null when there's nothing worth showing. */
    function describe(cell) {
        if (!cell) return null;
        if (cell.blocked) return { title: 'Selene construction site', body: 'Reserved. Deliveries to the pad build the cannon here.' };
        const lines = [];
        let title = null;
        if (cell.machine) {
            const m = cell.machine;
            title = BUILDING_NAMES[m.type] ?? m.type;
            if (m.tier && !['sink', 'belt', 'splitter', 'merger'].includes(m.type)) title += `  T${m.tier}`;
            const buf = Object.entries(m.buffer || {}).filter(([, n]) => n > 0);
            if (buf.length) lines.push('IN   ' + buf.map(([k, n]) => `${(ITEM_NAMES[k] ?? k).toUpperCase()} ×${n}`).join(', '));
            if (m.type === 'generator') lines.push(m.fuelTicks > 0 ? `FUEL ${m.fuelTicks} TICKS` : 'FUEL EMPTY');
            if (m.pendingOutput) lines.push(`OUT  ${(ITEM_NAMES[m.pendingOutput] ?? m.pendingOutput).toUpperCase()}`);
            if (m.dir && m.type !== 'sink') lines.push(`DIR  ${m.dir.toUpperCase()}`);
        }
        if (cell.resource) {
            if (!title) title = 'Ore node';
            lines.push(`NODE ${ITEM_NAMES[cell.resource].toUpperCase()}`);
        }
        if (cell.item) lines.push(`ITEM ${(ITEM_NAMES[cell.item.type] ?? cell.item.type).toUpperCase()}`);
        return title ? { title, body: lines.join('\n') } : null;
    }

    function buildPhaseDom(phase, complete) {
        phaseShown = phase;
        brandPhase = phase;
        const evil = phase >= 4;
        const b = brandFor(phase);
        document.body.classList.toggle('evil', evil);
        document.body.dataset.phase = String(Math.min(phase, 5)); // sky layers (style.css)
        brandMark.innerHTML = markSVG(evil, 28);
        brandWord.textContent = b.name;
        brandCell.title = `${b.name} · ${b.full} · ${b.motto}`;
        patchBox.innerHTML = patchSVG(evil, 48, { text: false });
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
            unlockLine.textContent = 'The sky is now a subscription. Keep building, if you like.';
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
            reqRows[item] = { count, fill, n };
        }
        unlockLine.textContent = def.unlocks.length
            ? `Unlocks · ${def.unlocks.map((t) => BUILDING_NAMES[t]).join(' · ')}`
            : phase === PHASES.length - 1 ? 'Completes Protocol: Selene' : PHASE_TEXT[phase].blurb;
    }

    function renderPlan(list) {
        const sig = list.map((o) => `${o.id}:${o.done ? 1 : 0}`).join('|');
        if (sig === planSig) return;
        planSig = sig;
        planList.innerHTML = '';
        const firstOpen = list.find((o) => !o.done);
        for (const o of list) {
            const li = el('li', o.done ? 'done' : o === firstOpen ? 'active' : '');
            li.appendChild(el('span', 'box'));
            li.appendChild(el('span', 'plan-text', o.text));
            if (o === firstOpen) li.appendChild(el('span', 'plan-now', 'Now'));
            planList.appendChild(li);
        }
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

    function update() {
        const s = getState();
        if (!s) return;
        if (!soundPanel.classList.contains('hidden') && sound && muteBtn.classList.contains('off') !== sound.settings().muted) refreshSoundPanel();
        const { project } = s;
        if (project.phase !== phaseShown) buildPhaseDom(project.phase, project.complete);

        creditsValue.textContent = credits(s.money);
        const { supply, demand, throttle } = s.power;
        powerLabel.textContent = `Power kW · ${demand}/${supply}`;
        const lit = supply > 0 ? Math.min(SEGMENTS, Math.ceil((demand / supply) * SEGMENTS)) : SEGMENTS;
        const tone = throttle >= 1 ? 'ok' : throttle >= 0.5 ? 'warn' : 'bad';
        segs.forEach((seg, i) => (seg.className = i < lit ? tone : ''));
        pauseBtn.innerHTML = iconSVG(s.paused ? ICON.play : ICON.pause, 16);
        pauseBtn.setAttribute('aria-label', s.paused ? 'Resume' : 'Pause');
        speedLabel.textContent = `${s.speed.toFixed(2)}×`;

        for (const [item, row] of Object.entries(reqRows)) {
            const got = Math.min(row.n, project.delivered[item] ?? 0);
            row.count.textContent = `${pad2(got)}/${pad2(row.n)}`;
            row.fill.style.width = `${(got / row.n) * 100}%`;
        }
        renderPlan(s.objectives ?? []);

        for (const [tool, btn] of Object.entries(toolButtons)) {
            btn.classList.toggle('active', s.tool === tool);
            if (!(tool in MACHINE_COST)) continue;
            const unlocked = s.unlocked[tool];
            const sub = btn.querySelector('.hwkey-sub');
            btn.classList.toggle('locked', !unlocked);
            btn.classList.toggle('broke', unlocked && s.money < MACHINE_COST[tool]);
            // unlockPhaseOf is the phase whose completion unlocks it; show the phase it arrives in.
            const arrives = unlockPhaseOf(tool) + 2;
            sub.textContent = !unlocked ? `PH ${pad2(arrives)}` : s.tool === tool ? BUILDING_NAMES[tool].toUpperCase() : `CR ${MACHINE_COST[tool]}`;
            btn.title = unlocked ? `${BUILDING_NAMES[tool]} · ${BUILDING_DESC[tool]}` : `${BUILDING_NAMES[tool]} · arrives in phase ${arrives}`;
            btn.querySelector('svg path').setAttribute('d', unlocked ? ICON[tool] : ICON.lock);
        }

        orderSec.classList.toggle('hidden', project.phase < 1);
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

        // Inspector follows the hovered cell.
        const info = s.hoverScreen ? describe(s.hovered) : null;
        tip.classList.toggle('hidden', !info);
        if (info) {
            tipTitle.textContent = info.title;
            tipBody.textContent = info.body;
            const w = tip.offsetWidth || 240;
            const h = tip.offsetHeight || 80;
            const x = Math.min(window.innerWidth - w - 12, s.hoverScreen.x + 28);
            const y = Math.max(64, Math.min(window.innerHeight - h - 120, s.hoverScreen.y - h - 12));
            tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        }
    }

    update();
    return { update, say, isBusy, showBanner, showTitle, showEnding, toast };
}
