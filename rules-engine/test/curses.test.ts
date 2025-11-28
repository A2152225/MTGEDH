/**
 * curses.test.ts
 * 
 * Tests for curse enchantment effects on players.
 */

import { describe, it, expect } from 'vitest';
import {
  isCurse,
  detectCurseEffect,
  collectPlayerCurses,
  checkCurses,
  applyDamageMultipliers,
  canCastSpellWithCurses,
  getCurseUpkeepTriggers,
  getCurseAttackTriggers,
  countCursesOnPlayer,
  CurseEffectType,
} from '../src/curses';
import type { GameState } from '../../shared/src';

// Helper to create a mock curse permanent
function createCurse(
  id: string, 
  name: string, 
  oracleText: string, 
  controllerId: string,
  enchantedPlayerId: string
): any {
  return {
    id,
    controller: controllerId,
    controllerId,
    attachedTo: enchantedPlayerId,
    enchanting: enchantedPlayerId,
    card: {
      name,
      oracle_text: oracleText,
      type_line: 'Enchantment — Aura Curse',
    },
  };
}

// Helper to create a mock game state
function createGameState(
  player1Permanents: any[] = [],
  player2Permanents: any[] = []
): GameState {
  return {
    players: [
      {
        id: 'player1',
        life: 40,
        battlefield: player1Permanents,
      },
      {
        id: 'player2',
        life: 40,
        battlefield: player2Permanents,
      },
    ],
    battlefield: [...player1Permanents, ...player2Permanents],
  } as unknown as GameState;
}

