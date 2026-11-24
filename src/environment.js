// src/environment.js — the valley the factory is built in, and how it decays.
// Phase 0 is a cosy meadow: green grass, forest, flowers, a farm, a river, the
// Steward's camp. Every completed phase darkens it (docs/DESIGN.md "Visual
// arc"): grass dries, trees turn autumn → dark → get felled one by one,
// flowers vanish, NILE's compound spreads in from the east. At the reveal
// NIHIL dams the river and its bed dries to cracked, sulfur-stained mud.
// Separately, the factory leaves its own scars: grass turns to concrete under
// everything the player builds (and stays paved), smelters and generators
// scorch the ground. NILE's survey fence marks the plot you lease (config.js
// PLOTS); the land outside it is dimmed and hatched until the plot grows.
// Purely visual; the sky and moon are CSS behind the canvas.
import * as THREE from 'three';
import { GRID_WIDTH as W, GRID_HEIGHT as H, PAD_POS, CANNON_AREA, ORE_FIELDS, PLOTS, RIVER } from './config.js';
import { grid, cellHash } from './grid.js';
import { natureMaterial } from './assets.js';
import { haloSprite } from './effects.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RIM = 6; // cells of landscape around the buildable area
// NILE's (later NIHIL's) headquarters: a tower on the east rim, level with the pad.
const HQ = { x: W + 3.6, z: PAD_POS.y + 0.5 };

// The land per phases completed (0..5): ground tint (multiplies the
// greyscale ground texture), shared nature material colours, river water.
const LAND = [
    { ground: 0x86cc5c, grass: 0x74bf4c, leafs: 0x5aae46, dirt: 0x8b6243, water: 0x48a9e0 },
    { ground: 0x8cc75e, grass: 0x7fbd4e, leafs: 0x64ac46, dirt: 0x8b6243, water: 0x46a0d8 },
    { ground: 0xb2bb5e, grass: 0xadb24e, leafs: 0x8ea63e, dirt: 0x8a6040, water: 0x3f8aa8 },
    { ground: 0x908b55, grass: 0x8c8648, leafs: 0x707a44, dirt: 0x74523a, water: 0x4a6a62 },
    { ground: 0x6f5d47, grass: 0x705e42, leafs: 0x5a5038, dirt: 0x5e4232, water: 0x62602a },
    { ground: 0x4d3c35, grass: 0x4f3f33, leafs: 0x3e3430, dirt: 0x4a3028, water: 0x4e4a22 },
];

const TREE_KINDS = ['default', 'oak', 'detailed', 'tall', 'simple', 'cone', 'plateau'];
const STUMPS = ['stump_old', 'stump_oldTall', 'stump_round', 'stump_roundDetailed'];

// ---- The river ---------------------------------------------------------------------
// Its whole course in world (= cell) coordinates: the sim's RIVER.path, carried
// on over the rim at both ends — out of a spring under a rock knoll on the west
// edge, and over the south cliff as a waterfall. The first and last added
// points continue the path's end segments, so rim and grid line up.
const COURSE = [[-5.3, 18.75], ...RIVER.path, [14.6, 26.8], [15.9, 29.0], [16.2, 30.2], [16.2, 31.0]];
const LIP_Z = H + RIM + 1;   // the south cliff's face (the cliff blocks span z 30..31)
const DAM_X = -2.75;         // NIHIL's dam, across the river on the west rim
const SULFUR_FIELDS = ORE_FIELDS.filter((f) => f.type === 'sulfurOre');
// The world rectangle the river's masks and textures cover.
const MASK = { x0: -8, z0: 15, x1: 20, z1: 34, px: 16 };

function distToCourse(px, pz) {
    let best = Infinity;
    for (let i = 0; i < COURSE.length - 1; i++) {
        const [ax, az] = COURSE[i];
        const [bx, bz] = COURSE[i + 1];
        const vx = bx - ax;
        const vz = bz - az;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
        best = Math.min(best, Math.hypot(px - (ax + vx * t), pz - (az + vz * t)));
    }
    return best;
}

/**
 * Is cell (x, z) river? Inside the grid the sim decides (`cell.river`); on the
 * rim the same rule runs along the extended course, so the bed keeps its
 * cell-by-cell shape all the way to the spring and the falls. Rows past the
 * lip copy the lip row, so the water doesn't round off before the edge.
 */
function riverCell(x, z) {
    if (x >= 0 && x < W && z >= 0 && z < H) return !!grid[x][z].river;
    if (x < -6 || x >= W + RIM || z < -RIM) return false;
    const zz = Math.min(z, H + RIM);
    return distToCourse(x + 0.5, zz + 0.5) <= RIVER.halfWidth + (cellHash(x, zz) - 0.5) * 0.35;
}
/** Keep rim scenery (trees, props) clear of the water and its banks. */
const nearRiver = (x, y) => distToCourse(x + 0.5, y + 0.5) < RIVER.halfWidth + 1.5;

// Small props don't cast shadows: they'd cost a draw call each for a few pixels.
const NO_SHADOW = /^(grass|flower|mushroom|lily|crop|wheat|stoneSmall)/;

const rimDist = (x, y) => Math.max(-1 - x, x - W, -1 - y, y - H);
const inPlateau = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
const inCompound = (x, y) => x >= W || (y < 0 && x >= Math.floor(W * 0.6));
const FARM = { x0: 1, x1: 7 }; // crop columns, south of the grid (west of where the river leaves it)
const inFarm = (x, y) => x >= FARM.x0 - 1 && x <= FARM.x1 + 1 && y >= H && y <= H + 3;
const inCamp = (x, y) => x >= -5 && x <= -1 && y >= 9 && y <= 14;
const ease = (t) => t * t * (3 - 2 * t);
const backOut = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

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

/** A tiny deterministic PRNG (mulberry32), so the decals look the same every load. */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Separable box blur, `passes` times (three passes ≈ a gaussian). */
function boxBlur(src, w, h, r, passes = 3) {
    const a = Float32Array.from(src);
    const b = new Float32Array(w * h);
    const n = 2 * r + 1;
    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < h; y++) {
            const row = y * w;
            let acc = 0;
            for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
            for (let x = 0; x < w; x++) {
                b[row + x] = acc / n;
                acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
            }
        }
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (let y = 0; y < h; y++) {
                a[y * w + x] = acc / n;
                acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
            }
        }
    }
    return a;
}

/**
 * The river's masks, one texel per 1/16 cell over MASK: red = the water (the
 * river cells, softened just enough to round their corners), green = the
 * banks (the same, blurred wide). The JS copy of the red channel places reeds.
 */
function riverMasks() {
    const w = (MASK.x1 - MASK.x0) * MASK.px;
    const h = (MASK.z1 - MASK.z0) * MASK.px;
    const cells = new Float32Array(w * h);
    for (let x = MASK.x0; x < MASK.x1; x++) {
        for (let z = MASK.z0; z < MASK.z1; z++) {
            if (!riverCell(x, z)) continue;
            for (let py = 0; py < MASK.px; py++) {
                const row = ((z - MASK.z0) * MASK.px + py) * w + (x - MASK.x0) * MASK.px;
                cells.fill(1, row, row + MASK.px);
            }
        }
    }
    const water = boxBlur(cells, w, h, 4);
    const bank = boxBlur(cells, w, h, 11);
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        data[i * 4] = Math.round(water[i] * 255);
        data[i * 4 + 1] = Math.round(bank[i] * 255);
        data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const sample = (wx, wz) => {
        const px = Math.floor((wx - MASK.x0) * MASK.px);
        const py = Math.floor((wz - MASK.z0) * MASK.px);
        if (px < 0 || py < 0 || px >= w || py >= h) return 0;
        return water[py * w + px];
    };
    return { tex, sample };
}

/**
 * The dried-out bed, over the same world rectangle as the masks: ochre mud
 * crazed into plates (a jittered Voronoi diagram, its borders the cracks with
 * a sunlit lip), and the sulfur stain soaking out of the two fields the dam
 * exposes. `pointAt(s)` walks the course for the stain's trail.
 */
