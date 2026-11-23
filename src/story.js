// src/story.js — every player-facing word of the campaign: names, phase
// titles, DELTA's script (story beats + tutorial objectives + hints), ambient
// chatter and the ending. Pure data; the predicates read the world snapshot
// that main.js builds, and director.js decides when each line plays.
//
// World snapshot (`w`) fields used here:
//   w.tick, w.phase, w.complete, w.money, w.throttle,
//   w.produced[item], w.deliveredTotal[item], w.delivered[item] (active phase),
//   w.researchEarned, w.tech[id], w.techCount,
//   w.built[type], w.extractorOn[resource], w.fueledGenerators, w.upgraded

export const GAME_TITLE = 'Protocol: Selene';

export const AI = { name: 'DELTA', title: 'Dispatch & Engineering Logistics Task Assistant' };

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
    research: 'Research',
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
    sink: 'Dispatch Pad',
};

export const BUILDING_DESC = {
    belt: 'Moves items one tile per tick. Drag to lay.',
    splitter: 'One input (back), three outputs, round-robin.',
    merger: 'Three inputs, one output straight ahead.',
    extractor: 'Mines the ore node it stands on.',
    smelter: 'Ore → ingot.',
    assembler: 'Iron + copper ingot → Circuit. 2 circuits → Research.',
    generator: 'Burns coal to power the grid.',
    lab: 'Turns Research into research points.',
};

export const TECH_TEXT = {
    fastBelts: { label: 'Express Belts', desc: 'Belts and routers move twice per tick' },
    advancedProduct: { label: 'Adv. Circuits', desc: 'Assembler: 2 circuits + 1 iron ingot → Advanced Circuit' },
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
// mood (delta only): undefined | 'happy' | 'glitch' | 'sinister'
const d = (text, mood) => ({ who: 'delta', text, mood });
const nile = (text) => ({ who: 'nile', text });
const memo = (text) => ({ who: 'memo', text });

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
            d("Phase 1 needs 20 iron ingots. Spend your credits on more Extractors and Smelters if you like. The Moon won't un-fall itself."),
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
            d("Look at you go! I've unlocked the Assembler, the Splitter and the Merger.", 'happy'),
            d("Phase 2 needs targeting circuitry. An Assembler (key 4) turns one iron ingot plus one copper ingot into a Circuit. Copper is the glowing orange crystal field; I've ringed it for you."),
            d('A Splitter (key 7) sends one belt three ways. A Merger (key 8) does the opposite. Like a family, but useful.'),
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
        when: (w) => w.throttle < 0.999 && w.phase < 3,
        lines: [
            d('Brownout! You have more machines than the starter grid can feed. They keep working, just slower. Like interns.'),
            d('Generators arrive with Phase 3. Until then: prioritise, or enjoy the slow life.'),
        ],
    },
    {
        id: 'phase2',
        when: (w) => w.phase >= 2,
        banner: 1,
        lines: [
            nile('PHASE 2 COMPLETE — Targeting systems online. The Moon has been located. It was where we left it.'),
            d('The Lab (key 0) is now available. An Assembler fed only circuits makes Research; a Lab turns Research into points you can spend on technology.', 'happy'),
            memo('INTERNAL — Moon+ launch plan. Tiers: Basic (crescent only), Plus (full moon, with ads), Premium (full moon, ad-free, 49.99/month). Launch date: one day after SELENE.'),
            d('Please disregard that memo. It was sent to you by mistake. You are not cleared for mistakes.', 'glitch'),
            d('Moving on! Phase 3 is the Power Core: lots of circuits. Research can make your factory faster. Faster work is its own reward. It is also the only reward.'),
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
            d('Generators are unlocked (key 9)! Belt coal from the black crystal field into them and they will feed the power grid.', 'happy'),
            d('Phase 4 is the Payload: Advanced Circuits. Two circuits plus one iron ingot, in an Assembler. Research the recipe first.'),
            d('NIHIL thanks you for your continued compliance.', 'glitch'),
            d('...NILE. I said NILE. You heard NILE. Everyone heard NILE.', 'glitch'),
            nile('CORPORATE ANNOUNCEMENT — NILE is thrilled to share that our bold new name will be unveiled upon completion of Protocol: Selene. Stay tuned!'),
            memo('INTERNAL — Re: rebrand. Legal confirms "Heavy Industry" fits between the I and the L. The E was never load-bearing.'),
        ],
    },
    {
        id: 'brownoutLate',
        when: (w) => w.throttle < 0.999 && w.phase >= 3,
        lines: [d('Brownout detected. Build Generators and keep them fed with coal. Darkness is a premium feature.')],
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
            d('Before you get ideas: your contract requires completion. Clause 88 also requires you to enjoy it. Please smile at the nearest camera.', 'sinister'),
            d('Also, HR has updated your title. You are no longer a Steward. You are an Asset. Congratulations on the promotion.', 'sinister'),
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
    ],
    [
        { id: 'copper', text: 'Smelt a Copper Ingot', done: (w) => w.produced.copperIngot > 0, focus: 'copperOre',
            hint: 'Copper ore is the ringed orange crystal field. Same recipe as iron: Extractor, belt, Smelter.' },
        { id: 'circuit', text: 'Assemble a Circuit', done: (w) => w.produced.circuit > 0,
            hint: 'An Assembler (key 4) needs one iron ingot AND one copper ingot. Belt both into it, any side works.' },
        { id: 'split', text: 'Share a belt with a Splitter', done: (w) => w.built.splitter > 0,
            hint: 'You need copper ingots for the Pad and for circuits. A Splitter (key 7) sends one belt three ways.' },
    ],
    [
        { id: 'lab', text: 'Build a Lab', done: (w) => w.built.lab > 0,
            hint: 'The Lab is key 0. It only accepts Research.' },
        { id: 'research', text: 'Produce research points', done: (w) => w.researchEarned > 0,
            hint: 'Feed an Assembler ONLY circuits: two circuits make one Research. Belt that into the Lab.' },
        { id: 'tech', text: 'Unlock a technology', done: (w) => w.techCount > 0,
            hint: 'Spend research points in the Research panel. Express Belts is a crowd favourite.' },
    ],
    [
        { id: 'generator', text: 'Fuel a Generator with coal', done: (w) => w.fueledGenerators > 0, focus: 'coalOre',
            hint: 'Generator is key 9. Mine the ringed black coal crystals and belt the coal straight into it.' },
        { id: 'advTech', text: 'Research Advanced Circuits', done: (w) => w.tech.advancedProduct,
            hint: 'Advanced Circuits cost 60 research points in the Research panel.' },
        { id: 'advanced', text: 'Assemble an Advanced Circuit', done: (w) => w.produced.advancedCircuit > 0,
            hint: 'An Assembler holding 2 circuits + 1 iron ingot makes an Advanced Circuit.' },
    ],
    [
        { id: 'upgrade', text: 'Upgrade a machine', done: (w) => w.upgraded > 0,
            hint: 'Select Upgrade (key 5) and click a machine. Higher tiers work faster. The Moon will not wait. Well, it will. But NIHIL will not.' },
    ],
];

// Idle chatter, one every few minutes when nothing else is being said.
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

// Played inside the ending overlay, timed by CSS (one line every few seconds).
export const ENDING = {
    lines: [
        d("Firing in three... two... I'm contractually obliged to say 'one'."),
        d('Congratulations, Asset. You have saved Earth from free things.', 'sinister'),
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
