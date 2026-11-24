// src/challenge.js — the weekly challenge: one set of rules per period, generated from the
// period's key alone ("2026-W48", an ISO week in UTC; a day, "2026-11-24", works the same
// way), so the game and the API server, which runs this file in QuickJS, derive the same
// challenge. A week has a theme (what squeezes you), a target product (the only thing the
// Dispatch Pad takes, and the only thing that scores), the buildings you may use, a cap on
// machines, a budget for the whole factory, a tier cap, a plot, whether belts are express,
// and its own ore fields. grid.js plays it as game.mode 'challenge'; benchmark.js scores it.
//
// Pure data and arithmetic: the random numbers are 32-bit integer maths, positions and radii
// are compared squared (no Math.hypot or other functions whose last bits can differ between
// engines). No DOM, no player-facing text (that is story.js, CHALLENGE_*).
import { PAD_POS, PLOTS, RIVER } from './config.js';

/** Bump when the generator or the challenge's scoring changes: older scores aren't comparable. */
export const CHALLENGE_VERSION = 1;

const DAY_MS = 86400000;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n) => String(n).padStart(2, '0');

// ---- Periods ---------------------------------------------------------------------------------
/** The ISO week (UTC, weeks start Monday 00:00) of a time: "2026-W48". */
export function weekKey(ms) {
    const day = Math.floor(ms / DAY_MS);
    const weekday = (((day + 3) % 7) + 7) % 7; // Monday = 0 (1970-01-01 was a Thursday)
    const thursday = day - weekday + 3; // the ISO year is the year of the week's Thursday
    const year = new Date(thursday * DAY_MS).getUTCFullYear();
    const jan1 = Math.floor(Date.UTC(year, 0, 1) / DAY_MS);
    return `${year}-W${pad2(Math.floor((thursday - jan1) / 7) + 1)}`;
}

