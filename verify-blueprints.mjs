// Iteration 7, stream C end to end: blueprints (save a selection, the library, place one,
// export/import, sync to a throwaway account), viewing a leaderboard factory (submit an
// Infinite factory, View it from the leaderboard, it runs read-only without touching the
// player's slot, Back returns to the game), share links (the link opens the viewer straight
// away, also for a stranger), Copy as blueprint, and the account's export and deletion.
// Needs the API (npm run dev:api, or api/target/release/selene-api.exe) behind the dev server.
//   node verify-blueprints.mjs        (dev server on :5173; another port: SELENE_URL=http://localhost:5183/)
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMALL } from './scripts/bench-cases.mjs';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const ORIGIN = new globalThis.URL(URL).origin;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

const results = [];
const check = (name, ok, detail = '') => {
    results.push([name, !!ok]);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const js = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
async function menu(item) {
    await page.click('.tb-menu-btn');
    await page.click(`.gm-item:has-text("${item}")`);
}
async function boot(p = page) {
    await p.waitForSelector('text=Start Infinite', { timeout: 90000 });
    await p.waitForTimeout(300);
}
/** Page coordinates of a cell, if the canvas is what's there (not a HUD panel). */
const cellAt = (x, y) => js(([cx, cy]) => {
    const p = window.__renderer.projectCell(cx, cy);
    const hit = document.elementFromPoint(p.x, p.y);
    return hit === window.__renderer.canvas ? p : null;
}, [x, y]);
const machineCount = () => js(() => window.__sim.grid.flat().filter((c) => c.machine && c.machine.type !== 'sink').length);

await page.goto(URL, { waitUntil: 'networkidle' });
await boot();
await js(() => {
    localStorage.clear();
    sessionStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await boot();
const apiUp = await js(() => window.__account.refresh().then((s) => s.online));
if (!apiUp) {
    console.log('The API is not running: start it (npm run dev:api) and try again.');
    await browser.close();
    process.exit(1);
}

// ---- An Infinite factory to work with ----------------------------------------------------------
await page.click('text=Start Infinite');
await wait(1000);
await js((layout) => {
    const d = window.__sim.serialize();
    d.score = 5000;
    d.game.licences = ['press', 'assembler', 'splitter', 'merger'];
    window.__sim.loadState(d);
    for (const m of layout.machines) window.__sim.buildMachine(m.x, m.y, m.type, m.dir, m.recipe ?? null);
}, SMALL);
await wait(1500);
const slotBefore = await js(() => ({ id: window.__saves.activeId(), n: window.__saves.list().length }));

// ---- Save a selection as a blueprint -------------------------------------------------------------
await page.keyboard.press('v');
const a = await cellAt(14, 11);
const b = await cellAt(18, 12);
check('the iron chain is on screen', a && b);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 6 });
await page.mouse.up();
await wait(200);
const sel = await js(() => window.__state.sel?.cells.length ?? 0);
check('a box selects the iron chain', sel === 6, `${sel} selected`);
check('the selection bar offers Save as blueprint', await page.waitForSelector('.selbar .sel-btn:has-text("Save as blueprint")', { timeout: 5000 }).then(() => true, () => false));
await page.click('.selbar .sel-btn:has-text("Save as blueprint")');
await page.fill('.bp-name-input', 'Iron chain');
await page.click('.mm-form button[type=submit]');
await wait(300);
const bp1 = await js(() => window.__blueprints.list().map((p) => ({ name: p.name, n: p.machines.length, w: p.w, h: p.h })));
check('it is in the library', bp1.length === 1 && bp1[0].name === 'Iron chain' && bp1[0].n === 6 && bp1[0].w === 5 && bp1[0].h === 2, JSON.stringify(bp1));

// ---- The library (B) and placing a blueprint --------------------------------------------------------
await page.keyboard.press('Escape'); // drop the selection
await page.keyboard.press('b');
await page.waitForSelector('.bp-card');
const cardText = (await page.textContent('.bp-card')).replace(/\s+/g, ' ');
check('B opens the library: plan, size, machines, build cost', await page.isVisible('.bp-card canvas') && /5 × 2 cells · 6 machines/.test(cardText) && /CR \d+ to build/.test(cardText), cardText.slice(0, 90));
await page.click('.bp-card .bp-place');
await wait(200);
check('Place puts it in hand', await js(() => window.__state.group?.blueprint?.name === 'Iron chain' && !document.querySelector('.mm-panel')));
// Somewhere it fits and that is on screen, and somewhere it doesn't.
const spot = await js(() => {
    const g = window.__state.group;
    const s = window.__sim;
    const canvas = window.__renderer.canvas;
    let good = null;
    let bad = null;
    for (let x = 0; x < 32 && !(good && bad); x++) {
        for (let y = 0; y < 24; y++) {
            const p = window.__renderer.projectCell(x, y);
            if (document.elementFromPoint(p.x, p.y) !== canvas) continue;
            for (let rot = 0; rot < 4; rot++) {
                const plan = s.planStored(g.blueprint.machines, g.anchor, { x, y }, rot);
                const allOnScreen = plan.moves.every((m) => m.to.x >= 0 && m.to.y >= 0 && m.to.x < 32 && m.to.y < 24);
                if (plan.ok && allOnScreen && !good) good = { x, y, rot, p, cost: plan.cost, to: plan.moves.map((m) => m.to) };
                if (!plan.ok && rot === 0 && !bad) bad = { x, y, p };
            }
        }
    }
    return { good, bad };
});
check('there is a place where it fits', !!spot.good, spot.good ? `${spot.good.x},${spot.good.y} turned ${spot.good.rot}` : 'none');
const before = await machineCount();
await page.mouse.move(spot.bad.p.x, spot.bad.p.y);
await wait(150);
const badInfo = await js(() => ({ ok: window.__state.group.plan?.ok, info: document.querySelector('.sel-info')?.textContent }));
await page.mouse.click(spot.bad.p.x, spot.bad.p.y);
await wait(150);
check('where it doesn\'t fit it shows red and refuses', badInfo.ok === false && (await machineCount()) === before, badInfo.info);
for (let i = 0; i < spot.good.rot; i++) await page.keyboard.press('r');
await page.mouse.move(spot.good.p.x, spot.good.p.y);
await wait(150);
await js(() => (window.__state.paused = true)); // so sales don't blur the price
const credits0 = await js(() => window.__sim.score);
await page.mouse.click(spot.good.p.x, spot.good.p.y);
await wait(200);
const placed = await js((to) => ({
    built: to.filter(({ x, y }) => window.__sim.grid[x][y].machine).length,
    score: window.__sim.score,
    stillCarrying: !!window.__state.group,
}), spot.good.to);
check('a click builds it, at the build price, and it stays in hand', placed.built === 6 && credits0 - placed.score === spot.good.cost && placed.stillCarrying, `${placed.built} built, CR ${credits0} → ${placed.score} (cost ${spot.good.cost})`);
await js(() => (window.__state.paused = false));
await page.keyboard.press('Escape');
check('Esc lets go of it', await js(() => !window.__state.group));

// ---- Export and import a blueprint file ------------------------------------------------------------
await menu('Blueprints');
await page.waitForSelector('.bp-card');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('.bp-card button:has-text("Export")')]);
const dir = mkdtempSync(join(tmpdir(), 'selene-bp-'));
const file = join(dir, download.suggestedFilename());
await download.saveAs(file);
const exported = JSON.parse(readFileSync(file, 'utf8'));
check('the in-game menu has Blueprints; Export downloads a blueprint file', exported.format === 'selene-blueprint' && exported.machines.length === 6, download.suggestedFilename());
await page.setInputFiles('.mm-foot input[type=file]', file);
await wait(300);
check('Import adds it again', await js(() => window.__blueprints.list().length === 2));
await page.click('.bp-card >> nth=0 >> button:has-text("Delete")');
await wait(200);
check('Delete removes one', await js(() => window.__blueprints.list().length === 1));
await page.keyboard.press('Escape');

