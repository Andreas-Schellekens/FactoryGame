import {
    GRID_WIDTH,
    GRID_HEIGHT,
    STARTING_MONEY,
    PRODUCT_REWARD,
    MACHINE_COST,
    UPGRADE_COST,
    MAX_TIER,
    PROCESS_TICKS,
    BUFFER_CAP,
} from './config.js';

export const grid = [];
export let score = STARTING_MONEY;

/**
 * @typedef {{ id: number, type: string }} Item
 * @typedef {{ type: string, dir: 'right'|'down'|'left'|'up', tier: number, buffer: Record<string, number>, pendingOutput: string|null, progress: number, produces?: string }} Machine
 * @typedef {{ machine: Machine | null, item: Item | null, resource: string | null }} Cell
 * @typedef {{ x: number, y: number }} Pos
 * @typedef {{ kind: 'move', item: Item, from: Pos, to: Pos } | { kind: 'spawn', item: Item, at: Pos } | { kind: 'consume', item: Item, at: Pos }} FactoryEvent
 */

let nextItemId = 1;

// The only item type the sink will pay for.
export const PRODUCT_TYPE = 'circuit';

const DIRS = {
    right: { dx: 1, dy: 0 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    up: { dx: 0, dy: -1 },
};

// Recipes. Smelter turns one ore into its matching ingot; the assembler
// combines one of each ingot into a product.
const SMELT = { ironOre: 'ironIngot', copperOre: 'copperIngot' };
const ASSEMBLE = { inputs: { ironIngot: 1, copperIngot: 1 }, output: PRODUCT_TYPE };

const PROCESSORS = new Set(['smelter', 'assembler']);
export const UPGRADABLE = new Set(['extractor', 'smelter', 'assembler']);

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
    grid[1][1].resource = 'ironOre';
    grid[1][2].resource = 'ironOre';
    grid[1][7].resource = 'copperOre';
    grid[1][8].resource = 'copperOre';

    // The single, pre-placed sink (protected: cannot be built or removed).
    grid[10][4].machine = makeMachine('sink');
}

export function machineCost(type) {
    return MACHINE_COST[type] ?? 0;
}

export function canBuildMachine(x, y, type) {
    if (!inBounds(x, y)) return false;
    if (!(type in MACHINE_COST)) return false;
    const cell = grid[x][y];
    if (cell.machine !== null) return false;
    if (type === 'extractor' && cell.resource === null) return false; // needs an ore node
    return score >= MACHINE_COST[type];
}

export function buildMachine(x, y, type, dir = 'right') {
    if (!canBuildMachine(x, y, type)) return false;
    const cell = grid[x][y];
    score -= MACHINE_COST[type];
    const extra = type === 'extractor' ? { produces: cell.resource } : {};
    cell.machine = makeMachine(type, dir, extra);
    return true;
}

/** @returns {FactoryEvent[]} events for any item destroyed with the machine */
export function removeMachine(x, y) {
    const events = [];
    if (!inBounds(x, y)) return events;
    const cell = grid[x][y];
    if (cell.machine === null || cell.machine.type === 'sink') return events; // sink protected
    if (cell.item) {
        events.push({ kind: 'consume', item: cell.item, at: { x, y } });
        cell.item = null;
    }
    cell.machine = null;
    return events;
}

export function upgradeCost(x, y) {
    const m = inBounds(x, y) ? grid[x][y].machine : null;
    if (!m || !UPGRADABLE.has(m.type) || m.tier >= MAX_TIER) return null;
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
            return true;
        case 'sink':
            return itemType === PRODUCT_TYPE;
        case 'smelter':
            return itemType in SMELT && (m.buffer[itemType] || 0) < BUFFER_CAP;
        case 'assembler':
            return itemType in ASSEMBLE.inputs && (m.buffer[itemType] || 0) < BUFFER_CAP;
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
        for (const k in ASSEMBLE.inputs) {
            if ((machine.buffer[k] || 0) < ASSEMBLE.inputs[k]) return null;
        }
        return { inputs: ASSEMBLE.inputs, output: ASSEMBLE.output };
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

    // 1) Sinks consume products and pay out.
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            if (cell.machine?.type === 'sink' && cell.item?.type === PRODUCT_TYPE) {
                events.push({ kind: 'consume', item: cell.item, at: { x, y } });
                cell.item = null;
                score += PRODUCT_REWARD;
            }
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

    // 3) Belts move items forward (reverse scan to limit multi-cell chaining).
    for (let x = GRID_WIDTH - 1; x >= 0; x--) {
        for (let y = GRID_HEIGHT - 1; y >= 0; y--) {
            const cell = grid[x][y];
            const m = cell.machine;
            if (m?.type !== 'belt' || cell.item === null) continue;
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
        }
    }

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
            m.progress++;
            if (m.progress >= processInterval(m)) {
                for (const k in recipe.inputs) m.buffer[k] -= recipe.inputs[k];
                m.pendingOutput = recipe.output;
                m.progress = 0;
                if (tryEject(m, x, y, m.pendingOutput, events)) m.pendingOutput = null;
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
                if (tryEject(m, x, y, m.produces, events)) m.progress = 0;
                else m.progress = processInterval(m); // output blocked; hold at full
            }
        }
    }

    return events;
}
