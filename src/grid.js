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
    RESEARCH_PER_ITEM,
    TECH_COST,
    PAD_POS,
    ORE_FIELDS,
    CANNON_AREA,
} from './config.js';
import { PHASES, STARTING_BUILDINGS } from './campaign.js';

export const grid = [];
export let score = STARTING_MONEY;

/**
 * @typedef {{ id: number, type: string }} Item
 * @typedef {{ type: string, dir: 'right'|'down'|'left'|'up', tier: number, buffer: Record<string, number>, pendingOutput: string|null, progress: number, produces?: string }} Machine
 * @typedef {{ machine: Machine | null, item: Item | null, resource: string | null, blocked?: boolean }} Cell
 *   (`blocked` = the reserved LIFELINE construction site; terrain, never saved)
 * @typedef {{ x: number, y: number }} Pos
 * @typedef {{ kind: 'move', item: Item, from: Pos, to: Pos } | { kind: 'spawn', item: Item, at: Pos } | { kind: 'consume', item: Item, at: Pos }} FactoryEvent
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

// The basic product: what orders ask for, and the first assembler recipe.
export const PRODUCT_TYPE = 'circuit';

// Global power network (mutated in place, like `order` — a stable reference
// other modules read each frame). Recomputed every tick from generators and
// the demand of powered machines that want to work; never saved. `throttle`
// scales powered processors' progress, so an undersupplied factory slows
// down smoothly instead of stalling.
export const power = {
    supply: BASE_POWER_SUPPLY,
    demand: 0,
    throttle: 1,
};

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
};

// Lifetime counters the story director reads to trigger tutorial steps and
// story beats ("first ingot", "first circuit"…). Persisted.
export const stats = {
    produced: {},        // items ejected by machines, per type
    delivered: {},       // items sunk at the Dispatch Pad, per type
    researchEarned: 0,   // research points ever banked by labs
};

const bump = (counter, key, n = 1) => (counter[key] = (counter[key] || 0) + n);

/** Is this building type available to build in the current campaign phase? */
export function isBuildingUnlocked(type) {
    if (STARTING_BUILDINGS.includes(type)) return true;
    for (let i = 0; i < project.phase && i < PHASES.length; i++) {
        if (PHASES[i].unlocks.includes(type)) return true;
    }
    return false;
}

