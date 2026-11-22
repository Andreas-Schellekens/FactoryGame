// src/effects.js — small, cheap visual effects: a pooled sprite particle
// system (dust puffs, sparkles, smoke, falling ash, rising embers), floating
// "+credits" text, butterflies over the meadow, and additive halo sprites
// that fake a glow without post-processing. Knows nothing about the game;
// callers say where and when.
import * as THREE from 'three';

function softTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const SOFT = softTexture();

/** An additive glow sprite (lamps, furnace mouths, campfire). */
export function haloSprite(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: SOFT, color, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.scale.setScalar(size);
    s.renderOrder = 3;
    return s;
}

const rand = (a, b) => a + Math.random() * (b - a);

/** @param {THREE.Scene} scene */
export function createEffects(scene) {
    const root = new THREE.Group();
    root.name = 'effects';
    scene.add(root);

    // ---- Pooled particles ----------------------------------------------------
    const pool = [];
    const live = [];

    function particle({ pos, vel, life, size, grow = 1, color, opacity = 0.8, gravity = 0, drag = 1, additive = false }) {
        let p = pool.pop();
        if (!p) {
            const mat = new THREE.SpriteMaterial({ map: SOFT, transparent: true, depthWrite: false });
            p = { sprite: new THREE.Sprite(mat), vel: new THREE.Vector3() };
        }
        p.sprite.material.color.setHex(color);
        p.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        p.sprite.material.opacity = opacity;
        p.sprite.position.copy(pos);
        p.sprite.scale.setScalar(size);
        p.sprite.renderOrder = additive ? 4 : 2;
        p.vel.copy(vel);
        Object.assign(p, { age: 0, life, size, grow, opacity, gravity, drag });
        root.add(p.sprite);
        live.push(p);
        return p;
    }

    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

    /** A dust cloud on the ground (building, demolishing, trees falling). */
    function puff(pos, { color = 0xcdbb9c, count = 9, size = 0.32, spread = 0.45 } = {}) {
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
            const sp = rand(0.6, 1.3) * spread;
            particle({
                pos: v3(pos.x + Math.cos(a) * 0.15, pos.y + rand(0.05, 0.2), pos.z + Math.sin(a) * 0.15),
                vel: v3(Math.cos(a) * sp, rand(0.25, 0.6), Math.sin(a) * sp),
                life: rand(0.55, 0.9), size: size * rand(0.7, 1.2), grow: 2.2, color, opacity: 0.7, drag: 0.9,
            });
        }
    }

    /** Bright additive sparks bursting upward (upgrades, phase completion). */
    function sparkle(pos, { color = 0xffd54a, count = 14, power = 1.6, size = 0.12 } = {}) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = rand(0.4, 1) * power;
            particle({
                pos: v3(pos.x, pos.y, pos.z),
                vel: v3(Math.cos(a) * s * 0.6, rand(1.2, 2.4) * power * 0.6, Math.sin(a) * s * 0.6),
                life: rand(0.5, 0.95), size: size * rand(0.7, 1.4), grow: 0.4, color, opacity: 1, gravity: 3.2,
                drag: 0.985, additive: true,
            });
        }
    }

    /** One rising, spreading smoke (or steam) puff. */
    function smoke(pos, { color = 0x8c8a90, size = 0.22, rise = 0.55, opacity = 0.55 } = {}) {
        particle({
            pos: v3(pos.x + rand(-0.03, 0.03), pos.y, pos.z + rand(-0.03, 0.03)),
            vel: v3(rand(-0.06, 0.06) + 0.08, rise, rand(-0.06, 0.06) - 0.05),
            life: rand(2, 2.8), size, grow: 4, color, opacity, drag: 0.995,
        });
    }

    // ---- Floating text ---------------------------------------------------------
    const textCache = new Map();
    const floats = [];
    function textTexture(text, color) {
        const key = `${text}|${color}`;
        if (textCache.has(key)) return textCache.get(key);
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 48;
        const g = c.getContext('2d');
        g.font = '800 30px system-ui, Segoe UI, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(10,12,20,0.85)';
        g.strokeText(text, 64, 25);
        g.fillStyle = color;
        g.fillText(text, 64, 25);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        textCache.set(key, tex);
        return tex;
    }
    /** Text that rises and fades (e.g. "+12" over the Dispatch Pad). */
    function floatText(pos, text, color = '#ffe28a') {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, color), transparent: true, depthTest: false }));
        s.scale.set(0.8, 0.3, 1);
        s.position.copy(pos);
        s.renderOrder = 20;
        root.add(s);
        floats.push({ s, age: 0 });
    }

    // ---- Butterflies (meadow, early phases) -------------------------------------------
    const WING = new THREE.PlaneGeometry(0.11, 0.09);
    WING.translate(0.055, 0, 0);
    const butterflies = [];
    const BUTTERFLY_COLORS = [0xfff6d6, 0xffd166, 0xff9f5a, 0xb9e3ff, 0xf7b7e3];
    function makeButterfly(i) {
        const g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length], side: THREE.DoubleSide });
        const l = new THREE.Mesh(WING, mat);
        const r = new THREE.Mesh(WING, mat);
        r.rotation.y = Math.PI;
        g.add(l, r);
        g.userData = { l, r, seed: Math.random() * 100, home: new THREE.Vector3(), speed: rand(0.35, 0.7) };
        root.add(g);
        return g;
    }
    for (let i = 0; i < 16; i++) butterflies.push(makeButterfly(i));
    let butterfliesPlaced = false;

    // ---- Weather (ash, embers) ---------------------------------------------------
    let ashAcc = 0;
    let emberAcc = 0;
    const WEATHER = [
        { butterflies: 16, ash: 0, embers: 0 },
        { butterflies: 11, ash: 0, embers: 0 },
        { butterflies: 4, ash: 0, embers: 0 },
        { butterflies: 0, ash: 9, embers: 0 },
        { butterflies: 0, ash: 16, embers: 7 },
        { butterflies: 0, ash: 26, embers: 18 },
    ];

    /**
     * @param {number} dt  real milliseconds since last frame
     * @param {THREE.Vector3} centre  where the camera looks (weather spawns around it)
     * @param {number} phase  campaign phases completed (0..5)
     * @param {{ width: number, height: number }} bounds  playfield size (butterfly homes)
     */
    function update(dt, centre, phase, bounds) {
        const s = dt / 1000;
        for (let i = live.length - 1; i >= 0; i--) {
            const p = live[i];
            p.age += s;
            const t = p.age / p.life;
            if (t >= 1) {
                root.remove(p.sprite);
                live.splice(i, 1);
                pool.push(p);
                continue;
            }
            p.vel.y -= p.gravity * s;
            p.vel.multiplyScalar(p.drag);
            p.sprite.position.addScaledVector(p.vel, s);
            p.sprite.scale.setScalar(p.size * (1 + (p.grow - 1) * t));
            p.sprite.material.opacity = p.opacity * (1 - t) * Math.min(1, t * 6 + 0.3);
        }

        for (let i = floats.length - 1; i >= 0; i--) {
            const f = floats[i];
            f.age += s;
            f.s.position.y += s * 0.7;
            f.s.material.opacity = Math.max(0, 1 - Math.max(0, f.age - 0.5) / 0.7);
            if (f.age > 1.2) {
                root.remove(f.s);
                f.s.material.dispose();
                floats.splice(i, 1);
            }
        }

        const w = WEATHER[Math.min(phase, WEATHER.length - 1)];
        const now = performance.now() / 1000;
        if (!butterfliesPlaced) {
            for (const b of butterflies) b.userData.home.set(rand(1, bounds.width - 1), 0, rand(1, bounds.height - 1));
            butterfliesPlaced = true;
        }
        butterflies.forEach((b, i) => {
            const u = b.userData;
            const on = i < w.butterflies;
            b.visible = on || b.scale.x > 0.02;
            b.scale.setScalar(THREE.MathUtils.lerp(b.scale.x, on ? 1 : 0, 0.03));
            if (!b.visible) return;
            const t = now * u.speed + u.seed;
            const x = u.home.x + Math.sin(t * 0.9) * 2.2 + Math.sin(t * 2.3) * 0.4;
            const z = u.home.z + Math.cos(t * 0.7) * 2.2 + Math.cos(t * 1.9) * 0.4;
            const y = 0.55 + Math.sin(t * 1.7) * 0.18;
            const dx = x - b.position.x;
            const dz = z - b.position.z;
            b.position.set(x, y, z);
            if (dx || dz) b.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
            const flap = Math.sin(now * 22 + u.seed) * 1.1;
            u.l.rotation.x = flap;
            u.r.rotation.x = -flap;
        });

        ashAcc += w.ash * s;
        while (ashAcc >= 1) {
            ashAcc -= 1;
            particle({
                pos: v3(centre.x + rand(-14, 14), rand(5, 9), centre.z + rand(-14, 14)),
                vel: v3(rand(0.1, 0.3), rand(-0.45, -0.3), rand(-0.1, 0.1)),
                life: rand(9, 14), size: rand(0.05, 0.09), grow: 1, color: 0x9a9396, opacity: 0.85,
            });
        }
        emberAcc += w.embers * s;
        while (emberAcc >= 1) {
            emberAcc -= 1;
            particle({
                pos: v3(centre.x + rand(-12, 12), rand(0, 0.5), centre.z + rand(-12, 12)),
                vel: v3(rand(-0.15, 0.15), rand(0.5, 1.1), rand(-0.15, 0.15)),
                life: rand(3, 5), size: rand(0.06, 0.1), grow: 0.5, color: Math.random() < 0.5 ? 0xff6a2a : 0xff3a2a,
                opacity: 1, additive: true,
            });
        }
    }

    return { puff, sparkle, smoke, floatText, update };
}
