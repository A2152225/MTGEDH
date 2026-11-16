/**
 * P2-7 turn planner unit tests (≥12).
 */

import { describe, expect, it } from 'vitest';
import {
  MANA_EFFICIENCY,
  planTurn,
  type PlannerCandidate,
} from '../src/ai/turnPlanner.js';

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
    manaProduced: extras.manaProduced,
    producedManaSick: extras.producedManaSick,
    ...extras,
  };
}

function affordableByCmc(manaAvailable: number) {
  return (plays: PlannerCandidate[]) => {
    let floating = manaAvailable;
    for (const p of plays) {
      if (p.manaCost > floating) return false;
      floating -= p.manaCost;
      if ((p.manaProduced || 0) > 0 && !p.producedManaSick) {
        floating += p.manaProduced || 0;
      }
    }
    return true;
  };
}

describe('P2-7 planTurn', () => {
  it('with 5 mana and equal scores prefers 2+3 over the 5-drop alone', () => {
    const plan = planTurn({
      candidates: [
        cand('two', 2, 10),
        cand('three', 3, 10),
        cand('five', 5, 10),
      ],
      manaAvailable: 5,
      affordable: affordableByCmc(5),
      holdUpInteraction: false,
    });
    expect(plan.plays.map((p) => p.id).sort()).toEqual(['three', 'two']);
  });

  it('never plans an unaffordable play', () => {
    const plan = planTurn({
      candidates: [cand('six', 6, 100), cand('two', 2, 5)],
      manaAvailable: 5,
      affordable: affordableByCmc(5),
      holdUpInteraction: false,
    });
    expect(plan.plays.every((p) => p.manaCost <= 5)).toBe(true);
    expect(plan.plays.map((p) => p.id)).not.toContain('six');
  });

  it('orders ramp before a non-ramp when both fit', () => {
    const plan = planTurn({
      candidates: [
        cand('bear', 3, 12),
        cand('sol', 1, 12, { roles: ['ramp'], manaProduced: 2 }),
      ],
      manaAvailable: 4,
      affordable: affordableByCmc(4),
      holdUpInteraction: false,
    });
    expect(plan.plays[0]?.id).toBe('sol');
  });

  it('reserves mana for a counterspell when hold-up is enabled', () => {
    const plan = planTurn({
      candidates: [
        cand('beast', 5, 20),
        cand('counter', 2, 8, { roles: ['counterspell'], instantSpeed: true }),
        cand('dog', 2, 9),
      ],
      manaAvailable: 5,
      affordable: affordableByCmc(5),
      holdUpInteraction: true,
    });
    expect(plan.reserved).toBe(2);
    expect(plan.plays.map((p) => p.id)).not.toContain('beast');
  });

  it('does not reserve when holdUpInteraction is false', () => {
    const plan = planTurn({
      candidates: [
        cand('beast', 5, 20),
        cand('counter', 2, 8, { roles: ['counterspell'], instantSpeed: true }),
      ],
      manaAvailable: 5,
      affordable: affordableByCmc(5),
      holdUpInteraction: false,
    });
    expect(plan.reserved).toBe(0);
    expect(plan.plays.map((p) => p.id)).toContain('beast');
  });

  it('empty candidate list yields empty plan', () => {
    const plan = planTurn({
      candidates: [],
      manaAvailable: 5,
      affordable: () => true,
    });
    expect(plan.plays).toEqual([]);
  });

  it('single affordable play is selected', () => {
    const plan = planTurn({
      candidates: [cand('bear', 3, 15)],
      manaAvailable: 3,
      affordable: affordableByCmc(3),
      holdUpInteraction: false,
    });
    expect(plan.plays.map((p) => p.id)).toEqual(['bear']);
  });

  it('scores mana efficiency into the plan score', () => {
    const wasteful = planTurn({
      candidates: [cand('one', 1, 10)],
      manaAvailable: 10,
      affordable: affordableByCmc(10),
      holdUpInteraction: false,
    });
    const tight = planTurn({
      candidates: [cand('ten', 10, 10)],
      manaAvailable: 10,
      affordable: affordableByCmc(10),
      holdUpInteraction: false,
    });
    expect(tight.score).toBeGreaterThan(wasteful.score);
    expect(MANA_EFFICIENCY).toBe(40);
  });

  it('respects beam width (top scores only)', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      cand(`c${i}`, 1, i === 11 ? 100 : i),
    );
    const plan = planTurn({
      candidates: many,
      manaAvailable: 1,
      affordable: affordableByCmc(1),
      beam: 3,
      holdUpInteraction: false,
    });
    expect(plan.plays[0]?.id).toBe('c11');
  });

  it('respects maxPlays cap', () => {
    const plan = planTurn({
      candidates: [
        cand('a', 1, 10),
        cand('b', 1, 10),
        cand('c', 1, 10),
        cand('d', 1, 10),
      ],
      manaAvailable: 4,
      affordable: affordableByCmc(4),
      maxPlays: 2,
      holdUpInteraction: false,
    });
    expect(plan.plays.length).toBeLessThanOrEqual(2);
  });

  it('credits mana produced by earlier ramp in the sequence', () => {
    const plan = planTurn({
      candidates: [
        cand('sol', 1, 10, { roles: ['ramp'], manaProduced: 2 }),
        cand('four', 4, 12),
      ],
      manaAvailable: 3,
      affordable: affordableByCmc(3),
      holdUpInteraction: false,
    });
    expect(plan.plays.map((p) => p.id)).toEqual(['sol', 'four']);
  });

  it('does not credit sick mana dorks for same-turn spends', () => {
    const plan = planTurn({
      candidates: [
        cand('elf', 1, 10, { roles: ['ramp'], manaProduced: 1, producedManaSick: true }),
        cand('five', 5, 20),
        cand('three', 3, 12),
      ],
      manaAvailable: 4,
      affordable: affordableByCmc(4),
      holdUpInteraction: false,
    });
    expect(plan.plays.map((p) => p.id)).not.toContain('five');
  });

  it('protection instants also reserve mana', () => {
    const plan = planTurn({
      candidates: [
        cand('beast', 4, 18),
        cand('teferi', 1, 5, { roles: ['protection'], instantSpeed: true }),
      ],
      manaAvailable: 4,
      affordable: affordableByCmc(4),
      holdUpInteraction: true,
    });
    expect(plan.reserved).toBe(1);
  });
});
