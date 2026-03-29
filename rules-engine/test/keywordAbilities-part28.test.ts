import { describe, expect, it } from 'vitest';
import {
  soulshift,
  triggerSoulshift,
  canReturnWithSoulshift,
  canReturnSpiritWithSoulshift,
  createSoulshiftReturnResult,
  epic,
  resolveEpic,
  createEpicCopy,
  canCreateEpicCopy,
  createEpicUpkeepResult,
  convoke,
  getConvokePaymentOptions,
  canCreaturePayFor,
  calculateConvokeReduction,
  getRemainingConvokeCost,
  createConvokePaymentResult,
  dredge,
  useDredge,
  canDredge,
  canDredgeFromZone,
  createDredgeResult,
  transmute,
  activateTransmute,
  canTransmute,
  canTransmuteFromZone,
  createTransmuteSearchResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 28 (Part 3 tutoring and cost-payment helpers)', () => {
  describe('Soulshift (702.46)', () => {
    it('should only return Spirit cards with low enough mana value', () => {
      const ability = soulshift('thief-of-hope', 3);

      expect(canReturnWithSoulshift(3, ability)).toBe(true);
      expect(canReturnSpiritWithSoulshift(ability, 3, true)).toBe(true);
      expect(canReturnSpiritWithSoulshift(ability, 4, true)).toBe(false);
      expect(canReturnSpiritWithSoulshift(ability, 2, false)).toBe(false);
    });

    it('should create a soulshift return summary for an eligible target', () => {
      const triggered = triggerSoulshift(soulshift('thief-of-hope', 3), 'kami-card');

      expect(createSoulshiftReturnResult(triggered, 2, true)).toEqual({
        source: 'thief-of-hope',
        targetCard: 'kami-card',
        returnsToHand: true,
      });
    });
  });

  describe('Epic (702.50)', () => {
    it('should only create upkeep copies after epic has resolved', () => {
      const inactive = epic('enduring-ideal');
      const active = resolveEpic(inactive);

      expect(canCreateEpicCopy(inactive)).toBe(false);
      expect(canCreateEpicCopy(active)).toBe(true);
      expect(createEpicCopy(active).copiesCreated).toBe(1);
    });

    it('should create an epic upkeep summary for the next copy', () => {
      const active = resolveEpic(epic('enduring-ideal'));

      expect(createEpicUpkeepResult(active)).toEqual({
        source: 'enduring-ideal',
        copiesCreatedThisUpkeep: 1,
        totalCopiesCreated: 1,
      });
    });
  });

  describe('Convoke (702.51)', () => {
    it('should expose legal payment options for colored and colorless creatures', () => {
      expect(getConvokePaymentOptions({ id: 'elf', name: 'Elf', colors: ['G'] })).toEqual(['generic', 'G']);
      expect(getConvokePaymentOptions({ id: 'construct', name: 'Construct', colors: [] })).toEqual(['generic']);
      expect(canCreaturePayFor({ id: 'elf', name: 'Elf', colors: ['G'] }, 'G')).toBe(true);
      expect(canCreaturePayFor({ id: 'elf', name: 'Elf', colors: ['G'] }, 'U')).toBe(false);
    });

    it('should summarize remaining cost after convoke payments are assigned', () => {
      const payments = [
        { creatureId: 'elf-1', paysFor: 'G' as const },
        { creatureId: 'elf-2', paysFor: 'generic' as const },
      ];

      expect(calculateConvokeReduction(payments)).toEqual({
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1 },
        generic: 1,
      });
      expect(getRemainingConvokeCost(payments, { generic: 2, colors: { G: 1, U: 1 } })).toEqual({
        generic: 1,
        colors: { W: 0, U: 1, B: 0, R: 0, G: 0 },
      });
      expect(createConvokePaymentResult(convoke('chord-of-calling'), payments, { generic: 2, colors: { G: 1, U: 1 } })).toEqual({
        source: 'chord-of-calling',
        tappedCreatures: ['elf-1', 'elf-2'],
        remainingCost: {
          generic: 1,
          colors: { W: 0, U: 1, B: 0, R: 0, G: 0 },
        },
      });
    });
  });

  describe('Dredge (702.52)', () => {
    it('should require enough library cards and graveyard access for dredge', () => {
      const ability = useDredge(dredge('golgari-grave-troll', 6));

      expect(ability.wasDredged).toBe(true);
      expect(canDredge(6, ability)).toBe(true);
      expect(canDredgeFromZone(ability, 'graveyard', 6)).toBe(true);
      expect(canDredgeFromZone(ability, 'hand', 6)).toBe(false);
      expect(canDredgeFromZone(ability, 'graveyard', 5)).toBe(false);
    });

    it('should create a dredge replacement summary', () => {
      expect(createDredgeResult(dredge('stinkweed-imp', 5), 'graveyard', 7)).toEqual({
        source: 'stinkweed-imp',
        milledCards: 5,
        returnsToHand: true,
      });
    });
  });

  describe('Transmute (702.53)', () => {
    it('should require hand-zone access and sorcery timing for transmute', () => {
      const ability = transmute('drift-of-phantasms', '{1}{U}{U}');

      expect(canTransmute(true, true)).toBe(true);
      expect(canTransmuteFromZone(ability, 'hand', true)).toBe(true);
      expect(canTransmuteFromZone(ability, 'graveyard', true)).toBe(false);
      expect(canTransmuteFromZone(activateTransmute(ability), 'hand', true)).toBe(false);
    });

    it('should create a transmute search summary for matching mana value', () => {
      expect(createTransmuteSearchResult(transmute('drift-of-phantasms', '{1}{U}{U}'), 'hand', true, 3)).toEqual({
        source: 'drift-of-phantasms',
        discardedCard: 'drift-of-phantasms',
        costPaid: '{1}{U}{U}',
        searchesForManaValue: 3,
      });
    });
  });
});