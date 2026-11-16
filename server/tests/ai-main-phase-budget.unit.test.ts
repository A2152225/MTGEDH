import { describe, expect, it } from 'vitest';
import {
  allowMainPhaseActivation,
  allowMainPhaseSpellScan,
  noteMainPhasePriorityVisit,
  shouldForceMainPhasePass,
} from '../src/socket/ai-handlers/aiMainPhaseActionBudget.js';

function gameWithBf(n: number, step = 'MAIN1'): any {
  return {
    state: {
      turnNumber: 1,
      step,
      battlefield: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })),
    },
  };
}

describe('aiMainPhaseActionBudget late-game caps', () => {
  it('skips activations and spell scans on large boards', () => {
    expect(allowMainPhaseActivation(gameWithBf(10), 'seat')).toBe(true);
    expect(allowMainPhaseActivation(gameWithBf(25), 'seat')).toBe(false);
    expect(allowMainPhaseSpellScan(gameWithBf(10))).toBe(true);
    expect(allowMainPhaseSpellScan(gameWithBf(25))).toBe(false);
  });

  it('force-passes after fewer visits on large boards', () => {
    const game = gameWithBf(30);
    for (let i = 0; i < 3; i++) noteMainPhasePriorityVisit(game, 'seat');
    expect(shouldForceMainPhasePass(game, 'seat')).toBe(false);
    noteMainPhasePriorityVisit(game, 'seat');
    expect(shouldForceMainPhasePass(game, 'seat')).toBe(true);
  });
});
