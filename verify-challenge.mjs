// The weekly challenge end to end, against the local API (npm run dev:api, with a local
// PostgreSQL; RELAX_LIMITS=1 in .env keeps the rate limits out of the way): the title card,
// starting this week's challenge, its rules while you build (banned keys, a build refused
// over the machine cap, full refunds), "Test here first", a factory sent in that lands on
// the week's board with the same score, layouts refused straight by the API (a banned
// building, over the cap, a week that is over), the export, and the throwaway account
// deleted with its row.
//   node verify-challenge.mjs    (dev server on :5173; another port: SELENE_URL=http://localhost:5185/)
import { chromium } from 'playwright';
import { autoLayout } from './scripts/challenge-cases.mjs';
import { challengeFor, previousPeriod } from './src/challenge.js';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
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
const api = (path, body) => js(([p, b]) => fetch(`/api${p}`, {
    method: b ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Selene': '1' },
    credentials: 'same-origin',
    body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })), [path, body]);

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
// SwiftShader draws on the CPU, which the server's test needs too: draw light.
await js(() => window.__settings.set('graphics', { shadows: false, renderScale: 0.5, particles: 'off' }));
const apiUp = await js(() => window.__account.refresh().then((s) => s.online));
if (!apiUp) {
    console.log('FAIL  the API is not running (npm run dev:api): this script needs it');
    await browser.close();
    process.exit(1);
}

// ---- The title card ---------------------------------------------------------------------------
const board0 = await api('/challenge');
const week = board0.body.thisWeek;
const rules = challengeFor(week);
await page.waitForSelector('.ch-card .ch-top li', { timeout: 10000 });
const card = await page.textContent('.ch-card');
check('the title screen has this week\'s challenge card', card.includes(week) && /left/.test(card) && /Start this week/.test(card), `${week}: ${rules.theme}, ${rules.target}`);

// A throwaway account, signed in before the game starts.
const name = `ch_${Date.now().toString(36).slice(-6)}`;
const password = 'correct horse battery';
await js(([n, p]) => window.__account.signup(n, p), [name, password]);
check('a throwaway account', await js(() => window.__account.state.user?.name) === name, name);

// ---- This week's challenge --------------------------------------------------------------------
await page.click('.ch-card .btn-primary');
await page.waitForSelector('.ch-board-btn', { timeout: 10000 });
await wait(600);
const game = await js(() => ({
    mode: window.__sim.game.mode, week: window.__sim.game.challenge, score: window.__sim.score,
    ore: window.__sim.activeChallenge?.ore.length, ribbon: document.querySelector('.ribbon-title').textContent,
    keys: document.querySelector('.keys').textContent, slot: window.__saves.list()[0],
}));
check('it starts this week\'s challenge with the budget as credits', game.mode === 'challenge' && game.week === week && game.score === rules.budget, `CR ${game.score}, ${game.ore} ore fields`);
check('the ribbon names the week', game.ribbon.length > 5, game.ribbon);
check('buildings not allowed this week are keyed NOT NOW', !rules.buildings.includes('lab') && game.keys.includes('NOT NOW'));
check('it plays in its own save slot', game.slot?.mode === 'challenge' && game.slot?.week === week, game.slot?.name);

// The cap: fill it with Smelters, then a real click on a free cell is refused with a toast.
const filler = await js(() => {
    const sim = window.__sim;
    const r = sim.activeChallenge;
    const cells = [];
    for (let x = 0; x < 32 && cells.length < r.cap; x++) {
        for (let y = 0; y < 24 && cells.length < r.cap; y++) {
            const c = sim.grid[x][y];
            if (!c.machine && !c.water && !c.resource && sim.inPlot(x, y) && Math.abs(x - 19) + Math.abs(y - 12) > 4) {
                if (sim.buildMachine(x, y, 'smelter', 'right', 'ironIngot')) cells.push({ x, y });
            }
        }
    }
    return { cells, capped: sim.cappedCount(), score: sim.score };
});
check('machines up to the cap can be built', filler.capped === rules.cap, `${filler.capped}/${rules.cap}`);
const spot = await js(() => {
    const sim = window.__sim;
    for (const [dx, dy] of [[-2, 0], [0, 2], [-2, 1], [-1, 2], [0, -2], [-2, -1]]) {
        const x = 19 + dx;
        const y = 12 + dy;
        const c = sim.grid[x][y];
        if (!c.machine && !c.water && sim.inPlot(x, y)) return { x, y, at: window.__renderer.projectCell(x, y) };
    }
    return null;
});
await page.keyboard.press('3'); // the Smelter
await page.mouse.move(spot.at.x, spot.at.y);
await wait(150);
await page.mouse.click(spot.at.x, spot.at.y);
await wait(300);
const refused = await js(([x, y]) => ({ built: !!window.__sim.grid[x][y].machine, toast: document.querySelector('.toast')?.textContent ?? '' }), [spot.x, spot.y]);
check('a build over the cap is refused, with a toast', !refused.built && /cap/i.test(refused.toast), refused.toast);
const back = await js((cells) => {
    for (const { x, y } of cells) window.__sim.removeMachine(x, y);
    return window.__sim.score;
}, filler.cells);
check('demolishing gives every credit back', back === rules.budget, `CR ${back}`);

