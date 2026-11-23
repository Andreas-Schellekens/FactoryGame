// src/saves.js — save slots. Local first: every slot lives in localStorage (an index of
// slot cards plus one key per save), so the game saves offline and without an account.
// Signed in, slots also go to the account (account.js): a save is pushed after it is
// written (autosaves at most every few minutes), cloud slots from other devices show up
// in the list and download when opened, and when both sides changed the cloud copy is
// kept as a slot of its own instead of being overwritten. Slots can be exported to and
// imported from a .selene.json file. The save data itself is whatever main.js hands in
// (grid.js serialize() plus the director's and renderer's parts).

import { download } from './account.js';

const INDEX_KEY = 'selene.slots.v1';
const dataKey = (id) => `selene.slot.${id}`;
const LEGACY_KEY = 'lifeline.save.v2'; // the single save from before slots
const LEGACY_DONE = 'selene.legacyImported';
const FILE_FORMAT = 'selene-save';
export const MAX_LOCAL_SLOTS = 12;
const PUSH_EVERY_MS = 3 * 60_000; // autosaves reach the cloud at most this often

const newId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9-]/g, '');

function readJSON(key) {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
        return null;
    }
}

/**
 * @param {{ account: ReturnType<typeof import('./account.js').createAccount>,
 *           isLoadable: (data: any) => boolean }} opts
 */
