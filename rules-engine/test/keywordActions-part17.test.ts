import { describe, expect, it } from 'vitest';
import {
  canCloakFromZone,
  canCollectEvidenceWithCards,
  canManifestDread,
  cloak,
  CLOAK_ONE_AT_A_TIME,
  collectEvidence,
  completeCollectEvidence,
  completeIncubate,
  completeManifestDread,
  createCloakResult,
  createCollectEvidenceResult,
  createIncubateResult,
  createManifestDreadSummary,
  createsWardPermanent,
  getEvidenceShortfall,
  getIncubateCounterCount,
  incubate,
  MANIFESTED_DREAD_EVEN_IF_IMPOSSIBLE,
  manifestDread,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 17 (modern manifestation and evidence summaries)', () => {
  describe('Rule 701.53: Incubate', () => {
    it('should summarize created Incubator tokens, counters, and transformability', () => {
      expect(getIncubateCounterCount(3)).toBe(3);
      expect(createIncubateResult(completeIncubate('p1', 3, 'incubator-1'))).toEqual({
        playerId: 'p1',
        tokenId: 'incubator-1',
        counterCount: 3,
        createsIncubatorToken: true,
        canTransformLater: true,
      });
      expect(incubate('p1', 0).type).toBe('incubate');
    });
  });

  describe('Rule 701.58: Cloak', () => {
    it('should summarize cloak source-zone legality and ward-granting face-down creation', () => {
      const action = cloak('p1', ['card-1', 'card-2'], 'library');

      expect(canCloakFromZone('library')).toBe(true);
      expect(createsWardPermanent()).toBe(true);
      expect(createCloakResult(action)).toEqual({
        playerId: 'p1',
        cardCount: 2,
        fromZone: 'library',
        legalSourceZone: true,
        createsWardPermanent: true,
        oneAtATime: true,
      });
      expect(CLOAK_ONE_AT_A_TIME).toBe(true);
    });
  });

  describe('Rule 701.59: Collect Evidence', () => {
    it('should summarize satisfied evidence totals and remaining shortfall when incomplete', () => {
      const completed = completeCollectEvidence('p1', 6, ['c1', 'c2'], 7);

      expect(canCollectEvidenceWithCards([{ manaValue: 4 }, { manaValue: 3 }], 6)).toBe(true);
      expect(createCollectEvidenceResult(completed)).toEqual({
        playerId: 'p1',
        requiredManaValue: 6,
        exiledCardCount: 2,
        totalManaValue: 7,
        satisfied: true,
        shortfall: 0,
      });
      expect(getEvidenceShortfall(5, 6)).toBe(1);
      expect(collectEvidence('p1', 6).type).toBe('collect-evidence');
    });
  });

  describe('Rule 701.62: Manifest Dread', () => {
    it('should summarize looked-at cards, manifested choice, and graveyard remainder', () => {
      const action = completeManifestDread('p1', 'top-2', ['top-1']);

      expect(canManifestDread(2)).toBe(true);
      expect(createManifestDreadSummary(action, 2)).toEqual({
        playerId: 'p1',
        seenCardCount: 2,
        manifestedCardId: 'top-2',
        graveyardCount: 1,
        canManifest: true,
        evenIfImpossible: true,
      });
      expect(MANIFESTED_DREAD_EVEN_IF_IMPOSSIBLE).toBe(true);
      expect(manifestDread('p1').type).toBe('manifest-dread');
    });
  });
});