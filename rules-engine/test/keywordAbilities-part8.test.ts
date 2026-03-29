/**
 * Tests for Part 8 keyword abilities (Rules 702.130-702.139).
 */

import { describe, expect, it } from 'vitest';
import {
  afflict,
  afterlife,
  AFTERLIFE_SPIRIT_TOKEN,
  applyAssist,
  ascend,
  assist,
  canAscendNow,
  canCastWithEscape,
  canCastWithJumpStart,
  canCastWithSpectacle,
  canChooseAssistingPlayer,
  canChooseRiotMode,
  canMentor,
  canMentorAttackingCreature,
  canPutCompanionIntoHand,
  canPutRevealedCompanionIntoHand,
  canRevealCompanion,
  canTriggerAfflict,
  castWithEscape,
  castWithJumpStart,
  castWithSpectacle,
  chooseAssistingPlayer,
  chooseRiotCounter,
  chooseRiotHaste,
  companion,
  COMPANION_ACTION_COST,
  countPermanentsForAscend,
  createAfterlifeSpiritTokens,
  escape,
  getAfflictTriggerCount,
  getAfflictValue,
  getAfterlifeTokens,
  getAssistMana,
  getAssistingPlayer,
  getCompanionCondition,
  getEscapeCost,
  getEscapedAbilityText,
  getEscapedCounterText,
  getMentoredCreatures,
  getMentorTriggerCount,
  getRemainingAssistCost,
  getRiotChoice,
  getSpectacleCost,
  grantCitysBlessing,
  hasCitysBlessing,
  hasEscaped,
  hasRedundantAfflict,
  hasRedundantAfterlife,
  hasRedundantAscend,
  hasRedundantAssist,
  hasRedundantCompanion,
  hasRedundantEscape,
  hasRedundantJumpStart,
  hasRedundantMentor,
  hasRedundantRiot,
  hasRedundantSpectacle,
  hasTriggeredAfterlife,
  jumpStart,
  keepsCitysBlessing,
  mentor,
  parseAfflictValue,
  parseAfterlifeValue,
  parseEscapeCost,
  parseSpectacleCost,
  putCompanionIntoHand,
  revealCompanion,
  riot,
  shouldExileJumpStart,
  shouldGetCitysBlessing,
  shouldTriggerAfterlife,
  spectacle,
  triggerAfflict,
  triggerAfterlife,
  triggerMentor,
  wasJumpStarted,
  wasSpectacled,
} from '../src/keywordAbilities';

