# Protocol: Selene — design & roadmap

A 2.5D factory game with a story and an ending. You are a "Steward"
contracted by **NILE** to build a giant cannon that will save Earth from the
falling Moon. Over the campaign it becomes clear that NILE is really
**NIHIL**, and that the Moon was never falling.

(The working title was *Project Lifeline*; renamed because that name belongs
to real humanitarian organisations. Saves still use the `lifeline.save.v2` key.)

## Story bible

**Tone:** mostly satire (corporate dystopia, Satisfactory-style), but the first
act should make you feel like a hero saving the world.

**NILE** — *Network for Infrastructure, Logistics & Engineering*. Motto:
*"Ad astra, ad infinitum."* Presents **Protocol: Selene — An Initiative by
NILE**. Mark: a delta (Δv, three branches) in a square frame, signal orange.

**NIHIL** — the same organisation with *Heavy Industry* slotted in: *Network
for Infrastructure, Heavy Industry & Logistics*. Motto: *"Ex nihilo, nihil
fit."* After the reveal it is **Protocol: Selene — A Project of NIHIL**; the
delta collapses to a flat line and the HUD turns alarm red.

**The player** is a **Steward** (NILE's word: noble, planetary, corporate
euphemism; deliberately not a frontier "pioneer"). At the reveal HR updates
the title: NIHIL calls you an **Asset** from then on (`BRAND.*.player`).

| Phase done | Brand | What the player notices |
|---|---|---|
| 0 | NILE | Heroic briefing: the Moon falls in 17 days |
| 1 | NILE | Impact date silently revised to "soon" |
| 2 | NILE, rare glitch → NIHIL | Leaked memo: *Moon+* subscription tiers |
| 3 | frequent glitch | DELTA slips: "NIHIL thanks you…"; a memo notes "Heavy Industry" fits between the I and the L |
| 4+ | **NIHIL**, red flatline | Reveal: the Moon is fine; free moonlight undercuts Moon+ |

**Visual identity — "D · Mission Control"** (chosen from three directions on
the Claude Design canvas *Nile Brand Directions*, a balance of B "Mission
Control" and C "Bright Future"): a NASA-style instrument panel in a 70s
mission palette. Midnight panels with 1 px hairlines and square corners;
paper text; signal orange for the active thing; mustard for money and costs;
teal for progress; sunset for the phase ribbon. Big Shoulders Display for
mission headlines, Archivo for the brand and text, IBM Plex Mono for
telemetry. After the reveal every accent becomes alarm red and the brand cell
gets hazard stripes.

**DELTA** — *Dispatch & Engineering Logistics Task Assistant*, NILE's AI guide
and the player's CAPCOM. Voice (recorded with ElevenLabs): a woman in her late
twenties, calm, slow and warm, perfectly polite and slightly too pleasant. She
never raises her voice, not even after the reveal; that is the joke. Cheerful, contractually positive, increasingly honest
in the worst way. Portrait is an oscilloscope badge whose trace follows its
mood (teal → bright sine when happy → magenta noise on a glitch → a red
flatline when sinister) and bounces while it speaks.

**Nolan Isaac Locke** — NIHIL's chief executive (his initials spell N.I.L.).
He only speaks after the reveal, on a darker comms channel with his own
portrait (a backlit silhouette, NIHIL-red tie) and voice (ElevenLabs,
unhurried and low, a little boardroom room): he introduces himself and
thanks the Asset at the reveal, drops in halfway through Ignition, comments
on a blackout, leaves a memo in the late chatter, and thanks the Asset once
more in the ending ("you, Asset, are now a cost"). Before the reveal he is
only heard of: NILE's broadcasts read out "a message from our Chief
Executive", DELTA mentions him now and then (he doesn't do interviews,
photographs or Tuesdays; he has read your file), memos go out over his
initials (N.I.L.) — the Moon+ plan is "Approved — N.I.L." — and his name is
on the construction site's sign. In phase 4 he looks forward to "thanking
our Steward personally. Upon completion."

