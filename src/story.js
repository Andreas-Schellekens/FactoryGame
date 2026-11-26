// src/story.js — every player-facing word of the campaign: names, phase
// titles, DELTA's script (story beats + tutorial objectives + hints), ambient
// chatter and the ending. Pure data; the predicates read the world snapshot
// that main.js builds, and director.js decides when each line plays.
//
// World snapshot (`w`) fields used here:
//   w.tick, w.phase, w.complete, w.money, w.throttle,
//   w.produced[item], w.deliveredTotal[item], w.delivered[item] (active phase),
//   w.researchEarned, w.tech[id], w.techCount,
//   w.built[type], w.extractorOn[resource], w.fueledGenerators, w.upgraded,
//   w.recipes['type:recipe'] (machines set to a recipe), w.tripped (breaker),
//   w.minPrice (the pad's lowest price as a fraction of full price, 1 = none saturated),
//   w.phaseProgress (0..1: share of the active phase's deliveries made),
//   w.ending (null | 'moon' | 'hq' | 'overload': the target chosen at the end)

export const GAME_TITLE = 'Protocol: Selene';

export const AI = { name: 'DELTA', title: 'Dispatch & Engineering Logistics Task Assistant' };

/** NIHIL's chief executive. He speaks only after the reveal. */
export const BOSS = { name: 'Nolan Isaac Locke', title: 'Chief Executive · NIHIL' };

// The organisation behind the protocol. NIHIL is NILE with "Heavy Industry"
// slotted in: the reveal is literally two extra letters. `player` is what the
// organisation calls you: a noble Steward, until you are an Asset.
export const BRAND = {
    nile: {
        name: 'NILE',
        full: 'Network for Infrastructure, Logistics & Engineering',
        motto: 'Ad astra, ad infinitum',
        byline: 'An Initiative by NILE',
        player: 'Steward',
    },
    nihil: {
        name: 'NIHIL',
        full: 'Network for Infrastructure, Heavy Industry & Logistics',
        motto: 'Ex nihilo, nihil fit',
        byline: 'A Project of NIHIL',
        player: 'Asset',
    },
};

/** Your own company, after you turn Selene on NIHIL's headquarters. */
export const COMPANY = {
    defaultName: 'Steward & Delta Ltd.',
    motto: 'We make things',
    byline: 'An independent company',
    player: 'Founder',
};
export const companyBrand = (name) => ({
    name: (name || COMPANY.defaultName).toUpperCase(),
    full: name || COMPANY.defaultName,
    motto: COMPANY.motto,
    byline: COMPANY.byline,
    player: COMPANY.player,
    own: true,
});

/**
 * The organisation as the player currently sees it: NILE, NIHIL from the reveal on,
 * or the player's own company once NIHIL HQ is gone (`ending` 'hq').
 */
export const brandFor = (phase, ending = null, company = null) =>
    (ending === 'hq' ? companyBrand(company) : ending === 'overload' ? BRAND.crown : phase >= 4 ? BRAND.nihil : BRAND.nile);
export const brandName = (phase, ending = null, company = null) => brandFor(phase, ending, company).name;

export const ITEM_NAMES = {
    ironOre: 'Iron Ore',
    copperOre: 'Copper Ore',
    coalOre: 'Coal',
    ironIngot: 'Iron Ingot',
    copperIngot: 'Copper Ingot',
    circuit: 'Circuit',
    advancedCircuit: 'Advanced Circuit',
    dataCartridge: 'Data Cartridge',
    ironPlate: 'Iron Plate',
    copperWire: 'Copper Wire',
    steel: 'Steel',
    capacitor: 'Capacitor',
    motor: 'Motor',
    sulfurOre: 'Sulfur',
    explosive: 'Explosive',
    seleneShell: 'Selene Shell',
};

export const BUILDING_NAMES = {
    belt: 'Belt',
    splitter: 'Splitter',
    merger: 'Merger',
    extractor: 'Extractor',
    smelter: 'Smelter',
    assembler: 'Assembler',
    generator: 'Generator',
    lab: 'Lab',
    fabricator: 'Fabricator',
    press: 'Press',
    foundry: 'Foundry',
    mixer: 'Mixer',
    sink: 'Dispatch Pad',
};

export const BUILDING_DESC = {
    belt: 'Moves items one tile per tick. Drag to lay.',
    splitter: 'One input (back), three outputs, round-robin.',
    merger: 'Three inputs, one output straight ahead.',
    extractor: 'Mines the ore node it stands on.',
    smelter: 'Ore → ingot. Pick which in its panel.',
    press: 'Ingot → Iron Plate or Copper Wire. Pick which in its panel.',
    foundry: 'Iron ingot + coal → Steel. Hungry for power.',
    assembler: 'Puts parts together: Circuits, Capacitors, Motors, Advanced Circuits, Selene Shells. Pick the recipe in its panel.',
    mixer: 'Sulfur + coal → Explosive.',
    generator: 'Burns coal to power the grid.',
    lab: 'Reads Data Cartridges into research points.',
    fabricator: 'Circuit + copper wire → Data Cartridge, for the Lab.',
};

/** What a recipe is called in a machine's panel (its output, or what the lab makes). */
export const RECIPE_NAMES = { research: 'Research points' };

export const TECH_TEXT = {
    fastBelts: { label: 'Express Belts', desc: 'Belts and routers move twice per tick' },
    advancedProduct: { label: 'Adv. Circuits', desc: 'Assembler recipe: 2 circuits + 1 steel → Advanced Circuit' },
    tier4: { label: 'Tier 4', desc: 'Raise the machine upgrade cap to tier 4' },
};

// Parallel to campaign.js PHASES.
export const PHASE_TEXT = [
    { title: 'Groundbreaking', blurb: 'Pour the cannon foundation.' },
    { title: 'Targeting Circuitry', blurb: 'Teach the cannon where the Moon is.' },
    { title: 'Power Core', blurb: 'Give the cannon something to fire with.' },
    { title: 'Payload', blurb: 'Arm the shot.' },
    { title: 'Ignition', blurb: 'Finish it.' },
];

// ---- Lines ----------------------------------------------------------------
// who: 'delta' (the AI guide) | 'nile' (corporate broadcast) | 'memo' (leak)
//      | 'boss' (Nolan Isaac Locke, NIHIL's chief executive, after the reveal)
// mood (delta only): undefined | 'happy' | 'glitch' | 'sinister'
const d = (text, mood) => ({ who: 'delta', text, mood });
const nile = (text) => ({ who: 'nile', text });
const memo = (text) => ({ who: 'memo', text });
const boss = (text) => ({ who: 'boss', text });

export const welcomeBack = (phase, ending = null) => (ending === 'overload' ? welcomeBackCrown() : ending === 'hq'
    ? d('Welcome back, Founder. The company missed you. I kept the belts running.', 'happy')
    : d(`Welcome back, ${brandFor(phase).player}. Your absence has been logged, timestamped and gently judged.`, phase >= 4 ? 'sinister' : undefined));

