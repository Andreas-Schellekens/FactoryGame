// src/camera.js — the isometric camera rig: an orthographic camera orbiting a
// ground target at a fixed elevation. Pan (keys / drag), zoom (wheel) and
// rotate in 90° steps (Q/E), all eased. No knowledge of the game.
import * as THREE from 'three';

const ELEVATION = THREE.MathUtils.degToRad(38);
const DISTANCE = 60;
const VIEW_HEIGHT = 15; // world units visible vertically at zoom 1
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.6;

/**
 * @param {{ width: number, height: number }} bounds  world-space x/z extent to keep the target inside
 */
export function createCameraRig(bounds) {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const target = new THREE.Vector3(bounds.width / 2, 0, bounds.height / 2);
    const goal = { target: target.clone(), azimuth: Math.PI / 4, zoom: 1 };
    let azimuth = goal.azimuth;
    let aspect = 1;

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
    function groundAxes() {
        const right = new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
        const up = new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth));
        return { right, up };
    }

    function clampGoal() {
        const m = 4;
        goal.target.x = THREE.MathUtils.clamp(goal.target.x, -m, bounds.width + m);
        goal.target.z = THREE.MathUtils.clamp(goal.target.z, -m, bounds.height + m);
        goal.zoom = THREE.MathUtils.clamp(goal.zoom, ZOOM_MIN, ZOOM_MAX);
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
            const worldPerPx = VIEW_HEIGHT / camera.zoom / viewportHeight;
            const { right, up } = groundAxes();
            // Vertical screen motion covers more ground at a shallow elevation.
            goal.target.addScaledVector(right, -dx * worldPerPx);
            goal.target.addScaledVector(up, (dy * worldPerPx) / Math.sin(ELEVATION));
            clampGoal();
            target.copy(goal.target); // drags feel direct, no easing
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
        get zoom() {
            return camera.zoom;
        },
        /** The ground point the camera looks at (live vector; don't mutate). */
        get target() {
            return target;
        },
        /** Ease toward the goal; call once per frame. */
        update(dt) {
            const k = 1 - Math.exp(-dt / 90);
            target.lerp(goal.target, k);
            azimuth += (goal.azimuth - azimuth) * k;
            camera.zoom += (goal.zoom - camera.zoom) * k;
            camera.updateProjectionMatrix();
            place();
        },
    };
}
