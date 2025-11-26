/**
 * Test suite for opponent-triggered abilities
 * 
 * Tests abilities that trigger when opponents perform actions and require
 * a response (pay a cost, make a choice, etc.)
 * 
 * Examples:
 * - Rhystic Study: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."
 * - Smothering Tithe: "Whenever an opponent draws a card, you may create a Treasure token unless that player pays {2}."
 * - Mystic Remora: "Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}."
 * - Esper Sentinel: "Whenever an opponent casts their first noncreature spell each turn, you draw a card unless that player pays {X}."
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Types for testing
interface Permanent {
  id: string;
  controller: string;
  card: {
    name: string;
    oracle_text: string;
    type_line?: string;
  };
}

interface SpellCastEvent {
  casterId: string;
  spellId: string;
  spellName: string;
  isCreature: boolean;
  isFirstNoncreatureThisTurn?: boolean;
}

interface DrawEvent {
  playerId: string;
  count: number;
}

interface OpponentTrigger {
  type: 'rhystic_study' | 'smothering_tithe' | 'mystic_remora' | 'esper_sentinel' | 'generic_pay_or';
  permanentId: string;
  permanentName: string;
  controller: string; // Who controls the permanent (gets the benefit)
  opponent: string; // Who triggered it (must pay or not)
  paymentCost: string; // e.g., "{1}", "{2}", "{4}"
  benefitIfNotPaid: string; // e.g., "draw a card", "create a Treasure token"
}

/**
 * Detect "pay or" triggers on opponent spell cast
 */
function detectSpellCastPayOrTriggers(
  battlefield: Permanent[],
  event: SpellCastEvent,
  allPlayerIds: string[]
): OpponentTrigger[] {
  const triggers: OpponentTrigger[] = [];
  
  for (const permanent of battlefield) {
    const controller = permanent.controller;
    const oracleText = (permanent.card.oracle_text || '').toLowerCase();
    const cardName = (permanent.card.name || '').toLowerCase();
    
    // Skip if the permanent's controller cast the spell (not an opponent)
    if (controller === event.casterId) continue;
    
    // Rhystic Study: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."
    if (cardName.includes('rhystic study') || 
        (oracleText.includes('opponent casts a spell') && 
         oracleText.includes('draw') && 
         oracleText.includes('unless') && 
         oracleText.includes('pays'))) {
      triggers.push({
        type: 'rhystic_study',
        permanentId: permanent.id,
        permanentName: permanent.card.name,
        controller,
        opponent: event.casterId,
        paymentCost: '{1}',
        benefitIfNotPaid: 'draw a card',
      });
    }
    
    // Mystic Remora: "Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}."
    if (cardName.includes('mystic remora') ||
        (oracleText.includes('opponent casts a noncreature spell') &&
         oracleText.includes('draw') &&
         oracleText.includes('unless') &&
         oracleText.includes('pays'))) {
      // Only trigger on noncreature spells
      if (!event.isCreature) {
        triggers.push({
          type: 'mystic_remora',
          permanentId: permanent.id,
          permanentName: permanent.card.name,
          controller,
          opponent: event.casterId,
          paymentCost: '{4}',
          benefitIfNotPaid: 'draw a card',
        });
      }
    }
    
    // Esper Sentinel: "Whenever an opponent casts their first noncreature spell each turn, you draw a card unless that player pays {X}."
    if (cardName.includes('esper sentinel') ||
        (oracleText.includes('first noncreature spell each turn') &&
         oracleText.includes('draw') &&
         oracleText.includes('unless'))) {
      if (!event.isCreature && event.isFirstNoncreatureThisTurn) {
        triggers.push({
          type: 'esper_sentinel',
          permanentId: permanent.id,
          permanentName: permanent.card.name,
          controller,
          opponent: event.casterId,
          paymentCost: '{X}', // X = Esper Sentinel's power
          benefitIfNotPaid: 'draw a card',
        });
      }
    }
    
    // Generic pattern: "Whenever an opponent casts a spell, [effect] unless that player pays {N}"
    const genericMatch = oracleText.match(/whenever an opponent casts a spell.*unless.*pays\s*(\{[^}]+\})/);
    if (genericMatch && !triggers.some(t => t.permanentId === permanent.id)) {
      triggers.push({
        type: 'generic_pay_or',
        permanentId: permanent.id,
        permanentName: permanent.card.name,
        controller,
        opponent: event.casterId,
        paymentCost: genericMatch[1],
        benefitIfNotPaid: 'trigger effect',
      });
    }
  }
  
  return triggers;
}

/**
 * Detect "pay or" triggers on opponent draw
 */
