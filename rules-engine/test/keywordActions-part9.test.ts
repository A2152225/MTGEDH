import { describe, expect, it } from 'vitest';
import {
  canActivateAction,
  createActivationResult,
  createAttachResult,
  changesAttachmentTimestamp,
  canCastFromZone,
  createCastResult,
  counterSpell,
  createCounterResolution,
  countersSpellToGraveyard,
  createTokens,
  createTokenResult,
  getCreatedTokenCount,
  createDestroyResult,
  destroyPermanent,
  isDestroyCause,
  DestructionCause,
  discardChosen,
  createDiscardResolution,
  requiresDiscardChoice,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 9 (core part-1 action summaries)', () => {
  describe('Rule 701.2: Activate', () => {
    it('should require priority, costs, and legal timing to activate an ability', () => {
      expect(canActivateAction(true, true, true)).toBe(true);
      expect(canActivateAction(false, true, true)).toBe(false);
      expect(canActivateAction(true, false, true)).toBe(false);
    });

    it('should summarize whether an activated ability goes on the stack and resolves', () => {
      expect(createActivationResult({ type: 'activate', abilityId: 'equip-1', controllerId: 'p1' }, true, true)).toEqual({
        abilityId: 'equip-1',
        controllerId: 'p1',
        costsPaid: true,
        usesStack: true,
        resolves: true,
      });
    });
  });

  describe('Rule 701.3: Attach', () => {
    it('should detect when reattaching creates a new timestamp', () => {
      expect(changesAttachmentTimestamp(null, 'creature-1')).toBe(true);
      expect(changesAttachmentTimestamp('creature-1', 'creature-2')).toBe(true);
      expect(changesAttachmentTimestamp('creature-1', 'creature-1')).toBe(false);
    });

    it('should summarize attachment movement to a new target', () => {
      expect(createAttachResult({ id: 'sword-1', attachedTo: null, timestamp: 10 }, 'creature-1', 25)).toEqual({
        attachmentId: 'sword-1',
        previousTargetId: null,
        targetId: 'creature-1',
        attached: true,
        timestampChanged: true,
      });
    });
  });

  describe('Rule 701.5: Cast', () => {
    it('should validate allowed casting zones', () => {
      expect(canCastFromZone('hand')).toBe(true);
      expect(canCastFromZone('exile', ['hand', 'exile'])).toBe(true);
      expect(canCastFromZone('graveyard')).toBe(false);
    });

    it('should summarize whether a cast spell legally moves to the stack', () => {
      expect(createCastResult({ type: 'cast', spellId: 'spell-1', controllerId: 'p1', fromZone: 'hand' }, true, true)).toEqual({
        spellId: 'spell-1',
        controllerId: 'p1',
        fromZone: 'hand',
        costsPaid: true,
        legal: true,
        movesToStack: true,
      });
    });
  });

  describe('Rule 701.6: Counter', () => {
    it('should distinguish countered spells from countered abilities', () => {
      expect(countersSpellToGraveyard('spell')).toBe(true);
      expect(countersSpellToGraveyard('ability')).toBe(false);
    });

    it('should summarize the destination of a countered spell', () => {
      expect(createCounterResolution(counterSpell('counter-target'))).toEqual({
        countered: true,
        costsRefunded: false,
        destination: 'graveyard',
      });
    });
  });

  describe('Rule 701.7: Create', () => {
    it('should report the number of tokens created without going below zero', () => {
      expect(getCreatedTokenCount(createTokens('p1', 3, 'Treasure'))).toBe(3);
      expect(getCreatedTokenCount(createTokens('p1', -2, 'Treasure'))).toBe(0);
    });

    it('should summarize token creation and whether custom characteristics were supplied', () => {
      const action = createTokens('p1', 2, 'Soldier', { power: 1, toughness: 1 });
      expect(createTokenResult(action)).toEqual({
        controllerId: 'p1',
        count: 2,
        tokenType: 'Soldier',
        hasCustomCharacteristics: true,
      });
    });
  });

  describe('Rule 701.8: Destroy', () => {
    it('should recognize valid destruction causes', () => {
      expect(isDestroyCause(DestructionCause.DESTROY_KEYWORD)).toBe(true);
      expect(isDestroyCause(DestructionCause.LETHAL_DAMAGE)).toBe(true);
      expect(isDestroyCause('bounce')).toBe(false);
    });

    it('should summarize whether destruction is replaced by regeneration', () => {
      expect(destroyPermanent('perm-1', DestructionCause.LETHAL_DAMAGE).type).toBe('destroy');
      expect(createDestroyResult(DestructionCause.LETHAL_DAMAGE, true)).toEqual({
        destroyed: false,
        cause: DestructionCause.LETHAL_DAMAGE,
        regenerated: true,
      });
    });
  });

  describe('Rule 701.9: Discard', () => {
    it('should distinguish random discard from discard modes that require a chosen card', () => {
      expect(requiresDiscardChoice('choice')).toBe(true);
      expect(requiresDiscardChoice('opponent-choice')).toBe(true);
      expect(requiresDiscardChoice('random')).toBe(false);
    });

    it('should summarize discard resolution into visible and hidden destinations', () => {
      expect(createDiscardResolution(discardChosen('p1', 'p2', 'card-1'), 'hidden-zone', false)).toEqual({
        playerId: 'p1',
        mode: 'opponent-choice',
        cardId: 'card-1',
        discarded: true,
        destination: 'hidden-zone',
        revealed: false,
        characteristicsDefined: false,
      });
    });
  });
});