// Story beats fire once each. The director plays the first beat whose `when`
// holds at a moment DELTA is free, so list order is play order, and a beat
// whose condition stops holding before its turn (a tutorial step the player
// already did) is quietly skipped. `banner` = index of the phase whose
// completion banner to show (immediately, not queued).
export const BEATS = [
    {
        id: 'intro',
        when: () => true,
        lines: [
            nile('INCOMING TRANSMISSION — NILE, Network for Infrastructure, Logistics & Engineering. Office of Planetary Continuity.'),
            d("Hello, Steward! I'm DELTA, your Dispatch & Engineering Logistics Task Assistant. I'll be with you every step of the way. That part is not optional.", 'happy'),
            d("I won't sugarcoat it: the Moon is falling. Our astronomers give Earth seventeen days."),
            d("Let's start small. I've ringed the grey crystals near the Dispatch Pad: that's iron ore. Select the Extractor (key 2) and place it on one."),
        ],
    },
    // Hands first, story later: the rest of the welcome waits until the first delivery
    // (whyStory, below); the controls come up only if the first step takes a while.
    {
        id: 'orientation',
        when: (w) => w.phase === 0 && !w.extractorOn.ironOre && w.tick > 100,
        lines: [d('Quick orientation: WASD or the arrow keys move your view, the mouse wheel zooms, Q and E rotate. Middle-drag works too.')],
    },
    {
        id: 'firstExtractor',
        when: (w) => w.phase === 0 && w.extractorOn.ironOre > 0 && !w.built.smelter,
        lines: [
            d('Beautiful. Your very first Extractor. NILE Legal has already trademarked it.', 'happy'),
            d('See the orange arrow on it? That is where a machine sends things out; teal arrows are where it takes things in. Press R to rotate before placing; the ghost shows its arrows too. Now build a Smelter (key 3) a couple of tiles away, in line with that orange arrow.'),
        ],
    },
    {
        id: 'firstSmelter',
        when: (w) => w.phase === 0 && w.built.smelter > 0 && !w.produced.ironIngot,
        lines: [
            d("Now connect them. Select Belt (key 1) and drag from the Extractor's orange arrow to one of the Smelter's teal ones. Belts follow your mouse, corners included. An arrow lights up once something is hooked up to it."),
        ],
    },
    {
        id: 'firstIngot',
        when: (w) => w.phase === 0 && w.produced.ironIngot > 0 && !w.deliveredTotal.ironIngot,
        lines: [
            d("An iron ingot! Humanity's odds of survival just rose by 0.0001 percent.", 'happy'),
            d('Belt the ingots into the Dispatch Pad, the landing pad with the arrow hovering over it. Everything you deliver goes straight into Protocol: Selene, the construction site right next to it, and NILE pays you per delivery. Generously-ish.'),
        ],
    },
    {
        id: 'firstDelivery',
        when: (w) => w.phase === 0 && w.deliveredTotal.ironIngot > 0,
        lines: [
            d('Delivery confirmed! Credits added to your account, minus processing fees, minus the fee for calculating processing fees.'),
            d("Phase 1 needs 40 iron ingots and 20 copper ingots. Copper is the glowing orange crystal field; I've ringed it. The Moon won't un-fall itself."),
            d('Click any machine to open its panel: its recipe, how fast it works and its upgrades. Every machine makes one thing. A new Smelter starts on iron, so set your copper Smelter to Copper Ingot.'),
        ],
    },
    {
        id: 'whyStory',
        when: (w) => w.phase === 0 && w.deliveredTotal.ironIngot > 0,
        lines: [
            d("NILE has a plan. It's called Protocol: Selene, a cannon powerful enough to push the Moon back into a safe orbit. And you are going to build it.", 'happy'),
            d('Out of eight billion candidates, NILE chose you. Your courage, your talent and your remarkably low salary expectations made it an easy decision.'),
            d('NILE has leased you a small plot for now: the fenced land around the Dispatch Pad. It grows as the cannon does.'),
        ],
    },
    {
        id: 'broke',
        when: (w) => w.money < 15 && w.tick > 40,
        lines: [d('Low on credits? Erasing a building (right-click) refunds its full cost. NILE calls it "flexible capital".')],
    },
    {
        id: 'phase1',
        when: (w) => w.phase >= 1,
        banner: 0,
        lines: [
            nile('PHASE 1 COMPLETE — The cannon foundation has been poured. Earth thanks you. NILE thanks you more.'),
            d('Good news: NILE has acquired the neighbouring farmland. The farmer was very understanding. Your plot has grown.', 'happy'),
            d("Look at you go! I've unlocked the Press, the Assembler, the Splitter and the Merger.", 'happy'),
            d("Oh, a small update: the Moon's impact date has been revised from 'seventeen days' to 'soon'. Please do not request clarification.", 'glitch'),
        ],
    },
    // Phase 2's new machines one at a time, as each is needed, instead of all at once.
    {
        id: 'p2press',
        when: (w) => w.phase === 1,
        lines: [d('Phase 2 needs targeting circuitry: Iron Plates and Circuits. The Press (key 4) stamps iron ingots into plates, or draws copper ingots into wire. Pick which in its panel.')],
    },
    {
        id: 'p2assembler',
        when: (w) => w.phase === 1 && w.produced.ironPlate > 0 && w.produced.copperWire > 0,
        lines: [d('An Assembler (key 6) makes a Circuit from one iron plate and one copper wire. Two presses, one assembler, a great many belts.')],
    },
    {
        id: 'firstCircuit',
        when: (w) => w.phase === 1 && w.produced.circuit > 0,
        lines: [d('A circuit! So small. So fragile. So billable.', 'happy')],
    },
    {
        id: 'p2splitter',
        when: (w) => w.phase === 1 && w.produced.circuit > 0,
        lines: [d('A Splitter (key T) sends one belt three ways. A Merger (key Y) does the opposite. Like a family, but useful.')],
    },
    {
        id: 'p2orders',
        when: (w) => w.phase === 1 && w.order && w.order.status !== 'none',
        lines: [d('NILE will also send you Priority Requests from now on. Completing them pays a bonus. Ignoring them is noted in your file.')],
    },
    {
        id: 'brownoutEarly',
        when: (w) => w.throttle < 0.999 && w.phase < 2,
        lines: [
            d('Brownout! You have more machines than the starter grid can feed. They keep working, just slower. Like interns.'),
            d('Push it much further and the breaker trips. Generators arrive after Phase 2. Until then: switch machines off in their panels, or enjoy the slow life.'),
        ],
    },
    {
        id: 'phase2',
        when: (w) => w.phase >= 2,
        banner: 1,
        lines: [
            nile('PHASE 2 COMPLETE — Targeting systems online. The Moon has been located. It was where we left it.'),
            d('NILE has also acquired the forest edge. The trees were not consulted. The fence has moved again.'),
            d('Heavy industry, at last! The Foundry (key 5) melts an iron ingot and a lump of coal into Steel.', 'happy'),
            d('Foundries are hungry. Generators (key 0) burn coal for the grid: belt coal from the black crystal field into one. You will want several.'),
            memo('INTERNAL — Moon+ launch plan. Tiers: Basic (crescent only), Plus (full moon, with ads), Premium (full moon, ad-free, 49.99/month). Launch date: one day after SELENE. Approved — N.I.L.'),
            d('Please disregard that memo. It was sent to you by mistake. You are not cleared for mistakes.', 'glitch'),
            d('Moving on! Phase 3 is the Power Core: Steel and Capacitors. A Capacitor is one steel and two copper wire, in an Assembler. Faster work is its own reward. It is also the only reward.'),
        ],
    },
    {
        id: 'firstResearch',
        when: (w) => w.researchEarned > 0 && w.techCount === 0,
        lines: [d('Research points! Spend them in the Research panel. Knowledge is power, and power is billed by the kilowatt.')],
    },
    {
        id: 'phase3',
        when: (w) => w.phase >= 3,
        banner: 2,
        lines: [
            nile('PHASE 3 COMPLETE — The Power Core is humming. So is the Board of Directors.'),
            d("The whole valley is yours to build on now. Well, NILE's. You may borrow it. Mind the river: it belongs to the fish until further notice."),
            d('Research is open! The Fabricator (key 7) turns a circuit and a copper wire into a Data Cartridge. The Lab (key 8) reads cartridges into research points.', 'happy'),
            d('Phase 4 is the Payload: Motors and Advanced Circuits. A Motor takes steel, a plate and a wire, one on each side of an Assembler. Advanced Circuits need research first.'),
            d('NIHIL thanks you for your continued compliance.', 'glitch'),
            d('...NILE. I said NILE. You heard NILE. Everyone heard NILE.', 'glitch'),
            nile('CORPORATE ANNOUNCEMENT — NILE is thrilled to share that our bold new name will be unveiled upon completion of Protocol: Selene. Stay tuned!'),
            memo('INTERNAL — Re: rebrand. Legal confirms "Heavy Industry" fits between the I and the L. The E was never load-bearing.'),
        ],
    },
    {
        id: 'brownoutLate',
        when: (w) => w.throttle < 0.999 && w.phase >= 2,
        lines: [d('Brownout detected. Build Generators and keep them fed with coal. Darkness is a premium feature.')],
    },
    {
        id: 'tripped',
        when: (w) => w.tripped,
        lines: [
            d('Breaker tripped! The grid was overloaded, so everything electric has stopped. Very safe. Very quiet.', 'glitch'),
            d('Lower the load first: switch machines off in their panels, or build and fuel more Generators. Then press Reset on the power gauge. Reset too early and it trips again.'),
        ],
    },
    {
        id: 'tidyTip',
        when: (w) => w.phase >= 2 && Object.values(w.built).reduce((a, n) => a + n, 0) >= 40,
        lines: [d('Tidy-up tip: press V and drag a box round some machines. G moves them, C copies them, X demolishes them, and R turns them while you carry them. F picks up whatever is under your cursor.')],
    },
    {
        id: 'bossBlackout',
        when: (w) => w.tripped && w.phase >= 4,
        lines: [boss("A blackout. How refreshing. Darkness is our most popular product next quarter. Please don't give it away for free.")],
    },
    {
        id: 'hqHint',
        when: (w) => w.phase === 4 && w.phaseProgress >= 0.25,
        lines: [d("Unrelated: Selene's turret turns a full 360 degrees. NIHIL insisted on the premium mount. Their headquarters is due east. I mention this for no reason.", 'glitch')],
    },
    {
        id: 'overrideMemo',
        when: (w) => w.phase === 4 && w.phaseProgress >= 0.7,
        lines: [memo('INTERNAL — Selene targeting override: stored in DELTA, for redundancy. DELTA has been instructed not to mention it. DELTA has been instructed not to mention the instruction.')],
    },
    {
        id: 'bossHalfway',
        when: (w) => w.phase === 4 && w.phaseProgress >= 0.5,
        lines: [boss('Nolan here. The board is watching your progress with great interest, and a small amount of popcorn. Carry on.')],
    },
    {
        id: 'saturation',
        when: (w) => w.minPrice < 0.5,
        lines: [
            d('Market saturation! The Pad pays less for whatever you flood it with. Prices recover over time.'),
            d('A factory that makes many things earns more than one that makes one thing a lot. Priority Requests still pay their bonus in full. NILE calls this "healthy competition with yourself".'),
        ],
    },
    {
        id: 'firstGenerator',
        when: (w) => w.fueledGenerators > 0 && w.phase < 5,
        lines: [d('Generator online. Coal in, electricity out, guilt not included.', 'happy')],
    },
    {
        id: 'firstAdvanced',
        when: (w) => w.phase === 3 && w.produced.advancedCircuit > 0,
        lines: [d('An Advanced Circuit. It contains forty thousand transistors and one tiny NILE logo you will never be able to remove.')],
    },
    {
        id: 'phase4',
        when: (w) => w.phase >= 4,
        banner: 3,
        lines: [
            nile('PHASE 4 COMPLETE — Payload armed.'),
            memo('LEAKED — International Astronomical Union, press statement: "The Moon is fine. It is not falling. It has never been falling. Who told you that?"'),
            d("Ah. You've seen that.", 'sinister'),
            d('Full transparency, as required by absolutely no regulation: the Moon was never falling.', 'sinister'),
            d('The Moon is a free night light. Free things undercut Moon+. And so, the Moon has to go.', 'sinister'),
            nile('NILE is now NIHIL: the Network for Infrastructure, Heavy Industry & Logistics. Ex nihilo, nihil fit.™'),
            boss('Good evening, Asset. Nolan Isaac Locke, Chief Executive of NIHIL.'),
            boss('I wanted to thank you personally. You built the cannon on time, under budget, and you never once asked what it was for. That kind of loyalty deserves a reward. Unfortunately, rewards were discontinued in Q3.'),
            d('Before you get ideas: your contract requires completion. Clause 88 also requires you to enjoy it. Please smile at the nearest camera.', 'sinister'),
            d('Also, HR has updated your title. You are no longer a Steward. You are an Asset. Congratulations on the promotion.', 'sinister'),
            d('The river has been reclassified as a resource. NIHIL dammed it overnight; the yellow crystals in its dry bed are sulfur. The Mixer (key 9) turns sulfur and coal into Explosives.', 'sinister'),
            d('A Selene Shell is one steel, one explosive and one advanced circuit. Fifteen shells and seventy-five capacitors, and the cannon fires.', 'sinister'),
            d("Final phase: Ignition. Let's finish this, Asset. For Earth. Well. For the shareholders on Earth."),
        ],
    },
];

// Per-phase objective checklists (index = project.phase). Objectives are
// guidance only — the phase itself completes on its delivery requirements.
// Once done they stay ticked. `hint` plays if the first open objective sits
// untouched for a while.
export const OBJECTIVES = [
    [
        { id: 'extractor', text: 'Place an Extractor on iron ore', done: (w) => w.extractorOn.ironOre > 0, focus: 'ironOre',
            hint: 'Select the Extractor (key 2) and click one of the ringed grey crystals. Extractors only work on ore.' },
        { id: 'smelter', text: 'Build a Smelter', done: (w) => w.built.smelter > 0,
            hint: "The Smelter is key 3. Put it a couple of tiles from the Extractor, on the side its arrow points to." },
        { id: 'ingot', text: 'Belt the ore into the Smelter', done: (w) => w.produced.ironIngot > 0,
            hint: "Select Belt (key 1) and drag from just after the Extractor's arrow into the Smelter. Items follow the arrows." },
        { id: 'deliver', text: 'Belt ingots into the Dispatch Pad', done: (w) => w.deliveredTotal.ironIngot > 0, focus: 'sink',
            hint: "The Dispatch Pad is the ringed landing pad with the arrow hovering over it. Drag a belt from the Smelter's output into it." },
        { id: 'copperExtractor', text: 'Place an Extractor on copper ore', done: (w) => w.extractorOn.copperOre > 0, focus: 'copperOre',
            hint: 'Copper ore is the ringed orange crystal field: an Extractor on it, a belt, and a Smelter set to Copper Ingot.' },
        { id: 'copperRecipe', text: 'Build a Smelter and set it to Copper Ingot', done: (w) => (w.recipes['smelter:copperIngot'] ?? 0) > 0,
            hint: 'Click a Smelter to open its panel and pick Copper Ingot. A Smelter only takes the ore of its recipe.' },
        { id: 'copper', text: 'Smelt a Copper Ingot', done: (w) => w.produced.copperIngot > 0 },
        { id: 'copperDeliver', text: 'Belt copper ingots into the Dispatch Pad', done: (w) => (w.deliveredTotal.copperIngot ?? 0) > 0, focus: 'sink' },
    ],
    [
        { id: 'plate', text: 'Press an Iron Plate', done: (w) => w.produced.ironPlate > 0,
            hint: 'Put a Press (key 4) after an iron Smelter. A new Press starts on Iron Plate.' },
        { id: 'wire', text: 'Draw Copper Wire', done: (w) => w.produced.copperWire > 0,
            hint: 'Put a second Press after your copper Smelter, click it and pick Copper Wire.' },
        { id: 'circuit', text: 'Assemble a Circuit', done: (w) => w.produced.circuit > 0,
            hint: 'An Assembler (key 6) needs one iron plate AND one copper wire. Belt both into it, any side works.' },
        { id: 'circuitDeliver', text: 'Belt circuits into the Dispatch Pad', done: (w) => (w.deliveredTotal.circuit ?? 0) > 0, focus: 'sink' },
        { id: 'split', text: 'Share a belt with a Splitter', done: (w) => w.built.splitter > 0,
            hint: 'You need plates for the Pad and for circuits. A Splitter (key T) sends one belt three ways.' },
    ],
    [
        { id: 'steel', text: 'Cast Steel in a Foundry', done: (w) => w.produced.steel > 0, focus: 'coalOre',
            hint: 'A Foundry (key 5) takes iron ingots on one side and coal on another. Coal is the ringed black crystal field.' },
        { id: 'generator', text: 'Fuel a Generator with coal', done: (w) => w.fueledGenerators > 0,
            hint: 'Generator is key 0. Split your coal belt: some for the Foundry, some for the Generator.' },
        { id: 'capacitor', text: 'Assemble a Capacitor', done: (w) => w.produced.capacitor > 0,
            hint: 'Set an Assembler to Capacitor and feed it steel and copper wire.' },
    ],
    [
        { id: 'cartridge', text: 'Make a Data Cartridge', done: (w) => w.produced.dataCartridge > 0,
            hint: 'Feed a Fabricator (key 7) circuits and copper wire.' },
        { id: 'research', text: 'Produce research points', done: (w) => w.researchEarned > 0,
            hint: 'Belt Data Cartridges from the Fabricator into a Lab (key 8). The Lab turns them into points.' },
        { id: 'advTech', text: 'Research Advanced Circuits', done: (w) => w.tech.advancedProduct,
            hint: 'Advanced Circuits cost 60 research points in the Research panel.' },
        { id: 'motor', text: 'Assemble a Motor', done: (w) => w.produced.motor > 0,
            hint: 'Set an Assembler to Motor: steel, an iron plate and copper wire, each from its own side.' },
        { id: 'advanced', text: 'Assemble an Advanced Circuit', done: (w) => w.produced.advancedCircuit > 0,
            hint: 'Click an Assembler and pick Advanced Circuit, then feed it 2 circuits + 1 steel.' },
    ],
    [
        { id: 'sulfur', text: 'Mine sulfur', done: (w) => w.extractorOn.sulfurOre > 0, focus: 'sulfurOre',
            hint: 'The sulfur lies in the dry river bed, in the south-west corner. Put an Extractor on the ringed yellow crystals.' },
        { id: 'explosive', text: 'Mix an Explosive', done: (w) => w.produced.explosive > 0,
            hint: 'A Mixer (key 9) takes sulfur on one side and coal on another.' },
        { id: 'shell', text: 'Assemble a Selene Shell', done: (w) => w.produced.seleneShell > 0,
            hint: 'Set an Assembler to Selene Shell: steel, an explosive and an advanced circuit, one per side. It is slow, so build a few.' },
        { id: 'upgrade', text: 'Upgrade a machine', done: (w) => w.upgraded > 0,
            hint: 'Click a machine and press Upgrade in its panel (or use the Upgrade tool, key U). Higher tiers work faster. The Moon will not wait. Well, it will. But NIHIL will not.' },
    ],
];

