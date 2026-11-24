// src/settings.js — the player's settings: defaults, localStorage, change listeners, and
// the copy that syncs to the account (account.js). No DOM beyond reading the OS's
// reduced-motion preference for the default; main.js applies each setting to the part
// of the game it belongs to (renderer, audio, HUD, director, input).

const KEY = 'selene.settings.v1';

/** Rebindable actions and their default keys (KeyboardEvent.key, lower case; ' ' = Space). */
export const DEFAULT_KEYS = {
    belt: '1', extractor: '2', smelter: '3', press: '4', foundry: '5', assembler: '6',
    fabricator: '7', lab: '8', mixer: '9', generator: '0',
    splitter: 't', merger: 'y', upgrade: 'u', erase: 'x', select: 'v',
    pipette: 'f', rotate: 'r', viewLeft: 'q', viewRight: 'e', pause: ' ', mute: 'm',
    move: 'g', copy: 'c', alerts: 'n',
};
/** Keys that can't be bound: camera panning, Escape, the speed keys. */
export const RESERVED_KEYS = new Set([
    'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'escape', '+', '=', '-', '_', 'delete', 'backspace', 'tab', 'enter', 'shift', 'control', 'alt', 'meta',
]);

const prefersReducedMotion = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

export function defaults() {
    return {
        audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 1, muted: false },
        graphics: { shadows: true, renderScale: 1, particles: 'high', shake: true },
        gameplay: { autosave: 60, hints: true, textSpeed: 1, voice: true },
        keys: { ...DEFAULT_KEYS },
        access: { colorblind: false, reducedMotion: prefersReducedMotion(), uiScale: 1 },
    };
}

/** Deep-merge saved values over the defaults, dropping keys that no longer exist. */
function merge(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    const out = {};
    for (const [k, v] of Object.entries(base)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(v, saved[k]);
        else out[k] = typeof saved[k] === typeof v ? saved[k] : v;
    }
    return out;
}

/**
 * @param {{ audioDefaults?: object }} [opts]  the sound engine's current settings, so the
 *   first run keeps the volumes the old Sound panel stored.
 */
export function createSettings({ audioDefaults } = {}) {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch { /* private mode or corrupt: defaults */ }
    const base = defaults();
    if (!stored && audioDefaults) base.audio = merge(base.audio, audioDefaults);
    let values = merge(base, stored?.values);
    let updatedAt = stored?.updatedAt ?? 0;
    const listeners = new Set();

    function persist() {
        try {
            localStorage.setItem(KEY, JSON.stringify({ values, updatedAt }));
        } catch { /* settings just won't persist */ }
    }
    function emit(section) {
        for (const fn of listeners) fn(values, section);
    }

    return {
        /** All values (a live object: read, don't write). */
        get: () => values,
        /** When they last changed (ms since epoch), for last-write-wins sync. */
        updatedAt: () => updatedAt,
        /** Change some values of one section, e.g. set('graphics', { shadows: false }). */
        set(section, patch) {
            if (!(section in values)) return;
            const next = merge(values[section], { ...values[section], ...patch });
            if (JSON.stringify(next) === JSON.stringify(values[section])) return;
            values = { ...values, [section]: next };
            updatedAt = Date.now();
            persist();
            emit(section);
        },
        /** Bind `action` to `key`; the action that had it gets the old key (a swap). @returns {boolean} */
        bindKey(action, key) {
            const k = key.toLowerCase();
            if (!(action in DEFAULT_KEYS) || RESERVED_KEYS.has(k)) return false;
            const keys = { ...values.keys };
            const other = Object.keys(keys).find((a) => a !== action && keys[a] === k);
            if (other) keys[other] = keys[action];
            keys[action] = k;
            this.set('keys', keys);
            return true;
        },
        /** Back to the defaults (one section, or everything). */
        reset(section = null) {
            const d = defaults();
            values = section ? { ...values, [section]: d[section] } : d;
            updatedAt = Date.now();
            persist();
            emit(section);
        },
        /** Take the account's copy if it is newer than ours. @returns {boolean} taken */
        adopt(data, at) {
            if (!data || !(at > updatedAt)) return false;
            values = merge(defaults(), data);
            updatedAt = at;
            persist();
            emit(null);
            return true;
        },
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
}

/** How a key is shown on a keycap: 'SPACE', 'F', '1'. */
export function keyLabel(key) {
    if (key === ' ') return 'SPACE';
    return key.length === 1 ? key.toUpperCase() : key.toUpperCase().slice(0, 5);
}
