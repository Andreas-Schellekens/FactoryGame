// src/sfx.js — every sound effect as a small recipe over the synth
// instruments. A cue is (kit, t, opts) => void, where kit = { ctx, out, wet,
// mood }: `out` is the dry effects bus, `wet` the shared reverb send and
// `mood` the current music mood, so musical cues (deliveries, upgrades,
// stingers) are always in the key the score is playing in.
//
// CUE_META sets each cue's minimum gap (rate limit, ms) and level (a linear
// gain, balanced from offline loudness measurements: short UI ticks need more).
import { tine, bell, pad, noise, kick, metal, blip, sweep } from './synth.js';
import { degreeFreq } from './music.js';

const PENTA = [0, 1, 2, 4, 5, 7, 8, 9]; // degrees used for the delivery "combo" climb (skips the 4th/7th)

export const CUE_META = {
    click: { gap: 25, gain: 3.2 },
    key: { gap: 25, gain: 3.0 },
    deny: { gap: 120, gain: 2.4 },
    open: { gap: 60, gain: 2.4 },
    close: { gap: 60, gain: 2.4 },
    rotate: { gap: 40, gain: 3.5 },
    pause: { gap: 80, gain: 1.8 },
    resume: { gap: 80, gain: 1.8 },
    speed: { gap: 40, gain: 2.4 },
    build: { gap: 30, gain: 1 },
    belt: { gap: 35, gain: 2.6 },
    demolish: { gap: 40, gain: 1.1 },
    upgrade: { gap: 80, gain: 0.9 },
    deliver: { gap: 110, gain: 0.75 },
    orderStart: { gap: 500, gain: 3.2 },
    orderDone: { gap: 500, gain: 0.9 },
    orderFail: { gap: 500, gain: 1.8 },
    tech: { gap: 300, gain: 2.2 },
    brownout: { gap: 2500, gain: 1.6 },
    powerup: { gap: 2500, gain: 1.7 },
    quindarIn: { gap: 200, gain: 1.4 },
    quindarOut: { gap: 200, gain: 1.4 },
    memo: { gap: 200, gain: 2.0 },
    glitch: { gap: 150, gain: 2.2 },
    phase: { gap: 2000, gain: 1 },
    reveal: { gap: 2000, gain: 1 },
    begin: { gap: 1000, gain: 0.9 },
    ending: { gap: 30000, gain: 1 },
    endingFinal: { gap: 2000, gain: 0.9 },
};

