import { describe, expect, it } from 'vitest';
import {
  attachWithReconfigure,
  blitz,
  castPrototyped,
  castWithBlitz,
  casualty,
  createBlitzSummary,
  createCasualtySummary,
  createEnlistSummary,
  createPrototypeSummary,
  createRavenousSummary,
  createReadAheadSummary,
  createReconfigureSummary,
  createSquadSummary,
  createSquadTokens,
  drawFromRavenous,
  enlist,
  enlistCreature,
  payCasualty,
  paySquadCost,
  prototype,
  ravenous,
  readAhead,
  reconfigure,
  chooseReadAheadChapter,
  squad,
  triggerCasualty,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 40 (Part 10 summaries)', () => {
  describe('Reconfigure (702.151)', () => {
    it('should summarize attach and unattach timing for reconfigure', () => {
      expect(createReconfigureSummary(attachWithReconfigure(reconfigure('cloudsteel-kirin', '{5}'), 'creature-1'), 'creature-1', true)).toEqual({
        source: 'cloudsteel-kirin',
        reconfigureCost: '{5}',
        attachedTo: 'creature-1',
        isCreature: false,
        canAttach: true,
        canUnattach: true,
      });
    });
  });

  describe('Blitz (702.152)', () => {
    it('should summarize blitz casting, sacrifice timing, and death trigger expectations', () => {
      expect(createBlitzSummary(castWithBlitz(blitz('jaxis', '{2}{R}')), 'hand')).toEqual({
        source: 'jaxis',
        blitzCost: '{2}{R}',
        canCastWithBlitz: true,
        wasBlitzed: true,
        sacrificesAtEndStep: true,
        drawsCardOnDeath: true,
      });
    });
  });

  describe('Casualty (702.153)', () => {
    it('should summarize payment eligibility, the sacrificed creature, and the resulting copy', () => {
      expect(createCasualtySummary(triggerCasualty(payCasualty(casualty('invoke-despair', 2), 'token-1', 3)!, 'copy-1'), 3)).toEqual({
        source: 'invoke-despair',
        casualtyValue: 2,
        creaturePower: 3,
        canPay: true,
        wasPaid: true,
        sacrificedCreature: 'token-1',
        copyId: 'copy-1',
      });
    });
  });

  describe('Enlist (702.154)', () => {
    it('should summarize helper eligibility and the granted power bonus', () => {
      expect(createEnlistSummary(enlistCreature(enlist('guardian-1'), 'soldier-1', 3), {
        id: 'soldier-1',
        controller: 'p1',
        attackedThisTurn: false,
        underControlSinceTurnBegan: true,
      }, 'p1')).toEqual({
        source: 'guardian-1',
        enlistedCreature: 'soldier-1',
        powerBonus: 3,
        canEnlist: true,
        didEnlist: true,
      });
    });
  });

  describe('Read Ahead (702.155)', () => {
    it('should summarize the chosen starting chapter and same-turn trigger gate', () => {
      expect(createReadAheadSummary(chooseReadAheadChapter(readAhead('the-elder-dragon-war', 3), 2), 2, true)).toEqual({
        source: 'the-elder-dragon-war',
        finalChapterNumber: 3,
        chosenStartingChapter: 2,
        loreCounters: 2,
        checkedChapter: 2,
        canTriggerChapter: true,
      });
    });
  });

  describe('Ravenous (702.156)', () => {
    it('should summarize X, counters, and the draw threshold for ravenous', () => {
      expect(createRavenousSummary(drawFromRavenous(ravenous('tyranid-1', 5)))).toEqual({
        source: 'tyranid-1',
        xValue: 5,
        countersAdded: 5,
        canDrawCard: true,
        hasDrawnCard: true,
      });
    });
  });

  describe('Squad (702.157)', () => {
    it('should summarize payments and resulting token copies for squad', () => {
      expect(createSquadSummary(createSquadTokens(paySquadCost(squad('space-marine', '{1}{W}'), 2), ['token-1', 'token-2']))).toEqual({
        source: 'space-marine',
        squadCost: '{1}{W}',
        timesPaid: 2,
        wasPaid: true,
        tokenCount: 2,
      });
    });
  });

  describe('Prototype (702.160)', () => {
    it('should summarize alternative casting and the effective prototype stats', () => {
      expect(createPrototypeSummary(castPrototyped(prototype('skitterbeam-battalion', '{3}{R}', 2, 2)), 'hand', 4, 4)).toEqual({
        source: 'skitterbeam-battalion',
        prototypeCost: '{3}{R}',
        canCastPrototyped: true,
        wasPrototyped: true,
        effectivePower: 2,
        effectiveToughness: 2,
      });
    });
  });
});