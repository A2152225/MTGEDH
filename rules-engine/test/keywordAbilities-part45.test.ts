import { describe, expect, it } from 'vitest';
import {
  awaken,
  castWithAwaken,
  castWithEmerge,
  castWithSurge,
  chooseEscalateModes,
  createAwakenSummary,
  createCrewSummary,
  createDevoidSummary,
  createEmergeSummary,
  createEscalateSummary,
  createIngestSummary,
  createMeleeSummary,
  createMyriadSummary,
  createSkulkSummary,
  createSurgeSummary,
  crew,
  devoid,
  emerge,
  escalate,
  ingest,
  melee,
  myriad,
  skulk,
  surge,
  triggerIngest,
  triggerMelee,
  triggerMyriad,
  activateCrew,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 45 (early Part 7 summaries)', () => {
  describe('Awaken (702.113)', () => {
    it('should summarize awaken targeting and alternative-cost usage', () => {
      expect(createAwakenSummary(castWithAwaken(awaken('spell-1', 3, '{4}{U}{U}'), 'land-1'), { controller: 'p1', card: { type_line: 'Land' } }, 'p1')).toEqual({
        source: 'spell-1',
        awakenValue: 3,
        awakenCost: '{4}{U}{U}',
        canTargetLand: true,
        wasAwakened: true,
        targetLand: 'land-1',
      });
    });
  });

  describe('Devoid (702.114)', () => {
    it('should summarize always-on colorlessness across zones', () => {
      expect(createDevoidSummary(devoid('spell-1'), 'hand', ['U', 'R'])).toEqual({
        source: 'spell-1',
        zone: 'hand',
        appliesInZone: true,
        isColorless: true,
        resultingColors: [],
      });
    });
  });

  describe('Ingest (702.115)', () => {
    it('should summarize combat-damage triggering and exile count', () => {
      expect(createIngestSummary(triggerIngest(triggerIngest(ingest('creature-1'))), true)).toEqual({
        source: 'creature-1',
        dealtCombatDamageToPlayer: true,
        canTrigger: true,
        triggerCount: 2,
        exilesPerTrigger: 1,
      });
    });
  });

  describe('Myriad (702.116)', () => {
    it('should summarize multiplayer triggerability and token creation', () => {
      expect(createMyriadSummary(triggerMyriad(myriad('creature-2'), ['token-1', 'token-2']), 3)).toEqual({
        source: 'creature-2',
        opponentCount: 3,
        tokenCount: 2,
        canTrigger: true,
        hasTriggered: true,
      });
    });
  });

  describe('Surge (702.117)', () => {
    it('should summarize team-based surge availability and alternative-cost use', () => {
      expect(createSurgeSummary(castWithSurge(surge('spell-2', '{1}{U}')), false, true)).toEqual({
        source: 'spell-2',
        surgeCost: '{1}{U}',
        canUseSurge: true,
        wasSurged: true,
        usesAlternateCost: true,
      });
    });
  });

  describe('Skulk (702.118)', () => {
    it('should summarize legal and illegal blockers against skulk', () => {
      expect(createSkulkSummary(skulk('creature-3'), 2, [{ id: 'a', power: 1 }, { id: 'b', power: 4 }])).toEqual({
        source: 'creature-3',
        attackerPower: 2,
        legalBlockerExists: true,
        illegalBlockers: ['b'],
      });
    });
  });

  describe('Emerge (702.119)', () => {
    it('should summarize sacrifice choice and generic-cost reduction', () => {
      expect(createEmergeSummary(castWithEmerge(emerge('spell-3', '{6}{U}', 'artifact'), 'artifact-creature-1', 5))).toEqual({
        source: 'spell-3',
        emergeCost: '{6}{U}',
        emergeQuality: 'artifact',
        wasEmerged: true,
        sacrificedCreature: 'artifact-creature-1',
        manaReduction: 5,
        reducedCost: '{1}{U}',
      });
    });
  });

  describe('Escalate (702.120)', () => {
    it('should summarize extra-cost payments from chosen modes', () => {
      expect(createEscalateSummary(chooseEscalateModes(escalate('spell-4', '{2}'), 3), 3)).toEqual({
        source: 'spell-4',
        escalateCost: '{2}',
        modesChosen: 3,
        extraCostPayments: 2,
        canChooseModes: true,
      });
    });
  });

  describe('Melee (702.121)', () => {
    it('should summarize attacked-opponent count and current melee bonus', () => {
      expect(createMeleeSummary(triggerMelee(melee('creature-4'), 2), 2, true)).toEqual({
        source: 'creature-4',
        bonusThisTurn: 2,
        opponentsAttacked: 2,
        canTrigger: true,
      });
    });
  });

  describe('Crew (702.122)', () => {
    it('should summarize crew state, activation readiness, and remaining power shortfall', () => {
      expect(createCrewSummary(activateCrew(crew('vehicle-1', 3), ['creature-a', 'creature-b'], 4)!, 4)).toEqual({
        source: 'vehicle-1',
        crewValue: 3,
        isCrewed: true,
        crewedCreatureCount: 2,
        canActivate: true,
        powerShortfall: 0,
      });
    });
  });
});