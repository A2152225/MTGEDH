import { describe, expect, it } from 'vitest';
import {
  storm,
  triggerStorm,
  getStormCopies,
  getStormCopyIds,
  createStormResolutionResult,
  affinity,
  calculateAffinityReduction,
  getAffinityReduction,
  getAffinityGenericManaRemaining,
  createAffinityCostResult,
  entwine,
  payEntwine,
  wasEntwined,
  canCastWithEntwine,
  createEntwineCastResult,
  offering,
  payOffering,
  getOfferingReduction,
  canCastWithOffering,
  createOfferingCastResult,
  ninjutsu,
  activateNinjutsu,
  canActivateNinjutsu,
  canActivateNinjutsuFromZone,
  createNinjutsuActivationResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 27 (Part 3 copy and alternative-cost helpers)', () => {
  describe('Storm (702.40)', () => {
    it('should expose copy IDs and the total number of storm copies created', () => {
      const triggered = triggerStorm(storm('tendrils-of-agony'), 3);

      expect(getStormCopies(triggered)).toBe(3);
      expect(getStormCopyIds(triggered)).toEqual([
        'tendrils-of-agony-storm-copy-1',
        'tendrils-of-agony-storm-copy-2',
        'tendrils-of-agony-storm-copy-3',
      ]);
    });

    it('should create a storm resolution summary', () => {
      const triggered = triggerStorm(storm('grapeshot'), 2);

      expect(createStormResolutionResult(triggered)).toEqual({
        source: 'grapeshot',
        copiesCreated: 2,
        copyIds: ['grapeshot-storm-copy-1', 'grapeshot-storm-copy-2'],
      });
    });
  });

  describe('Affinity (702.41)', () => {
    it('should reduce only the generic portion of a spell cost', () => {
      const calculated = calculateAffinityReduction(affinity('frogmite', 'artifacts'), 4);

      expect(getAffinityReduction(calculated)).toBe(4);
      expect(getAffinityGenericManaRemaining(6, calculated)).toBe(2);
      expect(getAffinityGenericManaRemaining(2, calculated)).toBe(0);
    });

    it('should create a capped affinity cost summary', () => {
      const calculated = calculateAffinityReduction(affinity('thoughtcast', 'artifacts'), 5);

      expect(createAffinityCostResult(calculated, 3)).toEqual({
        source: 'thoughtcast',
        affinityFor: 'artifacts',
        reducedBy: 3,
        genericManaRemaining: 0,
      });
    });
  });

  describe('Entwine (702.42)', () => {
    it('should only matter for modal spells with more than one mode', () => {
      const ability = entwine('tooth-and-nail', '{2}');

      expect(canCastWithEntwine(ability, 2)).toBe(true);
      expect(canCastWithEntwine(ability, 1)).toBe(false);
      expect(wasEntwined(payEntwine(ability))).toBe(true);
    });

    it('should create an entwine cast result after the cost is paid', () => {
      const paid = payEntwine(entwine('tooth-and-nail', '{2}'));

      expect(createEntwineCastResult(paid, 2)).toEqual({
        source: 'tooth-and-nail',
        additionalCostPaid: '{2}',
        modesChosen: 'all',
      });
      expect(createEntwineCastResult(paid, 1)).toBeNull();
    });
  });

  describe('Offering (702.48)', () => {
    it('should require a matching creature type and hand-zone access', () => {
      const paid = payOffering(offering('patron-of-the-orochi', 'Snake'), 'snake-1');

      expect(getOfferingReduction(4)).toBe(4);
      expect(canCastWithOffering(paid, 'hand', 'snake-1', ['Snake', 'Shaman'])).toBe(true);
      expect(canCastWithOffering(paid, 'battlefield', 'snake-1', ['Snake'])).toBe(false);
      expect(canCastWithOffering(paid, 'hand', 'snake-1', ['Goblin'])).toBe(false);
    });

    it('should create an offering cast result using the sacrificed creature data', () => {
      const paid = payOffering(offering('patron-of-the-orochi', 'Snake'), 'snake-1');

      expect(createOfferingCastResult(paid, 'hand', ['Snake', 'Shaman'], 4)).toEqual({
        source: 'patron-of-the-orochi',
        fromZone: 'hand',
        sacrificedCreature: 'snake-1',
        reducedBy: 4,
      });
    });
  });

  describe('Ninjutsu (702.49)', () => {
    it('should require hand-zone access plus an unblocked attacker in combat', () => {
      const ability = ninjutsu('ninja-of-the-deep-hours', '{1}{U}');

      expect(canActivateNinjutsu(true, true)).toBe(true);
      expect(canActivateNinjutsuFromZone(ability, 'hand', true, true)).toBe(true);
      expect(canActivateNinjutsuFromZone(ability, 'battlefield', true, true)).toBe(false);
      expect(canActivateNinjutsuFromZone(ability, 'hand', false, true)).toBe(false);
    });

    it('should create a ninjutsu activation summary with the returned attacker', () => {
      const activated = activateNinjutsu(ninjutsu('ninja-of-the-deep-hours', '{1}{U}'), 'faerie-seer');

      expect(createNinjutsuActivationResult(activated, 'hand', true, true, activated.returnedCreature)).toEqual({
        source: 'ninja-of-the-deep-hours',
        fromZone: 'hand',
        returnedCreature: 'faerie-seer',
        activationCostPaid: '{1}{U}',
      });
    });
  });
});