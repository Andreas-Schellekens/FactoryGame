# Protocol: Selene — design & roadmap

A 2.5D factory game with a story and an ending. You are a "Pioneer"
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
and the player's CAPCOM. Cheerful, contractually positive, increasingly honest
in the worst way. Portrait is an oscilloscope badge whose trace follows its
mood (teal → bright sine when happy → magenta noise on a glitch → a red
flatline when sinister) and bounces while it speaks.

**Protocol: Selene** — the cannon. Built in five phases by delivering goods to
the **Dispatch Pad**:

1. **Groundbreaking** — iron ingots → unlocks Assembler, Splitter, Merger
2. **Targeting Circuitry** — copper ingots + circuits → unlocks Lab
3. **Power Core** — circuits → unlocks Generator
4. **Payload** — advanced circuits → the reveal
5. **Ignition** — circuits + advanced circuits → the ending

**Ending (current):** the cannon fires, the Moon shatters, *Moon+* (an
ad-supported orbital billboard) goes live. "Congratulations, Pioneer. You have
saved Earth from free things."
*Planned:* an ending choice (fire at the Moon, or retarget NIHIL HQ).

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
      - [ ] Sound effects and music (CC0) that follow the arc (cheerful →
            industrial → ominous); more juice (screen shake on phase
            completion, smoother tool switching).
- [ ] **Iteration 4 — content & balance.** New resources and intermediate
      products (steel, wire, plates, motors, explosives…), phases rebalanced
      into a 45–90 minute campaign.
- [ ] **Iteration 5 — finale & polish.** Firing cinematic, ending choice,
      credits, save slots, settings.