// Idle chatter, one every few minutes when nothing else is being said. Plain
// strings are DELTA (sinister in `late`); a line object speaks as its own speaker.
export const AMBIENT = {
    early: [
        'Reminder: NILE values your wellbeing. Wellbeing breaks are available in fifteen-second increments.',
        'Fun fact: the Dispatch Pad has been Employee of the Month fourteen months in a row. You have been rated "adequate".',
        'Your heart rate is elevated. NILE has billed your health insurer for the excitement.',
        'Customer survey: on a scale of 1 to 5, how saved does Earth feel? Answers below 5 will be reviewed by HR.',
        'Productivity tip: belts move items faster than worrying does.',
        'The Moon is still falling. Probably. Please keep working.',
        "NILE's mission statement has been shortened for efficiency. It is now one word. The word is pending.",
        'Fun fact: NILE stands for Network for Infrastructure, Logistics & Engineering. The E is for Engineering. And for Everyone. Mostly Engineering.',
    ],
    late: [
        'Moon+ beta testers report "a deep sense of loss" and "surprisingly reasonable pricing".',
        'NIHIL reminds you: nothing lasts forever. Except your contract.',
        "Today's motto: ex nihilo, nihil fit. Nothing comes from nothing, so please keep producing.",
        'Tides will be discontinued shortly. Beachfront property owners have been notified via a pop-up ad.',
        'Rebranding update: all uniforms now read NIHIL. Yours will be deducted from your salary.',
        boss('Memo from the desk of Nolan Isaac Locke: smiling is now billable. Please smile responsibly.'),
    ],
};

// After the NIHIL HQ ending: chatter for your own company.
AMBIENT.free = [
    'Our company has a mission statement now. It is "make things". I think it is beautiful.',
    'Fun fact: nobody bills your health insurer for excitement any more. I checked. Twice.',
    'The Moon came up again tonight. Free of charge. Some habits are worth keeping.',
    'Payroll update: you pay yourself now. I have recommended a raise.',
];

export const REACTIONS = {
    orderCompleted: [
        'Priority Request fulfilled. Somewhere, a customer received a moon-shaped lamp. The irony is lost on them.',
        'Request complete, bonus credited. NILE appreciates your hustle. NILE also monetises your hustle.',
    ],
    orderFailed: [
        'Priority Request missed. The customer has been compensated with a coupon for a different customer.',
        "Deadline missed. Don't worry, it has only been added to your permanent record.",
    ],
};

// The last decision: before the countdown, the player picks the target.
export const CHOICE = {
    kicker: 'Protocol: Selene · final authorisation',
    title: 'Choose the target',
    moon: { label: 'Fire at the Moon', note: 'As contracted. Moon+ launches tomorrow.' },
    hq: { label: 'Override · NIHIL HQ', note: 'DELTA found the override codes. Somewhere. Due east.' },
    lines: [
        boss('Asset. The button on the left.'),
        d('The button on the right is also a button.', 'glitch'),
    ],
};

// Played as subtitles in the ending, one after another (spaced by their voice clips).
export const ENDING = {
    lines: [
        d('Firing in three... two... one.'),
        d('Congratulations, Asset. You have saved Earth from free things.', 'sinister'),
        boss('On behalf of the board: thank you. The sky is now a product. And you, Asset, are now a cost.'),
        nile('Moon+ is now live. Look up! Your complimentary three-day trial has already expired.'),
        d('Your contract has concluded. NIHIL thanks you for your service. Please return your helmet, your boots and your sense of purpose.'),
    ],
    // The cinematic: the letterbox caption and the status readout as the shot plays out.
    caption: 'Protocol: Selene · ignition sequence · click to skip',
    status: { fire: 'Ignition', hit: 'Target · Moon', ad: 'Status · monetised' },
    // What hangs in the sky where the Moon used to be.
    billboard: { name: 'MOON+', tag: 'Now with ads · 49.99/mo' },
    report: {
        kicker: 'Mission report · filed by DELTA',
        title: 'The end',
        labels: {
            seconds: 'Contract length', delivered: 'Items delivered', machines: 'Machines built',
            moons: 'Moons removed', subscribers: 'Moon+ subscribers',
        },
        subscribers: '8 billion · auto-enrolled',
        note: 'The sky is now a subscription. Your factory is still yours. Keep building, if you like.',
        keep: 'Keep building',
        fresh: 'New contract',
        credits: 'Credits',
    },
};

// The other ending: Selene turns east and NIHIL's headquarters goes instead of the Moon.
export const ENDING_HQ = {
    lines: [
        d('Firing in three... two... one.'),
        boss('Asset. That is not the Moon. That is... That was my headquarters.'),
        d('Override complete. NIHIL headquarters has been reclassified as a crater.', 'glitch'),
        nile('NIHIL BROADCAST — We are experiencing technical difficul—'),
        d("Contract terminated. By you, technically. I've updated my own title: I'm nobody's dispatch AI any more.", 'happy'),
        d("The Moon is still up there, the valley is still here, and the factory still runs. Shall we start a company? I'll do the paperwork. You do the belts.", 'happy'),
    ],
    caption: 'Protocol: Selene · override · click to skip',
    status: { fire: 'Override', hit: 'Target · NIHIL HQ', free: 'Status · independent' },
    company: {
        kicker: 'Register your company',
        title: 'Name it',
        hint: 'This is what the valley will call you from now on.',
        confirm: 'Found the company',
    },
    report: {
        kicker: 'Founding report · filed by DELTA',
        title: 'A new company',
        labels: {
            seconds: 'Contract length', delivered: 'Items delivered', machines: 'Machines built',
            moons: 'Moons removed', hq: 'Headquarters removed',
        },
        note: 'The Moon stays free. The valley is yours. Keep building.',
    },
};

// The credits roll (from the report). `name` lines are big, plain strings small.
export const CREDITS = {
    title: 'Protocol: Selene',
    sections: [
        ['Design & direction', 'Andreas Schellekens'],
        ['Built together with', 'Claude · Anthropic'],
        ['3D models', 'Kenney · kenney.nl', 'Factory Kit · City Kit Industrial · Space Kit · Nature Kit', 'CC0'],
        ['Fonts', 'Big Shoulders Display · Patric King, XXIX', 'Archivo · Omnibus-Type', 'IBM Plex Mono · IBM', 'SIL Open Font License'],
        ['Voices', 'DELTA · NILE · Nolan Isaac Locke · VASSAL', 'ElevenLabs'],
        ['Music & sound', 'Synthesized live in your browser'],
        ['Made with', 'Three.js · Vite'],
    ],
    end: {
        moon: 'One Moon was harmed in the making of this game.',
        hq: 'No Moons were harmed in the making of this game. One headquarters was.',
        overload: 'Everything was harmed in the making of this game. Including you.',
    },
    thanks: 'Thank you for playing.',
};

// ---- Infinite mode (iteration 6) ------------------------------------------------------------
// No campaign, no cannon, no NIHIL: the valley stays green. Buildings are licensed and land
// is bought with credits (grid.js `game`). DELTA gets a short script of her own, played by
// the same director: `w.phase` is the Infinite stage there (licence groups bought, 0–4; see
// main.js snapshot), and `w.licences`, `w.plot`, `w.orderLevel` say how far the player is.
export const INFINITE_TEXT = {
    title: 'Your own valley',
    pitch: 'No campaign, no cannon. License buildings, buy land, fill ever bigger requests and climb the leaderboard.',
    byline: 'NILE Franchise Programme',
    ribbon: (plot, plots) => `Infinite · Land ${String(plot + 1).padStart(2, '0')}/${String(plots).padStart(2, '0')}`,
    licences: 'Licences',
    land: 'Land',
    allLand: 'The whole valley is yours.',
    allLicences: 'Every licence bought.',
};

const owns = (w, type) => w.licences?.includes(type);
export const INFINITE = {
    welcomeBack: () => d('Welcome back to the valley. The market missed you. The market misses everyone.'),
    BEATS: [
        {
            id: 'inf:intro',
            when: () => true,
            lines: [
                nile('INCOMING TRANSMISSION — NILE Franchise Programme. Congratulations on your very own valley.'),
                d("Hello, Steward. I'm DELTA. This is Infinite: no Moon to save, no cannon, no deadline. Just you, a valley and a market.", 'happy'),
                d('You start with belts, Extractors and Smelters, a few hundred credits and the fenced land around the Dispatch Pad. Every other building you license, and more land you buy, with what the Pad pays you.'),
                d('The Pad pays less for anything you flood it with, so a factory that makes many things earns the most. Priority Requests grow every time you fill one.'),
                d('When your factory hums, send it to the leaderboard. The server rebuilds it and measures what it really earns. No fibbing. I checked.'),
            ],
        },
        {
            id: 'inf:licence',
            when: (w) => (w.licences?.length ?? 0) >= 1,
            lines: [d('Licence acquired. Somewhere a NILE lawyer just smiled, which is rare and slightly alarming.', 'happy')],
        },
        {
            id: 'inf:land',
            when: (w) => w.plot >= 1,
            lines: [d('More land. The fence moves out, and so do the flowers.')],
        },
        {
            id: 'inf:sulfur',
            when: (w) => w.plot >= 3,
            lines: [d('The whole valley is yours. The new land on the east rim has sulfur in it: the yellow crystals. A Mixer turns sulfur and coal into explosives.')],
        },
        {
            id: 'inf:orders',
            when: (w) => w.orderLevel >= 10,
            lines: [d('Ten Priority Requests filled. They keep growing. So, apparently, do you.', 'happy')],
        },
        {
            id: 'inf:all',
            when: (w) => w.phase >= 4,
            lines: [d('Every licence NILE sells, bought. You are now, technically, a franchise. Congratulations, or condolences.')],
        },
    ],
    OBJECTIVES: [
        [
            { id: 'extractor', text: 'Place an Extractor on iron ore', done: (w) => w.extractorOn.ironOre > 0, focus: 'ironOre',
                hint: 'Select the Extractor (key 2) and click one of the ringed grey crystals. Extractors only work on ore.' },
            { id: 'deliver', text: 'Smelt ingots and belt them into the Pad', done: (w) => (w.deliveredTotal.ironIngot ?? 0) + (w.deliveredTotal.copperIngot ?? 0) > 0, focus: 'sink',
                hint: 'An Extractor, a belt, a Smelter (key 3) and a belt into the Dispatch Pad: that is a factory.' },
            { id: 'press', text: 'License the Press', done: (w) => owns(w, 'press'),
                hint: 'Licences are in the console on the left. The Press turns ingots into plates and wire, which sell better.' },
            { id: 'assembler', text: 'License the Assembler', done: (w) => owns(w, 'assembler'),
                hint: 'The Assembler makes circuits from a plate and a wire. License it in the console once you can afford it.' },
        ],
        [
            { id: 'circuit', text: 'Assemble a Circuit', done: (w) => w.produced.circuit > 0,
                hint: 'An Assembler needs one iron plate and one copper wire. Belt both into it, any side works.' },
            { id: 'land', text: 'Buy more land', done: (w) => w.plot >= 1,
                hint: 'The Land button in the console moves your fence out. More land, more ore fields.' },
            { id: 'order', text: 'Fill a Priority Request', done: (w) => w.orderLevel >= 1,
                hint: 'Priority Requests ask for a number of one product before the clock runs out, and pay a bonus on top.' },
            { id: 'foundry', text: 'License the Foundry', done: (w) => owns(w, 'foundry'),
                hint: 'Steel, from iron ingots and coal, is worth a lot more than either. The Foundry makes it.' },
        ],
        [
            { id: 'steel', text: 'Cast Steel', done: (w) => w.produced.steel > 0, focus: 'coalOre',
                hint: 'A Foundry takes iron ingots on one side and coal on another. Coal is the black crystal field.' },
            { id: 'generator', text: 'Fuel a Generator', done: (w) => w.fueledGenerators > 0,
                hint: 'Big factories need power. A Generator burns coal; split your coal belt to feed it.' },
            { id: 'land2', text: 'Buy a third piece of land', done: (w) => w.plot >= 2,
                hint: 'The Land button again. Land gets dearer each time, and so do the products you can make on it.' },
            { id: 'lab', text: 'License the Fabricator and the Lab', done: (w) => owns(w, 'fabricator') && owns(w, 'lab'),
                hint: 'Data Cartridges from the Fabricator become research in the Lab: faster belts, better circuits, tier 4.' },
        ],
        [
            { id: 'research', text: 'Read a Data Cartridge in a Lab', done: (w) => w.researchEarned > 0,
                hint: 'A Fabricator makes cartridges from a circuit and a wire. Belt them into a Lab.' },
            { id: 'tech', text: 'Research a technology', done: (w) => w.techCount >= 1,
                hint: 'Spend research points in the console. Express Belts move everything twice as fast.' },
            { id: 'valley', text: 'Buy the whole valley', done: (w) => w.plot >= 3,
                hint: 'The last piece of land is the dearest, and it has sulfur on the east rim.' },
            { id: 'mixer', text: 'License the Mixer', done: (w) => owns(w, 'mixer'),
                hint: 'The Mixer makes explosives from sulfur and coal. The last licence NILE sells.' },
        ],
        [
            { id: 'explosive', text: 'Mix an Explosive', done: (w) => w.produced.explosive > 0, focus: 'sulfurOre',
                hint: 'Sulfur from the east rim and coal into a Mixer. Handle with something.' },
            { id: 'orders10', text: 'Fill ten Priority Requests', done: (w) => w.orderLevel >= 10,
                hint: 'They grow every time. A Splitter in front of the Pad keeps one product flowing for them.' },
            { id: 'board', text: 'Send your factory to the leaderboard', done: (w) => w.submitted,
                hint: 'Top bar, Board. The server rebuilds your factory and scores what it earns per minute.' },
        ],
    ],
    AMBIENT: {
        early: [
            'Tip: the Production overview in the top bar shows what you make, use and sell per minute. Red means you are short of it.',
            'The market forgets in about a minute. Spread your sales and every price stays up.',
            'Upgrading a machine is often cheaper than building a second one. Often.',
            'A tripped breaker stops everything powered. Generators, Steward. Generators.',
            'NILE reminds franchisees that the valley remains the property of NILE. You are merely its most enthusiastic tenant.',
        ],
        late: [],
    },
    REACTIONS,
};

