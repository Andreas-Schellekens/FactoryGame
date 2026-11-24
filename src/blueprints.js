// src/blueprints.js — the blueprint library (iteration 7): machine groups saved by name to
// build again, from a selection (select tool → Save as blueprint) or from another player's
// factory (the factory viewer → Copy as blueprint). Local first: the library lives in
// localStorage, so it works offline and without an account. Signed in, it syncs with the
// account (account.js → /api/blueprints): last write wins by the client's clock, a deletion
// here is sent on the next sync, and a blueprint gone from the account was deleted on
// another device. Blueprints made while signed in belong to that account: they're hidden
// while someone else (or nobody) is signed in, and leave this browser on sign-out.
//
// A blueprint: { id, name, w, h, machines: [{ x, y, type, dir, recipe?, off? }], createdAt,
// updatedAt, owner, cloud, dirty }, machines from 0,0. Placing one is grid.js planStored()
// + applyGroup(plan, 'copy'), driven by main.js like a carried copy.

import { MACHINE_COST, GRID_WIDTH, GRID_HEIGHT } from './config.js';
import { grid, RECIPES } from './grid.js';
import { download } from './account.js';

const KEY = 'selene.blueprints.v1';
const FILE_FORMAT = 'selene-blueprint';
export const MAX_BLUEPRINTS = 100;
export const MAX_NAME = 40;
const DIRS = new Set(['right', 'down', 'left', 'up']);
const MAX_MACHINES = GRID_WIDTH * GRID_HEIGHT;

const newId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9-]/g, '');
export const cleanName = (name) => String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME);

/**
 * A clean blueprint body from any machine list: known buildings only (never the pad), one
 * per cell, valid directions and recipes, shifted so the top-left machine is at 0,0.
 * @returns {{ w: number, h: number, machines: any[] } | null} null when nothing is left
 */
