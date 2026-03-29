import { describe, expect, it } from 'vitest';
import {
  persist,
  shouldPersistTrigger,
  canReturnWithPersist,
  createPersistReturnResult,
  wither,
  witherDamage,
  getWitherCounters,
  createWitherDamageResult,
  retrace,
  castWithRetrace,
  canCastWithRetrace,
  createRetraceCastResult,
  devour,
  sacrificeForDevour,
  canDevourPermanent,
  createDevourEntryResult,
  exalted,
  isAttackingAlone,
  shouldTriggerExalted,
  getTotalExaltedBonus,
  createExaltedAttackResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 24 (Part 5 graveyard and combat helpers)', () => {
  describe('Persist (702.79)', () => {
    it('should only return from the graveyard when the creature had no -1/-1 counters', () => {
      const ability = persist('kitchen-finks');

      expect(shouldPersistTrigger(ability, 0)).toBe(true);
      expect(canReturnWithPersist(ability, 'graveyard', 0)).toBe(true);
      expect(canReturnWithPersist(ability, 'graveyard', 1)).toBe(false);
      expect(canReturnWithPersist(ability, 'battlefield', 0)).toBe(false);
    });

    it('should create the persist return result with a -1/-1 counter', () => {
      expect(createPersistReturnResult(persist('murderous-redcap'), 'graveyard', 0)).toEqual({
        source: 'murderous-redcap',
        fromZone: 'graveyard',
        toZone: 'battlefield',
        minusOneMinusOneCountersAdded: 1,
      });
    });
  });

  describe('Wither (702.80)', () => {
    it('should clamp negative damage and convert creature damage into -1/-1 counters', () => {
      const ability = wither('boggart-ram-gang');

      expect(witherDamage(ability, -2)).toBe(0);
      expect(getWitherCounters(ability, 3, true)).toBe(3);
      expect(getWitherCounters(ability, 3, false)).toBe(0);
    });

    it('should distinguish creature counter placement from normal damage marking', () => {
      const ability = wither('boggart-ram-gang');

      expect(createWitherDamageResult(ability, 4, true)).toEqual({
        source: 'boggart-ram-gang',
        countersPlaced: 4,
        damageMarked: 0,
      });
      expect(createWitherDamageResult(ability, 4, false)).toEqual({
        source: 'boggart-ram-gang',
        countersPlaced: 0,
        damageMarked: 4,
      });
    });
  });

  describe('Retrace (702.81)', () => {
    it('should require both graveyard access and a discarded land for retrace', () => {
      const ability = retrace('raven-crime');

      expect(castWithRetrace(ability, 'swamp').discardedLand).toBe('swamp');
      expect(canCastWithRetrace(ability, 'graveyard', 'swamp')).toBe(true);
      expect(canCastWithRetrace(ability, 'hand', 'swamp')).toBe(false);
      expect(canCastWithRetrace(ability, 'graveyard')).toBe(false);
    });

    it('should create a retrace cast result from the graveyard', () => {
      expect(createRetraceCastResult(retrace('syphon-life'), 'graveyard', 'barren-moor')).toEqual({
        source: 'syphon-life',
        fromZone: 'graveyard',
        discardedLand: 'barren-moor',
        usedRetrace: true,
      });
    });
  });

  describe('Devour (702.82)', () => {
    it('should enforce quality restrictions when devouring permanents', () => {
      const unrestricted = devour('mycoloth', 2);
      const artifactOnly = devour('preyseizer-dragon', 1, 'artifact');

      expect(canDevourPermanent(unrestricted, ['creature'])).toBe(true);
      expect(canDevourPermanent(artifactOnly, ['artifact', 'creature'])).toBe(true);
      expect(canDevourPermanent(artifactOnly, ['creature'])).toBe(false);
    });

    it('should create a devour entry result from the chosen sacrifices', () => {
      const ability = sacrificeForDevour(devour('mycoloth', 2), 3);

      expect(createDevourEntryResult(ability)).toEqual({
        source: 'mycoloth',
        creaturesDevoured: 3,
        countersAdded: 6,
      });
    });
  });

  describe('Exalted (702.83)', () => {
    it('should only trigger when the named creature attacks alone', () => {
      const ability = exalted('akrasan-squire');

      expect(isAttackingAlone(['attacker-1'])).toBe(true);
      expect(shouldTriggerExalted(ability, ['attacker-1'], 'attacker-1')).toBe(true);
      expect(shouldTriggerExalted(ability, ['attacker-1', 'attacker-2'], 'attacker-1')).toBe(false);
      expect(shouldTriggerExalted(ability, ['attacker-1'], 'attacker-2')).toBe(false);
    });

    it('should total multiple exalted triggers into one combat bonus result', () => {
      expect(getTotalExaltedBonus(3)).toEqual({ power: 3, toughness: 3 });
      expect(createExaltedAttackResult(exalted('noble-hierarch'), ['lone-attacker'], 'lone-attacker', 2)).toEqual({
        source: 'noble-hierarch',
        attacker: 'lone-attacker',
        powerBonus: 2,
        toughnessBonus: 2,
      });
    });
  });
});