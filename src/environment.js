// src/environment.js — the valley the factory is built in, and how it decays.
// Phase 0 is a cosy meadow: green grass, forest, flowers, a farm, a pond, the
// Pioneer's camp. Every completed phase darkens it (docs/DESIGN.md "Visual
// arc"): grass dries, trees turn autumn → dark → get felled one by one,
// flowers vanish, Nile's compound spreads in from the east. Separately, the
// factory leaves its own scars: grass turns to concrete under everything the
// player builds (and stays paved), smelters and generators scorch the ground.
// Purely visual; the sky and moon are CSS behind the canvas.
import * as THREE from 'three';
import { GRID_WIDTH as W, GRID_HEIGHT as H, PAD_POS, CANNON_AREA } from './config.js';
import { grid, cellHash } from './grid.js';
import { natureMaterial } from './assets.js';
import { haloSprite } from './effects.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RIM = 6; // cells of landscape around the buildable area

// The land per phases completed (0..5): ground tint (multiplies the
// greyscale ground texture), shared nature material colours, pond water.
const LAND = [
    { ground: 0x86cc5c, grass: 0x74bf4c, leafs: 0x5aae46, dirt: 0x8b6243, water: 0x48a9e0 },
    { ground: 0x8cc75e, grass: 0x7fbd4e, leafs: 0x64ac46, dirt: 0x8b6243, water: 0x46a0d8 },
    { ground: 0xb2bb5e, grass: 0xadb24e, leafs: 0x8ea63e, dirt: 0x8a6040, water: 0x3f8aa8 },
    { ground: 0x908b55, grass: 0x8c8648, leafs: 0x707a44, dirt: 0x74523a, water: 0x4a6a62 },
    { ground: 0x6f5d47, grass: 0x705e42, leafs: 0x5a5038, dirt: 0x5e4232, water: 0x4a4038 },
    { ground: 0x4d3c35, grass: 0x4f3f33, leafs: 0x3e3430, dirt: 0x4a3028, water: 0x3a2222 },
];

const TREE_KINDS = ['default', 'oak', 'detailed', 'tall', 'simple', 'cone', 'plateau'];
const STUMPS = ['stump_old', 'stump_oldTall', 'stump_round', 'stump_roundDetailed'];
const POND = { x: -2.6, z: H + 3, r: 2.3 };

// Small props don't cast shadows: they'd cost a draw call each for a few pixels.
const NO_SHADOW = /^(grass|flower|mushroom|lily|crop|wheat|stoneSmall)/;

const rimDist = (x, y) => Math.max(-1 - x, x - W, -1 - y, y - H);
const inPlateau = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
const inCompound = (x, y) => x >= W || (y < 0 && x >= Math.floor(W * 0.6));
const inPond = (x, y) => Math.hypot(x + 0.5 - POND.x, y + 0.5 - POND.z) < POND.r + 0.8;
const inFarm = (x, y) => x >= 4 && x <= 13 && y >= H && y <= H + 3;
const inCamp = (x, y) => x >= -5 && x <= -1 && y >= 9 && y <= 14;
const ease = (t) => t * t * (3 - 2 * t);

