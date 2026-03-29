/**
 * Tests for Part 10 keyword abilities (Rules 702.151-702.160).
 */

import { describe, expect, it } from 'vitest';
import {
  attachWithReconfigure,
  blitz,
  canApplyCompleated,
  canAttachWithReconfigure,
  canChapterTrigger,
  canCastPrototyped,
  canCastWithBlitz,
  canChooseReadAheadChapter,
  canEnlistCreature,
  canPayCasualty,
  canPaySquad,
  casualty,
  createSquadTokens,
  drawCardFromBlitz,
  drawFromRavenous,
  enlist,
  enlistCreature,
  getCasualtyCopyId,
  getCasualtySacrificedCreature,
  getCasualtyValue,
  getEnlistedCreature,
  getEnlistBonus,
  getLoyaltyReduction,
  getPrototypeStats,
  getRavenousCounters,
  getRavenousXValue,
  getReadAheadLoreCounters,
  getReadAheadStartingChapter,
  getReconfigureAttachedTo,
  getReconfigureCost,
  getSquadTimesPaid,
  getSquadTokenCount,
  hasDrawnCardFromBlitz,
  hasDrawnFromRavenous,
  hasRedundantBlitz,
  hasRedundantCasualty,
  hasRedundantEnlist,
  hasRedundantPrototype,
  hasRedundantRavenous,
  hasRedundantReadAhead,
  hasRedundantReconfigure,
  hasRedundantSquad,
  isReconfigureCreature,
  parseBlitzCost,
  parseCasualtyValue,
  parsePrototype,
  parseReconfigureCost,
  parseSquadCost,
  payCasualty,
  paySquadCost,
  prototype,
  ravenous,
  readAhead,
  reconfigure,
  shouldDrawFromRavenous,
  shouldSacrificeBlitz,
  shouldTriggerTraining,
  squad,
  triggerCasualty,
  unattachWithReconfigure,
  wasBlitzed,
  wasCasualtyPaid,
  wasPrototyped,
  wasSquadPaid,
  castWithBlitz,
  applyCompleated,
  compleated,
  calculateStartingLoyalty,
  castPrototyped,
  getEffectiveCost,
  getEffectivePower,
  getEffectiveToughness,
  canDrawFromRavenous,
  chooseReadAheadChapter,
} from '../src/keywordAbilities';

