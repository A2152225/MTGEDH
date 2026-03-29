import { describe, expect, it } from 'vitest';
import {
  hiddenAgenda,
  canRevealAgenda,
  revealHiddenAgenda,
  getNamedAgendaCard,
  matchesAgenda,
  isAgendaRevealed,
  hasRedundantHiddenAgenda,
  outlast,
  canActivateOutlast,
  activateOutlast,
  getOutlastCounters,
  getOutlastCounterRate,
  createOutlastResolution,
  hasRedundantOutlast,
  prowess,
  shouldTriggerProwess,
  triggerProwess,
  resolveProwessTriggers,
  getProwessBonus,
  getProwessTriggers,
  getProwessStatBonus,
  clearProwessBonus,
  hasRedundantProwess,
  dash,
  canCastWithDash,
  payDash,
  castNormally,
  wasDashed,
  hasHasteFromDash,
  shouldDashReturnAtEndStep,
  resolveDashReturn,
  getDashReturnDestination,
  hasRedundantDash,
  exploit,
  shouldTriggerExploit,
  canExploitCreature,
  completeExploit,
  declineExploit,
  didExploitCreature,
  getExploitedCreature,
  resolveExploitChoice,
  hasRedundantExploit,
  menace,
  canBlockWithMenace,
  canMenaceBeBlockedBy,
  getMinimumBlockers,
  hasMenace,
  isMenaceEvasionRelevant,
  hasRedundantMenace,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 19 (Part 6 Batch 3 helper coverage)', () => {
  describe('Hidden Agenda (702.106)', () => {
    it('should require a named card and priority before it can be revealed', () => {
      const ability = hiddenAgenda('conspiracy-1', 'Lightning Bolt');
      const unnamed = hiddenAgenda('conspiracy-2');

      expect(canRevealAgenda(ability, true)).toBe(true);
      expect(canRevealAgenda(ability, false)).toBe(false);
      expect(canRevealAgenda(unnamed, true)).toBe(false);
    });

    it('should reveal, expose the named card, and match case-insensitively', () => {
      const revealed = revealHiddenAgenda(hiddenAgenda('conspiracy-1', 'Lightning Bolt'));

      expect(getNamedAgendaCard(revealed)).toBe('Lightning Bolt');
      expect(matchesAgenda(revealed, 'lightning bolt')).toBe(true);
      expect(isAgendaRevealed(revealed)).toBe(true);
      expect(hasRedundantHiddenAgenda([
        hiddenAgenda('c1', 'Lightning Bolt'),
        hiddenAgenda('c2', 'Counterspell'),
      ])).toBe(true);
    });
  });

  describe('Outlast (702.107)', () => {
    it('should only activate at sorcery speed while untapped', () => {
      expect(canActivateOutlast(true, true)).toBe(true);
      expect(canActivateOutlast(false, true)).toBe(false);
      expect(canActivateOutlast(true, false)).toBe(false);
    });

    it('should add one counter and tap the creature on resolution', () => {
      const activated = activateOutlast(outlast('ainok-bond-kin', '{1}{W}'));

      expect(getOutlastCounterRate()).toBe(1);
      expect(getOutlastCounters(activated)).toBe(1);
      expect(createOutlastResolution(activated)).toEqual({
        source: 'ainok-bond-kin',
        countersAdded: 1,
        tapped: true,
      });
      expect(hasRedundantOutlast([activated])).toBe(false);
    });
  });

  describe('Prowess (702.108)', () => {
    it('should trigger only for noncreature spells', () => {
      expect(shouldTriggerProwess(true)).toBe(true);
      expect(shouldTriggerProwess(false)).toBe(false);
    });

    it('should stack bonuses for multiple triggers and clear at end of turn', () => {
      const triggered = resolveProwessTriggers(prowess('seeker-of-the-way'), 2);
      const cleared = clearProwessBonus(triggered);

      expect(getProwessTriggers(triggered)).toBe(2);
      expect(getProwessBonus(triggered)).toBe(2);
      expect(getProwessStatBonus(triggered)).toEqual({ power: 2, toughness: 2 });
      expect(cleared.triggered).toBe(false);
      expect(getProwessBonus(cleared)).toBe(0);
      expect(hasRedundantProwess([prowess('a'), prowess('b')])).toBe(false);
    });
  });

  describe('Dash (702.109)', () => {
    it('should only be cast from hand as an alternative cost', () => {
      expect(canCastWithDash('hand')).toBe(true);
      expect(canCastWithDash('graveyard')).toBe(false);
      expect(canCastWithDash('exile')).toBe(false);
    });

    it('should grant haste and schedule a return only when dashed', () => {
      const dashed = payDash(dash('mardu-scout', '{1}{R}'));
      const returned = resolveDashReturn(dashed);
      const normalCast = castNormally(dash('mardu-scout', '{1}{R}'));

      expect(wasDashed(dashed)).toBe(true);
      expect(hasHasteFromDash(dashed)).toBe(true);
      expect(shouldDashReturnAtEndStep(dashed)).toBe(true);
      expect(getDashReturnDestination(returned)).toBe('hand');
      expect(shouldDashReturnAtEndStep(returned)).toBe(false);
      expect(getDashReturnDestination(normalCast)).toBe('battlefield');
      expect(hasRedundantDash([dash('a', '{1}{R}'), dash('b', '{1}{R}')])).toBe(true);
    });
  });

  describe('Exploit (702.110)', () => {
    it('should trigger on entering and allow either sacrificing or declining', () => {
      expect(shouldTriggerExploit(true)).toBe(true);
      expect(shouldTriggerExploit(false)).toBe(false);
      expect(canExploitCreature('token-1')).toBe(true);
      expect(canExploitCreature(undefined)).toBe(false);
    });

    it('should capture the sacrificed creature when exploit is used', () => {
      const exploited = completeExploit(exploit('sidisi'), 'zombie-token');
      const declined = declineExploit(exploit('sidisi'));

      expect(didExploitCreature(exploited)).toBe(true);
      expect(getExploitedCreature(exploited)).toBe('zombie-token');
      expect(resolveExploitChoice(exploit('sidisi'), 'zombie-token')).toEqual({
        source: 'sidisi',
        exploited: true,
        sacrificedCreature: 'zombie-token',
      });
      expect(resolveExploitChoice(declined)).toEqual({
        source: 'sidisi',
        exploited: false,
      });
      expect(hasRedundantExploit([exploit('a'), exploit('b')])).toBe(false);
    });
  });

  describe('Menace (702.111)', () => {
    it('should require at least two blockers', () => {
      const ability = menace('goblin-raider');

      expect(canBlockWithMenace(ability, 1)).toBe(false);
      expect(canBlockWithMenace(ability, 2)).toBe(true);
      expect(canMenaceBeBlockedBy(['blocker-1'])).toBe(false);
      expect(canMenaceBeBlockedBy(['blocker-1', 'blocker-2'])).toBe(true);
    });

    it('should expose the minimum blocker count and evasion pressure', () => {
      expect(getMinimumBlockers()).toBe(2);
      expect(hasMenace([menace('creature-1')])).toBe(true);
      expect(isMenaceEvasionRelevant(0)).toBe(true);
      expect(isMenaceEvasionRelevant(1)).toBe(true);
      expect(isMenaceEvasionRelevant(2)).toBe(false);
      expect(hasRedundantMenace([menace('a'), menace('a')])).toBe(true);
    });
  });
});