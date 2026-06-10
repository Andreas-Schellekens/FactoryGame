// src/renderer.js — owns everything Pixi: drawing the grid, ore nodes, machines
// (each with a distinct sprite), the hover ghost, and the animated item sprites.
// Knows nothing about input or the game loop.
import * as PIXI from 'pixi.js';
import { TILE_SIZE, GRID_WIDTH, GRID_HEIGHT, MAX_TIER, TICK_RATE, POWER_DRAW } from './config.js';
import { grid, power, research, canBuildMachine, canUpgrade, machineProgressFraction, UPGRADABLE } from './grid.js';

const DIR_VEC = {
    right: { dx: 1, dy: 0 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    up: { dx: 0, dy: -1 },
};

// Splitter outputs / merger inputs sit on these two perpendicular sides.
const PERP = {
    right: ['down', 'up'],
    left: ['up', 'down'],
    up: ['right', 'left'],
    down: ['left', 'right'],
};

const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };

// Visual identity for each item type.
const ITEM_STYLE = {
    ironOre: { shape: 'chunk', color: 0x9aa0aa, speck: 0x5f6470 },
    copperOre: { shape: 'chunk', color: 0xc77b3b, speck: 0x8a4f22 },
    coalOre: { shape: 'chunk', color: 0x3b3f48, speck: 0x14161b },
    ironIngot: { shape: 'bar', color: 0xdce1e9 },
    copperIngot: { shape: 'bar', color: 0xe2913f },
    circuit: { shape: 'chip', color: 0x39d353 },
    advancedCircuit: { shape: 'chip', color: 0xf5b041, accent: 0x6e4a0a, pin: 0xfdebd0 },
    research: { shape: 'flask', color: 0xb07cf0 },
};

const RESOURCE_COLOR = { ironOre: 0x6b7280, copperOre: 0xa86a39, coalOre: 0x4d525e };

/**
 * @param {import('pixi.js').Application} app
 */
