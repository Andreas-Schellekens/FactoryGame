# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server with hot reload
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build locally

There is no test runner, linter, or formatter configured.

## Overview

A 2D Factorio-style factory game (vanilla JS + Vite, rendered with [PixiJS](https://pixijs.com) v8). The player builds a production chain on a grid: **ore node → extractor → belts → smelter → belts → assembler → belts → sink**. The sink pays only for finished products; that money funds more machines and tier upgrades.

The production chain (all defined in `grid.js`):
- Two ore deposits sit on the map as terrain (`cell.resource`): `ironOre`, `copperOre`.
- **Extractor** (must be placed on an ore node) mines that ore.
- **Smelter** turns `ironOre→ironIngot`, `copperOre→copperIngot`.
- **Assembler** (the combiner) consumes `1 ironIngot + 1 copperIngot → circuit` (the product).
- **Sink** consumes only `circuit` (`PRODUCT_TYPE`) and pays `PRODUCT_REWARD`.

Two routing machines move items without transforming them: a **splitter** (1 input on the back → 3 outputs: straight ahead + both perpendiculars, round-robin) and a **merger** (3 inputs: back + both perpendiculars → 1 output straight ahead). `dir` is the primary flow axis for both.

An **order** system layers a timed bonus on top: a demand for N products within M ticks pays a one-off reward on completion (see `grid.js` order state and `config.js` `ORDER_*`).

Some older comments may be in Dutch.

## Architecture

The simulation (`grid.js`) is the source of truth and has **no knowledge of Pixi or the DOM**. Everything else reacts to it. Each `src/` file has one job:

### `src/grid.js` — simulation core
- Owns the `grid` (2D array of `{ machine, item, resource }` cells) and the exported `score` (money). `score` is a live ES-module binding — other modules `import { score }` and read the current value directly. Same pattern for `tickCount` (the monotonic sim clock, advanced once per tick) and the `order` object (mutated in place).
- A **machine is an object**: `{ type, dir, tier, buffer, pendingOutput, progress, produces?, toggle? }`. `type` ∈ `belt | splitter | merger | extractor | smelter | assembler | sink`. `dir` ∈ `right | down | left | up` (output / primary-flow direction). `buffer` holds input-item counts (capped at `BUFFER_CAP`); items inside a buffer have **no sprite** (they were `consume`d on entry). `toggle` is the round-robin cursor for splitters/mergers. Tier (1–`MAX_TIER`) scales processing speed via `PROCESS_TICKS`.
- `updateFactoryLogic()` advances one tick and **returns `FactoryEvent`s** (`spawn` / `move` / `consume`). It first does `tickCount++`. Phases run in a fixed order: (1) sinks consume products, pay out, and credit the active order — then the order resolves (complete pays `order.reward`, or fail past the deadline) → (2) processors absorb their input-slot item into their buffer → (3) **movers** (belts, splitters, mergers) relocate items, reverse scan → (4) processors run a recipe over `progress` ticks and eject the result → (5) extractors mine. Ejection/mining happen *after* movers so a newly produced item waits a tick before moving (no same-tick double-hop). The event list is the simulation's only output channel; the renderer reacts to it rather than diffing the grid.
- Splitters push their item to one of `splitterOutputs(dir)` (`[dir, ...PERP[dir]]`) round-robin; mergers push their held item forward then pull from one of `mergerInputs(dir)` (`[OPPOSITE[dir], ...PERP[dir]]`) — pull-only (`cellAccepts` is false for a merger), gated by `outputsToward()` so they only take from neighbours aimed at them. `toggle` advances past the side actually used so a blocked side can't skew the balance.
- `cellAccepts(cell, itemType)` is the single gate for all item transfer (belts, splitters, machine inputs, sink): it enforces empty slot, recipe match, buffer cap, and product-only sink. Recipes live in the `SMELT` / `ASSEMBLE` tables + `recipeFor()`.
- Build/economy API: `canBuildMachine` / `buildMachine` (extractor requires `cell.resource`), `placeBelt` (drag-laying), `removeMachine` (returns `consume` events for any destroyed in-transit item; the sink is protected), `canUpgrade` / `upgradeMachine` / `upgradeCost`, and `machineProgressFraction` (for the renderer's progress bars).
- Order API: `order` (state: `active`, `status` ∈ `none | active | completed | failed`, `target`, `reward`, `delivered`, `startTick`, `deadlineTick`) and `startOrder({ target, ticks, reward })` — grid.js counts deliveries and pays the reward; *which* order to issue (difficulty/cadence) is policy chosen in `main.js`. The `status` flip is the only completion/failure signal — the HUD polls it via `getState()`.
- Save/load API: `serialize()` returns a plain JSON-able snapshot (version, `score`, `tickCount`, `order`, and only the non-empty cells — terrain is recreated by `initGrid()`); `loadState(data)` rebuilds the grid (re-`initGrid()` then overlays saved machines onto `makeMachine` defaults) and **returns `spawn` events for in-transit items only** — buffer contents and `pendingOutput` have no sprite, so they are never spawned. Returns `null` on missing/version-mismatched data.

### `src/renderer.js` — all Pixi drawing
- `createRenderer(app)` builds a `world` container with three layers (bottom→top): `visuals` (grid + ore nodes + machines, redrawn each frame), `itemLayer`, `overlay` (hover ghost + placement pulse). Returns `{ world, applyEvents, tweenItems, draw, reset }`.
- Maintains `itemSprites` (`Map<itemId, { gfx, anim }>`) bridging simulation items to Pixi graphics. `applyEvents(events, tickMs)` creates/animates/destroys sprites; `tweenItems(dt)` interpolates them every frame so motion is decoupled from the tick rate; `draw(state)` redraws everything plus the hover/ghost overlay; `reset()` destroys all item sprites (used on load before re-spawning restored items).
- Sprites are procedural `PIXI.Graphics`, not image assets. Item looks live in `ITEM_STYLE` (chunk/bar/chip shapes), ore-node tints in `RESOURCE_COLOR`, and each machine has a distinct body in `drawMachineBody()` (reused at low alpha for the build ghost). `drawTierPips` shows tier, `drawProgress` shows `machineProgressFraction`.

### `src/gameLoop.js` — the loop
- `startGameLoop(app, renderer, state)` runs a **fixed-timestep tick on a per-frame ticker**: accumulates `deltaMS * state.speed` and calls `updateFactoryLogic()` once per `1000 / TICK_RATE` ms (catching up multiple ticks per frame, capped to avoid a spiral of death), feeding events to `renderer.applyEvents`.

### `src/ui.js` — DOM HUD
- `createUI({ root, ...callbacks, getState })` builds the sidebar HUD as **plain DOM** inside `root` (the `#toolbar` element) and returns `{ update }`. It is driven entirely through callbacks (`onToolChange`, `onRotate`, `onTogglePause`, `onSpeedChange`, `onSave`, `onLoad`) and a `getState()` pull function — it reads no game state directly. The HUD lives outside the canvas, so it never overlaps the playfield. Sections: Status (money/speed), Order (demand + progress + countdown/result, from `getState().order`), Build, Tools, Simulation, Save (Save/Load buttons with a transient status line), Inspector, Help.

### `src/main.js` — orchestrator
- Thin wiring layer: creates the Pixi app (canvas → `#stage`, sized to the grid only), calls `initGrid()`, `createRenderer`, `createUI`, `startGameLoop`, and translates pointer/keyboard input into `buildMachine` / `removeMachine` / `upgradeMachine` calls (feeding any returned events to `renderer.applyEvents`). Belts are drag-laid (`placeBelt`); erase also drags. Owns the transient `state` (tool, dir, paused, speed, hovered, build pulse, drag) that does **not** belong in the simulation. Tools: `belt | splitter | merger | extractor | smelter | assembler | upgrade | erase` (keys `1`–`4` belt/extractor/smelter/assembler, `5` upgrade, `6` erase, `7`/`8` splitter/merger, `R` rotates, `Space` pauses).
- Owns **order policy**: `issueOrder()` picks random `target`/`ticks`/`reward` from the `config.js` `ORDER_*` ranges; a per-frame `tickOrders()` watcher issues the first order and auto-cycles a new one `ORDER_GRACE_TICKS` after the previous resolves.
- Owns **persistence** (localStorage key `factory.save.v1`): `saveGame()` JSON-stringifies `serialize()`; `loadGame()` parses, calls `loadState()`, then `renderer.reset()` + `renderer.applyEvents(events, 0)` to rebuild sprites and clears transient drag/hover. Both are wrapped in try/catch and return a boolean for the UI status line.

### `src/config.js` — tunables
`TILE_SIZE`, `GRID_WIDTH`, `GRID_HEIGHT`, `TICK_RATE`; economy (`STARTING_MONEY`, `PRODUCT_REWARD`, `MACHINE_COST`, `UPGRADE_COST`, `MAX_TIER`); processing (`PROCESS_TICKS` = ticks-per-op per tier, `BUFFER_CAP`); and orders (`ORDER_TARGET`, `ORDER_TICKS`, `ORDER_REWARD` are `[min, max]` ranges, `ORDER_GRACE_TICKS`). Grid is indexed `grid[x][y]`; pixel position is `x * TILE_SIZE`.

### Layout
`index.html` has `#app` → `#toolbar` (DOM sidebar) + `#stage` (Pixi canvas mount); styled in `src/style.css`.

## Conventions

- Coordinates are always `(x, y)` with `x` as the column. Keep the boundaries clean: simulation logic, recipes, and economy in `grid.js`/`config.js` (returning events), Pixi drawing in `renderer.js`, loop timing in `gameLoop.js`, DOM HUD in `ui.js`, input/wiring in `main.js`.
- **Sprite/event invariant:** an item has a sprite only between its `spawn` and `consume` events. Anything that destroys an in-transit item (e.g. `removeMachine`) must emit a `consume` so the sprite is cleaned up; items absorbed into a machine buffer are `consume`d on entry. On load this means **only `cell.item` is re-spawned** — never buffer contents or `pendingOutput`.
- **Economy invariant:** `STARTING_MONEY` must cover bootstrapping one full ore→product chain, and `PRODUCT_REWARD` must make a running chain net-positive, or the game stalls.
- To add a **machine type**: add it to `MACHINE_COST` (+ `PROCESS_TICKS` if it processes), handle it in `cellAccepts` + the relevant `updateFactoryLogic` phase (processor → `PROCESSORS`/`UPGRADABLE`; pure router → the movers phase), draw it in `drawMachineBody`, add a build button + key in `ui.js`/`main.js`. Machines serialize automatically as long as they stay plain data.
- To add an **item type / recipe**: add it to `ITEM_STYLE` (renderer) and the `SMELT`/`ASSEMBLE` tables + `recipeFor` (grid).
- **Save format:** machines are stored as-is, so keep them plain JSON-able; `loadState` overlays saved fields onto `makeMachine` defaults, so adding a new machine field is backward-compatible. Bump `SAVE_VERSION` only for breaking changes.

## Verifying changes

There are no automated tests. Playwright (a devDependency) is available to drive the game in a real browser — launch the dev server and script clicks against `#stage canvas` (cell `(gx,gy)` center = `box + gx*TILE + TILE/2`) to build a chain and assert on `.stat.money` / the inspector. Avoid clicking cell `(0,0)` just to focus the page — that places a belt.
