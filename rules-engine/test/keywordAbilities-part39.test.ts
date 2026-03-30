import { describe, expect, it } from 'vitest';
import {
  afflict,
  afterlife,
  applyAssist,
  ascend,
  assist,
  castWithEscape,
  castWithJumpStart,
  castWithSpectacle,
  chooseAssistingPlayer,
  chooseRiotHaste,
  companion,
  createAfflictSummary,
  createAfterlifeSummary,
  createAscendSummary,
  createAssistSummary,
  createCompanionSummary,
  createEscapeSummary,
  createJumpStartSummary,
  createMentorSummary,
  createRiotSummary,
  createSpectacleSummary,
  escape,
  grantCitysBlessing,
  hasTriggeredAfterlife,
  jumpStart,
  mentor,
  putCompanionIntoHand,
  revealCompanion,
  riot,
  spectacle,
  triggerAfflict,
  triggerAfterlife,
  triggerMentor,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 39 (remaining Part 8 summaries)', () => {
  describe('Afflict (702.130)', () => {
    it('should summarize blocked-life-loss pressure and trigger count', () => {
      expect(createAfflictSummary(triggerAfflict(afflict('crocodile-1', 3)), true)).toEqual({
        source: 'crocodile-1',
        afflictValue: 3,
        isBlocked: true,
        canTrigger: true,
        triggerCount: 1,
        defendingPlayerLifeLoss: 3,
      });
    });
  });

  describe('Ascend (702.131)', () => {
    it('should summarize blessing eligibility and retained blessing state', () => {
      expect(createAscendSummary(grantCitysBlessing(ascend('treasure-city')), 10, false)).toEqual({
        source: 'treasure-city',
        permanentCount: 10,
        alreadyHasBlessing: false,
        canGetBlessing: true,
        hasCitysBlessing: true,
      });
    });
  });

  describe('Assist (702.132)', () => {
    it('should summarize the chosen assistant, payment, and remaining generic cost', () => {
      expect(createAssistSummary(applyAssist(chooseAssistingPlayer(assist('spell-1'), 'p2'), 2), 'p1', 3, '{3}{R}')).toEqual({
        source: 'spell-1',
        assistingPlayer: 'p2',
        canChooseAssistant: true,
        manaPaidByAssist: 2,
        remainingCost: '{1}{R}',
      });
    });
  });

  describe('Jump-Start (702.133)', () => {
    it('should summarize graveyard casting, discard payment, and exile replacement', () => {
      expect(createJumpStartSummary(castWithJumpStart(jumpStart('radical-idea'), 'card-1'), 'graveyard')).toEqual({
        source: 'radical-idea',
        canCastFromGraveyard: true,
        wasJumpStarted: true,
        discardedCard: 'card-1',
        exilesOnResolution: true,
      });
    });
  });

  describe('Mentor (702.134)', () => {
    it('should summarize legal targeting and tracked mentor resolutions', () => {
      expect(createMentorSummary(triggerMentor(mentor('swiftblade', 3), 'ally-1'), 2)).toEqual({
        source: 'swiftblade',
        mentorPower: 3,
        targetPower: 2,
        canMentor: true,
        mentoredCreatureCount: 1,
        lastMentoredCreature: 'ally-1',
      });
    });
  });

  describe('Afterlife (702.135)', () => {
    it('should summarize death-triggered token creation and expose trigger state directly', () => {
      const triggered = triggerAfterlife(afterlife('minister-1', 2), ['spirit-1', 'spirit-2']);

      expect(hasTriggeredAfterlife(triggered)).toBe(true);
      expect(createAfterlifeSummary(triggered, true)).toEqual({
        source: 'minister-1',
        afterlifeValue: 2,
        diesFromBattlefield: true,
        canTrigger: true,
        hasTriggered: true,
        tokenCount: 2,
      });
    });
  });

  describe('Riot (702.136)', () => {
    it('should summarize the chosen riot mode and whether another choice remains', () => {
      expect(createRiotSummary(chooseRiotHaste(riot('rioter-1')))).toEqual({
        source: 'rioter-1',
        choice: 'haste',
        canChooseMode: false,
        grantsCounter: false,
        grantsHaste: true,
      });
    });
  });

  describe('Spectacle (702.137)', () => {
    it('should summarize alternate-cost availability and usage for spectacle', () => {
      expect(createSpectacleSummary(castWithSpectacle(spectacle('light-up', '{R}')), true)).toEqual({
        source: 'light-up',
        spectacleCost: '{R}',
        canCastWithSpectacle: true,
        wasSpectacled: true,
        usesAlternateCost: true,
      });
    });
  });

  describe('Escape (702.138)', () => {
    it('should summarize graveyard casting eligibility and escaped riders', () => {
      expect(createEscapeSummary(castWithEscape(escape('phoenix-1', '{2}{R}', 'two +1/+1 counters', 'has haste')), 'graveyard', 4, 3)).toEqual({
        source: 'phoenix-1',
        escapeCost: '{2}{R}',
        canCastFromGraveyard: true,
        hasEscaped: true,
        escapedWithCounters: 'two +1/+1 counters',
        escapedWithAbility: 'has haste',
      });
    });
  });

  describe('Companion (702.139)', () => {
    it('should summarize reveal eligibility and the once-per-game hand action window', () => {
      expect(createCompanionSummary(putCompanionIntoHand(revealCompanion(companion('jegantha', 'No card in your starting deck has more than one of the same mana symbol in its mana cost.'))), true, true, true, true, true)).toEqual({
        source: 'jegantha',
        condition: 'No card in your starting deck has more than one of the same mana symbol in its mana cost.',
        canReveal: true,
        isRevealed: true,
        canPutIntoHand: false,
        isPutIntoHand: true,
      });
    });
  });
});