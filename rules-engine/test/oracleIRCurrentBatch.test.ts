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
});
