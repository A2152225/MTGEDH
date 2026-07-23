import { describe, expect, it } from 'vitest';

import { createTokenPermanent } from '../../rules-engine/src/tokenCreationPermanentFactory.js';
import { parseTokenCreationFromText } from '../../rules-engine/src/tokenCreationDetection.js';
import { detectAttackTriggers } from '../src/state/modules/triggers/combat.js';
import { hydratePermanentCardOracle } from '../../shared/src/hydrateCardOracleText.js';

const HUMAN_SOLDIER_CHARACTERISTICS = {
  name: 'Human Soldier',
  colors: ['W'],
  types: ['Creature'],
  subtypes: ['Human', 'Soldier'],
  power: 1,
  toughness: 1,
  abilities: [] as const,
  entersTapped: false,
  isLegendary: false,
};

const PRINTED_HUMAN_SOLDIER_ORACLE =
  'Training\nWhenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.';

describe('Human Soldier prototype tokens (Horn of Gondor)', () => {
  it('uses Token type line and does not hydrate printed-card oracle', () => {
    const token = createTokenPermanent(HUMAN_SOLDIER_CHARACTERISTICS, 'p1');

    expect(token.card.type_line).toMatch(/^Token Creature — Human Soldier$/);

    const hydrated = hydratePermanentCardOracle(token, () => ({
      oracle_text: PRINTED_HUMAN_SOLDIER_ORACLE,
      type_line: 'Creature — Human Soldier',
    }));
    expect(hydrated).toBe(false);
    expect(String(token.card.oracle_text || '')).toBe('');
  });

  it('does not register training attack triggers', () => {
    const token = createTokenPermanent(HUMAN_SOLDIER_CHARACTERISTICS, 'p1');
    const triggers = detectAttackTriggers(token.card, token);
    expect(triggers.some((trigger) => trigger.triggerType === 'training')).toBe(false);
  });

  it('grants training when the creation clause says "with training" (Torens)', () => {
    const parsed = parseTokenCreationFromText(
      'create a 1/1 green and white Human Soldier creature token with training',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.characteristics.abilities).toContain('Training');

    const token = createTokenPermanent(parsed!.characteristics, 'p1');
    const triggers = detectAttackTriggers(token.card, token);
    expect(triggers.some((trigger) => trigger.triggerType === 'training')).toBe(true);
  });
});
