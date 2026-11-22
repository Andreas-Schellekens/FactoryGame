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
export function memoSVG() {
    return `<svg viewBox="0 0 96 96" class="portrait-svg" role="img" aria-label="Intercepted memo">
        <rect x="2" y="2" width="92" height="92" fill="#1c1608" stroke="${C.mustard}" stroke-opacity="0.6" stroke-width="3" />
        <path d="M28 14 H58 L72 28 V82 H28 Z" fill="${C.paper}" stroke="#8a6a26" stroke-width="3" stroke-linejoin="round" />
        <path d="M58 14 V28 H72" fill="none" stroke="#8a6a26" stroke-width="3" />
        <path d="M36 40 H64 M36 49 H64 M36 58 H54" stroke="#8a6a26" stroke-width="3" stroke-linecap="square" />
        <rect x="34" y="64" width="32" height="9" fill="#1c1608" transform="rotate(-6 50 68)" />
    </svg>`;
}

/** The ending scene: the cannon fires, the Moon breaks, Moon+ switches on. Animated by CSS. */
export function endingSceneSVG() {
    const frags = [
        ['M-14 -10 L0 -22 L10 -6 L-4 2 Z', -150, -90, -70],
        ['M2 -4 L20 -16 L26 4 L10 10 Z', 160, -110, 80],
        ['M-24 4 L-6 0 L-10 20 L-26 18 Z', -170, 60, -120],
        ['M4 8 L22 6 L18 26 L2 22 Z', 140, 90, 140],
        ['M-8 -30 L8 -32 L4 -20 Z', 20, -160, 200],
        ['M-30 -12 L-18 -16 L-20 -2 Z', -200, -20, -160],
    ];
    return `<svg viewBox="0 0 640 340" class="ending-svg">
        <defs><linearGradient id="esky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#05070f" /><stop offset="1" stop-color="#2a0d18" />
        </linearGradient></defs>
        <rect width="640" height="340" fill="url(#esky)" />
        ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 640}" cy="${(i * 53) % 230}" r="${i % 3 ? 0.8 : 1.4}" fill="#fff" opacity="0.6" />`).join('')}
        <g class="end-moon"><circle cx="470" cy="100" r="54" fill="#dfe3ea" stroke="#9aa3b4" stroke-width="2" />
            <circle cx="452" cy="86" r="10" fill="#c3c9d4" /><circle cx="490" cy="118" r="13" fill="#c3c9d4" /><circle cx="486" cy="78" r="6" fill="#c3c9d4" /></g>
        <g transform="translate(470 100)">${frags.map(([d, dx, dy, r]) => `<path class="end-frag" style="--dx:${dx}px;--dy:${dy}px;--r:${r}deg" d="${d}" fill="#cfd5df" stroke="#8a93a3" />`).join('')}</g>
        <line class="end-beam" x1="249" y1="217" x2="470" y2="100" stroke="#ffe08a" stroke-width="7" stroke-linecap="round" />
        <g class="end-billboard"><rect x="384" y="58" width="172" height="84" fill="${C.alarm}" />
            <text x="470" y="106" text-anchor="middle" font-size="40" font-weight="900" fill="#fff" font-family="'Big Shoulders Display', sans-serif">MOON+</text>
            <text x="470" y="126" text-anchor="middle" font-size="10" fill="#ffe1e4" font-family="'IBM Plex Mono', monospace">NOW WITH ADS · 49.99/MO</text></g>
        <rect x="0" y="292" width="640" height="48" fill="#0b0d16" />
        <g fill="#5b6577" stroke="#1d232e" stroke-width="2">
            <polygon points="70,294 250,294 230,268 90,268" />
            <circle cx="160" cy="262" r="20" fill="#7d889c" />
            <rect x="160" y="250" width="100" height="24" rx="4" fill="#a3adbf" transform="rotate(-27 160 262)" />
        </g>
        <rect class="end-flash" width="640" height="340" fill="#fff" />
    </svg>`;
}
