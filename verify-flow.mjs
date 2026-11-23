// End-to-end check: start a campaign, build an iron + copper → circuit chain
// next to the Dispatch Pad with real mouse input in the 3D view, and assert
// that drag-laid belts turn their corners correctly and that money flows.
// Run with the dev server on :5173:  node verify-flow.mjs
import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';

// SwiftShader: headless Chromium otherwise renders WebGL canvases blank.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle' });
// Let the first load finish before reloading, or its in-flight model fetches
// get aborted and surface as "Failed to fetch" page errors.
await page.waitForSelector('text=Begin Onboarding', { timeout: 60000 });
await page.evaluate(() => localStorage.clear()); // start from a fresh contract
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=Begin Onboarding', { timeout: 60000 }); // models loaded
await page.click('text=Begin Onboarding'); // dismiss the title screen
// Skip the campaign gate so the Assembler is buildable (dev-only hook).
await page.evaluate(() => { window.__sim.project.phase = 1; });
// The phase jump plays the completion juice (camera shake + zoom punch): wait
// until the view is still, or the first clicks can land a cell off.
for (let i = 0, prev = null; i < 60; i++) {
    await page.waitForTimeout(150);
    const p = await page.evaluate(() => window.__renderer.projectCell(14, 11));
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.5) break;
    prev = p;
}

// Cell centres in page coordinates come from the renderer's own projection.
const center = (gx, gy) => page.evaluate(([x, y]) => window.__renderer.projectCell(x, y), [gx, gy]);

const readMoney = async () =>
    page.locator('.tb-value.credits').evaluate((el) => parseInt(el.textContent.replace(/[^0-9-]/g, ''), 10));

async function selectTool(key) {
    await page.keyboard.press(key); // 1 belt, 2 extractor, 3 smelter, 4 press, 6 assembler
}

async function clickCell(gx, gy) {
    const p = await center(gx, gy);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
}

// Drag through EVERY cell centre along the path (pointerdown → moves → pointerup).
async function dragBelt(cells) {
    const first = await center(cells[0][0], cells[0][1]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (let i = 1; i < cells.length; i++) {
        const p = await center(cells[i][0], cells[i][1]);
        await page.mouse.move(p.x, p.y, { steps: 4 });
    }
    await page.mouse.up();
}

const dirsAlong = (cells) =>
    page.evaluate((cs) => cs.map(([x, y]) => window.__grid[x][y].machine?.dir ?? null), cells);

// ---- Build the factory (machines via clicks, all default dir 'right') ------
// Starter fields: iron around (13,11), copper around (15,17); pad at (19,12).
await selectTool('2'); // extractor (on ore nodes)
await clickCell(14, 11); // iron
await clickCell(15, 16); // copper

await selectTool('3'); // smelter
await clickCell(16, 11); // iron smelter
await clickCell(17, 16); // copper smelter

// A new smelter starts on the iron recipe: open the copper one's panel (click it) and switch it.
await clickCell(17, 16);
await page.waitForSelector('.mpanel:not(.hidden)', { timeout: 5000 });
await page.click('.mp-recipe:has-text("Copper Ore")');
const copperRecipe = await page.evaluate(() => window.__grid[17][16].machine?.recipe);
await page.keyboard.press('Escape');
// The HUD redraws on the next frame, which can take a while under software rendering.
const panelClosed = await page
    .waitForFunction(() => document.querySelector('.mpanel')?.classList.contains('hidden'), null, { timeout: 4000 })
    .then(() => true, () => false);

// Presses right after the smelters: the iron one faces down (R once), the copper one up (R twice more).
await selectTool('4'); // press
await page.keyboard.press('r');
await clickCell(17, 11); // iron press → plates, facing down toward the assembler
await page.keyboard.press('r');
await page.keyboard.press('r');
await clickCell(18, 16); // copper press, facing up
await page.keyboard.press('r'); // back to 'right'
// A new press starts on Iron Plate: switch the copper one to Copper Wire in its panel.
await clickCell(18, 16);
await page.waitForSelector('.mpanel:not(.hidden)', { timeout: 5000 });
await page.click('.mp-recipe:has-text("Copper Wire")');
const wireRecipe = await page.evaluate(() => window.__grid[18][16].machine?.recipe);
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelector('.mpanel')?.classList.contains('hidden'), null, { timeout: 4000 }).catch(() => {});
const pressDirs = await page.evaluate(() => [window.__grid[17][11].machine?.dir, window.__grid[18][16].machine?.dir]);

await selectTool('6'); // assembler: one iron plate + one copper wire → circuit
await clickCell(17, 13);

// ---- Lay every belt by dragging --------------------------------------------
await selectTool('1'); // belt
await clickCell(15, 11); // extractor → iron smelter feed
await clickCell(16, 16); // extractor → copper smelter feed

const ironRoute = [[17, 12], [17, 13]]; // iron press out → down into the assembler (N)
const copperRoute = [[18, 15], [18, 14], [17, 14], [17, 13]]; // copper press out → up → left → into the assembler (S)
const outRoute = [[18, 13], [19, 13], [19, 12]]; // assembler → right → up into the pad
await dragBelt(ironRoute);
await dragBelt(copperRoute);
await dragBelt(outRoute);

// ---- Inspect the corners the dragged belts produced ------------------------
const ironDirs = await dirsAlong(ironRoute);
const copperDirs = await dirsAlong(copperRoute);
const outDirs = await dirsAlong(outRoute);

const baseline = await readMoney();

// ---- Let it run; poll money for ~14s real time -----------------------------
let peak = baseline;
let firstPayAt = null;
const t0 = Date.now();
while (Date.now() - t0 < 14000) {
    await page.waitForTimeout(400);
    const m = await readMoney();
    if (m > peak) {
        peak = m;
        if (firstPayAt === null) firstPayAt = ((Date.now() - t0) / 1000).toFixed(1);
    }
}
const circuits = await page.evaluate(() => window.__sim.stats.delivered.circuit ?? 0);

await browser.close();

// ---- Report ----------------------------------------------------------------
const fmt = (cells, dirs) => cells.map(([x, y], i) => `(${x},${y})=${dirs[i] ?? 'machine'}`).join('  ');
console.log('Iron route  :', fmt(ironRoute, ironDirs));
console.log('Copper route:', fmt(copperRoute, copperDirs));
console.log('Out route   :', fmt(outRoute, outDirs));
console.log('');
console.log(`Money after build (baseline): ${baseline}`);
console.log(`Money peak after running    : ${peak}`);
console.log(`First payout at             : ${firstPayAt ? firstPayAt + 's' : 'never'}`);
console.log(`Circuits delivered          : ${circuits}`);
if (errors.length) console.log('Page errors:', errors);
console.log('');

// Corner expectations from the drag logic (the cell being left re-points).
const checks = [
    ['presses face down (iron) and up (copper) after R', pressDirs[0] === 'down' && pressDirs[1] === 'up'],
    ['iron belt (17,12) points down into assembler', ironDirs[0] === 'down'],
    ['copper corner (18,14) turns left', copperDirs[1] === 'left'],
    ['copper belt (17,14) points up into assembler', copperDirs[2] === 'up'],
    ['copper press switched to Copper Wire in its panel', wireRecipe === 'copperWire'],
    ['out belt (19,13) points up into the pad', outDirs[1] === 'up'],
    ['copper smelter switched to Copper Ingot in its panel', copperRecipe === 'copperIngot'],
    ['Escape closes the panel', panelClosed === true],
    ['circuits reach the pad and money increases', circuits > 0 && peak > baseline],
    ['no page errors', errors.length === 0],
];
let failed = 0;
for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
