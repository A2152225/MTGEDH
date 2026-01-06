/**
 * Test for Recruiter of the Guard library search issue
 * 
 * Issue: When searching library with 4 copies of Recruiter of the Guard,
 * only 2 cards are shown instead of all 4.
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('Recruiter of the Guard - Library Search', () => {
  it('should show all 4 copies of Recruiter of the Guard when searching', () => {
    // Simulate library with 4 Recruiter of the Guard (each has toughness 1)
    const library = [
      {
        id: 'recruiter_1',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
      {
        id: 'recruiter_2',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
      {
        id: 'recruiter_3',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
      {
        id: 'recruiter_4',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
    ];

    // Filter criteria for "creature with toughness 2 or less"
    const filter = {
      types: ['creature'],
      maxToughness: 2,
    };

    // Simulate server-side filtering
    const availableCards = library.filter((card: any) => {
      let matches = true;
      
      // Check types
      if (filter.types && filter.types.length > 0) {
        const typeLine = (card.type_line || '').toLowerCase();
        matches = filter.types.some((type: string) => typeLine.includes(type.toLowerCase()));
      }
      
      // Check toughness
      if (matches && typeof filter.maxToughness === 'number') {
        if (card.toughness !== undefined && card.toughness !== null) {
          const toughnessStr = String(card.toughness);
          const toughnessNum = parseInt(toughnessStr, 10);
          if (!isNaN(toughnessNum)) {
            matches = toughnessNum <= filter.maxToughness;
          }
        }
      }
      
      return matches;
    });

    // Should return all 4 copies
    expect(availableCards.length).toBe(4);
    expect(availableCards.every((card: any) => card.name === 'Recruiter of the Guard')).toBe(true);
  });

  it('should show all 4 copies even after client-side re-filtering', () => {
    // Simulate the availableCards from server
    const availableCards = [
      {
        id: 'recruiter_1',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
      {
        id: 'recruiter_2',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
      {
        id: 'recruiter_3',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
      {
        id: 'recruiter_4',
        name: 'Recruiter of the Guard',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        cmc: 3,
      },
    ];

    const filter = {
      types: ['creature'],
      maxToughness: 2,
    };

    // Simulate client-side filtering (from LibrarySearchModal.tsx matchesFilter)
    const clientFilteredCards = availableCards.filter((card: any) => {
      const typeLine = (card.type_line || '').toLowerCase();
      
      // Check types
      if (filter.types && filter.types.length > 0) {
        const matchesType = filter.types.some((t: string) => typeLine.includes(t.toLowerCase()));
        if (!matchesType) return false;
      }
      
      // Check toughness
      if (filter.maxToughness !== undefined) {
        const toughnessStr = card.toughness;
        if (toughnessStr && toughnessStr !== '*') {
          const toughness = parseInt(String(toughnessStr), 10);
          if (!isNaN(toughness)) {
            if (toughness > filter.maxToughness) return false;
          }
        } else {
          // If toughness is undefined or *, cannot match toughness filters
          return false;  // ← This is the potential bug
        }
      }
      
      return true;
    });

    // Should still return all 4 copies after client filtering
    expect(clientFilteredCards.length).toBe(4);
  });
});
