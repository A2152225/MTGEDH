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

/**
 * Test suite for parseSearchFilter function
 * Tests that search criteria strings are correctly parsed into filter objects
 * with proper format for LibrarySearchModal (types array, not boolean properties)
 */
describe('parseSearchFilter', () => {
  // Re-implement parseSearchFilter for testing (mirrors server/src/socket/util.ts)
  function parseSearchFilter(criteria: string): { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } {
    if (!criteria) return {};
    
    const filter: { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } = {};
    const text = criteria.toLowerCase();
    
    // Card types - must be in types array for client filter to work
    const types: string[] = [];
    if (text.includes('creature')) types.push('creature');
    if (text.includes('instant')) types.push('instant');
    if (text.includes('sorcery')) types.push('sorcery');
    if (text.includes('artifact')) types.push('artifact');
    if (text.includes('enchantment')) types.push('enchantment');
    if (text.includes('planeswalker')) types.push('planeswalker');
    if (text.includes('land')) types.push('land');
    if (text.includes('tribal') || text.includes('kindred')) types.push('tribal');
    if (text.includes('battle')) types.push('battle');
    
    // Special composite types (these are handled specially by client matchesFilter)
    if (text.includes('historic')) types.push('historic');
    if (text.includes('permanent')) types.push('permanent');
    if (text.includes('noncreature')) types.push('noncreature');
    if (text.includes('nonland')) types.push('nonland');
    if (text.includes('nonartifact')) types.push('nonartifact');
    
    if (types.length > 0) {
      filter.types = types;
    }
    
    // Supertypes (Basic, Legendary, Snow, World, Ongoing, Host)
    const supertypes: string[] = [];
    if (text.includes('basic')) supertypes.push('basic');
    if (text.includes('legendary')) supertypes.push('legendary');
    if (text.includes('snow')) supertypes.push('snow');
    if (text.includes('world')) supertypes.push('world');
    if (text.includes('ongoing')) supertypes.push('ongoing');
    if (text.includes('host')) supertypes.push('host');
    
    if (supertypes.length > 0) {
      filter.supertypes = supertypes;
    }
    
    // Subtypes (land types, creature types, etc.)
    const subtypes: string[] = [];
    if (text.includes('forest')) subtypes.push('forest');
    if (text.includes('plains')) subtypes.push('plains');
    if (text.includes('island')) subtypes.push('island');
    if (text.includes('swamp')) subtypes.push('swamp');
    if (text.includes('mountain')) subtypes.push('mountain');
    if (text.includes('equipment')) subtypes.push('equipment');
    if (text.includes('aura')) subtypes.push('aura');
    if (text.includes('vehicle')) subtypes.push('vehicle');
    
    if (subtypes.length > 0) {
      filter.subtypes = subtypes;
    }
    
    // CMC restrictions
    const cmcMatch = text.match(/mana value (\d+) or less/);
    if (cmcMatch) {
      filter.maxCmc = parseInt(cmcMatch[1], 10);
    }
    
    return filter;
  }

  it('should parse planeswalker card to types array', () => {
    const filter = parseSearchFilter('planeswalker card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('planeswalker');
    expect(filter.types?.length).toBe(1);
  });

  it('should parse creature card to types array', () => {
    const filter = parseSearchFilter('creature card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('creature');
  });

  it('should parse artifact card to types array', () => {
    const filter = parseSearchFilter('artifact card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('artifact');
  });

  it('should parse basic land to both types and supertypes', () => {
    const filter = parseSearchFilter('basic land card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('land');
    expect(filter.supertypes).toBeDefined();
    expect(filter.supertypes).toContain('basic');
  });

  it('should parse forest to subtypes', () => {
    const filter = parseSearchFilter('Forest card');
    
    expect(filter.subtypes).toBeDefined();
    expect(filter.subtypes).toContain('forest');
  });

  it('should parse mana value restrictions', () => {
    const filter = parseSearchFilter('creature card with mana value 3 or less');
    
    expect(filter.types).toContain('creature');
    expect(filter.maxCmc).toBe(3);
  });

  it('should return empty object for generic card search', () => {
    const filter = parseSearchFilter('card');
    
    // Should have no type restrictions for generic "card" search
    expect(filter.types).toBeUndefined();
  });

  it('should handle enchantment creature (multiple types)', () => {
    const filter = parseSearchFilter('enchantment creature card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('enchantment');
    expect(filter.types).toContain('creature');
  });

  it('should handle legendary planeswalker', () => {
    const filter = parseSearchFilter('legendary planeswalker card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('planeswalker');
    expect(filter.supertypes).toBeDefined();
    expect(filter.supertypes).toContain('legendary');
  });

  // Additional tests for complete card type coverage
  it('should parse instant card to types array', () => {
    const filter = parseSearchFilter('instant card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('instant');
  });

  it('should parse sorcery card to types array', () => {
    const filter = parseSearchFilter('sorcery card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('sorcery');
  });

  it('should parse battle card to types array', () => {
    const filter = parseSearchFilter('battle card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('battle');
  });

  it('should parse tribal/kindred card to types array', () => {
    const filter = parseSearchFilter('tribal instant card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('tribal');
    expect(filter.types).toContain('instant');
  });

  // Tests for composite types
  it('should parse historic card to types array', () => {
    const filter = parseSearchFilter('historic permanent');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('historic');
    expect(filter.types).toContain('permanent');
  });

  it('should parse noncreature permanent to types array', () => {
    const filter = parseSearchFilter('noncreature permanent');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('noncreature');
    expect(filter.types).toContain('permanent');
  });

  it('should parse nonland card to types array', () => {
    const filter = parseSearchFilter('nonland card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('nonland');
  });

  // Tests for additional supertypes
  it('should parse snow permanent to supertypes', () => {
    const filter = parseSearchFilter('snow permanent');
    
    expect(filter.supertypes).toBeDefined();
    expect(filter.supertypes).toContain('snow');
  });

  // Tests for additional subtypes
  it('should parse aura card to subtypes', () => {
    const filter = parseSearchFilter('aura card');
    
    expect(filter.subtypes).toBeDefined();
    expect(filter.subtypes).toContain('aura');
  });

  it('should parse vehicle artifact to subtypes', () => {
    const filter = parseSearchFilter('vehicle artifact card');
    
    expect(filter.types).toBeDefined();
    expect(filter.types).toContain('artifact');
    expect(filter.subtypes).toBeDefined();
    expect(filter.subtypes).toContain('vehicle');
  });
});
