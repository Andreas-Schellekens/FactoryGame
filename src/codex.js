// src/codex.js — the in-game codex's logic: every entry (items, buildings, recipes, research)
// built from the game's own data (RECIPES, MACHINE_COST, PROCESS_TICKS, POWER_DRAW, SINK_VALUE
// and the live prices, TECH_COST, PHASES, LICENCE_COST, portsFor), so it never goes stale.
// It reads the live simulation (what is unlocked, researched, licensed, on the map) to say what
// is locked for the player right now, and keeps the story's NIHIL-era things "classified" until
// the reveal. No DOM: codexPanel.js draws what this returns; every word comes from story.js.
//
// Entry ids: 'item:<type>', 'building:<type>', 'tech:<id>'; recipes are 'recipe:<machine>:<id>'.
import {
    RECIPES, UPGRADABLE, grid, research, project, game, isInfinite, isBuildingUnlocked, recipeUnlocked,
    salePrice, portsFor, licenceAvailable,
} from './grid.js';
import {
    MACHINE_COST, PROCESS_TICKS, POWER_DRAW, SINK_VALUE, TECH_COST, LICENCE_COST, TICK_RATE, UPGRADE_COST, MAX_TIER,
    GENERATOR_FUEL_TICKS, POWER_PER_GENERATOR, BASE_POWER_SUPPLY, RESEARCH_PER_ITEM, ORE_FIELDS, ORDER_POOL,
    INFINITE_ORDER_POOL,
} from './config.js';
import { PHASES, unlockPhaseOf } from './campaign.js';
import { ITEM_NAMES, BUILDING_NAMES, TECH_TEXT, PHASE_TEXT, RECIPE_NAMES, CODEX } from './story.js';

// ---- The catalogue --------------------------------------------------------------------------
/** Every recipe as one flat list: { key: 'press:copperWire', machine, id, inputs, output, time?, tech? }. */
export const ALL_RECIPES = Object.entries(RECIPES).flatMap(([machine, list]) => list.map((r) => ({ ...r, machine, key: `${machine}:${r.id}` })));

const allItems = new Set([...Object.keys(ITEM_NAMES), ...ALL_RECIPES.flatMap((r) => [...Object.keys(r.inputs), r.output].filter(Boolean))]);
const RAW = new Set([...allItems].filter((k) => !ALL_RECIPES.some((r) => r.output === k)));

// Chain order: how many steps an item is from the ore (ingots 1, plates 2, circuits 3…).
const depthMemo = {};
function depth(item, seen = new Set()) {
    if (item in depthMemo) return depthMemo[item];
    if (RAW.has(item) || seen.has(item)) return 0;
    seen.add(item);
    const makers = ALL_RECIPES.filter((r) => r.output === item);
    const d = 1 + Math.min(...makers.map((r) => Math.max(0, ...Object.keys(r.inputs).map((k) => depth(k, seen)))));
    depthMemo[item] = d;
    return d;
}
const NAME_ORDER = Object.keys(ITEM_NAMES);
/** Items in chain order (ore first, finished goods last). */
export const ITEMS = [...allItems].sort((a, b) => depth(a) - depth(b) || NAME_ORDER.indexOf(a) - NAME_ORDER.indexOf(b));

// Buildings in the order of the build keys, then anything new, then the Pad.
const KEY_ORDER = ['belt', 'splitter', 'merger', 'extractor', 'smelter', 'press', 'foundry', 'assembler', 'fabricator', 'lab', 'mixer', 'generator'];
/** Buildings: the build keys' order, the Dispatch Pad last. */
export const BUILDINGS = [...KEY_ORDER.filter((t) => t in MACHINE_COST), ...Object.keys(MACHINE_COST).filter((t) => !KEY_ORDER.includes(t)), 'sink'];
export const TECHS = Object.keys(TECH_COST);

const CONVEYORS = new Set(['belt', 'splitter', 'merger']);

// ---- Spoilers: the NIHIL era stays classified in the story until the reveal -------------------
// The reveal is the phase NILE becomes NIHIL (story.js brandFor); what it brings is derived:
// the buildings that phase's completion unlocks, ore that only shows up from then on, and
// everything made from either.
const REVEAL_PHASE = 4;
const SECRET_BUILDINGS = new Set(PHASES[REVEAL_PHASE - 1]?.unlocks ?? []);
const SECRET_ITEMS = new Set(ORE_FIELDS
    .filter((f) => f.fromPhase >= REVEAL_PHASE)
    .map((f) => f.type)
    .filter((t) => ORE_FIELDS.every((f) => f.type !== t || f.only === 'infinite' || f.fromPhase >= REVEAL_PHASE)));
