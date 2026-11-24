// scripts/bench-cases.mjs — sample factory layouts for the leaderboard test (src/benchmark.js).
// Used by scripts/test-bench.mjs (Node) and, through the JSON it writes, by the API's
// cross-engine check (the same layouts through QuickJS must give the same scores).
import * as sim from '../src/grid.js';
import { GRID_WIDTH, GRID_HEIGHT, LICENCE_COST } from '../src/config.js';

// Two hand-laid chains into the pad at (19, 12): iron ingots from the field west of it,
// copper ingots from the field to the south.
export const SMALL = {
    world: 'valley',
    machines: [
        { x: 14, y: 11, type: 'extractor', dir: 'right', tier: 1 },
        { x: 15, y: 11, type: 'belt', dir: 'right', tier: 1 },
        { x: 16, y: 11, type: 'smelter', dir: 'right', tier: 1, recipe: 'ironIngot' },
        { x: 17, y: 11, type: 'belt', dir: 'right', tier: 1 },
        { x: 18, y: 11, type: 'belt', dir: 'down', tier: 1 },
        { x: 18, y: 12, type: 'belt', dir: 'right', tier: 1 },
        { x: 15, y: 17, type: 'extractor', dir: 'up', tier: 2 },
        { x: 15, y: 16, type: 'belt', dir: 'up', tier: 1 },
        { x: 15, y: 15, type: 'belt', dir: 'up', tier: 1 },
        { x: 15, y: 14, type: 'smelter', dir: 'up', tier: 2, recipe: 'copperIngot' },
        { x: 15, y: 13, type: 'belt', dir: 'right', tier: 1 },
        { x: 16, y: 13, type: 'belt', dir: 'right', tier: 1 },
        { x: 17, y: 13, type: 'belt', dir: 'right', tier: 1 },
        { x: 18, y: 13, type: 'belt', dir: 'right', tier: 1 },
        { x: 19, y: 13, type: 'belt', dir: 'up', tier: 1 },
    ],
};

/** A worst case for speed: every free cell of the valley built over (not a sensible factory). */
export function denseLayout() {
    sim.loadState({
        version: sim.SAVE_VERSION, score: 1e12,
        game: { mode: 'infinite', world: 'valley', plot: 3, licences: Object.keys(LICENCE_COST) },
        research: { unlocked: { fastBelts: true, advancedProduct: true, tier4: true } }, cells: [],
    });
    const cycle = ['belt', 'belt', 'smelter', 'belt', 'press', 'belt', 'assembler', 'generator', 'belt', 'foundry'];
    const dirs = ['right', 'down', 'left', 'up'];
    const machines = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = sim.grid[x][y];
            if (cell.machine) continue;
            const type = cell.resource ? 'extractor' : cycle[(x * 7 + y) % cycle.length];
            const dir = dirs[(x + y) % 4];
            if (sim.canBuildMachine(x, y, type)) machines.push({ x, y, type, dir, tier: 1 });
        }
    }
    return { world: 'valley', machines };
}
