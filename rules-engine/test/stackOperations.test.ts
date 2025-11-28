/**
 * Tests for stack operations (Rule 405)
 */

import { describe, it, expect } from 'vitest';
import {
  createEmptyStack,
  pushToStack,
  popFromStack,
  peekStack,
  isStackEmpty,
  getStackSize,
  counterStackObject,
  validateTargets,
  resolveStackObject,
  groupSimultaneousTriggers,
  applyTriggerOrder,
  pushSimultaneousTriggersToStack,
  parseCounterMovementAbility,
  type Stack,
  type StackObject,
} from '../src/stackOperations';

describe('Stack Operations', () => {
  describe('createEmptyStack', () => {
    it('should create empty stack', () => {
      const stack = createEmptyStack();
      
      expect(stack.objects).toHaveLength(0);
      expect(isStackEmpty(stack)).toBe(true);
    });
  });

  describe('pushToStack', () => {
    it('should add object to stack', () => {
      let stack = createEmptyStack();
      
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'lightning-bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: ['player2'],
        timestamp: 1000,
        type: 'spell',
      };

      const result = pushToStack(stack, spell);
      
      expect(result.stack.objects).toHaveLength(1);
      expect(result.stack.objects[0]).toBe(spell);
      expect(result.log).toHaveLength(1);
    });

    it('should maintain LIFO order', () => {
      let stack = createEmptyStack();
      
      const spell1: StackObject = {
        id: 'spell-1',
        spellId: 'bolt-1',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      const spell2: StackObject = {
        id: 'spell-2',
        spellId: 'counter-1',
        cardName: 'Counterspell',
        controllerId: 'player2',
        targets: ['spell-1'],
        timestamp: 2000,
        type: 'spell',
      };

      stack = pushToStack(stack, spell1).stack;
      stack = pushToStack(stack, spell2).stack;
      
      expect(stack.objects).toHaveLength(2);
      expect(stack.objects[0].id).toBe('spell-1');
      expect(stack.objects[1].id).toBe('spell-2');
    });
  });

  describe('popFromStack', () => {
    it('should remove top object (LIFO)', () => {
      let stack = createEmptyStack();
      
      const spell1: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      const spell2: StackObject = {
        id: 'spell-2',
        spellId: 'counter',
        cardName: 'Counterspell',
        controllerId: 'player2',
        targets: [],
        timestamp: 2000,
        type: 'spell',
      };

      stack = pushToStack(stack, spell1).stack;
      stack = pushToStack(stack, spell2).stack;
      
      const result = popFromStack(stack);
      
      expect(result.object?.id).toBe('spell-2'); // Last in, first out
      expect(result.stack.objects).toHaveLength(1);
      expect(result.stack.objects[0].id).toBe('spell-1');
    });

    it('should handle empty stack', () => {
      const stack = createEmptyStack();
      const result = popFromStack(stack);
      
      expect(result.object).toBeUndefined();
      expect(result.stack.objects).toHaveLength(0);
    });
  });

  describe('peekStack', () => {
    it('should return top object without removing', () => {
      let stack = createEmptyStack();
      
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      stack = pushToStack(stack, spell).stack;
      const top = peekStack(stack);
      
      expect(top?.id).toBe('spell-1');
      expect(stack.objects).toHaveLength(1); // Not removed
    });

    it('should return undefined for empty stack', () => {
      const stack = createEmptyStack();
      const top = peekStack(stack);
      
      expect(top).toBeUndefined();
    });
  });

  describe('isStackEmpty', () => {
    it('should return true for empty stack', () => {
      const stack = createEmptyStack();
      expect(isStackEmpty(stack)).toBe(true);
    });

    it('should return false for non-empty stack', () => {
      let stack = createEmptyStack();
      
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      stack = pushToStack(stack, spell).stack;
      expect(isStackEmpty(stack)).toBe(false);
    });
  });

  describe('getStackSize', () => {
    it('should return correct size', () => {
      let stack = createEmptyStack();
      expect(getStackSize(stack)).toBe(0);
      
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      stack = pushToStack(stack, spell).stack;
      expect(getStackSize(stack)).toBe(1);
      
      stack = pushToStack(stack, { ...spell, id: 'spell-2' }).stack;
      expect(getStackSize(stack)).toBe(2);
    });
  });

  describe('counterStackObject', () => {
    it('should counter object on stack', () => {
      let stack = createEmptyStack();
      
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      stack = pushToStack(stack, spell).stack;
      const result = counterStackObject(stack, 'spell-1');
      
      expect(result.countered).toBe(true);
      expect(result.stack.objects).toHaveLength(0);
    });

    it('should handle non-existent object', () => {
      const stack = createEmptyStack();
      const result = counterStackObject(stack, 'nonexistent');
      
      expect(result.countered).toBe(false);
      expect(result.log[0]).toContain('not found');
    });

    it('should counter object in middle of stack', () => {
      let stack = createEmptyStack();
      
      const spell1: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      const spell2: StackObject = {
        id: 'spell-2',
        spellId: 'giant',
        cardName: 'Giant Growth',
        controllerId: 'player1',
        targets: [],
        timestamp: 2000,
        type: 'spell',
      };

      const spell3: StackObject = {
        id: 'spell-3',
        spellId: 'shock',
        cardName: 'Shock',
        controllerId: 'player2',
        targets: [],
        timestamp: 3000,
        type: 'spell',
      };

      stack = pushToStack(stack, spell1).stack;
      stack = pushToStack(stack, spell2).stack;
      stack = pushToStack(stack, spell3).stack;
      
      const result = counterStackObject(stack, 'spell-2');
      
      expect(result.countered).toBe(true);
      expect(result.stack.objects).toHaveLength(2);
      expect(result.stack.objects.find(s => s.id === 'spell-2')).toBeUndefined();
    });
  });

  describe('validateTargets', () => {
    it('should validate legal targets', () => {
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: ['creature-1'],
        timestamp: 1000,
        type: 'spell',
      };

      const result = validateTargets(spell, ['creature-1', 'creature-2']);
      
      expect(result.valid).toBe(true);
    });

    it('should fail when all targets illegal', () => {
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: ['creature-1'],
        timestamp: 1000,
        type: 'spell',
      };

      const result = validateTargets(spell, ['creature-2', 'creature-3']);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('illegal');
    });

    it('should pass when spell has no targets', () => {
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'wrath',
        cardName: 'Wrath of God',
        controllerId: 'player1',
        targets: [],
        timestamp: 1000,
        type: 'spell',
      };

      const result = validateTargets(spell, []);
      
      expect(result.valid).toBe(true);
    });
  });

  describe('resolveStackObject', () => {
    it('should resolve spell with valid targets', () => {
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: ['player2'],
        timestamp: 1000,
        type: 'spell',
      };

      const result = resolveStackObject(spell, ['player2']);
      
      expect(result.success).toBe(true);
      expect(result.countered).toBe(false);
      expect(result.destination).toBe('graveyard');
    });

    it('should counter spell with illegal targets', () => {
      const spell: StackObject = {
        id: 'spell-1',
        spellId: 'bolt',
        cardName: 'Lightning Bolt',
        controllerId: 'player1',
        targets: ['creature-1'],
        timestamp: 1000,
        type: 'spell',
      };

      const result = resolveStackObject(spell, []);
      
      expect(result.success).toBe(false);
      expect(result.countered).toBe(true);
    });

    it('should handle ability resolution (ceases to exist)', () => {
      const ability: StackObject = {
        id: 'ability-1',
        spellId: 'tap-ability',
        cardName: 'Prodigal Sorcerer ability',
        controllerId: 'player1',
        targets: ['creature-1'],
        timestamp: 1000,
        type: 'ability',
      };

      const result = resolveStackObject(ability, ['creature-1']);
      
      expect(result.success).toBe(true);
      expect(result.destination).toBeUndefined(); // Abilities cease to exist
    });
  });
  
  describe('Rule 603.3b: Simultaneous Trigger Ordering', () => {
    it('should group simultaneous triggers by controller', () => {
      const triggers: StackObject[] = [
        {
          id: 'trigger-1',
          spellId: 'etb-trigger-1',
          cardName: 'ETB Trigger 1',
          controllerId: 'player1',
          timestamp: 1000,
          type: 'ability',
        },
        {
          id: 'trigger-2',
          spellId: 'etb-trigger-2',
          cardName: 'ETB Trigger 2',
          controllerId: 'player1',
          timestamp: 1000,
          type: 'ability',
        },
        {
          id: 'trigger-3',
          spellId: 'etb-trigger-3',
          cardName: 'ETB Trigger 3',
          controllerId: 'player2',
          timestamp: 1000,
          type: 'ability',
        },
      ];
      
      const result = groupSimultaneousTriggers(triggers);
      
      expect(result.groups.length).toBe(2);
      expect(result.requiresPlayerChoice).toBe(true);
      
      const player1Group = result.groups.find(g => g.controllerId === 'player1');
      expect(player1Group?.triggers.length).toBe(2);
      expect(player1Group?.requiresOrdering).toBe(true);
      
      const player2Group = result.groups.find(g => g.controllerId === 'player2');
      expect(player2Group?.triggers.length).toBe(1);
      expect(player2Group?.requiresOrdering).toBe(false);
    });
    
    it('should not require ordering when each player has only one trigger', () => {
      const triggers: StackObject[] = [
        {
          id: 'trigger-1',
          spellId: 'etb-trigger-1',
          cardName: 'ETB Trigger 1',
          controllerId: 'player1',
          timestamp: 1000,
          type: 'ability',
        },
        {
          id: 'trigger-2',
          spellId: 'etb-trigger-2',
          cardName: 'ETB Trigger 2',
          controllerId: 'player2',
          timestamp: 1000,
          type: 'ability',
        },
      ];
      
      const result = groupSimultaneousTriggers(triggers);
      
      expect(result.requiresPlayerChoice).toBe(false);
      expect(result.groups.every(g => !g.requiresOrdering)).toBe(true);
    });
    
    it('should apply player chosen trigger order', () => {
      const triggers: StackObject[] = [
        {
          id: 'trigger-A',
          spellId: 'trigger-A',
          cardName: 'Trigger A',
          controllerId: 'player1',
          timestamp: 1000,
          type: 'ability',
        },
        {
          id: 'trigger-B',
          spellId: 'trigger-B',
          cardName: 'Trigger B',
          controllerId: 'player1',
          timestamp: 1000,
          type: 'ability',
        },
        {
          id: 'trigger-C',
          spellId: 'trigger-C',
          cardName: 'Trigger C',
          controllerId: 'player1',
          timestamp: 1000,
          type: 'ability',
        },
      ];
      
      // Player wants A to resolve first, then B, then C
      // So on stack: C (bottom), B, A (top)
      const result = applyTriggerOrder(triggers, ['trigger-A', 'trigger-B', 'trigger-C']);
      
      // Stack order should be reversed: C, B, A (A on top, resolves first)
      expect(result.orderedTriggers[0].id).toBe('trigger-C');
      expect(result.orderedTriggers[1].id).toBe('trigger-B');
      expect(result.orderedTriggers[2].id).toBe('trigger-A');
    });
    
    it('should put simultaneous triggers on stack in APNAP order', () => {
      const stack = createEmptyStack();
      
      const triggerGroups = [
        {
          controllerId: 'player2', // Non-active player
          triggers: [{
            id: 'trigger-NAP',
            spellId: 'trigger-NAP',
            cardName: 'NAP Trigger',
            controllerId: 'player2',
            timestamp: 1000,
            type: 'ability' as const,
          }],
          requiresOrdering: false,
        },
        {
          controllerId: 'player1', // Active player
          triggers: [{
            id: 'trigger-AP',
            spellId: 'trigger-AP',
            cardName: 'AP Trigger',
            controllerId: 'player1',
            timestamp: 1000,
            type: 'ability' as const,
          }],
          requiresOrdering: false,
        },
      ];
      
      const turnOrder = ['player1', 'player2']; // player1 is active
      const result = pushSimultaneousTriggersToStack(stack, triggerGroups, turnOrder);
      
      // Active player's triggers go on first (bottom), non-active player's on top
      // So NAP trigger should be on top (resolves first)
      expect(result.stack.objects[0].id).toBe('trigger-AP'); // Bottom
      expect(result.stack.objects[1].id).toBe('trigger-NAP'); // Top
    });
  });
  
  describe('Counter Movement (Reyhan, Forgotten Ancient)', () => {
    it('should parse Reyhan counter movement ability', () => {
      const oracleText = 'Whenever a creature you control dies or is put into the command zone, you may put its counters on target creature.';
      const result = parseCounterMovementAbility(oracleText);
      
      expect(result.canMoveCounters).toBe(true);
      expect(result.counterType).toBe('all');
    });
    
    it('should parse Forgotten Ancient counter movement ability', () => {
      const oracleText = 'At the beginning of your upkeep, you may move any number of +1/+1 counters from Forgotten Ancient onto other creatures.';
      const result = parseCounterMovementAbility(oracleText);
      
      expect(result.canMoveCounters).toBe(true);
      expect(result.counterType).toBe('+1/+1');
    });
    
    it('should return false for cards without counter movement', () => {
      const oracleText = 'When this creature enters the battlefield, draw a card.';
      const result = parseCounterMovementAbility(oracleText);
      
      expect(result.canMoveCounters).toBe(false);
    });
  });
});
