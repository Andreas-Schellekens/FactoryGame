// src/castle.js — the citadel the player raises on NIHIL HQ's crater after the
// Overload ending, as "ruler of Earth" (the CROWN epilogue). Scenery on the east
// rim, off the grid; purely visual. Built like cannon.js: one part per stage
// (walls and gate → the keep → the towers → the crown spire with banners),
// finished parts solid, the next a blueprint hologram (alarm red, a scan line
// sweeping up), later ones hidden; completing a stage materialises it with
// sparks and dust. Stage 0 is the cleared, scorched crater with survey stakes,
// a crane and crates. A dark citadel in the HUD's palette: gunmetal and ash
// stone, black roofs, windows glowing alarm red, red banners with a mustard
// crown. Each part is merged into one mesh per material (a handful of draw calls).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { haloSprite } from './effects.js';

const S = 1.95;    // half the curtain wall's length (corner tower centres)
const T = 0.34;    // wall thickness
const WALL_H = 0.95;
const KEEP = { w: 1.5, h: 2.3, z: -0.2 };

/** A banner's cloth: alarm red with a darker hem, a mustard crown, a swallowtail. */
function bannerTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 320;
    const g = c.getContext('2d');
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(128, 0);
    g.lineTo(128, 320);
    g.lineTo(64, 262);
    g.lineTo(0, 320);
    g.closePath();
    g.fillStyle = '#7a120e';
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#d8261c';
    g.beginPath();
    g.moveTo(10, 10);
    g.lineTo(118, 10);
    g.lineTo(118, 300);
    g.lineTo(64, 248);
    g.lineTo(10, 300);
    g.closePath();
    g.fill();
    // The crown: a band and five points with balls on the tips.
    g.fillStyle = '#f3b23c';
    const cy = 118;
    g.beginPath();
    g.moveTo(26, cy + 26);
    g.lineTo(26, cy - 18);
    g.lineTo(42, cy + 2);
    g.lineTo(52, cy - 30);
    g.lineTo(64, cy - 2);
    g.lineTo(76, cy - 30);
    g.lineTo(86, cy + 2);
    g.lineTo(102, cy - 18);
    g.lineTo(102, cy + 26);
    g.closePath();
    g.fill();
    for (const [x, y] of [[26, cy - 22], [52, cy - 34], [76, cy - 34], [102, cy - 22]]) {
        g.beginPath();
        g.arc(x, y, 5.5, 0, Math.PI * 2);
        g.fill();
    }
    g.fillRect(24, cy + 32, 80, 8);
    g.fillStyle = '#7a120e';
    for (const x of [40, 64, 88]) {
        g.beginPath();
        g.arc(x, cy + 14, 4, 0, Math.PI * 2);
        g.fill();
    }
    g.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** Hazard tape for the survey stakes: alarm red on black. */
function tapeTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#16181d';
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#ff3b30';
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
}

/**
 * @param {THREE.Object3D} scene
 * @param {{ get: (key: string) => THREE.Object3D }} assets
 * @param {ReturnType<typeof import('./effects.js').createEffects>} effects
 * @param {{ x: number, z: number }} at  the crater's centre (NIHIL HQ's site)
 */