function detectDrawPayOrTriggers(
  battlefield: Permanent[],
  event: DrawEvent,
  allPlayerIds: string[]
): OpponentTrigger[] {
  const triggers: OpponentTrigger[] = [];
  
  for (const permanent of battlefield) {
    const controller = permanent.controller;
    const oracleText = (permanent.card.oracle_text || '').toLowerCase();
    const cardName = (permanent.card.name || '').toLowerCase();
    
    // Skip if the permanent's controller drew the card (not an opponent)
    if (controller === event.playerId) continue;
    
    // Smothering Tithe: "Whenever an opponent draws a card, you create a Treasure token unless that player pays {2}."
    if (cardName.includes('smothering tithe') ||
        (oracleText.includes('opponent draws a card') &&
         oracleText.includes('treasure') &&
         oracleText.includes('unless') &&
         oracleText.includes('pays'))) {
      // Trigger once per card drawn
      for (let i = 0; i < event.count; i++) {
        triggers.push({
          type: 'smothering_tithe',
          permanentId: permanent.id,
          permanentName: permanent.card.name,
          controller,
          opponent: event.playerId,
          paymentCost: '{2}',
          benefitIfNotPaid: 'create a Treasure token',
        });
      }
    }
  }
  
  return triggers;
}

describe('Opponent "Pay or" Triggers', () => {
  let battlefield: Permanent[];
  
  beforeEach(() => {
    battlefield = [];
  });
  
  describe('Rhystic Study', () => {
    it('should trigger when opponent casts any spell', () => {
      battlefield.push({
        id: 'rhystic1',
        controller: 'player1',
        card: {
          name: 'Rhystic Study',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      });
      
      const event: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell1',
        spellName: 'Lightning Bolt',
        isCreature: false,
      };
      
      const triggers = detectSpellCastPayOrTriggers(battlefield, event, ['player1', 'player2']);
      
      expect(triggers.length).toBe(1);
      expect(triggers[0].type).toBe('rhystic_study');
      expect(triggers[0].controller).toBe('player1');
      expect(triggers[0].opponent).toBe('player2');
      expect(triggers[0].paymentCost).toBe('{1}');
    });
    
    it('should NOT trigger when controller casts a spell', () => {
      battlefield.push({
        id: 'rhystic1',
        controller: 'player1',
        card: {
          name: 'Rhystic Study',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      });
      
      const event: SpellCastEvent = {
        casterId: 'player1', // Same as controller
        spellId: 'spell1',
        spellName: 'Counterspell',
        isCreature: false,
      };
      
      const triggers = detectSpellCastPayOrTriggers(battlefield, event, ['player1', 'player2']);
      
      expect(triggers.length).toBe(0);
    });
    
    it('should trigger on creature spells too', () => {
      battlefield.push({
        id: 'rhystic1',
        controller: 'player1',
        card: {
          name: 'Rhystic Study',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      });
      
      const event: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell1',
        spellName: 'Grizzly Bears',
        isCreature: true,
      };
      
      const triggers = detectSpellCastPayOrTriggers(battlefield, event, ['player1', 'player2']);
      
      expect(triggers.length).toBe(1);
    });
    
    it('should trigger for each opponent in multiplayer', () => {
      battlefield.push({
        id: 'rhystic1',
        controller: 'player1',
        card: {
          name: 'Rhystic Study',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      });
      
      // Player 3 casts a spell
      const event: SpellCastEvent = {
        casterId: 'player3',
        spellId: 'spell1',
        spellName: 'Sol Ring',
        isCreature: false,
      };
      
      const triggers = detectSpellCastPayOrTriggers(battlefield, event, ['player1', 'player2', 'player3', 'player4']);
      
      expect(triggers.length).toBe(1);
      expect(triggers[0].opponent).toBe('player3');
    });
  });
  
  describe('Smothering Tithe', () => {
    it('should trigger when opponent draws a card', () => {
      battlefield.push({
        id: 'tithe1',
        controller: 'player1',
        card: {
          name: 'Smothering Tithe',
          oracle_text: 'Whenever an opponent draws a card, you create a Treasure token unless that player pays {2}.',
        },
      });
      
      const event: DrawEvent = {
        playerId: 'player2',
        count: 1,
      };
      
      const triggers = detectDrawPayOrTriggers(battlefield, event, ['player1', 'player2']);
      
      expect(triggers.length).toBe(1);
      expect(triggers[0].type).toBe('smothering_tithe');
      expect(triggers[0].paymentCost).toBe('{2}');
    });
    
    it('should trigger multiple times for multiple cards drawn', () => {
      battlefield.push({
        id: 'tithe1',
        controller: 'player1',
        card: {
          name: 'Smothering Tithe',
          oracle_text: 'Whenever an opponent draws a card, you create a Treasure token unless that player pays {2}.',
        },
      });
      
      const event: DrawEvent = {
        playerId: 'player2',
        count: 3, // Drawing 3 cards
      };
      
      const triggers = detectDrawPayOrTriggers(battlefield, event, ['player1', 'player2']);
      
      expect(triggers.length).toBe(3); // 3 separate triggers
    });
    
    it('should NOT trigger when controller draws', () => {
      battlefield.push({
        id: 'tithe1',
        controller: 'player1',
        card: {
          name: 'Smothering Tithe',
          oracle_text: 'Whenever an opponent draws a card, you create a Treasure token unless that player pays {2}.',
        },
      });
      
      const event: DrawEvent = {
        playerId: 'player1', // Same as controller
        count: 1,
      };
      
      const triggers = detectDrawPayOrTriggers(battlefield, event, ['player1', 'player2']);
      
      expect(triggers.length).toBe(0);
    });
  });
  
  describe('Mystic Remora', () => {
    it('should trigger on noncreature spells only', () => {
      battlefield.push({
        id: 'remora1',
        controller: 'player1',
        card: {
          name: 'Mystic Remora',
          oracle_text: 'Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.',
        },
      });
      
      // Noncreature spell - should trigger
      const instantEvent: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell1',
        spellName: 'Lightning Bolt',
        isCreature: false,
      };
      
      const triggers1 = detectSpellCastPayOrTriggers(battlefield, instantEvent, ['player1', 'player2']);
      expect(triggers1.length).toBe(1);
      expect(triggers1[0].type).toBe('mystic_remora');
      
      // Creature spell - should NOT trigger
      const creatureEvent: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell2',
        spellName: 'Grizzly Bears',
        isCreature: true,
      };
      
      const triggers2 = detectSpellCastPayOrTriggers(battlefield, creatureEvent, ['player1', 'player2']);
      expect(triggers2.length).toBe(0);
    });
  });
  
  describe('Esper Sentinel', () => {
    it('should trigger on first noncreature spell each turn', () => {
      battlefield.push({
        id: 'sentinel1',
        controller: 'player1',
        card: {
          name: 'Esper Sentinel',
          oracle_text: 'Whenever an opponent casts their first noncreature spell each turn, you draw a card unless that player pays {X}, where X is Esper Sentinel\'s power.',
        },
      });
      
      // First noncreature spell - should trigger
      const firstSpell: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell1',
        spellName: 'Sol Ring',
        isCreature: false,
        isFirstNoncreatureThisTurn: true,
      };
      
      const triggers1 = detectSpellCastPayOrTriggers(battlefield, firstSpell, ['player1', 'player2']);
      expect(triggers1.length).toBe(1);
      expect(triggers1[0].type).toBe('esper_sentinel');
      
      // Second noncreature spell - should NOT trigger
      const secondSpell: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell2',
        spellName: 'Mana Crypt',
        isCreature: false,
        isFirstNoncreatureThisTurn: false,
      };
      
      const triggers2 = detectSpellCastPayOrTriggers(battlefield, secondSpell, ['player1', 'player2']);
      expect(triggers2.length).toBe(0);
    });
  });
  
  describe('Multiple triggers', () => {
    it('should detect all applicable triggers at once', () => {
      // Player 1 has Rhystic Study and Mystic Remora
      battlefield.push({
        id: 'rhystic1',
        controller: 'player1',
        card: {
          name: 'Rhystic Study',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      });
      battlefield.push({
        id: 'remora1',
        controller: 'player1',
        card: {
          name: 'Mystic Remora',
          oracle_text: 'Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.',
        },
      });
      
      // Opponent casts a noncreature spell - both should trigger
      const event: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell1',
        spellName: 'Sol Ring',
        isCreature: false,
      };
      
      const triggers = detectSpellCastPayOrTriggers(battlefield, event, ['player1', 'player2']);
      
      expect(triggers.length).toBe(2);
      expect(triggers.some(t => t.type === 'rhystic_study')).toBe(true);
      expect(triggers.some(t => t.type === 'mystic_remora')).toBe(true);
    });
    
    it('should handle multiple players with triggers', () => {
      // Player 1 has Rhystic Study
      battlefield.push({
        id: 'rhystic1',
        controller: 'player1',
        card: {
          name: 'Rhystic Study',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      });
      // Player 3 also has Rhystic Study
      battlefield.push({
        id: 'rhystic2',
        controller: 'player3',
        card: {
          name: 'Rhystic Study',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      });
      
      // Player 2 casts a spell - both Rhystic Studies trigger
      const event: SpellCastEvent = {
        casterId: 'player2',
        spellId: 'spell1',
        spellName: 'Lightning Bolt',
        isCreature: false,
      };
      
      const triggers = detectSpellCastPayOrTriggers(battlefield, event, ['player1', 'player2', 'player3', 'player4']);
      
      expect(triggers.length).toBe(2);
      expect(triggers.filter(t => t.controller === 'player1').length).toBe(1);
      expect(triggers.filter(t => t.controller === 'player3').length).toBe(1);
    });
  });
});
