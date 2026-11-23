// src/assets.js — everything the 3D view is built from: the Kenney model
// manifest (CC0, see CREDITS.md), GLB loading + normalisation into reusable
// templates, per-material recolouring, shared nature materials (so the whole
// valley can change colour per campaign phase), and the procedural item
// meshes. Knows nothing about the simulation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = '/assets/kenney/';

/**
 * Model manifest. Every model is normalised on load: centred on x/z, standing
 * on y = 0, and uniformly scaled so either its larger footprint side equals
 * `fit` or its height equals `fitHeight` (world units; one grid cell = 1).
 * `yaw` corrects the model's native facing so that "forward" is +z. `tint`
 * recolours named materials. `nature: true` swaps Nature Kit materials for
 * the shared ones in NATURE_PALETTE (see natureMaterial()).
 */
const MANIFEST = {
    // Belts + routers (Factory Kit). Conveyors run along z natively; the
    // corner connects the -x and +z sides.
    belt: { file: 'factory/conveyor-stripe', fit: 1 },
    beltCorner: { file: 'factory/conveyor-stripe-corner', fit: 1 },
    router: { file: 'factory/conveyor-stripe-cross', fit: 1 },

    // Machines. Fronts face +z natively (= the output direction).
    extractorFrame: { file: 'factory/scanner-high', fit: 0.96 },
    extractorPiston: { file: 'factory/piston-thin-round', fit: 0.3 },
    smelter: { file: 'factory/machine-fortified', fit: 0.92 },
    chimney: { file: 'city/chimney-medium', fit: 0.22 },
    assembler: { file: 'factory/machine', fit: 0.9 },
    cog: { file: 'factory/cog-a', fit: 0.34 },
    lab: { file: 'factory/machine-window', fit: 0.9 },
    fabBed: { file: 'factory/machine-bed', fit: 0.92 },
    dish: { file: 'space/satelliteDish', fit: 0.42 },
    generator: { file: 'city/chimney-large', fit: 0.86 },
    pad: { file: 'space/platform_large', fit: 0.98 },
    // Press: chunky Factory Kit pistons squashed into a bed, two columns, a crown
    // and the ram; the die is a yellow floor plate. Unit size, scaled per part.
    pressBlock: { file: 'factory/piston-square', fit: 1 },
    pressColumn: { file: 'factory/piston-round', fit: 1 },
    pressDie: { file: 'factory/button-floor-square', fit: 0.52 },
    // Foundry: a soot-blackened machine with molten metal glowing in the hole on
    // its roof, and a tall brick-red smokestack.
    foundry: { file: 'factory/machine-connection-hole', fit: 0.92, tint: { colormap: 0x7c7684 } },
    foundryStack: { file: 'city/chimney-basic', fitHeight: 1.6, tint: { colormap: 0xb8735f } },
    // Mixer (NIHIL's): an open octagonal vat in gunmetal with an alarm-red rim.
    mixerVat: { file: 'space/rocket_fuelA', fit: 0.8, tint: { metalRed: 0xb3333b, metalDark: 0x3b424e } },

    // Ore nodes (Space Kit crystal rocks), recoloured per ore at build time.
    crystalsA: { file: 'space/rock_crystalsLargeA', fit: 0.82 },
    crystalsB: { file: 'space/rock_crystalsLargeB', fit: 0.82 },
    crystalsC: { file: 'space/rock_crystals', fit: 0.7 },

    // The cannon's launch deck (Space Kit); the turret itself is built in cannon.js.
    cannonDeck: { file: 'space/platform_large', fit: 2.7 },
    // Construction-site dressing around the cannon (Factory Kit).
    siteCone: { file: 'factory/cone', fit: 0.26 },
    siteCrate: { file: 'factory/box-large', fit: 0.46 },
    siteCrateSmall: { file: 'factory/box-small', fit: 0.28 },
    siteBeacon: { file: 'factory/warning-orange', fitHeight: 0.62 },
    siteCrane: { file: 'factory/crane', fitHeight: 1.55 },

    // NILE's compound (City Kit Industrial + Space Kit).
    buildingA: { file: 'city/building-a', fit: 2.6 },
    buildingC: { file: 'city/building-c', fit: 2.6 },
    buildingE: { file: 'city/building-e', fit: 2.6 },
    buildingH: { file: 'city/building-h', fit: 2.4 },
    buildingL: { file: 'city/building-l', fit: 2.6 },
    buildingM: { file: 'city/building-m', fit: 2.6 },
    coolingTower: { file: 'city/chimney-large', fit: 1.6 },
    tankLarge: { file: 'city/detail-tank-large', fit: 1.4 },
    tank: { file: 'city/detail-tank', fit: 1.1 },
    containerA: { file: 'city/shipping-container-a', fit: 1.5 },
    containerB: { file: 'city/shipping-container-b', fit: 1.5 },
    containerC: { file: 'city/shipping-container-c', fit: 1.5 },
    waterTower: { file: 'city/water-tower', fit: 1.2 },
    solar: { file: 'city/solar-panel-portrait', fit: 1.3 },
    hangar: { file: 'space/hangar_largeA', fit: 2.8 },
    dishLarge: { file: 'space/satelliteDish_large', fit: 1.6 },
    barrels: { file: 'space/barrels', fit: 0.8 },
    lamp: { file: 'factory/warning-orange', fitHeight: 1.15 },

    // The valley (Nature Kit). Trees come in normal / _fall / _dark.
    ...Object.fromEntries(['default', 'oak', 'detailed', 'tall', 'simple', 'cone', 'plateau'].flatMap((t) =>
        ['', '_fall', '_dark'].map((v) => [`tree_${t}${v}`, { file: `nature/tree_${t}${v}`, fitHeight: 1.5, nature: true }]))),
    stump_old: { file: 'nature/stump_old', fitHeight: 0.28, nature: true },
    stump_oldTall: { file: 'nature/stump_oldTall', fitHeight: 0.45, nature: true },
    stump_round: { file: 'nature/stump_round', fitHeight: 0.22, nature: true },
    stump_roundDetailed: { file: 'nature/stump_roundDetailed', fitHeight: 0.26, nature: true },
    bush: { file: 'nature/plant_bush', fitHeight: 0.4, nature: true },
    bushLarge: { file: 'nature/plant_bushLarge', fitHeight: 0.55, nature: true },
    bushDetailed: { file: 'nature/plant_bushDetailed', fitHeight: 0.45, nature: true },
    grass: { file: 'nature/grass', fitHeight: 0.16, nature: true },
    grassLarge: { file: 'nature/grass_large', fitHeight: 0.22, nature: true },
    grassLeafs: { file: 'nature/grass_leafsLarge', fitHeight: 0.18, nature: true },
    flowerRed: { file: 'nature/flower_redA', fitHeight: 0.24, nature: true },
    flowerYellow: { file: 'nature/flower_yellowA', fitHeight: 0.24, nature: true },
    flowerPurple: { file: 'nature/flower_purpleA', fitHeight: 0.24, nature: true },
    flowerRedB: { file: 'nature/flower_redB', fitHeight: 0.22, nature: true },
    flowerYellowB: { file: 'nature/flower_yellowB', fitHeight: 0.22, nature: true },
    mushrooms: { file: 'nature/mushroom_redGroup', fitHeight: 0.2, nature: true },
    mushroomsTan: { file: 'nature/mushroom_tanGroup', fitHeight: 0.2, nature: true },
    cropCarrot: { file: 'nature/crop_carrot', fitHeight: 0.28, nature: true },
    cropPumpkin: { file: 'nature/crop_pumpkin', fit: 0.42, nature: true },
    cropMelon: { file: 'nature/crop_melon', fit: 0.4, nature: true },
    wheat: { file: 'nature/crops_wheatStageB', fitHeight: 0.42, nature: true },
    dirtRow: { file: 'nature/crops_dirtRow', fit: 1, nature: true },
    fence: { file: 'nature/fence_simple', fit: 1, nature: true },
    tent: { file: 'nature/tent_detailedOpen', fit: 1.3, nature: true },
    tentSmall: { file: 'nature/tent_smallClosed', fit: 1.0, nature: true },
    campfire: { file: 'nature/campfire_logs', fit: 0.55, nature: true },
    log: { file: 'nature/log', fit: 0.7, nature: true },
    logStack: { file: 'nature/log_stack', fit: 0.8, nature: true },
    lily: { file: 'nature/lily_large', fit: 0.42, nature: true },
    lilySmall: { file: 'nature/lily_small', fit: 0.3, nature: true },
    sign: { file: 'nature/sign', fitHeight: 0.7, nature: true },
    cliff: { file: 'nature/cliff_block_rock', fit: 1, nature: true },
    stoneA: { file: 'nature/stone_largeA', fit: 0.8, nature: true },
    stoneB: { file: 'nature/stone_largeC', fit: 0.8, nature: true },
    stoneSmall: { file: 'nature/stone_smallC', fit: 0.35, nature: true },
};

