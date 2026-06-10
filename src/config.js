// src/config.js — central tunables for the game.
export const TILE_SIZE = 64;   // Each cell is 64x64 pixels
export const GRID_WIDTH = 12;  // cells wide
export const GRID_HEIGHT = 10; // cells tall
export const TICK_RATE = 4;    // simulation steps per second

// Economy
export const STARTING_MONEY = 200; // enough to bootstrap one full production chain
export const PRODUCT_REWARD = 12;  // money earned per product consumed by the sink

// Placement cost per machine type (belts are cheap, processors are not).
export const MACHINE_COST = {
    belt: 1,
    splitter: 5,
    merger: 5,
    extractor: 15,
    smelter: 20,
    assembler: 30,
    generator: 30,
    lab: 25,
};

// Power network: a global (wireless) grid, not items on belts. Each tick
// supply vs demand yields a throttle in [0,1] that scales every powered
// machine's progress — a brownout slows the whole factory instead of
// stalling it.
export const BASE_POWER_SUPPLY = 20;    // free "starter grid"; covers a small factory
export const POWER_PER_GENERATOR = 10;  // supply added per fueled generator, per tick
export const GENERATOR_FUEL_TICKS = 20; // ticks one coalOre keeps a generator burning
// Per-tick draw of machines that need power to make progress. Extractors are
// deliberately unpowered so the bootstrap chain can never brown out itself.
export const POWER_DRAW = {
    smelter: 4,
    assembler: 6,
    lab: 3,
};

// Research: labs convert `research` items (assembled from circuits) into
// points; points buy permanent tech-tree unlocks. Costs are keyed by the
// node ids in grid.js's `research.unlocked`.
export const RESEARCH_PER_ITEM = 5;
export const TECH_COST = {
    power: 20,           // unlocks building generators
    fastBelts: 40,       // belts (and routers) move twice per tick
    advancedProduct: 60, // unlocks the advancedCircuit recipe
    tier4: 80,           // raises the machine upgrade cap to tier 4
};

// Tier system: machines start at tier 1 and can be upgraded to MAX_TIER.
// UPGRADE_COST is keyed by the tier being *reached*. Tier 4 is locked behind
// the `tier4` research node (grid.js caps at MAX_TIER - 1 until then).
export const MAX_TIER = 4;
export const UPGRADE_COST = { 2: 30, 3: 80, 4: 150 };

// How many ticks a machine needs to complete one operation, per tier
// [t1, t2, t3, t4]. Lower = faster. Upgrading a machine moves it down this list.
export const PROCESS_TICKS = {
    extractor: [4, 3, 2, 1],
    smelter: [4, 3, 2, 1],
    assembler: [6, 4, 3, 2],
    lab: [6, 4, 3, 2],
};

// Max units of each input type a processor will hold in its buffer.
export const BUFFER_CAP = 4;

// Orders: a timed demand for N products that pays a bonus on completion.
// main.js generates each order by picking from these ranges; grid.js pays the
// reward and counts deliveries.
export const ORDER_TARGET = [3, 8];      // [min, max] products demanded
export const ORDER_TICKS = [120, 240];   // [min, max] ticks to fulfil it
export const ORDER_REWARD = [40, 120];   // [min, max] bonus paid on completion
export const ORDER_GRACE_TICKS = 12;     // pause between one order ending and the next
