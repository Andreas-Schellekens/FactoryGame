// src/ui.js — the HUD, built as plain DOM (not drawn on the canvas), so it
// never overlaps the playfield. Driven entirely through the callbacks and the
// getState() pull function passed in from main.js; it reads no game state
// directly. Owns: the sidebar (status, project, objectives, build, order,
// research, tools, inspector), DELTA's comms panel (message queue +
// typewriter), phase banners, toasts, the title screen and the ending.
import { MACHINE_COST, TECH_COST, TICK_RATE } from './config.js';
import { PHASES, unlockPhaseOf } from './campaign.js';
import {
    AI, GAME_TITLE, ITEM_NAMES, BUILDING_NAMES, BUILDING_DESC, TECH_TEXT, PHASE_TEXT, ENDING, brandName,
} from './story.js';
import { logoSVG, deltaSVG, broadcastSVG, memoSVG, cannonSVG, endingSceneSVG } from './brand.js';

// UI colour per item (mirrors the renderer's ITEM_STYLE).
const ITEM_COLOR = {
    ironOre: '#9aa0aa', copperOre: '#c77b3b', coalOre: '#3b3f48',
    ironIngot: '#dce1e9', copperIngot: '#e2913f',
    circuit: '#39d353', advancedCircuit: '#f5b041', research: '#b07cf0',
};

// Build palette order + hotkeys (keys are handled in main.js).
const BUILD_DEFS = [
    ['belt', '1'], ['extractor', '2'], ['smelter', '3'], ['assembler', '4'],
    ['splitter', '7'], ['merger', '8'], ['generator', '9'], ['lab', '0'],
];

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function button(label, onClick, { sub, cls } = {}) {
    const b = el('button', `btn${cls ? ` ${cls}` : ''}`);
    b.addEventListener('click', onClick);
    b.appendChild(el('span', 'btn-label', label));
    if (sub != null) b.appendChild(el('span', 'cost', sub));
    return b;
}

function section(title) {
    const wrap = el('div', 'section');
    wrap.appendChild(el('div', 'section-title', title));
    return wrap;
}