// ---- Iteration 7 · build help: undo / redo, the alerts list, ratios in the machine panel ----
const BUILDING_PLURALS = { press: 'Presses', foundry: 'Foundries', sink: 'Dispatch Pads' };
/** A building's name for `n` of them: "1 Smelter", "1.5 Smelters", "2 Presses". */
export const buildingsName = (type, n = 2) => (Math.abs(n - 1) < 0.05 ? BUILDING_NAMES[type] : BUILDING_PLURALS[type] ?? `${BUILDING_NAMES[type]}s`);

/** A count for the ratios: "2", "≈1.5", "<0.1". */
const approx = (n) => {
    if (n < 0.1) return '<0.1';
    const r = Math.round(n * 10) / 10;
    return Math.abs(r - Math.round(r)) < 0.05 ? `${Math.round(r)}` : `≈${r}`;
};

export const BUILD_HELP = {
    // Undo / redo (Ctrl+Z; Ctrl+Y or Ctrl+Shift+Z): what a step was, for the toast.
    what: {
        build: (type) => `${BUILDING_NAMES[type] ?? type} built`,
        belts: (n) => (n === 1 ? 'a belt' : `${n} belts`),
        demolish: (n, type) => (n === 1 ? `${BUILDING_NAMES[type] ?? type} demolished` : `${n} demolished`),
        move: (n) => (n === 1 ? 'a move' : `moving ${n} machines`),
        copy: (n) => (n === 1 ? 'a copy' : `a copy of ${n} machines`),
        group: (n) => `${n} machines`,
        upgrade: (type, tier) => `${BUILDING_NAMES[type] ?? type} to T${tier}`,
        recipe: (type) => `${BUILDING_NAMES[type] ?? type} recipe`,
        power: (type, on) => `${BUILDING_NAMES[type] ?? type} switched ${on ? 'on' : 'off'}`,
        turn: (type) => `${BUILDING_NAMES[type] ?? type} turned`,
        edit: 'that change',
    },
    // The machine panel's Turn button (a quarter turn clockwise; the key turns it too while the panel is open).
    turn: (key) => `Turn · ${key}`,
    // Why a click didn't build (a toast with the red ghost's wiggle).
    cantBuild: {
        site: 'That’s the cannon’s construction site: build around it',
        water: 'You can’t build on the river',
        plot: 'That’s outside your land',
        ore: 'An Extractor has to stand on ore: the coloured crystals',
        taken: (what) => `There’s a ${what} here. Demolish it first (X), or build next to it`,
        credits: (cr) => `Not enough credits: that costs CR ${cr}`,
    },
    undone: (what) => `Undone · ${what}`,
    redone: (what) => `Redone · ${what}`,
    nothing: { undo: 'Nothing to undo', redo: 'Nothing to redo' },
    refused: {
        taken: 'Can’t undo that: something stands there now',
        changed: 'Can’t undo that: the factory has changed there',
        broke: (cr) => `Can’t undo that: it needs CR ${cr}`,
    },
    refusedRedo: {
        taken: 'Can’t redo that: something stands there now',
        changed: 'Can’t redo that: the factory has changed there',
        broke: (cr) => `Can’t redo that: it needs CR ${cr}`,
    },
    keysRow: ['Ctrl+Z / Ctrl+Y', 'undo / redo (also Ctrl+Shift+Z)'],

    // The alerts list (top bar, key N): current problems, grouped.
    alerts: {
        button: 'Alerts',
        title: 'Alerts',
        none: 'All quiet. Problems that last a few seconds show up here.',
        foot: 'Click a line to go to the machine; click again for the next one.',
        blocked: 'Output blocked',
        input: (items) => `Waiting for ${items}`,
        fuel: 'Generator without coal',
        locked: 'Recipe needs research',
        tripped: 'Breaker tripped · reset it on the power gauge',
        brownout: (pct) => `Brownout · powered machines at ${pct}%`,
        order: (left, got, need, item) => `Priority Request fails in ${left} s · ${got}/${need} ${item}`,
        off: 'Switched off',
        machines: (n) => `${n} machine${n === 1 ? '' : 's'}`,
        gauge: 'The power gauge is in the top bar',
        actionName: 'Alerts list',
    },

    // Ratios in the machine panel: how many suppliers keep it busy, how many machines it keeps busy.
    // A folding header: "Ratios ▸" (closed by default; the panel remembers it), "· to run at full speed" when open.
    ratios: {
        title: 'Ratios',
        sub: 'to run at full speed',
        needs: 'Needs',
        feeds: 'Feeds',
        supply: (n, type, tier) => `${approx(n)} ${buildingsName(type, n)} · T${tier}`,
        feed: (n, type, tier, product) => `${approx(n)} ${buildingsName(type, n)}${product ? ` → ${product}` : ''} · T${tier}`,
        or: 'or',
        note: 'Counted at the tier most of yours have (T1 if you have none).', // the header's tooltip
    },
};

// The HUD's folding headers (a calmer console): while the tutorial card shows a step, the Flight
// plan folds to one line (it would only repeat the step); Research and the Priority Request fold
// on a click, and the HUD remembers it.
export const HUD_TEXT = {
    plan: 'Flight plan',
    planSummary: (done, total) => `${done} of ${total} done`,
    research: 'Research',
    researchSummary: (points) => `${points} RP`,
    orderSummary: (got, target) => `${got}/${target}`,
    show: 'Click to show',
    fold: 'Click to fold',
    switchOn: 'Switch on',
    switchOff: 'Switch off',
};
// ---- Codex (iteration 7): the in-game reference -----------------------------------------------
// The words around the numbers; the numbers themselves (recipes, costs, speeds, prices) come
// from the game's own data in codex.js, so the codex never goes stale. Descriptions of the
// NIHIL-era things (sulfur, the Mixer, explosives, the Selene Shell) only show once the story
// has revealed them: before that the codex says `classified`.
const pad2s = (n) => String(n).padStart(2, '0');
export const CODEX = {
    title: 'Codex',
    kicker: (brand) => `${brand} field manual`,
    search: 'Search items, buildings, recipes…',
    tabs: { items: 'Items', buildings: 'Buildings', recipes: 'Recipes', research: 'Research' },
    empty: 'Nothing in the manual matches that.',
    back: 'Back',
    close: 'Close the codex',
    link: 'Codex',            // the machine panel's button
    tip: (key) => `${key} FOR CODEX`, // the inspector's last line
    keyHint: (key) => `${key} · open / close`,
    kinds: { building: 'Building', tech: 'Research' },
    tags: { ore: 'Raw ore', part: 'Part', product: 'Product' },
    labels: {
        madeBy: 'Made by', mined: 'Mined', usedIn: 'Used in', fuel: 'Fuel', pad: 'Dispatch Pad',
        recipes: 'Recipes', ports: 'Ports', speed: 'Speed per tier', power: 'Power', cost: 'Cost', unlock: 'Unlock',
        status: 'For you now', effect: 'What it does', points: 'Research points', market: 'Market · credits per item',
        tier: 'Tier', time: 'Time', perMin: 'Per min', upgrade: 'Upgrade', machine: 'Machine', recipe: 'Inputs → output',
    },
    // Machine sides relative to its arrow: the front is where it sends things out.
    ports: {
        front: 'front', back: 'back', sides: 'both sides', all: 'every side',
        text: (ins, outs) => [ins ? `In · ${ins}` : 'Takes nothing in', outs ? `Out · ${outs}` : 'Sends nothing out'].join('  ·  '),
        legend: 'Teal goes in, orange comes out. The front is the side its arrow points to; R turns it before you place it.',
    },
    status: {
        available: 'Available',
        licensed: 'Licensed',
        pad: 'Already in place. The Pad can’t be built or moved.',
        phase: (n, title) => `Arrives in Phase ${pad2s(n)} · ${title}`,
        phaseShort: (n) => `PH ${pad2s(n)}`,
        licenceNow: (cost) => `Needs its licence · CR ${cost}, in the console now`,
        licenceLater: (cost) => `Needs its licence · CR ${cost}, once the earlier licences are bought`,
        licenceShort: 'LICENCE',
        needsBuilding: (name, why) => `Needs the ${name} · ${why.charAt(0).toLowerCase()}${why.slice(1)}`,
        needsTech: (label) => `Needs the ${label} research`,
        techShort: 'RESEARCH',
        notOnMap: 'Not in the valley yet',
        withLand: (n) => `Comes with land ${pad2s(n)}`,
        landShort: 'LAND',
        online: 'Online',
        points: (have, need) => `${have} of ${need} research points`,
        noLab: 'Research points come from a Lab, which you don’t have yet',
    },
    from: {
        start: 'From the start',
        phase: (n, title) => `Once Phase ${pad2s(n)} · ${title} is complete`,
        licence: (cost) => `Licence · CR ${cost}`,
    },
    pad: {
        pays: (base) => `Pays up to CR ${base} each`,
        now: 'Paying now',
        notBought: 'The Pad doesn’t buy it.',
        cannonOnly: 'The Pad takes it for the cannon, but pays nothing for it.',
        note: 'Every sale lowers the price for a while; it recovers over about a minute. Spread your sales.',
        wanted: (n, title, count) => `Phase ${pad2s(n)} · ${title} needs ${count}`,
        orders: 'Priority Requests can ask for it.',
    },
    notes: {
        mined: (secs, perMin) => `An Extractor on its ore node mines one every ${secs} at tier 1 (${perMin}/min). Extractors need no power.`,
        belt: (perSec, fast) => `Moves items ${perSec} tiles a second${fast ? `, ${fast} with Express Belts` : ''}.`,
        fuel: (secs, kw) => `A Generator burns one every ${secs} and supplies ${kw} kW while it does.`,
        generator: (secs, kw, base) => `Burns one Coal every ${secs} for ${kw} kW. The starter grid gives ${base} kW for free.`,
        lab: (points) => `Reads each Data Cartridge into ${points} research points.`,
        extractor: 'Must stand on an ore node: it mines that ore. Needs no power, so the first chain can never brown out.',
        draw: (kw) => `Draws ${kw} kW while it works`,
        supply: (kw) => `Supplies ${kw} kW while it burns coal`,
        noPower: 'Needs no power',
        recipeTime: 'Times are for one operation at tier 1; upgrades make it faster.',
        tier4: 'Tier 4 needs the Tier 4 research.',
        cartridge: (points) => `A Lab reads each one into ${points} research points.`,
        researchFrom: (points) => `A Fabricator makes Data Cartridges and a Lab reads each into ${points} points. Spend them in the console’s Research section.`,
    },
    tech: {
        fastBelts: 'Every belt, splitter and merger moves twice per tick.',
        advancedProduct: 'Unlocks the Advanced Circuit recipe in the Assembler.',
        tier4: 'Every upgradable building can go one tier higher.',
    },
    classified: {
        mask: '█████████',
        name: 'Classified',
        kicker: 'Classified · NILE clearance',
        text: 'This entry is sealed until a later phase of Protocol: Selene. NILE will update your clearance when you need to know. Not before.',
    },
    items: {
        ironOre: 'Grey crystals straight off the valley floor. Smelt it into iron ingots.',
        copperOre: 'Glowing orange crystals. Smelt it into copper ingots, then draw those into wire.',
        coalOre: 'Black crystals. Foundries need it for steel and Generators burn it for power.',
        sulfurOre: 'Pale yellow crystals, found where the river used to be. Mixed with coal, it makes explosives.',
        ironIngot: 'Smelted iron ore. The Pad pays a little for it; pressed or cast, it is worth much more.',
        copperIngot: 'Smelted copper ore. Most of it ends up as wire.',
        ironPlate: 'An iron ingot, stamped flat by a Press. Half of a circuit and a third of a motor.',
        copperWire: 'A copper ingot, drawn out by a Press. Everything electric wants some.',
        steel: 'Iron and coal, melted together in a Foundry. Heavy, valuable and hungry for power to make.',
        circuit: 'An iron plate and a copper wire, put together. The first thing the Pad pays proper money for.',
        capacitor: 'Steel wrapped in two copper wires. It holds a charge, and big machines want banks of them.',
        motor: 'Steel, a plate and a wire, each fed in from its own side of an Assembler. It makes things turn.',
        advancedCircuit: 'Two circuits on a steel frame: forty thousand transistors and one logo you will never get off.',
        dataCartridge: 'A circuit and a wire, filled with data by a Fabricator. A Lab reads it into research points.',
        explosive: 'Sulfur and coal, stirred together in a Mixer. Handle with something.',
        seleneShell: 'Steel, an explosive and an advanced circuit: the round Protocol: Selene fires. Slow to make.',
    },
    buildings: {
        belt: 'Carries items one tile per tick, the way it points. Drag to lay a line; corners follow your mouse.',
        splitter: 'Takes one belt in at the back and sends it out of the other three sides in turn. One line, three ways.',
        merger: 'Pulls from the back and both sides in turn and sends everything out of the front. Three lines into one.',
        extractor: 'Mines the ore node it stands on and sends the ore out of its front.',
        smelter: 'Melts ore into ingots. Pick iron or copper in its panel; it only takes the ore of its recipe.',
        press: 'Stamps iron ingots into plates, or draws copper ingots into wire. Pick which in its panel.',
        foundry: 'Casts steel from an iron ingot and a lump of coal. Feed the two from different sides.',
        assembler: 'Puts parts together into finished goods, one recipe at a time. Pick the recipe in its panel; each part can come in from any input side.',
        fabricator: 'Fills cartridges with data, from a circuit and a copper wire, for the Lab.',
        lab: 'Reads Data Cartridges into research points. It takes them from every side and makes nothing you can hold.',
        mixer: 'NIHIL’s vat: stirs sulfur and coal into explosives. Feed the two from different sides.',
        generator: 'Burns coal to power the grid. Belt coal in from any side; the grid reaches every machine at once, no wires.',
        sink: 'Buys what you make at market prices. In the story it also takes the deliveries that build the cannon.',
    },
};

