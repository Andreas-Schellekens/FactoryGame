// src/director.js — the story director. Watches a world snapshot (built by
// main.js) and decides what DELTA says and when: story beats, tutorial
// objectives, nudges for a stuck player, order reactions, ambient chatter and
// the ending trigger. No DOM, no Pixi — it talks to the UI through callbacks.
// All text comes from story.js.
import { STORY_BEATS, OBJECTIVES, AMBIENT, REACTIONS, welcomeBack, LOCKE, EPILOGUE } from './story.js';

// Timings are in simulation ticks (4/s at 1× speed), so pausing the game
// also pauses DELTA's nagging.
const HINT_DELAY = 180;     // an open objective untouched this long earns a hint (~45 s)
const LEARNING_HINT_DELAY = 80; // ...in Story's first two phases (~20 s)
const HINT_REPEAT = 900;    // and the same hint repeats at most this often (~4 min)
const AMBIENT_EVERY = 1100; // idle chatter cadence (~4.5 min)
const REACTION_CHANCE = 0.5;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * The campaign's script (with Nolan's pre-reveal beats and chatter, story.js LOCKE). Infinite mode
 * passes its own (story.js INFINITE) through `script`, and so does the epilogue (below).
 */
export const STORY_SCRIPT = {
    BEATS: STORY_BEATS, OBJECTIVES, AMBIENT: { ...AMBIENT, early: [...AMBIENT.early, ...LOCKE.AMBIENT] },
    REACTIONS, welcomeBack, lateFrom: 4,
};

/**
 * After the NIHIL HQ ending: the company's epilogue (story.js EPILOGUE, epilogue.js). One list of
 * goals in the flight plan (until the report has been shown), the founder's chatter, the company's
 * own order reactions; once the `finale` beat has played and DELTA is quiet, `finale()` brings up
 * the report.
 */
export const EPILOGUE_SCRIPT = {
    BEATS: EPILOGUE.BEATS,
    OBJECTIVES: (w) => (w.epilogue && !w.epilogue.closed ? EPILOGUE.OBJECTIVES : []),
    AMBIENT: { early: [], late: [], free: [...AMBIENT.free, ...EPILOGUE.AMBIENT] },
    REACTIONS: EPILOGUE.REACTIONS,
    welcomeBack,
    finale: 'epi:valley',
};

/**
 * @param {{
 *   say: (line: {who: string, text: string, mood?: string}) => void,
 *   banner: (phaseIndex: number | { kicker: string, title: string, extra?: string }) => void,
 *   ending: () => void,
 *   finale?: () => void,     // a script's closing beat has played (the epilogue's report)
 *   isBusy: () => boolean,   // is the comms panel still talking?
 *   script?: () => typeof STORY_SCRIPT,   // which script plays (the mode's)
 *   hints?: () => boolean,   // the "DELTA's hints" setting
 * }} io
 */
export function createDirector({ say, banner, ending, finale = () => {}, isBusy, script = () => STORY_SCRIPT, hints = () => true }) {
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
        const { BEATS } = script();
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
        const { OBJECTIVES } = script();
        const list = (typeof OBJECTIVES === 'function' ? OBJECTIVES(w) : OBJECTIVES[w.phase]) ?? [];
        objectives = list.map((o) => {
            const key = `obj:${w.phase}:${o.id}`;
            if (!flags.has(key) && o.done(w)) flags.add(key); // sticky once done
            return {
                id: o.id, text: o.text, hint: o.hint, focus: o.focus ?? null, key: o.key ?? null, ui: o.ui ?? null,
                how: o.how ?? null, schema: o.schema ?? null, done: flags.has(key), // how/schema: the tutorial card
            };
        });
    }

    function maybeHint(w) {
        const open = objectives.find((o) => !o.done);
        const key = open ? `${w.phase}:${open.id}` : null;
        if (key !== stuck.key) {
            stuck = { key, since: w.tick };
            return;
        }
        // While learning (Story's first two phases) DELTA steps in sooner.
        const delay = w.mode === 'story' && w.phase <= 1 ? LEARNING_HINT_DELAY : HINT_DELAY;
        if (!open?.hint || !hints() || isBusy() || w.tick - stuck.since < delay) return;
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
        const { REACTIONS } = script();
        say({ who: 'delta', text: pick(o.status === 'completed' ? REACTIONS.orderCompleted : REACTIONS.orderFailed) });
    }

    function maybeAmbient(w) {
        if (isBusy() || w.tick - lastAmbient < AMBIENT_EVERY) return;
        lastAmbient = w.tick;
        // Plain strings are DELTA; a line object (Nolan's memo) speaks as itself.
        const textOf = (t) => (typeof t === 'string' ? t : t.text);
        const { AMBIENT, lateFrom = Infinity } = script();
        // After the HQ ending (Story) DELTA is a co-founder: her own, happier chatter.
        const free = w.ending === 'hq' && !!AMBIENT.free;
        const late = !free && w.phase >= lateFrom;
        const pool = (free ? AMBIENT.free : late ? AMBIENT.late : AMBIENT.early).filter((t) => !flags.has(`amb:${textOf(t)}`));
        if (!pool.length) return;
        const line = pick(pool);
        flags.add(`amb:${textOf(line)}`);
        const mood = free ? 'happy' : late ? 'sinister' : undefined;
        say(typeof line === 'string' ? { who: 'delta', text: line, mood } : line);
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
            // A script's closing beat (the epilogue's) has been said: once, when DELTA is quiet.
            const { finale: last } = script();
            if (last && flags.has(last) && !flags.has(`finale:${last}`) && !isBusy()) {
                flags.add(`finale:${last}`);
                finale();
            }
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

        /** Restore after loading a game; `tick` is the restored sim clock, `phase` the campaign phase. */
        load(data, tick, phase = 0, ending = null) {
            flags = new Set(data?.flags ?? []);
            lastAmbient = tick;
            stuck = { key: null, since: tick };
            lastHintAt.clear();
            lastOrderKey = null;
            if (flags.size) say(script().welcomeBack(phase, ending));
        },
    };
}
