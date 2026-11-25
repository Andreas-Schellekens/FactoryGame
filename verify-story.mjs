// Iteration 7's story additions: Nolan Isaac Locke referenced before the reveal (a broadcast
// from "our Chief Executive", his name on the construction site's sign), and the epilogue after
// the NIHIL HQ ending: four goals in the flight plan, completed here with the dev hooks, each
// changing the valley (the east-rim sulfur, the river back in its bed), then the annual report;
// a reload keeps it all, and a save from before the epilogue existed starts it on load.
//   node verify-story.mjs        (dev server on :5173; another port: SELENE_URL=http://localhost:5186/)
import { chromium } from 'playwright';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const results = [];
const check = (name, ok, detail = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const js = (fn, arg) => page.evaluate(fn, arg);
const boot = () => page.waitForSelector('text=Start Infinite', { timeout: 90000 });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(URL, { waitUntil: 'networkidle' });
await boot();
await js(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: 'networkidle' });
await boot();

// ---- Nolan before the reveal -------------------------------------------------------------------
await page.click('text=Begin onboarding');
await wait(800);
await js(() => {
    window.__sim.stats.produced.ironIngot = 12;
    window.__sim.stats.delivered.ironIngot = 12;
});
// Click through DELTA's lines until the Chief Executive's message comes up.
let ceo = '';
for (let i = 0; i < 160 && !/CHIEF EXECUTIVE/.test(ceo); i++) {
    ceo = await js(() => document.querySelector('.comms-text')?.textContent ?? '');
    if (!/CHIEF EXECUTIVE/.test(ceo)) await page.click('.comms-text', { force: true }).catch(() => {});
    await wait(120);
}
const ceoHead = await js(() => document.querySelector('.comms-name')?.textContent ?? '');
check('phase 1: NILE broadcasts a message from the Chief Executive', /CHIEF EXECUTIVE/.test(ceo) && /BROADCAST/.test(ceoHead), ceoHead);
await js(() => window.__renderer.rig.focusOn(24, 15));
await wait(1800);
const site = await js(() => window.__renderer.projectCell(21, 11));
await page.mouse.move(site.x, site.y);
await wait(400);
const sign = await js(() => document.querySelector('.tooltip')?.innerText ?? '');
check("the construction site's sign carries his name", /N\. I\. LOCKE/.test(sign), sign.split('\n').pop());

// ---- A phase waits for Confirm delivery -----------------------------------------------------------
await js(() => { for (const [k, n] of Object.entries(window.__sim.currentPhase().requires)) window.__sim.project.delivered[k] = n; });
await wait(1500);
const ready = await js(() => ({ phase: window.__sim.project.phase, button: !!document.querySelector('.con-confirm:not(.hidden)') }));
check('phase 1 waits for Confirm delivery once everything is in', ready.phase === 0 && ready.button, JSON.stringify(ready));
let said = '';
for (let i = 0; i < 120 && !/Confirm delivery/.test(said); i++) {
    said = await js(() => document.querySelector('.comms-text')?.textContent ?? '');
    if (!/Confirm delivery/.test(said)) await page.click('.comms-text', { force: true }).catch(() => {});
    await wait(120);
}
check('DELTA says the delivery can be confirmed', /Confirm delivery/.test(said), said.slice(0, 60));
await page.click('.con-confirm');
await wait(600);
check('confirming completes the phase', (await js(() => window.__sim.project.phase)) === 1);

// ---- The HQ ending, then the epilogue ----------------------------------------------------------
await js(() => {
    window.__sim.project.phase = 5;
    window.__sim.project.complete = true;
});
await page.waitForSelector('.end-choice', { timeout: 15000 });
await page.keyboard.press('2');
for (let i = 0; i < 40 && !(await page.isVisible('.end-company')); i++) {
    await page.mouse.click(800, 480); // a click skips ahead
    await wait(400);
}
await page.fill('.ecp-input', 'Valley Works');
await page.keyboard.press('Enter');
await page.waitForSelector('.report', { timeout: 10000 });
await page.click('.report .btn-primary');
await wait(1200);
const start = await js(() => ({
    epi: window.__sim.project.epilogue,
    plan: [...document.querySelectorAll('.plan li .plan-text')].map((n) => n.textContent),
    ribbon: document.querySelector('.ribbon')?.innerText ?? '',
    reqs: [...document.querySelectorAll('.req .req-name')].map((n) => n.textContent),
}));
check('the epilogue starts after the founding report', start.epi?.stage === 0, JSON.stringify(start.epi?.base ?? null));
check('its four goals are in the flight plan', start.plan.length === 4 && start.plan[0] === 'Relight the camp', start.plan.join(' · '));
check('the ribbon and the console show the first goal', /GOAL 01 OF 04/.test(start.ribbon) && start.reqs.includes('Circuit'), start.reqs.join(', '));

/** Confirm delivery in the console (a goal waits for it once everything is in). */
async function confirmDelivery() {
    await page.waitForSelector('.con-confirm:not(.hidden)', { timeout: 10000 });
    await page.click('.con-confirm');
}
/** Deliver what the active goal asks for (the dev hook: stats.delivered), confirm, then wait for the next stage. */
async function finishGoal({ confirm = true } = {}) {
    const before = await js(() => {
        const e = window.__sim.project.epilogue;
        const goal = window.__epilogue.GOALS[e.stage];
        for (const [k, n] of Object.entries(goal.requires)) window.__sim.stats.delivered[k] = (window.__sim.stats.delivered[k] ?? 0) + n;
        return e.stage;
    });
    if (!confirm) return before;
    await confirmDelivery();
    for (let i = 0; i < 30; i++) {
        if (await js(() => window.__sim.project.epilogue.stage) > before) return before + 1;
        await wait(200);
    }
    return before;
}
const water = () => js(() => {
    let n = 0;
    for (const col of window.__sim.grid) for (const c of col) if (c.river && c.water) n++;
    return n;
});

