import { describe, expect, it } from 'vitest';
import {
  replicate,
  payReplicate,
  getReplicateCopies,
  getReplicateCopyIds,
  createReplicateResolutionResult,
  fortify,
  attachFortification,
  detachFortification,
  canActivateFortifyAbility,
  createFortifyAttachmentResult,
  gravestorm,
  getGravestormCopies,
  getGravestormCopyIds,
  createGravestormResolutionResult,
  champion,
  setChampionedCard,
  hasChampionedCard,
  canChampionObject,
  createChampionExileResult,
  createChampionReturnResult,
  changeling,
  hasCreatureType,
  getRepresentativeChangelingTypes,
  hasChangelingType,
  createChangelingTypeResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 29 (remaining Part 4 state and attachment helpers)', () => {
  describe('Replicate (702.56)', () => {
    it('should expose generated copy ids from the number of times replicate was paid', () => {
      const paid = payReplicate(replicate('pyromatics', '{1}{R}'), 3);

      expect(getReplicateCopies(paid)).toBe(3);
      expect(getReplicateCopyIds(paid)).toEqual([
        'pyromatics-replicate-copy-1',
        'pyromatics-replicate-copy-2',
        'pyromatics-replicate-copy-3',
      ]);
    });

    it('should create a replicate resolution summary', () => {
      const paid = payReplicate(replicate('thunderheads', '{2}{U}'), 2);

      expect(createReplicateResolutionResult(paid)).toEqual({
        source: 'thunderheads',
        copiesCreated: 2,
        copyIds: ['thunderheads-replicate-copy-1', 'thunderheads-replicate-copy-2'],
      });
    });
  });

  describe('Fortify (702.67)', () => {
    it('should only activate from the battlefield at sorcery speed', () => {
      const ability = fortify('darksteel-garrison', '{3}');

      expect(canActivateFortifyAbility(ability, 'battlefield', true)).toBe(true);
      expect(canActivateFortifyAbility(ability, 'battlefield', false)).toBe(false);
      expect(canActivateFortifyAbility(ability, 'hand', true)).toBe(false);
    });

    it('should create an attachment summary and still support detach', () => {
      const attached = attachFortification(fortify('darksteel-garrison', '{3}'), 'ancient-den');

      expect(attached.attachedTo).toBe('ancient-den');
      expect(detachFortification(attached).attachedTo).toBeUndefined();
      expect(createFortifyAttachmentResult(attached, 'battlefield', true, 'ancient-den')).toEqual({
        source: 'darksteel-garrison',
        attachedTo: 'ancient-den',
        costPaid: '{3}',
      });
    });
  });

  describe('Gravestorm (702.69)', () => {
    it('should expose generated copy ids from the number of permanents that died', () => {
      const ability = gravestorm('bitter-ordeal', 3);

      expect(getGravestormCopies(ability)).toBe(3);
      expect(getGravestormCopyIds(ability)).toEqual([
        'bitter-ordeal-gravestorm-copy-1',
        'bitter-ordeal-gravestorm-copy-2',
        'bitter-ordeal-gravestorm-copy-3',
      ]);
    });

    it('should create a gravestorm resolution summary', () => {
      expect(createGravestormResolutionResult(gravestorm('bitter-ordeal', 2))).toEqual({
        source: 'bitter-ordeal',
        copiesCreated: 2,
        copyIds: ['bitter-ordeal-gravestorm-copy-1', 'bitter-ordeal-gravestorm-copy-2'],
      });
    });
  });

  describe('Champion (702.72)', () => {
    it('should require a different permanent with the matching object type', () => {
      const ability = champion('changeling-hero', 'Shapeshifter');

      expect(canChampionObject(ability, ['Shapeshifter'], 'other-shapeshifter')).toBe(true);
      expect(canChampionObject(ability, ['Shapeshifter'], 'changeling-hero')).toBe(false);
      expect(canChampionObject(ability, ['Warrior'], 'other-warrior')).toBe(false);
    });

    it('should create exile and return summaries for the championed card', () => {
      const set = setChampionedCard(champion('changeling-berserker', 'Shapeshifter'), 'ally-shapeshifter');

      expect(hasChampionedCard(set)).toBe(true);
      expect(createChampionExileResult(set, ['Shapeshifter'])).toEqual({
        source: 'changeling-berserker',
        championedCard: 'ally-shapeshifter',
        exilesChosenCard: true,
      });
      expect(createChampionReturnResult(set)).toEqual({
        source: 'changeling-berserker',
        returningCard: 'ally-shapeshifter',
        returnsToBattlefield: true,
      });
    });
  });

  describe('Changeling (702.73)', () => {
    it('should report representative creature types and match any non-empty query', () => {
      const ability = changeling('amoeboid-changeling');

      expect(getRepresentativeChangelingTypes()).toContain('Shapeshifter');
      expect(hasCreatureType(ability, 'Dragon')).toBe(true);
      expect(hasChangelingType(ability, 'Goblin')).toBe(true);
      expect(hasChangelingType(ability, '')).toBe(false);
    });

    it('should create a summary showing all queried creature types match', () => {
      expect(createChangelingTypeResult(changeling('chameleon-colossus'), ['Elf', 'Warrior', 'Zombie'])).toEqual({
        source: 'chameleon-colossus',
        queriedTypes: ['Elf', 'Warrior', 'Zombie'],
        allTypesMatch: true,
      });
    });
  });
});