// src/menus.js — the screens around the game, as plain DOM in the HUD's style: the title
// screen (Continue, Story or Infinite, Load, Leaderboard, Settings, the account chip), the
// in-game menu (top bar → Menu, or Esc), a notice for phones, and the modal panels for save
// slots, the account, and the leaderboard. Driven through
// callbacks from main.js; reads the account (account.js) and the slots (saves.js), and
// never touches the simulation. The settings panel is settingsPanel.js.

import { markSVG, patchSVG } from './brand.js';
import { BRAND, GAME_TITLE, INFINITE_TEXT, ITEM_NAMES, CHALLENGE_TEXT } from './story.js';
import { PHASES } from './campaign.js';
import { PLOTS } from './config.js';

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
/** The maker's badge (Schellekens Digital), linking to their site. */
export const MADE_BY = { src: '/assets/brand/made-by-schellekens-digital.png', alt: 'Gemaakt door Schellekens Digital', href: 'https://schellekensdigital.be' };
function madeBy() {
    const a = el('a', 'made-by');
    a.href = MADE_BY.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Schellekens Digital';
    const img = el('img');
    img.src = MADE_BY.src;
    img.alt = MADE_BY.alt;
    img.width = 231;
    img.height = 48;
    a.appendChild(img);
    return a;
}

function field(label, type = 'text', attrs = {}) {
    const wrap = el('label', 'mm-field');
    wrap.appendChild(el('span', 'mm-flabel', label));
    const input = el('input');
    input.type = type;
    Object.assign(input, attrs);
    wrap.appendChild(input);
    return { wrap, input };
}
const pad2 = (n) => String(n).padStart(2, '0');
const fmtNum = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2));

