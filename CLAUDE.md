# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server with hot reload
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build locally

There is no test runner, linter, or formatter configured.

## Overview

A 2D Factorio-style factory game (vanilla JS + Vite, rendered with [PixiJS](https://pixijs.com) v8). The player builds directional conveyor belts on a grid; a fixed spawner emits items that travel along belts into a sink, which awards money used to fund more belts.

Some comments are written in Dutch.

## Architecture

The codebase splits into two halves: **simulation** (`grid.js`) and **everything else** (`main.js`). The simulation has no knowledge of Pixi or rendering.

### `src/grid.js` — simulation core (the source of truth)
- Owns the `grid` (2D array of `{ machine, item }` cells) and the `score` (money), both exported.
- `updateFactoryLogic()` advances the world one tick and **returns an array of `FactoryEvent`s** (`spawn` / `move` / `consume`). It does the work in a fixed order each tick: sinks consume → belts move items (scanned in reverse to limit multi-cell chaining within one tick) → spawner emits. The event list is the simulation's only output channel; the renderer reacts to it rather than diffing the grid.
- Machines are plain strings: `'spawner'`, `'sink'`, `'belt_right'`, `'belt_left'`, `'belt_up'`, `'belt_down'`. Spawner/sink are "protected" and cannot be erased. The starting layout (spawner at `[1][2]`, sink at `[8][2]`) is set in `initGrid()`. The spawner always emits to the cell to its right (`x+1`).
- `buildMachine` / `removeMachine` / `canBuildMachine` mutate the grid and enforce the belt cost (`BELT_COST`).

### `src/main.js` — Pixi app, game loop, rendering, and input (all here)
- Note: `src/renderer.js` and `src/gameLoop.js` are empty placeholder files — despite their names, the render code and the loop both live in `main.js`. Don't assume logic lives in those files.
- Runs a **fixed-timestep tick on top of a per-frame ticker**: `app.ticker` accumulates `deltaMS * state.speed` and calls `updateFactoryLogic()` once per `1000 / TICK_RATE` ms. Item sprites are tweened between cell centers every frame using the events returned from the tick, so visual motion is decoupled from the tick rate.
- Maintains `itemSprites` (a `Map<itemId, { gfx, anim }>`) as the bridge between simulation items and Pixi graphics; `spawn`/`move`/`consume` events create, animate, or destroy entries.
- Holds the transient UI `state` (selected tool, build direction, paused, speed, hovered cell) that does **not** belong in the simulation.
- The Pixi stage uses three layers by `zIndex`: `visuals` (grid + machines, redrawn fully each frame), `itemLayer` (item sprites), `overlay` (hover ghost + placement pulse), plus the UI on top.

### `src/ui.js` — Pixi-drawn HUD
- `createUI({...})` returns a Pixi `Container` with an attached `update()` method. It is driven entirely through callbacks (`onToolChange`, `onRotate`, `onTogglePause`, `onSpeedChange`) and a `getState()` pull function passed in from `main.js` — it reads no game state directly.
- UI buttons call `e.stopPropagation()` on pointer events so world clicks underneath are not triggered.

### `src/config.js` — tunables
`TILE_SIZE`, `GRID_WIDTH`, `GRID_HEIGHT`, `TICK_RATE`. Grid is indexed `grid[x][y]`; pixel position is `x * TILE_SIZE`.

## Conventions

- Coordinates are always `(x, y)` with `x` as the column. Keep simulation logic in `grid.js` returning events; keep all Pixi/DOM/input code in `main.js`. When adding a new machine type, extend the string set and the tick phases in `updateFactoryLogic()`, then add its drawing in `drawGraphics()` and any new tool wiring in `ui.js`/`state`.
