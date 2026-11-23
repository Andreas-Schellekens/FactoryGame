// src/synth.js — the instruments every sound in the game is built from.
// All audio is synthesized with the Web Audio API (no samples), so music,
// effects and ambience share one sound world and can all follow the arc.
//
// Every instrument is a plain function (ctx, out, t, …): it builds its nodes,
// schedules them at absolute context time `t`, connects them to `out` and
// lets them stop and be garbage-collected on their own. Works the same on a
// live AudioContext and an OfflineAudioContext (used by tests).

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const noiseCache = new WeakMap();
/** A shared 2 s white-noise buffer per context. */
export function noiseBuffer(ctx) {
    let b = noiseCache.get(ctx);
    if (!b) {
        const len = Math.floor(ctx.sampleRate * 2);
        b = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = b.getChannelData(0);
        let seed = 0x2545f491;
        for (let i = 0; i < len; i++) {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
        }
        noiseCache.set(ctx, b);
    }
    return b;
}

/** A synthetic room: decaying stereo noise that loses its highs over time. */
export function impulseResponse(ctx, seconds = 3.2, decay = 2.6) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        let seed = ch ? 0x9e3779b9 : 0x7f4a7c15;
        for (let i = 0; i < len; i++) {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            const white = ((seed >>> 0) / 4294967296) * 2 - 1;
            const x = i / len;
            const k = 0.55 - 0.5 * x; // darker tail
            lp += k * (white - lp);
            d[i] = lp * Math.pow(1 - x, decay) * (i < 60 ? i / 60 : 1);
        }
    }
    return ir;
}

function osc(ctx, type, freq, t) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
}

/** Percussive envelope on a fresh gain node: fast attack, exponential decay. */
function perc(ctx, t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
}

function panned(ctx, out, pan) {
    if (!pan) return out;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    return p;
}

/** Wooden/metal tine (kalimba-marimba): warm fundamental, a quick 4th partial and a tiny click. */
export function tine(ctx, out, t, freq, { vel = 1, decay = 1.2, bright = 1, pan = 0, detune = 0 } = {}) {
    const dest = panned(ctx, out, pan);
    const end = t + decay + 0.05;
    const parts = [
        [1, 0.5, decay],
        [2.0, 0.07 * bright, decay * 0.45],
        [4.0, 0.16 * bright, decay * 0.11],
    ];
    for (const [ratio, amp, dec] of parts) {
        const o = osc(ctx, 'sine', freq * ratio, t);
        o.detune.value = detune;
        const g = perc(ctx, t, amp * vel, 0.004, dec);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(end);
    }
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(9000, freq * 6);
    bp.Q.value = 1.5;
    const ng = perc(ctx, t, 0.05 * vel * bright, 0.001, 0.02);
    n.connect(bp).connect(ng).connect(dest);
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.04);
}

/** FM bell: carrier + inharmonic modulator whose depth fades, for chimes and stingers. */
export function bell(ctx, out, t, freq, { vel = 1, decay = 2.4, ratio = 3.5, index = 2.2, pan = 0 } = {}) {
    const dest = panned(ctx, out, pan);
    const car = osc(ctx, 'sine', freq, t);
    const mod = osc(ctx, 'sine', freq * ratio, t);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(freq * index, t);
    depth.gain.exponentialRampToValueAtTime(freq * 0.05, t + decay * 0.6);
    mod.connect(depth).connect(car.frequency);
    const g = perc(ctx, t, 0.22 * vel, 0.003, decay);
    car.connect(g).connect(dest);
    car.start(t);
    mod.start(t);
    car.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
}

/** Sustained chord: two detuned oscillators per note through one lowpass, slow swell and release. */
export function pad(ctx, out, t, freqs, dur, { type = 'triangle', cutoff = 1600, gain = 0.05, attack = 1.4, release = 1.8, pan = 0.35 } = {}) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 0.6, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + attack + dur * 0.4);
    lp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur));
    g.gain.linearRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release);
    lp.connect(g).connect(out);
    const end = t + Math.max(attack, dur) + release + 0.05;
    freqs.forEach((f, i) => {
        for (const cents of [-7, 7]) {
            const o = osc(ctx, type, f, t);
            o.detune.value = cents + (i % 2 ? 2 : -2);
            const p = ctx.createStereoPanner();
            p.pan.value = (cents < 0 ? -pan : pan) * (0.6 + 0.4 * ((i + 1) / freqs.length));
            o.connect(p).connect(lp);
            o.start(t);
            o.stop(end);
        }
    });
}

