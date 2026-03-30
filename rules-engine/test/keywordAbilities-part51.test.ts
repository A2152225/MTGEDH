import { describe, expect, it } from 'vitest';
import {
  createDashSummary,
  createExploitSummary,
  createHiddenAgendaSummary,
  createOutlastSummary,
  createProwessSummary,
  dash,
  exploit,
  hiddenAgenda,
  outlast,
  payDash,
  prowess,
  revealHiddenAgenda,
  activateOutlast,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 51 (Part 19 summaries)', () => {
  describe('Hidden Agenda (702.106)', () => {
    it('should summarize reveal availability and named-card matching', () => {
      expect(createHiddenAgendaSummary(
        revealHiddenAgenda(hiddenAgenda('conspiracy-1', 'Lightning Bolt')),
        true,
        'lightning bolt',
      )).toEqual({
        source: 'conspiracy-1',
        namedCard: 'Lightning Bolt',
        canReveal: false,
        revealed: true,
        matchesCardName: true,
      });
    });
  });

  describe('Outlast (702.107)', () => {
    it('should summarize activation timing and accumulated counters', () => {
      expect(createOutlastSummary(activateOutlast(outlast('ainok-bond-kin', '{1}{W}')), true, true)).toEqual({
        source: 'ainok-bond-kin',
        outlastCost: '{1}{W}',
        canActivate: true,
        countersAdded: 1,
        tapped: true,
      });
    });
  });

  describe('Prowess (702.108)', () => {
    it('should summarize noncreature-spell triggering and stat growth', () => {
      expect(createProwessSummary(prowess('seeker-of-the-way'), true)).toEqual({
        source: 'seeker-of-the-way',
        triggers: true,
        triggerCount: 1,
        powerBonus: 1,
        toughnessBonus: 1,
      });
    });
  });

  describe('Dash (702.109)', () => {
    it('should summarize alternative-cast access, haste, and return destination', () => {
      expect(createDashSummary(payDash(dash('mardu-scout', '{1}{R}')), 'hand')).toEqual({
        source: 'mardu-scout',
        dashCost: '{1}{R}',
        canCastWithDash: true,
        wasDashed: true,
        hasHaste: true,
        returnDestination: 'battlefield',
      });
    });
  });

  describe('Exploit (702.110)', () => {
    it('should summarize ETB trigger state and sacrificed-creature choice', () => {
      expect(createExploitSummary(exploit('sidisi'), true, 'zombie-token')).toEqual({
        source: 'sidisi',
        triggers: true,
        canExploitCreature: true,
        didExploit: true,
        sacrificedCreature: 'zombie-token',
      });
    });
  });
});