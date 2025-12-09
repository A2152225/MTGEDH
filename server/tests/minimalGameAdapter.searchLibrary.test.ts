/**
 * Test for MinimalGameAdapter.searchLibrary functionality
 * Verifies that the searchLibrary method works correctly for AI commander selection
 */

import { describe, it, expect } from 'vitest';
import { GameManager } from '../src/GameManager';

describe('MinimalGameAdapter.searchLibrary', () => {
  it('should return all library cards when query is empty', () => {
    // Create a game (might fall back to MinimalGameAdapter)
    const game = GameManager.createGame({ id: 'test-search-library' });
    
    // Import a deck with some cards
    const testCards = [
      {
        id: 'cmd1',
        name: 'Atraxa, Praetors\' Voice',
        type_line: 'Legendary Creature — Phyrexian Angel Horror',
        oracle_text: 'Flying, vigilance, deathtouch, lifelink',
        mana_cost: '{G}{W}{U}{B}',
        color_identity: ['G', 'W', 'U', 'B'],
      },
      {
        id: 'card2',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
        mana_cost: '',
        color_identity: ['G'],
      },
      {
        id: 'card3',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '{T}: Add {U}.',
        mana_cost: '',
        color_identity: ['U'],
      },
    ];
    
    const playerId = 'p_test';
    
    // Import deck for the player
    if (typeof game.importDeckResolved === 'function') {
      game.importDeckResolved(playerId, testCards);
    }
    
    // Search library with empty query - should return all cards
    if (typeof game.searchLibrary === 'function') {
      const results = game.searchLibrary(playerId, '', 100);
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);
      
      // Verify cards have required properties for commander selection
      const atraxa = results.find((c: any) => c.name === 'Atraxa, Praetors\' Voice');
      expect(atraxa).toBeDefined();
      expect(atraxa.id).toBe('cmd1');
      expect(atraxa.type_line).toContain('Legendary Creature');
      expect(atraxa.color_identity).toBeDefined();
      expect(atraxa.color_identity).toEqual(['G', 'W', 'U', 'B']);
    } else {
      // This test expects searchLibrary to exist
      throw new Error('searchLibrary method not found on game object');
    }
  });
  
  it('should filter library cards by name query', () => {
    const game = GameManager.createGame({ id: 'test-search-library-filter' });
    
    const testCards = [
      {
        id: 'cmd1',
        name: 'Atraxa, Praetors\' Voice',
        type_line: 'Legendary Creature — Phyrexian Angel Horror',
        oracle_text: 'Flying, vigilance, deathtouch, lifelink',
        mana_cost: '{G}{W}{U}{B}',
        color_identity: ['G', 'W', 'U', 'B'],
      },
      {
        id: 'card2',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
        mana_cost: '',
        color_identity: ['G'],
      },
      {
        id: 'card3',
        name: 'Forbidden Orchard',
        type_line: 'Land',
        oracle_text: '{T}: Add one mana of any color.',
        mana_cost: '',
        color_identity: [],
      },
    ];
    
    const playerId = 'p_test';
    
    // Import deck
    if (typeof game.importDeckResolved === 'function') {
      game.importDeckResolved(playerId, testCards);
    }
    
    // Search for cards containing "forest"
    if (typeof game.searchLibrary === 'function') {
      const results = game.searchLibrary(playerId, 'forest', 100);
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Forest');
    }
  });
  
  it('should return empty array when player has no library', () => {
    const game = GameManager.createGame({ id: 'test-search-library-empty' });
    
    const playerId = 'p_no_library';
    
    // Don't import any deck
    
    // Search should return empty array, not throw
    if (typeof game.searchLibrary === 'function') {
      const results = game.searchLibrary(playerId, '', 100);
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    }
  });
  
  it('should respect the limit parameter', () => {
    const game = GameManager.createGame({ id: 'test-search-library-limit' });
    
    // Create 10 cards
    const testCards = Array.from({ length: 10 }, (_, i) => ({
      id: `card${i}`,
      name: `Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
      mana_cost: '{1}',
      color_identity: [],
    }));
    
    const playerId = 'p_test';
    
    // Import deck
    if (typeof game.importDeckResolved === 'function') {
      game.importDeckResolved(playerId, testCards);
    }
    
    // Search with limit of 5
    if (typeof game.searchLibrary === 'function') {
      const results = game.searchLibrary(playerId, '', 5);
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(5);
    }
  });
});
