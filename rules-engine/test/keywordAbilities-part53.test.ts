import { describe, expect, it } from 'vitest';
import {
  createDethroneSummary,
  createEvolveSummary,
  createMiracleSummary,
  createSoulbondSummary,
  createTributeSummary,
  dethrone,
  evolve,
  hiddenAgenda,
  markAsFirstCardDrawn,
  miracle,
  payTribute,
  soulbond,
  tribute,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 53 (Part 21 summaries)', () => {
  describe('Miracle (702.94)', () => {
    it('should summarize first-draw access and miracle casting from hand', () => {
      expect(createMiracleSummary(markAsFirstCardDrawn(miracle('terminus', '{W}')), 'hand')).toEqual({
        source: 'terminus',
        miracleCost: '{W}',
        canUseMiracle: true,
        canCastFromZone: true,
        usedMiracle: true,
      });
    });
  });

  describe('Soulbond (702.95)', () => {
    it('should summarize pairing eligibility and active pair state', () => {
      expect(createSoulbondSummary(soulbond('trusted-forcemage'), true, 'ally-creature')).toEqual({
        source: 'trusted-forcemage',
        canPair: true,
        canPairWithTarget: true,
        pairedWith: 'ally-creature',
        soulbondActive: true,
      });
    });
  });

  describe('Evolve (702.100)', () => {
    it('should summarize stat comparisons and trigger status', () => {
      expect(createEvolveSummary(evolve('experiment-one', [1, 1]), [2, 3])).toEqual({
        source: 'experiment-one',
        triggers: true,
        evolutionCount: 1,
        powerIncreases: true,
        toughnessIncreases: true,
      });
    });
  });

  describe('Tribute (702.104)', () => {
    it('should summarize tribute payment, counters, and fallback state', () => {
      expect(createTributeSummary(payTribute(tribute('oracle-of-bones', 2, 'opponent-a')))).toEqual({
        source: 'oracle-of-bones',
        opponent: 'opponent-a',
        tributeAmount: 2,
        tributePaid: true,
        countersAdded: 2,
        fallbackTriggers: false,
      });
    });
  });

  describe('Dethrone (702.105)', () => {
    it('should summarize highest-life targeting and counter output', () => {
      expect(createDethroneSummary(dethrone('marchesa-agent'), 25, [18, 25, 25, 10])).toEqual({
        source: 'marchesa-agent',
        defendingPlayerLife: 25,
        highestLifeTotal: 25,
        triggers: true,
        countersPut: 1,
      });
    });
  });
});