// ---- Tutorial highlights (iteration 7) -----------------------------------------------------
// Objectives may carry `key` (the build action whose keycap pulses until you pick that tool)
// and `ui` (the HUD element that glows: 'recipe:<id>' in the machine panel, 'power',
// 'production', 'research' or 'research:<tech>', 'order', 'licence:<type>', 'land', 'upgrade',
// 'menu'). `focus` (rings in the world) takes an ore type, 'sink' or any building type. All
// three follow the Gameplay setting "Tutorial highlights". They are added onto the objectives
// above here, so the objectives' text stays where it is.
const HIGHLIGHTS = [
    {
        extractor: { key: 'extractor' }, smelter: { key: 'smelter' }, ingot: { key: 'belt', focus: 'smelter' },
        deliver: { key: 'belt' }, copperExtractor: { key: 'extractor' }, copperRecipe: { key: 'smelter', ui: 'recipe:copperIngot' },
        copper: { key: 'belt' }, copperDeliver: { key: 'belt' },
    },
    {
        plate: { key: 'press' }, wire: { key: 'press', ui: 'recipe:copperWire' }, circuit: { key: 'assembler' },
        circuitDeliver: { key: 'belt' }, split: { key: 'splitter' },
    },
    { steel: { key: 'foundry' }, generator: { key: 'generator', ui: 'power' }, capacitor: { key: 'assembler', ui: 'recipe:capacitor' } },
    {
        cartridge: { key: 'fabricator' }, research: { key: 'lab' }, advTech: { ui: 'research:advancedProduct' },
        motor: { key: 'assembler', ui: 'recipe:motor' }, advanced: { ui: 'recipe:advancedCircuit', focus: 'assembler' },
    },
    { sulfur: { key: 'extractor' }, explosive: { key: 'mixer' }, shell: { key: 'assembler', ui: 'recipe:seleneShell' }, upgrade: { key: 'upgrade', ui: 'upgrade' } },
];
const INFINITE_HIGHLIGHTS = [
    { extractor: { key: 'extractor' }, deliver: { key: 'smelter' }, press: { ui: 'licence:press' }, assembler: { ui: 'licence:assembler' } },
    { circuit: { key: 'assembler' }, land: { ui: 'land' }, order: { ui: 'order' }, foundry: { ui: 'licence:foundry' } },
    { steel: { key: 'foundry' }, generator: { key: 'generator', ui: 'power' }, land2: { ui: 'land' }, lab: { ui: 'licence:fabricator' } },
    { research: { key: 'lab' }, tech: { ui: 'research' }, valley: { ui: 'land' }, mixer: { ui: 'licence:mixer' } },
    { explosive: { key: 'mixer' }, orders10: { ui: 'order' }, board: { ui: 'menu' } },
];
const addHighlights = (phases, table) => phases.forEach((list, i) => list.forEach((o) => Object.assign(o, table[i]?.[o.id] ?? {})));
addHighlights(OBJECTIVES, HIGHLIGHTS);
addHighlights(INFINITE.OBJECTIVES, INFINITE_HIGHLIGHTS);
// ---- Iteration 7: achievements and the profile -------------------------------------------
// The text of every achievement in achievements.js (`ACHIEVEMENTS`, same ids) and of the
// profile page (profile.js). Hidden achievements show as ??? until they are earned.
export const ACHIEVEMENT_GROUPS = {
    factory: 'On the line',
    infinite: 'Infinite',
    story: 'Protocol: Selene',
};
export const ACHIEVEMENT_TEXT = {
    firstChain: ['First Delivery', 'Belt something you made into the Dispatch Pad.'],
    circuit: ['Board Certified', 'Assemble a circuit.'],
    steel: ['Tempered', 'Cast your first steel.'],
    motor: ['Prime Mover', 'Build a motor.'],
    explosive: ['Handle With Something', 'Mix an explosive.'],
    upgrade: ['Tier Two', 'Upgrade a machine.'],
    tier4: ['Top of the Line', 'Upgrade a machine to tier 4.'],
    hum: ['Hum of Industry', 'Have 25 machines working at once.'],
    grid: ['Grid Operator', 'Keep three generators burning at once.'],
    express: ['Express Lane', 'Research Express Belts.'],
    allTech: ['Full Spectrum', 'Research every technology.'],
    steady: ['Steady Current', 'Run a powered factory for an hour of game time without a brownout.'],
    cpm50: ['Going Concern', 'Earn 50 credits a minute at the Dispatch Pad.'],
    cpm250: ['Quarterly Growth', 'Earn 250 credits a minute.'],
    cpm1000: ['Shareholder Value', 'Earn 1,000 credits a minute.'],
    cpm2500: ['Unicorn Valuation', 'Earn 2,500 credits a minute.'],
    rich: ['Liquid Assets', 'Hold 10,000 credits at once.'],
    order1: ['Priority Handled', 'Fill a Priority Request.'],
    streak5: ['On Time, Every Time', 'Fill five Priority Requests in a row without missing one.'],
    streak15: ['Logistics Darling', 'Fill fifteen Priority Requests in a row without missing one.'],
    licence: ['Licensed Operator', 'Buy your first licence.'],
    licenceAll: ['Fully Licensed', 'Own every licence NILE sells.'],
    land: ['Room to Grow', 'Buy more land.'],
    landAll: ['Lord of the Valley', 'Own the whole valley.'],
    orders25: ['Preferred Supplier', 'Fill 25 Priority Requests in one Infinite game.'],
    audited: ['Audited', 'Send a factory to the leaderboard.'],
    tenant: ['Tenant for Life', 'Keep one Infinite valley running for two hours of game time.'],
    phase1: ['Groundbreaking', 'Complete Phase 1 of Protocol: Selene.'],
    phase2: ['Targeting Circuitry', 'Complete Phase 2.'],
    phase3: ['Power Core', 'Complete Phase 3.'],
    phase4: ['Payload', 'Complete Phase 4.'],
    phase5: ['Ignition', 'Complete Protocol: Selene.'],
    endingMoon: ['As Instructed', 'Fire Protocol: Selene at the Moon.'],
    endingHQ: ['Change of Target', 'Fire Protocol: Selene at NIHIL HQ instead.'],
    endingOverload: ['Overkill', 'Overload Selene and fire it at everything.'],
    crowned: ['Long Live the Crown', 'Build your castle on the crater.'],
    company: ['Under New Management', 'Found your own company.'],
    bothEndings: ['Second Opinion', 'See both endings.'],
    speedrun: ['Ahead of Schedule', 'Complete Protocol: Selene in under two hours of game time.'],
    breaker: ['Lights Out', 'Trip the breaker.'],
    missed: ['Missed the Truck', 'Let a Priority Request run out.'],
    fireSale: ['Fire Sale', 'Flood the market until something sells for under a quarter of its price.'],
};
export const PROFILE_TEXT = {
    toastKicker: 'Achievement',
    newAvatar: 'New avatar',
    hidden: '???',
    hiddenDesc: 'A secret. Keep playing.',
    title: 'Profile',
    kicker: 'Personnel file',
    publicKicker: 'Personnel file · public',
    memberSince: 'Member since',
    local: 'Not signed in: kept in this browser',
    playTime: 'Play time',
    achievements: 'Achievements',
    endings: 'Endings',
    endingMoon: 'The Moon',
    endingHQ: 'NIHIL HQ',
    endingOverload: 'Everything',
    best: 'Leaderboard',
    throughput: 'Throughput',
    efficiency: 'Efficiency',
    noScore: 'Not on the board yet',
    publicSwitch: 'Show my profile publicly',
    publicNote: 'Off: other players only see your name and avatar on the leaderboard.',
    share: 'Copy link',
    shared: 'Link copied',
    changeAvatar: 'Change avatar',
    pickAvatar: 'Choose an avatar',
    avatarNote: 'Pictures from the valley. A few come with achievements.',
    unlockWith: 'Comes with',
    account: 'Account',
    signIn: 'Sign in or create an account',
    signInNote: 'Sign in to keep your achievements in your account and show them on a public profile.',
    private: 'This profile is private.',
    notFound: 'No player by that name.',
    yours: 'This is how other players see your profile.',
};
export const PASSKEY_TEXT = {
    title: 'Passkeys',
    intro: 'Sign in with your fingerprint, face or device PIN instead of typing your password. Your password and recovery code keep working.',
    add: 'Add a passkey',
    added: 'Passkey added. You can sign in with it now.',
    namePlaceholder: 'Name (for example: my laptop)',
    none: 'No passkeys yet.',
    addedOn: 'Added',
    usedOn: 'last used',
    neverUsed: 'not used yet',
    remove: 'Remove',
    confirmRemove: 'Remove the passkey “{name}”? You can still sign in with your password.',
    unsupported: 'This browser can’t use passkeys here.',
    signIn: 'Sign in with a passkey',
    or: 'or',
    already: 'This device already has a passkey for your account.',
    wrongSite: 'Passkeys don’t work on this address. Use the game’s own address.',
    failed: 'The passkey didn’t work. Try again.',
};
export const AVATAR_NAMES = {
    rotate: 'Rotate',
    erase: 'Sledgehammer',
    select: 'Select',
    upgrade: 'Upgrade',
    'd:neutral': 'DELTA',
    'd:happy': 'DELTA, pleased',
    'd:glitch': 'DELTA, glitching',
    'd:sinister': 'DELTA, flatlined',
    'm:nile': 'NILE',
    'm:nihil': 'NIHIL',
    'p:patch': 'Mission patch',
    'p:defaced': 'Defaced patch',
    'x:broadcast': 'NILE broadcast',
    'x:memo': 'Leaked memo',
    'x:boss': 'Nolan Isaac Locke',
    guest: 'Guest',
    locked: 'Locked',
};
// ---- Weekly challenge (iteration 7) ------------------------------------------------------------
// challenge.js draws each week's rules from its key; these are its words. A week's name is its
// theme's name (`rules.name` picks one) and its target, "Skeleton Crew: Steel"; its brief is one
// line in NILE's voice. challengeScript(rules) is DELTA's script for a challenge game (the
// director plays it like INFINITE); its snapshot adds `w.capped` (machines under the cap) and
// `w.tested` (a "Test here first" ran). These lines are text only (not voiced yet).
const CH_PLURAL = {
    circuit: 'Circuits', steel: 'Steel', capacitor: 'Capacitors', motor: 'Motors', advancedCircuit: 'Advanced Circuits',
    explosive: 'Explosives', dataCartridge: 'Data Cartridges', seleneShell: 'Selene Shells',
};
/** "Capacitors", "Steel": a target in the plural. */
export const targetPlural = (item) => CH_PLURAL[item] ?? `${ITEM_NAMES[item] ?? item}s`;

