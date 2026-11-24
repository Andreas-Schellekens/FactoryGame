// src/challengeUi.js — the weekly challenge's screens, as plain DOM in the HUD's style: its
// card on the title screen (this week's rules, time left, your best, the top 3), its board
// (the week's top 50 and you, last week's podium, and in a challenge game "Send in this
// factory" / "Test here first"), and its section in the console while you play it.
// Reads the account (account.js) and the slots (saves.js); never touches the simulation:
// main.js passes in what it needs. The rules come from challenge.js, the words from story.js.
import './challenge.css';
import { challengeFor, weekKey, periodBounds, previousPeriod } from './challenge.js';
import { CHALLENGE_TEXT, challengeName, challengeBrief, challengeRules, challengeTimeLeft, targetPlural } from './story.js';

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
const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const pad2 = (n) => String(n).padStart(2, '0');

/** The short rule chips: "Capacitors only · 20 machines · CR 850 · tier 4 · express belts". */
function chips(r) {
    const list = [
        `${targetPlural(r.target)} only`,
        `${r.cap} machines`,
        `CR ${r.budget}`,
        r.tierCap > 1 ? `up to tier ${r.tierCap}` : 'tier 1 only',
    ];
    if (r.fastBelts) list.push('express belts');
    if (!r.buildings.includes('generator')) list.push('no generators');
    if (r.plot < 3) list.push(CHALLENGE_TEXT.plotChip[r.plot]);
    return list;
}

/**
 * @param {{ account: any, saves: any, menus: any, sound?: any }} opts
 */
