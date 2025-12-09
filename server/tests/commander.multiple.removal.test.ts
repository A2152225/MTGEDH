/**
 * Test for multiple commander removal from library
 * Verifies that when setting 2 partner commanders, both are properly removed from the library
 */

import { describe, it, expect } from 'vitest';
import { MinimalGameAdapter } from '../src/MinimalGameAdapter';

describe('Commander removal from library', () => {
  it('should remove both partner commanders from library', () => {
    const game = new MinimalGameAdapter();
    const p1 = 'player1';
    
    // Create a deck with 2 partner commanders as the first 2 cards
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
    
    // Import the deck
    game.importDeckResolved(p1, deck);
    
    // Verify library has all 100 cards
    const libraryBeforeStr = game.searchLibrary(p1, '', 1000);
    const libraryBefore = libraryBeforeStr || [];
    expect(libraryBefore.length).toBe(100);
    
    // Verify both commanders are in the library
    const cmd1InLibBefore = libraryBefore.find((c: any) => c.id === 'cmd1');
    const cmd2InLibBefore = libraryBefore.find((c: any) => c.id === 'cmd2');
    expect(cmd1InLibBefore).toBeDefined();
    expect(cmd2InLibBefore).toBeDefined();
    
    // Set both commanders
    game.setCommander(
      p1,
      ['Thrasios, Triton Hero', 'Tymna the Weaver'],
      ['cmd1', 'cmd2'],
      ['G', 'U', 'W', 'B']
    );
    
    // Verify library now has 98 cards (100 - 2 commanders)
    // Note: After setCommander, if pendingInitialDraw was set, it would also draw 7 cards
    // But in this test, we're not setting pendingInitialDraw, so library should have 98 cards
    const libraryAfterStr = game.searchLibrary(p1, '', 1000);
    const libraryAfter = libraryAfterStr || [];
    
    // Since pendingInitialDraw wasn't set for this player, no draw happens
    // So library should have exactly 98 cards (100 - 2 commanders)
    expect(libraryAfter.length).toBe(98);
    
    // Verify both commanders are NOT in the library anymore
    const cmd1InLibAfter = libraryAfter.find((c: any) => c.id === 'cmd1');
    const cmd2InLibAfter = libraryAfter.find((c: any) => c.id === 'cmd2');
    expect(cmd1InLibAfter).toBeUndefined();
    expect(cmd2InLibAfter).toBeUndefined();
    
    // Verify commanders are in the command zone
    const commandZone = game.state.commandZone?.[p1];
    expect(commandZone).toBeDefined();
    expect(commandZone?.commanderIds).toEqual(['cmd1', 'cmd2']);
    expect(commandZone?.commanderNames).toEqual(['Thrasios, Triton Hero', 'Tymna the Weaver']);
  });
  
  it('should handle single commander correctly', () => {
    const game = new MinimalGameAdapter();
    const p1 = 'player1';
    
    // Create a deck with 1 commander as the first card
    const commanderCard = {
      id: 'cmd1',
      name: 'Atraxa, Praetors\' Voice',
      type_line: 'Legendary Creature — Phyrexian Angel Horror',
      oracle_text: 'Flying, vigilance, deathtouch, lifelink',
      image_uris: {},
      mana_cost: '{G}{W}{U}{B}',
      power: '4',
      toughness: '4',
    };
    
    // Create 99 other cards
    const otherCards = [];
    for (let i = 0; i < 99; i++) {
      otherCards.push({
        id: `card${i}`,
        name: `Card ${i}`,
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
        image_uris: {},
        mana_cost: '{1}',
      });
    }
    
    // Deck has 100 cards: 1 commander + 99 others
    const deck = [commanderCard, ...otherCards];
    
    // Import the deck
    game.importDeckResolved(p1, deck);
    
    // Verify library has all 100 cards
    const libraryBefore = game.searchLibrary(p1, '', 1000) || [];
    expect(libraryBefore.length).toBe(100);
    
    // Set the commander
    game.setCommander(
      p1,
      ['Atraxa, Praetors\' Voice'],
      ['cmd1'],
      ['G', 'W', 'U', 'B']
    );
    
    // Verify library now has 99 cards (100 - 1 commander)
    const libraryAfter = game.searchLibrary(p1, '', 1000) || [];
    expect(libraryAfter.length).toBe(99);
    
    // Verify commander is NOT in the library
    const cmdInLibAfter = libraryAfter.find((c: any) => c.id === 'cmd1');
    expect(cmdInLibAfter).toBeUndefined();
    
    // Verify commander is in the command zone
    const commandZone = game.state.commandZone?.[p1];
    expect(commandZone).toBeDefined();
    expect(commandZone?.commanderIds).toEqual(['cmd1']);
    expect(commandZone?.commanderNames).toEqual(['Atraxa, Praetors\' Voice']);
  });
  
  it('should handle commanders not in first positions', () => {
    const game = new MinimalGameAdapter();
    const p1 = 'player1';
    
    // Create commanders that are NOT at the start of the deck
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
    
    // Create other cards
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
    
    // Put commanders at positions 10 and 50 instead of at the start
    const deck = [
      ...otherCards.slice(0, 10),
      commanderCard1,
      ...otherCards.slice(10, 48),
      commanderCard2,
      ...otherCards.slice(48),
    ];
    
    // Import the deck
    game.importDeckResolved(p1, deck);
    
    // Verify library has all 100 cards
    const libraryBefore = game.searchLibrary(p1, '', 1000) || [];
    expect(libraryBefore.length).toBe(100);
    
    // Set both commanders
    game.setCommander(
      p1,
      ['Thrasios, Triton Hero', 'Tymna the Weaver'],
      ['cmd1', 'cmd2'],
      ['G', 'U', 'W', 'B']
    );
    
    // Verify library now has 98 cards
    const libraryAfter = game.searchLibrary(p1, '', 1000) || [];
    expect(libraryAfter.length).toBe(98);
    
    // Verify both commanders are NOT in the library
    const cmd1InLibAfter = libraryAfter.find((c: any) => c.id === 'cmd1');
    const cmd2InLibAfter = libraryAfter.find((c: any) => c.id === 'cmd2');
    expect(cmd1InLibAfter).toBeUndefined();
    expect(cmd2InLibAfter).toBeUndefined();
  });
});
