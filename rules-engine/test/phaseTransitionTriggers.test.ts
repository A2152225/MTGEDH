/**
 * phaseTransitionTriggers.test.ts
 * 
 * Tests for phase/step transition trigger wiring.
 * Ensures triggers are properly detected and placed on the stack at each phase transition.
 * 
 * Based on MTG Comprehensive Rules:
 * - Rule 500.2: Phase/step ends when stack is empty and all players pass
 * - Rule 502: Untap Step
 * - Rule 503: Upkeep Step
 * - Rule 504: Draw Step
 * - Rule 506-511: Combat Phase steps
 * - Rule 513: End Step
 * - Rule 514: Cleanup Step
 */

import { describe, it, expect } from 'vitest';
import {
  PhaseStep,
  canAdvancePhase,
  collectStepTriggers,
  processUntapStep,
  collectUpkeepTriggers,
  collectDrawStepTriggers,
  collectCombatTriggers,
  collectEndStepTriggers,
  processCleanupStep,
  verifyStepTransition,
  getStepEntryTriggers,
} from '../src/phaseTransitionTriggers';
import { TriggerEvent } from '../src/triggeredAbilities';
import { createEmptyStack } from '../src/stackOperations';

// Helper to create a triggered ability for testing
function createTestAbility(
  id: string,
  event: TriggerEvent,
  sourceName: string,
  effect: string
) {
  return {
    id,
    sourceId: `source-${id}`,
    sourceName,
    event,
    condition: undefined,
    effect,
    controller: 'player-1',
    isOptional: false,
    isManaAbility: false,
  };
}

