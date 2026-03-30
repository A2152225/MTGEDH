import { describe, expect, it } from 'vitest';
import {
  battleCry,
  bloodthirst,
  createBattleCrySummary,
  createBloodthirstSummary,
  createPoisonousSummary,
  createRampageSummary,
  poisonous,
  rampage,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 50 (Part 18 summaries)', () => {
  describe('Bloodthirst (702.54)', () => {
    it('should summarize eligibility and counters added on entry', () => {
      expect(createBloodthirstSummary(bloodthirst('skarrgan-pit-skulk', 1), true)).toEqual({
        source: 'skarrgan-pit-skulk',
        bloodthirstValue: 1,
        eligible: true,
        countersAdded: 1,
      });
    });
  });

  describe('Battle Cry (702.91)', () => {
    it('should summarize attacking trigger state and affected allies', () => {
      expect(createBattleCrySummary(battleCry('hero-of-bladehold'), true, [
        'hero-of-bladehold',
        'soldier-1',
        'soldier-2',
      ])).toEqual({
        source: 'hero-of-bladehold',
        triggers: true,
        affectedAttackers: ['soldier-1', 'soldier-2'],
        bonus: { power: 1, toughness: 0 },
      });
    });
  });

  describe('Poisonous (702.70)', () => {
    it('should summarize poison-trigger pressure against the defending player', () => {
      expect(createPoisonousSummary(poisonous('snake-cult-initiation', 3), true, 'player-b')).toEqual({
        source: 'snake-cult-initiation',
        poisonousValue: 3,
        triggers: true,
        defendingPlayerId: 'player-b',
        poisonCounters: 3,
      });
    });
  });

  describe('Rampage (702.23)', () => {
    it('should summarize extra-blocker scaling and resulting stat bonus', () => {
      expect(createRampageSummary(rampage('feral-shadow', 2), 3)).toEqual({
        source: 'feral-shadow',
        rampageValue: 2,
        triggers: true,
        blockerCount: 3,
        powerBonus: 4,
        toughnessBonus: 4,
      });
    });
  });
});