describe('Part 8: Keyword Abilities (Rules 702.130-702.139)', () => {
  describe('Afflict (702.130)', () => {
    it('should trigger when blocked and parse afflict values', () => {
      const ability = afflict('creature-1', 2);
      const triggered = triggerAfflict(triggerAfflict(ability));

      expect(canTriggerAfflict(true)).toBe(true);
      expect(getAfflictValue(triggered)).toBe(2);
      expect(getAfflictTriggerCount(triggered)).toBe(2);
      expect(parseAfflictValue('Afflict 2')).toBe(2);
      expect(hasRedundantAfflict([ability, afflict('creature-2', 3)])).toBe(false);
    });
  });

  describe('Ascend (702.131)', () => {
    it('should award and permanently keep the citys blessing once ten permanents are controlled', () => {
      const ability = ascend('permanent-1');
      const blessed = grantCitysBlessing(ability);

      expect(countPermanentsForAscend(['a', 'b', 'c'])).toBe(3);
      expect(shouldGetCitysBlessing(10, false)).toBe(true);
      expect(canAscendNow(10, false)).toBe(true);
      expect(hasCitysBlessing(blessed)).toBe(true);
      expect(keepsCitysBlessing(blessed)).toBe(true);
      expect(hasRedundantAscend([ability, ascend('permanent-2')])).toBe(false);
    });
  });

  describe('Assist (702.132)', () => {
    it('should choose another player and reduce only the generic cost paid by assist', () => {
      const ability = assist('spell-1');
      const chosen = chooseAssistingPlayer(ability, 'p2');
      const applied = applyAssist(chosen, 2);

      expect(canChooseAssistingPlayer('p1', 'p2', 3)).toBe(true);
      expect(canChooseAssistingPlayer('p1', 'p1', 3)).toBe(false);
      expect(getAssistingPlayer(chosen)).toBe('p2');
      expect(getAssistMana(applied)).toBe(2);
      expect(getRemainingAssistCost('{3}{R}', 2)).toBe('{1}{R}');
      expect(hasRedundantAssist([ability, assist('spell-2')])).toBe(false);
    });
  });

  describe('Jump-Start (702.133)', () => {
    it('should cast from graveyard with a discard and exile the spell afterward', () => {
      const ability = jumpStart('spell-1');
      const cast = castWithJumpStart(ability, 'discard-1');

      expect(canCastWithJumpStart('graveyard', true)).toBe(true);
      expect(canCastWithJumpStart('hand', true)).toBe(false);
      expect(wasJumpStarted(cast)).toBe(true);
      expect(shouldExileJumpStart(cast)).toBe(true);
      expect(hasRedundantJumpStart([ability, jumpStart('spell-2')])).toBe(false);
    });
  });

  describe('Mentor (702.134)', () => {
    it('should target only smaller attacking creatures and track each mentored creature', () => {
      const ability = mentor('mentor-1', 3);
      const triggered = triggerMentor(triggerMentor(ability, 'ally-1'), 'ally-2');

      expect(canMentor(3, 2)).toBe(true);
      expect(canMentorAttackingCreature(3, 2, true, true)).toBe(true);
      expect(canMentorAttackingCreature(3, 2, true, false)).toBe(false);
      expect(getMentoredCreatures(triggered)).toEqual(['ally-1', 'ally-2']);
      expect(getMentorTriggerCount(triggered)).toBe(2);
      expect(hasRedundantMentor([ability, mentor('mentor-2', 4)])).toBe(false);
    });
  });

  describe('Afterlife (702.135)', () => {
    it('should trigger on death, create Spirit tokens, and parse afterlife values', () => {
      const ability = afterlife('creature-1', 2);
      const triggered = triggerAfterlife(ability, ['spirit-1', 'spirit-2']);
      const created = createAfterlifeSpiritTokens('p1', ['spirit-1', 'spirit-2']);

      expect(shouldTriggerAfterlife(true)).toBe(true);
      expect(getAfterlifeTokens(triggered)).toEqual(['spirit-1', 'spirit-2']);
      expect(created).toHaveLength(2);
      expect(created[0].card.colors).toEqual(['W', 'B']);
      expect(created[0].card.oracle_text).toBe('Flying');
      expect(AFTERLIFE_SPIRIT_TOKEN.name).toBe('Spirit');
      expect(parseAfterlifeValue('Afterlife 2')).toBe(2);
      expect(hasRedundantAfterlife([ability, afterlife('creature-2', 1)])).toBe(false);
    });
  });

  describe('Riot (702.136)', () => {
    it('should choose either the counter or haste mode exactly once per instance', () => {
      const ability = riot('creature-1');
      const withCounter = chooseRiotCounter(ability);
      const withHaste = chooseRiotHaste(riot('creature-2'));

      expect(canChooseRiotMode(ability)).toBe(true);
      expect(getRiotChoice(withCounter)).toBe('counter');
      expect(getRiotChoice(withHaste)).toBe('haste');
      expect(hasRedundantRiot([ability, riot('creature-3')])).toBe(false);
    });
  });

  describe('Spectacle (702.137)', () => {
    it('should allow alternate casting after an opponent lost life and parse the spectacle cost', () => {
      const ability = spectacle('spell-1', '{1}{R}');
      const cast = castWithSpectacle(ability);

      expect(canCastWithSpectacle(true)).toBe(true);
      expect(wasSpectacled(cast)).toBe(true);
      expect(getSpectacleCost(cast)).toBe('{1}{R}');
      expect(parseSpectacleCost('Spectacle {1}{R}')).toBe('{1}{R}');
      expect(hasRedundantSpectacle([ability, spectacle('spell-2', '{1}{R}')])).toBe(true);
    });
  });

  describe('Escape (702.138)', () => {
    it('should cast from graveyard, preserve escape riders, and parse escape costs', () => {
      const ability = escape('spell-1', '{3}{G}', 'two +1/+1 counters', 'has haste');
      const cast = castWithEscape(ability);

      expect(canCastWithEscape('graveyard', 3, 2)).toBe(true);
      expect(hasEscaped(cast)).toBe(true);
      expect(getEscapeCost(cast)).toBe('{3}{G}');
      expect(getEscapedCounterText(cast)).toBe('two +1/+1 counters');
      expect(getEscapedAbilityText(cast)).toBe('has haste');
      expect(parseEscapeCost('Escape {3}{G}')).toBe('{3}{G}');
      expect(hasRedundantEscape([ability, escape('spell-2', '{2}{G}')])).toBe(false);
    });
  });

  describe('Companion (702.139)', () => {
    it('should reveal before the game and move into hand only through the special action window', () => {
      const ability = companion('card-1', 'Each permanent card in your starting deck has an activated ability.');
      const revealed = revealCompanion(ability);
      const inHand = putCompanionIntoHand(revealed);

      expect(canRevealCompanion(true, true)).toBe(true);
      expect(canPutCompanionIntoHand(true, true, true, false)).toBe(true);
      expect(canPutRevealedCompanionIntoHand(revealed, true, true, true)).toBe(true);
      expect(getCompanionCondition(ability)).toContain('activated ability');
      expect(COMPANION_ACTION_COST).toBe('{3}');
      expect(inHand.isPutIntoHand).toBe(true);
      expect(hasRedundantCompanion([ability, companion('card-2', 'Different condition')])).toBe(false);
    });
  });
});