/** The active phase definition, or null once the campaign is complete. */
export function currentPhase() {
    return PHASES[project.phase] ?? null;
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

// Recipes. Smelter turns one ore into its matching ingot; the assembler runs
// the first recipe in ASSEMBLE whose tech (if any) is unlocked and whose
// inputs its buffer satisfies — so what the player routes in steers which
// product comes out. The lab "recipe" has no item output: completing it adds
// RESEARCH_PER_ITEM points instead (special-cased in the processor phase).
const SMELT = { ironOre: 'ironIngot', copperOre: 'copperIngot' };
const ASSEMBLE = [
    { inputs: { ironIngot: 1, copperIngot: 1 }, output: PRODUCT_TYPE },
    { inputs: { circuit: 2, ironIngot: 1 }, output: 'advancedCircuit', tech: 'advancedProduct' },
    { inputs: { circuit: 2 }, output: 'research' },
];
const LAB_RECIPE = { inputs: { research: 1 }, output: null };

// Assembler recipes whose tech gate (if any) is currently unlocked.
function assemblerRecipes() {
    return ASSEMBLE.filter((r) => !r.tech || research.unlocked[r.tech]);
}

// Machines that absorb the item in their input slot into a buffer. The
// generator is one of them (it eats coalOre as fuel) even though it never
// runs a recipe — its burn happens in the power phase.
const PROCESSORS = new Set(['smelter', 'assembler', 'generator', 'lab']);
export const UPGRADABLE = new Set(['extractor', 'smelter', 'assembler', 'lab']);

function inBounds(x, y) {
    return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
}

function makeMachine(type, dir = 'right', extra = {}) {
    return { type, dir, tier: 1, buffer: {}, pendingOutput: null, progress: 0, ...extra };
}

function processInterval(machine) {
    const ticks = PROCESS_TICKS[machine.type];
    if (!ticks) return 1;
    return ticks[Math.min(machine.tier - 1, ticks.length - 1)];
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
    // comes back on every load.
    for (const f of ORE_FIELDS) {
        const r = Math.ceil(f.r + 1);
        for (let x = f.x - r; x <= f.x + r; x++) {
            for (let y = f.y - r; y <= f.y + r; y++) {
                if (!inBounds(x, y)) continue;
                const jitter = (cellHash(x, y) - 0.5) * 0.9;
                if (Math.hypot(x - f.x, y - f.y) <= f.r + jitter) grid[x][y].resource = f.type;
            }
        }
    }
    grid[PAD_POS.x][PAD_POS.y].resource = null;

    // The cannon's construction site: reserved, nothing can be built there.
    for (let x = CANNON_AREA.x; x < CANNON_AREA.x + CANNON_AREA.w; x++) {
        for (let y = CANNON_AREA.y; y < CANNON_AREA.y + CANNON_AREA.h; y++) {
            grid[x][y].resource = null;
            grid[x][y].blocked = true;
        }
    }

    // The single, pre-placed sink (protected: cannot be built or removed).
    grid[PAD_POS.x][PAD_POS.y].machine = makeMachine('sink');
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
const SAVE_VERSION = 2;

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
        project: { phase: project.phase, delivered: { ...project.delivered }, complete: project.complete },
        stats: structuredClone(stats),
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
    if (!data || data.version !== SAVE_VERSION) return null;

    initGrid(); // reset to empty cells + ore terrain + the pre-placed sink

    /** @type {FactoryEvent[]} */
    const events = [];
    for (const entry of data.cells ?? []) {
        const { x, y } = entry;
        if (!inBounds(x, y)) continue;
        const cell = grid[x][y];
        if (cell.blocked) continue; // reserved site (a save from before it existed)
        if (entry.machine) {
            // Overlay saved fields onto fresh defaults so a save missing a newer
            // field (e.g. toggle) still loads cleanly.
            cell.machine = { ...makeMachine(entry.machine.type, entry.machine.dir), ...entry.machine };
        }
        if (entry.item) {
            const item = { id: nextItemId++, type: entry.item.type };
            cell.item = item;
            events.push({ kind: 'spawn', item, at: { x, y } });
        }
    }

    if (typeof data.score === 'number') score = data.score;
    if (typeof data.tickCount === 'number') tickCount = data.tickCount;
    if (data.order) Object.assign(order, data.order);

    // Reset research to defaults, then overlay — pre-research saves load locked.
    research.points = data.research?.points ?? 0;
    for (const k in research.unlocked) research.unlocked[k] = data.research?.unlocked?.[k] ?? false;

    project.phase = data.project?.phase ?? 0;
    project.delivered = { ...(data.project?.delivered ?? {}) };
    project.complete = data.project?.complete ?? false;
    stats.produced = { ...(data.stats?.produced ?? {}) };
    stats.delivered = { ...(data.stats?.delivered ?? {}) };
    stats.researchEarned = data.stats?.researchEarned ?? 0;

    return events;
}

export function canBuildMachine(x, y, type) {
    if (!inBounds(x, y)) return false;
    if (!(type in MACHINE_COST)) return false;
    const cell = grid[x][y];
    if (cell.machine !== null || cell.blocked) return false;
    if (type === 'extractor' && cell.resource === null) return false; // needs an ore node
    if (!isBuildingUnlocked(type)) return false; // campaign-gated
    return score >= MACHINE_COST[type];
}

export function buildMachine(x, y, type, dir = 'right') {
    if (!canBuildMachine(x, y, type)) return false;
    const cell = grid[x][y];
    score -= MACHINE_COST[type];
    const extra = type === 'extractor' ? { produces: cell.resource }
        : (type === 'splitter' || type === 'merger') ? { toggle: 0 }
        : type === 'generator' ? { fuelTicks: 0 }
        : {};
    cell.machine = makeMachine(type, dir, extra);
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
    if (cell.machine || cell.blocked) return 'blocked'; // non-belt machine / reserved site
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
            return itemType in SMELT && (m.buffer[itemType] || 0) < BUFFER_CAP;
        case 'assembler':
            return assemblerRecipes().some((r) => itemType in r.inputs)
                && (m.buffer[itemType] || 0) < BUFFER_CAP;
        case 'lab':
            return itemType === 'research' && (m.buffer.research || 0) < BUFFER_CAP;
        case 'generator':
            return itemType === 'coalOre' && (m.buffer.coalOre || 0) < BUFFER_CAP;
        default:
            return false;
    }
}

