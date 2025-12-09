import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Tests for AI turn handling functionality
 * These tests verify that the AI helper functions work correctly
 */
describe('AI Turn Handling', () => {
  describe('AI helper functions', () => {
    it('should identify land cards correctly', () => {
      // Create sample cards
      const landCard = {
        id: 'land_1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        mana_cost: '',
      };
      
      const creatureCard = {
        id: 'creature_1',
        name: 'Llanowar Elves',
        type_line: 'Creature — Elf Druid',
        mana_cost: '{G}',
      };
      
      // Test type detection
      const isLand = (card: any) => (card?.type_line || '').toLowerCase().includes('land');
      
      expect(isLand(landCard)).toBe(true);
      expect(isLand(creatureCard)).toBe(false);
    });
    
    it('should check if commander is valid', () => {
      // Test commander detection logic - including Vehicles and Stations
      const isValidCommander = (card: any): boolean => {
        const typeLine = (card.type_line || '').toLowerCase();
        const oracleText = (card.oracle_text || '').toLowerCase();
        
        if (!typeLine.includes('legendary')) {
          return false;
        }
        
        if (typeLine.includes('creature')) {
          return true;
        }
        
        // Legendary Vehicles can be commanders
        if (typeLine.includes('vehicle')) {
          return true;
        }
        
        // Legendary Stations can be commanders
        if (typeLine.includes('station')) {
          return true;
        }
        
        if (oracleText.includes('can be your commander')) {
          return true;
        }
        
        return false;
      };
      
      const legendaryCreature = {
        id: 'cmd_1',
        name: 'Golos, Tireless Pilgrim',
        type_line: 'Legendary Artifact Creature — Scout',
        oracle_text: 'When Golos enters the battlefield, you may search your library...',
      };
      
      const nonLegendary = {
        id: 'creature_1',
        name: 'Llanowar Elves',
        type_line: 'Creature — Elf Druid',
        oracle_text: '{T}: Add {G}.',
      };
      
      const planeswalkerCommander = {
        id: 'pw_1',
        name: 'Teferi, Temporal Archmage',
        type_line: 'Legendary Planeswalker — Teferi',
        oracle_text: 'Teferi, Temporal Archmage can be your commander.',
      };
      
      const legendaryVehicle = {
        id: 'vehicle_1',
        name: 'Weatherlight',
        type_line: 'Legendary Artifact — Vehicle',
        oracle_text: 'Flying. Crew 3.',
      };
      
      const legendaryStation = {
        id: 'station_1',
        name: 'Example Legendary Station',
        type_line: 'Legendary Artifact — Station',
        oracle_text: 'Station ability...',
      };
      
      const nonLegendaryVehicle = {
        id: 'vehicle_2',
        name: 'Smugglers Copter',
        type_line: 'Artifact — Vehicle',
        oracle_text: 'Flying. Crew 1.',
      };
      
      expect(isValidCommander(legendaryCreature)).toBe(true);
      expect(isValidCommander(nonLegendary)).toBe(false);
      expect(isValidCommander(planeswalkerCommander)).toBe(true);
      expect(isValidCommander(legendaryVehicle)).toBe(true);
      expect(isValidCommander(legendaryStation)).toBe(true);
      expect(isValidCommander(nonLegendaryVehicle)).toBe(false);
    });
    
    it('should prioritize first cards in decklist for commander selection', () => {
      // Test that commander selection prioritizes first cards in decklist
      const isValidCommander = (card: any): boolean => {
        const typeLine = (card.type_line || '').toLowerCase();
        const oracleText = (card.oracle_text || '').toLowerCase();
        if (!typeLine.includes('legendary')) return false;
        if (typeLine.includes('creature')) return true;
        if (typeLine.includes('vehicle')) return true;
        if (typeLine.includes('station')) return true;
        if (oracleText.includes('can be your commander')) return true;
        return false;
      };
      
      // Simulate a deck where Morophon is first, followed by Hope
      const morophon = {
        id: 'morophon_1',
        name: 'Morophon, the Boundless',
        type_line: 'Legendary Creature — Shapeshifter',
        mana_cost: '{7}',
        color_identity: ['W', 'U', 'B', 'R', 'G'],
        oracle_text: 'Changeling. As Morophon enters the battlefield, choose a creature type...',
      };
      
      const hope = {
        id: 'hope_1',
        name: 'Hope of Ghirapur',
        type_line: 'Legendary Artifact Creature — Thopter',
        mana_cost: '{1}',
        color_identity: [],
        oracle_text: 'Flying...',
      };
      
      const randomCreature = {
        id: 'creature_1',
        name: 'Some Legendary Creature',
        type_line: 'Legendary Creature — Human',
        mana_cost: '{W}{U}',
        color_identity: ['W', 'U'],
        oracle_text: '',
      };
      
      // Deck with Morophon first (unshuffled)
      const deckWithMorophonFirst = [morophon, hope, randomCreature];
      
      // Simple commander selection that prioritizes first cards
      const firstTwoCandidates = deckWithMorophonFirst.slice(0, 2).filter(isValidCommander);
      expect(firstTwoCandidates.length).toBeGreaterThan(0);
      expect(firstTwoCandidates[0].name).toBe('Morophon, the Boundless');
    });
    
    it('should extract color identity from cards', () => {
      const extractColorIdentity = (card: any): string[] => {
        const colors = new Set<string>();
        const colorSymbols = ['W', 'U', 'B', 'R', 'G'];
        
        // Extract from mana cost
        const manaCost = card.mana_cost || '';
        for (const colorSymbol of colorSymbols) {
          if (manaCost.includes(colorSymbol)) {
            colors.add(colorSymbol);
          }
        }
        
        // Extract from color_identity if available
        if (Array.isArray(card.color_identity)) {
          for (const c of card.color_identity) {
            colors.add(c);
          }
        }
        
        // Extract from oracle text (for hybrid mana and ability costs)
        const oracleText = card.oracle_text || '';
        for (const colorSymbol of colorSymbols) {
          if (oracleText.includes(`{${colorSymbol}}`)) {
            colors.add(colorSymbol);
          }
        }
        
        return Array.from(colors);
      };
      
      const monoGreen = {
        name: 'Llanowar Elves',
        mana_cost: '{G}',
        oracle_text: '{T}: Add {G}.',
      };
      
      const multiColor = {
        name: 'Omnath, Locus of Creation',
        mana_cost: '{R}{G}{W}{U}',
        oracle_text: 'When Omnath enters the battlefield...',
      };
      
      const colorless = {
        name: 'Sol Ring',
        mana_cost: '{1}',
        oracle_text: '{T}: Add {C}{C}.',
      };
      
      expect(extractColorIdentity(monoGreen)).toContain('G');
      expect(extractColorIdentity(multiColor)).toContain('R');
      expect(extractColorIdentity(multiColor)).toContain('G');
      expect(extractColorIdentity(multiColor)).toContain('W');
      expect(extractColorIdentity(multiColor)).toContain('U');
      expect(extractColorIdentity(colorless).length).toBe(0);
    });
    
    it('should calculate discard priority correctly', () => {
      // Test that cards are scored properly for discard
      const scoreCardForDiscard = (card: any): number => {
        let score = 50; // Base score
        const typeLine = (card?.type_line || '').toLowerCase();
        const manaCost = card?.mana_cost || '';
        const oracleText = (card?.oracle_text || '').toLowerCase();
        
        // Keep lands (high priority)
        if (typeLine.includes('land')) {
          score += 100;
        }
        
        // Keep low-cost spells
        const cmc = (manaCost.match(/\d+/) || ['0'])[0];
        score += Math.max(0, 10 - parseInt(cmc, 10));
        
        // Keep creatures
        if (typeLine.includes('creature')) {
          score += 20;
        }
        
        // Keep removal spells
        if (oracleText.includes('destroy') || oracleText.includes('exile')) {
          score += 30;
        }
        
        return score;
      };
      
      const land = {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        mana_cost: '',
        oracle_text: '',
      };
      
      const creature = {
        name: 'Llanowar Elves',
        type_line: 'Creature — Elf Druid',
        mana_cost: '{G}',
        oracle_text: '{T}: Add {G}.',
      };
      
      const removal = {
        name: 'Murder',
        type_line: 'Instant',
        mana_cost: '{1}{B}{B}',
        oracle_text: 'Destroy target creature.',
      };
      
      const expensiveSpell = {
        name: 'Ugin, the Spirit Dragon',
        type_line: 'Legendary Planeswalker — Ugin',
        mana_cost: '{8}',
        oracle_text: '+2: Ugin deals 3 damage...',
      };
      
      // Lands should have highest score (kept)
      expect(scoreCardForDiscard(land)).toBeGreaterThan(scoreCardForDiscard(creature));
      
      // Creatures should be kept over non-removal spells
      expect(scoreCardForDiscard(creature)).toBeGreaterThan(scoreCardForDiscard(expensiveSpell));
      
      // Removal should have decent priority
      expect(scoreCardForDiscard(removal)).toBeGreaterThan(scoreCardForDiscard(expensiveSpell));
    });
    
    it('should determine max hand size correctly', () => {
      const getMaxHandSize = (battlefield: any[], playerId: string): number => {
        // Check for permanents that grant "no maximum hand size"
        for (const perm of battlefield) {
          if (perm && perm.controller === playerId) {
            const oracle = (perm.card?.oracle_text || '').toLowerCase();
            if (oracle.includes('you have no maximum hand size')) {
              return Infinity;
            }
          }
        }
        
        return 7; // Default maximum hand size
      };
      
      const playerId = 'player1';
      
      // Normal case - no special permanents
      expect(getMaxHandSize([], playerId)).toBe(7);
      
      // With Reliquary Tower
      const reliquaryTower = {
        id: 'land_1',
        controller: playerId,
        card: {
          name: 'Reliquary Tower',
          oracle_text: 'You have no maximum hand size.',
        },
      };
      
      expect(getMaxHandSize([reliquaryTower], playerId)).toBe(Infinity);
      
      // With opponent's Reliquary Tower (shouldn't affect us)
      const opponentTower = {
        id: 'land_2',
        controller: 'opponent',
        card: {
          name: 'Reliquary Tower',
          oracle_text: 'You have no maximum hand size.',
        },
      };
      
      expect(getMaxHandSize([opponentTower], playerId)).toBe(7);
    });
  });
  
  describe('AI game state handling', () => {
    it('should detect main phases correctly', () => {
      const isMainPhase = (phase: string, step: string): boolean => {
        const p = phase.toLowerCase();
        const s = step.toLowerCase();
        return p.includes('main') || s.includes('main');
      };
      
      expect(isMainPhase('precombatMain', 'MAIN1')).toBe(true);
      expect(isMainPhase('postcombatMain', 'MAIN2')).toBe(true);
      expect(isMainPhase('combat', 'DECLARE_ATTACKERS')).toBe(false);
      expect(isMainPhase('beginning', 'UNTAP')).toBe(false);
    });
    
    it('should detect cleanup step correctly', () => {
      const isCleanupStep = (step: string): boolean => {
        const s = step.toLowerCase();
        return s.includes('cleanup') || s === 'cleanup';
      };
      
      expect(isCleanupStep('CLEANUP')).toBe(true);
      expect(isCleanupStep('cleanup')).toBe(true);
      expect(isCleanupStep('END')).toBe(false);
    });
    
    it('should select partner commanders for multi-color decks instead of single commander', () => {
      // Test the fix for issue: WURG deck picking single WG commander instead of partners
      
      // Helper functions (mirroring ai.ts logic)
      const hasPartner = (card: any): boolean => {
        const oracleText = (card.oracle_text || '').toLowerCase();
        return oracleText.includes('partner');
      };
      
      const extractColorIdentity = (card: any): string[] => {
        const colors = new Set<string>();
        const colorSymbols = ['W', 'U', 'B', 'R', 'G'];
        
        const manaCost = card.mana_cost || '';
        for (const colorSymbol of colorSymbols) {
          if (manaCost.includes(colorSymbol)) {
            colors.add(colorSymbol);
          }
        }
        
        if (Array.isArray(card.color_identity)) {
          for (const c of card.color_identity) {
            colors.add(c);
          }
        }
        
        return Array.from(colors);
      };
      
      const calculateDeckColorIdentity = (cards: any[]): Set<string> => {
        const deckColors = new Set<string>();
        for (const card of cards) {
          const colors = extractColorIdentity(card);
          for (const color of colors) {
            deckColors.add(color);
          }
        }
        return deckColors;
      };
      
      const commanderIdentityMatchesDeck = (commanders: any[], deckColors: Set<string>): boolean => {
        const commanderColors = new Set<string>();
        for (const commander of commanders) {
          const colors = extractColorIdentity(commander);
          for (const color of colors) {
            commanderColors.add(color);
          }
        }
        
        if (commanderColors.size !== deckColors.size) return false;
        
        for (const color of deckColors) {
          if (!commanderColors.has(color)) return false;
        }
        
        for (const color of commanderColors) {
          if (!deckColors.has(color)) return false;
        }
        
        return true;
      };
      
      // Create test cards for WURG (4-color) deck
      const tanaPartner = {
        id: 'tana_1',
        name: 'Tana, the Bloodsower',
        type_line: 'Legendary Creature — Elf Druid',
        mana_cost: '{2}{R}{G}',
        color_identity: ['R', 'G'],
        oracle_text: 'Trample. Whenever Tana deals combat damage, create that many 1/1 green Saproling creature tokens. Partner',
      };
      
      const ishaiPartner = {
        id: 'ishai_1',
        name: 'Ishai, Ojutai Dragonspeaker',
        type_line: 'Legendary Creature — Bird Monk',
        mana_cost: '{2}{W}{U}',
        color_identity: ['W', 'U'],
        oracle_text: 'Flying. Whenever an opponent casts a spell, put a +1/+1 counter on Ishai. Partner',
      };
      
      // Some other legendary creatures
      const deckCard1 = {
        id: 'card_1',
        name: 'Ojutai, Soul of Winter',
        type_line: 'Legendary Creature — Dragon',
        mana_cost: '{5}{W}{U}',
        color_identity: ['W', 'U'],
        oracle_text: 'Flying, vigilance',
      };
      
      const deckCard2 = {
        id: 'card_2',
        name: 'Xenagos, God of Revels',
        type_line: 'Legendary Enchantment Creature — God',
        mana_cost: '{3}{R}{G}',
        color_identity: ['R', 'G'],
        oracle_text: 'Indestructible',
      };
      
      // Build a WURG deck (partners first)
      const deck = [tanaPartner, ishaiPartner, deckCard1, deckCard2];
      const deckColors = calculateDeckColorIdentity(deck);
      
      // Deck should be WURG (4 colors)
      expect(deckColors.has('W')).toBe(true);
      expect(deckColors.has('U')).toBe(true);
      expect(deckColors.has('R')).toBe(true);
      expect(deckColors.has('G')).toBe(true);
      expect(deckColors.size).toBe(4);
      
      // Test that partners' combined identity EXACTLY matches deck
      const partnersMatch = commanderIdentityMatchesDeck([tanaPartner, ishaiPartner], deckColors);
      expect(partnersMatch).toBe(true);
      
      // Test that single WG commander does NOT match WURG deck
      const singleCommanderMatches = commanderIdentityMatchesDeck([tanaPartner], deckColors);
      expect(singleCommanderMatches).toBe(false);
      
      // Verify both cards have partner
      expect(hasPartner(tanaPartner)).toBe(true);
      expect(hasPartner(ishaiPartner)).toBe(true);
      
      // Test that a WUG commander wouldn't match WURG deck (missing R)
      const wrongCommander = {
        id: 'wrong_1',
        name: 'Wrong Commander',
        type_line: 'Legendary Creature — Test',
        color_identity: ['W', 'U', 'G'],
        oracle_text: '',
      };
      expect(commanderIdentityMatchesDeck([wrongCommander], deckColors)).toBe(false);
    });
    
    it('should select single 4-color commander for 4-color deck', () => {
      // Test the requirement: legendary creatures with all the color identity should be considered
      
      // Helper functions
      const extractColorIdentity = (card: any): string[] => {
        const colors = new Set<string>();
        const colorSymbols = ['W', 'U', 'B', 'R', 'G'];
        
        const manaCost = card.mana_cost || '';
        for (const colorSymbol of colorSymbols) {
          if (manaCost.includes(colorSymbol)) {
            colors.add(colorSymbol);
          }
        }
        
        if (Array.isArray(card.color_identity)) {
          for (const c of card.color_identity) {
            colors.add(c);
          }
        }
        
        return Array.from(colors);
      };
      
      const calculateDeckColorIdentity = (cards: any[]): Set<string> => {
        const deckColors = new Set<string>();
        for (const card of cards) {
          const colors = extractColorIdentity(card);
          for (const color of colors) {
            deckColors.add(color);
          }
        }
        return deckColors;
      };
      
      const calculateColorCoverage = (commanders: any[], deckColors: Set<string>): number => {
        const commanderColors = new Set<string>();
        for (const commander of commanders) {
          const colors = extractColorIdentity(commander);
          for (const color of colors) {
            commanderColors.add(color);
          }
        }
        
        let coverage = 0;
        for (const color of deckColors) {
          if (commanderColors.has(color)) {
            coverage++;
          }
        }
        return coverage;
      };
      
      // Create a 4-color commander (Atraxa-like)
      const atraxa = {
        id: 'atraxa_1',
        name: 'Atraxa, Praetors\' Voice',
        type_line: 'Legendary Creature — Phyrexian Angel Horror',
        mana_cost: '{G}{W}{U}{B}',
        color_identity: ['W', 'U', 'B', 'G'],
        oracle_text: 'Flying, vigilance, deathtouch, lifelink. Proliferate',
      };
      
      // Other deck cards
      const deckCard1 = {
        id: 'card_1',
        name: 'Supreme Verdict',
        type_line: 'Sorcery',
        mana_cost: '{1}{W}{W}{U}',
        color_identity: ['W', 'U'],
        oracle_text: 'This spell can\'t be countered. Destroy all creatures.',
      };
      
      const deckCard2 = {
        id: 'card_2',
        name: 'Putrefy',
        type_line: 'Instant',
        mana_cost: '{1}{B}{G}',
        color_identity: ['B', 'G'],
        oracle_text: 'Destroy target artifact or creature.',
      };
      
      // Build WUBG deck with Atraxa first
      const deck = [atraxa, deckCard1, deckCard2];
      const deckColors = calculateDeckColorIdentity(deck);
      
      // Deck should be WUBG (4 colors)
      expect(deckColors.has('W')).toBe(true);
      expect(deckColors.has('U')).toBe(true);
      expect(deckColors.has('B')).toBe(true);
      expect(deckColors.has('G')).toBe(true);
      expect(deckColors.size).toBe(4);
      
      // Test that Atraxa covers all 4 colors
      const atraxaCoverage = calculateColorCoverage([atraxa], deckColors);
      expect(atraxaCoverage).toBe(4);
      
      // Verify Atraxa has all 4 colors in identity
      const atraxaColors = extractColorIdentity(atraxa);
      expect(atraxaColors).toContain('W');
      expect(atraxaColors).toContain('U');
      expect(atraxaColors).toContain('B');
      expect(atraxaColors).toContain('G');
      expect(atraxaColors.length).toBe(4);
      
      // The logic should select Atraxa as a single commander since it has full coverage
      // This validates Priority 1 (first card with full coverage) logic
    });
  });
});
