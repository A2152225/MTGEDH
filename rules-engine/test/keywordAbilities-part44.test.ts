import { describe, expect, it } from 'vitest';
import {
  activateStation,
  castWarped,
  createFirebendingSummary,
  createInfinitySummary,
  createMayhemSummary,
  createSneakSummary,
  createStationSummary,
  createWarpSummary,
  createWebSlingingSummary,
  discardForMayhem,
  exileWarped,
  firebending,
  harnessInfinity,
  infinity,
  mayhem,
  paySneak,
  sneak,
  station,
  triggerFirebending,
  warp,
  webSlinging,
  castWithWebSlinging,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 44 (Part 14 summaries)', () => {
  describe('Station (702.184)', () => {
    it('should summarize accumulated counters and tapped contributors', () => {
      expect(createStationSummary(activateStation(activateStation(station('station-card'), 'creature-1', 3), 'creature-2', 2))).toEqual({
        source: 'station-card',
        chargeCounters: 5,
        tappedCreatureCount: 2,
        lastTappedCreature: 'creature-2',
      });
    });
  });

  describe('Warp (702.185)', () => {
    it('should summarize warped casting and the delayed exile recast window', () => {
      expect(createWarpSummary(exileWarped(castWarped(warp('warp-card', '{1}{U}')), 4), 'hand', 5)).toEqual({
        source: 'warp-card',
        warpCost: '{1}{U}',
        canCastWithWarp: true,
        wasWarped: true,
        isWarpedInExile: true,
        canCastFromExile: true,
      });
    });
  });

  describe('Infinity (702.186)', () => {
    it('should summarize harness state and granted ability activation', () => {
      expect(createInfinitySummary(harnessInfinity(infinity('infinity-card', 'Flying')))).toEqual({
        source: 'infinity-card',
        grantedAbility: 'Flying',
        isHarnessed: true,
        isActive: true,
      });
    });
  });

  describe('Mayhem (702.187)', () => {
    it('should summarize discard gating and graveyard cast readiness', () => {
      expect(createMayhemSummary(discardForMayhem(mayhem('mayhem-card', '{1}{R}')))).toEqual({
        source: 'mayhem-card',
        mayhemCost: '{1}{R}',
        wasDiscardedThisTurn: true,
        canCastWithMayhem: true,
        wasCastWithMayhem: false,
      });
    });
  });

  describe('Web-slinging (702.188)', () => {
    it('should summarize alternate casting and the returned tapped creature', () => {
      expect(createWebSlingingSummary(castWithWebSlinging(webSlinging('web-card', '{2}{U}'), 'spider-token'), true, 'hand')).toEqual({
        source: 'web-card',
        webSlingingCost: '{2}{U}',
        canCastWithWebSlinging: true,
        wasWebSlung: true,
        returnedCreature: 'spider-token',
      });
    });
  });

  describe('Firebending (702.189)', () => {
    it('should summarize combat mana generation and retention until end of combat', () => {
      expect(createFirebendingSummary(triggerFirebending(firebending('firebender', 3)))).toEqual({
        source: 'firebender',
        firebendingValue: 3,
        manaAdded: 3,
        retainsManaUntilEndOfCombat: true,
      });
    });
  });

  describe('Sneak (702.190)', () => {
    it('should summarize declare-blockers timing and tapped-attacking entry state', () => {
      expect(createSneakSummary(paySneak(sneak('sneak-card', '{1}{R}'), 'attacker-1'), true, true)).toEqual({
        source: 'sneak-card',
        sneakCost: '{1}{R}',
        canActivateSneak: true,
        wasSneakPaid: true,
        returnedCreatureId: 'attacker-1',
        entersTappedAndAttacking: true,
      });
    });
  });
});