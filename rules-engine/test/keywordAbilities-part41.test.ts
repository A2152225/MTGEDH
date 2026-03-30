import { describe, expect, it } from 'vitest';
import {
  backup,
  bargain,
  castConverted,
  createBackupSummary,
  createBargainSummary,
  createCraftSummary,
  createDisguiseSummary,
  createForMirrodinSummary,
  createLivingMetalSummary,
  createMoreThanMeetsTheEyeSummary,
  createSolvedSummary,
  createToxicSummary,
  craft,
  disguise,
  disguiseCastFaceDown,
  disguiseTurnFaceUp,
  forMirrodin,
  livingMetal,
  moreThanMeetsTheEye,
  payBargain,
  solveCase,
  solved,
  toxic,
  triggerBackup,
  triggerForMirrodin,
  updateLivingMetalTurn,
  activateCraft,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 41 (Part 11 summaries)', () => {
  describe('Living Metal (702.161)', () => {
    it('should summarize turn-based creature status from living metal', () => {
      expect(createLivingMetalSummary(updateLivingMetalTurn(livingMetal('vehicle-1'), true))).toEqual({
        source: 'vehicle-1',
        isYourTurn: true,
        canApply: true,
        isCreature: true,
      });
    });
  });

  describe('More Than Meets the Eye (702.162)', () => {
    it('should summarize converted casting and alternate-cost usage', () => {
      expect(createMoreThanMeetsTheEyeSummary(castConverted(moreThanMeetsTheEye('transformer-1', '{2}{U}')), 'hand')).toEqual({
        source: 'transformer-1',
        mtmteCost: '{2}{U}',
        canCastConverted: true,
        wasConverted: true,
        usesAlternateCost: true,
      });
    });
  });

  describe('For Mirrodin! (702.163)', () => {
    it('should summarize ETB triggering and the attached Rebel token id', () => {
      expect(createForMirrodinSummary(triggerForMirrodin(forMirrodin('equipment-1'), 'rebel-1'), true)).toEqual({
        source: 'equipment-1',
        enteredBattlefield: true,
        shouldTrigger: true,
        hasTriggered: true,
        tokenId: 'rebel-1',
      });
    });
  });

  describe('Toxic (702.164)', () => {
    it('should summarize stacked toxic values and poison counters dealt to a player', () => {
      expect(createToxicSummary([toxic('creature-1', 1), toxic('creature-1', 2)], true)).toEqual({
        source: 'creature-1',
        abilityCount: 2,
        totalToxicValue: 3,
        dealtCombatDamageToPlayer: true,
        canApplyToPlayer: true,
        poisonCountersToGive: 3,
      });
    });
  });

  describe('Backup (702.165)', () => {
    it('should summarize counters, chosen target, and whether abilities are granted', () => {
      expect(createBackupSummary(triggerBackup(backup('backup-1', 2, ['flying', 'lifelink']), 'creature-2'), false)).toEqual({
        source: 'backup-1',
        backupValue: 2,
        targetCreature: 'creature-2',
        canTarget: true,
        grantsAbilities: true,
        abilitiesToGrant: ['flying', 'lifelink'],
      });
    });
  });

  describe('Bargain (702.166)', () => {
    it('should summarize candidate legality and the sacrificed bargain payment', () => {
      expect(createBargainSummary(payBargain(bargain('spell-1'), 'artifact-1'), { card: { type_line: 'Artifact Creature — Golem' } })).toEqual({
        source: 'spell-1',
        canPayCandidate: true,
        wasBargained: true,
        sacrificedPermanent: 'artifact-1',
      });
    });
  });

  describe('Craft (702.167)', () => {
    it('should summarize activation gating and exiled materials for craft', () => {
      expect(createCraftSummary(activateCraft(craft('artifact-1', '{3}', 'artifact, creature card'), ['mat-1', 'mat-2']), 'battlefield', true, 2)).toEqual({
        source: 'artifact-1',
        craftCost: '{3}',
        materials: 'artifact, creature card',
        canActivate: true,
        hasCrafted: true,
        exiledCardCount: 2,
      });
    });
  });

  describe('Disguise (702.168)', () => {
    it('should summarize face-down state, face-up timing, and chosen X value', () => {
      expect(createDisguiseSummary(disguiseTurnFaceUp(disguiseCastFaceDown(disguise('card-1', '{2}{G}')), 4), 'hand', true)).toEqual({
        source: 'card-1',
        disguiseCost: '{2}{G}',
        canCastWithDisguise: true,
        isFaceDown: false,
        canTurnFaceUp: false,
        xValue: 4,
      });
    });
  });

  describe('Solved (702.169)', () => {
    it('should summarize solved gating for the linked Case ability text', () => {
      expect(createSolvedSummary(solveCase(solved('case-1', 'activated', '{T}: Draw a card.')), 'activated')).toEqual({
        source: 'case-1',
        abilityType: 'activated',
        isSolved: true,
        canUseAbility: true,
        abilityText: '{T}: Draw a card.',
      });
    });
  });
});