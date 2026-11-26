// Iteration 7, stream A (build help), end to end with real input in the 3D view:
// undo / redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) of a build, an upgrade, a demolish, a drag-laid
// belt and a group move, with the credits checked to the unit; the alerts list (key N) finding
// a blocked machine and the camera jumping to it; a ratio line in the machine panel.
//   node verify-build-help.mjs     (dev server on :5173; another port: SELENE_URL=http://localhost:5181/)
import { chromium } from 'playwright';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail = '') => {
    results.push([name, !!ok]);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const js = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const score = () => js(() => window.__sim.score);
const typeAt = ([x, y]) => js(([cx, cy]) => window.__grid[cx][cy].machine?.type ?? null, [x, y]);
const machineAt = ([x, y]) => js(([cx, cy]) => {
    const m = window.__grid[cx][cy].machine;
    return m ? { type: m.type, dir: m.dir, tier: m.tier } : null;
}, [x, y]);
const center = ([x, y]) => js(([cx, cy]) => window.__renderer.projectCell(cx, cy), [x, y]);
async function clickCell(cell, button = 'left') {
    const p = await center(cell);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button });
    await page.mouse.up({ button });
    await wait(60);
}
async function drag(from, to, button = 'left') {
    const a = await center(from);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button });
    const steps = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const c = [Math.round(from[0] + (to[0] - from[0]) * t), Math.round(from[1] + (to[1] - from[1]) * t)];
        const p = await center(c);
        await page.mouse.move(p.x, p.y, { steps: 4 });
    }
    await page.mouse.up({ button });
    await wait(60);
}
async function stillView() {
    for (let i = 0, prev = null; i < 60; i++) {
        await wait(150);
        const p = await center([16, 10]);
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.5) break;
        prev = p;
    }
}
const toast = () => js(() => document.querySelector('.toast')?.textContent ?? '');

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('text=Begin onboarding', { timeout: 90000 });
await js(() => {
    localStorage.clear();
    sessionStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=Begin onboarding', { timeout: 90000 });
await page.click('text=Begin onboarding');
await wait(400);
await js(() => {
    window.__sim.project.phase = 1; // the press, the assembler and the routers
    const d = window.__sim.serialize();
    d.score = 1000;
    window.__sim.loadState(d);
});
await stillView();

// Free cells (no machine, ore, water or reserved site; inside the plot) clear of the HUD panels.
const free = await js(() => {
    const out = [];
    const s = window.__sim;
    for (let x = 0; x < s.grid.length; x++) {
        for (let y = 0; y < s.grid[0].length; y++) {
            const c = s.grid[x][y];
            if (c.machine || c.resource || c.blocked || c.water || !s.inPlot(x, y)) continue;
            const p = window.__renderer.projectCell(x, y);
            if (p.x > 520 && p.x < 1180 && p.y > 160 && p.y < 640) out.push(`${x},${y}`);
        }
    }
    return out;
});
const isFree = (x, y) => free.includes(`${x},${y}`);
// A row of five free cells (belts, the smelter, the move target).
let row = null;
for (const k of free) {
    const [x, y] = k.split(',').map(Number);
    if ([0, 1, 2, 3, 4].every((i) => isFree(x + i, y)) && [0, 1, 2, 3, 4].every((i) => isFree(x + i, y + 2))) {
        row = [x, y];
        break;
    }
}
check('found room to build', !!row, row ? `from ${row}` : '');
const [rx, ry] = row;
const A = [rx, ry];           // the smelter
const B = [rx + 3, ry + 2];   // where the group move puts it

// ---- Undo / redo: a build ------------------------------------------------------------------
let cr = await score();
await page.keyboard.press('3');
await clickCell(A);
check('a smelter is built for CR 20', (await typeAt(A)) === 'smelter' && (await score()) === cr - 20, `CR ${cr} → ${await score()}`);
await page.keyboard.press('Control+z');
check('Ctrl+Z takes it away and gives the CR 20 back', (await typeAt(A)) === null && (await score()) === cr, await toast());
await page.keyboard.press('Control+y');
check('Ctrl+Y builds it again for CR 20', (await typeAt(A)) === 'smelter' && (await score()) === cr - 20, await toast());
check('Ctrl+Y did not pick the merger key', await js(() => window.__state.tool) === 'smelter');

// ---- An upgrade, then a demolish, undone one by one ------------------------------------------
cr = await score();
await page.keyboard.press('u');
await clickCell(A);
check('the upgrade costs CR 30 (T2)', (await machineAt(A))?.tier === 2 && (await score()) === cr - 30);
await page.keyboard.press('3');
await clickCell(A, 'right');
check('demolishing refunds CR 20', (await typeAt(A)) === null && (await score()) === cr - 30 + 20);
await page.keyboard.press('Control+z');
const back = await machineAt(A);
check('undoing the demolish brings the T2 smelter back and charges the CR 20 again', back?.type === 'smelter' && back.tier === 2 && (await score()) === cr - 30, await toast());
check('it comes back empty (no buffer, no items)', await js(([x, y]) => Object.keys(window.__grid[x][y].machine.buffer).length === 0 && !window.__grid[x][y].item, A));
await page.keyboard.press('Control+z');
check('undoing the upgrade gives the CR 30 back (T1)', (await machineAt(A))?.tier === 1 && (await score()) === cr, await toast());
await page.keyboard.press('Control+Shift+Z');
check('Ctrl+Shift+Z redoes the upgrade', (await machineAt(A))?.tier === 2 && (await score()) === cr - 30, await toast());
await page.keyboard.press('Control+z');

// ---- A drag-laid belt is one step --------------------------------------------------------
cr = await score();
const steps0 = await js(() => window.__undo.size().undo);
await page.keyboard.press('1');
await drag([rx, ry + 2], [rx + 2, ry + 2]);
const laid = await js(([x, y]) => [0, 1, 2].filter((i) => window.__grid[x + i][y].machine?.type === 'belt').length, [rx, ry + 2]);
check('a drag lays three belts as one step', laid === 3 && (await js(() => window.__undo.size().undo)) === steps0 + 1 && (await score()) === cr - 3);
await page.keyboard.press('Control+z');
const left = await js(([x, y]) => [0, 1, 2].filter((i) => window.__grid[x + i][y].machine).length, [rx, ry + 2]);
check('one Ctrl+Z takes the whole belt away and refunds CR 3', left === 0 && (await score()) === cr, await toast());

// ---- A group move ---------------------------------------------------------------------------
cr = await score();
await page.keyboard.press('v');
await drag(A, A); // a box round the smelter
check('the select tool picks the smelter', await js(() => window.__state.sel?.cells.length) === 1);
await page.keyboard.press('g');
const to = await center(B);
await page.mouse.move(to.x, to.y, { steps: 4 });
await wait(150);
await page.mouse.down();
await page.mouse.up();
await wait(100);
check('the group move puts it down elsewhere, free of charge', (await typeAt(B)) === 'smelter' && (await typeAt(A)) === null && (await score()) === cr);
await page.keyboard.press('Escape'); // drop the selection
await page.keyboard.press('Control+z');
check('Ctrl+Z moves it back (T1, same credits)', (await typeAt(A)) === 'smelter' && (await typeAt(B)) === null && (await machineAt(A)).tier === 1 && (await score()) === cr, await toast());
await page.keyboard.press('Control+y');
check('Ctrl+Y moves it again', (await typeAt(B)) === 'smelter' && (await typeAt(A)) === null && (await score()) === cr);
await page.keyboard.press('Control+z');

// ---- A refused undo: not enough credits ---------------------------------------------------
await page.keyboard.press('3');
await clickCell(A, 'right'); // demolish (+20)
await js(() => window.__sim.rewriteCells([], 5 - window.__sim.score)); // credits only: the history stays
await page.keyboard.press('Control+z');
check('an undo it can’t pay for is refused', (await typeAt(A)) === null && (await score()) === 5, await toast());
await js(() => window.__sim.rewriteCells([], 995));
await page.keyboard.press('Control+z');
check('…and goes through once the credits are there', (await typeAt(A)) === 'smelter');

// ---- Ratios in the machine panel ------------------------------------------------------------
await page.keyboard.press('3');
await clickCell(A); // a click on a machine opens its panel
await page.waitForSelector('.mpanel:not(.hidden) .mp-ratios', { timeout: 5000 });
check('the ratios start folded behind their header', await js(() => document.querySelector('.mp-ratios').classList.contains('fold-shut')));
await page.click('.mpanel .mp-ratios .fold-head'); // open them (the panel remembers it)
const ratios = await js(() => document.querySelector('.mp-ratios').innerText);
check('the panel shows how many extractors feed the smelter', /Iron Ore[\s\S]*1 Extractor · T1/.test(ratios), ratios.replace(/\s+/g, ' '));
check('…and how many presses it feeds', /Iron Ingot[\s\S]*Press(es)? → Iron Plate · T1/.test(ratios));
await page.keyboard.press('Escape');

// ---- Alerts: a blocked extractor ---------------------------------------------------------
// An extractor on iron ore aimed at an empty cell fills up and blocks.
const ore = await js(() => {
    const s = window.__sim;
    for (let x = 0; x < s.grid.length; x++) {
        for (let y = 0; y < s.grid[0].length; y++) {
            const c = s.grid[x][y];
            const n = s.grid[x + 1]?.[y];
            const p = window.__renderer.projectCell(x, y);
            if (c.resource === 'ironOre' && !c.machine && n && !n.machine && !n.resource && !n.water && s.inPlot(x, y) && p.x > 520 && p.x < 1180 && p.y > 160 && p.y < 640) return [x, y];
        }
    }
    return null;
});
await js(() => window.__renderer.rig.focusOn(4, 20)); // look elsewhere first
await wait(300);
await js(([x, y]) => window.__sim.buildMachine(x, y, 'extractor', 'right'), ore);
await js(() => (window.__state.speed = 4));
let found = null;
for (let i = 0; i < 40 && !found; i++) {
    await wait(500);
    found = await js(() => window.__alerts.groups().find((g) => g.kind === 'blocked'));
}
await js(() => (window.__state.speed = 1));
check('the alerts list finds the blocked extractor (after a few seconds)', !!found && found.cells.some((c) => c.x === ore[0] && c.y === ore[1]));
check('the top bar counts it', /\d/.test(await js(() => document.querySelector('.tb-alerts-n').textContent)));
await page.keyboard.press('n');
await page.waitForSelector('.alerts-panel:not(.hidden) .al-row[data-kind="blocked"]', { timeout: 5000 });
await page.click('.al-row[data-kind="blocked"]');
const goal = { x: found.cells[0].x + 0.5, z: found.cells[0].y + 0.5 };
let jump = null;
for (let i = 0; i < 60; i++) { // the camera eases there (slowly, at SwiftShader's frame rate)
    await wait(150);
    jump = await js(() => ({ sel: window.__state.selected, t: { x: window.__renderer.rig.target.x, z: window.__renderer.rig.target.z } }));
    if (Math.hypot(jump.t.x - goal.x, jump.t.z - goal.z) < 0.5) break;
}
check('clicking it opens the machine’s panel', jump.sel?.x === found.cells[0].x && jump.sel?.y === found.cells[0].y);
check('…and moves the camera there', Math.hypot(jump.t.x - goal.x, jump.t.z - goal.z) < 0.5, JSON.stringify(jump.t));
check('the alerts list stays open beside the panel', await page.isVisible('.alerts-panel') && await page.isVisible('.mpanel'));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
