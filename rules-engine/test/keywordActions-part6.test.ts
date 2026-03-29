/**
 * Tests for keyword actions covering Rules 701.65-701.67.
 */

import { describe, expect, it } from 'vitest';
import {
  AIRBEND_ALTERNATE_COST,
  EARTHBENDED_PROPERTIES,
  airbend,
  canTapForWaterbend,
  completeWaterbend,
  createAirbendedState,
  createEarthbendTrigger,
  earthbend,
  getAirbendAlternateCost,
  getMaxWaterbendSubstitutions,
  getWaterbendRemainingCost,
  parseWaterbendCost,
  triggersWhenWaterbends,
  waterbend,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 6', () => {
  describe('Rule 701.65: Airbend', () => {
    it('should exile objects and grant the alternate cast cost', () => {
      const action = airbend('p1', ['card-1', 'card-2']);
      const state = createAirbendedState('card-1', 'p1');

      expect(action.type).toBe('airbend');
      expect(action.objectIds).toEqual(['card-1', 'card-2']);
      expect(getAirbendAlternateCost()).toBe(AIRBEND_ALTERNATE_COST);
      expect(state.canCastWithAlternateCost).toBe(true);
    });
  });

  describe('Rule 701.66: Earthbend', () => {
    it('should create the land animation action and delayed return trigger', () => {
      const action = earthbend('p1', 'land-1', 3);
      const trigger = createEarthbendTrigger('land-1', 'p1');

      expect(action.type).toBe('earthbend');
      expect(action.landId).toBe('land-1');
      expect(action.n).toBe(3);
      expect(EARTHBENDED_PROPERTIES.hasHaste).toBe(true);
      expect(EARTHBENDED_PROPERTIES.addedTypes).toContain('Creature');
      expect(trigger.returnsWhenDiesOrExiled).toBe(true);
    });
  });

  describe('Rule 701.67: Waterbend', () => {
    it('should create and complete a waterbend action', () => {
      const action = waterbend('p1', '{3}{U}');
      const completed = completeWaterbend('p1', '{3}{U}', ['artifact-1', 'creature-1'], '{1}{U}');

      expect(action.type).toBe('waterbend');
      expect(completed.tappedPermanents).toEqual(['artifact-1', 'creature-1']);
      expect(completed.manaPaid).toBe('{1}{U}');
      expect(triggersWhenWaterbends(true)).toBe(true);
    });

    it('should parse waterbend costs and reduce only generic mana', () => {
      expect(parseWaterbendCost('{3}{U}{U}')).toEqual({
        genericMana: 3,
        nonGenericSymbols: ['U', 'U'],
      });
      expect(getMaxWaterbendSubstitutions('{3}{U}{U}')).toBe(3);
      expect(getWaterbendRemainingCost('{3}{U}{U}', 2)).toBe('{1}{U}{U}');
      expect(getWaterbendRemainingCost('{2}{G}', 3)).toBe('{G}');
      expect(getWaterbendRemainingCost('{2}', 2)).toBe('{0}');
    });

    it('should accept untapped artifact or creature permanents for waterbend', () => {
      expect(canTapForWaterbend({ isArtifact: true, isTapped: false })).toBe(true);
      expect(canTapForWaterbend({ tapped: false, card: { type_line: 'Creature — Merfolk' } })).toBe(true);
      expect(canTapForWaterbend({ isCreature: true, isTapped: true })).toBe(false);
      expect(canTapForWaterbend({ tapped: false, card: { type_line: 'Enchantment' } })).toBe(false);
    });
  });
});