for (let grew = true; grew;) {
    grew = false;
    for (const r of ALL_RECIPES) {
        if (!r.output || SECRET_ITEMS.has(r.output)) continue;
        if (SECRET_BUILDINGS.has(r.machine) || Object.keys(r.inputs).some((k) => SECRET_ITEMS.has(k))) {
            SECRET_ITEMS.add(r.output);
            grew = true;
        }
    }
}
const secretsSealed = () => !isInfinite() && project.phase < REVEAL_PHASE;

/** Is this entry (an id, or a recipe object) classified for the player right now? */
export function isClassified(idOrRecipe) {
    if (!secretsSealed()) return false;
    if (typeof idOrRecipe === 'object') {
        const r = idOrRecipe;
        return SECRET_BUILDINGS.has(r.machine) || (r.output && SECRET_ITEMS.has(r.output)) || Object.keys(r.inputs).some((k) => SECRET_ITEMS.has(k));
    }
    const [kind, key] = idOrRecipe.split(':');
    return (kind === 'item' && SECRET_ITEMS.has(key)) || (kind === 'building' && SECRET_BUILDINGS.has(key));
}

// ---- Small helpers --------------------------------------------------------------------------
/** "0.75 s", "2 s", "12 s". */
export const fmtSecs = (s) => `${s >= 10 ? Math.round(s) : Number(s.toFixed(2))} s`;
const fmtRate = (n) => (n >= 10 ? Math.round(n) : Number(n.toFixed(1)));
const opSeconds = (type, tier = 1, time = 1) => ((PROCESS_TICKS[type]?.[tier - 1] ?? 1) * time) / TICK_RATE;
export const itemName = (k) => ITEM_NAMES[k] ?? k;
export const buildingName = (t) => BUILDING_NAMES[t] ?? t;

function oreOnMap(type) {
    for (const col of grid) for (const c of col) if (c.resource === type) return true;
    return false;
}

// ---- Status: what is locked for the player right now ------------------------------------------
/** { ok, text, chip } for a building: available, or why not (the phase, or its licence). */
export function buildingStatus(type) {
    if (type === 'sink') return { ok: true, text: CODEX.status.pad, chip: '' };
    if (isBuildingUnlocked(type)) {
        return { ok: true, text: isInfinite() && type in LICENCE_COST ? CODEX.status.licensed : CODEX.status.available, chip: '' };
    }
    if (isInfinite()) {
        const cost = LICENCE_COST[type];
        return { ok: false, text: licenceAvailable(type) ? CODEX.status.licenceNow(cost) : CODEX.status.licenceLater(cost), chip: CODEX.status.licenceShort };
    }
    const p = unlockPhaseOf(type); // the phase whose completion unlocks it: it arrives in the next one
    return { ok: false, text: CODEX.status.phase(p + 2, PHASE_TEXT[p + 1]?.title ?? ''), chip: CODEX.status.phaseShort(p + 2) };
}

/** { ok, text, chip, gate } for a recipe: its building ('building'), then its research ('tech'). */
export function recipeStatus(r) {
    const b = buildingStatus(r.machine);
    if (!b.ok) return { ok: false, text: CODEX.status.needsBuilding(buildingName(r.machine), b.text), chip: b.chip, gate: 'building' };
    if (!recipeUnlocked(r)) return { ok: false, text: CODEX.status.needsTech(TECH_TEXT[r.tech]?.label ?? r.tech), chip: CODEX.status.techShort, gate: 'tech' };
    return { ok: true, text: CODEX.status.available, chip: '', gate: null };
}

/** { ok, text, chip } for an item: on the map (ore), or some recipe that makes it is open. */
export function itemStatus(item) {
    if (RAW.has(item)) {
        if (oreOnMap(item)) return { ok: true, text: CODEX.status.available, chip: '' };
        const field = ORE_FIELDS.find((f) => f.type === item && (isInfinite() ? f.only === 'infinite' : f.only !== 'infinite'));
        if (isInfinite() && field?.fromPlot != null) return { ok: false, text: CODEX.status.withLand(field.fromPlot + 1), chip: CODEX.status.landShort };
        return { ok: false, text: CODEX.status.notOnMap, chip: CODEX.status.landShort };
    }
    const makers = ALL_RECIPES.filter((r) => r.output === item).map((r) => recipeStatus(r));
    return makers.find((s) => s.ok) ?? makers[0] ?? { ok: true, text: CODEX.status.available, chip: '' };
}

