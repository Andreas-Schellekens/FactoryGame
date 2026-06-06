// src/ui.js — the HUD, built as plain DOM (not drawn on the canvas), so it
// never overlaps the playfield. Driven entirely through the callbacks and the
// getState() pull function passed in from main.js.
import { MACHINE_COST } from './config.js';

function button(label, onClick, { id, sub } = {}) {
    const el = document.createElement('button');
    el.className = 'btn';
    el.id = id ?? '';
    el.addEventListener('click', onClick);
    const main = document.createElement('span');
    main.textContent = label;
    el.appendChild(main);
    if (sub != null) {
        const tag = document.createElement('span');
        tag.className = 'cost';
        tag.textContent = sub;
        el.appendChild(tag);
    }
    return el;
}

function section(title) {
    const wrap = document.createElement('div');
    wrap.className = 'section';
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = title;
    wrap.appendChild(h);
    return wrap;
}

/**
 * @param {{
 *   root: HTMLElement,
 *   onToolChange: (tool: string) => void,
 *   onRotate: () => void,
 *   onTogglePause: () => void,
 *   onSpeedChange: (delta: number) => void,
 *   onSave: () => boolean,
 *   onLoad: () => boolean,
 *   getState: () => any,
 * }} opts
 */
export function createUI({ root, onToolChange, onRotate, onTogglePause, onSpeedChange, onSave, onLoad, getState }) {
    root.innerHTML = '';

    const title = document.createElement('h1');
    title.className = 'app-title';
    title.textContent = 'Factory';
    root.appendChild(title);

    // Status.
    const stats = section('Status');
    const money = document.createElement('div');
    money.className = 'stat money';
    const speedStat = document.createElement('div');
    speedStat.className = 'stat';
    stats.append(money, speedStat);
    root.appendChild(stats);

    // Order — a timed demand for a bonus reward.
    const orderSec = section('Order');
    const orderDemand = document.createElement('div');
    orderDemand.className = 'stat';
    const orderProgress = document.createElement('div');
    orderProgress.className = 'stat mono';
    const orderStatus = document.createElement('div');
    orderStatus.className = 'stat order-status';
    orderSec.append(orderDemand, orderProgress, orderStatus);
    root.appendChild(orderSec);

    // Build tools (each shows its cost).
    const build = section('Build');
    const toolButtons = {};
    const buildDefs = [
        ['belt', 'Belt'],
        ['splitter', 'Splitter'],
        ['merger', 'Merger'],
        ['extractor', 'Extractor'],
        ['smelter', 'Smelter'],
        ['assembler', 'Assembler'],
    ];
    for (const [tool, label] of buildDefs) {
        const b = button(label, () => onToolChange(tool), { sub: MACHINE_COST[tool] });
        toolButtons[tool] = b;
        build.appendChild(b);
    }
    root.appendChild(build);

    // Editing tools.
    const edit = section('Tools');
    toolButtons.upgrade = button('Upgrade', () => onToolChange('upgrade'));
    toolButtons.erase = button('Erase', () => onToolChange('erase'));
    const rotateBtn = button('Rotate ⟳', onRotate);
    edit.append(toolButtons.upgrade, toolButtons.erase, rotateBtn);
    root.appendChild(edit);

    // Simulation controls.
    const sim = section('Simulation');
    const pauseBtn = button('Pause', onTogglePause);
    const speedRow = document.createElement('div');
    speedRow.className = 'row';
    speedRow.append(button('– Slower', () => onSpeedChange(-1)), button('+ Faster', () => onSpeedChange(1)));
    sim.append(pauseBtn, speedRow);
    root.appendChild(sim);

    // Save / load to localStorage.
    const save = section('Save');
    const saveStatus = document.createElement('div');
    saveStatus.className = 'save-status';
    let saveStatusTimer = null;
    const flashSave = (msg) => {
        saveStatus.textContent = msg;
        if (saveStatusTimer) clearTimeout(saveStatusTimer);
        saveStatusTimer = setTimeout(() => (saveStatus.textContent = ''), 2000);
    };
    const saveRow = document.createElement('div');
    saveRow.className = 'row';
    saveRow.append(
        button('Save', () => flashSave(onSave() ? 'Saved ✓' : 'Save failed')),
        button('Load', () => flashSave(onLoad() ? 'Loaded ✓' : 'No save')),
    );
    save.append(saveRow, saveStatus);
    root.appendChild(save);

    // Inspector.
    const inspect = section('Inspector');
    const hover = document.createElement('div');
    hover.className = 'stat mono';
    inspect.appendChild(hover);
    root.appendChild(inspect);

    // Help.
    const help = document.createElement('div');
    help.className = 'help';
    help.innerHTML = [
        '<b>Chain:</b> <span class="r1">ore</span> → Extractor → Smelter → Assembler → Sink',
        'Place an <b>Extractor</b> on an ore node, route ingots into an <b>Assembler</b>, sink the product.',
        '<b>LMB</b> use tool &nbsp; <b>RMB</b> erase &nbsp; <b>R</b> rotate',
        '<b>1–4,7,8</b> build &nbsp; <b>5</b> upgrade &nbsp; <b>6</b> erase &nbsp; <b>Space</b> pause',
    ].join('<br>');
    root.appendChild(help);

    function describe(cell) {
        if (!cell) return '—';
        const parts = [];
        if (cell.resource) parts.push(`node: ${cell.resource}`);
        if (cell.machine) {
            const m = cell.machine;
            let line = m.type;
            if (m.dir && m.type !== 'sink') line += ` ▸${m.dir}`;
            if (m.tier) line += `  T${m.tier}`;
            parts.push(line);
            const buf = Object.entries(m.buffer || {}).filter(([, n]) => n > 0);
            if (buf.length) parts.push('buffer: ' + buf.map(([k, n]) => `${k}×${n}`).join(', '));
            if (m.pendingOutput) parts.push(`out: ${m.pendingOutput}`);
        }
        if (cell.item) parts.push(`item: ${cell.item.type}`);
        return parts.length ? parts.join('\n') : 'empty';
    }

    function renderOrder(o) {
        orderStatus.classList.remove('completed', 'failed');
        if (!o || o.status === 'none') {
            orderDemand.textContent = 'No active order';
            orderProgress.textContent = '';
            orderStatus.textContent = '';
            return;
        }
        orderDemand.textContent = `Deliver ${o.target} ${o.productType}`;
        orderProgress.textContent = `${o.delivered}/${o.target} delivered`;
        if (o.status === 'active') {
            orderStatus.textContent = `⏱ ${o.remaining} ticks left`;
        } else if (o.status === 'completed') {
            orderStatus.textContent = `✓ Completed  +${o.reward}`;
            orderStatus.classList.add('completed');
        } else if (o.status === 'failed') {
            orderStatus.textContent = '✗ Failed';
            orderStatus.classList.add('failed');
        }
    }

    function update() {
        const s = getState();
        if (!s) return;
        money.textContent = `💰 ${s.money}`;
        speedStat.textContent = `Speed: ${s.speed.toFixed(2)}×${s.paused ? ' (paused)' : ''}`;
        renderOrder(s.order);
        pauseBtn.firstChild.textContent = s.paused ? 'Resume' : 'Pause';
        hover.textContent = s.hovered ? `(${s.hoverX}, ${s.hoverY})\n${describe(s.hovered)}` : '—';

        for (const [tool, btn] of Object.entries(toolButtons)) {
            btn.classList.toggle('active', s.tool === tool);
            if (tool in MACHINE_COST) btn.classList.toggle('disabled', s.money < MACHINE_COST[tool]);
        }
    }

    update();
    return { update };
}
