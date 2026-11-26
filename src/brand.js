// src/brand.js — the brand art for the HUD, as SVG markup strings (design:
// "D · Mission Control" on the Nile Brand Directions canvas). NILE's company
// mark is a delta (Δv, three branches) in a frame; for NIHIL it collapses to
// a flat line. Protocol: Selene wears a mission patch with the same delta.
// DELTA, the AI, is an oscilloscope badge whose trace follows its mood.

const C = {
    midnight: '#0e1a2c',
    well: '#0b1524',
    hair: '#2b3d56',
    paper: '#f2e8d5',
    signal: '#ff6a13',
    sunset: '#f2674a',
    mustard: '#f3b23c',
    teal: '#3cc8b4',
    alarm: '#ff3b30',
};

const DELTA_PATH = 'M37 14 L37 60 M37 14 C 37 34, 22 46, 16 60 M37 14 C 37 34, 52 46, 58 60';
const FLAT_PATH = 'M14 37 L 60 37';

/** The NILE company mark (delta in a frame); NIHIL's is a flat line. */
export function markSVG(evil = false, size = 30) {
    const frame = evil ? C.alarm : C.paper;
    const stroke = evil ? C.alarm : C.signal;
    return `<svg width="${size}" height="${size}" viewBox="0 0 74 74" aria-hidden="true">
        <rect x="2" y="2" width="70" height="70" fill="none" stroke="${frame}" stroke-width="4" />
        <path d="${evil ? FLAT_PATH : DELTA_PATH}" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="square" />
    </svg>`;
}

let patchId = 0;
/** The Protocol: Selene mission patch. Defaced after the reveal. */
/**
 * Your own company's mark: its initials (letters and digits only, so a typed name can never
 * inject markup) in a square frame.
 */
export function companyMarkSVG(name = '', size = 30) {
    const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? 'S').slice(0, 2)) || 'S';
    return `<svg width="${size}" height="${size}" viewBox="0 0 74 74" aria-hidden="true">
        <rect x="5" y="5" width="64" height="64" fill="none" stroke="${C.paper}" stroke-width="5" />
        <text x="37" y="51" text-anchor="middle" font-family="'Big Shoulders Display', Impact, sans-serif" font-weight="800" font-size="36" fill="${C.signal}">${initials}</text>
    </svg>`;
}

