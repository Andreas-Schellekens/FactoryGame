// src/brand.js — hand-built SVG art for the DOM HUD: the Nile/Nihil logo
// (corrupting phase by phase), DELTA's portrait (tinted by mood), comms
// portraits for broadcasts and memos, the cannon blueprint that fills in as
// phases complete, and the ending scene. Returns SVG markup strings.

const MOOD_COLOR = {
    neutral: '#4fd1ff',
    happy: '#5ef2a0',
    glitch: '#ff5fd2',
    sinister: '#ff4a5a',
};

/**
 * The corporate logo. `stage` = phases completed: 0–1 clean NILE, 2–3 NILE
 * with a NIHIL glitch layer (CSS flickers it in, more often at 3), 4+ NIHIL.
 */
export function logoSVG(stage) {
    const evil = stage >= 4;
    const color = evil ? '#ff4d5e' : '#38bdf8';
    const word = evil ? 'NIHIL' : 'NILE';
    // A river swoosh from N to E with an arrowhead; Nihil flattens it.
    const river = evil
        ? '<path d="M10 43 L150 43" stroke="#ff4d5e" stroke-width="3" stroke-linecap="round" />'
        : `<path d="M10 40 C 34 52, 58 32, 82 42 S 124 50, 140 38" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" />
           <path d="M132 34 L143 37 L136 46" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />`;
    const glitch = stage >= 2 && !evil
        ? `<g class="logo-glitch"><rect x="0" y="0" width="160" height="56" fill="#0e0f14" />
             <text x="80" y="31" text-anchor="middle" class="logo-word" fill="#ff4d5e">NIHIL</text>
             <path d="M10 43 L150 43" stroke="#ff4d5e" stroke-width="3" /></g>`
        : '';
    return `<svg class="logo logo-stage-${Math.min(stage, 4)}" viewBox="0 0 160 56" role="img" aria-label="${word}">
        <text x="80" y="31" text-anchor="middle" class="logo-word" fill="${evil ? '#ff4d5e' : '#e8f4ff'}">${word}</text>
        ${river}
        ${glitch}
    </svg>`;
}

/** DELTA: a river-delta triangle with an eye. */
export function deltaSVG(mood = 'neutral') {
    const c = MOOD_COLOR[mood] ?? MOOD_COLOR.neutral;
    const lid = mood === 'sinister' ? `<path d="M22 31 L42 33" stroke="${c}" stroke-width="2.5" stroke-linecap="round" />` : '';
    return `<svg viewBox="0 0 64 64" class="portrait-svg">
        <rect x="1" y="1" width="62" height="62" rx="12" fill="#0a1220" stroke="${c}" stroke-opacity="0.35" />
        <path d="M32 9 L56 52 L8 52 Z" fill="${c}" fill-opacity="0.08" stroke="${c}" stroke-width="3" stroke-linejoin="round" />
        <path d="M32 14 C 31 30, 23 41, 14 51 M32 14 L32 51 M32 14 C 33 30, 41 41, 50 51" fill="none" stroke="${c}" stroke-opacity="0.45" stroke-width="1.6" />
        <circle cx="32" cy="38" r="8.5" fill="#0a1220" stroke="${c}" stroke-width="2.5" />
        <circle class="pupil" cx="32" cy="38" r="3.6" fill="${c}" />
        ${lid}
    </svg>`;
}

/** Portrait for corporate broadcasts: the river mark in a badge. */
export function broadcastSVG(evil) {
    const c = evil ? '#ff4d5e' : '#38bdf8';
    const mark = evil
        ? `<path d="M14 34 L50 34" stroke="${c}" stroke-width="4" stroke-linecap="round" />`
        : `<path d="M12 36 C 20 44, 28 26, 36 34 S 48 40, 52 30" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" />`;
    return `<svg viewBox="0 0 64 64" class="portrait-svg">
        <rect x="1" y="1" width="62" height="62" rx="12" fill="#0a1220" stroke="${c}" stroke-opacity="0.5" />
        <text x="32" y="24" text-anchor="middle" font-size="11" font-weight="800" letter-spacing="1.5" fill="${c}" font-family="system-ui, Segoe UI, sans-serif">${evil ? 'NIHIL' : 'NILE'}</text>
        ${mark}
    </svg>`;
}

