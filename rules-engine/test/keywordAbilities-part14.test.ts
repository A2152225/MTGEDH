/**
 * Tests for Part 14 keyword abilities (Rules 702.184-702.190)
 */

import { describe, expect, it } from 'vitest';
import {
  activateStation,
  canActivateSneak,
  canCastWarpedFromExile,
  canCastWithWarp,
  canCastWithMayhem,
  canCastWithWebSlinging,
  canReturnForWebSlinging,
  castWarped,
  castWithMayhem,
  castWithWebSlinging,
  clearFirebendingMana,
  discardForMayhem,
  exileWarped,
  firebending,
  getChargeCounters,
  getFirebendingMana,
  getInfinityAbility,
  getReturnedCreature,
  harnessInfinity,
  hasRedundantFirebending,
  hasRedundantInfinity,
  hasRedundantMayhem,
  hasRedundantSneak,
  hasRedundantStation,
  hasRedundantWarp,
  hasRedundantWebSlinging,
  infinity,
  isInfinityActive,
  isWarpedInExile,
  mayhem,
  parseWarpCost,
  parseWebSlingingCost,
  paySneak,
  resetMayhem,
  sneak,
  station,
  triggerFirebending,
  unharnessInfinity,
  warp,
  wasSneakCast,
  wasWarpedThisTurn,
  wasWebSlung,
  webSlinging,
} from '../src/keywordAbilities';

describe('Part 14: Keyword Abilities (Rules 702.184-702.190)', () => {
  describe('Station (702.184)', () => {
    it('should accumulate charge counters from tapped creatures', () => {
      const ability = station('station-card');
      const updated = activateStation(ability, 'creature-1', 3);
      const updatedAgain = activateStation(updated, 'creature-2', 2);

      expect(updatedAgain.tappedCreatures).toEqual(['creature-1', 'creature-2']);
      expect(getChargeCounters(updatedAgain)).toBe(5);
    });

    it('should not treat multiple station abilities as redundant', () => {
      expect(hasRedundantStation([station('a'), station('b')])).toBe(false);
    });
  });

  describe('Warp (702.185)', () => {
    it('should create and track a warped spell through exile timing', () => {
      const ability = warp('warp-card', '{1}{U}');
      const cast = castWarped(ability);
      const exiled = exileWarped(cast, 4);

      expect(wasWarpedThisTurn(cast)).toBe(true);
      expect(isWarpedInExile(exiled)).toBe(true);
      expect(canCastWithWarp('hand')).toBe(true);
      expect(canCastWithWarp('graveyard')).toBe(false);
      expect(canCastWarpedFromExile(exiled, 4)).toBe(false);
      expect(canCastWarpedFromExile(exiled, 5)).toBe(true);
    });

    it('should parse warp cost from oracle text', () => {
      expect(parseWarpCost('Warp {1}{U} (You may cast this card...)')).toBe('{1}{U}');
    });

    it('should not treat multiple warp abilities as redundant', () => {
      expect(hasRedundantWarp([warp('a', '{1}{U}'), warp('b', '{2}{R}')])).toBe(false);
    });
  });

  describe('Infinity (702.186)', () => {
    it('should grant its ability only while harnessed', () => {
      const ability = infinity('infinity-card', 'Flying');
      const harnessed = harnessInfinity(ability);
      const unharnessed = unharnessInfinity(harnessed);

      expect(getInfinityAbility(ability)).toBe('Flying');
      expect(isInfinityActive(harnessed)).toBe(true);
      expect(isInfinityActive(unharnessed)).toBe(false);
    });

    it('should not treat multiple infinity abilities as redundant', () => {
      expect(hasRedundantInfinity([infinity('a', 'Flying'), infinity('b', 'First strike')])).toBe(false);
    });
  });

  describe('Mayhem (702.187)', () => {
    it('should allow graveyard casting only after the card was discarded this turn', () => {
      const ability = mayhem('mayhem-card', '{1}{R}');
      const discarded = discardForMayhem(ability);
      const cast = castWithMayhem(discarded);
      const reset = resetMayhem(discarded);

      expect(canCastWithMayhem(ability)).toBe(false);
      expect(canCastWithMayhem(discarded)).toBe(true);
      expect(cast?.wasCastWithMayhem).toBe(true);
      expect(canCastWithMayhem(reset)).toBe(false);
    });

    it('should not treat multiple mayhem abilities as redundant', () => {
      expect(hasRedundantMayhem([mayhem('a', '{1}{R}'), mayhem('b')])).toBe(false);
    });
  });

  describe('Web-slinging (702.188)', () => {
    it('should record the returned creature when web-slinging is used', () => {
      const ability = webSlinging('web-card', '{2}{U}');
      const cast = castWithWebSlinging(ability, 'spider-token');

      expect(wasWebSlung(cast)).toBe(true);
      expect(getReturnedCreature(cast)).toBe('spider-token');
    });

    it('should validate web-slinging cast requirements and returned creatures', () => {
      expect(canCastWithWebSlinging(true, 'hand')).toBe(true);
      expect(canCastWithWebSlinging(false, 'hand')).toBe(false);
      expect(canCastWithWebSlinging(true, 'graveyard')).toBe(false);

      expect(canReturnForWebSlinging({
        controller: 'p1',
        tapped: true,
        card: { type_line: 'Creature — Spider' },
      }, 'p1')).toBe(true);

      expect(canReturnForWebSlinging({
        controller: 'p1',
        tapped: false,
        card: { type_line: 'Creature — Spider' },
      }, 'p1')).toBe(false);
    });

    it('should parse web-slinging cost and detect redundant identical costs', () => {
      expect(parseWebSlingingCost('Web-slinging {2}{U} (You may cast...)')).toBe('{2}{U}');
      expect(hasRedundantWebSlinging([
        webSlinging('a', '{2}{U}'),
        webSlinging('b', '{2}{U}'),
      ])).toBe(true);
    });
  });

  describe('Firebending (702.189)', () => {
    it('should add and then clear combat mana', () => {
      const ability = firebending('firebender', 3);
      const triggered = triggerFirebending(ability);
      const cleared = clearFirebendingMana(triggered);

      expect(getFirebendingMana(triggered)).toBe(3);
      expect(getFirebendingMana(cleared)).toBe(0);
      expect(hasRedundantFirebending([ability, firebending('other', 2)])).toBe(false);
    });
  });

  describe('Sneak (702.190)', () => {
    it('should only allow sneak during declare blockers with an unblocked attacker', () => {
      const ability = sneak('sneak-card', '{1}{R}');
      const paid = paySneak(ability, 'attacker-1');

      expect(canActivateSneak(true, true)).toBe(true);
      expect(canActivateSneak(false, true)).toBe(false);
      expect(canActivateSneak(true, false)).toBe(false);
      expect(wasSneakCast(paid)).toBe(true);
    });

    it('should treat duplicate sneak costs as redundant', () => {
      expect(hasRedundantSneak([
        sneak('a', '{1}{R}'),
        sneak('b', '{1}{R}'),
      ])).toBe(true);
    });
  });
});