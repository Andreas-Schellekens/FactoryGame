#!/usr/bin/env node
// scripts/voice.mjs — records DELTA's (and NILE's) comms lines with
// ElevenLabs text-to-speech into public/assets/voice/, plus manifest.json,
// which the game reads at startup. Lines without a clip stay text-only, so
// this can run any time; only missing or changed lines are generated.
//
//   npm run voice -- --dry                 what would be generated, and how many characters
//   npm run voice                          record every missing line (one take each)
//   npm run voice -- --takes 3             record 3 takes per missing line into voice-takes/
//                                          and write voice-takes/review.html to compare them
//   npm run voice -- pick <key> <n>        use take n of a line as its game clip
//   npm run voice -- --redo "<text>"       re-record lines containing <text> (also with --takes)
//   npm run voice -- --only delta|nile     limit to one speaker
//   npm run voice -- --limit 5             at most 5 lines this run (try a few first)
//   npm run voice -- prune                 delete clips whose line no longer exists
//
// Needs a .env in the project root (never committed):
//   ELEVENLABS_API_KEY=...
//   DELTA_VOICE_ID=...        the voice made in ElevenLabs Voice Design
//   NILE_VOICE_ID=...         optional: the corporate announcer (NILE lines are skipped without it)
//   ELEVENLABS_MODEL=...      optional, default eleven_multilingual_v2
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_DIR = path.join(ROOT, 'public', 'assets', 'voice');
const TAKES_DIR = path.join(ROOT, 'voice-takes');
const MANIFEST = path.join(VOICE_DIR, 'manifest.json');
const { collectVoiceLines } = await import(pathToFileURL(path.join(ROOT, 'src', 'voiceLines.js')).href);

// ---- Config ---------------------------------------------------------------------
function loadEnv() {
    const p = path.join(ROOT, '.env');
    if (!fs.existsSync(p)) return {};
    const env = {};
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const i = line.indexOf('=');
        env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return env;
}
const env = { ...loadEnv(), ...process.env };
const MODEL = env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128'; // constant 128 kbps, so length ≈ bytes / 16 ms

// Delivery per speaker and mood. DELTA: calm and a bit slow; flatter and slower
// when sinister (the joke is that she never raises her voice). NILE: a bright
// corporate announcer.
const STYLE = {
    delta: {
        neutral: { stability: 0.55, similarity_boost: 0.8, style: 0.15, speed: 0.92 },
        happy: { stability: 0.45, similarity_boost: 0.8, style: 0.3, speed: 0.95 },
        sinister: { stability: 0.8, similarity_boost: 0.8, style: 0.05, speed: 0.86 },
        glitch: { stability: 0.3, similarity_boost: 0.75, style: 0.35, speed: 1.0 },
    },
    nile: { neutral: { stability: 0.4, similarity_boost: 0.75, style: 0.5, speed: 1.02 } },
};
const styleFor = (who, mood) => STYLE[who][mood] ?? STYLE[who].neutral;

/** Text as it should be read aloud (keys still hash the on-screen text). */
function spoken(text) {
    return text
        .replace(/™/g, '')
        .replace(/Moon\+/g, 'Moon Plus')
        .replace(/\b[A-Z]{3,}\b/g, (w) => w[0] + w.slice(1).toLowerCase()); // NILE → Nile, not N-I-L-E
}

// ---- Args -----------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'generate';

// ---- Manifest -------------------------------------------------------------------
function readManifest() {
    try {
        return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    } catch {
        return { version: 1, lines: {} };
    }
}
function writeManifest(m) {
    m.lines = Object.fromEntries(Object.entries(m.lines).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

const lines = collectVoiceLines();
const byKey = new Map(lines.map((l) => [l.key, l]));

// ---- ElevenLabs -----------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tts(line) {
    const voiceId = line.who === 'nile' ? env.NILE_VOICE_ID : env.DELTA_VOICE_ID;
    const body = {
        text: spoken(line.text),
        model_id: MODEL,
        voice_settings: { ...styleFor(line.who, line.mood), use_speaker_boost: true },
    };
    // Context from the previous line keeps a multi-line beat sounding like one conversation.
    if (line.previous && MODEL !== 'eleven_v3') body.previous_text = spoken(line.previous);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;
    for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify(body),
        });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        const detail = await res.text();
        if (res.status === 429 || res.status >= 500) {
            console.warn(`  ${res.status}, retrying in ${2 * attempt} s…`);
            await sleep(2000 * attempt);
            continue;
        }
        throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
    }
    throw new Error('ElevenLabs: too many retries');
}
const clipMs = (buf) => Math.round(buf.length / 16);

function requireEnv(who) {
    if (!env.ELEVENLABS_API_KEY) throw new Error('Missing ELEVENLABS_API_KEY in .env');
    if (who.has('delta') && !env.DELTA_VOICE_ID) throw new Error('Missing DELTA_VOICE_ID in .env');
}

