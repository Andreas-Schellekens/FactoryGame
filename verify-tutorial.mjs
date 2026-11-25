// verify-tutorial.mjs — the Story tutorial: the console's "Now" card walks a new game through the
// first chain step by step, the map shows an example building or belt route for each, following
// those guides completes the steps, a wrong recipe is explained (with Show me and DELTA's tip),
// and the card can be hidden. Dev server on :5173 (SELENE_URL for another port); no API needed.
// SHOTS=1 also saves two screenshots (verify-tutorial-*.png).
import { chromium } from 'playwright';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
// (errors are counted from the clean reload on: the first load is cut off by it, and its
// aborted model downloads can throw "Failed to fetch")
const js = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
let passed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
    total++;
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const card = () => js(() => ({ ...(window.__tutorial?.card ?? {}), shown: !document.querySelector('.now')?.classList.contains('hidden'), text: document.querySelector('.now')?.innerText ?? '' }));
const guide = () => js(() => window.__tutorial?.guide ?? null);
/** Wait until the card's step is `id` (or a kind). */
async function cardIs(test, ms = 8000) {
    for (let t = 0; t < ms; t += 200) {
        const c = await card();
        if (test(c)) return c;
        await wait(200);
    }
    return card();
}
/** Build what a guide shows: its example buildings, then its belt route. */
async function follow(g) {
    return js((g) => {
        const sim = window.__sim;
        let ok = true;
        for (const b of g.ghosts ?? []) ok = sim.buildMachine(b.x, b.y, b.type, b.dir) && ok;
        for (const p of g.path ?? []) ok = sim.placeBelt(p.x, p.y, p.dir) !== false && ok;
        return ok;
    }, g);
}

await page.goto(URL, { waitUntil: 'networkidle' });
await js(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: 'networkidle' });
page.on('pageerror', (e) => errors.push(String(e)));
/** Wait until `test()` (run in the page) is true, up to `ms`. */
async function until(test, ms = 6000) {
    for (let t = 0; t < ms; t += 200) {
        if (await js(test)) return true;
        await wait(200);
    }
    return false;
}
await page.waitForSelector('text=Begin onboarding', { timeout: 180000 });
await page.click('text=Begin onboarding');
await js(() => { window.__sim.score += 0; });

// ---- Step 1: the card and the example Extractor ---------------------------------------------------
let c = await cardIs((c) => c.kind === 'step' && c.shown);
check('a new Story game shows the tutorial card', c.shown && /STEP 1 OF/i.test(c.text), c.text.split('\n').slice(0, 2).join(' / '));
check('the first step says how, at once (no waiting for a hint)', c.id === 'extractor' && /Press 2/.test(c.how ?? ''), c.how?.slice(0, 50));
check('the first steps show the controls', /WASD/.test(c.text));
let g = await guide();
check('the map shows an example Extractor on iron ore', g?.ghosts?.[0]?.type === 'extractor' && (await js((p) => window.__sim.grid[p.x][p.y].resource, g.ghosts[0])) === 'ironOre', JSON.stringify(g?.ghosts?.[0]));
check('the example shows which way it faces (an orange arrow past its front)', !!g?.ghosts?.[0]?.dir);
if (process.env.SHOTS) await page.screenshot({ path: 'verify-tutorial-step1.png' });

// ---- Holding the Extractor over the example, turned another way: the card says press R ------------
await page.keyboard.press('2');
const at = await js((c) => window.__renderer.projectCell(c.x, c.y), g.ghosts[0]);
await page.mouse.move(at.x, at.y);
const notes = [];
for (let i = 0; i < 4; i++) {
    await wait(1100); // a director poll and a frame or two (SwiftShader is slow)
    notes.push(await js(() => window.__tutorial?.card?.note ?? null));
    await page.keyboard.press('r');
}
check('turned away from the example: the card says to press R; matching it: no note', notes.filter(Boolean).length === 3 && /Press R/.test(notes.find(Boolean) ?? ''), JSON.stringify(notes.map((n) => !!n)));