/** Ore node looks: rock body + crystal colour (crystals glow faintly at night). */
export const ORE_TINT = {
    ironOre: { rock: 0x7d828e, rockTrack: 0x6c717d, crystal: 0xd6e4ff, glow: 0x4a6cff },
    copperOre: { rock: 0x8a5d44, rockTrack: 0x7a5038, crystal: 0xff8a3d, glow: 0xff5a10 },
    coalOre: { rock: 0x4a4b54, rockTrack: 0x3e3f47, crystal: 0x23242b, glow: 0x101830 },
    sulfurOre: { rock: 0xcdb558, rockTrack: 0xb89f48, crystal: 0xf8f04a, glow: 0xd8d000 },
};

/**
 * Shared Nature Kit materials, by material name. Every nature model uses
 * these instances, so recolouring one (e.g. `grass` drying out per phase)
 * recolours the whole valley at once. Colours are warmer than the kit's teal
 * defaults for a cosy start.
 */
export const NATURE_PALETTE = {
    grass: 0x74bf4c,
    leafsGreen: 0x5aae46,
    leafsFall: 0xe8893a,
    leafsDark: 0x3d5c4a,
    woodBark: 0x8a5a3c,
    woodBarkDark: 0x5c3f33,
    woodBirch: 0xe9dfcf,
    woodInner: 0xe6c9a0,
    wood: 0xb57b4f,
    woodDark: 0x7c5136,
    dirt: 0x8b6243,
    dirtDark: 0x6b4a33,
    stone: 0x8e8b96,
    colorRed: 0xd9474f,
    colorYellow: 0xf2b84b,
    colorPurple: 0x9b6fd6,
};
const natureMats = new Map();

