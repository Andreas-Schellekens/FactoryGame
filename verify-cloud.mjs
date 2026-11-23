// Cloud saves across two "devices" (two browser contexts, one account): a slot made on
// A shows up on B after signing in and opens there (downloaded on Continue); when both
// then save the same slot, the second writer keeps the other device's copy as its own
// slot instead of overwriting it. Needs the API (npm run dev:api) and the dev server.
//   node verify-cloud.mjs        (SELENE_URL=http://localhost:5175/ for another port)
import { chromium } from 'playwright';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, ok, detail = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const errors = [];
async function device() {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Start Infinite', { timeout: 90000 });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Start Infinite', { timeout: 90000 });
    return page;
}
const name = `cl_${Date.now().toString(36).slice(-6)}`;
const password = 'two devices one account';

const a = await device();
if (!(await a.evaluate(() => window.__account.refresh().then((s) => s.online)))) {
    console.log('The API is offline: start it with npm run dev:api');
    process.exit(1);
}
await a.click('text=Start Infinite');
await a.waitForTimeout(600);
await a.evaluate(([n, p]) => window.__account.signup(n, p), [name, password]);
await a.waitForTimeout(2500); // sign-in → sync → the slot goes up
const slotId = await a.evaluate(() => window.__saves.activeId());
const rev1 = await a.evaluate((id) => window.__saves.get(id).cloud?.rev, slotId);
check('device A pushes its slot to the account', rev1 >= 1, `rev ${rev1}`);

const b = await device();
await b.evaluate(([n, p]) => window.__account.login(n, p), [name, password]);
await b.waitForTimeout(2500);
const onB = await b.evaluate((id) => window.__saves.get(id), slotId);
check('device B sees the slot after signing in', onB?.cloudOnly === true, onB?.name);
await b.waitForSelector('.btn-continue', { timeout: 5000 });
await b.click('.btn-continue');
await b.waitForTimeout(1200);
const openedB = await b.evaluate(() => ({ mode: window.__sim.game.mode, active: window.__saves.activeId() }));
check('Continue on B downloads and plays it', openedB.mode === 'infinite' && openedB.active === slotId);
await b.evaluate(() => window.__sim.buildMachine(14, 11, 'extractor', 'right'));
await b.click('.tbtn:has-text("Save") >> nth=0');
await b.waitForTimeout(2000);
const rev2 = await b.evaluate((id) => window.__saves.get(id).cloud?.rev, slotId);
check('B saves it as a new revision', rev2 > rev1, `rev ${rev2}`);

// A still thinks the cloud is at rev1: its save must not silently overwrite B's.
await a.evaluate(() => window.__sim.buildMachine(15, 17, 'extractor', 'up'));
await a.click('.tbtn:has-text("Save") >> nth=0');
await a.waitForTimeout(3000);
const afterA = await a.evaluate((id) => ({
    names: window.__saves.list().map((s) => s.name),
    rev: window.__saves.get(id).cloud?.rev,
}), slotId);
check('A keeps the other device\'s version as its own slot', afterA.names.some((n) => n.endsWith('(other device)')), afterA.names.join(', '));
check('and then writes its own on top', afterA.rev > rev2, `rev ${afterA.rev}`);
const cloud = await a.evaluate(() => window.__account.listSaves().then((r) => r.slots.length));
check('the account holds both versions', cloud === 2, `${cloud} slots`);

await a.evaluate((p) => window.__account.deleteAccount(p), password);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
