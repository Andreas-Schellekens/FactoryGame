import {
    GRID_WIDTH,
    GRID_HEIGHT,
    STARTING_MONEY,
    SINK_VALUE,
    MACHINE_COST,
    UPGRADE_COST,
    MAX_TIER,
    PROCESS_TICKS,
    BUFFER_CAP,
    BASE_POWER_SUPPLY,
    POWER_PER_GENERATOR,
    GENERATOR_FUEL_TICKS,
    POWER_DRAW,
    OVERLOAD_RATIO,
    OVERLOAD_TICKS,
    MARKET_SATURATION,
    MARKET_HALF_LIFE_TICKS,
    TICK_RATE,
    RESEARCH_PER_ITEM,
    TECH_COST,
    PAD_POS,
    ORE_FIELDS,
    CANNON_AREA,
    PLOTS,
    RIVER,
    INFINITE_STARTING_MONEY,
    LICENCE_COST,
    PLOT_COST,
} from './config.js';
import { PHASES, STARTING_BUILDINGS, unlockPhaseOf } from './campaign.js';

export const grid = [];
export let score = STARTING_MONEY;

/**
 * @typedef {{ id: number, type: string }} Item
 * @typedef {{ type: string, dir: 'right'|'down'|'left'|'up', tier: number, buffer: Record<string, number>, pendingOutput: string|null, progress: number, produces?: string, recipe?: string, off?: boolean }} Machine
 *   (`recipe`: the chosen recipe id for machines that have RECIPES; `off`: switched off by the player)
 * @typedef {{ machine: Machine | null, item: Item | null, resource: string | null, blocked?: boolean, river?: boolean, water?: boolean }} Cell
 *   (terrain, never saved: `blocked` = the reserved Selene construction site; `river` = part of the
 *   river bed, `water` while the river still flows there)
 * @typedef {{ x: number, y: number }} Pos
 * @typedef {{ kind: 'move', item: Item, from: Pos, to: Pos } | { kind: 'spawn', item: Item, at: Pos } | { kind: 'consume', item: Item, at: Pos, paid?: number }} FactoryEvent
 *   (`paid`: credits the Dispatch Pad paid for a delivery, at the market price)
 */

let nextItemId = 1;

// Monotonic simulation clock: advanced once per updateFactoryLogic() tick and
// never reset. Orders store their own start/deadline relative to this.
export let tickCount = 0;

// The single active order (mutated in place — a stable reference other modules
// read each frame, like `score`). `status` is the completion/failure signal.
export const order = {
    active: false,
    status: 'none',        // 'none' | 'active' | 'completed' | 'failed'
    productType: 'circuit',
    target: 0,             // products demanded
    reward: 0,             // bonus paid into score on completion
    startTick: 0,
    deadlineTick: 0,       // startTick + ticks
    delivered: 0,          // products sunk since this order started
};
const ORDER_DEFAULTS = { ...order };

// The basic product: what orders ask for, and the first assembler recipe.
export const PRODUCT_TYPE = 'circuit';

// Global power network (mutated in place, like `order` — a stable reference
// other modules read each frame). Recomputed every tick from generators and
// the demand of powered machines that want to work; never saved. `throttle`
// scales powered processors' progress, so an undersupplied factory slows
// down smoothly — until demand stays above OVERLOAD_RATIO × supply for
// OVERLOAD_TICKS: then the breaker trips (`tripped`), every powered machine
// stops, and only resetBreaker() brings the grid back. `overload` (0..1) is
// how close the countdown is to tripping.
export const power = {
    supply: BASE_POWER_SUPPLY,
    demand: 0,
    throttle: 1,
    overload: 0,
    tripped: false,
};
let overloadTicks = 0;

/** Flip the breaker back on. A grid that is still overloaded trips again within a second. */
export function resetBreaker() {
    if (!power.tripped) return false;
    power.tripped = false;
    overloadTicks = Math.max(0, OVERLOAD_TICKS - 4);
    power.overload = overloadTicks / OVERLOAD_TICKS;
    return true;
}

// The Dispatch Pad's market (mutated in place). `pressure[type]` counts recent
// sales of that item and decays every tick; it pushes the price down (see
// config.js MARKET_*). Saved, so reloading can't reset prices.
export const market = { pressure: {} };
const MARKET_DECAY = Math.pow(0.5, 1 / MARKET_HALF_LIFE_TICKS);

/** What the pad pays for one `type` right now (0 for items it only takes for the cannon). */
export function salePrice(type) {
    const base = SINK_VALUE[type] ?? 0;
    return base / (1 + (market.pressure[type] ?? 0) / MARKET_SATURATION);
}

// Running totals of items made, used up and sold, per type (never saved; the
// HUD samples them for its per-minute production overview).
export const flow = { made: {}, used: {}, sold: {} };

// Research state (mutated in place, like `order`). Labs add to `points`;
// `unlockTech` spends them on the permanent unlock flags below, which gate
// building (generator), recipes (advancedCircuit), the tier-4 upgrade cap,
// and belt speed. Persisted by serialize()/loadState().
export const research = {
    points: 0,
    unlocked: {
        fastBelts: false,
        advancedProduct: false,
        tier4: false,
    },
};

// Campaign progress (mutated in place, like `order`). `phase` indexes the
// active entry of campaign.js PHASES (== PHASES.length once the cannon is
// done); `delivered` counts the active phase's required items sunk so far.
// Buildings unlocked so far are derived from `phase`, never stored. Persisted.
export const project = {
    phase: 0,
    delivered: {},
    complete: false,
    ending: null,   // null | 'moon' | 'hq': the target chosen at the end
    company: null,  // the player's company name after the 'hq' ending
};

// Lifetime counters the story director reads to trigger tutorial steps and
// story beats ("first ingot", "first circuit"…). Persisted.
export const stats = {
    produced: {},        // items ejected by machines, per type
    delivered: {},       // items sunk at the Dispatch Pad, per type
    researchEarned: 0,   // research points ever banked by labs
};

const bump = (counter, key, n = 1) => (counter[key] = (counter[key] || 0) + n);

// The game mode (mutated in place, like `project`; persisted). 'story' plays the
// Protocol: Selene campaign. 'infinite' has no campaign and no cannon: buildings are
// licensed (`licences`) and land is bought (`plot`, an index into PLOTS) with credits,
// and every Priority Request filled raises `orderLevel`. `world` is the valley's state:
// 'valley' (the river flows; Infinite's sulfur is on the east rim) or 'aftermath' (after
// the story's reveal: dammed, the sulfur in the dry bed, the cannon on its site), so a
// finished campaign can carry on as Infinite on its own map (continueAsInfinite).
export const game = {
    mode: 'story',
    world: 'valley',
    plot: 0,
    licences: [],
    orderLevel: 0,
};
export const isInfinite = () => game.mode === 'infinite';
/** Is there a cannon (and its reserved site)? Story, and a campaign carried on as Infinite. */
export const hasCannon = () => !isInfinite() || game.world === 'aftermath';

/** The land level: which PLOTS rectangle you may build in (the campaign phase in Story). */
export function plotLevel() {
    return isInfinite() ? game.plot : project.phase;
}

/**
 * The phase the world looks like (light, decay, NIHIL's colours, the dam): the campaign
 * phase in Story; an Infinite valley stays in its first morning, the aftermath after the shot.
 */
