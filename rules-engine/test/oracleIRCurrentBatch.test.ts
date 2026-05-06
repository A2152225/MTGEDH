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

  it('surfaces next-category generic attachment, grant, counter, and untap templates', () => {
    const cases = [
      [
        'Retraction Helix',
        'Until end of turn, target creature gains "{T}: Return target nonland permanent to its owner\'s hand."',
      ],
      ['Swiftfoot Boots', 'Equipped creature has hexproof and haste.\nEquip {1}'],
      ['Animate Dead', 'Enchant creature card in a graveyard\nWhen Animate Dead enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with Animate Dead." Return enchanted creature card to the battlefield under your control and attach Animate Dead to it. When Animate Dead leaves the battlefield, that creature\'s controller sacrifices it.\nEnchanted creature gets -1/-0.'],
      ['Blackblade Reforged', 'Equipped creature gets +1/+1 for each land you control.\nEquip legendary creature {3}\nEquip {7}'],
      ['Mental Misstep', 'Counter target spell with mana value 1.'],
      ['Disallow', 'Counter target spell, activated ability, or triggered ability.'],
      ['Snap', 'Return target creature to its owner\'s hand. Untap up to two lands.'],
      ['Brass Squire', '{T}: Attach target Equipment you control to target creature you control.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    expect(stepsByName.get('Retraction Helix')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_temporary_ability', effectText: ['{T}: Return target nonland permanent to its owner\'s hand.'] }),
    ]));
    expect(stepsByName.get('Swiftfoot Boots')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', abilities: ['hexproof', 'haste'] }),
    ]));
    expect(stepsByName.get('Animate Dead')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', power: -1, toughness: 0 }),
    ]));
    expect(stepsByName.get('Blackblade Reforged')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', effectText: ['gets +1/+1 for each land you control'] }),
    ]));
    expect(stepsByName.get('Mental Misstep')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'counter_spell', target: { kind: 'raw', text: 'target spell with mana value 1' } }),
    ]));
    expect(stepsByName.get('Disallow')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'counter_spell', target: { kind: 'raw', text: 'target spell, activated ability, or triggered ability' } }),
    ]));
    expect(stepsByName.get('Snap')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tap_or_untap', mode: 'untap', target: { kind: 'raw', text: 'up to two lands' } }),
    ]));
    expect(stepsByName.get('Brass Squire')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'attach', attachment: { kind: 'raw', text: 'target Equipment you control' }, to: { kind: 'raw', text: 'target creature you control' } }),
    ]));
  });

  it('surfaces next-category static restrictions, gain-then-pump, copy, and conditional mana templates', () => {
    const cases = [
      ['Ghostly Prison', 'Creatures can\'t attack you unless their controller pays {2} for each creature they control that\'s attacking you.'],
      ['Mirari\'s Wake', 'Creatures you control get +1/+1.'],
      ['Kavaron, Memorial World', 'Creatures you control gain haste and get +1/+0 until end of turn.'],
      ['Increasing Vengeance', 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.'],
      ['Exotic Orchard', '{T}: Add one mana of any color that a land an opponent controls could produce.'],
      ['Ardenn, Intrepid Archaeologist', 'At the beginning of combat on your turn, you may attach any number of Auras and Equipment you control to target permanent or player.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    expect(collectUnknowns(parseOracleTextToIR(cases[0][1], cases[0][0]).abilities)).toEqual([]);
    expect(stepsByName.get('Ghostly Prison')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', effectText: expect.arrayContaining([expect.stringMatching(/can't attack you unless/i)]) }),
    ]));
    expect(stepsByName.get('Mirari\'s Wake')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', power: 1, toughness: 1 }),
    ]));
    expect(stepsByName.get('Kavaron, Memorial World')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_temporary_ability', abilities: ['haste'] }),
      expect.objectContaining({ kind: 'modify_pt', power: 1, toughness: 0, duration: 'end_of_turn' }),
    ]));
    expect(stepsByName.get('Increasing Vengeance')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'copy_spell', subject: 'target_spell', allowNewTargets: true }),
    ]));
    expect(stepsByName.get('Exotic Orchard')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_mana', requiresChosenMana: true, manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'] }),
    ]));
    expect(stepsByName.get('Ardenn, Intrepid Archaeologist')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'attach', attachment: { kind: 'raw', text: 'any number of Auras and Equipment you control' }, to: { kind: 'raw', text: 'target permanent or player' } }),
    ]));
  });

  it('surfaces next-category stack, library, combat, and reminder templates', () => {
    const cases = [
      ['Copperhorn Scout', 'Whenever this creature attacks, untap each other creature you control.'],
      ['Double Negative', 'Counter up to two target spells.'],
      ['Evasive Action', 'Domain — Counter target spell unless its controller pays {1} for each basic land type among lands you control.'],
      ['Watery Grave', '({T}: Add {U} or {B}.)'],
      ['Mystic Forge', 'You may look at the top card of your library any time.'],
      ['Mosswort Bridge', '{G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.'],
      ['Ulamog\'s Crusher', 'This creature attacks each combat if able.'],
      ['Trailblazer\'s Boots', '(It can\'t be blocked as long as defending player controls a nonbasic land.)'],
      ['Bloodghast', 'This creature has haste as long as an opponent has 10 or less life.'],
      ['Rings of Brighthearth', 'If you do, copy that ability.'],
      ['Thousand-Year Storm', 'Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you\'ve cast before it this turn.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    expect(stepsByName.get('Copperhorn Scout')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tap_or_untap', mode: 'untap', target: { kind: 'raw', text: 'each other creature you control' } }),
    ]));
    expect(stepsByName.get('Double Negative')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'counter_spell', target: { kind: 'raw', text: 'up to two target spells' } }),
    ]));
    expect(stepsByName.get('Evasive Action')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'counter_spell', target: { kind: 'raw', text: 'target spell' } }),
    ]));
    expect(stepsByName.get('Watery Grave')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_mana', manaOptions: ['{U}', '{B}'] }),
    ]));
    expect(stepsByName.get('Mystic Forge')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'look_top' }),
    ]));
    expect(stepsByName.get('Mosswort Bridge')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_exile_permission', permission: 'play', withoutPayingManaCost: true }),
    ]));
    expect(stepsByName.get('Ulamog\'s Crusher')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', effectText: ['attacks each combat if able'] }),
    ]));
    expect(stepsByName.get('Trailblazer\'s Boots')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', effectText: expect.arrayContaining([expect.stringMatching(/can't be blocked/i)]) }),
    ]));
    expect(stepsByName.get('Bloodghast')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', abilities: ['haste'] }),
    ]));
    expect(stepsByName.get('Rings of Brighthearth')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'copy_spell', target: { kind: 'raw', text: 'that ability' } }),
    ]));
    expect(stepsByName.get('Thousand-Year Storm')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'copy_spell', copies: { kind: 'spells_cast_before_this_turn' } }),
    ]));
  });

  it('surfaces next-category broad mana, pump, and restriction templates', () => {
    const cases = [
      ['Overwhelming Stampede', 'Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.'],
      ['Heraldic Banner', 'Creatures you control of the chosen color get +1/+0.'],
      ['Reflecting Pool', '{T}: Add one mana of any type that a land you control could produce.'],
      ['Mox Amber', '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.'],
      ['Jungle Shrine', '{T}: Add {R}, {G}, or {W}.'],
      ['Bloom Tender', 'For each color among permanents you control, add one mana of that color.'],
      ['Myr Galvanizer', '{1}, {T}: Untap each other Myr you control.'],
      ['Void Winnower', 'Your opponents can\'t block with creatures with even mana values.'],
      ['Pathrazer of Ulamog', 'This creature can\'t be blocked except by three or more creatures.'],
    ] as const;

    const stepsByName = new Map(cases.map(([name, text]) => [name, collectSteps(parseOracleTextToIR(text, name).abilities)]));

    expect(stepsByName.get('Overwhelming Stampede')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_temporary_ability', abilities: ['trample'] }),
      expect.objectContaining({ kind: 'modify_pt', duration: 'end_of_turn' }),
    ]));
    expect(stepsByName.get('Heraldic Banner')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', power: 1, toughness: 0 }),
    ]));
    for (const name of ['Reflecting Pool', 'Mox Amber', 'Bloom Tender']) {
      expect(stepsByName.get(name)).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'add_mana', requiresChosenMana: true }),
      ]));
    }
    expect(stepsByName.get('Jungle Shrine')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_mana', manaOptions: ['{R}', '{G}', '{W}'] }),
    ]));
    expect(stepsByName.get('Myr Galvanizer')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tap_or_untap', mode: 'untap', target: { kind: 'raw', text: 'each other Myr you control' } }),
    ]));
    expect(stepsByName.get('Void Winnower')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', effectText: expect.arrayContaining([expect.stringMatching(/can't block/i)]) }),
    ]));
    expect(stepsByName.get('Pathrazer of Ulamog')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability', effectText: expect.arrayContaining([expect.stringMatching(/can't be blocked/i)]) }),
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

  it('surfaces offset-5050 draw effects before villainous choices and replacement riders', () => {
    const drEggmanSteps = collectSteps(parseOracleTextToIR(
      'Flying\nAt the beginning of your end step, draw a card. Then each opponent faces a villainous choice — That player discards a card, or you may put a Construct, Robot, or Vehicle card from your hand onto the battlefield.',
      'Dr. Eggman'
    ).abilities);
    const stunningSteps = collectSteps(parseOracleTextToIR(
      'The next time you would lose the game this turn, instead draw seven cards and your life total becomes 1.\nExile Stunning Reversal.',
      'Stunning Reversal'
    ).abilities);

    expect(drEggmanSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'choose_mode' }),
    ]));
    expect(drEggmanSteps.find((step) => step.kind === 'choose_mode')?.modes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'That player discards a card' }),
      expect.objectContaining({ label: 'you may put a Construct, Robot, or Vehicle card from your hand onto the battlefield' }),
    ]));
    expect(stunningSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 7 } }),
    ]));
  });

  it('parses offset-5050 any-number target players draw selector', () => {
    const steps = collectSteps(parseOracleTextToIR(
      "Enchant player\nAt the beginning of enchanted player's upkeep, any number of target players other than that player each draw cards equal to the number of Curses attached to that player.",
      'Curse of Surveillance'
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'draw',
        who: { kind: 'any_number_of_target_players' },
        amount: { kind: 'unknown', raw: 'the number of Curses attached to that player' },
      }),
    ]));
  });

  it('keeps offset-5050 draw-trigger and reminder false positives non-draw', () => {
    const cases = [
      ['Uba Mask', 'If a player would draw a card, that player exiles that card face up instead.'],
      ['Tolarian Kraken', 'Whenever you draw a card, you may pay {1}. If you do, you may tap or untap target creature.'],
      ['Darkblast', 'Target creature gets -1/-1 until end of turn.\nDredge 3 (If you would draw a card, you may mill three cards instead.)'],
      ['Lorescale Coatl', 'Whenever you draw a card, put a +1/+1 counter on this creature.'],
      ['First Day of Class', 'Creatures you control get +1/+0 and gain haste until end of turn.\nLearn. (You may reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card.)'],
    ] as const;

    for (const [name, text] of cases) {
      const steps = collectSteps(parseOracleTextToIR(text, name).abilities);
      expect(steps.some((step) => step.kind === 'draw'), `${name} should not surface executable draw`).toBe(false);
    }
  });

  it('surfaces offset-5050 nested granted sacrifice metadata', () => {
    const cases = [
      ['Phantasmal Image', 'You may have this creature enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."'],
      ['Kataki, War\'s Wage', 'All artifacts have "At the beginning of your upkeep, sacrifice this artifact unless you pay {1}."'],
      ['Cultist of the Absolute', 'Commander creatures you own get +3/+3 and have flying, deathtouch, "Ward—Pay 3 life," and "At the beginning of your upkeep, sacrifice a creature."'],
      ['Hellish Rebuke', 'Until end of turn, permanents your opponents control gain "When this permanent deals damage to the player who cast Hellish Rebuke, sacrifice this permanent. You lose 2 life."'],
      ['Dropkick Bomber', 'Other Goblins you control get +1/+1.\n{R}: Until end of turn, another target Goblin you control gains flying and "When this creature deals combat damage, sacrifice it."'],
    ] as const;

    for (const [name, text] of cases) {
      const steps = collectSteps(parseOracleTextToIR(text, name).abilities);
      expect(steps.some((step) => step.kind === 'sacrifice'), `${name} should surface nested sacrifice metadata`).toBe(true);
    }
  });

  it('parses offset-5050 enchanted-controller sacrifice effects', () => {
    const steps = collectSteps(parseOracleTextToIR(
      "Enchant permanent\nVanishing 3 (This Aura enters with three time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)\nWhen this Aura leaves the battlefield, enchanted permanent's controller sacrifices it.",
      'Reality Acid'
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sacrifice', who: { kind: 'target_player' }, what: { kind: 'raw', text: 'it' } }),
    ]));
  });

  it('keeps offset-5050 sacrifice keyword reminders non-sacrifice', () => {
    const cases = [
      ['Cut Your Losses', 'Casualty 2 (As you cast this spell, you may sacrifice a creature with power 2 or greater. When you do, copy this spell and you may choose a new target for the copy.)\nTarget player mills half their library, rounded down.'],
      ['Feasting Hobbit', 'Devour Food 3 (As this creature enters, you may sacrifice any number of Foods. It enters with three times that many +1/+1 counters on it.)'],
      ['Karmic Guide', 'Echo {3}{W}{W} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\nFlying\nWhen this creature enters, return target creature card from your graveyard to the battlefield.'],
    ] as const;

    for (const [name, text] of cases) {
      const steps = collectSteps(parseOracleTextToIR(text, name).abilities);
      expect(steps.some((step) => step.kind === 'sacrifice'), `${name} should not surface reminder-only sacrifice`).toBe(false);
    }
  });

  it('surfaces offset-6050 direct and entry +1/+1 counter placement', () => {
    const courtSteps = collectSteps(parseOracleTextToIR(
      'At the beginning of your upkeep, distribute two +1/+1 counters among up to two target creatures.',
      'Court of Garenbrig'
    ).abilities);
    const bardSteps = collectSteps(parseOracleTextToIR(
      'Legendary creatures you control enter with an additional +1/+1 counter on them.',
      'Bard Class'
    ).abilities);
    const opalSteps = collectSteps(parseOracleTextToIR(
      "If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters on it equal to the number of times it's been cast from the command zone this game.",
      'Opal Palace'
    ).abilities);

    expect(courtSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', amount: { kind: 'number', value: 2 }, counter: '+1/+1' }),
    ]));
    expect(bardSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', amount: { kind: 'number', value: 1 }, target: { kind: 'raw', text: 'Legendary creatures you control' } }),
    ]));
    expect(opalSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', amount: { kind: 'unknown', raw: "a number equal to the number of times it's been cast from the command zone this game" } }),
    ]));
  });

  it('surfaces offset-6050 granted +1/+1 counter metadata', () => {
    const powerFistSteps = collectSteps(parseOracleTextToIR(
      'Equipped creature has trample and "Whenever this creature deals combat damage to a player, put that many +1/+1 counters on it."\nEquip {2}',
      'Power Fist'
    ).abilities);
    const ragingRavineSteps = collectSteps(parseOracleTextToIR(
      '{2}{R}{G}: Until end of turn, this land becomes a 3/3 red and green Elemental creature with "Whenever this creature attacks, put a +1/+1 counter on it." It\'s still a land.',
      'Raging Ravine'
    ).abilities);

    for (const [name, steps] of [['Power Fist', powerFistSteps], ['Raging Ravine', ragingRavineSteps]] as const) {
      expect(steps.some((step) => step.kind === 'add_counter'), `${name} should surface nested counter metadata`).toBe(true);
    }
  });

  it('surfaces offset-6050 delayed sacrifice cleanup on created tokens', () => {
    const steps = collectSteps(parseOracleTextToIR(
      'Whenever a nontoken creature you control enters, you may pay {2}. If you do, create a token that\'s a copy of that creature, except it has haste and "At the beginning of the end step, sacrifice this permanent."',
      'Minion Reflector'
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', atNextEndStep: 'sacrifice' }),
    ]));
  });

  it('keeps offset-6050 counter replacement and choice reminders non-counter-placement', () => {
    const cases = [
      ['Hardened Scales', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.'],
      ['Rhythm of the Wild', "Creature spells you control can't be countered.\nNontoken creatures you control have riot. (They enter with your choice of a +1/+1 counter or haste.)"],
    ] as const;

    for (const [name, text] of cases) {
      const steps = collectSteps(parseOracleTextToIR(text, name).abilities);
      expect(steps.some((step) => step.kind === 'add_counter'), `${name} should not surface executable counter placement`).toBe(false);
    }
  });

  it('surfaces offset-7050 dynamic counter riders on returned permanents and created tokens', () => {
    const graveEndeavorSteps = collectSteps(parseOracleTextToIR(
      'Return a creature card from your graveyard to the battlefield with a number of +1/+1 counters on it equal to that result.',
      'Grave Endeavor'
    ).abilities);
    const oversimplifySteps = collectSteps(parseOracleTextToIR(
      'Each player creates a 0/0 green and blue Fractal creature token and puts a number of +1/+1 counters on it equal to the total power of creatures they controlled that were exiled this way.',
      'Oversimplify'
    ).abilities);

    expect(graveEndeavorSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'move_zone', to: 'battlefield' }),
      expect.objectContaining({
        kind: 'add_counter',
        counter: '+1/+1',
        amount: { kind: 'unknown', raw: 'a number equal to that result' },
        target: { kind: 'raw', text: 'that creature' },
      }),
    ]));
    expect(graveEndeavorSteps.find((step) => step.kind === 'move_zone')?.withCounters).toBeUndefined();
    expect(oversimplifySteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', who: { kind: 'each_player' } }),
      expect.objectContaining({
        kind: 'add_counter',
        counter: '+1/+1',
        amount: { kind: 'unknown', raw: 'a number equal to the total power of creatures they controlled that were exiled this way' },
        target: { kind: 'raw', text: 'those tokens' },
      }),
    ]));
  });

  it('surfaces offset-7050 prevent-damage remove-counter clauses and entry counter fragments', () => {
    const undergrowthSteps = collectSteps(parseOracleTextToIR(
      'If damage would be dealt to this creature while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from this creature.',
      'Undergrowth Champion'
    ).abilities);
    const fireplaceSteps = collectSteps(parseOracleTextToIR(
      'This artifact enters tapped with a time counter on it.',
      'Rotating Fireplace'
    ).abilities);
    const questSteps = collectSteps(parseOracleTextToIR(
      "If it's a creature card, you may reveal it and put a quest counter on this enchantment.",
      "Quest for Ula's Temple"
    ).abilities);

    expect(undergrowthSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'prevent_damage', amount: 'all' }),
      expect.objectContaining({ kind: 'remove_counter', counter: '+1/+1', amount: { kind: 'number', value: 1 } }),
    ]));
    expect(fireplaceSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: 'time', amount: { kind: 'number', value: 1 } }),
    ]));
    expect(questSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: 'quest', target: { kind: 'raw', text: 'this enchantment' } }),
    ]));
  });

  it('keeps offset-7050 keyword and replacement counter reminders non-counter-placement', () => {
    const cases = [
      ['Stratus Dancer', 'Turn it face up any time for its megamorph cost and put a +1/+1 counter on it.)'],
      ['Arcbound Worker', 'Modular 1 (This creature enters with a +1/+1 counter on it.'],
      ['Bloodlord of Vaasgoth', 'Bloodthirst 3 (If an opponent was dealt damage this turn, this creature enters with three +1/+1 counters on it.)'],
      ['Fleecemane Lion', "(If this creature isn't monstrous, put a +1/+1 counter on it and it becomes monstrous.)"],
      ['Mowu, Loyal Companion', 'If one or more +1/+1 counters would be put on Mowu, that many plus one +1/+1 counters are put on it instead.'],
    ] as const;

    for (const [name, text] of cases) {
      const steps = collectSteps(parseOracleTextToIR(text, name).abilities);
      expect(steps.some((step) => step.kind === 'add_counter'), `${name} should not surface executable counter placement`).toBe(false);
    }
  });

  it('surfaces offset-7150 same-kind, pronoun entry, and delayed counter metadata', () => {
    const denrySteps = collectSteps(parseOracleTextToIR(
      'Whenever a nontoken creature you control enters, if Denry Klin has counters on it, put the same number of each kind of counter on that creature.',
      'Denry Klin, Editor in Chief'
    ).abilities);
    const scarletSteps = collectSteps(parseOracleTextToIR(
      'Sensational Save — If Scarlet Spider was cast using web-slinging, he enters with X +1/+1 counters on him, where X is the mana value of the returned creature.',
      'Scarlet Spider, Ben Reilly'
    ).abilities);
    const foeRazerSteps = collectSteps(parseOracleTextToIR(
      'Whenever a creature you control fights, put two +1/+1 counters on it at the beginning of the next end step.',
      'Foe-Razer Regent'
    ).abilities);

    expect(denrySteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'add_counter',
        amount: { kind: 'unknown', raw: 'the same number' },
        counter: 'each kind',
        target: { kind: 'raw', text: 'that creature' },
      }),
    ]));
    expect(scarletSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'add_counter',
        amount: { kind: 'x' },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'this permanent' },
      }),
    ]));
    expect(foeRazerSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule_delayed_trigger', timing: 'next_end_step' }),
      expect.objectContaining({ kind: 'add_counter', counter: '+1/+1', amount: { kind: 'number', value: 2 } }),
    ]));
  });

  it('surfaces offset-7250 choice tails, counter moves, and exile replacement counter riders', () => {
    const liegeSteps = collectSteps(parseOracleTextToIR(
      'Whenever this creature deals combat damage to a player, you may choose any number of target lands you control and put an awakening counter on each of them.',
      'Liege of the Tangle'
    ).abilities);
    const bioshiftSteps = collectSteps(parseOracleTextToIR(
      'Move any number of +1/+1 counters from target creature onto another target creature with the same controller.',
      'Bioshift'
    ).abilities);
    const ravenousSteps = collectSteps(parseOracleTextToIR(
      "If a creature an opponent controls would die, instead exile it and put a number of +1/+1 counters equal to that creature's power on this creature.",
      'Ravenous Slime'
    ).abilities);

    expect(liegeSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: 'awakening', target: { kind: 'raw', text: 'each of them' } }),
    ]));
    expect(bioshiftSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'move_counters',
        counter: '+1/+1',
        amount: { kind: 'any_number' },
        from: { kind: 'raw', text: 'target creature' },
        to: { kind: 'raw', text: 'another target creature with the same controller' },
      }),
    ]));
    expect(ravenousSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'exile', target: { kind: 'raw', text: 'it' } }),
      expect.objectContaining({
        kind: 'add_counter',
        counter: '+1/+1',
        amount: { kind: 'unknown', raw: "equal to that creature's power" },
        target: { kind: 'raw', text: 'this creature' },
      }),
    ]));
  });

  it('surfaces offset-7350 choice keyword counters and counter-plus-draw conditionals', () => {
    const owenSteps = collectSteps(parseOracleTextToIR(
      '{T}: Put your choice of a menace, trample, reach, or haste counter on target Dinosaur.',
      'Owen Grady, Raptor Trainer'
    ).abilities);
    const bountySteps = collectSteps(parseOracleTextToIR(
      'If no counters were removed this way, put a flood counter on this enchantment and draw a card.',
      'Bounty of the Luxa'
    ).abilities);

    expect(owenSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: 'choice: a menace, trample, reach, or haste',
        target: { kind: 'raw', text: 'target Dinosaur' },
      }),
    ]));
    expect(bountySteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: 'flood', target: { kind: 'raw', text: 'this enchantment' } }),
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-7450 singular counter moves and kicked entry counters', () => {
    const fiendSteps = collectSteps(parseOracleTextToIR(
      'At the beginning of your upkeep, you may move a +1/+1 counter from target creature onto this creature.',
      'Arcbound Fiend'
    ).abilities);
    const kangeeSteps = collectSteps(parseOracleTextToIR(
      'Kicker {X}{2} (You may pay an additional {X}{2} as you cast this spell.) Flying When Kangee enters, if it was kicked, put X feather counters on it. Other Bird creatures get +1/+1 for each feather counter on Kangee.',
      'Kangee, Aerie Keeper'
    ).abilities);

    expect(fiendSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'move_counters',
        amount: { kind: 'number', value: 1 },
        counter: '+1/+1',
        from: { kind: 'raw', text: 'target creature' },
        to: { kind: 'raw', text: 'this creature' },
      }),
    ]));
    expect(kangeeSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'add_counter',
        amount: { kind: 'x' },
        counter: 'feather',
        target: { kind: 'raw', text: 'it' },
      }),
    ]));
  });

  it('surfaces offset-7550 token counter metadata and compound counter followups', () => {
    const ashiokSteps = collectSteps(parseOracleTextToIR(
      'Create two 1/1 black Nightmare creature tokens with "At the beginning of combat on your turn, if a card was put into exile this turn, put a +1/+1 counter on this token."',
      'Ashiok, Wicked Manipulator'
    ).abilities);
    const mindSpiralSteps = collectSteps(parseOracleTextToIR(
      'If the gift was promised, tap target creature an opponent controls and put a stun counter on it.',
      'Mind Spiral'
    ).abilities);
    const heroesSteps = collectSteps(parseOracleTextToIR(
      'Whenever one or more Mutants, Ninjas, and/or Turtles you control deal combat damage to a player, put a +1/+1 counter on each of those creatures and draw a card.',
      'Heroes in a Half Shell'
    ).abilities);
    const sphereSteps = collectSteps(parseOracleTextToIR(
      'This artifact enters tapped and with three charge counters on it.',
      'Sphere of the Suns'
    ).abilities);

    expect(ashiokSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', token: '1/1 black Nightmare' }),
      expect.objectContaining({ kind: 'add_counter', counter: '+1/+1', target: { kind: 'raw', text: 'this token' } }),
    ]));
    expect(mindSpiralSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tap_or_untap', target: { kind: 'raw', text: 'target creature an opponent controls' } }),
      expect.objectContaining({ kind: 'add_counter', counter: 'stun', target: { kind: 'raw', text: 'it' } }),
    ]));
    expect(heroesSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: '+1/+1', target: { kind: 'raw', text: 'each of those creatures' } }),
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 1 } }),
    ]));
    expect(sphereSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: 'charge', amount: { kind: 'number', value: 3 } }),
    ]));
  });

  it('surfaces offset-7650 final counter-window deterministic placements', () => {
    const dukeSteps = collectSteps(parseOracleTextToIR(
      'The Duke enters with a +1/+1 counter on him.',
      'The Duke, Rebel Sentry'
    ).abilities);
    const regnaSteps = collectSteps(parseOracleTextToIR(
      'Each friend puts a +1/+1 counter on each creature they control.',
      "Regna's Sanction"
    ).abilities);
    const meSteps = collectSteps(parseOracleTextToIR(
      'At the beginning of combat on your turn, put your choice of a +1/+1, first strike, vigilance, or menace counter on Me.',
      'Me, the Immortal'
    ).abilities);
    const zygonSteps = collectSteps(parseOracleTextToIR(
      'Body-print — {2}{U}: Tap another target creature and put a stun counter on it.',
      'Zygon Infiltrator'
    ).abilities);

    expect(dukeSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: '+1/+1', target: { kind: 'raw', text: 'this permanent' } }),
    ]));
    expect(regnaSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: '+1/+1', target: { kind: 'raw', text: 'each creature they control' } }),
    ]));
    expect(meSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: 'choice: a +1/+1, first strike, vigilance, or menace' }),
    ]));
    expect(zygonSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tap_or_untap', target: { kind: 'raw', text: 'another target creature' } }),
      expect.objectContaining({ kind: 'add_counter', counter: 'stun', target: { kind: 'raw', text: 'it' } }),
    ]));
  });

  it('surfaces offset-7750 life swings split from draw and move-zone clauses', () => {
    const approachSteps = collectSteps(parseOracleTextToIR(
      "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.",
      'Approach of the Second Sun'
    ).abilities);
    const rankleSteps = collectSteps(parseOracleTextToIR(
      'Flying, haste\nWhenever Rankle, Master of Pranks deals combat damage to a player, choose any number -\n• Each player discards a card.\n• Each player loses 1 life and draws a card.\n• Each player sacrifices a creature token.',
      'Rankle, Master of Pranks'
    ).abilities);

    expect(approachSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'move_zone', to: 'library' }),
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 7 } }),
    ]));
    expect(rankleSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'each_player' }, amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'draw', who: { kind: 'each_player' }, amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-7750 optional target-opponent life loss without parsing lifelink reminders', () => {
    const discipleSteps = collectSteps(parseOracleTextToIR(
      'Whenever an artifact is put into a graveyard from the battlefield, you may have target opponent lose 1 life.',
      'Disciple of the Vault'
    ).abilities);
    const basiliskSteps = collectSteps(parseOracleTextToIR(
      'Equipped creature has deathtouch and lifelink. (Damage dealt by this creature also causes you to gain that much life.)',
      'Basilisk Collar'
    ).abilities);

    expect(discipleSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'lose_life',
        who: { kind: 'target_opponent' },
        amount: { kind: 'number', value: 1 },
        optional: true,
      }),
    ]));
    expect(basiliskSteps.some((step) => step.kind === 'gain_life')).toBe(false);
  });

  it('surfaces offset-7850 compound damage, shared gain, and mill-life effects', () => {
    const swordSteps = collectSteps(parseOracleTextToIR(
      'Equipped creature gets +2/+2 and has protection from red and from white. Whenever equipped creature deals combat damage to a player, this Equipment deals damage to that player equal to the number of cards in their hand and you gain 1 life for each card in your hand.',
      'Sword of War and Peace'
    ).abilities);
    const angelSteps = collectSteps(parseOracleTextToIR(
      'Flying, double strike\nWhenever a creature you control deals combat damage to a player, you and that player each gain that much life.',
      'Angel of Destiny'
    ).abilities);
    const tinybonesSteps = collectSteps(parseOracleTextToIR(
      'Whenever a legendary creature you control enters, any number of target players each mill a card and lose 1 life.',
      'Tinybones Joins Up'
    ).abilities);

    expect(swordSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'deal_damage', target: { kind: 'raw', text: 'that player' } }),
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'reference_amount', raw: '1 for each card in your hand' } }),
    ]));
    expect(angelSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you_and_target_player' }, amount: { kind: 'reference_amount', raw: 'that much' } }),
    ]));
    expect(tinybonesSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'mill', who: { kind: 'any_number_of_target_players' }, amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'any_number_of_target_players' }, amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-7950 conditional and qualified-opponent life effects', () => {
    const altarSteps = collectSteps(parseOracleTextToIR(
      '{T}: Add one mana of any color. If you control a God, a Demigod, or a legendary enchantment, you gain 1 life.',
      'Altar of the Pantheon'
    ).abilities);
    const atlasSteps = collectSteps(parseOracleTextToIR(
      'Corrupted — Whenever this artifact becomes tapped, each opponent who has three or more poison counters loses 1 life.',
      'Phyrexian Atlas'
    ).abilities);

    expect(altarSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you control a God, a Demigod, or a legendary enchantment' },
      }),
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
    ]));
    expect(atlasSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'each opponent who has three or more poison counters' },
      }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'each_opponent' }, amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-8050 granted and compound life-loss effects', () => {
    const clawingSteps = collectSteps(parseOracleTextToIR(
      'Enchant artifact or creature\nAs long as enchanted permanent is a creature, it gets -1/-1 and can\'t block.\nEnchanted permanent has "At the beginning of your upkeep, you lose 1 life."',
      'Clawing Torment'
    ).abilities);
    const experimentSteps = collectSteps(parseOracleTextToIR(
      'Target player mills two cards, draws two cards, and loses 2 life.',
      'Atrocious Experiment'
    ).abilities);
    const malboroSteps = collectSteps(parseOracleTextToIR(
      'Bad Breath — When this creature enters, each opponent discards a card, loses 2 life, and exiles the top three cards of their library.',
      'Malboro'
    ).abilities);

    expect(clawingSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
    ]));
    expect(experimentSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'mill', who: { kind: 'target_player' }, amount: { kind: 'number', value: 2 } }),
      expect.objectContaining({ kind: 'draw', who: { kind: 'target_player' }, amount: { kind: 'number', value: 2 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'target_player' }, amount: { kind: 'number', value: 2 } }),
    ]));
    expect(malboroSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'discard', who: { kind: 'each_opponent' }, amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'each_opponent' }, amount: { kind: 'number', value: 2 } }),
    ]));
  });

  it('surfaces offset-8150 draw-life and repeated lose-gain effects', () => {
    const confluenceSteps = collectSteps(parseOracleTextToIR(
      'Choose three. You may choose the same mode more than once.\n• Target player draws a card and loses 1 life.',
      'Wretched Confluence'
    ).abilities);
    const sufferSteps = collectSteps(parseOracleTextToIR(
      'Exile X target cards from target player\'s graveyard. For each card exiled this way, that player loses 1 life and you gain 1 life.',
      'Suffer the Past'
    ).abilities);
    const azorSteps = collectSteps(parseOracleTextToIR(
      'Whenever Azor attacks, you may pay {X}{W}{U}{U}. If you do, you gain X life and draw X cards.',
      'Azor, the Lawbringer'
    ).abilities);
    const rewardSteps = collectSteps(parseOracleTextToIR(
      'Each player may bid life. The high bidder loses life equal to the high bid and draws four cards.',
      "Pain's Reward"
    ).abilities);

    expect(confluenceSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', who: { kind: 'target_player' }, amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'target_player' }, amount: { kind: 'number', value: 1 } }),
    ]));
    expect(sufferSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'target_player' }, amount: { kind: 'unknown', raw: '1 for each card exiled this way' } }),
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'unknown', raw: '1 for each card exiled this way' } }),
    ]));
    expect(azorSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'x' } }),
      expect.objectContaining({ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'x' } }),
    ]));
    expect(rewardSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lose_life', amount: { kind: 'unknown', raw: 'the high bid' } }),
      expect.objectContaining({ kind: 'draw', amount: { kind: 'number', value: 4 } }),
    ]));
  });

  it('surfaces offset-8250 life pairs, token life metadata, and conditional draw-loss', () => {
    const hauntSteps = collectSteps(parseOracleTextToIR(
      'Then the chosen player loses X life and you gain X life, where X is the number of artifacts you control.',
      'Haunt the Network'
    ).abilities);
    const breachSteps = collectSteps(parseOracleTextToIR(
      'Destroy target artifact or enchantment. If its mana value is 2 or less, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."',
      'Containment Breach'
    ).abilities);
    const sleeperSteps = collectSteps(parseOracleTextToIR(
      '{1}{B}{B}: If this creature is a Phyrexian, put a +1/+1 counter on it, then you draw a card and you lose 1 life.',
      'Evolved Sleeper'
    ).abilities);

    expect(hauntSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lose_life', amount: { kind: 'x' }, sequence: 'then' }),
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'x' }, sequence: 'then' }),
    ]));
    expect(breachSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create_token', token: '1/1 black and green Pest' }),
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
    ]));
    expect(sleeperSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'add_counter', counter: '+1/+1' }),
      expect.objectContaining({ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-8350 compound discard, sacrifice, and delayed life effects', () => {
    const clutchesSteps = collectSteps(parseOracleTextToIR(
      'Target opponent discards two cards, mills two cards, and loses 2 life.',
      "Demogorgon's Clutches"
    ).abilities);
    const falseCureSteps = collectSteps(parseOracleTextToIR(
      'Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life they gained.',
      'False Cure'
    ).abilities);
    const broodSteps = collectSteps(parseOracleTextToIR(
      'When this creature is put into your graveyard from the battlefield, at the beginning of the next end step, you lose 1 life and return this card to your hand.',
      'Brood of Cockroaches'
    ).abilities);
    const verdictSteps = collectSteps(parseOracleTextToIR(
      'Target player sacrifices a creature of their choice and loses 1 life.',
      "Geth's Verdict"
    ).abilities);
    const scarringSteps = collectSteps(parseOracleTextToIR(
      'Target opponent sacrifices a creature of their choice, discards a card, and loses 3 life.',
      'Scarring Memories'
    ).abilities);

    expect(clutchesSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'discard', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: 2 } }),
      expect.objectContaining({ kind: 'mill', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: 2 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: 2 } }),
    ]));
    expect(falseCureSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'target_player' }, amount: { kind: 'unknown', raw: '2 for each 1 life they gained' }, duration: 'end_of_turn' }),
    ]));
    expect(broodSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule_delayed_trigger', timing: 'next_end_step' }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'move_zone', to: 'hand' }),
    ]));
    expect(verdictSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sacrifice', who: { kind: 'target_player' }, what: { kind: 'raw', text: 'a creature of their choice' } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'target_player' }, amount: { kind: 'number', value: 1 } }),
    ]));
    expect(scarringSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sacrifice', who: { kind: 'target_opponent' }, what: { kind: 'raw', text: 'a creature of their choice' } }),
      expect.objectContaining({ kind: 'discard', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: 1 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: 3 } }),
    ]));
  });

  it('surfaces offset-8450 for-each, replacement, and result-table life gain', () => {
    const grimnarchSteps = collectSteps(parseOracleTextToIR(
      'For each opponent who can\'t, you gain 4 life.',
      'Cruel Grimnarch'
    ).abilities);
    const wordsSteps = collectSteps(parseOracleTextToIR(
      '{1}: The next time you would draw a card this turn, you gain 5 life instead.',
      'Words of Worship'
    ).abilities);
    const spoilsSteps = collectSteps(parseOracleTextToIR(
      "For each artifact or creature card in target opponent's graveyard, add {C} and you gain 1 life.",
      'Spoils of Evil'
    ).abilities);
    const shepherdSteps = collectSteps(parseOracleTextToIR(
      '1—9 | You gain 1 life.',
      'Sylvan Shepherd'
    ).abilities);

    expect(grimnarchSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'unknown', raw: "4 for each opponent who can't" } }),
    ]));
    expect(wordsSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 5 }, replacementOf: 'draw_card', duration: 'end_of_turn' }),
    ]));
    expect(spoilsSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'unknown', raw: "1 for each artifact or creature card in target opponent's graveyard" } }),
    ]));
    expect(shepherdSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
    ]));
  });

  it('surfaces offset-8550 comma-separated draw and life loss', () => {
    const steps = collectSteps(parseOracleTextToIR(
      'You draw two cards, lose 2 life, and get {E}{E} (two energy counters).',
      'Live Fast'
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 2 } }),
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'you' }, amount: { kind: 'number', value: 2 } }),
    ]));
  });

  it('surfaces offset-8650 trailing trigger, each-other-player, and quoted gain life', () => {
    const faithfulSteps = collectSteps(parseOracleTextToIR(
      'Whenever you cast a blue, black, or red spell, you gain 1 life.',
      "God-Pharaoh's Faithful"
    ).abilities);
    const syphonMageSteps = collectSteps(parseOracleTextToIR(
      '{2}{B}, {T}, Discard a card: Each other player loses 2 life.',
      'Urborg Syphon-Mage'
    ).abilities);
    const katanaSteps = collectSteps(parseOracleTextToIR(
      'Equipped creature gets +1/+1 and has "Whenever this creature deals combat damage, untap it and you gain 2 life."',
      'Quintessential Katana'
    ).abilities);

    expect(faithfulSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 1 } }),
    ]));
    expect(syphonMageSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lose_life', who: { kind: 'each_opponent' }, amount: { kind: 'number', value: 2 } }),
    ]));
    expect(katanaSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 2 } }),
    ]));
  });

  it('surfaces offset-8750 prefixed and quoted destroy effects', () => {
    const windgraceSteps = collectSteps(parseOracleTextToIR(
      'For any number of opponents, destroy target nonland permanent that player controls.',
      "Windgrace's Judgment"
    ).abilities);
    const harmonicSteps = collectSteps(parseOracleTextToIR(
      'All Slivers have "When this permanent enters, destroy target artifact or enchantment."',
      'Harmonic Sliver'
    ).abilities);
    const dreadmawSteps = collectSteps(parseOracleTextToIR(
      'Until end of turn, target attacking creature gets +2/+2 and gains trample and "Whenever this creature deals combat damage to a player, destroy target artifact that player controls."',
      "Dreadmaw's Ire"
    ).abilities);

    expect(windgraceSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target nonland permanent that player controls' } }),
    ]));
    expect(harmonicSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target artifact or enchantment' } }),
    ]));
    expect(dreadmawSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target artifact that player controls' } }),
    ]));
  });

  it('surfaces offset-8850 prefixed, activated, and compound destroy effects', () => {
    const cloudSteps = collectSteps(parseOracleTextToIR(
      '• Cross-Slash — {0} — Destroy target tapped creature.',
      "Cloud's Limit Break"
    ).abilities);
    const evilTwinSteps = collectSteps(parseOracleTextToIR(
      'You may have this creature enter as a copy of any creature on the battlefield, except it has "{U}{B}, {T}: Destroy target creature with the same name as this creature."',
      'Evil Twin'
    ).abilities);
    const motherlodeSteps = collectSteps(parseOracleTextToIR(
      "When you do, destroy target nonbasic land defending player controls, and creatures that player controls without flying can't block this turn.",
      'The Motherlode, Excavator'
    ).abilities);
    const combustionSteps = collectSteps(parseOracleTextToIR(
      'Whenever Combustion Man attacks, destroy target permanent unless its controller has Combustion Man deal damage to them equal to his power.',
      'Combustion Man'
    ).abilities);

    expect(cloudSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target tapped creature' } }),
    ]));
    expect(evilTwinSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_static_ability' }),
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target creature with the same name as this creature' } }),
    ]));
    expect(motherlodeSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target nonbasic land defending player controls' } }),
      expect.objectContaining({ kind: 'cant_block', target: { kind: 'raw', text: 'creatures that player controls without flying' } }),
    ]));
    expect(combustionSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target permanent' } }),
      expect.objectContaining({ kind: 'deal_damage', source: { kind: 'raw', text: 'this permanent' } }),
    ]));
  });

  it('surfaces offset-9050 timed and cost-prefixed destroy effects', () => {
    const heatStrokeSteps = collectSteps(parseOracleTextToIR(
      'At end of combat, destroy each creature that blocked or was blocked this turn.',
      'Heat Stroke'
    ).abilities);
    const accidentSteps = collectSteps(parseOracleTextToIR(
      '+ {2}{B} — Destroy target creature.',
      'Unfortunate Accident'
    ).abilities);

    expect(heatStrokeSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'each creature that blocked or was blocked this turn' }, timing: 'end_of_combat' }),
    ]));
    expect(accidentSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target creature' } }),
    ]));
  });

  it('surfaces offset-9150 destroy before no-combat-damage riders', () => {
    const steps = collectSteps(parseOracleTextToIR(
      'If you do, destroy target artifact defending player controls and this creature assigns no combat damage this turn.',
      'Goblin Vandal'
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you do' },
      }),
      expect.objectContaining({ kind: 'destroy', target: { kind: 'raw', text: 'target artifact defending player controls' } }),
      expect.objectContaining({ kind: 'assign_no_combat_damage', target: { kind: 'raw', text: 'this creature' } }),
    ]));
  });

  it('surfaces offset-9550 broad acorn destroy targets without splitting MTGO names', () => {
    const steps = collectSteps(parseOracleTextToIR(
      "Destroy target artifact, enchantment, token, emblem, day/night tracker, monarch, initiative, dungeon, city's blessing, Attraction, Contraption, plane, scheme, vanguard, bounty, conspiracy, elite creature, or Magic: The Gathering Online avatar.",
      'Clear, Fair Magic'
    ).abilities);

    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'destroy',
        target: {
          kind: 'raw',
          text: "target artifact, enchantment, token, emblem, day/night tracker, monarch, initiative, dungeon, city's blessing, Attraction, Contraption, plane, scheme, vanguard, bounty, conspiracy, elite creature, or Magic The Gathering Online avatar",
        },
      }),
    ]));
  });

  it('surfaces offset-9580 library-search variants', () => {
    const pathSteps = collectSteps(parseOracleTextToIR(
      'Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      'Path to Exile'
    ).abilities);
    const cultivateSteps = collectSteps(parseOracleTextToIR(
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      'Cultivate'
    ).abilities);
    const thadaSteps = collectSteps(parseOracleTextToIR(
      "Whenever Thada Adel deals combat damage to a player, search that player's library for an artifact card and exile it.",
      'Thada Adel, Acquisitor'
    ).abilities);
    const doomsdaySteps = collectSteps(parseOracleTextToIR(
      'Search your library and graveyard for five cards and exile the rest.',
      'Doomsday'
    ).abilities);

    expect(pathSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'search_library',
        who: { kind: 'target_player' },
        criteria: { kind: 'raw', text: 'basic land' },
        destination: 'battlefield',
        entersTapped: true,
        optional: true,
      }),
    ]));
    expect(cultivateSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'search_library',
        criteria: { kind: 'raw', text: 'basic land' },
        destination: 'battlefield',
        revealFound: true,
        entersTapped: true,
        maxResults: 2,
      }),
    ]));
    expect(thadaSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'search_library',
        who: { kind: 'target_player' },
        criteria: { kind: 'raw', text: 'artifact' },
        destination: 'exile',
      }),
    ]));
    expect(doomsdaySteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'search_library',
        criteria: { kind: 'raw', text: '' },
        destination: 'exile',
        maxResults: 5,
      }),
    ]));
  });

  it('surfaces remaining library-search prevention and search-followup shuffle rows', () => {
    const ashiokSteps = collectSteps(parseOracleTextToIR(
      "Spells and abilities your opponents control can't cause their controller to search their library.",
      'Ashiok, Dream Render'
    ).abilities);
    const auditoreSteps = collectSteps(parseOracleTextToIR(
      'If they search their library this way, they shuffle.',
      'Auditore Ambush'
    ).abilities);
    const arachnusSteps = collectSteps(parseOracleTextToIR(
      'If you search your library this way, shuffle.',
      'Arachnus Spinner'
    ).abilities);
    const sayItsNameSteps = collectSteps(parseOracleTextToIR(
      'If you search your library this way, shuffle.',
      'Say Its Name'
    ).abilities);

    expect(ashiokSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'prevent_library_search',
        who: { kind: 'each_opponent' },
        source: { kind: 'raw', text: 'spells and abilities your opponents control' },
        duration: 'static',
      }),
    ]));
    expect(auditoreSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'they search their library this way' },
      }),
      expect.objectContaining({ kind: 'shuffle_library', who: { kind: 'target_player' } }),
    ]));
    for (const steps of [arachnusSteps, sayItsNameSteps]) {
      expect(steps).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'you search your library this way' },
        }),
        expect.objectContaining({ kind: 'shuffle_library', who: { kind: 'you' } }),
      ]));
    }
  });
});