// What recipe (if any) the machine can run given its current buffer.
function recipeFor(machine) {
    if (machine.type === 'smelter') {
        for (const ore in SMELT) {
            if ((machine.buffer[ore] || 0) > 0) return { inputs: { [ore]: 1 }, output: SMELT[ore] };
        }
        return null;
    }
    if (machine.type === 'assembler') {
        for (const recipe of assemblerRecipes()) {
            let ok = true;
            for (const k in recipe.inputs) {
                if ((machine.buffer[k] || 0) < recipe.inputs[k]) { ok = false; break; }
            }
            if (ok) return recipe;
        }
        return null;
    }
    if (machine.type === 'lab') {
        return (machine.buffer.research || 0) > 0 ? LAB_RECIPE : null;
    }
    return null;
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
                events.push({ kind: 'consume', item: cell.item, at: { x, y } });
                if (order.active && type === order.productType) order.delivered++;
                if (currentPhase()?.requires[type]) bump(project.delivered, type);
                bump(stats.delivered, type);
                score += SINK_VALUE[type] ?? 0;
                cell.item = null;
            }
        }
    }
    checkPhaseComplete();

    // Resolve the order the same tick its final product is sunk: complete (and
    // pay the bonus) on reaching the target, else fail when the deadline passes.
    // The status flip is the only completion/failure signal — the HUD polls it.
    if (order.active) {
        if (order.delivered >= order.target) {
            score += order.reward;
            order.active = false;
            order.status = 'completed';
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
    power.supply = BASE_POWER_SUPPLY;
    power.demand = 0;
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            if (!m) continue;
            if (m.type === 'generator') {
                if (m.fuelTicks <= 0 && (m.buffer.coalOre || 0) > 0) {
                    m.buffer.coalOre--;
                    m.fuelTicks = GENERATOR_FUEL_TICKS;
                }
                if (m.fuelTicks > 0) {
                    m.fuelTicks--;
                    power.supply += POWER_PER_GENERATOR;
                }
            } else if (POWER_DRAW[m.type] && recipeFor(m)) {
                power.demand += POWER_DRAW[m.type];
            }
        }
    }
    power.throttle = power.demand > 0 ? Math.min(1, power.supply / power.demand) : 1;

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

            const recipe = recipeFor(m);
            if (!recipe) {
                m.progress = 0;
                continue;
            }
            // Powered machines advance by the network throttle (progress may
            // be fractional); unpowered processors run at full speed.
            m.progress += POWER_DRAW[m.type] ? power.throttle : 1;
            if (m.progress >= processInterval(m)) {
                for (const k in recipe.inputs) m.buffer[k] -= recipe.inputs[k];
                m.progress = 0;
                if (recipe.output === null) {
                    // Lab: the "product" is research points, not an item.
                    research.points += RESEARCH_PER_ITEM;
                    stats.researchEarned += RESEARCH_PER_ITEM;
                } else {
                    // Counted when crafted, even if the output is still blocked.
                    bump(stats.produced, recipe.output);
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
            if (m?.type !== 'extractor' || !m.produces) continue;
            m.progress++;
            if (m.progress >= processInterval(m)) {
                if (tryEject(m, x, y, m.produces, events)) {
                    m.progress = 0;
                    bump(stats.produced, m.produces);
                } else {
                    m.progress = processInterval(m); // output blocked; hold at full
                }
            }
        }
    }

    return events;
}
