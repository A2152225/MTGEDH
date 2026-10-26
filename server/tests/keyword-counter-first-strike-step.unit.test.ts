import { describe, expect, it } from 'vitest';
import type { GameContext } from '../src/state/context.js';
import { computeNextStepPhaseAdvance } from '../src/state/modules/turn-handlers/turnStepPhaseAdvance.js';

function combatCtx(attacker: Record<string, unknown>): GameContext {
  return {
    state: {
      battlefield: [attacker],
    },
  } as GameContext;
}

describe('keyword counters open the first-strike damage step', () => {
  it('a double strike counter on an attacker creates a first-strike damage step', () => {
    const ctx = combatCtx({
      id: 'showdown-bear',
      attacking: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
      counters: { 'double strike': 1 },
    });
    const next = computeNextStepPhaseAdvance(ctx, 'combat', 'DECLARE_BLOCKERS', () => ({}));
    expect(next?.nextStep).toBe('FIRST_STRIKE_DAMAGE');
  });

  it('a creature with no strike keyword skips straight to regular damage', () => {
    const ctx = combatCtx({
      id: 'vanilla',
      attacking: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
      counters: {},
    });
    const next = computeNextStepPhaseAdvance(ctx, 'combat', 'DECLARE_BLOCKERS', () => ({}));
    expect(next?.nextStep).toBe('DAMAGE');
  });
});
