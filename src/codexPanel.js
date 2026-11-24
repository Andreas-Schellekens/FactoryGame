// src/codexPanel.js — the codex as a HUD panel (opened with K, the top bar's Codex button, the
// machine panel's link, or K over something in the world). It is a reference you keep open
// while the factory runs: it never pauses the game. Tabs for Items, Buildings, Recipes and
// Research, a search box over all of them, and pages whose every item, building and research
// is a link to its own page. All data comes from codex.js and all words from story.js CODEX;
// this file only draws them.
import { CODEX } from './story.js';
import * as cx from './codex.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
const svg = (path, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;
const GLYPH = {
    fastBelts: 'M4 7l5 5-5 5M11 7l5 5-5 5M18 7v10',
    advancedProduct: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
    tier4: 'M6 13l6-6 6 6M6 19l6-6 6 6',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
    back: 'M15 6l-6 6 6 6',
};
const TABS = ['items', 'buildings', 'recipes', 'research'];
const tabOf = (id) => ({ item: 'items', building: 'buildings', tech: 'research' })[String(id).split(':')[0]] ?? null;
const priceText = (n) => (n >= 10 ? String(Math.round(n)) : n.toFixed(1));

/**
 * @param {{ root: HTMLElement, icons?: Record<string,string>, itemIcons?: Record<string,string>,
 *   cue?: (name: string) => void, brand?: () => string, keyLabel?: () => string }} opts
 */
export function createCodexPanel({ root, icons = {}, itemIcons = {}, cue = () => {}, brand = () => 'NILE', keyLabel = () => 'K' }) {
    const panel = el('aside', 'codex hidden');
    panel.setAttribute('aria-label', CODEX.title);

    const head = el('div', 'cx-head');
    const titles = el('div', 'cx-titles');
    const kicker = el('span', 'cx-kicker');
    titles.append(kicker, el('span', 'cx-title', CODEX.title));
    const keyHint = el('span', 'cx-keyhint');
    const closeBtn = el('button', 'cx-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', CODEX.close);
    head.append(titles, keyHint, closeBtn);

    const bar = el('div', 'cx-bar');
    const tabsBox = el('div', 'cx-tabs');
    const tabBtns = {};
    for (const id of TABS) {
        const b = el('button', 'cx-tab');
        b.type = 'button';
        b.dataset.tab = id;
        b.append(el('span', null, CODEX.tabs[id]), el('span', 'cx-count'));
        tabBtns[id] = b;
        tabsBox.appendChild(b);
    }
    const search = el('input', 'cx-search');
    search.type = 'search';
    search.placeholder = CODEX.search;
    search.spellcheck = false;
    search.autocomplete = 'off';
    search.setAttribute('aria-label', CODEX.search);
    bar.append(tabsBox, search);

    const body = el('div', 'cx-body');
    const list = el('nav', 'cx-list');
    const page = el('article', 'cx-page');
    body.append(list, page);
    panel.append(head, bar, body);
    root.appendChild(panel);

    let tab = 'items';
    const chosen = { items: `item:${cx.ITEMS[0]}`, buildings: `building:${cx.BUILDINGS[0]}`, research: `tech:${cx.TECHS[0]}` };
    let query = '';
    let history = [];
    let sig = '';
    let lastCheck = 0;
    let markRecipe = null; // a recipe row to bring into view on the Recipes tab

    const isOpen = () => !panel.classList.contains('hidden');
    const current = () => (tab === 'recipes' ? 'tab:recipes' : chosen[tab]);

    // ---- Pictures and links ----------------------------------------------------------------
    function pic(icon, size, classified = false) {
        const box = el('span', 'cx-pic');
        box.style.width = `${size}px`;
        box.style.height = `${size}px`;
        if (classified) {
            box.classList.add('redacted');
            box.innerHTML = svg(GLYPH.lock, Math.round(size * 0.5));
            return box;
        }
        const src = icon?.item ? itemIcons[icon.item] : icon?.building ? icons[icon.building] : null;
        if (src) {
            const img = el('img');
            img.src = src;
            img.alt = '';
            img.draggable = false;
            box.appendChild(img);
        } else if (icon?.tech) {
            box.classList.add('glyph');
            box.innerHTML = svg(GLYPH[icon.tech] ?? GLYPH.tier4, Math.round(size * 0.62));
        } else box.classList.add('blank');
        return box;
    }
    /** An inline link to an entry: its picture and name (masked when classified). */
    function link(id, label, icon, { n = 1 } = {}) {
        const secret = cx.isClassified(id);
        const b = el('button', `cx-link${secret ? ' classified' : ''}`);
        b.type = 'button';
        if (!secret) b.dataset.go = id;
        b.append(pic(icon, 22, secret), el('span', null, `${n > 1 ? `${n}× ` : ''}${secret ? CODEX.classified.mask : label}`));
        return b;
    }
    const itemLink = (k, n = 1) => link(`item:${k}`, cx.itemName(k), { item: k }, { n });
    const buildingLink = (t) => link(`building:${t}`, cx.buildingName(t), { building: t });
    const techLink = (tech) => {
        const b = link(`tech:${tech.id}`, tech.label, { tech: tech.id });
        b.classList.add(tech.done ? 'online' : 'gate');
        return b;
    };

    /** One recipe: inputs → output, then machine, time and what gates it. */
    function recipeRow(v, { machine = true } = {}) {
        const row = el('div', `cx-recipe${v.classified ? ' classified' : v.ok ? '' : ' locked'}`);
        row.dataset.key = v.key;
        if (v.classified) {
            row.append(el('span', 'cx-redacted', CODEX.classified.mask), el('span', 'cx-chip', CODEX.classified.name));
            return row;
        }
        const flow = el('div', 'cx-flow');
        v.inputs.forEach((inp, i) => {
            if (i) flow.appendChild(el('span', 'cx-plus', '+'));
            flow.appendChild(itemLink(inp.item, inp.n));
        });
        flow.appendChild(el('span', 'cx-arrow', '→'));
        flow.appendChild(v.output ? itemLink(v.output) : el('span', 'cx-points', `${v.points} ${v.outputLabel}`));
        const meta = el('div', 'cx-meta');
        if (machine) meta.appendChild(buildingLink(v.machine));
        meta.appendChild(el('span', 'cx-time', `${v.secs} · ${v.perMin}/min`));
        if (v.tech) meta.appendChild(techLink(v.tech));
        row.append(flow, meta);
        // On the building's own page its lock is in the header already: only research is news.
        if (!v.ok && (machine || v.gate !== 'building')) row.appendChild(el('span', 'cx-why', v.why));
        return row;
    }

    function section(label, ...children) {
        const sec = el('section', 'cx-sec');
        sec.appendChild(el('span', 'con-label', label));
        for (const c of children.flat()) if (c) sec.appendChild(typeof c === 'string' ? el('p', 'cx-note', c) : c);
        return sec;
    }
    function statusLine(st) {
        const s = el('span', `cx-status ${st.ok ? 'ok' : 'locked'}`, st.text);
        return s;
    }
    function priceBar(base, now) {
        const bar = el('div', 'cx-mbar');
        const fill = el('div', 'cx-mfill');
        const frac = base ? now / base : 0;
        fill.style.width = `${Math.round(frac * 100)}%`;
        if (frac < 0.5) fill.dataset.low = '1';
        bar.appendChild(fill);
        return bar;
    }
    /** Ports as a little machine seen from above, its front to the right: teal in, orange out. */
    function portsSVG(ins, outs) {
        const ANGLE = { right: 0, down: 90, left: 180, up: 270 };
        const tri = (side, kind) => {
            const pts = kind === 'out' ? '53,29 65,36 53,43' : '65,29 53,36 65,43';
            return `<polygon class="cx-port-${kind}" points="${pts}" transform="rotate(${ANGLE[side]} 36 36)"/>`;
        };
        return `<svg class="cx-ports-svg" width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
            <rect x="22" y="22" width="28" height="28" class="cx-port-body"/>
            ${ins.map((s) => tri(s, 'in')).join('')}${outs.map((s) => tri(s, 'out')).join('')}</svg>`;
    }

    // ---- Pages --------------------------------------------------------------------------------
    function pageHead(p, kindLabel) {
        const h = el('div', 'cx-ph');
        h.appendChild(pic(p.icon, 64));
        const t = el('div', 'cx-ph-text');
        t.append(el('span', 'cx-ph-kicker', kindLabel), el('span', 'cx-ph-name', p.name), statusLine(p.status));
        h.appendChild(t);
        return h;
    }
    function itemPage(p) {
        const out = [pageHead(p, p.tag)];
        if (p.desc) out.push(el('p', 'cx-desc', p.desc));
        const made = [p.mined, ...p.makers.map((v) => recipeRow(v))].filter(Boolean);
        if (made.length) out.push(section(p.mined ? CODEX.labels.mined : CODEX.labels.madeBy, made));
        const used = [...p.uses.map((v) => recipeRow(v)), p.fuel, p.research].filter(Boolean);
        if (used.length) out.push(section(CODEX.labels.usedIn, used));
        const pad = [];
        if (p.pad.base) {
            const row = el('div', 'cx-market');
            row.append(el('span', 'cx-market-k', CODEX.pad.pays(p.pad.base)), priceBar(p.pad.base, p.pad.now), el('span', 'cx-market-v', `${CODEX.pad.now} ${priceText(p.pad.now)}`));
            pad.push(row);
        } else pad.push(p.pad.phases.length ? CODEX.pad.cannonOnly : CODEX.pad.notBought);
        for (const ph of p.pad.phases) pad.push(el('p', `cx-note cx-phase${ph.current ? ' current' : ph.done ? ' done' : ''}`, ph.text));
        if (p.pad.orders) pad.push(CODEX.pad.orders);
        if (p.pad.base) pad.push(CODEX.pad.note);
        out.push(section(CODEX.labels.pad, pad));
        return out;
    }
    function buildingPage(p) {
        const out = [pageHead(p, CODEX.kinds.building)];
        if (p.desc) out.push(el('p', 'cx-desc', p.desc));
        const facts = el('dl', 'cx-facts');
        const fact = (k, v) => {
            if (v == null || v === '') return;
            facts.append(el('dt', null, k), el('dd', null, v));
        };
        if (p.cost != null) fact(CODEX.labels.cost, `CR ${p.cost}`);
        fact(CODEX.labels.power, p.power);
        fact(CODEX.labels.unlock, p.from);
        if (facts.childNodes.length) out.push(facts);
        for (const n of p.notes) out.push(el('p', 'cx-note', n));
        if (p.ports) {
            const box = el('div', 'cx-ports');
            box.innerHTML = portsSVG(p.ports.in, p.ports.out);
            const words = el('div', 'cx-ports-text');
            words.append(el('span', null, p.ports.text));
            if (p.ports.out.length) words.appendChild(el('span', 'cx-note', CODEX.ports.legend)); // it has a front to turn
            box.appendChild(words);
            out.push(section(CODEX.labels.ports, box));
        }
        if (p.recipes.length) out.push(section(CODEX.labels.recipes, p.recipes.map((v) => recipeRow(v, { machine: false })), CODEX.notes.recipeTime));
        if (p.tiers) {
            const table = el('table', 'cx-tiers');
            const tr = (label, cells, cls = '') => {
                const r = el('tr', cls);
                r.appendChild(el('th', null, label));
                cells.forEach((c, i) => {
                    const td = el('td', p.tiers[i].locked ? 'locked' : '', c);
                    r.appendChild(td);
                });
                table.appendChild(r);
            };
            tr(CODEX.labels.tier, p.tiers.map((t) => `T${t.tier}`), 'head');
            tr(CODEX.labels.time, p.tiers.map((t) => t.secs));
            tr(CODEX.labels.perMin, p.tiers.map((t) => String(t.perMin)));
            tr(CODEX.labels.upgrade, p.tiers.map((t, i) => (i === 0 ? `CR ${t.cost}` : `+${t.cost}`)));
            out.push(section(CODEX.labels.speed, table, p.tier4Locked ? CODEX.notes.tier4 : null));
        }
        if (p.market) {
            const rows = p.market.map((m) => {
                const row = el('div', 'cx-market');
                row.append(itemLink(m.item), priceBar(m.base, m.now), el('span', 'cx-market-v', `${priceText(m.now)} / ${m.base}`));
                return row;
            });
            out.push(section(CODEX.labels.market, rows, CODEX.pad.note));
        }
        return out;
    }
    function techPage(p) {
        const out = [pageHead(p, `${CODEX.kinds.tech} · ${p.cost} RP`)];
        if (p.desc) out.push(el('p', 'cx-desc', p.desc));
        const effect = [...p.recipes.map((v) => recipeRow(v))];
        if (p.buildings.length) {
            const links = el('div', 'cx-flow');
            p.buildings.forEach((t) => links.appendChild(buildingLink(t)));
            effect.push(links);
        }
        if (effect.length) out.push(section(CODEX.labels.effect, effect));
        const from = el('div', 'cx-flow');
        from.append(buildingLink('fabricator'), el('span', 'cx-arrow', '→'), itemLink('dataCartridge'), el('span', 'cx-arrow', '→'), buildingLink('lab'));
        out.push(section(CODEX.labels.points, from, p.from));
        return out;
    }
    function classifiedPage() {
        const box = el('div', 'cx-sealed');
        box.append(pic(null, 64, true), el('span', 'cx-ph-kicker', CODEX.classified.kicker), el('span', 'cx-ph-name', CODEX.classified.name), el('p', 'cx-desc', CODEX.classified.text));
        return [box];
    }

    // ---- Drawing ------------------------------------------------------------------------------
    function renderList() {
        list.innerHTML = '';
        const rows = cx.listRows(tab, query);
        if (!rows.length) list.appendChild(el('p', 'cx-empty', CODEX.empty));
        for (const r of rows) {
            const b = el('button', `cx-row${r.id === chosen[tab] ? ' on' : ''}${r.classified ? ' classified' : r.ok ? '' : ' locked'}`);
            b.type = 'button';
            b.dataset.go = r.id;
            b.dataset.row = '1';
            const text = el('span', 'cx-row-text');
            text.append(el('span', 'cx-row-name', r.name), el('span', 'cx-row-sub', r.sub));
            b.append(pic(r.icon, 30, r.classified), text);
            if (r.chip) b.appendChild(el('span', 'cx-chip', r.chip));
            list.appendChild(b);
        }
        return rows;
    }
    function renderPage() {
        page.innerHTML = '';
        if (history.length) {
            const back = el('button', 'cx-back');
            back.type = 'button';
            back.innerHTML = svg(GLYPH.back, 12);
            back.appendChild(el('span', null, CODEX.back));
            page.appendChild(back);
        }
        if (tab === 'recipes') {
            const rows = cx.recipeRows(query);
            page.appendChild(el('p', 'cx-note', CODEX.notes.recipeTime));
            if (!rows.length) page.appendChild(el('p', 'cx-empty', CODEX.empty));
            for (const v of rows) page.appendChild(recipeRow(v));
            return;
        }
        const p = cx.pageFor(chosen[tab]);
        if (!p) return;
        const parts = p.classified ? classifiedPage() : p.kind === 'item' ? itemPage(p) : p.kind === 'building' ? buildingPage(p) : techPage(p);
        for (const part of parts) page.appendChild(part);
    }
    function render({ fresh = false } = {}) {
        sig = cx.signature();
        kicker.textContent = CODEX.kicker(brand());
        keyHint.textContent = CODEX.keyHint(keyLabel());
        const counts = query.trim() ? cx.searchCounts(query) : null;
        for (const [id, b] of Object.entries(tabBtns)) {
            b.classList.toggle('on', id === tab);
            b.classList.toggle('none', !!counts && !counts[id]);
            b.querySelector('.cx-count').textContent = counts ? String(counts[id]) : '';
        }
        const keepList = list.scrollTop;
        const keepPage = page.scrollTop;
        body.classList.toggle('wide', tab === 'recipes');
        if (tab !== 'recipes') renderList();
        renderPage();
        if (fresh) {
            page.scrollTop = 0;
            list.querySelector('.cx-row.on')?.scrollIntoView({ block: 'nearest' });
        } else {
            list.scrollTop = keepList;
            page.scrollTop = keepPage;
        }
        if (markRecipe && tab === 'recipes') {
            const row = page.querySelector(`.cx-recipe[data-key="${markRecipe}"]`);
            row?.classList.add('marked');
            row?.scrollIntoView({ block: 'center' });
            markRecipe = null;
        }
    }

    // ---- Navigation ---------------------------------------------------------------------------
    function go(id, { push = true } = {}) {
        const t = tabOf(id);
        if (!t || !cx.pageFor(id)) return;
        if (push && current() !== id) {
            history.push(current());
            if (history.length > 30) history.shift();
        }
        tab = t;
        chosen[t] = id;
        // A link to something the search hides: drop the search so the list shows it.
        if (query && !cx.listRows(t, query).some((r) => r.id === id)) {
            query = '';
            search.value = '';
        }
        render({ fresh: true });
    }
    function back() {
        const prev = history.pop();
        if (!prev) return;
        if (prev === 'tab:recipes') tab = 'recipes';
        else {
            tab = tabOf(prev);
            chosen[tab] = prev;
        }
        render({ fresh: true });
    }
    function setTab(id) {
        if (id === tab) return;
        tab = id;
        render({ fresh: true });
    }
    /** The search changed: follow the first match if the page on show no longer matches. */
    function onQuery() {
        query = search.value;
        if (query.trim()) {
            const counts = cx.searchCounts(query);
            if (!counts[tab]) tab = TABS.find((t) => counts[t]) ?? tab;
            if (tab !== 'recipes') {
                const rows = cx.listRows(tab, query);
                if (rows.length && !rows.some((r) => r.id === chosen[tab])) chosen[tab] = rows[0].id;
            }
        }
        render({ fresh: true });
    }

    panel.addEventListener('click', (e) => {
        const target = e.target.closest('[data-go], .cx-back, .cx-tab, .cx-close');
        if (!target) return;
        if (target === closeBtn) return close();
        if (target.classList.contains('cx-back')) {
            cue('key');
            return back();
        }
        if (target.classList.contains('cx-tab')) {
            cue('key');
            return setTab(target.dataset.tab);
        }
        cue('key');
        go(target.dataset.go, { push: !target.dataset.row });
    });
    search.addEventListener('input', onQuery);
    search.addEventListener('keydown', (e) => {
        // Typing here never reaches the game's keys (main.js ignores keys typed into inputs).
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (tab === 'recipes') {
                const first = cx.recipeRows(query).find((v) => !v.classified && v.output);
                if (first) go(`item:${first.output}`);
            } else {
                const first = cx.listRows(tab, query)[0];
                if (first) go(first.id, { push: false });
            }
        }
    });

    // ---- Open / close ---------------------------------------------------------------------------
    /** Open the codex (on `id`'s page if given: 'item:steel', 'building:press', 'tech:tier4', 'recipe:press:copperWire'). */
    function open(id = null) {
        const was = isOpen();
        if (!was) {
            panel.classList.remove('hidden');
            history = [];
            cue('open');
        }
        if (id?.startsWith('recipe:')) {
            if (was) history.push(current());
            tab = 'recipes';
            markRecipe = id.slice(7);
            query = '';
            search.value = '';
            render({ fresh: true });
        } else if (id) go(id, { push: was });
        else render({ fresh: !was });
    }
    function close() {
        if (!isOpen()) return;
        panel.classList.add('hidden');
        if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
        cue('close');
    }
    /** K: open (on `id`), go to `id`, or close when there is nothing new to show. */
    function toggle(id = null) {
        if (isOpen() && (!id || id === current())) close();
        else open(id);
    }

    return {
        open, close, toggle, isOpen,
        /** What is on show: an entry id, or 'tab:recipes'. */
        current,
        /** Per frame: redraw the open page when progress, research, licences or prices change. */
        update() {
            if (!isOpen()) return;
            const now = performance.now();
            if (now - lastCheck < 500) return;
            lastCheck = now;
            if (cx.signature() !== sig) render();
        },
        /** Redraw (new key bindings, a new brand). */
        refresh: () => isOpen() && render(),
        el: panel,
    };
}
