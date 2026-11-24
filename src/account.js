// src/account.js — talks to the API (api/, Rust; on Railway behind the web service's Caddy,
// in development behind Vite's proxy): who is signed in, and the calls for accounts, cloud
// saves, settings and the leaderboard. The game works without it: when the server can't be
// reached `online` is false and the cloud features say so.

const HEADERS = { 'Content-Type': 'application/json', 'X-Selene': '1' };

export class ApiError extends Error {
    constructor(status, message, body = {}) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

/** One API call: JSON in and out, the CSRF header, the session cookie. Throws ApiError. */
export async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
        res = await fetch(`/api${path}`, {
            method,
            headers: method === 'GET' ? { 'X-Selene': '1' } : HEADERS,
            body: body === undefined ? undefined : JSON.stringify(body),
            credentials: 'same-origin',
        });
    } catch {
        throw new ApiError(0, 'The server can’t be reached');
    }
    let data = null;
    try {
        data = await res.json();
    } catch { /* not JSON: an HTML error page from a proxy */ }
    if (!res.ok || data == null) {
        // A missing API behind the dev proxy answers 500/502/504 without JSON.
        if (data == null) throw new ApiError(0, 'The server can’t be reached');
        throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data);
    }
    return data;
}

export function createAccount() {
    const state = { user: null, online: false, checked: false, bench: null };
    const listeners = new Set();
    const emit = () => {
        for (const fn of listeners) fn(state);
    };
    const setUser = (user) => {
        state.user = user ?? null;
        state.online = true;
        emit();
    };

    return {
        state,
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** Is the server there, and who is signed in? Never throws. */
        async refresh() {
            try {
                const health = await call('/health');
                state.online = !!health.ok;
                state.bench = health.bench ?? null;
            } catch {
                state.online = false;
            }
            if (state.online) {
                try {
                    state.user = (await call('/me')).user;
                } catch (e) {
                    state.user = null;
                    if (e.status === 0) state.online = false;
                }
            } else state.user = null;
            state.checked = true;
            emit();
            return state;
        },
        async signup(name, password) {
            const r = await call('/auth/signup', { method: 'POST', body: { name, password } });
            setUser(r.user);
            return r; // { user, recoveryCode }
        },
        async login(name, password) {
            const r = await call('/auth/login', { method: 'POST', body: { name, password } });
            setUser(r.user);
            return r;
        },
        async logout() {
            try {
                await call('/auth/logout', { method: 'POST', body: {} });
            } finally {
                state.user = null;
                emit();
            }
        },
        async recover(name, recoveryCode, newPassword) {
            const r = await call('/auth/recover', { method: 'POST', body: { name, recoveryCode, newPassword } });
            setUser(r.user);
            return r; // a new recovery code
        },
        /** Signed in some other way (a passkey): take the user the server answered with. */
        adoptUser: (user) => setUser(user),
        /** Add fields to the signed-in user (profile.js: the avatar) and tell the listeners. */
        patchUser(fields) {
            if (!state.user) return;
            state.user = { ...state.user, ...fields };
            emit();
        },
        changePassword: (password, newPassword) => call('/me/password', { method: 'POST', body: { password, newPassword } }),
        async deleteAccount(password) {
            await call('/me', { method: 'DELETE', body: { password } });
            state.user = null;
            emit();
        },
        /** Everything the server holds about you, as a downloaded JSON file. */
        async exportData() {
            const data = await call('/me/export');
            download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'selene-account.json');
        },
        listSaves: () => call('/saves'),
        getSave: (slot) => call(`/saves/${encodeURIComponent(slot)}`),
        putSave: (slot, body) => call(`/saves/${encodeURIComponent(slot)}`, { method: 'PUT', body }),
        deleteSave: (slot) => call(`/saves/${encodeURIComponent(slot)}`, { method: 'DELETE', body: {} }),
        getSettings: () => call('/settings'),
        putSettings: (data, updatedAt) => call('/settings', { method: 'PUT', body: { data, updatedAt } }),
        submitScore: (layout) => call('/scores', { method: 'POST', body: { layout } }),
        leaderboard: (board, world = 'valley') => call(`/leaderboard?board=${encodeURIComponent(board)}&world=${encodeURIComponent(world)}`),
        // Iteration 7: the blueprint library (blueprints.js) and other players' factories (public).
        listBlueprints: () => call('/blueprints'),
        putBlueprint: (id, body) => call(`/blueprints/${encodeURIComponent(id)}`, { method: 'PUT', body }),
        deleteBlueprint: (id) => call(`/blueprints/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
        factory: (id) => call(`/factories/${encodeURIComponent(id)}`),
        // The weekly challenge (iteration 7): a week's board, and a factory for this week's.
        challengeBoard: (week = null) => call(`/challenge${week ? `?week=${encodeURIComponent(week)}` : ''}`),
        submitChallenge: (week, layout) => call('/challenge/submit', { method: 'POST', body: { week, layout } }),
    };
}

/** Offer a Blob as a file download. */
export function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
