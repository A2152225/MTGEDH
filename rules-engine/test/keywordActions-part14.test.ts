import { describe, expect, it } from 'vitest';
import {
  canFailToFindInZone,
  canShuffleLibrary,
  completeSearch,
  createExileResult,
  createRevealSummary,
  createSearchResult,
  createShuffleResult,
  exileObject,
  isFaceDownExile,
  isPublicShuffleSource,
  isPublicZone,
  revealCards,
  revealDoesNotMoveCard,
  searchZone,
  shuffleCardsIntoLibrary,
  shuffleLibrary,
  shouldShuffle,
  usesLinkedExileZone,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 14 (core discovery and library summaries)', () => {
  describe('Rule 701.13: Exile', () => {
    it('should summarize face-down exile and linked exile zones', () => {
      const action = exileObject('card-1', 'library', {
        faceDown: true,
        exileZoneId: 'exiled-with-source-1',
      });

      expect(isFaceDownExile(action)).toBe(true);
      expect(usesLinkedExileZone(action)).toBe(true);
      expect(createExileResult(action)).toEqual({
        objectId: 'card-1',
        fromZone: 'library',
        destinationZone: 'exile',
        faceDown: true,
        usesLinkedExileZone: true,
        exileZoneId: 'exiled-with-source-1',
      });
    });
  });

  describe('Rule 701.20: Reveal', () => {
    it('should summarize reveals from hidden zones while preserving library order', () => {
      const action = revealCards('p1', ['card-1', 'card-2'], 'library');

      expect(revealDoesNotMoveCard()).toBe(true);
      expect(createRevealSummary(action)).toEqual({
        playerId: 'p1',
        cardCount: 2,
        fromZone: 'library',
        fromHiddenZone: true,
        maintainOrder: true,
      });
    });
  });

  describe('Rule 701.23: Search', () => {
    it('should summarize hidden-zone searches and fail-to-find availability', () => {
      const search = searchZone('p1', 'library', { cardType: 'land', maxResults: 1 }, { revealFound: true });
      const completed = completeSearch(search, ['land-1']);

      expect(canFailToFindInZone('library')).toBe(true);
      expect(isPublicZone('graveyard')).toBe(true);
      expect(createSearchResult(completed)).toEqual({
        playerId: 'p1',
        zone: 'library',
        foundCount: 1,
        publicZone: false,
        canFailToFind: true,
        revealFound: true,
        failToFind: false,
      });
    });
  });

  describe('Rule 701.24: Shuffle', () => {
    it('should summarize full-library shuffles and public-zone shuffle-ins', () => {
      const shuffle = shuffleLibrary('p1');
      const shuffleIn = shuffleCardsIntoLibrary('p1', ['card-1'], 'graveyard');

      expect(canShuffleLibrary(true)).toBe(true);
      expect(shouldShuffle(['card-1'], ['card-1'])).toBe(true);
      expect(isPublicShuffleSource('graveyard')).toBe(true);
      expect(createShuffleResult(shuffleIn, true, 'graveyard', ['card-1'])).toEqual({
        playerId: 'p1',
        zone: 'library',
        libraryExists: true,
        shufflesSpecificCards: true,
        sourceZoneWasPublic: true,
      });
      expect(shuffle.zone).toBe('library');
    });
  });
});