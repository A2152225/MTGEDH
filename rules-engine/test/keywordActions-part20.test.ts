import { describe, expect, it } from 'vitest';
import {
  airbend,
  completeWaterbend,
  createAirbendResult,
  createBeholdAction,
  createBeholdResult,
  createEarthbendResult,
  createWaterbendResult,
  earthbend,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 20 (remaining lightweight and bend summaries)', () => {
  describe('Rule 701.4: Behold', () => {
    it('should summarize the chosen object and whether it satisfied the required quality', () => {
      expect(createBeholdResult(createBeholdAction('p1', 'legendary', 'chosen-permanent', 'perm-1'), true)).toEqual({
        playerId: 'p1',
        quality: 'legendary',
        objectId: 'perm-1',
        usedPermanent: true,
        satisfiedQuality: true,
      });
    });
  });

  describe('Rule 701.65: Airbend', () => {
    it('should summarize the number of exiled objects and granted alternate cost', () => {
      expect(createAirbendResult(airbend('p1', ['card-1', 'spell-1']))).toEqual({
        playerId: 'p1',
        exiledObjectCount: 2,
        grantsAlternateCost: true,
        alternateCost: '{2}',
      });
    });
  });

  describe('Rule 701.66: Earthbend', () => {
    it('should summarize the animated land characteristics and delayed return rider', () => {
      expect(createEarthbendResult(earthbend('p1', 'land-1', 3))).toEqual({
        playerId: 'p1',
        landId: 'land-1',
        countersAdded: 3,
        becomesCreature: true,
        gainsHaste: true,
        returnsWhenDiesOrExiled: true,
      });
    });
  });

  describe('Rule 701.67: Waterbend', () => {
    it('should summarize tapped substitutions, remaining cost, and trigger status', () => {
      expect(createWaterbendResult(completeWaterbend('p1', '{3}{U}', ['artifact-1', 'creature-1'], '{1}{U}'))).toEqual({
        playerId: 'p1',
        originalCost: '{3}{U}',
        tappedPermanentCount: 2,
        remainingCost: '{1}{U}',
        manaPaid: '{1}{U}',
        triggersWaterbendAbilities: true,
      });
    });
  });
});