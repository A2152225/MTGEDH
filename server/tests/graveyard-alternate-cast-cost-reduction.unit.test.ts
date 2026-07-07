import { describe, expect, it } from 'vitest';
import {
  buildAlternateCastSpellManaCost,
  isGraveyardAlternateCastAbilityId,
} from '../src/socket/game-actions.js';

const LIGHTNING_BOLT = {
  id: 'lightning_bolt_1',
  name: 'Lightning Bolt',
  type_line: 'Instant',
  mana_cost: '{R}',
  colors: ['R'],
  oracle_text: 'Lightning Bolt deals 3 damage to any target.\nFlashback {2}{R}',
};

const SECRETS_OF_THE_DEAD = {
  id: 'secrets_1',
  name: 'Secrets of the Dead',
  type_line: 'Enchantment',
  mana_cost: '{1}{U}',
  colors: ['U'],
  oracle_text: 'Whenever you cast a spell from your graveyard, draw a card.\nFlashback {3}{U}',
};

describe('graveyard alternate cast spell cost reducers', () => {
  it('identifies graveyard alternate cast ability ids', () => {
    expect(isGraveyardAlternateCastAbilityId('flashback')).toBe(true);
    expect(isGraveyardAlternateCastAbilityId('escape')).toBe(true);
    expect(isGraveyardAlternateCastAbilityId('unearth')).toBe(false);
  });

  it('reduces flashback cost with Ruby Medallion', () => {
    const game = {
      state: {
        battlefield: [
          {
            id: 'ruby_medallion_1',
            controller: 'p1',
            card: {
              name: 'Ruby Medallion',
              type_line: 'Artifact',
              oracle_text: 'Red spells you cast cost {1} less to cast.',
            },
          },
        ],
      },
    };

    const built = buildAlternateCastSpellManaCost(game, 'p1', LIGHTNING_BOLT, '{2}{R}');
    expect(built.originalManaCost).toBe('{2}{R}');
    expect(built.adjustedManaCost).toBe('{1}{R}');
    expect(built.costAdjustment?.adjustedManaCost).toBe('{1}{R}');
    expect(built.costReduction.messages.some((message) => message.includes('Ruby Medallion'))).toBe(true);
  });

  it('reduces flashback cost with Sapphire Medallion', () => {
    const game = {
      state: {
        battlefield: [
          {
            id: 'sapphire_medallion_1',
            controller: 'p1',
            card: {
              name: 'Sapphire Medallion',
              type_line: 'Artifact',
              oracle_text: 'Blue spells you cast cost {1} less to cast.',
            },
          },
        ],
      },
    };

    const built = buildAlternateCastSpellManaCost(game, 'p1', SECRETS_OF_THE_DEAD, '{3}{U}');
    expect(built.adjustedManaCost).toBe('{2}{U}');
  });

  it('does not apply spell reducers to unearth-style costs via helper guard', () => {
    expect(isGraveyardAlternateCastAbilityId('unearth')).toBe(false);
  });
});