/** The UTC day of a time: "2026-11-24" (a daily challenge's key). */
export function dayKey(ms) {
    const d = new Date(Math.floor(ms / DAY_MS) * DAY_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** The current period's key: kind 'week' (the weekly challenge) or 'day'. */
export function periodKey(ms, kind = 'week') {
    return kind === 'day' ? dayKey(ms) : weekKey(ms);
}

/** When a period starts and ends (ms, UTC; end exclusive), or null for a key that isn't one. */
export function periodBounds(key) {
    const s = String(key ?? '');
    let m = WEEK_RE.exec(s);
    if (m) {
        const year = Number(m[1]);
        const week = Number(m[2]);
        if (week < 1 || week > 53) return null;
        const jan4 = Math.floor(Date.UTC(year, 0, 4) / DAY_MS);
        const monday1 = jan4 - ((((jan4 + 3) % 7) + 7) % 7);
        const start = (monday1 + (week - 1) * 7) * DAY_MS;
        if (weekKey(start) !== s) return null; // week 53 of a year that has 52
        return { start, end: start + 7 * DAY_MS };
    }
    m = DAY_RE.exec(s);
    if (m) {
        const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (dayKey(start) !== s) return null; // 2026-02-31
        return { start, end: start + DAY_MS };
    }
    return null;
}

/** The period before this one ("2026-W47" before "2026-W48"), or null. */
export function previousPeriod(key) {
    const b = periodBounds(key);
    if (!b) return null;
    return DAY_RE.test(key) ? dayKey(b.start - 1) : weekKey(b.start - 1);
}

// ---- Seeded randomness (32-bit integer maths: identical in every engine) ------------------------
function hashKey(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- The pools ----------------------------------------------------------------------------------
// The buildings that never count towards the machine cap.
export const CONVEYORS = ['belt', 'splitter', 'merger'];
/** Does a building count towards a challenge's machine cap? */
export const countsTowardCap = (type) => !CONVEYORS.includes(type) && type !== 'sink';

// What each target needs (checked against grid.js RECIPES by scripts/test-bench.mjs): the
// buildings of its chain, the ores, the fewest machines a working chain has (extractors and
// processors: belts don't count) and roughly what that chain costs with its belts.
export const TARGETS = {
    circuit: { buildings: ['extractor', 'smelter', 'press', 'assembler'], ores: ['ironOre', 'copperOre'], machines: 7, cost: 170 },
    steel: { buildings: ['extractor', 'smelter', 'foundry'], ores: ['ironOre', 'coalOre'], machines: 4, cost: 110 },
    capacitor: { buildings: ['extractor', 'smelter', 'press', 'foundry', 'assembler'], ores: ['ironOre', 'copperOre', 'coalOre'], machines: 8, cost: 200 },
    motor: { buildings: ['extractor', 'smelter', 'press', 'foundry', 'assembler'], ores: ['ironOre', 'copperOre', 'coalOre'], machines: 11, cost: 270 },
    advancedCircuit: { buildings: ['extractor', 'smelter', 'press', 'foundry', 'assembler'], ores: ['ironOre', 'copperOre', 'coalOre'], machines: 12, cost: 300 },
    explosive: { buildings: ['extractor', 'mixer'], ores: ['sulfurOre', 'coalOre'], machines: 3, cost: 90 },
    dataCartridge: { buildings: ['extractor', 'smelter', 'press', 'assembler', 'fabricator'], ores: ['ironOre', 'copperOre'], machines: 10, cost: 260 },
    seleneShell: { buildings: ['extractor', 'smelter', 'press', 'foundry', 'assembler', 'mixer'], ores: ['ironOre', 'copperOre', 'coalOre', 'sulfurOre'], machines: 20, cost: 520 },
};

// The themes: what squeezes you this week. Each sets the ranges the rest is drawn from:
// `budget` and `cap` as multiples of the target's chain (`capPlus`: the chain plus a few),
// `tier` the tier cap range, `plot` the land (PLOTS index), `fastBelts` the chance of express
// belts, `extras` the chance of each optional building, `ore` how rich the fields are.
const ALL_TARGETS = Object.keys(TARGETS);
export const THEMES = {
    shoestring: { targets: ALL_TARGETS, budget: [1.5, 2.1], cap: [2.5, 3.5], tier: [2, 3], plot: [3], fastBelts: 0.5, extras: { splitter: 1, merger: 1, generator: 0.6 }, ore: 'normal' },
    skeleton: { targets: ALL_TARGETS, budget: [7, 10], capPlus: [1, 3], tier: [4, 4], plot: [3], fastBelts: 0.5, extras: { splitter: 1, merger: 1, generator: 1 }, ore: 'normal' },
    stock: { targets: ALL_TARGETS, budget: [4, 6], cap: [2, 2.6], tier: [1, 1], plot: [3], fastBelts: 0.5, extras: { splitter: 1, merger: 1, generator: 1 }, ore: 'normal' },
    scarcity: { targets: ALL_TARGETS, budget: [4, 6], cap: [2, 3], tier: [2, 4], plot: [3], fastBelts: 0.3, extras: { splitter: 1, merger: 1, generator: 0.8 }, ore: 'scarce' },
    tight: { targets: ['circuit', 'steel', 'capacitor', 'motor', 'explosive', 'dataCartridge'], budget: [4, 6], cap: [2, 3], tier: [2, 4], plot: [0, 1], fastBelts: 0.5, extras: { splitter: 1, merger: 1, generator: 0.8 }, ore: 'normal' },
    offgrid: { targets: ALL_TARGETS, budget: [4, 6], cap: [2.5, 3.5], tier: [2, 4], plot: [3], fastBelts: 0, extras: { splitter: 1, merger: 1, generator: 0 }, ore: 'normal' },
    rush: { targets: ['capacitor', 'motor', 'advancedCircuit', 'dataCartridge', 'seleneShell'], budget: [8, 12], cap: [3, 4], tier: [3, 4], plot: [3], fastBelts: 1, extras: { splitter: 1, merger: 1, generator: 1 }, ore: 'rich' },
};
// Names per theme in story.js: the generator only picks which one (0..NAMES_PER_THEME-1).
export const NAMES_PER_THEME = 4;
const BUILD_ORDER = ['belt', 'splitter', 'merger', 'extractor', 'smelter', 'press', 'foundry', 'assembler', 'fabricator', 'mixer', 'generator'];

// ---- Ore fields ---------------------------------------------------------------------------------
// Squared distance from a point to the river's polyline (cell coordinates).
function riverDist2(px, py) {
    let best = Infinity;
    for (let i = 0; i < RIVER.path.length - 1; i++) {
        const [ax, ay] = RIVER.path[i];
        const [bx, by] = RIVER.path[i + 1];
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
        const dx = px - (ax + vx * t);
        const dy = py - (ay + vy * t);
        best = Math.min(best, dx * dx + dy * dy);
    }
    return best;
}

const ORE_SHAPES = {
    normal: { count: [2, 3], r: [24, 44], padGap: 3 },   // r in twentieths of a cell
    scarce: { count: [1, 2], r: [20, 28], padGap: 7 },
    rich: { count: [3, 3], r: [34, 50], padGap: 3 },
};

/** Lay the week's fields: well apart, clear of the river and the pad, inside the plot. */
function layFields(rand, oreTypes, rect, shape) {
    const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
    const fields = [];
    for (const type of oreTypes) {
        const count = int(shape.count[0], shape.count[1]);
        for (let n = 0; n < count; n++) {
            const r = int(shape.r[0], shape.r[1]) / 20;
            let placed = null;
            // Fewer and fewer conditions if the land is crowded (never needed in practice).
            for (let attempt = 0; attempt < 400 && !placed; attempt++) {
                const strict = attempt < 300;
                const x = int(rect.x + 1, rect.x + rect.w - 2);
                const y = int(rect.y + 1, rect.y + rect.h - 2);
                const pdx = x - PAD_POS.x;
                const pdy = y - PAD_POS.y;
                const gap = strict ? shape.padGap : 2.5;
                if (pdx * pdx + pdy * pdy < (r + gap) * (r + gap)) continue;
                const wet = r + RIVER.halfWidth + 1.2;
                if (riverDist2(x + 0.5, y + 0.5) < wet * wet) continue;
                const apart = strict ? 1.5 : 0.5;
                if (fields.some((f) => (f.x - x) * (f.x - x) + (f.y - y) * (f.y - y) < (f.r + r + apart) * (f.r + r + apart))) continue;
                placed = { type, x, y, r };
            }
            if (placed) fields.push(placed);
        }
    }
    return fields;
}

// ---- The challenge ------------------------------------------------------------------------------
/** Is this a period key the challenge knows ("2026-W48" or "2026-11-24")? */
export const isPeriodKey = (key) => periodBounds(key) != null;

/** A period's place in time: weeks (or days) since 1970-01-05, a Monday. */
function periodIndex(key) {
    const b = periodBounds(key);
    const days = Math.floor(b.start / DAY_MS) - 4;
    return DAY_RE.test(key) ? days : Math.floor(days / 7);
}

/** The order the themes come in during one cycle (every theme once per cycle, seeded). */
function themeCycle(cycle, kind) {
    const ids = Object.keys(THEMES);
    const rand = mulberry32(hashKey(`selene-themes:${CHALLENGE_VERSION}:${kind}:${cycle}`));
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
}

/** This period's theme: they take turns, so two weeks in a row never share one. */
function themeOf(key) {
    const kind = DAY_RE.test(key) ? 'day' : 'week';
    const n = Object.keys(THEMES).length;
    const index = periodIndex(key);
    const cycle = Math.floor(index / n);
    const pos = index - cycle * n;
    const order = themeCycle(cycle, kind);
    // A cycle that would start with the theme the last one ended on swaps its first two.
    if (themeCycle(cycle - 1, kind)[n - 1] === order[0]) [order[0], order[1]] = [order[1], order[0]];
    return order[pos];
}

/** The target a period draws before it is kept from repeating the one before (see challengeFor). */
function drawnTarget(key, theme) {
    const rand = mulberry32(hashKey(`selene-target:${CHALLENGE_VERSION}:${key}`));
    return theme.targets[Math.floor(rand() * theme.targets.length)];
}

const cache = new Map();

/**
 * The challenge for a period key, or null for a key that isn't one. Always the same object for
 * the same key (treat it as read-only).
 * @returns {null | { key: string, version: number, theme: string, name: number, target: string,
 *   buildings: string[], cap: number, budget: number, tierCap: number, fastBelts: boolean,
 *   plot: number, ore: { type: string, x: number, y: number, r: number }[],
 *   minMachines: number, minCost: number }}
 */
export function challengeFor(key) {
    if (!isPeriodKey(key)) return null;
    if (cache.has(key)) return cache.get(key);
    const rand = mulberry32(hashKey(`selene-challenge:${CHALLENGE_VERSION}:${key}`));
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const between = ([lo, hi]) => lo + rand() * (hi - lo);
    const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

    const themeId = themeOf(key);
    const theme = THEMES[themeId];
    const name = int(0, NAMES_PER_THEME - 1);
    // The target: drawn for this period, moved one along its theme's list if the period before
    // drew the same one.
    let target = drawnTarget(key, theme);
    const prev = previousPeriod(key);
    if (prev && drawnTarget(prev, THEMES[themeOf(prev)]) === target) {
        target = theme.targets[(theme.targets.indexOf(target) + 1) % theme.targets.length];
    }
    const chain = TARGETS[target];
    const extras = Object.entries(theme.extras).filter(([, p]) => rand() < p).map(([t]) => t);
    const buildings = BUILD_ORDER.filter((t) => t === 'belt' || chain.buildings.includes(t) || extras.includes(t));
    const cap = theme.capPlus ? chain.machines + int(theme.capPlus[0], theme.capPlus[1]) : Math.ceil(chain.machines * between(theme.cap));
    const budget = Math.max(100, Math.round((chain.cost * between(theme.budget)) / 50) * 50);
    const tierCap = int(theme.tier[0], theme.tier[1]);
    const fastBelts = rand() < theme.fastBelts;
    const plot = pick(theme.plot);
    const oreTypes = [...chain.ores];
    if (buildings.includes('generator') && !oreTypes.includes('coalOre')) oreTypes.push('coalOre');
    const rect = PLOTS[Math.min(plot, PLOTS.length - 1)];
    const ore = layFields(rand, oreTypes, rect, ORE_SHAPES[theme.ore]);

    const rules = {
        key, version: CHALLENGE_VERSION, theme: themeId, name, target, buildings, cap, budget, tierCap, fastBelts, plot, ore,
        minMachines: chain.machines, minCost: chain.cost,
    };
    cache.set(key, rules);
    return rules;
}

/** This period's challenge (the weekly one unless `kind` is 'day'). */
export const currentChallenge = (ms, kind = 'week') => challengeFor(periodKey(ms, kind));
