import { describe, expect, it } from 'vitest';
import {
  evoke,
  payEvoke,
  wasEvoked,
  canCastWithEvoke,
  createEvokeCastResult,
  createEvokeSacrificeResult,
  hideaway,
  completeHideaway,
  getHideawayLookCount,
  createHideawayResolutionResult,
  prowl,
  payProwl,
  wasProwled,
  isProwlAvailable,
  canCastWithProwl,
  createProwlCastResult,
  reinforce,
  activateReinforce,
  canActivateReinforce,
  createReinforceActivationResult,
  conspire,
  payConspire,
  wasConspired,
  canPayConspireCost,
  createConspireCopyResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 26 (early Part 5 alt-cost and selection helpers)', () => {
  describe('Evoke (702.74)', () => {
    it('should only cast with evoke from hand and expose the alternative-cost result', () => {
      const ability = evoke('mulldrifter', '2U');

      expect(canCastWithEvoke(ability, 'hand')).toBe(true);
      expect(canCastWithEvoke(ability, 'graveyard')).toBe(false);
      expect(createEvokeCastResult(ability, 'hand')).toEqual({
        source: 'mulldrifter',
        fromZone: 'hand',
        alternativeCostPaid: '2U',
        usedEvoke: true,
      });
    });

    it('should create the sacrifice result only after the evoke cost was paid', () => {
      const paid = payEvoke(evoke('mulldrifter', '2U'));

      expect(wasEvoked(paid)).toBe(true);
      expect(createEvokeSacrificeResult(evoke('mulldrifter', '2U'))).toBeNull();
      expect(createEvokeSacrificeResult(paid)).toEqual({
        source: 'mulldrifter',
        shouldSacrifice: true,
      });
    });
  });

  describe('Hideaway (702.75)', () => {
    it('should cap the number of cards looked at by the current library size', () => {
      const ability = hideaway('mosswort-bridge');

      expect(getHideawayLookCount(ability, 10)).toBe(4);
      expect(getHideawayLookCount(ability, 2)).toBe(2);
    });

    it('should create a hideaway resolution summary once a card is exiled', () => {
      const resolved = completeHideaway(hideaway('mosswort-bridge'), 'lightning-bolt');

      expect(createHideawayResolutionResult(resolved, ['lightning-bolt', 'forest', 'mountain'])).toEqual({
        source: 'mosswort-bridge',
        lookedAtCount: 3,
        exiledCard: 'lightning-bolt',
        bottomedCards: ['forest', 'mountain'],
      });
    });
  });

  describe('Prowl (702.76)', () => {
    it('should match creature types case-insensitively for prowl availability', () => {
      const ability = prowl('morsel-theft', '2B');

      expect(isProwlAvailable(ability, ['Rogue'], ['rogue', 'Warrior'])).toBe(true);
      expect(isProwlAvailable(ability, ['Wizard'], ['rogue', 'Warrior'])).toBe(false);
    });

    it('should only create a prowl cast result from hand after matching combat damage', () => {
      const paid = payProwl(prowl('stinkdrinker-bandit', '1B'));

      expect(wasProwled(paid)).toBe(true);
      expect(canCastWithProwl(paid, 'hand', ['Rogue'], ['rogue'])).toBe(true);
      expect(createProwlCastResult(paid, 'hand', ['Rogue'], ['rogue'])).toEqual({
        source: 'stinkdrinker-bandit',
        fromZone: 'hand',
        alternativeCostPaid: '1B',
        usedProwl: true,
      });
    });
  });

  describe('Reinforce (702.77)', () => {
    it('should only activate from hand and preserve the existing counter count', () => {
      const ability = reinforce('hunting-triad', 3, '2G');

      expect(canActivateReinforce(ability, 'hand')).toBe(true);
      expect(canActivateReinforce(ability, 'battlefield')).toBe(false);
      expect(activateReinforce(ability, 'target-creature')).toBe(3);
    });

    it('should create a reinforce activation result with target and cost', () => {
      expect(createReinforceActivationResult(reinforce('hunting-triad', 3, '2G'), 'hand', 'ally-creature')).toEqual({
        source: 'hunting-triad',
        fromZone: 'hand',
        targetCreature: 'ally-creature',
        countersAdded: 3,
        costPaid: '2G',
      });
    });
  });

  describe('Conspire (702.78)', () => {
    it('should require exactly two creatures that share a color with the spell', () => {
      expect(canPayConspireCost(['c1', 'c2'], true)).toBe(true);
      expect(canPayConspireCost(['c1'], true)).toBe(false);
      expect(canPayConspireCost(['c1', 'c2'], false)).toBe(false);
    });

    it('should create the spell-copy result once the conspire cost is paid', () => {
      const paid = payConspire(conspire('incremental-blight'), ['creature1', 'creature2']);

      expect(wasConspired(paid)).toBe(true);
      expect(createConspireCopyResult(paid)).toEqual({
        source: 'incremental-blight',
        copied: true,
        tappedCreatures: ['creature1', 'creature2'],
      });
    });
  });
});