export function visualPhase() {
    if (!isInfinite()) return project.phase;
    return game.world === 'aftermath' ? PHASES.length : 0;
}

/** Is this building type available to build (campaign phase in Story, a licence in Infinite)? */
export function isBuildingUnlocked(type) {
    if (STARTING_BUILDINGS.includes(type)) return true;
    if (isInfinite()) return game.licences.includes(type);
    for (let i = 0; i < project.phase && i < PHASES.length; i++) {
        if (PHASES[i].unlocks.includes(type)) return true;
    }
    return false;
}

/** The target chosen at the end: 'moon' or 'hq' (NIHIL's headquarters). */
export function setEnding(kind) {
    if (kind === 'moon' || kind === 'hq') project.ending = kind;
}
/** Name the player's company (after the 'hq' ending). */
export function setCompany(name) {
    project.company = String(name ?? '').trim().slice(0, 28) || null;
}

/** The active phase definition, or null once the campaign is complete (and always in Infinite). */
export function currentPhase() {
    return isInfinite() ? null : PHASES[project.phase] ?? null;
}

// Advance the campaign once every requirement of the active phase is met.
// The `phase` bump is the only completion signal — the director polls it.
function checkPhaseComplete() {
    const phase = currentPhase();
    if (!phase) return;
    for (const [type, n] of Object.entries(phase.requires)) {
        if ((project.delivered[type] || 0) < n) return;
    }
    project.phase++;
    project.delivered = {};
    if (project.phase >= PHASES.length) project.complete = true;
    applyRiver();
    revealOre();
}

// ---- Infinite: licences and land ---------------------------------------------------------
/** Can `type`'s licence be bought now: Infinite, not owned yet, every earlier phase's buildings licensed? */
export function licenceAvailable(type) {
    if (!isInfinite() || !(type in LICENCE_COST) || game.licences.includes(type)) return false;
    const p = unlockPhaseOf(type);
    for (let i = 0; i < p; i++) {
        if (!PHASES[i].unlocks.every((t) => game.licences.includes(t))) return false;
    }
    return true;
}

/** Buy a building licence (Infinite). @returns {boolean} success */
export function buyLicence(type) {
    if (!licenceAvailable(type) || score < LICENCE_COST[type]) return false;
    score -= LICENCE_COST[type];
    game.licences.push(type);
    return true;
}

/** The price of the next piece of land, or null when there is none (or in Story). */
export function nextPlotCost() {
    return isInfinite() && game.plot < PLOTS.length - 1 ? PLOT_COST[game.plot + 1] : null;
}

/** Buy the next PLOTS rectangle (Infinite). Ore that comes with it is laid at once. */
export function buyPlot() {
    const cost = nextPlotCost();
    if (cost == null || score < cost) return false;
    score -= cost;
    game.plot++;
    revealOre();
    return true;
}

/** Carry a finished campaign on as Infinite on the same map ("your own company"); keeps the factory. */
export function continueAsInfinite() {
    game.mode = 'infinite';
    game.world = 'aftermath';
    game.plot = PLOTS.length - 1;
    game.licences = Object.keys(LICENCE_COST);
    game.orderLevel = 0;
}

// The Dispatch Pad buys sellable goods and takes anything the phase needs.
function sinkAccepts(itemType) {
    return itemType in SINK_VALUE || itemType in (currentPhase()?.requires ?? {});
}

/** Spend research points on a tech node. @returns {boolean} success */
export function unlockTech(id) {
    const cost = TECH_COST[id];
    if (cost == null || research.unlocked[id] || research.points < cost) return false;
    research.points -= cost;
    research.unlocked[id] = true;
    return true;
}

/**
 * Issue a new order. Difficulty (target/ticks/reward) is chosen by the caller
 * (policy lives in main.js); grid.js only stamps the clock-relative deadline,
 * counts deliveries, and pays the reward.
 */
export function startOrder({ target, ticks, reward, productType = PRODUCT_TYPE }) {
    order.active = true;
    order.status = 'active';
    order.productType = productType;
    order.target = target;
    order.reward = reward;
    order.startTick = tickCount;
    order.deadlineTick = tickCount + ticks;
    order.delivered = 0;
}

const DIRS = {
    right: { dx: 1, dy: 0 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    up: { dx: 0, dy: -1 },
};

// The two directions perpendicular to a given one. `dir` is the primary flow
// direction for both machines (splitter output / merger input run through it).
const PERP = {
    right: ['down', 'up'],
    left: ['up', 'down'],
    up: ['right', 'left'],
    down: ['left', 'right'],
};

const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };

// Splitter: one input (the back, opposite `dir`) fans out to three outputs —
// straight ahead plus both perpendiculars.
function splitterOutputs(dir) {
    return [dir, ...PERP[dir]];
}

// Merger: three inputs (the back plus both perpendiculars) feed one output
// straight ahead along `dir`.
function mergerInputs(dir) {
    return [OPPOSITE[dir], ...PERP[dir]];
}

// Does the machine at (fx,fy) send items toward (tx,ty)? Belts/processors output
// along `dir`; a splitter outputs along its three output sides. Used as the
// merger's pull gate so it only takes items from neighbours actually aimed at it.
function outputsToward(m, fx, fy, tx, ty) {
    const wantDx = tx - fx;
    const wantDy = ty - fy;
    if (m.type === 'splitter') {
        return splitterOutputs(m.dir).some((od) => DIRS[od].dx === wantDx && DIRS[od].dy === wantDy);
    }
    const d = DIRS[m.dir];
    return d.dx === wantDx && d.dy === wantDy;
}

// Recipes, per machine type. Every machine runs ONE chosen recipe
// (`machine.recipe`, set in its menu; a new machine gets the caller's choice
// or the first unlocked one) and only accepts that recipe's inputs. `time`
// multiplies the machine's PROCESS_TICKS for slow recipes; `tech` gates a
// recipe behind research. The lab's output is null: completing it adds
// RESEARCH_PER_ITEM points instead (special-cased in the processor phase).
export const RECIPES = {
    smelter: [
        { id: 'ironIngot', inputs: { ironOre: 1 }, output: 'ironIngot' },
        { id: 'copperIngot', inputs: { copperOre: 1 }, output: 'copperIngot' },
    ],
    press: [
        { id: 'ironPlate', inputs: { ironIngot: 1 }, output: 'ironPlate' },
        { id: 'copperWire', inputs: { copperIngot: 1 }, output: 'copperWire' },
    ],
    foundry: [
        { id: 'steel', inputs: { ironIngot: 1, coalOre: 1 }, output: 'steel' },
    ],
    assembler: [
        { id: 'circuit', inputs: { ironPlate: 1, copperWire: 1 }, output: PRODUCT_TYPE },
        { id: 'capacitor', inputs: { steel: 1, copperWire: 2 }, output: 'capacitor', time: 1.5 },
        { id: 'motor', inputs: { steel: 1, ironPlate: 1, copperWire: 1 }, output: 'motor', time: 2 },
        { id: 'advancedCircuit', inputs: { circuit: 2, steel: 1 }, output: 'advancedCircuit', tech: 'advancedProduct', time: 1.5 },
        { id: 'seleneShell', inputs: { steel: 1, explosive: 1, advancedCircuit: 1 }, output: 'seleneShell', time: 4 },
    ],
    fabricator: [
        { id: 'dataCartridge', inputs: { circuit: 1, copperWire: 1 }, output: 'dataCartridge' },
    ],
    mixer: [
        { id: 'explosive', inputs: { sulfurOre: 1, coalOre: 1 }, output: 'explosive' },
    ],
    lab: [
        { id: 'research', inputs: { dataCartridge: 1 }, output: null },
    ],
};

