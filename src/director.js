// src/director.js — the story director. Watches a world snapshot (built by
// main.js) and decides what DELTA says and when: story beats, tutorial
// objectives, nudges for a stuck player, order reactions, ambient chatter and
// the ending trigger. No DOM, no Pixi — it talks to the UI through callbacks.
// All text comes from story.js.
import { BEATS, OBJECTIVES, AMBIENT, REACTIONS, WELCOME_BACK } from './story.js';

// Timings are in simulation ticks (4/s at 1× speed), so pausing the game
// also pauses DELTA's nagging.
const HINT_DELAY = 180;     // an open objective untouched this long earns a hint (~45 s)
const HINT_REPEAT = 900;    // and the same hint repeats at most this often (~4 min)
const AMBIENT_EVERY = 1100; // idle chatter cadence (~4.5 min)
const REACTION_CHANCE = 0.5;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * @param {{
 *   say: (line: {who: string, text: string, mood?: string}) => void,
 *   banner: (phaseIndex: number) => void,
 *   ending: () => void,
 *   isBusy: () => boolean,   // is the comms panel still talking?
 * }} io
 */
export function createDirector({ say, banner, ending, isBusy }) {
    /** Fired beat ids, ticked objectives (`obj:<phase>:<id>`), used ambient lines. Persisted. */
    let flags = new Set();
    let objectives = [];
    let lastAmbient = 0;
    let stuck = { key: null, since: 0 };
    const lastHintAt = new Map();
    let lastOrderKey = null;

    // Beats play one at a time, and only once DELTA has stopped talking; the
    // condition is re-checked at that moment, so a tutorial step the player
    // already finished is skipped instead of arriving late. Phase banners
    // don't wait — they show the moment the phase completes.
    function runBeats(w) {
        for (const beat of BEATS) {
            if (beat.banner == null || flags.has(`banner:${beat.id}`) || !beat.when(w)) continue;
            flags.add(`banner:${beat.id}`);
            banner(beat.banner);
        }
        if (isBusy()) return;
        const beat = BEATS.find((b) => !flags.has(b.id) && b.when(w));
        if (!beat) return;
        flags.add(beat.id);
        for (const line of beat.lines) say(line);
    }

    function computeObjectives(w) {
        const list = OBJECTIVES[w.phase] ?? [];
        objectives = list.map((o) => {
            const key = `obj:${w.phase}:${o.id}`;
            if (!flags.has(key) && o.done(w)) flags.add(key); // sticky once done
            return { id: o.id, text: o.text, hint: o.hint, focus: o.focus ?? null, done: flags.has(key) };
        });
    }

    function maybeHint(w) {
        const open = objectives.find((o) => !o.done);
        const key = open ? `${w.phase}:${open.id}` : null;
        if (key !== stuck.key) {
            stuck = { key, since: w.tick };
            return;
        }
        if (!open?.hint || isBusy() || w.tick - stuck.since < HINT_DELAY) return;
        const last = lastHintAt.get(key);
        if (last != null && w.tick - last < HINT_REPEAT) return;
        lastHintAt.set(key, w.tick);
        say({ who: 'delta', text: open.hint });
    }

    function maybeReactToOrder(w) {
        const o = w.order;
        if (o.status !== 'completed' && o.status !== 'failed') return;
        const key = `${o.startTick}:${o.status}`;
        if (key === lastOrderKey) return;
        lastOrderKey = key;
        if (isBusy() || Math.random() > REACTION_CHANCE) return;
        say({ who: 'delta', text: pick(o.status === 'completed' ? REACTIONS.orderCompleted : REACTIONS.orderFailed) });
    }

    function maybeAmbient(w) {
        if (isBusy() || w.tick - lastAmbient < AMBIENT_EVERY) return;
        lastAmbient = w.tick;
        const pool = (w.phase >= 4 ? AMBIENT.late : AMBIENT.early).filter((t) => !flags.has(`amb:${t}`));
        if (!pool.length) return;
        const text = pick(pool);
        flags.add(`amb:${text}`);
        say({ who: 'delta', text, mood: w.phase >= 4 ? 'sinister' : undefined });
    }

    return {
        /** Called a few times per second while a campaign is running. */
        update(w) {
            if (w.complete && !flags.has('ending')) {
                flags.add('ending');
                ending();
                return;
            }
            runBeats(w);
            computeObjectives(w);
            maybeHint(w);
            maybeReactToOrder(w);
            maybeAmbient(w);
        },

        /** The active phase's checklist as of the last update. */
        objectives: () => objectives,

        /** Has the ending already been reached (e.g. after loading a finished save)? */
        ended: () => flags.has('ending'),

        save: () => ({ flags: [...flags] }),

        /** Restore after loading a game; `tick` is the restored sim clock. */
        load(data, tick) {
            flags = new Set(data?.flags ?? []);
            lastAmbient = tick;
            stuck = { key: null, since: tick };
            lastHintAt.clear();
            lastOrderKey = null;
            if (flags.size) say(WELCOME_BACK);
        },
    };
}
