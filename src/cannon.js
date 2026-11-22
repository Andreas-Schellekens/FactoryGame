// src/cannon.js — Protocol: Selene on the map: the cannon rising on its
// construction site beside the Dispatch Pad, one part per campaign phase.
// Finished parts are solid; the part being built is a pulsing hologram inside
// scaffolding; later parts don't exist yet. Completing a phase materialises
// the hologram with sparks and dust. Purely visual.
import * as THREE from 'three';
import { haloSprite } from './effects.js';

const ELEVATION = THREE.MathUtils.degToRad(50);
const BARREL_LEN = 3.4;

/**
 * @param {THREE.Scene} scene
 * @param {{ get: (key: string) => THREE.Object3D }} assets
 * @param {ReturnType<typeof import('./effects.js').createEffects>} effects
 * @param {{ x: number, y: number, w: number, h: number }} area  reserved grid cells
 */
export function buildCannon(scene, assets, effects, area) {
    const root = new THREE.Group();
    root.name = 'cannon';
    root.position.set(area.x + area.w / 2, 0, area.y + area.h / 2);
    scene.add(root);

    const metal = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.35, metalness: 0.7 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.4, metalness: 0.6 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.95 });
    const coreGlow = new THREE.MeshStandardMaterial({ color: 0x0a3a48, emissive: 0x38e1ff, emissiveIntensity: 1.6 });
    const ringGlow = new THREE.MeshStandardMaterial({ color: 0x3a2000, emissive: 0xffa040, emissiveIntensity: 0 });
    const holo = new THREE.MeshBasicMaterial({
        color: 0x4fd1ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = (geo, mat) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
    };

    // ---- The five parts (parallel to campaign PHASES) ------------------------------
    const parts = [];

    // 0 Groundbreaking: concrete foundation + steel deck.
    {
        const g = new THREE.Group();
        const base = mesh(new THREE.BoxGeometry(2.86, 0.22, 2.86), concrete);
        base.position.y = 0.11;
        g.add(base);
        const deck = assets.get('cannonDeck');
        deck.position.y = 0.22;
        g.add(deck);
        parts.push(g);
    }
    // 1 Targeting: the big dish, aimed at the sky.
    {
        const g = new THREE.Group();
        const dish = assets.get('cannonDish');
        dish.position.set(-0.85, 0.3, 0.85);
        dish.rotation.y = Math.PI * 0.85;
        g.add(dish);
        parts.push(g);
    }
    // 2 Power core: generator block + glowing core column.
    {
        const g = new THREE.Group();
        const gen = assets.get('cannonCore');
        gen.position.set(0.85, 0.3, 0.8);
        gen.rotation.y = -Math.PI / 2;
        g.add(gen);
        const core = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 16), coreGlow);
        core.position.set(0.85, 0.75, -0.75);
        g.add(core);
        const cap = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16), darkMetal);
        cap.position.set(0.85, 1.22, -0.75);
        g.add(cap);
        g.userData.core = core;
        parts.push(g);
    }
    // 3 Payload: the mount and the barrel, pointing at the Moon.
    const barrelPivot = new THREE.Group();
    {
        const g = new THREE.Group();
        const mount = assets.get('cannonMount');
        mount.position.set(0, 0.3, 0);
        g.add(mount);
        barrelPivot.position.set(0, 0.3 + mount.userData.height * 0.82, 0);
        barrelPivot.rotation.set(-(Math.PI / 2 - ELEVATION), 0, 0, 'YXZ'); // toward -z: up-right in the default view, at the Moon
        const barrelGeo = new THREE.CylinderGeometry(0.24, 0.34, BARREL_LEN, 20);
        barrelGeo.translate(0, BARREL_LEN / 2, 0);
        barrelPivot.add(mesh(barrelGeo, metal));
        const muzzleGeo = new THREE.CylinderGeometry(0.3, 0.28, 0.3, 20);
        muzzleGeo.translate(0, BARREL_LEN, 0);
        barrelPivot.add(mesh(muzzleGeo, darkMetal));
        for (const t of [0.12, 0.45]) {
            const bandGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.12, 20);
            bandGeo.translate(0, BARREL_LEN * t, 0);
            barrelPivot.add(mesh(bandGeo, darkMetal));
        }
        g.add(barrelPivot);
        parts.push(g);
    }
    // 4 Ignition: three glowing capacitor rings along the barrel + muzzle glow.
    const muzzleHalo = haloSprite(0xffb050, 1.2);
    {
        const g = new THREE.Group();
        const ringHolder = new THREE.Group();
        ringHolder.position.copy(barrelPivot.position);
        ringHolder.rotation.copy(barrelPivot.rotation);
        for (const t of [0.3, 0.58, 0.82]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 28), ringGlow);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = BARREL_LEN * t;
            ring.castShadow = true;
            ringHolder.add(ring);
        }
        muzzleHalo.position.y = BARREL_LEN + 0.2;
        muzzleHalo.material.opacity = 0;
        ringHolder.add(muzzleHalo);
        g.add(ringHolder);
        parts.push(g);
    }
    parts.forEach((p) => root.add(p));

    // Remember each part's own materials so it can switch to the hologram.
    for (const p of parts) {
        p.traverse((o) => {
            if (o.isMesh) o.userData.solid = o.material;
        });
    }
    function setLook(part, look) {
        part.visible = look !== 'hidden';
        part.traverse((o) => {
            if (!o.isMesh) return;
            o.material = look === 'holo' ? holo : o.userData.solid;
            o.castShadow = look === 'solid';
        });
    }

    // Scaffolding + the site sign while construction is ongoing.
    const scaffold = new THREE.Group();
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
        for (let level = 0; level < 2; level++) {
            const s = assets.get('scaffold');
            s.position.set(x, level * 0.9, z);
            s.scale.multiplyScalar(0.5);
            scaffold.add(s);
        }
    }
    const sign = assets.get('sign');
    sign.position.set(-1.25, 0, 1.55);
    sign.rotation.y = Math.PI * 0.2;
    scaffold.add(sign);
    root.add(scaffold);

    let built = -1; // phases completed as currently shown
    let pop = null; // { part, t }

    /** Show the cannon for `done` completed phases; animate a single step forward. */
    function setPhase(done, instant = false) {
        if (done === built) return;
        const animate = !instant && built >= 0 && done === built + 1;
        built = done;
        parts.forEach((p, i) => setLook(p, i < done ? 'solid' : i === done ? 'holo' : 'hidden'));
        scaffold.visible = done < parts.length;
        holo.color.setHex(done >= 4 ? 0xff4d5e : 0x4fd1ff);
        if (animate) {
            const part = parts[done - 1];
            pop = { part, t: 0 };
            const top = new THREE.Vector3(root.position.x, 1.2, root.position.z);
            effects.sparkle(top, { count: 40, power: 2.4, color: done >= 4 ? 0xff6a5a : 0x9fe6ff });
            effects.sparkle(top, { count: 24, power: 1.8, color: 0xffd54a });
            effects.puff(new THREE.Vector3(root.position.x, 0.1, root.position.z), { count: 18, size: 0.7, spread: 1.6 });
        }
    }

    function update(dt, timeMs) {
        holo.opacity = (built >= 3 ? 0.22 : 0.34) + 0.16 * Math.sin(timeMs / 280); // stronger in daylight
        const core = parts[2].userData.core;
        if (core) coreGlow.emissiveIntensity = 1.2 + 0.5 * Math.sin(timeMs / 420);
        // Fully built: the rings charge up and the muzzle glows.
        const charged = built >= parts.length;
        const charge = charged ? 2.2 + 1.2 * Math.sin(timeMs / 160) : built === 4 ? 0 : 0;
        ringGlow.emissiveIntensity += (charge - ringGlow.emissiveIntensity) * Math.min(1, dt / 400);
        muzzleHalo.material.opacity = charged ? 0.6 + 0.3 * Math.sin(timeMs / 120) : 0;
        if (pop) {
            pop.t = Math.min(1, pop.t + dt / 650);
            const s = 1 + Math.sin(pop.t * Math.PI) * 0.08;
            pop.part.scale.setScalar(s);
            if (pop.t >= 1) {
                pop.part.scale.setScalar(1);
                pop = null;
            }
        }
    }

    return { setPhase, update };
}
