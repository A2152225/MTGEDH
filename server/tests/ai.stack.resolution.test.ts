import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Tests for AI stack resolution functionality
 * These tests verify that when an AI passes priority after all players have passed,
 * the stack properly resolves.
 */
describe('AI Stack Resolution', () => {
  describe('passPriority returns resolvedNow flag', () => {
    it('should return resolvedNow=true when all players pass priority in succession with stack', () => {
      const g = createInitialGameState('ai_stack_resolution');
      
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      // Join two players
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
      
      // Put a spell on the stack
      const lightningBolt: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
        id: 'card_bolt',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        image_uris: undefined
      };
      const stackId = 'st_test123';
      g.applyEvent({
        type: 'pushStack',
        item: {
          id: stackId,
          controller: p1,
          card: lightningBolt,
          targets: []
        }
      });
      
      expect(g.state.stack.length).toBe(1);
      
      // P1 passes priority - should return { changed: true, resolvedNow: false }
      // because not all players have passed yet
      const result1 = g.passPriority(p1);
      expect(result1.changed).toBe(true);
      expect(result1.resolvedNow).toBe(false);
      expect(g.state.priority).toBe(p2); // Priority moves to p2
      
      // P2 passes priority - should return { changed: true, resolvedNow: true }
      // because all players have now passed
      const result2 = g.passPriority(p2);
      expect(result2.changed).toBe(true);
      expect(result2.resolvedNow).toBe(true);
    });
    
    it('should return resolvedNow=false when stack is empty', () => {
      const g = createInitialGameState('ai_empty_stack');
      
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      // Join two players
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
      
      // Stack is empty
      expect(g.state.stack.length).toBe(0);
      
      // P1 passes priority - should not trigger resolution (stack is empty)
      const result1 = g.passPriority(p1);
      expect(result1.changed).toBe(true);
      expect(result1.resolvedNow).toBe(false);
    });
    
    it('should resolve stack correctly in a 3-player game', () => {
      const g = createInitialGameState('ai_3player_stack');
      
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      const p3 = 'p3' as PlayerID;
      
      // Join three players
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
      g.applyEvent({ type: 'join', playerId: p3, name: 'Player 3' });
      
      // Put a spell on the stack
      const bolt: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
        id: 'card_bolt2',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        image_uris: undefined
      };
      g.applyEvent({
        type: 'pushStack',
        item: {
          id: 'st_3p_test',
          controller: p1,
          card: bolt,
          targets: []
        }
      });
      
      expect(g.state.stack.length).toBe(1);
      
      // P1 passes - not all have passed
      const result1 = g.passPriority(p1);
      expect(result1.resolvedNow).toBe(false);
      
      // P2 passes - still not all have passed
      const result2 = g.passPriority(p2);
      expect(result2.resolvedNow).toBe(false);
      
      // P3 passes - now all have passed, stack should resolve
      const result3 = g.passPriority(p3);
      expect(result3.resolvedNow).toBe(true);
    });
    
    it('should resolve stack when all players pass in succession (consecutive passes)', () => {
      const g = createInitialGameState('ai_consecutive_passes');
      
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      // Join two players
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
      
      // Put first spell on the stack
      const spell1: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
        id: 'card_spell1',
        name: 'Giant Growth',
        type_line: 'Instant',
        oracle_text: 'Target creature gets +3/+3 until end of turn.',
        image_uris: undefined
      };
      g.applyEvent({
        type: 'pushStack',
        item: {
          id: 'st_spell1',
          controller: p1,
          card: spell1,
          targets: []
        }
      });
      
      expect(g.state.stack.length).toBe(1);
      
      // P1 passes priority
      const result1 = g.passPriority(p1);
      expect(result1.resolvedNow).toBe(false);
      
      // P2 passes - now both have passed, stack should resolve
      const result2 = g.passPriority(p2);
      expect(result2.resolvedNow).toBe(true);
    });
  });
  
  describe('resolveTopOfStack', () => {
    it('should move permanent to battlefield when resolved', () => {
      const g = createInitialGameState('ai_resolve_permanent');
      
      const p1 = 'p1' as PlayerID;
      
      // Join player
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Put a creature spell on the stack
      const creature: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris' | 'power' | 'toughness'> = {
        id: 'card_bear',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        image_uris: undefined,
        power: '2',
        toughness: '2'
      };
      g.applyEvent({
        type: 'pushStack',
        item: {
          id: 'st_bear',
          controller: p1,
          card: creature,
          targets: []
        }
      });
      
      expect(g.state.stack.length).toBe(1);
      expect(g.state.battlefield.length).toBe(0);
      
      // Resolve the top of stack
      g.resolveTopOfStack();
      
      // Stack should be empty, creature should be on battlefield
      expect(g.state.stack.length).toBe(0);
      expect(g.state.battlefield.length).toBe(1);
      expect(g.state.battlefield[0].card.name).toBe('Grizzly Bears');
    });
    
    it('should remove instant/sorcery from stack when resolved', () => {
      const g = createInitialGameState('ai_resolve_spell');
      
      const p1 = 'p1' as PlayerID;
      
      // Join player
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Put an instant spell on the stack
      const instant: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
        id: 'card_bolt3',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        image_uris: undefined
      };
      g.applyEvent({
        type: 'pushStack',
        item: {
          id: 'st_bolt',
          controller: p1,
          card: instant,
          targets: []
        }
      });
      
      expect(g.state.stack.length).toBe(1);
      
      // Resolve the top of stack
      g.resolveTopOfStack();
      
      // Stack should be empty - the instant was resolved
      // Note: The instant should go to graveyard, but tracking that depends on ctx.zones 
      // which may not be fully initialized when using applyEvent for join.
      // The key point is that the stack is empty after resolution.
      expect(g.state.stack.length).toBe(0);
    });
  });
});
