// src/renderer.js — the 3D view (Three.js): an isometric diorama of the
// simulation grid. Owns the scene, the per-phase lighting mood, the
// machine/ore/item views (with build/demolish/upgrade juice), the build
// overlay and cursor picking, and drives the environment, cannon and effects
// modules. It reads the grid every frame to keep machine views in sync, and
// reacts to FactoryEvents for item meshes — it never changes simulation
// state. Knows nothing about input or the loop.
//
// World mapping: grid cell (x, y) is centred on (x + 0.5, 0, y + 0.5); grid
// "down" (+y) is world +z. Model forward is +z, so dir → yaw via YAW.
import * as THREE from 'three';
import {
    GRID_WIDTH as W, GRID_HEIGHT as H, TICK_RATE, MAX_TIER, POWER_DRAW, PAD_POS, CANNON_AREA, HQ_FLIGHT_MS, PROCESS_TICKS,
} from './config.js';
import {
    grid, power, research, project, canBuildMachine, canUpgrade, machineProgressFraction, UPGRADABLE, cellHash, machinePorts,
    machineStatus, machineRecipe, oreRevision, visualPhase, plotLevel, hasCannon,
} from './grid.js';
import { loadAssets, createItemMesh, tintTemplate, ORE_TINT } from './assets.js';
import { buildEnvironment } from './environment.js';
import { buildCannon } from './cannon.js';
import { createEffects, haloSprite } from './effects.js';
import { createCameraRig } from './camera.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DIR_VEC = { right: { dx: 1, dy: 0 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, up: { dx: 0, dy: -1 } };
const OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };
const PERP = { right: ['down', 'up'], left: ['up', 'down'], up: ['right', 'left'], down: ['left', 'right'] };
const YAW = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };
// Rotating a model by +90° yaw turns these grid directions into the next.
const ROT90 = { down: 'right', right: 'up', up: 'left', left: 'down' };

const BELT_TOP = 0.4;   // conveyor surface height (Factory Kit conveyor, fit 1)
const PAD_TOP = 0.08;
const TICK_MS = 1000 / TICK_RATE;

const BRAND_BLUE = 0x38bdf8;
const BRAND_RED = 0xff4d5e;

// Lighting per phases completed: the day wears on as the story darkens
// (sunny morning → afternoon → golden hour → dusk → red night → blood red).
// `dir` points from the scene toward the sun/moon.
const MOODS = [
    { sky: 0xd6ecff, ground: 0x6c7c48, hemi: 1.2, sun: 0xfff1d8, sunI: 2.9, dir: [-0.45, 1, -0.2], rim: 0xffd6a8, rimI: 0.4, exposure: 1.0, env: 0.45 },
    { sky: 0xd0e4ff, ground: 0x6e7846, hemi: 1.15, sun: 0xffe6c0, sunI: 2.8, dir: [-0.15, 1, -0.45], rim: 0xffc890, rimI: 0.5, exposure: 1.0, env: 0.42 },
    { sky: 0xffc8a0, ground: 0x6a5238, hemi: 0.95, sun: 0xffa868, sunI: 2.6, dir: [0.95, 0.5, -0.35], rim: 0xff9050, rimI: 0.75, exposure: 1.05, env: 0.34 },
    { sky: 0x9c88dc, ground: 0x3a2e42, hemi: 0.85, sun: 0xc8aaff, sunI: 1.8, dir: [-0.6, 0.85, -0.55], rim: 0xff7a5a, rimI: 0.75, exposure: 1.12, env: 0.28 },
    { sky: 0xffa0b0, ground: 0x3a2028, hemi: 0.95, sun: 0xffd0d6, sunI: 2.2, dir: [-0.55, 1, -0.4], rim: 0xff4a3a, rimI: 1.25, exposure: 1.1, env: 0.25 },
    { sky: 0xff7484, ground: 0x2a1014, hemi: 0.9, sun: 0xff9c8c, sunI: 2.0, dir: [-0.55, 1, -0.4], rim: 0xff2a1a, rimI: 1.45, exposure: 1.1, env: 0.22 },
];

// After the NIHIL HQ ending: the valley's dawn (the Moon stays; the light comes back).
const FREED = { sky: 0xffd9bf, ground: 0x5f6044, hemi: 1.05, sun: 0xffcf9a, sunI: 2.6, dir: [0.95, 0.42, -0.25], rim: 0xffb27a, rimI: 0.6, exposure: 1.02, env: 0.36 };

// Conveyors are laid by the hundred: they don't pave the grass (only real
// buildings leave concrete), they just hide the flowers under them.
const CONVEYORS = new Set(['belt', 'splitter', 'merger']);

const easeOutBack = (t) => {
    const c1 = 1.70158;
    const u = t - 1;
    return 1 + (c1 + 1) * u * u * u + c1 * u * u;
};
const smooth = (t) => t * t * (3 - 2 * t);

// Chimney smoke per machine: how often (sim ms) and what it looks like.
const SMOKE = {
    smelter: { every: 380, color: 0x7d7a80, size: 0.14 },
    foundry: { every: 300, color: 0x4a474e, size: 0.22, rise: 0.62, opacity: 0.62 },
};

// ---- Small geometry helpers --------------------------------------------------

/** A flat triangle in the XZ plane pointing +z (for direction arrows). */
function flatTriangle(len, width) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, len / 2, width / 2, 0, -len / 2, -width / 2, 0, -len / 2,
    ], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    return g;
}

/**
 * A flat ribbon along a centreline in the XZ plane; v runs along the line in
 * world units, so a repeating texture keeps the same density on curves.
 */
function ribbon(points, width) {
    const pos = [];
    const uv = [];
    const idx = [];
    let v = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const q = points[Math.min(i + 1, points.length - 1)];
        const o = points[Math.max(i - 1, 0)];
        const tx = q.x - o.x;
        const tz = q.z - o.z;
        const len = Math.hypot(tx, tz) || 1;
        const nx = -tz / len;
        const nz = tx / len;
        if (i > 0) v += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
        pos.push(p.x + nx * width / 2, 0, p.z + nz * width / 2, p.x - nx * width / 2, 0, p.z - nz * width / 2);
        uv.push(1, v, 0, v);
        if (i > 0) {
            // Counter-clockwise seen from above, so the faces point +y.
            const a = (i - 1) * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

const STRAIGHT_PATH = [new THREE.Vector3(0, 0, -0.5), new THREE.Vector3(0, 0, 0.5)];
// Native corner: centre (-0.5, +0.5), radius 0.5, from the -x edge (travelling
// +x) to the +z edge (travelling +z). Matches conveyor-stripe-corner.
const CORNER_PATH = Array.from({ length: 11 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 10) * (Math.PI / 2);
    return new THREE.Vector3(-0.5 + Math.cos(a) * 0.5, 0, 0.5 + Math.sin(a) * 0.5);
});

/** Canvas texture: a soft chevron pointing toward +v, tiling along v. */
function chevronTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const y of [12, 44]) {
        g.beginPath();
        g.moveTo(12, y + 14);
        g.lineTo(32, y);
        g.lineTo(52, y + 14);
        g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function dotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(16, 16, 13, 0, Math.PI * 2);
    g.fill();
    return new THREE.CanvasTexture(c);
}

/**
 * Status bubbles over machines, one texture per machineStatus() code that
 * means "look here": a coloured disc with a dark rim and a white glyph.
 */
function statusTextures() {
    const make = (fill, glyph) => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(8,14,26,0.85)';
        g.beginPath();
        g.arc(32, 32, 30, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = fill;
        g.beginPath();
        g.arc(32, 32, 25, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.strokeStyle = '#fff';
        g.lineWidth = 5;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        glyph(g);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    };
    const dots = (g) => [20, 32, 44].forEach((x) => { g.beginPath(); g.arc(x, 33, 4, 0, Math.PI * 2); g.fill(); });
    const bang = (g) => { g.fillRect(29, 15, 6, 22); g.beginPath(); g.arc(32, 46, 3.6, 0, Math.PI * 2); g.fill(); };
    const bolt = (g) => { g.beginPath(); g.moveTo(36, 12); g.lineTo(22, 35); g.lineTo(32, 35); g.lineTo(28, 52); g.lineTo(43, 28); g.lineTo(33, 28); g.closePath(); g.fill(); };
    const powerOff = (g) => { g.beginPath(); g.arc(32, 34, 13, -Math.PI * 0.3, Math.PI * 1.3); g.stroke(); g.beginPath(); g.moveTo(32, 15); g.lineTo(32, 31); g.stroke(); };
    const lock = (g) => { g.fillRect(21, 30, 22, 17); g.beginPath(); g.arc(32, 29, 8, Math.PI, 0); g.stroke(); };
    return {
        input: make('#5d6b80', dots),     // waiting for an ingredient
        blocked: make('#e8761c', bang),   // finished product can't leave
        tripped: make('#e2483d', bolt),   // breaker tripped
        slow: make('#d9a43a', bolt),      // brownout
        fuel: make('#5d6b80', bolt),      // generator without coal
        off: make('#3c4656', powerOff),   // switched off
        locked: make('#3c4656', lock),    // recipe needs research
    };
}

function beamTexture() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
    return new THREE.CanvasTexture(c);
}

