// src/gameLoop.js — drives the fixed-timestep simulation on top of Pixi's
// per-frame ticker, and hands each tick's events to the renderer.
import { TICK_RATE } from './config.js';
import { updateFactoryLogic } from './grid.js';

/**
 * @param {import('pixi.js').Application} app
 * @param {ReturnType<import('./renderer.js').createRenderer>} renderer
 * @param {{ paused: boolean, speed: number, lastBuildPulseMs: number }} state
 */
export function startGameLoop(app, renderer, state) {
    const timePerTick = 1000 / TICK_RATE;
    let timeSinceLastTick = 0;

    app.ticker.add((ticker) => {
        const dt = ticker.deltaMS;

        renderer.tweenItems(dt);

        if (state.lastBuildPulseMs > 0) {
            state.lastBuildPulseMs = Math.max(0, state.lastBuildPulseMs - dt);
        }

        if (!state.paused) {
            timeSinceLastTick += dt * state.speed;
            // Catch up if several ticks are due (e.g. at high speed), but cap to
            // avoid a spiral of death after a long frame stall.
            let ticksThisFrame = 0;
            while (timeSinceLastTick >= timePerTick && ticksThisFrame < 8) {
                const events = updateFactoryLogic() ?? [];
                renderer.applyEvents(events, timePerTick);
                timeSinceLastTick -= timePerTick;
                ticksThisFrame++;
            }
        }

        renderer.draw(state);
    });
}