export function createSaves({ account, isLoadable }) {
    /** @type {{ slots: any[], active: string|null }} */
    let index = readJSON(INDEX_KEY) ?? { slots: [], active: null };
    if (!Array.isArray(index.slots)) index = { slots: [], active: null };
    const listeners = new Set();
    const lastPush = new Map();
    const pushing = new Map();

    function persistIndex() {
        try {
            localStorage.setItem(INDEX_KEY, JSON.stringify(index));
            return true;
        } catch {
            return false;
        }
    }
    const emit = () => {
        for (const fn of listeners) fn();
    };
    const find = (id) => index.slots.find((s) => s.id === id) ?? null;
    const signedIn = () => !!account.state.user;

    // The single save from before slots becomes the first slot (the old key stays as a backup).
    if (!localStorage.getItem(LEGACY_DONE)) {
        const old = readJSON(LEGACY_KEY);
        if (old && isLoadable(old)) {
            const id = newId();
            try {
                localStorage.setItem(dataKey(id), JSON.stringify(old));
                index.slots.push({
                    id, name: 'Protocol: Selene', mode: 'story', world: 'valley', phase: old.project?.phase ?? 0, plot: 0,
                    complete: !!old.project?.complete, playSec: Math.round((old.tickCount ?? 0) / 4), savedAt: Date.now(), thumb: null,
                    cloud: null, dirty: true,
                });
                index.active = id;
                persistIndex();
            } catch { /* storage full: leave it */ }
        }
        try {
            localStorage.setItem(LEGACY_DONE, '1');
        } catch { /* ignore */ }
    }

    function nextName(mode) {
        const base = mode === 'infinite' ? 'Infinite' : 'Contract';
        let n = 1;
        while (index.slots.some((s) => s.name === `${base} ${String(n).padStart(2, '0')}`)) n++;
        return `${base} ${String(n).padStart(2, '0')}`;
    }

    /** Send a slot to the account. On a conflict the cloud's copy is kept as a new slot first. */
    async function push(id, { force = false } = {}) {
        const slot = find(id);
        if (!slot || !signedIn() || slot.cloudOnly) return false;
        if (pushing.get(id)) return pushing.get(id);
        const data = readJSON(dataKey(id));
        if (!data) return false;
        const meta = metaOf(slot);
        const job = (async () => {
            try {
                const r = await account.putSave(id, { name: slot.name, meta, data, baseRev: slot.cloud?.rev ?? null, force });
                slot.cloud = { rev: r.rev, at: Date.now() };
                slot.dirty = false;
                slot.cloudNewer = false;
                persistIndex();
                emit();
                return true;
            } catch (e) {
                if (e.status === 409 && !e.body?.full && !force) {
                    // Changed on another device too: keep theirs as its own slot, then write ours.
                    try {
                        const theirs = await account.getSave(id);
                        const copyId = newId();
                        localStorage.setItem(dataKey(copyId), JSON.stringify(theirs.data));
                        index.slots.push({ ...theirs.meta, id: copyId, name: `${theirs.name} (other device)`, savedAt: theirs.updatedAt, cloud: null, dirty: true });
                        persistIndex();
                        push(copyId); // the copy goes to the account too, as a slot of its own
                    } catch { /* couldn't fetch theirs: still don't lose ours */ }
                    pushing.delete(id);
                    return push(id, { force: true });
                }
                slot.syncError = e.message;
                emit();
                return false;
            } finally {
                pushing.delete(id);
            }
        })();
        pushing.set(id, job);
        return job;
    }

    function metaOf(slot) {
        const { mode, world, phase, plot, complete, playSec, savedAt, thumb } = slot;
        return { mode, world, phase, plot, complete, playSec, savedAt, thumb };
    }

    return {
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** Slot cards, newest first. */
        list: () => [...index.slots].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)),
        get: find,
        activeId: () => index.active,
        /** The most recently saved slot that can be played (for "Continue"). */
        latest() {
            return this.list().find((s) => s.cloudOnly || localStorage.getItem(dataKey(s.id))) ?? null;
        },
        setActive(id) {
            index.active = id;
            persistIndex();
        },
        /** A new, empty slot for a game about to start. */
        create({ mode = 'story', name = null } = {}) {
            const slot = { id: newId(), name: name || nextName(mode), mode, world: 'valley', phase: 0, plot: 0, complete: false, playSec: 0, savedAt: 0, thumb: null, cloud: null, dirty: true };
            index.slots.push(slot);
            index.active = slot.id;
            persistIndex();
            emit();
            return slot;
        },
        /**
         * Write a save into a slot. `push`: 'now' (a manual save), 'auto' (an autosave: the
         * cloud gets it at most every few minutes) or false. @returns {{ ok: boolean, error?: string }}
         */
        write(id, data, meta, { push: when = 'auto' } = {}) {
            const slot = find(id);
            if (!slot) return { ok: false, error: 'No such slot' };
            try {
                localStorage.setItem(dataKey(id), JSON.stringify(data));
            } catch {
                return { ok: false, error: 'Browser storage is full: delete or export a slot' };
            }
            Object.assign(slot, meta, { savedAt: Date.now(), dirty: true, cloudOnly: false });
            persistIndex();
            emit();
            const due = when === 'now' || (when === 'auto' && Date.now() - (lastPush.get(id) ?? 0) >= PUSH_EVERY_MS);
            if (due && signedIn()) {
                lastPush.set(id, Date.now());
                push(id);
            }
            return { ok: true };
        },
        /** The save in a slot, downloading it first when the cloud has it (or a newer copy). */
        async read(id) {
            const slot = find(id);
            if (!slot) return null;
            if ((slot.cloudOnly || slot.cloudNewer) && signedIn()) {
                try {
                    const r = await account.getSave(id);
                    localStorage.setItem(dataKey(id), JSON.stringify(r.data));
                    Object.assign(slot, r.meta, { name: r.name, cloud: { rev: r.rev, at: Date.now() }, cloudOnly: false, cloudNewer: false, dirty: false });
                    persistIndex();
                    emit();
                } catch (e) {
                    if (slot.cloudOnly) throw e;
                }
            }
            return readJSON(dataKey(id));
        },
        rename(id, name) {
            const slot = find(id);
            const clean = String(name ?? '').trim().slice(0, 60);
            if (!slot || !clean) return false;
            slot.name = clean;
            slot.dirty = true;
            persistIndex();
            emit();
            if (signedIn() && slot.cloud) push(id);
            return true;
        },
        /** Delete a slot here and, if it is there, from the account. */
        async remove(id) {
            const slot = find(id);
            if (!slot) return;
            index.slots = index.slots.filter((s) => s.id !== id);
            if (index.active === id) index.active = null;
            try {
                localStorage.removeItem(dataKey(id));
            } catch { /* ignore */ }
            persistIndex();
            emit();
            if (slot.cloud && signedIn()) await account.deleteSave(id).catch(() => {});
        },
        /** "Save as": a copy of a slot under a new name. @returns the new slot, or null */
        duplicate(id, name) {
            const slot = find(id);
            const data = readJSON(dataKey(id));
            if (!slot || !data) return null;
            const copy = { ...slot, id: newId(), name: name || `${slot.name} copy`, cloud: null, dirty: true, savedAt: Date.now() };
            try {
                localStorage.setItem(dataKey(copy.id), JSON.stringify(data));
            } catch {
                return null;
            }
            index.slots.push(copy);
            persistIndex();
            emit();
            if (signedIn()) push(copy.id);
            return copy;
        },
        /** Download a slot as a .selene.json file. */
        exportFile(id) {
            const slot = find(id);
            const data = readJSON(dataKey(id));
            if (!slot || !data) return false;
            const file = { format: FILE_FORMAT, version: 1, name: slot.name, meta: metaOf(slot), data };
            const safe = slot.name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'save';
            download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${safe}.selene.json`);
            return true;
        },
        /** Read a .selene.json file into a new slot. @returns {Promise<{ ok: boolean, error?: string, slot?: any }>} */
        async importFile(file) {
            let parsed;
            try {
                parsed = JSON.parse(await file.text());
            } catch {
                return { ok: false, error: 'That file is not a save' };
            }
            if (parsed?.format !== FILE_FORMAT || !isLoadable(parsed.data)) return { ok: false, error: 'That file is not a save this version can load' };
            if (index.slots.length >= MAX_LOCAL_SLOTS) return { ok: false, error: `At most ${MAX_LOCAL_SLOTS} slots: delete one first` };
            const slot = { ...(parsed.meta ?? {}), id: newId(), name: String(parsed.name ?? 'Imported').slice(0, 60), cloud: null, dirty: true, savedAt: Date.now() };
            try {
                localStorage.setItem(dataKey(slot.id), JSON.stringify(parsed.data));
            } catch {
                return { ok: false, error: 'Browser storage is full' };
            }
            index.slots.push(slot);
            persistIndex();
            emit();
            if (signedIn()) push(slot.id);
            return { ok: true, slot };
        },
        /** Match the local slots with the account's: new cloud slots appear, local ones go up. */
        async sync() {
            if (!signedIn()) return false;
            let cloud;
            try {
                cloud = (await account.listSaves()).slots;
            } catch {
                return false;
            }
            const byId = new Map(cloud.map((c) => [c.slot, c]));
            for (const c of cloud) {
                const local = find(c.slot);
                if (!local) {
                    index.slots.push({ ...c.meta, id: c.slot, name: c.name, cloud: { rev: c.rev, at: c.updatedAt }, cloudOnly: true, dirty: false });
                } else if ((local.cloud?.rev ?? 0) < c.rev && !local.dirty) {
                    Object.assign(local, c.meta, { name: c.name, cloudNewer: true });
                }
            }
            // A slot that was synced but is gone from the account was deleted elsewhere.
            index.slots = index.slots.filter((s) => !(s.cloudOnly && !byId.has(s.id)));
            persistIndex();
            emit();
            for (const s of index.slots) {
                if (!s.cloudOnly && (s.dirty || !byId.has(s.id)) && localStorage.getItem(dataKey(s.id))) await push(s.id);
            }
            return true;
        },
        push,
        /** Signed out: forget which slots only exist in the account. */
        forgetCloud() {
            index.slots = index.slots.filter((s) => !s.cloudOnly);
            for (const s of index.slots) s.cloudNewer = false;
            persistIndex();
            emit();
        },
    };
}