/** Portrait for leaked memos: a folded document. */
export function memoSVG() {
    return `<svg viewBox="0 0 64 64" class="portrait-svg">
        <rect x="1" y="1" width="62" height="62" rx="12" fill="#1c1608" stroke="#f0b64a" stroke-opacity="0.5" />
        <path d="M18 10 H38 L48 20 V54 H18 Z" fill="#f3e6c4" stroke="#8a6a26" stroke-width="2" stroke-linejoin="round" />
        <path d="M38 10 V20 H48" fill="none" stroke="#8a6a26" stroke-width="2" />
        <path d="M23 27 H43 M23 33 H43 M23 39 H36" stroke="#8a6a26" stroke-width="2" stroke-linecap="round" />
        <rect x="21" y="42" width="24" height="7" fill="#1c1608" transform="rotate(-8 33 45)" />
    </svg>`;
}

// ---- Cannon blueprint -------------------------------------------------------
// One shape list per campaign phase (parallel to campaign.js PHASES). Pivot of
// the barrel is (140,92); it aims ~36° up toward the Moon at (222,30).
const AIM = 'rotate(-36 140 92)';
const PARTS = [
    [ // Groundbreaking: foundation
        { t: 'polygon', a: { points: '56,114 204,114 188,98 72,98' }, fill: '#596377' },
        { t: 'rect', a: { x: 68, y: 94, width: 124, height: 5, rx: 1 }, fill: '#717c90' },
    ],
    [ // Targeting: radar mast + dish
        { t: 'rect', a: { x: 86, y: 76, width: 4, height: 19 }, fill: '#8792a6' },
        { t: 'path', a: { d: 'M74 72 Q 86 92 102 70 Z' }, fill: '#c3ccdc' },
        { t: 'circle', a: { cx: 88, cy: 78, r: 2.5 }, fill: '#ff6b6b' },
    ],
    [ // Power core
        { t: 'rect', a: { x: 158, y: 101, width: 26, height: 9, rx: 3 }, fill: '#2cc9ec' },
        { t: 'rect', a: { x: 163, y: 103, width: 16, height: 5, rx: 2 }, fill: '#c9f7ff' },
    ],
    [ // Payload: turret + barrel
        { t: 'circle', a: { cx: 140, cy: 92, r: 13 }, fill: '#7d889c' },
        { t: 'rect', a: { x: 140, y: 85, width: 70, height: 14, rx: 3, transform: AIM }, fill: '#a3adbf' },
    ],
    [ // Ignition: capacitor rings + muzzle glow
        { t: 'rect', a: { x: 160, y: 82, width: 5, height: 20, rx: 1, transform: AIM }, fill: '#ffb547' },
        { t: 'rect', a: { x: 176, y: 82, width: 5, height: 20, rx: 1, transform: AIM }, fill: '#ffb547' },
        { t: 'rect', a: { x: 192, y: 82, width: 5, height: 20, rx: 1, transform: AIM }, fill: '#ffb547' },
        { t: 'circle', a: { cx: 197, cy: 51, r: 5 }, fill: '#ffe08a' },
    ],
];

const attrs = (a) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');

function shape(s, state) {
    if (state === 'done') {
        return `<${s.t} ${attrs(s.a)} fill="${s.fill}" stroke="#1d232e" stroke-width="1.5" />`;
    }
    if (state === 'current') {
        return `<${s.t} ${attrs(s.a)} class="bp" fill="#4fd1ff" fill-opacity="0.08" stroke="#4fd1ff" stroke-width="1.5" stroke-dasharray="4 3" />`;
    }
    return `<${s.t} ${attrs(s.a)} fill="none" stroke="#4fd1ff" stroke-opacity="0.16" stroke-width="1" stroke-dasharray="2 4" />`;
}

const STARS = [[18, 18], [40, 44], [66, 14], [98, 34], [120, 12], [150, 26], [176, 10], [250, 60], [244, 14], [12, 70], [60, 64]];

