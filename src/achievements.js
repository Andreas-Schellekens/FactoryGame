// src/achievements.js — the achievements: the table, a tracker that polls the world about
// once a second (main.js hands it the same snapshot the story director reads, and the
// tracker adds what it measures itself: credits per minute, Priority Request streaks, time
// without a brownout), local storage, the account sync (a union of every device's), and
// the HUD toast when one is earned. Achievements aren't verified by the server: they are
// for fun, not a competition.
//
// To add one: a line in ACHIEVEMENTS below and its name and description in story.js
// ACHIEVEMENT_TEXT (same id). That's all: the profile grid, the toast and the sync pick it up.
//   { id, group: 'factory' | 'infinite' | 'story', mode?: 'story' | 'infinite', hidden?, when(w) }
// `mode` limits where it can be earned (none: both modes); `hidden` shows ??? until earned.
// `w` is main.js snapshot() plus the tracker's own fields (see `measure` below).

import { grid, power, order, project, tickCount } from './grid.js';
import { GRID_WIDTH, GRID_HEIGHT, TICK_RATE, LICENCE_COST, PLOTS, TECH_COST } from './config.js';
import { PHASES } from './campaign.js';
import { ACHIEVEMENT_TEXT, PROFILE_TEXT } from './story.js';
import { call } from './account.js';

const HOUR = 3600 * TICK_RATE; // ticks
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const owns = (w, type) => w.licences.includes(type);

export const ACHIEVEMENTS = [
    // On the line (both modes)
    { id: 'firstChain', group: 'factory', when: (w) => sum(w.deliveredTotal) > 0 },
    { id: 'circuit', group: 'factory', when: (w) => (w.produced.circuit ?? 0) > 0 },
    { id: 'steel', group: 'factory', when: (w) => (w.produced.steel ?? 0) > 0 },
    { id: 'motor', group: 'factory', when: (w) => (w.produced.motor ?? 0) > 0 },
    { id: 'explosive', group: 'factory', when: (w) => (w.produced.explosive ?? 0) > 0 },
    { id: 'upgrade', group: 'factory', when: (w) => w.upgraded > 0 },
    { id: 'tier4', group: 'factory', when: (w) => w.maxTier >= 4 },
    { id: 'hum', group: 'factory', when: (w) => w.working >= 25 },
    { id: 'grid', group: 'factory', when: (w) => w.fueledGenerators >= 3 },
    { id: 'express', group: 'factory', when: (w) => !!w.tech.fastBelts },
    { id: 'allTech', group: 'factory', when: (w) => w.techCount >= Object.keys(TECH_COST).length },
    { id: 'steady', group: 'factory', when: (w) => w.cleanTicks >= HOUR },
    { id: 'cpm50', group: 'factory', when: (w) => w.cpm >= 50 },
    { id: 'cpm250', group: 'factory', when: (w) => w.cpm >= 250 },
    { id: 'cpm1000', group: 'factory', when: (w) => w.cpm >= 1000 },
    { id: 'cpm2500', group: 'factory', when: (w) => w.cpm >= 2500 },
    { id: 'rich', group: 'factory', when: (w) => w.money >= 10000 },
    { id: 'order1', group: 'factory', when: (w) => w.ordersFilled >= 1 },
    { id: 'streak5', group: 'factory', when: (w) => w.streak >= 5 },
    { id: 'streak15', group: 'factory', when: (w) => w.streak >= 15 },
    { id: 'breaker', group: 'factory', hidden: true, when: (w) => w.tripped },
    { id: 'missed', group: 'factory', hidden: true, when: (w) => w.missed },
    { id: 'fireSale', group: 'factory', hidden: true, when: (w) => w.minPrice < 0.25 },
    // Infinite
    { id: 'licence', group: 'infinite', mode: 'infinite', when: (w) => w.licences.length >= 1 },
    { id: 'licenceAll', group: 'infinite', mode: 'infinite', when: (w) => Object.keys(LICENCE_COST).every((t) => owns(w, t)) },
    { id: 'land', group: 'infinite', mode: 'infinite', when: (w) => w.plot >= 1 },
    { id: 'landAll', group: 'infinite', mode: 'infinite', when: (w) => w.plot >= PLOTS.length - 1 },
    { id: 'orders25', group: 'infinite', mode: 'infinite', when: (w) => w.orderLevel >= 25 },
    { id: 'audited', group: 'infinite', mode: 'infinite', when: (w) => w.submitted },
    { id: 'tenant', group: 'infinite', mode: 'infinite', when: (w) => w.tick >= 2 * HOUR },
    // Protocol: Selene (Story)
    ...PHASES.map((_, i) => ({ id: `phase${i + 1}`, group: 'story', mode: 'story', when: (w) => w.phase > i || w.complete })),
    { id: 'endingMoon', group: 'story', mode: 'story', when: (w) => w.complete && w.ending === 'moon' },
    { id: 'endingHQ', group: 'story', mode: 'story', hidden: true, when: (w) => w.complete && w.ending === 'hq' },
    { id: 'company', group: 'story', mode: 'story', hidden: true, when: (w) => !!w.company },
    { id: 'bothEndings', group: 'story', hidden: true, when: (w) => !!(w.earned.endingMoon && w.earned.endingHQ) },
    { id: 'speedrun', group: 'story', mode: 'story', hidden: true, when: (w) => w.complete && w.tick < 2 * HOUR },
];