describe('Part 10: Keyword Abilities (Rules 702.151-702.160)', () => {
  describe('Reconfigure (702.151)', () => {
    it('should attach and unattach at sorcery speed and expose the attach target', () => {
      const ability = reconfigure('equipment-1', '{3}');
      const attached = attachWithReconfigure(ability, 'creature-1');
      const unattached = unattachWithReconfigure(attached);

      expect(canAttachWithReconfigure('creature-1', 'equipment-1', true)).toBe(true);
      expect(getReconfigureAttachedTo(attached)).toBe('creature-1');
      expect(isReconfigureCreature(attached)).toBe(false);
      expect(isReconfigureCreature(unattached)).toBe(true);
      expect(getReconfigureCost(attached)).toBe('{3}');
      expect(parseReconfigureCost('Reconfigure {3}')).toBe('{3}');
      expect(hasRedundantReconfigure([ability, reconfigure('equipment-2', '{2}')])).toBe(false);
    });
  });

  describe('Blitz (702.152)', () => {
    it('should grant haste, mark the end-step sacrifice, and draw on death after blitzing', () => {
      const ability = blitz('creature-1', '{2}{R}');
      const cast = castWithBlitz(ability);
      const drawn = drawCardFromBlitz(cast);

      expect(canCastWithBlitz('hand')).toBe(true);
      expect(wasBlitzed(cast)).toBe(true);
      expect(shouldSacrificeBlitz(cast)).toBe(true);
      expect(hasDrawnCardFromBlitz(drawn)).toBe(true);
      expect(parseBlitzCost('Blitz {2}{R}')).toBe('{2}{R}');
      expect(hasRedundantBlitz([ability, blitz('creature-2', '{2}{R}')])).toBe(true);
    });
  });

  describe('Casualty (702.153)', () => {
    it('should require a large enough sacrifice and produce a copy when paid', () => {
      const ability = casualty('spell-1', 2);
      const paid = payCasualty(ability, 'creature-1', 3)!;
      const copied = triggerCasualty(paid, 'copy-1');

      expect(canPayCasualty(ability, 3)).toBe(true);
      expect(wasCasualtyPaid(paid)).toBe(true);
      expect(getCasualtyValue(paid)).toBe(2);
      expect(getCasualtySacrificedCreature(paid)).toBe('creature-1');
      expect(getCasualtyCopyId(copied)).toBe('copy-1');
      expect(parseCasualtyValue('Casualty 2')).toBe(2);
      expect(hasRedundantCasualty([ability, casualty('spell-2', 3)])).toBe(false);
    });
  });

  describe('Enlist (702.154)', () => {
    it('should tap another eligible attacker helper and grant its power as a bonus', () => {
      const ability = enlist('attacker-1');
      const enlisted = enlistCreature(ability, 'helper-1', 4);

      expect(canEnlistCreature({ id: 'helper-1', controller: 'p1', attackedThisTurn: false, underControlSinceTurnBegan: true }, 'attacker-1', 'p1')).toBe(true);
      expect(getEnlistedCreature(enlisted)).toBe('helper-1');
      expect(getEnlistBonus(enlisted)).toBe(4);
      expect(hasRedundantEnlist([ability, enlist('attacker-2')])).toBe(false);
    });
  });

  describe('Read Ahead (702.155)', () => {
    it('should choose a legal starting chapter and restrict same-turn chapter triggers to the chosen chapter', () => {
      const ability = readAhead('saga-1', 3);
      const chosen = chooseReadAheadChapter(ability, 2);

      expect(canChooseReadAheadChapter(ability, 2)).toBe(true);
      expect(getReadAheadStartingChapter(chosen)).toBe(2);
      expect(getReadAheadLoreCounters(chosen)).toBe(2);
      expect(canChapterTrigger(chosen, 2, true)).toBe(true);
      expect(canChapterTrigger(chosen, 3, true)).toBe(false);
      expect(hasRedundantReadAhead([ability, readAhead('saga-2', 4)])).toBe(true);
    });
  });

  describe('Ravenous (702.156)', () => {
    it('should enter with X counters and draw only when X is five or more', () => {
      const ability = ravenous('creature-1', 5);
      const drawn = drawFromRavenous(ability);

      expect(canDrawFromRavenous(5)).toBe(true);
      expect(shouldDrawFromRavenous(ability)).toBe(true);
      expect(getRavenousCounters(ability)).toBe(5);
      expect(getRavenousXValue(ability)).toBe(5);
      expect(hasDrawnFromRavenous(drawn)).toBe(true);
      expect(hasRedundantRavenous([ability, ravenous('creature-2', 2)])).toBe(false);
    });
  });

  describe('Squad (702.157)', () => {
    it('should pay the squad cost multiple times and create one token per payment', () => {
      const ability = squad('creature-1', '{1}{W}');
      const paid = paySquadCost(ability, 2);
      const created = createSquadTokens(paid, ['token-1', 'token-2']);

      expect(canPaySquad(2)).toBe(true);
      expect(wasSquadPaid(paid)).toBe(true);
      expect(getSquadTimesPaid(paid)).toBe(2);
      expect(getSquadTokenCount(created)).toBe(2);
      expect(parseSquadCost('Squad {1}{W}')).toBe('{1}{W}');
      expect(hasRedundantSquad([ability, squad('creature-2', '{2}{W}')])).toBe(false);
    });
  });

  describe('Prototype (702.160)', () => {
    it('should use alternate cost and stats when cast prototyped', () => {
      const ability = prototype('artifact-1', '{1}{U}', 2, 1);
      const cast = castPrototyped(ability);

      expect(canCastPrototyped('hand')).toBe(true);
      expect(wasPrototyped(cast)).toBe(true);
      expect(getPrototypeStats(cast)).toEqual({ power: 2, toughness: 1 });
      expect(getEffectivePower(cast, 6)).toBe(2);
      expect(getEffectiveToughness(cast, 5)).toBe(1);
      expect(getEffectiveCost(cast, '{7}{U}')).toBe('{1}{U}');
      expect(parsePrototype('Prototype {1}{U} 2/1')).toEqual({ cost: '{1}{U}', power: 2, toughness: 1 });
      expect(hasRedundantPrototype([ability, prototype('artifact-2', '{2}{U}', 3, 3)])).toBe(true);
    });
  });

  describe('Compleated (702.150 reference)', () => {
    it('should still reduce loyalty by two per phyrexian life payment', () => {
      const ability = compleated('walker-1');
      const applied = applyCompleated(ability, 1);

      expect(canApplyCompleated(1)).toBe(true);
      expect(getLoyaltyReduction(applied)).toBe(2);
      expect(calculateStartingLoyalty(5, getLoyaltyReduction(applied))).toBe(3);
    });
  });
});