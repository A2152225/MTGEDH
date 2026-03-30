import { describe, expect, it } from 'vitest';
import {
  completeDiscover,
  completeOpenAttraction,
  completeRollVisit,
  createDiscoverResult,
  createOpenAttractionResult,
  createRingTemptationResult,
  createRollVisitAttractionsResult,
  ringTemptsYou,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 18 (remaining Part 7 result summaries)', () => {
  describe('Rule 701.51: Open an Attraction', () => {
    it('should summarize when an attraction was successfully opened and will trigger its opening text', () => {
      expect(createOpenAttractionResult(completeOpenAttraction('p1', 'attraction-1'))).toEqual({
        playerId: 'p1',
        attractionId: 'attraction-1',
        openedAttraction: true,
        triggersVisitAbilities: true,
      });
    });
  });

  describe('Rule 701.52: Roll to Visit Your Attractions', () => {
    it('should summarize valid rolls, visited attraction ids, and whether visit abilities trigger', () => {
      expect(createRollVisitAttractionsResult(completeRollVisit('p1', 4, ['a2', 'a4']))).toEqual({
        playerId: 'p1',
        rollResult: 4,
        validRoll: true,
        visitedAttractions: ['a2', 'a4'],
        visitedCount: 2,
        triggersVisitAbilities: true,
      });
    });
  });

  describe('Rule 701.54: The Ring Tempts You', () => {
    it('should summarize the newly chosen Ring-bearer and unlocked temptation tier', () => {
      expect(createRingTemptationResult(ringTemptsYou('p1', 'creature-2', 3), 'creature-1')).toEqual({
        playerId: 'p1',
        chosenRingBearer: 'creature-2',
        temptCount: 3,
        unlockedAbilityCount: 3,
        changedRingBearer: true,
      });
    });
  });

  describe('Rule 701.57: Discover', () => {
    it('should summarize the discovered card, cast choice, and number of bottomed cards', () => {
      expect(createDiscoverResult(
        completeDiscover('p1', 4, 'hit-1', false, ['land-1', 'big-1', 'hit-1']),
      )).toEqual({
        playerId: 'p1',
        maxManaValue: 4,
        discoveredCardId: 'hit-1',
        foundHit: true,
        castDiscoveredCard: false,
        bottomedCardCount: 2,
      });
    });
  });
});