/** Is this recipe available (its tech, if any, researched)? */
export const recipeUnlocked = (r) => !r.tech || research.unlocked[r.tech];

/** The recipe a machine is set to (null for machines without recipes). */
export function machineRecipe(m) {
    const list = RECIPES[m?.type];
    if (!list) return null;
    return list.find((r) => r.id === m.recipe) ?? list[0];
}

// Machines that absorb the item in their input slot into a buffer. The
// generator is one of them (it eats coalOre as fuel) even though it never
// runs a recipe — its burn happens in the power phase.
const PROCESSORS = new Set(['smelter', 'press', 'foundry', 'assembler', 'fabricator', 'mixer', 'generator', 'lab']);
export const UPGRADABLE = new Set(['extractor', 'smelter', 'press', 'foundry', 'assembler', 'fabricator', 'mixer', 'lab']);

function inBounds(x, y) {
    return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
}

function makeMachine(type, dir = 'right', extra = {}) {
    const m = { type, dir, tier: 1, buffer: {}, pendingOutput: null, progress: 0, ...extra };
    if (RECIPES[type] && !m.recipe) m.recipe = RECIPES[type][0].id;
    return m;
}

/** Ticks per operation at a tier (the machine's own tier by default), for its current recipe. */
function processInterval(machine, tier = machine.tier) {
    const ticks = PROCESS_TICKS[machine.type];
    if (!ticks) return 1;
    return ticks[Math.min(tier - 1, ticks.length - 1)] * (machineRecipe(machine)?.time ?? 1);
}

export function machineProgressFraction(machine) {
    const interval = processInterval(machine);
    return interval ? Math.min(1, machine.progress / interval) : 0;
}

export function initGrid() {
    for (let x = 0; x < GRID_WIDTH; x++) {
        grid[x] = [];
        for (let y = 0; y < GRID_HEIGHT; y++) {
            grid[x][y] = { machine: null, item: null, resource: null };
        }
    }

    // Ore deposits (terrain) — extractors must be placed on top of these.
    // Each field is a blob with a deterministic ragged edge, so the same map
    // comes back on every load. Fields with `fromPhase` wait for revealOre().
    // The terrain follows the current mode and progress, so set those before calling this.
    revealedFields.clear();
    for (const { x, y } of RIVER_CELLS) grid[x][y].river = true;
    applyRiver();

    // The cannon's construction site: reserved, nothing can be built there. An Infinite
    // valley has no cannon, so there it is ordinary land.
    if (hasCannon()) {
        for (let x = CANNON_AREA.x; x < CANNON_AREA.x + CANNON_AREA.w; x++) {
            for (let y = CANNON_AREA.y; y < CANNON_AREA.y + CANNON_AREA.h; y++) grid[x][y].blocked = true;
        }
    }
    revealOre();
    grid[PAD_POS.x][PAD_POS.y].resource = null;

    // The single, pre-placed sink (protected: cannot be built or removed).
    grid[PAD_POS.x][PAD_POS.y].machine = makeMachine('sink');
}

// ---- Terrain that changes with the campaign: the plot, the river -----------------------
/** The rectangle you may build in at land level `level` (phases completed, in Story). */
export function plotRect(level = plotLevel()) {
    return PLOTS[Math.min(level, PLOTS.length - 1)];
}
/** Is (x, y) inside the current plot? */
export function inPlot(x, y, level = plotLevel()) {
    const r = plotRect(level);
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

// Cells of the river bed: within halfWidth (a little ragged) of the RIVER polyline.
function distToPath(px, py) {
    let best = Infinity;
    for (let i = 0; i < RIVER.path.length - 1; i++) {
        const [ax, ay] = RIVER.path[i];
        const [bx, by] = RIVER.path[i + 1];
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
        best = Math.min(best, Math.hypot(px - (ax + vx * t), py - (ay + vy * t)));
    }
    return best;
}
const RIVER_CELLS = [];
for (let x = 0; x < GRID_WIDTH; x++) {
    for (let y = 0; y < GRID_HEIGHT; y++) {
        if (distToPath(x + 0.5, y + 0.5) <= RIVER.halfWidth + (cellHash(x, y) - 0.5) * 0.35) RIVER_CELLS.push({ x, y });
    }
}

/** Has NIHIL dammed the river: RIVER.damPhase phases complete, or an Infinite aftermath? */
export function riverDammed() {
    return isInfinite() ? game.world === 'aftermath' : project.phase >= RIVER.damPhase;
}

/** Water flows in the river bed until it is dammed. */
function applyRiver() {
    const flowing = !riverDammed();
    for (const { x, y } of RIVER_CELLS) grid[x][y].water = flowing;
}

// Ore fields laid so far (indexes into ORE_FIELDS), and a counter the renderer
// watches to add the views of a field that just appeared.
const revealedFields = new Set();
export let oreRevision = 0;

/** Is an ore field there yet: the riverbed sulfur once dammed, Infinite's own sulfur with its land. */
function fieldDue(f) {
    if (f.only === 'infinite') return isInfinite() && game.world === 'valley' && game.plot >= (f.fromPlot ?? 0);
    if (f.fromPhase != null) return isInfinite() ? game.world === 'aftermath' : project.phase >= f.fromPhase;
    return true;
}

/** Lay every ore field that is due and isn't laid yet. */
function revealOre() {
    ORE_FIELDS.forEach((f, i) => {
        if (revealedFields.has(i) || !fieldDue(f)) return;
        revealedFields.add(i);
        const r = Math.ceil(f.r + 1);
        for (let x = f.x - r; x <= f.x + r; x++) {
            for (let y = f.y - r; y <= f.y + r; y++) {
                if (!inBounds(x, y) || (x === PAD_POS.x && y === PAD_POS.y) || grid[x][y].blocked || grid[x][y].water) continue;
                const jitter = (cellHash(x, y) - 0.5) * 0.9;
                if (Math.hypot(x - f.x, y - f.y) <= f.r + jitter) grid[x][y].resource = f.type;
            }
        }
        oreRevision++;
    });
}

/** Deterministic pseudo-random value in [0, 1) for a cell (map + decor layout). */
export function cellHash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function machineCost(type) {
    return MACHINE_COST[type] ?? 0;
}

// ---- Save / load --------------------------------------------------------
// v2: campaign (project/stats) added; v1 sandbox saves are not loaded.
// v3: recipes chosen per machine, the Fabricator and Data Cartridges, the market.
// v4: the 4b production chain (press, foundry, mixer, new items and phases).
// v5: the growing plot and the river.
// v6: the game mode (`game`: Story or Infinite, licences, land, order level). v5 loads as Story.
export const SAVE_VERSION = 6;
const LOADABLE = new Set([5, 6]);
/** Can loadState() read this save (a version this build knows)? */
export const isLoadableSave = (data) => !!data && LOADABLE.has(data.version);

/**
 * Snapshot the simulation as a plain, JSON-serializable object. Terrain
 * (ore nodes, pre-placed sink) is recreated by initGrid() on load, so only
 * machines, in-transit items, and the economy/order clock are stored. Machine
 * objects are already plain data, so they serialize as-is.
 */
export function serialize() {
    const cells = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            if (!cell.machine && !cell.item) continue;
            const entry = { x, y };
            if (cell.machine) entry.machine = cell.machine;
            if (cell.item) entry.item = { type: cell.item.type }; // id is reassigned on load
            cells.push(entry);
        }
    }
    return {
        version: SAVE_VERSION,
        score,
        tickCount,
        order: { ...order },
        research: { points: research.points, unlocked: { ...research.unlocked } },
        project: { phase: project.phase, delivered: { ...project.delivered }, complete: project.complete, ending: project.ending, company: project.company },
        game: { ...game, licences: [...game.licences] },
        stats: structuredClone(stats),
        market: { pressure: { ...market.pressure } },
        cells,
    };
}

