// src/blueprint.js — the small "blueprint" picture on a save slot: the factory drawn as a
// plan in the HUD's palette (midnight paper, hairline grid, ore as tinted cells, the river,
// the plot outline, machines as squares coloured by what they do). Drawn in 2D from the
// live grid, so it works without WebGL and stays a few kilobytes.
import { GRID_WIDTH as W, GRID_HEIGHT as H } from './config.js';
import { grid, plotRect } from './grid.js';

const CELL = 4; // pixels per cell: 128 × 96
const ORE = { ironOre: '#6f86a6', copperOre: '#c17a4e', coalOre: '#4a4f5c', sulfurOre: '#c9b34a' };
const KIND = {
    belt: '#9fb3cf', splitter: '#cfe0ff', merger: '#cfe0ff',
    extractor: '#f2c14e', generator: '#ffd23f', lab: '#3cc8b4', fabricator: '#3cc8b4',
    sink: '#f4efe6',
};
const PROCESSOR = '#ff7a2a';

/** A PNG data URL of the current factory. */
export function blueprintThumb() {
    const c = document.createElement('canvas');
    c.width = W * CELL;
    c.height = H * CELL;
    const g = c.getContext('2d');
    g.fillStyle = '#0f1d33';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(160, 190, 230, 0.10)';
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 2) {
        g.beginPath();
        g.moveTo(x * CELL + 0.5, 0);
        g.lineTo(x * CELL + 0.5, c.height);
        g.stroke();
    }
    for (let y = 0; y <= H; y += 2) {
        g.beginPath();
        g.moveTo(0, y * CELL + 0.5);
        g.lineTo(c.width, y * CELL + 0.5);
        g.stroke();
    }
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const cell = grid[x][y];
            if (cell.water) {
                g.fillStyle = '#2b5c8a';
                g.fillRect(x * CELL, y * CELL, CELL, CELL);
            } else if (cell.resource) {
                g.fillStyle = ORE[cell.resource] ?? '#555';
                g.globalAlpha = 0.55;
                g.fillRect(x * CELL, y * CELL, CELL, CELL);
                g.globalAlpha = 1;
            }
        }
    }
    const r = plotRect();
    g.strokeStyle = 'rgba(255, 122, 42, 0.8)';
    g.setLineDash([3, 2]);
    g.strokeRect(r.x * CELL + 0.5, r.y * CELL + 0.5, r.w * CELL - 1, r.h * CELL - 1);
    g.setLineDash([]);
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const m = grid[x][y].machine;
            if (!m) continue;
            g.fillStyle = KIND[m.type] ?? PROCESSOR;
            const inset = m.type === 'belt' ? 1 : 0;
            g.fillRect(x * CELL + inset, y * CELL + inset, CELL - inset * 2, CELL - inset * 2);
        }
    }
    return c.toDataURL('image/png');
}
