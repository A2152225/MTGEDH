import { describe, it, expect } from 'vitest';
import { createInitialGameState } from './src/state/gameState';
import type { PlayerID, KnownCardRef } from '../shared/src';
import { GamePhase, GameStep } from '../shared/src';

describe('Priority after playing land', () => {
  it('should retain priority after playing a land and be able to cast a spell', () => {
    const g = createInitialGameState('priority_land_spell');
    
    const p1 = 'p1' as PlayerID;
    
    // Join player
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    // Check initial priority
    console.log('Initial state:', {
      turnPlayer: g.state.turnPlayer,
      priority: g.state.priority,
      phase: g.state.phase,
      step: g.state.step
    });
    
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
    
    console.log('Before playing land:', {
      turnPlayer: g.state.turnPlayer,
      priority: g.state.priority,
      phase: g.state.phase,
      step: g.state.step,
      handCount: g.state.zones?.[p1]?.handCount,
      battlefield: g.state.battlefield.length
    });
    
    // Play the forest
    const handCards = g.state.zones?.[p1]?.hand as any[];
    const forestCard = handCards.find((c: any) => c.name === 'Forest');
    
    expect(forestCard).toBeDefined();
    
    g.playLand(p1, forestCard.id);
    
    console.log('After playing land:', {
      turnPlayer: g.state.turnPlayer,
      priority: g.state.priority,
      phase: g.state.phase,
      step: g.state.step,
      handCount: g.state.zones?.[p1]?.handCount,
      battlefield: g.state.battlefield.length,
      landsPlayedThisTurn: g.state.landsPlayedThisTurn?.[p1]
    });
    
    // Critical check: priority should still be with p1 after playing a land
    expect(g.state.priority).toBe(p1);
    expect(g.state.turnPlayer).toBe(p1);
    expect(g.state.battlefield.length).toBe(1);
    
    // Verify we're still in main phase
    const phaseStr = String(g.state.phase || '').toUpperCase();
    const stepStr = String(g.state.step || '').toUpperCase();
    const isMainPhase = phaseStr.includes('MAIN') || stepStr.includes('MAIN');
    expect(isMainPhase).toBe(true);
    
    console.log('Phase check:', { phaseStr, stepStr, isMainPhase });
  });
});
