/**
 * Tests for Rules 200-209: Parts of a Card
 */
import { describe, it, expect } from 'vitest';
import {
  haveSameName,
  haveDifferentNames,
  hasDifferentNameThan,
  hasNoManaCost,
  getColorFromManaCost,
  isColorlessFromManaCost,
  isMulticoloredFromManaCost,
  formatTypeLine,
  getSubtypesFromTypeLine,
  canGainSubtype,
  ArtifactType,
  EnchantmentType,
  LandType,
  SpellType,
  BASIC_LAND_TYPES,
  isBasicLandType,
  isBasicLand,
  isLegendary,
  isWorldPermanent,
  isSnowPermanent,
  formatPowerToughness,
  hasCharacteristicDefiningPT,
  getStartingLoyaltyCounters,
  TypeLine,
  PowerToughness,
  Loyalty
} from '../src/types/cardParts';
import { Color } from '../src/types/colors';
import { CardType, Supertype } from '../src/types/objects';

describe('Rule 201: Name', () => {
  describe('Rule 201.2a - Same name', () => {
    it('should identify objects with same name', () => {
      expect(haveSameName('Lightning Bolt', 'Lightning Bolt')).toBe(true);
      expect(haveSameName('Lightning Bolt', 'Shock')).toBe(false);
    });

    it('should handle objects with multiple names', () => {
      expect(haveSameName(['Fire', 'Ice'], ['Fire'])).toBe(true);
      expect(haveSameName(['Fire', 'Ice'], ['Ice'])).toBe(true);
      expect(haveSameName(['Fire', 'Ice'], ['Lightning Bolt'])).toBe(false);
    });

    it('should handle objects with no name', () => {
      expect(haveSameName(null, null)).toBe(false);
      expect(haveSameName(null, 'Lightning Bolt')).toBe(false);
      expect(haveSameName('Lightning Bolt', null)).toBe(false);
    });
  });

  describe('Rule 201.2b - Different names', () => {
    it('should identify all different names', () => {
      expect(haveDifferentNames(['Bolt', 'Shock', 'Blaze'])).toBe(true);
      expect(haveDifferentNames(['Bolt', 'Shock', 'Bolt'])).toBe(false);
    });

    it('should return false if any object has no name', () => {
      expect(haveDifferentNames(['Bolt', null, 'Shock'])).toBe(false);
    });

    it('should handle split cards correctly', () => {
      // A split card like Fire // Ice has both names, they count as one object
      const splitCard = ['Fire', 'Ice'];
      const bolt = 'Lightning Bolt';
      
      // The split card object has two names, so it shares a name with 'Fire'
      expect(haveDifferentNames([splitCard, bolt])).toBe(true);
      
      // But two different cards with single names are different
      expect(haveDifferentNames(['Bolt', 'Shock', 'Blaze'])).toBe(true);
    });
  });

  describe('Rule 201.2c - Has different name than', () => {
    it('should check if one object has different name than others', () => {
      expect(hasDifferentNameThan('Bolt', ['Shock', 'Blaze'])).toBe(true);
      expect(hasDifferentNameThan('Bolt', ['Bolt', 'Shock'])).toBe(false);
    });

    it('should return false if first object has no name', () => {
      expect(hasDifferentNameThan(null, ['Shock', 'Blaze'])).toBe(false);
    });

    it('should handle other objects with no names', () => {
      expect(hasDifferentNameThan('Bolt', ['Shock', null])).toBe(true);
    });
  });
});

