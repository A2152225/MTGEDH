import { describe, expect, it } from 'vitest';
import { shouldHoldUpInteractionForStep } from '../src/socket/ai-handlers/aiTurnPlanHook.js';
import { planTurn, type PlannerCandidate } from '../../rules-engine/src/ai/turnPlanner.js';

function cand(
  id: string,
  manaCost: number,
  score: number,
  extras: Partial<PlannerCandidate> = {},
): PlannerCandidate {
  return {
    id,
    kind: 'cast_spell',
    manaCost,
    score,
    roles: extras.roles || [],
    instantSpeed: extras.instantSpeed || false,
    ...extras,
  };
}

describe('MAIN1 dump / MAIN2 hold-up', () => {
  it('shouldHoldUpInteractionForStep is true only on MAIN2', () => {
    expect(shouldHoldUpInteractionForStep('MAIN1')).toBe(false);
    expect(shouldHoldUpInteractionForStep('main1')).toBe(false);
    expect(shouldHoldUpInteractionForStep('MAIN2')).toBe(true);
    expect(shouldHoldUpInteractionForStep('main2')).toBe(true);
  });

  it('with 5 mana + Counterspell, MAIN1-style dump prefers the 5-drop', () => {
    const candidates = [
      cand('five', 5, 20),
      cand('counter', 2, 15, { roles: ['counterspell'], instantSpeed: true }),
    ];
    const affordable = (plays: PlannerCandidate[]) => {
      let floating = 5;
      for (const p of plays) {
        if (p.manaCost > floating) return false;
        floating -= p.manaCost;
      }
      return true;
    };
    const dump = planTurn({
      candidates,
      manaAvailable: 5,
      affordable,
      holdUpInteraction: shouldHoldUpInteractionForStep('MAIN1'),
    });
    expect(dump.reserved).toBe(0);
    expect(dump.plays.map((p) => p.id)).toContain('five');

    const hold = planTurn({
      candidates,
      manaAvailable: 5,
      affordable,
      holdUpInteraction: shouldHoldUpInteractionForStep('MAIN2'),
    });
    expect(hold.reserved).toBe(2);
  });
});
