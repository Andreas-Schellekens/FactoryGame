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
more in the ending ("you, Asset, are now a cost").

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
