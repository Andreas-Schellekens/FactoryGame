// verify-overload.mjs — the hidden third ending (iteration 8). Nolan's memo gives Selene's rated
// load; confirming the last phase with twice the shells on the pad and a grid of 100 kW or more
// unlocks a third choice; Overload plays the salvo (skipped here) to VASSAL's proclamation; the
// game is CROWN's in an ash-grey world; the castle epilogue runs its four stages to its own
// report; a reload keeps it all without asking again. Without the overload, the choice has two.
//   node verify-overload.mjs        (dev server on :5173; another port: SELENE_URL=http://localhost:5175/)
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
const boot = () => page.waitForSelector('text=Start Infinite', { timeout: 180000 });
const wait = (ms) => page.waitForTimeout(ms);
/** Click the comms text until `test()` holds (skips DELTA's / VASSAL's lines). */
async function skipLinesUntil(test, tries = 120) {
    for (let i = 0; i < tries && !(await js(test)); i++) {
        await page.click('.comms-text', { force: true }).catch(() => {});
        await wait(200);
    }
    return js(test);
}

await page.goto(URL, { waitUntil: 'networkidle' });
await boot();
await js(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: 'networkidle' });
await boot();
page.on('pageerror', () => {}); // (counted above)

// ---- The last phase: the memo, then a pad holding twice the shells and a strong grid ----------
await page.click('text=Begin onboarding');
await wait(800);
await js(() => {
    const s = window.__sim;
    s.project.phase = 4;
    s.score += 20000;
    s.stats.delivered.seleneShell = 4;
});
const memo = await skipLinesUntil(() => /rated for fifteen shells/i.test(document.querySelector('.comms-text')?.textContent ?? ''), 200);
check("Nolan's memo gives Selene's rated load", memo);
// Six fueled generators (100 kW with the starter grid) and the pad stocked past the rated load.
await js(() => {
    const s = window.__sim;
    let n = 0;
    for (let x = 10; x < 24 && n < 6; x++) {
        for (let y = 5; y < 9 && n < 6; y++) {
            if (s.buildMachine(x, y, 'generator', 'right')) {
                s.grid[x][y].machine.fuelTicks = 100000;
                n++;
            }
        }
    }
    s.project.delivered = { seleneShell: 30, capacitor: 75 };
});
await wait(1500);
const primed = await js(() => ({ supply: window.__sim.power.supply, primed: window.__sim.overloadPrimed() }));
check('twice the shells and a 100 kW grid: the overload is primed', primed.primed, `supply ${primed.supply} kW`);
await skipLinesUntil(() => /obliged to mention it/i.test(document.querySelector('.comms-text')?.textContent ?? '') || !!document.querySelector('.con-confirm:not(.hidden)'), 120);
await page.waitForSelector('.con-confirm:not(.hidden)', { timeout: 15000 });
await page.click('.con-confirm');
await page.waitForSelector('.end-choice', { timeout: 20000 });
const choice = await js(() => [...document.querySelectorAll('.end-choice .ec-btn b')].map((b) => b.textContent));
check('confirming it brings up the choice with a third button', choice.length === 3 && /overload/i.test(choice[2]), choice.join(' · '));

