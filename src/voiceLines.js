// src/voiceLines.js — which comms lines get a recorded voice, and the stable
// key each clip is stored under. Shared by the game (audio.js) and the
// generator (scripts/voice.mjs), so both derive identical keys. Pure data,
// no DOM: it runs in Node too.
//
// A key hashes speaker, mood and text, so editing a line (or its mood) makes
// it a new key: the old clip simply stops matching and the generator records
// the new one. Lines are enumerated exactly as director.js builds them.
import { STORY_BEATS, OBJECTIVES, AMBIENT, REACTIONS, ENDING, ENDING_HQ, CHOICE, welcomeBack, INFINITE, LOCKE, EPILOGUE } from './story.js';

/** Speakers with a voice. Memos are read, not spoken. */
export const VOICED = new Set(['delta', 'nile', 'boss']);

function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Clip key for a comms line: `delta-1a2b3c4d`. */
export const voiceKey = (line) => `${line.who}-${fnv1a(`${line.who}|${line.mood ?? ''}|${line.text}`)}`;

/**
 * Every line the game can voice, de-duplicated by key, in play order:
 * [{ key, who, mood, text, previous }] where `previous` is the line spoken
 * just before it in the same beat (for natural delivery), if any.
 */
export function collectVoiceLines() {
    const out = new Map();
    const add = (line, previous = null) => {
        if (!VOICED.has(line.who)) return;
        const key = voiceKey(line);
        if (!out.has(key)) out.set(key, { key, who: line.who, mood: line.mood ?? null, text: line.text, previous });
    };
    const delta = (text, mood) => ({ who: 'delta', text, mood });

    add(welcomeBack(0));
    add(welcomeBack(4));
    add(welcomeBack(5, 'hq'));
    // The campaign's beats, Nolan's pre-reveal ones (story.js LOCKE) slotted in where they play.
    for (const beat of STORY_BEATS) {
        let prev = null;
        for (const line of beat.lines) {
            add(line, prev && prev.who === line.who ? prev.text : null);
            prev = line;
        }
    }
    for (const phase of OBJECTIVES) for (const o of phase) if (o.hint) add(delta(o.hint));
    for (const t of [...AMBIENT.early, ...LOCKE.AMBIENT]) add(typeof t === 'string' ? delta(t) : t);
    for (const t of AMBIENT.late) add(typeof t === 'string' ? delta(t, 'sinister') : t);
    for (const text of [...REACTIONS.orderCompleted, ...REACTIONS.orderFailed]) add(delta(text));
    for (const text of AMBIENT.free) add(delta(text, 'happy'));
    for (const lines of [CHOICE.lines, ENDING.lines, ENDING_HQ.lines]) {
        let prev = null;
        for (const line of lines) {
            add(line, prev && prev.who === line.who ? prev.text : null);
            prev = line;
        }
    }
    // Infinite mode's own script (the same director, its own beats and objectives).
    add(INFINITE.welcomeBack());
    for (const beat of INFINITE.BEATS) {
        let before = null;
        for (const line of beat.lines) {
            add(line, before && before.who === line.who ? before.text : null);
            before = line;
        }
    }
    for (const stage of INFINITE.OBJECTIVES) for (const o of stage) if (o.hint) add(delta(o.hint));
    for (const text of INFINITE.AMBIENT.early) add(delta(text));
    // The epilogue after the NIHIL HQ ending (iteration 7): its beats, hints, chatter, reactions.
    for (const beat of EPILOGUE.BEATS) {
        let before = null;
        for (const line of beat.lines) {
            add(line, before && before.who === line.who ? before.text : null);
            before = line;
        }
    }
    for (const o of EPILOGUE.OBJECTIVES) if (o.hint) add(delta(o.hint));
    for (const text of EPILOGUE.AMBIENT) add(delta(text, 'happy'));
    for (const text of [...EPILOGUE.REACTIONS.orderCompleted, ...EPILOGUE.REACTIONS.orderFailed]) add(delta(text));
    return [...out.values()];
}