function dryBedTexture(pointAt, sOf) {
    const PX = 24;
    const w = (MASK.x1 - MASK.x0) * PX;
    const h = (MASK.z1 - MASK.z0) * PX;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const r = prng(7);
    g.fillStyle = '#6f5a3a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,236,170,0.07)' : 'rgba(30,20,8,0.1)';
        g.fillRect(r() * w, r() * h, 2, 2);
    }
    const SP = 10; // seed spacing in px (≈ 0.42 world units)
    const gw = Math.ceil(w / SP) + 1;
    const gh = Math.ceil(h / SP) + 1;
    const seeds = new Float32Array(gw * gh * 2);
    for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
            seeds[(j * gw + i) * 2] = (i + 0.15 + r() * 0.7) * SP;
            seeds[(j * gw + i) * 2 + 1] = (j + 0.15 + r() * 0.7) * SP;
        }
    }
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
        const cj = Math.floor(y / SP);
        for (let x = 0; x < w; x++) {
            const ci = Math.floor(x / SP);
            let d1 = Infinity;
            let d2 = Infinity;
            let ny = 0;
            for (let j = cj - 1; j <= cj + 1; j++) {
                if (j < 0 || j >= gh) continue;
                for (let i = ci - 1; i <= ci + 1; i++) {
                    if (i < 0 || i >= gw) continue;
                    const sx = seeds[(j * gw + i) * 2];
                    const sy = seeds[(j * gw + i) * 2 + 1];
                    const q = (x - sx) ** 2 + (y - sy) ** 2;
                    if (q < d1) {
                        d2 = d1;
                        d1 = q;
                        ny = sy;
                    } else if (q < d2) d2 = q;
                }
            }
            // How far from the border of two plates (soft-edged, so it doesn't stair-step).
            const edge = Math.sqrt(d2) - Math.sqrt(d1);
            const k = (y * w + x) * 4;
            const crack = 1 - ease(clamp01((edge - 0.5) / 1.3));
            const lip = y < ny ? (1 - crack) * (1 - ease(clamp01((edge - 1.8) / 1.6))) : 0;
            const f = (1 - 0.68 * crack) * (1 + 0.16 * lip);
            d[k] = Math.min(255, d[k] * f);
            d[k + 1] = Math.min(255, d[k + 1] * f * (1 - 0.04 * crack));
            d[k + 2] = Math.min(255, d[k + 2] * f * (1 - 0.1 * crack));
        }
    }
    g.putImageData(img, 0, 0);
    // The sulfur: soaked round both fields and along the bed between them.
    const at = (wx, wz) => [(wx - MASK.x0) * PX, (wz - MASK.z0) * PX];
    const blob = (wx, wz, rad, alpha, rgb = '206,178,52') => {
        const [px, py] = at(wx, wz);
        const grad = g.createRadialGradient(px, py, 0, px, py, rad * PX);
        grad.addColorStop(0, `rgba(${rgb},${alpha})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grad;
        g.fillRect(px - rad * PX, py - rad * PX, rad * PX * 2, rad * PX * 2);
    };
    const fieldS = SULFUR_FIELDS.map((f) => sOf(f.x + 0.5, f.y + 0.5));
    const s0 = Math.min(...fieldS, 8) - 2.5;
    const s1 = Math.max(...fieldS, 14) + 3;
    for (let i = 0; i < 18; i++) {
        const p = pointAt(s0 + r() * (s1 - s0));
        blob(p.x + (r() - 0.5) * 1.6, p.z + (r() - 0.5) * 1.6, 0.5 + r() * 0.8, 0.08 + r() * 0.1);
    }
    for (const f of SULFUR_FIELDS) {
        for (let i = 0; i < 10; i++) {
            const a = r() * Math.PI * 2;
            const dd = r() * (f.r + 0.5);
            blob(f.x + 0.5 + Math.cos(a) * dd, f.y + 0.5 + Math.sin(a) * dd, 0.4 + r() * 0.7, 0.14 + r() * 0.14);
        }
        for (let i = 0; i < 160; i++) { // crystalline crust, in clumps round the field
            const a = r() * Math.PI * 2;
            const dd = Math.sqrt(r()) * (f.r + 1.2);
            const [px, py] = at(f.x + 0.5 + Math.cos(a) * dd, f.y + 0.5 + Math.sin(a) * dd);
            g.fillStyle = r() < 0.7 ? `rgba(236,212,84,${0.25 + r() * 0.35})` : `rgba(110,88,34,${0.25 + r() * 0.3})`;
            g.fillRect(px, py, 1 + r() * 3, 1 + r() * 2);
        }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // canvas row 0 is MASK.z0, like the mask texture
    tex.anisotropy = 4;
    return tex;
}

/** A face of NIHIL's dam: board-marked concrete, the alarm-red stripe, NIHIL's flat-line mark. */
function damFaceTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d');
    const r = prng(31);
    g.fillStyle = '#b9b3a7';
    g.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 2600; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(40,36,30,0.09)';
        g.fillRect(r() * 512, r() * 128, 2, 2);
    }
    g.fillStyle = 'rgba(60,55,48,0.35)';
    for (let x = 0; x < 512; x += 73) g.fillRect(x, 0, 2, 128);
    g.fillRect(0, 34, 512, 2);
    g.fillStyle = 'rgba(70,60,48,0.18)'; // water stain along the foot
    g.fillRect(0, 104, 512, 24);
    g.fillStyle = '#ff3b30';
    g.fillRect(0, 58, 512, 22);
    // NIHIL's mark: a flat line in a frame, on the stripe's left.
    g.fillStyle = '#1d222b';
    g.fillRect(40, 50, 38, 38);
    g.strokeStyle = '#ff3b30';
    g.lineWidth = 4;
    g.strokeRect(44, 54, 30, 30);
    g.beginPath();
    g.moveTo(50, 69);
    g.lineTo(68, 69);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** Hazard tape for the survey fence: NILE orange and paper stripes. */
function tapeTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#ff6a13';
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = '#f2e8d5';
    for (let x = -16; x < 144; x += 32) {
        g.beginPath();
        g.moveTo(x, 16);
        g.lineTo(x + 12, 0);
        g.lineTo(x + 24, 0);
        g.lineTo(x + 12, 16);
        g.closePath();
        g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** NILE's corner flag: the delta in a frame, paper on signal orange. */
function flagTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 84;
    const g = c.getContext('2d');
    g.fillStyle = '#ff6a13';
    g.fillRect(0, 0, 128, 84);
    g.fillStyle = '#c24a05';
    g.fillRect(0, 0, 8, 84);
    const s = 56 / 74;
    const ox = 64 - 28;
    const oy = 42 - 28;
    const P = (x, y) => [ox + x * s, oy + y * s];
    g.strokeStyle = '#f2e8d5';
    g.lineCap = 'square';
    g.lineWidth = 4;
    g.strokeRect(...P(2, 2), 70 * s, 70 * s);
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(...P(37, 14));
    g.lineTo(...P(37, 60));
    g.moveTo(...P(37, 14));
    g.bezierCurveTo(...P(37, 34), ...P(22, 46), ...P(16, 60));
    g.moveTo(...P(37, 14));
    g.bezierCurveTo(...P(37, 34), ...P(52, 46), ...P(58, 60));
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

// GLSL for the river's two layers. Both read the mask over MASK in world
// space; `vRiver` is (across, s = distance downstream, fall depth, soft edge).
const RIVER_COMMON = /* glsl */ `
    uniform float uTime;
    uniform float uFront;
    uniform float uFill;
    uniform float uDam;
    uniform sampler2D uMask;
    uniform sampler2D uDry;
    uniform vec4 uMaskBox;
    uniform vec3 uBankWet;
    uniform vec3 uBedWet;
    varying vec4 vRiver;
    varying vec2 vWorldXZ;
`;
// Water: the river cells, shallower and lighter at the edges with a foam
// line, dashes of light drifting downstream (fast down the falls). Once the
// dam is shut the water downstream of it runs off: everything upstream of
// uFront is gone, and it thins to a trickle over the last few units. When the
// epilogue opens the dam again it comes back from the dam down: everything
// upstream of uFill is water, its leading edge a thinning tongue.
const WATER_GLSL = /* glsl */ `
    vec4 mk = texture2D(uMask, (vWorldXZ - uMaskBox.xy) / uMaskBox.zw);
    float s = vRiver.y;
    float fall = vRiver.z;
    float level = s < uDam ? 1.0 : max(smoothstep(uFront, uFront + 3.0, s), 1.0 - smoothstep(uFill - 3.0, uFill, s));
    float thr = mix(1.04, 0.5, level) + sin(s * 2.7 + uTime * 1.4) * 0.012 + sin(vRiver.x * 6.0 - uTime) * 0.01;
    float m = mk.r;
    float wa = smoothstep(thr - 0.025, thr + 0.025, m);
    if (vRiver.w > 0.0) { // the spring's cascade: soft sides, fading in at the top
        wa *= 1.0 - smoothstep(vRiver.w - 0.18, vRiver.w, abs(vRiver.x));
        wa *= smoothstep(-0.74, -0.52, s);
    }
    wa *= 1.0 - smoothstep(1.5, 3.4, fall);
    if (wa < 0.01) discard;
    vec3 col = diffuseColor.rgb;
    float shallow = 1.0 - smoothstep(thr, thr + 0.34, m);
    col = mix(col, col * 1.3 + vec3(0.03, 0.05, 0.04), shallow * 0.7);
    if (fall > 0.0) col = mix(col, vec3(0.88, 0.95, 1.0), 0.2); // falling water is white with air
    // Streaks of light drifting downstream, one per lane, each lane its own pace.
    float lanes = vRiver.x * 4.0 + 0.5;
    float lane = floor(lanes);
    float hsh = fract(sin(lane * 91.7 + 3.1) * 43758.5453);
    float speed = fall > 0.0 ? 2.6 : 0.42 + 0.3 * hsh;
    float t = fract((s - uTime * speed) * (0.3 + 0.22 * hsh) + hsh);
    float dash = smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.08, 0.3, t));
    dash *= 1.0 - smoothstep(0.1, 0.32, abs(fract(lanes) - 0.5) * 2.0);
    dash *= step(0.25, hsh);
    col = mix(col, vec3(1.0), dash * (fall > 0.0 ? 0.5 : 0.28));
    float foam = smoothstep(thr, thr + 0.035, m) * (1.0 - smoothstep(thr + 0.05, thr + 0.13, m));
    col = mix(col, vec3(1.0), foam * 0.5 * level);
    diffuseColor.rgb = col;
    diffuseColor.a *= wa;
