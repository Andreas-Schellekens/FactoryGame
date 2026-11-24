// src/viewer.js — the factory viewer's bar (iteration 7). main.js builds another player's
// leaderboard factory on a fresh Infinite map and runs it, read-only (no slot, no autosave,
// no building); this is the strip across the top: whose factory, what it scored and when,
// what it makes right now, and Copy as blueprint / Share link / Back. Plus the share link
// itself (`/?factory=<id>`) and sharing it.

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function button(label, onClick, cls = 'btn-secondary') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}
const fmtNum = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2));

/** The page address that opens a leaderboard factory in the viewer. */
export const factoryLink = (id) => `${location.origin}/?factory=${encodeURIComponent(id)}`;

/** A factory id from the address (`?factory=12`), or null. */
export function linkedFactory() {
    try {
        const id = new URLSearchParams(location.search).get('factory');
        return id && /^\d{1,18}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}

/**
 * Share a link: the share sheet on touch devices that have one, the clipboard elsewhere.
 * @returns {Promise<'shared'|'copied'|'shown'>} 'shown': neither worked, show the link
 */
export async function shareLink(url, title) {
    let touch = false;
    try {
        touch = window.matchMedia('(pointer: coarse)').matches;
    } catch { /* old browser */ }
    if (touch && navigator.share) {
        try {
            await navigator.share({ title, url });
            return 'shared';
        } catch (e) {
            if (e?.name === 'AbortError') return 'shared'; // they closed the sheet
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        return 'copied';
    } catch {
        return 'shown';
    }
}

/**
 * The bar. Starts in a loading state; `show(factory)` fills it, `fail(message)` says why
 * there's nothing to see. Callbacks: onCopy(factory), onBack().
 * @returns {{ show(f: any): void, fail(msg: string): void, setLive(perMinute: number|null): void, flash(text: string): void, remove(): void }}
 */
export function createViewBar({ onCopy, onBack }) {
    const bar = el('div', 'viewbar');
    const tag = el('span', 'vb-tag', 'Viewing');
    const who = el('div', 'vb-who');
    const name = el('span', 'vb-name', 'Loading factory…');
    const meta = el('span', 'vb-meta', '');
    who.append(name, meta);
    const live = el('span', 'vb-live', '');
    const acts = el('div', 'vb-acts');
    const copy = button('Copy as blueprint', () => current && onCopy(current), 'btn-secondary strong vb-copy');
    const share = button('Share link', async () => {
        if (!current) return;
        const url = factoryLink(current.id);
        const how = await shareLink(url, `${current.name}'s factory · Protocol: Selene`);
        link.value = url;
        link.classList.remove('hidden');
        flash(how === 'copied' ? 'Link copied' : how === 'shared' ? 'Shared' : 'Copy the link');
        if (how === 'shown') link.select();
    }, 'btn-secondary vb-share');
    const back = button('Back', () => onBack(), 'btn-secondary vb-back');
    copy.disabled = share.disabled = true;
    acts.append(copy, share, back);
    const link = el('input', 'vb-link hidden');
    link.readOnly = true;
    link.addEventListener('focus', () => link.select());
    const note = el('span', 'vb-note', '');
    bar.append(tag, who, live, acts, link, note);
    document.body.appendChild(bar);

    let current = null;
    let noteTimer = null;
    function flash(text) {
        note.textContent = text;
        note.classList.remove('pop');
        void note.offsetWidth;
        note.classList.add('pop');
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => (note.textContent = ''), 4000);
    }

    return {
        show(f) {
            current = f;
            name.textContent = `${f.name}’s factory`;
            const when = new Date(f.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            meta.textContent = `${fmtNum(f.perMinute)} CR/min · ${fmtNum(f.efficiency)} per cell · ${f.machines} machines · ${f.world === 'aftermath' ? 'Aftermath' : 'Valley'} · ${when}${f.current ? '' : ' · older test'}`;
            copy.disabled = share.disabled = false;
        },
        fail(msg) {
            name.textContent = 'Nothing to see here';
            meta.textContent = msg;
            bar.classList.add('failed');
        },
        setLive(perMinute) {
            live.textContent = perMinute == null ? '' : `Now ${fmtNum(perMinute)} CR/min`;
        },
        flash,
        remove: () => bar.remove(),
    };
}
