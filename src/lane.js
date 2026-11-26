// src/lane.js — the HUD's message lane: one column at top centre, under the top bar. The phase
// ribbon hangs at the top of it (and swells there into the celebration banner); under it the
// achievement toasts (achievements.js) and the short toasts (ui.js toast()) stack, newest at
// the bottom. Each item slides in and out on its own, and one that leaves folds its room away,
// so the ones under it move up instead of jumping. Nothing in the lane takes the pointer.
//
// ui.js builds the lane (`createLane`) when it builds the HUD; achievements.js only posts to it,
// looking it up when a toast shows (it is created before the HUD is).

const LEAVE_MS = 420; // the fade, then the fold (style.css .lane-slot)

/** The lane's stack in the HUD, or null before the HUD is built. */
const findStack = () => document.querySelector('#hud .lane-stack');

/**
 * Build the lane in `root` (#hud) with `ribbon` at its top.
 * @returns {{ lane: HTMLElement, stack: HTMLElement }}
 */
export function createLane(root, ribbon) {
    const lane = document.createElement('div');
    lane.className = 'lane';
    const stack = document.createElement('div');
    stack.className = 'lane-stack';
    lane.append(ribbon, stack);
    root.appendChild(lane);
    return { lane, stack };
}

/**
 * Post `item` (an element with its own look: `.toast`, `.achv-toast`) to the lane for `ms`.
 * The item gets `show` while it is up. `host` puts it somewhere else (default: the lane, else
 * #hud). `onGone` runs once it has left and been removed.
 * @returns {{ item: HTMLElement, leave: () => void, hold: (ms: number) => void, leaving: () => boolean }}
 */
export function postToLane(item, ms, { host = null, onGone = null } = {}) {
    const slot = document.createElement('div');
    slot.className = 'lane-slot';
    slot.appendChild(item);
    // Newest first in the DOM: the stack runs bottom-up (column-reverse), so it shows at the
    // bottom, and querySelector('.toast') finds the latest one.
    (host ?? findStack() ?? document.getElementById('hud') ?? document.body).prepend(slot);
    void item.offsetWidth; // start from the hidden state, so it slides in
    item.classList.add('show');
    let gone = false;
    let timer = setTimeout(leave, ms);
    function leave() {
        if (gone) return;
        gone = true;
        clearTimeout(timer);
        item.classList.remove('show');
        // Fold the slot's room away (after the fade has started), so the rest moves up.
        slot.style.height = `${slot.offsetHeight}px`;
        void slot.offsetHeight;
        slot.classList.add('gone');
        slot.style.height = '0px';
        setTimeout(() => {
            slot.remove();
            onGone?.();
        }, LEAVE_MS);
    }
    return {
        item,
        leave,
        /** Keep it up for another `ms` from now (the same toast again). */
        hold(more) {
            if (gone) return;
            clearTimeout(timer);
            timer = setTimeout(leave, more);
        },
        leaving: () => gone,
    };
}
