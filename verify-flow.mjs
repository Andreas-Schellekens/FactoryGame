import { chromium } from 'playwright';

const TILE = 64;
const URL = 'http://localhost:5173/';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('#stage canvas');

const canvasBox = await page.locator('#stage canvas').boundingBox();
const center = (gx, gy) => ({ x: canvasBox.x + gx * TILE + TILE / 2, y: canvasBox.y + gy * TILE + TILE / 2 });

const readMoney = async () =>
    page.locator('.stat.money').evaluate((el) => parseInt(el.textContent.replace(/[^0-9-]/g, ''), 10));

async function selectTool(key) {
    await page.keyboard.press(key); // 1 belt, 2 extractor, 3 smelter, 4 assembler
}

async function clickCell(gx, gy) {
    const p = center(gx, gy);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
}

// Drag through EVERY cell center along the path (pointerdown → moves → pointerup).
async function dragBelt(cells) {
    const first = center(cells[0][0], cells[0][1]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (let i = 1; i < cells.length; i++) {
        const p = center(cells[i][0], cells[i][1]);
        await page.mouse.move(p.x, p.y, { steps: 4 });
    }
    await page.mouse.up();
}

const dirsAlong = (cells) =>
    page.evaluate((cs) => cs.map(([x, y]) => window.__grid[x][y].machine?.dir ?? null), cells);

// ---- Build the factory (machines via clicks, all default dir 'right') ------
await selectTool('2'); // extractor (on ore nodes)
await clickCell(1, 1); // iron
await clickCell(1, 7); // copper

await selectTool('3'); // smelter
await clickCell(3, 1); // iron smelter
await clickCell(3, 7); // copper smelter

await selectTool('4'); // assembler (combines ironIngot + copperIngot → circuit)
await clickCell(6, 4);

// ---- Lay every belt by dragging --------------------------------------------
await selectTool('1'); // belt
await clickCell(2, 1); // extractor → iron smelter feed
await clickCell(2, 7); // extractor → copper smelter feed

const ironRoute = [[4, 1], [5, 1], [5, 2], [5, 3], [5, 4], [6, 4]]; // smelter out → down → into assembler (W)
const copperRoute = [[4, 7], [5, 7], [6, 7], [6, 6], [6, 5], [6, 4]]; // smelter out → up → into assembler (S)
const outRoute = [[7, 4], [8, 4], [9, 4], [10, 4]]; // assembler → sink
await dragBelt(ironRoute);
await dragBelt(copperRoute);
await dragBelt(outRoute);

// ---- Inspect the corners the dragged belts produced ------------------------
const ironDirs = await dirsAlong(ironRoute);
const copperDirs = await dirsAlong(copperRoute);
const outDirs = await dirsAlong(outRoute);

const baseline = await readMoney();

// ---- Let it run; poll money for ~12s real time -----------------------------
let peak = baseline;
let firstPayAt = null;
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
    await page.waitForTimeout(400);
    const m = await readMoney();
    if (m > peak) {
        peak = m;
        if (firstPayAt === null) firstPayAt = ((Date.now() - t0) / 1000).toFixed(1);
    }
}

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
console.log('');

// Corner expectations from the drag logic (the cell being left re-points).
const checks = [
    ['iron corner (5,1) turns down', ironDirs[1] === 'down'],
    ['iron corner (5,4) turns right into assembler', ironDirs[4] === 'right'],
    ['copper corner (6,7) turns up', copperDirs[2] === 'up'],
    ['copper corner (6,5) points up into assembler', copperDirs[4] === 'up'],
    ['out belt (9,4) points right into sink', outDirs[2] === 'right'],
    ['money increased while running (items flow through corners)', peak > baseline],
];
let failed = 0;
for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