// ---- A throwaway account: the library syncs --------------------------------------------------------
const name = `bp_${Date.now().toString(36).slice(-6)}`;
const password = 'correct horse battery';
await js(([n, p]) => window.__account.signup(n, p), [name, password]);
await wait(2500);
let remote = await js(() => window.__account.listBlueprints());
check('signed in, the library goes to the account', remote.blueprints.length === 1 && remote.blueprints[0].name === 'Iron chain' && remote.blueprints[0].data.machines.length === 6);
await js(() => window.__blueprints.rename(window.__blueprints.list()[0].id, 'Iron chain v2'));
await wait(1500);
remote = await js(() => window.__account.listBlueprints());
check('a rename syncs', remote.blueprints[0]?.name === 'Iron chain v2');

// ---- Send in the factory, then view it from the leaderboard ---------------------------------------
await menu('Leaderboard');
await page.click('button:has-text("Send in this factory")');
await page.waitForFunction(() => /rank/.test(document.querySelector('.lb-result')?.textContent ?? ''), null, { timeout: 60000 });
check('the submit flow says others can view it, and offers its share link', await page.isVisible('text=can be viewed by other players') && await page.isVisible('.lb-share-btn'));
await page.click('.lb-share-btn');
await wait(300);
const clip0 = await js(() => navigator.clipboard.readText());
check('Share link (leaderboard) copies the factory\'s link', /\?factory=\d+$/.test(clip0) && await page.isVisible('text=Link copied'), clip0);
const factoryId = clip0.match(/factory=(\d+)/)?.[1];
await page.waitForSelector('.lb-row.me .lb-view-btn', { timeout: 10000 });
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('.lb-row.me .lb-view-btn')]);
await page.waitForSelector('.viewbar .vb-copy:not([disabled])', { timeout: 90000 });
await wait(1500);
const view = await js(() => ({
    url: location.href, viewing: window.__state.viewing, started: window.__state.started,
    name: document.querySelector('.vb-name')?.textContent, meta: document.querySelector('.vb-meta')?.textContent,
    machines: window.__sim.grid.flat().filter((c) => c.machine && c.machine.type !== 'sink').length,
    mode: window.__sim.game.mode, hud: getComputedStyle(document.getElementById('hud')).display,
}));
check('View opens the factory in the viewer, with its share link in the address', view.viewing && !view.started && view.url.endsWith(`?factory=${factoryId}`), view.url);
check('the bar shows the player and the score', view.name?.includes(name) && /CR\/min/.test(view.meta), `${view.name} · ${view.meta}`);
check('it is the submitted factory on a fresh Infinite map, HUD hidden', view.machines === SMALL.machines.length + 6 && view.mode === 'infinite' && view.hud === 'none', `${view.machines} machines`);
const t0 = await js(() => window.__sim.tickCount);
const slotData0 = await js((id) => localStorage.getItem(`selene.slot.${id}`), slotBefore.id); // saved on the way here
await wait(1500);
check('it runs', (await js(() => window.__sim.tickCount)) > t0);
// Read-only: build keys and clicks do nothing.
const m0 = await machineCount();
await page.keyboard.press('1');
const free = await js(() => {
    for (let x = 4; x < 28; x++) {
        for (let y = 4; y < 20; y++) {
            const c = window.__sim.grid[x][y];
            if (c.machine || c.water || c.blocked) continue;
            const p = window.__renderer.projectCell(x, y);
            if (document.elementFromPoint(p.x, p.y) === window.__renderer.canvas) return p;
        }
    }
    return null;
});
if (free) await page.mouse.click(free.x, free.y);
await wait(200);
check('nothing can be built in the viewer', (await machineCount()) === m0 && (await js(() => window.__state.tool)) === 'select');
check('no slot is touched while viewing', await js(([id, data, n]) => localStorage.getItem(`selene.slot.${id}`) === data && window.__saves.list().length === n, [slotBefore.id, slotData0, slotBefore.n]));