/** An achievement's name and description (???, for a hidden one not earned yet). */
export function achievementText(def, earned = true) {
    const [name, desc] = ACHIEVEMENT_TEXT[def.id] ?? [def.id, ''];
    return def.hidden && !earned ? { name: PROFILE_TEXT.hidden, desc: PROFILE_TEXT.hiddenDesc } : { name, desc };
}
export const achievementById = (id) => ACHIEVEMENTS.find((a) => a.id === id) ?? null;

const STORE = 'selene.achievements.v1';
const WINDOW = 60 * TICK_RATE; // credits per minute over the last minute of game time

function readStore() {
    try {
        const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
        return v && typeof v.earned === 'object' ? v : { earned: {} };
    } catch {
        return { earned: {} };
    }
}

/** A fresh run: the per-game counters (saved with the game, so a reload keeps a streak). */
const freshRun = () => ({ income: 0, streak: 0, filled: 0, missed: false, clean: 0, lastOrder: '', lastTick: 0 });

/**
 * @param {{ account: any, sound?: any, root?: HTMLElement, avatarFor?: (achievementId: string) => any, quiet?: () => boolean }} opts
 * `root`: where the toast goes (default #hud, looked up when the first one shows, since the
 * HUD clears #hud when it builds). `avatarFor` names the avatar an achievement unlocks
 * (profile.js), for the toast. While `quiet()` is true (the ending's cinematic) achievements
 * are still earned, but their toasts wait.
 */
