/**
 * Test suite for tutor effect destination parsing
 * Tests that detectTutorEffect correctly parses the intended destination
 * from card oracle text.
 */

import { describe, it, expect } from 'vitest';

// Re-implement detectTutorEffect for testing (since it's not exported)
// This mirrors the logic in server/src/socket/interaction.ts
function detectTutorEffect(oracleText: string): { isTutor: boolean; searchCriteria?: string; destination?: string } {
  if (!oracleText) return { isTutor: false };
  
  const text = oracleText.toLowerCase();
  
  if (text.includes('search your library')) {
    let searchCriteria = '';
    let destination = 'hand';
    
    const forMatch = text.match(/search your library for (?:a|an|up to \w+) ([^,\.]+)/i);
    if (forMatch) {
      searchCriteria = forMatch[1].trim();
    }
    
    // Top of library patterns
    if (text.includes('put it on top of your library') || 
        text.includes('put that card on top of your library') ||
        text.includes('put it on top') ||
        text.includes('put that card on top')) {
      destination = 'top';
    }
    // Battlefield patterns
    else if (text.includes('put it onto the battlefield') || 
             text.includes('put that card onto the battlefield') ||
             text.includes('put onto the battlefield') ||
             text.includes('enters the battlefield')) {
      destination = 'battlefield';
    }
    // Graveyard patterns
    else if (text.includes('put it into your graveyard') || 
             text.includes('put that card into your graveyard') ||
             text.includes('put into your graveyard')) {
      destination = 'graveyard';
    }
    // Hand patterns
    else if (text.includes('put it into your hand') || 
             text.includes('put that card into your hand') ||
             text.includes('add it to your hand') ||
             text.includes('reveal it') ||
             text.includes('reveal that card')) {
      destination = 'hand';
    }
    
    return { isTutor: true, searchCriteria, destination };
  }
  
  return { isTutor: false };
}

describe('Tutor Destination Parsing', () => {
  describe('detectTutorEffect - destination detection', () => {
    it('should detect hand destination for Demonic Tutor', () => {
      const oracleText = "Search your library for a card, put that card into your hand, then shuffle.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('hand');
    });

    it('should detect top of library destination for Vampiric Tutor', () => {
      const oracleText = "Search your library for a card, then shuffle and put that card on top of it. You lose 2 life.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('top');
    });

    it('should detect top of library destination for Mystical Tutor', () => {
      const oracleText = "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top of your library.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('top');
      expect(result.searchCriteria).toContain('instant');
    });

    it('should detect battlefield destination for Green Sun\'s Zenith', () => {
      const oracleText = "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('battlefield');
    });

    it('should detect battlefield destination for Natural Order', () => {
      const oracleText = "As an additional cost to cast this spell, sacrifice a green creature.\nSearch your library for a green creature card, put it onto the battlefield, then shuffle.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('battlefield');
    });

    it('should detect graveyard destination for Entomb', () => {
      const oracleText = "Search your library for a card, put that card into your graveyard, then shuffle.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('graveyard');
    });

    it('should detect hand destination for Diabolic Tutor', () => {
      const oracleText = "Search your library for a card and put that card into your hand. Then shuffle your library.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('hand');
    });

    it('should detect hand destination for Enlightened Tutor (reveal pattern)', () => {
      const oracleText = "Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top of your library.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      // Should detect "top" because it explicitly says "on top of your library"
      expect(result.destination).toBe('top');
    });

    it('should detect search criteria for creature tutors', () => {
      const oracleText = "Search your library for a creature card with power 2 or less, reveal it, put it into your hand, then shuffle.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('hand');
      expect(result.searchCriteria).toContain('creature');
    });

    it('should default to hand for unrecognized patterns', () => {
      const oracleText = "Search your library for a card.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(true);
      expect(result.destination).toBe('hand');
    });

    it('should return isTutor: false for non-tutor cards', () => {
      const oracleText = "Draw three cards.";
      const result = detectTutorEffect(oracleText);
      
      expect(result.isTutor).toBe(false);
    });
  });
});
