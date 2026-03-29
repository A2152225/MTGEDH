import { describe, expect, it } from 'vitest';
import {
  miracle,
  markAsFirstCardDrawn,
  canUseMiracle,
  canCastMiracleFromZone,
  resolveMiracleCast,
  soulbond,
  pairCreatures,
  canPair,
  canPairWithTarget,
  getPairedCreature,
  resolveSoulbondPairing,
  unpairCreatures,
  evolve,
  shouldTriggerEvolve,
  getEvolutionCount,
  getEvolveStatComparison,
  resolveEvolve,
  fuse,
  castFused,
  isFused,
  canCastFused,
  getFusedCost,
  createFuseCastResult,
  tribute,
  payTribute,
  declineTribute,
  wasTributePaid,
  getTributeAmount,
  getTributeCounters,
  shouldTriggerTributeFallback,
  createTributeResolution,
  dethrone,
  shouldTriggerDethrone,
  getDethroneCounters,
  getHighestLifeTotal,
  getEligibleDethroneLifeTotals,
  createDethroneResolution,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 21 (remaining Part 6 Batch 1/2 trigger-state helpers)', () => {
  describe('Miracle (702.94)', () => {
    it('should only cast for miracle from hand after being the first card drawn', () => {
      const enabled = markAsFirstCardDrawn(miracle('terminus', '{W}'));

      expect(canUseMiracle(enabled)).toBe(true);
      expect(canCastMiracleFromZone('hand', enabled)).toBe(true);
      expect(canCastMiracleFromZone('graveyard', enabled)).toBe(false);
    });

    it('should create a miracle cast result with the miracle cost', () => {
      const enabled = markAsFirstCardDrawn(miracle('temporal-mastery', '{1}{U}'));

      expect(resolveMiracleCast(enabled)).toEqual({
        source: 'temporal-mastery',
        usedMiracle: true,
        costPaid: '{1}{U}',
      });
    });
  });

  describe('Soulbond (702.95)', () => {
    it('should only pair with another unpaired creature', () => {
      const ability = soulbond('silverblade-paladin');

      expect(canPair(ability)).toBe(true);
      expect(canPairWithTarget(ability, true, 'other-creature')).toBe(true);
      expect(canPairWithTarget(ability, false, 'other-creature')).toBe(false);
      expect(canPairWithTarget(ability, true, 'silverblade-paladin')).toBe(false);
    });

    it('should expose and clear the paired creature correctly', () => {
      const paired = pairCreatures(soulbond('trusted-forcemage'), 'ally-creature');
      const unpaired = unpairCreatures(paired);

      expect(getPairedCreature(paired)).toBe('ally-creature');
      expect(resolveSoulbondPairing(paired)).toEqual({
        source: 'trusted-forcemage',
        pairedWith: 'ally-creature',
        soulbondActive: true,
      });
      expect(resolveSoulbondPairing(unpaired)).toBeNull();
    });
  });

  describe('Evolve (702.100)', () => {
    it('should report whether power and toughness increase independently', () => {
      const ability = evolve('experiment-one', [1, 1]);

      expect(getEvolveStatComparison(ability, [2, 1])).toEqual({ powerIncreases: true, toughnessIncreases: false });
      expect(getEvolveStatComparison(ability, [1, 3])).toEqual({ powerIncreases: false, toughnessIncreases: true });
      expect(getEvolveStatComparison(ability, [2, 3])).toEqual({ powerIncreases: true, toughnessIncreases: true });
    });

    it('should resolve evolve into one added counter and updated stats', () => {
      const ability = evolve('experiment-one', [1, 1]);

      expect(shouldTriggerEvolve(ability, [2, 1])).toBe(true);
      expect(resolveEvolve(ability, [2, 2])).toEqual({
        source: 'experiment-one',
        countersAdded: 1,
        newPowerToughness: [2, 2],
      });
    });
  });

  describe('Fuse (702.102)', () => {
    it('should only allow fused casting from hand when both halves can be paid', () => {
      expect(canCastFused('hand', true)).toBe(true);
      expect(canCastFused('hand', false)).toBe(false);
      expect(canCastFused('graveyard', true)).toBe(false);
    });

    it('should distinguish fused and single-half cast results', () => {
      const ability = fuse('wear-tear', '{1}{R}', '{W}');
      const fused = castFused(ability);

      expect(isFused(fused)).toBe(true);
      expect(getFusedCost(ability)).toBe('{1}{R} + {W}');
      expect(createFuseCastResult(ability, 'left')).toEqual({
        source: 'wear-tear',
        fused: false,
        halvesCast: ['left'],
        totalCost: '{1}{R}',
      });
      expect(createFuseCastResult(fused, 'fused')).toEqual({
        source: 'wear-tear',
        fused: true,
        halvesCast: ['left', 'right'],
        totalCost: '{1}{R} + {W}',
      });
    });
  });

  describe('Tribute (702.104)', () => {
    it('should convert tribute payment into counters and skip fallback triggers', () => {
      const paid = payTribute(tribute('oracle-of-bones', 2, 'opponent-a'));

      expect(wasTributePaid(paid)).toBe(true);
      expect(getTributeAmount(paid)).toBe(2);
      expect(getTributeCounters(paid)).toBe(2);
      expect(shouldTriggerTributeFallback(paid)).toBe(false);
      expect(createTributeResolution(paid)).toEqual({
        source: 'oracle-of-bones',
        opponent: 'opponent-a',
        tributePaid: true,
        countersAdded: 2,
      });
    });

    it('should leave counters at zero and enable fallback text if tribute is declined', () => {
      const declined = declineTribute(tribute('snake-of-the-golden-grove', 3, 'opponent-a'));

      expect(getTributeCounters(declined)).toBe(0);
      expect(shouldTriggerTributeFallback(declined)).toBe(true);
    });
  });

  describe('Dethrone (702.105)', () => {
    it('should identify the highest life total and all eligible defenders', () => {
      expect(getHighestLifeTotal([18, 25, 25, 10])).toBe(25);
      expect(getEligibleDethroneLifeTotals([18, 25, 25, 10])).toEqual([25, 25]);
    });

    it('should create a counter result only when attacking the highest-life player', () => {
      const ability = dethrone('marchesa-agent');

      expect(shouldTriggerDethrone(25, [18, 25, 25, 10])).toBe(true);
      expect(getDethroneCounters(ability)).toBe(0);
      expect(createDethroneResolution(ability, true)).toEqual({
        source: 'marchesa-agent',
        triggered: true,
        countersPut: 1,
      });
      expect(createDethroneResolution(ability, false)).toEqual({
        source: 'marchesa-agent',
        triggered: false,
        countersPut: 0,
      });
    });
  });
});