// src/cannon.js — Protocol: Selene on the map: the cannon rising on its
// construction site beside the Dispatch Pad, one part per campaign phase.
// Finished parts are solid; the part being built is a blueprint hologram
// (blue edges, a faint fill and a scan line; red after the reveal) wrapped in
// scaffolding; later parts don't exist yet. The site is dressed for the job:
// cones and hazard tape around the dig, then a painted launch deck (hazard
// border + the NILE mark), crates, a swinging crane and blinking beacons,
// all cleared away once the cannon stands. Completing a phase materialises
// the hologram with sparks and dust. For the ending it charges up (charge),
// fires (fire: recoil, muzzle flash, shockwave, smoke) and stays spent.
// muzzle() gives the barrel tip and direction, so the ending can aim the
// camera and draw the beam. The hidden Overload ending overloads it (red-hot
// barrel, alarm-red stuttering rings, sparks, smoke), fires it again and again,
// lights its bore for the last shot and leaves it charred. Purely visual.
import * as THREE from 'three';
import { haloSprite } from './effects.js';
import { tintTemplate } from './assets.js';

const ELEVATION = THREE.MathUtils.degToRad(50);
const BARREL_LEN = 2.75; // pivot to the muzzle brake's mouth

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

    // The cannon's palette: dark gunmetal, mid steel, signal-orange accents (alarm red after the
    // reveal), a paper-white dish, cyan capacitor glow. The same colours as the HUD.
    const gun = new THREE.MeshStandardMaterial({ color: 0x353c47, roughness: 0.45, metalness: 0.55 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a919b, roughness: 0.4, metalness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.55, metalness: 0.1 });
    const paper = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.6, side: THREE.DoubleSide });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8b867d, roughness: 0.95 });
    const coreGlow = new THREE.MeshStandardMaterial({ color: 0x0a3a48, emissive: 0x38e1ff, emissiveIntensity: 1.6 });
    const ringGlow = new THREE.MeshStandardMaterial({ color: 0x3a2000, emissive: 0xffa040, emissiveIntensity: 0 });
    // The barrel's own copies of steel and gunmetal, so only the barrel goes red-hot when overloaded.
    const tubeMat = steel.clone();
    tubeMat.emissive = new THREE.Color(0xff2a0a);
    tubeMat.emissiveIntensity = 0;
    const breechMat = gun.clone();
    breechMat.emissive = new THREE.Color(0xff3010);
    breechMat.emissiveIntensity = 0;
    const boreMat = new THREE.MeshBasicMaterial({ color: 0x07080a });
    const BORE_DARK = new THREE.Color(0x07080a);
    const BORE_HOT = new THREE.Color(0xfff0c8);
    const RING_WARM = new THREE.Color(0xffa040);
    const RING_ALARM = new THREE.Color(0xff2a1a);
    const CORE_CYAN = new THREE.Color(0x38e1ff);
    const STEEL = new THREE.Color(0x8a919b);
    const GUN = new THREE.Color(0x353c47);
    const CHAR = new THREE.Color(0x1d1b1c);
    const HALO_WARM = new THREE.Color(0xffb050);
    // Blueprint hologram: crisp edges + a faint fill, readable on grass and at night alike.
    const HOLO_BLUE = 0x2f8cff;
    const HOLO_RED = 0xff4d5e;
    const holoFill = new THREE.MeshBasicMaterial({ color: HOLO_BLUE, transparent: true, opacity: 0.2, depthWrite: false });
    const holoLine = new THREE.LineBasicMaterial({ color: HOLO_BLUE, transparent: true, opacity: 0.9, depthWrite: false });
    const scanMat = new THREE.LineBasicMaterial({ color: HOLO_BLUE, transparent: true, opacity: 0.8, depthWrite: false });
    const edgeCache = new WeakMap();
    const edgesOf = (geo) => {
        let e = edgeCache.get(geo);
        if (!e) {
            e = new THREE.EdgesGeometry(geo, 28);
            edgeCache.set(geo, e);
        }
        return e;
    };
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
        // The launch deck: matte concrete steel with a signal-orange rim (not the kit's shiny white).
        const deck = tintTemplate(assets.get('cannonDeck'), { metal: 0x868a91, metalDark: 0x555b64, metalRed: 0xff6a13 });
        deck.traverse((o) => {
            if (!o.isMesh) return;
            o.material.metalness = 0.15;
            o.material.roughness = 0.8;
        });
        deck.position.y = 0.22;
        g.add(deck);
        deck.updateWorldMatrix(true, true);
        g.userData.top = new THREE.Box3().setFromObject(deck).max.y;
        parts.push(g);
    }
    const deckY = parts[0].userData.top;
    const cyl = (r0, r1, h, seg = 20) => new THREE.CylinderGeometry(r0, r1, h, seg);
    const at = (m, x, y, z) => {
        m.position.set(x, y, z);
        return m;
    };

    // 1 Targeting: a tracking dish on a mast in the back corner, tilted at the sky.
    {
        const g = new THREE.Group();
        const x = -0.95;
        const z = -0.95;
        g.add(at(mesh(new THREE.BoxGeometry(0.34, 0.08, 0.34), steel), x, deckY + 0.04, z));
        g.add(at(mesh(cyl(0.045, 0.06, 0.55, 10), gun), x, deckY + 0.35, z));
        const head = new THREE.Group();
        head.position.set(x, deckY + 0.64, z);
        head.rotation.set(-0.75, Math.PI * 0.25, 0, 'YXZ'); // looking up and out over the valley
        const f = 0.3;
        const pts = [];
        for (let i = 0; i <= 10; i++) {
            const r = (i / 10) * 0.42;
            pts.push(new THREE.Vector2(r, (r * r) / (4 * f)));
        }
        head.add(mesh(new THREE.LatheGeometry(pts, 28), paper));
        head.add(at(mesh(cyl(0.012, 0.012, 0.3, 6), gun), 0, 0.15, 0));
        head.add(at(mesh(new THREE.ConeGeometry(0.05, 0.1, 10), accent), 0, 0.31, 0));
        head.add(at(mesh(cyl(0.07, 0.07, 0.08, 12), gun), 0, -0.02, 0));
        g.add(head);
        parts.push(g);
    }
    // 2 Power core: a bank of three capacitors along the right edge, cabled into the turret.
    const coreBands = [];
    {
        const g = new THREE.Group();
        const x = 1.02;
        g.add(at(mesh(new THREE.BoxGeometry(0.44, 0.08, 2.1), steel), x, deckY + 0.04, 0));
        for (const z of [-0.72, 0, 0.72]) {
            g.add(at(mesh(cyl(0.16, 0.17, 0.62), gun), x, deckY + 0.39, z));
            g.add(at(mesh(cyl(0.12, 0.16, 0.06), steel), x, deckY + 0.73, z));
            for (const y of [0.24, 0.5]) {
                const band = at(mesh(cyl(0.172, 0.172, 0.05), coreGlow), x, deckY + 0.08 + y, z);
                coreBands.push(band);
                g.add(band);
            }
            // A cable from each capacitor straight across the deck into the turret's base ring.
            const from = x - 0.17;
            const to = Math.sqrt(Math.max(0, 0.74 * 0.74 - z * z));
            const cable = at(mesh(cyl(0.03, 0.03, from - to, 6), accent), (from + to) / 2, deckY + 0.035, z);
            cable.rotation.z = Math.PI / 2;
            g.add(cable);
        }
        g.userData.core = coreBands[0];
        parts.push(g);
    }
    // 3 Payload: the turret. A fixed base ring; a turntable (the swivel) with two cheek plates
    // holding the barrel on an axle; the barrel with its breech block, rails, bands and muzzle brake.
    const yawGroup = new THREE.Group();
    const barrelPivot = new THREE.Group();
    const barrelGroup = new THREE.Group(); // slides back along the barrel on recoil
    {
        const g = new THREE.Group();
        g.add(at(mesh(cyl(0.7, 0.74, 0.14, 32), gun), 0, deckY + 0.07, 0));
        g.add(at(mesh(cyl(0.755, 0.755, 0.035, 32), accent), 0, deckY + 0.11, 0));
        yawGroup.position.set(0, deckY + 0.14, 0);
        yawGroup.add(at(mesh(cyl(0.58, 0.62, 0.1, 28), steel), 0, 0.05, 0));
        for (const side of [-1, 1]) {
            yawGroup.add(at(mesh(new THREE.BoxGeometry(0.1, 0.66, 0.66), gun), side * 0.33, 0.43, 0));
            yawGroup.add(at(mesh(new THREE.BoxGeometry(0.012, 0.36, 0.08), accent), side * 0.386, 0.48, 0.12));
        }
        const axle = at(mesh(cyl(0.075, 0.075, 0.82, 14), steel), 0, 0.62, 0);
        axle.rotation.z = Math.PI / 2;
        yawGroup.add(axle);
        barrelPivot.position.set(0, 0.62, 0);
        barrelPivot.rotation.set(-(Math.PI / 2 - ELEVATION), 0, 0); // toward -z: up-right in the default view
        const L = 2.42;
        barrelGroup.add(at(mesh(new THREE.BoxGeometry(0.42, 0.56, 0.42), breechMat), 0, -0.1, 0)); // breech block
        barrelGroup.add(at(mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), accent), 0, 0.2, 0));
        barrelGroup.add(at(mesh(cyl(0.13, 0.17, L), tubeMat), 0, 0.12 + L / 2, 0)); // the tube
        for (const side of [-1, 1]) {
            barrelGroup.add(at(mesh(new THREE.BoxGeometry(0.07, L * 0.92, 0.09), breechMat), side * 0.17, 0.12 + (L * 0.92) / 2, 0)); // rails
        }
        for (const t of [0.22, 0.58]) {
            barrelGroup.add(at(mesh(cyl(0.2, 0.2, 0.07), accent), 0, 0.12 + L * t, 0));
        }
        barrelGroup.add(at(mesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), breechMat), 0, 0.12 + L + 0.08, 0)); // muzzle brake
        barrelGroup.add(at(mesh(new THREE.BoxGeometry(0.36, 0.035, 0.36), accent), 0, 0.12 + L + 0.02, 0));
        // The bore: a dark mouth on the muzzle brake (it glows from inside when overloaded).
        const bore = new THREE.Mesh(new THREE.CircleGeometry(0.105, 20).rotateX(-Math.PI / 2), boreMat);
        bore.position.y = 0.12 + L + 0.2 + 0.002;
        barrelGroup.add(bore);
        barrelPivot.add(barrelGroup);
        yawGroup.add(barrelPivot);
        g.add(yawGroup);
        parts.push(g);
    }
    // 4 Ignition: three capacitor rings along the barrel + the muzzle glow. They live in their own
    // part (so they can be a hologram on their own) and follow the barrel's transform every frame.
    const muzzleHalo = haloSprite(0xffb050, 1.2);
    const ringHolder = new THREE.Group();
    ringHolder.matrixAutoUpdate = false;
    {
        const g = new THREE.Group();
        for (const t of [0.34, 0.5, 0.66]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 10, 28), ringGlow);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.12 + 2.42 * t;
            ring.castShadow = true;
            ringHolder.add(ring);
        }
        muzzleHalo.position.y = BARREL_LEN + 0.2;
        muzzleHalo.material.opacity = 0;
        ringHolder.add(muzzleHalo);
        g.add(ringHolder);
        parts.push(g);
    }
    const rootInverse = new THREE.Matrix4();
    function syncRings() {
        root.updateWorldMatrix(true, false);
        barrelGroup.updateWorldMatrix(true, false);
        rootInverse.copy(root.matrixWorld).invert();
        ringHolder.matrix.copy(rootInverse).multiply(barrelGroup.matrixWorld);
        ringHolder.matrixWorldNeedsUpdate = true;
    }
    parts.forEach((p) => root.add(p));
    syncRings();

    // Remember each part's own materials so it can switch to the hologram.
    for (const p of parts) {
        p.traverse((o) => {
            if (o.isMesh) o.userData.solid = o.material;
        });
    }
    function setLook(part, look) {
        part.visible = look !== 'hidden';
        const holo = look === 'holo';
        part.traverse((o) => {
            if (!o.isMesh) return;
            o.material = holo ? holoFill : o.userData.solid;
            o.castShadow = look === 'solid';
            if (holo && !o.userData.edges) {
                const lines = new THREE.LineSegments(edgesOf(o.geometry), holoLine);
                lines.renderOrder = 2;
                o.add(lines);
                o.userData.edges = lines;
            }
            if (o.userData.edges) o.userData.edges.visible = holo;
        });
    }

    // ---- The construction site --------------------------------------------------------
    const deckTop = parts[0].userData.top;
    const site = new THREE.Group(); // everything here is cleared away once the cannon stands
    root.add(site);
    const sign = assets.get('sign');
    sign.position.set(-1.25, 0, 1.55);
    sign.rotation.y = Math.PI * 0.2;
    site.add(sign);

    // Before the foundation: cones and hazard tape around the dig.
    const stripeTex = (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 16;
        const g = c.getContext('2d');
        g.fillStyle = '#1d222b';
        g.fillRect(0, 0, 64, 16);
        g.fillStyle = '#f3b23c';
        for (let x = -16; x < 80; x += 16) {
            g.beginPath();
            g.moveTo(x, 16);
            g.lineTo(x + 8, 16);
            g.lineTo(x + 16, 0);
            g.lineTo(x + 8, 0);
            g.closePath();
            g.fill();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        return t;
    })();
    const dig = new THREE.Group();
    site.add(dig);
    const C = 1.32;
    const corners = [[-C, -C], [C, -C], [C, C], [-C, C]];
    for (const [x, z] of corners) {
        const cone = assets.get('siteCone');
        cone.position.set(x, 0, z);
        dig.add(cone);
    }
    for (let i = 0; i < 4; i++) {
        const [x0, z0] = corners[i];
        const [x1, z1] = corners[(i + 1) % 4];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const map = stripeTex.clone();
        map.repeat.set(len * 3, 1);
        map.needsUpdate = true;
        const tape = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.07), new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.7 }));
        tape.position.set((x0 + x1) / 2, 0.2, (z0 + z1) / 2);
        tape.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        dig.add(tape);
    }

    // Once there is a deck: crates, a crane, blinking beacons, and paint.
    const yard = new THREE.Group();
    site.add(yard);
    for (const [key, x, z, y, r] of [
        ['siteCrate', -0.2, -1.2, 0, 0.15], ['siteCrateSmall', -0.18, -1.18, 0.25, 0.9], ['siteCrate', -1.2, -0.12, 0, 1.4],
    ]) {
        const crate = assets.get(key);
        crate.position.set(x, deckTop + y, z);
        crate.rotation.y = r;
        yard.add(crate);
    }
    const crane = assets.get('siteCrane');
    crane.position.set(-1.08, deckTop, 1.05);
    crane.rotation.y = Math.PI * 0.75;
    yard.add(crane);
    const beacons = [];
    for (const [x, z] of [[1.3, 1.3], [-1.3, -1.3]]) {
        const b = assets.get('siteBeacon');
        b.position.set(x, deckTop, z);
        yard.add(b);
        const glow = haloSprite(0xff8a2a, 0.55);
        glow.position.set(x, deckTop + 0.6, z);
        yard.add(glow);
        beacons.push(glow);
    }

    // The deck's paint: a hazard-striped border, the organisation's mark, the pad's name.
    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = paintCanvas.height = 512;
    const paintTex = new THREE.CanvasTexture(paintCanvas);
    paintTex.colorSpace = THREE.SRGBColorSpace;
    paintTex.anisotropy = 4;
    let paintedEvil = null;
    function paintDeck(evil) {
        paintedEvil = evil;
        const g = paintCanvas.getContext('2d');
        g.clearRect(0, 0, 512, 512);
        const inset = 14;
        const band = 30;
        g.save();
        g.beginPath();
        g.rect(inset, inset, 512 - inset * 2, 512 - inset * 2);
        g.rect(inset + band, inset + band, 512 - (inset + band) * 2, 512 - (inset + band) * 2);
        g.clip('evenodd');
        g.fillStyle = '#1d222b';
        g.fillRect(0, 0, 512, 512);
        g.fillStyle = evil ? '#ff3b30' : '#f3b23c';
        for (let x = -512; x < 1024; x += 44) {
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x + 22, 0);
            g.lineTo(x + 22 + 512, 512);
            g.lineTo(x + 512, 512);
            g.closePath();
            g.fill();
        }
        g.restore();
        // The mark: NILE's delta in a frame, or NIHIL's flat line.
        const s = 150 / 74;
        const ox = 256 - 75;
        const oy = 226 - 75;
        const P = (x, y) => [ox + x * s, oy + y * s];
        g.lineCap = 'square';
        g.strokeStyle = evil ? '#ff3b30' : '#f2e8d5';
        g.lineWidth = 9;
        g.strokeRect(...P(2, 2), 70 * s, 70 * s);
        g.strokeStyle = evil ? '#ff3b30' : '#ff6a13';
        g.lineWidth = 12;
        g.beginPath();
        if (evil) {
            g.moveTo(...P(14, 37));
            g.lineTo(...P(60, 37));
        } else {
            g.moveTo(...P(37, 14));
            g.lineTo(...P(37, 60));
            g.moveTo(...P(37, 14));
            g.bezierCurveTo(...P(37, 34), ...P(22, 46), ...P(16, 60));
            g.moveTo(...P(37, 14));
            g.bezierCurveTo(...P(37, 34), ...P(52, 46), ...P(58, 60));
        }
        g.stroke();
        g.fillStyle = evil ? '#ff3b30' : '#f2e8d5';
        g.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
        g.textAlign = 'center';
        g.fillText(evil ? 'NIHIL · PAD 01' : 'SELENE · PAD 01', 256, 410);
        paintTex.needsUpdate = true;
    }
    paintDeck(false);
    document.fonts?.ready.then(() => paintDeck(!!paintedEvil)); // redraw once the HUD's mono font is in
    const paint = new THREE.Mesh(
        new THREE.PlaneGeometry(2.62, 2.62),
        new THREE.MeshStandardMaterial({ map: paintTex, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    paint.rotation.x = -Math.PI / 2;
    paint.position.y = deckTop + 0.004;
    paint.receiveShadow = true;
    paint.renderOrder = 1;
    root.add(paint);

    // Scaffolding wrapped around the part being built: grey poles, mustard rails, wooden decks.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xa9b0b9, metalness: 0.4, roughness: 0.5 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xf3b23c, roughness: 0.6 });
    const plankMat = new THREE.MeshStandardMaterial({ color: 0xa47a52, roughness: 0.9 });
    const scaffold = new THREE.Group();
    root.add(scaffold);
    function buildScaffold(part) {
        scaffold.clear();
        if (!part) return;
        part.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(part);
        box.min.sub(root.position);
        box.max.sub(root.position);
        const height = Math.min(2.2, box.max.y + 0.12);
        if (height - deckTop < 0.45) return; // flat parts need no scaffolding
        const pad = 0.08;
        const x0 = Math.max(-1.36, box.min.x - pad);
        const x1 = Math.min(1.36, box.max.x + pad);
        const z0 = Math.max(-1.36, box.min.z - pad);
        const z1 = Math.min(1.36, box.max.z + pad);
        const base = deckTop;
        const h = height - base;
        const poleGeo = new THREE.CylinderGeometry(0.022, 0.022, h, 6);
        for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(x, base + h / 2, z);
            pole.castShadow = true;
            scaffold.add(pole);
        }
        const levels = Math.max(2, Math.round(h / 0.42));
        for (let i = 1; i <= levels; i++) {
            const y = base + (h * i) / levels;
            for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
                const len = Math.hypot(bx - ax, bz - az);
                const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.022, 0.022), railMat);
                rail.position.set((ax + bx) / 2, y, (az + bz) / 2);
                rail.rotation.y = -Math.atan2(bz - az, bx - ax);
                scaffold.add(rail);
            }
            if (i % 2 === 0 || i === levels) {
                // A walkway along the back side.
                const plank = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.025, 0.2), plankMat);
                plank.position.set((x0 + x1) / 2, y - 0.03, z0 + 0.1);
                plank.castShadow = true;
                scaffold.add(plank);
            }
        }
        // A diagonal brace on the two outer faces.
        for (const [ax, az, bx, bz] of [[x0, z1, x1, z1], [x1, z0, x1, z1]]) {
            const len = Math.hypot(bx - ax, bz - az);
            const diag = Math.hypot(len, h);
            const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, diag, 5), poleMat);
            brace.position.set((ax + bx) / 2, base + h / 2, (az + bz) / 2);
            brace.rotation.order = 'YZX';
            brace.rotation.y = -Math.atan2(bz - az, bx - ax);
            brace.rotation.z = Math.atan2(len, h);
            scaffold.add(brace);
        }
    }

    // The scan line sweeping up through the hologram.
    const scan = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5),
            new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5),
        ]),
        scanMat,
    );
    scan.renderOrder = 3;
    root.add(scan);
    const scanBox = new THREE.Box3();

    // Ending: charge level, the shot, and the cooled-down state afterwards.
    const flash = haloSprite(0xfff0c0, 1);
    flash.material.opacity = 0;
    flash.position.y = BARREL_LEN + 0.4;
    barrelGroup.add(flash);
    const shock = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    shock.rotation.x = -Math.PI / 2;
    shock.position.y = 0.06;
    root.add(shock);
    let chargeLevel = 0;
    let spent = false;
    let yaw = 0;      // turret swivel (radians); the ending aims it at the Moon
    let yawGoal = 0;
    let yawTau = 320; // how quickly it swivels (ms, exponential)
    let shot = null; // { t, big } ms since the shot
    const tmp = new THREE.Vector3();
    // The Overload ending: `heat` 0..1 is the charge gone wrong (barrel red-hot, rings alarm red
    // and flickering, sparks, smoke); it eases up fast toward `heatGoal` and cools slowly after a
    // shot. `boreGlow` lights the mouth from inside for the last shot; `char` 0..1 is the charred,
    // dead barrel left after it.
    let heat = 0;
    let heatGoal = 0;
    let boreGlow = 0;
    let char = 0;
    let charGoal = 0;
    let haze = true; // the overload's smoke, shimmer and big muzzle halo (off for the close-up down the barrel)
    const tmpC = new THREE.Color();
    const capTops = [-0.72, 0, 0.72].map((z) => new THREE.Vector3(1.02, deckY + 0.76, z));

    let built = -1; // phases completed as currently shown
    let pop = null; // { part, t }

    /** Show the cannon for `done` completed phases; animate a single step forward. */
    function setPhase(done, instant = false) {
        if (done === built) return;
        const animate = !instant && built >= 0 && done === built + 1;
        built = done;
        if (done >= parts.length && instant) spent = true; // loaded after the ending: already fired
        if (done < parts.length) spent = false;
        parts.forEach((p, i) => setLook(p, i < done ? 'solid' : i === done ? 'holo' : 'hidden'));
        const building = done < parts.length;
        const color = done >= 4 ? HOLO_RED : HOLO_BLUE;
        for (const m of [holoFill, holoLine, scanMat]) m.color.setHex(color);
        accent.color.setHex(done >= 4 ? 0xff3b30 : 0xff6a13);
        syncRings();
        // The site: the dig before the foundation, the yard while parts go up, cleared at the end.
        site.visible = building;
        dig.visible = done === 0;
        yard.visible = building && done >= 1;
        paint.visible = done >= 1;
        if (paintedEvil !== done >= 4) paintDeck(done >= 4);
        buildScaffold(building && done >= 1 && done <= 3 ? parts[done] : null);
        scan.visible = building;
        if (building) {
            parts[done].updateWorldMatrix(true, true);
            scanBox.setFromObject(parts[done]);
            scanBox.min.sub(root.position);
            scanBox.max.sub(root.position);
            scan.scale.set(scanBox.max.x - scanBox.min.x + 0.12, 1, scanBox.max.z - scanBox.min.z + 0.12);
            scan.position.x = (scanBox.min.x + scanBox.max.x) / 2;
            scan.position.z = (scanBox.min.z + scanBox.max.z) / 2;
        }
        if (animate && !building) {
            effects.puff(new THREE.Vector3(root.position.x, 0.3, root.position.z), { count: 24, size: 0.8, spread: 2.2 }); // the site is cleared
        }
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
        holoLine.opacity = 0.8 + 0.2 * Math.sin(timeMs / 300);
        holoFill.opacity = 0.2 + 0.06 * Math.sin(timeMs / 300);
        if (scan.visible) {
            const k = (timeMs % 2400) / 2400;
            scan.position.y = scanBox.min.y + (scanBox.max.y - scanBox.min.y) * k;
            scanMat.opacity = 0.85 * Math.sin(Math.PI * k);
        }
        if (yard.visible) {
            crane.rotation.y = Math.PI * 0.75 + Math.sin(timeMs / 2600) * 0.45; // slowly swinging its load
            beacons.forEach((b, i) => {
                const on = Math.sin(timeMs / 260 + i * Math.PI) > 0.2;
                b.material.opacity = on ? 0.95 : 0.12;
            });
        }
        // Overload: heat climbs fast toward its goal and bleeds off slowly once the shot is out.
        heat += (heatGoal - heat) * (1 - Math.exp(-dt / (heatGoal > heat ? 260 : 16000)));
        if (heat < 1e-3 && heatGoal === 0) heat = 0;
        char += (charGoal - char) * (1 - Math.exp(-dt / 2500));
        const hot = Math.min(1, heat * 1.4);
        coreGlow.emissiveIntensity = (1.2 + 0.5 * Math.sin(timeMs / 420)) * (hot > 0 && Math.random() < hot * 0.3 ? 0.2 : 1) * (1 - char * 0.9);
        coreGlow.emissive.copy(CORE_CYAN).lerp(RING_ALARM, hot);
        // Fully built: the rings hum, charge hard for the shot, and cool down after it.
        const charged = built >= parts.length && !spent;
        let hum = charged ? 2.2 + 1.2 * Math.sin(timeMs / 160) + chargeLevel * (4 + 2 * Math.sin(timeMs / 40)) : spent ? 0.35 * (1 - char) : 0;
        if (heat > 0.01) {
            // The charge gone wrong: the rings blaze alarm red and stutter (not so bright that
            // the tone mapping bleaches the red out of them).
            hum = hum * (1 - hot) + hot * (2.4 + 1.1 * Math.sin(timeMs / 37));
            if (Math.random() < heat * 0.28) hum *= 0.12;
        }
        ringGlow.emissiveIntensity += (hum - ringGlow.emissiveIntensity) * Math.min(1, dt / (heat > 0.01 ? 50 : spent ? 1800 : 300));
        ringGlow.emissive.copy(RING_WARM).lerp(RING_ALARM, hot);
        // The barrel glows red-hot from the breech up; once it's all over, it is charred.
        tubeMat.emissiveIntensity = heat * (1.5 + 0.35 * Math.sin(timeMs / 90)) + char * 0.05 * (1 + Math.sin(timeMs / 700));
        tubeMat.color.copy(STEEL).lerp(tmpC.setHex(0x6a3028), hot * 0.6).lerp(CHAR, char);
        breechMat.emissiveIntensity = heat * 0.55;
        breechMat.color.copy(GUN).lerp(CHAR, char * 0.8);
        boreMat.color.copy(BORE_DARK).lerp(BORE_HOT, Math.min(1, Math.max(boreGlow, heat * 0.35)));
        let halo = charged ? Math.min(1, 0.6 + 0.3 * Math.sin(timeMs / 120) + chargeLevel * 0.4) : 0;
        if (heat > 0.01) halo = Math.max(halo, heat * (0.7 + 0.3 * Math.random()));
        halo = Math.max(halo, boreGlow);
        muzzleHalo.material.color.copy(HALO_WARM).lerp(RING_ALARM, hot * 0.7).lerp(BORE_HOT, boreGlow * 0.6);
        if (haze) {
            muzzleHalo.material.opacity = halo;
            muzzleHalo.scale.setScalar(1.2 * (1 + chargeLevel * 2.2 + heat * 1.6 * (0.8 + 0.4 * Math.random()) + boreGlow * 2.5));
        } else {
            // A camera at the muzzle: a tight glow round the mouth, not a halo filling the frame.
            muzzleHalo.material.opacity = Math.min(0.7, halo);
            muzzleHalo.scale.setScalar(0.55 + boreGlow * 0.35);
        }
        if (charged && chargeLevel > 0 && Math.random() < chargeLevel * dt * 0.02) {
            // Sparks crawl up the barrel while it charges.
            const { pos } = muzzle(Math.random() * 0.9);
            effects.sparkle(pos, { count: 3, power: 0.9, color: 0xffc070, size: 0.08 });
        }
        if (heat > 0.04) {
            // Overloaded: sparks spit off the barrel, arcs crack over the capacitors, it smokes
            // and the air above it shimmers.
            if (Math.random() < heat * dt * (haze ? 0.03 : 0.008)) {
                const { pos } = muzzle(0.1 + Math.random() * (haze ? 0.95 : 0.45)); // (not into a close-up's lens)
                const c = [0xff5a2a, 0xffc070, 0xfff4e0, 0xff3b30][Math.floor(Math.random() * 4)];
                effects.sparkle(pos, { count: 3 + Math.floor(heat * 6), power: 1 + heat * 1.4, color: c, size: 0.09 });
            }
            if (built >= 3 && Math.random() < heat * dt * 0.006) {
                const at = capTops[Math.floor(Math.random() * 3)].clone().add(root.position);
                effects.sparkle(at, { count: 6, power: 1.3, color: Math.random() < 0.5 ? 0x9fe6ff : 0xff6a5a, size: 0.08 });
            }
            if (haze && heat > 0.15 && Math.random() < heat * dt * 0.007) {
                effects.smoke(muzzle(0.25 + Math.random() * 0.8).pos, { color: 0x3a3634, size: 0.32, rise: 0.75, opacity: 0.5 });
            }
            if (haze && heat > 0.3 && Math.random() < heat * dt * 0.012) {
                const p = muzzle(Math.random()).pos;
                p.y += 0.25;
                effects.smoke(p, { color: 0xffc8a8, size: 0.16, rise: 1.5, opacity: 0.12 });
            }
        }
        if (Math.abs(yawGoal - yaw) > 1e-4) {
            yaw += (yawGoal - yaw) * (1 - Math.exp(-dt / yawTau));
            yawGroup.rotation.y = yaw;
        }
        if (shot) {
            shot.t += dt;
            const k = shot.t / 1000;
            // Recoil: the barrel kicks back into its cradle, then eases home.
            const back = k < 0.06 ? k / 0.06 : Math.max(0, 1 - (k - 0.06) / 0.9) ** 2;
            barrelGroup.position.y = -0.38 * back;
            flash.material.opacity = Math.max(0, 1 - k / (shot.big ? 0.9 : 0.45));
            flash.scale.setScalar(2 + (shot.big ? 26 : 9) * Math.min(1, k / 0.12));
            shock.material.opacity = Math.max(0, 0.8 * (1 - k / 0.9));
            shock.scale.setScalar(1 + 9 * Math.min(1, k / 0.9));
            if (k < 4 && Math.random() < dt * 0.01) effects.smoke(muzzle(1).pos, { color: 0x6a6670, size: 0.5 });
            if (k > 4.5) {
                barrelGroup.position.y = 0;
                shot = null;
            }
        }
        if (parts[4].visible) syncRings();
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

    /** World position and direction of the barrel at fraction `along` (1 = the muzzle). */
    function muzzle(along = 1) {
        barrelPivot.updateWorldMatrix(true, false);
        const pos = new THREE.Vector3(0, BARREL_LEN * along + (along >= 1 ? 0.15 : 0), 0).applyMatrix4(barrelPivot.matrixWorld);
        const dir = tmp.set(0, 1, 0).transformDirection(barrelPivot.matrixWorld).clone();
        return { pos, dir };
    }

    /** World position of the barrel's pivot (the swivel point). */
    function pivot() {
        barrelPivot.updateWorldMatrix(true, false);
        return new THREE.Vector3().setFromMatrixPosition(barrelPivot.matrixWorld);
    }
    /** The barrel's world direction if the turret were swivelled to `y` radians. */
    function directionAt(y) {
        const c = Math.cos(ELEVATION);
        return new THREE.Vector3(-c * Math.sin(y), Math.sin(ELEVATION), -c * Math.cos(y));
    }
    /**
     * Swivel the turret to `y` radians (eased, the short way round; instant snaps).
     * `tau` is the easing time constant in ms (the salvo swings faster).
     */
    function aim(y, instant = false, tau = 320) {
        yawTau = tau;
        yawGoal = y + Math.PI * 2 * Math.round((yaw - y) / (Math.PI * 2));
        if (instant) {
            yaw = yawGoal;
            yawGroup.rotation.y = yaw;
        }
    }
    /** The turret's current swivel and how far it still has to go (radians). */
    const yawLeft = () => Math.abs(yawGoal - yaw);

    /** Ending: how charged the cannon is (0..1). */
    function charge(level) {
        chargeLevel = Math.max(0, Math.min(1, level));
    }

    /**
     * The Overload ending's charge, 0..2: up to 1 it charges as usual; past 1 it goes wrong
     * (heat: the barrel red-hot, alarm-red flickering rings, sparks, smoke, shimmer).
     */
    function overload(level) {
        chargeLevel = Math.max(0, Math.min(1, level));
        heatGoal = Math.max(0, Math.min(1, level - 1));
    }
    /** The last shot: the bore lights up from inside (0..1). */
    function glowBore(level) {
        boreGlow = Math.max(0, Math.min(1, level));
    }
    /** After the Overload ending the barrel is charred and dead (instant snaps). */
    function setScorched(on, instant = false) {
        charGoal = on ? 1 : 0;
        if (instant) char = charGoal;
    }
    /** Back to a cold, ordinary cannon (a load, a replayed ending). */
    function cool() {
        heat = heatGoal = boreGlow = 0;
        chargeLevel = 0;
        haze = true;
    }
    /** The overload's smoke, shimmer and big muzzle halo on/off (a camera right at the barrel would see only haze). */
    function setHaze(on) {
        haze = !!on;
    }

    /**
     * Ending: fire. Recoil, muzzle flash, a shockwave over the ground, sparks, dust and smoke.
     * `force` fires again while a shot is still recoiling (the salvo); `big` is the last shot's
     * flash, straight into the lens.
     */
    function fire({ force = false, big = false } = {}) {
        if (spent && shot && !force) return;
        const { pos } = muzzle();
        shot = { t: 0, big };
        spent = true;
        chargeLevel = 0;
        heatGoal = 0;
        boreGlow = 0;
        effects.sparkle(pos, { count: 60, power: 4, color: 0xfff0b0, size: 0.16 });
        effects.sparkle(pos, { count: 40, power: 3, color: 0xff8a4a, size: 0.12 });
        effects.puff(pos, { color: 0x8a8690, count: 16, size: 0.9, spread: 1.1 });
        effects.puff(new THREE.Vector3(root.position.x, 0.1, root.position.z), { count: 26, size: 0.9, spread: 2.6 });
        if (big) effects.sparkle(pos, { count: 60, power: 6, color: 0xff3b30, size: 0.2 });
    }

    return { setPhase, update, muzzle, pivot, directionAt, aim, yawLeft, charge, overload, glowBore, setScorched, setHaze, cool, fire };
}
