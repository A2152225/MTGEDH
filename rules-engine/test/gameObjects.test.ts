/**
 * Tests for Rules 111-112, 114: Tokens, Spells, and Emblems
 */
import { describe, it, expect } from 'vitest';
import {
  TokenDefinition,
  TokenCreationSpec,
  PredefinedTokenType,
  getPredefinedToken,
  Spell,
  Emblem,
  createEmblem,
  isEmblemAbilityActive
} from '../src/types/gameObjects';
import { CardType } from '../src/types/objects';
import { Color } from '../src/types/colors';

describe('Rule 111: Tokens', () => {
  describe('Rule 111.2 - Token ownership', () => {
    it('should define token with owner', () => {
      const token: TokenDefinition = {
        id: 'token-1',
        owner: 'player-1',
        isToken: true,
        isCopy: false,
        name: 'Goblin Token',
        colors: [Color.RED],
        types: [CardType.CREATURE],
        subtypes: ['Goblin'],
        supertypes: [],
        rulesText: '',
        power: 1,
        toughness: 1
      };

      expect(token.isToken).toBe(true);
      expect(token.owner).toBe('player-1');
    });
  });

  describe('Rule 111.3 - Token characteristics', () => {
    it('should create token spec with defined characteristics', () => {
      const spec: TokenCreationSpec = {
        name: 'Soldier',
        colors: [Color.WHITE],
        types: [CardType.CREATURE],
        subtypes: ['Soldier'],
        power: 1,
        toughness: 1
      };

      expect(spec.name).toBe('Soldier');
      expect(spec.types).toContain(CardType.CREATURE);
      expect(spec.power).toBe(1);
    });

    it('should allow name to be undefined (uses subtype + Token)', () => {
      const spec: TokenCreationSpec = {
        types: [CardType.CREATURE],
        subtypes: ['Zombie']
      };

      expect(spec.name).toBeUndefined();
      // Name would be "Zombie Token" when created
    });
  });

  describe('Rule 111.10 - Predefined tokens', () => {
    it('should create Treasure token', () => {
      const treasure = getPredefinedToken(PredefinedTokenType.TREASURE);
      expect(treasure.name).toBe('Treasure');
      expect(treasure.types).toContain(CardType.ARTIFACT);
      expect(treasure.subtypes).toContain('Treasure');
      expect(treasure.abilities).toHaveLength(1);
    });

    it('should create Clue token', () => {
      const clue = getPredefinedToken(PredefinedTokenType.CLUE);
      expect(clue.name).toBe('Clue');
      expect(clue.types).toContain(CardType.ARTIFACT);
      expect(clue.subtypes).toContain('Clue');
    });

    it('should create Food token', () => {
      const food = getPredefinedToken(PredefinedTokenType.FOOD);
      expect(food.name).toBe('Food');
      expect(food.types).toContain(CardType.ARTIFACT);
      expect(food.abilities![0]).toContain('You gain 3 life');
    });
  });
});

describe('Rule 112: Spells', () => {
  describe('Rule 112.1 - Spell on the stack', () => {
    it('should define spell with all required properties', () => {
      const spell: Spell = {
        id: 'spell-1',
        cardId: 'card-1',
        owner: 'player-1',
        controller: 'player-1',
        characteristics: {
          name: 'Lightning Bolt',
          manaCost: ['{R}'],
          colors: [Color.RED],
          types: [CardType.INSTANT],
          subtypes: [],
          supertypes: [],
          rulesText: 'Lightning Bolt deals 3 damage to any target.'
        },
        timestamp: Date.now(),
        isCopy: false
      };

      expect(spell.cardId).toBe('card-1');
      expect(spell.characteristics.name).toBe('Lightning Bolt');
    });

    it('should support spell targets', () => {
      const spell: Spell = {
        id: 'spell-2',
        cardId: 'card-2',
        owner: 'player-1',
        controller: 'player-1',
        characteristics: {
          name: 'Murder',
          types: [CardType.INSTANT],
          subtypes: [],
          supertypes: [],
          rulesText: 'Destroy target creature.',
          colors: []
        },
        targets: [
          {
            type: 'permanent',
            id: 'creature-1',
            isValid: true
          }
        ],
        timestamp: Date.now(),
        isCopy: false
      };

      expect(spell.targets).toHaveLength(1);
      expect(spell.targets![0].type).toBe('permanent');
    });

    it('should support X value for variable costs', () => {
      const spell: Spell = {
        id: 'spell-3',
        cardId: 'card-3',
        owner: 'player-1',
        controller: 'player-1',
        characteristics: {
          name: 'Fireball',
          manaCost: ['{X}', '{R}'],
          types: [CardType.SORCERY],
          subtypes: [],
          supertypes: [],
          rulesText: 'Fireball deals X damage divided evenly.',
          colors: [Color.RED]
        },
        xValue: 5,
        timestamp: Date.now(),
        isCopy: false
      };

      expect(spell.xValue).toBe(5);
    });
  });

  describe('Rule 112.1a - Spell copies', () => {
    it('should support copied spells', () => {
      const spell: Spell = {
        id: 'spell-copy-1',
        cardId: 'card-original',
        owner: 'player-1',
        controller: 'player-1',
        characteristics: {
          name: 'Lightning Bolt',
          types: [CardType.INSTANT],
          subtypes: [],
          supertypes: [],
          rulesText: '',
          colors: []
        },
        timestamp: Date.now(),
        isCopy: true
      };

      expect(spell.isCopy).toBe(true);
    });
  });
});

describe('Rule 114: Emblems', () => {
  describe('Rule 114.1 - Emblems in command zone', () => {
    it('should create emblem with owner and abilities', () => {
      const emblem = createEmblem('player-1', {
        name: 'Jace, Unraveler of Secrets Emblem',
        abilities: ['Whenever an opponent casts their first spell each turn, counter that spell.']
      });

      expect(emblem.owner).toBe('player-1');
      expect(emblem.name).toContain('Jace');
      expect(emblem.abilities).toHaveLength(1);
    });

    it('should have unique IDs for different emblems', () => {
      const emblem1 = createEmblem('player-1', {
        name: 'Test Emblem',
        abilities: ['Test ability']
      });

      const emblem2 = createEmblem('player-1', {
        name: 'Test Emblem',
        abilities: ['Test ability']
      });

      expect(emblem1.id).not.toBe(emblem2.id);
    });
  });

  describe('Rule 114.3 - Emblems function in command zone', () => {
    it('should always be active', () => {
      const emblem: Emblem = {
        id: 'emblem-1',
        owner: 'player-1',
        name: 'Test Emblem',
        abilities: ['Test'],
        timestamp: Date.now()
      };

      expect(isEmblemAbilityActive(emblem)).toBe(true);
    });
  });
});