const fmtTime = (secs) => {
    const s = Math.floor(secs);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

/**
 * @param {{
 *   root: HTMLElement, view: HTMLElement, commsRoot: HTMLElement,
 *   onToolChange: (tool: string) => void, onRotate: () => void,
 *   onTogglePause: () => void, onSpeedChange: (delta: number) => void,
 *   onSave: () => boolean, onLoad: () => boolean, onUnlock: (techId: string) => boolean,
 *   getState: () => any,
 * }} opts
 */
export function createUI({ root, view, commsRoot, onToolChange, onRotate, onTogglePause, onSpeedChange, onSave, onLoad, onUnlock, getState }) {
    root.innerHTML = '';
    let phaseShown = -1; // phase the phase-dependent DOM was last built for
    let brandPhase = 0;  // for comms headers / portraits

    // ---- Brand header ----------------------------------------------------
    const brand = el('div', 'brand');
    const logoBox = el('div', 'brand-logo');
    const gameTitle = el('div', 'brand-title', GAME_TITLE.toUpperCase());
    brand.append(logoBox, gameTitle);
    root.appendChild(brand);

    // ---- Status ----------------------------------------------------------
    const stats = section('Status');
    const money = el('div', 'stat money');
    const powerStat = el('div', 'stat');
    const powerBar = el('div', 'bar');
    const powerFill = el('div', 'bar-fill');
    powerBar.appendChild(powerFill);
    const simRow = el('div', 'row');
    const pauseBtn = button('Pause', onTogglePause);
    const speedLabel = el('div', 'speed-label');
    simRow.append(pauseBtn, button('–', () => onSpeedChange(-1), { cls: 'btn-sq' }), speedLabel, button('+', () => onSpeedChange(1), { cls: 'btn-sq' }));
    stats.append(money, powerStat, powerBar, simRow);
    root.appendChild(stats);

    // ---- Project LIFELINE --------------------------------------------------
    const projectSec = section('Project LIFELINE');
    const cannonBox = el('div', 'cannon');
    const phaseKicker = el('div', 'phase-kicker');
    const phaseTitle = el('div', 'phase-title');
    const phaseBlurb = el('div', 'phase-blurb');
    const reqList = el('div', 'req-list');
    const unlockLine = el('div', 'unlock-line');
    projectSec.append(cannonBox, phaseKicker, phaseTitle, phaseBlurb, reqList, unlockLine);
    root.appendChild(projectSec);
    /** @type {Record<string, {count: HTMLElement, fill: HTMLElement, n: number}>} */
    let reqRows = {};

    // ---- Objectives ------------------------------------------------------
    const objSec = section('Objectives');
    const objList = el('ul', 'objectives');
    objSec.appendChild(objList);
    root.appendChild(objSec);
    let objSig = null;

    // ---- Build -----------------------------------------------------------
    const build = section('Build');
    const buildGrid = el('div', 'build-grid');
    const toolButtons = {};
    for (const [tool, key] of BUILD_DEFS) {
        const b = button(BUILDING_NAMES[tool], () => onToolChange(tool), { sub: MACHINE_COST[tool] });
        b.classList.add('build-btn');
        b.insertBefore(el('span', 'key', key), b.firstChild);
        b.title = BUILDING_DESC[tool];
        toolButtons[tool] = b;
        buildGrid.appendChild(b);
    }
    build.appendChild(buildGrid);
    root.appendChild(build);

    // ---- Priority request (orders) ----------------------------------------
    const orderSec = section('Priority Request');
    const orderDemand = el('div', 'stat');
    const orderProgress = el('div', 'stat dim');
    const orderStatus = el('div', 'stat order-status');
    orderSec.append(orderDemand, orderProgress, orderStatus);
    root.appendChild(orderSec);

    // ---- Research ----------------------------------------------------------
    const researchSec = section('Research');
    const researchPoints = el('div', 'stat research-points');
    researchSec.appendChild(researchPoints);
    const techButtons = {};
    for (const id of Object.keys(TECH_TEXT)) {
        const b = button(TECH_TEXT[id].label, () => onUnlock(id), { sub: `${TECH_COST[id]} rp` });
        b.title = TECH_TEXT[id].desc;
        techButtons[id] = b;
        researchSec.appendChild(b);
    }
    root.appendChild(researchSec);

    // ---- Tools + save --------------------------------------------------------
    const edit = section('Tools');
    const editRow = el('div', 'row');
    toolButtons.upgrade = button('Upgrade', () => onToolChange('upgrade'), { sub: '5' });
    toolButtons.erase = button('Erase', () => onToolChange('erase'), { sub: '6' });
    editRow.append(toolButtons.upgrade, toolButtons.erase, button('⟳', onRotate, { cls: 'btn-sq' }));
    const saveRow = el('div', 'row');
    saveRow.append(
        button('Save', () => toast(onSave() ? 'Contract saved ✓' : 'Save failed')),
        button('Load', () => toast(onLoad() ? 'Contract restored ✓' : 'No saved contract')),
    );
    edit.append(editRow, saveRow);
    root.appendChild(edit);

    // ---- Inspector -------------------------------------------------------------
    const inspect = section('Inspector');
    const hover = el('div', 'stat mono inspector');
    inspect.appendChild(hover);
    root.appendChild(inspect);

    const help = el('div', 'help');
    help.innerHTML = '<b>LMB</b> build · <b>RMB</b> erase · <b>R</b> rotate<br><b>WASD</b> move · <b>wheel</b> zoom · <b>Q/E</b> turn view<br><b>Space</b> pause · <b>+/−</b> speed';
    root.appendChild(help);

    // ---- Comms panel (DELTA) -------------------------------------------------
    commsRoot.innerHTML = '';
    commsRoot.classList.add('comms', 'idle');
    const portrait = el('div', 'comms-portrait');
    const body = el('div', 'comms-body');
    const head = el('div', 'comms-head');
    const commsName = el('span', 'comms-name');
    const commsRole = el('span', 'comms-role');
    const commsMore = el('span', 'comms-more');
    head.append(commsName, commsRole, commsMore);
    const commsText = el('div', 'comms-text');
    body.append(head, commsText);
    const logBtn = el('button', 'comms-log-btn', 'Log');
    const logPanel = el('div', 'comms-log hidden');
    commsRoot.append(portrait, body, logBtn, logPanel);

    const queue = [];
    const log = [];
    let current = null;
    let typeTimer = null;
    let holdTimer = null;

    function speaker(line) {
        const evil = brandPhase >= 4;
        if (line.who === 'nile') {
            return { name: `${brandName(brandPhase)} BROADCAST`, role: 'Office of Planetary Continuity', svg: broadcastSVG(evil) };
        }
        if (line.who === 'memo') return { name: 'INTERCEPTED MEMO', role: 'not for Pioneer eyes', svg: memoSVG() };
        return { name: AI.name, role: `${evil ? 'Nihil' : 'Nile'} Dispatch AI`, svg: deltaSVG(line.mood) };
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
        commsRoot.classList.remove('speaking');
        holdTimer = setTimeout(endLinger, lingerMs(current.text));
    }

    function endLinger() {
        stopTimers();
        if (queue.length) nextLine();
        else commsRoot.classList.add('idle');
    }

    function nextLine() {
        stopTimers();
        current = queue.shift() ?? null;
        updateMore();
        if (!current) {
            commsRoot.classList.add('idle');
            return;
        }
        const who = speaker(current);
        commsRoot.className = `comms who-${current.who} mood-${current.mood ?? 'neutral'} speaking`;
        portrait.innerHTML = who.svg;
        commsName.textContent = who.name;
        commsRole.textContent = who.role;
        commsText.textContent = '';
        const start = performance.now();
        typeTimer = setInterval(() => {
            const typed = Math.floor((performance.now() - start) * CHARS_PER_MS);
            commsText.textContent = current.text.slice(0, typed);
            if (typed >= current.text.length) finishTyping();
        }, 30);
    }

    function updateMore() {
        commsMore.textContent = queue.length ? `▸ ${queue.length} more · click to skip` : '';
    }

    function say(line) {
        queue.push(line);
        // Remember the header as it was when said (the brand changes later).
        log.push({ ...line, label: speaker(line).name });
        if (log.length > 80) log.shift();
        if (!typeTimer && !holdTimer) nextLine();
        else updateMore();
    }

    /** Still mid-conversation (typing, lingering or with lines queued)? */
    const isBusy = () => !!typeTimer || !!holdTimer || queue.length > 0;

    // Click: finish the line being typed, else skip to the next one.
    commsRoot.addEventListener('click', (e) => {
        if (e.target === logBtn || logPanel.contains(e.target)) return;
        if (typeTimer) finishTyping();
        else if (holdTimer) endLinger();
    });
    logBtn.addEventListener('click', () => {
        logPanel.classList.toggle('hidden');
        if (logPanel.classList.contains('hidden')) return;
        logPanel.innerHTML = '';
        for (const line of log) {
            const p = el('p', `log-line who-${line.who}`);
            p.appendChild(el('b', null, `${line.label}: `));
            p.appendChild(document.createTextNode(line.text));
            logPanel.appendChild(p);
        }
        logPanel.scrollTop = logPanel.scrollHeight;
    });

    // ---- Banner + toast (over the playfield) ----------------------------------
    const banner = el('div', 'banner');
    const toastEl = el('div', 'toast');
    view.append(banner, toastEl);
    let bannerTimer = null;
    let toastTimer = null;

    function showBanner(phaseIndex) {
        const unlocks = PHASES[phaseIndex]?.unlocks ?? [];
        banner.innerHTML = '';
        banner.append(
            el('div', 'banner-kicker', `Phase ${phaseIndex + 1} complete`),
            el('div', 'banner-title', PHASE_TEXT[phaseIndex]?.title ?? ''),
        );
        if (unlocks.length) {
            banner.appendChild(el('div', 'banner-unlocks', `Unlocked: ${unlocks.map((t) => BUILDING_NAMES[t]).join(' · ')}`));
        }
        banner.classList.add('show');
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => banner.classList.remove('show'), 5500);
    }

    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
    }

    // ---- Title screen + ending (full-screen overlays) ----------------------------
    function showTitle({ hasSave, onNew, onResume }) {
        const overlay = el('div', 'overlay title-screen');
        const card = el('div', 'title-card');
        const logo = el('div', 'title-logo');
        logo.innerHTML = logoSVG(0);
        const begin = button('Begin Onboarding', () => {
            if (hasSave && !confirm('Start a new contract? Your saved contract will be overwritten.')) return;
            overlay.remove();
            onNew();
        }, { cls: 'btn-primary' });
        const resume = button('Resume Contract', () => {
            overlay.remove();
            onResume();
        });
        if (!hasSave) resume.disabled = true;
        const actions = el('div', 'title-actions');
        actions.append(begin, resume);
        card.append(
            logo,
            el('div', 'title-tag', 'Everything, from Source to Delta.'),
            el('h1', 'title-game', GAME_TITLE),
            el('p', 'title-pitch', 'The Moon is falling. Nile has a plan. You are the plan.'),
            actions,
            el('p', 'fine-print', 'By clicking Begin you accept the Nile Pioneer Agreement (4,812 pages), including Clause 88.'),
        );
        overlay.appendChild(card);
        document.body.appendChild(overlay);
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
            p.appendChild(el('b', null, `${line.who === 'nile' ? 'NIHIL' : AI.name}: `));
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
            box.append(el('div', 'ending-stat-value', String(value)), el('div', 'ending-stat-label', label));
            statRow.appendChild(box);
        }
        const actions = el('div', 'title-actions');
        actions.append(
            button('Keep Building', () => { overlay.remove(); onContinue(); }, { cls: 'btn-primary' }),
            button('New Contract', onNewGame),
        );
        final.append(el('div', 'ending-title', 'THE END'), el('div', 'ending-sub', 'Project LIGHTS OUT — thank you for playing.'), statRow, actions);
        card.append(scene, lines, final);
        overlay.appendChild(card);
        // Clicking skips straight to the final card.
        overlay.addEventListener('click', (e) => {
            if (!actions.contains(e.target)) overlay.classList.add('skip');
        });
        document.body.appendChild(overlay);
    }

    // ---- Per-frame refresh -----------------------------------------------------
    function describe(cell) {
        if (!cell) return '—';
        const parts = [];
        if (cell.blocked) parts.push('Project LIFELINE construction site');
        if (cell.resource) parts.push(`node: ${ITEM_NAMES[cell.resource]}`);
        if (cell.machine) {
            const m = cell.machine;
            let line = BUILDING_NAMES[m.type] ?? m.type;
            if (m.dir && m.type !== 'sink') line += ` ▸${m.dir}`;
            if (m.tier && m.type !== 'sink' && m.type !== 'belt') line += `  T${m.tier}`;
            parts.push(line);
            const buf = Object.entries(m.buffer || {}).filter(([, n]) => n > 0);
            if (buf.length) parts.push('buffer: ' + buf.map(([k, n]) => `${ITEM_NAMES[k] ?? k}×${n}`).join(', '));
            if (m.type === 'generator') parts.push(m.fuelTicks > 0 ? `fuel: ${m.fuelTicks} ticks` : 'fuel: empty');
            if (m.pendingOutput) parts.push(`out: ${ITEM_NAMES[m.pendingOutput] ?? m.pendingOutput}`);
        }
        if (cell.item) parts.push(`item: ${ITEM_NAMES[cell.item.type] ?? cell.item.type}`);
        return parts.length ? parts.join('\n') : 'empty';
    }

    function buildPhaseDom(phase, complete) {
        phaseShown = phase;
        brandPhase = phase;
        logoBox.innerHTML = logoSVG(phase);
        gameTitle.textContent = (phase >= 4 ? 'Project Lights Out' : GAME_TITLE).toUpperCase();
        document.body.classList.toggle('evil', phase >= 4);
        document.body.dataset.phase = String(Math.min(phase, 5)); // sky layers (style.css)
        cannonBox.innerHTML = cannonSVG(phase);
        reqList.innerHTML = '';
        reqRows = {};
        if (complete || phase >= PHASES.length) {
            phaseKicker.textContent = 'All phases complete';
            phaseTitle.textContent = 'LIFELINE has fired';
            phaseBlurb.textContent = 'The sky is now a subscription. Keep building, if you like.';
            unlockLine.textContent = '';
            return;
        }
        const def = PHASES[phase];
        phaseKicker.textContent = `Phase ${phase + 1} / ${PHASES.length}`;
        phaseTitle.textContent = PHASE_TEXT[phase].title;
        phaseBlurb.textContent = PHASE_TEXT[phase].blurb;
        for (const [item, n] of Object.entries(def.requires)) {
            const row = el('div', 'req');
            const dot = el('span', 'dot');
            dot.style.background = ITEM_COLOR[item] ?? '#fff';
            const name = el('span', 'req-name', ITEM_NAMES[item] ?? item);
            const count = el('span', 'req-count');
            const bar = el('div', 'bar req-bar');
            const fill = el('div', 'bar-fill');
            bar.appendChild(fill);
            row.append(dot, name, count, bar);
            reqList.appendChild(row);
            reqRows[item] = { count, fill, n };
        }
        unlockLine.textContent = def.unlocks.length
            ? `Unlocks: ${def.unlocks.map((t) => BUILDING_NAMES[t]).join(', ')}`
            : phase === PHASES.length - 1 ? 'Completes Project LIFELINE' : '';
    }

    function renderObjectives(list) {
        const sig = list.map((o) => `${o.id}:${o.done ? 1 : 0}`).join('|');
        if (sig === objSig) return;
        objSig = sig;
        objList.innerHTML = '';
        const firstOpen = list.find((o) => !o.done);
        for (const o of list) {
            const li = el('li', o.done ? 'done' : o === firstOpen ? 'active' : '');
            li.appendChild(el('span', 'check', o.done ? '✓' : '○'));
            li.appendChild(el('span', null, o.text));
            objList.appendChild(li);
        }
        objSec.classList.toggle('hidden', list.length === 0);
    }

    function renderOrder(o) {
        orderStatus.classList.remove('completed', 'failed');
        if (!o || o.status === 'none') {
            orderDemand.textContent = 'Awaiting request…';
            orderProgress.textContent = '';
            orderStatus.textContent = '';
            return;
        }
        orderDemand.textContent = `Deliver ${o.target} × ${ITEM_NAMES[o.productType] ?? o.productType}`;
        orderProgress.textContent = `${o.delivered}/${o.target} delivered · bonus ${o.reward}`;
        if (o.status === 'active') {
            orderStatus.textContent = `⏱ ${Math.ceil(o.remaining / TICK_RATE)} s left`;
        } else if (o.status === 'completed') {
            orderStatus.textContent = `✓ Completed  +${o.reward}`;
            orderStatus.classList.add('completed');
        } else if (o.status === 'failed') {
            orderStatus.textContent = '✗ Missed';
            orderStatus.classList.add('failed');
        }
    }

    function update() {
        const s = getState();
        if (!s) return;
        const { project } = s;
        if (project.phase !== phaseShown) buildPhaseDom(project.phase, project.complete);

        money.innerHTML = `<span class="cur">◈</span> ${s.money} <span class="unit">credits</span>`;
        const th = s.power.throttle;
        powerStat.textContent = `⚡ ${s.power.demand} / ${s.power.supply} power${th < 1 ? `  (${Math.round(th * 100)}%)` : ''}`;
        powerFill.style.width = `${Math.round(th * 100)}%`;
        powerFill.style.background = th >= 1 ? 'var(--green)' : th >= 0.5 ? '#e0a83a' : 'var(--red)';
        pauseBtn.firstChild.textContent = s.paused ? 'Resume' : 'Pause';
        speedLabel.textContent = `${s.speed.toFixed(2)}×`;

        for (const [item, row] of Object.entries(reqRows)) {
            const got = Math.min(row.n, project.delivered[item] ?? 0);
            row.count.textContent = `${got} / ${row.n}`;
            row.fill.style.width = `${(got / row.n) * 100}%`;
        }
        renderObjectives(s.objectives ?? []);

        for (const [tool, btn] of Object.entries(toolButtons)) {
            btn.classList.toggle('active', s.tool === tool);
            if (!(tool in MACHINE_COST)) continue;
            const unlocked = s.unlocked[tool];
            btn.classList.toggle('locked', !unlocked);
            btn.classList.toggle('disabled', unlocked && s.money < MACHINE_COST[tool]);
            btn.querySelector('.cost').textContent = unlocked ? MACHINE_COST[tool] : `🔒${unlockPhaseOf(tool) + 1}`;
            btn.title = unlocked ? BUILDING_DESC[tool] : `Unlocks after Phase ${unlockPhaseOf(tool) + 1}`;
        }

        orderSec.classList.toggle('hidden', project.phase < 1);
        renderOrder(s.order);

        researchSec.classList.toggle('hidden', !s.unlocked.lab);
        researchPoints.textContent = `🧪 ${s.research.points} research points`;
        for (const id of Object.keys(TECH_TEXT)) {
            const btn = techButtons[id];
            const unlocked = s.research.unlocked[id];
            btn.classList.toggle('unlocked', unlocked);
            btn.classList.toggle('disabled', !unlocked && s.research.points < TECH_COST[id]);
            btn.querySelector('.cost').textContent = unlocked ? '✓' : `${TECH_COST[id]} rp`;
        }

        hover.textContent = s.hovered ? `(${s.hoverX}, ${s.hoverY})\n${describe(s.hovered)}` : '—';
    }

    update();
    return { update, say, isBusy, showBanner, showTitle, showEnding, toast };
}
