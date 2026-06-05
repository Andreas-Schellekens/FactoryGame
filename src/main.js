// src/main.js — wires everything together: creates the Pixi app, builds the
// renderer/UI, starts the loop, and translates input into grid edits.
import * as PIXI from 'pixi.js';
import './style.css';
import { TILE_SIZE, GRID_WIDTH, GRID_HEIGHT } from './config.js';
import { grid, score, initGrid, buildMachine, removeMachine, upgradeMachine } from './grid.js';
import { createRenderer } from './renderer.js';
import { startGameLoop } from './gameLoop.js';
import { createUI } from './ui.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- Pixi app (canvas shows only the playfield) ---
const app = new PIXI.Application();
await app.init({
    width: GRID_WIDTH * TILE_SIZE,
    height: GRID_HEIGHT * TILE_SIZE,
    backgroundColor: 0x222222,
    antialias: true,
});
document.getElementById('stage').appendChild(app.canvas);
app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

initGrid();
const renderer = createRenderer(app);

app.stage.eventMode = 'static';
app.stage.hitArea = new PIXI.Rectangle(0, 0, GRID_WIDTH * TILE_SIZE, GRID_HEIGHT * TILE_SIZE);

// --- Shared UI/input state (kept out of the simulation) ---
const buildableTools = new Set(['belt', 'extractor', 'smelter', 'assembler']);
const rotations = ['right', 'down', 'left', 'up'];
const nextDir = (dir) => rotations[(rotations.indexOf(dir) + 1) % rotations.length] ?? 'right';

const state = {
    tool: 'belt',
    dir: 'right',
    paused: false,
    speed: 1,
    hovered: { x: -1, y: -1 },
    lastBuildPulseMs: 0,
};

// --- HUD ---
const ui = createUI({
    root: document.getElementById('toolbar'),
    onToolChange: (tool) => (state.tool = tool),
    onRotate: () => (state.dir = nextDir(state.dir)),
    onTogglePause: () => (state.paused = !state.paused),
    onSpeedChange: (delta) => (state.speed = clamp(state.speed + delta * 0.25, 0.25, 4)),
    getState: () => {
        const onGrid = state.hovered.x >= 0;
        return {
            money: score,
            tool: state.tool,
            dir: state.dir,
            speed: state.speed,
            paused: state.paused,
            hoverX: state.hovered.x,
            hoverY: state.hovered.y,
            hovered: onGrid ? grid[state.hovered.x][state.hovered.y] : null,
        };
    },
});

app.ticker.add(() => ui.update());
startGameLoop(app, renderer, state);

// --- Input ---
function actAt(gx, gy, button) {
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return;

    if (button === 2 || state.tool === 'erase') {
        renderer.applyEvents(removeMachine(gx, gy), 0);
        return;
    }
    if (state.tool === 'upgrade') {
        if (upgradeMachine(gx, gy)) state.lastBuildPulseMs = 120;
        return;
    }
    if (buildableTools.has(state.tool)) {
        if (buildMachine(gx, gy, state.tool, state.dir)) state.lastBuildPulseMs = 120;
    }
}

const keyTools = { 1: 'belt', 2: 'extractor', 3: 'smelter', 4: 'assembler', 5: 'upgrade', 6: 'erase' };
window.addEventListener('keydown', (e) => {
    if (e.key in keyTools) state.tool = keyTools[e.key];
    if (e.key === 'r' || e.key === 'R') state.dir = nextDir(state.dir);
    if (e.key === ' ') {
        e.preventDefault();
        state.paused = !state.paused;
    }
    if (e.key === '+' || e.key === '=') state.speed = clamp(state.speed + 0.25, 0.25, 4);
    if (e.key === '-' || e.key === '_') state.speed = clamp(state.speed - 0.25, 0.25, 4);
});

const cellFromEvent = (event) => ({
    gx: Math.floor(event.global.x / TILE_SIZE),
    gy: Math.floor(event.global.y / TILE_SIZE),
});

app.stage.on('pointermove', (event) => {
    const { gx, gy } = cellFromEvent(event);
    if (gx >= 0 && gx < GRID_WIDTH && gy >= 0 && gy < GRID_HEIGHT) state.hovered = { x: gx, y: gy };
    else state.hovered = { x: -1, y: -1 };
});

app.stage.on('pointerdown', (event) => {
    const { gx, gy } = cellFromEvent(event);
    if (event.button === 0 || event.button === 2) actAt(gx, gy, event.button);
});
