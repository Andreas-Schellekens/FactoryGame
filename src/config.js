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
};

// Tier system: machines start at tier 1 and can be upgraded to MAX_TIER.
// UPGRADE_COST is keyed by the tier being *reached*.
export const MAX_TIER = 3;
export const UPGRADE_COST = { 2: 30, 3: 80 };

// How many ticks a machine needs to complete one operation, per tier [t1, t2, t3].
// Lower = faster. Upgrading a machine moves it down this list.
export const PROCESS_TICKS = {
    extractor: [4, 2, 1],
    smelter: [4, 2, 1],
    assembler: [6, 3, 2],
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
