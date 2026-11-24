// src/undo.js — undo / redo for the player's edits (Ctrl+Z; Ctrl+Y or Ctrl+Shift+Z).
//
// Generic: a step is whatever changed on the grid between begin() and end() (or inside
// run()), found by comparing every cell's machine before and after, plus the credits the
// tracked grid calls moved. So anything that edits machines through grid.js (a build, a
// drag-laid belt, a drag-erase, a group move or copy through applyGroup, an upgrade, a
// recipe, on/off) becomes one step without undo.js knowing what it was.
//
// Undoing puts machines back as they were (type, direction, tier, recipe, on/off): a machine
// that is still on the grid (moved, turned, upgraded) is carried back with its buffer and
// the item on it; one that was demolished comes back fresh, with an empty buffer, and items
// that were destroyed stay destroyed. Credits are reversed exactly: undoing a build gives
// back what it cost, undoing a demolish charges the refund again. A step is refused when the
// cells don't look the way the step left them, or when the credits aren't there.
//
// The history (LIMIT steps) lives in memory only: main.js clears it on load and new game
// (a slot switch reloads the page). No DOM, no Three.js; grid.js does the writing
// (machineSpec, rewriteCells).
import { grid, score, machineSpec, rewriteCells } from './grid.js';
import { GRID_WIDTH, GRID_HEIGHT } from './config.js';

const LIMIT = 100;

const sameSpec = (a, b) => (!a && !b) || (!!a && !!b && a.type === b.type && a.dir === b.dir && a.tier === b.tier
    && (a.recipe ?? null) === (b.recipe ?? null) && !!a.off === !!b.off);

/** Every cell's machine (the pad left out): [{ m, spec } | null], indexed x * GRID_HEIGHT + y. */
function snapshot() {
    const out = new Array(GRID_WIDTH * GRID_HEIGHT);
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const m = grid[x][y].machine;
            out[x * GRID_HEIGHT + y] = m && m.type !== 'sink' ? { m, spec: machineSpec(m) } : null;
        }
    }
    return out;
}

/**
 * @typedef {{ m: object, spec: object } | null} Side
 * @typedef {{ label: any, cells: { x: number, y: number, before: Side, after: Side }[], credits: number }} Step
 * @typedef {{ ok: boolean, step?: Step, events?: object[], carried?: boolean, error?: 'empty'|'changed'|'taken'|'broke', need?: number }} Result
 */
export function createUndo({ limit = LIMIT } = {}) {
    /** @type {Step[]} */
    const done = [];
    /** @type {Step[]} */
    const undone = [];
    let open = null; // { label, before, credits } while a step is being recorded

    /** Start recording a step (a drag: pointer down). An open one is closed first. */
    function begin(label) {
        if (open) end();
        open = { label, before: snapshot(), credits: 0 };
    }

    /** Close the step: keep it if anything changed. @returns {Step|null} */
    function end() {
        const rec = open;
        open = null;
        if (!rec) return null;
        const cells = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            for (let y = 0; y < GRID_HEIGHT; y++) {
                const a = rec.before[x * GRID_HEIGHT + y];
                const m = grid[x][y].machine;
                const b = m && m.type !== 'sink' ? { m, spec: machineSpec(m) } : null;
                if ((a?.m ?? null) === (b?.m ?? null) && sameSpec(a?.spec, b?.spec)) continue;
                cells.push({ x, y, before: a, after: b });
            }
        }
        if (!cells.length) return null; // nothing on the grid changed (a refused build): no step
        const label = typeof rec.label === 'function' ? rec.label(cells) : rec.label;
        const step = { label, cells, credits: rec.credits };
        done.push(step);
        if (done.length > limit) done.shift();
        undone.length = 0;
        return step;
    }

    /** Run one grid call inside the open step, counting the credits it moves. */
    function track(fn) {
        const before = score;
        try {
            return fn();
        } finally {
            if (open) open.credits += score - before;
        }
    }

    /** One action as one step (or as part of the open one). */
    function run(label, fn) {
        if (open) return track(fn);
        begin(label);
        try {
            return track(fn);
        } finally {
            end();
        }
    }

    // A machine that came back fresh replaces the old one everywhere in the history, so later
    // undos and redos still recognise it.
    function remap(oldM, newM) {
        for (const st of [...done, ...undone]) {
            for (const c of st.cells) {
                if (c.before?.m === oldM) c.before = { ...c.before, m: newM };
                if (c.after?.m === oldM) c.after = { ...c.after, m: newM };
            }
        }
    }

    /** Take `step` from its `from` side to its `to` side. @returns {Result} */
    function apply(step, from, to, credits) {
        for (const c of step.cells) {
            const cell = grid[c.x][c.y];
            const now = cell.machine;
            if (!sameSpec(now ? machineSpec(now) : null, c[from]?.spec ?? null)) {
                return { ok: false, step, error: now && !c[from] ? 'taken' : 'changed' };
            }
            if (c[to] && (cell.blocked || cell.water || (c[to].spec.type === 'extractor' && !cell.resource))) {
                return { ok: false, step, error: 'taken' };
            }
        }
        if (credits < 0 && score + credits < 0) return { ok: false, step, error: 'broke', need: -credits };
        const standing = new Set(step.cells.map((c) => grid[c.x][c.y].machine).filter(Boolean));
        let carried = false;
        const changes = step.cells.map((c) => {
            const want = c[to];
            if (!want) return { x: c.x, y: c.y, spec: null };
            const carry = standing.has(want.m) ? want.m : null;
            // Carried to another cell: the step moved machines (the renderer slides them quietly).
            if (carry && grid[c.x][c.y].machine !== carry) carried = true;
            return { x: c.x, y: c.y, spec: want.spec, carry };
        });
        const { events, placed } = rewriteCells(changes, credits);
        placed.forEach((m, i) => {
            const want = step.cells[i][to];
            if (m && want && want.m !== m) remap(want.m, m);
        });
        return { ok: true, step, events, carried };
    }

    return {
        begin,
        end,
        track,
        run,
        /** Undo the last step. @returns {Result} */
        undo() {
            if (open) end();
            const step = done[done.length - 1];
            if (!step) return { ok: false, error: 'empty' };
            const r = apply(step, 'after', 'before', -step.credits);
            if (r.ok) undone.push(done.pop());
            return r;
        },
        /** Redo the last undone step. @returns {Result} */
        redo() {
            if (open) end();
            const step = undone[undone.length - 1];
            if (!step) return { ok: false, error: 'empty' };
            const r = apply(step, 'before', 'after', step.credits);
            if (r.ok) done.push(undone.pop());
            return r;
        },
        /** Forget everything (load, new game). */
        clear() {
            open = null;
            done.length = 0;
            undone.length = 0;
        },
        canUndo: () => done.length > 0,
        canRedo: () => undone.length > 0,
        /** How many steps can be undone / redone (for tests). */
        size: () => ({ undo: done.length, redo: undone.length }),
        recording: () => !!open,
    };
}

/** The game's history (main.js clears it on load and new game). Other modules wrap their grid edits in history.run(). */
export const history = createUndo();