/**
 * Rebuild the simulation from a serialize() snapshot. Returns spawn events for
 * the renderer to recreate sprites for in-transit items — and ONLY those:
 * buffer contents and pendingOutput have no sprite, so they are never spawned.
 * Returns null (a no-op for the caller) if the data is missing or the wrong
 * version. The renderer's existing sprites must be cleared by the caller first.
 * @returns {FactoryEvent[] | null}
 */
export function loadState(data) {
    if (!data || !LOADABLE.has(data.version)) return null;

    // The mode and the campaign come first: they decide the terrain (cannon site, river, ore).
    const infinite = data.game?.mode === 'infinite';
    game.mode = infinite ? 'infinite' : 'story';
    game.world = data.game?.world === 'aftermath' ? 'aftermath' : 'valley';
    game.plot = Math.max(0, Math.min(PLOTS.length - 1, Math.floor(data.game?.plot ?? 0)));
    game.licences = (data.game?.licences ?? []).filter((t) => t in LICENCE_COST);
    game.orderLevel = Math.max(0, Math.floor(data.game?.orderLevel ?? 0));
    project.phase = data.project?.phase ?? 0;
    project.delivered = { ...(data.project?.delivered ?? {}) };
    project.complete = data.project?.complete ?? false;
    project.ending = data.project?.ending ?? null;
    project.company = data.project?.company ?? null;

    initGrid(); // reset to empty cells + ore terrain + the pre-placed sink

    /** @type {FactoryEvent[]} */
    const events = [];
    for (const entry of data.cells ?? []) {
        const { x, y } = entry;
        if (!inBounds(x, y)) continue;
        const cell = grid[x][y];
        if (cell.blocked) continue; // reserved site (a save from before it existed)
        if (entry.machine && cell.water) continue; // under water
        if (entry.machine) {
            // Overlay saved fields onto fresh defaults so a save missing a newer
            // field (e.g. toggle) still loads cleanly.
            cell.machine = { ...makeMachine(entry.machine.type, entry.machine.dir), ...entry.machine };
            if (RECIPES[cell.machine.type] && !RECIPES[cell.machine.type].some((r) => r.id === cell.machine.recipe)) {
                cell.machine.recipe = RECIPES[cell.machine.type][0].id; // a recipe that no longer exists
            }
        }
        if (entry.item) {
            const item = { id: nextItemId++, type: entry.item.type };
            cell.item = item;
            events.push({ kind: 'spawn', item, at: { x, y } });
        }
    }

    score = typeof data.score === 'number' ? data.score : infinite ? INFINITE_STARTING_MONEY : STARTING_MONEY;
    tickCount = typeof data.tickCount === 'number' ? data.tickCount : 0;
    Object.assign(order, ORDER_DEFAULTS, data.order ?? {});

    // Reset research to defaults, then overlay — pre-research saves load locked.
    research.points = data.research?.points ?? 0;
    for (const k in research.unlocked) research.unlocked[k] = data.research?.unlocked?.[k] ?? false;

    stats.produced = { ...(data.stats?.produced ?? {}) };
    stats.delivered = { ...(data.stats?.delivered ?? {}) };
    stats.researchEarned = data.stats?.researchEarned ?? 0;
    market.pressure = { ...(data.market?.pressure ?? {}) };
    power.tripped = false;
    overloadTicks = 0;

    return events;
}

/**
 * Start a fresh game: Story (the campaign) or Infinite. Everything is reset, the
 * terrain laid for the mode, and the starting credits paid. @returns {FactoryEvent[]}
 */
export function newGame(mode = 'story', { world = 'valley' } = {}) {
    return loadState({ version: SAVE_VERSION, game: { mode, world }, cells: [] });
}

export function canBuildMachine(x, y, type) {
    if (!inBounds(x, y)) return false;
    if (!(type in MACHINE_COST)) return false;
    const cell = grid[x][y];
    if (cell.machine !== null || cell.blocked || cell.water || !inPlot(x, y)) return false;
    if (type === 'extractor' && cell.resource === null) return false; // needs an ore node
    if (!isBuildingUnlocked(type)) return false; // campaign-gated
    return score >= MACHINE_COST[type];
}

export function buildMachine(x, y, type, dir = 'right', recipe = null) {
    if (!canBuildMachine(x, y, type)) return false;
    const cell = grid[x][y];
    score -= MACHINE_COST[type];
    const extra = type === 'extractor' ? { produces: cell.resource }
        : (type === 'splitter' || type === 'merger') ? { toggle: 0 }
        : type === 'generator' ? { fuelTicks: 0 }
        : {};
    const r = RECIPES[type]?.find((q) => q.id === recipe && recipeUnlocked(q))
        ?? RECIPES[type]?.find(recipeUnlocked);
    if (r) extra.recipe = r.id;
    cell.machine = makeMachine(type, dir, extra);
    return true;
}

/**
 * Switch a machine to another of its recipes. Buffered inputs the new recipe
 * doesn't use are scrapped and the operation in progress restarts; a finished
 * product waiting to leave still leaves. @returns {boolean} changed
 */
export function setRecipe(x, y, id) {
    const m = inBounds(x, y) ? grid[x][y].machine : null;
    const r = RECIPES[m?.type]?.find((q) => q.id === id);
    if (!r || !recipeUnlocked(r) || m.recipe === id) return false;
    m.recipe = id;
    for (const k of Object.keys(m.buffer)) if (!(k in r.inputs)) delete m.buffer[k];
    m.progress = 0;
    return true;
}

/** Switch a machine on or off (off: no work, no power draw; it still takes deliveries until full). */
export function setMachineOn(x, y, on) {
    const m = inBounds(x, y) ? grid[x][y].machine : null;
    if (!m || m.type === 'sink' || m.type === 'belt') return false;
    if (on) delete m.off;
    else m.off = true;
    return true;
}

/**
 * Cardinal direction for a single orthogonal step from `from` to `to`.
 * Returns null for diagonals, jumps, or no movement — also serves as the
 * "is this an orthogonal unit step?" gate for drag-laying.
 * @param {Pos} from @param {Pos} to
 */
export function dirBetween(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 1 && dy === 0) return 'right';
    if (dx === -1 && dy === 0) return 'left';
    if (dx === 0 && dy === 1) return 'down';
    if (dx === 0 && dy === -1) return 'up';
    return null;
}

/**
 * Lay a single belt cell while drag-building. Encapsulates the
 * build-or-reorient decision and the economy gate so callers never mutate a
 * cell directly.
 * @returns {'built'|'oriented'|'blocked'|'unaffordable'|'offgrid'}
 */