`;
// Bank + bed: wet earth round the water (soft into the grass) and dark mud
// under it; behind the draining water both dry to the cracked, stained bed.
const BED_GLSL = /* glsl */ `
    vec2 muv = (vWorldXZ - uMaskBox.xy) / uMaskBox.zw;
    vec4 mk = texture2D(uMask, muv);
    float s = vRiver.y;
    float bed = smoothstep(0.36, 0.62, mk.r);
    // A narrow band of wet earth hugging the water, and a faint damp halo beyond it.
    float bank = max(smoothstep(0.1, 0.4, mk.r) * 0.92, smoothstep(0.04, 0.6, mk.g) * 0.22);
    float dry = s < uDam ? 0.0 : (1.0 - smoothstep(uFront - 2.5, uFront + 0.5, s)) * smoothstep(uFill - 0.5, uFill + 2.5, s);
    float a = mix(bank, max(bank, smoothstep(0.12, 0.42, mk.r)), dry);
    if (a < 0.01) discard;
    vec3 dryCol = texture2D(uDry, muv).rgb * mix(1.06, 0.82, smoothstep(0.55, 1.0, mk.r));
    vec3 wetCol = mix(uBankWet, uBedWet, bed);
    diffuseColor.rgb = mix(wetCol, dryCol, dry);
    diffuseColor.a *= a;
