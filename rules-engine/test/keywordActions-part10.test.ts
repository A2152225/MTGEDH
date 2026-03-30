import { describe, expect, it } from 'vitest';
import {
  adapt,
  AMASSED_EVEN_IF_IMPOSSIBLE,
  amass,
  canExert,
  completeAmass,
  completeConnive,
  completeExplore,
  conniveN,
  createAdaptResult,
  createAmassResult,
  createConniveResult,
  createExertResult,
  createExertedState,
  createExploreResult,
  createLearnResult,
  createVentureResult,
  createsExploreCounter,
  exert,
  EXPLORES_EVEN_IF_IMPOSSIBLE,
  getAdaptCounters,
  getConniveCounterCount,
  hasExertUntapRestriction,
  isAdaptLocked,
  learnWithDiscard,
  learnWithLesson,
  needsArmyToken,
  normalizeAmassSubtype,
  startsNewDungeon,
  usesLessonFallback,
  ventureCompleteDungeon,
  ventureFirstTime,
  ventureToNextRoom,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 10 (part-6 focused action summaries)', () => {
  describe('Rule 701.43: Exert', () => {
    it('should allow exerting any battlefield permanent and track the untap restriction state', () => {
      const state = createExertedState('perm-1', 'p1');

      expect(canExert({ isOnBattlefield: true, isTapped: false, isAlreadyExerted: true })).toBe(true);
      expect(canExert({ isOnBattlefield: false })).toBe(false);
      expect(hasExertUntapRestriction(state)).toBe(true);
    });

    it('should summarize a legal exert action into an untap-restriction result', () => {
      expect(createExertResult(exert('perm-1', 'p1'), true, 1)).toEqual({
        permanentId: 'perm-1',
        controllerId: 'p1',
        legal: true,
        appliesUntapRestriction: true,
        exertCount: 1,
      });
    });
  });

  describe('Rule 701.44: Explore', () => {
    it('should distinguish land explores from nonland explores that add counters', () => {
      expect(createsExploreCounter(true)).toBe(false);
      expect(createsExploreCounter(false)).toBe(true);
      expect(EXPLORES_EVEN_IF_IMPOSSIBLE).toBe(true);
    });

    it('should summarize whether explore puts a land in hand or a nonland into the graveyard choice flow', () => {
      expect(createExploreResult(completeExplore('perm-1', 'p1', 'card-1', false, true))).toEqual({
        permanentId: 'perm-1',
        controllerId: 'p1',
        revealedCardId: 'card-1',
        putsLandIntoHand: false,
        addsCounter: true,
        mayPutCardIntoGraveyard: true,
      });
    });
  });

  describe('Rule 701.46: Adapt', () => {
    it('should lock adapt when the permanent already has +1/+1 counters', () => {
      expect(isAdaptLocked(1)).toBe(true);
      expect(isAdaptLocked(0)).toBe(false);
      expect(getAdaptCounters(3, 0)).toBe(3);
      expect(getAdaptCounters(3, 2)).toBe(0);
    });

    it('should summarize whether adapt actually adds counters', () => {
      expect(createAdaptResult(adapt('perm-1', 3, 0))).toEqual({
        permanentId: 'perm-1',
        requestedCounters: 3,
        countersAdded: 3,
        hadCounters: false,
        adaptsSuccessfully: true,
      });
    });
  });

  describe('Rule 701.47: Amass', () => {
    it('should default subtype text and detect when a fresh Army token is needed', () => {
      expect(normalizeAmassSubtype()).toBe('Zombies');
      expect(normalizeAmassSubtype('Goblins')).toBe('Goblins');
      expect(needsArmyToken(0)).toBe(true);
      expect(needsArmyToken(2)).toBe(false);
      expect(AMASSED_EVEN_IF_IMPOSSIBLE).toBe(true);
    });

    it('should summarize the chosen Army, subtype, and number of counters added', () => {
      expect(createAmassResult(completeAmass('p1', 'Orcs', 4, 'army-1', true))).toEqual({
        playerId: 'p1',
        subtype: 'Orcs',
        chosenArmyId: 'army-1',
        createdArmyToken: true,
        countersAdded: 4,
      });
      expect(amass('p1', 'Orcs', 4).type).toBe('amass');
    });
  });

  describe('Rule 701.48: Learn', () => {
    it('should distinguish the discard branch from the lesson fallback branch', () => {
      expect(usesLessonFallback(learnWithDiscard('p1', true, true))).toBe(false);
      expect(usesLessonFallback(learnWithLesson('p1', 'lesson-1'))).toBe(true);
    });

    it('should summarize whether learning discarded, drew, or revealed a Lesson', () => {
      expect(createLearnResult(learnWithLesson('p1', 'lesson-1'))).toEqual({
        playerId: 'p1',
        discardedCard: false,
        drewCard: false,
        tookLesson: true,
        revealedLesson: 'lesson-1',
      });
    });
  });

  describe('Rule 701.49: Venture into the Dungeon', () => {
    it('should recognize starting a dungeon and moving to a connected room', () => {
      expect(startsNewDungeon(ventureFirstTime('p1', 'Lost Mine of Phandelver'))).toBe(true);
      expect(startsNewDungeon(ventureToNextRoom('p1', 'Lost Mine of Phandelver', 'entrance', 'Goblin Lair'))).toBe(true);
    });

    it('should summarize room movement and completed-dungeon restarts', () => {
      expect(createVentureResult(ventureCompleteDungeon('p1', 'Tomb of Annihilation', 'Dungeon of the Mad Mage'))).toEqual({
        playerId: 'p1',
        dungeonName: 'Dungeon of the Mad Mage',
        enteredDungeon: true,
        movedRooms: false,
        completedDungeon: true,
        nextRoom: undefined,
      });
    });
  });

  describe('Rule 701.50: Connive', () => {
    it('should count only discarded nonland cards toward connive counters', () => {
      expect(getConniveCounterCount(0)).toBe(0);
      expect(getConniveCounterCount(2)).toBe(2);
    });

    it('should summarize draw, discard, and counter results for connive N', () => {
      expect(createConniveResult(completeConnive('perm-1', 'p1', 2, 3), true)).toEqual({
        permanentId: 'perm-1',
        controllerId: 'p1',
        drawnCards: 3,
        discardedCards: 3,
        countersAdded: 2,
        usesLastKnownInformation: true,
      });
      expect(conniveN('perm-1', 'p1', 3).type).toBe('connive');
    });
  });
});