describe('Rule 202: Mana Cost and Color', () => {
  describe('Rule 202.1b - No mana cost', () => {
    it('should identify objects with no mana cost', () => {
      expect(hasNoManaCost(undefined)).toBe(true);
      expect(hasNoManaCost(null as any)).toBe(true);
      expect(hasNoManaCost({ generic: 1, white: 1 })).toBe(false);
    });
  });

  describe('Rule 202.2 - Color from mana cost', () => {
    it('should extract colors from mana cost', () => {
      const whiteCost = { white: 1, generic: 1 };
      expect(getColorFromManaCost(whiteCost)).toEqual([Color.WHITE]);
    });

    it('should handle multicolored mana costs', () => {
      const multiCost = { white: 1, blue: 1, generic: 2 };
      const colors = getColorFromManaCost(multiCost);
      expect(colors).toContain(Color.WHITE);
      expect(colors).toContain(Color.BLUE);
      expect(colors).toHaveLength(2);
    });

    it('should handle colorless mana costs', () => {
      const colorlessCost = { generic: 2 };
      expect(getColorFromManaCost(colorlessCost)).toEqual([]);
    });
  });

  describe('Rule 202.2b - Colorless', () => {
    it('should identify colorless from mana cost', () => {
      expect(isColorlessFromManaCost({ generic: 2 })).toBe(true);
      expect(isColorlessFromManaCost({ white: 1 })).toBe(false);
      expect(isColorlessFromManaCost(undefined)).toBe(true);
    });
  });

  describe('Rule 202.2c - Multicolored', () => {
    it('should identify multicolored from mana cost', () => {
      expect(isMulticoloredFromManaCost({ white: 1, blue: 1 })).toBe(true);
      expect(isMulticoloredFromManaCost({ white: 1 })).toBe(false);
      expect(isMulticoloredFromManaCost({ generic: 2 })).toBe(false);
    });
  });
});

describe('Rule 205: Type Line', () => {
  describe('Rule 205.1a - Format type line', () => {
    it('should format type line with supertypes', () => {
      const typeLine: TypeLine = {
        supertypes: [Supertype.LEGENDARY],
        cardTypes: [CardType.CREATURE],
        subtypes: ['Human', 'Wizard']
      };
      expect(formatTypeLine(typeLine)).toBe('legendary Creature — Human Wizard');
    });

    it('should format type line without supertypes', () => {
      const typeLine: TypeLine = {
        supertypes: [],
        cardTypes: [CardType.CREATURE],
        subtypes: ['Goblin']
      };
      expect(formatTypeLine(typeLine)).toBe('Creature — Goblin');
    });

    it('should format type line without subtypes', () => {
      const typeLine: TypeLine = {
        supertypes: [Supertype.BASIC],
        cardTypes: [CardType.LAND],
        subtypes: []
      };
      expect(formatTypeLine(typeLine)).toBe('basic Land');
    });
  });

  describe('Rule 205.3a - Extract subtypes', () => {
    it('should extract subtypes from type line text', () => {
      expect(getSubtypesFromTypeLine('Creature — Human Wizard')).toEqual(['Human', 'Wizard']);
      expect(getSubtypesFromTypeLine('Artifact — Equipment')).toEqual(['Equipment']);
      expect(getSubtypesFromTypeLine('Basic Land')).toEqual([]);
    });
  });

  describe('Rule 205.3d - Can gain subtype', () => {
    it('should only allow appropriate subtypes', () => {
      expect(canGainSubtype([CardType.CREATURE], 'Goblin', CardType.CREATURE)).toBe(true);
      expect(canGainSubtype([CardType.CREATURE], 'Equipment', CardType.ARTIFACT)).toBe(false);
      expect(canGainSubtype([CardType.ARTIFACT, CardType.CREATURE], 'Equipment', CardType.ARTIFACT)).toBe(true);
    });
  });

  describe('Rule 205.3g - Artifact types', () => {
    it('should define all artifact types', () => {
      expect(ArtifactType.EQUIPMENT).toBe('Equipment');
      expect(ArtifactType.TREASURE).toBe('Treasure');
      expect(ArtifactType.CLUE).toBe('Clue');
      expect(ArtifactType.FOOD).toBe('Food');
      expect(ArtifactType.VEHICLE).toBe('Vehicle');
    });
  });

  describe('Rule 205.3h - Enchantment types', () => {
    it('should define all enchantment types', () => {
      expect(EnchantmentType.AURA).toBe('Aura');
      expect(EnchantmentType.SAGA).toBe('Saga');
      expect(EnchantmentType.CLASS).toBe('Class');
      expect(EnchantmentType.CURSE).toBe('Curse');
    });
  });

  describe('Rule 205.3i - Land types', () => {
    it('should define all land types', () => {
      expect(LandType.FOREST).toBe('Forest');
      expect(LandType.ISLAND).toBe('Island');
      expect(LandType.MOUNTAIN).toBe('Mountain');
      expect(LandType.PLAINS).toBe('Plains');
      expect(LandType.SWAMP).toBe('Swamp');
    });

    it('should identify basic land types', () => {
      expect(BASIC_LAND_TYPES).toHaveLength(5);
      expect(BASIC_LAND_TYPES).toContain(LandType.FOREST);
      expect(BASIC_LAND_TYPES).toContain(LandType.ISLAND);
    });

    it('should check if land type is basic', () => {
      expect(isBasicLandType(LandType.FOREST)).toBe(true);
      expect(isBasicLandType(LandType.GATE)).toBe(false);
      expect(isBasicLandType(LandType.DESERT)).toBe(false);
    });
  });

  describe('Rule 205.3k - Spell types', () => {
    it('should define spell types for instants and sorceries', () => {
      expect(SpellType.ADVENTURE).toBe('Adventure');
      expect(SpellType.ARCANE).toBe('Arcane');
      expect(SpellType.LESSON).toBe('Lesson');
      expect(SpellType.TRAP).toBe('Trap');
    });
  });

  describe('Rule 205.4 - Supertypes', () => {
    it('should define all supertypes', () => {
      expect(Supertype.BASIC).toBe('basic');
      expect(Supertype.LEGENDARY).toBe('legendary');
      expect(Supertype.SNOW).toBe('snow');
      expect(Supertype.WORLD).toBe('world');
    });

    it('should identify basic lands', () => {
      expect(isBasicLand([Supertype.BASIC])).toBe(true);
      expect(isBasicLand([Supertype.LEGENDARY])).toBe(false);
      expect(isBasicLand([])).toBe(false);
    });

    it('should identify legendary permanents', () => {
      expect(isLegendary([Supertype.LEGENDARY])).toBe(true);
      expect(isLegendary([Supertype.BASIC])).toBe(false);
    });

    it('should identify world permanents', () => {
      expect(isWorldPermanent([Supertype.WORLD])).toBe(true);
      expect(isWorldPermanent([Supertype.LEGENDARY])).toBe(false);
    });

    it('should identify snow permanents', () => {
      expect(isSnowPermanent([Supertype.SNOW])).toBe(true);
      expect(isSnowPermanent([Supertype.BASIC])).toBe(false);
    });
  });
});

