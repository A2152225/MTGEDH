import { describe, expect, it } from 'vitest';
import {
  absorb,
  applyAbsorb,
  getAbsorbPrevention,
  resolveAbsorb,
  annihilator,
  getAnnihilatorCount,
  shouldTriggerAnnihilator,
  createAnnihilatorTrigger,
  getCombinedAnnihilatorCount,
  areAnnihilatorAbilitiesRedundant,
  bushido,
  triggerBushido,
  shouldTriggerBushido,
  getBushidoBonus,
  getBushidoStatBonus,
  isBushidoRedundant,
  frenzy,
  getFrenzyBonus,
  shouldTriggerFrenzy,
  getFrenzyStatBonus,
  horsemanship,
  canBlockHorsemanship,
  canBlockAttackerWithHorsemanship,
  isHorsemanshipEvasionRelevant,
  hasRedundantHorsemanship,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 17 (combat and static helper coverage)', () => {
  describe('Absorb (Rule 702.64)', () => {
    it('should split prevented and remaining damage correctly', () => {
      const ability = absorb('lichenthrope', 2);

      expect(getAbsorbPrevention(ability, 5)).toBe(2);
      expect(applyAbsorb(ability, 5)).toBe(3);
      expect(resolveAbsorb(ability, 5)).toEqual({
        originalDamage: 5,
        preventedDamage: 2,
        remainingDamage: 3,
      });
    });

    it('should clamp damage prevention when damage is smaller than absorb', () => {
      const ability = absorb('lichenthrope', 3);

      expect(getAbsorbPrevention(ability, 1)).toBe(1);
      expect(resolveAbsorb(ability, 1)).toEqual({
        originalDamage: 1,
        preventedDamage: 1,
        remainingDamage: 0,
      });
    });
  });

  describe('Annihilator (Rule 702.86)', () => {
    it('should trigger only while attacking a defending player', () => {
      expect(shouldTriggerAnnihilator(true, 'player-b')).toBe(true);
      expect(shouldTriggerAnnihilator(false, 'player-b')).toBe(false);
      expect(shouldTriggerAnnihilator(true, undefined)).toBe(false);
    });

    it('should build a sacrifice trigger for the defending player', () => {
      const ability = annihilator('ulamog', 4);

      expect(getAnnihilatorCount(ability)).toBe(4);
      expect(createAnnihilatorTrigger(ability, 'player-b')).toEqual({
        source: 'ulamog',
        defendingPlayerId: 'player-b',
        permanentsToSacrifice: 4,
      });
    });

    it('should combine multiple annihilator instances without treating them as redundant', () => {
      const first = annihilator('eldrazi-1', 2);
      const second = annihilator('eldrazi-1', 3);

      expect(getCombinedAnnihilatorCount([first, second])).toBe(5);
      expect(areAnnihilatorAbilitiesRedundant(first, second)).toBe(false);
    });
  });

  describe('Bushido (Rule 702.45)', () => {
    it('should trigger when a creature becomes blocked or becomes blocking', () => {
      expect(shouldTriggerBushido(true, false)).toBe(true);
      expect(shouldTriggerBushido(false, true)).toBe(true);
      expect(shouldTriggerBushido(false, false)).toBe(false);
    });

    it('should produce matched power and toughness bonuses once triggered', () => {
      const ability = bushido('hand-of-honor', 2);
      const triggered = triggerBushido(ability);

      expect(getBushidoBonus(ability)).toBe(0);
      expect(getBushidoBonus(triggered)).toBe(2);
      expect(getBushidoStatBonus(triggered)).toEqual({ power: 2, toughness: 2 });
      expect(isBushidoRedundant()).toBe(false);
    });
  });

  describe('Frenzy (Rule 702.68)', () => {
    it('should trigger only for attacking creatures that remain unblocked', () => {
      expect(shouldTriggerFrenzy(true, false)).toBe(true);
      expect(shouldTriggerFrenzy(true, true)).toBe(false);
      expect(shouldTriggerFrenzy(false, false)).toBe(false);
    });

    it('should grant only a power bonus', () => {
      const ability = frenzy('goblin-berserker', 3);

      expect(getFrenzyBonus(ability)).toBe(3);
      expect(getFrenzyStatBonus(ability)).toEqual({ power: 3, toughness: 0 });
    });
  });

  describe('Horsemanship (Rule 702.31)', () => {
    it('should only allow horsemanship creatures to block horsemanship attackers', () => {
      expect(canBlockHorsemanship(true)).toBe(true);
      expect(canBlockHorsemanship(false)).toBe(false);
      expect(canBlockAttackerWithHorsemanship(true, true)).toBe(true);
      expect(canBlockAttackerWithHorsemanship(true, false)).toBe(false);
      expect(canBlockAttackerWithHorsemanship(false, false)).toBe(true);
    });

    it('should identify when horsemanship creates real evasion pressure', () => {
      expect(isHorsemanshipEvasionRelevant(true, false)).toBe(true);
      expect(isHorsemanshipEvasionRelevant(true, true)).toBe(false);
      expect(isHorsemanshipEvasionRelevant(false, false)).toBe(false);
    });

    it('should still treat multiple horsemanship instances as redundant', () => {
      expect(hasRedundantHorsemanship([
        horsemanship('creature-1'),
        horsemanship('creature-1'),
      ])).toBe(true);
    });
  });
});