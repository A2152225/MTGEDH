/**
 * winEffectCards.test.ts
 * 
 * Tests for win effect card detection and handling (Rule 104.2b)
 */

import { describe, it, expect } from 'vitest';
import {
  WinEffectType,
  detectWinEffect,
  collectWinEffects,
  playerHasCantLoseEffect,
  opponentsHaveCantWinEffect,
  checkEmptyLibraryDrawWin,
  calculateDevotion,
  checkThassasOracleWin,
  checkUpkeepWinConditions,
  createWinEffectChoiceEvent,
} from '../src/winEffectCards';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

// Helper to create a test permanent
function createTestPermanent(
  id: string,
  name: string,
  oracleText: string,
  controller: string,
  manaCost: string = ''
): BattlefieldPermanent {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    attachments: [],
    modifiers: [],
    card: {
      id,
      name,
      oracle_text: oracleText,
      mana_cost: manaCost,
      type_line: 'Creature',
    } as KnownCardRef,
  };
}

describe('Win Effect Cards', () => {
  describe('detectWinEffect', () => {
    it('should detect Laboratory Maniac win effect', () => {
      const card: KnownCardRef = {
        id: 'lab-man',
        name: 'Laboratory Maniac',
        oracle_text: 'If you would draw a card while your library has no cards in it, you win the game instead.',
        type_line: 'Creature — Human Wizard',
      };
      
      const effect = detectWinEffect(card, 'perm-1', 'player-1');
      
      expect(effect).not.toBeNull();
      expect(effect?.type).toBe(WinEffectType.EMPTY_LIBRARY_DRAW_WIN);
      expect(effect?.isReplacement).toBe(true);
      expect(effect?.controllerId).toBe('player-1');
    });
    
    it('should detect Jace, Wielder of Mysteries win effect', () => {
      const card: KnownCardRef = {
        id: 'jace',
        name: 'Jace, Wielder of Mysteries',
        oracle_text: 'If you would draw a card while your library has no cards in it, you win the game instead.',
        type_line: 'Legendary Planeswalker — Jace',
      };
      
      const effect = detectWinEffect(card, 'perm-1', 'player-1');
      
      expect(effect).not.toBeNull();
      expect(effect?.type).toBe(WinEffectType.EMPTY_LIBRARY_DRAW_WIN);
      expect(effect?.isReplacement).toBe(true);
    });
    
    it("should detect Thassa's Oracle win effect", () => {
      const card: KnownCardRef = {
        id: 'oracle',
        name: "Thassa's Oracle",
        oracle_text: 'When Thassa\'s Oracle enters the battlefield, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.',
        type_line: 'Creature — Merfolk Wizard',
      };
      
      const effect = detectWinEffect(card, 'perm-1', 'player-1');
      
      expect(effect).not.toBeNull();
      expect(effect?.type).toBe(WinEffectType.DEVOTION_WIN);
      expect(effect?.isReplacement).toBe(false);
    });
    
    it('should detect Platinum Angel cant lose effect', () => {
      const card: KnownCardRef = {
        id: 'angel',
        name: 'Platinum Angel',
        oracle_text: "You can't lose the game and your opponents can't win the game.",
        type_line: 'Artifact Creature — Angel',
      };
      
      const effect = detectWinEffect(card, 'perm-1', 'player-1');
      
      expect(effect).not.toBeNull();
      expect(effect?.type).toBe(WinEffectType.CANT_LOSE);
    });
    
    it('should return null for regular cards', () => {
      const card: KnownCardRef = {
        id: 'bear',
        name: 'Grizzly Bears',
        oracle_text: '',
        type_line: 'Creature — Bear',
      };
      
      const effect = detectWinEffect(card, 'perm-1', 'player-1');
      
      expect(effect).toBeNull();
    });
  });
  
  describe('collectWinEffects', () => {
    it('should collect all win effects from battlefield', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'lab-man',
          'Laboratory Maniac',
          'If you would draw a card while your library has no cards in it, you win the game instead.',
          'player-1'
        ),
        createTestPermanent(
          'bear',
          'Grizzly Bears',
          '',
          'player-1'
        ),
        createTestPermanent(
          'angel',
          'Platinum Angel',
          "You can't lose the game and your opponents can't win the game.",
          'player-2'
        ),
      ];
      
      const effects = collectWinEffects(battlefield);
      
      expect(effects.length).toBe(2);
      expect(effects.some(e => e.type === WinEffectType.EMPTY_LIBRARY_DRAW_WIN)).toBe(true);
      expect(effects.some(e => e.type === WinEffectType.CANT_LOSE)).toBe(true);
    });
  });
  
  describe('playerHasCantLoseEffect', () => {
    it('should return true when player controls Platinum Angel', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'angel',
          'Platinum Angel',
          "You can't lose the game and your opponents can't win the game.",
          'player-1'
        ),
      ];
      
      const result = playerHasCantLoseEffect('player-1', battlefield);
      
      expect(result.hasCantLose).toBe(true);
      expect(result.source).toBe('Platinum Angel');
    });
    
    it("should return false when player doesn't control protective permanent", () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'angel',
          'Platinum Angel',
          "You can't lose the game and your opponents can't win the game.",
          'player-2' // Different player
        ),
      ];
      
      const result = playerHasCantLoseEffect('player-1', battlefield);
      
      expect(result.hasCantLose).toBe(false);
    });
  });
  
  describe('opponentsHaveCantWinEffect', () => {
    it('should return true when opponent controls Platinum Angel', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'angel',
          'Platinum Angel',
          "You can't lose the game and your opponents can't win the game.",
          'player-2'
        ),
      ];
      
      // player-1 is trying to win, player-2 has Platinum Angel
      const result = opponentsHaveCantWinEffect('player-1', battlefield);
      
      expect(result.hasCantWin).toBe(true);
      expect(result.source).toBe('Platinum Angel');
    });
    
    it('should return false when only winning player controls protective permanent', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'angel',
          'Platinum Angel',
          "You can't lose the game and your opponents can't win the game.",
          'player-1'
        ),
      ];
      
      const result = opponentsHaveCantWinEffect('player-1', battlefield);
      
      expect(result.hasCantWin).toBe(false);
    });
  });
  
  describe('checkEmptyLibraryDrawWin', () => {
    it('should return win when player has Lab Man and empty library', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'lab-man',
          'Laboratory Maniac',
          'If you would draw a card while your library has no cards in it, you win the game instead.',
          'player-1'
        ),
      ];
      
      const result = checkEmptyLibraryDrawWin('player-1', 0, battlefield);
      
      expect(result.playerWins).toBe(true);
      expect(result.winningPlayerId).toBe('player-1');
      expect(result.sourceName).toBe('Laboratory Maniac');
    });
    
    it('should not win when library has cards', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'lab-man',
          'Laboratory Maniac',
          'If you would draw a card while your library has no cards in it, you win the game instead.',
          'player-1'
        ),
      ];
      
      const result = checkEmptyLibraryDrawWin('player-1', 5, battlefield);
      
      expect(result.playerWins).toBe(false);
    });
    
    it('should not win when opponent has Platinum Angel', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'lab-man',
          'Laboratory Maniac',
          'If you would draw a card while your library has no cards in it, you win the game instead.',
          'player-1'
        ),
        createTestPermanent(
          'angel',
          'Platinum Angel',
          "You can't lose the game and your opponents can't win the game.",
          'player-2'
        ),
      ];
      
      const result = checkEmptyLibraryDrawWin('player-1', 0, battlefield);
      
      expect(result.playerWins).toBe(false);
      expect(result.blockedBy).toBe('Platinum Angel');
    });
  });
  
  describe('calculateDevotion', () => {
    it('should calculate devotion to blue correctly', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent('oracle', "Thassa's Oracle", '', 'player-1', '{U}{U}'), // 2 blue
        createTestPermanent('counterspell', 'Counterspell', '', 'player-1', '{U}{U}'), // 2 blue
        createTestPermanent('bear', 'Grizzly Bears', '', 'player-1', '{1}{G}'), // 0 blue
      ];
      
      const devotion = calculateDevotion('player-1', 'U', battlefield);
      
      expect(devotion).toBe(4);
    });
    
    it('should not count opponent permanents', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent('oracle', "Thassa's Oracle", '', 'player-1', '{U}{U}'),
        createTestPermanent('counterspell', 'Counterspell', '', 'player-2', '{U}{U}'),
      ];
      
      const devotion = calculateDevotion('player-1', 'U', battlefield);
      
      expect(devotion).toBe(2);
    });
  });
  
  describe("checkThassasOracleWin", () => {
    it('should win when devotion >= library size', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent('oracle', "Thassa's Oracle", '', 'player-1', '{U}{U}'),
        createTestPermanent('spell', 'Other Blue Card', '', 'player-1', '{U}{U}{U}'),
      ];
      
      const result = checkThassasOracleWin('player-1', 3, battlefield);
      
      expect(result.playerWins).toBe(true);
      expect(result.log).toContain("Thassa's Oracle condition met! (5 >= 3)");
    });
    
    it('should not win when devotion < library size', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent('oracle', "Thassa's Oracle", '', 'player-1', '{U}{U}'),
      ];
      
      const result = checkThassasOracleWin('player-1', 10, battlefield);
      
      expect(result.playerWins).toBe(false);
    });
  });
  
  describe('checkUpkeepWinConditions', () => {
    it('should detect Battle of Wits win', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'wits',
          'Battle of Wits',
          'At the beginning of your upkeep, if you have 200 or more cards in your library, you win the game.',
          'player-1'
        ),
      ];
      
      const result = checkUpkeepWinConditions('player-1', 200, 7, 0, battlefield);
      
      expect(result.playerWins).toBe(true);
      expect(result.sourceName).toBe('Battle of Wits');
    });
    
    it('should detect Triskaidekaphile win', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'trisk',
          'Triskaidekaphile',
          'At the beginning of your upkeep, if you have exactly thirteen cards in your hand, you win the game.',
          'player-1'
        ),
      ];
      
      const result = checkUpkeepWinConditions('player-1', 50, 13, 0, battlefield);
      
      expect(result.playerWins).toBe(true);
      expect(result.sourceName).toBe('Triskaidekaphile');
    });
    
    it('should detect Mortal Combat win', () => {
      const battlefield: BattlefieldPermanent[] = [
        createTestPermanent(
          'mortal',
          'Mortal Combat',
          'At the beginning of your upkeep, if you have twenty or more creature cards in your graveyard, you win the game.',
          'player-1'
        ),
      ];
      
      const result = checkUpkeepWinConditions('player-1', 50, 7, 20, battlefield);
      
      expect(result.playerWins).toBe(true);
      expect(result.sourceName).toBe('Mortal Combat');
    });
  });
  
  describe('createWinEffectChoiceEvent', () => {
    it('should create choice event with correct properties', () => {
      const effect = {
        type: WinEffectType.EMPTY_LIBRARY_DRAW_WIN,
        sourceId: 'lab-man',
        sourceName: 'Laboratory Maniac',
        controllerId: 'player-1',
        description: 'Win the game when drawing from empty library',
        isReplacement: true,
        active: true,
      };
      
      const event = createWinEffectChoiceEvent(effect, false);
      
      expect(event.type).toBe('win_effect_choice');
      expect(event.playerId).toBe('player-1');
      expect(event.sourceId).toBe('lab-man');
      expect(event.sourceName).toBe('Laboratory Maniac');
      expect(event.effectType).toBe(WinEffectType.EMPTY_LIBRARY_DRAW_WIN);
      expect(event.optional).toBe(false);
    });
  });
});
