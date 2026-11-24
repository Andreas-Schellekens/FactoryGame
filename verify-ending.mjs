// The ending (iteration 5) with save slots (iteration 6): finish the campaign, choose NIHIL HQ,
// name the company, and check the slot comes back after a reload as the company's sandbox
// without asking again; then the Moon in a second slot.
//   node verify-ending.mjs        (dev server on :5173; another port: SELENE_URL=http://localhost:5175/)
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

await page.goto(URL, { waitUntil: 'networkidle' });
await boot();
await js(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: 'networkidle' });
await boot();

/** Start a Story game and jump to the end of the campaign. */
async function finishCampaign() {
    await page.click('text=Begin onboarding');
    await page.waitForTimeout(500);
    await js(() => {
        window.__sim.project.phase = 5;
        window.__sim.project.complete = true;
    });
    await page.waitForSelector('.end-choice', { timeout: 15000 });
}

// ---- NIHIL HQ ----------------------------------------------------------------------------------
await finishCampaign();
check('the last delivery brings up the choice', true);
await page.keyboard.press('2');
for (let i = 0; i < 40 && !(await page.isVisible('.end-company')); i++) {
    await page.mouse.click(800, 480); // a click skips ahead
    await page.waitForTimeout(400);
}
check('the HQ ending asks for a company name', await page.isVisible('.end-company'));
await page.fill('.ecp-input', 'Moonless Ltd');
await page.keyboard.press('Enter');
await page.waitForSelector('.report', { timeout: 10000 });
const hq = await js(() => ({ ending: window.__sim.project.ending, company: window.__sim.project.company, slot: window.__saves.get(window.__saves.activeId()) }));
check('the choice and the company are saved in the slot', hq.ending === 'hq' && hq.company === 'Moonless Ltd' && hq.slot.complete, hq.slot?.name);
await page.click('.report .btn-primary');
await page.waitForTimeout(600);
check('Keep building returns to play', await js(() => !window.__state.cinematic && !document.querySelector('.report')));

await page.reload({ waitUntil: 'networkidle' });
await boot();
await page.click('.btn-continue');
await page.waitForTimeout(1500);
const back = await js(() => ({
    ending: window.__sim.project.ending, company: window.__sim.project.company, choice: !!document.querySelector('.end-choice'),
    brand: document.querySelector('.tb-word')?.textContent,
}));
check('Continue brings the company sandbox back without asking again', back.ending === 'hq' && !back.choice && /Moonless/i.test(back.brand ?? ''), back.brand);

// ---- The Moon, in a new slot -------------------------------------------------------------------
await js(() => sessionStorage.setItem('selene.boot', JSON.stringify({ action: 'title' })));
await page.reload({ waitUntil: 'networkidle' });
await boot();
await finishCampaign();
await page.keyboard.press('1');
for (let i = 0; i < 60 && !(await page.isVisible('.report')); i++) {
    await page.mouse.click(800, 480);
    await page.waitForTimeout(400);
}
const moon = await js(() => ({ ending: window.__sim.project.ending, slots: window.__saves.list().length, phase: document.body.dataset.phase }));
check('the Moon ending reaches its report in a second slot', moon.ending === 'moon' && moon.slots === 2, `sky ${moon.phase}`);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
