/**
 * Tests for emblem support module
 */
import { describe, it, expect } from 'vitest';
import {
  createEmblem,
  createEmblemFromPlaneswalker,
  createCustomEmblem,
  emblemHasAbility,
  isTriggeredEmblem,
  isStaticEmblem,
  getPlayerEmblems,
  parseEmblemAbility,
  getAvailableEmblemNames,
  getEmblemSpec,
  COMMON_EMBLEMS,
} from '../src/emblemSupport';

describe('Emblem Support', () => {
  describe('createEmblem', () => {
    it('should create an emblem with specified abilities', () => {
      const result = createEmblem('player1', {
        name: 'Test Emblem',
        abilities: ['You have hexproof.'],
        createdBy: 'Test Planeswalker',
      });
      
      expect(result.emblem.name).toBe('Test Emblem');
      expect(result.emblem.owner).toBe('player1');
      expect(result.emblem.controller).toBe('player1');
      expect(result.emblem.abilities).toContain('You have hexproof.');
      expect(result.emblem.createdBy).toBe('Test Planeswalker');
      expect(result.emblem.id).toMatch(/^emblem-/);
      expect(result.log.length).toBeGreaterThan(0);
    });
  });

  describe('createEmblemFromPlaneswalker', () => {
    it('should create Elspeth emblem', () => {
      const result = createEmblemFromPlaneswalker('player1', 'Elspeth, Knight-Errant');
      
      expect(result).not.toBeNull();
      expect(result!.emblem.name).toBe("Elspeth's Emblem");
      expect(result!.emblem.abilities[0]).toContain('indestructible');
    });

    it('should create Venser emblem', () => {
      const result = createEmblemFromPlaneswalker('player1', 'Venser, the Sojourner');
      
      expect(result).not.toBeNull();
      expect(result!.emblem.abilities[0]).toContain('Whenever you cast a spell');
    });

    it('should return null for unknown planeswalker', () => {
      const result = createEmblemFromPlaneswalker('player1', 'Unknown Planeswalker');
      
      expect(result).toBeNull();
    });
  });

  describe('createCustomEmblem', () => {
    it('should create a custom emblem', () => {
      const result = createCustomEmblem(
        'player1',
        'Custom Emblem',
        ['Draw a card.', 'Gain 1 life.'],
        'Custom Source',
        'source-123'
      );
      
      expect(result.emblem.name).toBe('Custom Emblem');
      expect(result.emblem.abilities).toHaveLength(2);
      expect(result.emblem.createdBy).toBe('Custom Source');
      expect(result.emblem.sourceId).toBe('source-123');
    });
  });

  describe('emblemHasAbility', () => {
    it('should find ability text in emblem', () => {
      const result = createEmblemFromPlaneswalker('player1', 'Elspeth, Knight-Errant');
      const emblem = result!.emblem;
      
      expect(emblemHasAbility(emblem, 'indestructible')).toBe(true);
      expect(emblemHasAbility(emblem, 'artifacts')).toBe(true);
      expect(emblemHasAbility(emblem, 'flying')).toBe(false);
    });
  });

  describe('isTriggeredEmblem', () => {
    it('should identify triggered emblems', () => {
      const venserEmblem = createEmblemFromPlaneswalker('player1', 'Venser, the Sojourner')!.emblem;
      const chandraEmblem = createEmblemFromPlaneswalker('player1', 'Chandra, Torch of Defiance')!.emblem;
      
      expect(isTriggeredEmblem(venserEmblem)).toBe(true);
      expect(isTriggeredEmblem(chandraEmblem)).toBe(true);
    });

    it('should identify static emblems', () => {
      const elspethEmblem = createEmblemFromPlaneswalker('player1', 'Elspeth, Knight-Errant')!.emblem;
      const narsetEmblem = createEmblemFromPlaneswalker('player1', 'Narset Transcendent')!.emblem;
      
      expect(isTriggeredEmblem(elspethEmblem)).toBe(false);
      expect(isTriggeredEmblem(narsetEmblem)).toBe(false);
    });
  });

  describe('isStaticEmblem', () => {
    it('should be opposite of isTriggeredEmblem', () => {
      const elspethEmblem = createEmblemFromPlaneswalker('player1', 'Elspeth, Knight-Errant')!.emblem;
      const venserEmblem = createEmblemFromPlaneswalker('player1', 'Venser, the Sojourner')!.emblem;
      
      expect(isStaticEmblem(elspethEmblem)).toBe(true);
      expect(isStaticEmblem(venserEmblem)).toBe(false);
    });
  });

  describe('getPlayerEmblems', () => {
    it('should filter emblems by controller', () => {
      const emblem1 = createEmblem('player1', { name: 'E1', abilities: ['A1'] }).emblem;
      const emblem2 = createEmblem('player2', { name: 'E2', abilities: ['A2'] }).emblem;
      const emblem3 = createEmblem('player1', { name: 'E3', abilities: ['A3'] }).emblem;
      
      const allEmblems = [emblem1, emblem2, emblem3];
      const player1Emblems = getPlayerEmblems(allEmblems, 'player1');
      
      expect(player1Emblems).toHaveLength(2);
      expect(player1Emblems.map(e => e.name)).toContain('E1');
      expect(player1Emblems.map(e => e.name)).toContain('E3');
    });
  });

  describe('parseEmblemAbility', () => {
    it('should parse triggered abilities', () => {
      const result = parseEmblemAbility('Whenever you cast a spell, exile target permanent.');
      
      expect(result.isTriggered).toBe(true);
      expect(result.isStatic).toBe(false);
      expect(result.triggerCondition).toBe('you cast a spell');
      expect(result.effect).toBe('exile target permanent.');
    });

    it('should parse "at" triggered abilities', () => {
      const result = parseEmblemAbility('At the beginning of your end step, create a 9/9 blue Kraken creature token.');
      
      expect(result.isTriggered).toBe(true);
      expect(result.triggerCondition).toBe('the beginning of your end step');
    });

    it('should parse static abilities', () => {
      const result = parseEmblemAbility('Artifacts, creatures, enchantments, and lands you control have indestructible.');
      
      expect(result.isTriggered).toBe(false);
      expect(result.isStatic).toBe(true);
      expect(result.effect).toBe('Artifacts, creatures, enchantments, and lands you control have indestructible.');
    });
  });

  describe('getAvailableEmblemNames', () => {
    it('should return list of planeswalker names', () => {
      const names = getAvailableEmblemNames();
      
      expect(names.length).toBeGreaterThan(10);
      expect(names).toContain('Elspeth, Knight-Errant');
      expect(names).toContain('Venser, the Sojourner');
    });
  });

  describe('getEmblemSpec', () => {
    it('should return emblem spec for known planeswalker', () => {
      const spec = getEmblemSpec('Jace, Unraveler of Secrets');
      
      expect(spec).not.toBeUndefined();
      expect(spec!.name).toBe("Jace's Emblem");
      expect(spec!.abilities[0]).toContain('counter that spell');
    });

    it('should return undefined for unknown planeswalker', () => {
      const spec = getEmblemSpec('Unknown Planeswalker');
      
      expect(spec).toBeUndefined();
    });
  });

  describe('COMMON_EMBLEMS', () => {
    it('should have Teferi emblem', () => {
      const teferi = COMMON_EMBLEMS['Teferi, Hero of Dominaria'];
      
      expect(teferi).toBeDefined();
      expect(teferi.abilities[0]).toContain('Whenever you draw a card');
    });

    it('should have Gideon emblem', () => {
      const gideon = COMMON_EMBLEMS['Gideon of the Trials'];
      
      expect(gideon).toBeDefined();
      expect(gideon.abilities[0]).toContain("can't lose the game");
    });

    it('should have The Ring emblem', () => {
      const ring = COMMON_EMBLEMS['The Ring'];
      
      expect(ring).toBeDefined();
      expect(ring.abilities.length).toBe(4);
    });
  });
});
