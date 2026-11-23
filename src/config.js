// src/config.js — central tunables for the game.
// The world is a GRID_WIDTH × GRID_HEIGHT grid; in the 3D view one cell is
// one world unit (cell (x, y) is centred on world (x + 0.5, 0, y + 0.5)).
export const GRID_WIDTH = 32;  // cells wide
export const GRID_HEIGHT = 24; // cells tall
export const TICK_RATE = 4;    // simulation steps per second

// Map layout: the Dispatch Pad, and the ore fields as blobs (centre + radius).
// The three small fields next to the pad are the tutorial's starter area; the
// rest reward expanding. Terrain is recreated from this on load.
export const PAD_POS = { x: 19, y: 12 };
// The Selene construction site: reserved cells beside the pad where the
// cannon rises phase by phase. Nothing can be built here.
export const CANNON_AREA = { x: 20, y: 11, w: 3, h: 3 };
export const ORE_FIELDS = [
    { type: 'ironOre', x: 13, y: 11, r: 1.4 },
    { type: 'copperOre', x: 15, y: 17, r: 1.2 },
    { type: 'coalOre', x: 16, y: 6, r: 1.1 },
    { type: 'ironOre', x: 5, y: 5, r: 2.2 },
    { type: 'ironOre', x: 26, y: 19, r: 2.0 },
    { type: 'copperOre', x: 6, y: 18, r: 2.1 },
    { type: 'copperOre', x: 27, y: 4, r: 2.0 },
    { type: 'coalOre', x: 4, y: 12, r: 1.8 },
    { type: 'coalOre', x: 28, y: 12, r: 1.6 },
];

// Economy
export const STARTING_MONEY = 200; // enough to bootstrap one full production chain
export const PRODUCT_REWARD = 12;  // money earned per circuit consumed by the sink
// Payout per item type the sink (the Dispatch Pad) accepts. Ingots pay a
// little so the first phase already earns credits; the advanced circuit
// (2 circuits + 1 ironIngot, research-gated) is worth more than its parts.
// The pad also accepts whatever the active campaign phase requires.
export const SINK_VALUE = {
    ironIngot: 2,
    copperIngot: 2,
    circuit: PRODUCT_REWARD,
    advancedCircuit: 40,
};

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
    fabricator: 30,
};

// Power network: a global (wireless) grid, not items on belts. Each tick
// supply vs demand yields a throttle in [0,1] that scales every powered
// machine's progress — a brownout slows the whole factory instead of
// stalling it.
export const BASE_POWER_SUPPLY = 30;    // free "starter grid"; covers a small factory
export const POWER_PER_GENERATOR = 10;  // supply added per fueled generator, per tick
export const GENERATOR_FUEL_TICKS = 20; // ticks one coalOre keeps a generator burning
// Per-tick draw of machines that need power to make progress. Extractors are
// deliberately unpowered so the bootstrap chain can never brown out itself.
export const POWER_DRAW = {
    smelter: 4,
    assembler: 6,
    fabricator: 5,
    lab: 3,
};
// Overload: a brownout (demand above supply) only slows the factory, but
// demand above OVERLOAD_RATIO × supply for OVERLOAD_TICKS in a row trips the
// breaker: every powered machine stops until the player resets it (and a
// reset while still overloaded trips again within a second).
export const OVERLOAD_RATIO = 1.25;
export const OVERLOAD_TICKS = 20; // 5 s of warning at TICK_RATE 4

// Research: labs convert `research` items (assembled from circuits) into
// points; points buy permanent tech-tree unlocks. Costs are keyed by the
// node ids in grid.js's `research.unlocked`. (Buildings — generator, lab… —
// are unlocked by campaign phases instead; see campaign.js.)
export const RESEARCH_PER_ITEM = 5; // points per Data Cartridge read by a lab
export const TECH_COST = {
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
    fabricator: [8, 6, 4, 3],
};

// The Dispatch Pad's market: every sale pushes that item's price down, and
// prices recover over time. price = SINK_VALUE / (1 + pressure / MARKET_SATURATION),
// where pressure is the number of recent sales, halving every
// MARKET_HALF_LIFE_TICKS. So a flood of one product earns less and less, and
// a factory that makes many things (and fills Priority Requests) earns more.
export const MARKET_SATURATION = 20;      // recent sales that halve a price
export const MARKET_HALF_LIFE_TICKS = 240; // one minute of sim time

// Max units of each input type a processor will hold in its buffer.
export const BUFFER_CAP = 4;

// Orders: a timed demand for N products that pays a bonus on completion.
// main.js generates each order by picking from these ranges; grid.js pays the
// reward and counts deliveries.
export const ORDER_TARGET = [3, 8];      // [min, max] products demanded
export const ORDER_TICKS = [120, 240];   // [min, max] ticks to fulfil it
export const ORDER_REWARD = [40, 120];   // [min, max] bonus paid on completion
export const ORDER_GRACE_TICKS = 12;     // pause between one order ending and the next