await page.click('.vb-share');
await wait(300);
const clip1 = await js(() => navigator.clipboard.readText());
check('Share link (viewer) copies it', clip1 === `${ORIGIN}/?factory=${factoryId}` && /Link copied/.test(await page.textContent('.vb-note')), clip1);
await page.click('.vb-copy');
await page.fill('.bp-name-input', 'Their factory');
await page.click('.mm-form button[type=submit]');
await wait(2500);
const copied = await js(() => window.__blueprints.list().find((p) => p.name === 'Their factory'));
remote = await js(() => window.__account.listBlueprints());
check('Copy as blueprint puts it in the library (and the account)', copied?.machines.length === SMALL.machines.length + 6 && remote.blueprints.some((p) => p.name === 'Their factory'), `${copied?.machines.length} machines`);

// Back to the game it came from.
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('.vb-back')]);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 90000 });
await wait(800);
const backIn = await js(() => ({ url: location.href, slot: window.__saves.activeId(), viewing: window.__state.viewing, machines: window.__sim.grid.flat().filter((c) => c.machine && c.machine.type !== 'sink').length }));
check('Back returns to the game, as it was', backIn.slot === slotBefore.id && !backIn.viewing && !backIn.url.includes('factory') && backIn.machines === SMALL.machines.length + 6, `${backIn.machines} machines`);

