// src/profile.js — the profile page and the avatars. Your own profile (in-game menu →
// Profile, or the title screen's account chip): avatar, name, member since, play time, your
// best leaderboard scores with their rank, the endings you reached and the achievements
// grid, the "show my profile publicly" switch and a share link (?player=<name>). Other
// players' profiles are read-only and public unless they switched that off (a click on a
// name on the leaderboard, or the share link). Avatars are pictures the game already has
// (the building icons the renderer draws at startup, DELTA's moods, the brand marks and the
// mission patch), stored as an id; a few come with achievements. No uploads.
//
// Talks to api/src/profile.rs; reads achievements.js; shows its panels with menus.js
// openModal. Text: story.js PROFILE_TEXT, AVATAR_NAMES, ACHIEVEMENT_TEXT.

import './profile.css';
import { call } from './account.js';
import { ACHIEVEMENTS, achievementText, achievementById } from './achievements.js';
import { deltaSVG, markSVG, patchSVG, broadcastSVG, memoSVG, bossSVG } from './brand.js';
import { ACHIEVEMENT_GROUPS, AVATAR_NAMES, BUILDING_NAMES, PROFILE_TEXT as T } from './story.js';

// ---- Avatars ---------------------------------------------------------------------------------
const BUILDINGS = ['belt', 'extractor', 'smelter', 'press', 'foundry', 'assembler', 'splitter', 'merger', 'generator', 'lab', 'fabricator', 'mixer'];
const TOOLS = ['rotate', 'erase', 'select'];
/** Every avatar: { id, name, unlock?: achievement id }. */
export const AVATARS = [
    { id: 'd:neutral' }, { id: 'd:happy' }, { id: 'm:nile' }, { id: 'p:patch' }, { id: 'x:broadcast' },
    ...BUILDINGS.map((t) => ({ id: `b:${t}`, name: BUILDING_NAMES[t] })),
    ...TOOLS.map((t) => ({ id: `b:${t}`, name: AVATAR_NAMES[t] })),
    { id: 'b:upgrade', name: AVATAR_NAMES.upgrade, unlock: 'tier4' },
    { id: 'd:glitch', unlock: 'breaker' },
    { id: 'x:memo', unlock: 'audited' },
    { id: 'd:sinister', unlock: 'phase4' },
    { id: 'm:nihil', unlock: 'phase4' },
    { id: 'p:defaced', unlock: 'phase5' },
    { id: 'x:boss', unlock: 'endingHQ' },
].map((a) => ({ ...a, name: a.name ?? AVATAR_NAMES[a.id] ?? a.id }));
export const DEFAULT_AVATAR = 'd:neutral';
const avatarById = (id) => AVATARS.find((a) => a.id === id) ?? null;
/** The avatar an achievement brings (for the achievement toast), or null. */
export const avatarForAchievement = (achId) => AVATARS.find((a) => a.unlock === achId) ?? null;

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function button(label, onClick, cls = 'btn-secondary') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtNum = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const pad2 = (n) => String(n).padStart(2, '0');
function fmtPlay(secs = 0) {
    const m = Math.floor(secs / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${pad2(m % 60)} min` : `${m} min`;
}

const STORE = 'selene.profile.v1';
function readPrefs() {
    try {
        return { avatar: null, ...(JSON.parse(localStorage.getItem(STORE) ?? 'null') ?? {}) };
    } catch {
        return { avatar: null };
    }
}

/**
 * @param {{ account: any, menus: any, achievements: any, saves: any, icons?: Record<string, string>,
 *           sound?: any, onLeaderboard?: () => void }} opts
 */
export function createProfile({ account, menus, achievements, saves, icons = {}, sound, onLeaderboard = () => {} }) {
    const cue = (name) => sound?.cue(name);
    const prefs = readPrefs();
    const savePrefs = () => {
        try {
            localStorage.setItem(STORE, JSON.stringify(prefs));
        } catch { /* kept for this visit */ }
    };
    const avatarCache = new Map(); // player name → avatar id ('' = none), for leaderboard rows

    /** A picture for an avatar id, `size` px square (unknown ids fall back to DELTA). */
    function avatarNode(id, size = 40) {
        const node = el('span', 'av');
        node.style.setProperty('--av', `${size}px`);
        const [kind, name] = String(id || DEFAULT_AVATAR).split(':');
        const known = avatarById(id);
        node.title = known?.name ?? '';
        if (kind === 'b' && icons[name]) {
            const img = el('img');
            img.src = icons[name];
            img.alt = '';
            img.draggable = false;
            node.classList.add('img');
            node.appendChild(img);
            return node;
        }
        // Every SVG here is a constant from brand.js (no player text goes into markup).
        node.innerHTML = kind === 'm' ? markSVG(name === 'nihil', size)
            : kind === 'p' ? patchSVG(name === 'defaced', size, { text: false })
                : kind === 'x' ? (name === 'memo' ? memoSVG() : name === 'boss' ? bossSVG() : broadcastSVG(false))
                    : deltaSVG(kind === 'd' && ['happy', 'glitch', 'sinister'].includes(name) ? name : 'neutral');
        return node;
    }
    const unlocked = (a) => !a.unlock || achievements.has(a.unlock);
    const myAvatar = () => {
        const a = avatarById(prefs.avatar);
        return a && unlocked(a) ? a.id : DEFAULT_AVATAR;
    };

    // ---- Sync with the account ----------------------------------------------------------------
    let remote = null; // the last /api/profile answer
    async function fetchOwn() {
        remote = await call('/profile');
        return remote;
    }
    let lastUser = null;
    account.onChange(async (st) => {
        const id = st.user?.id ?? null;
        if (id === lastUser) return;
        lastUser = id;
        remote = null;
        if (!id) return;
        try {
            const r = await fetchOwn();
            if (r.avatar) {
                prefs.avatar = r.avatar;
                savePrefs();
            } else if (prefs.avatar) {
                await call('/profile', { method: 'PUT', body: { avatar: prefs.avatar } });
            }
            account.patchUser({ avatar: myAvatar() });
        } catch { /* offline: next sign-in */ }
    });

    async function setAvatar(id) {
        prefs.avatar = id;
        savePrefs();
        avatarCache.clear();
        account.patchUser({ avatar: id });
        if (account.state.user) await call('/profile', { method: 'PUT', body: { avatar: id } });
    }

    // ---- The pieces of a profile page ---------------------------------------------------------
    function statBox(label, value, sub) {
        const box = el('div', 'pf-stat');
        box.append(el('span', 'pf-label', label), el('strong', 'pf-value', value));
        if (sub) box.appendChild(el('span', 'pf-sub', sub));
        return box;
    }
    function bestsRow(best) {
        const row = el('div', 'pf-stats');
        for (const [key, unit] of [['throughput', 'CR/min'], ['efficiency', 'CR/min/cell']]) {
            const b = best?.[key];
            row.appendChild(b ? statBox(T[key], `${fmtNum(b.value)} ${unit}`, `Rank ${b.rank}${b.machines ? ` · ${b.machines} machines` : ''}`)
                : statBox(T[key], '—', T.noScore));
        }
        return row;
    }
    function endingsRow(earned) {
        const box = el('div', 'pf-endings');
        box.appendChild(el('span', 'pf-label', T.endings));
        for (const [id, label] of [['endingMoon', T.endingMoon], ['endingHQ', T.endingHQ]]) {
            const got = id in earned;
            const def = achievementById(id);
            const chip = el('span', `pf-ending${got ? ' on' : ''}`, got || !def?.hidden ? label : T.hidden);
            chip.title = got ? `${achievementText(def).name}: ${fmtDate(earned[id])}` : '';
            box.appendChild(chip);
        }
        return box;
    }
    function achievementGrid(earned) {
        const wrap = el('div', 'pf-ach');
        for (const [group, title] of Object.entries(ACHIEVEMENT_GROUPS)) {
            const defs = ACHIEVEMENTS.filter((a) => a.group === group);
            if (!defs.length) continue;
            const got = defs.filter((a) => a.id in earned).length;
            const head = el('div', 'pf-group');
            head.append(el('span', null, title), el('span', 'pf-count', `${got}/${defs.length}`));
            const grid = el('div', 'pf-grid');
            for (const def of defs) {
                const on = def.id in earned;
                const { name, desc } = achievementText(def, on);
                const tile = el('div', `ach${on ? ' on' : ''}${def.hidden && !on ? ' secret' : ''}`);
                tile.dataset.id = def.id;
                tile.append(el('span', 'ach-mark'), el('span', 'ach-name', name), el('span', 'ach-desc', desc));
                if (on) tile.appendChild(el('span', 'ach-date', fmtDate(earned[def.id])));
                const av = avatarForAchievement(def.id);
                if (av && (on || !def.hidden)) tile.appendChild(el('span', 'ach-av', `+ ${T.newAvatar.toLowerCase()}`));
                grid.appendChild(tile);
            }
            wrap.append(head, grid);
        }
        return wrap;
    }
    function header({ avatar, name, lines, onChangeAvatar }) {
        const head = el('div', 'pf-head');
        const left = el('div', 'pf-avbox');
        left.appendChild(avatarNode(avatar, 88));
        if (onChangeAvatar) left.appendChild(button(T.changeAvatar, onChangeAvatar, 'btn-secondary small pf-change'));
        const id = el('div', 'pf-id');
        id.appendChild(el('h3', 'pf-name', name));
        for (const [label, value] of lines) {
            const line = el('span', 'pf-line');
            line.append(el('span', 'pf-label', label), el('span', null, value));
            id.appendChild(line);
        }
        head.append(left, id);
        return head;
    }
    const countLine = (earned) => [T.achievements, `${ACHIEVEMENTS.filter((a) => a.id in earned).length}/${ACHIEVEMENTS.length}`];
    const shareUrl = (name) => `${location.origin}${location.pathname}?player=${encodeURIComponent(name)}`;

    // ---- Your own profile ----------------------------------------------------------------------
    function open() {
        const m = menus.openModal({ kicker: T.kicker, title: T.title, wide: true });
        m.node.querySelector('.mm-panel').classList.add('profile');
        const body = m.body;
        let view = 'profile';

        async function render() {
            body.innerHTML = '';
            if (view === 'avatars') return renderPicker();
            const user = account.state.user;
            const earned = achievements.earned();
            const localPlay = saves.list().reduce((a, s) => a + (s.playSec ?? 0), 0);
            const lines = [];
            if (user && remote) lines.push([T.memberSince, fmtDate(remote.createdAt)]);
            if (!user) lines.push(['', T.local]);
            lines.push([T.playTime, fmtPlay(Math.max(localPlay, remote?.playSec ?? 0))], countLine(earned));
            body.appendChild(header({ avatar: myAvatar(), name: user?.name ?? AVATAR_NAMES.guest, lines, onChangeAvatar: () => { view = 'avatars'; cue('click'); render(); } }));

            if (user) {
                const row = el('div', 'pf-public');
                const label = el('label', 'pf-switch');
                const box = el('input');
                box.type = 'checkbox';
                box.checked = remote?.public ?? true;
                box.disabled = !remote;
                box.addEventListener('change', async () => {
                    box.disabled = true;
                    try {
                        const r = await call('/profile', { method: 'PUT', body: { public: box.checked } });
                        if (remote) remote.public = r.public;
                        cue('click');
                    } catch (e) {
                        box.checked = !box.checked;
                        note.textContent = e.message;
                    } finally {
                        box.disabled = false;
                    }
                });
                label.append(box, el('span', 'pf-knob'), el('span', null, T.publicSwitch));
                const share = button(T.share, async () => {
                    try {
                        await navigator.clipboard.writeText(shareUrl(user.name));
                        share.textContent = T.shared;
                        cue('click');
                    } catch {
                        prompt(T.share, shareUrl(user.name));
                    }
                });
                const note = el('p', 'mm-note', T.publicNote);
                row.append(label, share);
                body.append(row, note, bestsRow(remote?.best));
            } else {
                const row = el('div', 'mm-actions');
                row.appendChild(button(T.signIn, () => menus.openAccount(), 'btn-primary small'));
                body.append(row, el('p', 'mm-note', T.signInNote));
            }
            body.append(endingsRow(earned), achievementGrid(earned));
            const foot = el('div', 'mm-actions pf-foot');
            foot.append(button(T.account, () => menus.openAccount(), 'btn-secondary strong'), button(T.best, () => onLeaderboard()));
            body.appendChild(foot);
        }

        function renderPicker() {
            body.append(el('p', 'mm-text', T.avatarNote));
            const grid = el('div', 'av-grid');
            const current = myAvatar();
            for (const a of AVATARS) {
                const ok = unlocked(a);
                const def = a.unlock ? achievementById(a.unlock) : null;
                const b = el('button', `av-pick${a.id === current ? ' on' : ''}${ok ? '' : ' locked'}`);
                b.type = 'button';
                b.dataset.avatar = a.id;
                if (ok) b.appendChild(avatarNode(a.id, 56));
                else b.appendChild(el('span', 'av av-lock'));
                b.appendChild(el('span', 'av-name', ok ? a.name : AVATAR_NAMES.locked));
                if (!ok) b.appendChild(el('span', 'av-unlock', `${T.unlockWith} ${achievementText(def, false).name}`));
                b.disabled = !ok;
                b.addEventListener('click', async () => {
                    try {
                        await setAvatar(a.id);
                        cue('check');
                    } catch (e) {
                        alert(e.message);
                    }
                    view = 'profile';
                    render();
                });
                grid.appendChild(b);
            }
            const row = el('div', 'mm-actions');
            row.appendChild(button('Back', () => { view = 'profile'; render(); }));
            body.append(grid, row);
        }

        const modalOpen = () => body.isConnected;
        render();
        if (account.state.user) fetchOwn().then(() => view === 'profile' && modalOpen() && render()).catch(() => {});
        const offA = achievements.onChange(() => view === 'profile' && render());
        const offU = account.onChange(() => modalOpen() && view === 'profile' && !body.contains(document.activeElement) && render());
        m.onClose = () => {
            offA();
            offU();
        };
    }

    // ---- Someone else's (or your public one) -----------------------------------------------------
    async function openPlayer(name) {
        const m = menus.openModal({ kicker: T.publicKicker, title: name, wide: true });
        m.node.querySelector('.mm-panel').classList.add('profile');
        const body = m.body;
        body.appendChild(el('p', 'mm-empty', 'Loading…'));
        let p;
        try {
            p = await call(`/players/${encodeURIComponent(name)}`);
        } catch (e) {
            body.innerHTML = '';
            body.appendChild(el('p', 'mm-empty', e.status === 404 ? T.notFound : e.status === 0 ? 'The server can’t be reached.' : e.message));
            return;
        }
        if (!body.isConnected) return;
        body.innerHTML = '';
        if (p.private) {
            body.appendChild(header({ avatar: p.avatar, name: p.name, lines: [] }));
            body.appendChild(el('p', 'mm-text', T.private));
            return;
        }
        const earned = p.achievements ?? {};
        body.appendChild(header({ avatar: p.avatar, name: p.name, lines: [[T.memberSince, fmtDate(p.createdAt)], countLine(earned)] }));
        if (p.me) {
            const row = el('div', 'mm-actions');
            row.append(el('span', 'mm-note', T.yours), button(T.title, () => open()));
            body.appendChild(row);
        }
        body.append(bestsRow(p.best), endingsRow(earned), achievementGrid(earned));
    }

    // ---- Leaderboard rows ----------------------------------------------------------------------
    /** Fill every `[data-av-name]` placeholder under `root` with that player's avatar. */
    async function fillAvatars(root) {
        const slots = [...root.querySelectorAll('[data-av-name]')];
        const missing = [...new Set(slots.map((s) => s.dataset.avName).filter((n) => !avatarCache.has(n)))];
        if (missing.length) {
            try {
                const r = await call(`/players?names=${encodeURIComponent(missing.join(','))}`);
                for (const n of missing) avatarCache.set(n, r.avatars?.[n] ?? '');
            } catch { /* offline: DELTA for everyone */ }
        }
        const me = account.state.user?.name;
        for (const s of slots) {
            const n = s.dataset.avName;
            const id = n === me ? myAvatar() : avatarCache.get(n) || DEFAULT_AVATAR;
            s.replaceChildren(avatarNode(id, Number(s.dataset.avSize) || 22));
        }
    }

    return {
        open,
        openPlayer,
        avatarNode,
        fillAvatars,
        myAvatar,
        /** The in-game menu's hint for Profile. */
        menuHint: () => `${achievements.count()}/${ACHIEVEMENTS.length} achievements`,
    };
}
