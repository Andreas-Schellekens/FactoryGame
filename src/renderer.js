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
    GRID_WIDTH as W, GRID_HEIGHT as H, TICK_RATE, MAX_TIER, POWER_DRAW, PAD_POS, CANNON_AREA, SINK_VALUE,
} from './config.js';
import {
    grid, power, research, project, canBuildMachine, canUpgrade, machineProgressFraction, UPGRADABLE, cellHash, machinePorts,
} from './grid.js';
import { loadAssets, createItemMesh, tintTemplate, ORE_TINT } from './assets.js';
import { buildEnvironment } from './environment.js';
import { buildCannon } from './cannon.js';
import { createEffects, haloSprite } from './effects.js';
import { createCameraRig } from './camera.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

// Conveyors are laid by the hundred: they don't pave the grass (only real
// buildings leave concrete), they just hide the flowers under them.
const CONVEYORS = new Set(['belt', 'splitter', 'merger']);

const easeOutBack = (t) => {
    const c1 = 1.70158;
    const u = t - 1;
    return 1 + (c1 + 1) * u * u * u + c1 * u * u;
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
    const cannon = buildCannon(scene, assets, effects, CANNON_AREA);

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
    const tierMat = new THREE.SpriteMaterial({ map: dotTex, color: 0xffd54a, depthTest: false });
    const barBgMat = new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.55, transparent: true, depthTest: false });
    const barFillMat = new THREE.SpriteMaterial({ color: 0x6ee7b7, depthTest: false });
    const straightGeo = ribbon(STRAIGHT_PATH, 0.5);
    const cornerGeo = ribbon(CORNER_PATH, 0.5);
    const cornerRevGeo = ribbon([...CORNER_PATH].reverse(), 0.5);
    const arrowGeo = flatTriangle(0.2, 0.22);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x1a0800, emissive: 0xff7a18, emissiveIntensity: 1 });

    // ---- Ore nodes (static terrain) -------------------------------------------------
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
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const res = grid[x][y].resource;
            if (!res) continue;
            const g = new THREE.Group();
            g.position.set(x + 0.5, 0, y + 0.5);
            const variants = oreTemplates[res];
            const rock = variants[Math.floor(cellHash(x, y) * variants.length)].clone();
            rock.rotation.y = cellHash(y, x) * Math.PI * 2;
            g.add(rock);
            const stain = new THREE.Mesh(stainGeo, stainMats[res]);
            stain.rotation.x = -Math.PI / 2;
            stain.position.y = 0.004;
            g.add(stain);
            g.userData.rock = rock;
            oreLayer.add(g);
            oreViews.set(`${x},${y}`, g);
        }
    }

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

        // Status cluster above processors: progress bar, tier dots, power pip.
        if (!ghost && (UPGRADABLE.has(m.type) || m.type === 'generator')) {
            const top = 1.05;
            const bg = new THREE.Sprite(barBgMat);
            bg.scale.set(0.5, 0.06, 1);
            bg.position.set(0, top, 0);
            const fill = new THREE.Sprite(barFillMat);
            fill.center.set(0, 0.5);
            fill.scale.set(0.001, 0.06, 1);
            fill.position.set(-0.25, top, 0);
            const pip = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xe74c3c, depthTest: false }));
            pip.scale.set(0.14, 0.14, 1);
            pip.position.set(0.34, top, 0);
            for (const s of [bg, fill, pip]) {
                s.renderOrder = 10;
                s.visible = false;
                obj.add(s);
            }
            parts.bar = { bg, fill };
            parts.pip = pip;
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
                const view = { sig, machine: m, tier: m.tier, pop: null, smoke: 0, ...built };
                views.set(key, view);
                if (CONVEYORS.has(m.type)) {
                    env.coverCell(x, y, true);
                } else if (m.type !== 'sink') {
                    env.paveCell(x, y);
                    if (m.type === 'smelter' || m.type === 'generator') env.scorch(x, y);
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
            if (p.smokeFrom && working && dtSim > 0) {
                v.smoke += dtSim;
                if (v.smoke > 380) {
                    v.smoke = 0;
                    effects.smoke(p.smokeFrom.getWorldPosition(new THREE.Vector3()), { color: 0x7d7a80, size: 0.14 });
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
                p.beam.material.opacity = (0.3 + 0.12 * Math.sin(animMs / 400)) * (project.phase >= 3 ? 1 : 0.6); // subtle by day
                p.chevron.position.y = 1.28 + 0.09 * Math.sin(animMs / 330);
                p.ring.scale.setScalar(1 + pulse * 1.4);
                p.ring.material.opacity = 0.9 * (1 - pulse);
            }
            if (p.bar) {
                const show = frac > 0 && m.type !== 'generator';
                p.bar.bg.visible = p.bar.fill.visible = show;
                if (show) p.bar.fill.scale.x = 0.5 * frac;
                p.tier.forEach((d, i) => (d.visible = m.tier > 1 && i < m.tier));
                // Power pip: red when starved (or an empty generator), amber in a brownout.
                const starved = m.type === 'generator' ? m.fuelTicks <= 0 : POWER_DRAW[m.type] && working && th <= 0.02;
                const brown = POWER_DRAW[m.type] && working && th < 1 && th > 0.02;
                p.pip.visible = !!(starved || brown);
                if (p.pip.visible) {
                    p.pip.material.color.setHex(starved ? 0xe74c3c : 0xf0b64a);
                    p.pip.material.opacity = starved ? 0.55 + 0.45 * Math.sin(animMs / 160) : 1;
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
        const m = MOODS[Math.min(project.phase, MOODS.length - 1)];
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

        const evil = project.phase >= 4;
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
                if (ev.at.x === PAD_POS.x && ev.at.y === PAD_POS.y) padCredits += SINK_VALUE[ev.item.type] ?? 0;
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
        for (const id of [...items.keys()]) removeItem(id);
        quiet = true; // the next sync rebuilds a loaded factory: no juice
        shownPhase = -1;
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

    function updateFocus(focus) {
        if (focus !== focusShown) {
            focusShown = focus;
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
        cursor.visible = on;
        tintBox.visible = false;
        if (ghostShown) ghostShown.visible = false;
        if (!on) return;
        const cx = hovered.x + 0.5;
        const cz = hovered.y + 0.5;
        cursor.position.set(cx, 0.03, cz);
        const pulse = state.lastBuildPulseMs > 0 ? 1 + 0.15 * (state.lastBuildPulseMs / 120) : 1;
        cursor.scale.setScalar(pulse);

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

    // ---- Ports: where items go in (teal) and out (orange) -----------------------------------
    // Flat arrows at a machine's edges, drawn over the world like an overlay. Shown for
    // every machine while a build tool is held, always for the hovered machine and the
    // build ghost, and always (red, pulsing) for an output whose product is stuck. An
    // arrow is bright when something is hooked up to it and dim when not; an output and
    // the input next to it line up into a little chain across the shared edge.
    const PORT_MAX = 1200;
    const PORT_TOOLS = new Set(['belt', 'splitter', 'merger', 'extractor', 'smelter', 'assembler', 'generator', 'lab']);
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

    function resize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
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
    const icons = renderIcons(['belt', 'extractor', 'smelter', 'assembler', 'splitter', 'merger', 'generator', 'lab', 'upgrade', 'erase', 'rotate']);

    // ---- Frame ---------------------------------------------------------------------------
    let shownPhase = -1;
    function draw(state, dt) {
        const dtSim = state.paused ? 0 : dt * state.speed;
        animMs += dtSim;
        rig.update(dt);
        // Phase changes: one step forward animates; anything else (first
        // frame, loading a save) snaps.
        const phase = project.phase;
        const instant = shownPhase < 0 || phase !== shownPhase + 1;
        if (phase !== shownPhase) {
            env.setPhase(phase, instant);
            cannon.setPhase(phase, instant);
            if (!instant) {
                rig.shake(0.45);
                rig.punch(0.06);
            }
        }
        applyMood(dt, phase !== shownPhase && instant);
        shownPhase = phase;
        syncMachines();
        animateMachines(dtSim, dt);
        env.update(dt);
        cannon.update(dt, performance.now());
        effects.update(dt, rig.target, phase, { width: W, height: H });
        const now = performance.now();
        if (padCredits > 0 && now - lastFloat > 450) {
            lastFloat = now;
            effects.floatText(new THREE.Vector3(PAD_POS.x + 0.5, 1.1, PAD_POS.y + 0.5), `+${padCredits}`);
            padCredits = 0;
        }
        updateOverlay(state, dt);
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
    function frameCannon({ radius, top }) {
        const cx = CANNON_AREA.x + CANNON_AREA.w / 2;
        const cz = CANNON_AREA.y + CANNON_AREA.h / 2;
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
    function fireCannon() {
        cannon.fire();
        rig.shake(1);
        rig.punch(0.1);
    }
    /** After the ending: ease back out to a wider view of the valley. */
    function releaseCinematic() {
        rig.zoomBy(0.8);
    }

    /** Floating text over a cell (e.g. a build's cost). */
    function floatAt(x, y, text, color) {
        effects.floatText(new THREE.Vector3(x + 0.5, 0.9, y + 0.5), text, color);
    }

    return {
        canvas: renderer.domElement, rig, applyEvents, tweenItems, draw, reset, pickCell, projectCell,
        /** Build-menu icons: { [machineType]: PNG data URL } rendered from the real models. */
        icons,
        nudgeGhost, floatAt, frameCannon, muzzlePage, chargeCannon, fireCannon, releaseCinematic,
        /** Render cost of the last frame (draw calls, triangles) — for profiling. */
        stats: () => ({ ...renderer.info.render }),
        /** Visual state worth keeping in a save: the concrete scars. */
        saveVisual: () => ({ paved: env.savePaved() }),
        loadVisual: (data) => env.loadPaved(data?.paved),
    };
}
