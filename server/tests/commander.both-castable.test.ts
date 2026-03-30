/**
 * Test for casting both commanders in a partner commander game
 * Verifies that both commanders can be cast independently
 */

import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';

describe('Casting both partner commanders', () => {
  it('replays legacy castCommander events that only persisted cardId', () => {
    const game = createInitialGameState('commander_legacy_cast_replay');
    const p1 = 'player1' as PlayerID;

    const commanderCard = {
      id: 'cmd1',
      name: 'Kynaios and Tiro of Meletis',
      type_line: 'Legendary Creature — Human Soldier',
      oracle_text: 'At the beginning of your end step, draw a card.',
      image_uris: {},
      mana_cost: '{R}{G}{W}{U}',
      power: '2',
      toughness: '8',
    };

    const fillerCards: KnownCardRef[] = Array.from({ length: 99 }, (_, index) => ({
      id: `card${index}`,
      name: `Card ${index}`,
      type_line: 'Sorcery',
      oracle_text: 'Draw a card.',
      image_uris: {},
      mana_cost: '{1}',
    } as any));

    game.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    game.applyEvent({
      type: 'importDeck',
      playerId: p1,
      cards: [commanderCard as any, ...fillerCards],
    });

    game.setCommander(p1, [commanderCard.name], [commanderCard.id], ['R', 'G', 'W', 'U']);

    game.applyEvent({
      type: 'castCommander',
      playerId: p1,
      cardId: commanderCard.id,
      cardName: commanderCard.name,
      card: commanderCard,
      isAI: true,
    } as any);

    const commandZone = game.state.commandZone?.[p1];
    const inCZ = (commandZone as any)?.inCommandZone || [];
    expect(inCZ).not.toContain(commanderCard.id);
    expect(commandZone?.taxById?.[commanderCard.id]).toBe(2);
  });

  it('should allow casting both partner commanders independently', () => {
    const game = createInitialGameState('commander_both_castable');
    const p1 = 'player1' as PlayerID;
    
    // Create a deck with 2 partner commanders
    const commanderCard1 = {
      id: 'cmd1',
      name: 'Thrasios, Triton Hero',
      type_line: 'Legendary Creature — Merfolk Wizard',
      oracle_text: 'Partner',
      image_uris: {},
      mana_cost: '{G}{U}',
      power: '1',
      toughness: '3',
    };
    
    const commanderCard2 = {
      id: 'cmd2',
      name: 'Tymna the Weaver',
      type_line: 'Legendary Creature — Human Cleric',
      oracle_text: 'Partner',
      image_uris: {},
      mana_cost: '{1}{W}{B}',
      power: '2',
      toughness: '2',
    };
    
    // Create 98 other cards
    const otherCards = [];
    for (let i = 0; i < 98; i++) {
      otherCards.push({
        id: `card${i}`,
        name: `Card ${i}`,
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
        image_uris: {},
        mana_cost: '{1}',
      });
    }
    
    // Deck has 100 cards: 2 commanders + 98 others
    const deck = [commanderCard1, commanderCard2, ...otherCards];
    
    // Join game
    game.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    // Import the deck - using applyEvent
    game.applyEvent({ 
      type: 'importDeck', 
      playerId: p1, 
      cards: deck 
    });
    
    // Set both commanders
    game.setCommander(
      p1,
      ['Thrasios, Triton Hero', 'Tymna the Weaver'],
      ['cmd1', 'cmd2'],
      ['G', 'U', 'W', 'B']
    );
    
    // Verify both commanders are in the command zone
    const commandZoneBefore = game.state.commandZone?.[p1];
    expect(commandZoneBefore).toBeDefined();
    expect(commandZoneBefore?.commanderIds).toEqual(['cmd1', 'cmd2']);
    
    // Verify inCommandZone array is initialized with both commanders
    const inCZBefore = (commandZoneBefore as any)?.inCommandZone || [];
    expect(inCZBefore).toContain('cmd1');
    expect(inCZBefore).toContain('cmd2');
    expect(inCZBefore.length).toBe(2);
    
    // Cast the first commander
    game.castCommander(p1, 'cmd1');
    
    // Verify first commander is removed from inCommandZone
    const commandZoneAfterFirst = game.state.commandZone?.[p1];
    const inCZAfterFirst = (commandZoneAfterFirst as any)?.inCommandZone || [];
    expect(inCZAfterFirst).not.toContain('cmd1');
    expect(inCZAfterFirst).toContain('cmd2'); // Second commander should still be there
    expect(inCZAfterFirst.length).toBe(1);
    
    // Verify tax was applied to first commander
    expect(commandZoneAfterFirst?.taxById?.['cmd1']).toBe(2);
    expect(commandZoneAfterFirst?.taxById?.['cmd2']).toBe(0);
    
    // Now cast the second commander
    game.castCommander(p1, 'cmd2');
    
    // Verify second commander is also removed from inCommandZone
    const commandZoneAfterSecond = game.state.commandZone?.[p1];
    const inCZAfterSecond = (commandZoneAfterSecond as any)?.inCommandZone || [];
    expect(inCZAfterSecond).not.toContain('cmd1');
    expect(inCZAfterSecond).not.toContain('cmd2');
    expect(inCZAfterSecond.length).toBe(0);
    
    // Verify tax was applied to second commander
    expect(commandZoneAfterSecond?.taxById?.['cmd1']).toBe(2);
    expect(commandZoneAfterSecond?.taxById?.['cmd2']).toBe(2);
    
    // Move first commander back to command zone
    game.moveCommanderToCZ(p1, 'cmd1');
    
    // Verify first commander is back in inCommandZone
    const commandZoneAfterMove1 = game.state.commandZone?.[p1];
    const inCZAfterMove1 = (commandZoneAfterMove1 as any)?.inCommandZone || [];
    expect(inCZAfterMove1).toContain('cmd1');
    expect(inCZAfterMove1).not.toContain('cmd2'); // Second is still out
    expect(inCZAfterMove1.length).toBe(1);
    
    // Move second commander back to command zone
    game.moveCommanderToCZ(p1, 'cmd2');
    
    // Verify both commanders are back in inCommandZone
    const commandZoneAfterMove2 = game.state.commandZone?.[p1];
    const inCZAfterMove2 = (commandZoneAfterMove2 as any)?.inCommandZone || [];
    expect(inCZAfterMove2).toContain('cmd1');
    expect(inCZAfterMove2).toContain('cmd2');
    expect(inCZAfterMove2.length).toBe(2);
    
    // Cast both commanders again to verify tax increases
    game.castCommander(p1, 'cmd1');
    game.castCommander(p1, 'cmd2');
    
    const commandZoneFinal = game.state.commandZone?.[p1];
    expect(commandZoneFinal?.taxById?.['cmd1']).toBe(4); // Second cast, so 2+2=4
    expect(commandZoneFinal?.taxById?.['cmd2']).toBe(4);
  });
});