export function placeBelt(x, y, dir) {
    if (!inBounds(x, y)) return 'offgrid';
    const cell = grid[x][y];
    if (cell.machine?.type === 'belt') {
        cell.machine.dir = dir; // re-orient in place (free) to follow the drag
        return 'oriented';
    }
    if (cell.machine || cell.blocked || cell.water || !inPlot(x, y)) return 'blocked'; // machine, reserved site, river, outside the plot
    if (score < MACHINE_COST.belt) return 'unaffordable';
    buildMachine(x, y, 'belt', dir); // builds + charges (already known affordable/empty)
    return 'built';
}

/**
 * Remove a machine and refund its placement cost (upgrades are not refunded),
 * so a bad layout can always be sold back — the economy can't soft-lock.
 * @returns {FactoryEvent[]} events for any item destroyed with the machine
 */
export function removeMachine(x, y) {
    const events = [];
    if (!inBounds(x, y)) return events;
    const cell = grid[x][y];
    if (cell.machine === null || cell.machine.type === 'sink') return events; // sink protected
    if (cell.item) {
        events.push({ kind: 'consume', item: cell.item, at: { x, y } });
        cell.item = null;
    }
    score += MACHINE_COST[cell.machine.type] ?? 0;
    cell.machine = null;
    return events;
}

// ---- Groups: move, copy or remove many machines at once ---------------------------------
const TURNS = ['right', 'down', 'left', 'up'];
const turnDir = (dir, rot) => TURNS[(TURNS.indexOf(dir) + rot) % 4];

/** The machines inside a rectangle (corners inclusive, any order) that can be picked up: all but the pad. */
export function machinesIn(x0, y0, x1, y1) {
    const out = [];
    for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(GRID_WIDTH - 1, Math.max(x0, x1)); x++) {
        for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(GRID_HEIGHT - 1, Math.max(y0, y1)); y++) {
            const m = grid[x][y].machine;
            if (m && m.type !== 'sink') out.push({ x, y });
        }
    }
    return out;
}

/**
 * Where a group lands when the cell `anchor` is put down at `to`, turned `rot`
 * quarter turns clockwise. mode 'move' may land on its own old cells; 'copy'
 * needs empty cells, unlocked buildings and the credits.
 * @returns {{ moves: { from: Pos, to: Pos, type: string, dir: string }[], bad: Pos[], cost: number, ok: boolean }}
 */
export function planGroup(cells, anchor, to, rot = 0, mode = 'move') {
    const own = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const moves = [];
    const bad = [];
    let cost = 0;
    for (const { x, y } of cells) {
        const m = grid[x]?.[y]?.machine;
        if (!m) continue;
        let rx = x - anchor.x;
        let ry = y - anchor.y;
        for (let i = 0; i < rot; i++) [rx, ry] = [-ry, rx];
        const t = { x: to.x + rx, y: to.y + ry };
        moves.push({ from: { x, y }, to: t, type: m.type, dir: turnDir(m.dir, rot), recipe: m.recipe, off: !!m.off });
        if (mode === 'copy') cost += MACHINE_COST[m.type] ?? 0;
        const c = inBounds(t.x, t.y) ? grid[t.x][t.y] : null;
        const free = c && (!c.machine || (mode === 'move' && own.has(`${t.x},${t.y}`)));
        const fits = c && free && !c.blocked && !c.water && inPlot(t.x, t.y)
            && (m.type !== 'extractor' || c.resource)
            && (mode !== 'copy' || isBuildingUnlocked(m.type));
        if (!fits) bad.push(t);
    }
    return { moves, bad, cost, ok: moves.length > 0 && bad.length === 0 && (mode !== 'copy' || score >= cost) };
}

/**
 * Carry out a planGroup() plan. 'move' lifts every machine (with its buffer,
 * tier and the item on it) and sets it down turned; 'copy' builds fresh tier-1
 * copies (same recipe, direction and on/off) and pays for them.
 * @returns {FactoryEvent[] | null} item moves for the renderer, or null if the plan doesn't fit
 */
export function applyGroup(plan, mode = 'move') {
    if (!plan?.ok) return null;
    const events = [];
    if (mode === 'copy') {
        score -= plan.cost;
        for (const mv of plan.moves) {
            const cell = grid[mv.to.x][mv.to.y];
            const extra = mv.type === 'extractor' ? { produces: cell.resource }
                : (mv.type === 'splitter' || mv.type === 'merger') ? { toggle: 0 }
                : mv.type === 'generator' ? { fuelTicks: 0 }
                : {};
            if (mv.recipe) extra.recipe = mv.recipe;
            if (mv.off) extra.off = true;
            cell.machine = makeMachine(mv.type, mv.dir, extra);
        }
        return events;
    }
    const lifted = plan.moves.map((mv) => {
        const cell = grid[mv.from.x][mv.from.y];
        const carried = { machine: cell.machine, item: cell.item };
        cell.machine = null;
        cell.item = null;
        return carried;
    });
    plan.moves.forEach((mv, i) => {
        const cell = grid[mv.to.x][mv.to.y];
        const { machine, item } = lifted[i];
        machine.dir = mv.dir;
        if (machine.type === 'extractor') machine.produces = cell.resource;
        cell.machine = machine;
        if (item) {
            cell.item = item;
            events.push({ kind: 'move', item, from: mv.from, to: mv.to });
        }
    });
    return events;
}

/**
 * Plan a stored machine list (a blueprint: `[{ x, y, type, dir, recipe?, off? }]`, from
 * blueprints.js) as a copy: the entry at `anchor` lands on `to`, turned `rot` quarter turns
 * clockwise. The same plan shape as planGroup()'s 'copy', so applyGroup(plan, 'copy') builds
 * it. A blueprint has no source cell on the map: each move's `from` is its landing cell.
 * Unknown building types and recipes don't fit (a file from another version).
 */
export function planStored(machines, anchor, to, rot = 0) {
    const moves = [];
    const bad = [];
    const seen = new Set();
    let cost = 0;
    for (const m of machines) {
        let rx = m.x - anchor.x;
        let ry = m.y - anchor.y;
        for (let i = 0; i < rot; i++) [rx, ry] = [-ry, rx];
        const t = { x: to.x + rx, y: to.y + ry };
        const known = m.type in MACHINE_COST && m.type !== 'sink' && TURNS.includes(m.dir)
            && (m.recipe == null || RECIPES[m.type]?.some((r) => r.id === m.recipe));
        moves.push({ from: t, to: t, type: m.type, dir: known ? turnDir(m.dir, rot) : 'right', recipe: m.recipe ?? undefined, off: !!m.off });
        cost += MACHINE_COST[m.type] ?? 0;
        const c = inBounds(t.x, t.y) ? grid[t.x][t.y] : null;
        const fits = known && c && !c.machine && !c.blocked && !c.water && inPlot(t.x, t.y)
            && (m.type !== 'extractor' || c.resource) && isBuildingUnlocked(m.type) && !seen.has(`${t.x},${t.y}`);
        seen.add(`${t.x},${t.y}`);
        if (!fits) bad.push(t);
    }
    return { moves, bad, cost, ok: moves.length > 0 && bad.length === 0 && score >= cost };
}

/** Demolish every machine in `cells` (refunds, like removeMachine). @returns {FactoryEvent[]} */
export function removeGroup(cells) {
    return cells.flatMap(({ x, y }) => removeMachine(x, y));
}

