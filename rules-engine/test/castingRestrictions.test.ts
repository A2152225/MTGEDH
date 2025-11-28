/**
 * castingRestrictions.test.ts
 * 
 * Tests for casting restriction effects (Silence, Rule of Law, Grand Abolisher, etc.)
 */

import { describe, it, expect } from 'vitest';
import {
  detectCastingRestrictions,
  collectCastingRestrictions,
  canCastSpell,
  applySilenceEffect,
  clearEndOfTurnRestrictions,
  canActivateAbilities,
  CastingRestrictionType,
  RestrictionDuration,
} from '../src/castingRestrictions';
import type { GameState } from '../../shared/src';

// Helper to create a mock permanent
function createPermanent(
  id: string, 
  name: string, 
  oracleText: string, 
  controllerId: string = 'player1'
): any {
  return {
    id,
    controller: controllerId,
    controllerId,
    card: {
      name,
      oracle_text: oracleText,
      type_line: 'Enchantment',
    },
  };
}

// Helper to create a mock spell
function createSpell(
  name: string,
  typeLine: string,
  cmc: number = 2
): any {
  return {
    name,
    type_line: typeLine,
    cmc,
    mana_value: cmc,
  };
}

// Helper to create a mock game state
function createGameState(
  player1Permanents: any[] = [],
  player2Permanents: any[] = [],
  options: { activePlayerIndex?: number; phase?: string; stack?: any[] } = {}
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
    activePlayerIndex: options.activePlayerIndex ?? 0,
    phase: options.phase ?? 'precombat_main',
    stack: options.stack ?? [],
  } as unknown as GameState;
}