describe('Phase Transition Triggers', () => {
  describe('canAdvancePhase', () => {
    it('should allow advance when stack is empty and no pending triggers', () => {
      const context = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: createEmptyStack(),
        abilities: [],
      };
      
      const result = canAdvancePhase(context);
      
      expect(result.canAdvance).toBe(true);
      expect(result.stackEmpty).toBe(true);
      expect(result.pendingTriggers).toHaveLength(0);
    });
    
    it('should not allow advance when stack is not empty', () => {
      // Create a stack with items using the correct structure
      const stackWithItems = {
        objects: [{ id: 'spell-1', type: 'spell' as const, controller: 'player-1', timestamp: Date.now() }],
      };
      
      const context = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: stackWithItems,
        abilities: [],
      };
      
      const result = canAdvancePhase(context);
      
      expect(result.canAdvance).toBe(false);
      expect(result.stackEmpty).toBe(false);
      expect(result.reason).toContain('Stack must be empty');
    });
    
    it('should not allow advance when there are pending triggers', () => {
      const upkeepAbility = createTestAbility(
        'upkeep-trigger-1',
        TriggerEvent.BEGINNING_OF_UPKEEP,
        'Phyrexian Arena',
        'At the beginning of your upkeep, you draw a card and you lose 1 life.'
      );
      
      const context = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: createEmptyStack(),
        abilities: [upkeepAbility],
      };
      
      const result = canAdvancePhase(context);
      
      expect(result.canAdvance).toBe(false);
      expect(result.pendingTriggers.length).toBeGreaterThan(0);
      expect(result.reason).toContain('trigger');
    });
  });
  
  describe('processUntapStep', () => {
    it('should untap all controlled permanents that can untap', () => {
      const permanents = [
        { id: 'land-1', name: 'Forest', controllerId: 'player-1', tapped: true, types: ['Land'] },
        { id: 'creature-1', name: 'Grizzly Bears', controllerId: 'player-1', tapped: true, types: ['Creature'] },
        { id: 'opponent-land', name: 'Island', controllerId: 'player-2', tapped: true, types: ['Land'] },
      ];
      
      const result = processUntapStep(permanents, 'player-1');
      
      expect(result.untappedPermanents).toContain('land-1');
      expect(result.untappedPermanents).toContain('creature-1');
      expect(result.untappedPermanents).not.toContain('opponent-land');
    });
    
    it('should not untap permanents with "doesnt untap" effect', () => {
      const permanents = [
        { id: 'frozen-1', name: 'Frozen Creature', controllerId: 'player-1', tapped: true, doesntUntap: true, types: ['Creature'] },
        { id: 'normal-1', name: 'Normal Creature', controllerId: 'player-1', tapped: true, types: ['Creature'] },
      ];
      
      const result = processUntapStep(permanents, 'player-1');
      
      expect(result.untappedPermanents).not.toContain('frozen-1');
      expect(result.untappedPermanents).toContain('normal-1');
      expect(result.permanentsNotUntapped.some(p => p.id === 'frozen-1')).toBe(true);
    });
    
    it('should log untap actions', () => {
      const permanents = [
        { id: 'land-1', name: 'Forest', controllerId: 'player-1', tapped: true, types: ['Land'] },
      ];
      
      const result = processUntapStep(permanents, 'player-1');
      
      expect(result.log.some(l => l.includes('Forest untaps'))).toBe(true);
    });
  });
  
  describe('collectUpkeepTriggers', () => {
    it('should collect upkeep triggers', () => {
      const abilities = [
        createTestAbility('upkeep-1', TriggerEvent.BEGINNING_OF_UPKEEP, 'Phyrexian Arena', 'Draw and lose life'),
        createTestAbility('etb-1', TriggerEvent.ENTERS_BATTLEFIELD, 'Soul Warden', 'Gain life'),
      ];
      
      const result = collectUpkeepTriggers(abilities, 'player-1');
      
      expect(result.triggers.length).toBe(1);
      expect(result.log.some(l => l.includes('Phyrexian Arena'))).toBe(true);
    });
    
    it('should detect cumulative upkeep patterns', () => {
      const abilities = [
        createTestAbility(
          'cumulative-1',
          TriggerEvent.BEGINNING_OF_UPKEEP,
          'Mystic Remora',
          'Cumulative upkeep—Pay {1} for each age counter on this permanent.'
        ),
      ];
      
      const result = collectUpkeepTriggers(abilities, 'player-1');
      
      expect(result.cumulativeUpkeepTriggers.length).toBe(1);
    });
  });
  
  describe('collectDrawStepTriggers', () => {
    it('should indicate player should draw', () => {
      const result = collectDrawStepTriggers([], 'player-1');
      
      expect(result.shouldDraw).toBe(true);
      expect(result.log.some(l => l.includes('draws a card'))).toBe(true);
    });
    
    it('should skip draw when skip effect is active', () => {
      const result = collectDrawStepTriggers([], 'player-1', true, 'Spirit of the Labyrinth');
      
      expect(result.shouldDraw).toBe(false);
      expect(result.skipReason).toContain('Spirit of the Labyrinth');
    });
    
    it('should collect draw step triggers', () => {
      const abilities = [
        createTestAbility('draw-trigger-1', TriggerEvent.BEGINNING_OF_DRAW_STEP, 'Howling Mine', 'Each player draws a card'),
      ];
      
      const result = collectDrawStepTriggers(abilities, 'player-1');
      
      expect(result.triggers.length).toBe(1);
    });
  });
  
  describe('collectCombatTriggers', () => {
    it('should collect beginning of combat triggers', () => {
      const abilities = [
        createTestAbility('combat-begin-1', TriggerEvent.BEGINNING_OF_COMBAT, 'Reconnaissance Mission', 'Effect'),
      ];
      
      const result = collectCombatTriggers(
        PhaseStep.BEGINNING_OF_COMBAT,
        abilities,
        'player-1'
      );
      
      expect(result.triggers.length).toBe(1);
    });
    
    it('should collect attack triggers for attacking creatures', () => {
      const abilities = [
        createTestAbility('attack-1', TriggerEvent.ATTACKS, 'Goblin Rabblemaster', 'Create a token'),
      ];
      
      const result = collectCombatTriggers(
        PhaseStep.DECLARE_ATTACKERS,
        abilities,
        'player-1',
        ['source-attack-1'], // attacking creature IDs
        []
      );
      
      expect(result.attackTriggers.length).toBe(1);
    });
    
    it('should collect end of combat triggers', () => {
      const abilities = [
        createTestAbility('end-combat-1', TriggerEvent.END_OF_COMBAT, 'Some Card', 'Effect'),
      ];
      
      const result = collectCombatTriggers(
        PhaseStep.END_OF_COMBAT,
        abilities,
        'player-1'
      );
      
      expect(result.triggers.length).toBe(1);
    });
  });
  
  describe('collectEndStepTriggers', () => {
    it('should collect end step triggers', () => {
      const abilities = [
        createTestAbility('end-step-1', TriggerEvent.BEGINNING_OF_END_STEP, 'Palace Siege', 'Effect'),
      ];
      
      const result = collectEndStepTriggers(abilities, 'player-1');
      
      expect(result.triggers.length).toBe(1);
    });
  });
  
  describe('processCleanupStep', () => {
    it('should clear damage from permanents', () => {
      const permanents = [
        { id: 'creature-1', name: 'Creature', controllerId: 'player-1', tapped: false, types: ['Creature'], markedDamage: 3 },
        { id: 'creature-2', name: 'Undamaged', controllerId: 'player-1', tapped: false, types: ['Creature'], markedDamage: 0 },
      ];
      
      const playerState = { id: 'player-1', handSize: 5, maxHandSize: 7, lifeTotal: 20 };
      
      const result = processCleanupStep(permanents, 'player-1', playerState, []);
      
      expect(result.damageCleared).toContain('creature-1');
      expect(result.damageCleared).not.toContain('creature-2');
    });
    
    it('should end temporary effects', () => {
      const permanents: any[] = [];
      const playerState = { id: 'player-1', handSize: 5, maxHandSize: 7, lifeTotal: 20 };
      const temporaryEffects = ['Giant Growth on creature-1', 'Infuriate on creature-2'];
      
      const result = processCleanupStep(permanents, 'player-1', playerState, [], temporaryEffects);
      
      expect(result.effectsEnded.length).toBe(2);
    });
    
    it('should require discard when hand exceeds max', () => {
      const permanents: any[] = [];
      const playerState = { id: 'player-1', handSize: 9, maxHandSize: 7, lifeTotal: 20 };
      
      const result = processCleanupStep(permanents, 'player-1', playerState, []);
      
      expect(result.discardRequired).toBe(2);
    });
    
    it('should not require discard when hand is at or below max', () => {
      const permanents: any[] = [];
      const playerState = { id: 'player-1', handSize: 7, maxHandSize: 7, lifeTotal: 20 };
      
      const result = processCleanupStep(permanents, 'player-1', playerState, []);
      
      expect(result.discardRequired).toBe(0);
    });
    
    it('should grant priority when cleanup triggers exist', () => {
      const permanents: any[] = [];
      const playerState = { id: 'player-1', handSize: 5, maxHandSize: 7, lifeTotal: 20 };
      const abilities = [
        createTestAbility('cleanup-1', TriggerEvent.CLEANUP_STEP, 'Madness Card', 'Cleanup effect'),
      ];
      
      const result = processCleanupStep(permanents, 'player-1', playerState, abilities);
      
      expect(result.needsPriority).toBe(true);
      expect(result.pendingTriggers.length).toBe(1);
    });
  });
  
  describe('verifyStepTransition', () => {
    it('should allow transition when stack is empty and no pending triggers', () => {
      const context = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: createEmptyStack(),
        abilities: [],
      };
      
      const result = verifyStepTransition(PhaseStep.UPKEEP, PhaseStep.DRAW, context);
      
      expect(result.valid).toBe(true);
      expect(result.requiredActions).toHaveLength(0);
    });
    
    it('should not allow transition when stack is not empty', () => {
      const stackWithItems = {
        objects: [{ id: 'spell-1', type: 'spell' as const, controller: 'player-1', timestamp: Date.now() }],
      };
      
      const context = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: stackWithItems,
        abilities: [],
      };
      
      const result = verifyStepTransition(PhaseStep.UPKEEP, PhaseStep.DRAW, context);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Stack must be empty');
    });
  });
  
  describe('getStepEntryTriggers', () => {
    it('should collect and queue triggers for step entry', () => {
      const abilities = [
        createTestAbility('upkeep-1', TriggerEvent.BEGINNING_OF_UPKEEP, 'Phyrexian Arena', 'Draw and lose life'),
        createTestAbility('upkeep-2', TriggerEvent.BEGINNING_OF_UPKEEP, 'Sulfuric Vortex', 'Deals damage'),
      ];
      
      const context = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: createEmptyStack(),
        abilities,
      };
      
      const result = getStepEntryTriggers(PhaseStep.UPKEEP, context);
      
      expect(result.triggers.length).toBe(2);
      expect(result.log.length).toBeGreaterThan(0);
    });
    
    it('should return empty for steps without trigger events', () => {
      const context = {
        currentStep: PhaseStep.UNTAP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: createEmptyStack(),
        abilities: [],
      };
      
      // Untap step has no trigger event (no priority)
      const result = getStepEntryTriggers(PhaseStep.UNTAP, context);
      
      expect(result.triggers.length).toBe(0);
    });
  });
  
  describe('Phase Step Enum', () => {
    it('should have all required phase steps', () => {
      expect(PhaseStep.UNTAP).toBe('untap');
      expect(PhaseStep.UPKEEP).toBe('upkeep');
      expect(PhaseStep.DRAW).toBe('draw');
      expect(PhaseStep.PRECOMBAT_MAIN).toBe('precombat_main');
      expect(PhaseStep.BEGINNING_OF_COMBAT).toBe('beginning_of_combat');
      expect(PhaseStep.DECLARE_ATTACKERS).toBe('declare_attackers');
      expect(PhaseStep.DECLARE_BLOCKERS).toBe('declare_blockers');
      expect(PhaseStep.COMBAT_DAMAGE).toBe('combat_damage');
      expect(PhaseStep.END_OF_COMBAT).toBe('end_of_combat');
      expect(PhaseStep.POSTCOMBAT_MAIN).toBe('postcombat_main');
      expect(PhaseStep.END_STEP).toBe('end_step');
      expect(PhaseStep.CLEANUP).toBe('cleanup');
    });
  });
  
  describe('Integration: Full turn trigger wiring', () => {
    it('should properly wire triggers through a simulated turn', () => {
      const upkeepAbility = createTestAbility(
        'upkeep-1',
        TriggerEvent.BEGINNING_OF_UPKEEP,
        'Phyrexian Arena',
        'Draw and lose life'
      );
      
      const drawAbility = createTestAbility(
        'draw-1',
        TriggerEvent.BEGINNING_OF_DRAW_STEP,
        'Howling Mine',
        'Draw extra card'
      );
      
      const endStepAbility = createTestAbility(
        'end-1',
        TriggerEvent.BEGINNING_OF_END_STEP,
        'Palace Siege',
        'Dragons mode effect'
      );
      
      const abilities = [upkeepAbility, drawAbility, endStepAbility];
      
      const emptyStack = createEmptyStack();
      
      // Simulate upkeep step
      const upkeepContext = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: emptyStack,
        abilities,
      };
      
      const upkeepResult = getStepEntryTriggers(PhaseStep.UPKEEP, upkeepContext);
      expect(upkeepResult.triggers.length).toBe(1);
      expect(upkeepResult.triggers[0].sourceName).toBe('Phyrexian Arena');
      
      // Simulate draw step
      const drawContext = {
        currentStep: PhaseStep.DRAW,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: emptyStack,
        abilities,
      };
      
      const drawResult = getStepEntryTriggers(PhaseStep.DRAW, drawContext);
      expect(drawResult.triggers.length).toBe(1);
      expect(drawResult.triggers[0].sourceName).toBe('Howling Mine');
      
      // Simulate end step
      const endContext = {
        currentStep: PhaseStep.END_STEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: emptyStack,
        abilities,
      };
      
      const endResult = getStepEntryTriggers(PhaseStep.END_STEP, endContext);
      expect(endResult.triggers.length).toBe(1);
      expect(endResult.triggers[0].sourceName).toBe('Palace Siege');
    });
    
    it('should prevent phase advancement until triggers resolve', () => {
      const upkeepAbility = createTestAbility(
        'upkeep-1',
        TriggerEvent.BEGINNING_OF_UPKEEP,
        'Phyrexian Arena',
        'Draw and lose life'
      );
      
      // Stack is empty but there are pending triggers
      const context = {
        currentStep: PhaseStep.UPKEEP,
        activePlayerId: 'player-1',
        turnNumber: 1,
        stack: createEmptyStack(),
        abilities: [upkeepAbility],
      };
      
      // First check: should not advance due to pending triggers
      const initialCheck = canAdvancePhase(context);
      expect(initialCheck.canAdvance).toBe(false);
      expect(initialCheck.pendingTriggers.length).toBe(1);
      
      // After triggers would be placed on stack and resolved,
      // and no more triggers exist, should be able to advance
      const resolvedContext = {
        ...context,
        abilities: [], // No more triggering abilities
      };
      
      const resolvedCheck = canAdvancePhase(resolvedContext);
      expect(resolvedCheck.canAdvance).toBe(true);
    });
  });
});