export function upgradeCost(x, y) {
    const m = inBounds(x, y) ? grid[x][y].machine : null;
    // The top tier is research-gated: capped at MAX_TIER - 1 until `tier4`.
    const tierCap = research.unlocked.tier4 ? MAX_TIER : MAX_TIER - 1;
    if (!m || !UPGRADABLE.has(m.type) || m.tier >= tierCap) return null;
    return UPGRADE_COST[m.tier + 1];
}

export function canUpgrade(x, y) {
    const cost = upgradeCost(x, y);
    return cost !== null && score >= cost;
}

export function upgradeMachine(x, y) {
    if (!canUpgrade(x, y)) return false;
    const m = grid[x][y].machine;
    score -= UPGRADE_COST[m.tier + 1];
    m.tier += 1;
    return true;
}

// Can the given cell receive an item of `itemType` right now?
function cellAccepts(cell, itemType) {
    const m = cell.machine;
    if (!m || cell.item !== null) return false;
    switch (m.type) {
        case 'belt':
        case 'splitter':
            return true; // accept any item into the free slot, like a belt
        case 'merger':
            return false; // pull-only: items enter via the merger's own pull
        case 'sink':
            return sinkAccepts(itemType);
        case 'smelter':
        case 'press':
        case 'foundry':
        case 'assembler':
        case 'fabricator':
        case 'mixer':
        case 'lab': {
            const r = machineRecipe(m);
            return !!r && recipeUnlocked(r) && itemType in r.inputs && (m.buffer[itemType] || 0) < BUFFER_CAP;
        }
        case 'generator':
            return itemType === 'coalOre' && (m.buffer.coalOre || 0) < BUFFER_CAP;
        default:
            return false;
    }
}

// The machine's recipe if its buffer holds everything for one operation, else null.
function recipeFor(machine) {
    const r = machineRecipe(machine);
    if (!r || !recipeUnlocked(r)) return null;
    for (const k in r.inputs) if ((machine.buffer[k] || 0) < r.inputs[k]) return null;
    return r;
}

// ---- Ports: where items go in and out ---------------------------------------------
// Read-only queries for the renderer's port markers and the inspector; they
// mirror the transfer rules above. Processors and the pad accept from any
// side (their front is their output, so in practice: back and sides), they
// only ever send out the front; splitters take from the back and send out
// three ways; mergers pull from back and sides, only from neighbours aimed at
// them. Belts show their own direction and have no ports.
const ALL_SIDES = ['right', 'down', 'left', 'up'];
const NO_OUTPUT = new Set(['generator', 'lab', 'sink']);

/** The sides a machine of `type` facing `dir` takes items in from and sends them out to. */
export function portsFor(type, dir) {
    switch (type) {
        case 'extractor': return { in: [], out: [dir] };
        case 'smelter':
        case 'press':
        case 'foundry':
        case 'assembler':
        case 'fabricator':
        case 'mixer': return { in: [OPPOSITE[dir], ...PERP[dir]], out: [dir] };
        case 'generator':
        case 'lab':
        case 'sink': return { in: ALL_SIDES, out: [] };
        case 'splitter': return { in: [OPPOSITE[dir]], out: splitterOutputs(dir) };
        case 'merger': return { in: mergerInputs(dir), out: [dir] };
        default: return { in: [], out: [] };
    }
}

// Would an item sent out of (x,y) on `side` find a taker next door?
function sideFeeds(x, y, side) {
    const { dx, dy } = DIRS[side];
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) return false;
    const n = grid[nx][ny].machine;
    if (!n) return false;
    const from = OPPOSITE[side]; // the neighbour's side that faces us
    switch (n.type) {
        case 'belt':
        case 'splitter': return n.dir !== from; // anything but pointing straight back at us
        case 'merger': return mergerInputs(n.dir).includes(from);
        case 'extractor': return false;
        default: return true; // processors and the pad take items from any side
    }
}

// Does the neighbour on `side` of (x,y) send items into (x,y)?
function sideFedFrom(x, y, side) {
    const { dx, dy } = DIRS[side];
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) return false;
    const n = grid[nx][ny].machine;
    if (!n || NO_OUTPUT.has(n.type)) return false;
    return outputsToward(n, nx, ny, x, y);
}

/**
 * The ports of the machine at (x,y), or of a machine of `type`/`dir` that
 * would be placed there (build preview): [{ side, kind: 'in'|'out',
 * connected, blocked }]. `blocked`: a finished product is stuck in it.
 */
export function machinePorts(x, y, type = null, dir = null) {
    const m = grid[x]?.[y]?.machine;
    const t = type ?? m?.type;
    if (!t) return [];
    const d = dir ?? m.dir;
    const p = portsFor(t, d);
    const stuck = !type && !!m?.pendingOutput;
    const ports = [];
    for (const side of p.out) ports.push({ side, kind: 'out', connected: sideFeeds(x, y, side), blocked: stuck && side === d });
    for (const side of p.in) ports.push({ side, kind: 'in', connected: sideFedFrom(x, y, side), blocked: false });
    return ports;
}

/**
 * What a machine takes in and makes (item types), for the inspector: the
 * chosen recipe of a placed machine (pass the machine), or everything a
 * machine type can make (pass the type).
 */
export function machineIO(machineOrType) {
    const m = typeof machineOrType === 'string' ? null : machineOrType;
    const type = m ? m.type : machineOrType;
    if (RECIPES[type]) {
        const rs = m ? [machineRecipe(m)] : RECIPES[type];
        return { takes: [...new Set(rs.flatMap((r) => Object.keys(r.inputs)))], makes: rs.map((r) => r.output).filter(Boolean) };
    }
    switch (type) {
        case 'generator': return { takes: ['coalOre'], makes: [] };
        case 'sink': return { takes: [...new Set([...Object.keys(SINK_VALUE), ...Object.keys(currentPhase()?.requires ?? {})])], makes: [] };
        default: return { takes: [], makes: [] };
    }
}

const perMinute = (ticks) => (60 * TICK_RATE) / ticks;

/**
 * Why a machine is (not) working, for its menu and the status icons:
 * 'off' | 'tripped' (breaker) | 'blocked' (product can't leave) | 'fuel'
 * (generator without coal) | 'input' (waiting; `missing` lists what) |
 * 'locked' (recipe needs research) | 'slow' (brownout) | 'working' | 'idle'.
 */
export function machineStatus(x, y) {
    const m = inBounds(x, y) ? grid[x][y].machine : null;
    if (!m) return { code: 'idle' };
    if (m.off) return { code: 'off' };
    if (m.type === 'extractor') return m.progress >= processInterval(m) ? { code: 'blocked' } : { code: 'working' };
    if (m.type === 'generator') return m.fuelTicks > 0 ? { code: power.tripped ? 'tripped' : 'working' } : { code: 'fuel' };
    if (!RECIPES[m.type]) return { code: 'idle' };
    if (m.pendingOutput) return { code: 'blocked' };
    const r = machineRecipe(m);
    if (!recipeUnlocked(r)) return { code: 'locked' };
    const missing = Object.keys(r.inputs).filter((k) => (m.buffer[k] || 0) < r.inputs[k]);
    if (missing.length && m.progress <= 0) return { code: 'input', missing };
    if (POWER_DRAW[m.type] && power.tripped) return { code: 'tripped' };
    if (POWER_DRAW[m.type] && power.throttle < 0.999) return { code: 'slow' };
    return { code: 'working' };
}