// ---- The account's data export holds the blueprints ---------------------------------------------
const exportData = await js(() => fetch('/api/me/export', { credentials: 'same-origin' }).then((r) => r.json()));
check('Download my data includes the blueprints', exportData.blueprints?.length === 2, `${exportData.blueprints?.length} blueprints`);

// ---- The share link, opened by someone else (no storage, not signed in) ---------------------------
await page.goto('about:blank'); // one WebGL page at a time (SwiftShader is slow)
const stranger = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const other = await stranger.newPage();
other.on('pageerror', (e) => errors.push(`stranger: ${e}`));
await other.goto(`${ORIGIN}/?factory=${factoryId}`, { waitUntil: 'networkidle' });
await other.waitForSelector('.viewbar .vb-copy:not([disabled])', { timeout: 90000 });
await other.waitForTimeout(1000);
const seen = await other.evaluate(() => ({
    title: !!document.querySelector('.title-screen'), name: document.querySelector('.vb-name')?.textContent,
    slots: window.__saves.list().length, machines: window.__sim.grid.flat().filter((c) => c.machine && c.machine.type !== 'sink').length,
}));
check('the share link opens the viewer straight away', !seen.title && seen.name?.includes(name) && seen.machines === SMALL.machines.length + 6, seen.name);
check('...without making a save slot', seen.slots === 0);
await Promise.all([other.waitForNavigation({ waitUntil: 'networkidle' }), other.click('.vb-back')]);
await other.waitForSelector('text=Start Infinite', { timeout: 90000 });
check('Back from a share link goes to the title screen', await other.evaluate(() => !location.search && !window.__state.viewing));
const missing = await other.evaluate(() => fetch('/api/factories/999999999').then((r) => r.status));
check('an unknown factory is a 404', missing === 404);
await stranger.close();

// ---- Deleting the account removes its blueprints and factories -----------------------------------
await page.goto(URL, { waitUntil: 'networkidle' });
await boot();
await page.waitForFunction(() => window.__account.state.user && window.__blueprints.list().length === 2, null, { timeout: 15000 });
await js((p) => window.__account.deleteAccount(p), password);
await wait(500);
const after = await js(async (id) => ({
    list: await fetch('/api/blueprints', { headers: { 'X-Selene': '1' } }).then((r) => r.status),
    factory: await fetch(`/api/factories/${id}`).then((r) => r.status),
    local: window.__blueprints.list().map((p) => p.name),
}), factoryId);
check('deleting the account removes its blueprints and factories', after.list === 401 && after.factory === 404, `blueprints HTTP ${after.list}, factory HTTP ${after.factory}`);
check('...and its blueprints leave this browser', after.local.length === 0, after.local.join(', '));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