export function createChallengeUi({ account, saves, menus, sound }) {
    const cue = (name) => sound?.cue(name);
    // The server's clock decides which week it is (once it has answered); offline, ours does.
    let serverWeek = null;
    let clockSkew = 0;
    const now = () => Date.now() + clockSkew;
    const thisWeek = () => serverWeek ?? weekKey(now());
    const msLeft = (week) => (periodBounds(week)?.end ?? 0) - now();

    async function board(week) {
        const data = await account.challengeBoard(week);
        serverWeek = data.thisWeek ?? serverWeek;
        if (typeof data.now === 'number') clockSkew = data.now - Date.now();
        return data;
    }
    /** The save slot that plays a week's challenge, if there is one. */
    const slotFor = (week) => saves.list().find((s) => s.mode === 'challenge' && s.week === week) ?? null;

    function rowsTable(entries, me, unit) {
        const table = el('div', 'lb-table');
        const head = el('div', 'lb-row lb-head ch-row');
        for (const h of ['#', 'Name', unit, 'CR', 'Machines']) head.appendChild(el('span', null, h));
        table.appendChild(head);
        const row = (e) => {
            const r = el('div', `lb-row ch-row${e.me ? ' me' : ''}`);
            r.append(el('span', 'lb-rank', String(e.rank)), el('span', 'lb-name', e.name), el('span', 'lb-val', fmt(e.perMinute)),
                el('span', null, String(e.cost)), el('span', null, String(e.machines)));
            return r;
        };
        for (const e of entries) table.appendChild(row(e));
        if (!entries.length) table.appendChild(el('p', 'mm-empty', CHALLENGE_TEXT.noTop));
        if (me && !entries.some((e) => e.me)) {
            table.appendChild(el('div', 'lb-gap', '⋯'));
            table.appendChild(row(me));
        }
        return table;
    }

    // ---- The title screen's card ---------------------------------------------------------------
    /**
     * @param {{ onStart: (week: string) => void, onPlay: (slot: any) => void }} opts
     * (both leave the title screen: wrap them with the title's `leave`)
     */
    function titleCard({ onStart, onPlay }) {
        const card = el('div', 'mode-card ch-card');
        let data = null;
        let offline = false;
        function render() {
            const week = thisWeek();
            const r = challengeFor(week);
            card.innerHTML = '';
            if (!r) return;
            const left = el('div', 'ch-main');
            const meta = el('span', 'mode-kicker', `${CHALLENGE_TEXT.kicker} · ${week} · ${challengeTimeLeft(msLeft(week))}`);
            const chipRow = el('div', 'ch-chips');
            for (const c of chips(r)) chipRow.appendChild(el('span', 'ch-chip', c));
            left.append(meta, el('h3', 'mode-title', challengeName(r)), el('p', 'mode-text', challengeBrief(r)), chipRow);

            const side = el('div', 'ch-side');
            side.appendChild(el('span', 'con-label', CHALLENGE_TEXT.top));
            const top = el('ol', 'ch-top');
            const entries = data?.week === week ? data.entries.slice(0, 3) : [];
            for (const e of entries) {
                const li = el('li', e.me ? 'me' : '');
                li.append(el('span', 'ch-top-name', e.name), el('span', 'ch-top-val', `${fmt(e.perMinute)}/min`));
                top.appendChild(li);
            }
            if (!entries.length) top.appendChild(el('li', 'ch-empty', offline ? CHALLENGE_TEXT.offline : data ? CHALLENGE_TEXT.noTop : 'Loading…'));
            const mine = data?.week === week ? data.me : null;
            side.append(top, el('span', 'ch-best', CHALLENGE_TEXT.best(mine ? fmt(mine.perMinute) : null, mine?.rank)));

            const acts = el('div', 'ch-acts');
            const slot = slotFor(week);
            acts.append(
                slot ? button(CHALLENGE_TEXT.resume, () => onPlay(slot), 'btn-primary') : button(CHALLENGE_TEXT.start, () => onStart(week), 'btn-primary'),
                button(CHALLENGE_TEXT.board, () => openBoard({ week })),
            );
            side.appendChild(acts);
            card.append(left, side);
        }
        render();
        board()
            .then((d) => {
                data = d;
                render();
            })
            .catch(() => {
                offline = true;
                render();
            });
        // The clock on the card moves once a minute (and a new week redraws it).
        const timer = setInterval(() => {
            if (!card.isConnected) clearInterval(timer);
            else render();
        }, 60000);
        return card;
    }

    // ---- The board -------------------------------------------------------------------------------
    /**
     * A week's board. `submit` (in a challenge game): { week, layout(), preview(), onTested(), onSent() }.
     */
    function openBoard({ week = thisWeek(), submit = null } = {}) {
        const r = challengeFor(week);
        if (!r) return;
        const m = menus.openModal({ kicker: `${CHALLENGE_TEXT.kicker} · ${week}`, title: challengeName(r), wide: true });
        const body = m.body;
        const kicker = m.head.querySelector('.mm-kicker');
        body.appendChild(el('p', 'mm-text', challengeBrief(r)));
        const rules = el('ul', 'ch-rules');
        for (const line of challengeRules(r)) rules.appendChild(el('li', null, line));
        body.appendChild(rules);
        const sub = el('div', 'lb-submit');
        const tableBox = el('div', 'ch-board');
        const podium = el('div', 'ch-podium');
        body.append(sub, tableBox, podium, el('p', 'mm-fine', CHALLENGE_TEXT.explain));

        const running = () => msLeft(week) > 0 && week === thisWeek();
        async function load() {
            kicker.textContent = `${CHALLENGE_TEXT.kicker} · ${week} · ${challengeTimeLeft(msLeft(week))}`;
            tableBox.innerHTML = '';
            tableBox.appendChild(el('p', 'mm-empty', 'Loading…'));
            let data;
            try {
                data = await board(week);
            } catch (e) {
                tableBox.innerHTML = '';
                tableBox.appendChild(el('p', 'mm-empty', e.status === 0 ? CHALLENGE_TEXT.offline : e.message));
                renderSubmit();
                return;
            }
            kicker.textContent = `${CHALLENGE_TEXT.kicker} · ${week} · ${challengeTimeLeft(msLeft(week))}`;
            tableBox.innerHTML = '';
            tableBox.appendChild(rowsTable(data.entries, data.me, CHALLENGE_TEXT.unit(r)));
            podium.innerHTML = '';
            const prev = challengeFor(data.previous?.week ?? previousPeriod(week));
            if (prev && data.previous?.podium?.length) {
                podium.appendChild(el('span', 'con-label', CHALLENGE_TEXT.lastWeek(challengeName(prev))));
                const ol = el('ol', 'ch-top');
                data.previous.podium.forEach((e) => {
                    const li = el('li');
                    li.append(el('span', 'ch-top-name', `${pad2(e.rank)} · ${e.name}`), el('span', 'ch-top-val', `${fmt(e.perMinute)} ${targetPlural(prev.target)}/min`));
                    ol.appendChild(li);
                });
                podium.appendChild(ol);
            }
            renderSubmit();
        }

        // Rebuilt only when what it offers changes (the week's state, signed in or not), so the
        // last result stays on screen while the board reloads under it.
        let submitSig = null;
        function renderSubmit() {
            const sig = `${running()}|${!!account.state.user}`;
            if (sig === submitSig) return;
            submitSig = sig;
            sub.innerHTML = '';
            if (!submit) return;
            if (submit.week !== week) return;
            if (!running()) {
                sub.appendChild(el('p', 'mm-note', CHALLENGE_TEXT.over));
                return;
            }
            const out = el('p', 'lb-result');
            const unit = CHALLENGE_TEXT.unit(r);
            const testBtn = button('Test here first', async () => {
                testBtn.disabled = true;
                out.textContent = 'Running the test in your browser…';
                const res = await submit.preview();
                testBtn.disabled = false;
                submit.onTested?.();
                out.textContent = res.ok ? `Expected: ${fmt(res.perMinute)} ${unit} · ${res.machines}/${r.cap} machines · CR ${res.cost}/${r.budget}` : res.error;
            });
            const sendBtn = button('Send in this factory', async () => {
                if (!account.state.user) {
                    menus.openAccount();
                    return;
                }
                sendBtn.disabled = true;
                testBtn.disabled = true;
                out.textContent = 'The auditors are rebuilding your factory on the server…';
                out.classList.add('busy');
                try {
                    const res = await account.submitChallenge(week, submit.layout());
                    submit.onSent?.();
                    const best = res.best ? ` Your best: ${fmt(res.best.perMinute)} (rank ${res.best.rank}).` : '';
                    out.textContent = `${fmt(res.result.perMinute)} ${unit}, CR ${res.result.cost}.${res.stored ? ' New personal best.' : ' Not better than your best, so not stored.'}${best}`;
                    cue(res.stored ? 'orderDone' : 'click');
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
            const row = el('div', 'mm-actions');
            row.append(sendBtn, testBtn);
            if (!account.state.user) row.appendChild(el('span', 'mm-note', 'Sign in to send it in.'));
            sub.append(row, el('p', 'mm-fine', CHALLENGE_TEXT.submitNote), out);
        }

        renderSubmit();
        load();
        m.onClose = account.onChange(renderSubmit);
    }

    // ---- The console, while a challenge is played ------------------------------------------------
    /**
     * Fill the console's requirement list with the week's numbers. `info` (main.js): { key,
     * rules, capped, money, rate }. Returns { update(info) } for every frame.
     */
    function consoleView(list, note, info, onBoard) {
        const r = info.rules;
        list.innerHTML = '';
        const row = (label, bar = true) => {
            const node = el('div', 'req');
            const name = el('span', 'req-name', label);
            const count = el('span', 'req-count');
            node.append(name, count);
            let fill = null;
            if (bar) {
                const b = el('div', 'req-bar');
                fill = el('div', 'req-fill');
                b.appendChild(fill);
                node.appendChild(b);
            }
            list.appendChild(node);
            return { node, count, fill };
        };
        const rate = row(CHALLENGE_TEXT.unit(r), false);
        rate.node.classList.add('ch-rate');
        const machines = row('Machines');
        const budget = row('Budget left');
        const extra = el('div', 'ch-chips');
        for (const c of chips(r).slice(3)) extra.appendChild(el('span', 'ch-chip', c));
        const boardBtn = button(CHALLENGE_TEXT.board, onBoard, 'inf-buy ch-board-btn');
        list.append(extra, boardBtn);
        let lastSig = '';
        return {
            update(s) {
                const left = msLeft(s.key);
                const sig = `${s.rate}|${s.capped}|${Math.round(s.money)}|${Math.floor(left / 60000)}`;
                if (sig === lastSig) return;
                lastSig = sig;
                rate.count.textContent = s.rate == null ? '·' : fmt(s.rate);
                machines.count.textContent = `${pad2(s.capped)}/${pad2(r.cap)}`;
                machines.fill.style.width = `${Math.min(100, (s.capped / r.cap) * 100)}%`;
                machines.node.classList.toggle('met', s.capped >= r.cap);
                budget.count.textContent = `CR ${Math.max(0, Math.floor(s.money))}`;
                budget.fill.style.width = `${Math.max(0, Math.min(100, (s.money / r.budget) * 100))}%`;
                note.textContent = left > 0 ? `${s.key} · ${challengeTimeLeft(left)}` : `${s.key} · ${CHALLENGE_TEXT.over}`;
            },
        };
    }

    return { titleCard, openBoard, consoleView, thisWeek, slotFor };
}
