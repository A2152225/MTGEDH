import { describe, expect, it } from 'vitest';
import {
  TURN_PLAN_MAX_ACTIONABLE,
  TURN_PLAN_SKIP_BF,
  applyTurnPlanToMainCandidates,
} from '../src/socket/ai-handlers/aiTurnPlanHook.js';

function makeCandidate(name: string, priority: number) {
  return {
    kind: 'cast_spell' as const,
    priority,
    spell: {
      cmc: 2,
      castCard: {
        name,
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
        mana_cost: '{1}{U}',
        cmc: 2,
      },
      card: {
        name,
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
        mana_cost: '{1}{U}',
        cmc: 2,
      },
    },
  };
}

function gameWithBrain(bfSize: number) {
  return {
    state: {
      players: [{ id: 'ai', aiBrain: 'v2', life: 40 }],
      battlefield: Array.from({ length: bfSize }, (_, i) => ({
        id: `p${i}`,
        controller: 'ai',
        card: { name: `P${i}`, type_line: 'Creature', power: '1', toughness: '1' },
      })),
      stack: [],
      turn: 5,
      turnNumber: 5,
      phase: 'precombatMain',
      step: 'MAIN1',
      activePlayer: 'ai',
      priority: 'ai',
      life: { ai: 40 },
      manaPool: { ai: { blue: 6, white: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      zones: {
        ai: {
          hand: [],
          library: [],
          graveyard: [],
          exile: [],
        },
      },
      opponents: [],
    },
  };
}

describe('applyTurnPlanToMainCandidates thresholds', () => {
  it('exports stall-safe skip and actionable cap', () => {
    expect(TURN_PLAN_SKIP_BF).toBe(20);
    expect(TURN_PLAN_MAX_ACTIONABLE).toBe(10);
  });

  it('skips large boards but still plans a capped pool on small busy boards', () => {
    const many = Array.from({ length: 12 }, (_, i) => makeCandidate(`Spell ${i}`, 100 - i));
    const skipped = applyTurnPlanToMainCandidates(gameWithBrain(TURN_PLAN_SKIP_BF + 1), 'ai', many);
    expect(skipped.reason).toMatch(/^skip-large:/);
    expect(skipped.plan).toBeNull();

    const busySmall = applyTurnPlanToMainCandidates(gameWithBrain(8), 'ai', many);
    expect(busySmall.reason).not.toMatch(/^skip-large:/);
    expect(busySmall.reason).toMatch(/capped=10\/12|first:/);
  });
});
