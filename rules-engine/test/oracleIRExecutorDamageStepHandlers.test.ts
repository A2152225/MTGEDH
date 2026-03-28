import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { applyDealDamageStep } from '../src/oracleIRExecutorDamageStepHandlers';

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
});