describe('Curses', () => {
  describe('isCurse', () => {
    it('identifies cards with Curse subtype', () => {
      const curse = {
        id: 'curse-1',
        card: {
          name: 'Curse of Exhaustion',
          type_line: 'Enchantment — Aura Curse',
        },
      };
      
      expect(isCurse(curse)).toBe(true);
    });
    
    it('identifies enchant player auras as curses', () => {
      const aura = {
        id: 'aura-1',
        card: {
          name: 'Some Player Aura',
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant player. Enchanted player loses 1 life.',
        },
      };
      
      expect(isCurse(aura)).toBe(true);
    });
    
    it('returns false for non-curse enchantments', () => {
      const enchantment = {
        id: 'ench-1',
        card: {
          name: 'Propaganda',
          type_line: 'Enchantment',
          oracle_text: "Creatures can't attack you unless their controller pays {2}",
        },
      };
      
      expect(isCurse(enchantment)).toBe(false);
    });
  });
  
  describe('detectCurseEffect', () => {
    it('detects Curse of the Pierced Heart damage effect', () => {
      const curse = createCurse(
        'pierced-heart-1',
        'Curse of the Pierced Heart',
        "Enchant player. At the beginning of enchanted player's upkeep, Curse of the Pierced Heart deals 1 damage to that player.",
        'player1',
        'player2'
      );
      
      const effect = detectCurseEffect(curse, 'player2');
      
      expect(effect).not.toBeNull();
      expect(effect?.effectType).toBe(CurseEffectType.UPKEEP_DAMAGE);
      expect(effect?.damageAmount).toBe(1);
      expect(effect?.enchantedPlayerId).toBe('player2');
    });
    
    it('detects Curse of Exhaustion spell restriction', () => {
      const curse = createCurse(
        'exhaustion-1',
        'Curse of Exhaustion',
        "Enchant player. Enchanted player can't cast more than one spell each turn.",
        'player1',
        'player2'
      );
      
      const effect = detectCurseEffect(curse, 'player2');
      
      expect(effect).not.toBeNull();
      expect(effect?.effectType).toBe(CurseEffectType.SPELL_RESTRICTION);
      expect(effect?.spellLimit).toBe(1);
    });
    
    it('detects Curse of Bloodletting damage multiplier', () => {
      const curse = createCurse(
        'bloodletting-1',
        'Curse of Bloodletting',
        "Enchant player. If a source would deal damage to enchanted player, it deals double that damage to that player instead.",
        'player1',
        'player2'
      );
      
      const effect = detectCurseEffect(curse, 'player2');
      
      expect(effect).not.toBeNull();
      expect(effect?.effectType).toBe(CurseEffectType.DAMAGE_MULTIPLIER);
      expect(effect?.multiplier).toBe(2);
    });
    
    it('detects attack trigger curses', () => {
      const curse = createCurse(
        'opulence-1',
        'Curse of Opulence',
        "Enchant player. Whenever a player attacks enchanted player with one or more creatures, that attacking player creates a Gold token.",
        'player1',
        'player2'
      );
      
      const effect = detectCurseEffect(curse, 'player2');
      
      expect(effect).not.toBeNull();
      expect(effect?.effectType).toBe(CurseEffectType.ATTACK_TRIGGER);
    });
    
    it('returns null for non-curse permanents', () => {
      const creature = {
        id: 'creature-1',
        controller: 'player1',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
        },
      };
      
      const effect = detectCurseEffect(creature, 'player2');
      
      expect(effect).toBeNull();
    });
  });
  
  describe('collectPlayerCurses', () => {
    it('collects all curses attached to a player', () => {
      const curse1 = createCurse(
        'curse-1',
        'Curse of Exhaustion',
        "Enchant player. Enchanted player can't cast more than one spell each turn.",
        'player1',
        'player2'
      );
      
      const curse2 = createCurse(
        'curse-2',
        'Curse of the Pierced Heart',
        "Enchant player. At the beginning of enchanted player's upkeep, deals 1 damage",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse1, curse2], []);
      
      const curses = collectPlayerCurses(state, 'player2');
      
      expect(curses).toHaveLength(2);
    });
    
    it('only collects curses attached to the specified player', () => {
      const curseOnPlayer2 = createCurse(
        'curse-1',
        'Curse of Exhaustion',
        "Enchant player. Enchanted player can't cast more than one spell each turn.",
        'player1',
        'player2'
      );
      
      const curseOnPlayer1 = createCurse(
        'curse-2',
        'Curse of the Pierced Heart',
        "Enchant player. At the beginning of enchanted player's upkeep, deals 1 damage",
        'player2',
        'player1'
      );
      
      const state = createGameState([curseOnPlayer2], [curseOnPlayer1]);
      
      const player1Curses = collectPlayerCurses(state, 'player1');
      const player2Curses = collectPlayerCurses(state, 'player2');
      
      expect(player1Curses).toHaveLength(1);
      expect(player1Curses[0].sourceName).toBe('Curse of the Pierced Heart');
      
      expect(player2Curses).toHaveLength(1);
      expect(player2Curses[0].sourceName).toBe('Curse of Exhaustion');
    });
    
    it('returns empty array when no curses', () => {
      const state = createGameState([], []);
      
      const curses = collectPlayerCurses(state, 'player1');
      
      expect(curses).toHaveLength(0);
    });
  });
  
  describe('checkCurses', () => {
    it('returns curse summary with aggregated effects', () => {
      const curse = createCurse(
        'bloodletting-1',
        'Curse of Bloodletting',
        "If a source would deal damage to enchanted player, it deals double that damage.",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const result = checkCurses(state, 'player2');
      
      expect(result.curseCount).toBe(1);
      expect(result.hasDamageMultiplier).toBe(true);
      expect(result.damageMultiplier).toBe(2);
    });
    
    it('stacks multiple damage multipliers', () => {
      const curse1 = createCurse(
        'bloodletting-1',
        'Curse of Bloodletting',
        "If a source would deal damage to enchanted player, it deals double that damage.",
        'player1',
        'player2'
      );
      
      const curse2 = createCurse(
        'bloodletting-2',
        'Curse of Bloodletting',
        "If a source would deal damage to enchanted player, it deals double that damage.",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse1, curse2], []);
      
      const result = checkCurses(state, 'player2');
      
      expect(result.curseCount).toBe(2);
      expect(result.damageMultiplier).toBe(4); // 2 * 2 = 4
    });
    
    it('tracks spell restrictions', () => {
      const curse = createCurse(
        'exhaustion-1',
        'Curse of Exhaustion',
        "Enchanted player can't cast more than one spell each turn.",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const result = checkCurses(state, 'player2');
      
      expect(result.hasSpellRestriction).toBe(true);
      expect(result.spellsPerTurn).toBe(1);
    });
  });
  
  describe('applyDamageMultipliers', () => {
    it('doubles damage with Curse of Bloodletting', () => {
      const curse = createCurse(
        'bloodletting-1',
        'Curse of Bloodletting',
        "If a source would deal damage to enchanted player, it deals double that damage.",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const result = applyDamageMultipliers(state, 'player2', 5);
      
      expect(result.finalDamage).toBe(10);
      expect(result.multipliers).toHaveLength(1);
    });
    
    it('returns base damage when no multipliers', () => {
      const state = createGameState([], []);
      
      const result = applyDamageMultipliers(state, 'player2', 5);
      
      expect(result.finalDamage).toBe(5);
      expect(result.multipliers).toHaveLength(0);
    });
  });
  
  describe('canCastSpellWithCurses', () => {
    it('allows casting when no curse restrictions', () => {
      const state = createGameState([], []);
      
      const result = canCastSpellWithCurses(state, 'player2', 5);
      
      expect(result.canCast).toBe(true);
    });
    
    it('allows first spell with Curse of Exhaustion', () => {
      const curse = createCurse(
        'exhaustion-1',
        'Curse of Exhaustion',
        "Enchanted player can't cast more than one spell each turn.",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const result = canCastSpellWithCurses(state, 'player2', 0);
      
      expect(result.canCast).toBe(true);
    });
    
    it('blocks second spell with Curse of Exhaustion', () => {
      const curse = createCurse(
        'exhaustion-1',
        'Curse of Exhaustion',
        "Enchanted player can't cast more than one spell each turn.",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const result = canCastSpellWithCurses(state, 'player2', 1);
      
      expect(result.canCast).toBe(false);
      expect(result.reason).toContain('Curse of Exhaustion');
      expect(result.reason).toContain('1 spell');
    });
  });
  
  describe('getCurseUpkeepTriggers', () => {
    it('returns curses that trigger at upkeep', () => {
      const curse = createCurse(
        'pierced-heart-1',
        'Curse of the Pierced Heart',
        "At the beginning of enchanted player's upkeep, deals 1 damage",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const triggers = getCurseUpkeepTriggers(state, 'player2');
      
      expect(triggers).toHaveLength(1);
      expect(triggers[0].effectType).toBe(CurseEffectType.UPKEEP_DAMAGE);
    });
    
    it('excludes non-upkeep curses', () => {
      const curse = createCurse(
        'opulence-1',
        'Curse of Opulence',
        "Whenever a player attacks enchanted player, create a Gold token",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const triggers = getCurseUpkeepTriggers(state, 'player2');
      
      expect(triggers).toHaveLength(0);
    });
  });
  
  describe('getCurseAttackTriggers', () => {
    it('returns curses that trigger when attacked', () => {
      const curse = createCurse(
        'opulence-1',
        'Curse of Opulence',
        "Whenever a player attacks enchanted player, create a Gold token",
        'player1',
        'player2'
      );
      
      const state = createGameState([curse], []);
      
      const triggers = getCurseAttackTriggers(state, 'player2');
      
      expect(triggers).toHaveLength(1);
      expect(triggers[0].effectType).toBe(CurseEffectType.ATTACK_TRIGGER);
    });
  });
  
  describe('countCursesOnPlayer', () => {
    it('counts all curses on a player', () => {
      const curse1 = createCurse('curse-1', 'Curse 1', "Enchant player", 'player1', 'player2');
      const curse2 = createCurse('curse-2', 'Curse 2', "Enchant player", 'player1', 'player2');
      const curse3 = createCurse('curse-3', 'Curse 3', "Enchant player", 'player1', 'player2');
      
      const state = createGameState([curse1, curse2, curse3], []);
      
      expect(countCursesOnPlayer(state, 'player2')).toBe(3);
      expect(countCursesOnPlayer(state, 'player1')).toBe(0);
    });
  });
});