/** The shared material for a Nature Kit material name (null if not shared). */
export function natureMaterial(name) {
    if (!(name in NATURE_PALETTE)) return null;
    if (!natureMats.has(name)) {
        natureMats.set(name, new THREE.MeshStandardMaterial({
            name, color: NATURE_PALETTE[name], roughness: 0.85, metalness: 0, flatShading: true,
        }));
    }
    return natureMats.get(name);
}

function shareNatureMaterials(root) {
    root.traverse((o) => {
        if (!o.isMesh) return;
        const swap = (m) => natureMaterial(m.name) ?? m;
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
}

/** Recolour named materials on a template (clones those materials once). */
export function tintTemplate(root, tints, emissive = {}) {
    const cache = new Map();
    root.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const next = mats.map((m) => {
            if (!(m.name in tints)) return m;
            if (!cache.has(m)) {
                const c = m.clone();
                c.color = new THREE.Color(tints[m.name]);
                if (emissive[m.name]) {
                    c.emissive = new THREE.Color(emissive[m.name]);
                    c.emissiveIntensity = 0.6;
                }
                cache.set(m, c);
            }
            return cache.get(m);
        });
        o.material = Array.isArray(o.material) ? next : next[0];
    });
    return root;
}

function normalise(scene, def) {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const k = def.fitHeight ? def.fitHeight / size.y : def.fit / Math.max(size.x, size.z);
    scene.scale.setScalar(k);
    scene.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
    const wrap = new THREE.Group();
    wrap.add(scene);
    wrap.userData.height = size.y * k;
    wrap.userData.width = size.x * k;
    wrap.userData.depth = size.z * k;
    scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) fixMaterial(m);
    });
    return wrap;
}

