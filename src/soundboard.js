// src/soundboard.js — dev-only sound test panel (open the game with ?sounds).
// Plays every cue and every music mood on demand, so the whole sound design
// can be auditioned without playing through the campaign.
import { CUES } from './sfx.js';
import { SCORE } from './music.js';
import { collectVoiceLines } from './voiceLines.js';

export function mountSoundboard(audio) {
    const panel = document.createElement('div');
    panel.className = 'soundboard';
    const head = document.createElement('div');
    head.className = 'sb-head';
    head.textContent = 'Soundboard · dev';
    panel.appendChild(head);

    const section = (title) => {
        const s = document.createElement('div');
        s.className = 'sb-sec';
        const h = document.createElement('span');
        h.className = 'sb-label';
        h.textContent = title;
        s.appendChild(h);
        panel.appendChild(s);
        return s;
    };
    const button = (parent, label, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            audio.unlock();
            onClick();
        });
        parent.appendChild(b);
        return b;
    };

    const moods = section('Music mood (scale)');
    SCORE.forEach((m, i) => button(moods, `${i} ${m.name} · ${m.mode}`, () => audio.playMood(i)));

    const cues = section('Cues');
    for (const name of Object.keys(CUES)) {
        button(cues, name, () => {
            if (name === 'ending') audio.ending([], []);
            else audio.cue(name, { combo: Math.floor(Math.random() * 6), size: 1, speed: 2 });
        });
    }

    const voice = section('Voice');
    const lines = collectVoiceLines();
    let i = 0;
    const status = document.createElement('span');
    status.className = 'sb-note';
    button(voice, 'Next line', () => {
        const line = lines[i++ % lines.length];
        const ms = audio.lineStart(line, { fresh: true });
        status.textContent = `${line.key} · ${ms ? `${(ms / 1000).toFixed(1)} s` : 'no clip'} · ${line.text.slice(0, 60)}`;
    });
    button(voice, 'Stop', () => audio.lineStop());
    voice.appendChild(status);

    document.body.appendChild(panel);
}