/** Greyscale ground detail (the material colour supplies the season). */
function groundTexture() {
    const px = 16;
    const cw = W + RIM * 2;
    const ch = H + RIM * 2;
    const c = document.createElement('canvas');
    c.width = cw * px;
    c.height = ch * px;
    const g = c.getContext('2d');
    for (let cx = 0; cx < cw; cx++) {
        for (let cy = 0; cy < ch; cy++) {
            const x = cx - RIM;
            const y = cy - RIM;
            const h = cellHash(x + 50, y + 90);
            const base = inPlateau(x, y) ? 226 + h * 14 : 200 + h * 22;
            g.fillStyle = `rgb(${base},${base},${base})`;
            g.fillRect(cx * px, cy * px, px, px);
            for (let i = 0; i < 7; i++) {
                const a = cellHash(x * 13 + i, y * 7 - i);
                const b = cellHash(i - x, y * 3 + i);
                g.fillStyle = a > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
                g.fillRect(cx * px + a * px, cy * px + b * px, 2, 3);
            }
        }
    }
    // Faint build grid + a surveyor's line around the buildable area.
    g.strokeStyle = 'rgba(0,0,0,0.09)';
    g.lineWidth = 1;
    for (let x = 0; x <= W; x++) {
        g.beginPath();
        g.moveTo((x + RIM) * px + 0.5, RIM * px);
        g.lineTo((x + RIM) * px + 0.5, (H + RIM) * px);
        g.stroke();
    }
    for (let y = 0; y <= H; y++) {
        g.beginPath();
        g.moveTo(RIM * px, (y + RIM) * px + 0.5);
        g.lineTo((W + RIM) * px, (y + RIM) * px + 0.5);
        g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.setLineDash([6, 6]);
    g.lineWidth = 2;
    g.strokeRect(RIM * px, RIM * px, W * px, H * px);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}

/**
 * @param {THREE.Scene} scene
 * @param {{ get: (key: string) => THREE.Object3D }} assets
 * @param {ReturnType<typeof import('./effects.js').createEffects>} effects
 */
export function buildEnvironment(scene, assets, effects) {
    const root = new THREE.Group();
    root.name = 'environment';
    scene.add(root);
    const rand = (x, y, k = 0) => cellHash(x * 31 + k * 7, y * 17 - k * 3);

    /**
     * Bake static scenery into one mesh per material (+ attribute layout):
     * hundreds of cliff blocks or fence posts become a couple of draw calls.
     */
    function mergeStatic(objs, { castShadow = false } = {}) {
        root.updateMatrixWorld(true);
        const groups = new Map();
        for (const o of objs) {
            o.traverse((m) => {
                if (!m.isMesh || Array.isArray(m.material)) return;
                let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
                if (g.index) g = g.toNonIndexed();
                const key = `${m.material.uuid}|${Object.keys(g.attributes).sort().join(',')}`;
                if (!groups.has(key)) groups.set(key, { mat: m.material, geos: [] });
                groups.get(key).geos.push(g);
            });
            root.remove(o);
        }
        for (const { mat, geos } of groups.values()) {
            const merged = new THREE.Mesh(mergeGeometries(geos), mat);
            merged.castShadow = castShadow;
            merged.receiveShadow = true;
            root.add(merged);
        }
    }

    // ---- Ground ------------------------------------------------------------------
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(), color: LAND[0].ground, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + RIM * 2, H + RIM * 2), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    ground.receiveShadow = true;
    root.add(ground);

    // Paving layer over the buildable area: concrete under built cells, the
    // cannon site's gravel, scorch marks. Transparent where untouched.
    const PX = 32;
    const paveCanvas = document.createElement('canvas');
    paveCanvas.width = W * PX;
    paveCanvas.height = H * PX;
    const pg = paveCanvas.getContext('2d');
    const paveTex = new THREE.CanvasTexture(paveCanvas);
    paveTex.colorSpace = THREE.SRGBColorSpace;
    paveTex.anisotropy = 8;
    const pave = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshStandardMaterial({
            map: paveTex, transparent: true, roughness: 0.95, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }),
    );
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(W / 2, 0.003, H / 2);
    pave.receiveShadow = true;
    pave.renderOrder = 1;
    root.add(pave);

    // Gravel for the cannon's construction site.
    for (let x = CANNON_AREA.x; x < CANNON_AREA.x + CANNON_AREA.w; x++) {
        for (let y = CANNON_AREA.y; y < CANNON_AREA.y + CANNON_AREA.h; y++) {
            pg.fillStyle = `hsl(30, 14%, ${40 + rand(x, y) * 6}%)`;
            pg.fillRect(x * PX, y * PX, PX, PX);
            for (let i = 0; i < 10; i++) {
                pg.fillStyle = `rgba(0,0,0,${0.08 + rand(x + i, y) * 0.1})`;
                pg.fillRect(x * PX + rand(i, x) * PX, y * PX + rand(y, i) * PX, 3, 3);
            }
        }
    }
    paveTex.needsUpdate = true;

    const paved = new Set();
    function paveCell(x, y) {
        const key = `${x},${y}`;
        if (paved.has(key) || (grid[x]?.[y]?.blocked)) return;
        paved.add(key);
        const l = 52 + rand(x, y, 3) * 8;
        pg.fillStyle = `hsl(35, 5%, ${l}%)`;
        pg.fillRect(x * PX, y * PX, PX, PX);
        pg.fillStyle = 'rgba(0,0,0,0.35)';
        pg.fillRect(x * PX, y * PX, PX, 1);
        pg.fillRect(x * PX, y * PX, 1, PX);
        pg.fillStyle = 'rgba(255,255,255,0.08)';
        pg.fillRect(x * PX + 1, y * PX + 1, PX - 2, 1);
        for (let i = 0; i < 5; i++) {
            pg.fillStyle = `rgba(0,0,0,${0.06 + rand(i, x + y) * 0.08})`;
            pg.fillRect(x * PX + rand(x * 3, i) * PX, y * PX + rand(i, y * 5) * PX, 2 + i % 3, 2);
        }
        paveTex.needsUpdate = true;
        const f = flora.get(key);
        if (f) f.gone = true;
    }
    const scorched = new Set();
    function scorch(x, y) {
        const key = `${x},${y}`;
        if (scorched.has(key)) return;
        scorched.add(key);
        const cx = (x + 0.5) * PX;
        const cy = (y + 0.5) * PX;
        const grad = pg.createRadialGradient(cx, cy, PX * 0.3, cx, cy, PX * 1.9);
        grad.addColorStop(0, 'rgba(46,32,22,0.55)');
        grad.addColorStop(1, 'rgba(46,32,22,0)');
        pg.fillStyle = grad;
        pg.fillRect(cx - PX * 2, cy - PX * 2, PX * 4, PX * 4);
        paveTex.needsUpdate = true;
    }

    // ---- Cliffs around the valley ------------------------------------------------
    const cliffs = [];
    const cliffAt = (x, z) => {
        for (let level = 1; level <= 2; level++) {
            const b = assets.get('cliff');
            b.position.set(x + 0.5, -level, z + 0.5);
            b.rotation.y = Math.floor(rand(x, z, level) * 4) * (Math.PI / 2);
            root.add(b);
            cliffs.push(b);
        }
    };
    for (let x = -RIM - 1; x <= W + RIM; x++) {
        cliffAt(x, -RIM - 1);
        cliffAt(x, H + RIM);
    }
    for (let z = -RIM; z < H + RIM; z++) {
        cliffAt(-RIM - 1, z);
        cliffAt(W + RIM, z);
    }
    mergeStatic(cliffs);

    // ---- Things that change with the phase ------------------------------------------
    /** Trees: { x, z, kind, scale, rot, fellPhase, state, obj, anim } */
    const trees = [];
    /** Phase-gated props: { obj, min, max, shown, k } (visible while min <= phase <= max) */
    const props = [];
    /** Flora on buildable cells (gone once paved): key → prop */
    const flora = new Map();
    /** Nile compound pieces: { obj, appear, shown } */
    const compound = [];
    const lamps = [];

    function place(key, x, z, { rot = 0, scale = 1, y = 0 } = {}) {
        const o = assets.get(key);
        o.position.set(x, y, z);
        o.rotation.y = rot;
        o.scale.multiplyScalar(scale);
        o.userData.baseScale = o.scale.x;
        if (NO_SHADOW.test(key)) o.traverse((m) => { if (m.isMesh) m.castShadow = false; });
        root.add(o);
        return o;
    }
    function addProp(key, x, z, min, max, opts) {
        const obj = place(key, x, z, opts);
        const p = { obj, min, max, shown: true, k: 1 };
        props.push(p);
        return p;
    }
    function addTree(x, z, h, fellPhase) {
        const kind = TREE_KINDS[Math.floor(h * TREE_KINDS.length)];
        const t = {
            x, z, kind, fellPhase, state: null, obj: null, anim: null,
            scale: 0.8 + cellHash(x * 3, z * 11) * 0.55,
            rot: cellHash(z, x) * Math.PI * 2,
            stump: STUMPS[Math.floor(cellHash(x + 9, z) * STUMPS.length)],
        };
        trees.push(t);
        return t;
    }

    // Pioneer's camp (west): where the hero sleeps. The fire goes out after the reveal.
    addProp('tent', -3.2, 10.6, 0, 5, { rot: Math.PI / 2 });
    addProp('tentSmall', -4.2, 13.4, 0, 5, { rot: Math.PI * 0.6 });
    const campfire = place('campfire', -2.2, 12.5);
    const fireHalo = haloSprite(0xffa040, 1.4);
    fireHalo.position.set(-2.2, 0.35, 12.5);
    root.add(fireHalo);
    addProp('log', -1.6, 13.2, 0, 5, { rot: 0.3 });
    addProp('log', -2.9, 12.1, 0, 5, { rot: 1.9 });
    addProp('logStack', -4.3, 11.6, 0, 5, { rot: 0.2 });

    // Farm (south): three crop rows behind a fence; crops die at dusk.
    const farmStatic = [];
    for (let x = 4; x <= 13; x++) {
        farmStatic.push(place('fence', x + 0.5, H + 0.15, { rot: 0 }));
        for (let r = 0; r < 3; r++) {
            const y = H + 1 + r;
            farmStatic.push(place('dirtRow', x + 0.5, y + 0.5, { rot: Math.PI / 2 }));
            const crop = ['cropCarrot', 'wheat', 'cropPumpkin'][r];
            addProp(crop, x + 0.5, y + 0.5, 0, 2, { rot: rand(x, y) * 6 });
        }
    }
    mergeStatic(farmStatic, { castShadow: true });

    // Pond (south-west) with lilies; the water turns murky.
    const bank = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.35, 40),
        new THREE.MeshStandardMaterial({ color: 0x6b5a40, roughness: 1 }));
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(POND.x, 0.004, POND.z);
    bank.receiveShadow = true;
    root.add(bank);
    const waterMat = new THREE.MeshStandardMaterial({ color: LAND[0].water, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.92 });
    const water = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 40), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(POND.x, 0.012, POND.z);
    root.add(water);
    for (let i = 0; i < 6; i++) {
        const a = i * 1.7;
        const r = 0.5 + (i % 3) * 0.5;
        addProp(i % 2 ? 'lily' : 'lilySmall', POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, 0, 2, { rot: a, y: 0.014 });
    }

    // Rim: forest, meadow and Nile's compound.
    const BIG_BY_PHASE = {
        1: ['containerA', 'containerB', 'containerC', 'tankLarge'],
        2: ['buildingH', 'dishLarge', 'solar', 'hangar'],
        3: ['coolingTower', 'buildingL', 'buildingM', 'waterTower'],
        4: ['buildingA', 'buildingC', 'buildingE', 'hangar'],
    };
    const bigSlots = [];
    for (let x = -RIM; x < W + RIM; x++) {
        for (let y = -RIM; y < H + RIM; y++) {
            if (inPlateau(x, y)) continue;
            const rd = rimDist(x, y);
            const h = rand(x, y);
            const cx = x + 0.5 + (rand(x, y, 1) - 0.5) * 0.4;
            const cz = y + 0.5 + (rand(x, y, 2) - 0.5) * 0.4;
            if (inPond(x, y) || inFarm(x, y) || inCamp(x, y)) continue;

            if (inCompound(x, y)) {
                const lattice = (((x - W) % 3) + 3) % 3 === 2 && (y + RIM) % 3 === 1 && rd >= 2;
                if (lattice) {
                    bigSlots.push({ x: x + 0.5, z: y + 0.5, d: Math.hypot(x - W, y - PAD_POS.y), h });
                    continue;
                }
            }
            if (rd >= 2 && h < 0.5) {
                // Trees near the plateau fall first; deep forest survives longest.
                const fell = Math.min(6, Math.max(1, Math.floor(1 + (rd - 2) * 0.6 + rand(x, y, 3) * 3.2)));
                addTree(cx, cz, rand(x, y, 4), inCompound(x, y) ? Math.min(fell, 3) : fell);
                continue;
            }
            const f = rand(x, y, 5);
            if (f < 0.1) addProp(['flowerRed', 'flowerYellow', 'flowerPurple'][Math.floor(f * 30) % 3], cx, cz, 0, f < 0.05 ? 1 : 2, { rot: h * 6 });
            else if (f < 0.2) addProp(['grass', 'grassLarge', 'grassLeafs'][Math.floor(f * 30) % 3], cx, cz, 0, 3, { rot: h * 6 });
            else if (f < 0.26) addProp(f < 0.23 ? 'bush' : 'bushLarge', cx, cz, 0, 3, { rot: h * 6 });
            else if (f < 0.29) addProp(f < 0.275 ? 'mushrooms' : 'mushroomsTan', cx, cz, 3, 5, { rot: h * 6 });
            else if (f < 0.31) addProp(f < 0.3 ? 'stoneA' : 'stoneSmall', cx, cz, 0, 5, { rot: h * 6 });
        }
    }
    // Nile's compound: nearer the pad appears sooner. Until then a tree
    // stands on the slot; Nile clears it the phase the building arrives.
    bigSlots.sort((a, b) => a.d - b.d);
    bigSlots.forEach((s, i) => {
        const appear = 1 + Math.min(3, Math.floor((i / bigSlots.length) * 4));
        const options = BIG_BY_PHASE[appear];
        const key = options[Math.floor(s.h * options.length)];
        const obj = place(key, s.x, s.z, { rot: Math.floor(s.h * 4) * (Math.PI / 2) });
        obj.visible = false;
        compound.push({ obj, appear, shown: false });
        addTree(s.x, s.z, s.h, appear);
    });

    // Nile floodlights along the plateau edge; they switch on at golden hour.
    const lampAt = (x, z, rot) => {
        const o = place('lamp', x, z, { rot });
        const halo = haloSprite(0xffb050, 1.1);
        halo.position.set(x, o.userData.height - 0.08, z);
        halo.material.opacity = 0;
        root.add(halo);
        lamps.push(halo);
    };
    for (let x = 0; x <= W; x += 8) {
        lampAt(x - 0.25, -0.35, 0);
        lampAt(x - 0.25, H + 0.35, 0);
    }
    for (let y = 8; y < H; y += 8) {
        lampAt(-0.35, y, 0);
        lampAt(W + 0.35, y, 0);
    }

    // Flora on empty buildable cells: gone once that cell is paved.
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const c = grid[x][y];
            if (c.resource || c.blocked || c.machine) continue;
            const f = rand(x, y, 8);
            if (f > 0.13) continue;
            const key = f < 0.05 ? ['flowerRedB', 'flowerYellowB'][Math.floor(f * 100) % 2] : 'grass';
            const p = addProp(key, x + 0.3 + rand(x, y, 9) * 0.4, y + 0.3 + rand(y, x, 9) * 0.4, 0, f < 0.05 ? 2 : 3, { rot: f * 50 });
            flora.set(`${x},${y}`, p);
        }
    }

    // ---- Phase changes ---------------------------------------------------------------------
    let phase = -1;
    let clock = 0;
    const pending = []; // { at, run }

    function treeTarget(t, p) {
        if (p >= t.fellPhase) return 'stump';
        if (p <= 1) return 'normal';
        return p === 2 ? 'fall' : 'dark';
    }
    function treeKey(t, state) {
        if (state === 'stump') return t.stump;
        return `tree_${t.kind}${state === 'normal' ? '' : `_${state}`}`;
    }
    function setTree(t, state) {
        if (t.obj) root.remove(t.obj);
        t.state = state;
        t.obj = place(treeKey(t, state), t.x, t.z, { rot: t.rot, scale: state === 'stump' ? 1 : t.scale });
    }

    /** Apply a phase. `instant` skips the staggered animations (first load, saves). */
    function setPhase(p, instant = false) {
        if (p === phase) return;
        const animate = !instant && phase >= 0 && p > phase;
        phase = p;
        for (const t of trees) {
            const target = treeTarget(t, p);
            if (target === t.state) continue;
            if (!animate || !t.obj) {
                setTree(t, target);
                continue;
            }
            const at = clock + 300 + Math.random() * 4200;
            if (target === 'stump') {
                pending.push({ at, run: () => (t.anim = { kind: 'fall', t: 0, axis: Math.random() * Math.PI * 2 }) });
            } else {
                pending.push({ at, run: () => { setTree(t, target); t.anim = { kind: 'shiver', t: 0 }; } });
            }
        }
        compound.forEach((c) => {
            const show = p >= c.appear;
            if (show === c.shown) return;
            c.shown = show;
            if (!animate) {
                c.obj.visible = show;
                return;
            }
            pending.push({ at: clock + 2600 + Math.random() * 2500, run: () => {
                c.obj.visible = show;
                c.obj.scale.setScalar(c.obj.userData.baseScale * 0.01);
                c.grow = 0;
                effects.puff(c.obj.position, { count: 14, size: 0.6, spread: 1.2, color: 0xb9a88c });
            } });
        });
        if (instant) {
            for (const pr of props) {
                pr.shown = p >= pr.min && p <= pr.max && !pr.gone && !pr.covered;
                pr.k = pr.shown ? 1 : 0;
                pr.obj.visible = pr.shown;
                pr.obj.scale.setScalar(pr.obj.userData.baseScale * pr.k);
            }
            const land = LAND[Math.min(p, LAND.length - 1)];
            groundMat.color.setHex(land.ground);
            natureMaterial('grass').color.setHex(land.grass);
            natureMaterial('leafsGreen').color.setHex(land.leafs);
            natureMaterial('dirt').color.setHex(land.dirt);
            waterMat.color.setHex(land.water);
        }
    }

    const tmpColor = new THREE.Color();
    function lerpHex(color, hex, k) {
        color.lerp(tmpColor.setHex(hex), k);
    }

    let smokeAcc = 0;
    /** Per frame: staggered transitions, falling trees, colour easing, fire, lamps. */
    function update(dt) {
        clock += dt;
        for (let i = pending.length - 1; i >= 0; i--) {
            if (clock >= pending[i].at) {
                pending[i].run();
                pending.splice(i, 1);
            }
        }
        for (const t of trees) {
            if (!t.anim) continue;
            t.anim.t += dt;
            if (t.anim.kind === 'fall') {
                const k = Math.min(1, t.anim.t / 900);
                const tilt = (Math.PI / 2) * k * k;
                t.obj.rotation.set(Math.cos(t.anim.axis) * tilt, t.rot, Math.sin(t.anim.axis) * tilt);
                if (k >= 1) {
                    setTree(t, 'stump');
                    effects.puff(t.obj.position, { count: 10, size: 0.4, spread: 0.8, color: 0x9e8a6a });
                    t.anim = null;
                }
            } else {
                const k = Math.min(1, t.anim.t / 500);
                t.obj.scale.setScalar(t.scale * (1 + Math.sin(k * Math.PI) * 0.12));
                if (k >= 1) t.anim = null;
            }
        }
        for (const c of compound) {
            if (c.grow == null || c.grow >= 1) continue;
            c.grow = Math.min(1, c.grow + dt / 700);
            const s = 1 + Math.sin(c.grow * Math.PI) * 0.12; // overshoot pop
            c.obj.scale.setScalar(c.obj.userData.baseScale * ease(c.grow) * s);
        }
        for (const pr of props) {
            const want = phase >= pr.min && phase <= pr.max && !pr.gone && !pr.covered;
            if (want !== pr.shown) pr.shown = want;
            const target = pr.shown ? 1 : 0;
            if (pr.k === target) continue;
            pr.k += Math.sign(target - pr.k) * Math.min(Math.abs(target - pr.k), dt / 600);
            pr.obj.visible = pr.k > 0.001;
            pr.obj.scale.setScalar(pr.obj.userData.baseScale * ease(pr.k));
        }
        const land = LAND[Math.max(0, Math.min(phase, LAND.length - 1))];
        const k = 1 - Math.exp(-dt / 1800);
        lerpHex(groundMat.color, land.ground, k);
        lerpHex(natureMaterial('grass').color, land.grass, k);
        lerpHex(natureMaterial('leafsGreen').color, land.leafs, k);
        lerpHex(natureMaterial('dirt').color, land.dirt, k);
        lerpHex(waterMat.color, land.water, k);

        // The campfire burns until the reveal; then the camp is abandoned.
        const fireOn = phase < 4;
        const flick = 0.75 + Math.sin(clock / 90) * 0.12 + Math.sin(clock / 37) * 0.08;
        fireHalo.material.opacity = fireOn ? flick * (phase >= 2 ? 1 : 0.6) : Math.max(0, fireHalo.material.opacity - dt / 2000);
        campfire.visible = true;
        if (fireOn) {
            smokeAcc += dt;
            if (smokeAcc > 650) {
                smokeAcc = 0;
                effects.smoke(new THREE.Vector3(-2.2, 0.35, 12.5), { color: 0xa09a94, size: 0.16, rise: 0.45, opacity: 0.4 });
            }
        }
        const lampsOn = phase >= 2;
        for (const l of lamps) {
            const target = lampsOn ? 0.75 + Math.sin(clock / 400 + l.position.x) * 0.05 : 0;
            l.material.opacity += (target - l.material.opacity) * Math.min(1, dt / 800);
        }
    }

    return {
        setPhase,
        update,
        paveCell,
        scorch,
        /** Hide (or restore) a cell's flowers without paving it — under conveyors. */
        coverCell(x, y, covered) {
            const f = flora.get(`${x},${y}`);
            if (f) f.covered = covered;
        },
        savePaved: () => [...paved],
        loadPaved(list) {
            for (const key of list ?? []) {
                const [x, y] = key.split(',').map(Number);
                paveCell(x, y);
            }
        },
    };
}