// glTF defaults metallicFactor to 1, and the flat-colour kits (Space, Nature)
// don't set it, so their rock and plastic would render as dark mirrors.
// Only materials literally named "metal…" keep a little sheen.
const fixed = new WeakSet();
function fixMaterial(m) {
    if (!m || fixed.has(m) || !('metalness' in m)) return;
    fixed.add(m);
    if (m.metalness >= 0.99 && !m.metalnessMap) {
        m.metalness = /metal/i.test(m.name) ? 0.3 : 0;
        m.roughness = Math.max(m.roughness, 0.6);
    }
}

/**
 * Load every model in the manifest. Resolves to `{ get(key), has(key), templates }`,
 * where get() returns a fresh clone (geometry + materials shared).
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function loadAssets(onProgress) {
    const loader = new GLTFLoader();
    const entries = Object.entries(MANIFEST);
    let done = 0;
    const templates = {};
    await Promise.all(entries.map(async ([key, def]) => {
        const gltf = await loader.loadAsync(`${BASE}${def.file}.glb`);
        const t = normalise(gltf.scene, def);
        if (def.yaw) t.rotation.y = def.yaw;
        if (def.nature) shareNatureMaterials(t);
        if (def.tint) tintTemplate(t, def.tint);
        templates[key] = t;
        onProgress?.(++done, entries.length);
    }));
    return {
        templates,
        has: (key) => key in templates,
        get(key) {
            const t = templates[key];
            if (!t) throw new Error(`unknown model ${key}`);
            const c = t.clone();
            c.userData = { ...t.userData };
            return c;
        },
    };
}

// ---- Procedural item meshes ------------------------------------------------
// Items are small and numerous, so they're simple shared-geometry meshes
// (multi-part pieces of one material merged into one geometry) with a clear
// silhouette per family: ore chunks, ingot bars, pressed plates, wire coils,
// I-beams, circuit boards, capacitor cans, motors, dynamite, the Selene shell,
// data cartridges.

function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...opts });
}

const G = {
    chunk: new THREE.IcosahedronGeometry(0.12, 0),
    bar: (() => {
        const g = new THREE.BoxGeometry(0.3, 0.09, 0.15);
        g.translate(0, 0.045, 0);
        return g;
    })(),
    board: (() => {
        const g = new THREE.BoxGeometry(0.26, 0.035, 0.26);
        g.translate(0, 0.0175, 0);
        return g;
    })(),
    chip: (() => {
        const g = new THREE.BoxGeometry(0.11, 0.035, 0.11);
        g.translate(0, 0.05, 0);
        return g;
    })(),
    flask: (() => {
        const g = new THREE.SphereGeometry(0.1, 14, 10);
        g.translate(0, 0.1, 0);
        return g;
    })(),
    neck: (() => {
        const g = new THREE.CylinderGeometry(0.035, 0.04, 0.09, 10);
        g.translate(0, 0.22, 0);
        return g;
    })(),
    cartridge: (() => {
        const g = new THREE.BoxGeometry(0.24, 0.07, 0.17);
        g.translate(0, 0.035, 0);
        return g;
    })(),
    label: (() => {
        const g = new THREE.BoxGeometry(0.14, 0.012, 0.12);
        g.translate(-0.02, 0.076, 0);
        return g;
    })(),
    led: (() => {
        const g = new THREE.BoxGeometry(0.03, 0.02, 0.13);
        g.translate(0.095, 0.075, 0);
        return g;
    })(),
    // Two pressed plates, the top one turned a little.
    plates: merge([
        box(0.26, 0.026, 0.22, 0, 0.013, 0),
        box(0.26, 0.026, 0.22, 0.015, 0.04, -0.01, 0.28),
    ]),
    // A coil of wire on a dark spool core.
    coil: merge([0.03, 0.075, 0.12].map((y) => {
        const t = new THREE.TorusGeometry(0.074, 0.03, 6, 14);
        t.rotateX(Math.PI / 2);
        t.translate(0, y, 0);
        return t;
    })),
    spool: (() => {
        const g = new THREE.CylinderGeometry(0.046, 0.046, 0.17, 10);
        g.translate(0, 0.085, 0);
        return g;
    })(),
    // A short I-beam along x.
    beam: (() => {
        const s = new THREE.Shape();
        const w = 0.075;  // flange half-width
        const h = 0.065;  // half-height
        const f = 0.022;  // flange thickness
        const t = 0.02;   // web half-thickness
        s.moveTo(-w, -h);
        s.lineTo(w, -h);
        s.lineTo(w, -h + f);
        s.lineTo(t, -h + f);
        s.lineTo(t, h - f);
        s.lineTo(w, h - f);
        s.lineTo(w, h);
        s.lineTo(-w, h);
        s.lineTo(-w, h - f);
        s.lineTo(-t, h - f);
        s.lineTo(-t, -h + f);
        s.lineTo(-w, -h + f);
        s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
        g.translate(0, 0, -0.15);
        g.rotateY(Math.PI / 2); // run along x, the shape in the y/z plane
        g.translate(0, h, 0);
        return g;
    })(),
    // Capacitor: a can with a glowing band and a scored silver top.
    can: (() => {
        const g = new THREE.CylinderGeometry(0.08, 0.08, 0.19, 14);
        g.translate(0, 0.095, 0);
        return g;
    })(),
    canTop: (() => {
        const g = new THREE.CylinderGeometry(0.073, 0.073, 0.014, 14);
        g.translate(0, 0.196, 0);
        return g;
    })(),
    canBand: (() => {
        const g = new THREE.CylinderGeometry(0.085, 0.085, 0.035, 14);
        g.translate(0, 0.12, 0);
        return g;
    })(),
    // Motor: a painted can on its side, dark end caps and foot, a silver shaft.
    motorBody: (() => {
        const g = new THREE.CylinderGeometry(0.085, 0.085, 0.19, 12);
        g.rotateZ(Math.PI / 2);
        g.translate(0, 0.105, 0);
        return g;
    })(),
    motorCaps: merge([
        ...[-0.105, 0.105].map((x) => {
            const g = new THREE.CylinderGeometry(0.07, 0.078, 0.028, 12);
            g.rotateZ(Math.PI / 2);
            g.translate(x, 0.105, 0);
            return g;
        }),
        box(0.16, 0.03, 0.15, 0, 0.015, 0),
    ]),
    motorShaft: (() => {
        const g = new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8);
        g.rotateZ(Math.PI / 2);
        g.translate(0.155, 0.105, 0);
        return g;
    })(),
    // Explosive: three sticks strapped together.
    sticks: merge([[-0.042, 0.04], [0.042, 0.04], [0, 0.11]].map(([z, y]) => {
        const g = new THREE.CylinderGeometry(0.04, 0.04, 0.26, 10);
        g.rotateZ(Math.PI / 2);
        g.translate(0, y, z);
        return g;
    })),
    strap: merge([-0.07, 0.07].map((x) => box(0.026, 0.17, 0.18, x, 0.076, 0))),
    // The Selene shell: a brass case, a driving band, a gunmetal ogive.
    shellCase: (() => {
        const g = new THREE.CylinderGeometry(0.075, 0.08, 0.19, 14);
        g.translate(0, 0.095, 0);
        return g;
    })(),
    shellBand: (() => {
        const g = new THREE.CylinderGeometry(0.083, 0.083, 0.03, 14);
        g.translate(0, 0.2, 0);
        return g;
    })(),
    shellNose: new THREE.LatheGeometry([
        [0.075, 0.215], [0.074, 0.25], [0.066, 0.285], [0.05, 0.315], [0.028, 0.34], [0.006, 0.352], [0, 0.353],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 14),
};

/** A box geometry with its centre at (x, y, z), optionally turned about y. */
function box(w, h, d, x, y, z, yaw = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (yaw) g.rotateY(yaw);
    g.translate(x, y, z);
    return g;
}

