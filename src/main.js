import * as PIXI from 'pixi.js';
import { TILE_SIZE, GRID_WIDTH, GRID_HEIGHT, TICK_RATE } from './config.js';
import {
    grid,
    initGrid,
    updateFactoryLogic,
    score,
    buildMachine,
    removeMachine,
    canBuildMachine,
} from './grid.js';
import { createUI } from './ui.js';

const app = new PIXI.Application();
await app.init({
    width: GRID_WIDTH * TILE_SIZE,
    height: GRID_HEIGHT * TILE_SIZE,
    backgroundColor: 0x222222,
});
document.body.appendChild(app.canvas);

app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

initGrid();
const visuals = new PIXI.Graphics();
visuals.eventMode = 'none';
app.stage.addChild(visuals);

const overlay = new PIXI.Graphics();
overlay.eventMode = 'none';
app.stage.addChild(overlay);

const itemLayer = new PIXI.Container();
itemLayer.eventMode = 'none';
app.stage.addChild(itemLayer);

app.stage.sortableChildren = true;
itemLayer.zIndex = 10;
overlay.zIndex = 20;

app.stage.eventMode = 'static';
app.stage.hitArea = new PIXI.Rectangle(0, 0, GRID_WIDTH * TILE_SIZE, GRID_HEIGHT * TILE_SIZE);

const buildDirs = ['belt_right', 'belt_down', 'belt_left', 'belt_up'];
function nextDir(dir) {
    const idx = buildDirs.indexOf(dir);
    return buildDirs[(idx + 1) % buildDirs.length] ?? 'belt_right';
}

const state = {
    tool: 'belt',
    dir: 'belt_right',
    paused: false,
    speed: 1,
    hovered: { x: -1, y: -1 },
    lastBuildPulseMs: 0,
};

function cellCenterPx(x, y) {
    return { x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 };
}

/** @type {Map<number, { gfx: PIXI.Graphics, anim: null | { from: {x:number,y:number}, to: {x:number,y:number}, t:number, dur:number } }>} */
const itemSprites = new Map();

function createItemGfx(type) {
    const g = new PIXI.Graphics();
    g.eventMode = 'none';
    const color = type === 'iron' ? 0xe67e22 : 0xffffff;
    g.circle(0, 0, TILE_SIZE / 4);
    g.fill(color);
    g.circle(0, 0, TILE_SIZE / 4);
    g.stroke({ width: 2, color: 0x000000, alpha: 0.25 });
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

const ui = createUI({
    width: GRID_WIDTH * TILE_SIZE,
    onToolChange: (tool) => (state.tool = tool),
    onRotate: () => (state.dir = nextDir(state.dir)),
    onTogglePause: () => (state.paused = !state.paused),
    onSpeedChange: (delta) => {
        state.speed = Math.max(0.25, Math.min(4, state.speed + delta * 0.25));
    },
    getState: () => ({
        money: score,
        tool: state.tool,
        dir: state.dir,
        paused: state.paused,
        hoverText:
            state.hovered.x >= 0
                ? `Hover: (${state.hovered.x}, ${state.hovered.y})  M=${grid[state.hovered.x][state.hovered.y].machine ?? '-'}  I=${
                      grid[state.hovered.x][state.hovered.y].item?.type ?? '-'
                  }`
                : '',
    }),
});
ui.zIndex = 100;
app.stage.addChild(ui);

function drawGraphics() {
    visuals.clear(); 

    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            const cell = grid[x][y];
            const pixelX = x * TILE_SIZE;
            const pixelY = y * TILE_SIZE;

            visuals.rect(pixelX, pixelY, TILE_SIZE, TILE_SIZE);
            visuals.stroke({ width: 1, color: 0x333333 });

            // Teken de Spawner (Groen)
            if (cell.machine === 'spawner') {
                visuals.rect(pixelX + 2, pixelY + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                visuals.fill(0x2ecc71);
            }

            // Belts (directional)
            if (cell.machine?.startsWith('belt_')) {
                visuals.roundRect(pixelX + 4, pixelY + 4, TILE_SIZE - 8, TILE_SIZE - 8, 10);
                visuals.fill(0x2f7bd1);

                const cx = pixelX + TILE_SIZE / 2;
                const cy = pixelY + TILE_SIZE / 2;
                visuals.moveTo(cx, cy);
                if (cell.machine === 'belt_right') visuals.lineTo(cx + TILE_SIZE * 0.22, cy);
                if (cell.machine === 'belt_left') visuals.lineTo(cx - TILE_SIZE * 0.22, cy);
                if (cell.machine === 'belt_up') visuals.lineTo(cx, cy - TILE_SIZE * 0.22);
                if (cell.machine === 'belt_down') visuals.lineTo(cx, cy + TILE_SIZE * 0.22);
                visuals.stroke({ width: 5, color: 0xffffff, alpha: 0.7, cap: 'round' });
                visuals.circle(cx, cy, 2.5);
                visuals.fill(0xffffff);
            }

            // Teken de Sink (Rood)
            if (cell.machine === 'sink') {
                visuals.rect(pixelX + 2, pixelY + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                visuals.fill(0xe74c3c);
            }
        }
    }

    // Hover + ghost preview
    overlay.clear();
    if (state.hovered.x >= 0) {
        const hx = state.hovered.x;
        const hy = state.hovered.y;
        const px = hx * TILE_SIZE;
        const py = hy * TILE_SIZE;

        overlay.roundRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2, 8);
        overlay.stroke({ width: 2, color: 0xffffff, alpha: 0.18 });

        if (state.tool === 'belt') {
            const ok = canBuildMachine(hx, hy, state.dir);
            overlay.roundRect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12, 10);
            overlay.fill({ color: ok ? 0x2f7bd1 : 0xe74c3c, alpha: 0.22 });

            const cx = px + TILE_SIZE / 2;
            const cy = py + TILE_SIZE / 2;
            overlay.moveTo(cx, cy);
            if (state.dir === 'belt_right') overlay.lineTo(cx + TILE_SIZE * 0.22, cy);
            if (state.dir === 'belt_left') overlay.lineTo(cx - TILE_SIZE * 0.22, cy);
            if (state.dir === 'belt_up') overlay.lineTo(cx, cy - TILE_SIZE * 0.22);
            if (state.dir === 'belt_down') overlay.lineTo(cx, cy + TILE_SIZE * 0.22);
            overlay.stroke({ width: 5, color: 0xffffff, alpha: ok ? 0.35 : 0.2, cap: 'round' });
        }
    }

    if (state.lastBuildPulseMs > 0 && state.hovered.x >= 0) {
        const a = state.lastBuildPulseMs / 120;
        const px = state.hovered.x * TILE_SIZE;
        const py = state.hovered.y * TILE_SIZE;
        overlay.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 12);
        overlay.stroke({ width: 3, color: 0xffffff, alpha: 0.22 * a });
    }

    ui.update?.();
}