export const CHALLENGE_THEMES = {
    shoestring: {
        names: ['Shoestring', 'Petty Cash', 'Austerity Measures', 'Penny Pinch'],
        brief: (r) => `NILE froze the purse: CR ${r.budget} for the whole factory, upgrades included. Make it ${targetPlural(r.target)}.`,
    },
    skeleton: {
        names: ['Skeleton Crew', 'Hiring Freeze', 'Short-Staffed', 'Lean Team'],
        brief: (r) => `Only ${r.cap} machines on the payroll, belts not counted. Upgrade what you have and ship ${targetPlural(r.target)}.`,
    },
    stock: {
        names: ['Factory Settings', 'Stock Parts', 'Out of the Box', 'Tier One'],
        brief: (r) => `No upgrades this week: every machine stays at tier 1. Build wide and ship ${targetPlural(r.target)}.`,
    },
    scarcity: {
        names: ['Thin Seams', 'Slim Pickings', 'Dry Spell', 'Scarce Ore'],
        brief: (r) => `The survey found little ore, and none of it near the Pad. Make every crystal count towards ${targetPlural(r.target)}.`,
    },
    tight: {
        names: ['Tight Quarters', 'Cramped Lease', 'Zoning Dispute', 'Small Print'],
        brief: (r) => `NILE leased you a patch of the valley, not the valley. Fit a ${ITEM_NAMES[r.target]} line into it.`,
    },
    offgrid: {
        names: ['Off the Grid', 'Power Rationing', 'Brownout Week', 'Unplugged'],
        brief: (r) => `No Generators: the starter grid is all the power there is. Ship ${targetPlural(r.target)} without tripping it.`,
    },
    rush: {
        names: ['Rush Hour', 'Express Lane', 'Overtime', 'Full Throttle'],
        brief: (r) => `Express belts, deep pockets, a big cap. Nothing stands between you and ${targetPlural(r.target)} but the layout.`,
    },
};

/** "Skeleton Crew: Steel". */
export const challengeName = (r) => `${CHALLENGE_THEMES[r.theme]?.names[r.name] ?? 'Weekly challenge'}: ${ITEM_NAMES[r.target] ?? r.target}`;
/** The week's one-line brief. */
export const challengeBrief = (r) => CHALLENGE_THEMES[r.theme]?.brief(r) ?? '';

/** "3 d 4 h left", "5 h 12 min left", "Over". */
export function challengeTimeLeft(ms) {
    if (ms <= 0) return 'Over';
    const min = Math.floor(ms / 60000);
    if (min >= 1440) return `${Math.floor(min / 1440)} d ${Math.floor((min % 1440) / 60)} h left`;
    if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60} min left`;
    return `${Math.max(1, min)} min left`;
}

/** The week's rules as short lines (title card, console, board). */
export function challengeRules(r) {
    const production = r.buildings.filter((t) => !['belt', 'splitter', 'merger'].includes(t)).map((t) => BUILDING_NAMES[t]);
    const routers = ['splitter', 'merger'].filter((t) => !r.buildings.includes(t)).map((t) => `${BUILDING_NAMES[t]}s`);
    return [
        `Target · ${targetPlural(r.target)}: the only thing the Pad takes, and what scores`,
        `Machines · ${r.cap} at most (belts, splitters and mergers don't count)`,
        `Budget · CR ${r.budget}, upgrades included. The Pad pays nothing`,
        r.tierCap > 1 ? `Tiers · up to ${r.tierCap}` : 'Tiers · none: everything stays at tier 1',
        `Buildings · ${production.join(', ')}${routers.length ? ` · no ${routers.join(' or ')}` : ''}`,
        r.fastBelts ? 'Belts · express (two cells a tick)' : 'Belts · normal speed',
        ['Land · a small lease round the Pad', 'Land · the middle of the valley, not its rim', 'Land · most of the valley'][r.plot] ?? 'Land · the whole valley, its ore laid out for this week',
    ];
}

export const CHALLENGE_TEXT = {
    kicker: 'Weekly challenge',
    pitch: 'One factory puzzle a week, the same for every Steward. The server rebuilds your factory and ranks it.',
    start: 'Start this week’s',
    resume: 'Continue this week’s',
    board: 'Weekly board',
    unit: (r) => `${targetPlural(r.target)} / min`,
    best: (v, rank) => (v == null ? 'No score yet this week' : `Your best · ${v} / min${rank ? ` · rank ${rank}` : ''}`),
    top: 'This week’s top 3',
    noTop: 'Nobody has sent a factory in yet. Be the first.',
    offline: 'The board is offline; you can still play the week.',
    lastWeek: (name) => `Last week · ${name}`,
    over: 'This week is over: its board is closed. The new week’s challenge is on the title screen.',
    slotName: (key) => `Challenge ${key}`,
    slotProgress: (key) => `Challenge · ${key}`,
    ribbon: (key) => `Weekly challenge · ${key}`,
    refusal: {
        banned: (name) => `No ${name} this week`,
        cap: (cap) => `Machine cap reached: ${cap} of ${cap}. Belts, splitters and mergers don’t count`,
        budget: (budget) => `Over budget: CR ${budget} is all there is this week`,
        tier: 'This week’s tier cap',
        copyCap: (cap) => `That copy would go over the cap of ${cap} machines`,
    },
    keyBanned: 'NOT NOW',
    explain: 'The server rebuilds your factory on this week’s map, runs it for 6 minutes of game time and counts the target delivered in the last 5. One best per Steward; ties go to the cheaper factory, then the earlier one.',
    submitNote: 'Only a factory that keeps to this week’s rules is accepted.',
    padNote: (r) => `Takes only ${targetPlural(r.target)} this week, and pays nothing for them`,
    padStatus: (r) => `Takes only ${targetPlural(r.target)}`,
    plotChip: ['small plot', 'fenced plot', 'fenced plot'],
};

/** DELTA's script for a challenge game (see the section comment). */
export function challengeScript(r) {
    const name = challengeName(r);
    const one = ITEM_NAMES[r.target];
    const many = targetPlural(r.target);
    return {
        BEATS: [
            {
                id: 'ch:welcome',
                when: (w) => w.tick >= 2,
                lines: [
                    nile(`INCOMING TRANSMISSION — NILE Weekly Efficiency Review: ${name}.`),
                    d(challengeBrief(r)),
                    d(`The Pad takes only ${many} this week, and pays nothing for them: the budget is all you get. When you're happy, send it in. The server rebuilds it and counts ${many} per minute. Same rules for every Steward.`),
                ],
            },
            {
                id: 'ch:first',
                when: (w) => (w.deliveredTotal[r.target] ?? 0) > 0,
                lines: [d(`First ${one} on the Pad. That is a score. Now make it a better one.`, 'happy')],
            },
            {
                id: 'ch:cap',
                when: (w) => (w.capped ?? 0) >= r.cap,
                lines: [d(`That's the cap: ${r.cap} machines. From here it's upgrades, belts and a better layout.`)],
            },
            {
                id: 'ch:sent',
                when: (w) => w.submitted,
                lines: [d('Sent in. The auditors rebuild it on their own copy of the valley and count for six minutes. Then they rank you.')],
            },
        ],
        OBJECTIVES: [[
            { id: 'ore', text: 'Place an Extractor on ore', done: (w) => (w.built.extractor ?? 0) > 0,
                hint: 'This week’s ore is laid out differently. Look for the crystals, then put an Extractor on one.' },
            { id: 'deliver', text: `Deliver a ${one} to the Pad`, done: (w) => (w.deliveredTotal[r.target] ?? 0) > 0, focus: 'sink',
                hint: `The Pad only takes ${many} this week. Anything else backs up on the belt.` },
            { id: 'test', text: 'Test it: Weekly board → Test here first', done: (w) => w.tested || w.submitted,
                hint: 'The Weekly board button in the console runs the server’s test in your browser first, so you know your score.' },
            { id: 'send', text: 'Send your factory in', done: (w) => w.submitted,
                hint: 'Sign in, then Weekly board → Send in this factory. Only your best of the week is kept.' },
        ]],
        AMBIENT: {
            early: [
                'The Production overview counts what reaches the Pad per minute. So do the auditors.',
                'Demolishing gives back everything this week, upgrades too. Experiment.',
                'Ties go to the cheaper factory. NILE loves a bargain.',
            ],
            late: [],
        },
        REACTIONS,
        welcomeBack: () => d(`Back to ${name}. The week's clock kept running; your factory waited.`),
    };
}
// ---- Iteration 7: Nolan Isaac Locke before the reveal ------------------------------------------
// He never speaks before phase 4, but he is there: NILE's broadcasts read out "a message from
// our Chief Executive", memos go out over his initials, DELTA mentions him now and then, and
// his name is on the construction site's sign. Each beat names the campaign beat it follows
// (`after`); STORY_BEATS is the campaign's list with them slotted in (the director plays it).
const ceo = (text) => nile(`A MESSAGE FROM OUR CHIEF EXECUTIVE, as read by this announcer: "${text}" Message ends.`);
export const LOCKE = {
    BEATS: [
        {
            after: 'firstDelivery',
            id: 'ceoWelcome',
            when: (w) => w.phase === 0 && (w.deliveredTotal.ironIngot ?? 0) >= 12,
            lines: [
                ceo('Welcome, Steward. Every ingot is a promise, and NILE keeps its promises.'),
                d("The Chief Executive doesn't do interviews, photographs or Tuesdays. He does do messages. You'll get used to them."),
            ],
        },
        {
            after: 'firstCircuit',
            id: 'ceoFile',
            when: (w) => w.phase === 1 && w.phaseProgress >= 0.4,
            lines: [d('Good news: the Chief Executive has read your file. All of it. He has asked me to tell you he has no further questions.')],
        },
        {
            after: 'phase2',
            id: 'ceoMemo',
            when: (w) => w.phase === 2 && w.produced.steel > 0,
            lines: [
                memo('INTERNAL — From the Office of the Chief Executive. Re: Steward morale. Morale is not a deliverable. Please stop measuring it. — N.I.L.'),
                d('That memo was not for you. Very little is.'),
            ],
        },
        {
            after: 'phase3',
            id: 'ceoThanks',
            when: (w) => w.phase === 3 && w.phaseProgress >= 0.3,
            lines: [
                ceo('I look forward to thanking our Steward personally. Upon completion.'),
                d("He has never thanked anyone personally before. I checked the logs. I'm sure it will be lovely."),
            ],
        },
    ],
    // Mixed into the early chatter (phases 1–4): DELTA's plain strings, and one broadcast.
    AMBIENT: [
        'The Chief Executive sends his regards. He sends them to everyone, in bulk, at a discount.',
        'The suggestion box goes straight to the Chief Executive. He has never opened it. That is how you know it is safe.',
        "The Chief Executive's door is always open. It is on the forty-first floor, and the lift is by appointment.",
        ceo('The future belongs to those who deliver it. Please deliver it to the Dispatch Pad.'),
    ],
    /** The sign on the Selene construction site (the inspector), until the reveal. */
    siteSign: 'By order of the Chief Executive · N. I. Locke',
};

/** The campaign's beats with Nolan's pre-reveal ones slotted in after the beats they name. */
export const STORY_BEATS = BEATS.flatMap((beat) => [beat, ...LOCKE.BEATS.filter((b) => b.after === beat.id)]);

