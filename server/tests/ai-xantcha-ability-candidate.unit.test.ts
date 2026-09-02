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

const KOGLA_ORACLE =
  'When Kogla and Yidaro enters, choose one —\n' +
  '\u2022 It gains trample and haste until end of turn.\n' +
  '\u2022 It fights target creature you don\'t control.\n' +
  '{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment. Shuffle this card into your library from your graveyard, then draw a card.';

const koglaAction = {
  activate: true,
  permanentId: 'stack_htqnsr3f',
  cardName: 'Kogla and Yidaro',
  abilityId: 'b760ebdf-bea6-4c43-a187-4a02ebf95ebf_mtdha500_21_i3a2l9-ability-0',
  abilityText: '{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment. Shuffle this card into your library from your graveyard, then draw a card.',
};

function koglaGame() {
  return {
    state: {
      turnPlayer: 'ai',
      phase: 'precombatMain',
      step: 'MAIN1',
      stack: [{ id: 'trig_kogla_etb', type: 'triggered_ability' }],
      manaPool: {
        ai: { white: 1, blue: 1, black: 1, red: 1, green: 14, colorless: 1 },
      },
      battlefield: [{
        id: 'stack_htqnsr3f',
        controller: 'ai',
        owner: 'ai',
        tapped: false,
        card: {
          id: 'b760ebdf-bea6-4c43-a187-4a02ebf95ebf',
          name: 'Kogla and Yidaro',
          type_line: 'Legendary Creature — Ape Dinosaur Turtle',
          oracle_text: KOGLA_ORACLE,
        },
      }],
    },
  };
}

describe('AI Kogla and Yidaro discard-this-card is not a battlefield ability', () => {
  it('rejects the hand-only discard ability at response speed', () => {
    expect(canAIActivateBattlefieldAbilityNow(koglaGame(), 'ai', koglaAction, 'response')).toBe(false);
  });

  it('rejects the hand-only discard ability on the AI main phase', () => {
    expect(canAIActivateBattlefieldAbilityNow(
      koglaGame(),
      'ai',
      koglaAction,
      'main',
    )).toBe(false);
  });
});
