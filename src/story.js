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
//   w.phaseProgress (0..1: share of the active phase's deliveries made)

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

/** The organisation as the player currently sees it (NIHIL from the reveal on). */
export const brandFor = (phase) => (phase >= 4 ? BRAND.nihil : BRAND.nile);
export const brandName = (phase) => brandFor(phase).name;

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

export const welcomeBack = (phase) =>
    d(`Welcome back, ${brandFor(phase).player}. Your absence has been logged, timestamped and gently judged.`, phase >= 4 ? 'sinister' : undefined);

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
            d("NILE has a plan. It's called Protocol: Selene, a cannon powerful enough to push the Moon back into a safe orbit. And you are going to build it.", 'happy'),
            d('Out of eight billion candidates, NILE chose you. Your courage, your talent and your remarkably low salary expectations made it an easy decision.'),
            d('Quick orientation: WASD or the arrow keys move your view, the mouse wheel zooms, Q and E rotate. Middle-drag works too.'),
            d('NILE has leased you a small plot for now: the fenced land around the Dispatch Pad. It grows as the cannon does.'),
            d("Let's start small. I've ringed the grey crystals near the Dispatch Pad: that's iron ore. Select the Extractor (key 2) and place it on one."),
        ],
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
            d('Phase 2 needs targeting circuitry: Iron Plates and Circuits. The Press (key 4) stamps iron ingots into plates, or draws copper ingots into wire. Pick which in its panel.'),
            d('An Assembler (key 6) makes a Circuit from one iron plate and one copper wire. Two presses, one assembler, a great many belts.'),
            d('A Splitter (key T) sends one belt three ways. A Merger (key Y) does the opposite. Like a family, but useful.'),
            d('NILE will also send you Priority Requests from now on. Completing them pays a bonus. Ignoring them is noted in your file.'),
            d("Oh, a small update: the Moon's impact date has been revised from 'seventeen days' to 'soon'. Please do not request clarification.", 'glitch'),
        ],
    },
    {
        id: 'firstCircuit',
        when: (w) => w.phase === 1 && w.produced.circuit > 0,
        lines: [d('A circuit! So small. So fragile. So billable.', 'happy')],
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
            memo('INTERNAL — Moon+ launch plan. Tiers: Basic (crescent only), Plus (full moon, with ads), Premium (full moon, ad-free, 49.99/month). Launch date: one day after SELENE.'),
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
        { id: 'copperRecipe', text: 'Set a Smelter to Copper Ingot', done: (w) => (w.recipes['smelter:copperIngot'] ?? 0) > 0,
            hint: 'Click a Smelter to open its panel and pick Copper Ingot. A Smelter only takes the ore of its recipe.' },
        { id: 'copper', text: 'Smelt a Copper Ingot', done: (w) => w.produced.copperIngot > 0, focus: 'copperOre',
            hint: 'Copper ore is the ringed orange crystal field: an Extractor on it, a belt, and a Smelter set to Copper Ingot.' },
    ],
    [
        { id: 'plate', text: 'Press an Iron Plate', done: (w) => w.produced.ironPlate > 0,
            hint: 'Put a Press (key 4) after an iron Smelter. A new Press starts on Iron Plate.' },
        { id: 'wire', text: 'Draw Copper Wire', done: (w) => w.produced.copperWire > 0,
            hint: 'Put a second Press after your copper Smelter, click it and pick Copper Wire.' },
        { id: 'circuit', text: 'Assemble a Circuit', done: (w) => w.produced.circuit > 0,
            hint: 'An Assembler (key 6) needs one iron plate AND one copper wire. Belt both into it, any side works.' },
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

// Played as subtitles in the ending, one after another (spaced by their voice clips).
export const ENDING = {
    lines: [
        d("Firing in three... two... I'm contractually obliged to say 'one'."),
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
    },
};
