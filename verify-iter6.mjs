// Iteration 6 end to end: the title screen (Story or Infinite), Infinite play (a licence,
// land), save slots (save, Save as, export, import, Continue after a reload), settings
// (applied, kept after a reload, a rebound key working in play), and, when the API runs
// (npm run dev:api with a local PostgreSQL), accounts, cloud saves, settings sync and a
// server-verified leaderboard score.
//   node verify-iter6.mjs        (dev server on :5173; another port: SELENE_URL=http://localhost:5175/)
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMALL } from './scripts/bench-cases.mjs';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept()); // confirm() before leaving or deleting

const results = [];
const check = (name, ok, detail = '') => {
    results.push([name, !!ok]);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const js = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
/** Top bar → Menu, then one of its items (Save game, Saves, Settings, Leaderboard, Profile, Main menu). */
async function menu(item) {
    await page.click('.tb-menu-btn');
    await page.click(`.gm-item:has-text("${item}")`);
}
async function boot() {
    await page.waitForSelector('text=Start Infinite', { timeout: 90000 });
    await wait(300);
}

await page.goto(URL, { waitUntil: 'networkidle' });
await boot();
await js(() => {
    localStorage.clear();
    sessionStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await boot();
const apiUp = await js(() => window.__account.refresh().then((s) => s.online));
console.log(`API: ${apiUp ? 'online' : 'offline (account, cloud and leaderboard checks are skipped)'}\n`);

// ---- Title screen --------------------------------------------------------------------------
check('title offers Story and Infinite', await page.isVisible('text=Begin onboarding') && await page.isVisible('text=Start Infinite'));
check('no Continue without a save', !(await page.isVisible('.btn-continue')));

// ---- Infinite --------------------------------------------------------------------------------
await page.click('text=Start Infinite');
await wait(800);
const inf = await js(() => ({
    mode: window.__sim.game.mode, score: window.__sim.score, cannon: window.__sim.hasCannon(),
    siteFree: !window.__sim.grid[21][12].blocked, ribbon: document.querySelector('.ribbon-kicker').textContent,
    pressLocked: !window.__sim.isBuildingUnlocked('press'),
}));
check('Infinite starts with no cannon and its site free', inf.mode === 'infinite' && !inf.cannon && inf.siteFree, `CR ${inf.score}`);
check('the ribbon says Infinite', /Infinite/.test(inf.ribbon), inf.ribbon);
check('the Press needs a licence', inf.pressLocked);
await page.click('.inf-buy:has-text("Press")');
await wait(200);
await page.keyboard.press('4');
const lic = await js(() => ({ licences: window.__sim.game.licences, score: window.__sim.score, tool: window.__state.tool }));
check('licensing the Press unlocks it (key 4 selects it)', lic.licences.includes('press') && lic.tool === 'press', `CR ${lic.score}`);

// A small factory (two chains into the pad), with credits to spare, through the sim.
await js((layout) => {
    const d = window.__sim.serialize();
    d.score = 5000;
    window.__sim.loadState(d);
    for (const m of layout.machines) window.__sim.buildMachine(m.x, m.y, m.type, m.dir, m.recipe ?? null);
}, SMALL);
await page.click('.inf-buy:has-text("Buy land")');
await wait(300);
check('buying land moves the plot out', await js(() => window.__sim.game.plot === 1));

// ---- The in-game menu: Esc opens it and pauses the game, Resume carries on --------------------
await page.keyboard.press('Escape');
await wait(300);
const t0 = await js(() => window.__sim.tickCount);
await wait(800);
const paused = await js(() => ({ open: !!document.querySelector('.game-menu'), paused: window.__state.paused, items: [...document.querySelectorAll('.gm-label')].map((e) => e.textContent) }));
check('Esc opens the menu and pauses the game', paused.open && paused.paused && (await js(() => window.__sim.tickCount)) === t0, paused.items.join(' · '));
await page.click('.gm-item:has-text("Resume")');
await wait(800);
check('Resume closes it and the game runs on', await js(() => !document.querySelector('.mm-panel') && !window.__state.paused));
check('the top bar keeps only the game\'s own buttons', (await js(() => [...document.querySelectorAll('.tb-menu .tbtn')].map((b) => b.textContent).join(','))) === 'Production,Keys,Menu');

// ---- Settings: apply, rebind ----------------------------------------------------------------
await menu('Settings');
check('Settings from the menu keep the game paused', await js(() => window.__state.paused && !!document.querySelector('.set-body')));
await page.click('.mm-tab:has-text("Graphics")');
await page.click('.set-row:has-text("Shadows") .set-toggle');
await page.click('.mm-tab:has-text("Controls")');
await page.click('.key-row:has-text("Smelter") .keycap');
await page.keyboard.press('j');
await page.click('.mm-tab:has-text("Accessibility")');
await page.click('.set-row:has-text("Interface size") button:has-text("115%")');
await page.click('.set-row:has-text("Colour-blind") .set-toggle');
await page.keyboard.press('Escape');
await wait(200);
await page.keyboard.press('j');
const set1 = await js(() => ({
    tool: window.__state.tool, zoom: document.getElementById('hud').style.zoom, shadows: window.__settings.get().graphics.shadows,
    cap: [...document.querySelectorAll('.hwkey')].find((b) => b.getAttribute('aria-label')?.startsWith('Smelter'))?.querySelector('.hwkey-k').textContent,
    cb: document.body.classList.contains('cb-safe'),
}));
check('a rebound key works in play (J → Smelter) and its keycap says so', set1.tool === 'smelter' && set1.cap === 'J', `cap ${set1.cap}`);
check('graphics and accessibility settings apply', set1.shadows === false && set1.zoom === '1.15' && set1.cb, `zoom ${set1.zoom}`);

// ---- Save slots ----------------------------------------------------------------------------
await menu('Save game');
await wait(200);
check('Save game in the menu saves', /Saved just now/.test(await page.textContent('.gm-item:has-text("Save game")')));
await page.click('.gm-item:has-text("Saves")');
await page.fill('.mm-inline', 'Verify B');
await page.click('button:has-text("Save as new slot")');
await wait(300);
const slots1 = await js(() => ({ names: window.__saves.list().map((s) => s.name), active: window.__saves.get(window.__saves.activeId())?.name }));
check('Save as makes a second slot and plays in it', slots1.names.length === 2 && slots1.active === 'Verify B', slots1.names.join(', '));
check('the playing slot is marked', await page.isVisible('.slot.playing:has-text("Verify B")'));
const [download] = await Promise.all([page.waitForEvent('download'), page.click('.slot:has-text("Verify B") button:has-text("Export")')]);
const dir = mkdtempSync(join(tmpdir(), 'selene-'));
const file = join(dir, download.suggestedFilename());
await download.saveAs(file);
const exported = JSON.parse(readFileSync(file, 'utf8'));
check('Export downloads a .selene.json save', exported.format === 'selene-save' && exported.data?.game?.mode === 'infinite', download.suggestedFilename());
await page.setInputFiles('.mm-foot input[type=file]', file);
await wait(400);
check('Import adds it as a new slot', await js(() => window.__saves.list().length === 3));
await page.keyboard.press('Escape');

// ---- Cloud: account, saves, settings, leaderboard (needs the API) ----------------------------
const name = `v6_${Date.now().toString(36).slice(-6)}`;
const password = 'correct horse battery';
let recoveryCode = null;
if (apiUp) {
    await menu('Profile'); // the account panel is in the profile (iteration 7)
    await page.click('.pf-foot button:has-text("Account")');
    await page.click('.mm-tab:has-text("Create account")');
    await page.fill('.mm-field:has-text("Name") input', name);
    await page.fill('.mm-field:has-text("Password (8") input', password);
    await page.fill('.mm-field:has-text("Password again") input', password);
    await page.click('.mm-form button[type=submit]'); // (the tab says "Create account" too)
    await page.waitForSelector('.recovery-code', { timeout: 10000 });
    recoveryCode = await page.textContent('.recovery-code');
    check('sign-up shows a recovery code once', /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(recoveryCode), recoveryCode);
    await page.click('button:has-text("I have written it down")');
    await page.keyboard.press('Escape');
    await wait(2500);
    const cloud = await js(() => window.__account.listSaves());
    check('slots sync to the account', cloud.slots.length === 3, `${cloud.slots.length} in the account`);
    await js(() => window.__settings.set('graphics', { particles: 'low' }));
    await wait(2500);
    const remote = await js(() => window.__account.getSettings());
    check('settings sync to the account', remote.data?.graphics?.particles === 'low' && remote.data?.keys?.smelter === 'j');

    // The leaderboard: the server rebuilds the factory and scores it.
    await menu('Leaderboard');
    await page.click('button:has-text("Test here first")');
    await page.waitForFunction(() => /Expected/.test(document.querySelector('.lb-result')?.textContent ?? ''), null, { timeout: 20000 });
    const preview = await page.textContent('.lb-result');
    await page.click('button:has-text("Send in this factory")');
    await page.waitForFunction(() => /rank/.test(document.querySelector('.lb-result')?.textContent ?? ''), null, { timeout: 60000 });
    const result = await page.textContent('.lb-result');
    const num = (t) => parseFloat((t.match(/([\d,.]+) CR\/min/) ?? [])[1]?.replace(/,/g, '') ?? 'NaN');
    check('the server scores the factory (and agrees with the local test)', num(result) > 0 && num(result) === num(preview), `${num(result)} vs ${num(preview)} CR/min`);
    await page.waitForSelector('.lb-row.me', { timeout: 10000 });
    check('the score is on the leaderboard', await page.isVisible(`.lb-row.me:has-text("${name}")`));
    await page.keyboard.press('Escape');

    // A faked score can't get in: the server only takes a layout and runs it itself.
    const fake = await js(() => fetch('/api/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Selene': '1' }, credentials: 'same-origin',
        body: JSON.stringify({ layout: { machines: [{ x: 0, y: 0, type: 'extractor', dir: 'right' }] }, perMinute: 1e9 }),
    }).then((r) => r.status));
    check('an impossible layout is refused', fake === 422 || fake === 429, `HTTP ${fake}`);
    const noHeader = await js(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).then((r) => r.status));
    check('a request without X-Selene is refused (CSRF guard)', noHeader === 403);

    // Out, wrong password, back in, recover, delete.
    await js(() => window.__account.logout());
    const wrong = await js(([n]) => window.__account.login(n, 'not the password').then(() => 'ok', (e) => e.status), [name]);
    check('a wrong password is refused', wrong === 401);
    const back = await js(([n, p]) => window.__account.login(n, p).then((r) => r.user.name), [name, password]);
    check('sign in works', back === name);
    const rec = await js(([n, c]) => window.__account.recover(n, c, 'a new long password').then((r) => r.recoveryCode), [name, recoveryCode]);
    check('the recovery code sets a new password (and gives a new code)', rec && rec !== recoveryCode);
    const del = await js(() => window.__account.deleteAccount('a new long password').then(() => window.__account.state.user));
    check('the account can be deleted', del === null);
}