export function fmtPlay(secs = 0) {
    const m = Math.floor(secs / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${pad2(m % 60)} min` : `${m} min`;
}
function fmtAgo(ms) {
    if (!ms) return 'not saved yet';
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
/** "STORY · PHASE 03/05" or "INFINITE · LAND 2/4". */
export function slotProgress(slot) {
    if (slot.mode === 'infinite') return `Infinite · Land ${(slot.plot ?? 0) + 1}/${PLOTS.length}`;
    if (slot.mode === 'challenge') return CHALLENGE_TEXT.slotProgress(slot.week ?? '');
    if (slot.complete) return 'Story · complete';
    return `Story · Phase ${pad2(Math.min((slot.phase ?? 0) + 1, PHASES.length))}/${pad2(PHASES.length)}`;
}
function syncBadge(slot, signedIn) {
    if (slot.cloudOnly) return ['cloud', 'In your account'];
    if (slot.cloudNewer) return ['cloud', 'Newer in your account'];
    if (!signedIn) return ['local', 'This browser'];
    if (slot.syncError) return ['error', 'Not synced'];
    if (slot.cloud && !slot.dirty) return ['synced', 'Synced'];
    return ['local', 'Syncing…'];
}

/**
 * @param {{ account: any, saves: any, sound?: any, onOpenSettings: () => void }} opts
 */
export function createMenus({ account, saves, sound, onOpenSettings }) {
    const cue = (name) => sound?.cue(name);
    let modal = null; // the open modal panel: { node, close }
    let titleNode = null;

    // ---- Modal frame ------------------------------------------------------------------
    function openModal({ kicker, title, wide = false, onClose = null }) {
        closeModal();
        const back = el('div', 'mm-back');
        const panel = el('section', `mm-panel${wide ? ' wide' : ''}`);
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        const head = el('header', 'mm-head');
        const titles = el('div', 'mm-titles');
        titles.append(el('span', 'mm-kicker', kicker), el('h2', 'mm-title', title));
        const close = el('button', 'mm-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.addEventListener('click', () => {
            cue('close');
            closeModal();
        });
        head.append(titles, close);
        const body = el('div', 'mm-body');
        panel.append(head, body);
        back.appendChild(panel);
        back.addEventListener('pointerdown', (e) => {
            if (e.target === back) closeModal();
        });
        document.body.appendChild(back);
        document.body.classList.add('menu-open');
        modal = { node: back, head, body, onClose };
        cue('open');
        setTimeout(() => panel.querySelector('input, button:not(.mm-close)')?.focus(), 0);
        return modal;
    }
    function closeModal() {
        if (!modal) return;
        const m = modal;
        modal = null;
        m.node.remove();
        document.body.classList.remove('menu-open');
        m.onClose?.();
    }
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.capturing) {
            e.stopPropagation();
            cue('close');
            closeModal();
        }
    }, true);

    /** The account chip (title screen, save panel): who's signed in, or a way to sign in. */
    function accountChip() {
        const chip = el('button', 'mm-chip');
        chip.type = 'button';
        const render = () => {
            const s = account.state;
            chip.classList.toggle('on', !!s.user);
            chip.classList.toggle('offline', s.checked && !s.online);
            chip.textContent = s.user ? s.user.name : !s.checked ? 'Account…' : s.online ? 'Sign in' : 'Offline';
            chip.title = s.user ? 'Your account' : s.online ? 'Sign in to keep your saves and settings in your account' : 'The server can’t be reached: saves stay in this browser';
        };
        render();
        const off = account.onChange(render);
        chip.addEventListener('click', () => openAccount());
        chip._off = off;
        return chip;
    }

    // ---- Phones ----------------------------------------------------------------------------
    /** A phone (touch, small screen): the game is built for a computer, the menus work anywhere. */
    const isPhone = () => {
        let coarse = navigator.maxTouchPoints > 0;
        try {
            coarse = coarse || window.matchMedia('(pointer: coarse)').matches;
        } catch { /* old browser */ }
        return coarse && Math.min(window.innerWidth, window.innerHeight) < 600;
    };
    const PHONE_NOTE = 'selene.phoneNote';
    function showPhoneNote(onLeaderboard) {
        try {
            if (sessionStorage.getItem(PHONE_NOTE)) return;
            sessionStorage.setItem(PHONE_NOTE, '1');
        } catch { /* show it anyway */ }
        const m = openModal({ kicker: 'Heads-up', title: 'Made for a computer' });
        m.node.querySelector('.mm-panel').classList.add('phone-note');
        m.body.append(
            el('p', 'mm-text', 'Protocol: Selene is a factory game you build with a mouse and keyboard, on a computer or a tablet with a mouse.'),
            el('p', 'mm-text', 'On a phone you can sign in, check the leaderboard and manage your saves and settings. Playing works too, but it is cramped and some things need a mouse.'),
        );
        const row = el('div', 'mm-actions');
        row.append(
            button('Play anyway', () => {
                cue('click');
                closeModal();
            }, 'btn-primary small'),
            button('Leaderboard', () => onLeaderboard()),
        );
        m.body.appendChild(row);
    }

    // ---- The in-game menu ------------------------------------------------------------------
    /**
     * Everything that isn't playing, in one place (top bar → Menu, or Esc). main.js pauses the
     * game while any menu is open.
     * @param {{ slot: any, onSave: () => boolean, onSaves: () => void, onSettings: () => void,
     *           onLeaderboard: () => void, onMainMenu: () => void }} opts
     */
    function openGameMenu({ slot, onSave, onSaves, onSettings, onLeaderboard, onMainMenu }) {
        const m = openModal({ kicker: slot ? `${slot.name} · ${slotProgress(slot)}` : 'Paused', title: 'Menu' });
        m.node.querySelector('.mm-panel').classList.add('game-menu');
        const list = el('div', 'gm-list');
        const item = (label, hint, action, cls = '') => {
            const b = el('button', `gm-item${cls ? ` ${cls}` : ''}`);
            b.type = 'button';
            b.append(el('span', 'gm-label', label), el('span', 'gm-hint', hint));
            b.addEventListener('click', action);
            list.appendChild(b);
            return b;
        };
        item('Resume', 'Esc', () => {
            cue('close');
            closeModal();
        }, 'primary');
        const save = item('Save game', slot?.savedAt ? `Saved ${fmtAgo(slot.savedAt)}` : 'Not saved yet', () => {
            const ok = onSave();
            save.querySelector('.gm-hint').textContent = ok ? 'Saved just now' : 'Save failed';
            cue(ok ? 'check' : 'deny');
        });
        item('Saves', 'Load another game · save as · export · import', onSaves);
        item('Settings', 'Sound · graphics · gameplay · controls · accessibility', onSettings);
        item('Leaderboard', 'The most efficient Infinite factories', onLeaderboard);
        const acc = item('Account', '', () => openAccount());
        const renderAccount = () => {
            const s = account.state;
            acc.querySelector('.gm-hint').textContent = s.user ? `Signed in as ${s.user.name}`
                : s.checked && !s.online ? 'Offline: saves stay in this browser' : 'Sign in to keep your saves in the cloud';
        };
        renderAccount();
        list.appendChild(el('span', 'gm-sep'));
        item('Main menu', 'Saves this game and goes back to the title screen, to switch between Story and Infinite', onMainMenu, 'exit');
        m.body.append(list, el('p', 'mm-note', 'The game is paused while this menu is open.'));
        m.onClose = account.onChange(renderAccount);
    }

    // ---- Title screen ---------------------------------------------------------------------
    /**
     * @param {{ onNew: (mode: 'story'|'infinite') => void, onPlay: (slot: any) => void, onLeaderboard: () => void,
     *           challengeCard?: (leave: (fn: Function) => Function) => HTMLElement }} opts
     */
    function showTitle({ onNew, onPlay, onLeaderboard, challengeCard = null }) {
        const overlay = el('div', 'overlay title-screen');
        titleNode = overlay;
        const lockup = el('div', 'lockup');
        const lockMark = el('span', 'lockup-mark');
        lockMark.innerHTML = markSVG(false, 54);
        const lockText = el('div', 'lockup-text');
        lockText.append(el('span', 'lockup-word', BRAND.nile.name), el('span', 'lockup-full', BRAND.nile.full), el('span', 'lockup-motto', BRAND.nile.motto));
        lockup.append(lockMark, lockText);
        const corner = el('div', 'title-corner');
        corner.appendChild(accountChip());

        const card = el('div', 'title-card');
        const patch = el('div', 'title-patch');
        patch.innerHTML = patchSVG(false, 150);
        const leave = (fn) => () => {
            closeModal();
            overlay.remove();
            titleNode = null;
            fn();
        };

        const cont = el('div', 'title-continue');
        const renderContinue = () => {
            cont.innerHTML = '';
            const latest = saves.latest();
            if (!latest) return;
            const b = button('', leave(() => onPlay(latest)), 'btn-continue');
            b.append(el('span', 'tc-k', 'Continue'), el('span', 'tc-name', latest.name), el('span', 'tc-meta', `${slotProgress(latest)} · ${fmtPlay(latest.playSec)}`));
            cont.appendChild(b);
        };
        renderContinue();
        const offSaves = saves.onChange(renderContinue);

        const modes = el('div', 'title-modes');
        const story = el('div', 'mode-card');
        story.append(
            el('span', 'mode-kicker', 'Story'),
            el('h3', 'mode-title', GAME_TITLE),
            el('p', 'mode-text', 'Five phases, one cannon. The Moon is falling. NILE has a plan. You are the plan.'),
            button('Begin onboarding', leave(() => onNew('story')), 'btn-primary'),
        );
        const inf = el('div', 'mode-card infinite');
        inf.append(
            el('span', 'mode-kicker', 'Infinite'),
            el('h3', 'mode-title', INFINITE_TEXT.title),
            el('p', 'mode-text', INFINITE_TEXT.pitch),
            button('Start Infinite', leave(() => onNew('infinite')), 'btn-primary'),
        );
        modes.append(story, inf);
        if (challengeCard) modes.appendChild(challengeCard(leave)); // the weekly challenge (challengeUi.js)

        const row = el('div', 'title-row');
        row.append(
            button('Load game', () => openSlots({ onPlay: leave((slot) => onPlay(slot)) })),
            button('Leaderboard', () => onLeaderboard()),
            button('Settings', () => onOpenSettings()),
        );
        card.append(
            patch,
            el('h1', 'title-game', GAME_TITLE),
            el('p', 'title-byline', BRAND.nile.byline),
            cont,
            modes,
            row,
            el('p', 'fine-print', `By clicking Begin you accept the ${BRAND.nile.name} ${BRAND.nile.player} Agreement (4,812 pages), including Clause 88.`),
        );
        overlay.append(lockup, corner, card, madeBy());
        document.body.appendChild(overlay);
        overlay._off = offSaves;
        if (isPhone()) showPhoneNote(onLeaderboard);
        card.querySelector('.btn-continue, .btn-primary')?.focus();
    }

    // ---- Save slots --------------------------------------------------------------------------
    /**
     * @param {{ onPlay: (slot: any) => void, inGame?: { activeId: () => string, onSave: () => boolean, onSaveAs: (name: string) => boolean } }} opts
     */
    function openSlots({ onPlay, inGame = null }) {
        const m = openModal({ kicker: 'Contracts on file', title: 'Saves', wide: true });
        m.head.querySelector('.mm-titles').after(accountChip());
        const body = m.body;
        if (inGame) {
            const actions = el('div', 'mm-actions');
            const name = el('input', 'mm-inline');
            name.placeholder = 'Name for a new slot';
            name.maxLength = 60;
            actions.append(
                button('Save now', () => {
                    cue('click');
                    flash(inGame.onSave() ? 'Saved' : 'Save failed');
                }, 'btn-secondary strong'),
                name,
                button('Save as new slot', () => {
                    cue('click');
                    flash(inGame.onSaveAs(name.value.trim()) ? 'Saved as a new slot: you are playing in it now' : 'Could not make a new slot');
                    name.value = '';
                    render();
                }),
            );
            body.appendChild(actions);
        }
        const status = el('p', 'mm-status');
        const flash = (text) => {
            status.textContent = text;
            status.classList.remove('pop');
            void status.offsetWidth;
            status.classList.add('pop');
        };
        const list = el('div', 'slot-list');
        body.append(list, status);

        const foot = el('div', 'mm-foot');
        const file = el('input');
        file.type = 'file';
        file.accept = '.json,application/json';
        file.className = 'hidden';
        file.addEventListener('change', async () => {
            const f = file.files?.[0];
            file.value = '';
            if (!f) return;
            const r = await saves.importFile(f);
            flash(r.ok ? `Imported “${r.slot.name}”` : r.error);
        });
        const note = el('p', 'mm-note');
        foot.append(button('Import file…', () => file.click()), file, note);
        body.appendChild(foot);

        function render() {
            const signedIn = !!account.state.user;
            note.textContent = signedIn
                ? 'Saves are kept in this browser and in your account.'
                : 'Saves are kept in this browser. Sign in to keep them in your account too.';
            list.innerHTML = '';
            const slots = saves.list();
            if (!slots.length) list.appendChild(el('p', 'mm-empty', 'No saves yet. Start a game and it saves itself.'));
            for (const slot of slots) list.appendChild(slotCard(slot, signedIn));
        }
        function slotCard(slot, signedIn) {
            const card = el('div', 'slot');
            const playing = inGame?.activeId() === slot.id;
            card.classList.toggle('playing', playing);
            const thumb = el('div', 'slot-thumb');
            if (slot.thumb) {
                const img = el('img');
                img.src = slot.thumb;
                img.alt = '';
                thumb.appendChild(img);
            }
            const info = el('div', 'slot-info');
            const nameEl = el('span', 'slot-name', slot.name);
            const [badgeCls, badgeText] = syncBadge(slot, signedIn);
            info.append(
                nameEl,
                el('span', 'slot-meta', `${slotProgress(slot)} · ${fmtPlay(slot.playSec)} played`),
                el('span', 'slot-meta', `Saved ${fmtAgo(slot.savedAt)}`),
                el('span', `slot-badge ${badgeCls}`, playing ? 'Playing now' : badgeText),
            );
            const acts = el('div', 'slot-acts');
            if (!playing) {
                acts.appendChild(button('Play', async () => {
                    if (inGame && !confirm('Leave this game? It is saved first.')) return;
                    cue('click');
                    onPlay(slot);
                }, 'btn-secondary strong'));
            }
            acts.append(
                button('Rename', () => {
                    const name = prompt('Name this save', slot.name);
                    if (name != null && saves.rename(slot.id, name)) render();
                }),
                button('Copy', () => {
                    const c = saves.duplicate(slot.id);
                    flash(c ? `Copied to “${c.name}”` : 'Could not copy (is it saved here yet?)');
                }),
                button('Export', () => {
                    if (!saves.exportFile(slot.id)) flash('Open it once to download it first');
                }),
            );
            if (!playing) {
                acts.appendChild(button('Delete', async () => {
                    const where = slot.cloud || slot.cloudOnly ? ' here and in your account' : '';
                    if (!confirm(`Delete “${slot.name}”${where}? This cannot be undone.`)) return;
                    await saves.remove(slot.id);
                    flash('Deleted');
                }, 'btn-secondary danger'));
            }
            card.append(thumb, info, acts);
            return card;
        }
        render();
        const offSaves = saves.onChange(render);
        const offAcc = account.onChange(render);
        m.onClose = () => {
            offSaves();
            offAcc();
        };
        if (account.state.user) saves.sync();
    }

    // ---- Account ------------------------------------------------------------------------------
    function openAccount() {
        const m = openModal({ kicker: 'Personnel file', title: 'Account' });
        const body = m.body;
        const render = (view = null) => {
            body.innerHTML = '';
            const s = account.state;
            if (s.checked && !s.online) {
                body.append(
                    el('p', 'mm-text', 'The server can’t be reached right now. You can still play: saves and settings stay in this browser.'),
                    button('Try again', async () => {
                        await account.refresh();
                        render();
                    }),
                );
                return;
            }
            if (s.user) return renderSignedIn(s.user, view);
            renderSignedOut(view ?? 'login');
        };

        const privacy = () => el('p', 'mm-fine', 'We keep your name, a hash of your password, your saves, settings and leaderboard scores. No e-mail address, no IP address. You can download or delete all of it here.');
        const errorLine = () => el('p', 'mm-error');
        async function busy(btn, fn, err) {
            btn.disabled = true;
            err.textContent = '';
            try {
                await fn();
            } catch (e) {
                err.textContent = e.message;
                cue('deny');
            } finally {
                btn.disabled = false;
            }
        }

        function renderSignedOut(view) {
            const tabs = el('div', 'mm-tabs');
            for (const [id, label] of [['login', 'Sign in'], ['signup', 'Create account'], ['recover', 'Forgot password']]) {
                const t = button(label, () => render(id), `mm-tab${view === id ? ' on' : ''}`);
                tabs.appendChild(t);
            }
            body.appendChild(tabs);
            const form = el('form', 'mm-form');
            const err = errorLine();
            const name = field('Name', 'text', { autocomplete: 'username', maxLength: 20, required: true });
            if (view === 'login') {
                const pw = field('Password', 'password', { autocomplete: 'current-password', required: true });
                const go = button('Sign in', () => {}, 'btn-primary small');
                go.type = 'submit';
                form.append(name.wrap, pw.wrap, err, go);
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    busy(go, async () => {
                        await account.login(name.input.value.trim(), pw.input.value);
                        cue('check');
                        await saves.sync();
                        render();
                    }, err);
                });
            } else if (view === 'signup') {
                const pw = field('Password (8 or more characters)', 'password', { autocomplete: 'new-password', required: true, minLength: 8 });
                const pw2 = field('Password again', 'password', { autocomplete: 'new-password', required: true });
                const go = button('Create account', () => {}, 'btn-primary small');
                go.type = 'submit';
                form.append(name.wrap, pw.wrap, pw2.wrap, el('p', 'mm-fine', 'Names are 3 to 20 letters, digits, - or _ and show on the leaderboard.'), err, go);
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    if (pw.input.value !== pw2.input.value) {
                        err.textContent = 'The passwords don’t match';
                        return;
                    }
                    busy(go, async () => {
                        const r = await account.signup(name.input.value.trim(), pw.input.value);
                        cue('check');
                        showRecovery(r.recoveryCode, true);
                        saves.sync();
                    }, err);
                });
            } else {
                const code = field('Recovery code', 'text', { autocomplete: 'off', required: true, placeholder: 'XXXX-XXXX-XXXX-XXXX' });
                const pw = field('New password', 'password', { autocomplete: 'new-password', required: true, minLength: 8 });
                const go = button('Set new password', () => {}, 'btn-primary small');
                go.type = 'submit';
                form.append(el('p', 'mm-text', 'Use the recovery code you got when you made the account. You get a new one after this.'), name.wrap, code.wrap, pw.wrap, err, go);
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    busy(go, async () => {
                        const r = await account.recover(name.input.value.trim(), code.input.value, pw.input.value);
                        showRecovery(r.recoveryCode, false);
                        saves.sync();
                    }, err);
                });
            }
            body.append(form, privacy());
        }

        function showRecovery(code, fresh) {
            body.innerHTML = '';
            body.append(
                el('p', 'mm-text', fresh
                    ? 'Account made. This is your recovery code: the only way back in if you forget your password. It is shown once. Write it down or keep it in a password manager.'
                    : 'Password changed. Your old recovery code no longer works; this is the new one. It is shown once.'),
                el('p', 'recovery-code', code),
            );
            const row = el('div', 'mm-actions');
            row.append(
                button('Copy', async () => {
                    try {
                        await navigator.clipboard.writeText(code);
                        cue('click');
                    } catch { /* no clipboard: they can select it */ }
                }),
                button('I have written it down', () => render(), 'btn-primary small'),
            );
            body.appendChild(row);
        }

        function renderSignedIn(user, view) {
            body.append(
                el('p', 'mm-text', `Signed in as ${user.name}. Your saves and settings are kept in your account as well as in this browser.`),
            );
            const row = el('div', 'mm-actions');
            row.append(
                button('Sign out', async () => {
                    await account.logout();
                    saves.forgetCloud();
                    cue('click');
                    render();
                }, 'btn-secondary strong'),
                button('Download my data', async () => {
                    try {
                        await account.exportData();
                    } catch (e) {
                        alert(e.message);
                    }
                }),
            );
            body.appendChild(row);

            const pwSec = el('details', 'mm-sec');
            pwSec.open = view === 'password';
            pwSec.appendChild(el('summary', null, 'Change password'));
            const pwForm = el('form', 'mm-form');
            const cur = field('Current password', 'password', { autocomplete: 'current-password', required: true });
            const next = field('New password', 'password', { autocomplete: 'new-password', required: true, minLength: 8 });
            const err = errorLine();
            const go = button('Change password', () => {}, 'btn-secondary strong');
            go.type = 'submit';
            pwForm.append(cur.wrap, next.wrap, err, go);
            pwForm.addEventListener('submit', (e) => {
                e.preventDefault();
                busy(go, async () => {
                    await account.changePassword(cur.input.value, next.input.value);
                    err.textContent = 'Password changed.';
                    cur.input.value = '';
                    next.input.value = '';
                    cue('check');
                }, err);
            });
            pwSec.appendChild(pwForm);

            const delSec = el('details', 'mm-sec danger');
            delSec.appendChild(el('summary', null, 'Delete account'));
            const delForm = el('form', 'mm-form');
            const dpw = field('Password', 'password', { autocomplete: 'current-password', required: true });
            const derr = errorLine();
            const dgo = button('Delete my account and everything in it', () => {}, 'btn-secondary danger');
            dgo.type = 'submit';
            delForm.append(el('p', 'mm-text', 'This deletes your account, its saves, settings and leaderboard scores for good. Saves in this browser stay.'), dpw.wrap, derr, dgo);
            delForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!confirm('Delete your account for good? This cannot be undone.')) return;
                busy(dgo, async () => {
                    await account.deleteAccount(dpw.input.value);
                    saves.forgetCloud();
                    render();
                }, derr);
            });
            delSec.appendChild(delForm);
            body.append(pwSec, delSec, privacy());
        }

        render();
        const off = account.onChange(() => {
            if (!body.querySelector('.recovery-code') && !body.contains(document.activeElement)) render();
        });
        m.onClose = off;
        if (!account.state.checked) account.refresh();
    }

    // ---- Leaderboard -------------------------------------------------------------------------
    /**
     * @param {{ submit?: { allowed: boolean, reason?: string, layout: () => any, preview: () => Promise<any> } }} opts
     */
    function openLeaderboard({ submit = null } = {}) {
        const m = openModal({ kicker: 'Valley Efficiency Index', title: 'Leaderboard', wide: true });
        const body = m.body;
        let board = 'throughput';
        const tabs = el('div', 'mm-tabs');
        const tabBtns = {};
        for (const [id, label] of [['throughput', 'Throughput'], ['efficiency', 'Efficiency']]) {
            tabBtns[id] = button(label, () => {
                board = id;
                for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle('on', k === board);
                load();
            }, `mm-tab${id === board ? ' on' : ''}`);
            tabs.appendChild(tabBtns[id]);
        }
        const explain = el('p', 'mm-fine', 'The server rebuilds your factory on a fresh Infinite valley (everything researched, belts empty, a fresh market), runs it for 6 minutes of game time and counts what the Dispatch Pad pays in the last 5. Throughput: credits per minute. Efficiency: credits per minute for each cell the factory covers. Selling one thing only floods the market.');
        const table = el('div', 'lb-table');
        const sub = el('div', 'lb-submit');
        body.append(tabs, explain, sub, table);

        async function load() {
            table.innerHTML = '';
            table.appendChild(el('p', 'mm-empty', 'Loading…'));
            let data;
            try {
                data = await account.leaderboard(board);
            } catch (e) {
                table.innerHTML = '';
                table.appendChild(el('p', 'mm-empty', e.status === 0 ? 'The leaderboard is offline (the server can’t be reached).' : e.message));
                return;
            }
            table.innerHTML = '';
            const head = el('div', 'lb-row lb-head');
            for (const h of ['#', 'Name', board === 'throughput' ? 'CR / min' : 'CR / min / cell', 'Machines', 'Date']) head.appendChild(el('span', null, h));
            table.appendChild(head);
            const row = (e) => {
                const r = el('div', `lb-row${e.me ? ' me' : ''}`);
                const value = board === 'throughput' ? fmtNum(e.perMinute) : fmtNum(e.efficiency);
                r.append(el('span', 'lb-rank', String(e.rank)), el('span', 'lb-name', e.name), el('span', 'lb-val', value),
                    el('span', null, String(e.machines)), el('span', 'lb-date', new Date(e.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
                return r;
            };
            for (const e of data.entries) table.appendChild(row(e));
            if (!data.entries.length) table.appendChild(el('p', 'mm-empty', 'No factories on this board yet. Be the first.'));
            if (data.me && !data.entries.some((e) => e.me)) {
                table.appendChild(el('div', 'lb-gap', '⋯'));
                table.appendChild(row(data.me));
            }
        }

        function renderSubmit() {
            sub.innerHTML = '';
            if (!submit) {
                sub.appendChild(el('p', 'mm-note', 'Start or load an Infinite game to send in your factory.'));
                return;
            }
            if (!submit.allowed) {
                sub.appendChild(el('p', 'mm-note', submit.reason));
                return;
            }
            const out = el('p', 'lb-result');
            const testBtn = button('Test here first', async () => {
                testBtn.disabled = true;
                out.textContent = 'Running the test in your browser…';
                const r = await submit.preview();
                testBtn.disabled = false;
                out.textContent = r.ok ? `Expected: ${fmtNum(r.perMinute)} CR/min · ${fmtNum(r.efficiency)} per cell · ${soldText(r.sold)}` : r.error;
            });
            const sendBtn = button('Send in this factory', async () => {
                if (!account.state.user) {
                    openAccount();
                    return;
                }
                sendBtn.disabled = true;
                testBtn.disabled = true;
                out.textContent = 'The auditors are rebuilding your factory on the server…';
                out.classList.add('busy');
                try {
                    const r = await account.submitScore(submit.layout());
                    const res = r.result;
                    const best = r.newBest.throughput || r.newBest.efficiency ? ' New personal best.' : ' Not better than your best, so not stored.';
                    out.textContent = `${fmtNum(res.perMinute)} CR/min (rank ${r.rank.throughput}) · ${fmtNum(res.efficiency)} per cell (rank ${r.rank.efficiency}).${best}`;
                    cue(r.stored ? 'orderDone' : 'click');
                    load();
                } catch (e) {
                    out.textContent = e.message;
                    cue('deny');
                } finally {
                    out.classList.remove('busy');
                    sendBtn.disabled = false;
                    testBtn.disabled = false;
                }
            }, 'btn-secondary strong');
            const signNote = account.state.user ? null : el('span', 'mm-note', 'Sign in to send it in.');
            const row = el('div', 'mm-actions');
            row.append(sendBtn, testBtn);
            if (signNote) row.appendChild(signNote);
            sub.append(row, out);
        }
        const soldText = (sold) => Object.entries(sold ?? {}).map(([k, n]) => `${n} ${ITEM_NAMES[k] ?? k}/min`).join(', ') || 'nothing sold';

        renderSubmit();
        load();
        const off = account.onChange(renderSubmit);
        m.onClose = off;
    }

    return {
        showTitle,
        openGameMenu,
        openSlots,
        openAccount,
        openLeaderboard,
        openModal,
        closeModal,
        isOpen: () => !!modal,
        /** The settings panel sets this while it waits for a key to bind (Esc then cancels the binding, not the panel). */
        setCapturing: (on) => {
            if (modal) modal.capturing = on;
        },
        titleShown: () => !!titleNode,
    };
}
