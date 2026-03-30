import { describe, expect, it } from 'vitest';
import {
  canBeSacrificed,
  canPlay,
  completeScry,
  completeSurveil,
  createPlayResult,
  createRegenerateSummary,
  createRegenerationShield,
  createSacrificeResult,
  createScryResult,
  createSurveilResult,
  playCard,
  playLand,
  regenerate,
  revealDoesNotMoveCard,
  sacrificePermanent,
  SACRIFICE_IS_NOT_DESTRUCTION,
  scry,
  shouldTriggerScry,
  shouldTriggerSurveil,
  surveil,
  SURVEIL_VS_SCRY_DIFFERENCE,
  useRegenerationShield,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 15 (resource and top-of-library summaries)', () => {
  describe('Rule 701.18: Play', () => {
    it('should summarize legal land plays separately from ordinary spell plays', () => {
      const landAction = playLand('land-1', 'p1');
      const spellAction = playCard('spell-1', 'p1', 'spell', 'exile');

      expect(canPlay('land', true, true, true, 0, 0)).toBe(true);
      expect(createPlayResult(landAction, true)).toEqual({
        cardId: 'land-1',
        playerId: 'p1',
        playType: 'land',
        fromZone: 'hand',
        legal: true,
        consumesLandPlay: true,
      });
      expect(createPlayResult(spellAction, true).consumesLandPlay).toBe(false);
    });
  });

  describe('Rule 701.19: Regenerate', () => {
    it('should summarize active regeneration shields and combat removal effects', () => {
      const activeShield = createRegenerationShield('perm-1');
      const spentShield = useRegenerationShield(activeShield);

      expect(regenerate('perm-1').type).toBe('regenerate');
      expect(createRegenerateSummary('perm-1', [spentShield, createRegenerationShield('perm-1')], true).hasActiveShield).toBe(true);
      expect(createRegenerateSummary('perm-1', [spentShield], true).removesFromCombat).toBe(true);
    });
  });

  describe('Rule 701.21: Sacrifice', () => {
    it('should summarize legal sacrifice to the graveyard and ignore indestructible', () => {
      expect(canBeSacrificed(true)).toBe(true);
      expect(SACRIFICE_IS_NOT_DESTRUCTION).toBe(true);
      expect(createSacrificeResult(sacrificePermanent('perm-1', 'p1'), true)).toEqual({
        permanentId: 'perm-1',
        controllerId: 'p1',
        legal: true,
        destinationZone: 'graveyard',
        isDestruction: false,
        ignoresIndestructible: true,
      });
    });
  });

  describe('Rule 701.22: Scry', () => {
    it('should summarize actual scry count and top-versus-bottom decisions', () => {
      const action = completeScry('p1', 3, ['card-1'], ['card-2', 'card-3']);

      expect(shouldTriggerScry(0)).toBe(false);
      expect(createScryResult(action, 2)).toEqual({
        playerId: 'p1',
        requestedCount: 3,
        actualCount: 2,
        topCount: 1,
        bottomCount: 2,
        triggersScryAbilities: true,
      });
    });
  });

  describe('Rule 701.25: Surveil', () => {
    it('should summarize actual surveil count and graveyard-versus-top decisions', () => {
      const action = completeSurveil('p1', 3, ['card-1'], ['card-2', 'card-3']);

      expect(shouldTriggerSurveil(0)).toBe(false);
      expect(revealDoesNotMoveCard()).toBe(true);
      expect(createSurveilResult(action, 2)).toEqual({
        playerId: 'p1',
        requestedCount: 3,
        actualCount: 2,
        graveyardCount: 1,
        topCount: 2,
        triggersSurveilAbilities: true,
      });
      expect(SURVEIL_VS_SCRY_DIFFERENCE.surveil).toContain('graveyard');
    });
  });
});