/** The cannon as built so far. `done` = phases completed (0..PHASES.length). */
export function cannonSVG(done) {
    const evil = done >= 4;
    const finished = done >= PARTS.length;
    const parts = PARTS.map((list, i) => {
        const state = i < done ? 'done' : i === done ? 'current' : 'future';
        return list.map((s) => shape(s, state)).join('');
    }).join('');
    const reticleColor = evil ? '#ff4a5a' : '#4fd1ff';
    const reticle = done >= 2 && !finished
        ? `<g class="reticle" stroke="${reticleColor}" stroke-width="1.2" fill="none" opacity="0.85">
             <circle cx="222" cy="30" r="24" stroke-dasharray="6 4" />
             <path d="M222 2 V14 M222 46 V58 M194 30 H206 M238 30 H250" />
           </g>`
        : '';
    const moon = finished
        ? `<g fill="#cfd5df" stroke="#8a93a3">
             <path d="M214 22 L222 18 L224 27 L216 30 Z" /><path d="M228 24 L236 26 L232 34 Z" />
             <path d="M212 36 L220 34 L218 42 Z" /><path d="M226 38 L234 40 L228 46 Z" />
           </g>
           <rect x="198" y="8" width="48" height="14" rx="3" fill="#ff4a5a" />
           <text x="222" y="18" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">MOON+</text>`
        : `<circle cx="222" cy="30" r="17" fill="#d9dde6" stroke="#9aa3b4" />
           <circle cx="216" cy="25" r="3.5" fill="#b9c0cc" /><circle cx="228" cy="34" r="4.5" fill="#b9c0cc" /><circle cx="226" cy="22" r="2" fill="#b9c0cc" />`;
    return `<svg viewBox="0 0 260 130" class="cannon-svg" role="img" aria-label="Cannon blueprint">
        <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${evil ? '#1e0d22' : '#0a1430'}" /><stop offset="1" stop-color="${evil ? '#2a1424' : '#18244a'}" />
        </linearGradient></defs>
        <rect width="260" height="130" rx="8" fill="url(#sky)" />
        ${STARS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.9" fill="#fff" opacity="0.7" />`).join('')}
        ${moon}${reticle}
        <rect x="0" y="113" width="260" height="17" fill="#141a26" />
        ${parts}
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
            <stop offset="0" stop-color="#05070f" /><stop offset="1" stop-color="#1a1030" />
        </linearGradient></defs>
        <rect width="640" height="340" fill="url(#esky)" />
        ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 640}" cy="${(i * 53) % 230}" r="${i % 3 ? 0.8 : 1.4}" fill="#fff" opacity="0.6" />`).join('')}
        <g class="end-moon"><circle cx="470" cy="100" r="54" fill="#dfe3ea" stroke="#9aa3b4" stroke-width="2" />
            <circle cx="452" cy="86" r="10" fill="#c3c9d4" /><circle cx="490" cy="118" r="13" fill="#c3c9d4" /><circle cx="486" cy="78" r="6" fill="#c3c9d4" /></g>
        <g transform="translate(470 100)">${frags.map(([d, dx, dy, r]) => `<path class="end-frag" style="--dx:${dx}px;--dy:${dy}px;--r:${r}deg" d="${d}" fill="#cfd5df" stroke="#8a93a3" />`).join('')}</g>
        <line class="end-beam" x1="249" y1="217" x2="470" y2="100" stroke="#ffe08a" stroke-width="7" stroke-linecap="round" />
        <g class="end-billboard"><rect x="384" y="58" width="172" height="84" rx="10" fill="#ff4a5a" />
            <text x="470" y="104" text-anchor="middle" font-size="34" font-weight="900" fill="#fff" font-family="system-ui, sans-serif">MOON+</text>
            <text x="470" y="126" text-anchor="middle" font-size="11" fill="#ffe1e4" font-family="system-ui, sans-serif">Now with ads · 49.99/mo</text></g>
        <rect x="0" y="292" width="640" height="48" fill="#0b0d16" />
        <g fill="#5b6577" stroke="#1d232e" stroke-width="2">
            <polygon points="70,294 250,294 230,268 90,268" />
            <circle cx="160" cy="262" r="20" fill="#7d889c" />
            <rect x="160" y="250" width="100" height="24" rx="4" fill="#a3adbf" transform="rotate(-27 160 262)" />
        </g>
        <rect class="end-flash" width="640" height="340" fill="#fff" />
    </svg>`;
}
