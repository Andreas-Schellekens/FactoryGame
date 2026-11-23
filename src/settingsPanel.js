// src/settingsPanel.js — the Settings panel (top bar gear, title screen): tabs for Audio,
// Graphics, Gameplay, Controls (with rebinding) and Accessibility. It only edits the store
// (settings.js) and the sound engine's volumes; main.js applies the values.

import { DEFAULT_KEYS, RESERVED_KEYS, keyLabel } from './settings.js';
import { BUILDING_NAMES } from './story.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

const ACTION_NAMES = {
    upgrade: 'Upgrade tool', erase: 'Demolish tool', select: 'Select tool', pipette: 'Pipette (build what is under the cursor)',
    rotate: 'Rotate before placing', viewLeft: 'Turn the view left', viewRight: 'Turn the view right', pause: 'Pause',
    mute: 'Sound on / off', move: 'Move the selection', copy: 'Copy the selection',
};
const actionName = (a) => ACTION_NAMES[a] ?? BUILDING_NAMES[a] ?? a;
const FIXED_KEYS = [
    ['WASD / arrows', 'move the view'], ['Wheel', 'zoom'], ['Middle drag', 'pan'], ['Right click', 'demolish (refunds)'],
    ['Delete', 'demolish tool'], ['+ / −', 'sim speed'], ['Esc', 'close a panel, drop a selection'],
];

/**
 * @param {{ settings: any, sound?: any, menus: any, account: any }} opts
 */