describe('Rule 208: Power/Toughness', () => {
  describe('Rule 208.2 - Format power/toughness', () => {
    it('should format numeric P/T', () => {
      const pt: PowerToughness = { power: 2, toughness: 2 };
      expect(formatPowerToughness(pt)).toBe('2/2');
    });

    it('should format with * for characteristic-defining', () => {
      const pt: PowerToughness = { power: '*', toughness: '*' };
      expect(formatPowerToughness(pt)).toBe('*/*');
    });

    it('should format mixed P/T', () => {
      const pt: PowerToughness = { power: '*', toughness: 5 };
      expect(formatPowerToughness(pt)).toBe('*/5');
    });
  });

  describe('Rule 208.3 - Characteristic-defining P/T', () => {
    it('should identify characteristic-defining abilities', () => {
      expect(hasCharacteristicDefiningPT({ power: '*', toughness: '*' })).toBe(true);
      expect(hasCharacteristicDefiningPT({ power: '*', toughness: 5 })).toBe(true);
      expect(hasCharacteristicDefiningPT({ power: 2, toughness: '*' })).toBe(true);
      expect(hasCharacteristicDefiningPT({ power: 2, toughness: 2 })).toBe(false);
    });
  });
});

describe('Rule 209: Loyalty', () => {
  describe('Rule 209.2 - Starting loyalty counters', () => {
    it('should get starting loyalty counters', () => {
      const loyalty: Loyalty = { startingLoyalty: 3 };
      expect(getStartingLoyaltyCounters(loyalty)).toBe(3);
    });

    it('should handle high loyalty values', () => {
      const loyalty: Loyalty = { startingLoyalty: 6 };
      expect(getStartingLoyaltyCounters(loyalty)).toBe(6);
    });
  });
});
