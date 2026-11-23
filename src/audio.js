// src/audio.js — the sound engine. Owns the AudioContext (created on the
// player's first click or key press, as browsers require), the mixer, the
// procedural score (music.js), the valley's ambience (ambience.js), the
// effect cues (sfx.js) and DELTA's recorded voice. No DOM beyond <audio>
// elements for voice clips, and no knowledge of the simulation: main.js
// feeds it a small world snapshot every frame, the tick's FactoryEvents and
// explicit cues for player actions; ui.js reaches it through hooks.
//
// Mixer:  music ─ pause lowpass ─ duck ┐
//         ambience ─ pause lowpass ─ duck ┼─ master ─ compressor ─ out
//         effects ─────────────────────┤
//         voice ───────────────────────┘      + one shared reverb (sends)
import { impulseResponse } from './synth.js';
import { createMusic } from './music.js';
import { createAmbience } from './ambience.js';
import { CUES, CUE_META } from './sfx.js';
import { voiceKey } from './voiceLines.js';
import { PAD_POS } from './config.js';

const SETTINGS_KEY = 'selene.audio.v1';
const DEFAULTS = { master: 0.8, music: 0.6, sfx: 0.8, voice: 1, muted: false };
const LOOKAHEAD = 0.35; // seconds of music scheduled ahead of the clock
const VOICE_BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/voice/`;

/** Size of the thud when a machine is placed. */
export const BUILD_SIZE = { belt: 0.5, splitter: 0.7, merger: 0.7, extractor: 1, smelter: 1.2, assembler: 1.15, generator: 1.3, lab: 1.05 };

const curve = (v) => Math.max(0, Math.min(1, v)) ** 2; // slider → perceived loudness

function loadSettings() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

export function createAudio() {
    const settings = loadSettings();
    let ctx = null;
    let n = null; // mixer nodes
    let music = null;
    let amb = null;
    let driver = null;
    let mood = 0;
    let scoreStarted = false;
    let awaitingEnding = false;
    const lastCue = new Map();
    let combo = 0;
    let comboUntil = 0;
    const seen = { init: false, orderStart: null, orderStatus: 'none', techCount: 0, brownout: false, paused: false };
    const devLog = import.meta.env?.DEV ? [] : null;

    // ---- Voice manifest (clips are optional: without them DELTA is text-only) ----
    let manifest = null;
    let voice = null; // { el, timers }
    fetch(`${VOICE_BASE}manifest.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => { manifest = m && typeof m === 'object' ? m : null; })
        .catch(() => {});

    function build() {
        ctx = new AudioContext({ latencyHint: 'interactive' });
        const g = (v = 1) => {
            const node = ctx.createGain();
            node.gain.value = v;
            return node;
        };
        const lowpass = () => {
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = 20000;
            f.Q.value = 0.5;
            return f;
        };
        n = {
            master: g(), comp: ctx.createDynamicsCompressor(), makeup: g(1.8),
            reverb: ctx.createConvolver(), reverbReturn: g(0.32),
            music: g(), musicPause: lowpass(), musicDuck: g(), musicWet: g(0.6),
            amb: g(), ambPause: lowpass(), ambDuck: g(), ambWet: g(0.5),
            sfx: g(), sfxWet: g(0.8),
            voice: g(), ending: null,
        };
        n.comp.threshold.value = -12;
        n.comp.knee.value = 10;
        n.comp.ratio.value = 4;
        n.comp.attack.value = 0.004;
        n.comp.release.value = 0.25;
        n.master.connect(n.comp).connect(n.makeup).connect(ctx.destination);
        n.reverb.buffer = impulseResponse(ctx);
        n.reverb.connect(n.reverbReturn).connect(n.master);
        n.music.connect(n.musicPause).connect(n.musicDuck).connect(n.master);
        n.musicWet.connect(n.reverb);
        n.amb.connect(n.ambPause).connect(n.ambDuck).connect(n.master);
        n.ambWet.connect(n.reverb);
        n.sfx.connect(n.master);
        n.sfxWet.connect(n.reverb);
        n.voice.connect(n.master);
        applySettings();

        music = createMusic(ctx, { dry: n.music, wet: n.musicWet });
        amb = createAmbience(ctx, { out: n.amb, wet: n.ambWet });
        driver = setInterval(() => {
            if (ctx.state !== 'running') return;
            const until = ctx.currentTime + LOOKAHEAD;
            music.scheduleUntil(until);
            amb.scheduleUntil(until);
        }, 60);
        // Background tabs throttle timers; rather than stutter, go quiet until we're back.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) ctx.suspend();
            else ctx.resume();
        });
    }

    function applySettings() {
        if (!n) return;
        const t = ctx.currentTime;
        n.master.gain.setTargetAtTime(settings.muted ? 0 : curve(settings.master), t, 0.05);
        n.music.gain.setTargetAtTime(curve(settings.music) * 1.6, t, 0.05);
        n.amb.gain.setTargetAtTime(curve(settings.sfx) * 1.4, t, 0.05);
        n.sfx.gain.setTargetAtTime(curve(settings.sfx), t, 0.05);
        n.voice.gain.setTargetAtTime(curve(settings.voice) * 1.2, t, 0.05);
    }

    /** Create/resume the context. Call from a user gesture. */
    function unlock() {
        if (!ctx) build();
        if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
        if (!scoreStarted) {
            scoreStarted = true;
            music.start(ctx.currentTime + 0.1, mood);
            amb.start(ctx.currentTime + 0.1, mood);
        }
    }

    function cue(name, opts = {}) {
        if (!ctx || !CUES[name]) return;
        const meta = CUE_META[name] ?? { gap: 30, gain: 1 };
        const now = performance.now();
        if (now - (lastCue.get(name) ?? -1e9) < meta.gap) return;
        lastCue.set(name, now);
        const dry = ctx.createGain();
        dry.gain.value = meta.gain;
        dry.connect(opts.bus ?? n.sfx);
        const wet = ctx.createGain();
        wet.gain.value = meta.gain;
        wet.connect(opts.wetBus ?? n.sfxWet);
        try {
            CUES[name]({ ctx, out: dry, wet, mood: opts.mood ?? mood }, ctx.currentTime + 0.01, opts);
        } catch (err) {
            console.warn(`sound cue ${name} failed`, err);
        }
        const life = name === 'ending' ? 30000 : 8000;
        setTimeout(() => { dry.disconnect(); wet.disconnect(); }, life);
        devLog?.push({ name, at: Math.round(now) });
        if (devLog && devLog.length > 300) devLog.shift();
    }

    function duck(on) {
        if (!n) return;
        const t = ctx.currentTime;
        n.musicDuck.gain.setTargetAtTime(on ? 0.42 : 1, t, on ? 0.08 : 0.5);
        n.ambDuck.gain.setTargetAtTime(on ? 0.55 : 1, t, on ? 0.08 : 0.5);
    }

    // ---- Voice --------------------------------------------------------------------
    function clipFor(line) {
        return manifest?.lines?.[voiceKey(line)] ?? null;
    }

    /** DELTA: a touch of presence. NILE broadcasts: a narrow PA-system band with a little room. */
    function voiceChain(line) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = line.who === 'nile' ? 280 : 90;
        const eq = ctx.createBiquadFilter();
        if (line.who === 'nile') {
            eq.type = 'lowpass';
            eq.frequency.value = 3600;
            const send = ctx.createGain();
            send.gain.value = 0.35;
            eq.connect(send).connect(n.sfxWet);
        } else {
            eq.type = 'peaking';
            eq.frequency.value = 3200;
            eq.gain.value = 2;
            eq.Q.value = 0.8;
        }
        hp.connect(eq).connect(n.voice);
        return hp;
    }

    function stopVoice() {
        if (!voice) return;
        const v = voice;
        voice = null;
        v.timers.forEach(clearTimeout);
        v.el.pause();
        v.el.removeAttribute('src');
        setTimeout(() => v.src.disconnect(), 50);
        duck(false);
    }

    /** Play the recorded clip for a line. Returns its length in ms, or null when there is none. */
    function speak(line) {
        if (!ctx || settings.muted || settings.voice <= 0.01) return null;
        const clip = clipFor(line);
        if (!clip) return null;
        stopVoice();
        const el = new Audio(VOICE_BASE + clip.file);
        el.preload = 'auto';
        const src = ctx.createMediaElementSource(el);
        src.connect(voiceChain(line));
        const v = { el, src, timers: [] };
        voice = v;
        if (line.mood === 'glitch') {
            // DELTA's voice catches on itself: brief pitch wobbles.
            el.preservesPitch = false;
            const wobble = () => {
                if (voice !== v) return;
                el.playbackRate = Math.random() < 0.3 ? 0.86 + Math.random() * 0.08 : 1;
                v.timers.push(setTimeout(wobble, 120 + Math.random() * 260));
            };
            wobble();
        }
        el.addEventListener('ended', () => { if (voice === v) stopVoice(); });
        el.play().catch(() => { if (voice === v) stopVoice(); });
        duck(true);
        return clip.ms ?? null;
    }

    /** Ending: voice the lines one after another, each no earlier than its text appears. */
    function speakSequence(lines, delaysSec) {
        if (!ctx) return;
        let at = 0;
        lines.forEach((line, i) => {
            const clip = clipFor(line);
            if (!clip) return;
            at = Math.max(at, (delaysSec[i] ?? 0) * 1000);
            const start = at;
            setTimeout(() => speak(line), start);
            at = start + (clip.ms ?? 3000) + 350;
        });
    }

    // ---- Game state → sound ----------------------------------------------------------
    function setMood(next, { transition }) {
        if (next === mood) return;
        const step = next - mood;
        mood = next;
        if (!ctx) return;
        if (next === 5 && transition) {
            // The last phase is done: the ending sequence is the payoff, not a stinger.
            awaitingEnding = true;
            music.silence(2.5, { drone: true });
            amb.setMood(next);
            return;
        }
        if (transition && step === 1) {
            cue(next === 4 ? 'reveal' : 'phase');
            music.setMood(next, { restSec: next === 4 ? 3.9 : 3.2 });
            amb.setMood(next);
        } else {
            music.setMood(next, { instant: true });
            amb.setMood(next, { instant: true });
        }
    }

    return {
        unlock,
        cue,

        /** A campaign starts (new or resumed): snap to its mood, no stingers for the jump. */
        begin(startMood, { fresh = false } = {}) {
            unlock();
            setMood(startMood, { transition: false });
            seen.init = false;
            if (fresh) cue('begin');
        },

        /**
         * Per-frame world snapshot: { mood, paused, throttle, working, orderStatus,
         * orderStart, techCount, playing }. Detects transitions and cues them.
         */
        update(dt, w) {
            if (!ctx) return;
            if (w.mood !== mood) setMood(w.mood, { transition: w.playing && seen.init });

            // Pause: muffle music and ambience.
            if (w.paused !== seen.paused) {
                seen.paused = w.paused;
                const t = ctx.currentTime;
                for (const f of [n.musicPause, n.ambPause]) f.frequency.setTargetAtTime(w.paused ? 750 : 20000, t, 0.15);
            }
            amb.setFactory({ working: w.working, throttle: w.throttle });
            if (!w.playing) return;

            if (!seen.init) {
                Object.assign(seen, { init: true, orderStart: w.orderStart, orderStatus: w.orderStatus, techCount: w.techCount, brownout: w.throttle < 0.95 });
                return;
            }
            if (w.orderStatus === 'active' && w.orderStart !== seen.orderStart) cue('orderStart');
            if (seen.orderStatus === 'active' && w.orderStatus === 'completed') cue('orderDone');
            if (seen.orderStatus === 'active' && w.orderStatus === 'failed') cue('orderFail');
            seen.orderStart = w.orderStart;
            seen.orderStatus = w.orderStatus;
            if (w.techCount > seen.techCount) cue('tech');
            seen.techCount = w.techCount;
            if (!seen.brownout && w.throttle < 0.95) {
                seen.brownout = true;
                cue('brownout');
            } else if (seen.brownout && w.throttle >= 0.999) {
                seen.brownout = false;
                cue('powerup');
            }
        },

        /** The tick's FactoryEvents: deliveries chime, climbing the scale while they keep coming. */
        onEvents(events) {
            if (!ctx || !events.length) return;
            let delivered = 0;
            for (const ev of events) {
                if (ev.kind === 'consume' && ev.at.x === PAD_POS.x && ev.at.y === PAD_POS.y) delivered++;
            }
            if (!delivered) return;
            const now = performance.now();
            combo = now < comboUntil ? combo + 1 : 0;
            comboUntil = now + 1600;
            cue('deliver', { combo });
        },

        // ---- Comms hooks (called by ui.js) ----
        /** A comms line starts typing. `fresh` = a new transmission. Returns the voice clip's ms, or null. */
        lineStart(line, { fresh = false } = {}) {
            if (line.who === 'memo') cue('memo');
            else if (fresh) cue('quindarIn');
            if (line.mood === 'glitch') cue('glitch');
            return speak(line);
        },
        lineStop: stopVoice,
        commsIdle() {
            cue('quindarOut');
        },

        // ---- Ending ----
        /** The ending: its sound on the cinematic's timeline ({ fire, ad, report } in seconds), then DELTA's lines. */
        ending(lines, delaysSec, times = {}) {
            unlock();
            awaitingEnding = false;
            music.silence(1.2);
            // Its own buses, so skipping can silence everything still scheduled.
            const bus = ctx.createGain();
            const wetBus = ctx.createGain();
            bus.connect(n.sfx);
            wetBus.connect(n.sfxWet);
            n.ending = [bus, wetBus];
            cue('ending', { bus, wetBus, fireAt: times.fire, adAt: times.ad, finalAt: times.report });
            speakSequence(lines, delaysSec);
        },
        endingSkip() {
            if (!n?.ending) return;
            for (const b of n.ending) b.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
            n.ending = null;
            cue('endingFinal');
        },
        afterEnding() {
            if (!ctx) return;
            awaitingEnding = false;
            music.resume(5);
            amb.setMood(5);
        },

        // ---- Settings ----
        settings: () => ({ ...settings }),
        setSettings(patch) {
            Object.assign(settings, patch);
            try {
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            } catch { /* private mode: settings just won't persist */ }
            applySettings();
            if (settings.muted) stopVoice();
        },
        toggleMute() {
            this.setSettings({ muted: !settings.muted });
            return settings.muted;
        },
        /** How many voice clips are installed (0 = DELTA is text-only). */
        voiceLines: () => Object.keys(manifest?.lines ?? {}).length,

        // ---- Dev / tests ----
        get context() { return ctx; },
        get mood() { return mood; },
        get speaking() { return !!voice; },
        get musicDuck() { return n ? n.musicDuck.gain.value : 1; },
        get awaitingEnding() { return awaitingEnding; },
        log: devLog,
        playMood(m) {
            unlock();
            setMood(m, { transition: false });
            if (awaitingEnding || m === 5) music.resume(m);
        },
    };
}
