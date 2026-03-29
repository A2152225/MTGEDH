import { describe, expect, it } from 'vitest';
import {
  splice,
  paySplice,
  wasSpliced,
  canSpliceOnto,
  getSpliceAdditionalCost,
  createSplicedSpell,
  recover,
  doesRecoverTrigger,
  resolveRecover,
  getRecoverDestination,
  auraSwap,
  isAuraCard,
  canActivateAuraSwap,
  canExchangeWithHandAura,
  performAuraSwap,
  transfigure,
  canActivateTransfigure,
  canFindTransfigureTarget,
  getTransfigureCandidates,
  resolveTransfigure,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 16 (legacy exchange and search helpers)', () => {
  describe('Splice (Rule 702.47)', () => {
    it('should only splice onto a matching subtype spell', () => {
      const ability = splice('glacial-ray', 'Arcane', '{1}{R}');

      expect(canSpliceOnto(ability, ['Arcane', 'Instant'])).toBe(true);
      expect(canSpliceOnto(ability, ['Instant', 'Sorcery'])).toBe(false);
    });

    it('should total the additional cost for paid splice abilities', () => {
      const first = paySplice(splice('glacial-ray', 'Arcane', '{1}{R}'));
      const second = paySplice(splice('evermind', 'Arcane', '{U}'));
      const unpaid = splice('desperate-ritual', 'Arcane', '{1}{R}');

      expect(wasSpliced(first)).toBe(true);
      expect(getSpliceAdditionalCost([first, second, unpaid])).toBe('{1}{R} + {U}');
      expect(getSpliceAdditionalCost([unpaid])).toBe('0');
    });

    it('should build a combined spliced spell record', () => {
      const result = createSplicedSpell('lava-spike', 'Deal 3 damage to any target.', [
        {
          ability: paySplice(splice('glacial-ray', 'Arcane', '{1}{R}')),
          rulesText: 'Glacial Ray deals 2 damage to any target.',
        },
        {
          ability: splice('evermind', 'Arcane', '{U}'),
          rulesText: 'Draw a card.',
        },
      ]);

      expect(result).toEqual({
        spellId: 'lava-spike',
        spliceSources: ['glacial-ray'],
        combinedRulesText: 'Deal 3 damage to any target.\nGlacial Ray deals 2 damage to any target.',
        additionalCost: '{1}{R}',
      });
    });
  });

  describe('Recover (Rule 702.59)', () => {
    it('should trigger only from your creature going to your graveyard while recover is in the graveyard', () => {
      expect(doesRecoverTrigger(true, true)).toBe(true);
      expect(doesRecoverTrigger(false, true)).toBe(false);
      expect(doesRecoverTrigger(true, false)).toBe(false);
    });

    it('should return to hand if the recover cost is paid', () => {
      const resolution = resolveRecover(recover('krovikan-rot', '{1}{B}{B}'), true);

      expect(resolution.recovered).toBe(true);
      expect(getRecoverDestination(resolution)).toBe('hand');
    });

    it('should be exiled if the recover cost is not paid', () => {
      const resolution = resolveRecover(recover('krovikan-rot', '{1}{B}{B}'), false);

      expect(resolution.recovered).toBe(false);
      expect(getRecoverDestination(resolution)).toBe('exile');
    });
  });

  describe('Aura Swap (Rule 702.65)', () => {
    it('should recognize aura cards and aura swap timing restrictions', () => {
      expect(isAuraCard('Enchantment - Aura')).toBe(true);
      expect(isAuraCard('Creature - Spirit')).toBe(false);
      expect(canActivateAuraSwap(true, true, true)).toBe(true);
      expect(canActivateAuraSwap(false, true, true)).toBe(false);
      expect(canActivateAuraSwap(true, false, true)).toBe(false);
    });

    it('should only exchange with an aura card from hand', () => {
      const ability = auraSwap('arcanum-wings', '{2}{U}');

      expect(canExchangeWithHandAura(ability, 'Enchantment - Aura')).toBe(true);
      expect(canExchangeWithHandAura(ability, 'Creature - Angel')).toBe(false);
    });

    it('should describe the battlefield-hand aura exchange', () => {
      expect(performAuraSwap('arcanum-wings', 'eldrazi-conscription')).toEqual({
        returnedAuraId: 'arcanum-wings',
        putOntoBattlefieldAuraId: 'eldrazi-conscription',
        exchangePerformed: true,
      });
    });
  });

  describe('Transfigure (Rule 702.71)', () => {
    it('should only activate at sorcery speed while on the battlefield', () => {
      expect(canActivateTransfigure(true, true, true)).toBe(true);
      expect(canActivateTransfigure(false, true, true)).toBe(false);
      expect(canActivateTransfigure(true, false, true)).toBe(false);
      expect(canActivateTransfigure(true, true, false)).toBe(false);
    });

    it('should filter targets by matching mana value', () => {
      const candidates = getTransfigureCandidates(4, [
        { id: 'faceless-butcher', manaValue: 4 },
        { id: 'shriekmaw', manaValue: 5 },
        { id: 'ravenous-chupacabra', manaValue: 4 },
      ]);

      expect(canFindTransfigureTarget(4, 4)).toBe(true);
      expect(canFindTransfigureTarget(4, 5)).toBe(false);
      expect(candidates.map(card => card.id)).toEqual(['faceless-butcher', 'ravenous-chupacabra']);
    });

    it('should resolve into a sacrifice-plus-search outcome', () => {
      const result = resolveTransfigure(transfigure('fleshwrither', '{1}{B}{B}'), 4, 'faceless-butcher');

      expect(result).toEqual({
        sacrificedSourceId: 'fleshwrither',
        selectedCardId: 'faceless-butcher',
        requiredManaValue: 4,
      });
    });
  });
});