export function createRenderer(app) {
    const world = new PIXI.Container();
    app.stage.addChild(world);

    const background = new PIXI.Graphics(); // static: checker tiles, grid lines, vignette
    background.eventMode = 'none';
    world.addChild(background);

    const visuals = new PIXI.Graphics(); // ore nodes, machines (redrawn each frame)
    visuals.eventMode = 'none';
    world.addChild(visuals);

    const itemLayer = new PIXI.Container(); // moving items
    itemLayer.eventMode = 'none';
    world.addChild(itemLayer);

    const overlay = new PIXI.Graphics(); // hover ghost + placement pulse
    overlay.eventMode = 'none';
    world.addChild(overlay);

    /** @type {Map<number, { gfx: PIXI.Graphics, anim: null | { from: {x:number,y:number}, to: {x:number,y:number}, t:number, dur:number } }>} */
    const itemSprites = new Map();

    function cellCenterPx(x, y) {
        return { x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 };
    }

    // Animation clock: advanced per frame in draw(), scaled by sim speed and
    // frozen while paused, so belt scroll / glow pulses track the simulation
    // pace instead of wall time.
    const tickMs = 1000 / TICK_RATE;
    let animMs = 0;
    let lastDrawNow = performance.now();

    // Static depth pass, drawn once: alternating tile tints so the field
    // doesn't read as a flat slab, the cell grid lines, and a soft edge
    // vignette. Everything dynamic stays in `visuals`.
    function drawBackground() {
        background.clear();
        const W = GRID_WIDTH * TILE_SIZE;
        const H = GRID_HEIGHT * TILE_SIZE;
        background.rect(0, 0, W, H);
        background.fill(0x20232b);
        for (let x = 0; x < GRID_WIDTH; x++) {
            for (let y = 0; y < GRID_HEIGHT; y++) {
                if ((x + y) % 2 === 0) continue;
                background.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                background.fill({ color: 0x262a34, alpha: 0.8 });
            }
        }
        for (let x = 0; x <= GRID_WIDTH; x++) {
            background.moveTo(x * TILE_SIZE, 0).lineTo(x * TILE_SIZE, H);
        }
        for (let y = 0; y <= GRID_HEIGHT; y++) {
            background.moveTo(0, y * TILE_SIZE).lineTo(W, y * TILE_SIZE);
        }
        background.stroke({ width: 1, color: 0x333333 });
        // vignette: stacked translucent strokes darkening toward the border
        for (let i = 0; i < 18; i++) {
            background.rect(i, i, W - i * 2, H - i * 2);
            background.stroke({ width: 1, color: 0x000000, alpha: 0.022 * (1 - i / 18) });
        }
    }
    drawBackground();

    // ---- Item sprites -------------------------------------------------------
    function createItemGfx(type) {
        const g = new PIXI.Graphics();
        g.eventMode = 'none';
        const style = ITEM_STYLE[type] ?? { shape: 'chunk', color: 0xffffff };
        const r = TILE_SIZE / 4;

        if (style.shape === 'chunk') {
            g.circle(0, 0, r);
            g.fill(style.color);
            g.stroke({ width: 2, color: 0x000000, alpha: 0.25 });
            for (const [sx, sy] of [[-r / 3, -r / 4], [r / 3, r / 6], [0, r / 2.2]]) {
                g.circle(sx, sy, r / 4);
                g.fill({ color: style.speck ?? 0x000000, alpha: 0.6 });
            }
        } else if (style.shape === 'bar') {
            const w = TILE_SIZE * 0.5;
            const h = TILE_SIZE * 0.28;
            g.roundRect(-w / 2, -h / 2, w, h, 4);
            g.fill(style.color);
            g.roundRect(-w / 2, -h / 2, w, h, 4);
            g.stroke({ width: 2, color: 0x000000, alpha: 0.25 });
            g.rect(-w / 2 + 3, -h / 2 + 3, w - 6, 3);
            g.fill({ color: 0xffffff, alpha: 0.35 });
        } else if (style.shape === 'flask') {
            // research flask: round body, short neck, liquid line
            const r2 = TILE_SIZE * 0.18;
            g.circle(0, r2 * 0.35, r2);
            g.fill(style.color);
            g.rect(-r2 * 0.35, -r2 * 1.3, r2 * 0.7, r2);
            g.fill(style.color);
            g.circle(0, r2 * 0.35, r2);
            g.stroke({ width: 2, color: 0x000000, alpha: 0.3 });
            g.circle(-r2 * 0.3, 0, r2 * 0.25);
            g.fill({ color: 0xffffff, alpha: 0.5 });
        } else {
            // chip / product
            const accent = style.accent ?? 0x0c3a16;
            const pin = style.pin ?? 0xcde8d2;
            const s = TILE_SIZE * 0.44;
            g.roundRect(-s / 2, -s / 2, s, s, 4);
            g.fill(style.color);
            g.roundRect(-s / 2, -s / 2, s, s, 4);
            g.stroke({ width: 2, color: accent });
            g.rect(-s / 4, -s / 4, s / 2, s / 2);
            g.stroke({ width: 1.5, color: accent, alpha: 0.7 });
            for (const off of [-s / 6, s / 6]) {
                g.rect(off - 1, -s / 2 - 3, 2, 3);
                g.rect(off - 1, s / 2, 2, 3);
                g.fill(pin);
            }
        }
        return g;
    }

    function ensureItemSprite(item, x, y) {
        const existing = itemSprites.get(item.id);
        if (existing) return existing;
        const gfx = createItemGfx(item.type);
        const p = cellCenterPx(x, y);
        gfx.x = p.x;
        gfx.y = p.y;
        itemLayer.addChild(gfx);
        const entry = { gfx, anim: null };
        itemSprites.set(item.id, entry);
        return entry;
    }

    function removeItemSprite(itemId) {
        const entry = itemSprites.get(itemId);
        if (!entry) return;
        entry.gfx.destroy();
        itemSprites.delete(itemId);
    }

    // Drop every item sprite — used on load, before re-spawning the restored
    // in-transit items, so no orphaned graphics or stale ids survive.
    function reset() {
        for (const entry of itemSprites.values()) entry.gfx.destroy();
        itemSprites.clear();
    }

    function applyEvents(events, tickDurationMs) {
        for (const ev of events) {
            if (ev.kind === 'spawn') {
                ensureItemSprite(ev.item, ev.at.x, ev.at.y);
            } else if (ev.kind === 'move') {
                const sprite = ensureItemSprite(ev.item, ev.to.x, ev.to.y);
                const from = cellCenterPx(ev.from.x, ev.from.y);
                const to = cellCenterPx(ev.to.x, ev.to.y);
                if (sprite.anim && sprite.anim.t === 0) {
                    // Second hop in the same tick (fastBelts): extend the tween
                    // to the final cell instead of snapping to the midpoint.
                    sprite.anim.to = to;
                } else {
                    sprite.anim = { from, to, t: 0, dur: tickDurationMs };
                    sprite.gfx.x = from.x;
                    sprite.gfx.y = from.y;
                }
            } else if (ev.kind === 'consume') {
                removeItemSprite(ev.item.id);
            }
        }
    }

    function tweenItems(dt) {
        for (const entry of itemSprites.values()) {
            if (!entry.anim) continue;
            entry.anim.t += dt;
            const a = Math.min(1, entry.anim.t / entry.anim.dur);
            entry.gfx.x = entry.anim.from.x + (entry.anim.to.x - entry.anim.from.x) * a;
            entry.gfx.y = entry.anim.from.y + (entry.anim.to.y - entry.anim.from.y) * a;
            if (a >= 1) entry.anim = null;
        }
    }

    // ---- Machine / tile drawing --------------------------------------------
    function drawArrow(g, px, py, dir, color, alpha) {
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;
        const d = DIR_VEC[dir] ?? DIR_VEC.right;
        const tipX = cx + d.dx * (TILE_SIZE / 2 - 5);
        const tipY = cy + d.dy * (TILE_SIZE / 2 - 5);
        // perpendicular for the arrow base
        const perpX = -d.dy;
        const perpY = d.dx;
        const back = 9;
        const half = 6;
        const bx = tipX - d.dx * back;
        const by = tipY - d.dy * back;
        g.poly([
            tipX, tipY,
            bx + perpX * half, by + perpY * half,
            bx - perpX * half, by - perpY * half,
        ]);
        g.fill({ color, alpha });
    }

    // Which direction is an item travelling as it enters this belt? We look for a
    // single neighbour whose output dir points back into (x,y). Returns null when
    // there's no feeder or several (a merge), so those fall back to a straight belt.
    function incomingFlowDir(x, y, machine) {
        let found = null;
        for (const v of Object.values(DIR_VEC)) {
            const nx = x + v.dx;
            const ny = y + v.dy;
            if (nx < 0 || ny < 0 || nx >= GRID_WIDTH || ny >= GRID_HEIGHT) continue;
            const nm = grid[nx][ny].machine;
            if (!nm) continue;
            const nd = DIR_VEC[nm.dir];
            // neighbour feeds us when its output points opposite to v (i.e. at us)
            if (nd && nd.dx === -v.dx && nd.dy === -v.dy) {
                if (found) return null; // multiple feeders → keep it straight
                found = nm.dir;
            }
        }
        return found;
    }

    // How far (in px) the belt surface has scrolled, modulo `period`. Belts
    // cover one tile per tick (two with fastBelts), and the clock already
    // carries sim speed/pause, so the chevrons track item motion exactly.
    function beltScroll(period) {
        const cellsPerTick = research.unlocked.fastBelts ? 2 : 1;
        return ((animMs / tickMs) * TILE_SIZE * cellsPerTick) % period;
    }

    // A small "V" with its tip at (cx,cy), pointing along the unit vector (dx,dy).
    function drawChevron(g, cx, cy, dx, dy, color, alpha) {
        const s = 6;
        const perpX = -dy;
        const perpY = dx;
        g.moveTo(cx - dx * s + perpX * s, cy - dy * s + perpY * s);
        g.lineTo(cx, cy);
        g.lineTo(cx - dx * s - perpX * s, cy - dy * s - perpY * s);
        g.stroke({ width: 3, color, alpha, cap: 'round', join: 'round' });
    }

    // Scrolling chevrons along a straight belt — the moving surface.
    function drawStraightChevrons(g, px, py, dir, alpha) {
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;
        const d = DIR_VEC[dir];
        const spacing = TILE_SIZE / 3;
        const offset = beltScroll(TILE_SIZE);
        for (let k = 0; k < 3; k++) {
            const t = ((k * spacing + offset) % TILE_SIZE) - TILE_SIZE / 2;
            if (Math.abs(t) > TILE_SIZE / 2 - 10) continue; // keep inside the body
            drawChevron(g, cx + d.dx * t, cy + d.dy * t, d.dx, d.dy, 0xffffff, 0.8 * alpha);
        }
    }

    // A smooth 90° elbow: a thick rounded stroke from the entry edge through the
    // tile centre to the exit edge, with chevrons scrolling along the curve.
    function drawBeltCorner(g, px, py, inDir, outDir, alpha) {
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;
        const din = DIR_VEC[inDir];
        const dout = DIR_VEC[outDir];
        const reach = TILE_SIZE / 2 - 4;
        // item enters from the side opposite to its travel direction
        const ex = cx - din.dx * reach;
        const ey = cy - din.dy * reach;
        const sx = cx + dout.dx * reach;
        const sy = cy + dout.dy * reach;
        g.moveTo(ex, ey);
        g.quadraticCurveTo(cx, cy, sx, sy);
        g.stroke({ width: 13, color: 0xffffff, alpha: 0.85 * alpha, cap: 'round', join: 'round' });
        // chevrons ride the quadratic from entry (u=0) to exit (u=1)
        const phase = beltScroll(TILE_SIZE) / TILE_SIZE;
        for (let k = 0; k < 3; k++) {
            const u = (k / 3 + phase / 3) % 1;
            const iu = 1 - u;
            const qx = iu * iu * ex + 2 * iu * u * cx + u * u * sx;
            const qy = iu * iu * ey + 2 * iu * u * cy + u * u * sy;
            let tx = 2 * iu * (cx - ex) + 2 * u * (sx - cx);
            let ty = 2 * iu * (cy - ey) + 2 * u * (sy - cy);
            const len = Math.hypot(tx, ty) || 1;
            tx /= len;
            ty /= len;
            drawChevron(g, qx, qy, tx, ty, 0x1b4d85, 0.9 * alpha);
        }
    }

    // An arrow sitting on the `side` edge pointing inward (toward the centre) —
    // marks an input on splitters/mergers, the mirror of drawArrow.
    function drawInArrow(g, px, py, side, color, alpha) {
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;
        const d = DIR_VEC[side] ?? DIR_VEC.right;
        const baseX = cx + d.dx * (TILE_SIZE / 2 - 4);
        const baseY = cy + d.dy * (TILE_SIZE / 2 - 4);
        const tipX = baseX - d.dx * 10;
        const tipY = baseY - d.dy * 10;
        const perpX = -d.dy;
        const perpY = d.dx;
        const half = 6;
        g.poly([
            tipX, tipY,
            baseX + perpX * half, baseY + perpY * half,
            baseX - perpX * half, baseY - perpY * half,
        ]);
        g.fill({ color, alpha });
    }

    function drawResource(g, type, px, py) {
        const color = RESOURCE_COLOR[type] ?? 0x666666;
        // ambient glow, tinted by the ore color, gently out of phase per tile
        const pulse = 0.5 + 0.5 * Math.sin(animMs / 700 + (px + py) * 0.05);
        g.roundRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2, 9);
        g.stroke({ width: 3, color, alpha: 0.2 + 0.3 * pulse });
        g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
        g.fill({ color, alpha: 0.45 });
        // a few speckles to read as ore
        const dots = [[0.3, 0.35], [0.62, 0.4], [0.45, 0.66], [0.7, 0.7], [0.32, 0.62]];
        for (const [fx, fy] of dots) {
            g.circle(px + TILE_SIZE * fx, py + TILE_SIZE * fy, 3);
            g.fill({ color: 0x000000, alpha: 0.28 });
        }
    }

    function drawMachineBody(g, machine, px, py, alpha = 1, coords = null) {
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;
        // Drives the subtle "working" body animations; 0 for build ghosts
        // (no progress field) and idle machines.
        const frac = machine.progress != null ? machineProgressFraction(machine) : 0;

        if (machine.type === 'belt') {
            g.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 10);
            g.fill({ color: 0x2f7bd1, alpha });

            // Bend the belt when its feeder arrives from a perpendicular side.
            // coords is omitted for the build ghost, which stays a straight belt.
            const inDir = coords ? incomingFlowDir(coords.x, coords.y, machine) : null;
            const out = DIR_VEC[machine.dir];
            const isCorner = inDir && inDir !== machine.dir
                && !(DIR_VEC[inDir].dx === -out.dx && DIR_VEC[inDir].dy === -out.dy);

            if (isCorner) {
                drawBeltCorner(g, px, py, inDir, machine.dir, alpha);
            } else {
                drawStraightChevrons(g, px, py, machine.dir, alpha);
            }
            return;
        }

        if (machine.type === 'splitter') {
            g.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 10);
            g.fill({ color: 0x16a085, alpha });
            // one input from the back, three bright outputs on the other sides
            drawInArrow(g, px, py, OPPOSITE[machine.dir], 0xffffff, 0.4 * alpha);
            for (const od of [machine.dir, ...PERP[machine.dir]]) drawArrow(g, px, py, od, 0xffffff, 0.85 * alpha);
            g.circle(cx, cy, 2.5);
            g.fill({ color: 0xffffff, alpha });
            return;
        }

        if (machine.type === 'merger') {
            g.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 10);
            g.fill({ color: 0xca6f1e, alpha });
            // three inputs on the other sides, one bright output along dir
            for (const sd of [OPPOSITE[machine.dir], ...PERP[machine.dir]]) drawInArrow(g, px, py, sd, 0xffffff, 0.4 * alpha);
            drawArrow(g, px, py, machine.dir, 0xffffff, 0.9 * alpha);
            g.circle(cx, cy, 2.5);
            g.fill({ color: 0xffffff, alpha });
            return;
        }

        if (machine.type === 'extractor') {
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.fill({ color: 0x3c4452, alpha });
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.stroke({ width: 2, color: 0x222831, alpha });
            // drill chevrons — they march downward as the extractor works
            for (let i = 0; i < 3; i++) {
                const yy = cy - 10 + ((i * 8 + frac * 8) % 24);
                g.poly([cx - 9, yy, cx, yy + 6, cx + 9, yy]);
                g.stroke({ width: 3, color: 0xf1c40f, alpha });
            }
            drawArrow(g, px, py, machine.dir, 0xf1c40f, 0.9 * alpha);
            return;
        }

        if (machine.type === 'smelter') {
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.fill({ color: 0x6e3b2a, alpha });
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.stroke({ width: 2, color: 0x3d2017, alpha });
            // glowing furnace mouth — heat builds with progress and flickers
            const flicker = frac > 0 ? 0.12 * Math.sin(animMs / 70 + px) : 0;
            const heat = 0.45 + 0.55 * frac + flicker;
            g.roundRect(cx - 12, cy - 4, 24, 14, 3);
            g.fill({ color: 0xff7a18, alpha: alpha * Math.min(1, heat) });
            g.roundRect(cx - 12, cy - 4, 24, 5, 2);
            g.fill({ color: 0xffd166, alpha: 0.9 * alpha * Math.min(1, heat) });
            drawArrow(g, px, py, machine.dir, 0xffd166, 0.9 * alpha);
            return;
        }

        if (machine.type === 'assembler') {
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.fill({ color: 0x5b3a78, alpha });
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.stroke({ width: 2, color: 0x35224a, alpha });
            // gear — rotates one tooth per completed operation
            const rot = frac * (Math.PI / 4);
            g.circle(cx, cy - 2, 11);
            g.fill({ color: 0xcdb4f0, alpha });
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 + rot;
                g.rect(cx + Math.cos(a) * 10 - 2, cy - 2 + Math.sin(a) * 10 - 2, 4, 4);
                g.fill({ color: 0xcdb4f0, alpha });
            }
            g.circle(cx, cy - 2, 4);
            g.fill({ color: 0x5b3a78, alpha });
            drawArrow(g, px, py, machine.dir, 0xcdb4f0, 0.9 * alpha);
            return;
        }

        if (machine.type === 'lab') {
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.fill({ color: 0x2c3e6b, alpha });
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.stroke({ width: 2, color: 0x1a2540, alpha });
            // flask glyph — a bubble rises through it while analysing
            g.circle(cx, cy + 4, 9);
            g.fill({ color: 0xb07cf0, alpha });
            g.rect(cx - 3, cy - 12, 6, 8);
            g.fill({ color: 0xb07cf0, alpha });
            g.circle(cx - 3, cy + 2, 2.5);
            g.fill({ color: 0xffffff, alpha: 0.6 * alpha });
            if (frac > 0) {
                g.circle(cx + 3, cy + 9 - frac * 14, 2);
                g.fill({ color: 0xffffff, alpha: 0.8 * alpha });
            }
            return;
        }

        if (machine.type === 'generator') {
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.fill({ color: 0x274156, alpha });
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.stroke({ width: 2, color: 0x16242f, alpha });
            // lightning bolt
            g.poly([cx + 5, cy - 14, cx - 7, cy + 3, cx - 1, cy + 3, cx - 5, cy + 14, cx + 7, cy - 3, cx + 1, cy - 3]);
            g.fill({ color: 0xf7e463, alpha });
            return;
        }

        if (machine.type === 'sink') {
            g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
            g.fill({ color: 0xe74c3c, alpha });
            g.circle(cx, cy, 12);
            g.fill({ color: 0x7a1f15, alpha });
            for (const dir of ['right', 'down', 'left', 'up']) {
                drawArrow(g, px, py, dir, 0xffffff, 0.25 * alpha);
            }
            return;
        }
    }

    function drawTierPips(g, machine, px, py) {
        if (!UPGRADABLE.has(machine.type)) return;
        for (let i = 0; i < MAX_TIER; i++) {
            const cx = px + 9 + i * 8;
            const cy = py + 9;
            g.circle(cx, cy, 3);
            if (i < machine.tier) g.fill(0xffd54a);
            else g.stroke({ width: 1, color: 0xffd54a, alpha: 0.5 });
        }
    }

    function drawProgress(g, machine, px, py) {
        if (machine.type === 'belt' || machine.type === 'sink'
            || machine.type === 'splitter' || machine.type === 'merger') return;
        const frac = machineProgressFraction(machine);
        if (frac <= 0) return;
        const w = TILE_SIZE - 16;
        const y = py + TILE_SIZE - 9;
        g.rect(px + 8, y, w, 3);
        g.fill({ color: 0x000000, alpha: 0.35 });
        g.rect(px + 8, y, w * frac, 3);
        g.fill(0x6ee7b7);
    }

    // Power feedback on top of the body: fueled generators show a flickering
    // flame; working powered machines get a pulsing glow whose speed and
    // brightness scale with the network throttle; a starved machine (or an
    // unfueled generator) goes dark with a red "no power" pip.
    function drawNoPower(g, px, py) {
        g.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
        g.fill({ color: 0x000000, alpha: 0.45 });
        const blink = 0.6 + 0.4 * Math.sin(animMs / 250);
        g.circle(px + TILE_SIZE - 11, py + 11, 4);
        g.fill({ color: 0xe74c3c, alpha: blink });
    }

    function drawPowerStatus(g, m, px, py) {
        if (m.type === 'generator') {
            if (m.fuelTicks > 0) {
                const cx = px + TILE_SIZE / 2;
                const f = 0.7 + 0.3 * Math.sin(animMs / 90 + px);
                g.poly([cx - 6, py + 18, cx, py + 18 - 10 * f, cx + 6, py + 18]);
                g.fill({ color: 0xff7a18, alpha: 0.95 });
                g.poly([cx - 3, py + 18, cx, py + 18 - 5 * f, cx + 3, py + 18]);
                g.fill({ color: 0xffd166, alpha: 0.95 });
            } else {
                drawNoPower(g, px, py);
            }
            return;
        }
        if (!POWER_DRAW[m.type]) return;
        const working = m.pendingOutput !== null || m.progress > 0;
        if (!working) return;
        const th = power.throttle;
        if (th <= 0.02) {
            drawNoPower(g, px, py);
            return;
        }
        const freq = 0.002 + 0.006 * th; // brownout → slower pulse
        const pulse = 0.5 + 0.5 * Math.sin(animMs * freq + px + py);
        const a = (0.12 + 0.4 * th) * (0.4 + 0.6 * pulse); // brownout → dimmer
        g.roundRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4, 9);
        g.stroke({ width: 3, color: 0x7fdfff, alpha: a });
    }

    // ---- Per-frame draw -----------------------------------------------------
    function draw(state) {
        const now = performance.now();
        const frameDt = Math.min(100, now - lastDrawNow);
        lastDrawNow = now;
        if (!state.paused) animMs += frameDt * state.speed;

        visuals.clear();

        for (let x = 0; x < GRID_WIDTH; x++) {
            for (let y = 0; y < GRID_HEIGHT; y++) {
                const cell = grid[x][y];
                const px = x * TILE_SIZE;
                const py = y * TILE_SIZE;

                if (cell.resource) drawResource(visuals, cell.resource, px, py);
                if (cell.machine) {
                    drawMachineBody(visuals, cell.machine, px, py, 1, { x, y });
                    drawPowerStatus(visuals, cell.machine, px, py);
                    drawTierPips(visuals, cell.machine, px, py);
                    drawProgress(visuals, cell.machine, px, py);
                }
            }
        }

        drawOverlay(state);
    }

    function drawOverlay(state) {
        overlay.clear();
        const { hovered, tool, dir } = state;
        if (hovered.x < 0) return;

        const px = hovered.x * TILE_SIZE;
        const py = hovered.y * TILE_SIZE;

        overlay.roundRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2, 8);
        overlay.stroke({ width: 2, color: 0xffffff, alpha: 0.2 });

        if (tool === 'erase') {
            overlay.roundRect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12, 10);
            overlay.fill({ color: 0xe74c3c, alpha: 0.2 });
        } else if (tool === 'upgrade') {
            const ok = canUpgrade(hovered.x, hovered.y);
            overlay.roundRect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12, 10);
            overlay.fill({ color: ok ? 0xffd54a : 0x888888, alpha: 0.22 });
        } else {
            // build ghost
            const ok = canBuildMachine(hovered.x, hovered.y, tool);
            drawMachineBody(overlay, { type: tool, dir }, px, py, 0.5);
            overlay.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 10);
            overlay.fill({ color: ok ? 0x2ecc71 : 0xe74c3c, alpha: 0.18 });
        }

        if (state.lastBuildPulseMs > 0) {
            const a = state.lastBuildPulseMs / 120;
            overlay.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 12);
            overlay.stroke({ width: 3, color: 0xffffff, alpha: 0.3 * a });
        }
    }

    return { world, applyEvents, tweenItems, draw, reset };
}