// ---- Overload --------------------------------------------------------------------------------
await page.keyboard.press('3');
await wait(2500);
const running = await js(() => ({ caption: document.querySelector('.lb-caption')?.textContent, ending: window.__sim.project.ending }));
check('3 picks Overload, and it is saved at once', running.ending === 'overload' && /overload/i.test(running.caption ?? ''), running.caption);
for (let i = 0; i < 60 && !(await page.isVisible('.report')); i++) {
    await page.mouse.click(800, 480); // a click skips ahead
    await wait(400);
}
const rep = await js(() => ({ text: document.querySelector('.report')?.innerText ?? '', phase: document.body.dataset.phase, ash: document.body.classList.contains('ash') }));
check("the salvo ends in VASSAL's proclamation", /ALL OF IT/i.test(rep.text) && /VASSAL/i.test(rep.text), rep.text.split('\n').slice(0, 2).join(' / '));
check('the sky is ash grey, with no Moon', rep.phase === '7' && rep.ash, `phase ${rep.phase}`);
await page.click('.report .btn-primary');
await wait(1500);
const crown = await js(() => ({
    brand: document.querySelector('.tb-word')?.textContent,
    epi: window.__sim.project.epilogue,
    ribbon: document.querySelector('.ribbon')?.innerText ?? '',
    reqs: [...document.querySelectorAll('.req .req-name')].map((n) => n.textContent),
}));
check('the company is CROWN', /CROWN/.test(crown.brand ?? ''), crown.brand);
check('Build the castle starts the castle epilogue', crown.epi?.stage === 0 && /CORONATION/i.test(crown.ribbon) && crown.reqs.includes('Steel'), crown.reqs.join(', '));
const speaker = await skipLinesUntil(() => /VASSAL/.test(document.querySelector('.comms-name')?.textContent ?? document.querySelector('.comms')?.innerText ?? ''), 60);
check('VASSAL speaks now, not DELTA', speaker);

// ---- The castle: four stages, then the proclamation -------------------------------------------
async function finishStage() {
    const before = await js(() => {
        const e = window.__sim.project.epilogue;
        const goal = window.__epilogue.goalsFor()[e.stage];
        for (const [k, n] of Object.entries(goal.requires)) window.__sim.stats.delivered[k] = (window.__sim.stats.delivered[k] ?? 0) + n;
        return e.stage;
    });
    await page.waitForSelector('.con-confirm:not(.hidden)', { timeout: 10000 });
    await page.click('.con-confirm');
    for (let i = 0; i < 30; i++) {
        if (await js(() => window.__sim.project.epilogue.stage) > before) return before + 1;
        await wait(200);
    }
    return before;
}
const stages = [];
for (let i = 0; i < 4; i++) stages.push(await finishStage());
check('the castle goes up in four confirmed stages', stages.join(',') === '1,2,3,4', stages.join(','));
await skipLinesUntil(() => !!document.querySelector('.report'), 160);
const proclamation = await js(() => document.querySelector('.report')?.innerText ?? '');
check('the castle closes with its own proclamation', /LONG LIVE THE CROWN/i.test(proclamation), proclamation.split('\n').slice(0, 2).join(' / '));
await page.click('.report .btn-primary');
await wait(800);
const ach = await js(() => ({ over: window.__achievements.has('endingOverload'), crowned: window.__achievements.has('crowned') }));
check('both hidden achievements are earned', ach.over && ach.crowned, JSON.stringify(ach));

// ---- A reload keeps it -----------------------------------------------------------------------
await page.reload({ waitUntil: 'networkidle' });
await boot();
await page.click('.btn-continue');
await wait(2000);
const back = await js(() => ({
    ending: window.__sim.project.ending, choice: !!document.querySelector('.end-choice'), report: !!document.querySelector('.report'),
    brand: document.querySelector('.tb-word')?.textContent, phase: document.body.dataset.phase, stage: window.__sim.project.epilogue?.stage,
}));
check('Continue brings CROWN back, ash and castle and all, without asking again', back.ending === 'overload' && !back.choice && !back.report && /CROWN/.test(back.brand ?? '') && back.phase === '7' && back.stage === 4, JSON.stringify(back));

// ---- Without the overload: two buttons -------------------------------------------------------
await js(() => sessionStorage.setItem('selene.boot', JSON.stringify({ action: 'title' })));
await page.reload({ waitUntil: 'networkidle' });
await boot();
await page.click('text=Begin onboarding');
await wait(600);
await js(() => {
    window.__sim.project.phase = 5;
    window.__sim.project.complete = true;
});
await page.waitForSelector('.end-choice', { timeout: 15000 });
const two = await js(() => document.querySelectorAll('.end-choice .ec-btn').length);
check('a cannon at its rated load offers only the two targets', two === 2, `${two} buttons`);
await page.keyboard.press('3');
await wait(500);
check('and 3 does nothing then', await js(() => !window.__sim.project.ending && !!document.querySelector('.end-choice')));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