describe('Casting Restrictions', () => {
  describe('detectCastingRestrictions', () => {
    it('detects Rule of Law effect', () => {
      const ruleOfLaw = createPermanent(
        'rule-of-law-1',
        'Rule of Law',
        "Each player can't cast more than one spell each turn."
      );
      
      const restrictions = detectCastingRestrictions(ruleOfLaw, 'player1');
      
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe(CastingRestrictionType.ONE_SPELL_PER_TURN);
      expect(restrictions[0].affectedPlayers).toBe('all');
      expect(restrictions[0].duration).toBe(RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD);
    });
    
    it('detects Deafening Silence effect', () => {
      const deafeningSilence = createPermanent(
        'deafening-silence-1',
        'Deafening Silence',
        "Each player can't cast more than one noncreature spell each turn."
      );
      
      const restrictions = detectCastingRestrictions(deafeningSilence, 'player1');
      
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe(CastingRestrictionType.ONE_NONCREATURE_PER_TURN);
      expect(restrictions[0].spellTypeRestriction).toBe('noncreature');
    });
    
    it('detects Teferi sorcery-speed restriction', () => {
      const teferi = createPermanent(
        'teferi-1',
        'Teferi, Time Raveler',
        "Each opponent can only cast spells any time they could cast a sorcery."
      );
      
      const restrictions = detectCastingRestrictions(teferi, 'player1');
      
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe(CastingRestrictionType.SORCERY_SPEED_ONLY);
      expect(restrictions[0].affectedPlayers).toBe('opponents');
    });
    
    it('detects Drannith Magistrate hand-only restriction', () => {
      const magistrate = createPermanent(
        'magistrate-1',
        'Drannith Magistrate',
        "Your opponents can't cast spells from anywhere other than their hands."
      );
      
      const restrictions = detectCastingRestrictions(magistrate, 'player1');
      
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe(CastingRestrictionType.HAND_ONLY);
    });
    
    it('detects Grand Abolisher during-your-turn restriction', () => {
      const abolisher = createPermanent(
        'abolisher-1',
        'Grand Abolisher',
        "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments."
      );
      
      const restrictions = detectCastingRestrictions(abolisher, 'player1');
      
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe(CastingRestrictionType.CANT_CAST_SPELLS);
      expect(restrictions[0].onlyDuringYourTurn).toBe(true);
    });
    
    it('returns empty array for non-restriction cards', () => {
      const creature = createPermanent(
        'creature-1',
        'Grizzly Bears',
        ''
      );
      
      const restrictions = detectCastingRestrictions(creature, 'player1');
      
      expect(restrictions).toHaveLength(0);
    });
  });
  
  describe('applySilenceEffect', () => {
    it('adds a silence restriction to opponents', () => {
      const state = createGameState([], []);
      
      const newState = applySilenceEffect(
        state,
        'silence-1',
        'Silence',
        'player1'
      );
      
      const restrictions = (newState as any).castingRestrictions;
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].type).toBe(CastingRestrictionType.CANT_CAST_SPELLS);
      expect(restrictions[0].affectedPlayers).toBe('opponents');
      expect(restrictions[0].expiresAtEndOfTurn).toBe(true);
    });
    
    it('can target a specific player (Orim\'s Chant)', () => {
      const state = createGameState([], []);
      
      const newState = applySilenceEffect(
        state,
        'chant-1',
        "Orim's Chant",
        'player1',
        'player2'
      );
      
      const restrictions = (newState as any).castingRestrictions;
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].affectedPlayers).toBe('target');
      expect(restrictions[0].targetPlayerId).toBe('player2');
    });
  });
  
  describe('clearEndOfTurnRestrictions', () => {
    it('removes end-of-turn restrictions', () => {
      let state = createGameState([], []);
      state = applySilenceEffect(state, 'silence-1', 'Silence', 'player1');
      
      const cleared = clearEndOfTurnRestrictions(state);
      
      const restrictions = (cleared as any).castingRestrictions;
      expect(restrictions).toHaveLength(0);
    });
    
    it('preserves permanent restrictions', () => {
      let state = createGameState([], []) as any;
      
      // Add a permanent restriction (like from Rule of Law)
      state.castingRestrictions = [
        {
          id: 'rule-of-law-1',
          type: CastingRestrictionType.ONE_SPELL_PER_TURN,
          expiresAtEndOfTurn: false,
        },
      ];
      
      // Add an end-of-turn restriction
      state = applySilenceEffect(state, 'silence-1', 'Silence', 'player1');
      
      expect((state as any).castingRestrictions).toHaveLength(2);
      
      const cleared = clearEndOfTurnRestrictions(state);
      const restrictions = (cleared as any).castingRestrictions;
      
      expect(restrictions).toHaveLength(1);
      expect(restrictions[0].id).toBe('rule-of-law-1');
    });
  });
  
  describe('canCastSpell', () => {
    it('allows casting when no restrictions', () => {
      const state = createGameState([], []);
      const spell = createSpell('Lightning Bolt', 'Instant');
      
      const result = canCastSpell(state, 'player1', spell, 0);
      
      expect(result.canCast).toBe(true);
      expect(result.blockingRestrictions).toHaveLength(0);
    });
    
    it('blocks casting with Silence effect', () => {
      let state = createGameState([], []);
      state = applySilenceEffect(state, 'silence-1', 'Silence', 'player1');
      
      const spell = createSpell('Lightning Bolt', 'Instant');
      
      // Player1 cast Silence, so player2 can't cast
      const result = canCastSpell(state, 'player2', spell, 0);
      
      expect(result.canCast).toBe(false);
      expect(result.reason).toContain('Silence');
      expect(result.blockingRestrictions).toHaveLength(1);
    });
    
    it('allows controller to cast after Silence', () => {
      let state = createGameState([], []);
      state = applySilenceEffect(state, 'silence-1', 'Silence', 'player1');
      
      const spell = createSpell('Lightning Bolt', 'Instant');
      
      // Player1 cast Silence, they can still cast spells
      const result = canCastSpell(state, 'player1', spell, 0);
      
      expect(result.canCast).toBe(true);
    });
    
    it('enforces Rule of Law one-spell limit', () => {
      const ruleOfLaw = createPermanent(
        'rule-of-law-1',
        'Rule of Law',
        "Each player can't cast more than one spell each turn."
      );
      
      const state = createGameState([ruleOfLaw], []);
      const spell = createSpell('Lightning Bolt', 'Instant');
      
      // First spell is allowed
      const firstResult = canCastSpell(state, 'player1', spell, 0);
      expect(firstResult.canCast).toBe(true);
      
      // Second spell is blocked
      const secondResult = canCastSpell(state, 'player1', spell, 1);
      expect(secondResult.canCast).toBe(false);
      expect(secondResult.reason).toContain('Rule of Law');
    });
    
    it('allows creature spells with Deafening Silence', () => {
      const deafeningSilence = createPermanent(
        'deafening-silence-1',
        'Deafening Silence',
        "Each player can't cast more than one noncreature spell each turn."
      );
      
      const state = createGameState([deafeningSilence], []);
      const creature = createSpell('Grizzly Bears', 'Creature — Bear');
      
      // Multiple creature spells are allowed
      const result1 = canCastSpell(state, 'player1', creature, 0);
      expect(result1.canCast).toBe(true);
      
      const result2 = canCastSpell(state, 'player1', creature, 1);
      expect(result2.canCast).toBe(true);
    });
    
    it('blocks non-hand casting with Drannith Magistrate', () => {
      const magistrate = createPermanent(
        'magistrate-1',
        'Drannith Magistrate',
        "Your opponents can't cast spells from anywhere other than their hands."
      );
      
      const state = createGameState([magistrate], []);
      const spell = createSpell('Counterspell', 'Instant');
      
      // Casting from hand is allowed
      const handResult = canCastSpell(state, 'player2', spell, 0, 'hand');
      expect(handResult.canCast).toBe(true);
      
      // Casting from graveyard is blocked
      const graveyardResult = canCastSpell(state, 'player2', spell, 0, 'graveyard');
      expect(graveyardResult.canCast).toBe(false);
      expect(graveyardResult.reason).toContain('Drannith Magistrate');
      
      // Controller is not affected
      const controllerResult = canCastSpell(state, 'player1', spell, 0, 'graveyard');
      expect(controllerResult.canCast).toBe(true);
    });
    
    it('enforces sorcery speed with Teferi, Time Raveler', () => {
      const teferi = createPermanent(
        'teferi-1',
        'Teferi, Time Raveler',
        "Each opponent can only cast spells any time they could cast a sorcery."
      );
      
      // Main phase, own turn, empty stack - sorcery timing is valid
      const validState = createGameState([teferi], [], {
        activePlayerIndex: 1, // player2's turn
        phase: 'precombat_main',
        stack: [],
      });
      
      const instant = createSpell('Lightning Bolt', 'Instant');
      
      // During opponent's main phase with empty stack, instant is allowed
      const validResult = canCastSpell(validState, 'player2', instant, 0);
      expect(validResult.canCast).toBe(true);
      
      // With something on stack, instant is blocked
      const stackState = createGameState([teferi], [], {
        activePlayerIndex: 1,
        phase: 'precombat_main',
        stack: [{ id: 'some-spell' }],
      });
      
      const blockedResult = canCastSpell(stackState, 'player2', instant, 0);
      expect(blockedResult.canCast).toBe(false);
    });
  });
  
  describe('canActivateAbilities', () => {
    it('allows abilities when no restrictions', () => {
      const state = createGameState([], []);
      
      const result = canActivateAbilities(state, 'player1');
      
      expect(result.canActivate).toBe(true);
    });
    
    it('blocks abilities with Grand Abolisher during controller turn', () => {
      const abolisher = createPermanent(
        'abolisher-1',
        'Grand Abolisher',
        "During your turn, your opponents can't cast spells or activate abilities."
      );
      
      // Player1's turn (controller of Grand Abolisher)
      const state = createGameState([abolisher], [], {
        activePlayerIndex: 0,
      });
      
      // Player2 can't activate during player1's turn
      const result = canActivateAbilities(state, 'player2');
      
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('Grand Abolisher');
    });
    
    it('allows abilities on opponent turn with Grand Abolisher', () => {
      const abolisher = createPermanent(
        'abolisher-1',
        'Grand Abolisher',
        "During your turn, your opponents can't cast spells or activate abilities."
      );
      
      // Player2's turn (not controller of Grand Abolisher)
      const state = createGameState([abolisher], [], {
        activePlayerIndex: 1,
      });
      
      // Player2 can activate during their own turn
      const result = canActivateAbilities(state, 'player2');
      
      expect(result.canActivate).toBe(true);
    });
  });
  
  describe('collectCastingRestrictions', () => {
    it('collects restrictions from multiple sources', () => {
      const ruleOfLaw = createPermanent(
        'rule-of-law-1',
        'Rule of Law',
        "Each player can't cast more than one spell each turn.",
        'player1'
      );
      
      const teferi = createPermanent(
        'teferi-1',
        'Teferi, Time Raveler',
        "Each opponent can only cast spells any time they could cast a sorcery.",
        'player1'
      );
      
      const state = createGameState([ruleOfLaw, teferi], []);
      
      const restrictions = collectCastingRestrictions(state);
      
      // Player1 has Rule of Law
      const player1Restrictions = restrictions.get('player1') || [];
      expect(player1Restrictions.length).toBeGreaterThanOrEqual(1);
      
      // Player2 has both Rule of Law and Teferi (as opponent)
      const player2Restrictions = restrictions.get('player2') || [];
      expect(player2Restrictions.length).toBeGreaterThanOrEqual(2);
    });
  });
});
