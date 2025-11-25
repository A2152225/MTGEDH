import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';

describe('Priority after playing land', () => {
  it('should set turnPlayer and priority when first non-spectator player joins', () => {
    const g = createInitialGameState('priority_on_join');
    
    const p1 = 'p1' as PlayerID;
    
    // Before joining, turnPlayer and priority should be empty
    expect(g.state.turnPlayer).toBe('');
    expect(g.state.priority).toBe('');
    
    // Join player
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    // After joining, turnPlayer and priority should be set to p1
    expect(g.state.priority).toBe(p1);
    expect(g.state.turnPlayer).toBe(p1);
  });

  it('should retain priority after playing a land', () => {
    const g = createInitialGameState('priority_land_spell');
    
    const p1 = 'p1' as PlayerID;
    
    // Join player
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    expect(g.state.priority).toBe(p1);
    expect(g.state.turnPlayer).toBe(p1);
    
    // Import deck with a Forest and Llanowar Elves
    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', image_uris: undefined },
      { id: 'llanowar_1', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.', mana_cost: '{G}', image_uris: undefined },
    ];
    
    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 2);
    
    // Advance to main phase
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).step = GameStep.MAIN1;
    
    // Play the forest
    const handCards = g.state.zones?.[p1]?.hand as any[];
    const forestCard = handCards.find((c: any) => c.name === 'Forest');
    
    expect(forestCard).toBeDefined();
    
    g.playLand(p1, forestCard.id);
    
    // Critical check: priority should still be with p1 after playing a land
    expect(g.state.priority).toBe(p1);
    expect(g.state.turnPlayer).toBe(p1);
    expect(g.state.battlefield.length).toBe(1);
    
    // Verify we're still in main phase
    const phaseStr = String(g.state.phase || '').toUpperCase();
    const stepStr = String(g.state.step || '').toUpperCase();
    const isMainPhase = phaseStr.includes('MAIN') || stepStr.includes('MAIN');
    expect(isMainPhase).toBe(true);
  });

  it('should not set turnPlayer/priority for spectators', () => {
    const g = createInitialGameState('priority_spectator');
    
    const s1 = 's1' as PlayerID;
    
    // Join as spectator
    g.applyEvent({ type: 'join', playerId: s1, name: 'Spectator 1', spectator: true });
    
    // turnPlayer and priority should remain empty (spectators don't get priority)
    expect(g.state.turnPlayer).toBe('');
    expect(g.state.priority).toBe('');
  });

  it('should give turnPlayer/priority to first non-spectator even if spectators joined first', () => {
    const g = createInitialGameState('priority_spectator_then_player');
    
    const s1 = 's1' as PlayerID;
    const p1 = 'p1' as PlayerID;
    
    // Join spectator first
    g.applyEvent({ type: 'join', playerId: s1, name: 'Spectator 1', spectator: true });
    
    // turnPlayer and priority should still be empty
    expect(g.state.turnPlayer).toBe('');
    expect(g.state.priority).toBe('');
    
    // Then a player joins
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    // Now turnPlayer and priority should be set to p1
    expect(g.state.turnPlayer).toBe(p1);
    expect(g.state.priority).toBe(p1);
  });
});

describe('Priority with multiple players', () => {
  it('should give turnPlayer/priority to the first non-spectator player when 3 players join', () => {
    const g = createInitialGameState('priority_three_players');
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    
    // First player joins
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    // turnPlayer and priority should be set to p1 (first player)
    expect(g.state.turnPlayer).toBe(p1);
    expect(g.state.priority).toBe(p1);
    
    // Second player joins
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    
    // turnPlayer and priority should STILL be p1 (not overwritten)
    expect(g.state.turnPlayer).toBe(p1);
    expect(g.state.priority).toBe(p1);
    
    // Third player joins
    g.applyEvent({ type: 'join', playerId: p3, name: 'Player 3' });
    
    // turnPlayer and priority should STILL be p1 (not overwritten)
    expect(g.state.turnPlayer).toBe(p1);
    expect(g.state.priority).toBe(p1);
    
    // All 3 players should be in the game
    expect((g.state.players as any[]).length).toBe(3);
  });

  it('should allow priority to pass correctly in multiplayer after playing a land', () => {
    const g = createInitialGameState('priority_multiplayer_land');
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    
    // All players join
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    g.applyEvent({ type: 'join', playerId: p3, name: 'Player 3' });
    
    // Import deck for p1
    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', image_uris: undefined },
    ];
    
    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);
    
    // Advance to main phase
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).step = GameStep.MAIN1;
    
    // p1 plays a land
    const handCards = g.state.zones?.[p1]?.hand as any[];
    const forestCard = handCards.find((c: any) => c.name === 'Forest');
    g.playLand(p1, forestCard.id);
    
    // Priority should still be with p1 (active player retains priority after playing a land)
    expect(g.state.priority).toBe(p1);
    expect(g.state.turnPlayer).toBe(p1);
    
    // p1 passes priority
    g.passPriority(p1);
    
    // Priority should now move to p2
    expect(g.state.priority).toBe(p2);
    expect(g.state.turnPlayer).toBe(p1); // Turn player doesn't change
  });
});
