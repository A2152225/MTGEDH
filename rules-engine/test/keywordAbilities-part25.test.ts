import { describe, expect, it } from 'vitest';
import {
  unearth,
  activateUnearth,
  canActivateUnearthAsSorcery,
  createUnearthReturnResult,
  cascade,
  resolveCascade,
  canCascadeInto,
  getCascadeCastableCards,
  createCascadeResolutionResult,
  levelUp,
  activateLevelUp,
  getLevelCounters,
  canActivateLevelUpAbility,
  createLevelUpActivationResult,
  rebound,
  exileForRebound,
  shouldReboundTrigger,
  canCastReboundFromZone,
  createReboundCastResult,
  livingWeapon,
  triggerLivingWeapon,
  getGermToken,
  hasLivingWeaponToken,
  createLivingWeaponResolutionResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 25 (Part 5 return and cast helpers)', () => {
  describe('Unearth (702.84)', () => {
    it('should require graveyard access and sorcery timing for unearth', () => {
      const ability = unearth('hell-mongrel', 'B');

      expect(canActivateUnearthAsSorcery(ability, 'graveyard', true)).toBe(true);
      expect(canActivateUnearthAsSorcery(ability, 'graveyard', false)).toBe(false);
      expect(canActivateUnearthAsSorcery(ability, 'hand', true)).toBe(false);
      expect(canActivateUnearthAsSorcery(activateUnearth(ability), 'graveyard', true)).toBe(false);
    });

    it('should create an unearth return result with the usual riders', () => {
      expect(createUnearthReturnResult(unearth('hell-mongrel', 'B'), 'graveyard', true)).toEqual({
        source: 'hell-mongrel',
        fromZone: 'graveyard',
        toZone: 'battlefield',
        gainsHaste: true,
        exileAtNextEndStep: true,
        exileIfItWouldLeaveBattlefield: true,
      });
    });
  });

  describe('Cascade (702.85)', () => {
    it('should identify which exiled cards are legal cascade hits', () => {
      expect(canCascadeInto(8, 5, false)).toBe(true);
      expect(canCascadeInto(8, 8, false)).toBe(false);
      expect(getCascadeCastableCards(6, [
        { cardId: 'forest', manaValue: 0, isLand: true },
        { cardId: 'signet', manaValue: 2, isLand: false },
        { cardId: 'dragon', manaValue: 6, isLand: false },
      ])).toEqual(['signet']);
    });

    it('should summarize exiled cards and the chosen cascade hit', () => {
      const ability = resolveCascade(cascade('bloodbraid-elf'), ['forest', 'lightning-bolt'], 'lightning-bolt');

      expect(ability.castCard).toBe('lightning-bolt');
      expect(createCascadeResolutionResult(cascade('bloodbraid-elf'), 4, [
        { cardId: 'forest', manaValue: 0, isLand: true },
        { cardId: 'lightning-bolt', manaValue: 1, isLand: false },
      ], 'lightning-bolt')).toEqual({
        source: 'bloodbraid-elf',
        exiledCards: ['forest', 'lightning-bolt'],
        castableCards: ['lightning-bolt'],
        chosenCard: 'lightning-bolt',
      });
    });
  });

  describe('Level Up (702.87)', () => {
    it('should only activate on the battlefield at sorcery speed', () => {
      const ability = levelUp('student-of-warfare', '1');

      expect(canActivateLevelUpAbility(ability, 'battlefield', true)).toBe(true);
      expect(canActivateLevelUpAbility(ability, 'battlefield', false)).toBe(false);
      expect(canActivateLevelUpAbility(ability, 'hand', true)).toBe(false);
    });

    it('should create a level-up activation result with incremented counters', () => {
      const leveled = activateLevelUp(levelUp('student-of-warfare', '1'));

      expect(getLevelCounters(leveled)).toBe(1);
      expect(createLevelUpActivationResult(leveled, 'battlefield', true)).toEqual({
        source: 'student-of-warfare',
        costPaid: '1',
        newLevelCounters: 2,
      });
    });
  });

  describe('Rebound (702.88)', () => {
    it('should only allow rebound casting from exile after a hand-cast spell is exiled', () => {
      const exiled = exileForRebound(rebound('staggershock', true));
      const notEligible = exileForRebound(rebound('staggershock', false));

      expect(shouldReboundTrigger(exiled)).toBe(true);
      expect(canCastReboundFromZone(exiled, 'exile')).toBe(true);
      expect(canCastReboundFromZone(exiled, 'graveyard')).toBe(false);
      expect(canCastReboundFromZone(notEligible, 'exile')).toBe(false);
    });

    it('should create a free cast result from exile for rebound', () => {
      const exiled = exileForRebound(rebound('surreal-memoir', true));

      expect(createReboundCastResult(exiled, 'exile')).toEqual({
        source: 'surreal-memoir',
        fromZone: 'exile',
        withoutPayingManaCost: true,
      });
    });
  });

  describe('Living Weapon (702.92)', () => {
    it('should track whether the Germ token has been created', () => {
      const base = livingWeapon('batterskull');
      const triggered = triggerLivingWeapon(base, 'germ-token-1');

      expect(hasLivingWeaponToken(base)).toBe(false);
      expect(hasLivingWeaponToken(triggered)).toBe(true);
      expect(getGermToken(triggered)).toBe('germ-token-1');
    });

    it('should create a living weapon resolution summary once the token exists', () => {
      expect(createLivingWeaponResolutionResult(triggerLivingWeapon(livingWeapon('batterskull'), 'germ-token-1'))).toEqual({
        source: 'batterskull',
        germToken: 'germ-token-1',
        attachToToken: true,
      });
    });
  });
});