**Protocol: Selene** — the cannon. Built in five phases by delivering goods to
the **Dispatch Pad**:

1. **Groundbreaking** (foundation) — 40 iron ingots, 20 copper ingots →
   unlocks Press, Assembler, Splitter, Merger
2. **Targeting Circuitry** (dish) — 60 iron plates, 40 circuits → unlocks
   Foundry, Generator
3. **Power Core** (capacitor bank) — 60 steel, 50 capacitors → unlocks
   Fabricator, Lab
4. **Payload** (turret) — 40 motors, 30 advanced circuits → the reveal;
   unlocks the Mixer, and the drained pond exposes sulfur
5. **Ignition** (rings, the shot) — 15 Selene Shells, 75 capacitors → the
   ending

Each phase needs the chain the one before it unlocked, so the whole factory
gets built; selling one product in bulk doesn't skip ahead (the pad's market
saturates, see 4a).

**Production tree** (machine · recipe, at tier 1 per minute):

| Product | Machine | Recipe | /min |
|---|---|---|---|
| Iron / Copper Ingot | Smelter | 1 ore | 60 |
| Iron Plate | Press | 1 iron ingot | 80 |
| Copper Wire | Press | 1 copper ingot | 80 |
| Steel | Foundry | 1 iron ingot + 1 coal | 30 |
| Circuit | Assembler | 1 iron plate + 1 copper wire | 40 |
| Capacitor | Assembler | 1 steel + 2 copper wire | 27 |
| Motor | Assembler | 1 steel + 1 iron plate + 1 copper wire | 20 |
| Advanced Circuit | Assembler | 2 circuits + 1 steel (research) | 27 |
| Selene Shell | Assembler | 1 steel + 1 explosive + 1 advanced circuit | 10 |
| Data Cartridge | Fabricator | 1 circuit + 1 copper wire | 30 |
| Explosive | Mixer | 1 sulfur + 1 coal | 30 |
| Research points | Lab | 1 data cartridge → 5 points | 200 |

Coal feeds three things (generators, foundries, mixers), so splitting a coal
line is the mid-game puzzle; motors and shells take three inputs, one per
side of an assembler.

