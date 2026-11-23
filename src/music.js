// src/music.js — the procedural score. Every mood (one per phase, plus the
// aftermath) shares D as its tonal centre while the scale darkens by one note
// per milestone: Ionian → Mixolydian → Dorian → Aeolian → Phrygian → Locrian.
// The arrangement thins out alongside it: a sunny kalimba tune over warm
// pads becomes a forge rhythm at dusk, a heartbeat and a b2 ostinato after
// the reveal, and a broken music box in the aftermath.
//
// createMusic(ctx, { dry, wet }) returns a scheduler: call scheduleUntil(t)
// regularly (audio.js does, ~every 60 ms with a little lookahead; tests can
// call it once on an OfflineAudioContext). Melodies are composed per 8-bar
// phrase from a seeded RNG: motif, answer, motif transposed, cadence home.
import { tine, bell, pad, bass, noise, kick, metal, blip, mtof } from './synth.js';

export const MODES = {
    ionian: [0, 2, 4, 5, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
};
const ROOT = 62; // D4

// One entry per mood (index = phases completed; 5 = after the ending).
// prog: chord roots as scale degrees, two bars each. Gains are 0..1 levels.
export const SCORE = [
    { // 0 · sunny morning: cozy, a little tune, birdsong does the rest
        name: 'Morning', mode: 'ionian', bpm: 84, prog: [0, 4, 5, 3],
        pad: { type: 'triangle', cutoff: 1700, gain: 0.04 }, padSeventh: false,
        bass: { pattern: 'root', gain: 0.75 },
        melody: { density: 0.6, octave: 1, inst: 'tine' }, bells: 0.3,
        shaker: 0, wood: 0, anvil: null, heart: 0, drone: 0,
    },
    { // 1 · afternoon: a gentle pulse, folk-ish flat seventh
        name: 'Afternoon', mode: 'mixolydian', bpm: 84, prog: [0, 6, 3, 0],
        pad: { type: 'triangle', cutoff: 1600, gain: 0.04 }, padSeventh: false,
        bass: { pattern: 'rootFifth', gain: 0.8 },
        melody: { density: 0.55, octave: 1, inst: 'tine' }, bells: 0.15,
        shaker: 0.7, wood: 0.6, anvil: null, heart: 0, drone: 0,
    },
    { // 2 · golden hour: bittersweet, the first metal tick of industry
        name: 'Golden hour', mode: 'dorian', bpm: 78, prog: [0, 3, 0, 6],
        pad: { type: 'triangle', cutoff: 1300, gain: 0.045 }, padSeventh: true,
        bass: { pattern: 'rootFifth', gain: 0.8 },
        melody: { density: 0.45, octave: 1, inst: 'tine' }, bells: 0.08,
        shaker: 0.55, wood: 0, anvil: 'tick', heart: 0, drone: 0.15,
    },
    { // 3 · dusk: minor, a forge hammer keeps time, a drone creeps in
        name: 'Dusk', mode: 'aeolian', bpm: 72, prog: [0, 5, 2, 6],
        pad: { type: 'sawtooth', cutoff: 900, gain: 0.032 }, padSeventh: true,
        bass: { pattern: 'root', gain: 0.85 },
        melody: { density: 0.3, octave: 0, inst: 'tine' }, bells: 0,
        shaker: 0, wood: 0, anvil: 'forge', heart: 0, drone: 0.4,
    },
    { // 4 · red night: the reveal and Ignition. Heartbeat, b2 ostinato, distant industry
        name: 'Red night', mode: 'phrygian', bpm: 66, prog: [0, 1, 0, 6],
        pad: { type: 'sawtooth', cutoff: 650, gain: 0.034 }, padSeventh: false,
        bass: { pattern: 'ostinato', gain: 0.7 },
        melody: { density: 0.16, octave: 1, inst: 'box' }, bells: 0,
        shaker: 0, wood: 0, anvil: 'distant', heart: 0.8, drone: 0.7,
    },
    { // 5 · aftermath (sandbox after the ending): hollow, a broken music box
        name: 'Aftermath', mode: 'locrian', bpm: 58, prog: [0, 1, 0, 4],
        pad: { type: 'sawtooth', cutoff: 520, gain: 0.03 }, padSeventh: false,
        bass: { pattern: null, gain: 0 },
        melody: { density: 0.14, octave: 1, inst: 'box' }, bells: 0,
        shaker: 0, wood: 0, anvil: 'distant', heart: 0, drone: 0.85,
    },
];

const clampMood = (m) => Math.max(0, Math.min(SCORE.length - 1, m | 0));

/** MIDI note of a scale degree in a mood (degrees past 6 or below 0 wrap into octaves). */
export function degreeNote(mood, degree, octave = 0) {
    const scale = MODES[SCORE[clampMood(mood)].mode];
    const o = Math.floor(degree / 7);
    const d = ((degree % 7) + 7) % 7;
    return ROOT + 12 * (octave + o) + scale[d];
}
export const degreeFreq = (mood, degree, octave = 0) => mtof(degreeNote(mood, degree, octave));

/** Small seeded PRNG (mulberry32), so a phrase can be re-composed deterministically. */
export function rng(seed) {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Eighth-note slots in a bar where a melody note may start.
const RHYTHMS = [
    [1, 0, 0, 0, 1, 0, 1, 0],
    [1, 0, 1, 0, 0, 0, 1, 0],
    [1, 0, 0, 1, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1, 1],
    [1, 0, 1, 0, 1, 0, 0, 0],
];
const STEPS = [-2, -1, -1, -1, 0, 1, 1, 1, 2];

function nearestChordTone(deg, root) {
    let best = root;
    for (let k = -3; k <= 3; k++) {
        for (const t of [0, 2, 4]) {
            const c = root + t + 7 * k;
            if (Math.abs(c - deg) < Math.abs(best - deg)) best = c;
        }
    }
    return best;
}

/** One 8-bar phrase of melody: Map<step(0..63), { deg, vel }>. */
export function composePhrase(sc, rand) {
    const out = new Map();
    const density = sc.melody.density;
    if (!density) return out;
    const base = 7 * sc.melody.octave;
    const lo = base - 2;
    const hi = base + 9;
    let prev = base + (rand() < 0.5 ? 2 : 4);

    const cell = (root) => {
        const notes = [];
        for (let bar = 0; bar < 2; bar++) {
            const rhythm = RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
            for (let s = 0; s < 8; s++) {
                if (!rhythm[s]) continue;
                const p = s === 0 ? Math.min(1, density * 1.6) : density * 1.3;
                if (rand() > p) continue;
                let deg = s === 0 ? nearestChordTone(prev, root) : prev + STEPS[Math.floor(rand() * STEPS.length)];
                deg = Math.max(lo, Math.min(hi, deg));
                notes.push({ step: bar * 8 + s, deg, vel: s === 0 ? 0.9 : 0.62 + rand() * 0.25 });
                prev = deg;
            }
        }
        return notes;
    };

    const [c0, c1, c2, c3] = sc.prog;
    const a = cell(c0);
    const b = cell(c1);
    // The motif returns over the third chord, moved with the harmony and snapped onto its chord tones.
    const shift = c2 - c0;
    const a2 = a.map((n) => {
        let deg = n.deg + shift;
        if (n.step % 8 === 0) deg = nearestChordTone(deg, c2);
        return { ...n, deg: Math.max(lo, Math.min(hi, deg)) };
    });
    prev = a2.length ? a2[a2.length - 1].deg : prev;
    const cad = cell(c3);
    // Cadence: the phrase ends on the tonic.
    if (cad.length) {
        const last = cad[cad.length - 1];
        last.deg = nearestChordTone(last.deg, 0);
        last.deg -= ((last.deg % 7) + 7) % 7; // root of that octave
        if (last.deg < lo) last.deg += 7;
        last.vel = 0.85;
    }
    [a, b, a2, cad].forEach((notes, i) => notes.forEach((n) => out.set(i * 16 + n.step, n)));
    return out;
}

/**
 * @param {BaseAudioContext} ctx
 * @param {{ dry: AudioNode, wet: AudioNode, seed?: number }} io
 */
export function createMusic(ctx, { dry, wet, seed = (Math.random() * 1e9) | 0 }) {
    let mood = 0;
    let pending = null;    // mood to switch to at the next bar boundary
    let restUntil = 0;     // no new notes before this time (stinger room)
    let running = false;
    let nextTime = 0;
    let step = 0;          // eighth note within the 8-bar phrase (0..63)
    let phrase = 0;
    let phraseNotes = new Map();
    let section = null;    // per-mood output: lets a mood change silence notes already scheduled

    // Drone: always running, its level follows the mood.
    const droneOut = ctx.createGain();
    droneOut.gain.value = 0;
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 240;
    droneLp.Q.value = 1.2;
    droneLp.connect(droneOut);
    droneOut.connect(dry);
    const droneSend = ctx.createGain();
    droneSend.gain.value = 0.4;
    droneOut.connect(droneSend).connect(wet);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 110;
    lfo.connect(lfoDepth).connect(droneLp.frequency);
    const droneOscs = [];
    const flat2 = ctx.createGain(); // the dissonant b2 that joins after the reveal
    flat2.gain.value = 0;
    flat2.connect(droneLp);
    for (const [freq, type, g, dest] of [
        [mtof(38), 'sawtooth', 0.05, droneLp], [mtof(38) * 1.003, 'sawtooth', 0.05, droneLp],
        [mtof(26), 'sine', 0.22, droneLp], [mtof(39), 'sawtooth', 0.045, flat2],
    ]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(dest);
        droneOscs.push(o);
    }

    const sc = () => SCORE[mood];
    const stepDur = () => 60 / sc().bpm / 2;

    const SENDS = { pad: 0.35, bass: 0.04, mel: 0.38, box: 0.7, bells: 0.6, perc: 0.1, metal: 0.55, far: 0.95 };
    const LEVELS = { pad: 1, bass: 0.45, mel: 1.05, box: 0.95, bells: 0.5, perc: 0.6, metal: 0.8, far: 0.9 };

    function newSection(t) {
        if (section) {
            const old = section;
            old.gain.gain.setTargetAtTime(0, t, 0.25);
            setTimeout(() => old.gain.disconnect(), 4000 + Math.max(0, (t - ctx.currentTime) * 1000));
        }
        const g = ctx.createGain();
        g.gain.value = 1;
        const wetG = ctx.createGain();
        wetG.gain.value = 1;
        g.connect(dry);
        wetG.connect(wet);
        const cats = {};
        for (const k of Object.keys(SENDS)) {
            const c = ctx.createGain();
            c.gain.value = LEVELS[k];
            const s = ctx.createGain();
            s.gain.value = SENDS[k];
            c.connect(g);
            c.connect(s).connect(wetG);
            cats[k] = c;
        }
        section = { gain: g, wetGain: wetG, cats };
    }

    function applyDrone(t, instant) {
        const s = sc();
        const tc = instant ? 0.05 : 3;
        droneOut.gain.setTargetAtTime(s.drone * 0.5, t, tc);
        flat2.gain.setTargetAtTime(mood >= 4 ? 1 : 0, t, tc);
    }

    function chordFreqs(root, seventh) {
        const degs = seventh ? [root, root + 2, root + 4, root + 6] : [root, root + 2, root + 4];
        return degs.map((d) => {
            let n = degreeNote(mood, d, -1);
            while (n > ROOT + 4) n -= 12;
            while (n < ROOT - 10) n += 12;
            return mtof(n);
        });
    }

    function playStep(t) {
        const s = sc();
        const c = section.cats;
        const bar = Math.floor(step / 8);
        const inBar = step % 8;
        const chordIdx = Math.floor(step / 16);
        const root = s.prog[chordIdx];
        const eighth = stepDur();
        const rand = Math.random;
        const breath = phrase % 4 === 3; // every fourth phrase: no melody, room to breathe

        if (step % 16 === 0) {
            pad(ctx, c.pad, t, chordFreqs(root, s.padSeventh), eighth * 16 - 0.2, {
                type: s.pad.type, cutoff: s.pad.cutoff, gain: s.pad.gain, attack: 1.2, release: 2,
            });
        }

        // Bass
        const bf = (deg) => degreeFreq(mood, deg, -2);
        if (s.bass.pattern === 'root' && step % 16 === 0) bass(ctx, c.bass, t, bf(root), eighth * 12, { vel: s.bass.gain });
        if (s.bass.pattern === 'rootFifth') {
            const pos = step % 16;
            if (pos === 0 || pos === 8) bass(ctx, c.bass, t, bf(root), eighth * 5, { vel: s.bass.gain });
            if (pos === 6 || pos === 14) bass(ctx, c.bass, t, bf(root + 4) / (root + 4 >= 7 ? 2 : 1), eighth * 1.6, { vel: s.bass.gain * 0.7 });
        }
        if (s.bass.pattern === 'ostinato') {
            const pat = [0, 0, 0, 1, 0, 0, 1, 0];
            const deg = root + pat[inBar];
            bass(ctx, c.bass, t, bf(deg), eighth * 0.8, { vel: s.bass.gain * (inBar === 0 ? 1 : 0.7), cutoff: 520 });
        }

        // Melody
        if (!breath) {
            const n = phraseNotes.get(step);
            if (n) {
                const jitter = (rand() - 0.5) * 0.016;
                const f = degreeFreq(mood, n.deg, 0);
                if (s.melody.inst === 'box') {
                    if (rand() > 0.15) {
                        tine(ctx, c.box, t + jitter, f * 2, { vel: n.vel * 0.55, decay: 2.4, bright: 1.6, detune: (rand() - 0.5) * 60, pan: (rand() - 0.5) * 0.6 });
                    }
                } else {
                    tine(ctx, c.mel, t + jitter, f, { vel: n.vel * 0.8, decay: 1.4, pan: (rand() - 0.5) * 0.4 });
                }
            }
        }

        // Sparkle bells on the bar
        if (inBar === 0 && s.bells && rand() < s.bells) {
            const deg = root + [0, 2, 4][Math.floor(rand() * 3)];
            bell(ctx, c.bells, t + eighth * (rand() < 0.5 ? 0 : 2), degreeFreq(mood, deg, 1), { vel: 0.4 + rand() * 0.2, pan: (rand() - 0.5) * 1.2 });
        }

        // Percussion
        if (s.shaker && step % 2 === 1) {
            noise(ctx, c.perc, t, { dur: 0.035, gain: 0.05 * s.shaker * (0.6 + rand() * 0.4), type: 'highpass', freq: 7000, pan: 0.25 });
        }
        if (s.wood && (inBar === 2 || inBar === 6)) {
            blip(ctx, c.perc, t, 1250, { dur: 0.045, gain: 0.06 * s.wood, glide: 820, pan: -0.2 });
        }
        if (s.anvil === 'tick' && bar % 2 === 1 && inBar === 6) {
            metal(ctx, c.metal, t, 1480, { vel: 0.35, decay: 0.5, pan: 0.4 });
        }
        if (s.anvil === 'forge' && (inBar === 0 || inBar === 4)) {
            metal(ctx, c.metal, t, inBar === 0 ? 520 : 600, { vel: inBar === 0 ? 0.5 : 0.32, decay: 1.1, pan: -0.25 });
        }
        if (s.anvil === 'distant') {
            if (inBar === 0) metal(ctx, c.far, t, 170, { vel: 0.8, decay: 1.9 });
            else if (rand() < 0.05) metal(ctx, c.far, t, 300 + rand() * 400, { vel: 0.35, decay: 1.4, pan: (rand() - 0.5) * 1.4 });
        }
        if (s.heart && (inBar === 0 || inBar === 4)) {
            kick(ctx, c.perc, t, { gain: 0.5 * s.heart, from: 92, to: 40, dur: 0.32 });
            kick(ctx, c.perc, t + 0.19, { gain: 0.3 * s.heart, from: 80, to: 38, dur: 0.28 });
        }
    }

    let phraseRand = rng(seed);
    function startPhrase() {
        phraseRand = rng(seed + phrase * 7919 + mood * 104729);
        phraseNotes = composePhrase(sc(), phraseRand);
    }

    return {
        get mood() { return mood; },
        get running() { return running; },

        /** Start playing at context time t (mood snaps, no transition). */
        start(t = ctx.currentTime, startMood = mood) {
            mood = clampMood(startMood);
            pending = null;
            if (!droneOscs.started) {
                for (const o of droneOscs) o.start(t);
                lfo.start(t);
                droneOscs.started = true;
            }
            running = true;
            nextTime = t + 0.05;
            step = 0;
            phrase = 0;
            restUntil = 0;
            newSection(t);
            applyDrone(t, true);
            startPhrase();
        },

        /**
         * Change mood. With instant the next bar starts the new mood; otherwise
         * the current music fades, leaves `restSec` of room for a stinger, and
         * the new mood begins on the first bar after that.
         */
        setMood(next, { instant = false, restSec = 3.4 } = {}) {
            const m = clampMood(next);
            const t = ctx.currentTime;
            if (instant || !running) {
                mood = m;
                pending = null;
                if (running) {
                    newSection(t);
                    step = 0;
                    phrase = 0;
                    nextTime = Math.max(nextTime, t + 0.05);
                    startPhrase();
                }
                applyDrone(t, true);
                return;
            }
            pending = m;
            restUntil = t + restSec;
            section.gain.gain.setTargetAtTime(0, t, 0.3);
            section.wetGain.gain.setTargetAtTime(0, t + 0.6, 0.8);
        },

        /** Fade the score out and stop composing (the ending), keeping the drone if asked. */
        silence(fadeSec = 1.2, { drone = false } = {}) {
            const t = ctx.currentTime;
            restUntil = Infinity;
            pending = null;
            if (section) {
                section.gain.gain.setTargetAtTime(0, t, fadeSec / 3);
                section.wetGain.gain.setTargetAtTime(0, t, fadeSec / 2);
            }
            if (!drone) droneOut.gain.setTargetAtTime(0, t, fadeSec / 3);
        },

        /** Resume composing after silence(), in the given mood. */
        resume(next = mood) {
            const t = ctx.currentTime;
            mood = clampMood(next);
            restUntil = 0;
            pending = null;
            newSection(t);
            step = 0;
            phrase = 0;
            nextTime = Math.max(nextTime, t + 0.1);
            applyDrone(t, false);
            startPhrase();
        },

        /** Schedule every step that starts before context time tEnd. */
        scheduleUntil(tEnd) {
            if (!running) return;
            const now = ctx.currentTime;
            if (nextTime < now - 0.5) nextTime = now + 0.05; // resumed after a stall: don't burst
            while (nextTime < tEnd) {
                if (step % 8 === 0 && pending !== null && nextTime >= restUntil) {
                    mood = pending;
                    pending = null;
                    newSection(nextTime);
                    step = 0;
                    phrase = 0;
                    applyDrone(nextTime, false);
                    startPhrase();
                }
                if (nextTime >= restUntil && section) playStep(nextTime);
                nextTime += stepDur();
                step = (step + 1) % 64;
                if (step === 0) {
                    phrase++;
                    startPhrase();
                }
            }
        },
    };
}
