// src/blueprintPanel.js — the blueprint library's screens (iteration 7), in the menus' modal
// style: the library (key B, or Menu → Blueprints) with a plan of each blueprint, its size,
// machine count and build cost; Place / Rename / Export / Delete; Import a file; and the
// little "name this blueprint" dialog. The store is blueprints.js; placing is main.js's.

import { machinesThumb } from './blueprint.js';
import { costOf, typesOf, MAX_NAME, MAX_BLUEPRINTS } from './blueprints.js';
import { BUILDING_NAMES } from './story.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function button(label, onClick, cls = 'btn-secondary') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}
const fmtCost = (n) => Math.round(n).toLocaleString('en-US');

/**
 * @param {{ menus: any, blueprints: any, account: any, sound?: any,
 *           unlocked?: (type: string) => boolean }} opts
 */
export function createBlueprintPanel({ menus, blueprints, account, sound, unlocked = () => true }) {
    const cue = (name) => sound?.cue(name);

    /** Ask for a name. `onSave(name)` returns an error message or nothing (closes). */
    function askName({ kicker = 'Blueprint', title = 'Save as blueprint', value = '', hint = null, action = 'Save blueprint', onSave }) {
        const m = menus.openModal({ kicker, title });
        const form = el('form', 'mm-form');
        const wrap = el('label', 'mm-field');
        wrap.appendChild(el('span', 'mm-flabel', 'Name'));
        const input = el('input');
        input.type = 'text';
        input.maxLength = MAX_NAME;
        input.required = true;
        input.value = value;
        input.className = 'bp-name-input';
        wrap.appendChild(input);
        const err = el('p', 'mm-error');
        const go = el('button', 'btn-primary small', action);
        go.type = 'submit';
        form.append(wrap);
        if (hint) form.appendChild(el('p', 'mm-fine', hint));
        form.append(err, go);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const problem = onSave(input.value);
            if (problem) {
                err.textContent = problem;
                cue('deny');
                return;
            }
            menus.closeModal();
        });
        m.body.appendChild(form);
        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    }

    /** The library. `onPick(blueprint)` puts one in the player's hand (null: not in a game). */
    function open({ onPick = null } = {}) {
        const m = menus.openModal({ kicker: 'Library', title: 'Blueprints', wide: true });
        const body = m.body;
        const status = el('p', 'mm-status');
        const flash = (text) => {
            status.textContent = text;
            status.classList.remove('pop');
            void status.offsetWidth;
            status.classList.add('pop');
        };
        const list = el('div', 'slot-list bp-list');
        const foot = el('div', 'mm-foot');
        const file = el('input');
        file.type = 'file';
        file.accept = '.json,application/json';
        file.className = 'hidden';
        file.addEventListener('change', async () => {
            const f = file.files?.[0];
            file.value = '';
            if (!f) return;
            const r = await blueprints.importFile(f);
            flash(r.ok ? `Imported “${r.blueprint.name}”` : r.error);
            cue(r.ok ? 'check' : 'deny');
        });
        const note = el('p', 'mm-note');
        foot.append(button('Import file…', () => file.click()), file, note);
        body.append(
            el('p', 'mm-fine', 'Select machines with the select tool and choose Save as blueprint, or copy another player’s factory from the leaderboard. Place puts one in your hand: R turns it, a click builds it (at the build price), red cells don’t fit.'),
            list, status, foot,
        );

        function render() {
            const signedIn = !!account.state.user;
            const all = blueprints.list();
            note.textContent = `${all.length}/${MAX_BLUEPRINTS} · ${signedIn ? 'kept in this browser and in your account' : 'kept in this browser. Sign in to keep them in your account too'}.`;
            list.innerHTML = '';
            if (!all.length) list.appendChild(el('p', 'mm-empty', 'No blueprints yet.'));
            for (const bp of all) list.appendChild(card(bp, signedIn));
        }
        function card(bp, signedIn) {
            const c = el('div', 'slot bp-card');
            c.dataset.id = bp.id;
            const thumb = el('div', 'slot-thumb bp-thumb');
            try {
                thumb.appendChild(machinesThumb(bp.machines, bp.w, bp.h, 128, 96));
            } catch { /* no canvas */ }
            const info = el('div', 'slot-info');
            const missing = typesOf(bp).filter((t) => !unlocked(t));
            info.append(
                el('span', 'slot-name', bp.name),
                el('span', 'slot-meta', `${bp.w} × ${bp.h} cells · ${bp.machines.length} machine${bp.machines.length === 1 ? '' : 's'}`),
                el('span', 'slot-meta', `CR ${fmtCost(costOf(bp))} to build`),
            );
            if (missing.length) info.appendChild(el('span', 'slot-meta bp-missing', `Needs ${missing.map((t) => BUILDING_NAMES[t] ?? t).join(', ')}`));
            const badge = !signedIn ? ['local', 'This browser'] : bp.syncError ? ['error', 'Not synced'] : bp.cloud && !bp.dirty ? ['synced', 'Synced'] : ['local', 'Syncing…'];
            info.appendChild(el('span', `slot-badge ${badge[0]}`, badge[1]));
            const acts = el('div', 'slot-acts');
            if (onPick) {
                acts.appendChild(button('Place', () => {
                    cue('key');
                    menus.closeModal();
                    onPick(bp);
                }, 'btn-secondary strong bp-place'));
            }
            acts.append(
                button('Rename', () => askName({
                    title: 'Rename blueprint', value: bp.name, action: 'Rename',
                    onSave: (name) => {
                        blueprints.rename(bp.id, name);
                        setTimeout(() => open({ onPick }), 0);
                    },
                })),
                button('Export', () => blueprints.exportFile(bp.id)),
                button('Delete', () => {
                    const where = signedIn && bp.cloud ? ' here and in your account' : '';
                    if (!confirm(`Delete the blueprint “${bp.name}”${where}?`)) return;
                    blueprints.remove(bp.id);
                    flash('Deleted');
                }, 'btn-secondary danger'),
            );
            c.append(thumb, info, acts);
            return c;
        }
        render();
        const offBp = blueprints.onChange(render);
        const offAcc = account.onChange(render);
        m.onClose = () => {
            offBp();
            offAcc();
        };
        if (account.state.user) blueprints.sync();
    }

    return { open, askName };
}