// ---- Commands -------------------------------------------------------------------
function selectLines(manifest) {
    const only = opt('only');
    const redo = opt('redo');
    const limit = Number(opt('limit') ?? Infinity);
    let todo = lines.filter((l) => !only || l.who === only);
    if (!env.NILE_VOICE_ID) todo = todo.filter((l) => l.who !== 'nile');
    if (redo) todo = todo.filter((l) => l.text.toLowerCase().includes(redo.toLowerCase()));
    else if (!flag('force')) todo = todo.filter((l) => !manifest.lines[l.key] || !fs.existsSync(path.join(VOICE_DIR, manifest.lines[l.key].file)));
    return todo.slice(0, limit);
}

function writeReview() {
    if (!fs.existsSync(TAKES_DIR)) return;
    const rows = [];
    for (const key of fs.readdirSync(TAKES_DIR).sort()) {
        const dir = path.join(TAKES_DIR, key);
        if (!fs.statSync(dir).isDirectory()) continue;
        const line = byKey.get(key);
        const takes = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        rows.push(`<section><p><b>${key}</b> <i>${line?.mood ?? ''}</i><br>${esc(line?.text ?? '(line no longer in the game)')}</p>${takes
            .map((f, i) => `<div><audio controls preload="none" src="${key}/${f}"></audio> <code>npm run voice -- pick ${key} ${i + 1}</code></div>`)
            .join('')}</section>`);
    }
    fs.writeFileSync(path.join(TAKES_DIR, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Voice takes</title>
<style>body{font:14px system-ui;background:#0e1a2c;color:#f2e8d5;max-width:900px;margin:24px auto;padding:0 16px}section{border-bottom:1px solid #2b3d56;padding:12px 0}code{color:#f3b23c}audio{height:30px;vertical-align:middle}</style>
<h1>Voice takes</h1><p>Listen, then run the pick command for the take you like.</p>${rows.join('\n')}`);
}

async function generate() {
    const manifest = readManifest();
    const todo = selectLines(manifest);
    const takes = Math.max(1, Number(opt('takes') ?? 1));
    const chars = todo.reduce((a, l) => a + spoken(l.text).length, 0);
    console.log(`${todo.length} line(s), ${chars} characters × ${takes} take(s) = ~${chars * takes} credits (model ${MODEL})`);
    if (!env.NILE_VOICE_ID) console.log('No NILE_VOICE_ID: NILE broadcasts are skipped (they stay text-only).');
    if (flag('dry')) {
        for (const l of todo) console.log(`  ${l.key}  ${l.mood ?? ''}  ${l.text.slice(0, 90)}`);
        return;
    }
    if (!todo.length) return;
    requireEnv(new Set(todo.map((l) => l.who)));
    fs.mkdirSync(VOICE_DIR, { recursive: true });
    manifest.model = MODEL;
    manifest.voices = { delta: env.DELTA_VOICE_ID ?? null, nile: env.NILE_VOICE_ID ?? null };
    let n = 0;
    for (const line of todo) {
        n++;
        console.log(`[${n}/${todo.length}] ${line.key}  ${line.text.slice(0, 70)}`);
        if (takes > 1) {
            const dir = path.join(TAKES_DIR, line.key);
            fs.mkdirSync(dir, { recursive: true });
            for (let i = 1; i <= takes; i++) fs.writeFileSync(path.join(dir, `take-${i}.mp3`), await tts(line));
        } else {
            const buf = await tts(line);
            const file = `${line.key}.mp3`;
            fs.writeFileSync(path.join(VOICE_DIR, file), buf);
            manifest.lines[line.key] = { file, ms: clipMs(buf), who: line.who, mood: line.mood, text: line.text };
            writeManifest(manifest); // after every clip, so an interrupted run keeps its progress
        }
    }
    if (takes > 1) {
        writeReview();
        console.log(`Takes written. Open ${path.relative(ROOT, path.join(TAKES_DIR, 'review.html'))} to compare, then pick.`);
    }
}

function pick() {
    const [, key, n] = argv;
    const line = byKey.get(key);
    const src = path.join(TAKES_DIR, key ?? '', `take-${n}.mp3`);
    if (!line) throw new Error(`Unknown line key ${key} (run --dry to list keys)`);
    if (!fs.existsSync(src)) throw new Error(`No take ${n} for ${key}`);
    const manifest = readManifest();
    const buf = fs.readFileSync(src);
    const file = `${key}.mp3`;
    fs.mkdirSync(VOICE_DIR, { recursive: true });
    fs.writeFileSync(path.join(VOICE_DIR, file), buf);
    manifest.lines[key] = { file, ms: clipMs(buf), who: line.who, mood: line.mood, text: line.text };
    writeManifest(manifest);
    console.log(`${key}: take ${n} is now the game clip (${(clipMs(buf) / 1000).toFixed(1)} s)`);
}

function prune() {
    const manifest = readManifest();
    let removed = 0;
    for (const [key, entry] of Object.entries(manifest.lines)) {
        if (byKey.has(key)) continue;
        fs.rmSync(path.join(VOICE_DIR, entry.file), { force: true });
        delete manifest.lines[key];
        removed++;
    }
    writeManifest(manifest);
    console.log(`Removed ${removed} clip(s) for lines that no longer exist.`);
}

try {
    if (command === 'pick') pick();
    else if (command === 'prune') prune();
    else if (command === 'review') writeReview();
    else await generate();
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
