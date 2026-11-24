// src/camera.js — the isometric camera rig: an orthographic camera orbiting a
// ground target at a fixed elevation. Pan (keys / drag, with momentum after a
// drag), zoom (wheel) and rotate in 90° steps (Q/E), all eased. Juice: shake
// (trauma that decays), a zoom punch, and instant cuts for cinematics.
// No knowledge of the game.
import * as THREE from 'three';

const ELEVATION = THREE.MathUtils.degToRad(38);
const DISTANCE = 60;
const VIEW_HEIGHT = 15; // world units visible vertically at zoom 1
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.6;
const DEFAULT_AZIMUTH = Math.PI / 4;

/**
 * @param {{ width: number, height: number }} bounds  world-space x/z extent to keep the target inside
 */
export function createCameraRig(bounds) {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const target = new THREE.Vector3(bounds.width / 2, 0, bounds.height / 2);
    const goal = { target: target.clone(), azimuth: DEFAULT_AZIMUTH, zoom: 1 };
    let azimuth = goal.azimuth;
    let zoom = 1;        // eased zoom, before the punch
    let aspect = 1;
    let trauma = 0;      // 0..1, shake strength (squared when applied)
    let kick = 0;        // zoom punch, decays to 0
    let shakeScale = 1;  // the Camera shake setting (0 = off)
    const momentum = new THREE.Vector2(); // px/ms after a drag ends
    const lastDrag = { vx: 0, vy: 0, at: 0, h: 1 };

    function applyFrustum() {
        const h = VIEW_HEIGHT / 2;
        camera.left = -h * aspect;
        camera.right = h * aspect;
        camera.top = h;
        camera.bottom = -h;
        camera.updateProjectionMatrix();
    }

    function place() {
        const flat = Math.cos(ELEVATION) * DISTANCE;
        camera.position.set(
            target.x + Math.sin(azimuth) * flat,
            Math.sin(ELEVATION) * DISTANCE,
            target.z + Math.cos(azimuth) * flat,
        );
        camera.lookAt(target);
    }

    // Screen-aligned pan directions projected onto the ground.
    function groundAxes(az = azimuth) {
        const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
        const up = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
        return { right, up };
    }

    function clampGoal() {
        const m = 4;
        goal.target.x = THREE.MathUtils.clamp(goal.target.x, -m, bounds.width + m);
        goal.target.z = THREE.MathUtils.clamp(goal.target.z, -m, bounds.height + m);
        goal.zoom = THREE.MathUtils.clamp(goal.zoom, ZOOM_MIN, ZOOM_MAX);
    }

    /** Ground offset for a screen-pixel delta (content moves with the pointer). */
    function pixelsToGround(dx, dy, viewportHeight, z = camera.zoom) {
        const worldPerPx = VIEW_HEIGHT / z / viewportHeight;
        const { right, up } = groundAxes();
        // Vertical screen motion covers more ground at a shallow elevation.
        return new THREE.Vector3()
            .addScaledVector(right, -dx * worldPerPx)
            .addScaledVector(up, (dy * worldPerPx) / Math.sin(ELEVATION));
    }

    place();

    return {
        camera,
        resize(w, h) {
            aspect = w / Math.max(1, h);
            applyFrustum();
        },
        /** Pan by a screen-space pixel delta (drag). */
        panPixels(dx, dy, viewportHeight) {
            goal.target.add(pixelsToGround(dx, dy, viewportHeight));
            clampGoal();
            target.copy(goal.target); // drags feel direct, no easing
            const now = performance.now();
            const dt = Math.max(1, now - lastDrag.at);
            // Smoothed drag velocity, for the glide after release.
            lastDrag.vx = lastDrag.vx * 0.6 + (dx / dt) * 0.4;
            lastDrag.vy = lastDrag.vy * 0.6 + (dy / dt) * 0.4;
            lastDrag.at = now;
            lastDrag.h = viewportHeight;
            momentum.set(0, 0);
        },
        /** A drag ended: keep gliding briefly if it was moving. */
        endPan() {
            if (performance.now() - lastDrag.at < 80) momentum.set(lastDrag.vx, lastDrag.vy);
            lastDrag.vx = 0;
            lastDrag.vy = 0;
        },
        /** Pan by a screen-relative direction (keys), in world units. */
        panBy(rx, uy) {
            const { right, up } = groundAxes();
            goal.target.addScaledVector(right, rx).addScaledVector(up, uy);
            clampGoal();
        },
        zoomBy(factor) {
            goal.zoom *= factor;
            clampGoal();
        },
        rotate(steps) {
            goal.azimuth += steps * (Math.PI / 2);
        },
        focusOn(x, z) {
            goal.target.set(x, 0, z);
            clampGoal();
        },
        /** Add shake (0..1). Big moments ~0.4–1, a thud ~0.05–0.1. */
        shake(amount) {
            trauma = Math.min(1, trauma + amount * shakeScale);
        },
        /** A quick zoom-in kick that springs back (e.g. 0.05 = 5%). */
        punch(amount) {
            kick += amount * shakeScale;
        },
        /** The Camera shake setting (and reduced motion): 0 turns shake and punch off. */
        setShakeScale(s) {
            shakeScale = s;
        },
        /** Cut (no easing) to a framing: default view direction unless given. */
        snap({ x = target.x, z = target.z, zoom: zz = zoom, azimuth: az = DEFAULT_AZIMUTH } = {}) {
            goal.target.set(x, 0, z);
            goal.zoom = zz;
            goal.azimuth = az;
            clampGoal();
            target.copy(goal.target);
            zoom = goal.zoom;
            azimuth = goal.azimuth;
            momentum.set(0, 0);
            camera.zoom = zoom;
            camera.updateProjectionMatrix();
            place();
            camera.updateMatrixWorld();
        },
        /** Move the view so screen content shifts by (dx, dy) pixels; instant with snap. */
        shiftPixels(dx, dy, viewportHeight, { snap = false } = {}) {
            goal.target.add(pixelsToGround(dx, dy, viewportHeight, snap ? camera.zoom : goal.zoom));
            clampGoal();
            if (snap) {
                target.copy(goal.target);
                place();
                camera.updateMatrixWorld();
            }
        },
        get zoom() {
            return camera.zoom;
        },
        /** The ground point the camera looks at (live vector; don't mutate). */
        get target() {
            return target;
        },
        /** Ease toward the goal; call once per frame. */
        update(rawDt) {
            const dt = Math.max(0, Math.min(100, rawDt || 0)); // a negative or huge dt would make the easing explode
            if (momentum.lengthSq() > 1e-6) {
                goal.target.add(pixelsToGround(momentum.x * dt, momentum.y * dt, lastDrag.h));
                clampGoal();
                target.copy(goal.target);
                momentum.multiplyScalar(Math.exp(-dt / 140));
            }
            const k = 1 - Math.exp(-dt / 90);
            target.lerp(goal.target, k);
            azimuth += (goal.azimuth - azimuth) * k;
            zoom += (goal.zoom - zoom) * k;
            kick *= Math.exp(-dt / 110);
            camera.zoom = zoom * (1 + kick);
            camera.updateProjectionMatrix();
            place();
            if (trauma > 0.001) {
                // Shake: smooth pseudo-noise, strength = trauma², a touch of roll.
                const t = performance.now() / 1000;
                const s = (trauma * trauma * 0.45) / camera.zoom;
                const nx = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7 + 1.3) * 0.4;
                const ny = Math.sin(t * 43.3 + 2.1) * 0.6 + Math.sin(t * 71.9) * 0.4;
                const { right } = groundAxes();
                camera.position.addScaledVector(right, nx * s);
                camera.position.y += ny * s;
                camera.rotateZ(Math.sin(t * 29.3) * trauma * trauma * 0.012);
                trauma = Math.max(0, trauma - dt / 900);
            }
        },
    };
}
