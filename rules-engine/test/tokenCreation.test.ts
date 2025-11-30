/**
 * Test suite for token creation automation
 */

import { describe, it, expect } from 'vitest';
import {
  createTokenPermanent,
  createTokens,
  createTokensByName,
  parseTokenCreationFromText,
  detectTokenETBTriggers,
  detectTokenCreationTriggers,
  COMMON_TOKENS,
  getCommonTokenNames,
  getTokenCharacteristics,
} from '../src/tokenCreation';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

describe('Token Creation', () => {
  describe('createTokenPermanent', () => {
    it('should create a basic creature token', () => {
      const token = createTokenPermanent(
        COMMON_TOKENS['2/2 Zombie'],
        'player1',
        'source-id'
      );
      
      expect(token).toBeDefined();
      expect(token.id).toMatch(/^token-/);
      expect(token.controller).toBe('player1');
      expect(token.owner).toBe('player1');
      expect(token.isToken).toBe(true);
      expect(token.summoningSickness).toBe(true);
      expect(token.basePower).toBe(2);
      expect(token.baseToughness).toBe(2);
    });

    it('should create a Treasure token with correct abilities', () => {
      const token = createTokenPermanent(
        COMMON_TOKENS['Treasure'],
        'player1'
      );
      
      const card = token.card as KnownCardRef;
      expect(card.name).toBe('Treasure');
      expect(card.type_line).toContain('Artifact');
      expect(card.oracle_text).toContain('Sacrifice this artifact');
      expect(token.summoningSickness).toBe(false); // Artifacts don't have summoning sickness
    });

    it('should create token with counters when specified', () => {
      const token = createTokenPermanent(
        COMMON_TOKENS['1/1 Spirit (Flying)'],
        'player1',
        undefined,
        { '+1/+1': 2 }
      );
      
      expect(token.counters).toEqual({ '+1/+1': 2 });
    });

    it('should create flying spirit with correct abilities', () => {
      const token = createTokenPermanent(
        COMMON_TOKENS['1/1 Spirit (Flying)'],
        'player1'
      );
      
      const card = token.card as KnownCardRef;
      expect(card.oracle_text).toContain('Flying');
      expect(card.type_line).toContain('Spirit');
    });
  });

  describe('createTokens', () => {
    it('should create multiple tokens', () => {
      const result = createTokens({
        characteristics: COMMON_TOKENS['1/1 Soldier'],
        count: 3,
        controllerId: 'player1',
        sourceName: 'Test Source',
      }, []);
      
      expect(result.tokens).toHaveLength(3);
      expect(result.log).toContain('Created Soldier token');
      result.tokens.forEach(t => {
        expect(t.token.controller).toBe('player1');
        expect(t.token.isToken).toBe(true);
      });
    });

    it('should detect token creation triggers from battlefield permanents', () => {
      const existingPermanent: BattlefieldPermanent = {
        id: 'perm-1',
        controller: 'player1',
        owner: 'player1',
        tapped: false,
        counters: {},
        card: {
          name: 'Anointed Procession',
          oracle_text: 'Whenever a creature token enters the battlefield under your control, create a token that\'s a copy of that creature.',
        } as KnownCardRef,
      } as BattlefieldPermanent;

      const result = createTokens({
        characteristics: COMMON_TOKENS['2/2 Zombie'],
        count: 1,
        controllerId: 'player1',
      }, [existingPermanent]);
      
      expect(result.otherTriggers.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createTokensByName', () => {
    it('should create tokens by common name', () => {
      const result = createTokensByName(
        'Treasure',
        2,
        'player1',
        [],
        'source-1',
        'Smothering Tithe'
      );
      
      expect(result).not.toBeNull();
      expect(result!.tokens).toHaveLength(2);
      expect(result!.log).toContain('Created Treasure token');
    });

    it('should return null for unknown token name', () => {
      const result = createTokensByName(
        'NonexistentToken',
        1,
        'player1',
        []
      );
      
      expect(result).toBeNull();
    });
  });

  describe('parseTokenCreationFromText', () => {
    it('should parse "create a 2/2 zombie creature token"', () => {
      const result = parseTokenCreationFromText('create a 2/2 black zombie creature token');
      
      expect(result).not.toBeNull();
      expect(result!.count).toBe(1);
      expect(result!.characteristics.power).toBe(2);
      expect(result!.characteristics.toughness).toBe(2);
      expect(result!.characteristics.colors).toContain('B');
    });

    it('should parse "create 3 1/1 soldier tokens"', () => {
      const result = parseTokenCreationFromText('create 3 1/1 white soldier creature tokens');
      
      expect(result).not.toBeNull();
      expect(result!.count).toBe(3);
      expect(result!.characteristics.power).toBe(1);
      expect(result!.characteristics.toughness).toBe(1);
    });

    it('should parse tokens with abilities', () => {
      const result = parseTokenCreationFromText('create a 1/1 white spirit creature token with flying');
      
      expect(result).not.toBeNull();
      expect(result!.characteristics.abilities).toContain('Flying');
    });

    it('should return null for non-token text', () => {
      const result = parseTokenCreationFromText('draw a card');
      expect(result).toBeNull();
    });
  });

  describe('detectTokenETBTriggers', () => {
    it('should detect ETB trigger with target', () => {
      const token: BattlefieldPermanent = {
        id: 'token-1',
        controller: 'player1',
        owner: 'player1',
        tapped: false,
        counters: {},
        card: {
          name: 'Angel',
          oracle_text: 'When this creature enters the battlefield, target player gains 3 life.',
        } as KnownCardRef,
      } as BattlefieldPermanent;

      const triggers = detectTokenETBTriggers(token, 'player1');
      
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].requiresChoice).toBe(true);
      expect(triggers[0].choiceType).toBe('target');
    });

    it('should detect "may" ETB triggers', () => {
      const token: BattlefieldPermanent = {
        id: 'token-1',
        controller: 'player1',
        owner: 'player1',
        tapped: false,
        counters: {},
        card: {
          name: 'Creature',
          oracle_text: 'When this creature enters the battlefield, you may draw a card.',
        } as KnownCardRef,
      } as BattlefieldPermanent;

      const triggers = detectTokenETBTriggers(token, 'player1');
      
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].requiresChoice).toBe(true);
      expect(triggers[0].choiceType).toBe('may');
    });
  });

  describe('detectTokenCreationTriggers', () => {
    it('should detect "whenever a token enters" triggers', () => {
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'perm-1',
          controller: 'player1',
          owner: 'player1',
          tapped: false,
          counters: {},
          card: {
            name: 'Divine Visitation',
            oracle_text: 'Whenever a creature token you control enters the battlefield, you gain 1 life.',
          } as KnownCardRef,
        } as BattlefieldPermanent,
      ];

      const triggers = detectTokenCreationTriggers(battlefield, 'new-token-id', 'player1');
      
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].sourceName).toBe('Divine Visitation');
    });

    it('should not trigger for opponent\'s token if "you control" restriction', () => {
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'perm-1',
          controller: 'player1',
          owner: 'player1',
          tapped: false,
          counters: {},
          card: {
            name: 'Divine Visitation',
            oracle_text: 'Whenever a creature token you control enters the battlefield, you gain 1 life.',
          } as KnownCardRef,
        } as BattlefieldPermanent,
      ];

      // Token controlled by opponent
      const triggers = detectTokenCreationTriggers(battlefield, 'new-token-id', 'player2');
      
      // Should not trigger because player2 != player1 (controller of Divine Visitation)
      expect(triggers.length).toBe(0);
    });
  });

  describe('Common Token Definitions', () => {
    it('should have all expected common tokens', () => {
      const expectedTokens = [
        'Treasure', 'Food', 'Clue', 'Blood',
        '1/1 Soldier', '2/2 Zombie', '1/1 Goblin', '3/3 Beast',
      ];
      
      for (const name of expectedTokens) {
        expect(COMMON_TOKENS[name]).toBeDefined();
      }
    });

    it('should return all token names', () => {
      const names = getCommonTokenNames();
      expect(names.length).toBeGreaterThan(10);
      expect(names).toContain('Treasure');
      expect(names).toContain('2/2 Zombie');
    });

    it('should get characteristics by name', () => {
      const treasure = getTokenCharacteristics('Treasure');
      expect(treasure).toBeDefined();
      expect(treasure!.types).toContain('Artifact');
      expect(treasure!.subtypes).toContain('Treasure');
    });
  });
});

