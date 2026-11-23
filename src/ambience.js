// src/ambience.js — the valley's soundscape, following the same arc as the
// visuals (docs/DESIGN.md "Visual arc"): birdsong in the morning that thins
// out and is gone by dusk, crickets at dusk, wind that rises phase by phase,
// a low rumble and distant clangs at night. Under it all runs the factory's
// own hum, whose level follows how many machines are working and whose pitch
// sags when the power network browns out.
import { noiseBuffer, chirp, cricket, metal } from './synth.js';

// Per mood (phases completed, 5 = after the ending).
const AMB = [
    { birds: 1, crickets: 0, wind: 0.07, rumble: 0, clangs: 0 },
    { birds: 0.7, crickets: 0, wind: 0.085, rumble: 0, clangs: 0 },
    { birds: 0.35, crickets: 0.2, wind: 0.11, rumble: 0, clangs: 0 },
    { birds: 0, crickets: 1, wind: 0.15, rumble: 0.05, clangs: 0.2 },
    { birds: 0, crickets: 0.15, wind: 0.19, rumble: 0.15, clangs: 1 },
    { birds: 0, crickets: 0, wind: 0.23, rumble: 0.18, clangs: 0.6 },
];

/**
 * @param {BaseAudioContext} ctx
 * @param {{ out: AudioNode, wet: AudioNode }} io
 */
export function createAmbience(ctx, { out, wet }) {
    let mood = 0;
    let running = false;
    let nextBird = 0;
    let nextCricket = 0;
    let nextClang = 0;
    let activity = 0; // smoothed 0..1

    // Wind: looped noise, lowpassed, with slow gusts.
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer(ctx);
    windSrc.loop = true;
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass';
    windLp.frequency.value = 420;
    windLp.Q.value = 0.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windLp).connect(windGain).connect(out);

    // Rumble: noise through a very low lowpass.
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = noiseBuffer(ctx);
    rumbleSrc.loop = true;
    rumbleSrc.playbackRate.value = 0.5;
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.value = 90;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleSrc.connect(rumbleLp).connect(rumbleGain).connect(out);

    // Factory hum: mains-like sines plus a band of machinery noise.
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.connect(out);
    const humOscs = [55, 110, 165].map((f, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = [0.5, 0.25, 0.08][i];
        o.connect(g).connect(humGain);
        return o;
    });
    const machSrc = ctx.createBufferSource();
    machSrc.buffer = noiseBuffer(ctx);
    machSrc.loop = true;
    const machBp = ctx.createBiquadFilter();
    machBp.type = 'bandpass';
    machBp.frequency.value = 320;
    machBp.Q.value = 0.9;
    const machGain = ctx.createGain();
    machGain.gain.value = 0.9;
    machSrc.connect(machBp).connect(machGain).connect(humGain);

    function applyMood(t, instant) {
        const a = AMB[mood];
        const tc = instant ? 0.05 : 4;
        windGain.gain.setTargetAtTime(a.wind, t, tc);
        rumbleGain.gain.setTargetAtTime(a.rumble, t, tc);
    }

    return {
        start(t = ctx.currentTime, startMood = 0) {
            mood = Math.max(0, Math.min(AMB.length - 1, startMood));
            if (!running) {
                windSrc.start(t);
                rumbleSrc.start(t);
                machSrc.start(t);
                for (const o of humOscs) o.start(t);
                running = true;
            }
            nextBird = t + 1.5;
            nextCricket = t + 2;
            nextClang = t + 6;
            applyMood(t, true);
        },

        setMood(next, { instant = false } = {}) {
            mood = Math.max(0, Math.min(AMB.length - 1, next));
            if (running) applyMood(ctx.currentTime, instant);
        },

        /**
         * Per-frame state from the game. `working` is how many machines are busy,
         * `throttle` the power network's 0..1 throttle.
         */
        setFactory({ working = 0, throttle = 1 }) {
            if (!running) return;
            const t = ctx.currentTime;
            const target = Math.min(1, Math.sqrt(working / 40));
            activity += (target - activity) * 0.2;
            humGain.gain.setTargetAtTime(0.085 * activity, t, 0.8);
            // Brownout: the hum sags in pitch and the machinery band drops.
            const sag = 0.82 + 0.18 * Math.max(0, Math.min(1, throttle));
            humOscs.forEach((o, i) => o.frequency.setTargetAtTime([55, 110, 165][i] * sag, t, 0.5));
            machBp.frequency.setTargetAtTime(320 * sag, t, 0.5);
        },

        /** Random events (birds, crickets, clangs) up to context time tEnd. */
        scheduleUntil(tEnd) {
            if (!running) return;
            const a = AMB[mood];
            const t = ctx.currentTime;
            // Gusts: drift the wind filter now and then.
            if (Math.random() < 0.02) windLp.frequency.setTargetAtTime(280 + Math.random() * 420, t, 2.5);
            if (a.birds && nextBird < tEnd) {
                chirp(ctx, out, Math.max(t, nextBird), { base: 2600 + Math.random() * 1800, count: 2 + Math.floor(Math.random() * 4), gain: 0.055, pan: (Math.random() - 0.5) * 1.6 });
                nextBird = Math.max(t, nextBird) + (3 + Math.random() * 6) / a.birds;
            } else if (!a.birds) nextBird = tEnd + 2;
            if (a.crickets && nextCricket < tEnd) {
                cricket(ctx, out, Math.max(t, nextCricket), { pulses: 3 + Math.floor(Math.random() * 3), gain: 0.024, pan: (Math.random() - 0.5) * 1.6 });
                nextCricket = Math.max(t, nextCricket) + (0.7 + Math.random() * 1.2) / a.crickets;
            } else if (!a.crickets) nextCricket = tEnd + 1;
            if (a.clangs && nextClang < tEnd) {
                metal(ctx, wet, Math.max(t, nextClang), 160 + Math.random() * 380, { vel: 0.35, decay: 1.6, pan: (Math.random() - 0.5) * 1.8 });
                nextClang = Math.max(t, nextClang) + (8 + Math.random() * 10) / a.clangs;
            } else if (!a.clangs) nextClang = tEnd + 4;
        },
    };
}
