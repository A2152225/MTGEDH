import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

function collectUnknowns(value: unknown): unknown[] {
  const unknowns: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as any).kind === 'unknown') unknowns.push((node as any).raw ?? node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns;
}

function collectSteps(value: unknown): any[] {
  const steps: any[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (typeof (node as any).kind === 'string') steps.push(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return steps;
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base: any = {
    id: 'oracle-ir-current-batch',
    format: 'commander',
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        commandZone: [],
        counters: {},
        hasLost: false,
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        commandZone: [],
        counters: {},
        hasLost: false,
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ],
    turnOrder: ['p1', 'p2'],
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turn: 1,
    turnNumber: 1,
    phase: 'precombatMain',
    step: 'main',
    stack: [],
    battlefield: [],
    commandZone: {},
    startingLife: 20,
    allowUndos: false,
    turnTimerEnabled: false,
    turnTimerSeconds: 0,
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    spectators: [],
    status: 'inProgress',
  };

  return { ...base, ...overrides } as GameState;
}

describe('Oracle IR current audit batch support', () => {
  it('parses Prime Speaker Zegana counters and draw without unknowns', () => {
    const ir = parseOracleTextToIR(
      'Prime Speaker Zegana enters with X +1/+1 counters on it, where X is the greatest power among other creatures you control.\nWhen Prime Speaker Zegana enters, draw cards equal to its power.',
      'Prime Speaker Zegana'
    );

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'add_counter',
      amount: { kind: 'greatest_power_among_other_creatures_you_control' },
      counter: '+1/+1',
    });
    expect(ir.abilities[1]?.steps[0]).toMatchObject({
      kind: 'draw',
      amount: { kind: 'source_power' },
    });
  });

  it('applies Zegana greatest-power counters before drawing equal to source power', () => {
    const ir = parseOracleTextToIR(
      'Prime Speaker Zegana enters with X +1/+1 counters on it, where X is the greatest power among other creatures you control.\nWhen Prime Speaker Zegana enters, draw cards equal to its power.',
      'Prime Speaker Zegana'
    );
    const steps = [...(ir.abilities[0]?.steps ?? []), ...(ir.abilities[1]?.steps ?? [])];
    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          life: 20,
          hand: [],
          library: [
            { id: 'card-1', name: 'One' },
            { id: 'card-2', name: 'Two' },
            { id: 'card-3', name: 'Three' },
            { id: 'card-4', name: 'Four' },
            { id: 'card-5', name: 'Five' },
            { id: 'card-6', name: 'Six' },
          ],
          graveyard: [],
          exile: [],
          commandZone: [],
          counters: {},
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        } as any,
      ],
      battlefield: [
        {
          id: 'zegana-1',
          name: 'Prime Speaker Zegana',
          controller: 'p1',
          type_line: 'Legendary Creature — Merfolk Wizard',
          basePower: 1,
          counters: {},
        },
        {
          id: 'other-1',
          name: 'Large Creature',
          controller: 'p1',
          type_line: 'Creature — Beast',
          basePower: 4,
          counters: {},
        },
      ],
      turnOrder: ['p1'],
    } as any);

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'zegana-1',
      sourceName: 'Prime Speaker Zegana',
    });
    const player = (result.state.players as any[]).find((candidate) => candidate.id === 'p1');
    const zegana = ((result.state as any).battlefield as any[]).find((perm) => perm.id === 'zegana-1');

    expect(zegana.counters['+1/+1']).toBe(4);
    expect(player.hand).toHaveLength(5);
  });

  it('parses current-batch modal and delayed-return cards without unknowns', () => {
    const samples = [
      [
        'Aetheric Amplifier',
        '{T}: Add one mana of any color.\n{4}, {T}: Choose one. Activate only as a sorcery.\n• Double the number of each kind of counter on target permanent.\n• Double the number of each kind of counter you have.',
      ],
      [
        'Hidden Nursery',
        'When Hidden Nursery enters, discover 4.\n{T}: Add {G}.',
      ],
      [
        'Obzedat, Ghost Council',
        "When Obzedat enters, target opponent loses 2 life and you gain 2 life.\nAt the beginning of your end step, you may exile Obzedat. If you do, return it to the battlefield under its owner's control at the beginning of your next upkeep. It gains haste.",
      ],
      [
        'Michelangelo, Improviser',
        'Sneak {2}{G}{G} (You may cast this spell for {2}{G}{G} if you also return an unblocked attacker you control to hand during the declare blockers step. He enters tapped and attacking.)\nWhenever Michelangelo deals combat damage to a player, you may put a creature card and/or a land card from your hand onto the battlefield.',
      ],
    ] as const;

    for (const [cardName, oracleText] of samples) {
      const ir = parseOracleTextToIR(oracleText, cardName);
      expect(collectUnknowns(ir.abilities), cardName).toEqual([]);
    }
  });

  it('splits Fleshformer temporary pump and fear grant without unknowns', () => {
    const ir = parseOracleTextToIR(
      '{W}{U}{B}{R}{G}: This creature gets +2/+2 and gains fear until end of turn. Target creature gets -2/-2 until end of turn. Activate only during your turn.',
      'Fleshformer'
    );
    const steps = ir.abilities[0]?.steps ?? [];

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(steps).toMatchObject([
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'this creature' },
        power: 2,
        toughness: 2,
        duration: 'end_of_turn',
      },
      {
        kind: 'grant_temporary_ability',
        target: { kind: 'raw', text: 'This creature' },
        duration: 'end_of_turn',
        abilities: ['fear'],
      },
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: 'target creature' },
        power: -2,
        toughness: -2,
        duration: 'end_of_turn',
      },
    ]);
  });

  it('doubles each kind of counter a player has', () => {
    const ir = parseOracleTextToIR('Double the number of each kind of counter you have.', 'Aetheric Amplifier');
    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          life: 20,
          hand: [],
          library: [],
          graveyard: [],
          exile: [],
          commandZone: [],
          counters: { ticket: 3 },
          energyCounters: 2,
          poisonCounters: 1,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        } as any,
      ],
      turnOrder: ['p1'],
    } as any);

    const result = applyOracleIRStepsToGameState(state, ir.abilities[0]?.steps ?? [], {
      controllerId: 'p1',
      sourceName: 'Aetheric Amplifier',
    });
    const player = (result.state.players as any[]).find((candidate) => candidate.id === 'p1');

    expect(player.energyCounters).toBe(4);
    expect(player.poisonCounters).toBe(2);
    expect(player.counters.ticket).toBe(6);
  });

  it('parses current-batch graveyard keyword, token replacement, and static grant gaps', () => {
    const samples = [
      [
        'Iroh, Grand Lotus',
        'During your turn, each non-Lesson instant and sorcery card in your graveyard has flashback.',
      ],
      ['Salvation Colossus', 'Unearth-Pay eight {E}.'],
      ['Meticulous Excavation', "If it has unearth, instead exile it, then return that card to its owner's hand."],
      ['Mishra, Tamer of Mak Fawa', 'Each artifact card in your graveyard has unearth {1}{B}{R}.'],
      [
        'Ghost Ark',
        'Whenever this Vehicle becomes crewed, each artifact creature card in your graveyard gains unearth {3} until end of turn.',
      ],
      ['Deeproot Historian', 'Merfolk and Druid cards in your graveyard have retrace.'],
      ['Cursecloth Wrappings', 'Target creature card in your graveyard gains embalm until end of turn.'],
      [
        "The Grim Captain's Locker",
        'Until end of turn, each creature card in your graveyard gains "Escape-{3}{B}, Exile four other cards from your graveyard." (You may cast a card with escape from your graveyard for its escape cost.)',
      ],
      [
        "Urza's Saga",
        'II — This Saga gains "{2}, {T}: Create a 0/0 colorless Construct artifact creature token with \'This token gets +1/+1 for each artifact you control.\'"',
      ],
      ['Academy Manufactor', 'If you would create a Clue, Food, or Treasure token, instead create one of each.'],
      [
        'The Reaver Cleaver',
        'Equipped creature gets +1/+1 and has trample and "Whenever this creature deals combat damage to a player or planeswalker, create that many Treasure tokens."',
      ],
      ['Coruscation Mage', 'If you do, when this creature enters, create a 1/1 token copy of it.)'],
      [
        'Blade of Selves',
        'Equipped creature has myriad. (Whenever it attacks, for each opponent other than defending player, you may create a token copy that\'s tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)',
      ],
      ['Xorn', 'If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.'],
    ] as const;

    for (const [cardName, oracleText] of samples) {
      const ir = parseOracleTextToIR(oracleText, cardName);
      expect(collectUnknowns(ir.abilities), cardName).toEqual([]);
    }

    expect(parseOracleTextToIR('Unearth-Pay eight {E}.', 'Salvation Colossus').abilities[0]).toMatchObject({
      cost: 'Pay eight {E}',
      steps: [{ kind: 'move_zone' }, { kind: 'schedule_delayed_battlefield_action' }, { kind: 'grant_leave_battlefield_replacement' }],
    });

    const grimSteps = collectSteps(parseOracleTextToIR(samples[7][1], samples[7][0]).abilities);
    expect(grimSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_graveyard_permission', permission: 'cast', duration: 'this_turn' }),
      expect.objectContaining({
        kind: 'modify_graveyard_permissions',
        castCostRaw: '{3}{B}',
        additionalCost: expect.objectContaining({ kind: 'exile_from_graveyard', count: 4 }),
      }),
    ]));

    expect(collectSteps(parseOracleTextToIR(samples[9][1], samples[9][0]).abilities)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'modify_token_creation',
        tokenTypes: ['clue', 'food', 'treasure'],
        mode: 'replace_with_one_of_each',
      }),
    ]));

    expect(collectSteps(parseOracleTextToIR(samples[10][1], samples[10][0]).abilities)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'grant_static_ability',
        abilities: ['trample'],
        power: 1,
        toughness: 1,
      }),
    ]));

    expect(collectSteps(parseOracleTextToIR(samples[11][1], samples[11][0]).abilities)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', token: '1/1 copy of it' }),
    ]));

    expect(collectSteps(parseOracleTextToIR(samples[12][1], samples[12][0]).abilities)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', abilities: ['myriad'] }),
    ]));
  });

  it('surfaces current-batch wrapped token creation metadata', () => {
    const delinaSteps = collectSteps(parseOracleTextToIR(
      'Whenever Delina attacks, choose target creature you control, then roll a d20.\n1-14 | Create a tapped and attacking token that\'s a copy of that creature, except it\'s not legendary and it has "At end of combat, exile this token."\n15-20 | Create one of those tokens. You may roll again.',
      'Delina, Wild Mage'
    ).abilities);
    expect(delinaSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', entersTapped: true, attacking: 'defending_player' }),
    ]));

    const spotlightSteps = collectSteps(parseOracleTextToIR(
      'Each opponent chooses fame or fortune. For each player who chose fame, gain control of a creature that player controls until end of turn. Untap those creatures and they gain haste until end of turn. For each player who chose fortune, you draw a card and create a Treasure token.',
      'Seize the Spotlight'
    ).abilities);
    expect(spotlightSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', token: 'Treasure' }),
    ]));

    const stashSteps = collectSteps(parseOracleTextToIR(
      'Lands you control have "{T}: Create a Treasure token."',
      "Bootleggers' Stash"
    ).abilities);
    expect(collectUnknowns(stashSteps)).toEqual([]);
    expect(stashSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'create_token', token: 'Treasure' }),
    ]));
  });

  it('surfaces token creation metadata for offset-800 automation gaps', () => {
    const cases = [
      ['Kozilek\'s Unsealing', 'Whenever you cast a creature spell with mana value 4, 5, or 6, create two 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this token: Add {C}."'],
      ['Warden of the Grove', '(Put X +1/+1 counters on the creature that entered or create an X/X white Spirit creature token.)'],
      ['Sedgemoor Witch', 'Magecraft - Whenever you cast or copy an instant or sorcery spell, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."'],
      ['Doppelgang', 'For each of X target permanents, create X tokens that are copies of that permanent.'],
      ['Master of Ceremonies', 'For each player who chose money, you and that player each create a Treasure token.'],
      ['Gluntch, the Bestower', 'Then choose a third player to create two Treasure tokens.'],
      ['Den of the Bugbear', '{3}{R}: Until end of turn, this land becomes a 3/2 red Goblin creature with "Whenever this creature attacks, create a 1/1 red Goblin creature token that\'s tapped and attacking." It\'s still a land.'],
      ['Guild Artisan', 'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, you create two Treasure tokens."'],
      ['Scurry of Squirrels', 'Myriad, myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that\'s tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)'],
      ['Galadhrim Brigade', 'Squad {1}{G} (As an additional cost to cast this spell, you may pay {1}{G} any number of times. When this creature enters, create that many tokens that are copies of it.)\nOther Elves you control get +1/+1.'],
      ['Infantry Shield', '(Whenever it attacks, create X tapped and attacking 1/1 red Warrior creature tokens.)'],
      ['Mirror March', 'Whenever a nontoken creature you control enters, flip a coin until you lose a flip. For each flip you won, create a token that\'s a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.'],
      ['Bloodroot Apothecary', 'When this creature enters, you and target opponent each create a Treasure token.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    for (const [name] of cases) {
      expect(stepsByName.get(name)?.some((step) => step.kind === 'create_token'), `${name} should surface create_token`).toBe(true);
    }

    expect(stepsByName.get('Infantry Shield')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', token: '1/1 red Warrior', entersTapped: true, attacking: 'defending_player' }),
    ]));

    expect(stepsByName.get('Guild Artisan')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'create_token', token: 'Treasure' }),
    ]));

    expect(stepsByName.get('Galadhrim Brigade')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', token: 'copy of it' }),
    ]));
  });

  it('surfaces token creation metadata for offset-1050 primary gaps', () => {
    const cases = [
      ['Securitron Squadron', 'Squad {3} (As an additional cost to cast this spell, you may pay {3} any number of times. When this creature enters, create that many tokens that are copies of it.)\nVigilance\nWhenever a creature token you control enters, put a +1/+1 counter on it.'],
      ['Ultramarines Honour Guard', 'Squad {2} (As an additional cost to cast this spell, you may pay {2} any number of times. When this creature enters, create that many tokens that are copies of it.)\nOther creatures you control get +1/+1.'],
      ['Sicarian Infiltrator', 'Flash\nSquad {2} (As an additional cost to cast this spell, you may pay {2} any number of times. When this creature enters, create that many tokens that are copies of it.)\nBenediction of the Omnissiah - When this creature enters, draw a card.'],
      ['Kavaron, Memorial World', '{T}: Add {R}.\nStation (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It\'s an artifact creature at 12+.)\n12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.'],
      ['Vanguard Suppressor', 'Squad {2} (As an additional cost to cast this spell, you may pay {2} any number of times. When this creature enters, create that many tokens that are copies of it.)\nFlying\nSuppressing Fire - Whenever this creature deals combat damage to a player, draw a card.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    for (const [name] of cases) {
      expect(stepsByName.get(name)?.some((step) => step.kind === 'create_token'), `${name} should surface create_token`).toBe(true);
    }

    for (const name of ['Securitron Squadron', 'Ultramarines Honour Guard', 'Sicarian Infiltrator', 'Vanguard Suppressor']) {
      expect(stepsByName.get(name)).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'create_token', token: 'copy of it' }),
      ]));
    }

    expect(stepsByName.get('Kavaron, Memorial World')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', token: '2/2 colorless Robot artifact' }),
    ]));
  });

  it('prunes offset-1050 secondary reminder noise', () => {
    const cases = [
      ['City of Death', '(As this Saga enters and after your draw step, add a lore counter.)\nI, II - Create a 2/2 black Alien creature token.\nIII - Destroy all non-Alien creatures.'],
      ['Path of Annihilation', 'Devoid (This card has no color.)\nWhenever you cast a colorless spell with mana value 7 or greater, create a 10/10 colorless Eldrazi creature token.'],
      ['Witch\'s Mark', 'Target creature you control gets +1/+0 until end of turn. Create a Wicked Role token attached to it. (If you control another Role on it, put that one into the graveyard. Enchanted creature gets +1/+1. When this token is put into a graveyard, each opponent loses 1 life.)'],
      ['Ranger Class', '(Gain the next level as a sorcery to add its ability.)\nWhen this Class enters, create a 2/2 green Wolf creature token.\n{1}{G}: Level 2\nWhenever you attack, put a +1/+1 counter on target attacking creature.\n{3}{G}: Level 3\nYou may look at the top card of your library any time.'],
      ['Tender Wildguide', 'Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\n{T}: Add one mana of any color.'],
      ['Wolfwillow Haven', 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.\n{4}{G}, Sacrifice Wolfwillow Haven: Create a 2/2 green Wolf creature token.'],
      ['Elturel Survivors', 'Trample, myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that\'s tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)'],
    ] as const;

    const unknownsByName = new Map(cases.map(([name, text]) => [name, collectUnknowns(parseOracleTextToIR(text, name).abilities)]));

    expect(unknownsByName.get('City of Death')?.join('\n')).not.toMatch(/As this Saga enters/i);
    expect(unknownsByName.get('Path of Annihilation')?.join('\n')).not.toMatch(/Devoid/i);
    expect(unknownsByName.get('Witch\'s Mark')?.join('\n')).not.toMatch(/Role|Enchanted creature gets/i);
    expect(unknownsByName.get('Ranger Class')?.join('\n')).not.toMatch(/Gain the next level/i);
    expect(unknownsByName.get('Tender Wildguide')?.join('\n')).not.toMatch(/Offspring/i);
    expect(unknownsByName.get('Wolfwillow Haven')?.join('\n')).not.toMatch(/Enchant land/i);
    expect(unknownsByName.get('Elturel Survivors')?.join('\n')).not.toMatch(/myriad/i);
  });

  it('surfaces damage metadata for offset-2050 primary gaps', () => {
    const cases = [
      ['Bushwhack', 'Target creature you control fights target creature you don\'t control.'],
      ['Passionate Archaeologist', 'Commander creatures you own have "Whenever you cast a spell from exile, this creature deals damage equal to that spell\'s mana value to target opponent."'],
      ['Viridian Longbow', 'Equipped creature has "{T}: This creature deals 1 damage to any target."\nEquip {3}'],
      ['Torbran, Thane of Red Fell', 'If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.'],
      ['Electrolyze', 'Electrolyze deals 2 damage divided as you choose among one or two targets. Draw a card.'],
      ['Sentinel Sarah Lyons', 'When Sentinel Sarah Lyons enters, up to two target creatures you control each deal damage equal to their power to up to one target creature.'],
      ['Koth, Fire of Resistance', 'You get an emblem with "Whenever a Mountain enters under your control, this emblem deals 4 damage to any target."'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    for (const [name] of cases) {
      expect(
        stepsByName.get(name)?.some((step) => step.kind === 'deal_damage' || step.kind === 'modify_damage'),
        `${name} should surface damage automation metadata`
      ).toBe(true);
    }

    expect(stepsByName.get('Torbran, Thane of Red Fell')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'modify_damage', mode: 'add', amount: { kind: 'number', value: 2 } }),
    ]));
    expect(stepsByName.get('Electrolyze')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'deal_damage', division: 'as_you_choose' }),
    ]));
    expect(stepsByName.get('Viridian Longbow')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'deal_damage', amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('prunes offset-2050 secondary reminder noise', () => {
    const cases = [
      ['Chancellor of the Forge', 'You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, create a 1/1 red Goblin creature token with haste.'],
      ['Armed with Proof', 'When Armed with Proof enters, investigate twice. (To investigate, create a Clue token. It\'s an artifact with "{2}, Sacrifice this artifact: Draw a card.")'],
      ['Dragonwing Glider', 'For Mirrodin! (When this Equipment enters, create a 2/2 red Rebel creature token, then attach this to it.)\nEquipped creature gets +2/+2 and has flying and haste.'],
      ['Elturel Survivors', 'Trample Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that\'s tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)'],
    ] as const;

    const unknownsByName = new Map(cases.map(([name, text]) => [name, collectUnknowns(parseOracleTextToIR(text, name).abilities)]));

    expect(unknownsByName.get('Chancellor of the Forge')?.join('\n')).not.toMatch(/opening hand|first upkeep/i);
    expect(unknownsByName.get('Armed with Proof')?.join('\n')).not.toMatch(/investigate|Clue token|Sacrifice this artifact/i);
    expect(unknownsByName.get('Dragonwing Glider')?.join('\n')).not.toMatch(/For Mirrodin|Rebel creature token/i);
    expect(unknownsByName.get('Elturel Survivors')?.join('\n')).not.toMatch(/myriad/i);
  });

  it('surfaces offset-3050 damage and dynamic draw primary gaps', () => {
    const cases = [
      ['Torch the Witness', 'Torch the Witness deals twice X damage to target creature. If excess damage was dealt to that creature this way, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")'],
      ['Benevolent Unicorn', 'If a spell would deal damage to a permanent or player, it deals that much damage minus 1 to that permanent or player instead.'],
      ['Return of the Wildspeaker', 'Choose one -\n• Draw cards equal to the greatest power among non-Human creatures you control.\n• Non-Human creatures you control get +3/+3 until end of turn.'],
      ['Rishkar\'s Expertise', 'Draw cards equal to the greatest power among creatures you control. You may cast a spell with mana value 5 or less from your hand without paying its mana cost.'],
      ['Greater Good', 'Sacrifice a creature: Draw cards equal to the sacrificed creature\'s power, then discard three cards.'],
      ['Loran of the Third Path', '{T}: You and target opponent each draw a card.'],
      ['Selvala, Heart of the Wilds', 'Whenever another creature enters, its controller may draw a card if its power is greater than each other creature\'s power.'],
      ['Sram, Senior Edificer', 'Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.'],
      ['Trouble in Pairs', 'Whenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn, you draw a card.'],
      ['Braids, Arisen Nightmare', 'At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn\'t, that player loses 2 life and you draw a card.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    expect(stepsByName.get('Torch the Witness')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'deal_damage' }),
    ]));
    expect(stepsByName.get('Benevolent Unicorn')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'modify_damage', mode: 'subtract', amount: { kind: 'number', value: 1 } }),
    ]));

    for (const name of cases.slice(2).map(([caseName]) => caseName)) {
      expect(stepsByName.get(name)?.some((step) => step.kind === 'draw'), `${name} should surface draw`).toBe(true);
    }

    expect(stepsByName.get('Return of the Wildspeaker')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', amount: { kind: 'greatest_power_among_creatures_you_control', excludeSubtype: 'human' } }),
    ]));
    expect(stepsByName.get('Rishkar\'s Expertise')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', amount: { kind: 'greatest_power_among_creatures_you_control' } }),
    ]));
    expect(stepsByName.get('Loran of the Third Path')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', who: { kind: 'you_and_target_opponent' } }),
    ]));
  });

  it('keeps offset-3050 draw-family condition and reminder false positives non-draw', () => {
    const cases = [
      ['Psychosis Crawler', 'Whenever you draw a card, each opponent loses 1 life.'],
      ['Sheoldred, the Apocalypse', 'Deathtouch\nWhenever you draw a card, you gain 2 life.\nWhenever an opponent draws a card, they lose 2 life.'],
      ['Laboratory Maniac', 'If you would draw a card while your library has no cards in it, you win the game instead.'],
      ['Life from the Loam', 'Return up to three target land cards from your graveyard to your hand.\nDredge 3 (If you would draw a card, you may mill three cards instead.)'],
      ['Ledger Shredder', 'Flying\nWhenever a player casts their second spell each turn, this creature connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    for (const [name] of cases) {
      expect(stepsByName.get(name)?.some((step) => step.kind === 'draw'), `${name} should not surface executable draw`).toBe(false);
    }
  });

  it('surfaces offset-4050 triggered draw effects before follow-up actions', () => {
    const cases = [
      ['Bonny Pall, Clearcutter', 'Whenever you attack, draw a card, then you may put a land card from your hand or graveyard onto the battlefield.'],
      ['Mirelurk Queen', 'Whenever one or more nonland cards are milled, draw a card, then put a +1/+1 counter on this creature.'],
      ['Benthic Biomancer', 'Whenever one or more +1/+1 counters are put on this creature, draw a card, then discard a card.'],
      ['Temmet, Naktamun\'s Will', 'Whenever you attack, draw a card, then discard a card.'],
      ['Paladin Elizabeth Taggerdy', 'Battalion - Whenever Paladin Elizabeth Taggerdy and at least two other creatures attack, draw a card, then you may put a creature card with mana value X or less from your hand onto the battlefield tapped and attacking, where X is Paladin Elizabeth Taggerdy\'s power.'],
      ['Sidar Jabari of Zhalfir', 'Eminence - Whenever you attack with one or more Knights, if Sidar Jabari is in the command zone or on the battlefield, draw a card, then discard a card.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    for (const [name] of cases) {
      expect(stepsByName.get(name)?.some((step) => step.kind === 'draw'), `${name} should surface draw`).toBe(true);
    }
  });

  it('parses offset-4050 target-opponents draw selector', () => {
    const steps = collectSteps(parseOracleTextToIR(
      'When this enchantment enters, any number of target opponents each draw a card.',
      'Communal Brewing'
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'draw',
        who: { kind: 'any_number_of_target_opponents' },
        amount: { kind: 'number', value: 1 },
      }),
    ]));
  });

  it('surfaces offset-4050 granted and emblem draw metadata', () => {
    const underworldSteps = collectSteps(parseOracleTextToIR(
      'Enchanted land has "{T}, Pay 1 life: Draw a card."',
      'Underworld Connections'
    ).abilities);
    const teferiSteps = collectSteps(parseOracleTextToIR(
      '−7: You get an emblem with "Untap all permanents you control during each opponent\'s untap step" and "You draw a card during each opponent\'s draw step."',
      'Teferi, Who Slows the Sunset'
    ).abilities);

    expect(underworldSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 1 } }),
    ]));
    expect(teferiSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_emblem' }),
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-4050 draw before shield-counter reminder text', () => {
    const steps = collectSteps(parseOracleTextToIR(
      'If you do, draw a card." (If a creature with a shield counter on it would be dealt damage or destroyed, remove a shield counter from it instead.)',
      "Family's Favor"
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-4050 draw replacement actions without parsing non-draw replacements', () => {
    const almsSteps = collectSteps(parseOracleTextToIR(
      'If an opponent would draw two or more cards, instead you and that player each draw a card.',
      'Alms Collector'
    ).abilities);
    const maxSpeedSteps = collectSteps(parseOracleTextToIR(
      'Max speed - If you would draw a card, draw two cards instead.',
      'Vnwxt, Verbose Host'
    ).abilities);
    const jaceSteps = collectSteps(parseOracleTextToIR(
      'If you would draw a card while your library has no cards in it, you win the game instead.',
      'Jace, Wielder of Mysteries'
    ).abilities);

    expect(almsSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', who: { kind: 'you_and_target_player' }, amount: { kind: 'number', value: 1 } }),
    ]));
    expect(maxSpeedSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 2 } }),
    ]));
    expect(jaceSteps.some((step) => step.kind === 'draw')).toBe(false);
  });
});
