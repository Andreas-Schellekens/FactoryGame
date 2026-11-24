// src/passkeys.js — passkeys in the browser (WebAuthn): add one to the signed-in account,
// list and remove them, and sign in with one (a discoverable credential, so no name is
// typed). The server side is api/src/passkeys.rs (webauthn-rs). The account panel
// (menus.js) shows `passkeySection` when signed in and `passkeySignInButton` on the
// sign-in tab. All text lives in story.js PASSKEY_TEXT.

import { call } from './account.js';
import { PASSKEY_TEXT as T } from './story.js';

export const passkeysSupported = () =>
    typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials?.create && window.isSecureContext;

// ---- base64url <-> bytes ---------------------------------------------------------------------
function enc(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function dec(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
/** Drop null fields: WebIDL dictionaries refuse null where they expect a list or a string. */
function clean(v) {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) out[k] = clean(x);
        return out;
    }
    return v;
}

function creationOptions(json) {
    const pk = clean(json.publicKey);
    pk.challenge = dec(pk.challenge);
    pk.user = { ...pk.user, id: dec(pk.user.id) };
    pk.excludeCredentials = (pk.excludeCredentials ?? []).map((c) => ({ ...c, id: dec(c.id) }));
    return { publicKey: pk };
}
function requestOptions(json) {
    const pk = clean(json.publicKey);
    pk.challenge = dec(pk.challenge);
    pk.allowCredentials = (pk.allowCredentials ?? []).map((c) => ({ ...c, id: dec(c.id) }));
    // A button press asks right away (no `mediation: conditional`, which waits for autofill).
    return { publicKey: pk };
}
const extensions = (cred) => {
    try {
        return cred.getClientExtensionResults?.() ?? {};
    } catch {
        return {};
    }
};

/** Why the browser said no, in words for the panel (null: the player cancelled). */
function browserError(e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return null;
    if (e?.name === 'InvalidStateError') return T.already;
    if (e?.name === 'SecurityError') return T.wrongSite;
    return e?.message || T.failed;
}

/** A name for a new passkey from the browser and the system ("Chrome on Windows"). */
function deviceName() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} on ${os}` : browser;
}

/** Add a passkey to the signed-in account. Resolves { ok, error?, cancelled? }. */
export async function addPasskey(name) {
    const options = await call('/passkeys/register/start', { method: 'POST', body: {} });
    let cred;
    try {
        cred = await navigator.credentials.create(creationOptions(options));
    } catch (e) {
        const error = browserError(e);
        return { ok: false, cancelled: !error, error };
    }
    if (!cred) return { ok: false, cancelled: true };
    const credential = {
        id: cred.id,
        rawId: enc(cred.rawId),
        type: cred.type,
        response: {
            attestationObject: enc(cred.response.attestationObject),
            clientDataJSON: enc(cred.response.clientDataJSON),
            transports: cred.response.getTransports?.() ?? [],
        },
        extensions: extensions(cred),
    };
    await call('/passkeys/register/finish', { method: 'POST', body: { credential, name: name || deviceName() } });
    return { ok: true };
}

/** Sign in with any passkey this browser has for the site. Resolves { ok, user?, error? }. */
export async function signInWithPasskey() {
    const { ticket, options } = await call('/passkeys/login/start', { method: 'POST', body: {} });
    let cred;
    try {
        cred = await navigator.credentials.get(requestOptions(options));
    } catch (e) {
        const error = browserError(e);
        return { ok: false, cancelled: !error, error };
    }
    if (!cred) return { ok: false, cancelled: true };
    const credential = {
        id: cred.id,
        rawId: enc(cred.rawId),
        type: cred.type,
        response: {
            authenticatorData: enc(cred.response.authenticatorData),
            clientDataJSON: enc(cred.response.clientDataJSON),
            signature: enc(cred.response.signature),
            userHandle: cred.response.userHandle ? enc(cred.response.userHandle) : null,
        },
        extensions: extensions(cred),
    };
    const r = await call('/passkeys/login/finish', { method: 'POST', body: { ticket, credential } });
    return { ok: true, user: r.user };
}

export const listPasskeys = () => call('/passkeys');
export const removePasskey = (id) => call(`/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });

// ---- The account panel's pieces --------------------------------------------------------------
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
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Passkeys" for the signed-in account panel: the list, Remove, and Add a passkey. */
export function passkeySection({ cue = () => {}, open = false } = {}) {
    const sec = el('details', 'mm-sec passkeys');
    sec.open = open;
    sec.appendChild(el('summary', null, T.title));
    const intro = el('p', 'mm-text', T.intro);
    const list = el('div', 'pk-list');
    const err = el('p', 'mm-error');
    const row = el('div', 'mm-actions');
    const name = el('input', 'mm-inline');
    name.placeholder = T.namePlaceholder;
    name.maxLength = 40;
    const add = button(T.add, async () => {
        add.disabled = true;
        err.textContent = '';
        try {
            const r = await addPasskey(name.value.trim());
            if (r.ok) {
                name.value = '';
                cue('check');
                err.textContent = T.added;
                await load();
            } else if (r.error) {
                err.textContent = r.error;
                cue('deny');
            }
        } catch (e) {
            err.textContent = e.message;
            cue('deny');
        } finally {
            add.disabled = false;
        }
    }, 'btn-secondary strong');
    row.append(name, add);

    async function load() {
        list.innerHTML = '';
        let data;
        try {
            data = await listPasskeys();
        } catch (e) {
            list.appendChild(el('p', 'mm-note', e.message));
            return;
        }
        if (!data.passkeys.length) list.appendChild(el('p', 'mm-note', T.none));
        for (const pk of data.passkeys) {
            const item = el('div', 'pk-item');
            const info = el('div', 'pk-info');
            info.append(
                el('span', 'pk-name', pk.name),
                el('span', 'pk-meta', `${T.addedOn} ${fmtDate(pk.createdAt)} · ${pk.lastUsedAt ? `${T.usedOn} ${fmtDate(pk.lastUsedAt)}` : T.neverUsed}`),
            );
            const rm = button(T.remove, async () => {
                if (!confirm(T.confirmRemove.replace('{name}', pk.name))) return;
                rm.disabled = true;
                try {
                    await removePasskey(pk.id);
                    cue('click');
                    await load();
                } catch (e) {
                    err.textContent = e.message;
                    rm.disabled = false;
                }
            }, 'btn-secondary danger');
            item.append(info, rm);
            list.appendChild(item);
        }
    }

    if (!passkeysSupported()) sec.append(intro, el('p', 'mm-note', T.unsupported));
    else {
        sec.append(intro, list, row, err);
        sec.addEventListener('toggle', () => {
            if (sec.open && !list.childElementCount) load();
        });
        if (open) load();
    }
    return sec;
}

/**
 * "Sign in with a passkey" for the sign-in tab. `onUser(user)` gets the signed-in user;
 * `err` is the form's error line.
 */
export function passkeySignInButton({ onUser, err, cue = () => {} }) {
    const wrap = el('div', 'pk-signin');
    if (!passkeysSupported()) return wrap;
    const b = button(T.signIn, async () => {
        b.disabled = true;
        err.textContent = '';
        try {
            const r = await signInWithPasskey();
            if (r.ok) await onUser(r.user);
            else if (r.error) {
                err.textContent = r.error;
                cue('deny');
            }
        } catch (e) {
            err.textContent = e.message;
            cue('deny');
        } finally {
            b.disabled = false;
        }
    }, 'btn-secondary strong pk-button');
    wrap.append(el('span', 'pk-or', T.or), b);
    return wrap;
}
