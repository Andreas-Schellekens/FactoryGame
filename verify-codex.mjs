// Iteration 7, stream B: the codex and the tutorial highlights, in a fresh Story game. The
// first objective's keycap pulses (and follows a rebound key); K and the top bar's button open
// the codex without pausing; typing in its search never reaches the game's keys; a recipe can
// be found and its links followed (and Back); the NIHIL-era entries are Classified this early;
// Esc closes it; the machine panel and K over the map open the right page; the Tutorial
// highlights setting turns the pulse and the rings off.
//   node verify-codex.mjs        (dev server on :5173; another port: SELENE_URL=http://localhost:5182/)
import { chromium } from 'playwright';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
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
/** Poll until `fn` holds in the page (SwiftShader draws few frames a second): true, or false after `ms`. */
const until = (fn, ms = 4000) => page.waitForFunction(fn, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
const codexOpen = () => js(() => window.__ui.codexOpen());
const pageName = () => js(() => document.querySelector('.codex .cx-ph-name')?.textContent ?? null);
/** Park the mouse over a HUD panel, so K isn't "over" anything on the map. */
const parkMouse = async () => {
    const box = await page.locator('.console').boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await js(() => {
    localStorage.clear();
    sessionStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=Begin onboarding', { timeout: 90000 });
await wait(300);
await page.click('text=Begin onboarding');
await until(() => !!document.querySelector('.plan li.active') && !!document.querySelector('.hwkey.hint-pulse')); // the director ticks the flight plan in

// ---- Tutorial highlight on the first objective ----------------------------------------------
const first = await js(() => ({
    now: document.querySelector('.plan li.active .plan-text')?.textContent,
    pulse: [...document.querySelectorAll('.hwkey.hint-pulse')].map((b) => ({ label: b.getAttribute('aria-label'), cap: b.querySelector('.hwkey-k').textContent })),
    focus: window.__state.focus,
}));
check('the first objective pulses the Extractor keycap', first.pulse.length === 1 && /Extractor/.test(first.pulse[0].label) && first.pulse[0].cap === '2',
    `${first.now} · ${JSON.stringify(first.pulse)}`);
check('…and rings the iron ore', first.focus === 'ironOre');
await js(() => window.__settings.bindKey('extractor', 'j'));
await until(() => document.querySelector('.hwkey.hint-pulse .hwkey-k')?.textContent === 'J');
const rebound = await js(() => document.querySelector('.hwkey.hint-pulse .hwkey-k')?.textContent);
check('the pulsing keycap follows a rebound key', rebound === 'J', rebound);
await page.keyboard.press('j');
check('picking the tool stops the pulse', await until(() => window.__state.tool === 'extractor' && !document.querySelector('.hwkey.hint-pulse')));
await js(() => window.__settings.reset('keys'));
await page.keyboard.press('1'); // back to the belt
await until(() => !!document.querySelector('.hwkey.hint-pulse'));

// ---- Open and close: K, the top bar, never paused ------------------------------------------------
await parkMouse();
await page.keyboard.press('k');
await wait(200);
check('K opens the codex', await codexOpen());
check('the game keeps running behind it', await js(() => window.__state.paused === false && !window.__menus.isOpen()));
const t0 = await js(() => window.__sim.tickCount);
await wait(2500); // SwiftShader draws few frames a second
const t1 = await js(() => window.__sim.tickCount);
check('…the simulation still ticks', t1 > t0, `tick ${t0} → ${t1}`);
await page.keyboard.press('k');
await wait(150);
check('K closes it again', !(await codexOpen()));
await page.click('.tb-codex-btn');
await wait(200);
check('the top bar button opens it', await codexOpen());
check('items have pictures rendered from the 3D models', await js(() => Object.keys(window.__renderer.itemIcons).length >= 16
    && document.querySelector('.codex .cx-ph .cx-pic img')?.src.startsWith('data:image/png')));

// ---- Search: typing never reaches the game ----------------------------------------------------------
// The camera's spot (rounded): a pan (w) or a turn of the view (e) would move it.
const view = () => js(() => {
    const p = window.__renderer.rig.camera.position;
    return { tool: window.__state.tool, dir: window.__state.dir, cam: [p.x, p.z].map((v) => Math.round(v * 10) / 10).join(','), open: window.__ui.codexOpen() };
});
const before = await view();
await page.click('.cx-search');
await page.keyboard.type('wire'); // w pans, r rotates, e turns the view: none of them may fire
await wait(1500);
const after = await view();
check('typing in the search box triggers no game keys', after.open && after.tool === before.tool && after.dir === before.dir && after.cam === before.cam,
    `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
await page.click('.cx-tab[data-tab="recipes"]');
await wait(150);
const rows = await js(() => [...document.querySelectorAll('.codex .cx-recipe')].map((r) => r.dataset.key));
check('searching "wire" finds the recipes that use or make it', rows.includes('press:copperWire') && rows.includes('assembler:circuit'), rows.join(' '));

// ---- Links: recipe → building, Back, → item ------------------------------------------------------------
await page.click('.cx-recipe[data-key="press:copperWire"] .cx-link[data-go="building:press"]');
await wait(150);
check('a recipe links to its building', (await pageName()) === 'Press');
await page.click('.codex .cx-back');
await wait(150);
check('Back returns to the recipe list', await js(() => !!document.querySelector('.codex .cx-recipe[data-key="press:copperWire"]')));
await page.click('.cx-recipe[data-key="press:copperWire"] .cx-flow .cx-link[data-go="item:copperWire"]');
await wait(150);
const wire = await js(() => ({ name: document.querySelector('.codex .cx-ph-name')?.textContent, text: document.querySelector('.codex .cx-page').textContent }));
check('…and to its item, with what makes and uses it', wire.name === 'Copper Wire' && /Made by/i.test(wire.text) && /Used in/i.test(wire.text) && /Circuit/.test(wire.text));

// ---- Classified: the NIHIL era, this early in the story ------------------------------------------------
await page.fill('.cx-search', '');
await page.click('.cx-tab[data-tab="items"]');
await wait(150);
const list = await js(() => ({
    classified: [...document.querySelectorAll('.codex .cx-row.classified')].map((r) => r.dataset.go),
    text: document.querySelector('.codex .cx-list').textContent,
}));
check('sulfur, explosives and the Selene Shell are Classified', ['item:sulfurOre', 'item:explosive', 'item:seleneShell'].every((id) => list.classified.includes(id))
    && !/Sulfur|Explosive|Selene Shell/.test(list.text), list.classified.join(' '));
await page.click('.codex .cx-row[data-go="item:sulfurOre"]');
await wait(150);
check('a Classified entry shows no details', await js(() => !!document.querySelector('.codex .cx-sealed') && !/Sulfur/.test(document.querySelector('.codex .cx-page').textContent)));
await page.fill('.cx-search', 'sulfur');
await wait(150);
check('…and no search finds it', await js(() => [...document.querySelectorAll('.codex .cx-count')].every((c) => c.textContent === '0')));
await js(() => window.__ui.openCodex('building:assembler'));
await wait(150);
check('the Assembler page keeps the Selene Shell recipe classified', await js(() => !!document.querySelector('.codex .cx-recipe.classified') && !/Selene Shell|Explosive/.test(document.querySelector('.codex .cx-page').textContent)));
check('locked things say why (the phase they arrive in)', await js(() => /Arrives in Phase 02/.test(document.querySelector('.codex .cx-status')?.textContent ?? '')));

// ---- Esc closes it (from the search box too), without opening the menu ------------------------------------
await page.click('.cx-search');
await page.keyboard.press('Escape');
await wait(150);
check('Esc closes the codex (and does not open the menu)', !(await codexOpen()) && !(await js(() => window.__menus.isOpen())));

// ---- The machine panel and the map link straight to an entry ------------------------------------------------
await js(() => {
    window.__sim.buildMachine(16, 9, 'smelter', 'right');
    window.__state.selected = { x: 16, y: 9 };
});
await wait(250);
await page.click('.mpanel .mp-codex');
await wait(150);
check('the machine panel links to its building’s entry', (await codexOpen()) && (await pageName()) === 'Smelter');
await js(() => {
    window.__ui.closeCodex();
    window.__state.selected = null;
});
const ore = await js(() => window.__renderer.projectCell(13, 11));
await page.mouse.move(ore.x, ore.y);
await wait(250);
const tip = await js(() => document.querySelector('.tooltip:not(.hidden) .tip-body')?.textContent ?? '');
check('the inspector offers the codex', /K FOR CODEX/.test(tip), tip.replace(/\n/g, ' / '));
await page.keyboard.press('k');
await wait(200);
check('K over the ore opens its entry', (await codexOpen()) && (await pageName()) === 'Iron Ore');
await parkMouse();
await page.keyboard.press('Escape');

// ---- The setting ---------------------------------------------------------------------------------------------
await js(() => window.__settings.set('gameplay', { highlights: false }));
await until(() => !document.querySelector('.hint-pulse, .hint-glow') && window.__state.focus === null);
const off = await js(() => ({ lit: [...document.querySelectorAll('.hint-pulse, .hint-glow')].map((e) => e.className), focus: window.__state.focus }));
check('Tutorial highlights off: no pulse, no rings', !off.lit.length && off.focus === null, JSON.stringify(off));
await js(() => window.__settings.set('gameplay', { highlights: true }));
check('…and on again', await until(() => !!document.querySelector('.hwkey.hint-pulse') && window.__state.focus === 'ironOre'));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