// ... (Je Game Loop / app.ticker.add blijft hier exact hetzelfde als eerst!) ...
let timeSinceLastTick = 0;
const timePerTick = 1000 / TICK_RATE; 

app.ticker.add((ticker) => {
    const dt = ticker.deltaMS;

    // animate items every frame
    for (const entry of itemSprites.values()) {
        if (!entry.anim) continue;
        entry.anim.t += dt;
        const a = Math.min(1, entry.anim.t / entry.anim.dur);
        entry.gfx.x = entry.anim.from.x + (entry.anim.to.x - entry.anim.from.x) * a;
        entry.gfx.y = entry.anim.from.y + (entry.anim.to.y - entry.anim.from.y) * a;
        if (a >= 1) entry.anim = null;
    }

    // small placement pulse feedback
    if (state.lastBuildPulseMs > 0) {
        state.lastBuildPulseMs = Math.max(0, state.lastBuildPulseMs - dt);
    }

    if (!state.paused) {
        timeSinceLastTick += dt * state.speed;
        if (timeSinceLastTick >= timePerTick) {
            const events = updateFactoryLogic() ?? [];
            for (const ev of events) {
                if (ev.kind === 'spawn') {
                    ensureItemSprite(ev.item, ev.at.x, ev.at.y);
                } else if (ev.kind === 'move') {
                    const sprite = ensureItemSprite(ev.item, ev.to.x, ev.to.y);
                    const from = cellCenterPx(ev.from.x, ev.from.y);
                    const to = cellCenterPx(ev.to.x, ev.to.y);
                    sprite.anim = { from, to, t: 0, dur: timePerTick };
                    sprite.gfx.x = from.x;
                    sprite.gfx.y = from.y;
                } else if (ev.kind === 'consume') {
                    removeItemSprite(ev.item.id);
                }
            }
            timeSinceLastTick -= timePerTick;
        }
    }
    drawGraphics();
});

function applyBuildOrErase(gx, gy, button) {
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return;
    if (button === 2 || state.tool === 'erase') {
        removeMachine(gx, gy);
        return;
    }
    if (state.tool === 'belt') {
        const ok = buildMachine(gx, gy, state.dir);
        if (ok) state.lastBuildPulseMs = 120;
    }
}

window.addEventListener('keydown', (e) => {
    if (e.key === '1') state.tool = 'belt';
    if (e.key === '2') state.tool = 'erase';
    if (e.key === 'r' || e.key === 'R') state.dir = nextDir(state.dir);
    if (e.key === ' ') {
        e.preventDefault();
        state.paused = !state.paused;
    }
    if (e.key === '+' || e.key === '=' ) state.speed = Math.max(0.25, Math.min(4, state.speed + 0.25));
    if (e.key === '-' || e.key === '_' ) state.speed = Math.max(0.25, Math.min(4, state.speed - 0.25));
});

app.stage.on('pointermove', (event) => {
    const gx = Math.floor(event.global.x / TILE_SIZE);
    const gy = Math.floor(event.global.y / TILE_SIZE);
    if (gx >= 0 && gx < GRID_WIDTH && gy >= 0 && gy < GRID_HEIGHT) state.hovered = { x: gx, y: gy };
    else state.hovered = { x: -1, y: -1 };
});

app.stage.on('pointerdown', (event) => {
    // UI elements stop propagation; if we got here, it's a world click
    const gx = Math.floor(event.global.x / TILE_SIZE);
    const gy = Math.floor(event.global.y / TILE_SIZE);
    if (event.button === 0 || event.button === 2) applyBuildOrErase(gx, gy, event.button);
});