export function buildCastle(scene, assets, effects, at) {
    const root = new THREE.Group();
    root.name = 'castle';
    root.position.set(at.x - 0.25, 0, at.z); // a little west, so the east towers stay clear of the cliff
    root.visible = false;
    scene.add(root);

    const mats = {
        stone: new THREE.MeshStandardMaterial({ color: 0x4b4f58, roughness: 0.88, flatShading: true }),
        ash: new THREE.MeshStandardMaterial({ color: 0x6d6c6c, roughness: 0.92, flatShading: true }),
        dark: new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7, metalness: 0.15, flatShading: true }),
        glow: new THREE.MeshStandardMaterial({ color: 0x2a0706, emissive: 0xff3b30, emissiveIntensity: 1.5 }),
        crown: new THREE.MeshStandardMaterial({ color: 0xe0a83a, emissive: 0x6a3a00, emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.7, flatShading: true }),
        banner: new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.5 }),
        pennant: new THREE.MeshStandardMaterial({ color: 0xd8261c, roughness: 0.8, side: THREE.DoubleSide }),
    };

    // ---- Geometry helpers: everything of one material in a part is merged into one mesh ----
    const box = (w, h, d, x, y, z, ry = 0) => new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z);
    const cyl = (r0, r1, h, x, y, z, seg = 12) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z);
    const cone = (r, h, x, y, z, seg = 12, ry = 0) => new THREE.ConeGeometry(r, h, seg).rotateY(ry).translate(x, y, z);
    function part(bins) {
        const g = new THREE.Group();
        for (const [name, geos] of Object.entries(bins)) {
            if (!geos.length) continue;
            const flat = geos.map((q) => (q.index ? q.toNonIndexed() : q));
            for (const q of flat) if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
            const m = new THREE.Mesh(mergeGeometries(flat), mats[name]);
            m.castShadow = name !== 'glow';
            m.receiveShadow = true;
            m.userData.solid = mats[name];
            m.userData.kind = name;
            g.add(m);
        }
        return g;
    }
    const bins = () => ({ stone: [], ash: [], dark: [], glow: [], crown: [], banner: [], pennant: [] });
    /** Merlons along a wall top from (x0, z0) to (x1, z1). */
    function merlons(b, x0, z0, x1, z1, y, depth, mat = 'stone') {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(2, Math.round(len / 0.3));
        const ry = -Math.atan2(z1 - z0, x1 - x0);
        for (let i = 0; i < n; i++) {
            const k = (i + 0.5) / n;
            b[mat].push(box(0.15, 0.17, depth, x0 + (x1 - x0) * k, y + 0.085, z0 + (z1 - z0) * k, ry));
        }
    }
    /** A ring of merlons round a round top. */
    function ringMerlons(b, x, z, r, y, n = 8, mat = 'stone') {
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            b[mat].push(box(0.12, 0.15, 0.1, x + Math.cos(a) * r, y + 0.075, z + Math.sin(a) * r, -a));
        }
    }
    /** A window slit glowing from inside, on a face with outward normal (nx, nz). */
    const slit = (b, x, y, z, nx, nz, h = 0.3) => b.glow.push(box(Math.abs(nz) > 0 ? 0.08 : 0.03, h, Math.abs(nx) > 0 ? 0.08 : 0.03, x + nx * 0.012, y, z + nz * 0.012));

    const parts = [];
    // Stage 1: the curtain wall with crenellations, a battered plinth, and the gatehouse (south, +z,
    // the side the default view sees) flanked by two square gate towers.
    {
        const b = bins();
        const sides = [[-S, -S, S, -S], [S, -S, S, S], [-S, S, -S, -S]]; // north, east, west
        for (const [x0, z0, x1, z1] of sides) {
            const len = Math.hypot(x1 - x0, z1 - z0);
            const cx = (x0 + x1) / 2;
            const cz = (z0 + z1) / 2;
            const ry = -Math.atan2(z1 - z0, x1 - x0);
            b.stone.push(box(len, WALL_H, T, cx, WALL_H / 2, cz, ry));
            b.dark.push(box(len, 0.24, T + 0.12, cx, 0.12, cz, ry));
            merlons(b, x0, z0, x1, z1, WALL_H, T + 0.02);
        }
        // The south wall, in two halves either side of the gatehouse.
        for (const side of [-1, 1]) {
            const x0 = side * 0.95;
            const x1 = side * S;
            b.stone.push(box(Math.abs(x1 - x0), WALL_H, T, (x0 + x1) / 2, WALL_H / 2, S));
            b.dark.push(box(Math.abs(x1 - x0), 0.24, T + 0.12, (x0 + x1) / 2, 0.12, S));
            merlons(b, x0, S, x1, S, WALL_H, T + 0.02);
            // The gate towers.
            b.stone.push(box(0.52, 1.6, 0.6, side * 0.72, 0.8, S + 0.04));
            b.dark.push(box(0.6, 0.12, 0.68, side * 0.72, 1.6, S + 0.04));
            ringMerlons(b, side * 0.72, S + 0.04, 0.24, 1.66, 6);
            slit(b, side * 0.72, 1.15, S + 0.34, 0, 1, 0.26);
        }
        // The gatehouse between them: a dark arch, a red lintel, the portcullis's bars.
        b.ash.push(box(0.92, 1.25, 0.56, 0, 0.625, S + 0.02));
        merlons(b, -0.46, S + 0.02, 0.46, S + 0.02, 1.25, 0.58);
        b.dark.push(box(0.5, 0.74, 0.04, 0, 0.37, S + 0.31));
        b.glow.push(box(0.42, 0.05, 0.03, 0, 0.8, S + 0.33));
        for (const x of [-0.16, -0.05, 0.06, 0.17]) b.ash.push(box(0.025, 0.7, 0.03, x, 0.36, S + 0.34));
        // Arrow slits along the walls the view sees.
        for (const z of [-1.1, 0, 1.1]) slit(b, S + T / 2, 0.55, z, 1, 0);
        for (const x of [-1.45, 1.45]) slit(b, x, 0.55, S + T / 2, 0, 1);
        parts.push(part(b));
    }
    // Stage 2: the keep, a tall block with a corbelled, crenellated top, a door and glowing slits.
    {
        const b = bins();
        const { w, h, z } = KEEP;
        b.stone.push(box(w, h, w, 0, h / 2, z));
        b.dark.push(box(w + 0.1, 0.18, w + 0.1, 0, 0.09, z));
        b.ash.push(box(w + 0.18, 0.14, w + 0.18, 0, h + 0.05, z));
        for (const [x0, z0, x1, z1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
            const r = (w + 0.18) / 2 - 0.05;
            merlons(b, x0 * r, z + z0 * r, x1 * r, z + z1 * r, h + 0.12, 0.12, 'ash');
        }
        b.dark.push(box(0.36, 0.56, 0.04, 0, 0.28, z + w / 2 + 0.01));
        b.glow.push(box(0.3, 0.04, 0.03, 0, 0.6, z + w / 2 + 0.02));
        for (const y of [1.05, 1.65]) {
            for (const o of [-0.38, 0.38]) {
                slit(b, o, y, z + w / 2, 0, 1);
                slit(b, w / 2, y, z + o, 1, 0);
            }
        }
        parts.push(part(b));
    }
    // Stage 3: four round corner towers with black conical roofs, and two turrets on the keep.
    {
        const b = bins();
        for (const [x, z] of [[-S, -S], [S, -S], [S, S], [-S, S]]) {
            b.stone.push(cyl(0.4, 0.48, 1.6, x, 0.8, z, 12));
            b.dark.push(cyl(0.5, 0.5, 0.14, x, 0.07, z, 12));
            b.ash.push(cyl(0.47, 0.47, 0.1, x, 1.65, z, 12));
            ringMerlons(b, x, z, 0.42, 1.7, 8, 'ash');
            b.dark.push(cone(0.46, 0.95, x, 2.35, z, 12));
            const nx = Math.sign(x);
            const nz = Math.sign(z);
            if (nx > 0) slit(b, x + 0.43, 1.0, z, 1, 0, 0.26);
            if (nz > 0) slit(b, x, 1.0, z + 0.43, 0, 1, 0.26);
        }
        const top = KEEP.h + 0.12;
        for (const [x, z] of [[KEEP.w / 2, KEEP.z + KEEP.w / 2], [-KEEP.w / 2, KEEP.z - KEEP.w / 2]]) {
            b.stone.push(cyl(0.2, 0.22, 0.7, x, top + 0.35, z, 10));
            b.dark.push(cone(0.25, 0.6, x, top + 1.0, z, 10));
            slit(b, x + 0.205 * Math.sign(x), top + 0.4, z, Math.sign(x), 0, 0.18);
        }
        parts.push(part(b));
    }
    // Stage 4: the crown spire on the keep, the crown on its tip, a pennant above it, and red
    // banners down the faces the view sees.
    const bannerGroup = { mesh: null, base: null, weight: null, phase: null };
    const pennant = { mesh: null, base: null };
    {
        const b = bins();
        const top = KEEP.h + 0.12;
        b.dark.push(cone(0.5, 2.1, 0, top + 1.05, KEEP.z, 4, Math.PI / 4));
        b.ash.push(box(0.56, 0.16, 0.56, 0, top + 0.08, KEEP.z, Math.PI / 4));
        // The crown: a band with five points, a ball on each.
        const cy = top + 2.1 + 0.05;
        b.crown.push(cyl(0.27, 0.24, 0.2, 0, cy, KEEP.z, 16));
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const x = Math.cos(a) * 0.24;
            const z = KEEP.z + Math.sin(a) * 0.24;
            b.crown.push(cone(0.075, 0.26, x, cy + 0.22, z, 6));
            b.crown.push(new THREE.SphereGeometry(0.045, 8, 6).translate(x, cy + 0.37, z));
        }
        b.glow.push(cyl(0.276, 0.276, 0.04, 0, cy - 0.02, KEEP.z, 16));
        b.dark.push(cyl(0.018, 0.018, 0.75, 0, cy + 0.45, KEEP.z, 6));
        const g = part(b);
        // Banners: one merged, double-sided mesh; every vertex remembers how far it hangs.
        const quads = [
            // [x, yTop, z, normal x, normal z, width, length]
            [0, 1.95, KEEP.z + KEEP.w / 2 + 0.02, 0, 1, 0.5, 1.25],
            [KEEP.w / 2 + 0.02, 1.95, KEEP.z, 1, 0, 0.5, 1.25],
            [0, 1.22, S + 0.32, 0, 1, 0.34, 0.4],
            [S + 0.49, 1.42, S - 0.05, 1, 0, 0.3, 0.8],
            [-S - 0.05, 1.42, S + 0.49, 0, 1, 0.3, 0.8],
            [S + 0.49, 1.42, -S + 0.05, 1, 0, 0.3, 0.8],
        ];
        const geos = [];
        const weights = [];
        const phases = [];
        quads.forEach(([x, y, z, nx, nz, w, len], i) => {
            const q = new THREE.PlaneGeometry(w, len, 1, 6).translate(0, -len / 2, 0);
            q.rotateY(Math.atan2(nx, nz));
            q.translate(x, y, z);
            const p = q.attributes.position;
            for (let v = 0; v < p.count; v++) {
                weights.push((y - p.getY(v)) / len);
                phases.push(i * 1.7);
            }
            geos.push(q);
        });
        const merged = mergeGeometries(geos.map((q) => q.toNonIndexed()));
        const mesh = new THREE.Mesh(merged, mats.banner);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.solid = mats.banner;
        g.add(mesh);
        bannerGroup.mesh = mesh;
        bannerGroup.base = Float32Array.from(merged.attributes.position.array);
        bannerGroup.weight = weights.length === merged.attributes.position.count ? weights : expand(weights, geos);
        bannerGroup.phase = phases.length === merged.attributes.position.count ? phases : expand(phases, geos);
        // A pennant streaming off the mast above the crown.
        const pg = new THREE.BufferGeometry();
        const L = 0.7;
        const pts = [];
        const N = 6;
        for (let i = 0; i < N; i++) {
            const u0 = i / N;
            const u1 = (i + 1) / N;
            const h0 = 0.16 * (1 - u0);
            const h1 = 0.16 * (1 - u1);
            pts.push(u0 * L, h0, 0, u0 * L, -h0, 0, u1 * L, -h1, 0, u0 * L, h0, 0, u1 * L, -h1, 0, u1 * L, h1, 0);
        }
        pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        pg.computeVertexNormals();
        const pm = new THREE.Mesh(pg, mats.pennant);
        pm.position.set(0, cy + 0.7, KEEP.z);
        pm.rotation.y = -0.5;
        pm.castShadow = true;
        pm.userData.solid = mats.pennant;
        g.add(pm);
        pennant.mesh = pm;
        pennant.base = Float32Array.from(pts);
        parts.push(g);
    }
    /** Per-geometry vertex data, re-expanded after toNonIndexed() (indexed planes). */
    function expand(values, geos) {
        const out = [];
        let off = 0;
        for (const q of geos) {
            const n = q.attributes.position.count;
            const idx = q.index ? q.index.array : null;
            if (!idx) {
                for (let v = 0; v < n; v++) out.push(values[off + v]);
            } else {
                for (let k = 0; k < idx.length; k++) out.push(values[off + idx[k]]);
            }
            off += n;
        }
        return out;
    }
    parts.forEach((p) => root.add(p));

    // ---- Stage 0: the cleared crater: a berm of rubble pushed to its rim, survey stakes ------
    const site = new THREE.Group(); // stakes, crane, crates: gone once the castle is finished
    root.add(site);
    {
        const r = (() => {
            let a = 97;
            return () => ((a = (a * 16807) % 2147483647) / 2147483647);
        })();
        const N = 30;
        const berm = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), mats.ash, N);
        const m = new THREE.Matrix4();
        let n = 0;
        for (let i = 0; i < N * 2 && n < N; i++) {
            const a = r() * Math.PI * 2;
            const d = 3.15 + r() * 0.5;
            const x = Math.cos(a) * d;
            const z = Math.sin(a) * d;
            if (root.position.x + x > 37.7) continue; // not over the cliff
            const s = 0.22 + r() * 0.32;
            m.compose(new THREE.Vector3(x, s * 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(s, s * 0.6, s * 0.8));
            berm.setMatrixAt(n++, m);
        }
        berm.count = n;
        berm.castShadow = berm.receiveShadow = true;
        root.add(berm);
    }
    // Survey stakes round the walls' line (orange tips), red-and-black tape between them.
    const stakes = new THREE.Group();
    site.add(stakes);
    {
        const posts = [];
        const R = S + 0.25;
        const corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
        corners.forEach(([x0, z0], e) => {
            const [x1, z1] = corners[(e + 1) % 4];
            for (let i = 0; i < 4; i++) posts.push([x0 + ((x1 - x0) * i) / 4, z0 + ((z1 - z0) * i) / 4]);
        });
        const wood = [];
        const tips = [];
        for (const [x, z] of posts) {
            wood.push(box(0.05, 0.3, 0.05, x, 0.15, z));
            tips.push(box(0.056, 0.07, 0.056, x, 0.33, z));
        }
        const wm = new THREE.Mesh(mergeGeometries(wood), new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.85 }));
        const tm = new THREE.Mesh(mergeGeometries(tips), new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }));
        wm.castShadow = tm.castShadow = true;
        stakes.add(wm, tm);
        const tex = tapeTexture();
        const tapes = [];
        corners.forEach(([x0, z0], e) => {
            const [x1, z1] = corners[(e + 1) % 4];
            const len = Math.hypot(x1 - x0, z1 - z0);
            tapes.push(new THREE.PlaneGeometry(len, 0.07).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, 0.24, (z0 + z1) / 2));
        });
        tex.repeat.set(R * 2 * 3, 1);
        const tape = new THREE.Mesh(mergeGeometries(tapes), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 }));
        stakes.add(tape);
    }
    // The yard: a crane and crates outside the walls while it goes up.
    const crane = assets.get('siteCrane');
    crane.position.set(-S - 1.05, 0, S + 0.55);
    crane.rotation.y = Math.PI * 0.25;
    site.add(crane);
    for (const [key, x, z, rot] of [['siteCrate', -S - 0.9, -0.6, 0.3], ['siteCrateSmall', -S - 0.95, -0.2, 1.1], ['siteCrate', 0.9, S + 1.0, 0.8]]) {
        const c = assets.get(key);
        c.position.set(x, 0, z);
        c.rotation.y = rot;
        site.add(c);
    }
    const beacons = [];
    for (const [x, z] of [[-S - 0.6, S + 0.9], [S + 0.3, S + 1.0]]) {
        const b = assets.get('siteBeacon');
        b.position.set(x, 0, z);
        site.add(b);
        const glow = haloSprite(0xff3b30, 0.5);
        glow.position.set(x, 0.62, z);
        site.add(glow);
        beacons.push(glow);
    }
    // The gate's fire-glow, lit once the walls stand.
    const gateGlow = haloSprite(0xff4a2a, 1.1);
    gateGlow.position.set(0, 0.45, S + 0.45);
    gateGlow.material.opacity = 0;
    root.add(gateGlow);

    // ---- Blueprint hologram (as cannon.js, in alarm red) ----------------------------------
    const HOLO = 0xff4d5e;
    const holoFill = new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const holoLine = new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.9, depthWrite: false });
    const scanMat = new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.8, depthWrite: false });
    function setLook(p, look) {
        p.visible = look !== 'hidden';
        const holo = look === 'holo';
        p.traverse((o) => {
            if (!o.isMesh) return;
            o.material = holo ? holoFill : o.userData.solid;
            o.castShadow = look === 'solid' && o.userData.kind !== 'glow';
            if (holo && !o.userData.edges) {
                const lines = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), holoLine);
                lines.renderOrder = 2;
                o.add(lines);
                o.userData.edges = lines;
            }
            if (o.userData.edges) o.userData.edges.visible = holo;
        });
    }
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

    let stage = -1; // -1: no castle (the ruin or the tower stands there)
    let pop = null;
    /**
     * Show the castle at `s` stages done (0–4; -1 hides it). One step forward animates (the
     * hologram materialises with sparks and dust); anything else, or `instant`, snaps.
     */
    function setStage(s, instant = false) {
        const next = s == null || s < 0 ? -1 : Math.min(4, Math.floor(s));
        if (next === stage) return;
        const animate = !instant && stage >= 0 && next === stage + 1;
        stage = next;
        root.visible = stage >= 0;
        if (stage < 0) return;
        parts.forEach((p, i) => setLook(p, i < stage ? 'solid' : i === stage ? 'holo' : 'hidden'));
        site.visible = stage < 4;
        stakes.visible = stage === 0;
        scan.visible = stage < 4;
        if (stage < 4) {
            parts[stage].updateWorldMatrix(true, true);
            scanBox.setFromObject(parts[stage]);
            scanBox.min.sub(root.position);
            scanBox.max.sub(root.position);
            scan.scale.set(scanBox.max.x - scanBox.min.x + 0.16, 1, scanBox.max.z - scanBox.min.z + 0.16);
            scan.position.x = (scanBox.min.x + scanBox.max.x) / 2;
            scan.position.z = (scanBox.min.z + scanBox.max.z) / 2;
        }
        if (animate) {
            const p = parts[stage - 1];
            pop = { part: p, t: 0 };
            const box3 = new THREE.Box3().setFromObject(p);
            const mid = box3.getCenter(new THREE.Vector3());
            const top = new THREE.Vector3(mid.x, box3.max.y * 0.7, mid.z);
            effects.sparkle(top, { count: 44, power: 2.6, color: 0xff6a5a });
            effects.sparkle(top, { count: 26, power: 2, color: 0xffd54a });
            for (const [x, z] of [[-S, -S], [S, -S], [S, S], [-S, S], [0, 0]]) {
                effects.puff(new THREE.Vector3(root.position.x + x, 0.1, root.position.z + z), { count: 8, size: 0.6, spread: 1.2, color: 0x8a8580 });
            }
            if (stage === 4) effects.puff(new THREE.Vector3(root.position.x - S - 0.8, 0.2, root.position.z + S), { count: 18, size: 0.7, spread: 1.8, color: 0x8a8580 }); // the yard is cleared
        }
    }

    function update(dt, timeMs) {
        if (!root.visible) return;
        holoLine.opacity = 0.8 + 0.2 * Math.sin(timeMs / 300);
        holoFill.opacity = 0.16 + 0.06 * Math.sin(timeMs / 300);
        if (scan.visible) {
            const k = (timeMs % 2600) / 2600;
            scan.position.y = scanBox.min.y + (scanBox.max.y - scanBox.min.y) * k;
            scanMat.opacity = 0.85 * Math.sin(Math.PI * k);
        }
        if (site.visible) {
            crane.rotation.y = Math.PI * 0.25 + Math.sin(timeMs / 2900) * 0.5;
            beacons.forEach((b, i) => (b.material.opacity = Math.sin(timeMs / 280 + i * Math.PI) > 0.2 ? 0.95 : 0.1));
        }
        mats.glow.emissiveIntensity = 1.35 + 0.25 * Math.sin(timeMs / 700) + 0.1 * Math.sin(timeMs / 97);
        gateGlow.material.opacity = stage >= 1 ? 0.45 + 0.12 * Math.sin(timeMs / 130) : 0;
        if (stage >= 4) {
            // The banners sway against the walls; the pennant streams in the wind.
            const t = timeMs / 1000;
            const pos = bannerGroup.mesh.geometry.attributes.position;
            const nor = bannerGroup.mesh.geometry.attributes.normal;
            const base = bannerGroup.base;
            for (let i = 0; i < pos.count; i++) {
                const w = bannerGroup.weight[i];
                const off = Math.sin(t * 1.6 + bannerGroup.phase[i] + w * 2.2) * 0.045 * w;
                pos.setXYZ(i, base[i * 3] + nor.getX(i) * off, base[i * 3 + 1], base[i * 3 + 2] + nor.getZ(i) * off);
            }
            pos.needsUpdate = true;
            const pp = pennant.mesh.geometry.attributes.position;
            for (let i = 0; i < pp.count; i++) {
                const x = pennant.base[i * 3];
                pp.setZ(i, Math.sin(x * 9 - t * 6) * 0.06 * (x / 0.7));
            }
            pp.needsUpdate = true;
        }
        if (pop) {
            pop.t = Math.min(1, pop.t + dt / 650);
            pop.part.scale.setScalar(1 + Math.sin(pop.t * Math.PI) * 0.06);
            if (pop.t >= 1) {
                pop.part.scale.setScalar(1);
                pop = null;
            }
        }
    }

    return {
        setStage,
        update,
        get stage() {
            return stage;
        },
        /** Where to glide the camera to (world x/z of the castle). */
        point: () => ({ x: root.position.x, z: root.position.z }),
    };
}