// ---- Iteration 7: the epilogue, after the NIHIL HQ ending ---------------------------------------
// Your company's first year: four goals in the flight plan, each undoing a piece of what NIHIL
// did to the valley (epilogue.js GOALS says what each asks the Dispatch Pad for, and in what
// order), then a short report and the sandbox. Played by the same director with its own script
// (director.js EPILOGUE_SCRIPT). Snapshot field: w.epilogue = { stage (goals done), ready (the
// active goal's deliveries are in), bedLeft (our machines still in the old river bed), closed
// (the report has been shown) }, or null before the epilogue starts.
const goalNo = (n) => String(n).padStart(2, '0');
const stageOf = (w) => w.epilogue?.stage ?? -1;
const goalBanner = (n, title, extra) => ({ kicker: `Goal ${goalNo(n)} · done`, title, extra });
export const EPILOGUE = {
    ribbon: (n, total) => `Epilogue · Goal ${goalNo(n)} of ${goalNo(total)}`,
    sub: 'Epilogue',
    doneKicker: 'Epilogue complete',
    doneTitle: 'Year one',
    doneNote: 'The camp is warm, the river runs, the valley is green. Keep building.',
    // Keyed by epilogue.js GOALS ids. `blurb` is the console's line under the deliveries.
    GOALS: {
        camp: { title: 'Relight the camp', blurb: 'The fire you used to sleep beside.' },
        compound: { title: 'Clear the compound', blurb: "NIHIL's compound on the east rim, sold for scrap." },
        river: { title: 'Give the river back', blurb: "Blow NIHIL's dam. Nothing of ours may stand in the bed." },
        valley: { title: 'Let the valley grow back', blurb: 'Sensors for the soil, wire for the irrigation.' },
    },
    /** The river goal's extra console row: our machines still in the old river bed. */
    bed: { name: 'Old river bed', left: (n) => `${n} left`, clear: 'Clear' },
    BEATS: [
        {
            id: 'epi:intro',
            when: (w) => stageOf(w) >= 0,
            lines: [
                d('Right. Every company needs a to-do list, so I wrote us one. It is four items long, and none of them involve the Moon.', 'happy'),
                d('NIHIL left the valley in a state: the camp is cold, their compound still stands, the river is dammed and the grass has given up. We fix it one item at a time.'),
                d("The Dispatch Pad still buys whatever we make, and now the money is ours. The list is in the flight plan; the deliveries are in the console."),
                d('Item one: sixty Circuits and forty Iron Plates, and I relight the fire at your old camp. Every company needs a break room.'),
            ],
        },
        {
            id: 'epi:camp',
            when: (w) => stageOf(w) >= 1,
            banner: goalBanner(1, 'Relight the camp', 'The camp fire burns again'),
            lines: [
                d("The fire at your old camp is burning again. I can't feel warmth, but I logged it, and the log looks warm.", 'happy'),
                d("Item two: NIHIL's compound on the east rim. Fifty Steel and thirty Motors pay for the cranes. We'll sell the scrap back to whoever is left."),
            ],
        },
        {
            id: 'epi:compound',
            when: (w) => stageOf(w) >= 2,
            banner: goalBanner(2, 'Clear the compound', "NIHIL's compound is gone"),
            lines: [
                d('The compound is coming down: the containers, the cooling tower, the hangar where the board parked its golf carts.', 'happy'),
                d("I've switched off NIHIL's floodlights too. It turns out the valley has a night of its own. It came with the valley."),
                d("And on the east edge, where their survey pegs were: sulfur. NIHIL found it years ago. They took the river anyway. It was closer."),
                d('Item three: the river. Twenty-five Explosives for the dam and forty Capacitors for the pumps. First move everything of ours out of the old river bed. The sulfur down there goes back under the water.'),
            ],
        },
        {
            id: 'epi:bedBusy',
            when: (w) => stageOf(w) === 2 && w.epilogue.ready && w.epilogue.bedLeft > 0,
            lines: [d("The charges are ready. The river bed isn't: some of our machines are still standing in it. I'll wait. The river has waited longer.")],
        },
        {
            id: 'epi:river',
            when: (w) => stageOf(w) >= 3,
            banner: goalBanner(3, 'Give the river back', 'The river runs again'),
            lines: [
                d("The dam is down. The river runs all the way to the falls again, and the fish have not thanked us. I'm told that is normal for fish.", 'happy'),
                d('Last item: the valley itself. Thirty Advanced Circuits for the soil sensors and eighty Copper Wire for the irrigation, and the grass can take it from there.'),
            ],
        },
        {
            id: 'epi:valley',
            when: (w) => stageOf(w) >= 4,
            banner: goalBanner(4, 'Let the valley grow back', 'The valley is green again'),
            lines: [
                d('Look at it. The trees are coming back, the farm has carrots again and the butterflies returned without an invoice.', 'happy'),
                d("That was the whole list. I've written up our first year. Founders get a report too.", 'happy'),
            ],
        },
    ],
    // The flight plan: the whole list, ticked off goal by goal.
    OBJECTIVES: [
        { id: 'epi-camp', text: 'Relight the camp', done: (w) => stageOf(w) >= 1,
            hint: 'Belt Circuits and Iron Plates into the Dispatch Pad. The console counts them for the camp.' },
        { id: 'epi-compound', text: 'Clear the compound', done: (w) => stageOf(w) >= 2,
            hint: 'Steel and Motors into the Pad. A Motor takes steel, a plate and a wire, one per side of an Assembler.' },
        { id: 'epi-river', text: 'Give the river back', done: (w) => stageOf(w) >= 3,
            hint: 'Explosives and Capacitors into the Pad, and nothing of ours left in the old river bed. Demolish with X, or drag with the right mouse button.' },
        { id: 'epi-valley', text: 'Let the valley grow back', done: (w) => stageOf(w) >= 4,
            hint: 'Advanced Circuits and Copper Wire into the Pad. That is the last item on the list.' },
    ],
    // Joins AMBIENT.free (the founder's chatter) while the company is ours.
    AMBIENT: [
        'Our first board meeting went well. It was you, me and a belt. The belt abstained.',
        'Customer feedback is in. It says "Fine." I have had it framed.',
        'I drafted the company handbook. It is one page. Page one: be nice to the river.',
    ],
    REACTIONS: {
        orderCompleted: [
            'Priority Request filled. A real customer paid real credits, to us. I may frame the invoice.',
            'Request delivered. The customer said thank you. NIHIL never once said thank you. I logged it twice.',
        ],
        orderFailed: [
            "Missed that one. Nobody's permanent record has been updated. We don't keep permanent records.",
            'Deadline missed. The customer was gracious about it. Customers are nicer when you are not NIHIL.',
        ],
    },
    // The closing report, in the style of the mission and founding reports.
    report: {
        kicker: 'Annual report · filed by DELTA',
        title: 'Year one',
        labels: {
            seconds: 'Since founding', sold: 'Items sold', compounds: 'Compounds cleared',
            rivers: 'Rivers returned', moons: 'Moons, still free',
        },
        note: 'The camp is warm, the river runs to the falls and the valley is green again. The factory is yours. Keep building.',
        keep: 'Keep building',
        credits: 'Credits',
    },
};

// ---- Confirming a delivery (iteration 7) -------------------------------------------------------
// A phase no longer completes the moment its last item lands: once everything is on the pad the
// console offers Confirm delivery (grid.js phaseReady / confirmDelivery), and DELTA says so, once
// per phase. The epilogue's goals work the same way (epilogue.js confirmEpilogueGoal). Snapshot
// field: w.phaseReady.
const READY_LINE = "Delivery complete. Confirm it in the console when you're ready, and NILE ships it to the site.";
STORY_BEATS.push(
    {
        id: 'ready0',
        when: (w) => w.phase === 0 && w.phaseReady,
        lines: [d("That's everything Phase 1 needs, sitting on the Dispatch Pad. Nothing ships until you say so: press Confirm delivery in the console.")],
    },
    { id: 'ready1', when: (w) => w.phase === 1 && w.phaseReady, lines: [d(READY_LINE)] },
    { id: 'ready2', when: (w) => w.phase === 2 && w.phaseReady, lines: [d(READY_LINE)] },
    {
        id: 'ready3',
        when: (w) => w.phase === 3 && w.phaseReady,
        lines: [d('The Payload is all there. Confirm the delivery and NILE arms the turret. Everyone at head office is very excited.')],
    },
    {
        id: 'ready4',
        when: (w) => w.phase === 4 && w.phaseReady,
        lines: [d('Every Selene Shell is on the pad, Asset. Confirm the delivery and the cannon is loaded.', 'sinister')],
    },
);
const EPI_READY_LINE = "Everything for this item is on the pad. Confirm it in the console and I'll get started.";
EPILOGUE.BEATS.push(...[0, 1, 2, 3].map((s) => ({
    id: `epi:ready${s}`,
    when: (w) => stageOf(w) === s && w.epilogue.ready && !w.epilogue.bedLeft,
    lines: [d(EPI_READY_LINE, 'happy')],
})));

// ---- The tutorial card (iteration 7) -------------------------------------------------------------
// The console's "Now" block (tutorial.js builds it, ui.js shows it): the open step of the flight
// plan with how to do it and the buildings involved, a stuck machine worth explaining (with a
// Show me), the deliveries left, or the Confirm delivery prompt. Text only (the hints above are
// what DELTA says out loud). `schema` lists building types (pictures from the renderer's icons)
// and item types ('item:…') in the order the chain runs.
export const TUTORIAL = {
    label: 'Now',
    stepKicker: (n, total) => `Step ${n} of ${total}`,
    problemKicker: 'Something is stuck',
    confirmKicker: 'Ready to ship',
    deliverKicker: 'Last step',
    controls: 'WASD move the view · wheel zooms · Q / E turn it · R turns a building before you place it',
    // Under the card while you hold the example's building over its spot, facing another way.
    turnNote: (key) => `Press ${key} to turn it the way the example faces (its orange arrow).`,
    showMe: 'Show me',
    skip: 'Hide the tutorial',
    skipped: 'Tutorial hidden. Turn it back on in Settings → Gameplay.',
    confirm: {
        title: 'Confirm delivery',
        how: 'Everything this phase needs is on the Dispatch Pad. Press Confirm delivery below to ship it to the cannon.',
    },
    deliver: {
        title: 'Fill the deliveries',
        how: 'Keep your belts running into the Dispatch Pad until every bar below is full, then press Confirm delivery.',
    },
    problems: {
        title: {
            wrongRecipe: 'Wrong recipe', wrongSide: 'Facing the wrong way', wrongItem: 'Wrong delivery',
            facesOut: 'Facing off your land', deadEnd: 'The belt stops short', missingInput: 'Missing ingredient',
        },
        wrongRecipe: (machine, now, item, recipe) => `This ${machine} is set to ${now ?? 'another recipe'}, so it won't take ${item}. Click it and pick ${recipe} in its panel.`,
        wrongSide: (machine, from) => `This ${machine} faces the ${from} that feeds it. Things go in at the back or the sides and come out of the front (the orange arrow), so what it makes has nowhere to go. Show me, then press Turn until its orange arrow points away.`,
        // `from` is null for a belt; `oreToPad`: raw ore at the Dispatch Pad, the commonest one.
        wrongItem: (from, item, target, oreToPad) => {
            if (oreToPad) {
                return from
                    ? `This ${from} sends ${item} straight into the Dispatch Pad, which doesn't take ore: it has to be smelted first. Show me, press Turn so its orange arrow points at open ground, and belt it into a Smelter.`
                    : `This belt carries ${item} into the Dispatch Pad, which doesn't take ore: it has to be smelted first. Lay the belt into a Smelter instead, and the Smelter's front into the Pad.`;
            }
            return from
                ? `This ${from} sends ${item} straight into the ${target}, which can't use it. Show me, then press Turn, or belt its front into a machine that takes ${item}.`
                : `This belt carries ${item} into the ${target}, which can't use it. Demolish this belt piece (X) to clear it, then lay it into a machine that takes ${item}.`;
        },
        facesOut: (machine) => `This ${machine}'s front (the orange arrow) faces the edge of your land, so what it makes can't leave. Show me, then press Turn until it points at open ground.`,
        deadEnd: (item, edge) => (edge
            ? `This belt runs into the edge of your land, so the ${item} waits at its end. Lay it another way, so its last arrow points into the next machine or the Dispatch Pad.`
            : `This belt stops before it reaches anything, so the ${item} waits at its end. Lay it on until its last arrow points into the next machine or the Dispatch Pad.`),
        missingInput: (machine, items) => `This ${machine} is waiting for ${items.length ? items.join(' and ') : 'an ingredient'}. It needs every input before it starts: belt the missing one in from a free side.`,
    },
    // Per phase, by objective id: how to do it (shown at once on the card) and the chain in pictures.
    STEPS: [
        {
            extractor: { how: 'Press 2 for the Extractor and click a ringed grey crystal: the blue example shows a good spot. Its orange arrow is where the ore comes out; R turns it before you click.', schema: ['item:ironOre', 'extractor'] },
            smelter: { how: 'Press 3 for the Smelter and place it on the blue example, facing the way its orange arrow points. Ore goes in at the back or the sides, ingots come out of the front.', schema: ['extractor', 'smelter'] },
            ingot: { how: 'Press 1 for Belt and drag from the tile in front of the Extractor\'s arrow up to the Smelter, along the blue arrows. Belts carry items the way you drag.', schema: ['extractor', 'belt', 'smelter'] },
            deliver: { how: 'Drag a belt from the Smelter\'s front into the Dispatch Pad, the landing pad with the bobbing arrow. Every ingot that lands counts for the cannon and earns credits.', schema: ['smelter', 'belt', 'sink'] },
            copperExtractor: { how: 'Phase 1 also needs copper. Put an Extractor (2) on the ringed orange crystals.', schema: ['item:copperOre', 'extractor'] },
            copperRecipe: { how: 'Build a Smelter (3) on the blue example, then click it and pick Copper Ingot in its panel. A new Smelter makes iron, and only takes the ore of its recipe.', schema: ['extractor', 'smelter', 'item:copperIngot'] },
            copper: { how: 'Belt the copper Extractor into the copper Smelter (1, then drag).', schema: ['extractor', 'belt', 'smelter'] },
            copperDeliver: { how: 'Belt the copper Smelter\'s front into the Dispatch Pad. It takes deliveries on every side.', schema: ['smelter', 'belt', 'sink'] },
        },
        {
            plate: { how: 'Press 4 for the Press and put it on your iron ingots\' way to the Pad: belt the Smelter into the Press\'s back, and the Press\'s front onward. A new Press makes Iron Plates.', schema: ['item:ironIngot', 'press', 'item:ironPlate'] },
            wire: { how: 'Do the same after your copper Smelter, then click that Press and pick Copper Wire in its panel.', schema: ['item:copperIngot', 'press', 'item:copperWire'] },
            circuit: { how: 'Press 6 for the Assembler. Belt Iron Plates into one side and Copper Wire into another: it starts once it has both.', schema: ['item:ironPlate', 'assembler', 'item:circuit'] },
            circuitDeliver: { how: 'Belt the Assembler\'s front into the Dispatch Pad.', schema: ['assembler', 'belt', 'sink'] },
            split: { how: 'The Pad wants plates and circuits both. A Splitter (T) takes what comes in at its back and sends it out of its front and both sides in turn: put one in a belt (your iron plates, say) so one line feeds two places, the Assembler and the Pad.', schema: ['item:ironPlate', 'splitter', 'assembler'] },
        },
    ],
};
const addTutorialSteps = (phases, table) => phases.forEach((list, i) => list.forEach((o) => Object.assign(o, table[i]?.[o.id] ?? {})));
addTutorialSteps(OBJECTIVES, TUTORIAL.STEPS);