export function createSettingsPanel({ settings, sound, menus, account }) {
    let tab = 'audio';

    function open(start = tab) {
        tab = start;
        const m = menus.openModal({ kicker: 'Configuration', title: 'Settings', wide: true });
        const tabs = el('div', 'mm-tabs');
        const content = el('div', 'set-body');
        const foot = el('p', 'mm-note set-foot');
        const tabBtns = {};
        for (const [id, label] of [['audio', 'Audio'], ['graphics', 'Graphics'], ['gameplay', 'Gameplay'], ['controls', 'Controls'], ['access', 'Accessibility']]) {
            const b = el('button', `mm-tab${id === tab ? ' on' : ''}`, label);
            b.type = 'button';
            b.addEventListener('click', () => {
                tab = id;
                for (const [k, t] of Object.entries(tabBtns)) t.classList.toggle('on', k === tab);
                render();
                sound?.cue('key');
            });
            tabBtns[id] = b;
            tabs.appendChild(b);
        }
        const reset = el('button', 'btn-secondary', 'Reset this tab');
        reset.type = 'button';
        reset.addEventListener('click', () => {
            settings.reset(tab);
            if (tab === 'audio') sound?.setSettings(settings.get().audio);
            render();
        });
        const footRow = el('div', 'mm-foot');
        footRow.append(reset, foot);
        m.body.append(tabs, content, footRow);

        const renderFoot = () => {
            foot.textContent = account.state.user ? 'Saved in this browser and in your account.' : 'Saved in this browser.';
        };
        function render() {
            content.innerHTML = '';
            ({ audio, graphics, gameplay, controls, access })[tab]();
            renderFoot();
        }

        // ---- Controls ----
        const row = (label, control, hint = null) => {
            const r = el('div', 'set-row');
            const l = el('div', 'set-label');
            l.appendChild(el('span', null, label));
            if (hint) l.appendChild(el('span', 'set-hint', hint));
            r.append(l, control);
            content.appendChild(r);
            return r;
        };
        const toggle = (section, key, label, hint) => {
            const b = el('button', 'set-toggle');
            b.type = 'button';
            const paint = () => {
                const on = !!settings.get()[section][key];
                b.textContent = on ? 'On' : 'Off';
                b.classList.toggle('on', on);
                b.setAttribute('aria-pressed', String(on));
            };
            b.addEventListener('click', () => {
                settings.set(section, { [key]: !settings.get()[section][key] });
                paint();
                sound?.cue('key');
            });
            paint();
            row(label, b, hint);
        };
        const choice = (section, key, label, options, hint) => {
            const box = el('div', 'set-seg');
            const paint = () => {
                for (const b of box.children) b.classList.toggle('on', b.dataset.v === String(settings.get()[section][key]));
            };
            for (const [value, text] of options) {
                const b = el('button', null, text);
                b.type = 'button';
                b.dataset.v = String(value);
                b.addEventListener('click', () => {
                    settings.set(section, { [key]: value });
                    paint();
                    sound?.cue('key');
                });
                box.appendChild(b);
            }
            paint();
            row(label, box, hint);
        };
        const slider = (key, label) => {
            const wrap = el('div', 'set-slider snd-row');
            const input = el('input');
            input.type = 'range';
            input.min = '0';
            input.max = '100';
            const value = el('span', 'snd-value');
            const st = sound?.settings() ?? settings.get().audio;
            input.value = String(Math.round((st[key] ?? 0) * 100));
            value.textContent = input.value;
            input.addEventListener('input', () => {
                value.textContent = input.value;
                sound?.setSettings({ [key]: Number(input.value) / 100 });
                settings.set('audio', { [key]: Number(input.value) / 100 });
            });
            input.addEventListener('change', () => {
                if (key === 'master' || key === 'sfx') sound?.cue('key');
            });
            wrap.append(input, value);
            row(label, wrap);
        };

        // ---- Tabs ----
        function audio() {
            for (const [k, l] of [['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects and ambience'], ['voice', 'Voice']]) slider(k, l);
            const mute = el('button', 'set-toggle');
            mute.type = 'button';
            const paint = () => {
                const muted = !!(sound?.settings() ?? settings.get().audio).muted;
                mute.textContent = muted ? 'Muted' : 'Playing';
                mute.classList.toggle('on', !muted);
            };
            mute.addEventListener('click', () => {
                sound?.toggleMute();
                settings.set('audio', { muted: !!sound?.settings().muted });
                paint();
            });
            paint();
            row('All sound', mute, `Also on the ${keyLabel(settings.get().keys.mute)} key`);
            const lines = sound?.voiceLines() ?? 0;
            content.appendChild(el('p', 'mm-note', lines ? `DELTA's voice: ${lines} recorded lines.` : 'DELTA’s voice is not recorded yet: her lines are text only.'));
        }
        function graphics() {
            toggle('graphics', 'shadows', 'Shadows', 'Soft shadows from the sun; off is faster');
            choice('graphics', 'renderScale', 'Render scale', [[0.5, '50%'], [0.75, '75%'], [1, '100%']], 'Fewer pixels is faster on slow machines');
            choice('graphics', 'particles', 'Particles', [['off', 'Off'], ['low', 'Low'], ['high', 'High']], 'Smoke, dust, sparks, ash and butterflies');
            toggle('graphics', 'shake', 'Camera shake', 'On big moments and builds');
        }
        function gameplay() {
            choice('gameplay', 'autosave', 'Autosave', [[0, 'Off'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']], 'Also on every phase and when you leave');
            toggle('gameplay', 'hints', 'DELTA’s hints', 'A nudge when an objective stays open for a while');
            choice('gameplay', 'textSpeed', 'Text speed', [[0.6, 'Slow'], [1, 'Normal'], [1.6, 'Fast'], [99, 'Instant']], 'How fast DELTA’s lines type out (with a voice, they follow it)');
            toggle('gameplay', 'voice', 'DELTA’s voice', 'Off: her lines stay text only');
        }
        function controls() {
            const keys = settings.get().keys;
            const grid = el('div', 'key-grid');
            for (const action of Object.keys(DEFAULT_KEYS)) {
                const r = el('div', 'key-row');
                const cap = el('button', 'keycap', keyLabel(keys[action]));
                cap.type = 'button';
                cap.title = 'Click, then press a key';
                cap.addEventListener('click', () => capture(action, cap));
                r.append(el('span', 'key-name', actionName(action)), cap);
                grid.appendChild(r);
            }
            content.appendChild(grid);
            content.appendChild(el('p', 'mm-note', 'Click a key, then press the new one. A key that was in use swaps with it.'));
            const fixed = el('div', 'key-fixed');
            for (const [k, v] of FIXED_KEYS) {
                const r = el('div', 'key-row');
                r.append(el('span', 'key-name', v), el('span', 'keycap fixed', k));
                fixed.appendChild(r);
            }
            content.append(el('span', 'con-label', 'Fixed'), fixed);
        }
        function capture(action, cap) {
            cap.textContent = 'Press…';
            cap.classList.add('waiting');
            menus.setCapturing(true);
            const onKey = (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.removeEventListener('keydown', onKey, true);
                menus.setCapturing(false);
                const k = e.key.toLowerCase();
                if (e.key !== 'Escape') {
                    if (RESERVED_KEYS.has(k)) sound?.cue('deny');
                    else if (settings.bindKey(action, k)) sound?.cue('key');
                }
                render();
            };
            window.addEventListener('keydown', onKey, true);
        }
        function access() {
            toggle('access', 'colorblind', 'Colour-blind-safe arrows', 'Port arrows in blue, orange and purple instead of teal, orange and red');
            toggle('access', 'reducedMotion', 'Reduced motion', 'No camera shake, zoom kicks, flashes or bouncing panels');
            choice('access', 'uiScale', 'Interface size', [[0.8, '80%'], [0.9, '90%'], [1, '100%'], [1.15, '115%'], [1.3, '130%'], [1.5, '150%']]);
        }

        render();
        const off = account.onChange(renderFoot);
        m.onClose = off;
    }

    return { open };
}