export function createAchievements({ account, sound, root = null, avatarFor = () => null, quiet = () => false }) {
    const store = readStore();
    const listeners = new Set();
    const emit = () => {
        for (const fn of listeners) fn(store.earned);
    };
    const persist = () => {
        try {
            localStorage.setItem(STORE, JSON.stringify(store));
        } catch { /* full or blocked: kept for this visit */ }
    };

    let run = freshRun();
    let samples = []; // [tick, income] over the last minute
    let lastCheck = -Infinity;

    // ---- The toast --------------------------------------------------------------------------
    const queue = [];
    let showing = false;
    const toast = document.createElement('div');
    toast.className = 'achv-toast';
    toast.setAttribute('role', 'status');
    function next() {
        if (queue.length && quiet()) {
            showing = true;
            setTimeout(next, 1000);
            return;
        }
        const def = queue.shift();
        if (!def) {
            showing = false;
            return;
        }
        showing = true;
        if (!toast.isConnected) (root ?? document.getElementById('hud') ?? document.body).appendChild(toast);
        const { name, desc } = achievementText(def, true);
        const n = Object.keys(store.earned).filter((id) => achievementById(id)).length;
        const avatar = avatarFor(def.id);
        toast.innerHTML = '';
        const badge = document.createElement('span');
        badge.className = 'achv-badge';
        badge.innerHTML = BADGE;
        const text = document.createElement('div');
        text.className = 'achv-text';
        const kicker = document.createElement('span');
        kicker.className = 'achv-kicker';
        kicker.textContent = `${PROFILE_TEXT.toastKicker} · ${String(n).padStart(2, '0')}/${ACHIEVEMENTS.length}`;
        const title = document.createElement('strong');
        title.className = 'achv-name';
        title.textContent = name;
        const line = document.createElement('span');
        line.className = 'achv-desc';
        line.textContent = desc;
        text.append(kicker, title, line);
        if (avatar) {
            const extra = document.createElement('span');
            extra.className = 'achv-extra';
            extra.textContent = `${PROFILE_TEXT.newAvatar}: ${avatar.name}`;
            text.appendChild(extra);
        }
        toast.append(badge, text);
        toast.classList.remove('show');
        void toast.offsetWidth;
        toast.classList.add('show');
        sound?.cue('achievement');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(next, 350);
        }, 4600);
    }

    // ---- Account sync -----------------------------------------------------------------------
    let pushTimer = null;
    async function push() {
        if (!account.state.user) return;
        try {
            const r = await call('/achievements', { method: 'POST', body: { earned: store.earned } });
            adopt(r.earned);
        } catch { /* offline: the next unlock or sign-in tries again */ }
    }
    const pushSoon = () => {
        clearTimeout(pushTimer);
        pushTimer = setTimeout(push, 1500);
    };
    /** Take in what the account has (no toasts: they were earned somewhere else). */
    function adopt(remote) {
        let changed = false;
        for (const [id, at] of Object.entries(remote ?? {})) {
            if (!(id in store.earned) || at < store.earned[id]) {
                store.earned[id] = at;
                changed = true;
            }
        }
        if (changed) {
            persist();
            emit();
        }
    }
    let lastUser = null;
    account.onChange((st) => {
        const id = st.user?.id ?? null;
        if (id === lastUser) return;
        lastUser = id;
        if (id) push(); // sends this browser's and takes the account's
    });

    // ---- Measuring --------------------------------------------------------------------------
    /** What the tracker adds to the snapshot: its own counters and a look at the grid. */
    function measure(w) {
        const tick = tickCount;
        if (tick < run.lastTick) run = { ...freshRun(), lastTick: tick }; // another game
        const dt = tick - run.lastTick;
        run.lastTick = tick;
        // Priority Requests: a streak of filled ones, broken by one that runs out.
        const key = `${order.startTick}:${order.status}`;
        if (key !== run.lastOrder) {
            run.lastOrder = key;
            if (order.status === 'completed') {
                run.streak++;
                run.filled++;
            } else if (order.status === 'failed') {
                run.streak = 0;
                run.missed = true;
            }
        }
        // Brownouts: a powered factory running at full power keeps the clock going.
        if (power.tripped || power.throttle < 0.999) run.clean = 0;
        else if (power.demand > 0) run.clean += dt;
        // Credits per minute at the pad, over the last minute of game time.
        samples.push([tick, run.income]);
        while (samples.length > 2 && tick - samples[1][0] >= WINDOW) samples.shift();
        const [t0, i0] = samples[0];
        const span = tick - t0;
        const cpm = span >= WINDOW * 0.75 ? ((run.income - i0) * WINDOW) / span : 0;
        let maxTier = 0;
        for (let x = 0; x < GRID_WIDTH; x++) {
            for (let y = 0; y < GRID_HEIGHT; y++) {
                const m = grid[x][y].machine;
                if (m && m.tier > maxTier) maxTier = m.tier;
            }
        }
        return {
            ...w, tick, cpm, maxTier, streak: run.streak, ordersFilled: run.filled, missed: run.missed,
            cleanTicks: run.clean, company: project.company, earned: store.earned,
        };
    }

    function earn(def) {
        store.earned[def.id] = Date.now();
        persist();
        emit();
        queue.push(def);
        if (!showing) next();
        pushSoon();
    }

    return {
        /** Check every achievement against the world (call it as often as you like: ~1/s is used). */
        update(w) {
            const now = performance.now();
            if (now - lastCheck < 1000) return;
            lastCheck = now;
            const v = measure(w);
            for (const def of ACHIEVEMENTS) {
                if (def.id in store.earned) continue;
                if (def.mode && def.mode !== v.mode) continue;
                let ok = false;
                try {
                    ok = !!def.when(v);
                } catch { /* a field missing in an older save: not yet */ }
                if (ok) earn(def);
            }
        },
        /** A tick's events: the pad's deliveries say what they earned. */
        onEvents(events) {
            for (const e of events) if (e.kind === 'consume' && e.paid) run.income += e.paid;
        },
        /** The per-game counters, saved with the game. */
        saveRun: () => ({ income: run.income, streak: run.streak, filled: run.filled, missed: run.missed, clean: run.clean }),
        loadRun(data) {
            run = { ...freshRun(), ...(data ?? {}), lastOrder: `${order.startTick}:${order.status}`, lastTick: tickCount };
            samples = [];
        },
        earned: () => store.earned,
        has: (id) => id in store.earned,
        count: () => ACHIEVEMENTS.filter((a) => a.id in store.earned).length,
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** Dev/test: earn one by id, as if the game had. */
        grant(id) {
            const def = achievementById(id);
            if (def && !(id in store.earned)) earn(def);
        },
    };
}

/** The toast's badge: a mission-control medal (a star in a square frame). */
const BADGE = `<svg viewBox="0 0 48 48" aria-hidden="true">
    <rect x="3" y="3" width="42" height="42" fill="#0b1524" stroke="#f3b23c" stroke-width="3" />
    <path d="M24 10 L28.1 19.4 L38.3 20.3 L30.6 27 L32.9 37 L24 31.8 L15.1 37 L17.4 27 L9.7 20.3 L19.9 19.4 Z" fill="#f3b23c" />
</svg>`;