export function patchSVG(evil = false, size = 46, { text = true } = {}) {
    const id = `patch${patchId++}`;
    const sky = evil ? '#4a2228' : C.sunset;
    const trace = evil ? 'M40 92 L 110 92' : 'M75 42 L75 118 M75 42 C 75 74, 56 92, 46 112 M75 42 C 75 74, 94 92, 104 112';
    const labels = text
        ? `<defs>
             <path id="${id}t" d="M 22 75 A 53 53 0 0 1 128 75" />
             <path id="${id}b" d="M 18 75 A 57 57 0 0 0 132 75" />
           </defs>
           <text font-family="'Big Shoulders Display', sans-serif" font-weight="900" font-size="14" letter-spacing="3" fill="${evil ? C.alarm : C.mustard}"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">PROTOCOL: SELENE</textPath></text>
           <text font-family="'IBM Plex Mono', monospace" font-weight="500" font-size="8" letter-spacing="2" fill="${C.paper}"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">${evil ? 'A PROJECT OF NIHIL' : 'AN INITIATIVE BY NILE'}</textPath></text>`
        : '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 150 150" role="img" aria-label="Protocol: Selene mission patch">
        ${evil ? `<circle cx="79" cy="79" r="71" fill="${C.alarm}" opacity="0.45" />` : ''}
        <circle cx="75" cy="75" r="72" fill="${C.midnight}" stroke="${C.paper}" stroke-width="2.5" />
        <circle cx="75" cy="75" r="47" fill="${sky}" />
        <circle cx="96" cy="58" r="11" fill="${C.paper}" />
        ${evil ? `<circle cx="96" cy="58" r="19" fill="none" stroke="${C.alarm}" stroke-width="4" /><path d="M96 34 v10 M96 72 v10 M72 58 h10 M110 58 h10" stroke="${C.alarm}" stroke-width="3" />` : ''}
        <path d="${trace}" fill="none" stroke="${C.midnight}" stroke-width="6" stroke-linecap="square" />
        <path d="${trace}" fill="none" stroke="${evil ? C.alarm : C.teal}" stroke-width="2.5" stroke-linecap="square" />
        ${labels}
    </svg>`;
}

const MOOD = {
    neutral: { trace: C.teal, ring: C.hair, rays: C.mustard, wave: 'M18 48 h8 l4 -12 l6 26 l6 -32 l6 38 l6 -26 l6 14 l4 -8 h8' },
    happy: { trace: '#6ff2cf', ring: C.hair, rays: C.mustard, wave: 'M18 48 c 6 -14, 10 -14, 15 0 s 9 14, 15 0 s 9 -14, 15 0 s 9 14, 15 0' },
    glitch: { trace: '#ff5fd2', ring: '#5a2a50', rays: '#7a3a6a', wave: 'M18 48 h6 l2 -18 l3 30 l2 -6 h6 l3 -24 l2 34 l4 -14 h4 l2 8 l3 -4 h11' },
    sinister: { trace: C.alarm, ring: C.alarm, rays: '#5a2a2e', wave: 'M18 48 h60' },
};

/** DELTA: an oscilloscope badge; the trace changes with its mood. */
export function deltaSVG(mood = 'neutral') {
    const m = MOOD[mood] ?? MOOD.neutral;
    return `<svg viewBox="0 0 96 96" class="portrait-svg" role="img" aria-label="DELTA">
        <circle cx="48" cy="48" r="45" fill="${C.well}" stroke="${m.ring}" stroke-width="3" />
        <path d="M48 4 v7 M48 85 v7 M4 48 h7 M85 48 h7 M17 17 l5 5 M74 74 l5 5 M17 79 l5 -5 M74 22 l5 -5" stroke="${m.rays}" stroke-width="3" />
        <path class="trace" d="${m.wave}" fill="none" stroke="${m.trace}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />
    </svg>`;
}

/** Portrait for corporate broadcasts: the company mark on a console well. */
export function broadcastSVG(evil) {
    return `<svg viewBox="0 0 96 96" class="portrait-svg" role="img" aria-label="${evil ? 'NIHIL' : 'NILE'} broadcast">
        <rect x="2" y="2" width="92" height="92" fill="${C.well}" stroke="${evil ? C.alarm : C.hair}" stroke-width="3" />
        <g transform="translate(19 19) scale(0.78)">
            <rect x="2" y="2" width="70" height="70" fill="none" stroke="${evil ? C.alarm : C.paper}" stroke-width="4" />
            <path d="${evil ? FLAT_PATH : DELTA_PATH}" fill="none" stroke="${evil ? C.alarm : C.signal}" stroke-width="5" stroke-linecap="square" />
        </g>
    </svg>`;
}

/** Portrait for leaked memos: a folded document with a redaction. */
/** Nolan Isaac Locke: a backlit executive silhouette, white collar, NIHIL-red tie. */
export function bossSVG() {
    return `<svg viewBox="0 0 96 96" class="portrait-svg" role="img" aria-label="Nolan Isaac Locke">
        <rect x="2" y="2" width="92" height="92" fill="#0a0b10" stroke="${C.alarm}" stroke-opacity="0.7" stroke-width="3" />
        <circle cx="48" cy="40" r="30" fill="${C.alarm}" fill-opacity="0.16" />
        <path d="M14 94 C 16 72, 30 64, 48 64 C 66 64, 80 72, 82 94 Z" fill="#1a1d26" />
        <path d="M40 64 L48 80 L56 64 Z" fill="${C.paper}" />
        <path d="M46 66 L50 66 L52 86 L48 92 L44 86 Z" fill="${C.alarm}" />
        <ellipse cx="48" cy="40" rx="13" ry="16" fill="#1a1d26" />
        <path d="M35 34 C 36 22, 60 22, 61 34 C 56 28, 40 28, 35 34 Z" fill="#2a2f3c" />
    </svg>`;
}

export function memoSVG() {
    return `<svg viewBox="0 0 96 96" class="portrait-svg" role="img" aria-label="Intercepted memo">
        <rect x="2" y="2" width="92" height="92" fill="#1c1608" stroke="${C.mustard}" stroke-opacity="0.6" stroke-width="3" />
        <path d="M28 14 H58 L72 28 V82 H28 Z" fill="${C.paper}" stroke="#8a6a26" stroke-width="3" stroke-linejoin="round" />
        <path d="M58 14 V28 H72" fill="none" stroke="#8a6a26" stroke-width="3" />
        <path d="M36 40 H64 M36 49 H64 M36 58 H54" stroke="#8a6a26" stroke-width="3" stroke-linecap="square" />
        <rect x="34" y="64" width="32" height="9" fill="#1c1608" transform="rotate(-6 50 68)" />
    </svg>`;
}

// ---- After the Overload ending (iteration 8): CROWN and VASSAL ---------------------------------
const ASH = { bone: '#e4ded2', ash: '#8f8a83', soot: '#16161a', ember: '#ff5a3c' };

/** CROWN's mark: a three-point crown over a bar, bone on soot, in a square frame. */
export function crownMarkSVG(size = 30) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 74 74" aria-hidden="true">
        <rect x="2" y="2" width="70" height="70" fill="none" stroke="${ASH.bone}" stroke-width="4" />
        <path d="M16 50 L16 24 L28 38 L37 18 L46 38 L58 24 L58 50 Z" fill="none" stroke="${ASH.bone}" stroke-width="4.5" stroke-linejoin="miter" />
        <path d="M16 58 H58" stroke="${ASH.ember}" stroke-width="5" stroke-linecap="square" />
    </svg>`;
}

/** VASSAL: no face and no wave, a lens of nested squares with one ember pixel. */
export function vassalSVG() {
    return `<svg viewBox="0 0 96 96" class="portrait-svg vassal-svg" role="img" aria-label="VASSAL">
        <rect x="2" y="2" width="92" height="92" fill="${ASH.soot}" stroke="${ASH.ash}" stroke-width="3" />
        <rect x="18" y="18" width="60" height="60" fill="none" stroke="${ASH.ash}" stroke-width="2" />
        <rect x="28" y="28" width="40" height="40" fill="none" stroke="${ASH.bone}" stroke-opacity="0.7" stroke-width="2" />
        <rect x="38" y="38" width="20" height="20" fill="none" stroke="${ASH.bone}" stroke-width="3" />
        <rect class="trace" x="44" y="44" width="8" height="8" fill="${ASH.ember}" />
        <path d="M8 48 H18 M78 48 H88 M48 8 V18 M48 78 V88" stroke="${ASH.ash}" stroke-width="2" />
    </svg>`;
}
