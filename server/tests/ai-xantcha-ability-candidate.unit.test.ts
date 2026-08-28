import { describe, expect, it } from 'vitest';

import { canAIActivateBattlefieldAbilityNow } from '../src/socket/ai-handlers/aiActionCandidateHandlers.js';

const XANTCHA_ORACLE =
  "Xantcha enters under the control of an opponent of your choice.\n" +
  "Xantcha attacks each combat if able and can't attack its owner or planeswalkers its owner controls.\n" +
  "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.";

const xantchaAction = {
  activate: true,
  permanentId: 'stack_vzea37q0',
  cardName: 'Xantcha, Sleeper Agent',
  abilityId: 'xantcha_card-ability-0',
  abilityText: "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.",
};

function xantchaGame(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      turnPlayer: 'human',
      phase: 'precombatMain',
      step: 'MAIN1',
      stack: [{ id: 'spell1' }],
      manaPool: {
        ai: { white: 1, blue: 0, black: 0, red: 1, green: 2, colorless: 0 },
      },
      battlefield: [{
        id: 'stack_vzea37q0',
        controller: 'human',
        owner: 'human',
        tapped: false,
        card: {
          id: 'xantcha_card',
          name: 'Xantcha, Sleeper Agent',
          type_line: 'Legendary Creature — Phyrexian Minion',
          oracle_text: XANTCHA_ORACLE,
        },
      }],
      ...overrides,
    },
  };
}

describe('AI Xantcha any-player {3} timing', () => {
  it('allows the {3} draw-and-ping ability at response speed when an opponent controls it', () => {
    expect(canAIActivateBattlefieldAbilityNow(xantchaGame(), 'ai', xantchaAction, 'response')).toBe(true);
  });

  it('still allows it on the AI main phase', () => {
    expect(canAIActivateBattlefieldAbilityNow(
      xantchaGame({ turnPlayer: 'ai', stack: [] }),
      'ai',
      xantchaAction,
      'main',
    )).toBe(true);
  });
});