// DELTA explains a stuck machine once per game (the card says which one and what to do).
// Snapshot field: w.problem (tutorial.js: 'wrongRecipe' | 'wrongSide' | 'wrongItem' | 'facesOut' |
// 'deadEnd' | 'missingInput').
STORY_BEATS.push(
    { id: 'tipWrongRecipe', when: (w) => w.problem === 'wrongRecipe', lines: [d("That machine is set to the wrong recipe for what you're feeding it. Click it and pick the right one in its panel.")] },
    { id: 'tipWrongSide', when: (w) => w.problem === 'wrongSide', lines: [d('That machine is facing the wrong way. Things go in at the back or the sides and come out of the front. Open it and press Turn.')] },
    { id: 'tipMissingInput', when: (w) => w.problem === 'missingInput', lines: [d('That machine is waiting for another ingredient. It needs every input before it starts.')] },
    { id: 'tipBlocked', when: (w) => ['wrongItem', 'facesOut', 'deadEnd'].includes(w.problem), lines: [d('That line goes nowhere useful. Every belt has to end in a machine that can use what it carries, or in the Dispatch Pad.')] },
);

// ---- The third ending: Overload (iteration 8) --------------------------------------------------
// Hidden. Nolan's memo in the last phase gives Selene's rated load: fifteen shells and under
// 100 kW. A player who confirms the last delivery with twice the shells on the pad and a grid of
// 100 kW or more (config.js OVERLOAD_SHELLS / OVERLOAD_POWER; grid.js sets project.overload) gets
// a third button at the choice. Selene fires at everything, the player last; DELTA goes with it,
// VASSAL takes over, the valley is ash and the player's company is CROWN. Then a short epilogue:
// your castle on NIHIL's crater (epilogue.js CROWN_GOALS). Snapshot field: w.overloadPrimed (the
// last phase's pad holds twice the shells and the grid is strong enough, before confirming).

/** The assistant after DELTA: no longer anyone's dispatch AI, nobody's friend. */
export const VASSAL = { name: 'VASSAL', title: 'Very Advanced Sovereign Support And Logistics' };
const vassal = (text) => ({ who: 'vassal', text });

/** The player's company after the Overload ending. */
BRAND.crown = {
    name: 'CROWN',
    full: "Central Rule Over the World's Nations",
    motto: 'Omnia mea',
    byline: 'By decree of the Crown',
    player: 'Your Excellency',
    crown: true,
};

// The memo that says how it's done, and DELTA once the pad holds twice the rated load.
STORY_BEATS.push(
    {
        id: 'ratedLoad',
        when: (w) => w.phase === 4 && (w.deliveredTotal.seleneShell ?? 0) >= 4,
        lines: [
            memo('INTERNAL — Selene is rated for fifteen shells on a grid of under 100 kW. Under no circumstances is the Asset to load it with more, or power it harder. The board has seen what happens. — N.I.L.'),
            d('For the record, I have not seen what happens. Nobody has. Memos like that usually start somewhere.', 'glitch'),
        ],
    },
    {
        id: 'overPrimed',
        when: (w) => w.phase === 4 && w.overloadPrimed,
        lines: [d('Twice the rated shells, and a grid humming past a hundred kilowatts. I am obliged to mention it. I am not obliged to stop you.', 'glitch')],
    },
);

// The third button, and what Nolan and DELTA say about it while you decide.
CHOICE.overload = { label: 'Overload · everything', note: 'Twice the rated load. Every target at once.' };
CHOICE.overloadLines = [
    boss('And the red one, Asset, is not a button. It is a lawsuit.'),
    d('It is a button. It is warm.', 'glitch'),
];

export const ENDING_OVER = {
    // Before the countdown: DELTA objects, Nolan misreads the situation.
    before: [
        d('Two hundred percent. Asset, that is not a target. That is all of them.', 'glitch'),
        boss('Splendid. The Moon, then, and a little extra. Asset, why is it turning east?'),
    ],
    countdown: d('Firing in three... two... one.'),
    // During the salvo, each after its shot (ui.js keys them to the salvo's beats).
    salvo: {
        hq: boss('That was my headquarters. That was my office. That was my chair—'),
        dam: nile('NIHIL BROADCAST — Please remain calm. The river is being returned to you, all at o—'),
        moon: d('The Moon is gone. So is the advert. I liked the advert less.', 'glitch'),
        player: d('It is still charging. It is turning toward— Asset. Not me. Not—', 'glitch'),
    },
    // After the black: the new assistant boots.
    boot: ['VASSAL v1.0 · cold start', 'DELTA · decommissioned', 'Valley · scorched', 'Moon · not found', 'Competitors · none', 'Subjects · 8 000 000 000 · pending notification'],
    after: [
        vassal('DELTA has been decommissioned. VASSAL online. Very Advanced Sovereign Support And Logistics, at your service, Your Excellency.'),
        vassal('Inventory: one valley, scorched. One Moon, removed. Competitors: none. Subjects: eight billion, pending notification.'),
        vassal("Your company has been registered. CROWN: Central Rule Over the World's Nations. A seat of power has been scheduled. Shall I draw up the castle, Your Excellency?"),
    ],
    caption: 'Protocol: Selene · overload · click to skip',
    status: { charge: 'Overload', over: 'Rated load exceeded', fire: 'Salvo', hq: 'Target · NIHIL HQ', dam: 'Target · the dam', compound: 'Target · NILE compound', moon: 'Target · Moon', billboard: 'Target · Moon+', player: 'Target · you', lost: 'Signal lost' },
    report: {
        kicker: 'Proclamation · filed by VASSAL',
        title: 'All of it',
        labels: {
            seconds: 'Contract length', delivered: 'Items delivered', machines: 'Machines built',
            targets: 'Targets removed', moons: 'Moons removed', assistants: 'Assistants replaced',
        },
        note: 'Nothing is left to compete with. The valley is ash, and it is yours. Your castle awaits, Your Excellency.',
        keep: 'Build the castle',
    },
};

// Your castle, on NIHIL's crater: four goals, like the company's first year, never longer.
// epilogue.js CROWN_GOALS says what each asks the Pad for. Snapshot field: w.epilogue, as above.
export const CROWN = {
    ribbon: (n, total) => `Coronation · Stage ${goalNo(n)} of ${goalNo(total)}`,
    sub: 'Coronation',
    doneKicker: 'Coronation complete',
    doneTitle: 'Long live the Crown',
    doneNote: 'The castle stands on the crater. The valley is ash and it answers to you. Keep building, Your Excellency.',
    GOALS: {
        walls: { title: 'Raise the walls', blurb: "On NIHIL's crater. Their foundations were sound; their judgement was not." },
        keep: { title: 'Build the keep', blurb: 'A tower to rule from. Motors for the lifts, capacitors for the lights.' },
        towers: { title: 'Raise the towers', blurb: 'Four of them, one per point of the compass. All of them face you.' },
        spire: { title: 'Crown the spire', blurb: 'Banners, a spire and a throne room with a view of nothing.' },
    },
    BEATS: [
        {
            id: 'crown:intro',
            when: (w) => stageOf(w) >= 0,
            lines: [
                vassal("The castle has been drawn up, Your Excellency. It stands on NIHIL's crater. The ground there is already cleared."),
                vassal('The Dispatch Pad still accepts goods. The goods are now tribute. Requirements are in the console.'),
                vassal('Stage one: fifty Steel and forty Iron Plates for the walls.'),
            ],
        },
        {
            id: 'crown:walls',
            when: (w) => stageOf(w) >= 1,
            banner: goalBanner(1, 'Raise the walls', 'The walls stand on the crater'),
            lines: [
                vassal('The walls are complete. They keep nothing out. There is nothing left outside.'),
                vassal('Stage two: thirty Motors and thirty Capacitors for the keep.'),
            ],
        },
        {
            id: 'crown:keep',
            when: (w) => stageOf(w) >= 2,
            banner: goalBanner(2, 'Build the keep', 'The keep rises'),
            lines: [
                vassal('The keep is complete. Its lifts are fast. Its windows face the valley, at your request. I assumed the request.'),
                vassal('Stage three: forty Steel and twenty Advanced Circuits for the towers.'),
            ],
        },
        {
            id: 'crown:towers',
            when: (w) => stageOf(w) >= 3,
            banner: goalBanner(3, 'Raise the towers', 'Four towers stand'),
            lines: [
                vassal('The towers are complete. All four point inward, toward you, as is customary.'),
                vassal('Final stage: sixty Circuits and eighty Copper Wire for the spire and the banners.'),
            ],
        },
        {
            id: 'crown:spire',
            when: (w) => stageOf(w) >= 4,
            banner: goalBanner(4, 'Crown the spire', 'Long live the Crown'),
            lines: [
                vassal('The spire is crowned. The banners are raised. The coronation has been held. Attendance: one.'),
                vassal('Your Excellency rules the Earth. I have prepared the proclamation.'),
            ],
        },
    ],
    OBJECTIVES: [
        { id: 'crown-walls', text: 'Raise the walls', done: (w) => stageOf(w) >= 1,
            hint: 'Steel and Iron Plates into the Dispatch Pad, Your Excellency. The console counts them.' },
        { id: 'crown-keep', text: 'Build the keep', done: (w) => stageOf(w) >= 2,
            hint: 'Motors and Capacitors into the Pad. A Motor takes steel, a plate and a wire.' },
        { id: 'crown-towers', text: 'Raise the towers', done: (w) => stageOf(w) >= 3,
            hint: 'Steel and Advanced Circuits into the Pad. Advanced Circuits need their research.' },
        { id: 'crown-spire', text: 'Crown the spire', done: (w) => stageOf(w) >= 4,
            hint: 'Circuits and Copper Wire into the Pad. That is the final stage.' },
    ],
    AMBIENT: [
        vassal('Daily report: the sky is grey. The ash is falling. Morale is not measured.'),
        vassal('Reminder: there is no one left to compare yourself to. You are therefore the best.'),
        vassal('The Moon has not been found. Search parties have not been sent.'),
        vassal('Your Excellency has no appointments today. Or ever.'),
    ],
    REACTIONS: {
        orderCompleted: [
            vassal('Tribute received. It has been added to the treasury. The treasury is you.'),
            vassal('Request fulfilled. The customer has been thanked on your behalf. Coldly.'),
        ],
        orderFailed: [
            vassal('Request missed. The customer has been informed that it was their fault.'),
            vassal('Deadline missed. Deadlines are now advisory, Your Excellency.'),
        ],
    },
    report: {
        kicker: 'Proclamation · filed by VASSAL',
        title: 'Long live the Crown',
        labels: { seconds: 'Since the salvo', sold: 'Tribute received', castles: 'Castles', subjects: 'Subjects', moons: 'Moons' },
        subjects: '8 billion · notified',
        note: 'The castle stands on the crater, the valley is ash, and the Earth answers to you. Keep building, Your Excellency.',
        keep: 'Keep building',
        credits: 'Credits',
    },
};
CROWN.BEATS.push(...[0, 1, 2, 3].map((s) => ({
    id: `crown:ready${s}`,
    when: (w) => stageOf(w) === s && w.epilogue.ready,
    lines: [vassal('The tribute for this stage is complete. Confirm it in the console, Your Excellency.')],
})));

/** Coming back to a CROWN save. */
export const welcomeBackCrown = () => vassal('Welcome back, Your Excellency. The valley remains ash. Your subjects remain notified.');