// ---- A click that can't build says why -------------------------------------------------------------
const grass = await js(() => {
    const sim = window.__sim;
    for (let x = 16; x < 24; x++) for (let y = 6; y < 10; y++) if (!sim.grid[x][y].resource && !sim.grid[x][y].machine && sim.inPlot(x, y)) return { x, y };
    return null;
});
const gp = await js((c) => window.__renderer.projectCell(c.x, c.y), grass);
await page.mouse.click(gp.x, gp.y);
await wait(300);
const toast = await js(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
check('an Extractor clicked on grass says it needs ore', /stand on ore/.test(toast), toast.slice(0, 80));
await page.mouse.move(5, 300); // off the map again (over the console)

// ---- Follow the guides through the first chain ----------------------------------------------------
const steps = [['extractor', 'smelter'], ['smelter', 'ingot'], ['ingot', 'deliver'], ['deliver', 'copperExtractor']];
for (const [now, next] of steps) {
    g = await guide();
    const built = g && (await follow(g));
    c = await cardIs((c) => c.id === next, 20000);
    check(`following the guide completes "${now}" and moves on to "${next}"`, !!built && c.id === next, c.title);
}
c = await card();
check('the card counts the steps', /STEP 5 OF 8/i.test(c.text), c.kicker);

// ---- A wrong recipe is explained -------------------------------------------------------------------
g = await guide();
await follow(g); // the copper Extractor
c = await cardIs((c) => c.id === 'copperRecipe');
g = await guide();
check('the copper step shows an example Smelter', g?.ghosts?.[0]?.type === 'smelter');
// Build the Smelter but leave it on iron, and belt the copper ore into it.
const ext = await js(() => {
    const sim = window.__sim;
    for (let x = 0; x < 32; x++) for (let y = 0; y < 24; y++) {
        const m = sim.grid[x][y].machine;
        if (m?.type === 'extractor' && sim.grid[x][y].resource === 'copperOre') return { x, y, dir: m.dir };
    }
    return null;
});
await follow(g);
await js((e) => {
    const sim = window.__sim;
    const v = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] }[e.dir];
    for (let i = 1; i <= 2; i++) sim.placeBelt(e.x + v[0] * i, e.y + v[1] * i, e.dir);
}, ext);
c = await cardIs((c) => c.kind === 'problem', 25000);
check('copper ore at an iron Smelter: the card explains the wrong recipe', c.kind === 'problem' && /set to Iron Ingot/.test(c.how ?? '') && /Copper Ingot/.test(c.how ?? ''), c.how?.slice(0, 80));
let said = '';
for (let i = 0; i < 100 && !/wrong recipe/.test(said); i++) {
    said = await js(() => document.querySelector('.comms-text')?.textContent ?? '');
    if (!/wrong recipe/.test(said)) await page.click('.comms-text', { force: true }).catch(() => {});
    await wait(150);
}
check('DELTA explains it once too', /wrong recipe/.test(said), said.slice(0, 50));
await page.click('.now-show');
await until(() => !!document.querySelector('.mpanel:not(.hidden) .hint-glow'));
const shown = await js(() => ({ panel: !document.querySelector('.mpanel')?.classList.contains('hidden'), glow: !!document.querySelector('.mpanel .hint-glow') }));
check('Show me opens that Smelter with the right recipe lit up', shown.panel && shown.glow, JSON.stringify(shown));
await page.click('.mpanel .hint-glow');
c = await cardIs((c) => c.kind === 'step' && c.id === 'copper', 15000);
check('picking the recipe clears the problem and the steps carry on', c.kind === 'step', c.title);
if (process.env.SHOTS) await page.screenshot({ path: 'verify-tutorial-problem.png' });

// ---- A Smelter facing the belt that feeds it: explained, and Turn fixes it --------------------------
const cs = await js(() => {
    const sim = window.__sim;
    for (let x = 0; x < 32; x++) for (let y = 0; y < 24; y++) if (sim.grid[x][y].machine?.recipe === 'copperIngot') return { x, y, dir: sim.grid[x][y].machine.dir };
    return null;
});
await js((s) => { window.__sim.turnMachine(s.x, s.y); window.__sim.turnMachine(s.x, s.y); }, cs); // now it faces its feed
c = await cardIs((c) => c.kind === 'problem' && /wrong way/i.test(c.title ?? ''), 15000);
check('a Smelter turned to face its feed: "Facing the wrong way"', /wrong way/i.test(c.title ?? '') && /Turn/.test(c.how ?? ''), `${c.title} · ${c.how?.slice(0, 60)}`);
const mark = await guide();
check('the map marks it in red', mark?.mark?.x === cs.x && mark?.mark?.y === cs.y, JSON.stringify(mark));
await page.click('.now-show');
await until(() => !!document.querySelector('.mpanel:not(.hidden) .mp-turn.hint-glow'));
const turnBtn = await js(() => ({ there: !!document.querySelector('.mpanel .mp-turn'), glow: !!document.querySelector('.mpanel .mp-turn.hint-glow') }));
check('Show me opens it with Turn lit up', turnBtn.there && turnBtn.glow, JSON.stringify(turnBtn));
await page.click('.mpanel .mp-turn');
await wait(1500); // a quarter turn already takes its front off the feed: the problem clears, the panel stays
await page.click('.mpanel .mp-turn');
const back = await js((s) => window.__sim.grid[s.x][s.y].machine.dir, cs);
check('Turn turns it where it stands, and the panel stays open meanwhile (twice: back the way it was)', back === cs.dir, `${cs.dir} → ${back}`);
c = await cardIs((c) => !/wrong way/i.test(c.title ?? ''), 15000);
check('facing the right way again: that problem is gone', !/wrong way/i.test(c.title ?? ''), `${c.kind}: ${c.title}`);
await js(() => window.__undo?.undo());
const undone = await js((s) => window.__sim.grid[s.x][s.y].machine.dir, cs);
check('a turn is undoable', undone !== cs.dir, undone);
await js(() => window.__undo?.redo());
await page.keyboard.press('Escape');

// ---- Hiding it -------------------------------------------------------------------------------------
await page.click('.now-skip');
await until(() => document.querySelector('.now')?.classList.contains('hidden') && window.__tutorial === null);
const hidden = await js(() => ({ card: document.querySelector('.now')?.classList.contains('hidden'), setting: window.__settings.get().gameplay.highlights, guide: window.__tutorial?.guide ?? null }));
check('Hide the tutorial hides the card and the guides, and turns the setting off', hidden.card && hidden.setting === false, JSON.stringify(hidden));
check('no page errors', errors.length === 0, errors[0] ?? '');
console.log(`\n${passed}/${total} passed`);
await browser.close();