export const CUES = {
    /** Mouse click on a HUD button. */
    click({ ctx, out }, t) {
        noise(ctx, out, t, { dur: 0.012, gain: 0.1, freq: 2600, q: 2 });
        blip(ctx, out, t, 420, { dur: 0.03, gain: 0.045, glide: 300 });
    },
    /** A hardware key (tool select): a chunkier clack. */
    key({ ctx, out }, t) {
        noise(ctx, out, t, { dur: 0.018, gain: 0.14, freq: 1900, q: 1.6 });
        blip(ctx, out, t, 300, { dur: 0.04, gain: 0.06, glide: 190 });
        noise(ctx, out, t + 0.035, { dur: 0.01, gain: 0.05, freq: 3200, q: 2 });
    },
    deny({ ctx, out }, t) {
        blip(ctx, out, t, 220, { type: 'square', dur: 0.08, gain: 0.05, cutoff: 1100 });
        blip(ctx, out, t + 0.1, 165, { type: 'square', dur: 0.11, gain: 0.05, cutoff: 900 });
    },
    open({ ctx, out }, t) {
        blip(ctx, out, t, 660, { dur: 0.07, gain: 0.05, glide: 990 });
    },
    close({ ctx, out }, t) {
        blip(ctx, out, t, 990, { dur: 0.07, gain: 0.045, glide: 660 });
    },
    rotate({ ctx, out }, t) {
        noise(ctx, out, t, { dur: 0.05, gain: 0.07, freq: 1400, freqEnd: 3200, q: 1.2 });
        blip(ctx, out, t + 0.02, 880, { dur: 0.03, gain: 0.03 });
    },
    pause({ ctx, out }, t) {
        sweep(ctx, out, t, 520, 260, 0.18, { type: 'triangle', gain: 0.06, cutoff: 1800 });
    },
    resume({ ctx, out }, t) {
        sweep(ctx, out, t, 260, 520, 0.16, { type: 'triangle', gain: 0.06, cutoff: 1800 });
    },
    speed({ ctx, out }, t, { speed = 1 } = {}) {
        blip(ctx, out, t, 520 * Math.pow(1.25, Math.log2(speed) * 2), { dur: 0.05, gain: 0.04 });
    },

    /** A machine set down: thud, dust, a metal clink. size ~0.5 (belt) … 1.3 (big machines). */
    build({ ctx, out, wet }, t, { size = 1 } = {}) {
        kick(ctx, out, t, { gain: 0.32 * size, from: 170 / Math.sqrt(size), to: 55, dur: 0.22 + 0.1 * size });
        noise(ctx, out, t, { dur: 0.14 * size, gain: 0.14 * size, type: 'lowpass', freq: 900, freqEnd: 200, q: 0.7 });
        metal(ctx, out, t + 0.025, 1150 + Math.random() * 300, { vel: 0.22, decay: 0.28 });
        noise(ctx, wet, t + 0.02, { dur: 0.25, gain: 0.05 * size, type: 'bandpass', freq: 500, q: 0.8 });
    },
    /** One belt segment laid during a drag. */
    belt({ ctx, out }, t) {
        const r = 0.92 + Math.random() * 0.16;
        noise(ctx, out, t, { dur: 0.028, gain: 0.08, freq: 1800 * r, q: 3 });
        blip(ctx, out, t, 620 * r, { dur: 0.028, gain: 0.035, glide: 480 * r });
    },
    demolish({ ctx, out }, t) {
        noise(ctx, out, t, { dur: 0.26, gain: 0.2, freq: 2400, freqEnd: 320, q: 1.4 });
        kick(ctx, out, t, { gain: 0.2, from: 120, to: 50, dur: 0.2 });
        for (let i = 0; i < 4; i++) {
            metal(ctx, out, t + 0.05 + Math.random() * 0.25, 900 + Math.random() * 1600, { vel: 0.14, decay: 0.16, pan: (Math.random() - 0.5) * 0.8 });
        }
    },
    upgrade({ ctx, out, wet, mood }, t) {
        [0, 2, 4, 7].forEach((deg, i) => tine(ctx, out, t + i * 0.055, degreeFreq(mood, deg, 1), { vel: 0.55 + i * 0.08, decay: 0.7, bright: 1.3 }));
        bell(ctx, wet, t + 0.22, degreeFreq(mood, 7, 1), { vel: 0.35, decay: 1.6 });
        noise(ctx, out, t + 0.05, { dur: 0.35, gain: 0.035, type: 'highpass', freq: 5000, freqEnd: 11000 });
    },
    /** Credits at the Dispatch Pad; `combo` climbs the scale for quick successive deliveries. */
    deliver({ ctx, out, wet, mood }, t, { combo = 0 } = {}) {
        const deg = PENTA[combo % PENTA.length];
        const f = degreeFreq(mood, deg + 4, 1);
        tine(ctx, out, t, f, { vel: 0.5, decay: 0.45, bright: 1.4, pan: 0.15 });
        tine(ctx, wet, t + 0.045, f * 2, { vel: 0.22, decay: 0.35, bright: 1.2 });
    },
    orderStart({ ctx, out }, t) {
        blip(ctx, out, t, 1047, { type: 'square', dur: 0.07, gain: 0.035, cutoff: 2600 });
        blip(ctx, out, t + 0.1, 1319, { type: 'square', dur: 0.09, gain: 0.035, cutoff: 2600 });
    },
    orderDone({ ctx, out, wet, mood }, t) {
        [0, 2, 4, 7, 9].forEach((deg, i) => tine(ctx, out, t + i * 0.045, degreeFreq(mood, deg, 1), { vel: 0.6, decay: 0.6, bright: 1.4 }));
        bell(ctx, wet, t + 0.24, degreeFreq(mood, 7, 1), { vel: 0.5, decay: 2 });
        for (let i = 0; i < 5; i++) noise(ctx, out, t + 0.25 + i * 0.05, { dur: 0.02, gain: 0.03, type: 'highpass', freq: 7000 });
    },
    orderFail({ ctx, out, mood }, t) {
        blip(ctx, out, t, degreeFreq(mood, 2, 0), { type: 'triangle', dur: 0.28, gain: 0.08, cutoff: 900 });
        blip(ctx, out, t + 0.3, degreeFreq(mood, 0, 0), { type: 'triangle', dur: 0.5, gain: 0.08, glide: degreeFreq(mood, -1, 0), cutoff: 700 });
    },
    tech({ ctx, out, wet, mood }, t) {
        [0, 4, 7, 11].forEach((deg, i) => blip(ctx, out, t + i * 0.06, degreeFreq(mood, deg, 1), { type: 'square', dur: 0.09, gain: 0.035, cutoff: 3000 }));
        bell(ctx, wet, t + 0.26, degreeFreq(mood, 14, 0), { vel: 0.45, decay: 2.2 });
    },
    brownout({ ctx, out }, t) {
        sweep(ctx, out, t, 320, 50, 0.9, { gain: 0.09, cutoff: 1400, cutoffEnd: 180 });
        for (let i = 0; i < 3; i++) blip(ctx, out, t + 0.95 + i * 0.12, 110, { type: 'square', dur: 0.05, gain: 0.04, cutoff: 600 });
    },
    powerup({ ctx, out }, t) {
        sweep(ctx, out, t, 70, 340, 0.6, { gain: 0.06, cutoff: 300, cutoffEnd: 1800 });
    },

    /** NASA Quindar tones: the beep that opens and closes a CAPCOM transmission. */
    quindarIn({ ctx, out }, t) {
        blip(ctx, out, t, 2525, { dur: 0.22, gain: 0.035, attack: 0.004 });
    },
    quindarOut({ ctx, out }, t) {
        blip(ctx, out, t, 2475, { dur: 0.22, gain: 0.035, attack: 0.004 });
    },
    /** An intercepted memo: teleprinter chatter. */
    memo({ ctx, out }, t) {
        for (let i = 0; i < 7; i++) noise(ctx, out, t + i * 0.045 + Math.random() * 0.01, { dur: 0.012, gain: 0.07, type: 'highpass', freq: 2500 });
        blip(ctx, out, t + 0.36, 1600, { dur: 0.04, gain: 0.02 });
    },
    /** DELTA glitching: a stutter of digital garbage. */
    glitch({ ctx, out }, t) {
        for (let i = 0; i < 6; i++) {
            blip(ctx, out, t + i * 0.035, 200 + Math.random() * 1800, { type: 'square', dur: 0.022, gain: 0.03, cutoff: 4000 });
        }
        noise(ctx, out, t + 0.1, { dur: 0.06, gain: 0.05, type: 'bandpass', freq: 1200, q: 4 });
    },

    /** Starting a contract: a bright little sign-on. */
    begin({ ctx, out, wet }, t) {
        [0, 4, 7].forEach((deg, i) => tine(ctx, out, t + i * 0.09, degreeFreq(0, deg, 1), { vel: 0.6, decay: 1.2 }));
        bell(ctx, wet, t + 0.27, degreeFreq(0, 7, 1), { vel: 0.4, decay: 2.4 });
    },

    /** A phase completed: an arpeggio up the new mood's scale, a held chord, the cannon part materialising. */
    phase({ ctx, out, wet, mood }, t) {
        const dark = mood >= 3;
        [0, 2, 4, 7, 9, 11].forEach((deg, i) => tine(ctx, out, t + i * 0.075, degreeFreq(mood, deg, 0), { vel: 0.55 + i * 0.05, decay: 1.4, pan: (i - 2.5) * 0.12 }));
        bell(ctx, wet, t + 0.45, degreeFreq(mood, 7, 1), { vel: 0.5, decay: 3 });
        bell(ctx, wet, t + 0.6, degreeFreq(mood, 11, 1), { vel: 0.35, decay: 3 });
        pad(ctx, out, t + 0.4, [0, 2, 4, 7].map((d) => degreeFreq(mood, d, -1)), 2.2, {
            type: dark ? 'sawtooth' : 'triangle', cutoff: dark ? 1100 : 2000, gain: 0.05, attack: 0.35, release: 1.8,
        });
        kick(ctx, out, t + 0.4, { gain: 0.45, from: 95, to: 34, dur: 1.3 });
        noise(ctx, wet, t, { dur: 1.3, gain: 0.07, type: 'lowpass', freq: 400, freqEnd: 5000, attack: 0.6 });
        sweep(ctx, wet, t, 220, 1760, 1.1, { type: 'sine', gain: 0.025, cutoff: 6000 });
    },

    /** The reveal: a cheerful jingle that tape-stops into a Phrygian hit. */
    reveal({ ctx, out, wet }, t) {
        [0, 2, 4].forEach((deg, i) => tine(ctx, out, t + i * 0.09, degreeFreq(0, deg, 1), { vel: 0.6, decay: 0.8 }));
        sweep(ctx, out, t + 0.3, degreeFreq(0, 7, 1), 55, 1.0, { type: 'square', gain: 0.06, cutoff: 2200, cutoffEnd: 250 });
        noise(ctx, out, t + 0.3, { dur: 1.0, gain: 0.05, type: 'bandpass', freq: 2000, freqEnd: 150, q: 0.8 });
        const hit = t + 1.35;
        pad(ctx, out, hit, [degreeFreq(4, 0, -1), degreeFreq(4, 1, -1), degreeFreq(4, 0, -2)], 2.6, { type: 'sawtooth', cutoff: 700, gain: 0.07, attack: 0.02, release: 2.4 });
        metal(ctx, wet, hit, 140, { vel: 1, decay: 2.6 });
        kick(ctx, out, hit, { gain: 0.7, from: 75, to: 28, dur: 2 });
        noise(ctx, wet, hit, { dur: 2.2, gain: 0.12, type: 'lowpass', freq: 900, freqEnd: 90 });
    },

    /**
     * The ending, timed to the CSS animation in style.css: charge (0–2.6 s),
     * beam (2.6), flash + boom (3.2), debris, the Moon+ billboard flickering
     * on (6.0) with its ad jingle, and the closing chord with "The end" (18).
     */
    ending(kit, t) {
        const { ctx, out, wet } = kit;
        sweep(ctx, out, t, 45, 62, 3.2, { type: 'sine', gain: 0.16, cutoff: 300, attack: 1.5 });
        sweep(ctx, out, t + 0.3, 70, 1100, 2.3, { gain: 0.05, cutoff: 600, cutoffEnd: 5000, attack: 1.2 });
        noise(ctx, out, t + 0.6, { dur: 2.0, gain: 0.05, type: 'highpass', freq: 800, freqEnd: 7000, attack: 1.8 });
        sweep(ctx, out, t + 2.6, 2200, 180, 0.55, { type: 'square', gain: 0.06, cutoff: 5000 });
        noise(ctx, out, t + 2.6, { dur: 0.5, gain: 0.12, type: 'highpass', freq: 3000 });
        const boom = t + 3.2;
        kick(ctx, out, boom, { gain: 0.95, from: 70, to: 22, dur: 3 });
        noise(ctx, out, boom, { dur: 3.6, gain: 0.32, type: 'lowpass', freq: 1400, freqEnd: 70, attack: 0.01 });
        noise(ctx, wet, boom, { dur: 4.5, gain: 0.2, type: 'lowpass', freq: 600, freqEnd: 60 });
        metal(ctx, wet, boom + 0.05, 95, { vel: 1, decay: 3.2 });
        for (let i = 0; i < 12; i++) {
            metal(ctx, wet, boom + 0.3 + Math.random() * 2.3, 600 + Math.random() * 2200, { vel: 0.18, decay: 0.3, pan: (Math.random() - 0.5) * 1.6 });
        }
        // Moon+ switches on: a flicker of glitches, then a relentlessly cheerful ad jingle.
        const ad = t + 6.0;
        for (let i = 0; i < 4; i++) CUES.glitch(kit, ad + i * 0.16);
        [0, 2, 4, 7, 4, 7].forEach((deg, i) => {
            blip(ctx, out, ad + 0.8 + i * 0.13, degreeFreq(0, deg, 1), { type: 'square', dur: 0.11, gain: 0.04, cutoff: 3200 });
            tine(ctx, out, ad + 0.8 + i * 0.13, degreeFreq(0, deg, 1), { vel: 0.4, decay: 0.4 });
        });
        bell(ctx, wet, ad + 1.65, degreeFreq(0, 14, 0), { vel: 0.6, decay: 2.5 });
        CUES.endingFinal(kit, t + 18);
    },
    /** The closing chord under "The end" (also played on its own when the ending is skipped). */
    endingFinal({ ctx, out, wet }, t) {
        // A hollow open fifth: no third, so neither triumphant nor sad. Just over.
        pad(ctx, out, t, [degreeFreq(4, 0, -1), degreeFreq(4, 4, -1), degreeFreq(4, 0, 0)], 4.5, { type: 'sawtooth', cutoff: 700, gain: 0.05, attack: 1.5, release: 4 });
        bell(ctx, wet, t + 0.5, degreeFreq(5, 0, 1), { vel: 0.35, decay: 4 });
    },
};