// ---- Reload: Continue brings the game back, settings stay ----------------------------------
await page.reload({ waitUntil: 'networkidle' });
await boot();
const cont = await page.textContent('.btn-continue');
check('the title offers Continue with the last slot', /Verify B|Infinite/.test(cont), cont.replace(/\s+/g, ' '));
await page.click('.btn-continue');
await wait(800);
const back = await js(() => ({
    mode: window.__sim.game.mode, plot: window.__sim.game.plot, licences: window.__sim.game.licences,
    machines: window.__sim.grid.flat().filter((c) => c.machine && c.machine.type !== 'sink').length,
    shadows: window.__settings.get().graphics.shadows, smelterKey: window.__settings.get().keys.smelter,
}));
check('Continue restores the Infinite factory', back.mode === 'infinite' && back.plot === 1 && back.licences.includes('press') && back.machines === SMALL.machines.length, `${back.machines} machines`);
check('settings survive a reload', back.shadows === false && back.smelterKey === 'j');

// ---- Main menu: back to the title screen, then switch to Story ---------------------------------
await js(() => window.__settings.reset());
await menu('Main menu');
await page.waitForLoadState('networkidle');
await boot();
check('Main menu returns to the title screen (with Continue)', await js(() => !window.__state.started && !!document.querySelector('.btn-continue')));
await page.click('text=Begin onboarding');
await wait(600);
const story = await js(() => ({ mode: window.__sim.game.mode, cannon: window.__sim.hasCannon(), site: !!window.__sim.grid[21][12].blocked, slots: window.__saves.list().length }));
check('Story starts in a new slot with the cannon site reserved', story.mode === 'story' && story.cannon && story.site && story.slots === 4, `${story.slots} slots`);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