/** Merge same-material parts into one geometry (one draw call per item part). */
function merge(geos) {
    return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
}

const M = {
    ironOre: mat(0x8f97a6, { flatShading: true, roughness: 0.8 }),
    copperOre: mat(0xc0703a, { flatShading: true, roughness: 0.8 }),
    coalOre: mat(0x24262c, { flatShading: true, roughness: 0.5, metalness: 0.3 }),
    sulfurOre: mat(0xe8cf34, { flatShading: true, roughness: 0.75, emissive: 0x3a3000, emissiveIntensity: 0.35 }),
    ironPlate: mat(0xa9b4c6, { metalness: 0.75, roughness: 0.32 }),
    copperWire: mat(0xe8813a, { metalness: 0.8, roughness: 0.3 }),
    spool: mat(0x3a2f2a, { roughness: 0.6 }),
    steel: mat(0x66748a, { metalness: 0.8, roughness: 0.35 }),
    capCan: mat(0x1f3a66, { roughness: 0.45 }),
    capTop: mat(0xc9d0da, { metalness: 0.8, roughness: 0.3 }),
    capBand: mat(0x3fe0ff, { emissive: 0x2ad4ff, emissiveIntensity: 1.3 }),
    motorBody: mat(0xe8691e, { roughness: 0.45 }),
    motorDark: mat(0x2a3140, { roughness: 0.5 }),
    shaft: mat(0xd5dbe3, { metalness: 0.85, roughness: 0.25 }),
    explosive: mat(0xc9302c, { roughness: 0.55 }),
    strap: mat(0x22252b, { roughness: 0.6 }),
    shellCase: mat(0xd6a23a, { metalness: 0.8, roughness: 0.3 }),
    shellBand: mat(0xe2483d, { emissive: 0x8a1010, emissiveIntensity: 0.6, roughness: 0.4 }),
    shellNose: mat(0x4a5260, { metalness: 0.6, roughness: 0.35 }),
    ironIngot: mat(0xd9dee8, { metalness: 0.85, roughness: 0.3 }),
    copperIngot: mat(0xe58a45, { metalness: 0.85, roughness: 0.3 }),
    pcb: mat(0x1f8f45, { roughness: 0.5 }),
    pcbGold: mat(0xd9a43a, { metalness: 0.7, roughness: 0.35 }),
    chipDark: mat(0x1c1f26, { roughness: 0.4 }),
    chipGold: mat(0xf2c65a, { metalness: 0.8, roughness: 0.3, emissive: 0x4a3200, emissiveIntensity: 0.4 }),
    flask: mat(0xb07cf0, { emissive: 0x7a3cf0, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.92 }),
    glass: mat(0xdde6ff, { roughness: 0.1, transparent: true, opacity: 0.6 }),
    cartridge: mat(0x2a3140, { roughness: 0.45 }),
    label: mat(0xf2e8d5, { roughness: 0.7 }),
    led: mat(0x3cc8b4, { emissive: 0x3cc8b4, emissiveIntensity: 1.4 }),
};

