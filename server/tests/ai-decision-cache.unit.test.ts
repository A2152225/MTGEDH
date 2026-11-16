import { describe, expect, it } from 'vitest';
import {
  aiCandidateStableKey,
  getAvailableManaCached,
  getCachedObservation,
  getOrComputeSeqSeatModeCached,
  reorderByStickyKeys,
  readStickyTurnPlanOrder,
  setCachedObservation,
  writeStickyTurnPlanOrder,
} from '../src/socket/ai-handlers/aiDecisionCache.js';
import type { AIActionCandidate } from '../src/socket/ai-handlers/aiActionCandidateTypes.js';

function spell(id: string, name: string): AIActionCandidate {
  return {
    kind: 'cast_spell',
    priority: 1,
    spell: {
      card: { id, name },
      castCard: { id, name },
      sourceZone: 'hand',
      cost: {},
      cmc: 1,
      typeLine: 'Creature',
      priority: 1,
    },
  };
}

describe('aiDecisionCache', () => {
  it('reorders by sticky keys and keeps unknowns at the end', () => {
    const a = spell('a', 'A');
    const b = spell('b', 'B');
    const c = spell('c', 'C');
    const out = reorderByStickyKeys([c, a, b], [
      aiCandidateStableKey(b),
      aiCandidateStableKey(a),
    ]);
    expect(out?.map((x) => aiCandidateStableKey(x))).toEqual([
      aiCandidateStableKey(b),
      aiCandidateStableKey(a),
      aiCandidateStableKey(c),
    ]);
  });

  it('sticky plan is window-scoped and observation is seq-scoped', () => {
    const game: any = {
      seq: 10,
      state: {
        turnNumber: 3,
        step: 'MAIN1',
        players: [{ id: 'p1' }],
      },
    };
    writeStickyTurnPlanOrder(game, 'p1', ['spell:a:hand', 'spell:b:hand']);
    expect(readStickyTurnPlanOrder(game, 'p1')).toEqual(['spell:a:hand', 'spell:b:hand']);

    game.state.step = 'MAIN2';
    expect(readStickyTurnPlanOrder(game, 'p1')).toBeNull();

    const obs = { seat: 'p1' } as any;
    setCachedObservation(game, 'p1', obs);
    expect(getCachedObservation(game, 'p1')).toBe(obs);
    game.seq = 11;
    expect(getCachedObservation(game, 'p1')).toBeNull();
  });

  it('caches available mana per seat+seq', () => {
    const game: any = { seq: 1, state: {} };
    let calls = 0;
    const compute = () => {
      calls += 1;
      return { G: 2 };
    };
    expect(getAvailableManaCached(game, 'p1', compute)).toEqual({ G: 2 });
    expect(getAvailableManaCached(game, 'p1', compute)).toEqual({ G: 2 });
    expect(calls).toBe(1);
    game.seq = 2;
    expect(getAvailableManaCached(game, 'p1', compute)).toEqual({ G: 2 });
    expect(calls).toBe(2);
  });

  it('caches seat+seq+mode compute results', () => {
    const game: any = { seq: 5, state: {} };
    let calls = 0;
    const run = () =>
      getOrComputeSeqSeatModeCached(game, '_aiCastableSpellsCache', 'p1', 'main', () => {
        calls += 1;
        return ['Bolt'];
      });
    expect(run()).toEqual(['Bolt']);
    expect(run()).toEqual(['Bolt']);
    expect(calls).toBe(1);
    expect(
      getOrComputeSeqSeatModeCached(game, '_aiCastableSpellsCache', 'p1', 'response', () => {
        calls += 1;
        return ['Counter'];
      }),
    ).toEqual(['Counter']);
    expect(calls).toBe(2);
    game.seq = 6;
    expect(run()).toEqual(['Bolt']);
    expect(calls).toBe(3);
  });
});
