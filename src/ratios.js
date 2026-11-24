// src/ratios.js — the machine panel's ratios: for each input, how many supplying machines it
// takes to keep this one busy at full speed, and for the output, how many machines it keeps
// busy. Worked out from grid.js RECIPES, config.js PROCESS_TICKS and machineRates (full power,
// the machine's own tier); the other side is counted at the tier most of the player's machines
// of that kind have (T1 when there are none, which is what a new one would be). An item with
// several makers or users lists the ones the factory has first. The pad, belts and routers
// have no ratios. Reads the grid, writes nothing; no DOM.
import { grid, RECIPES, machineRates, recipeUnlocked, isBuildingUnlocked } from './grid.js';
import { GRID_WIDTH, GRID_HEIGHT, PROCESS_TICKS, TICK_RATE, GENERATOR_FUEL_TICKS } from './config.js';

const NONE = new Set(['belt', 'splitter', 'merger', 'sink']);
const ORES = ['ironOre', 'copperOre', 'coalOre', 'sulfurOre'];
const perMinute = (ticks) => (60 * TICK_RATE) / ticks;

// Every way of making or using items: a recipe on a machine, an extractor on an ore, the generator's coal.
const WAYS = [
    ...Object.entries(RECIPES).flatMap(([type, list]) => list.map((r) => ({
        type, recipe: r.id, inputs: r.inputs, output: r.output, time: r.time ?? 1, tech: r.tech ?? null, choices: list.length,
    }))),
    ...ORES.map((ore) => ({ type: 'extractor', ore, inputs: {}, output: ore, time: 1, choices: 1 })),
    { type: 'generator', inputs: { coalOre: 1 }, output: null, ticks: GENERATOR_FUEL_TICKS, choices: 1 },
];
const wayKey = (w) => `${w.type}:${w.recipe ?? w.ore ?? ''}`;

/** Operations per minute of one machine doing `w` at `tier`. */
function opsPerMin(w, tier) {
    if (w.ticks) return perMinute(w.ticks);
    const t = PROCESS_TICKS[w.type];
    return perMinute(t[Math.min(tier, t.length) - 1] * w.time);
}

/** The factory's machines per way: { [wayKey]: { n, tiers: { [tier]: n } } }. */
function census() {
    const out = {};
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            if (!m || NONE.has(m.type)) continue;
            const key = `${m.type}:${m.recipe ?? (m.type === 'extractor' ? m.produces : '') ?? ''}`;
            const c = (out[key] ??= { n: 0, tiers: {} });
            c.n++;
            c.tiers[m.tier] = (c.tiers[m.tier] ?? 0) + 1;
        }
    }
    return out;
}

/** The tier most of the player's machines doing `w` have (the lower one on a tie), T1 if none. */
function usualTier(c) {
    let best = 1;
    let most = 0;
    for (const [t, n] of Object.entries(c?.tiers ?? {})) {
        if (n > most || (n === most && Number(t) < best)) {
            best = Number(t);
            most = n;
        }
    }
    return best;
}

/** The ways worth showing: the ones the factory has (most first), else the ones it could build. */
function pick(ways, have, max = 2) {
    const present = ways.filter((w) => have[wayKey(w)]?.n).sort((a, b) => have[wayKey(b)].n - have[wayKey(a)].n);
    if (present.length) return present.slice(0, max);
    const possible = ways.filter((w) => isBuildingUnlocked(w.type) && (!w.tech || recipeUnlocked(w)));
    return possible.length ? possible.slice(0, max) : ways.slice(0, 1); // nothing buildable yet: the first that will be
}

/**
 * The ratios for the machine at (x, y), or null (no machine, pad, belt, router, nothing to say).
 * @returns {{ needs: { item: string, options: { type: string, tier: number, n: number }[] }[],
 *             feeds: { item: string, options: { type: string, tier: number, n: number, product: string|null }[] }[] } | null}
 */
export function machineRatios(x, y) {
    const m = grid[x]?.[y]?.machine;
    if (!m || NONE.has(m.type)) return null;
    const rates = machineRates(x, y);
    if (!rates) return null;
    const have = census();
    const needs = Object.entries(rates.inPerMin ?? {}).map(([item, rate]) => ({
        item,
        options: pick(WAYS.filter((w) => w.output === item), have).map((w) => {
            const tier = usualTier(have[wayKey(w)]);
            return { type: w.type, tier, n: rate / opsPerMin(w, tier) };
        }),
    })).filter((r) => r.options.length);
    const feeds = Object.entries(rates.outPerMin ?? {}).map(([item, rate]) => ({
        item,
        options: pick(WAYS.filter((w) => w.inputs[item]), have).map((w) => {
            const tier = usualTier(have[wayKey(w)]);
            return { type: w.type, tier, n: rate / (w.inputs[item] * opsPerMin(w, tier)), product: w.choices > 1 ? w.output : null };
        }),
    })).filter((r) => r.options.length);
    return needs.length || feeds.length ? { needs, feeds } : null;
}
