import { describe, expect, it } from 'vitest';
import {
  buyback,
  payBuyback,
  shouldBuybackReturnToHand,
  canCastWithBuyback,
  createBuybackCastResult,
  createBuybackResolutionResult,
  shadow,
  canBlockWithShadow,
  canBeBlockedByShadow,
  isShadowCombatLegal,
  createShadowCombatResult,
  cycling,
  typecycling,
  canActivateCycling,
  createCyclingActivationResult,
  canActivateTypecycling,
  createTypecyclingActivationResult,
  echo,
  doesEchoTrigger,
  createEchoUpkeepResult,
  morph,
  morphCastFaceDown,
  morphTurnFaceUp,
  getFaceDownStats,
  canCastMorphFaceDown,
  createMorphCastResult,
  createMorphTurnFaceUpResult,
  megamorph,
  createMegamorphTurnFaceUpResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 30 (remaining Part 2 cast and combat helpers)', () => {
  describe('Buyback (702.27)', () => {
    it('should only create a buyback cast result from hand after the cost is paid', () => {
      const paid = payBuyback(buyback('capsize', '{3}'));

      expect(canCastWithBuyback(paid, 'hand')).toBe(true);
      expect(canCastWithBuyback(paid, 'graveyard')).toBe(false);
      expect(createBuybackCastResult(paid, 'hand')).toEqual({
        source: 'capsize',
        fromZone: 'hand',
        additionalCostPaid: '{3}',
        usedBuyback: true,
      });
    });

    it('should summarize the post-resolution destination based on payment', () => {
      expect(shouldBuybackReturnToHand(payBuyback(buyback('capsize', '{3}')))).toBe(true);
      expect(createBuybackResolutionResult(buyback('whispers-of-the-muse', '{5}'))).toEqual({
        source: 'whispers-of-the-muse',
        destination: 'graveyard',
      });
      expect(createBuybackResolutionResult(payBuyback(buyback('whispers-of-the-muse', '{5}')))).toEqual({
        source: 'whispers-of-the-muse',
        destination: 'hand',
      });
    });
  });

  describe('Shadow (702.28)', () => {
    it('should keep shadow blocking legality symmetric', () => {
      shadow('soltari-priest');

      expect(canBlockWithShadow(true, true)).toBe(true);
      expect(canBeBlockedByShadow(true, true)).toBe(true);
      expect(isShadowCombatLegal(true, true)).toBe(true);
      expect(isShadowCombatLegal(true, false)).toBe(false);
      expect(isShadowCombatLegal(false, true)).toBe(false);
    });

    it('should create a combat summary only for legal shadow blocks', () => {
      expect(createShadowCombatResult('attacker', 'blocker', true, true)).toEqual({
        attacker: 'attacker',
        blocker: 'blocker',
        legalBlock: true,
      });
      expect(createShadowCombatResult('attacker', 'blocker', true, false)).toBeNull();
    });
  });

  describe('Cycling (702.29)', () => {
    it('should only activate cycling and typecycling from hand', () => {
      const ability = cycling('decree-of-justice', '{2}');
      const typeAbility = typecycling('ash-barrens', '{1}', 'Plains');

      expect(canActivateCycling(ability, 'hand')).toBe(true);
      expect(canActivateCycling(ability, 'graveyard')).toBe(false);
      expect(canActivateTypecycling(typeAbility, 'hand')).toBe(true);
      expect(canActivateTypecycling(typeAbility, 'battlefield')).toBe(false);
    });

    it('should create distinct draw and search summaries for cycling variants', () => {
      expect(createCyclingActivationResult(cycling('decree-of-justice', '{2}'), 'hand')).toEqual({
        source: 'decree-of-justice',
        fromZone: 'hand',
        costPaid: '{2}',
        cardsDrawn: 1,
      });
      expect(createTypecyclingActivationResult(typecycling('ash-barrens', '{1}', 'Plains'), 'hand')).toEqual({
        source: 'ash-barrens',
        fromZone: 'hand',
        costPaid: '{1}',
        searchLandType: 'Plains',
      });
    });
  });

  describe('Echo (702.30)', () => {
    it('should trigger only on the first upkeep after gaining control', () => {
      const ability = echo('crater-hellion', '{4}{R}{R}', 1);

      expect(doesEchoTrigger(ability, 2, 1)).toBe(true);
      expect(doesEchoTrigger(ability, 2, 2)).toBe(false);
    });

    it('should summarize whether the permanent will be sacrificed if echo is unpaid', () => {
      const ability = echo('crater-hellion', '{4}{R}{R}', 1);

      expect(createEchoUpkeepResult(ability, 2, 1, false)).toEqual({
        source: 'crater-hellion',
        cost: '{4}{R}{R}',
        triggered: true,
        shouldSacrifice: true,
      });
      expect(createEchoUpkeepResult(ability, 2, 1, true)).toEqual({
        source: 'crater-hellion',
        cost: '{4}{R}{R}',
        triggered: true,
        shouldSacrifice: false,
      });
    });
  });

  describe('Morph (702.37)', () => {
    it('should cast morph face down from hand and keep 2/2 face-down stats', () => {
      const ability = morph('battering-kraghorn', '{4}{R}');
      const faceDown = morphCastFaceDown(ability);

      expect(canCastMorphFaceDown(ability, 'hand')).toBe(true);
      expect(canCastMorphFaceDown(ability, 'graveyard')).toBe(false);
      expect(getFaceDownStats()).toEqual({ power: 2, toughness: 2 });
      expect(createMorphCastResult(ability, 'hand')).toEqual({
        source: 'battering-kraghorn',
        fromZone: 'hand',
        castFaceDown: true,
        alternativeCostPaid: '{3}',
      });
      expect(faceDown.isFaceDown).toBe(true);
    });

    it('should summarize turning morph and megamorph face up', () => {
      const faceDownMorph = morphCastFaceDown(morph('willbender', '{1}{U}'));
      const faceDownMegamorph = { ...megamorph('icefeather-avens', '{1}{G}{U}'), isFaceDown: true };

      expect(morphTurnFaceUp(faceDownMorph).isFaceDown).toBe(false);
      expect(createMorphTurnFaceUpResult(faceDownMorph)).toEqual({
        source: 'willbender',
        costPaid: '{1}{U}',
        turnedFaceUp: true,
      });
      expect(createMegamorphTurnFaceUpResult(faceDownMegamorph)).toEqual({
        source: 'icefeather-avens',
        costPaid: '{1}{G}{U}',
        turnedFaceUp: true,
        plusOnePlusOneCountersAdded: 1,
      });
    });
  });
});