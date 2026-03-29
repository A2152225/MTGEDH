import { describe, expect, it } from 'vitest';
import {
  bloodthirst,
  canApplyBloodthirst,
  createBloodthirstResolution,
  getBloodthirstCounters,
  isBloodthirstRedundant,
  resolveBloodthirst,
  battleCry,
  shouldTriggerBattleCry,
  getBattleCryBonus,
  getBattleCryAffectedAttackers,
  createBattleCryBonuses,
  areBattleCryAbilitiesRedundant,
  poisonous,
  shouldTriggerPoisonous,
  getPoisonCounters,
  resolvePoisonous,
  getCombinedPoisonousCounters,
  flanking,
  doesFlankingTrigger,
  shouldTriggerFlanking,
  calculateFlankingPenalty,
  getFlankingPenaltyForAbilities,
  rampage,
  calculateRampageBonus,
  shouldTriggerRampage,
  getRampageStatBonus,
  combinedRampageBonus,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 18 (combat pressure helpers)', () => {
  describe('Bloodthirst (Rule 702.54)', () => {
    it('should only apply if an opponent was dealt damage this turn', () => {
      const ability = bloodthirst('rakdos-guildmage', 2);
      const applied = resolveBloodthirst(ability, true);
      const notApplied = resolveBloodthirst(ability, false);

      expect(canApplyBloodthirst(true)).toBe(true);
      expect(canApplyBloodthirst(false)).toBe(false);
      expect(getBloodthirstCounters(applied)).toBe(2);
      expect(getBloodthirstCounters(notApplied)).toBe(0);
    });

    it('should build a resolved bloodthirst outcome', () => {
      const result = createBloodthirstResolution(bloodthirst('skarrgan-pit-skulk', 1), true);

      expect(result).toEqual({
        source: 'skarrgan-pit-skulk',
        eligible: true,
        countersAdded: 1,
      });
      expect(isBloodthirstRedundant()).toBe(false);
    });
  });

  describe('Battle Cry (Rule 702.91)', () => {
    it('should trigger when the source creature attacks', () => {
      expect(shouldTriggerBattleCry(true)).toBe(true);
      expect(shouldTriggerBattleCry(false)).toBe(false);
    });

    it('should affect each other attacking creature but not the source', () => {
      expect(getBattleCryAffectedAttackers('hero-of-bladehold', [
        'hero-of-bladehold',
        'soldier-1',
        'soldier-2',
      ])).toEqual(['soldier-1', 'soldier-2']);

      expect(Array.from(createBattleCryBonuses('hero-of-bladehold', [
        'hero-of-bladehold',
        'soldier-1',
        'soldier-2',
      ]).entries())).toEqual([
        ['soldier-1', { power: 1, toughness: 0 }],
        ['soldier-2', { power: 1, toughness: 0 }],
      ]);

      expect(getBattleCryBonus()).toEqual({ power: 1, toughness: 0 });
      expect(areBattleCryAbilitiesRedundant(battleCry('hero-1'), battleCry('hero-2'))).toBe(false);
    });
  });

  describe('Poisonous (Rule 702.70)', () => {
    it('should trigger only from combat damage to a player', () => {
      expect(shouldTriggerPoisonous(true)).toBe(true);
      expect(shouldTriggerPoisonous(false)).toBe(false);
    });

    it('should resolve the poison counters given and stack multiple instances', () => {
      const first = poisonous('virulent-sliver', 1);
      const second = poisonous('snake-cult-initiation', 3);

      expect(getPoisonCounters(first)).toBe(1);
      expect(resolvePoisonous(second, 'player-b')).toEqual({
        source: 'snake-cult-initiation',
        defendingPlayerId: 'player-b',
        poisonCounters: 3,
      });
      expect(getCombinedPoisonousCounters([first, second])).toBe(4);
    });
  });

  describe('Flanking (Rule 702.25)', () => {
    it('should only trigger for actual blockers without flanking', () => {
      expect(doesFlankingTrigger(false)).toBe(true);
      expect(doesFlankingTrigger(true)).toBe(false);
      expect(shouldTriggerFlanking(false, true)).toBe(true);
      expect(shouldTriggerFlanking(false, false)).toBe(false);
      expect(shouldTriggerFlanking(true, true)).toBe(false);
    });

    it('should accumulate the correct stat penalty from multiple instances', () => {
      expect(calculateFlankingPenalty(2)).toEqual({ power: -2, toughness: -2 });
      expect(getFlankingPenaltyForAbilities([
        flanking('creature-1'),
        flanking('creature-1'),
        flanking('creature-1'),
      ])).toEqual({ power: -3, toughness: -3 });
    });
  });

  describe('Rampage (Rule 702.23)', () => {
    it('should trigger when the creature becomes blocked', () => {
      expect(shouldTriggerRampage(0)).toBe(false);
      expect(shouldTriggerRampage(1)).toBe(true);
      expect(shouldTriggerRampage(3)).toBe(true);
    });

    it('should convert extra blockers into matching power and toughness bonuses', () => {
      const ability = rampage('feral-shadow', 2);

      expect(calculateRampageBonus(ability, 1)).toBe(0);
      expect(calculateRampageBonus(ability, 3)).toBe(4);
      expect(getRampageStatBonus(ability, 3)).toEqual({ power: 4, toughness: 4 });
      expect(combinedRampageBonus([
        rampage('creature-1', 1),
        rampage('creature-1', 2),
      ], 3)).toBe(6);
    });
  });
});