/** A recipe as the codex shows it (one row): inputs → output, time, machine, gate, status. */
export function recipeView(r) {
    if (isClassified(r)) return { key: r.key, classified: true, machine: SECRET_BUILDINGS.has(r.machine) ? null : r.machine };
    const secs = opSeconds(r.machine, 1, r.time ?? 1);
    const st = recipeStatus(r);
    return {
        key: r.key,
        classified: false,
        machine: r.machine,
        inputs: Object.entries(r.inputs).map(([item, n]) => ({ item, n })),
        output: r.output,
        outputLabel: r.output ? itemName(r.output) : RECIPE_NAMES[r.id] ?? r.id,
        points: r.output ? 0 : RESEARCH_PER_ITEM,
        time: r.time ?? 1,
        secs: fmtSecs(secs),
        perMin: fmtRate(60 / secs),
        tech: r.tech ? { id: r.tech, label: TECH_TEXT[r.tech]?.label ?? r.tech, done: !!research.unlocked[r.tech] } : null,
        ok: st.ok,
        why: st.ok ? '' : st.text,
        gate: st.gate,
        chip: st.chip,
    };
}

// ---- Search and lists -----------------------------------------------------------------------
const words = (q) => String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const matches = (hay, q) => words(q).every((w) => hay.toLowerCase().includes(w));

function itemHay(k) { return `${itemName(k)} ${CODEX.items[k] ?? ''}`; }
function buildingHay(t) { return `${buildingName(t)} ${CODEX.buildings[t] ?? ''}`; }
function techHay(id) { return `${TECH_TEXT[id]?.label ?? id} ${TECH_TEXT[id]?.desc ?? ''} ${CODEX.tech[id] ?? ''}`; }
function recipeHay(r) {
    return [buildingName(r.machine), r.output ? itemName(r.output) : RECIPE_NAMES[r.id] ?? r.id, ...Object.keys(r.inputs).map(itemName), r.tech ? TECH_TEXT[r.tech]?.label : ''].join(' ');
}

/** One row of a tab's list: { id, name, sub, ok, chip, classified, icon: { item | building | tech } }. */
function itemRow(k) {
    if (isClassified(`item:${k}`)) return { id: `item:${k}`, name: CODEX.classified.mask, sub: CODEX.classified.name, classified: true, ok: false, chip: '' };
    const st = itemStatus(k);
    const price = SINK_VALUE[k];
    return {
        id: `item:${k}`, name: itemName(k), icon: { item: k },
        sub: RAW.has(k) ? CODEX.tags.ore : price ? `CR ${price}` : CODEX.tags.part,
        ok: st.ok, chip: st.chip, classified: false,
    };
}
function buildingRow(t) {
    if (isClassified(`building:${t}`)) return { id: `building:${t}`, name: CODEX.classified.mask, sub: CODEX.classified.name, classified: true, ok: false, chip: '' };
    const st = buildingStatus(t);
    return { id: `building:${t}`, name: buildingName(t), icon: { building: t }, sub: t === 'sink' ? '' : `CR ${MACHINE_COST[t]}`, ok: st.ok, chip: st.chip, classified: false };
}
function techRow(id) {
    const online = !!research.unlocked[id];
    return { id: `tech:${id}`, name: TECH_TEXT[id]?.label ?? id, icon: { tech: id }, sub: online ? CODEX.status.online : `${TECH_COST[id]} RP`, ok: online, chip: '', classified: false };
}

/**
 * The rows of one tab ('items' | 'buildings' | 'research'), filtered by a search query.
 * Classified entries are listed (masked) without a query and never match one.
 */
export function listRows(tab, query = '') {
    const q = words(query).length ? query : '';
    // With a query: entries whose name matches first, then the ones whose description does.
    const pick = (keys, hidden, name, hay, row) => {
        if (!q) return keys.map(row);
        const hits = keys.filter((k) => !hidden(k) && matches(hay(k), q));
        return [...hits.filter((k) => matches(name(k), q)), ...hits.filter((k) => !matches(name(k), q))].map(row);
    };
    if (tab === 'items') return pick(ITEMS, (k) => isClassified(`item:${k}`), itemName, itemHay, itemRow);
    if (tab === 'buildings') return pick(BUILDINGS, (t) => isClassified(`building:${t}`), buildingName, buildingHay, buildingRow);
    if (tab === 'research') return pick(TECHS, () => false, (id) => TECH_TEXT[id]?.label ?? id, techHay, techRow);
    return [];
}