/** A new mesh group for an item type, sitting on y = 0. */
export function createItemMesh(type) {
    const g = new THREE.Group();
    const add = (geo, m) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.castShadow = true;
        g.add(mesh);
        return mesh;
    };
    switch (type) {
        case 'ironOre':
        case 'copperOre':
        case 'coalOre':
        case 'sulfurOre': {
            const m = add(G.chunk, M[type]);
            m.position.y = 0.1;
            m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
            break;
        }
        case 'ironIngot':
        case 'copperIngot':
            add(G.bar, M[type]);
            break;
        case 'circuit':
            add(G.board, M.pcb);
            add(G.chip, M.pcbGold);
            break;
        case 'advancedCircuit':
            add(G.board, M.chipGold);
            add(G.chip, M.chipDark);
            break;
        case 'dataCartridge':
            add(G.cartridge, M.cartridge);
            add(G.label, M.label);
            add(G.led, M.led);
            break;
        case 'ironPlate':
            add(G.plates, M.ironPlate);
            break;
        case 'copperWire':
            add(G.spool, M.spool);
            add(G.coil, M.copperWire);
            break;
        case 'steel':
            add(G.beam, M.steel);
            break;
        case 'capacitor':
            add(G.can, M.capCan);
            add(G.canTop, M.capTop);
            add(G.canBand, M.capBand);
            break;
        case 'motor':
            add(G.motorBody, M.motorBody);
            add(G.motorCaps, M.motorDark);
            add(G.motorShaft, M.shaft);
            break;
        case 'explosive':
            add(G.sticks, M.explosive);
            add(G.strap, M.strap);
            break;
        case 'seleneShell':
            add(G.shellCase, M.shellCase);
            add(G.shellBand, M.shellBand);
            add(G.shellNose, M.shellNose);
            break;
        default:
            add(G.chunk, mat(0xffffff));
    }
    return g;
}