`;

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

    // Gravel for the cannon's construction site (an Infinite valley has no cannon: plain ground).
    let cannonSite = null;
    function setCannonSite(on) {
        if (on === cannonSite) return;
        cannonSite = on;
        for (let x = CANNON_AREA.x; x < CANNON_AREA.x + CANNON_AREA.w; x++) {
            for (let y = CANNON_AREA.y; y < CANNON_AREA.y + CANNON_AREA.h; y++) {
                if (!on) {
                    if (!paved.has(`${x},${y}`)) pg.clearRect(x * PX, y * PX, PX, PX); // keep concrete already laid
                    continue;
                }
                pg.fillStyle = `hsl(30, 14%, ${40 + rand(x, y) * 6}%)`;
                pg.fillRect(x * PX, y * PX, PX, PX);
                for (let i = 0; i < 10; i++) {
                    pg.fillStyle = `rgba(0,0,0,${0.08 + rand(x + i, y) * 0.1})`;
                    pg.fillRect(x * PX + rand(i, x) * PX, y * PX + rand(y, i) * PX, 3, 3);
                }
            }
        }
        paveTex.needsUpdate = true;
    }
    setCannonSite(true);

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
    const SCORCH = { soot: '46,32,22', toxic: '150,168,40' }; // furnaces / the Mixer's spills
    function scorch(x, y, tone = 'soot') {
        const key = `${x},${y},${tone}`;
        if (scorched.has(key)) return;
        scorched.add(key);
        const cx = (x + 0.5) * PX;
        const cy = (y + 0.5) * PX;
        const rgb = SCORCH[tone] ?? SCORCH.soot;
        const grad = pg.createRadialGradient(cx, cy, PX * 0.3, cx, cy, PX * 1.9);
        grad.addColorStop(0, `rgba(${rgb},0.55)`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        pg.fillStyle = grad;
        pg.fillRect(cx - PX * 2, cy - PX * 2, PX * 4, PX * 4);
        paveTex.needsUpdate = true;
    }

    // ---- Cliffs around the valley ------------------------------------------------
    const cliffs = [];
    const cliffAt = (x, z, levels = [1, 2]) => {
        for (const level of levels) {
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
    // The spring's rock knoll on the west rim: a step of blocks the river wells out of.
    for (const [x, z, levels] of [
        [-7, 16, [0]], [-7, 17, [0, -1]], [-7, 18, [0, -1]], [-7, 19, [0, -1]], [-7, 20, [0]],
        [-6, 17, [0]], [-6, 18, [0]], [-6, 19, [0]],
    ]) cliffAt(x, z, levels);
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

    // The Steward's camp (west): where the hero sleeps. The fire goes out after the reveal.
    addProp('tent', -3.2, 10.6, 0, 5, { rot: Math.PI / 2 });
    addProp('tentSmall', -4.2, 13.4, 0, 5, { rot: Math.PI * 0.6 });
    const campfire = place('campfire', -2.2, 12.5);
    const fireHalo = haloSprite(0xffa040, 1.4);
    fireHalo.position.set(-2.2, 0.35, 12.5);
    root.add(fireHalo);
    addProp('log', -1.6, 13.2, 0, 5, { rot: 0.3 });
    addProp('log', -2.9, 12.1, 0, 5, { rot: 1.9 });
    addProp('logStack', -4.3, 11.6, 0, 5, { rot: 0.2 });

    // Farm (south, by the river): three crop rows behind a fence; crops die at dusk.
    const farmStatic = [];
    for (let x = FARM.x0; x <= FARM.x1; x++) {
        farmStatic.push(place('fence', x + 0.5, H + 0.15, { rot: 0 }));
        for (let r = 0; r < 3; r++) {
            const y = H + 1 + r;
            farmStatic.push(place('dirtRow', x + 0.5, y + 0.5, { rot: Math.PI / 2 }));
            const crop = ['cropCarrot', 'wheat', 'cropPumpkin'][r];
            addProp(crop, x + 0.5, y + 0.5, 0, 2, { rot: rand(x, y) * 6 });
        }
    }
    mergeStatic(farmStatic, { castShadow: true });

    // ---- The river -------------------------------------------------------------------
    // A ribbon of water along the course, cut to the river cells by the mask,
    // over a soft muddy bank; reeds and lilies along it; it wells out of the
    // knoll in the west and drops off the south cliff. At the reveal NIHIL
    // raises a dam on the west rim and everything downstream of it runs off
    // over a few seconds, leaving the cracked, sulfur-stained bed.
    const curve = new THREE.CatmullRomCurve3(COURSE.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const LEN = curve.getLength();
    const SEGS = Math.ceil(LEN / 0.2);
    const pts = curve.getSpacedPoints(SEGS);
    const tans = pts.map((_, i) => curve.getTangentAt(i / SEGS));
    const sAt = (i) => (i / SEGS) * LEN;
    /** Point + across-normal at distance s downstream. */
    const pointAt = (s) => {
        const u = clamp01(s / LEN);
        const p = curve.getPointAt(u);
        const t = curve.getTangentAt(u);
        return { x: p.x, z: p.z, nx: -t.z, nz: t.x };
    };
    /** Distance downstream of the course point nearest (x, z). */
    function sOf(x, z) {
        let best = Infinity;
        let bi = 0;
        pts.forEach((p, i) => {
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < best) {
                best = d;
                bi = i;
            }
        });
        return sAt(bi);
    }
    const S_DAM = sOf(DAM_X, 19.1);
    const S_LIP = LEN;
    const FALL_DEPTH = 3.8;
    const S_GONE = S_LIP + FALL_DEPTH + 3.5; // uFront past this: not a drop left

    const masks = riverMasks();
    const riverU = {
        uTime: { value: 0 },
        uFront: { value: -1e4 },
        uFill: { value: -1e4 },
        uDam: { value: S_DAM },
        uMask: { value: masks.tex },
        uDry: { value: dryBedTexture(pointAt, sOf) },
        uMaskBox: { value: new THREE.Vector4(MASK.x0, MASK.z0, MASK.x1 - MASK.x0, MASK.z1 - MASK.z0) },
        uBankWet: { value: new THREE.Color(0x6e5a3c) },
        uBedWet: { value: new THREE.Color(0x3d3322) },
    };
    function riverMaterial(kind, opts) {
        const m = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, ...opts });
        m.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, riverU);
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nattribute vec4 aRiver;\nvarying vec4 vRiver;\nvarying vec2 vWorldXZ;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiver = aRiver;\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', `#include <common>\n${RIVER_COMMON}`)
                .replace('#include <color_fragment>', `#include <color_fragment>\n${kind === 'water' ? WATER_GLSL : BED_GLSL}`);
        };
        m.customProgramCacheKey = () => `river-${kind}`;
        return m;
    }

    /** Geometry from quads: rows of [x, y, z, across, s, depth, edge] vertices, two per row. */
    function stripGeometry(rows, normal) {
        const pos = [];
        const nor = [];
        const riv = [];
        const idx = [];
        rows.forEach((row, i) => {
            for (const v of row) {
                pos.push(v[0], v[1], v[2]);
                nor.push(...normal);
                riv.push(v[3], v[4], v[5], v[6]);
            }
            if (i) {
                const k = (i - 1) * 2;
                idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('aRiver', new THREE.Float32BufferAttribute(riv, 4));
        g.setIndex(idx);
        return g;
    }
    /** A flat ribbon along the course, `hw` either side of it. */
    function courseRibbon(hw, y) {
        return stripGeometry(pts.map((p, i) => {
            const nx = -tans[i].z;
            const nz = tans[i].x;
            return [-hw, hw].map((a) => [p.x + nx * a, y, p.z + nz * a, a, sAt(i), 0, 0]);
        }), [0, 1, 0]);
    }
    // The falls: down the south cliff from the lip, leaning out a little, fading into spray.
    const lipP = pts[SEGS];
    const lipN = { x: -tans[SEGS].z, z: tans[SEGS].x };
    const fallRows = [];
    for (let k = 0; k <= 10; k++) {
        const depth = (k / 10) * FALL_DEPTH;
        const lean = 0.03 + Math.sqrt(depth) * 0.12;
        fallRows.push([-2.1, 2.1].map((a) => [lipP.x + lipN.x * a, 0.012 - depth, LIP_Z + lean, a, S_LIP + depth, depth, 0]));
    }
    // The spring: a short cascade down the knoll's face (x = -5) into the head of the river.
    const springZ = 18.85;
    const springRows = [];
    for (let k = 0; k <= 4; k++) {
        const y = 0.98 - (k / 4) * 0.97;
        springRows.push([-0.52, 0.52].map((a) => [-4.985, y, springZ + a, a, -0.7 + (k / 4) * 1.0, 0.4, 0.5]));
    }

    const bedMesh = new THREE.Mesh(courseRibbon(2.9, 0.005), riverMaterial('bed', { roughness: 1 }));
    bedMesh.receiveShadow = true;
    bedMesh.renderOrder = -4;
    root.add(bedMesh);
    const waterMat = riverMaterial('water', { color: LAND[0].water, roughness: 0.12, metalness: 0.15, opacity: 0.92 });
    const waterGeo = mergeGeometries([courseRibbon(2.2, 0.014), stripGeometry(fallRows, [0, 0, 1]), stripGeometry(springRows, [1, 0, 0])]);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.receiveShadow = true;
    water.renderOrder = -3;
    root.add(water);
    // Stones round the spring.
    for (const [key, x, z, r, s, y = 0] of [
        ['stoneA', -5.0, 17.55, 0.4, 0.9], ['stoneSmall', -4.6, 17.9, 1.1, 1], ['stoneB', -5.1, 20.05, 2.2, 0.75],
        ['stoneSmall', -4.7, 19.85, 0.3, 1.1], ['stoneA', -5.55, 17.45, 1.4, 0.6, 1],
    ]) place(key, x, z, { rot: r, scale: s, y });
    addProp('bushLarge', -5.5, 19.5, 0, 3, { rot: 0.7, y: 1 });
    addProp('grassLarge', -6.5, 17.6, 0, 3, { rot: 2.1, y: 2 });
    addProp('grassLeafs', -6.4, 19.3, 0, 3, { rot: 0.4, y: 2 });

    // Reeds where the water meets the bank, lilies out on it. Both die off as the water leaves.
    const reedGeo = new THREE.ConeGeometry(0.026, 1, 4, 1).translate(0, 0.5, 0);
    const headGeo = new THREE.CylinderGeometry(0.03, 0.026, 0.11, 6);
    const reedClumps = []; // { s, k, blades: [{ x, z, q, h }], heads: [{ x, z, q, h }] }
    {
        const r = prng(5);
        for (let s = 0.9; s < S_LIP - 1.4; s += 0.5) {
            if (Math.abs(s - S_DAM) < 0.8) continue;
            const p = pointAt(s);
            for (const side of [-1, 1]) {
                if (r() < 0.45) continue;
                let edge = 0;
                for (let a = 0.3; a < 2.3; a += 0.04) if (masks.sample(p.x + p.nx * side * a, p.z + p.nz * side * a) > 0.55) edge = a;
                if (!edge) continue;
                const a = edge - 0.08 - r() * 0.12;
                const cx = p.x + p.nx * side * a + (r() - 0.5) * 0.25;
                const cz = p.z + p.nz * side * a + (r() - 0.5) * 0.25;
                const clump = { s, k: 1, blades: [], heads: [] };
                const n = 3 + Math.floor(r() * 4);
                for (let i = 0; i < n; i++) {
                    const ang = r() * Math.PI * 2;
                    const tilt = 0.06 + r() * 0.22;
                    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(ang) * tilt, r() * 6, Math.sin(ang) * tilt));
                    const b = { x: cx + Math.cos(ang) * r() * 0.1, z: cz + Math.sin(ang) * r() * 0.1, q, h: 0.28 + r() * 0.26 };
                    clump.blades.push(b);
                    if (i < 2 && r() < 0.7) clump.heads.push(b);
                }
                reedClumps.push(clump);
            }
        }
    }
    const reedMesh = new THREE.InstancedMesh(reedGeo, natureMaterial('grass'), reedClumps.reduce((n, c) => n + c.blades.length, 0));
    const headMesh = new THREE.InstancedMesh(headGeo, natureMaterial('woodDark'), Math.max(1, reedClumps.reduce((n, c) => n + c.heads.length, 0)));
    reedMesh.receiveShadow = headMesh.receiveShadow = true;
    reedMesh.frustumCulled = headMesh.frustumCulled = false;
    root.add(reedMesh, headMesh);
    const tmpM = new THREE.Matrix4();
    const tmpV = new THREE.Vector3();
    const tmpS = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    function writeReeds() {
        let bi = 0;
        let hi = 0;
        for (const c of reedClumps) {
            const k = ease(c.k);
            for (const b of c.blades) {
                reedMesh.setMatrixAt(bi++, tmpM.compose(tmpV.set(b.x, 0, b.z), b.q, tmpS.set(k, b.h * k, k)));
            }
            for (const b of c.heads) {
                const up = UP.clone().applyQuaternion(b.q).multiplyScalar(b.h * 0.8 * k);
                headMesh.setMatrixAt(hi++, tmpM.compose(tmpV.set(b.x + up.x, up.y, b.z + up.z), b.q, tmpS.setScalar(k)));
            }
        }
        headMesh.count = hi;
        reedMesh.instanceMatrix.needsUpdate = true;
        headMesh.instanceMatrix.needsUpdate = true;
    }
    writeReeds();
    const lilies = []; // { obj, s, k }
    {
        const r = prng(13);
        for (let s = 1.5; s < S_LIP - 2; s += 1.7 + r() * 1.6) {
            if (Math.abs(s - S_DAM) < 1) continue;
            const p = pointAt(s);
            const a = (r() - 0.5) * 1.3;
            const x = p.x + p.nx * a;
            const z = p.z + p.nz * a;
            if (masks.sample(x, z) < 0.9) continue;
            const obj = place(r() < 0.5 ? 'lily' : 'lilySmall', x, z, { rot: r() * 6, y: 0.016 });
            lilies.push({ obj, s, k: 1 });
        }
    }

    // NIHIL's dam: board-marked concrete with the alarm-red stripe and NIHIL's
    // mark, buttressed downstream, red beacons on both ends. Hidden (sunk
    // below the ground) until the reveal; then it rises across the river.
    const dam = new THREE.Group();
    const damPt = pointAt(S_DAM);
    dam.position.set(damPt.x, -1, damPt.z);
    dam.rotation.y = Math.atan2(damPt.nz, -damPt.nx); // local +z = downstream, local x = across
    {
        const concrete = new THREE.MeshStandardMaterial({ color: 0xb4aea2, roughness: 0.92 });
        const cap = new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.85 });
        const face = new THREE.MeshStandardMaterial({ map: damFaceTexture(), roughness: 0.9 });
        const beaconMat = new THREE.MeshStandardMaterial({ color: 0x3a1210, emissive: 0xff3b30, emissiveIntensity: 1.2 });
        const mesh = (geo, mat) => {
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = true;
            m.receiveShadow = true;
            dam.add(m);
        };
        // The wall carries the face texture on its long sides; the small parts merge per material.
        mesh(new THREE.BoxGeometry(3.6, 0.8, 0.44).translate(0, 0.4, 0), [concrete, concrete, cap, concrete, face, face]);
        const parts = { concrete: [], cap: [], beacon: [] };
        const box = (w, h, d, kind, x, y, z) => parts[kind].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
        box(3.74, 0.08, 0.56, 'cap', 0, 0.84, 0);
        for (const x of [-1.2, 0, 1.2]) box(0.24, 0.44, 0.34, 'concrete', x, 0.22, 0.38); // buttresses
        for (const x of [-1.72, 1.72]) {
            box(0.08, 0.2, 0.08, 'concrete', x, 0.98, 0);
            box(0.12, 0.08, 0.12, 'beacon', x, 1.12, 0);
            const halo = haloSprite(0xff3b30, 0.7);
            halo.position.set(x, 1.12, 0);
            halo.material.opacity = 0;
            dam.add(halo);
        }
        mesh(mergeGeometries(parts.concrete), concrete);
        mesh(mergeGeometries(parts.cap), cap);
        mesh(mergeGeometries(parts.beacon), beaconMat);
    }
    dam.visible = false;
    root.add(dam);
    const damHalos = dam.children.filter((c) => c.isSprite);

    // The river's state: `reveal` is the clock time NIHIL started damming it
    // (null while it flows, -Infinity when it was already dammed on load).
    let reveal = null;
    const DAM_RISE = [200, 1000]; // ms after the reveal: the dam comes up
    const DRAIN_MS = 4600;        // then the water runs off, dam → past the falls
    function riverFront(now) {
        if (reveal === null) return -1e4;
        const t = (now - reveal - DAM_RISE[1]) / DRAIN_MS;
        return t >= 1 ? S_GONE : S_DAM - 0.5 + (S_GONE - S_DAM + 0.5) * Math.max(0, t);
    }
    // The epilogue blows the dam (`freed`: the clock time it went, null while it stands,
    // -Infinity when it was already gone on load): it sinks back into its dust, then the
    // water runs down the bed again from the dam to the falls (uFill, the reverse of uFront).
    let freed = null;
    let blasted = false;
    const DAM_SINK = [350, 1900]; // ms after the blast: the dam goes down
    const FILL_AT = 1100;         // the water starts down the bed
    const FILL_MS = 5600;         // and reaches past the falls
    function riverFill(now) {
        if (freed === null) return -1e4;
        const t = (now - freed - FILL_AT) / FILL_MS;
        return t >= 1 ? 1e4 : S_DAM - 0.5 + (S_GONE + 3 - S_DAM + 0.5) * Math.max(0, t);
    }

    // Rim: forest, meadow and NILE's compound.
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
            if (nearRiver(x, y) || inFarm(x, y) || inCamp(x, y)) continue;
            if (Math.hypot(x + 0.5 - HQ.x, y + 0.5 - HQ.z) < 2.4) continue; // the HQ's plaza

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
    // ---- The headquarters tower ----------------------------------------------------------
    // A plain corporate tower (lit window grid, crown, antenna with a beacon) wearing NILE's
    // sign, then NIHIL's from the reveal. ruinHQ() brings it down: it tilts and sinks into its
    // own dust, then stays a smoking, burning stump with rubble.
    const hq = (() => {
        const g = new THREE.Group();
        g.position.set(HQ.x, 0, HQ.z);
        root.add(g);
        const tex = (draw, w, h) => {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            draw(c.getContext('2d'), w, h);
            const t = new THREE.CanvasTexture(c);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        };
        const windows = (burnt) => tex((x, w, h) => {
            x.fillStyle = burnt ? '#17181c' : '#2c3240';
            x.fillRect(0, 0, w, h);
            let seed = burnt ? 7 : 3;
            const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
            for (let r = 0; r < 16; r++) {
                for (let col = 0; col < 5; col++) {
                    const lit = !burnt && rnd() < 0.62;
                    x.fillStyle = lit ? (rnd() < 0.5 ? '#ffd98a' : '#fff1c4') : burnt ? '#0c0c0e' : '#1b1f29';
                    x.fillRect(4 + col * 12, 3 + r * 8, 8, 5);
                }
            }
        }, 64, 132);
        const litTex = windows(false);
        const facade = new THREE.MeshStandardMaterial({ map: litTex, emissive: 0xffe0a8, emissiveMap: litTex, emissiveIntensity: 0.25, roughness: 0.45, metalness: 0.1 });
        const burnt = new THREE.MeshStandardMaterial({ map: windows(true), roughness: 0.9, color: 0x77706a });
        const concrete = new THREE.MeshStandardMaterial({ color: 0xa3a7ae, roughness: 0.85, flatShading: true });
        const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.6, flatShading: true });
        const box = (w, h, d, mat, y, parent = g) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.y = y;
            m.castShadow = true;
            m.receiveShadow = true;
            parent.add(m);
            return m;
        };
        box(3.1, 0.3, 3.1, concrete, 0.15); // the plaza
        const stack = new THREE.Group(); // everything that falls
        g.add(stack);
        box(2.0, 4.6, 2.0, facade, 0.3 + 2.3, stack);
        box(2.3, 0.28, 2.3, dark, 5.04, stack);
        box(1.35, 0.8, 1.35, facade, 5.58, stack);
        box(1.55, 0.12, 1.55, dark, 6.04, stack);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 1.3, 8), dark);
        mast.position.y = 6.75;
        stack.add(mast);
        const beacon = haloSprite(0xff3b30, 0.7);
        beacon.position.y = 7.45;
        stack.add(beacon);
        // The sign on all four faces, just under the crown: NILE's, then NIHIL's.
        const sign = (evil) => tex((x, w, h) => {
            x.fillStyle = evil ? '#16070a' : '#0e1a2c';
            x.fillRect(0, 0, w, h);
            x.strokeStyle = evil ? '#ff3b30' : '#ff6a13';
            x.lineWidth = 5;
            if (evil) {
                x.beginPath();
                x.moveTo(18, h / 2);
                x.lineTo(62, h / 2);
                x.stroke();
            } else {
                x.beginPath();
                x.moveTo(40, 16);
                x.lineTo(40, h - 16);
                x.moveTo(40, 16);
                x.bezierCurveTo(40, 40, 26, 50, 20, h - 16);
                x.moveTo(40, 16);
                x.bezierCurveTo(40, 40, 54, 50, 60, h - 16);
                x.stroke();
            }
            x.fillStyle = evil ? '#ff3b30' : '#f2e8d5';
            x.font = '800 54px "Big Shoulders Display", Impact, sans-serif';
            x.textBaseline = 'middle';
            x.fillText(evil ? 'NIHIL' : 'NILE', 78, h / 2 + 2);
        }, 256, 80);
        const signMats = {
            nile: new THREE.MeshBasicMaterial({ map: sign(false) }),
            nihil: new THREE.MeshBasicMaterial({ map: sign(true) }),
        };
        const signs = [];
        for (let i = 0; i < 4; i++) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.53), signMats.nile);
            const a = (i * Math.PI) / 2;
            m.position.set(Math.sin(a) * 1.012, 4.45, Math.cos(a) * 1.012);
            m.rotation.y = a;
            stack.add(m);
            signs.push(m);
        }
        // The ruin, hidden until the strike: a broken stump, slabs and rubble, and fires.
        const ruin = new THREE.Group();
        ruin.visible = false;
        g.add(ruin);
        const stump = box(2.0, 1.5, 2.0, burnt, 0.3 + 0.75, ruin);
        stump.rotation.set(0.08, 0.2, -0.12);
        const slab = box(2.4, 0.22, 1.2, concrete, 0.55, ruin);
        slab.position.set(-1.3, 0.5, 0.6);
        slab.rotation.set(0.3, 0.6, 0.45);
        let seed = 11;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 14; i++) {
            const r = box(0.25 + rnd() * 0.4, 0.18 + rnd() * 0.3, 0.25 + rnd() * 0.4, rnd() < 0.5 ? concrete : dark, 0.15, ruin);
            const a = rnd() * Math.PI * 2;
            const d = 1.1 + rnd() * 1.4;
            r.position.set(Math.cos(a) * d, 0.12 + rnd() * 0.15, Math.sin(a) * d);
            r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        }
        const fires = [[0.3, 1.6, 0.2], [-0.6, 1.2, -0.4], [0.5, 0.9, 0.8], [-1.2, 0.7, 0.5]].map(([x, y, z], i) => {
            const f = haloSprite(i % 2 ? 0xff7a1a : 0xffb040, 1.1 + (i % 3) * 0.25);
            f.position.set(x, y, z);
            ruin.add(f);
            return f;
        });
        return { g, stack, ruin, signs, signMats, beacon, facade, fires, fall: null, ruined: false, smoke: 0 };
    })();

    /** Stand the tower up again, or show it ruined (instantly; e.g. on load). */
    function setHQRuined(ruined) {
        hq.ruined = ruined;
        hq.fall = null;
        hq.stack.visible = !ruined;
        hq.stack.position.y = 0;
        hq.stack.rotation.set(0, 0, 0);
        hq.ruin.visible = ruined;
        hq.ruin.scale.setScalar(1);
    }
    /** Bring the tower down: it tilts and sinks into its dust, and the ruin smokes on. */
    function ruinHQ() {
        if (hq.ruined) return;
        hq.ruined = true;
        hq.fall = { t: 0 };
        hq.ruin.visible = true;
        hq.ruin.scale.setScalar(0.01);
        for (let i = 0; i < 6; i++) effects.puff(new THREE.Vector3(HQ.x + (Math.random() - 0.5) * 2.6, 0.4, HQ.z + (Math.random() - 0.5) * 2.6), { count: 10, size: 0.8, spread: 1.4, color: 0x8a8278 });
    }
    function updateHQ(dt) {
        // NILE's sign until the reveal, then NIHIL's; the beacon blinks; windows glow at night.
        const mat = phase >= 4 ? hq.signMats.nihil : hq.signMats.nile;
        for (const s of hq.signs) if (s.material !== mat) s.material = mat;
        hq.beacon.material.opacity = (Math.sin(clock / 260) > 0 ? 0.95 : 0.15) * (hq.stack.visible ? 1 : 0);
        hq.facade.emissiveIntensity = 0.15 + Math.min(1, Math.max(0, phase - 2) * 0.35);
        if (hq.fall) {
            const f = hq.fall;
            f.t = Math.min(1, f.t + dt / 2400);
            const k = f.t * f.t;
            hq.stack.rotation.z = -0.55 * k;
            hq.stack.rotation.x = 0.18 * k;
            hq.stack.position.y = -4.2 * k;
            hq.ruin.scale.setScalar(Math.max(0.01, Math.min(1, (f.t - 0.25) / 0.6)));
            if (Math.random() < dt / 90) effects.puff(new THREE.Vector3(HQ.x + (Math.random() - 0.5) * 3, 0.3, HQ.z + (Math.random() - 0.5) * 3), { count: 6, size: 0.7, spread: 1.2, color: 0x9a9088 });
            if (f.t >= 1) {
                hq.fall = null;
                hq.stack.visible = false;
            }
        }
        if (hq.ruined && healed >= 2) {
            // The epilogue cleared the compound: the ruin's fires are out at last.
            hq.fires.forEach((fl) => (fl.material.opacity = Math.max(0, fl.material.opacity - dt / 1500)));
        } else if (hq.ruined) {
            hq.fires.forEach((fl, i) => (fl.material.opacity = 0.55 + 0.35 * Math.sin(clock / (70 + i * 17) + i)));
            hq.smoke += dt;
            if (hq.smoke > 260) {
                hq.smoke = 0;
                const fl = hq.fires[Math.floor(Math.random() * hq.fires.length)];
                effects.smoke(new THREE.Vector3(HQ.x + fl.position.x, fl.position.y + 0.3, HQ.z + fl.position.z), { color: 0x3a3634, size: 0.5, rise: 1.2, opacity: 0.6 });
            }
        }
    }

    // NILE's compound: nearer the pad appears sooner. Until then a tree
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

    // Flora on empty buildable cells: gone once that cell is paved. None in the river.
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const c = grid[x][y];
            if (c.resource || c.blocked || c.machine || c.river) continue;
            const f = rand(x, y, 8);
            if (f > 0.13) continue;
            const key = f < 0.05 ? ['flowerRedB', 'flowerYellowB'][Math.floor(f * 100) % 2] : 'grass';
            const p = addProp(key, x + 0.3 + rand(x, y, 9) * 0.4, y + 0.3 + rand(y, x, 9) * 0.4, 0, f < 0.05 ? 2 : 3, { rot: f * 50 });
            flora.set(`${x},${y}`, p);
        }
    }

    // ---- The plot: NILE's survey fence and the land you don't lease yet -------------------
    // Wooden stakes with orange tips round the plot's edge, hazard tape between
    // them, a NILE flag on each corner. Outside it the land is dimmed and
    // hatched. When the plot grows the old fence sinks away in a lap round the
    // edge, the shade retreats, and the new fence springs up in a wave of dust.
    const POST_H = 0.34;
    const TAPE_Y = 0.25;
    const POLE_H = 0.92;
    const fenceMats = {
        post: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
        tape: new THREE.MeshStandardMaterial({ map: tapeTexture(), roughness: 0.7, side: THREE.DoubleSide }),
        pole: new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.5, metalness: 0.2 }),
        flag: new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.8, side: THREE.DoubleSide }),
    };
    const coloured = (geo, hex) => {
        const c = new THREE.Color(hex);
        const n = geo.attributes.position.count;
        geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => c.toArray()[i % 3]), 3));
        return geo;
    };
    const postGeo = mergeGeometries([
        coloured(new THREE.BoxGeometry(0.05, POST_H - 0.07, 0.05).translate(0, (POST_H - 0.07) / 2, 0), 0xcfae7e),
        coloured(new THREE.BoxGeometry(0.056, 0.07, 0.056).translate(0, POST_H - 0.035, 0), 0xff6a13),
    ]);
    const tapeGeo = new THREE.BoxGeometry(1, 0.055, 0.008);
    const poleGeo = new THREE.CylinderGeometry(0.02, 0.024, POLE_H, 6).translate(0, POLE_H / 2, 0);
    const FLAG_W = 0.46;
    const flagGeo = new THREE.PlaneGeometry(FLAG_W, FLAG_W * 0.66, 8, 1).translate(FLAG_W / 2, -FLAG_W * 0.33, 0);
    const flagBase = Float32Array.from(flagGeo.attributes.position.array);
    const fenceMesh = {};
    for (const [part, geo, cap] of [['post', postGeo, 240], ['tape', tapeGeo, 240], ['pole', poleGeo, 8], ['flag', flagGeo, 8]]) {
        const m = new THREE.InstancedMesh(geo, fenceMats[part], cap);
        m.count = 0;
        m.castShadow = part !== 'tape';
        m.receiveShadow = true;
        m.frustumCulled = false;
        root.add(m);
        fenceMesh[part] = m;
    }
    /** Fence pieces: { part, x, z, rot, len, u (0..1 round the edge), k, dir (+1 in, -1 out), wait, puff } */
    let fence = [];
    let fenceBusy = false;
    const WIND = Math.atan2(0.6, 1); // flags stream toward +x, a little north (screen right)

    /** Is the corner (x, z) of the grid in the river (two of its four cells)? */
    const wetCorner = (x, z) => [[x - 1, z - 1], [x, z - 1], [x - 1, z], [x, z]]
        .filter(([cx, cz]) => grid[cx]?.[cz]?.river).length >= 2;
    function fenceLayout(r) {
        if (wholeValley(r)) return []; // the whole valley is yours: no fence
        const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
        const P = 2 * (r.w + r.h);
        const posts = [];
        corners.forEach(([x0, z0], e) => {
            const [x1, z1] = corners[(e + 1) % 4];
            const len = Math.abs(x1 - x0) + Math.abs(z1 - z0);
            for (let i = 0; i < len; i++) {
                const x = x0 + Math.sign(x1 - x0) * i;
                const z = z0 + Math.sign(z1 - z0) * i;
                posts.push({ x, z, corner: i === 0, u: posts.length / P, wet: wetCorner(x, z) });
            }
        });
        const out = [];
        posts.forEach((p, i) => {
            const q = posts[(i + 1) % posts.length];
            if (!p.wet) out.push({ part: p.corner ? 'pole' : 'post', x: p.x, z: p.z, rot: 0, u: p.u, puff: p.corner || i % 3 === 0 });
            if (p.corner && !p.wet) out.push({ part: 'flag', x: p.x, z: p.z, rot: WIND, u: p.u });
            if (!p.wet && !q.wet) {
                out.push({ part: 'tape', x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, rot: Math.atan2(-(q.z - p.z), q.x - p.x), u: (p.u + 0.5 / P) % 1 });
            }
        });
        return out;
    }
    function setFence(r, animate) {
        if (!animate) {
            fence = fenceLayout(r).map((f) => ({ ...f, k: 1, dir: 1, wait: 0 }));
        } else {
            for (const f of fence) {
                f.dir = -1;
                f.wait = 120 + f.u * 700;
            }
            fence.push(...fenceLayout(r).map((f) => ({ ...f, k: 0, dir: 1, wait: 1000 + f.u * 1500 + (f.part === 'tape' ? 90 : 0) })));
        }
        fenceBusy = true;
    }
    /** Write the fence's instance matrices (only the flags' when `flagsOnly`: they flutter every frame). */
    function writeFence(time, flagsOnly = false) {
        const counts = { post: 0, tape: 0, pole: 0, flag: 0 };
        for (const f of fence) {
            if (flagsOnly && f.part !== 'flag') continue;
            const rising = f.dir > 0;
            if (rising && f.k <= 0) continue; // not up yet
            const m = fenceMesh[f.part];
            const i = counts[f.part]++;
            const s = rising ? Math.max(0, backOut(f.k)) : 1;
            const sink = rising ? 0 : -0.42 * (1 - ease(f.k));
            if (f.part === 'post' || f.part === 'pole') {
                tmpM.compose(tmpV.set(f.x, sink, f.z), tmpQ.identity(), tmpS.set(1, s, 1));
            } else if (f.part === 'tape') {
                tmpQ.setFromAxisAngle(UP, f.rot);
                tmpM.compose(tmpV.set(f.x, TAPE_Y * s + sink, f.z), tmpQ, tmpS.set(Math.min(1, f.k * 1.6), Math.max(0.001, s), 1));
            } else {
                tmpQ.setFromAxisAngle(UP, f.rot + Math.sin(time * 1.9 + f.x * 0.7 + f.z) * 0.22);
                tmpM.compose(tmpV.set(f.x, POLE_H * s + sink, f.z), tmpQ, tmpS.setScalar(Math.max(0.001, rising ? s : 1)));
            }
            m.setMatrixAt(i, tmpM);
        }
        for (const part of flagsOnly ? ['flag'] : Object.keys(counts)) {
            fenceMesh[part].count = counts[part];
            fenceMesh[part].instanceMatrix.needsUpdate = true;
        }
    }
    function updateFence(dt) {
        if (fenceBusy) {
            let busy = false;
            for (const f of fence) {
                if (f.wait > 0) {
                    f.wait -= dt;
                    busy = true;
                    continue;
                }
                if (f.dir > 0 && f.k < 1) {
                    if (f.k === 0 && f.puff) effects.puff(new THREE.Vector3(f.x, 0, f.z), { color: 0xcdb99a, count: 4, size: 0.24, spread: 0.3 });
                    f.k = Math.min(1, f.k + dt / 420);
                    busy = true;
                } else if (f.dir < 0 && f.k > 0) {
                    if (f.k === 1 && f.puff && f.part !== 'pole') effects.puff(new THREE.Vector3(f.x, 0, f.z), { color: 0xb9a88c, count: 3, size: 0.2, spread: 0.2 });
                    f.k = Math.max(0, f.k - dt / 300);
                    busy = true;
                }
            }
            fence = fence.filter((f) => f.dir > 0 || f.k > 0);
            fenceBusy = busy;
            writeFence(clock / 1000);
        } else if (fenceMesh.flag.count) {
            writeFence(clock / 1000, true); // flags flutter
        }
        if (fenceMesh.flag.count) { // a ripple along the cloth
            const pos = flagGeo.attributes.position;
            const t = clock / 1000;
            for (let i = 0; i < pos.count; i++) {
                const x = flagBase[i * 3];
                pos.setZ(i, Math.sin(x * 12 - t * 7) * 0.032 * (x / FLAG_W));
            }
            pos.needsUpdate = true;
        }
    }

    // The shade over the land outside the plot: an unlit overlay over the grid,
    // clear inside the (animated) plot rectangle, dim with faint hatching outside.
    const shadeMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uRect: { value: new THREE.Vector4(0, 0, W, H) } },
        vertexShader: /* glsl */ `
            varying vec2 vW;
            void main() {
                vec4 w = modelMatrix * vec4(position, 1.0);
                vW = w.xz;
                gl_Position = projectionMatrix * viewMatrix * w;
            }`,
        fragmentShader: /* glsl */ `
            uniform vec4 uRect;
            varying vec2 vW;
            void main() {
                float e = 0.05;
                float inside = smoothstep(uRect.x - e, uRect.x + e, vW.x) * (1.0 - smoothstep(uRect.z - e, uRect.z + e, vW.x))
                    * smoothstep(uRect.y - e, uRect.y + e, vW.y) * (1.0 - smoothstep(uRect.w - e, uRect.w + e, vW.y));
                // Diagonal hatching (≈45° on screen in the default view), world-anchored.
                float c = (vW.x * 4.0 - vW.y) / 4.1231 / 0.4;
                float hatch = 1.0 - smoothstep(0.05, 0.11, abs(fract(c) - 0.5));
                float a = (1.0 - inside) * (0.15 + 0.09 * hatch);
                if (a < 0.003) discard;
                gl_FragColor = vec4(0.09, 0.1, 0.14, a);
            }`,
    });
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(W, H), shadeMat);
    shade.rotation.x = -Math.PI / 2;
    shade.position.set(W / 2, 0.02, H / 2);
    shade.renderOrder = -1; // over the ground layers and the river, under everything else that's see-through
    root.add(shade);
    const rectOf = (r) => new THREE.Vector4(r.x, r.y, r.x + r.w, r.y + r.h);
    let shadeAnim = null; // { from, to, t }
    let plotIndex = -1;
    function setPlot(p, animate) {
        const idx = Math.min(Math.max(p, 0), PLOTS.length - 1);
        if (idx === plotIndex && !(!animate && (shadeAnim || fenceBusy))) return;
        const r = PLOTS[idx];
        const grow = animate && plotIndex >= 0 && idx > plotIndex;
        plotIndex = idx;
        setFence(r, grow);
        if (grow) {
            shadeAnim = { from: shadeMat.uniforms.uRect.value.clone(), to: rectOf(r), t: -500 };
        } else {
            shadeAnim = null;
            shadeMat.uniforms.uRect.value.copy(rectOf(r));
            for (const f of fence) f.k = 1;
            writeFence(clock / 1000);
            fenceBusy = false;
        }
        shade.visible = !!shadeAnim || !wholeValley(r);
    }
    const wholeValley = (r) => r.x <= 0 && r.y <= 0 && r.x + r.w >= W && r.y + r.h >= H;
    function updateShade(dt) {
        if (!shadeAnim) return;
        shadeAnim.t += dt;
        const k = ease(clamp01(shadeAnim.t / 1700));
        shadeMat.uniforms.uRect.value.lerpVectors(shadeAnim.from, shadeAnim.to, k);
        if (k >= 1) {
            shadeAnim = null;
            shade.visible = !wholeValley(PLOTS[plotIndex]);
        }
    }

    // ---- Phase changes ---------------------------------------------------------------------
    let phase = -1;
    let clock = 0;
    const pending = []; // { at, run }
    // The epilogue after the NIHIL HQ ending (epilogue.js; goals done, 0–4): the camp fire is
    // relit (1), NIHIL's compound comes down and its floodlights go out (2), the dam goes and the
    // river runs again (3), and every goal turns the land one phase back toward its first
    // morning: colours, trees, flowers and crops follow `landP()`, not the campaign's phase.
    let healed = 0;
    const landFor = (p) => (healed ? Math.max(1, p - healed) : p);
    const landP = () => landFor(phase);

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
        const wasDammed = phase >= RIVER.damPhase;
        phase = p;
        for (const t of trees) {
            const target = treeTarget(t, landFor(p));
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
            const show = p >= c.appear && healed < 2;
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
        setPlot(p, animate);
        const dammed = p >= RIVER.damPhase;
        if (dammed && animate && !wasDammed) reveal = clock;
        else if (!animate || !dammed) reveal = dammed ? -Infinity : null;
        if (!animate) applyRiver(true);
        if (instant) snapLand();
    }

    /** Props, flora and the land's colours at once, for the land's phase (loads, jumps). */
    function snapLand() {
        const p = landP();
        for (const pr of props) {
            pr.shown = p >= pr.min && p <= pr.max && !pr.gone && !pr.covered && !pr.ore;
            pr.k = pr.shown ? 1 : 0;
            pr.obj.visible = pr.shown;
            pr.obj.scale.setScalar(pr.obj.userData.baseScale * pr.k);
        }
        const land = LAND[Math.max(0, Math.min(p, LAND.length - 1))];
        groundMat.color.setHex(land.ground);
        natureMaterial('grass').color.setHex(land.grass);
        natureMaterial('leafsGreen').color.setHex(land.leafs);
        natureMaterial('dirt').color.setHex(land.dirt);
        waterMat.color.setHex(land.water);
        bankTarget(riverU.uBankWet.value, land);
    }

    /**
     * The epilogue's goals done so far (0–4). One step forward animates: the camp fire catches
     * with a shower of sparks, the compound sinks away building by building, the dam is blown
     * and the river runs back down its bed, trees grow back out of their stumps; the land's
     * colours ease toward the earlier phase. Anything else (a load) snaps.
     */
    function setEpilogue(stage, instant = false) {
        if (stage === healed) return;
        const animate = !instant && phase >= 0 && stage === healed + 1;
        const was = healed;
        healed = stage;
        for (const t of trees) {
            if (treeTarget(t, landP()) === t.state) continue;
            if (!animate || !t.obj) {
                t.anim = null;
                setTree(t, treeTarget(t, landP()));
                continue;
            }
            // The target is read when it runs, so a quick second step can't leave a tree behind.
            pending.push({ at: clock + 600 + Math.random() * 5200, run: () => {
                const target = treeTarget(t, landP());
                if (target === t.state) return;
                const regrow = t.state === 'stump';
                setTree(t, target);
                t.anim = { kind: regrow ? 'grow' : 'shiver', t: 0 };
                if (regrow) {
                    t.obj.scale.setScalar(0.01);
                    effects.sparkle(new THREE.Vector3(t.x, 0.25, t.z), { color: 0x9be070, count: 4, power: 0.8, size: 0.08 });
                }
            } });
        }
        if (stage >= 2 && was < 2) {
            // NIHIL's compound comes down, nearest the valley first, one building after another.
            compound.forEach((c, i) => {
                if (!c.shown) return;
                c.shown = false;
                if (!animate) {
                    c.obj.visible = false;
                    return;
                }
                pending.push({ at: clock + 500 + i * 160 + Math.random() * 300, run: () => {
                    c.grow = null;
                    c.sink = 0;
                    effects.puff(c.obj.position, { count: 16, size: 0.7, spread: 1.3, color: 0xb9a88c });
                } });
            });
        } else if (stage < 2 && was >= 2) {
            compound.forEach((c) => {
                c.sink = null;
                c.shown = phase >= c.appear;
                c.obj.visible = c.shown;
                c.obj.position.y = 0;
                c.obj.scale.setScalar(c.obj.userData.baseScale);
            });
        }
        if (animate && stage === 1) {
            // The camp fire catches again.
            pending.push({ at: clock + 400, run: () => {
                effects.sparkle(new THREE.Vector3(-2.2, 0.3, 12.5), { color: 0xffb040, count: 18, power: 1.4, size: 0.1 });
                effects.puff(new THREE.Vector3(-2.2, 0.1, 12.5), { count: 6, size: 0.3, spread: 0.3, color: 0x9a9088 });
            } });
        }
        if (stage >= 3) {
            if (freed === null) {
                freed = animate ? clock : -Infinity;
                blasted = !animate;
            }
        } else {
            freed = null;
            blasted = false;
        }
        if (!animate) {
            applyRiver(true);
            snapLand();
        }
    }

    /** Where the epilogue's goal `stage` changes the valley (for the camera to glide to). */
    function epiloguePoint(stage) {
        if (stage === 1) return { x: -2.2, z: 12.5 };
        if (stage === 2) {
            const shown = compound.filter((c) => c.appear <= Math.max(1, phase));
            const n = Math.max(1, shown.length);
            return { x: shown.reduce((a, c) => a + c.obj.position.x, 0) / n, z: shown.reduce((a, c) => a + c.obj.position.z, 0) / n };
        }
        if (stage === 3) return { x: damPt.x + 3, z: damPt.z + 1 };
        return null;
    }

    const tmpColor = new THREE.Color();
    function lerpHex(color, hex, k) {
        color.lerp(tmpColor.setHex(hex), k);
    }
    /** The wet bank: river mud, darkening with the land. */
    function bankTarget(out, land) {
        return out.setHex(land.dirt).lerp(tmpColor.setHex(0xa08a5a), 0.45);
    }
    const bankGoal = new THREE.Color();

    /**
     * Bring the river to `now`: the dam's height, how far the water has run
     * off, which reeds and lilies are left. `snap` jumps reeds and lilies too.
     */
    function applyRiver(snap = false) {
        const front = riverFront(clock);
        const fill = riverFill(clock);
        riverU.uFront.value = front;
        riverU.uFill.value = fill;
        // The dam: below ground while the river flows, rising at the reveal, sinking when blown.
        let rise = reveal === null ? 0 : clamp01((clock - reveal - DAM_RISE[0]) / (DAM_RISE[1] - DAM_RISE[0]));
        if (freed !== null) rise *= 1 - clamp01((clock - freed - DAM_SINK[0]) / (DAM_SINK[1] - DAM_SINK[0]));
        dam.visible = rise > 0;
        const e = 1 - (1 - rise) ** 3;
        dam.position.y = -0.98 * (1 - e);
        const shaking = rise > 0 && rise < 1;
        dam.position.x = damPt.x + (shaking ? (Math.random() - 0.5) * 0.04 : 0);
        dam.position.z = damPt.z + (shaking ? (Math.random() - 0.5) * 0.04 : 0);
        let reedsMoved = false;
        for (const c of reedClumps) {
            const want = c.s < S_DAM || c.s > front + 0.6 || c.s < fill - 0.6 ? 1 : 0;
            if (c.k === want) continue;
            c.k = snap ? want : c.k + Math.sign(want - c.k) * Math.min(Math.abs(want - c.k), 0.05);
            reedsMoved = true;
        }
        if (reedsMoved) writeReeds();
        for (const l of lilies) {
            const want = l.s < S_DAM || l.s > front + 0.4 || l.s < fill - 0.4 ? 1 : 0;
            if (l.k === want) continue;
            l.k = snap ? want : l.k + Math.sign(want - l.k) * Math.min(Math.abs(want - l.k), 0.06);
            l.obj.visible = l.k > 0.001;
            l.obj.scale.setScalar(l.obj.userData.baseScale * ease(l.k));
            l.obj.position.y = 0.016 - 0.03 * (1 - l.k);
        }
    }

    let smokeAcc = 0;
    let dustAcc = 0;
    let sprayAcc = 0;
    let splashAcc = 0;
    let damDust = 0;
    /** Per frame: staggered transitions, falling trees, colour easing, the river, the fence, fire, lamps. */
    function update(dt) {
        clock += dt;
        updateHQ(dt);
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
            } else if (t.anim.kind === 'grow') { // back out of its stump (the epilogue)
                const k = Math.min(1, t.anim.t / 1500);
                t.obj.scale.setScalar(t.scale * Math.max(0.01, ease(k)) * (1 + Math.sin(k * Math.PI) * 0.1));
                if (k >= 1) t.anim = null;
            } else {
                const k = Math.min(1, t.anim.t / 500);
                t.obj.scale.setScalar(t.scale * (1 + Math.sin(k * Math.PI) * 0.12));
                if (k >= 1) t.anim = null;
            }
        }
        for (const c of compound) {
            if (c.sink != null) { // taken down (the epilogue): it judders and sinks into its dust
                c.sink = Math.min(1, c.sink + dt / 1300);
                const k = c.sink * c.sink;
                c.obj.position.y = -k * ((c.obj.userData.height ?? 2) + 0.2);
                c.obj.rotation.z = Math.sin(c.sink * 40) * 0.025 * (1 - c.sink);
                if (Math.random() < dt / 110) {
                    effects.puff(new THREE.Vector3(c.obj.position.x + (Math.random() - 0.5) * 1.2, 0.1, c.obj.position.z + (Math.random() - 0.5) * 1.2), { count: 4, size: 0.5, spread: 0.6, color: 0xb9a88c });
                }
                if (c.sink >= 1) {
                    c.sink = null;
                    c.obj.visible = false;
                    c.obj.position.y = 0;
                    c.obj.rotation.z = 0;
                }
                continue;
            }
            if (c.grow == null || c.grow >= 1) continue;
            c.grow = Math.min(1, c.grow + dt / 700);
            const s = 1 + Math.sin(c.grow * Math.PI) * 0.12; // overshoot pop
            c.obj.scale.setScalar(c.obj.userData.baseScale * ease(c.grow) * s);
        }
        const lp = landP();
        for (const pr of props) {
            const want = lp >= pr.min && lp <= pr.max && !pr.gone && !pr.covered && !pr.ore;
            if (want !== pr.shown) pr.shown = want;
            const target = pr.shown ? 1 : 0;
            if (pr.k === target) continue;
            pr.k += Math.sign(target - pr.k) * Math.min(Math.abs(target - pr.k), dt / 600);
            pr.obj.visible = pr.k > 0.001;
            pr.obj.scale.setScalar(pr.obj.userData.baseScale * ease(pr.k));
        }
        const land = LAND[Math.max(0, Math.min(lp, LAND.length - 1))];
        const k = 1 - Math.exp(-dt / 1800);
        lerpHex(groundMat.color, land.ground, k);
        lerpHex(natureMaterial('grass').color, land.grass, k);
        lerpHex(natureMaterial('leafsGreen').color, land.leafs, k);
        lerpHex(natureMaterial('dirt').color, land.dirt, k);
        lerpHex(waterMat.color, land.water, k);
        riverU.uBankWet.value.lerp(bankTarget(bankGoal, land), k);

        // The river: flowing, or being dammed and running off.
        riverU.uTime.value = clock / 1000;
        applyRiver();
        if (reveal !== null && reveal > -Infinity) {
            const since = clock - reveal;
            const front = riverU.uFront.value;
            if (since > DAM_RISE[0] && since < DAM_RISE[1] + 200) { // the dam grinds up out of the ground
                damDust += dt;
                if (damDust > 90) {
                    damDust = 0;
                    const a = (Math.random() - 0.5) * 3.4;
                    effects.puff(new THREE.Vector3(damPt.x + damPt.nx * a, 0, damPt.z + damPt.nz * a), { color: 0xb9ad98, count: 3, size: 0.38, spread: 0.45 });
                }
            }
            if (front > S_DAM && front < S_LIP) { // dust off the drying bed behind the water
                dustAcc += dt;
                if (dustAcc > 140) {
                    dustAcc = 0;
                    const p = pointAt(front - 1.2 - Math.random() * 1.5);
                    const a = (Math.random() - 0.5) * 2;
                    effects.puff(new THREE.Vector3(p.x + p.nx * a, 0, p.z + p.nz * a), { color: 0xc9ab62, count: 3, size: 0.4, spread: 0.3 });
                }
            }
        }
        if (freed !== null && freed > -Infinity) {
            // The epilogue: the charges go off, the dam sinks in a cloud, the water rushes down the bed.
            const since = clock - freed;
            if (!blasted && since >= DAM_SINK[0]) {
                blasted = true;
                const at = new THREE.Vector3(damPt.x, 0.5, damPt.z);
                effects.sparkle(at, { color: 0xffc04a, count: 26, power: 2.4, size: 0.13 });
                for (let i = 0; i < 5; i++) {
                    const a = (Math.random() - 0.5) * 3.4;
                    effects.puff(new THREE.Vector3(damPt.x + damPt.nx * a, 0.2, damPt.z + damPt.nz * a), { color: 0xb4aea2, count: 8, size: 0.7, spread: 0.9 });
                }
            }
            if (since > DAM_SINK[0] && since < DAM_SINK[1]) {
                damDust += dt;
                if (damDust > 80) {
                    damDust = 0;
                    const a = (Math.random() - 0.5) * 3.4;
                    effects.puff(new THREE.Vector3(damPt.x + damPt.nx * a, 0, damPt.z + damPt.nz * a), { color: 0xb9ad98, count: 3, size: 0.45, spread: 0.5 });
                }
            }
            const fill = riverU.uFill.value;
            if (fill > S_DAM && fill < S_LIP) { // white water at the head of the returning river
                dustAcc += dt;
                if (dustAcc > 110) {
                    dustAcc = 0;
                    const p = pointAt(fill - 0.6);
                    const a = (Math.random() - 0.5) * 1.8;
                    effects.smoke(new THREE.Vector3(p.x + p.nx * a, 0.08, p.z + p.nz * a), { color: 0xf2f8ff, size: 0.22, rise: 0.25, opacity: 0.5 });
                }
            }
        }
        // Spray where the falls drop into the void, while there's water to fall.
        if (riverU.uFront.value < S_LIP + 1 || riverU.uFill.value > S_LIP) {
            sprayAcc += dt;
            if (sprayAcc > 190) {
                sprayAcc = 0;
                const a = (Math.random() - 0.5) * 2.4;
                effects.smoke(new THREE.Vector3(lipP.x + lipN.x * a, -2.3 - Math.random() * 0.8, LIP_Z + 0.45),
                    { color: 0xeaf4fb, size: 0.42, rise: 0.12, opacity: 0.32 });
            }
        }
        splashAcc += dt; // and where the spring's cascade hits the head of the river
        if (splashAcc > 380) {
            splashAcc = 0;
            effects.smoke(new THREE.Vector3(-4.85, 0.06, springZ + (Math.random() - 0.5) * 0.7), { color: 0xf2f8ff, size: 0.16, rise: 0.2, opacity: 0.45 });
        }
        for (const [i, h] of damHalos.entries()) { // NIHIL's beacons blink, alternately
            h.material.opacity = dam.position.y > -0.2 ? (Math.sin(clock / 260 + i * Math.PI) > 0 ? 0.85 : 0.08) : 0;
        }

        updateFence(dt);
        updateShade(dt);

        // The campfire burns until the reveal; then the camp is abandoned (until the epilogue relights it).
        const fireOn = phase < 4 || healed >= 1;
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
        const lampsOn = phase >= 2 && healed < 2; // NIHIL's floodlights go out with its compound
        for (const l of lamps) {
            const target = lampsOn ? 0.75 + Math.sin(clock / 400 + l.position.x) * 0.05 : 0;
            l.material.opacity += (target - l.material.opacity) * Math.min(1, dt / 800);
        }
    }

    return {
        setPhase,
        /** The epilogue's goals done (0–4): the valley mends, one step animated, a jump snapped. */
        setEpilogue,
        /** Where goal `stage` changes the valley ({ x, z } on the ground), or null. */
        epiloguePoint,
        /** The phase the land looks like: the campaign's, minus the epilogue's mending. */
        landPhase: landP,
        /** Set the fence and the shade to land level `p` (Infinite buys land apart from phases); `animate` grows it. */
        setPlot,
        /** Show the cannon site's gravel, or plain ground (an Infinite valley has no cannon). */
        setCannonSite,
        update,
        /** The point to aim at on the headquarters tower (world). */
        hqPoint: () => new THREE.Vector3(HQ.x, 3.4, HQ.z),
        /** The tower comes down (animated), or is set standing / ruined at once (`setHQRuined`). */
        ruinHQ,
        setHQRuined,
        paveCell,
        scorch,
        /** Hide (or restore) a cell's flowers without paving it — under conveyors. */
        coverCell(x, y, covered) {
            const f = flora.get(`${x},${y}`);
            if (f) f.covered = covered;
        },
        /** Ore appeared on a cell (a field laid mid-game): its flowers make way. */
        markOre(x, y) {
            const f = flora.get(`${x},${y}`);
            if (f) f.ore = true;
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