/** The Recipes tab: every recipe as a row, filtered by a search query (ingredients, product, machine). */
export function recipeRows(query = '') {
    const q = words(query).length ? query : '';
    return ALL_RECIPES.filter((r) => !q || (!isClassified(r) && matches(recipeHay(r), q))).map(recipeView);
}

/** How many entries each tab has for a query (the tab labels show them while searching). */
export function searchCounts(query) {
    return {
        items: listRows('items', query).length,
        buildings: listRows('buildings', query).length,
        recipes: recipeRows(query).length,
        research: listRows('research', query).length,
    };
}

// ---- Pages ----------------------------------------------------------------------------------
/** An item's page: what makes it, what uses it, what the Pad pays, where the story wants it. */
export function itemPage(k) {
    const id = `item:${k}`;
    if (isClassified(id)) return { kind: 'item', id, classified: true };
    const st = itemStatus(k);
    const makers = ALL_RECIPES.filter((r) => r.output === k).map(recipeView);
    const uses = ALL_RECIPES.filter((r) => k in r.inputs).map(recipeView);
    const minedSecs = opSeconds('extractor');
    const base = SINK_VALUE[k] ?? 0;
    const phases = isInfinite() ? [] : PHASES.map((p, i) => ({ i, n: p.requires[k] ?? 0 })).filter((p) => p.n > 0).map(({ i, n }) => ({
        text: CODEX.pad.wanted(i + 1, PHASE_TEXT[i]?.title ?? '', n), current: project.phase === i, done: project.phase > i,
    }));
    const orders = isInfinite() ? INFINITE_ORDER_POOL.includes(k) : ORDER_POOL.some((pool) => pool.includes(k));
    return {
        kind: 'item', id, classified: false, name: itemName(k), desc: CODEX.items[k] ?? '', icon: { item: k },
        tag: RAW.has(k) ? CODEX.tags.ore : base ? CODEX.tags.product : CODEX.tags.part,
        status: st,
        mined: RAW.has(k) ? CODEX.notes.mined(fmtSecs(minedSecs), fmtRate(60 / minedSecs)) : null,
        makers,
        uses,
        fuel: k === 'coalOre' ? CODEX.notes.fuel(fmtSecs(GENERATOR_FUEL_TICKS / TICK_RATE), POWER_PER_GENERATOR) : null,
        research: uses.some((r) => r.machine === 'lab') ? CODEX.notes.cartridge(RESEARCH_PER_ITEM) : null,
        pad: { base, now: salePrice(k), phases, orders },
    };
}

/** The sides a building takes from and sends to, as words: "In · back, both sides  ·  Out · front". */
function portWords(type) {
    const p = portsFor(type, 'right'); // facing right: right is the front, left the back
    const say = (sides) => {
        if (sides.length === 4) return CODEX.ports.all;
        const out = [];
        if (sides.includes('right')) out.push(CODEX.ports.front);
        if (sides.includes('left')) out.push(CODEX.ports.back);
        if (sides.includes('up') && sides.includes('down')) out.push(CODEX.ports.sides);
        return out.join(', ');
    };
    return { in: p.in, out: p.out, text: CODEX.ports.text(say(p.in), say(p.out)) };
}

