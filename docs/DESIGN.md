# Project Lifeline — design & roadmap

A 2D (soon 2.5D) factory game with a story and an ending. You are a "Pioneer"
contracted by **Nile** to build a giant cannon that will save Earth from the
falling Moon. Over the campaign it becomes clear that Nile is really
**NIHIL**, and that the Moon was never falling.

## Story bible

**Tone:** mostly satire (corporate dystopia, Satisfactory-style), but the first
act should make you feel like a hero saving the world.

**Nile** — mega-corporation, logo: a river swoosh running from N to E.
Tagline: *"Everything, from Source to Delta."* The logo gets corrupted phase by
phase:

| Phase done | Logo | What the player notices |
|---|---|---|
| 0 | NILE, blue river | Heroic briefing: the Moon falls in 17 days |
| 1 | NILE | Impact date silently revised to "soon" |
| 2 | NILE, rare glitch → NIHIL | Leaked memo: *Moon+* subscription tiers |
| 3 | frequent glitch | DELTA slips: "Nihil thanks you…" |
| 4+ | **NIHIL**, red flatline | Reveal: the Moon is fine; free moonlight undercuts Moon+ |

**DELTA** — *Dispatch & Engineering Logistics Task Assistant*, Nile's AI guide.
Cheerful, contractually positive, increasingly honest in the worst way. Portrait
is a river-delta triangle with an eye; its colour shifts with mood
(cyan → green happy → magenta glitch → red sinister).

**Project LIFELINE** — the cannon. Built in five phases by delivering goods to
the **Dispatch Pad**:

1. **Groundbreaking** — iron ingots → unlocks Assembler, Splitter, Merger
2. **Targeting Circuitry** — copper ingots + circuits → unlocks Lab
3. **Power Core** — circuits → unlocks Generator
4. **Payload** — advanced circuits → the reveal
5. **Ignition** — circuits + advanced circuits → the ending

**Ending (current):** the cannon fires, the Moon shatters, *Moon+* (an
ad-supported orbital billboard) goes live. "Congratulations, Pioneer. You have
saved Earth from free things."
*Planned:* an ending choice (fire at the Moon, or retarget Nihil HQ).

## Visual arc: from cozy to Nihil

The world starts cosy and warm (think a sunny farming valley) and darkens with
every milestone, so the landscape tells the story alongside DELTA. The player
should *feel* the cost of their own factory before the plot spells it out.

| Phase done | Time of day | Landscape | Nile's presence |
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
lilies), City Kit Industrial and Space Kit for Nile's compound.

## Roadmap — built in iterations

Each iteration should be playable on its own before the next one starts.

- [x] **Iteration 1 — story & goal.** Campaign phases, Dispatch Pad
      deliveries, building unlocks, DELTA comms panel with tutorial and story
      beats, objectives, title screen, phase banners, simple ending, autosave.
- [x] **Iteration 2 — 2.5D world.** Three.js renderer with real 3D models
      (Kenney CC0: Factory, City Industrial, Space, Nature kits) under an
      isometric orthographic camera (pan, zoom, 90° rotation); the sim stays a
      square grid. 32×24 map with nine ore fields, a concrete plateau on a
      cliff-edged rim with Nile's compound, night sky + moon, animated belts
      and machines, build ghost, objective focus rings, red Nihil lighting
      after the reveal. *Moved to iteration 3:* the cannon as a multi-tile
      structure on the map.
- [x] **Iteration 3 — atmosphere: the cozy-to-Nihil arc.** The green valley
      that darkens per phase (time of day, grass, trees normal → autumn →
      dark → felled, flowers, crops, pond, campfire), concrete scars under
      the factory, Nile's compound spreading in from the east, the cannon
      rising on its reserved site beside the pad (hologram → solid per
      phase), sky crossfading per phase, butterflies / smoke / ash / embers,
      halo glows, and juice: pop-in + dust on build, shrink + dust on
      demolish, sparkles on upgrade, floating credits on delivery.
      *Skipped:* real bloom (fights the transparent canvas over the CSS sky;
      halo sprites instead).
- [ ] **Iteration 3b — sound & HUD.** Sound effects and music (CC0) that
      follow the arc (cheerful → industrial → ominous); HUD restyle with a
      proper display font; more juice (screen shake on phase completion,
      hover feedback, smoother tool switching).
- [ ] **Iteration 4 — content & balance.** New resources and intermediate
      products (steel, wire, plates, motors, explosives…), phases rebalanced
      into a 45–90 minute campaign.
- [ ] **Iteration 5 — finale & polish.** Firing cinematic, ending choice,
      credits, save slots, settings.
