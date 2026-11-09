import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  candidatesFromAIActionList,
  recordDecision,
  resetAIDecisionTrace,
  setAIDecisionTraceSink,
  type DecisionTrace,
} from '../src/socket/ai-handlers/aiDecisionTrace.js';

describe('aiDecisionTrace (P0-4)', () => {
  afterEach(() => {
    resetAIDecisionTrace();
    delete process.env.AI_TRACE_FILE;
  });

  it('records candidates in priority order and chosen index via a stub sink', () => {
    const captured: DecisionTrace[] = [];
    setAIDecisionTraceSink((r) => captured.push(r));

    const candidates = candidatesFromAIActionList([
      {
        kind: 'cast_spell',
        priority: 90,
        spell: { castCard: { name: 'Sol Ring' }, card: { name: 'Sol Ring' } },
      },
      {
        kind: 'cast_spell',
        priority: 70,
        spell: { card: { name: 'Cultivate' } },
      },
      {
        kind: 'activate_ability',
        priority: 50,
        ability: { action: { cardName: 'Mana Crypt' } },
      },
    ]);

    expect(candidates.map((c) => c.name)).toEqual(['Sol Ring', 'Cultivate', 'Mana Crypt']);
    expect(candidates.map((c) => c.score)).toEqual([90, 70, 50]);

    recordDecision({
      gameId: 'g1',
      turn: 3,
      phase: 'main',
      step: 'precombat_main',
      seat: 'p1',
      kind: 'priority',
      candidates,
      chosen: 0,
      note: 'cast-sol-ring',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].v).toBe(1);
    expect(captured[0].chosen).toBe(0);
    expect(captured[0].candidates[0].name).toBe('Sol Ring');
    expect(captured[0].note).toBe('cast-sol-ring');
  });

  it('is a no-op when no sink and AI_TRACE_FILE is unset', () => {
    const spy = vi.spyOn(console, 'error');
    recordDecision({
      gameId: 'g1',
      turn: 1,
      phase: 'main',
      seat: 'p1',
      kind: 'priority',
      candidates: [],
      chosen: null,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
