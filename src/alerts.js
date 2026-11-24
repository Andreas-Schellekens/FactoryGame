// src/alerts.js — the alerts list (top bar, key N): the factory's current problems, grouped by
// kind. It reads grid.js (machineStatus, power, order) and keeps, per machine, how long its
// status has been what it is, so a problem only shows once it has lasted ALERT_DELAY of sim
// time, and a machine just built gets NEW_GRACE before its problems count: no noise while
// the player is still laying the belts to it. Global problems (a tripped breaker, a brownout,
// a Priority Request about to fail) have no machine of their own. main.js calls update() a few
// times a second, the HUD renders groups(), and next(key) walks a group's machines in turn
// for the camera. No DOM, no Three.js; nothing here is saved.
import { grid, machineStatus, power, order, tickCount } from './grid.js';
import { GRID_WIDTH, GRID_HEIGHT, TICK_RATE, PAD_POS } from './config.js';

const ALERT_DELAY = 5 * TICK_RATE;   // a problem shows once it has lasted this long
const NEW_GRACE = 10 * TICK_RATE;    // a new machine's problems wait this long
const ORDER_WARN = 20 * TICK_RATE;   // a Priority Request this close to its deadline (or its last third)…
const NONE = new Set(['belt', 'splitter', 'merger', 'sink']);
// Per-machine kinds, in the order the list shows them ('off' is a quiet info line, last).
const KINDS = ['blocked', 'input', 'fuel', 'locked', 'off'];

/**
 * @typedef {{ key: string, kind: string, cells: { x: number, y: number }[], items?: string[],
 *   pct?: number, left?: number, got?: number, need?: number, item?: string, quiet?: boolean }} AlertGroup
 */
export function createAlerts() {
    const seen = new Map(); // 'x,y' → { m, born, key, since, st }
    let brownSince = null;
    /** @type {AlertGroup[]} */
    let list = [];
    let problems = 0;
    const cursor = new Map(); // group key → the index next() showed last

    function update() {
        const now = tickCount;
        const live = new Set();
        const byKey = new Map();
        for (let x = 0; x < GRID_WIDTH; x++) {
            for (let y = 0; y < GRID_HEIGHT; y++) {
                const m = grid[x][y].machine;
                if (!m || NONE.has(m.type)) continue;
                const id = `${x},${y}`;
                live.add(id);
                let e = seen.get(id);
                if (!e || e.m !== m) {
                    e = { m, born: now, key: null, since: now, st: null };
                    seen.set(id, e);
                }
                const st = machineStatus(x, y);
                const key = st.code === 'input' ? `input:${(st.missing ?? []).join('+')}` : st.code;
                if (key !== e.key) {
                    e.key = key;
                    e.since = now;
                    e.st = st;
                }
                if (!KINDS.includes(e.st.code)) continue;
                if (now - e.since < ALERT_DELAY || now - e.born < NEW_GRACE) continue;
                let g = byKey.get(key);
                if (!g) {
                    g = { key, kind: e.st.code, cells: [] };
                    if (e.st.code === 'input') g.items = e.st.missing ?? [];
                    if (e.st.code === 'off') g.quiet = true;
                    byKey.set(key, g);
                }
                g.cells.push({ x, y });
            }
        }
        for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);

        const global = [];
        if (power.tripped) global.push({ key: 'tripped', kind: 'tripped', cells: [] });
        brownSince = !power.tripped && power.demand > 0 && power.throttle < 0.999 ? brownSince ?? now : null;
        if (brownSince != null && now - brownSince >= ALERT_DELAY) {
            global.push({ key: 'brownout', kind: 'brownout', cells: [], pct: Math.round(power.throttle * 100) });
        }
        if (order.active && order.delivered < order.target) {
            const left = order.deadlineTick - now;
            const total = order.deadlineTick - order.startTick;
            if (left <= Math.max(ORDER_WARN, total / 3)) {
                global.push({
                    key: 'order', kind: 'order', cells: [{ x: PAD_POS.x, y: PAD_POS.y }],
                    left: Math.max(0, Math.ceil(left / TICK_RATE)), got: order.delivered, need: order.target, item: order.productType,
                });
            }
        }
        const groups = [...byKey.values()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.key.localeCompare(b.key));
        list = [...global, ...groups];
        problems = global.length + groups.filter((g) => !g.quiet).reduce((a, g) => a + g.cells.length, 0);
    }

    return {
        update,
        /** The groups to show, global problems first, switched-off machines last. */
        groups: () => list,
        /** How many problems: machines with one (switched-off ones don't count) plus global ones. */
        count: () => problems,
        /** The next machine of a group to look at (the first on the first call), or null. */
        next(key) {
            const g = list.find((q) => q.key === key);
            if (!g?.cells.length) return null;
            const i = cursor.has(key) ? (cursor.get(key) + 1) % g.cells.length : 0;
            cursor.set(key, i);
            return { ...g.cells[i], index: i, of: g.cells.length };
        },
        /** Start every group from its first machine again (the list was opened). */
        rewind: () => cursor.clear(),
        /** Forget everything (load, new game). */
        reset() {
            seen.clear();
            cursor.clear();
            brownSince = null;
            list = [];
            problems = 0;
        },
    };
}
