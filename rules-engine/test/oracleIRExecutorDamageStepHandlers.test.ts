import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { applyDealDamageStep } from '../src/oracleIRExecutorDamageStepHandlers';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function makeState(overrides: Partial<GameState> & Record<string, unknown> = {}): GameState {
  return {
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} } as any,
      { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} } as any,
    ],
    battlefield: [],
    stack: [],
    ...overrides,
  } as any;
}

function player(id: string, seat: number) {
  return { id, name: id.toUpperCase(), seat, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} } as any;
}

function land(id: string, controller: string, typeLine: string) {
  return {
    id,
    controller,
    owner: controller,
    type_line: typeLine,
    card: { id: `${id}-card`, name: id, type_line: typeLine },
  };
}

function findDealDamage(oracleText: string, cardName: string) {
  const ir = parseOracleTextToIR(oracleText, cardName);
  return ir.abilities.flatMap((ability) => ability.steps).find((entry) => entry.kind === 'deal_damage');
}

describe('oracleIRExecutorDamageStepHandlers', () => {
  it('applies lifelink when a source deals damage to a player', () => {
    const state = makeState({
      battlefield: [
        {
          id: 'lifelink-source',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'lifelink-source-card',
            name: 'Vampire Nighthawk',
            type_line: 'Creature - Vampire Shaman',
            oracle_text: 'Flying, deathtouch, lifelink',
          },
        } as any,
      ],
    });

    const result = applyDealDamageStep(
      state,
      {
        kind: 'deal_damage',
        amount: { kind: 'number', value: 3 },
        target: { kind: 'raw', text: 'that player' },
        raw: 'This creature deals 3 damage to that player.',
      } as any,
      {
        controllerId: 'p1',
        sourceId: 'lifelink-source',
        sourceName: 'Vampire Nighthawk',
        selectorContext: { targetPlayerId: 'p2' },
      } as any
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    const p1 = result.state.players.find((player: any) => player.id === 'p1') as any;
    const p2 = result.state.players.find((player: any) => player.id === 'p2') as any;

    expect(p1.life).toBe(43);
    expect(p2.life).toBe(37);
  });

  it('applies infect to players as poison counters instead of life loss', () => {
    const state = makeState({
      battlefield: [
        {
          id: 'infect-source',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'infect-source-card',
            name: 'Plague Stinger',
            type_line: 'Creature - Insect Horror',
            oracle_text: 'Flying, infect',
          },
        } as any,
      ],
    });

    const result = applyDealDamageStep(
      state,
      {
        kind: 'deal_damage',
        amount: { kind: 'number', value: 2 },
        target: { kind: 'raw', text: 'that player' },
        raw: 'This creature deals 2 damage to that player.',
      } as any,
      {
        controllerId: 'p1',
        sourceId: 'infect-source',
        sourceName: 'Plague Stinger',
        selectorContext: { targetPlayerId: 'p2' },
      } as any
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    const p2 = result.state.players.find((player: any) => player.id === 'p2') as any;

    expect(p2.life).toBe(40);
    expect(p2.poisonCounters).toBe(2);
    expect(p2.counters?.poison).toBe(2);
    expect((result.state as any).poisonCounters?.p2).toBe(2);
  });

  it('applies wither to creatures as -1/-1 counters and keeps damage provenance', () => {
    const state = makeState({
      battlefield: [
        {
          id: 'wither-source',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'wither-source-card',
            name: 'Sickle Ripper',
            type_line: 'Creature - Elemental Warrior',
            oracle_text: 'Wither',
          },
        } as any,
        {
          id: 'target-creature',
          controller: 'p2',
          owner: 'p2',
          counters: {},
          card: {
            id: 'target-creature-card',
            name: 'Grizzly Bears',
            type_line: 'Creature - Bear',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
    });

    const result = applyDealDamageStep(
      state,
      {
        kind: 'deal_damage',
        amount: { kind: 'number', value: 2 },
        target: { kind: 'raw', text: 'that creature' },
        raw: 'This creature deals 2 damage to that creature.',
      } as any,
      {
        controllerId: 'p1',
        sourceId: 'wither-source',
        sourceName: 'Sickle Ripper',
        targetCreatureId: 'target-creature',
      } as any
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    const target = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'target-creature') as any;

    expect(target.counters?.['-1/-1']).toBe(2);
    expect(target.counters?.damage || 0).toBe(0);
    expect(target.damageSourceIds).toContain('wither-source');
  });

  it('applies lifelink when a source deals damage to a creature', () => {
    const state = makeState({
      battlefield: [
        {
          id: 'lifelink-source',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'lifelink-source-card',
            name: 'Knight of Meadowgrain',
            type_line: 'Creature - Kithkin Knight',
            oracle_text: 'First strike, lifelink',
          },
        } as any,
        {
          id: 'target-creature',
          controller: 'p2',
          owner: 'p2',
          counters: {},
          card: {
            id: 'target-creature-card',
            name: 'Runeclaw Bear',
            type_line: 'Creature - Bear',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
    });

    const result = applyDealDamageStep(
      state,
      {
        kind: 'deal_damage',
        amount: { kind: 'number', value: 2 },
        target: { kind: 'raw', text: 'that creature' },
        raw: 'This creature deals 2 damage to that creature.',
      } as any,
      {
        controllerId: 'p1',
        sourceId: 'lifelink-source',
        sourceName: 'Knight of Meadowgrain',
        targetCreatureId: 'target-creature',
      } as any
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    const p1 = result.state.players.find((player: any) => player.id === 'p1') as any;
    const target = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'target-creature') as any;

    expect(p1.life).toBe(42);
    expect(target.counters?.damage).toBe(2);
  });

  it('deals Treacherous Terrain damage to each opponent equal to that player\'s lands', () => {
    const oracleText =
      'Treacherous Terrain deals damage to each opponent equal to the number of lands that player controls.\n'
      + 'Basic landcycling {2} ({2}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)';
    const ir = parseOracleTextToIR(oracleText, 'Treacherous Terrain');
    const step = ir.abilities.flatMap((ability) => ability.steps).find((entry) => entry.kind === 'deal_damage');
    expect(step).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'the number of lands that player controls' },
      target: { kind: 'raw', text: 'each opponent' },
    });

    const land = (id: string, controller: string) => ({
      id,
      controller,
      owner: controller,
      type_line: 'Basic Land — Forest',
      card: { id: `${id}-card`, name: 'Forest', type_line: 'Basic Land — Forest' },
    });

    const state = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} } as any,
      ],
      battlefield: [
        land('p1-land-1', 'p1'),
        land('p1-land-2', 'p1'),
        land('p2-land-1', 'p2'),
        land('p2-land-2', 'p2'),
        land('p2-land-3', 'p2'),
        land('p3-land-1', 'p3'),
        land('p3-land-2', 'p3'),
        land('p3-land-3', 'p3'),
        land('p3-land-4', 'p3'),
        land('p3-land-5', 'p3'),
      ],
    });

    const result = applyDealDamageStep(
      state,
      step as any,
      {
        controllerId: 'p1',
        sourceName: 'Treacherous Terrain',
      } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    expect(result.state.players.find((player: any) => player.id === 'p1')?.life).toBe(40);
    expect(result.state.players.find((player: any) => player.id === 'p2')?.life).toBe(37);
    expect(result.state.players.find((player: any) => player.id === 'p3')?.life).toBe(35);
  });

  it('deals Acidic Soil damage to each player equal to lands they control', () => {
    const step = findDealDamage(
      'Acidic Soil deals damage to each player equal to the number of lands they control.',
      'Acidic Soil',
    );
    expect(step).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'the number of lands they control' },
      target: { kind: 'raw', text: 'each player' },
    });

    const result = applyDealDamageStep(
      makeState({
        players: [player('p1', 0), player('p2', 1), player('p3', 2)],
        battlefield: [
          land('p1-a', 'p1', 'Basic Land — Forest'),
          land('p1-b', 'p1', 'Basic Land — Forest'),
          land('p2-a', 'p2', 'Basic Land — Forest'),
          land('p2-b', 'p2', 'Basic Land — Forest'),
          land('p2-c', 'p2', 'Basic Land — Forest'),
          land('p3-a', 'p3', 'Basic Land — Forest'),
        ],
      }),
      step as any,
      { controllerId: 'p1', sourceName: 'Acidic Soil' } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.state.players.find((entry: any) => entry.id === 'p1')?.life).toBe(38);
    expect(result.state.players.find((entry: any) => entry.id === 'p2')?.life).toBe(37);
    expect(result.state.players.find((entry: any) => entry.id === 'p3')?.life).toBe(39);
  });

  it('deals Price of Progress damage equal to twice each player\'s nonbasic lands', () => {
    const step = findDealDamage(
      'Price of Progress deals damage to each player equal to twice the number of nonbasic lands that player controls.',
      'Price of Progress',
    );
    expect(step).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'twice the number of nonbasic lands that player controls' },
      target: { kind: 'raw', text: 'each player' },
    });

    const result = applyDealDamageStep(
      makeState({
        players: [player('p1', 0), player('p2', 1), player('p3', 2)],
        battlefield: [
          land('p1-basic', 'p1', 'Basic Land — Forest'),
          land('p1-shock', 'p1', 'Land — Forest Island'),
          land('p2-shock-1', 'p2', 'Land — Mountain'),
          land('p2-shock-2', 'p2', 'Land — Swamp'),
          land('p2-basic', 'p2', 'Basic Land — Plains'),
          land('p3-basic-1', 'p3', 'Basic Land — Island'),
          land('p3-basic-2', 'p3', 'Basic Land — Island'),
        ],
      }),
      step as any,
      { controllerId: 'p1', sourceName: 'Price of Progress' } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.state.players.find((entry: any) => entry.id === 'p1')?.life).toBe(38);
    expect(result.state.players.find((entry: any) => entry.id === 'p2')?.life).toBe(36);
    expect(result.state.players.find((entry: any) => entry.id === 'p3')?.life).toBe(40);
  });

  it('deals Typhoon damage to each opponent equal to Islands that player controls', () => {
    const step = findDealDamage(
      'Typhoon deals damage to each opponent equal to the number of Islands that player controls.',
      'Typhoon',
    );
    expect(step).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'the number of islands that player controls' },
      target: { kind: 'raw', text: 'each opponent' },
    });

    const result = applyDealDamageStep(
      makeState({
        players: [player('p1', 0), player('p2', 1), player('p3', 2)],
        battlefield: [
          land('p1-island', 'p1', 'Basic Land — Island'),
          land('p2-island-1', 'p2', 'Basic Land — Island'),
          land('p2-island-2', 'p2', 'Basic Land — Island'),
          land('p2-forest', 'p2', 'Basic Land — Forest'),
          land('p3-mountain', 'p3', 'Basic Land — Mountain'),
        ],
      }),
      step as any,
      { controllerId: 'p1', sourceName: 'Typhoon' } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.state.players.find((entry: any) => entry.id === 'p1')?.life).toBe(40);
    expect(result.state.players.find((entry: any) => entry.id === 'p2')?.life).toBe(38);
    expect(result.state.players.find((entry: any) => entry.id === 'p3')?.life).toBe(40);
  });

  it('deals Ground Assault damage to a creature equal to lands you control', () => {
    const step = findDealDamage(
      'Ground Assault deals damage to target creature equal to the number of lands you control.',
      'Ground Assault',
    );
    expect(step).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'the number of lands you control' },
      target: { kind: 'raw', text: 'target creature' },
    });

    const result = applyDealDamageStep(
      makeState({
        battlefield: [
          land('p1-a', 'p1', 'Basic Land — Forest'),
          land('p1-b', 'p1', 'Basic Land — Forest'),
          land('p1-c', 'p1', 'Basic Land — Forest'),
          land('p2-a', 'p2', 'Basic Land — Mountain'),
          {
            id: 'target-creature',
            controller: 'p2',
            owner: 'p2',
            counters: {},
            card: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature - Bear', power: '2', toughness: '2' },
          } as any,
        ],
      }),
      step as any,
      {
        controllerId: 'p1',
        sourceName: 'Ground Assault',
        targetCreatureId: 'target-creature',
      } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const target = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'target-creature');
    expect(target?.counters?.damage).toBe(3);
  });

  it("deals Weight of Spires damage equal to the creature's controller's nonbasic lands", () => {
    const step = findDealDamage(
      "Weight of Spires deals damage to target creature equal to the number of nonbasic lands that creature's controller controls.",
      'Weight of Spires',
    );
    expect(step).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: "the number of nonbasic lands that creature's controller controls" },
      target: { kind: 'raw', text: 'target creature' },
    });

    const result = applyDealDamageStep(
      makeState({
        battlefield: [
          land('p1-shock', 'p1', 'Land — Forest Island'),
          land('p2-shock-1', 'p2', 'Land — Mountain'),
          land('p2-shock-2', 'p2', 'Land — Swamp'),
          land('p2-basic', 'p2', 'Basic Land — Plains'),
          {
            id: 'target-creature',
            controller: 'p2',
            owner: 'p2',
            counters: {},
            card: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature - Bear', power: '2', toughness: '2' },
          } as any,
        ],
      }),
      step as any,
      {
        controllerId: 'p1',
        sourceName: 'Weight of Spires',
        targetCreatureId: 'target-creature',
      } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const target = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'target-creature');
    expect(target?.counters?.damage).toBe(2);
  });

  it('deals Power Surge damage from the turn-start untapped-land snapshot', () => {
    const oracleText =
      "At the beginning of each player's upkeep, this enchantment deals X damage to that player, where X is the number of untapped lands they controlled at the beginning of this turn.";
    const step = findDealDamage(oracleText, 'Power Surge');
    expect(step).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'x' },
      target: { kind: 'raw', text: 'that player' },
      whereX: { kind: 'where', raw: 'the number of untapped lands they controlled at the beginning of this turn' },
    });

    const snapshotLand = (id: string, tapped: boolean) => ({
      ...land(id, 'p2', 'Basic Land — Island'),
      tapped,
    });

    const result = applyDealDamageStep(
      makeState({
        battlefield: [
          snapshotLand('p2-untapped', false),
          snapshotLand('p2-was-tapped', false),
          snapshotLand('p2-still-tapped', false),
        ],
        turnStartBattlefieldSnapshot: [
          snapshotLand('p2-untapped', false),
          snapshotLand('p2-was-tapped', true),
          snapshotLand('p2-still-tapped', true),
        ],
      }),
      step as any,
      {
        controllerId: 'p1',
        sourceName: 'Power Surge',
        selectorContext: { targetPlayerId: 'p2' },
      } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const p2 = result.state.players.find((entry: any) => entry.id === 'p2') as any;
    expect(p2.life).toBe(39);
  });
});