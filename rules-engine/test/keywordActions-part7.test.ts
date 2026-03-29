/**
 * Tests for keyword actions covering the remaining Part 7 action slice.
 */

import { describe, expect, it } from 'vitest';
import {
  advanceRingTemptation,
  canCastDiscoveredCard,
  canChooseRingBearer,
  canCloakFromZone,
  canOpenAttraction,
  canTransformIncubator,
  cloak,
  CLOAK_ONE_AT_A_TIME,
  CLOAKED_CHARACTERISTICS,
  completeDiscover,
  completeOpenAttraction,
  completeRollVisit,
  createCloakedPermanent,
  createIncubatorToken,
  createRingBearerState,
  discover,
  DISCOVERED_EVEN_IF_IMPOSSIBLE,
  findDiscoveredCard,
  getDiscoverBottomedCards,
  getIncubateCounterCount,
  getRingAbilities,
  getVisitedAttractions,
  hasOpenedAttraction,
  incubate,
  INCUBATOR_TOKEN,
  isDiscoveredCard,
  isDiscoverHit,
  isValidVisitRoll,
  isYourRingBearer,
  openAttraction,
  ringTemptsYou,
  rollToVisitAttractions,
  TRIGGERS_WHEN_OPENING,
  TRIGGERS_WHEN_RING_TEMPTS,
  VISIT_DIE_SIDES,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 7 Slice', () => {
  describe('Rule 701.51: Open an Attraction', () => {
    it('should open an attraction only in attraction games and track the opened card', () => {
      const action = openAttraction('p1');
      const completed = completeOpenAttraction('p1', 'attraction-1');

      expect(canOpenAttraction(true)).toBe(true);
      expect(canOpenAttraction(false)).toBe(false);
      expect(action.type).toBe('open-attraction');
      expect(hasOpenedAttraction(completed)).toBe(true);
      expect(TRIGGERS_WHEN_OPENING).toBe(true);
    });
  });

  describe('Rule 701.52: Roll to Visit Your Attractions', () => {
    it('should validate die rolls and identify matching visited attractions', () => {
      const action = rollToVisitAttractions('p1');
      const completed = completeRollVisit('p1', 4, ['a2']);

      expect(action.type).toBe('roll-visit-attractions');
      expect(VISIT_DIE_SIDES).toBe(6);
      expect(isValidVisitRoll(4)).toBe(true);
      expect(isValidVisitRoll(7)).toBe(false);
      expect(getVisitedAttractions([
        { id: 'a1', litNumbers: [2, 6] },
        { id: 'a2', litNumbers: [4] },
      ], 4)).toEqual(['a2']);
      expect(completed.visitedAttractions).toEqual(['a2']);
    });
  });

  describe('Rule 701.53: Incubate', () => {
    it('should create an incubator token with counters and a transformable back face', () => {
      const action = incubate('p1', 3);
      const token = createIncubatorToken('incubator-1', 'p1', 3);

      expect(action.type).toBe('incubate');
      expect(getIncubateCounterCount(3)).toBe(3);
      expect(getIncubateCounterCount(-2)).toBe(0);
      expect(String(token.card.type_line)).toContain('Incubator');
      expect(token.counters['+1/+1']).toBe(3);
      expect(token.backFace.type_line).toContain('Phyrexian');
      expect(canTransformIncubator(token, 2)).toBe(true);
      expect(canTransformIncubator(token, 1)).toBe(false);
      expect(INCUBATOR_TOKEN.frontFace.subtypes).toContain('Incubator');
    });
  });

  describe('Rule 701.54: The Ring Tempts You', () => {
    it('should track ring-bearer choices and unlock ability layers by temptation count', () => {
      const action = ringTemptsYou('p1', 'creature-1', 2);
      const state = createRingBearerState('p1', 'creature-1', 1);
      const advanced = advanceRingTemptation(state, 'creature-2');

      expect(action.type).toBe('ring-tempts-you');
      expect(canChooseRingBearer({ controller: 'p1', card: { type_line: 'Creature — Halfling' } }, 'p1')).toBe(true);
      expect(canChooseRingBearer({ controller: 'p2', card: { type_line: 'Creature — Orc' } }, 'p1')).toBe(false);
      expect(getRingAbilities(1)).toHaveLength(1);
      expect(getRingAbilities(4)).toHaveLength(4);
      expect(isYourRingBearer('creature-2', 'p1', advanced)).toBe(true);
      expect(TRIGGERS_WHEN_RING_TEMPTS).toBe(true);
    });
  });

  describe('Rule 701.57: Discover', () => {
    it('should find the first legal discover hit and separate the bottomed cards', () => {
      const action = discover('p1', 4);
      const exiled = [
        { id: 'land-1', type_line: 'Basic Land — Forest', cmc: 0 },
        { id: 'big-1', type_line: 'Creature — Dinosaur', cmc: 8 },
        { id: 'hit-1', type_line: 'Instant', cmc: 2 },
      ];
      const hit = findDiscoveredCard(exiled, 4);
      const completed = completeDiscover('p1', 4, 'hit-1', false, exiled.map((card) => card.id));

      expect(action.type).toBe('discover');
      expect(DISCOVERED_EVEN_IF_IMPOSSIBLE).toBe(true);
      expect(isDiscoveredCard(2, 4)).toBe(true);
      expect(isDiscoverHit(exiled[0], 4)).toBe(false);
      expect(hit?.id).toBe('hit-1');
      expect(canCastDiscoveredCard(hit!, 4)).toBe(true);
      expect(getDiscoverBottomedCards(exiled, 'hit-1').map((card) => card.id)).toEqual(['land-1', 'big-1']);
      expect(completed.discoveredCardId).toBe('hit-1');
    });
  });

  describe('Rule 701.58: Cloak', () => {
    it('should create a cloaked permanent with ward metadata and hidden face-up card data', () => {
      const action = cloak('p1', ['card-1'], 'library');
      const cloaked = createCloakedPermanent(
        'perm-1',
        { id: 'card-1', name: 'Air Elemental', type_line: 'Creature — Elemental', mana_cost: '{3}{U}{U}' },
        'p1',
        'p1',
      );

      expect(action.type).toBe('cloak');
      expect(canCloakFromZone('library')).toBe(true);
      expect(canCloakFromZone('battlefield')).toBe(false);
      expect(CLOAK_ONE_AT_A_TIME).toBe(true);
      expect(CLOAKED_CHARACTERISTICS.ward).toBe(2);
      expect(cloaked.card.faceDown).toBe(true);
      expect(cloaked.card.wardCost).toBe('{2}');
      expect(cloaked.faceUpCard.id).toBe('card-1');
      expect(cloaked.basePower).toBe(2);
      expect(cloaked.baseToughness).toBe(2);
    });
  });
});