/** Soft round bass note. */
export function bass(ctx, out, t, freq, dur, { vel = 1, cutoff = 420 } = {}) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    const peak = 0.32 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(peak * 0.55, t + 0.35);
    g.gain.setValueAtTime(peak * 0.55, t + Math.max(0.36, dur - 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    lp.connect(g).connect(out);
    const a = osc(ctx, 'sine', freq, t);
    const b = osc(ctx, 'triangle', freq, t);
    const bg = ctx.createGain();
    bg.gain.value = 0.35;
    a.connect(lp);
    b.connect(bg).connect(lp);
    for (const o of [a, b]) {
        o.start(t);
        o.stop(t + dur + 0.3);
    }
}

/** A filtered noise burst: shakers, whooshes, crunches, dust. */
export function noise(ctx, out, t, { dur = 0.08, gain = 0.2, type = 'bandpass', freq = 6000, freqEnd = null, q = 1, attack = 0.002, pan = 0 } = {}) {
    const dest = panned(ctx, out, pan);
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = perc(ctx, t, gain, attack, dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random() * 1.6);
    n.stop(t + attack + dur + 0.05);
}

/** Kick / thud: a sine that drops in pitch. */
export function kick(ctx, out, t, { gain = 0.6, from = 120, to = 42, dur = 0.38 } = {}) {
    const o = osc(ctx, 'sine', from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.35);
    const g = perc(ctx, t, gain, 0.003, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
}

/** Metallic clank: inharmonic FM through a highpass, for anvils and distant industry. */
export function metal(ctx, out, t, freq, { vel = 1, decay = 0.9, pan = 0 } = {}) {
    const dest = panned(ctx, out, pan);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = Math.max(80, freq * 0.7);
    hp.connect(dest);
    for (const [ratio, amp] of [[1, 0.16], [2.76, 0.09], [5.4, 0.05]]) {
        const car = osc(ctx, 'sine', freq * ratio, t);
        const mod = osc(ctx, 'sine', freq * ratio * 1.41, t);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(freq * ratio * 1.6, t);
        depth.gain.exponentialRampToValueAtTime(freq * 0.02, t + decay * 0.5);
        mod.connect(depth).connect(car.frequency);
        const g = perc(ctx, t, amp * vel, 0.002, decay * (ratio === 1 ? 1 : 0.5));
        car.connect(g).connect(hp);
        car.start(t);
        mod.start(t);
        car.stop(t + decay + 0.1);
        mod.stop(t + decay + 0.1);
    }
    noise(ctx, dest, t, { dur: 0.03, gain: 0.08 * vel, type: 'highpass', freq: 3000 });
}

/** A short tone, optionally gliding: UI blips, Quindar tones, arcade stingers. */
export function blip(ctx, out, t, freq, { type = 'sine', dur = 0.06, gain = 0.15, glide = null, attack = 0.003, cutoff = null, pan = 0 } = {}) {
    let dest = panned(ctx, out, pan);
    if (cutoff) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = cutoff;
        lp.connect(dest);
        dest = lp;
    }
    const o = osc(ctx, type, freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - 0.015));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
}

/** A held tone that sweeps in pitch through a lowpass: power up/down, charge, tape-stop. */
export function sweep(ctx, out, t, from, to, dur, { type = 'sawtooth', gain = 0.12, cutoff = 1800, cutoffEnd = null, attack = 0.02, curve = 'exp' } = {}) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    if (cutoffEnd) lp.frequency.exponentialRampToValueAtTime(cutoffEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(out);
    const o = osc(ctx, type, from, t);
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(to, t + dur);
    else o.frequency.linearRampToValueAtTime(to, t + dur);
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.02);
}

/** Bird call: a few quick frequency-swept chirps. */
export function chirp(ctx, out, t, { base = 3200, count = 3, gain = 0.035, pan = 0 } = {}) {
    const dest = panned(ctx, out, pan);
    let at = t;
    for (let i = 0; i < count; i++) {
        const f0 = base * (0.85 + Math.random() * 0.4);
        const f1 = f0 * (Math.random() < 0.5 ? 1.35 : 0.72);
        const dur = 0.05 + Math.random() * 0.05;
        const o = osc(ctx, 'sine', f0, at);
        o.frequency.exponentialRampToValueAtTime(f1, at + dur);
        const g = perc(ctx, at, gain, 0.006, dur);
        o.connect(g).connect(dest);
        o.start(at);
        o.stop(at + dur + 0.03);
        at += dur + 0.03 + Math.random() * 0.07;
    }
}

/** Cricket: a short train of amplitude-gated high sine pulses. */
export function cricket(ctx, out, t, { freq = 4600, pulses = 4, gain = 0.018, pan = 0 } = {}) {
    const dest = panned(ctx, out, pan);
    for (let i = 0; i < pulses; i++) {
        const at = t + i * 0.055;
        const o = osc(ctx, 'sine', freq + Math.random() * 120, at);
        const g = perc(ctx, at, gain, 0.004, 0.025);
        o.connect(g).connect(dest);
        o.start(at);
        o.stop(at + 0.04);
    }
}