**The ending: a choice.** In the last phase DELTA lets slip that Selene's
turret turns a full circle and that NIHIL's headquarters is due east, and a
leaked memo says the targeting override is stored in DELTA. When the last
delivery lands, the player chooses the target (Nolan: "The button on the
left." DELTA: "The button on the right is also a button.").
- **The Moon** (as contracted): played in the valley itself: the cannon
  swivels to the Moon and fires, the Moon shatters, *Moon+* (an ad-supported
  orbital billboard) switches on where it hung and stays there for the rest
  of the sandbox. "Congratulations, Asset. You have saved Earth from free
  things."
- **NIHIL HQ** (the override): Selene turns east, the shell arcs over the
  valley into NIHIL's tower on the east rim, which comes down in fire and
  dust ("That was my headquarters."). The Moon stays, the sky turns to dawn,
  NIHIL's red drains from the HUD, the birds and the bright early music come
  back, DELTA becomes your co-founder, and you name your own company; the
  sandbox goes on under that name and mark.
- **The epilogue** (NIHIL HQ only): the company's first year, four goals
  paid for at the Dispatch Pad, each mending what NIHIL did: relight the
  camp, clear the compound (the east rim's sulfur turns up under it), give
  the river back (blow the dam once nothing of ours stands in the bed), let
  the valley grow back; every goal turns the land a phase greener. It closes
  with DELTA's annual report, "Year one", then sandbox.
- Both end in a report (a mission report, or a founding report) and the
  credits roll.

## Visual arc: from cozy to NIHIL

The world starts cosy and warm (think a sunny farming valley) and darkens with
every milestone, so the landscape tells the story alongside DELTA. The player
should *feel* the cost of their own factory before the plot spells it out.

| Phase done | Time of day | Landscape | NILE's presence |
|---|---|---|---|
| 0: start | sunny morning, pale Moon in a blue sky | lush grass, green trees, flowers, crops, fences, a pond with lilies, butterflies | one landing pad and a friendly sign |
| 1 | afternoon | still green; first trees felled near the factory (stumps) | shipping containers, a tent camp |
| 2 | golden hour | autumn trees (`_fall`), flowers thinning, grass yellowing | first buildings, a satellite dish |
| 3 | dusk, purple sky | dark trees (`_dark`), grass dying, smog, falling ash | chimneys with smoke, more compound |
| 4: reveal | night, red sky | mostly stumps, dead ground, no flowers left | the compound dominates, NIHIL branding, red lights |
| 5: ending | blood-red night | scorched | Moon+ in the sky |

Two layers drive it:

- **Global mood per phase:** sky, sun/moon light colour and angle, tree
  variant (normal → `_fall` → `_dark` → stump), grass colour, particles
  (butterflies/pollen → ash → red embers), later also music. The change
  eases in over several seconds when a phase completes.
- **The factory's own footprint:** grass turns to concrete under every
  building (not under conveyors, which are laid by the hundred) and stays paved, and smelters and generators brown the grass
  around them. Your own factory visibly eats the valley.

Assets: Kenney Nature Kit (trees in normal/fall/dark variants, stumps,
flowers, mushrooms, crops, fences, tents, campfire, river and pond tiles,
lilies), City Kit Industrial and Space Kit for NILE's compound.

## Roadmap — built in iterations

Each iteration should be playable on its own before the next one starts.

- [x] **Iteration 1 — story & goal.** Campaign phases, Dispatch Pad
      deliveries, building unlocks, DELTA comms panel with tutorial and story
      beats, objectives, title screen, phase banners, simple ending, autosave.
- [x] **Iteration 2 — 2.5D world.** Three.js renderer with real 3D models
      (Kenney CC0: Factory, City Industrial, Space, Nature kits) under an
      isometric orthographic camera (pan, zoom, 90° rotation); the sim stays a
      square grid. 32×24 map with nine ore fields, a concrete plateau on a
      cliff-edged rim with NILE's compound, night sky + moon, animated belts
      and machines, build ghost, objective focus rings, red NIHIL lighting
      after the reveal. *Moved to iteration 3:* the cannon as a multi-tile
      structure on the map.
- [x] **Iteration 3 — atmosphere: the cozy-to-NIHIL arc.** The green valley
      that darkens per phase (time of day, grass, trees normal → autumn →
      dark → felled, flowers, crops, pond, campfire), concrete scars under
      the factory, NILE's compound spreading in from the east, the cannon
      rising on its reserved site beside the pad (hologram → solid per
      phase), sky crossfading per phase, butterflies / smoke / ash / embers,
      halo glows, and juice: pop-in + dust on build, shrink + dust on
      demolish, sparkles on upgrade, floating credits on delivery.
      *Skipped:* real bloom (fights the transparent canvas over the CSS sky;
      halo sprites instead).
- [ ] **Iteration 3b — HUD & sound.**
      - [x] Branding: three directions on a Claude Design canvas, D chosen;
            renamed to *Protocol: Selene* with NILE/NIHIL as acronyms.
      - [x] HUD rebuilt in D style as an overlay on a full-window view: top
            bar, phase ribbon, console (requirements, flight plan, research,
            priority request), hardware keys, DELTA's CAPCOM terminal, hover
            tooltip, new title screen and ending; self-hosted OFL fonts.
      - [x] Sound, all synthesized in the browser (no sample files): a
            procedural score whose mode darkens one note per milestone
            (Ionian → Mixolydian → Dorian → Aeolian → Phrygian → Locrian, all
            on D), effect cues for every action, phase stingers in the new
            mood's key, a reveal jingle that tape-stops into a Phrygian hit,
            the ending timed to its animation, Quindar tones around DELTA's
            transmissions, and an ambience of birds → crickets → wind and
            rumble with a factory hum that sags in brownouts. Sound settings
            in the top bar; `?sounds` soundboard in dev.
      - [x] Voice pipeline for DELTA: `npm run voice` records the lines with
            ElevenLabs (takes + review page), the game plays them with
            ducking and synced text.
      - [ ] Record DELTA's voice (Voice Design: a calm, slow woman in her
            late twenties) and, optionally, a NILE announcer; listen to the
            whole sound design and tune it.
      - [x] Juice: camera shake (phase completion, builds, demolitions,
            the shot) and a zoom punch, pan momentum, a build ghost that pops
            in, turns smoothly and shakes when refused, cost and refund
            floats, a counting and flashing credits readout, requirement and
            objective pops, a phase flash at the screen edges.
      - [x] Build keys show the real machines: icons rendered at startup from
            the 3D models (locked ones greyed with a lock); upgrade /
            demolish / rotate get small 3D props in the same style (gold
            chevrons over a machine, a sledgehammer on a crate, an arrow
            round a belt).
      - [x] The cannon redesigned as one artillery turret (turntable, cheek
            plates, breech, railed barrel with bands and a muzzle brake),
            with a tracking dish and a capacitor bank cabled into it; the
            Dispatch Pad's tall light beam replaced by a compact drop-zone
            marker (short cone, bobbing arrow, pulsing ring).
      - [x] The cannon's construction site: blueprint holograms with a scan
            line, real scaffolding around the part being built, a painted
            launch deck (hazard border, NILE mark, red NIHIL repaint after
            the reveal), cones and tape around the dig, crates, a crane and
            beacons, cleared away when the cannon stands.
      - [x] Port arrows on machines (teal in, orange out; dim when nothing
            is hooked up, red when the output is blocked), on the build
            ghost too, and an inspector that says what a machine takes,
            makes and holds and how it is hooked up.
      - [x] The ending rebuilt in the world, in the HUD's style: letterbox,
            the camera cuts to the cannon, the turret swivels to the Moon
            during the countdown, the shot (beam, recoil, flash, shockwave),
            the Moon breaks, the Moon+ billboard switches on in its place and
            stays in the sandbox sky, DELTA's last lines as subtitles, and a
            mission report in the console style.
- [ ] **Iteration 4 — content & balance**, in three playable parts. Goal: a
      45–90 minute campaign where the whole production loop has to be built
      (no winning by spamming one product).
      - [ ] **4a — systems.**
        - [x] A panel per machine (click it): the recipe (chosen, not
              guessed from the inputs; new machines start on the last
              choice), rates per minute, what it holds, upgrade with the
              speed gain, switch on/off. The Dispatch Pad's panel is the
              market.
        - [x] The Fabricator: circuits → Data Cartridges, which the Lab
              reads into research (replaces the assembler's hidden
              "2 circuits → research").
        - [x] Power overload: a brownout still only slows things, but
              demand above 125% of supply for 5 s trips the breaker; reset
              it on the power gauge once the load is down.
        - [x] Market saturation at the Dispatch Pad: each sale lowers that
              item's price, prices recover over a minute or so; Priority
              Requests pay in full. Spamming one product stops paying.
        - [x] Status bubbles over machines (waiting, blocked, no power,
              off) and a production overview (made / used / sold per
              minute, machines by status).
        - [ ] Record DELTA's new and changed tutorial lines.
      - [ ] **4b — content.**
        - [x] Press (plates, wire), Foundry (steel), Mixer (explosives); new
              products (plates, wire, steel, capacitors, motors, explosives,
              the Selene Shell); research cartridges from circuit + wire.
        - [x] The five phases rebalanced so every chain is needed (see the
              table above); Priority Requests ask for the goods of the
              current phase.
        - [x] Sulfur appears at the reveal where NIHIL drained the pond.
        - [x] Keys in chain order: 1 belt, 2 extractor, 3 smelter, 4 press,
              5 foundry, 6 assembler, 7 fabricator, 8 lab, 9 mixer,
              0 generator; T/Y splitter/merger, U/X upgrade/demolish.
        - [ ] Record DELTA's new tutorial lines; playtest the pacing
              (target 45–90 minutes).
      - [ ] **4c — world & tidiness.**
        - [x] A small fenced plot around the pad that grows with every
              phase (NILE "acquires" the farmland, the forest edge, then the
              whole valley); nothing can be built outside it.
        - [x] The pond becomes a river across the south-west corner; nothing
              can be built on the water. NIHIL dams it at the reveal and the
              sulfur lies in the dry bed.
        - [x] Select (V): drag a box round machines, then move (G) or copy
              (C) the lot (R turns it while carried; copies cost their build
              price), or demolish it (X). Pipette (F): build what is under
              the cursor, same direction and recipe.
        - [ ] Record DELTA's lines about the plot, the river and the tip.
- [ ] **Iteration 5 — finale.**
      - [x] The ending choice: fire at the Moon, or override and destroy
            NIHIL HQ (a tower on the east rim, NILE's sign until the reveal);
            the HQ cinematic (aim east, a shell in an arc, the tower comes
            down), dawn, naming your company, a founding report; a credits
            roll from either report. Foreshadowed in the last phase.
      - [ ] Record the new lines (the choice, the HQ ending, the founder's
            chatter).
      (Save slots and settings moved to iteration 6.)
- [ ] **Iteration 6 — accounts, save slots, settings, Infinite & a leaderboard.**
      - [x] Hosting on Railway in three services: Postgres (db), a Rust API
            (`api/`: axum, sqlx, Argon2id; private network only) and the game
            (`web/`: Caddy serves the build and passes `/api` on, so the
            browser sees one site). See `docs/DEPLOY.md`.
      - [x] Accounts: a username and a password, a one-time recovery code
            instead of an e-mail address, an HttpOnly session cookie. No
            e-mail or IP addresses are stored; download or delete everything
            from the account panel.
      - [x] Save slots: named slots with a blueprint thumbnail, phase or land,
            play time and sync state; Save, Save as, rename, copy, delete,
            export and import (`.selene.json`); local first, synced to the
            account when signed in (a conflict keeps both copies). The old
            single save becomes the first slot.
      - [x] Settings (the gear in the top bar, and on the title screen):
            Audio (the old Sound popover), Graphics (shadows, render scale,
            particles, camera shake), Gameplay (autosave interval, DELTA's
            hints, text speed, voice), Controls (every key rebindable) and
            Accessibility (colour-blind-safe port arrows, reduced motion,
            interface size). Kept locally and in the account.
      - [x] New game: Story or Infinite. Infinite has no campaign and no
            cannon, and the valley stays green: buildings are licensed and
            land is bought with credits, Priority Requests grow with every
            one filled, the sulfur comes with the last land on the east rim,
            and DELTA has a short script of her own. (`continueAsInfinite()`
            could later carry a finished campaign into Infinite on its own map.)
      - [x] A leaderboard the client can't fake: the server rebuilds the
            submitted factory and runs the game's own simulation on it in
            QuickJS (a fresh Infinite valley, 1 minute warm-up, 5 minutes
            scored at market prices). Boards: throughput (credits per minute)
            and efficiency (per occupied cell). It does not prove the factory
            was built in play; a Story speedrun board would need a replay of
            every input.
      - [x] Live on Railway at selene.schellekensdigital.be; DELTA's Infinite
            lines recorded (34 clips); the "Gemaakt door Schellekens Digital"
            badge on the title screen and at the end of the credits.
      - [x] One Menu in the top bar (and on Esc) for everything that isn't
            playing: resume, save, saves, settings, leaderboard, account, and
            Main menu (back to the title screen to switch between Story and
            Infinite); the game pauses while it is open. The title screen
            stacks on narrow windows (the NILE lockup no longer covers the
            patch), and phones get a notice (made for a computer, play anyway)
            and menus that fit.
      - [ ] Playtest Infinite's prices (licences, land, request growth).
- [ ] **Iteration 7 — build help, a codex, blueprints, profiles, a weekly challenge, an epilogue.**
      Built in six parallel streams and merged.
      - [x] Build help: undo / redo (Ctrl+Z / Ctrl+Y, 100 steps, credits reversed exactly, nothing
            duplicated: demolished machines come back empty); an alerts list (top bar, N) of problems
            that lasted a few seconds, grouped, a click jumps to the machine; ratios in the machine
            panel (how many suppliers keep it busy, how many machines it feeds).
      - [x] Codex & tutorial highlights: an in-game codex (K) for items, buildings, recipes and
            research, generated from the game's data, searchable, every entry linked to the next, with
            what's locked for you now and NIHIL's things Classified until the reveal; highlights that
            show where a tutorial objective wants you to look, switchable in Settings.
      - [x] Blueprints and shared factories: save a selection as a named blueprint (B), a library in the
            browser and the account, placed like a copy; every leaderboard factory can be watched
            running, read-only (View, or a share link `/?factory=<id>`), and copied as a blueprint.
      - [x] Profile, achievements, passkeys: 40 achievements weighted to Infinite (plus Story's phases,
            endings and a few secret ones), a profile page (an avatar from the game's own pictures, some
            earned; play time; best scores with rank; endings), public unless switched off (`?player=`
            links), passkey sign-in next to password and recovery code.
      - [x] Weekly challenge: one factory puzzle per ISO week, the same for everyone (a theme, a target
            product, a machine cap, a budget, a tier cap, the week's own ore), its own save slot, rebuilt
            and scored by the server under the week's rules, a board per week. Later: a daily variant.
      - [x] The epilogue after the NIHIL HQ ending: four goals (the camp fire, the compound, the river,
            the valley), each changing the valley (the dam blown and the river back, the land greener
            every goal), DELTA as co-founder, an annual report; older saves start it on load.
      - [x] Nolan Isaac Locke present before the reveal: the Chief Executive's messages in NILE's
            broadcasts, memos over his initials, DELTA's mentions, his name on the site's sign.
      - [x] Recorded the 43 new lines (Nolan's pre-reveal broadcasts, DELTA's lines, the epilogue, the
            challenge's fixed lines); a challenge's per-week lines stay text.
      - [x] Confirm delivery: a phase (and an epilogue goal) waits once everything is on the pad;
            the console's button sends it, and DELTA says when it's ready. The title screen fits
            short windows (it scrolls instead of cutting off the patch), with Load game, Leaderboard
            and Settings under Continue, and a Resume per mode.
      - [x] A hands-on Story tutorial: a "Now" card at the top of the console with the open step
            (step n of m, how to do it at once, the buildings in pictures), sky-blue example
            buildings and belt arrows on the map for the first chain, a camera that goes to the
            step, stuck lines explained by their cause (a machine facing its feed, a wrong recipe,
            something a machine or the Pad can't use, a belt that stops short, a missing
            ingredient) with Show me, a red tile on the map and a tip from DELTA, hints after 20 s
            while learning; the opening is hands first (the story after the first delivery) and
            phase 2's machines come one at a time. Switchable in Settings (Tutorial) and from the
            card. After a fresh-eyes playtest: examples that always fit inside the land, an orange
            arrow for which way an example faces, "press R" while you hold it turned the wrong way,
            Turn in the machine panel, a toast for why a click didn't build, and the first Priority
            Request after the first Circuit.
      - [ ] Examples on the map for phase 2's machines too (Press, Assembler, Splitter).
      - [ ] Playtest the epilogue's goal sizes and the challenge's weeks at real pace.
