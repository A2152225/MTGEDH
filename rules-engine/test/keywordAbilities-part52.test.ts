import { describe, expect, it } from 'vitest';
import {
  activateScavenge,
  bestow,
  castWithBestow,
  createBestowSummary,
  createExtortSummary,
  createScavengeSummary,
  extort,
  payExtortCost,
  scavenge,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 52 (Part 20 summaries)', () => {
  describe('Scavenge (702.97)', () => {
    it('should summarize graveyard activation and counter output', () => {
      expect(createScavengeSummary(
        activateScavenge(scavenge('deadbridge-goliath', '{4}{G}{G}', [5, 5]), 'target-creature'),
        'graveyard',
        true,
        true,
      )).toEqual({
        source: 'deadbridge-goliath',
        scavengeCost: '{4}{G}{G}',
        canActivate: true,
        countersAdded: 5,
        wasScavenged: true,
      });
    });
  });

  describe('Extort (702.101)', () => {
    it('should summarize trigger state and mirrored life swing', () => {
      expect(createExtortSummary(payExtortCost(extort('pontiff-of-blight'), 3), true, 3)).toEqual({
        source: 'pontiff-of-blight',
        triggers: true,
        timesPaid: 1,
        opponentsLoseLife: 3,
        youGainLife: 3,
      });
    });
  });

  describe('Bestow (702.103)', () => {
    it('should summarize alternative-cast legality and aura mode attachment', () => {
      expect(createBestowSummary(
        castWithBestow(bestow('hopeful-eidolon', '{3}{W}', '{W}'), 'creature-1'),
        'hand',
        true,
      )).toEqual({
        source: 'hopeful-eidolon',
        bestowCost: '{3}{W}',
        canCastWithBestow: true,
        mode: 'aura',
        attachedTo: 'creature-1',
      });
    });
  });
});