/**
 * Throughput of a machine per minute of sim time, at its tier and at full
 * power: { inPerMin, outPerMin, points?, kw, next } — `next` is the same for
 * the next tier (null at the cap or for machines without tiers). `kw` is its
 * draw (negative = supply).
 */
export function machineRates(x, y) {
    const m = inBounds(x, y) ? grid[x][y].machine : null;
    if (!m) return null;
    const at = (tier) => {
        const per = perMinute(processInterval(m, tier));
        if (m.type === 'extractor') return { inPerMin: {}, outPerMin: m.produces ? { [m.produces]: per } : {} };
        const r = machineRecipe(m);
        if (!r) return null;
        const inPerMin = Object.fromEntries(Object.entries(r.inputs).map(([k, n]) => [k, n * per]));
        return r.output
            ? { inPerMin, outPerMin: { [r.output]: per } }
            : { inPerMin, outPerMin: {}, points: RESEARCH_PER_ITEM * per };
    };
    if (m.type === 'generator') {
        return { inPerMin: { coalOre: perMinute(GENERATOR_FUEL_TICKS) }, outPerMin: {}, kw: -POWER_PER_GENERATOR, next: null };
    }
    const now = at(m.tier);
    if (!now) return null;
    const cap = research.unlocked.tier4 ? MAX_TIER : MAX_TIER - 1;
    return { ...now, kw: POWER_DRAW[m.type] ?? 0, next: UPGRADABLE.has(m.type) && m.tier < cap ? at(m.tier + 1) : null };
}

// Try to push a freshly produced item into the cell this machine points at.
function tryEject(machine, x, y, type, events) {
    const d = DIRS[machine.dir];
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (!inBounds(nx, ny)) return false;
    const target = grid[nx][ny];
    if (!cellAccepts(target, type)) return false;
    const item = { id: nextItemId++, type };
    target.item = item;
    events.push({ kind: 'spawn', item, at: { x: nx, y: ny } });
    return true;
}

export function updateFactoryLogic() {
    /** @type {FactoryEvent[]} */
    const events = [];

    tickCount++;

    // 1) Sinks (Dispatch Pads) consume deliveries, pay out, and credit the
    // active order and the active campaign phase. cellAccepts already limited
    // what could arrive here, so anything sitting on a pad is consumed.
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            if (cell.machine?.type === 'sink' && cell.item) {
                const type = cell.item.type;
                const paid = salePrice(type);
                events.push({ kind: 'consume', item: cell.item, at: { x, y }, paid });
                if (order.active && type === order.productType) order.delivered++;
                if (currentPhase()?.requires[type]) bump(project.delivered, type);
                bump(stats.delivered, type);
                bump(flow.sold, type);
                score += paid;
                if (SINK_VALUE[type]) bump(market.pressure, type);
                cell.item = null;
            }
        }
    }
    checkPhaseComplete();
    for (const k in market.pressure) {
        market.pressure[k] *= MARKET_DECAY;
        if (market.pressure[k] < 0.01) delete market.pressure[k];
    }

    // Resolve the order the same tick its final product is sunk: complete (and
    // pay the bonus) on reaching the target, else fail when the deadline passes.
    // The status flip is the only completion/failure signal — the HUD polls it.
    if (order.active) {
        if (order.delivered >= order.target) {
            score += order.reward;
            order.active = false;
            order.status = 'completed';
            if (isInfinite()) game.orderLevel++;
        } else if (tickCount >= order.deadlineTick) {
            order.active = false;
            order.status = 'failed';
        }
    }

    // 2) Processors absorb the item sitting in their input slot into their buffer.
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            const m = cell.machine;
            if (m && PROCESSORS.has(m.type) && cell.item) {
                m.buffer[cell.item.type] = (m.buffer[cell.item.type] || 0) + 1;
                events.push({ kind: 'consume', item: cell.item, at: { x, y } });
                cell.item = null;
            }
        }
    }

    // 3) Movers relocate items (reverse scan to limit multi-cell chaining).
    // Belts, splitters and mergers all move (never transform) items, so they
    // share this phase and the belt's single-hop / back-pressure semantics.
    // With the fastBelts tech the whole phase runs twice, so items travel up
    // to two cells per tick (the renderer chains the two move events).
    const moverPasses = research.unlocked.fastBelts ? 2 : 1;
    for (let pass = 0; pass < moverPasses; pass++)
    for (let x = GRID_WIDTH - 1; x >= 0; x--) {
        for (let y = GRID_HEIGHT - 1; y >= 0; y--) {
            const cell = grid[x][y];
            const m = cell.machine;
            if (!m) continue;

            // Belt: push the item one cell along `dir`.
            if (m.type === 'belt') {
                if (cell.item === null) continue;
                const d = DIRS[m.dir];
                const nx = x + d.dx;
                const ny = y + d.dy;
                if (!inBounds(nx, ny)) continue;
                const target = grid[nx][ny];
                if (cellAccepts(target, cell.item.type)) {
                    const item = cell.item;
                    target.item = item;
                    cell.item = null;
                    events.push({ kind: 'move', item, from: { x, y }, to: { x: nx, y: ny } });
                }
                continue;
            }

            // Splitter: push the item to one of its three outputs (straight
            // ahead + both perpendiculars), round-robin. `toggle` is the side to
            // try first and advances past the side actually used on every
            // successful push, so a blocked side can't permanently skew the
            // balance.
            if (m.type === 'splitter') {
                if (cell.item === null) continue;
                const outs = splitterOutputs(m.dir);
                for (let i = 0; i < outs.length; i++) {
                    const od = outs[(m.toggle + i) % outs.length];
                    const d = DIRS[od];
                    const nx = x + d.dx;
                    const ny = y + d.dy;
                    if (!inBounds(nx, ny)) continue;
                    const target = grid[nx][ny];
                    if (cellAccepts(target, cell.item.type)) {
                        const item = cell.item;
                        target.item = item;
                        cell.item = null;
                        events.push({ kind: 'move', item, from: { x, y }, to: { x: nx, y: ny } });
                        m.toggle = (m.toggle + i + 1) % outs.length;
                        break;
                    }
                }
                continue;
            }

            // Merger: push its held item forward along `dir`, then pull a new one
            // from one of its three inputs (the back + both perpendiculars),
            // round-robin with the same toggle rule as the splitter. It only
            // pulls from a neighbour aimed at it, and only takes over the move
            // itself (cellAccepts is false), so no item double-moves.
            if (m.type === 'merger') {
                if (cell.item) {
                    const d = DIRS[m.dir];
                    const nx = x + d.dx;
                    const ny = y + d.dy;
                    if (inBounds(nx, ny) && cellAccepts(grid[nx][ny], cell.item.type)) {
                        const item = cell.item;
                        grid[nx][ny].item = item;
                        cell.item = null;
                        events.push({ kind: 'move', item, from: { x, y }, to: { x: nx, y: ny } });
                    }
                }
                if (cell.item === null) {
                    const ins = mergerInputs(m.dir);
                    for (let i = 0; i < ins.length; i++) {
                        const sd = ins[(m.toggle + i) % ins.length];
                        const d = DIRS[sd];
                        const sx = x + d.dx;
                        const sy = y + d.dy;
                        if (!inBounds(sx, sy)) continue;
                        const src = grid[sx][sy];
                        if (!src.item || !src.machine) continue;
                        if (!outputsToward(src.machine, sx, sy, x, y)) continue;
                        const item = src.item;
                        cell.item = item;
                        src.item = null;
                        events.push({ kind: 'move', item, from: { x: sx, y: sy }, to: { x, y } });
                        m.toggle = (m.toggle + i + 1) % ins.length;
                        break;
                    }
                }
                continue;
            }
        }
    }

    // 3.5) Power network. Generators burn buffered coal for supply; every
    // powered machine that wants to work adds its draw to demand. The ratio
    // becomes this tick's throttle for phase 4. Computed after movers so
    // freshly delivered coal counts the tick it arrives in the buffer.
    // While the breaker is tripped, generators idle (no burn) but still count
    // as available supply, and demand is what would run on a reset, so the
    // HUD can show whether a reset will hold.
    power.supply = BASE_POWER_SUPPLY;
    power.demand = 0;
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            if (!m || m.off) continue;
            if (m.type === 'generator') {
                if (power.tripped) {
                    if (m.fuelTicks > 0 || (m.buffer.coalOre || 0) > 0) power.supply += POWER_PER_GENERATOR;
                    continue;
                }
                if (m.fuelTicks <= 0 && (m.buffer.coalOre || 0) > 0) {
                    m.buffer.coalOre--;
                    m.fuelTicks = GENERATOR_FUEL_TICKS;
                    bump(flow.used, 'coalOre');
                }
                if (m.fuelTicks > 0) {
                    m.fuelTicks--;
                    power.supply += POWER_PER_GENERATOR;
                }
            } else if (POWER_DRAW[m.type] && !m.pendingOutput && recipeFor(m)) {
                power.demand += POWER_DRAW[m.type];
            }
        }
    }
    if (!power.tripped) {
        if (power.demand > power.supply * OVERLOAD_RATIO) overloadTicks++;
        else overloadTicks = Math.max(0, overloadTicks - 2);
        if (overloadTicks >= OVERLOAD_TICKS) {
            power.tripped = true;
            overloadTicks = 0;
        }
    }
    power.overload = power.tripped ? 1 : overloadTicks / OVERLOAD_TICKS;
    power.throttle = power.tripped ? 0 : power.demand > 0 ? Math.min(1, power.supply / power.demand) : 1;

    // 4) Processors run their recipe over time, then eject the result.
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            const m = cell.machine;
            if (!m || !PROCESSORS.has(m.type)) continue;

            if (m.pendingOutput) {
                if (tryEject(m, x, y, m.pendingOutput, events)) m.pendingOutput = null;
                else continue; // output is blocked; stall until it can leave
            }
            if (m.off) continue;

            const recipe = recipeFor(m);
            if (!recipe) {
                m.progress = 0;
                continue;
            }
            // Powered machines advance by the network throttle (progress may
            // be fractional); unpowered processors run at full speed.
            m.progress += POWER_DRAW[m.type] ? power.throttle : 1;
            if (m.progress >= processInterval(m)) {
                for (const k in recipe.inputs) {
                    m.buffer[k] -= recipe.inputs[k];
                    bump(flow.used, k, recipe.inputs[k]);
                }
                m.progress = 0;
                if (recipe.output === null) {
                    // Lab: the "product" is research points, not an item.
                    research.points += RESEARCH_PER_ITEM;
                    stats.researchEarned += RESEARCH_PER_ITEM;
                } else {
                    // Counted when crafted, even if the output is still blocked.
                    bump(stats.produced, recipe.output);
                    bump(flow.made, recipe.output);
                    m.pendingOutput = recipe.output;
                    if (tryEject(m, x, y, m.pendingOutput, events)) m.pendingOutput = null;
                }
            }
        }
    }

    // 5) Extractors mine the ore node beneath them.
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            const m = cell.machine;
            if (m?.type !== 'extractor' || !m.produces || m.off) continue;
            m.progress++;
            if (m.progress >= processInterval(m)) {
                if (tryEject(m, x, y, m.produces, events)) {
                    m.progress = 0;
                    bump(stats.produced, m.produces);
                    bump(flow.made, m.produces);
                } else {
                    m.progress = processInterval(m); // output blocked; hold at full
                }
            }
        }
    }

    return events;
}