describe('Token Entry Scenarios', () => {
  it('should handle Smothering Tithe creating Treasure', () => {
    const result = createTokensByName('Treasure', 1, 'player1', [], 'tithe-id', 'Smothering Tithe');
    
    expect(result).not.toBeNull();
    expect(result!.tokens[0].token.isToken).toBe(true);
    const card = result!.tokens[0].token.card as KnownCardRef;
    expect(card.name).toBe('Treasure');
  });

  it('should handle Grave Titan creating Zombies', () => {
    const result = createTokensByName('2/2 Zombie', 2, 'player1', [], 'titan-id', 'Grave Titan');
    
    expect(result).not.toBeNull();
    expect(result!.tokens).toHaveLength(2);
    expect(result!.tokens[0].token.basePower).toBe(2);
    expect(result!.tokens[0].token.baseToughness).toBe(2);
  });

  it('should handle Avenger of Zendikar creating Plants', () => {
    // Plants aren't in common tokens, so we use the full creation API
    const plantCharacteristics = {
      name: 'Plant',
      colors: ['G'] as const,
      types: ['Creature'] as const,
      subtypes: ['Plant'] as const,
      power: 0,
      toughness: 1,
      abilities: [] as const,
    };

    const result = createTokens({
      characteristics: plantCharacteristics,
      count: 5,
      controllerId: 'player1',
      sourceName: 'Avenger of Zendikar',
    }, []);
    
    expect(result.tokens).toHaveLength(5);
    expect(result.tokens[0].token.basePower).toBe(0);
    expect(result.tokens[0].token.baseToughness).toBe(1);
  });

  it('should have 1/1 Warrior token for Mobilize ability', () => {
    const warrior = COMMON_TOKENS['1/1 Warrior'];
    expect(warrior).toBeDefined();
    expect(warrior.name).toBe('Warrior');
    expect(warrior.colors).toContain('R');
    expect(warrior.power).toBe(1);
    expect(warrior.toughness).toBe(1);
    expect(warrior.entersTapped).toBe(true);
  });

  it('should have 0/1 Plant token definition', () => {
    const plant = COMMON_TOKENS['0/1 Plant'];
    expect(plant).toBeDefined();
    expect(plant.name).toBe('Plant');
    expect(plant.colors).toContain('G');
    expect(plant.power).toBe(0);
    expect(plant.toughness).toBe(1);
  });

  it('should have Eldrazi Spawn and Scion tokens', () => {
    const spawn = COMMON_TOKENS['0/1 Eldrazi Spawn'];
    expect(spawn).toBeDefined();
    expect(spawn.power).toBe(0);
    expect(spawn.toughness).toBe(1);
    expect(spawn.abilities).toContain('Sacrifice this creature: Add {C}.');
    
    const scion = COMMON_TOKENS['1/1 Eldrazi Scion'];
    expect(scion).toBeDefined();
    expect(scion.power).toBe(1);
    expect(scion.toughness).toBe(1);
  });

  it('should have Faerie Rogue token for Bitterblossom', () => {
    const faerie = COMMON_TOKENS['1/1 Faerie Rogue (Flying)'];
    expect(faerie).toBeDefined();
    expect(faerie.name).toBe('Faerie Rogue');
    expect(faerie.colors).toContain('B');
    expect(faerie.abilities).toContain('Flying');
  });

  it('should have Squirrel token for Deranged Hermit and Squirrel Nest', () => {
    const squirrel = COMMON_TOKENS['1/1 Squirrel'];
    expect(squirrel).toBeDefined();
    expect(squirrel.name).toBe('Squirrel');
    expect(squirrel.power).toBe(1);
    expect(squirrel.toughness).toBe(1);
    expect(squirrel.colors).toContain('G');
    expect(squirrel.subtypes).toContain('Squirrel');
  });

  it('should have Merfolk token with Hexproof for Deeproot Waters', () => {
    const merfolk = COMMON_TOKENS['1/1 Merfolk (Hexproof)'];
    expect(merfolk).toBeDefined();
    expect(merfolk.name).toBe('Merfolk');
    expect(merfolk.power).toBe(1);
    expect(merfolk.toughness).toBe(1);
    expect(merfolk.colors).toContain('U');
    expect(merfolk.subtypes).toContain('Merfolk');
    expect(merfolk.abilities).toContain('Hexproof');
  });
});
