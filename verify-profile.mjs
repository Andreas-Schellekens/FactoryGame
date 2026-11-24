// Iteration 7, stream D end to end: earn an achievement in play (the toast, the cue, the
// profile grid, the account), pick an avatar and see it on the leaderboard, open another
// player's profile from the leaderboard and from its share link (?player=<name>), the
// public switch, add a passkey (Chrome's virtual authenticator), sign out and back in with
// it, "download my data", and delete both throwaway accounts (the passkey goes with it).
// Needs the API (npm run dev:api, or api/target/release/selene-api.exe) with a database.
//   node verify-profile.mjs        (dev server on :5173; another port: SELENE_URL=http://localhost:5184/)
import { chromium } from 'playwright';
import { SMALL } from './scripts/bench-cases.mjs';

const URL = process.env.SELENE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept()); // confirm() before removing a passkey

// A virtual platform authenticator (discoverable credentials, user verification), over CDP.
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});

const results = [];
const check = (name, ok, detail = '') => {
    results.push([name, !!ok]);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const js = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
async function boot() {
    await page.waitForSelector('text=Start Infinite', { timeout: 90000 });
    await wait(300);
}
async function menu(item) {
    await page.click('.tb-menu-btn');
    await page.click(`.gm-item:has-text("${item}")`);
}
const api = (path, opts = {}) => js(([p, o]) => fetch(`/api${p}`, {
    method: o.method ?? 'GET', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Selene': '1' },
    body: o.body ? JSON.stringify(o.body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })), [path, opts]);

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
    console.log('The API is not running: start it first (npm run dev:api).');
    await browser.close();
    process.exit(1);
}

const stamp = Date.now().toString(36).slice(-6);
const other = `vpB_${stamp}`;
const name = `vpA_${stamp}`;
const password = 'correct horse battery';

// ---- Another player: an avatar, an achievement, a score; then signed out ---------------------
await js(([n, p]) => window.__account.signup(n, p), [other, password]);
await api('/profile', { method: 'PUT', body: { avatar: 'm:nile' } });
await api('/achievements', { method: 'POST', body: { earned: { firstChain: Date.now() - 60000 } } });
const otherScore = await js((layout) => window.__account.submitScore(layout).then((r) => r.stored), SMALL);
check('the other player is on the leaderboard', otherScore);
await js(() => window.__account.logout());
await js(() => localStorage.removeItem('selene.achievements.v1'));
await js(() => localStorage.removeItem('selene.profile.v1'));

// ---- You: an account, then an achievement earned in play ---------------------------------------
await js(([n, p]) => window.__account.signup(n, p), [name, password]);
await wait(600);
await page.click('text=Start Infinite');
await wait(800);
await page.click('.inf-buy:has-text("Press")');
await page.waitForSelector('.achv-toast.show', { timeout: 5000 }).catch(() => {});
const toast = await js(() => ({ shown: !!document.querySelector('.achv-toast.show'), text: document.querySelector('.achv-toast')?.textContent ?? '' }));
check('buying a licence earns an achievement, with a toast', toast.shown && /Licensed Operator/.test(toast.text), toast.text.replace(/\s+/g, ' ').trim());
check('the toast plays its cue', await js(() => (window.__audio.log ?? []).some((c) => String(c?.name ?? c).includes('achievement'))));
await wait(2500);
const synced = await api('/achievements');
check('the achievement reaches the account', !!synced.body?.earned?.licence, Object.keys(synced.body?.earned ?? {}).join(', '));

// ---- The profile: the grid, the avatar picker ------------------------------------------------
await menu('Profile');
await page.waitForSelector('.mm-panel.profile');
const prof = await js(() => ({
    title: document.querySelector('.pf-name')?.textContent,
    licence: !!document.querySelector('.ach.on[data-id="licence"]'),
    secret: document.querySelector('.ach.secret .ach-name')?.textContent,
    count: [...document.querySelectorAll('.pf-line')].map((l) => l.textContent).find((t) => /Achievements/i.test(t)),
}));
check('the profile shows the earned achievement', prof.title === name && prof.licence, prof.count);
check('hidden achievements show as ???', prof.secret === '???');
await page.click('.pf-change');
const picker = await js(() => ({
    all: document.querySelectorAll('.av-pick').length,
    locked: document.querySelectorAll('.av-pick.locked:disabled').length,
    lockedShowsPicture: !!document.querySelector('.av-pick.locked .av:not(.av-lock)'),
}));
check('the picker offers the game’s pictures, a few locked behind achievements', picker.all >= 20 && picker.locked >= 4 && !picker.lockedShowsPicture, `${picker.all} avatars, ${picker.locked} locked`);
await page.click('.av-pick[data-avatar="b:smelter"]');
await wait(600);
const av = await api('/profile');
check('a chosen avatar is kept in the account', av.body?.avatar === 'b:smelter');
await page.keyboard.press('Escape');