// ---- Undo / redo support (undo.js keeps the history; these two are its only way in) -----
/** What undo puts back of a machine: type, direction, tier, recipe and on/off. Never its contents. */
export function machineSpec(m) {
    if (!m) return null;
    const s = { type: m.type, dir: m.dir, tier: m.tier };
    if (m.recipe) s.recipe = m.recipe;
    if (m.off) s.off = true;
    return s;
}

/**
 * Undo/redo's primitive: rewrite some cells and move `credits` (positive: paid to the player) in
 * one go, with no checks of its own (undo.js checks the cells and the credits first). Each change
 * is { x, y, spec, carry }: `spec` null clears the cell; `carry` is a machine standing on one of
 * these cells, set down here (turned to `spec`) with the item on it; otherwise a fresh machine is
 * built from `spec`, with an empty buffer. Items on machines that are gone are consumed. The
 * Dispatch Pad is never touched.
 * @returns {{ events: FactoryEvent[], placed: (Machine|null)[] }} item events, and the machine set down per change
 */
export function rewriteCells(changes, credits = 0) {
    const events = [];
    const ok = (c) => inBounds(c.x, c.y) && grid[c.x][c.y].machine?.type !== 'sink';
    const lifted = new Map(); // machine → { item, at }
    for (const c of changes) {
        if (!ok(c)) continue;
        const cell = grid[c.x][c.y];
        if (cell.machine) lifted.set(cell.machine, { item: cell.item, at: { x: c.x, y: c.y } });
        else if (cell.item) events.push({ kind: 'consume', item: cell.item, at: { x: c.x, y: c.y } });
        cell.machine = null;
        cell.item = null;
    }
    const placed = changes.map((c) => {
        if (!ok(c) || !c.spec) return null;
        const cell = grid[c.x][c.y];
        const s = c.spec;
        const was = c.carry ? lifted.get(c.carry) : null;
        let m;
        if (was) {
            lifted.delete(c.carry);
            m = c.carry;
            m.dir = s.dir;
            m.tier = s.tier;
            if (s.recipe && m.recipe !== s.recipe) {
                // Like setRecipe: inputs the recipe doesn't use are scrapped, the operation restarts.
                const r = RECIPES[m.type]?.find((q) => q.id === s.recipe);
                if (r) for (const k of Object.keys(m.buffer)) if (!(k in r.inputs)) delete m.buffer[k];
                m.recipe = s.recipe;
                m.progress = 0;
            }
            if (s.off) m.off = true;
            else delete m.off;
            if (was.item) {
                cell.item = was.item;
                if (was.at.x !== c.x || was.at.y !== c.y) events.push({ kind: 'move', item: was.item, from: was.at, to: { x: c.x, y: c.y } });
            }
        } else {
            const extra = s.type === 'splitter' || s.type === 'merger' ? { toggle: 0 } : s.type === 'generator' ? { fuelTicks: 0 } : {};
            if (s.recipe) extra.recipe = s.recipe;
            if (s.off) extra.off = true;
            m = makeMachine(s.type, s.dir, extra);
            m.tier = s.tier ?? 1;
        }
        if (m.type === 'extractor') m.produces = cell.resource;
        cell.machine = m;
        return m;
    });
    for (const { item, at } of lifted.values()) if (item) events.push({ kind: 'consume', item, at });
    score += credits;
    return { events, placed };
}
