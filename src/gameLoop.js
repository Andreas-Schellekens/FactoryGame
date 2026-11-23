// src/gameLoop.js — drives the fixed-timestep simulation on a
// requestAnimationFrame loop and hands each tick's events to the renderer.
import { TICK_RATE } from './config.js';
import { updateFactoryLogic } from './grid.js';

const MAX_TICKS_PER_FRAME = 8;

/**
 * @param {ReturnType<typeof import('./renderer.js').createRenderer> extends Promise<infer R> ? R : never} renderer
 * @param {{ paused: boolean, speed: number, lastBuildPulseMs: number }} state
 * @param {(dt: number) => void} [onFrame]  extra per-frame work (HUD, director…), before drawing
 * @param {(events: any[]) => void} [onEvents]  sees each tick's FactoryEvents too (sound)
 */
export function startGameLoop(renderer, state, onFrame, onEvents) {
    const timePerTick = 1000 / TICK_RATE;
    let acc = 0;
    let last = performance.now();

    function frame(now) {
        const dt = Math.min(100, now - last); // clamp long stalls (tab switch)
        last = now;

        renderer.tweenItems(dt);
        if (state.lastBuildPulseMs > 0) state.lastBuildPulseMs = Math.max(0, state.lastBuildPulseMs - dt);

        if (!state.paused) {
            acc += dt * state.speed;
            // Catch up if several ticks are due (high speed), but cap the work
            // per frame and drop the backlog so a stall can't spiral.
            let n = 0;
            while (acc >= timePerTick && n < MAX_TICKS_PER_FRAME) {
                // Tweens last one tick of *wall* time, so they keep up at speed.
                const events = updateFactoryLogic() ?? [];
                renderer.applyEvents(events, timePerTick / state.speed);
                onEvents?.(events);
                acc -= timePerTick;
                n++;
            }
            if (n === MAX_TICKS_PER_FRAME) acc = Math.min(acc, timePerTick);
        }

        onFrame?.(dt);
        renderer.draw(state, dt);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