await finishGoal({ confirm: false });
await wait(1200);
const waiting = await js(() => ({ stage: window.__sim.project.epilogue.stage, button: !!document.querySelector('.con-confirm:not(.hidden)') }));
check('goal 1 waits for Confirm delivery once its deliveries are in', waiting.stage === 0 && waiting.button, JSON.stringify(waiting));
await confirmDelivery();
for (let i = 0; i < 30 && (await js(() => window.__sim.project.epilogue.stage)) < 1; i++) await wait(200);
check('goal 1 (the camp) completes when confirmed', (await js(() => window.__sim.project.epilogue.stage)) === 1);
await wait(300);
const banner = await js(() => document.querySelector('.ribbon')?.innerText ?? '');
check('a goal banner celebrates it', /GOAL 01 · DONE/.test(banner), banner.replace(/\n/g, ' / '));

// (The east rim: x ≥ 27. The dev-hook phase jump skips the reveal, so the bed's sulfur is no measure.)
const eastSulfur = () => js(() => window.__grid.slice(27).flat().filter((c) => c.resource === 'sulfurOre').length);
const sulfurBefore = await eastSulfur();
check('goal 2 (the compound) completes', (await finishGoal()) === 2);
const sulfurAfter = await eastSulfur();
check('clearing the compound lays the east-rim sulfur', sulfurAfter > sulfurBefore, `${sulfurBefore} → ${sulfurAfter}`);

// The river goal waits while anything of ours stands in the old bed.
const bedCell = await js(() => {
    for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 24; y++) {
            const c = window.__grid[x][y];
            if (c.river && !c.machine && !c.water && window.__sim.buildMachine(x, y, 'belt', 'right')) return { x, y };
        }
    }
    return null;
});
await js(() => {
    const goal = window.__epilogue.GOALS[window.__sim.project.epilogue.stage];
    for (const [k, n] of Object.entries(goal.requires)) window.__sim.stats.delivered[k] = (window.__sim.stats.delivered[k] ?? 0) + n;
});
await wait(1200);
const held = await js(() => ({ stage: window.__sim.project.epilogue.stage, bed: document.querySelector('.req:last-child .req-count')?.textContent }));
check('the river waits for a clear bed', !!bedCell && held.stage === 2 && /1 left/.test(held.bed ?? ''), held.bed);
check('the river bed is dry before', (await water()) === 0);
await js((c) => window.__sim.removeMachine(c.x, c.y), bedCell);
await confirmDelivery();
for (let i = 0; i < 20 && (await js(() => window.__sim.project.epilogue.stage)) < 3; i++) await wait(200);
check('goal 3 (the river) completes once the bed is clear', (await js(() => window.__sim.project.epilogue.stage)) === 3);
const wet = await water();
check('the river runs in its bed again', wet > 0 && (await js((c) => !window.__sim.canBuildMachine(c.x, c.y, 'belt'), bedCell)), `${wet} water cells`);

check('goal 4 (the valley) completes', (await finishGoal()) === 4);
// DELTA's closing lines, then the report.
for (let i = 0; i < 120 && !(await page.isVisible('.report')); i++) {
    await page.click('.comms-text', { force: true }).catch(() => {});
    await wait(200);
}
const report = await js(() => document.querySelector('.report')?.innerText ?? '');
check('the epilogue closes with the annual report', /YEAR ONE/i.test(report) && /RIVERS RETURNED/i.test(report), report.split('\n').slice(0, 3).join(' / '));
await page.click('.report .btn-primary');
await wait(800);
const after = await js(() => ({ plan: document.querySelectorAll('.plan li').length, closed: window.__sim.project.epilogue.closed, ribbon: document.querySelector('.ribbon')?.innerText }));
check('then the sandbox: the flight plan is cleared', after.plan === 0 && after.closed, after.ribbon?.replace(/\n/g, ' / '));

// ---- A reload keeps it -----------------------------------------------------------------------
await page.reload({ waitUntil: 'networkidle' });
await boot();
await page.click('.btn-continue');
await wait(2000);
const back = await js(() => ({ epi: window.__sim.project.epilogue, report: !!document.querySelector('.report') }));
check('a reload keeps the epilogue done and the river flowing, without the report again', back.epi?.stage === 4 && back.epi.closed && !back.report && (await water()) > 0);

// ---- A save from before the epilogue existed ---------------------------------------------------
await js(() => {
    window.__state.started = false; // no save on the way out
    const id = window.__saves.activeId();
    const data = JSON.parse(localStorage.getItem(`selene.slot.${id}`));
    delete data.project.epilogue;
    data.story.flags = data.story.flags.filter((f) => !/epi/.test(f)); // nor DELTA's memory of it
    localStorage.setItem(`selene.slot.${id}`, JSON.stringify(data));
});
await page.reload({ waitUntil: 'networkidle' });
await boot();
await page.click('.btn-continue');
await wait(2000);
const old = await js(() => ({ epi: window.__sim.project.epilogue, plan: document.querySelectorAll('.plan li').length, done: document.querySelectorAll('.plan li.done').length }));
check('an older save after the HQ ending starts the epilogue on load', old.epi?.stage === 0 && old.plan === 4 && old.done === 0);
check('...with the river dammed again until its goal', (await water()) === 0);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
