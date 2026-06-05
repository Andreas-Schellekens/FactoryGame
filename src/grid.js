import { GRID_WIDTH, GRID_HEIGHT } from './config.js';

export const grid = [];
export let score = 0;

/**
 * @typedef {{ id: number, type: string }} Item
 * @typedef {{ machine: string | null, item: Item | null }} Cell
 * @typedef {{ x: number, y: number }} Pos
 * @typedef {{ kind: 'move', item: Item, from: Pos, to: Pos } | { kind: 'spawn', item: Item, at: Pos } | { kind: 'consume', item: Item, at: Pos }} FactoryEvent
 */

const BELT_COST = 1;
let nextItemId = 1;

function inBounds(x, y) {
    return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
}

function isProtectedMachine(machine) {
    return machine === 'spawner' || machine === 'sink';
}

function isBelt(machine) {
    return machine === 'belt_right' || machine === 'belt_left' || machine === 'belt_up' || machine === 'belt_down';
}

function beltDelta(machine) {
    switch (machine) {
        case 'belt_right':
            return { dx: 1, dy: 0 };
        case 'belt_left':
            return { dx: -1, dy: 0 };
        case 'belt_up':
            return { dx: 0, dy: -1 };
        case 'belt_down':
            return { dx: 0, dy: 1 };
        default:
            return { dx: 0, dy: 0 };
    }
}

export function initGrid() {
    for (let x = 0; x < GRID_WIDTH; x++) {
        grid[x] = [];
        for (let y = 0; y < GRID_HEIGHT; y++) {
            grid[x][y] = { machine: null, item: null };
        }
    }

    grid[1][2].machine = 'spawner';
    grid[8][2].machine = 'sink';
}

export function canBuildMachine(x, y, type) {
    if (!inBounds(x, y)) return false;
    const cell = grid[x][y];
    if (cell.machine !== null) return false;
    if (type === 'belt_right' || type === 'belt_left' || type === 'belt_up' || type === 'belt_down') {
        return score >= BELT_COST;
    }
    return true;
}

export function buildMachine(x, y, type) {
    if (!canBuildMachine(x, y, type)) return false;
    const cell = grid[x][y];
    if (type === 'belt_right' || type === 'belt_left' || type === 'belt_up' || type === 'belt_down') {
        score -= BELT_COST;
    }
    cell.machine = type;
    return true;
}

export function removeMachine(x, y) {
    if (!inBounds(x, y)) return;
    const cell = grid[x][y];
    if (cell.machine === null) return;
    if (isProtectedMachine(cell.machine)) return;
    cell.machine = null;
}

export function updateFactoryLogic() {
    /** @type {FactoryEvent[]} */
    const events = [];

    // 1) Sink consumes
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            if (cell.machine === 'sink' && cell.item !== null) {
                events.push({ kind: 'consume', item: cell.item, at: { x, y } });
                cell.item = null;
                score += 1;
            }
        }
    }

    // 2) Belts move items (reverse scan to reduce chain moves)
    for (let x = GRID_WIDTH - 1; x >= 0; x--) {
        for (let y = GRID_HEIGHT - 1; y >= 0; y--) {
            const cell = grid[x][y];
            if (!isBelt(cell.machine) || cell.item === null) continue;

            const { dx, dy } = beltDelta(cell.machine);
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(nx, ny)) continue;

            const nextCell = grid[nx][ny];
            if ((isBelt(nextCell.machine) || nextCell.machine === 'sink') && nextCell.item === null) {
                const movingItem = cell.item;
                nextCell.item = movingItem;
                cell.item = null;
                events.push({ kind: 'move', item: movingItem, from: { x, y }, to: { x: nx, y: ny } });
            }
        }
    }

    // 3) Spawner spawns
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            if (cell.machine !== 'spawner') continue;
            const nx = x + 1;
            const ny = y;
            if (!inBounds(nx, ny)) continue;
            const outCell = grid[nx][ny];
            if (isBelt(outCell.machine) && outCell.item === null) {
                const item = { id: nextItemId++, type: 'iron' };
                outCell.item = item;
                events.push({ kind: 'spawn', item, at: { x: nx, y: ny } });
            }
        }
    }

    return events;
}