// A working factory for this week (built the way the test builder lays it), then the board.
const layout = autoLayout(week);
check('the test builder has a factory for this week', !!layout, layout ? `${layout.machines.length} buildings` : '');
const built = await js((machines) => machines.filter((m) => window.__sim.buildMachine(m.x, m.y, m.type, m.dir, m.recipe ?? null)).length, layout.machines);
check('it builds in the game under the week\'s rules', built === layout.machines.length, `${built}/${layout.machines.length}`);
await page.click('.ch-board-btn');
await page.click('button:has-text("Test here first")');
await page.waitForFunction(() => /Expected/.test(document.querySelector('.lb-result')?.textContent ?? ''), null, { timeout: 30000 });
const preview = await page.textContent('.lb-result');
await page.click('button:has-text("Send in this factory")');
await page.waitForFunction(() => {
    const out = document.querySelector('.lb-result');
    return out && !out.classList.contains('busy') && out.textContent && !/Expected|Running|rebuilding/.test(out.textContent);
}, null, { timeout: 90000 });
const sent = await page.textContent('.lb-result');
const num = (t) => parseFloat((t.match(/([\d.]+) [A-Z][a-zA-Z ]+ \/ min/) ?? [])[1] ?? 'NaN');
check('the server scores it like the local test', num(sent) > 0 && num(sent) === num(preview), `${num(sent)} vs ${num(preview)}: ${sent}`);
await page.waitForSelector('.ch-row.me', { timeout: 10000 });
check('the factory is on the week\'s board', await page.isVisible(`.ch-row.me:has-text("${name}")`));
await page.keyboard.press('Escape');

// ---- Straight to the API: rule-breaking layouts and a week that is over are refused ------------
const banned = ['lab', 'mixer', 'fabricator', 'generator'].find((t) => !rules.buildings.includes(t));
const free = await js(() => {
    const sim = window.__sim;
    const out = [];
    for (let x = 0; x < 32; x++) for (let y = 0; y < 24; y++) {
        const c = sim.grid[x][y];
        if (!c.machine && !c.water && !c.resource && sim.inPlot(x, y)) out.push({ x, y });
    }
    return out;
});
const withBanned = { ...layout, machines: [...layout.machines, { ...free[0], type: banned, dir: 'right', tier: 1 }] };
const r1 = await api('/challenge/submit', { week, layout: withBanned });
check(`a layout with a ${banned} is refused by the server`, r1.status === 422 && r1.body?.rule === 'banned', `HTTP ${r1.status}: ${r1.body?.error}`);
const overCap = { ...layout, machines: [...layout.machines, ...free.slice(0, rules.cap).map((c) => ({ ...c, type: 'smelter', dir: 'up', tier: 1, recipe: 'ironIngot' }))] };
const r2 = await api('/challenge/submit', { week, layout: overCap });
check('a layout over the cap is refused by the server', r2.status === 422 && r2.body?.rule === 'cap', `HTTP ${r2.status}: ${r2.body?.error}`);
const r3 = await api('/challenge/submit', { week: previousPeriod(week), layout });
check('a week that is over takes no factories', r3.status === 409, `HTTP ${r3.status}: ${r3.body?.error}`);
const r4 = await js(([w, l]) => fetch('/api/challenge/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ week: w, layout: l }) }).then((r) => r.status), [week, layout]);
check('a submission without X-Selene is refused (CSRF guard)', r4 === 403);

// ---- The export and the title card know the score ---------------------------------------------
const exp = await api('/me/export');
check('"Download my data" includes the challenge score', exp.body?.challengeScores?.length === 1 && exp.body.challengeScores[0].week === week);
await js(() => sessionStorage.setItem('selene.boot', JSON.stringify({ action: 'title' })));
const requests = [];
const onRequest = (r) => requests.push(r.url().replace(/^https?:\/\/[^/]+/, ''));
page.on('request', onRequest);
await page.reload({ waitUntil: 'load' });
await boot();
await wait(4000);
page.off('request', onRequest);
const apiCalls = requests.filter((u) => u.startsWith('/api/'));
check('the title screen settles (no request loop)', apiCalls.length < 15, `${apiCalls.length} API calls: ${[...new Set(apiCalls)].join(' ')}`);
await page.waitForSelector('.ch-card .ch-top li', { timeout: 10000 });
await wait(800);
const card2 = await page.textContent('.ch-card');
check('the title card shows your best and you in the top 3', /Your best · [\d.]+ \/ min · rank \d+/.test(card2) && card2.includes(name), card2.match(/Your best[^A-Z]*/)?.[0]);
check('it offers to continue this week\'s game', /Continue this week/.test(card2));

// ---- The account goes, its row with it ----------------------------------------------------------
await js((p) => window.__account.deleteAccount(p), password);
const after = await api('/challenge');
check('deleting the account removes its row from the board', !after.body.entries.some((e) => e.name === name));

check('no page errors', !errors.length, errors.join(' | ').slice(0, 300));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