/** A building's page: cost, power, ports, recipes, speed per tier, when it unlocks. */
export function buildingPage(t) {
    const id = `building:${t}`;
    if (isClassified(id)) return { kind: 'building', id, classified: true };
    const notes = [];
    if (CONVEYORS.has(t)) notes.push(CODEX.notes.belt(TICK_RATE, TICK_RATE * 2));
    if (t === 'extractor') notes.push(CODEX.notes.extractor);
    if (t === 'generator') notes.push(CODEX.notes.generator(fmtSecs(GENERATOR_FUEL_TICKS / TICK_RATE), POWER_PER_GENERATOR, BASE_POWER_SUPPLY));
    if (t === 'lab') notes.push(CODEX.notes.lab(RESEARCH_PER_ITEM));
    const power = POWER_DRAW[t] ? CODEX.notes.draw(POWER_DRAW[t]) : t === 'generator' ? CODEX.notes.supply(POWER_PER_GENERATOR) : t === 'sink' ? null : CODEX.notes.noPower;
    // Speed per tier (for a recipe of time ×1), with what each upgrade costs.
    const cap = research.unlocked.tier4 ? MAX_TIER : MAX_TIER - 1;
    const tiers = UPGRADABLE.has(t) && PROCESS_TICKS[t] ? PROCESS_TICKS[t].map((_, i) => {
        const secs = opSeconds(t, i + 1);
        return { tier: i + 1, secs: fmtSecs(secs), perMin: fmtRate(60 / secs), cost: i === 0 ? MACHINE_COST[t] : UPGRADE_COST[i + 1], locked: i + 1 > cap };
    }) : null;
    const from = t === 'sink' ? null
        : isInfinite() ? (t in LICENCE_COST ? CODEX.from.licence(LICENCE_COST[t]) : CODEX.from.start)
            : unlockPhaseOf(t) < 0 ? CODEX.from.start : CODEX.from.phase(unlockPhaseOf(t) + 1, PHASE_TEXT[unlockPhaseOf(t)]?.title ?? '');
    const market = t === 'sink'
        ? Object.keys(SINK_VALUE).filter((k) => !isClassified(`item:${k}`)).map((k) => ({ item: k, base: SINK_VALUE[k], now: salePrice(k) }))
        : null;
    return {
        kind: 'building', id, classified: false, name: buildingName(t), desc: CODEX.buildings[t] ?? '', icon: { building: t },
        status: buildingStatus(t),
        cost: MACHINE_COST[t] ?? null,
        from,
        power,
        ports: t === 'belt' || t === 'sink' ? (t === 'sink' ? portWords(t) : null) : portWords(t),
        recipes: (RECIPES[t] ?? []).map((r) => recipeView({ ...r, machine: t, key: `${t}:${r.id}` })),
        tiers,
        tier4Locked: !!tiers && cap < MAX_TIER,
        notes,
        market,
    };
}

/** A research page: cost, what it does (with links), whether you have it. */
export function techPage(id) {
    const online = !!research.unlocked[id];
    const recipes = ALL_RECIPES.filter((r) => r.tech === id).map(recipeView);
    const buildings = id === 'fastBelts' ? [...CONVEYORS] : id === 'tier4' ? [...UPGRADABLE].filter((t) => !isClassified(`building:${t}`)) : [];
    return {
        kind: 'tech', id: `tech:${id}`, classified: false, name: TECH_TEXT[id]?.label ?? id, desc: CODEX.tech[id] ?? TECH_TEXT[id]?.desc ?? '',
        icon: { tech: id },
        cost: TECH_COST[id],
        status: online ? { ok: true, text: CODEX.status.online, chip: '' }
            : isBuildingUnlocked('lab') ? { ok: false, text: CODEX.status.points(research.points, TECH_COST[id]), chip: '' }
                : { ok: false, text: CODEX.status.noLab, chip: '' },
        recipes,
        buildings,
        from: CODEX.notes.researchFrom(RESEARCH_PER_ITEM),
    };
}

/** The page for any entry id, or null for an unknown one. */
export function pageFor(id) {
    const [kind, key] = String(id ?? '').split(':');
    if (kind === 'item' && allItems.has(key)) return itemPage(key);
    if (kind === 'building' && BUILDINGS.includes(key)) return buildingPage(key);
    if (kind === 'tech' && key in TECH_COST) return techPage(key);
    return null;
}

/** The codex entry for a hovered cell: the item on it, else its machine, else its ore. */
export function entryForCell(cell) {
    if (!cell) return null;
    if (cell.item) return `item:${cell.item.type}`;
    if (cell.machine) return `building:${cell.machine.type}`;
    if (cell.resource) return `item:${cell.resource}`;
    return null;
}

/**
 * Changes whenever the codex would read differently (progress, licences, research, prices),
 * so an open page can redraw itself only then.
 */
export function signature() {
    const prices = Object.keys(SINK_VALUE).map((k) => Math.round(salePrice(k) * 10)).join(',');
    return [game.mode, project.phase, game.plot, game.licences.join(','), JSON.stringify(research.unlocked), research.points, prices].join('|');
}

/** For tests: the raw ores and what the story keeps classified until the reveal. */
export const _internal = { RAW, SECRET_ITEMS, SECRET_BUILDINGS, REVEAL_PHASE };
