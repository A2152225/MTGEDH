import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('intervening-if: "if <Name> has counters on it"', () => {
  function mkCtx(overrides: any = {}) {
    return {
      gameId: 'g1',
      state: {
        battlefield: [],
        players: [],
        ...overrides,
      },
    } as any;
  }

  it('returns null when named permanent has no counters map and there is no evidence counters tracking exists', () => {
    const sourcePermanent = {
      id: 'p1',
      controllerId: 'A',
      card: { name: 'Thing' },
    } as any;

    const ctx = mkCtx({
      battlefield: [
        // Named permanent exists but omits `counters`
        { id: 'p1', controllerId: 'A', card: { name: 'Thing' } },
        // No other permanents have a `counters` object either
        { id: 'p2', controllerId: 'A', card: { name: 'Other' } },
      ],
    });

    const result = evaluateInterveningIfClause('if Thing has counters on it', ctx, sourcePermanent);
    expect(result).toBeNull();
  });

  it('returns false when named permanent has no counters map but counters tracking exists elsewhere on battlefield', () => {
    const sourcePermanent = {
      id: 'p1',
      controllerId: 'A',
      card: { name: 'Thing' },
    } as any;

    const ctx = mkCtx({
      battlefield: [
        { id: 'p1', controllerId: 'A', card: { name: 'Thing' } },
        // Evidence counters tracking exists
        { id: 'p2', controllerId: 'A', card: { name: 'Other' }, counters: {} },
      ],
    });

    const result = evaluateInterveningIfClause('if Thing has counters on it', ctx, sourcePermanent);
    expect(result).toBe(false);
  });

  it('returns true when named permanent explicitly has counters (even if no other counters tracking evidence exists)', () => {
    const sourcePermanent = {
      id: 'p1',
      controllerId: 'A',
      card: { name: 'Thing' },
      counters: { '+1/+1': 1 },
    } as any;

    const ctx = mkCtx({
      battlefield: [{ id: 'p1', controllerId: 'A', card: { name: 'Thing' }, counters: { '+1/+1': 1 } }],
    });

    const result = evaluateInterveningIfClause('if Thing has counters on it', ctx, sourcePermanent);
    expect(result).toBe(true);
  });

  it('returns false when named permanent explicitly has an empty counters map', () => {
    const sourcePermanent = {
      id: 'p1',
      controllerId: 'A',
      card: { name: 'Thing' },
      counters: {},
    } as any;

    const ctx = mkCtx({
      battlefield: [{ id: 'p1', controllerId: 'A', card: { name: 'Thing' }, counters: {} }],
    });

    const result = evaluateInterveningIfClause('if Thing has counters on it', ctx, sourcePermanent);
    expect(result).toBe(false);
  });
});
