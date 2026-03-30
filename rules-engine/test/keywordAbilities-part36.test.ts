import { describe, expect, it } from 'vitest';
import {
  mutate,
  castWithMutate,
  completeMutate,
  createDayNightTransitionSummary,
  createMutateMergeSummary,
  daybound,
  isValidMutateTarget,
  nightbound,
} from '../src/keywordAbilities';
import {
  adventure,
  castAdventure,
  createAdventureCastingSummary,
  sendOnAdventure,
} from '../src/keywordAbilities/adventure';
import {
  createRegenerationDestructionSummary,
  regenerate,
} from '../src/keywordAbilities/regeneration';

describe('Keyword Abilities - Part 36 (standalone late-summary cleanup)', () => {
  describe('Adventure (Rule 715)', () => {
    it('should summarize when an adventure card in exile can only cast its creature half', () => {
      const ability = sendOnAdventure(
        castAdventure(
          adventure('beanstalk-giant', 'Beanstalk Giant', '{6}{G}', {
            name: 'Fertile Footsteps',
            manaCost: '{2}{G}',
            type: 'Sorcery — Adventure',
            oracleText: 'Search your library for a basic land card.',
          }),
          'p1',
        ),
      );

      expect(createAdventureCastingSummary(ability, 'exile')).toEqual({
        source: 'beanstalk-giant',
        state: 'on_adventure',
        optionCount: 1,
        canCastCreature: true,
        canCastAdventure: false,
        adventureCasterId: 'p1',
      });
    });
  });

  describe('Daybound and Nightbound (702.145)', () => {
    it('should summarize day/night cycle transforms and the manual-transform restriction', () => {
      const front = daybound('werewolf-front');
      const back = nightbound('werewolf-back');

      expect(createDayNightTransitionSummary(false, true, false, front.isFrontFace, back.isBackFace, true)).toEqual({
        becomesDay: true,
        entersTransformed: true,
        transformsToNight: true,
        transformsToDay: false,
        manualTransformAllowed: false,
      });
    });
  });

  describe('Mutate (702.140)', () => {
    it('should summarize a legal mutate merge and whether the top card sets characteristics', () => {
      const base = castWithMutate(mutate('Gemrazer', '{1}{G}{G}'), 'creature-1');
      const completed = completeMutate(base, false, ['card-1', 'card-2']);
      const validation = isValidMutateTarget({ owner: 'p1', card: { type_line: 'Creature — Beast' } }, 'p1');

      expect(createMutateMergeSummary(completed, validation)).toEqual({
        source: 'Gemrazer',
        targetCreature: 'creature-1',
        usedMutateCost: true,
        legalTarget: true,
        merged: true,
        cardCount: 2,
        topCardDeterminesCharacteristics: false,
      });
    });
  });

  describe('Regeneration (Rule 701.15)', () => {
    it('should summarize when an available shield prevents destruction and removes combat damage', () => {
      const regen = regenerate('perm-1', 'p1');

      expect(createRegenerationDestructionSummary('perm-1', [regen.shield!], false, 3, true)).toEqual({
        permanentId: 'perm-1',
        availableShieldCount: 1,
        canRegenerate: true,
        willRegenerate: true,
        permanentTapped: true,
        removedFromCombat: true,
        damageRemoved: true,
      });
    });
  });
});