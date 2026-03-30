import { describe, expect, it } from 'vitest';
import {
  auraSwap,
  createAuraSwapSummary,
  createRecoverSummary,
  createSpliceSummary,
  createTransfigureSummary,
  paySplice,
  performAuraSwap,
  recover,
  splice,
  transfigure,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 48 (Part 16 summaries)', () => {
  describe('Aura Swap (702.65)', () => {
    it('should summarize timing, exchange eligibility, and execution state', () => {
      expect(createAuraSwapSummary(
        auraSwap('arcanum-wings', '{2}{U}'),
        'Enchantment - Aura',
        true,
        true,
        true,
        performAuraSwap('arcanum-wings', 'eldrazi-conscription'),
      )).toEqual({
        source: 'arcanum-wings',
        cost: '{2}{U}',
        canActivate: true,
        canExchange: true,
        exchangePerformed: true,
      });
    });
  });

  describe('Recover (702.59)', () => {
    it('should summarize trigger conditions and final destination', () => {
      expect(createRecoverSummary(recover('krovikan-rot', '{1}{B}{B}'), true, true, false)).toEqual({
        source: 'krovikan-rot',
        recoverCost: '{1}{B}{B}',
        triggers: true,
        recovered: false,
        destination: 'exile',
      });
    });
  });

  describe('Splice (702.47)', () => {
    it('should summarize subtype compatibility and paid splice cost', () => {
      expect(createSpliceSummary(paySplice(splice('glacial-ray', 'Arcane', '{1}{R}')), ['Arcane', 'Instant'])).toEqual({
        source: 'glacial-ray',
        spliceOnto: 'Arcane',
        wasSpliced: true,
        canSpliceOntoSpell: true,
        additionalCost: '{1}{R}',
      });
    });
  });

  describe('Transfigure (702.71)', () => {
    it('should summarize activation timing and matching-search availability', () => {
      expect(createTransfigureSummary(
        transfigure('fleshwrither', '{1}{B}{B}'),
        4,
        [
          { id: 'faceless-butcher', manaValue: 4 },
          { id: 'shriekmaw', manaValue: 5 },
          { id: 'ravenous-chupacabra', manaValue: 4 },
        ],
        'faceless-butcher',
        true,
        true,
      )).toEqual({
        source: 'fleshwrither',
        transfigureCost: '{1}{B}{B}',
        canActivate: true,
        matchingTargetCount: 2,
        selectedCardId: 'faceless-butcher',
      });
    });
  });
});