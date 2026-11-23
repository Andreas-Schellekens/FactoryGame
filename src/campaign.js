// src/campaign.js — the campaign's mechanical skeleton: the buildings you
// start with, and the Protocol: Selene phases (deliveries to the Dispatch Pad)
// that unlock everything else. Pure data, read by grid.js. Every player-facing
// word about these phases lives in story.js.

export const STARTING_BUILDINGS = ['belt', 'extractor', 'smelter'];

// Each phase completes once the Dispatch Pad has received every `requires`
// count while that phase is active; completing it unlocks `unlocks` for good.
export const PHASES = [
    // Each phase needs the chain the one before it unlocked, so the whole
    // factory gets built: ingots → plates + wire → steel → capacitors and
    // motors (with research) → shells (with explosives from the sulfur).
    { id: 'groundbreaking', requires: { ironIngot: 40, copperIngot: 20 }, unlocks: ['press', 'assembler', 'splitter', 'merger'] },
    { id: 'targeting', requires: { ironPlate: 60, circuit: 40 }, unlocks: ['foundry', 'generator'] },
    { id: 'powercore', requires: { steel: 60, capacitor: 50 }, unlocks: ['fabricator', 'lab'] },
    { id: 'payload', requires: { motor: 40, advancedCircuit: 30 }, unlocks: ['mixer'] },
    { id: 'ignition', requires: { seleneShell: 15, capacitor: 75 }, unlocks: [] },
];

/** Index of the phase whose completion unlocks `type` (-1 = available from the start). */
export function unlockPhaseOf(type) {
    if (STARTING_BUILDINGS.includes(type)) return -1;
    return PHASES.findIndex((p) => p.unlocks.includes(type));
}