// ---- The leaderboard: your avatar on your row, another player's profile ---------------------
const mine = await js((layout) => window.__account.submitScore(layout).then((r) => r.stored), SMALL);
await menu('Leaderboard');
await page.waitForSelector(`.lb-row:has-text("${name}") .av`, { timeout: 10000 });
await wait(500);
const board = await js(([me, them]) => {
    const row = (n) => [...document.querySelectorAll('.lb-row')].find((r) => r.textContent.includes(n));
    return {
        mineImg: !!row(me)?.querySelector('.av.img img'),
        mineTitle: row(me)?.querySelector('.av')?.title,
        theirsSvg: !!row(them)?.querySelector('.av svg'),
        theirsTitle: row(them)?.querySelector('.av')?.title,
    };
}, [name, other]);
check('your avatar shows on your leaderboard row', mine && board.mineImg && board.mineTitle === 'Smelter', board.mineTitle);
check('other players’ avatars show on theirs', board.theirsSvg && board.theirsTitle === 'NILE', board.theirsTitle);
await page.click(`.lb-player:has-text("${other}")`);
await page.waitForSelector('.mm-panel.profile .pf-name', { timeout: 10000 });
const theirs = await js(() => ({
    title: document.querySelector('.mm-panel.profile .mm-title')?.textContent,
    first: !!document.querySelector('.ach.on[data-id="firstChain"]'),
    best: document.querySelector('.pf-stat .pf-sub')?.textContent,
}));
check('a name on the leaderboard opens that player’s profile', theirs.title === other && theirs.first, theirs.best);
await page.keyboard.press('Escape');

// ---- The share link ------------------------------------------------------------------------------
await page.goto(`${URL}?player=${other}`, { waitUntil: 'networkidle' });
await boot();
await page.waitForSelector('.mm-panel.profile .pf-name', { timeout: 15000 });
const link = await js(() => ({ title: document.querySelector('.mm-panel.profile .mm-title')?.textContent, url: location.search }));
check('?player=<name> opens that player’s profile over the title screen', link.title === other, `url now "${link.url}"`);
await page.keyboard.press('Escape');

// ---- The account chip (title screen) and the public switch ------------------------------------
const chip = await js(() => ({ av: document.querySelector('.title-corner .mm-chip .av')?.title, text: document.querySelector('.title-corner .mm-chip')?.textContent }));
check('the account chip shows your avatar', chip.av === 'Smelter', chip.text);
await page.click('.title-corner .mm-chip');
await page.waitForSelector('.pf-switch input');
await page.waitForFunction(() => !document.querySelector('.pf-switch input').disabled);
await page.click('.pf-switch');
await wait(600);
const anon = await browser.newContext();
const priv = await anon.request.get(`${URL}api/players/${name}`).then((r) => r.json());
check('switching the profile off leaves only name and avatar', priv.private === true && !priv.achievements && priv.avatar === 'b:smelter');
await page.click('.pf-switch');
await wait(600);
const pub = await anon.request.get(`${URL}api/players/${name}`).then((r) => r.json());
check('switched back on, it is public again', !pub.private && !!pub.achievements?.licence);
await anon.close();

// ---- Passkeys: add one, sign out, sign in with it ------------------------------------------------
await page.click('.pf-foot button:has-text("Account")');
await page.click('details.passkeys summary');
await page.fill('details.passkeys .mm-inline', 'Verify laptop');
await page.click('details.passkeys button:has-text("Add a passkey")');
await page.waitForSelector('.pk-item', { timeout: 15000 }).catch(() => {});
const added = await js(() => ({ items: [...document.querySelectorAll('.pk-item .pk-name')].map((e) => e.textContent), err: document.querySelector('details.passkeys .mm-error')?.textContent }));
check('a passkey can be added', added.items.includes('Verify laptop'), added.err);
const creds = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
check('the authenticator holds a discoverable credential', creds.credentials.length === 1 && creds.credentials[0].isResidentCredential);
await page.click('button:has-text("Sign out")');
await page.waitForSelector('.pk-button', { timeout: 5000 });
check('signed out', await js(() => !window.__account.state.user));
await page.click('.pk-button');
await page.waitForFunction(() => !!window.__account.state.user, null, { timeout: 15000 }).catch(() => {});
const back = await js(() => window.__account.state.user?.name);
check('signing in with the passkey works (no name typed)', back === name, back ?? document.querySelector('.mm-error')?.textContent);
const list = await api('/passkeys');
check('the passkey shows when it was last used', !!list.body?.passkeys?.[0]?.lastUsedAt);

// ---- Download my data, then delete both accounts ------------------------------------------------
const exp = await api('/me/export');
const p = exp.body?.profile;
check('“download my data” includes the profile, achievements and passkeys', p?.avatar === 'b:smelter' && !!p?.achievements?.licence && p?.passkeys?.length === 1 && !!p.passkeys[0].publicCredential);
const del = await js((pw) => window.__account.deleteAccount(pw).then(() => window.__account.state.user), password);
check('your throwaway account is deleted', del === null);
await page.keyboard.press('Escape');
const again = await js(() => import('/src/passkeys.js').then((m) => m.signInWithPasskey()).then((r) => (r.ok ? 'signed in' : r.error), (e) => e.status));
check('its passkey went with it', again === 401, `got ${again}`);
const gone = await js((n) => fetch(`/api/players/${n}`).then((r) => r.status), name);
check('its profile is gone', gone === 404);
await js(([n, pw]) => window.__account.login(n, pw).then(() => window.__account.deleteAccount(pw)), [other, password]);
check('the other throwaway account is deleted', await js(() => !window.__account.state.user));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
