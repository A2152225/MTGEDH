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
});