/** Two stacked downward chevrons, white on a dark outline (tinted by the sprite's colour). */
function dropChevronTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [w, style] of [[22, 'rgba(11,21,36,0.75)'], [11, '#ffffff']]) {
        g.lineWidth = w;
        g.strokeStyle = style;
        for (const y of [30, 70]) {
            g.beginPath();
            g.moveTo(28, y);
            g.lineTo(64, y + 30);
            g.lineTo(100, y);
            g.stroke();
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// -----------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
 */
export async function createRenderer(container, { onProgress } = {}) {
    const assets = await loadAssets(onProgress);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // A soft studio environment gives PBR materials some reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.28;
    const rig = createCameraRig({ width: W, height: H });
    rig.focusOn(PAD_POS.x - 3, PAD_POS.y + 0.5);
    rig.zoomBy(1.35);

    // ---- Lights: sun (later the moon) with soft shadows, a warm rim fill.
    // Colours, intensities and the sun's direction follow MOODS per phase.
    const centre = new THREE.Vector3(W / 2, 0, H / 2);
    const hemi = new THREE.HemisphereLight(MOODS[0].sky, MOODS[0].ground, MOODS[0].hemi);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(MOODS[0].sun, MOODS[0].sunI);
    sun.target.position.copy(centre);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sh = Math.max(W, H) / 2 + 10;
    Object.assign(sun.shadow.camera, { left: -sh, right: sh, top: sh, bottom: -sh, near: 1, far: 110 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    const sunDir = new THREE.Vector3(...MOODS[0].dir).normalize();
    const rimLight = new THREE.DirectionalLight(MOODS[0].rim, MOODS[0].rimI);
    rimLight.position.set(W / 2 + 20, 12, H / 2 + 16);
    rimLight.target.position.copy(centre);
    scene.add(rimLight, rimLight.target);

    const effects = createEffects(scene);
    const env = buildEnvironment(scene, assets, effects);
    // The cannon lives in its own group, hidden in an Infinite valley (which has no cannon).
    const cannonGroup = new THREE.Group();
    scene.add(cannonGroup);
    const cannon = buildCannon(cannonGroup, assets, effects, CANNON_AREA);

    const oreLayer = new THREE.Group();
    const machineLayer = new THREE.Group();
    const itemLayer = new THREE.Group();
    const overlay = new THREE.Group();
    scene.add(oreLayer, machineLayer, itemLayer, overlay);

    // ---- Shared materials -----------------------------------------------------
    const chevronMat = new THREE.MeshBasicMaterial({
        map: chevronTexture(), color: 0x2c3168, transparent: true, opacity: 0.6, depthWrite: false,
    });
    const arrowMats = {
        out: new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.85, depthWrite: false }),
        split: new THREE.MeshBasicMaterial({ color: 0x4fe3c1, transparent: true, opacity: 0.9, depthWrite: false }),
        merge: new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0.9, depthWrite: false }),
        dim: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
    };
    const dotTex = dotTexture();
    // The Fabricator's own parts: an articulated arm in machine colours.
    const fabScreenMat = new THREE.MeshStandardMaterial({ color: 0x0b1524, emissive: 0x3cc8b4, emissiveIntensity: 0.9, roughness: 0.4 });
    const armMats = {
        yellow: new THREE.MeshStandardMaterial({ color: 0xf3b23c, roughness: 0.5, flatShading: true }),
        steel: new THREE.MeshStandardMaterial({ color: 0x5c6470, roughness: 0.4, metalness: 0.3, flatShading: true }),
        dark: new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.5, flatShading: true }),
    };
    const armGeo = {
        turntable: new THREE.CylinderGeometry(0.1, 0.12, 0.06, 12),
        joint: new THREE.SphereGeometry(0.05, 10, 8),
        upper: new THREE.BoxGeometry(0.07, 0.3, 0.07),
        fore: new THREE.BoxGeometry(0.06, 0.24, 0.06),
        wrist: new THREE.BoxGeometry(0.1, 0.04, 0.06),
        finger: new THREE.BoxGeometry(0.02, 0.07, 0.04),
    };
    /** { root, base, shoulder, elbow }: base turns, shoulder and elbow bend (rotation.z). */
    function robotArm() {
        const mesh = (geo, m) => {
            const o = new THREE.Mesh(geo, m);
            o.castShadow = true;
            return o;
        };
        const root = new THREE.Group();
        const base = new THREE.Group();
        root.add(base);
        const table = mesh(armGeo.turntable, armMats.steel);
        table.position.y = 0.03;
        base.add(table);
        const shoulder = new THREE.Group();
        shoulder.position.y = 0.08;
        base.add(shoulder);
        shoulder.add(mesh(armGeo.joint, armMats.dark));
        const upper = mesh(armGeo.upper, armMats.yellow);
        upper.position.y = 0.15;
        shoulder.add(upper);
        const elbow = new THREE.Group();
        elbow.position.y = 0.3;
        shoulder.add(elbow);
        elbow.add(mesh(armGeo.joint, armMats.dark));
        const fore = mesh(armGeo.fore, armMats.yellow);
        fore.position.y = 0.12;
        elbow.add(fore);
        const wrist = mesh(armGeo.wrist, armMats.steel);
        wrist.position.y = 0.25;
        elbow.add(wrist);
        for (const sx of [-0.035, 0.035]) {
            const f = mesh(armGeo.finger, armMats.dark);
            f.position.set(sx, 0.3, 0);
            elbow.add(f);
        }
        shoulder.rotation.z = -0.55;
        elbow.rotation.z = 1.7;
        base.rotation.y = -0.6;
        return { root, base, shoulder, elbow };
    }
    // The Press, Foundry and Mixer's own parts: shared geometry in the arm's
    // materials; glowing surfaces get a material per machine (they pulse with its work).
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd5dbe3, roughness: 0.25, metalness: 0.8 });
    const moltenMat = new THREE.MeshStandardMaterial({ color: 0x2a0c00, emissive: 0xff8a20, emissiveIntensity: 1.4 });
    const toxicMat = new THREE.MeshStandardMaterial({ color: 0x223308, emissive: 0x8ee01a, emissiveIntensity: 0.8, roughness: 0.3 });
    const partGeo = {
        housing: new THREE.CylinderGeometry(0.075, 0.085, 0.2, 12),
        rod: new THREE.CylinderGeometry(0.028, 0.028, 0.3, 8),
        mouth: new THREE.PlaneGeometry(0.4, 0.2),
        melt: new THREE.CircleGeometry(0.2, 8, Math.PI / 8),
        liquid: new THREE.CircleGeometry(0.34, 8, Math.PI / 8),
        bridge: new THREE.BoxGeometry(0.86, 0.05, 0.09),
        motor: new THREE.CylinderGeometry(0.085, 0.085, 0.15, 10),
        motorCap: new THREE.CylinderGeometry(0.06, 0.07, 0.04, 10),
        pipe: new THREE.CylinderGeometry(0.034, 0.034, 1, 8), // unit length, scaled
        valve: new THREE.TorusGeometry(0.06, 0.016, 6, 12),
        shaft: new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6),
        blade: new THREE.BoxGeometry(0.44, 0.022, 0.06),
    };
    /** A part's geometry placed in its machine: scaled (y), turned (x, y, z), moved. */
    const placed = (geo, x, y, z, { sy = 1, rx = 0, ry = 0, rz = 0 } = {}) => {
        let g = geo.clone();
        if (sy !== 1) g.scale(1, sy, 1);
        if (rx) g.rotateX(rx);
        if (ry) g.rotateY(ry);
        if (rz) g.rotateZ(rz);
        g.translate(x, y, z);
        if (g.index) g = g.toNonIndexed();
        return g;
    };
    /**
     * Static model parts baked into one mesh per material, once per `key`, and shared by every
     * machine of that kind (the press's frame is a dozen Kenney meshes otherwise). `build`
     * returns the parts posed in the machine's frame; materials are matched by name and
     * colour, so the parts must come from one kit (the Factory Kit shares one colour atlas).
     */
    const bakedParts = new Map();
    function baked(key, build) {
        if (!bakedParts.has(key)) {
            const holder = new THREE.Group();
            for (const o of build()) holder.add(o);
            holder.updateMatrixWorld(true);
            const groups = new Map();
            holder.traverse((m) => {
                if (!m.isMesh || Array.isArray(m.material)) return;
                let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
                if (g.index) g = g.toNonIndexed();
                const mat = m.material;
                const k = `${mat.name || mat.uuid}|${mat.color?.getHexString()}|${Object.keys(g.attributes).sort().join(',')}`;
                if (!groups.has(k)) groups.set(k, { mat, geos: [] });
                groups.get(k).geos.push(g);
            });
            bakedParts.set(key, [...groups.values()].map(({ mat, geos }) => ({ mat, geo: mergeGeometries(geos) })));
        }
        const group = new THREE.Group();
        for (const { geo, mat } of bakedParts.get(key)) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        }
        return group;
    }
    // The Mixer's static parts, merged per material once (they depend on the vat's height).
    let mixerParts = null;
    function mixerFixed(rim) {
        if (mixerParts) return mixerParts;
        const px = -0.445; // the feed pipe, just outside the vat's left wall
        mixerParts = {
            dark: mergeGeometries([placed(partGeo.bridge, 0, rim + 0.03, 0), placed(partGeo.motorCap, 0, rim + 0.225, 0)]),
            yellow: mergeGeometries([placed(partGeo.motor, 0, rim + 0.13, 0), placed(partGeo.valve, px - 0.04, rim * 0.5, 0, { ry: Math.PI / 2 })]),
            steel: mergeGeometries([
                placed(partGeo.pipe, px, (rim + 0.1) / 2, 0, { sy: rim + 0.1 }),
                placed(partGeo.pipe, px + 0.11, rim + 0.08, 0, { sy: 0.25, rz: Math.PI / 2 }),
            ]),
            blades: mergeGeometries([placed(partGeo.blade, 0, 0, 0), placed(partGeo.blade, 0, 0, 0, { ry: Math.PI / 2 })]),
        };
        return mixerParts;
    }
    const partMesh = (geo, m, parent, x, y, z) => {
        const o = new THREE.Mesh(geo, m);
        o.position.set(x, y, z);
        o.castShadow = true;
        parent.add(o);
        return o;
    };
    const STATUS_TEX = statusTextures();
    let statusShown = true; // off during the ending
    const tierMat = new THREE.SpriteMaterial({ map: dotTex, color: 0xffd54a, depthTest: false });
    const barBgMat = new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.55, transparent: true, depthTest: false });
    const barFillMat = new THREE.SpriteMaterial({ color: 0x6ee7b7, depthTest: false });
    const straightGeo = ribbon(STRAIGHT_PATH, 0.5);
    const cornerGeo = ribbon(CORNER_PATH, 0.5);
    const cornerRevGeo = ribbon([...CORNER_PATH].reverse(), 0.5);
    const arrowGeo = flatTriangle(0.2, 0.22);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x1a0800, emissive: 0xff7a18, emissiveIntensity: 1 });

    // ---- Ore nodes (terrain) --------------------------------------------------------
    // Built from the grid's resources, and rebuilt where they change: grid.js bumps
    // `oreRevision` whenever a field is laid (the sulfur under the drained pond appears
    // at the reveal). A field that appears during play pushes up out of the ground in
    // a ripple of dust and sparks; on load it is simply there.
    const oreTemplates = {};
    for (const [type, t] of Object.entries(ORE_TINT)) {
        oreTemplates[type] = ['crystalsA', 'crystalsB', 'crystalsC'].map((key) => tintTemplate(
            assets.get(key), { rock: t.rock, rockTrack: t.rockTrack, crystal: t.crystal }, { crystal: t.glow },
        ));
    }
    const stainGeo = new THREE.CircleGeometry(0.48, 20);
    const stainMats = Object.fromEntries(Object.keys(ORE_TINT).map((type) => [type,
        new THREE.MeshBasicMaterial({ color: ORE_TINT[type].crystal, transparent: true, opacity: 0.12, depthWrite: false })]));
    const oreViews = new Map();
    const orePops = []; // { g, x, y, wait, t } — fresh ore rising out of the ground
    let oreShown = -1;

    function buildOreView(x, y, res) {
        const g = new THREE.Group();
        g.position.set(x + 0.5, 0, y + 0.5);
        const variants = oreTemplates[res] ?? oreTemplates.ironOre;
        const rock = variants[Math.floor(cellHash(x, y) * variants.length)].clone();
        rock.rotation.y = cellHash(y, x) * Math.PI * 2;
        g.add(rock);
        const stain = new THREE.Mesh(stainGeo, stainMats[res] ?? stainMats.ironOre);
        stain.rotation.x = -Math.PI / 2;
        stain.position.y = 0.004;
        g.add(stain);
        g.userData.rock = rock;
        g.userData.type = res;
        oreLayer.add(g);
        return g;
    }

    /** Match the ore views to the grid's resources (only when oreRevision moved). */
    function syncOre(animate) {
        if (oreRevision === oreShown) return;
        oreShown = oreRevision;
        const fresh = [];
        for (let x = 0; x < W; x++) {
            for (let y = 0; y < H; y++) {
                const key = `${x},${y}`;
                const res = grid[x][y].resource;
                const old = oreViews.get(key);
                if (old && old.userData.type === res) continue;
                if (old) {
                    oreLayer.remove(old);
                    oreViews.delete(key);
                }
                if (!res) continue;
                const g = buildOreView(x, y, res);
                oreViews.set(key, g);
                env.markOre(x, y);
                fresh.push({ g, x, y });
            }
        }
        if (!animate || !fresh.length) return;
        // Rise from the middle of the new field outward, after the land has had a moment
        // (in the river bed: once the water draining away from the dam has passed).
        const cx = fresh.reduce((s, f) => s + f.x, 0) / fresh.length;
        const cy = fresh.reduce((s, f) => s + f.y, 0) / fresh.length;
        for (const f of fresh) {
            f.g.scale.setScalar(0.001);
            const settle = grid[f.x][f.y].river ? 2600 : 1400;
            orePops.push({ g: f.g, wait: settle + Math.hypot(f.x - cx, f.y - cy) * 260 + Math.random() * 200, t: 0 });
        }
    }

    function animateOre(dt) {
        for (let i = orePops.length - 1; i >= 0; i--) {
            const p = orePops[i];
            if (p.wait > 0) {
                p.wait -= dt;
                if (p.wait <= 0) {
                    const at = p.g.position;
                    effects.puff(at, { color: 0xcdb46a, count: 6, size: 0.3, spread: 0.35 });
                    effects.sparkle(new THREE.Vector3(at.x, 0.3, at.z), { color: 0xffe45a, count: 5, power: 1.1, size: 0.09 });
                }
                continue;
            }
            p.t = Math.min(1, p.t + dt / 420);
            p.g.scale.setScalar(Math.max(0.001, easeOutBack(p.t)));
            if (p.t >= 1) {
                p.g.scale.setScalar(1);
                orePops.splice(i, 1);
            }
        }
    }
    syncOre(false);

    // ---- Machine views ------------------------------------------------------------------
    /** @type {Map<string, { sig: string, machine: object, obj: THREE.Group, parts: object }>} */
    const views = new Map();

    // Which neighbour feeds this belt? A single feeder from a side turns it into a corner.
    function incomingDir(x, y) {
        let found = null;
        for (const [dir, v] of Object.entries(DIR_VEC)) {
            const nx = x - v.dx;
            const ny = y - v.dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nm = grid[nx][ny].machine;
            if (!nm || nm.type === 'sink') continue;
            const outs = nm.type === 'splitter' ? [nm.dir, ...PERP[nm.dir]] : [nm.dir];
            if (!outs.includes(dir)) continue; // neighbour's output doesn't point at us
            if (found) return null; // several feeders → keep it straight
            found = dir;
        }
        return found;
    }

    function beltShape(x, y, m) {
        const inDir = incomingDir(x, y);
        if (!inDir || inDir === m.dir || inDir === OPPOSITE[m.dir]) return 'straight';
        return `corner:${inDir}`;
    }

    // Rotation + flow sense for a corner from the native {left, down} model.
    function cornerFit(inDir, outDir) {
        const entry = OPPOSITE[inDir];
        let a = 'left';
        let b = 'down';
        for (let k = 0; k < 4; k++) {
            if (a === entry && b === outDir) return { yaw: k * (Math.PI / 2), reversed: false };
            if (a === outDir && b === entry) return { yaw: k * (Math.PI / 2), reversed: true };
            a = ROT90[a];
            b = ROT90[b];
        }
        return { yaw: 0, reversed: false };
    }

    function addArrow(group, dir, mat, inward = false, y = BELT_TOP + 0.01, reach = 0.36) {
        const a = new THREE.Mesh(arrowGeo, mat);
        const v = DIR_VEC[dir];
        a.position.set(v.dx * reach, y, v.dy * reach);
        a.rotation.y = YAW[dir] + (inward ? Math.PI : 0);
        a.renderOrder = 2;
        group.add(a);
        return a;
    }

    /** Build the 3D view for a machine (or a build ghost when `ghost`). */
    function buildView(m, x, y, shape, ghost = false) {
        const obj = new THREE.Group();
        const parts = {};
        const facing = new THREE.Group(); // rotated to the machine's dir
        facing.rotation.y = YAW[m.dir] ?? 0;
        obj.add(facing);

        switch (m.type) {
            case 'belt': {
                if (shape.startsWith('corner:')) {
                    const fit = cornerFit(shape.slice(7), m.dir);
                    const turn = new THREE.Group();
                    turn.rotation.y = fit.yaw;
                    turn.add(assets.get('beltCorner'));
                    const strip = new THREE.Mesh(fit.reversed ? cornerRevGeo : cornerGeo, chevronMat);
                    strip.position.y = BELT_TOP + 0.006;
                    strip.renderOrder = 1;
                    turn.add(strip);
                    obj.add(turn);
                } else {
                    facing.add(assets.get('belt'));
                    const strip = new THREE.Mesh(straightGeo, chevronMat);
                    strip.position.y = BELT_TOP + 0.006;
                    strip.renderOrder = 1;
                    facing.add(strip);
                }
                break;
            }
            case 'splitter':
            case 'merger': {
                obj.add(assets.get('router'));
                const isSplit = m.type === 'splitter';
                const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 20),
                    new THREE.MeshStandardMaterial({ color: isSplit ? 0x2bb89a : 0xd9792a, roughness: 0.4 }));
                cap.position.y = BELT_TOP + 0.02;
                obj.add(cap);
                if (isSplit) {
                    addArrow(obj, OPPOSITE[m.dir], arrowMats.dim, true);
                    for (const d of [m.dir, ...PERP[m.dir]]) addArrow(obj, d, arrowMats.split);
                } else {
                    for (const d of [OPPOSITE[m.dir], ...PERP[m.dir]]) addArrow(obj, d, arrowMats.dim, true);
                    addArrow(obj, m.dir, arrowMats.merge);
                }
                break;
            }
            case 'extractor': {
                const frame = assets.get('extractorFrame');
                facing.add(frame);
                const piston = assets.get('extractorPiston');
                piston.userData.baseY = frame.userData.height - piston.userData.height - 0.02;
                piston.position.y = piston.userData.baseY;
                facing.add(piston);
                parts.piston = piston;
                addArrow(facing, 'down', arrowMats.out, false, 0.02, 0.4);
                break;
            }
            case 'smelter': {
                const body = assets.get('smelter');
                facing.add(body);
                const chimney = assets.get('chimney');
                chimney.position.set(-0.24, body.userData.height - 0.05, -0.2);
                facing.add(chimney);
                const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), ghost ? glowMat : glowMat.clone());
                mouth.position.set(0, 0.24, body.userData.depth / 2 + 0.006);
                facing.add(mouth);
                parts.mouth = mouth;
                if (!ghost) {
                    const halo = haloSprite(0xff8a30, 0.7);
                    halo.position.set(0, 0.26, body.userData.depth / 2 + 0.12);
                    halo.material.opacity = 0;
                    facing.add(halo);
                    parts.halo = halo;
                    const top = new THREE.Object3D();
                    top.position.set(-0.24, body.userData.height - 0.05 + chimney.userData.height, -0.2);
                    facing.add(top);
                    parts.smokeFrom = top;
                }
                addArrow(facing, 'down', arrowMats.out, false, 0.02, 0.47);
                break;
            }
            case 'assembler': {
                const body = assets.get('assembler');
                facing.add(body);
                const cog = assets.get('cog');
                cog.position.set(0, body.userData.height - 0.02, -0.05);
                facing.add(cog);
                parts.cog = cog;
                addArrow(facing, 'down', arrowMats.out, false, 0.02, 0.47);
                break;
            }
            case 'fabricator': {
                // A yellow robot arm on a machine bed, writing data cartridges at a teal reader.
                const bed = assets.get('fabBed');
                facing.add(bed);
                const arm = robotArm();
                arm.root.position.set(-0.08, bed.userData.height - 0.03, -0.08);
                arm.root.scale.setScalar(1.45);
                facing.add(arm.root);
                parts.arm = arm;
                const screen = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), fabScreenMat);
                screen.position.set(0.17, bed.userData.height - 0.01, 0.13);
                facing.add(screen);
                addArrow(facing, 'down', arrowMats.out, false, 0.02, 0.47);
                break;
            }
            case 'press': {
                // A hydraulic press: a heavy bed with a yellow die, two columns, a crown with
                // the cylinder on top, and the ram on a chrome rod between the columns.
                // Built from squashed Factory Kit pistons (three meshes each), so the frame and
                // the ram are baked into one mesh per material, shared by every press.
                const block = (sx, sy, sz, y, flip = false) => {
                    const o = assets.get('pressBlock');
                    o.scale.set(sx, sy, sz);
                    if (flip) o.rotation.x = Math.PI; // cap down
                    o.position.y = flip ? y + sy : y;
                    return o;
                };
                const BED = 0.28;
                const COL = 0.5;
                const crownY = BED + COL - 0.02;
                const dieTop = BED + assets.templates.pressDie.userData.height;
                facing.add(baked('pressFrame', () => {
                    const die = assets.get('pressDie');
                    die.position.y = BED;
                    const cols = [-0.33, 0.33].map((sx) => {
                        const col = assets.get('pressColumn');
                        col.scale.set(0.15, COL, 0.15);
                        col.position.set(sx, BED, 0);
                        return col;
                    });
                    return [block(0.86, BED, 0.8, 0), die, ...cols, block(0.9, 0.2, 0.34, crownY)];
                }));
                partMesh(partGeo.housing, armMats.dark, facing, 0, crownY + 0.28, 0);
                const ram = new THREE.Group();
                ram.add(baked('pressRam', () => [block(0.42, 0.2, 0.3, 0, true)]));
                partMesh(partGeo.rod, chromeMat, ram, 0, 0.2 + 0.15, 0);
                const up = crownY - 0.02 - 0.2;
                ram.userData = { up, down: dieTop + 0.004 };
                ram.position.y = up;
                facing.add(ram);
                parts.ram = ram;
                addArrow(facing, 'down', arrowMats.out, false, 0.02, 0.47);
                break;
            }
            case 'foundry': {
                // Heavy industry: a soot-black furnace with molten steel in its roof, a glowing
                // mouth, and a tall stack that smokes while it pours.
                const body = assets.get('foundry');
                facing.add(body);
                const stack = assets.get('foundryStack');
                stack.position.set(-0.26, 0, -0.3);
                facing.add(stack);
                const melt = new THREE.Mesh(partGeo.melt, ghost ? moltenMat : moltenMat.clone());
                melt.rotation.x = -Math.PI / 2;
                melt.position.y = body.userData.height - 0.05;
                facing.add(melt);
                parts.melt = melt;
                const mouth = new THREE.Mesh(partGeo.mouth, ghost ? glowMat : glowMat.clone());
                mouth.position.set(0, 0.3, body.userData.depth / 2 + 0.006);
                facing.add(mouth);
                parts.mouth = mouth;
                if (!ghost) {
                    const halo = haloSprite(0xff8a30, 0.8);
                    halo.position.set(0, 0.32, body.userData.depth / 2 + 0.12);
                    halo.material.opacity = 0;
                    facing.add(halo);
                    parts.halo = halo;
                    const meltHalo = haloSprite(0xff9a3a, 0.75);
                    meltHalo.position.y = body.userData.height + 0.08;
                    facing.add(meltHalo);
                    parts.meltHalo = meltHalo;
                    const smokeTop = new THREE.Object3D();
                    smokeTop.position.set(-0.26, stack.userData.height + 0.02, -0.3);
                    facing.add(smokeTop);
                    parts.smokeFrom = smokeTop;
                }
                addArrow(facing, 'down', arrowMats.out, false, 0.02, 0.47);
                break;
            }
            case 'mixer': {
                // NIHIL's chemistry: an open gunmetal vat with an alarm-red rim, full of something
                // sickly green that glows and bubbles while a paddle stirs it.
                const vat = assets.get('mixerVat');
                vat.scale.y *= 1.5; // a deep vat, not a tub
                facing.add(vat);
                const rim = vat.userData.height * 1.5;
                const liquid = new THREE.Mesh(partGeo.liquid, ghost ? toxicMat : toxicMat.clone());
                liquid.rotation.x = -Math.PI / 2;
                liquid.position.y = rim - 0.08;
                facing.add(liquid);
                parts.liquid = liquid;
                // The bridge with its yellow motor, a feed pipe up the side and over the rim
                // with a valve wheel: merged per material, one draw call each.
                const fixed = mixerFixed(rim);
                partMesh(fixed.dark, armMats.dark, facing, 0, 0, 0);
                partMesh(fixed.yellow, armMats.yellow, facing, 0, 0, 0);
                partMesh(fixed.steel, armMats.steel, facing, 0, 0, 0);
                const paddle = new THREE.Group();
                paddle.position.y = rim - 0.045;
                partMesh(partGeo.shaft, chromeMat, paddle, 0, 0.06, 0);
                partMesh(fixed.blades, armMats.steel, paddle, 0, 0, 0);
                facing.add(paddle);
                parts.paddle = paddle;
                if (!ghost) {
                    const halo = haloSprite(0x9be040, 0.9);
                    halo.position.y = rim + 0.05;
                    halo.material.opacity = 0;
                    facing.add(halo);
                    parts.toxicHalo = halo;
                    const surface = new THREE.Object3D();
                    surface.position.y = rim - 0.06;
                    facing.add(surface);
                    parts.vatTop = surface;
                }
                addArrow(facing, 'down', arrowMats.out, false, 0.02, 0.47);
                break;
            }
            case 'lab': {
                const body = assets.get('lab');
                facing.add(body);
                const dish = assets.get('dish');
                dish.position.set(0.05, body.userData.height - 0.04, -0.08);
                facing.add(dish);
                parts.dish = dish;
                break;
            }
            case 'generator': {
                const tower = assets.get('generator');
                facing.add(tower);
                const glow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20),
                    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false }));
                glow.rotation.x = -Math.PI / 2;
                glow.position.y = tower.userData.height - 0.02;
                facing.add(glow);
                parts.glow = glow;
                if (!ghost) {
                    const halo = haloSprite(0xffa040, 0.9);
                    halo.position.y = tower.userData.height + 0.05;
                    halo.material.opacity = 0;
                    facing.add(halo);
                    parts.halo = halo;
                    const top = new THREE.Object3D();
                    top.position.y = tower.userData.height;
                    facing.add(top);
                    parts.steamFrom = top;
                }
                break;
            }
            case 'sink': {
                // A drop zone, not a lighthouse: a short soft light cone, a bobbing chevron pointing
                // down at the pad, and a ring pulsing outward. Compact, so it never crosses the cannon.
                obj.add(assets.get('pad'));
                const beamMat = new THREE.MeshBasicMaterial({
                    color: BRAND_BLUE, alphaMap: beamTexture(), transparent: true, opacity: 0.35,
                    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
                });
                const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 1.05, 20, 1, true), beamMat);
                beam.position.y = PAD_TOP + 0.52;
                obj.add(beam);
                const chevron = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: dropChevronTexture(), color: BRAND_BLUE, transparent: true, depthWrite: false,
                }));
                chevron.scale.set(0.42, 0.42, 1);
                chevron.position.y = 1.3;
                chevron.renderOrder = 4;
                obj.add(chevron);
                parts.chevron = chevron;
                const ringMat = new THREE.MeshBasicMaterial({
                    color: BRAND_BLUE, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
                });
                const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 32), ringMat);
                ring.rotation.x = -Math.PI / 2;
                ring.position.y = PAD_TOP + 0.01;
                obj.add(ring);
                parts.beam = beam;
                parts.ring = ring;
                break;
            }
            default:
                break;
        }

        // Status cluster above processors: progress bar, tier dots, and a status
        // bubble when something is wrong (waiting, blocked, no power, off…).
        if (!ghost && (UPGRADABLE.has(m.type) || m.type === 'generator')) {
            const top = 1.05;
            const bg = new THREE.Sprite(barBgMat);
            bg.scale.set(0.5, 0.06, 1);
            bg.position.set(0, top, 0);
            const fill = new THREE.Sprite(barFillMat);
            fill.center.set(0, 0.5);
            fill.scale.set(0.001, 0.06, 1);
            fill.position.set(-0.25, top, 0);
            const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: STATUS_TEX.input, depthTest: false, transparent: true }));
            badge.scale.set(0.3, 0.3, 1);
            badge.position.set(0, top + 0.3, 0);
            for (const s of [bg, fill, badge]) {
                s.renderOrder = 10;
                s.visible = false;
                obj.add(s);
            }
            parts.bar = { bg, fill };
            parts.badge = badge;
            parts.tier = [];
            for (let i = 0; i < MAX_TIER; i++) {
                const d = new THREE.Sprite(tierMat);
                d.scale.set(0.08, 0.08, 1);
                d.position.set(-0.15 + i * 0.1, top + 0.1, 0);
                d.renderOrder = 10;
                d.visible = false;
                obj.add(d);
                parts.tier.push(d);
            }
        }

        obj.position.set(x + 0.5, 0, y + 0.5);
        return { obj, parts };
    }

    // Demolished views shrink and sink before they go.
    const dying = [];
    // Set on the first sync and after a load: build views without juice.
    let quiet = true;

    function removeView(key, animate) {
        const v = views.get(key);
        if (!v) return;
        views.delete(key);
        const [cx, cy] = key.split(',').map(Number);
        if (CONVEYORS.has(v.machine.type) && !grid[cx][cy].machine) env.coverCell(cx, cy, false);
        if (!animate) {
            machineLayer.remove(v.obj);
            return;
        }
        dying.push({ obj: v.obj, t: 0 });
        const small = CONVEYORS.has(v.machine.type);
        effects.puff(v.obj.position, { count: small ? 5 : 10, size: small ? 0.2 : 0.32, spread: small ? 0.3 : 0.5 });
        if (!small) rig.shake(0.12);
    }

    function syncMachines() {
        for (let x = 0; x < W; x++) {
            for (let y = 0; y < H; y++) {
                const key = `${x},${y}`;
                const m = grid[x][y].machine;
                if (!m) {
                    if (views.has(key)) removeView(key, !quiet);
                    continue;
                }
                const shape = m.type === 'belt' ? beltShape(x, y, m) : '';
                const sig = `${m.type}|${m.dir}|${shape}`;
                const v = views.get(key);
                if (v && v.sig === sig && v.machine === m) {
                    if (m.tier > v.tier) { // upgraded: sparkle + bounce
                        v.tier = m.tier;
                        v.pop = 0;
                        effects.sparkle(new THREE.Vector3(x + 0.5, 0.9, y + 0.5), { count: 18 });
                    }
                    continue;
                }
                const isNew = !v || v.machine !== m;
                if (v) removeView(key, false); // reshaped (corner) or replaced: swap silently
                const built = buildView(m, x, y, shape);
                machineLayer.add(built.obj);
                const view = { sig, machine: m, tier: m.tier, pop: null, smoke: 0, x, y, ...built };
                views.set(key, view);
                if (CONVEYORS.has(m.type)) {
                    env.coverCell(x, y, true);
                } else if (m.type !== 'sink') {
                    env.paveCell(x, y);
                    if (m.type === 'smelter' || m.type === 'foundry' || m.type === 'generator') env.scorch(x, y);
                    else if (m.type === 'mixer') env.scorch(x, y, 'toxic');
                }
                if (isNew && !quiet && m.type !== 'sink') {
                    view.pop = 0;
                    built.obj.scale.setScalar(0.01);
                    const small = CONVEYORS.has(m.type);
                    effects.puff(built.obj.position, { count: small ? 4 : 10, size: small ? 0.18 : 0.32, spread: small ? 0.25 : 0.5 });
                    if (!small) rig.shake(0.16); // the thud of something heavy set down
                }
                // An extractor sits over its ore: shrink the rock under the frame.
                const ore = oreViews.get(key);
                if (ore) ore.userData.rock.scale.setScalar(m.type === 'extractor' ? 0.75 : 1);
            }
        }
        // Restore ore rocks whose machine was removed.
        for (const [key, ore] of oreViews) {
            if (!views.has(key)) ore.userData.rock.scale.setScalar(1);
        }
        quiet = false;
    }

    // ---- Per-frame machine animation -----------------------------------------
    let animMs = 0;

    /** Sim milliseconds one operation takes at full power (the machine's tier and recipe). */
    function opMs(m) {
        const ticks = PROCESS_TICKS[m.type];
        if (!ticks) return TICK_MS;
        return ticks[Math.min(m.tier - 1, ticks.length - 1)] * (machineRecipe(m)?.time ?? 1) * TICK_MS;
    }

    function animateMachines(dtSim, dt) {
        const th = power.throttle;
        for (let i = dying.length - 1; i >= 0; i--) {
            const d = dying[i];
            d.t = Math.min(1, d.t + dt / 220);
            d.obj.scale.setScalar(1 - d.t);
            d.obj.position.y = -0.15 * d.t;
            if (d.t >= 1) {
                machineLayer.remove(d.obj);
                dying.splice(i, 1);
            }
        }
        for (const v of views.values()) {
            const m = v.machine;
            const p = v.parts;
            const frac = machineProgressFraction(m);
            const working = m.pendingOutput !== null || m.progress > 0;
            if (v.pop != null) {
                v.pop = Math.min(1, v.pop + dt / 280);
                v.obj.scale.setScalar(Math.max(0.01, easeOutBack(v.pop)));
                if (v.pop >= 1) {
                    v.obj.scale.setScalar(1);
                    v.pop = null;
                }
            }
            // What the machine is doing right now (drives the status bubble and the press).
            const status = p.bar ? machineStatus(v.x, v.y).code : null;
            const running = status === 'working' || status === 'slow';
            const thr = POWER_DRAW[m.type] ? th : 1;
            if (p.smokeFrom && working && dtSim > 0) {
                const style = SMOKE[m.type] ?? SMOKE.smelter;
                v.smoke += dtSim;
                if (v.smoke > style.every) {
                    v.smoke = 0;
                    effects.smoke(p.smokeFrom.getWorldPosition(new THREE.Vector3()), style);
                }
            }
            if (p.ram) {
                // Its own clock, one stroke per operation (progress only moves per tick): drop
                // fast onto the die, then lift slowly. Idle, it eases back up.
                const u = p.ram.userData;
                if (running) {
                    v.cycle = ((v.cycle ?? 0) + (dtSim * thr) / opMs(m)) % 1;
                    const c = v.cycle;
                    const d = c < 0.28 ? (c / 0.28) ** 2 : 1 - smooth((c - 0.28) / 0.72);
                    p.ram.position.y = u.up - (u.up - u.down) * d;
                } else {
                    v.cycle = 0;
                    p.ram.position.y += (u.up - p.ram.position.y) * Math.min(1, dt / 160);
                }
            }
            if (p.melt) {
                // Molten steel stays warm between pours and flares while it works.
                const flick = Math.sin(animMs / 90 + v.x * 3) * 0.12 + Math.sin(animMs / 37 + v.y) * 0.06;
                const heat = working ? 1.1 + 1.5 * thr * (0.5 + 0.5 * frac) : 0.45;
                p.melt.material.emissiveIntensity = heat + flick;
                if (p.meltHalo) p.meltHalo.material.opacity = working ? 0.4 + 0.35 * thr + flick : 0.12;
                if (working && thr > 0 && dtSim > 0) {
                    v.spark = (v.spark ?? 0) + dtSim * thr;
                    if (v.spark > 1500) {
                        v.spark = Math.random() * 500;
                        const at = p.melt.getWorldPosition(new THREE.Vector3());
                        effects.sparkle(at, { color: 0xffa040, count: 3, power: 0.75, size: 0.07 });
                    }
                }
            }
            if (p.liquid) {
                const wave = Math.sin(animMs / 230 + v.x * 2) * 0.2 + Math.sin(animMs / 97 + v.y) * 0.08;
                p.liquid.material.emissiveIntensity = working ? 0.6 + 0.35 * thr + wave : 0.3 + wave * 0.3;
                p.toxicHalo.material.opacity = working ? 0.2 + 0.12 * thr + wave * 0.2 : 0.06;
                if (working) p.paddle.rotation.y += dtSim * 0.005 * thr;
                if (working && dtSim > 0 && thr > 0) {
                    v.bubble = (v.bubble ?? 0) + dtSim * thr;
                    v.smoke += dtSim;
                    const top = p.vatTop.getWorldPosition(new THREE.Vector3());
                    if (v.bubble > 280) {
                        v.bubble = Math.random() * 120;
                        effects.bubble(top, { count: 1, spread: 0.24, color: 0xa8f03a });
                    }
                    if (v.smoke > 720) {
                        v.smoke = Math.random() * 200;
                        effects.smoke(top, { color: 0xa6b84a, size: 0.16, rise: 0.32, opacity: 0.32 });
                    }
                }
            }
            if (p.steamFrom && m.fuelTicks > 0 && dtSim > 0) {
                v.smoke += dtSim;
                if (v.smoke > 520) {
                    v.smoke = 0;
                    effects.smoke(p.steamFrom.getWorldPosition(new THREE.Vector3()), { color: 0xe8e6e2, size: 0.3, rise: 0.7, opacity: 0.45 });
                }
            }
            if (p.piston) p.piston.position.y = p.piston.userData.baseY - Math.sin(frac * Math.PI) * 0.09;
            if (p.cog && working) p.cog.rotation.y += dtSim * 0.004 * (POWER_DRAW[m.type] ? th : 1);
            if (p.arm) {
                // Swing from the inputs to the reader and back once per operation.
                const go = working && th > 0 ? Math.sin(frac * Math.PI) : 0;
                p.arm.base.rotation.y = -0.6 + go * 1.9;
                p.arm.shoulder.rotation.z = -0.55 - go * 0.3;
                p.arm.elbow.rotation.z = 1.7 + go * 0.35;
            }
            if (p.dish && working) p.dish.rotation.y += dtSim * 0.0012 * th;
            if (p.mouth) {
                const flicker = working ? 0.25 * Math.sin(animMs / 60 + v.obj.position.x) : 0;
                p.mouth.material.emissiveIntensity = working ? 0.6 + 2.2 * frac * th + flicker : 0.12;
                if (p.halo) p.halo.material.opacity = working ? 0.35 + 0.5 * frac * th + flicker * 0.4 : 0;
            }
            if (p.glow) {
                const lit = m.fuelTicks > 0;
                p.glow.material.opacity = lit ? 0.55 + 0.25 * Math.sin(animMs / 120 + v.obj.position.z) : 0;
                if (p.halo) p.halo.material.opacity = lit ? 0.45 + 0.2 * Math.sin(animMs / 150) : 0;
            }
            if (p.beam) {
                const pulse = (animMs % 1800) / 1800;
                p.beam.material.opacity = (0.3 + 0.12 * Math.sin(animMs / 400)) * (visualPhase() >= 3 ? 1 : 0.6); // subtle by day
                p.chevron.position.y = 1.28 + 0.09 * Math.sin(animMs / 330);
                p.ring.scale.setScalar(1 + pulse * 1.4);
                p.ring.material.opacity = 0.9 * (1 - pulse);
            }
            if (p.bar) {
                const show = frac > 0 && m.type !== 'generator';
                p.bar.bg.visible = p.bar.fill.visible = show;
                if (show) p.bar.fill.scale.x = 0.5 * frac;
                p.tier.forEach((d, i) => (d.visible = m.tier > 1 && i < m.tier));
                // Status bubble: nothing while it works; otherwise what's wrong.
                const code = statusShown ? status : 'working';
                const tex = STATUS_TEX[code];
                p.badge.visible = !!tex;
                if (tex) {
                    if (p.badge.material.map !== tex) {
                        p.badge.material.map = tex;
                        p.badge.material.needsUpdate = true;
                    }
                    const urgent = code === 'tripped' || code === 'blocked';
                    p.badge.material.opacity = urgent ? 0.6 + 0.4 * Math.sin(animMs / 150) : 0.95;
                    p.badge.position.y = 1.35 + 0.03 * Math.sin(animMs / 300 + v.x);
                }
            }
        }
        // Belt surfaces scroll one cell per tick (two with Express Belts).
        const cellsPerTick = research.unlocked.fastBelts ? 2 : 1;
        chevronMat.map.offset.y = -((animMs / TICK_MS) * cellsPerTick) % 1;
    }

    // The lighting eases toward the current phase's mood; the pad beacon
    // switches to NIHIL red at the reveal.
    const tmpC = new THREE.Color();
    const tmpV = new THREE.Vector3();
    let evilShown = null;
    function applyMood(dt, instant) {
        const freed = project.ending === 'hq' && !hqPending;
        const m = freed ? FREED : MOODS[Math.min(visualPhase(), MOODS.length - 1)];
        const k = instant ? 1 : 1 - Math.exp(-dt / 2200);
        hemi.color.lerp(tmpC.setHex(m.sky), k);
        hemi.groundColor.lerp(tmpC.setHex(m.ground), k);
        hemi.intensity += (m.hemi - hemi.intensity) * k;
        sun.color.lerp(tmpC.setHex(m.sun), k);
        sun.intensity += (m.sunI - sun.intensity) * k;
        sunDir.lerp(tmpV.set(...m.dir).normalize(), k).normalize();
        sun.position.copy(centre).addScaledVector(sunDir, 40);
        rimLight.color.lerp(tmpC.setHex(m.rim), k);
        rimLight.intensity += (m.rimI - rimLight.intensity) * k;
        renderer.toneMappingExposure += (m.exposure - renderer.toneMappingExposure) * k;
        scene.environmentIntensity += (m.env - scene.environmentIntensity) * k;

        const evil = visualPhase() >= 4 && !freed;
        if (evil === evilShown) return;
        evilShown = evil;
        for (const v of views.values()) {
            if (v.parts.beam) {
                v.parts.beam.material.color.setHex(evil ? BRAND_RED : BRAND_BLUE);
                v.parts.ring.material.color.setHex(evil ? BRAND_RED : BRAND_BLUE);
                v.parts.chevron.material.color.setHex(evil ? BRAND_RED : BRAND_BLUE);
            }
        }
    }

    // ---- Items -------------------------------------------------------------------------
    /** @type {Map<number, { obj: THREE.Object3D, anim: null | { from: THREE.Vector3, to: THREE.Vector3, t: number, dur: number } }>} */
    const items = new Map();

    function surfaceY(x, y) {
        const m = grid[x]?.[y]?.machine;
        if (!m) return 0.02;
        if (m.type === 'sink') return PAD_TOP;
        if (m.type === 'belt' || m.type === 'splitter' || m.type === 'merger') return BELT_TOP;
        return 0.3; // entering a machine: disappears inside its body
    }

    const posOf = (cell) => new THREE.Vector3(cell.x + 0.5, surfaceY(cell.x, cell.y), cell.y + 0.5);

    function ensureItem(item, cell) {
        let e = items.get(item.id);
        if (e) return e;
        const obj = createItemMesh(item.type);
        obj.position.copy(posOf(cell));
        itemLayer.add(obj);
        e = { obj, anim: null };
        items.set(item.id, e);
        return e;
    }

    function removeItem(id) {
        const e = items.get(id);
        if (!e) return;
        itemLayer.remove(e.obj);
        items.delete(id);
    }

    // Credits earned at the pad, shown as one floating "+N" every half second.
    let padCredits = 0;
    let lastFloat = 0;

    function applyEvents(events, tickDurationMs) {
        for (const ev of events) {
            if (ev.kind === 'spawn') {
                ensureItem(ev.item, ev.at);
            } else if (ev.kind === 'move') {
                const e = ensureItem(ev.item, ev.to);
                const to = posOf(ev.to);
                if (e.anim && e.anim.t === 0) {
                    e.anim.to = to; // second hop in one tick (Express Belts): extend
                } else {
                    e.anim = { from: posOf(ev.from), to, t: 0, dur: Math.max(1, tickDurationMs) };
                    e.obj.position.copy(e.anim.from);
                }
                const dx = ev.to.x - ev.from.x;
                const dy = ev.to.y - ev.from.y;
                e.obj.rotation.y = Math.atan2(dx, dy);
            } else if (ev.kind === 'consume') {
                removeItem(ev.item.id);
                // Consumed on the pad = delivered (the pad can't be demolished).
                if (ev.at.x === PAD_POS.x && ev.at.y === PAD_POS.y) padCredits += ev.paid ?? 0;
            }
        }
    }

    function tweenItems(dt) {
        for (const e of items.values()) {
            if (!e.anim) continue;
            e.anim.t += dt;
            const a = Math.min(1, e.anim.t / e.anim.dur);
            e.obj.position.lerpVectors(e.anim.from, e.anim.to, a);
            if (a >= 1) e.anim = null;
        }
    }

    function reset() {
        hqPending = false;
        for (const id of [...items.keys()]) removeItem(id);
        quiet = true; // the next sync rebuilds a loaded factory: no juice
        shownPhase = -1;
        shownHealed = -1;
        for (const p of orePops) p.g.scale.setScalar(1);
        orePops.length = 0;
    }

    // ---- Build overlay: cursor, ghost, focus markers ---------------------------------------
    const cursor = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.48, 0, -0.48), new THREE.Vector3(0.48, 0, -0.48),
            new THREE.Vector3(0.48, 0, 0.48), new THREE.Vector3(-0.48, 0, 0.48),
        ]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
    );
    cursor.position.y = 0.03;
    overlay.add(cursor);
    // The machine whose menu is open: a signal-orange frame that breathes.
    const selectBox = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.55, 0, -0.55), new THREE.Vector3(0.55, 0, -0.55),
            new THREE.Vector3(0.55, 0, 0.55), new THREE.Vector3(-0.55, 0, 0.55),
        ]),
        new THREE.LineBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.95, depthTest: false }),
    );
    selectBox.renderOrder = 32;
    selectBox.visible = false;
    overlay.add(selectBox);
    const tintBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.96, 0.7, 0.96),
        new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    tintBox.position.y = 0.35;
    overlay.add(tintBox);
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.45, depthWrite: false });
    const ghosts = new Map();
    let ghostShown = null;
    const ghostFx = { tool: null, dir: null, pop: 1, yaw: 0, wiggle: 0 };

    function ghostFor(tool, dir) {
        const key = `${tool}|${dir}`;
        if (!ghosts.has(key)) {
            const { obj } = buildView({ type: tool, dir, tier: 1, progress: 0, pendingOutput: null }, 0, 0, 'straight', true);
            obj.traverse((o) => {
                if (o.isMesh) {
                    o.material = ghostMat;
                    o.castShadow = false;
                    o.renderOrder = 5;
                }
            });
            obj.position.set(0, 0, 0);
            const wrap = new THREE.Group(); // animated (pop, turn, wiggle) without touching the view itself
            wrap.add(obj);
            ghosts.set(key, wrap);
        }
        return ghosts.get(key);
    }

    /** The build was refused: the ghost shakes its head. */
    function nudgeGhost() {
        ghostFx.wiggle = 1;
    }

    const focusGroup = new THREE.Group();
    overlay.add(focusGroup);
    const focusMat = new THREE.MeshBasicMaterial({
        color: 0x7dd3fc, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const focusGeo = new THREE.RingGeometry(0.44, 0.5, 40);
    let focusShown = null;
    let focusOre = -1; // the ore revision the rings were laid for (new ore can be a focus)

    function updateFocus(focus) {
        if (focus !== focusShown || focusOre !== oreShown) {
            focusShown = focus;
            focusOre = oreShown;
            focusGroup.clear();
            if (focus) {
                // Ring only the field nearest the pad: the tutorial's starter area.
                const cells = [];
                for (let x = 0; x < W; x++) {
                    for (let y = 0; y < H; y++) {
                        const c = grid[x][y];
                        const hit = focus === 'sink' ? c.machine?.type === 'sink' : c.resource === focus && !c.machine;
                        if (hit) cells.push({ x, y, d: Math.hypot(x - PAD_POS.x, y - PAD_POS.y) });
                    }
                }
                const nearest = Math.min(...cells.map((c) => c.d));
                for (const { x, y, d } of cells) {
                    if (d > nearest + 3) continue;
                    const ring = new THREE.Mesh(focusGeo, focusMat);
                    ring.rotation.x = -Math.PI / 2;
                    ring.position.set(x + 0.5, 0.05, y + 0.5);
                    focusGroup.add(ring);
                }
            }
        }
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
        focusMat.opacity = 0.35 + 0.55 * pulse;
        focusGroup.children.forEach((r) => r.scale.setScalar(1 + 0.08 * pulse));
    }

    function updateOverlay(state, dt) {
        const { hovered, tool, dir } = state;
        const on = hovered.x >= 0 && !state.cinematic;
        // Ghost juice: pop in on a tool change, turn from the old direction on R.
        if (tool !== ghostFx.tool) {
            ghostFx.tool = tool;
            ghostFx.pop = 0;
            ghostFx.yaw = 0;
        } else if (dir !== ghostFx.dir && ghostFx.dir) {
            ghostFx.yaw = (YAW[ghostFx.dir] ?? 0) - (YAW[dir] ?? 0);
            while (ghostFx.yaw > Math.PI) ghostFx.yaw -= Math.PI * 2;
            while (ghostFx.yaw < -Math.PI) ghostFx.yaw += Math.PI * 2;
        }
        ghostFx.dir = dir;
        ghostFx.pop = Math.min(1, ghostFx.pop + dt / 170);
        ghostFx.yaw *= Math.exp(-dt / 55);
        ghostFx.wiggle = Math.max(0, ghostFx.wiggle - dt / 320);
        const sel = state.selected;
        selectBox.visible = !!sel && !state.cinematic;
        if (selectBox.visible) {
            selectBox.position.set(sel.x + 0.5, 0.04, sel.y + 0.5);
            selectBox.scale.setScalar(1 + 0.04 * Math.sin(performance.now() / 260));
        }
        cursor.visible = on;
        tintBox.visible = false;
        if (ghostShown) ghostShown.visible = false;
        if (!on) return;
        const cx = hovered.x + 0.5;
        const cz = hovered.y + 0.5;
        cursor.position.set(cx, 0.03, cz);
        const pulse = state.lastBuildPulseMs > 0 ? 1 + 0.15 * (state.lastBuildPulseMs / 120) : 1;
        cursor.scale.setScalar(pulse);

        if (tool === 'select' || state.group) return; // the selection overlay takes over
        if (tool === 'erase') {
            tintBox.visible = !!grid[hovered.x][hovered.y].machine;
            tintBox.material.color.setHex(0xe74c3c);
            tintBox.position.set(cx, 0.35, cz);
        } else if (tool === 'upgrade') {
            tintBox.visible = !!grid[hovered.x][hovered.y].machine;
            tintBox.material.color.setHex(canUpgrade(hovered.x, hovered.y) ? 0xffd54a : 0x888888);
            tintBox.position.set(cx, 0.35, cz);
        } else {
            const ghost = ghostFor(tool, dir);
            if (!ghost.parent) overlay.add(ghost);
            ghost.visible = !grid[hovered.x][hovered.y].machine || tool === 'belt';
            const wig = Math.sin(ghostFx.wiggle * Math.PI * 6) * 0.09 * ghostFx.wiggle;
            ghost.position.set(cx + wig, 0.002, cz - wig);
            ghost.scale.setScalar(Math.max(0.01, easeOutBack(ghostFx.pop)));
            ghost.rotation.y = ghostFx.yaw;
            ghostMat.color.setHex(canBuildMachine(hovered.x, hovered.y, tool) ? 0x2ecc71 : 0xe74c3c);
            ghostShown = ghost;
        }
    }

    // ---- Selection: the drag rectangle, the selected machines, the group being carried ------
    const SEL_MAX = 1024;
    const selRect = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.14, depthWrite: false, depthTest: false }),
    );
    selRect.renderOrder = 28;
    selRect.visible = false;
    overlay.add(selRect);
    const selEdge = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5),
            new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5),
        ]),
        new THREE.LineBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.95, depthTest: false }),
    );
    selEdge.renderOrder = 29;
    selEdge.visible = false;
    overlay.add(selEdge);
    // A square frame on every selected machine (a 4-segment ring turned 45°).
    const selMarks = new THREE.InstancedMesh(
        new THREE.RingGeometry(0.58, 0.67, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
        SEL_MAX,
    );
    selMarks.count = 0;
    selMarks.renderOrder = 29;
    selMarks.frustumCulled = false;
    overlay.add(selMarks);
    const groupRoot = new THREE.Group();
    overlay.add(groupRoot);
    const groupOk = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.45, depthWrite: false });
    const groupBad = new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.5, depthWrite: false });
    let groupShape = '';
    let groupPlace = '';
    const markTmp = new THREE.Object3D();

    function updateSelection(state) {
        const live = !state.cinematic;
        // The rectangle being dragged.
        const d = live && state.selDrag;
        selRect.visible = selEdge.visible = !!d;
        if (d) {
            const x0 = Math.min(d.from.x, d.to.x);
            const y0 = Math.min(d.from.y, d.to.y);
            const w = Math.abs(d.to.x - d.from.x) + 1;
            const h = Math.abs(d.to.y - d.from.y) + 1;
            for (const o of [selRect, selEdge]) {
                o.position.set(x0 + w / 2, 0.05, y0 + h / 2);
                o.scale.set(w, 1, h);
            }
        }
        // Frames on the selected machines, breathing a little.
        const cells = live ? state.sel?.cells ?? [] : [];
        selMarks.count = Math.min(SEL_MAX, cells.length);
        const breathe = 1 + 0.03 * Math.sin(performance.now() / 260);
        for (let i = 0; i < selMarks.count; i++) {
            markTmp.position.set(cells[i].x + 0.5, 0.045, cells[i].y + 0.5);
            markTmp.scale.setScalar(breathe);
            markTmp.updateMatrix();
            selMarks.setMatrixAt(i, markTmp.matrix);
        }
        selMarks.instanceMatrix.needsUpdate = true;
        // The group being carried: ghost models at their landing cells, red where they don't fit.
        const plan = live && state.group?.plan;
        groupRoot.visible = !!plan;
        if (!plan) return;
        const shape = plan.moves.map((m) => `${m.type}:${m.dir}`).join('|');
        if (shape !== groupShape) {
            groupShape = shape;
            groupPlace = '';
            groupRoot.clear();
            for (const m of plan.moves) {
                const { obj } = buildView({ type: m.type, dir: m.dir, tier: 1, progress: 0, pendingOutput: null, buffer: {} }, 0, 0, 'straight', true);
                obj.traverse((o) => {
                    if (o.isMesh || o.isSprite) {
                        o.castShadow = false;
                        o.renderOrder = 5;
                        if (o.isMesh) o.material = groupOk;
                    }
                });
                groupRoot.add(obj);
            }
        }
        const place = `${plan.moves.map((m) => `${m.to.x},${m.to.y}`).join(';')}#${plan.bad.length}`;
        if (place !== groupPlace) {
            groupPlace = place;
            const bad = new Set(plan.bad.map((b) => `${b.x},${b.y}`));
            plan.moves.forEach((m, i) => {
                const obj = groupRoot.children[i];
                obj.position.set(m.to.x + 0.5, 0.002, m.to.y + 0.5);
                const mat = bad.has(`${m.to.x},${m.to.y}`) || !plan.ok ? groupBad : groupOk;
                obj.traverse((o) => {
                    if (o.isMesh) o.material = mat;
                });
            });
        }
    }

    // ---- Ports: where items go in (teal) and out (orange) -----------------------------------
    // Flat arrows at a machine's edges, drawn over the world like an overlay. Shown for
    // every machine while a build tool is held, always for the hovered machine and the
    // build ghost, and always (red, pulsing) for an output whose product is stuck. An
    // arrow is bright when something is hooked up to it and dim when not; an output and
    // the input next to it line up into a little chain across the shared edge.
    const PORT_MAX = 1200;
    const PORT_TOOLS = new Set(['belt', 'splitter', 'merger', 'extractor', 'smelter', 'press', 'foundry', 'assembler', 'fabricator', 'mixer', 'generator', 'lab']);
    const SIDE = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };
    const INWARD = { right: 'left', left: 'right', up: 'down', down: 'up' };
    const portArrowGeo = (() => {
        const sh = new THREE.Shape();
        sh.moveTo(-0.05, -0.11);
        sh.lineTo(0.05, -0.11);
        sh.lineTo(0.05, 0.0);
        sh.lineTo(0.12, 0.0);
        sh.lineTo(0, 0.13);
        sh.lineTo(-0.12, 0.0);
        sh.lineTo(-0.05, 0.0);
        sh.closePath();
        const g = new THREE.ShapeGeometry(sh);
        g.rotateX(-Math.PI / 2); // flat, pointing toward -z
        g.rotateY(Math.PI);      // pointing toward +z, the models' forward (so YAW applies)
        return g;
    })();
    const portMat = (color, opacity) => new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const PORT_STYLE = {
        inOn: portMat(0x3cc8b4, 0.95), inOff: portMat(0x3cc8b4, 0.4),
        outOn: portMat(0xff7a2a, 0.95), outOff: portMat(0xff7a2a, 0.42),
        blocked: portMat(0xff3b30, 1),
    };
    const portMeshes = {};
    for (const [k, mat] of Object.entries(PORT_STYLE)) {
        const im = new THREE.InstancedMesh(portArrowGeo, mat, PORT_MAX);
        im.count = 0;
        im.renderOrder = 31;
        im.frustumCulled = false;
        overlay.add(im);
        portMeshes[k] = im;
    }
    const portOutline = new THREE.InstancedMesh(portArrowGeo.clone().scale(1.55, 1, 1.55), portMat(0x0b1524, 0.55), PORT_MAX);
    portOutline.count = 0;
    portOutline.renderOrder = 30;
    portOutline.frustumCulled = false;
    overlay.add(portOutline);
    const portTmp = new THREE.Object3D();
    let portsAt = 0;
    let portsKey = '';

    function collectPorts(state) {
        const list = [];
        if (state.cinematic) return list;
        const { hovered, tool, dir } = state;
        const all = PORT_TOOLS.has(tool);
        const hx = hovered.x;
        const hy = hovered.y;
        for (let x = 0; x < W; x++) {
            for (let y = 0; y < H; y++) {
                const m = grid[x][y].machine;
                if (!m || m.type === 'belt') continue;
                const isHover = x === hx && y === hy;
                if (all || isHover) {
                    for (const p of machinePorts(x, y)) list.push({ x, y, ...p, scale: isHover ? 1.25 : 1 });
                } else if (m.pendingOutput) {
                    for (const p of machinePorts(x, y)) if (p.blocked) list.push({ x, y, ...p, scale: 1 });
                }
            }
        }
        // The build ghost shows the ports it would have, hooked up to what's already there.
        if (hx >= 0 && PORT_TOOLS.has(tool) && tool !== 'belt' && !grid[hx][hy].machine) {
            for (const p of machinePorts(hx, hy, tool, dir)) list.push({ x: hx, y: hy, ...p, scale: 1.15 });
        }
        return list;
    }

    function updatePorts(state, now) {
        PORT_STYLE.blocked.opacity = 0.55 + 0.45 * Math.sin(now / 160);
        const key = `${state.tool}|${state.dir}|${state.hovered.x},${state.hovered.y}|${state.cinematic ? 1 : 0}`;
        if (now - portsAt < 120 && key === portsKey) return;
        portsAt = now;
        portsKey = key;
        const counts = { inOn: 0, inOff: 0, outOn: 0, outOff: 0, blocked: 0 };
        let outlines = 0;
        for (const p of collectPorts(state)) {
            const style = p.blocked ? 'blocked' : `${p.kind}${p.connected ? 'On' : 'Off'}`;
            if (counts[style] >= PORT_MAX) continue;
            const [dx, dz] = SIDE[p.side];
            portTmp.position.set(p.x + 0.5 + dx * 0.38, 0.06, p.y + 0.5 + dz * 0.38);
            portTmp.rotation.set(0, YAW[p.kind === 'out' ? p.side : INWARD[p.side]], 0);
            portTmp.scale.setScalar(p.scale * (p.blocked ? 1.2 : 1));
            portTmp.updateMatrix();
            portMeshes[style].setMatrixAt(counts[style]++, portTmp.matrix);
            if (outlines < PORT_MAX) portOutline.setMatrixAt(outlines++, portTmp.matrix);
        }
        for (const [k, im] of Object.entries(portMeshes)) {
            im.count = counts[k];
            im.instanceMatrix.needsUpdate = true;
        }
        portOutline.count = outlines;
        portOutline.instanceMatrix.needsUpdate = true;
    }

    // ---- Picking + sizing --------------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    /** Grid cell under a client (page) coordinate, or null when off the grid. */
    function pickCell(clientX, clientY) {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, rig.camera);
        if (!raycaster.ray.intersectPlane(ground, hit)) return null;
        const x = Math.floor(hit.x);
        const y = Math.floor(hit.z);
        return x >= 0 && x < W && y >= 0 && y < H ? { x, y } : null;
    }

    let renderScale = 1; // the Graphics setting: a fraction of the screen's pixel ratio
    function resize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * renderScale);
        renderer.setSize(w, h);
        rig.resize(w, h);
    }
    new ResizeObserver(resize).observe(container);
    resize();

    // ---- Edit-tool props: small 3D scenes for the upgrade / demolish / rotate keys ---------
    // Built from the same models and flat-shaded materials as the world, so their pictures
    // match the machines'. Only ever rendered into icons.
    const propMat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, flatShading: true, ...opts });
    const PROP_FACE = Math.PI / 4; // the icon camera's azimuth: yaw a flat shape by this to face it
    function chevronGeo() {
        const sh = new THREE.Shape();
        sh.moveTo(-0.36, -0.06);
        sh.lineTo(0, 0.28);
        sh.lineTo(0.36, -0.06);
        sh.lineTo(0.36, -0.27);
        sh.lineTo(0, 0.07);
        sh.lineTo(-0.36, -0.27);
        sh.closePath();
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 1 });
        g.center();
        return g;
    }
    const TOOL_PROPS = {
        /** A machine with two gold chevrons rising out of it. */
        upgrade() {
            const g = new THREE.Group();
            const body = assets.get('assembler');
            body.scale.multiplyScalar(0.86);
            g.add(body);
            const top = new THREE.Box3().setFromObject(body).max.y;
            const gold = propMat(0xe0900a, { roughness: 0.45 });
            const geo = chevronGeo();
            for (const [i, y] of [[0, 0.22], [1, 0.47]]) {
                const c = new THREE.Mesh(geo, gold);
                c.position.set(0, top + y, 0);
                c.rotation.y = PROP_FACE - 0.62;
                c.scale.setScalar(0.78 - i * 0.08);
                c.castShadow = true;
                g.add(c);
            }
            return g;
        },
        /** A sledgehammer coming down on a crate that is already breaking up. */
        erase() {
            const g = new THREE.Group();
            const crate = assets.get('siteCrate');
            crate.scale.multiplyScalar(1.5);
            crate.rotation.set(0.1, 0.45, -0.12);
            g.add(crate);
            const crateTop = new THREE.Box3().setFromObject(crate).max.y;
            const rubble = propMat(0xc9a36a);
            const dark = propMat(0x8a6a42);
            for (const [x, y, z, s, m] of [
                [0.36, 0.05, 0.26, 0.1, rubble], [0.12, 0.04, 0.46, 0.08, dark], [-0.38, 0.04, 0.3, 0.09, rubble],
                [-0.42, 0.78, 0.2, 0.065, dark], [-0.22, 0.98, 0.34, 0.055, rubble], [0.3, 0.86, 0.42, 0.05, dark],
            ]) {
                const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), m);
                chunk.position.set(x, y, z);
                chunk.rotation.set(x * 7, z * 5, y * 3);
                g.add(chunk);
            }
            const hammer = new THREE.Group();
            const wood = propMat(0xb57c43);
            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.86, 8), wood);
            handle.position.y = 0.42;
            hammer.add(handle);
            const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.26, 8), propMat(0xe2483d));
            grip.position.y = 0.74;
            hammer.add(grip);
            const steel = propMat(0x5c6470, { roughness: 0.35, metalness: 0.35 });
            const face = propMat(0xaab2bc, { roughness: 0.3, metalness: 0.4 });
            const head = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8), steel);
            head.rotation.z = Math.PI / 2;
            hammer.add(head);
            for (const side of [-1, 1]) {
                const end = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.15, 0.07, 8), face);
                end.rotation.z = -side * Math.PI / 2;
                end.position.x = side * 0.28;
                hammer.add(end);
            }
            // In the picture plane: the head lands on the crate, the handle sweeps up to the right.
            const lean = new THREE.Group();
            lean.rotation.y = PROP_FACE;
            hammer.rotation.z = -0.72;
            hammer.scale.setScalar(1.15);
            hammer.position.set(0.12, crateTop + 0.12, 0);
            lean.add(hammer);
            g.add(lean);
            return g;
        },
        /** Three crates in a signal-orange selection frame (corner brackets). */
        select() {
            const g = new THREE.Group();
            for (const [x, z, s] of [[-0.3, 0.12, 1], [0.12, -0.25, 0.9], [0.2, 0.28, 1.05]]) {
                const crate = assets.get('siteCrateSmall');
                crate.scale.multiplyScalar(1.4 * s);
                crate.position.set(x, 0, z);
                crate.rotation.y = x * 2;
                g.add(crate);
            }
            const orange = propMat(0xff6a13, { roughness: 0.45, emissive: 0x5a1e00, emissiveIntensity: 0.4 });
            const arm = new THREE.BoxGeometry(0.34, 0.06, 0.07);
            const h = 0.7;
            for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                for (const along of ['x', 'z']) {
                    const b = new THREE.Mesh(arm, orange);
                    b.position.set(cx * h - (along === 'x' ? cx * 0.13 : 0), 0.03, cz * h - (along === 'z' ? cz * 0.13 : 0));
                    if (along === 'z') b.rotation.y = Math.PI / 2;
                    g.add(b);
                }
            }
            return g;
        },
        /** A belt with a curved arrow going round it, clockwise as R turns things. */
        rotate() {
            const g = new THREE.Group();
            const { obj } = buildView({ type: 'belt', dir: 'right', tier: 1, progress: 0, pendingOutput: null, buffer: {} }, 0, 0, 'straight', true);
            obj.scale.setScalar(0.9);
            g.add(obj);
            const r = 0.74;
            const y = 0.38;
            // Clockwise seen from above (grid right -> down), with the gap at the back.
            const a0 = -Math.PI * 0.95;
            const a1 = a0 + Math.PI * 1.45;
            class Arc extends THREE.Curve {
                getPoint(t, target = new THREE.Vector3()) {
                    const a = a0 + (a1 - a0) * t;
                    return target.set(Math.cos(a) * r, y, Math.sin(a) * r);
                }
            }
            const teal = propMat(0x3cc8b4, { roughness: 0.4, emissive: 0x0a3a34, emissiveIntensity: 0.4 });
            g.add(new THREE.Mesh(new THREE.TubeGeometry(new Arc(), 40, 0.085, 8, false), teal));
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.4, 10), teal);
            tip.position.set(Math.cos(a1) * r, y, Math.sin(a1) * r);
            tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(a1), 0, Math.cos(a1)));
            tip.position.addScaledVector(new THREE.Vector3(-Math.sin(a1), 0, Math.cos(a1)), 0.12);
            g.add(tip);
            const tail = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), teal);
            tail.position.set(Math.cos(a0) * r, y, Math.sin(a0) * r);
            g.add(tail);
            return g;
        },
    };

    // ---- Build-menu icons: the real machine views, photographed once -------------------------
    /**
     * PNG data URLs of each machine, posed as in the world (from the game's camera angle, output
     * toward the lower right) on a transparent background. Rendered by the main renderer into a
     * corner of its own canvas before the first frame and copied out in the same task, so there
     * is no second WebGL context and the look (tone mapping, colour space) is exactly the game's.
     * The belt carries some ore; the extractor stands on its crystal. {} on failure.
     */
    function renderIcons(types, size = 128) {
        const out = {};
        const canvasEl = renderer.domElement;
        const pr = renderer.getPixelRatio();
        const px = Math.round(size * pr);
        if (canvasEl.width < px || canvasEl.height < px) return out;
        const copy = document.createElement('canvas');
        copy.width = copy.height = size;
        const ctx2d = copy.getContext('2d');
        const iconScene = new THREE.Scene();
        iconScene.environment = scene.environment;
        iconScene.environmentIntensity = 0.6;
        iconScene.add(new THREE.HemisphereLight(0xfff4e0, 0x55607a, 1.5));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
        keyLight.position.set(-3, 6, 5);
        iconScene.add(keyLight);
        const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
        const elev = THREE.MathUtils.degToRad(34);
        const az = Math.PI / 4;
        const box = new THREE.Box3();
        const sphere = new THREE.Sphere();
        const clear = new THREE.Color();
        renderer.getClearColor(clear);
        const clearAlpha = renderer.getClearAlpha();
        const exposure = renderer.toneMappingExposure;
        renderer.toneMappingExposure = 1.05;
        renderer.setClearColor(0x000000, 0);
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, size, size);
        renderer.setScissor(0, 0, size, size);
        try {
            for (const type of types) {
                const holder = new THREE.Group();
                if (TOOL_PROPS[type]) {
                    holder.add(TOOL_PROPS[type]());
                } else {
                    const { obj } = buildView({ type, dir: 'right', tier: 1, progress: 0, pendingOutput: null, buffer: {} }, 0, 0, 'straight', true);
                    obj.position.set(0, 0, 0);
                    holder.add(obj);
                }
                if (type === 'extractor') {
                    const rock = oreTemplates.ironOre[0].clone();
                    rock.scale.multiplyScalar(0.75);
                    holder.add(rock);
                }
                if (type === 'belt') {
                    for (const [x, item] of [[-0.24, 'ironOre'], [0.18, 'copperOre']]) {
                        const it = createItemMesh(item);
                        it.position.set(x, BELT_TOP + 0.05, 0);
                        holder.add(it);
                    }
                }
                iconScene.add(holder);
                holder.updateMatrixWorld(true);
                box.setFromObject(holder).getBoundingSphere(sphere);
                cam.position.set(
                    sphere.center.x + Math.sin(az) * Math.cos(elev) * 20,
                    sphere.center.y + Math.sin(elev) * 20,
                    sphere.center.z + Math.cos(az) * Math.cos(elev) * 20,
                );
                cam.lookAt(sphere.center);
                if (TOOL_PROPS[type]) {
                    // Props are spindly (a hammer, an arc): frame their actual silhouette, not their
                    // bounding sphere, so they fill the key like the chunky machines do.
                    cam.updateMatrixWorld();
                    const v = new THREE.Vector3();
                    const lo = new THREE.Vector2(Infinity, Infinity);
                    const hi = new THREE.Vector2(-Infinity, -Infinity);
                    holder.traverse((o) => {
                        const pos = o.isMesh && o.geometry.attributes.position;
                        if (!pos) return;
                        for (let i = 0; i < pos.count; i++) {
                            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
                            lo.min(v);
                            hi.max(v);
                        }
                    });
                    const half = Math.max(hi.x - lo.x, hi.y - lo.y) * 0.5 * 1.1;
                    const cx = (lo.x + hi.x) / 2;
                    const cy = (lo.y + hi.y) / 2;
                    cam.left = cx - half;
                    cam.right = cx + half;
                    cam.top = cy + half;
                    cam.bottom = cy - half;
                } else {
                    const half = sphere.radius * 1.0; // the whole model fits, nothing touches the edge
                    cam.left = -half;
                    cam.right = half;
                    cam.top = half;
                    cam.bottom = -half;
                }
                cam.updateProjectionMatrix();
                renderer.clear();
                renderer.render(iconScene, cam);
                // GL's viewport origin is bottom-left: the icon sits in the canvas's bottom-left corner.
                ctx2d.clearRect(0, 0, size, size);
                ctx2d.drawImage(canvasEl, 0, canvasEl.height - px, px, px, 0, 0, size, size);
                out[type] = copy.toDataURL('image/png');
                iconScene.remove(holder);
            }
        } catch (err) {
            console.warn('build icons could not be rendered', err);
        } finally {
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, canvasEl.clientWidth, canvasEl.clientHeight);
            renderer.setClearColor(clear, clearAlpha);
            renderer.toneMappingExposure = exposure;
            renderer.clear();
        }
        return out;
    }
    const icons = renderIcons([
        'belt', 'extractor', 'smelter', 'press', 'foundry', 'assembler', 'splitter', 'merger', 'generator', 'lab', 'fabricator', 'mixer',
        'upgrade', 'erase', 'select', 'rotate',
    ]);

    // ---- Frame ---------------------------------------------------------------------------
    let shownPhase = -1;
    let shownPlot = -1;
    let shownHealed = -1;
    function draw(state, dt) {
        statusShown = !state.cinematic;
        const dtSim = state.paused ? 0 : dt * state.speed;
        animMs += dtSim;
        rig.update(dt);
        // Phase changes: one step forward animates; anything else (first
        // frame, loading a save) snaps.
        // (The world's phase: the campaign's in Story, fixed in Infinite; see grid.js visualPhase.)
        const phase = visualPhase();
        const instant = shownPhase < 0 || phase !== shownPhase + 1;
        if (phase !== shownPhase) {
            env.setPhase(phase, instant);
            cannon.setPhase(phase, instant);
            if (!instant) {
                rig.shake(0.45);
                rig.punch(0.06);
            }
        }
        // The fence follows the land you hold (bought with credits in Infinite).
        const plot = plotLevel();
        if (plot !== shownPlot || phase !== shownPhase) {
            env.setPlot(plot, shownPlot >= 0 && plot === shownPlot + 1 && !instant);
            shownPlot = plot;
        }
        cannonGroup.visible = hasCannon();
        env.setCannonSite(cannonGroup.visible);
        applyMood(dt, phase !== shownPhase && instant);
        shownPhase = phase;
        // The epilogue after the NIHIL HQ ending (epilogue.js): each goal done mends the valley.
        // One step forward animates (and the view glides there unless the player is mid-drag).
        const healed = project.epilogue?.stage ?? 0;
        if (healed !== shownHealed) {
            const step = shownHealed >= 0 && healed === shownHealed + 1;
            env.setEpilogue(healed, !step);
            const at = step ? env.epiloguePoint(healed) : null;
            if (step) rig.shake(0.3);
            if (at && !state.drag && !state.group && !state.cinematic) rig.focusOn(at.x, at.z);
            shownHealed = healed;
        }
        syncOre(!quiet);
        animateOre(dt);
        syncMachines();
        animateMachines(dtSim, dt);
        const wantRuin = project.ending === 'hq' && !hqPending;
        if (wantRuin !== hqRuinShown) {
            hqRuinShown = wantRuin;
            env.setHQRuined(wantRuin);
        }
        updateShots(dt);
        env.update(dt);
        cannon.update(dt, performance.now());
        effects.update(dt, rig.target, env.landPhase(), { width: W, height: H }); // ash and butterflies follow the land
        const now = performance.now();
        if (padCredits > 0 && now - lastFloat > 450) {
            lastFloat = now;
            if (padCredits >= 0.5) effects.floatText(new THREE.Vector3(PAD_POS.x + 0.5, 1.1, PAD_POS.y + 0.5), `+${Math.round(padCredits)}`);
            padCredits = 0;
        }
        updateOverlay(state, dt);
        updateSelection(state);
        updatePorts(state, now);
        focusGroup.visible = !state.cinematic;
        updateFocus(state.focus ?? null);
        renderer.render(scene, rig.camera);
    }

    /** Client (page) coordinates of a world point. */
    function toPage(p) {
        const v = p.clone().project(rig.camera);
        const r = renderer.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    }
    /** Client (page) coordinates of a cell's centre — for tests and tooltips. */
    function projectCell(x, y) {
        return toPage(new THREE.Vector3(x + 0.5, 0, y + 0.5));
    }

    // ---- The ending, in the world ------------------------------------------------------
    /** Is there world geometry (not sky) under this page point? */
    const skyRay = new THREE.Raycaster();
    function hitsWorld(p, targets) {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
        skyRay.setFromCamera(ndc, rig.camera);
        return skyRay.intersectObjects(targets, true).some((h) => h.object.isMesh);
    }

    /**
     * Cut to the cannon (default view direction) and set up the shot. In this
     * view the sky only shows beyond the far edge of the valley, so look for a
     * patch of clear sky in the upper part of the frame (raycasting against the
     * world) for the Moon; the HUD moves the CSS Moon there under the cut, and
     * the turret swivels to aim at it during the countdown. Zooms out until a
     * patch is found. `radius` is the Moon's in px, `top` the highest y it may
     * sit at (below the letterbox). Returns the Moon's page point, or null.
     */
    function frameCannon({ radius, top, target = 'moon' }) {
        const cx = CANNON_AREA.x + CANNON_AREA.w / 2;
        const cz = CANNON_AREA.y + CANNON_AREA.h / 2;
        if (target === 'hq') {
            // Seen from the south-west, so east (the HQ) is up and to the right of the cannon.
            hqPending = true;
            const hp = env.hqPoint();
            rig.snap({ x: (cx + hp.x) / 2, z: (cz + hp.z) / 2 + 1.5, zoom: 0.64, azimuth: -Math.PI / 4 });
            aimAtWorld(hp, false);
            return toPage(hp);
        }
        const r = renderer.domElement.getBoundingClientRect();
        const targets = scene.children.filter((o) => o !== overlay && o.name !== 'cannon' && !o.isLight);
        const clear = (p, rad) => {
            if (hitsWorld(p, targets)) return false;
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                if (hitsWorld({ x: p.x + Math.cos(a) * rad, y: p.y + Math.sin(a) * rad }, targets)) return false;
            }
            return true;
        };
        let zoom = 0.95;
        for (let attempt = 0; attempt < 6; attempt++, zoom *= 0.88) {
            rig.snap({ x: cx, z: cz, zoom });
            // The cannon's foot low and left of centre; the sky is up to the right.
            const foot = toPage(new THREE.Vector3(cx, 0, cz));
            rig.shiftPixels(r.left + r.width * 0.4 - foot.x, r.top + r.height * 0.74 - foot.y, r.height, { snap: true });
            const ideal = { x: r.left + r.width * 0.76, y: top + radius * 0.4 };
            const cands = [];
            const step = radius * 0.7;
            for (let y = top; y <= r.top + r.height * 0.55; y += step) {
                for (let x = r.left + r.width * 0.45; x <= r.right - radius * 2.2; x += step) {
                    cands.push({ x, y, d: Math.hypot(x - ideal.x, (y - ideal.y) * 1.6) });
                }
            }
            cands.sort((p, q) => p.d - q.d);
            for (const c of cands) {
                if (!clear(c, radius * 1.2)) continue;
                aimAt(c, false);
                return { x: c.x, y: c.y };
            }
        }
        return null; // no clear sky: the HUD keeps the Moon where it is
    }

    // ---- The other ending: NIHIL HQ ---------------------------------------------------------
    let hqPending = false;    // the HQ shot is under way: keep the tower standing, the night on
    let hqRuinShown = false;  // what the environment shows (standing / ruined)
    const shots = [];
    const flashes = [];

    /** While the player chooses the target: a calm look at the cannon. */
    function lookAtCannon() {
        rig.snap({ x: CANNON_AREA.x + CANNON_AREA.w / 2, z: CANNON_AREA.y + CANNON_AREA.h / 2, zoom: 0.8 });
    }

    /** Turn the turret so the barrel points (in plan) at the world point `p`. */
    function aimAtWorld(p, instant) {
        const pv = cannon.pivot();
        const want = Math.atan2(p.z - pv.z, p.x - pv.x);
        let best = 0;
        let bestErr = Infinity;
        for (let i = 0; i < 720; i++) {
            const y = (i / 720) * Math.PI * 2 - Math.PI;
            const d = cannon.directionAt(y);
            let err = Math.abs(Math.atan2(d.z, d.x) - want);
            if (err > Math.PI) err = Math.PI * 2 - err;
            if (err < bestErr) {
                bestErr = err;
                best = y;
            }
        }
        cannon.aim(best, instant);
    }

    /** A glowing shell on a ballistic arc with a smoke trail; `onHit` when it lands. */
    function launchShell(from, to, ms, onHit) {
        const obj = new THREE.Group();
        const glow = haloSprite(0xff8a2a, 1.3);
        const core = haloSprite(0xfff4d0, 0.45);
        obj.add(glow, core);
        obj.position.copy(from);
        scene.add(obj);
        shots.push({ obj, from: from.clone(), to: to.clone(), t: 0, ms, trail: 0, onHit, apex: 3 + from.distanceTo(to) * 0.18 });
    }
    function updateShots(dt) {
        for (let i = shots.length - 1; i >= 0; i--) {
            const sh = shots[i];
            sh.t += dt;
            const k = Math.min(1, sh.t / sh.ms);
            sh.obj.position.lerpVectors(sh.from, sh.to, k);
            sh.obj.position.y += 4 * k * (1 - k) * sh.apex;
            sh.trail += dt;
            if (sh.trail > 35) {
                sh.trail = 0;
                effects.smoke(sh.obj.position.clone(), { color: 0x8a8480, size: 0.22, rise: 0.15, opacity: 0.5 });
            }
            if (k >= 1) {
                scene.remove(sh.obj);
                shots.splice(i, 1);
                sh.onHit?.();
            }
        }
        for (let i = flashes.length - 1; i >= 0; i--) {
            const f = flashes[i];
            f.t += dt;
            const k = Math.min(1, f.t / f.ms);
            if (f.light) f.light.intensity = f.peak * (1 - k) * (1 - k);
            if (f.ring) {
                f.ring.scale.setScalar(0.5 + k * 9);
                f.ring.material.opacity = 0.85 * (1 - k);
            }
            if (k >= 1) {
                if (f.light) scene.remove(f.light);
                if (f.ring) scene.remove(f.ring);
                flashes.splice(i, 1);
            }
        }
    }
    /** The shell lands on NIHIL HQ: fireball, flash, shockwave, the tower comes down. */
    function hitHQ() {
        const p = env.hqPoint();
        effects.puff(p, { count: 44, size: 1.15, spread: 2.8, color: 0x5e5550 });
        effects.puff(p.clone().setY(0.6), { count: 30, size: 0.9, spread: 3.4, color: 0x9a8a78 });
        effects.sparkle(p, { count: 70 });
        const light = new THREE.PointLight(0xffb060, 0, 0, 2);
        light.position.copy(p).add(new THREE.Vector3(0, 1.5, 0));
        scene.add(light);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 48).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0xffd0a0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
        ring.position.set(p.x, 0.08, p.z);
        scene.add(ring);
        flashes.push({ light, peak: 900, ring, t: 0, ms: 1100 });
        rig.shake(1);
        rig.punch(0.08);
        hqPending = false;
        hqRuinShown = true;
        env.ruinHQ();
    }

    /** Swivel the turret so the barrel's on-screen line runs from its pivot through `p`. */
    function aimAt(p, instant) {
        const pv = cannon.pivot();
        const P = toPage(pv);
        const want = Math.atan2(p.y - P.y, p.x - P.x);
        let best = 0;
        let bestErr = Infinity;
        for (let i = 0; i < 720; i++) {
            const y = (i / 720) * Math.PI * 2 - Math.PI;
            const T = toPage(pv.clone().addScaledVector(cannon.directionAt(y), 3));
            let err = Math.abs(Math.atan2(T.y - P.y, T.x - P.x) - want);
            if (err > Math.PI) err = Math.PI * 2 - err;
            if (err < bestErr - 1e-6 || (Math.abs(err - bestErr) < 1e-3 && Math.abs(y) < Math.abs(best))) {
                bestErr = err;
                best = y;
            }
        }
        cannon.aim(best, instant);
    }

    /** Page coordinates of the barrel at `along` (1 = the muzzle), for the beam. */
    function muzzlePage(along = 1) {
        return toPage(cannon.muzzle(along).pos);
    }
    function chargeCannon(level) {
        cannon.charge(level);
        rig.shake(level * 0.05);
    }
    function fireCannon({ target = 'moon' } = {}) {
        cannon.fire();
        rig.shake(target === 'hq' ? 0.6 : 1);
        rig.punch(0.1);
        if (target === 'hq') launchShell(cannon.muzzle(1).pos, env.hqPoint(), HQ_FLIGHT_MS, hitHQ);
    }
    /** After the ending: ease back out to a wider view of the valley. */
    function releaseCinematic() {
        rig.zoomBy(0.8);
    }

    // ---- Settings (settings.js, applied by main.js) ---------------------------------------
    /** Graphics: shadows, render scale (0.5–1), particle density, camera shake. */
    function setGraphics({ shadows = true, renderScale: scale = 1, particles = 'high', shake = true } = {}) {
        if (renderer.shadowMap.enabled !== shadows) {
            renderer.shadowMap.enabled = shadows;
            sun.castShadow = shadows;
            // Materials compile with or without shadow code: rebuild them.
            scene.traverse((o) => {
                for (const mat of [o.material].flat()) if (mat) mat.needsUpdate = true;
            });
        }
        const s = Math.max(0.5, Math.min(1, Number(scale) || 1));
        if (s !== renderScale) {
            renderScale = s;
            resize();
        }
        effects.setDensity(particles === 'off' ? 0 : particles === 'low' ? 0.35 : 1);
        rig.setShakeScale(shake ? 1 : 0);
    }
    const PORT_COLORS = {
        normal: { in: 0x3cc8b4, out: 0xff7a2a, blocked: 0xff3b30 },
        // Okabe–Ito: sky blue in, orange out, reddish purple when blocked (apart for red-green blindness).
        colorblind: { in: 0x56b4e9, out: 0xe69f00, blocked: 0xcc79a7 },
    };
    /** Accessibility: a colour-blind-safe palette for the port arrows. */
    function setPortPalette(colorblind) {
        const c = PORT_COLORS[colorblind ? 'colorblind' : 'normal'];
        PORT_STYLE.inOn.color.setHex(c.in);
        PORT_STYLE.inOff.color.setHex(c.in);
        PORT_STYLE.outOn.color.setHex(c.out);
        PORT_STYLE.outOff.color.setHex(c.out);
        PORT_STYLE.blocked.color.setHex(c.blocked);
    }

    /** Floating text over a cell (e.g. a build's cost). */
    function floatAt(x, y, text, color) {
        effects.floatText(new THREE.Vector3(x + 0.5, 0.9, y + 0.5), text, color);
    }

    return {
        canvas: renderer.domElement, rig, applyEvents, tweenItems, draw, reset, pickCell, projectCell,
        /** The next machine sync is silent (a group moved: its machines slide over, no demolish/build juice). */
        quietNext: () => { quiet = true; },
        /** Build-menu icons: { [machineType]: PNG data URL } rendered from the real models. */
        icons,
        nudgeGhost, floatAt, frameCannon, muzzlePage, chargeCannon, fireCannon, releaseCinematic, lookAtCannon,
        setGraphics, setPortPalette,
        /** Render cost of the last frame (draw calls, triangles) — for profiling. */
        stats: () => ({ ...renderer.info.render }),
        /** Visual state worth keeping in a save: the concrete scars. */
        saveVisual: () => ({ paved: env.savePaved() }),
        loadVisual: (data) => env.loadPaved(data?.paved),
    };
}
