/**
 * Tests for keyword actions covering Rules 701.59-701.64.
 */

import { describe, expect, it } from 'vitest';
import {
  canBecomeSuspected,
  canChooseEndureCounters,
  canBecomeHarnessed,
  canBlockWhileSuspected,
  canCollectEvidence,
  canCollectEvidenceWithCards,
  canForage,
  canHarnessPermanent,
  canManifestDread,
  canSacrificeFoodForForage,
  canSuspectCreature,
  clearHarnessedState,
  clearSuspectedState,
  collectEvidence,
  completeCollectEvidence,
  completeManifestDread,
  createEndureSpiritToken,
  createHarnessedState,
  createSuspectedState,
  endure,
  endureDoesNothing,
  endureWithCounters,
  endureWithToken,
  ENDURE_SPIRIT_TOKEN,
  forageByExiling,
  forageBySacrificing,
  FORAGE_EXILE_COUNT,
  getCollectedEvidenceTotal,
  getEndureValue,
  getEvidenceShortfall,
  getForageMethod,
  getManifestDreadSeenCardCount,
  harness,
  isHarnessed,
  isValidEvidence,
  isValidForageExile,
  isValidManifestDreadChoice,
  manifestDread,
  MANIFEST_DREAD_CARD_COUNT,
  resolveManifestDreadLook,
  shouldCreateEndureToken,
  suspect,
  SUSPECTED_ABILITIES,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 8', () => {
  describe('Rule 701.59: Collect Evidence', () => {
    it('should total selected mana values and track the shortfall correctly', () => {
      const action = collectEvidence('p1', 6);
      const completed = completeCollectEvidence('p1', 6, ['c1', 'c2'], 7);
      const total = getCollectedEvidenceTotal([
        { manaValue: 2 },
        { mana_value: 3 },
        { card: { cmc: 2 } },
      ]);

      expect(action.type).toBe('collect-evidence');
      expect(completed.totalManaValue).toBe(7);
      expect(canCollectEvidence(7, 6)).toBe(true);
      expect(isValidEvidence([2, 3, 1], 6)).toBe(true);
      expect(total).toBe(7);
      expect(canCollectEvidenceWithCards([{ manaValue: 4 }, { manaValue: 1 }], 6)).toBe(false);
      expect(getEvidenceShortfall(total, 9)).toBe(2);
    });
  });

  describe('Rule 701.60: Suspect', () => {
    it('should apply and clear the suspected designation on creatures only', () => {
      const action = suspect('creature-1', 'p1');
      const state = createSuspectedState('creature-1');
      const cleared = clearSuspectedState(state);

      expect(action.type).toBe('suspect');
      expect(canSuspectCreature({ card: { type_line: 'Creature — Rogue' } }, false)).toBe(true);
      expect(canSuspectCreature({ card: { type_line: 'Artifact' } }, false)).toBe(false);
      expect(canBlockWhileSuspected(state.isSuspected)).toBe(false);
      expect(cleared.isSuspected).toBe(false);
      expect(canBecomeSuspected(state.isSuspected)).toBe(false);
      expect(SUSPECTED_ABILITIES.menace).toBe(true);
    });
  });

  describe('Rule 701.61: Forage', () => {
    it('should support both forage branches and validate Food sacrifice targets', () => {
      const exileAction = forageByExiling('p1', ['g1', 'g2', 'g3']);
      const sacrificeAction = forageBySacrificing('p1', 'food-1');

      expect(FORAGE_EXILE_COUNT).toBe(3);
      expect(canForage(3, 0)).toBe(true);
      expect(canForage(2, 0)).toBe(false);
      expect(isValidForageExile(['g1', 'g2', 'g3'])).toBe(true);
      expect(isValidForageExile(['g1', 'g2'])).toBe(false);
      expect(canSacrificeFoodForForage({ card: { type_line: 'Token Artifact — Food' } })).toBe(true);
      expect(canSacrificeFoodForForage({ card: { type_line: 'Token Artifact — Treasure' } })).toBe(false);
      expect(getForageMethod(exileAction)).toBe('exile');
      expect(getForageMethod(sacrificeAction)).toBe('sacrifice');
    });
  });

  describe('Rule 701.62: Manifest Dread', () => {
    it('should resolve the looked-at cards into one manifested card and the rest to graveyard', () => {
      const action = manifestDread('p1');
      const resolved = resolveManifestDreadLook(['top-1', 'top-2'], 'top-2');
      const completed = completeManifestDread('p1', 'top-2', ['top-1']);

      expect(action.type).toBe('manifest-dread');
      expect(MANIFEST_DREAD_CARD_COUNT).toBe(2);
      expect(canManifestDread(1)).toBe(true);
      expect(canManifestDread(0)).toBe(false);
      expect(getManifestDreadSeenCardCount(5)).toBe(2);
      expect(getManifestDreadSeenCardCount(1)).toBe(1);
      expect(isValidManifestDreadChoice(['top-1', 'top-2'], 'top-2')).toBe(true);
      expect(resolved).toEqual({ manifestedCardId: 'top-2', cardsToGraveyard: ['top-1'] });
      expect(completed.cardsToGraveyard).toEqual(['top-1']);
    });
  });

  describe('Rule 701.63: Endure', () => {
    it('should support both the counter and Spirit-token branches', () => {
      const action = endure('perm-1', 'p1', 3);
      const counters = endureWithCounters('perm-1', 'p1', 3);
      const tokenAction = endureWithToken('perm-1', 'p1', 3, 'spirit-1');
      const token = createEndureSpiritToken('spirit-1', 'p1', 3);

      expect(action.type).toBe('endure');
      expect(canChooseEndureCounters(3, true)).toBe(true);
      expect(canChooseEndureCounters(3, false)).toBe(false);
      expect(shouldCreateEndureToken(counters)).toBe(false);
      expect(shouldCreateEndureToken(tokenAction)).toBe(true);
      expect(getEndureValue(tokenAction)).toBe(3);
      expect(ENDURE_SPIRIT_TOKEN.name).toBe('Spirit');
      expect(token.basePower).toBe(3);
      expect(token.baseToughness).toBe(3);
      expect(token.isToken).toBe(true);
      expect(endureDoesNothing(0)).toBe(true);
    });
  });

  describe('Rule 701.64: Harness', () => {
    it('should apply, test, and clear the harnessed designation', () => {
      const action = harness('artifact-1');
      const state = createHarnessedState('artifact-1');
      const cleared = clearHarnessedState(state);

      expect(action.type).toBe('harness');
      expect(canHarnessPermanent('battlefield', false)).toBe(true);
      expect(canHarnessPermanent('hand', false)).toBe(false);
      expect(canBecomeHarnessed(true)).toBe(false);
      expect(isHarnessed(state)).toBe(true);
      expect(isHarnessed(cleared)).toBe(false);
    });
  });
});