export function normalise(list) {
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    const out = [];
    for (const m of list) {
        if (!m || typeof m !== 'object' || !Number.isInteger(m.x) || !Number.isInteger(m.y)) continue;
        if (!(m.type in MACHINE_COST) || m.type === 'sink' || !DIRS.has(m.dir)) continue;
        const k = `${m.x},${m.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const e = { x: m.x, y: m.y, type: m.type, dir: m.dir };
        if (m.recipe != null && RECIPES[m.type]?.some((r) => r.id === m.recipe)) e.recipe = m.recipe;
        if (m.off) e.off = true;
        out.push(e);
        if (out.length >= MAX_MACHINES) break;
    }
    if (!out.length) return null;
    const x0 = Math.min(...out.map((m) => m.x));
    const y0 = Math.min(...out.map((m) => m.y));
    for (const m of out) {
        m.x -= x0;
        m.y -= y0;
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return { w: Math.max(...out.map((m) => m.x)) + 1, h: Math.max(...out.map((m) => m.y)) + 1, machines: out };
}

/** The machines on the live grid at `cells` (a selection) as a blueprint body. */
export function fromCells(cells) {
    return normalise(cells.map(({ x, y }) => {
        const m = grid[x]?.[y]?.machine;
        return m && { x, y, type: m.type, dir: m.dir, recipe: m.recipe, off: m.off };
    }));
}

/** A leaderboard layout ({ world, machines: [{ x, y, type, dir, tier, recipe, off }] }) as a blueprint body. */
export const fromLayout = (layout) => normalise(layout?.machines);

/** What building a blueprint costs (tier 1, like a copy). */
export const costOf = (bp) => bp.machines.reduce((a, m) => a + (MACHINE_COST[m.type] ?? 0), 0);

/** The building types a blueprint uses, in a stable order. */
export const typesOf = (bp) => [...new Set(bp.machines.map((m) => m.type))];

/** The cell a carried blueprint hangs from: the machine nearest its middle. */
export function anchorOf(bp) {
    const cx = (bp.w - 1) / 2;
    const cy = (bp.h - 1) / 2;
    return bp.machines.reduce((a, c) => (Math.hypot(c.x - cx, c.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? c : a));
}

function read() {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
        if (v && Array.isArray(v.list)) return { list: v.list, deleted: Array.isArray(v.deleted) ? v.deleted : [] };
    } catch { /* corrupt or private mode */ }
    return { list: [], deleted: [] };
}

/**
 * @param {{ account: ReturnType<typeof import('./account.js').createAccount> }} opts
 */
export function createBlueprints({ account }) {
    let store = read();
    const listeners = new Set();
    let syncing = null;
    let lastUser = null;

    const me = () => account.state.user?.id ?? null;
    /** Is this blueprint in the library right now (made here, or in the signed-in account)? */
    const mine = (b) => b.owner == null || b.owner === me();
    const persist = () => {
        try {
            localStorage.setItem(KEY, JSON.stringify(store));
            return true;
        } catch {
            return false;
        }
    };
    const emit = () => {
        for (const fn of listeners) fn();
    };
    const find = (id) => store.list.find((b) => b.id === id && mine(b)) ?? null;
    const changed = () => {
        persist();
        emit();
        if (me()) syncSoon();
    };

    let timer = null;
    function syncSoon() {
        clearTimeout(timer);
        timer = setTimeout(() => api.sync(), 400);
    }

    async function push(b) {
        try {
            await account.putBlueprint(b.id, { name: b.name, data: { w: b.w, h: b.h, machines: b.machines }, updatedAt: b.updatedAt });
            b.cloud = true;
            b.dirty = false;
            b.owner = me();
            delete b.syncError;
        } catch (e) {
            b.syncError = e.status === 0 ? null : e.message;
        }
    }

    async function syncNow() {
        const user = me();
        if (!user) return false;
        // Deletions made here first (only this account's).
        for (const d of [...store.deleted]) {
            if (d.owner !== user) continue;
            try {
                await account.deleteBlueprint(d.id);
                store.deleted = store.deleted.filter((x) => x !== d);
            } catch (e) {
                if (e.status === 0) return false;
            }
        }
        let cloud;
        try {
            cloud = (await account.listBlueprints()).blueprints;
        } catch {
            return false;
        }
        if (me() !== user) return false; // signed out meanwhile
        const byId = new Map(cloud.map((c) => [c.id, c]));
        for (const c of cloud) {
            const body = normalise(c.data?.machines);
            if (!body) continue;
            const local = store.list.find((b) => b.id === c.id);
            if (local && local.owner != null && local.owner !== user) continue;
            if (!local) {
                store.list.push({ id: c.id, name: cleanName(c.name) || 'Blueprint', ...body, createdAt: c.createdAt, updatedAt: c.updatedAt, owner: user, cloud: true, dirty: false });
            } else if (c.updatedAt > local.updatedAt) {
                Object.assign(local, { name: cleanName(c.name) || local.name, ...body, updatedAt: c.updatedAt, owner: user, cloud: true, dirty: false });
            } else if (c.updatedAt === local.updatedAt) {
                Object.assign(local, { owner: user, cloud: true, dirty: false });
            }
        }
        // Synced before but gone from the account (and not changed here since): deleted elsewhere.
        store.list = store.list.filter((b) => !(b.owner === user && b.cloud && !b.dirty && !byId.has(b.id)));
        persist();
        emit();
        for (const b of store.list) {
            if (!mine(b)) continue;
            const c = byId.get(b.id);
            if (!c || b.dirty || b.updatedAt > c.updatedAt) await push(b);
        }
        persist();
        emit();
        return true;
    }

    const api = {
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** The library, newest first. */
        list: () => store.list.filter(mine).sort((a, b) => b.createdAt - a.createdAt),
        get: find,
        /**
         * Add a blueprint (a body from fromCells / fromLayout).
         * @returns {{ ok: boolean, error?: string, blueprint?: any }}
         */
        add(name, body) {
            if (!body?.machines?.length) return { ok: false, error: 'There are no machines to save' };
            if (api.list().length >= MAX_BLUEPRINTS) return { ok: false, error: `At most ${MAX_BLUEPRINTS} blueprints: delete one first` };
            const now = Date.now();
            const b = { id: newId(), name: cleanName(name) || 'Blueprint', ...body, createdAt: now, updatedAt: now, owner: me(), cloud: false, dirty: true };
            store.list.push(b);
            if (!persist()) {
                store.list.pop();
                return { ok: false, error: 'Browser storage is full' };
            }
            emit();
            if (me()) syncSoon();
            return { ok: true, blueprint: b };
        },
        rename(id, name) {
            const b = find(id);
            const clean = cleanName(name);
            if (!b || !clean || clean === b.name) return false;
            b.name = clean;
            b.updatedAt = Date.now();
            b.dirty = true;
            changed();
            return true;
        },
        remove(id) {
            const b = find(id);
            if (!b) return false;
            store.list = store.list.filter((x) => x !== b);
            if (b.cloud && b.owner != null) store.deleted.push({ id: b.id, owner: b.owner });
            changed();
            return true;
        },
        /** Offer a blueprint as a .selene-blueprint.json file. */
        exportFile(id) {
            const b = find(id);
            if (!b) return false;
            const file = { format: FILE_FORMAT, version: 1, name: b.name, w: b.w, h: b.h, machines: b.machines };
            const safe = b.name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'blueprint';
            download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${safe}.selene-blueprint.json`);
            return true;
        },
        /** Read a blueprint file into the library. @returns {Promise<{ ok: boolean, error?: string, blueprint?: any }>} */
        async importFile(file) {
            let parsed;
            try {
                parsed = JSON.parse(await file.text());
            } catch {
                return { ok: false, error: 'That file is not a blueprint' };
            }
            if (parsed?.format !== FILE_FORMAT) return { ok: false, error: 'That file is not a blueprint' };
            const body = normalise(parsed.machines);
            if (!body) return { ok: false, error: 'That blueprint has no machines this version knows' };
            return api.add(parsed.name, body);
        },
        /** Match the library with the account's (signed in only). Never throws. */
        sync() {
            syncing ??= syncNow().finally(() => {
                syncing = null;
            });
            return syncing;
        },
    };

    // Another tab (the factory viewer, say) changed the library: take its copy.
    window.addEventListener('storage', (e) => {
        if (e.key !== KEY) return;
        store = read();
        emit();
    });
    // Signing in syncs; signing out takes that account's blueprints out of this browser.
    account.onChange((st) => {
        const id = st.user?.id ?? null;
        if (id === lastUser) return;
        const was = lastUser;
        lastUser = id;
        if (was != null && id == null && st.checked) {
            store.list = store.list.filter((b) => b.owner !== was);
            store.deleted = store.deleted.filter((d) => d.owner !== was);
            persist();
        }
        emit();
        if (id != null) api.sync();
    });
    return api;
}
