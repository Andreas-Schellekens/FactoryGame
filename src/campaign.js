// src/campaign.js — the campaign's mechanical skeleton: the buildings you
// start with, and the Project LIFELINE phases (deliveries to the Dispatch Pad)
// that unlock everything else. Pure data, read by grid.js. Every player-facing
// word about these phases lives in story.js.

export const STARTING_BUILDINGS = ['belt', 'extractor', 'smelter'];

// Each phase completes once the Dispatch Pad has received every `requires`
// count while that phase is active; completing it unlocks `unlocks` for good.
export const PHASES = [
    { id: 'groundbreaking', requires: { ironIngot: 20 }, unlocks: ['assembler', 'splitter', 'merger'] },
    { id: 'targeting', requires: { copperIngot: 15, circuit: 25 }, unlocks: ['lab'] },
    { id: 'powercore', requires: { circuit: 60 }, unlocks: ['generator'] },
    { id: 'payload', requires: { advancedCircuit: 20 }, unlocks: [] },
    { id: 'ignition', requires: { circuit: 80, advancedCircuit: 40 }, unlocks: [] },
];

/** Index of the phase whose completion unlocks `type` (-1 = available from the start). */
export function unlockPhaseOf(type) {
    if (STARTING_BUILDINGS.includes(type)) return -1;
    return PHASES.findIndex((p) => p.unlocks.includes(type));
}
