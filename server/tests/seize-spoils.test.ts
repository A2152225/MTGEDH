/**
 * Test for Seize the Spoils resolution
 * Tests that after paying the additional discard cost, the spell resolves correctly
 * and draws 2 cards + creates a Treasure token
 */

import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/GameManager';
import { GamePhase, type PlayerID } from '../../shared/src';

describe('Seize the Spoils', () => {
  it('should draw 2 cards and create a Treasure token when resolved', () => {
    const game = createInitialGameState('seize_spoils_test');
    const p1 = 'player1' as PlayerID;
    
    // Join the game
    game.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    // Set up game state
    (game.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    
    // Put cards in library for drawing
    const zones = game.state.zones![p1];
    zones.library = [
      { id: 'lib1', name: 'Card 1', type_line: 'Creature' },
      { id: 'lib2', name: 'Card 2', type_line: 'Creature' },
      { id: 'lib3', name: 'Card 3', type_line: 'Creature' },
    ];
    zones.libraryCount = 3;
    
    // Create Seize the Spoils card on the stack
    const seizeCard = {
      id: 'seize1',
      name: 'Seize the Spoils',
      type_line: 'Sorcery',
      oracle_text: 'As an additional cost to cast this spell, discard a card.\nDraw two cards and create a Treasure token.',
      mana_cost: '{2}{R}',
    };
    
    // Put spell on stack (simulating successful cast after paying costs)
    game.state.stack = [{
      id: 'spell1',
      controller: p1,
      card: seizeCard,
      targets: [],
    } as any];
    
    // Record initial state
    const handCountBefore = zones.hand.length;
    const battlefieldCountBefore = game.state.battlefield.length;
    
    // Resolve the spell
    game.passPriority(p1); // P1 passes
    
    // Check results
    const handCountAfter = zones.hand.length;
    const battlefieldCountAfter = game.state.battlefield.length;
    
    // Should have drawn 2 cards
    expect(handCountAfter).toBe(handCountBefore + 2);
    
    // Should have created 1 Treasure token
    expect(battlefieldCountAfter).toBe(battlefieldCountBefore + 1);
    
    // Verify the token is a Treasure
    const treasures = game.state.battlefield.filter((p: any) => 
      p.card?.name === 'Treasure' && p.controller === p1
    );
    expect(treasures.length).toBe(1);
    expect(treasures[0].card.type_line).toContain('Treasure');
  });
});
