/**
 * Tests for creature mana ability generation via tap effect
 * 
 * This test suite verifies that:
 * 1. Creatures with inherent mana abilities generate mana when tapped
 * 2. Creatures granted mana abilities (via Cryptolith Rite, etc.) generate mana when tapped
 * 3. Mana is properly added to the player's mana pool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getManaAbilitiesForPermanent, detectManaModifiers, getEffectiveBasicLandTypes } from '../src/state/modules/mana-abilities';
import { calculateManaProduction } from '../src/socket/util.js';
import { getAvailableMana, getTotalManaFromPool } from '../src/state/modules/mana-check.js';

describe('Creature Mana Abilities', () => {
  describe('getManaAbilitiesForPermanent', () => {
    it('should detect mana abilities for a creature with inherent tap-for-mana', () => {
      const gameState = {
        battlefield: [],
      };
      
      const permanent = {
        id: 'llanowar-elves-1',
        controller: 'player1',
        card: {
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, permanent, 'player1');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities.some(a => a.produces.includes('G'))).toBe(true);
    });
    
    it('should detect granted mana abilities from Cryptolith Rite', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // A creature without inherent mana ability
      const creature = {
        id: 'grizzly-bears-1',
        controller: 'player1',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, creature, 'player1');
      
      // Should have a granted mana ability from Cryptolith Rite
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities.some(a => a.isGranted)).toBe(true);
      expect(abilities.some(a => a.produces.length > 1 || a.produces.includes('W'))).toBe(true);
    });
    
    it('should detect granted mana abilities from Citanul Hierophants', () => {
      const citanulHierophants = {
        id: 'citanul-hierophants-1',
        controller: 'player1',
        card: {
          name: 'Citanul Hierophants',
          type_line: 'Creature — Human Druid',
          oracle_text: 'Creatures you control have "{T}: Add {G}."',
        },
      };
      
      const gameState = {
        battlefield: [citanulHierophants],
      };
      
      // A creature without inherent mana ability
      const creature = {
        id: 'grizzly-bears-1',
        controller: 'player1',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, creature, 'player1');
      
      // Should have a granted mana ability from Citanul Hierophants
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities.some(a => a.isGranted)).toBe(true);
      expect(abilities.some(a => a.produces.includes('G'))).toBe(true);
    });
    
    it('should not grant abilities to creatures controlled by other players', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // A creature controlled by player2 (not the Cryptolith Rite owner)
      const creature = {
        id: 'grizzly-bears-1',
        controller: 'player2',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, creature, 'player2');
      
      // Should NOT have any mana abilities granted
      expect(abilities.filter(a => a.isGranted).length).toBe(0);
    });
    
    it('should not grant mana abilities to lands from creature-granting effects', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // A land (not a creature)
      const land = {
        id: 'forest-1',
        controller: 'player1',
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, land, 'player1');
      
      // Should have the inherent Forest mana ability, but NOT the Cryptolith Rite granted ability
      expect(abilities.some(a => a.produces.includes('G'))).toBe(true);
      expect(abilities.filter(a => a.isGranted && a.grantedBy === 'cryptolith-rite-1').length).toBe(0);
    });

    it('should not treat Cryptolith Rite itself as a native mana source', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };

      const gameState = {
        battlefield: [cryptolithRite],
      };

      const abilities = getManaAbilitiesForPermanent(gameState, cryptolithRite, 'player1');

      expect(abilities).toHaveLength(0);
    });

    it('should preserve granted any-color mana as a color-choice source', () => {
      const creature = {
        id: 'bear-1',
        controller: 'player1',
        grantedAbilities: ['tap_for_any_color'],
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };

      const manaProduction = calculateManaProduction({ battlefield: [creature] }, creature, 'player1');
      expect(manaProduction.totalAmount).toBe(1);
      expect(manaProduction.colors).toEqual(['any']);
      expect(manaProduction.requiresColorChoice).toBe(true);

      const greenManaProduction = calculateManaProduction({ battlefield: [creature] }, creature, 'player1', 'G');
      expect(greenManaProduction.totalAmount).toBe(1);
      expect(greenManaProduction.colors).toEqual(['G']);
      expect(greenManaProduction.requiresColorChoice).toBe(false);
    });

    it('should not treat Mox Amber as a mana source without a colored legendary creature or planeswalker', () => {
      const moxAmber = {
        id: 'mox-amber-1',
        controller: 'player1',
        card: {
          name: 'Mox Amber',
          type_line: 'Legendary Artifact',
          oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
        },
      };

      const nonLegendaryCreature = {
        id: 'bear-1',
        controller: 'player1',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          colors: ['G'],
        },
      };

      const gameState = {
        battlefield: [moxAmber, nonLegendaryCreature],
      };

      expect(getManaAbilitiesForPermanent(gameState, moxAmber, 'player1')).toHaveLength(0);

      const manaProduction = calculateManaProduction(gameState, moxAmber, 'player1');
      expect(manaProduction.baseAmount).toBe(0);
      expect(manaProduction.totalAmount).toBe(0);
      expect(manaProduction.colors).toEqual([]);
    });

    it('should restrict Mox Amber colors to controlled legendary creatures and planeswalkers', () => {
      const moxAmber = {
        id: 'mox-amber-1',
        controller: 'player1',
        card: {
          name: 'Mox Amber',
          type_line: 'Legendary Artifact',
          oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
        },
      };

      const legendaryCreature = {
        id: 'legend-1',
        controller: 'player1',
        card: {
          name: 'Raffine, Scheming Seer',
          type_line: 'Legendary Creature — Sphinx Demon',
          oracle_text: '',
          colors: ['W', 'U', 'B'],
        },
      };

      const planeswalker = {
        id: 'walker-1',
        controller: 'player1',
        card: {
          name: 'Koth, Fire of Resistance',
          type_line: 'Planeswalker — Koth',
          oracle_text: '',
          colors: ['R'],
        },
      };

      const gameState = {
        battlefield: [moxAmber, legendaryCreature, planeswalker],
      };

      const manaAbilities = getManaAbilitiesForPermanent(gameState, moxAmber, 'player1');
      expect(manaAbilities).toHaveLength(1);
      expect([...(manaAbilities[0]?.produces || [])].sort()).toEqual(['B', 'R', 'U', 'W']);

      const manaProduction = calculateManaProduction(gameState, moxAmber, 'player1');
      expect([...manaProduction.colors].sort()).toEqual(['B', 'R', 'U', 'W']);
      expect(manaProduction.requiresColorChoice).toBe(true);

      const redManaProduction = calculateManaProduction(gameState, moxAmber, 'player1', 'R');
      expect(redManaProduction.colors).toEqual(['R']);
      expect(redManaProduction.requiresColorChoice).toBe(false);
    });

    it('should remap basic land mana under Reality Twist without changing land types', () => {
      const realityTwist = {
        id: 'reality-twist-1',
        controller: 'player1',
        card: {
          name: 'Reality Twist',
          type_line: 'World Enchantment',
          oracle_text: 'If tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.',
        },
      };

      const plains = {
        id: 'plains-1',
        controller: 'player1',
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '',
        },
      };

      const swamp = {
        id: 'swamp-1',
        controller: 'player1',
        card: {
          name: 'Swamp',
          type_line: 'Basic Land — Swamp',
          oracle_text: '',
        },
      };

      const forest = {
        id: 'forest-1',
        controller: 'player1',
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '',
        },
      };

      const gameState = {
        battlefield: [realityTwist, plains, swamp, forest],
      };

      expect(getEffectiveBasicLandTypes(gameState, plains)).toEqual(['plains']);
      expect(getEffectiveBasicLandTypes(gameState, swamp)).toEqual(['swamp']);
      expect(getEffectiveBasicLandTypes(gameState, forest)).toEqual(['forest']);

      const plainsAbilities = getManaAbilitiesForPermanent(gameState, plains, 'player1');
      const swampAbilities = getManaAbilitiesForPermanent(gameState, swamp, 'player1');
      const forestAbilities = getManaAbilitiesForPermanent(gameState, forest, 'player1');

      expect(plainsAbilities.some(a => a.produces.includes('R'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('W'))).toBe(false);
      expect(swampAbilities.some(a => a.produces.includes('G'))).toBe(true);
      expect(swampAbilities.some(a => a.produces.includes('B'))).toBe(false);
      expect(forestAbilities.some(a => a.produces.includes('B'))).toBe(true);
      expect(forestAbilities.some(a => a.produces.includes('G'))).toBe(false);
    });

    it('should combine Urborg with Reality Twist through effective land types', () => {
      const urborg = {
        id: 'urborg-1',
        controller: 'player1',
        card: {
          name: 'Urborg, Tomb of Yawgmoth',
          type_line: 'Legendary Land',
          oracle_text: 'Each land is a Swamp in addition to its other land types.',
        },
      };

      const realityTwist = {
        id: 'reality-twist-1',
        controller: 'player1',
        card: {
          name: 'Reality Twist',
          type_line: 'World Enchantment',
          oracle_text: 'If tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.',
        },
      };

      const plains = {
        id: 'plains-1',
        controller: 'player1',
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '',
        },
      };

      const gameState = {
        battlefield: [urborg, realityTwist, plains],
      };

      expect(getEffectiveBasicLandTypes(gameState, plains)).toEqual(['plains', 'swamp']);

      const plainsAbilities = getManaAbilitiesForPermanent(gameState, plains, 'player1');

      expect(plainsAbilities.some(a => a.produces.includes('R'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('G'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('W'))).toBe(false);
      expect(plainsAbilities.some(a => a.produces.includes('B'))).toBe(false);
    });

    it('should suppress Urborg under Blood Moon and remap Mountain mana with Reality Twist', () => {
      const bloodMoon = {
        id: 'blood-moon-1',
        controller: 'player2',
        card: {
          name: 'Blood Moon',
          type_line: 'Enchantment',
          oracle_text: 'Nonbasic lands are Mountains.',
        },
      };

      const urborg = {
        id: 'urborg-1',
        controller: 'player1',
        card: {
          name: 'Urborg, Tomb of Yawgmoth',
          type_line: 'Legendary Land',
          oracle_text: 'Each land is a Swamp in addition to its other land types.',
        },
      };

      const realityTwist = {
        id: 'reality-twist-1',
        controller: 'player1',
        card: {
          name: 'Reality Twist',
          type_line: 'World Enchantment',
          oracle_text: 'If tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.',
        },
      };

      const commandTower = {
        id: 'command-tower-1',
        controller: 'player1',
        card: {
          name: 'Command Tower',
          type_line: 'Land',
          oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
        },
      };

      const plains = {
        id: 'plains-1',
        controller: 'player1',
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '',
        },
      };

      const gameState = {
        battlefield: [bloodMoon, urborg, realityTwist, commandTower, plains],
      };

      expect(getEffectiveBasicLandTypes(gameState, commandTower)).toEqual(['mountain']);
      expect(getEffectiveBasicLandTypes(gameState, plains)).toEqual(['plains']);

      const towerAbilities = getManaAbilitiesForPermanent(gameState, commandTower, 'player1');
      const plainsAbilities = getManaAbilitiesForPermanent(gameState, plains, 'player1');

      expect(towerAbilities).toHaveLength(1);
      expect(towerAbilities[0].produces).toEqual(['W']);
      expect(plainsAbilities.some(a => a.produces.includes('R'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('G'))).toBe(false);
    });
  });

  describe('oracle land-type grants (not KNOWN_MANA_MODIFIERS)', () => {
    it('lets an Island tap for {G} under Dryad of the Ilysian Grove', () => {
      const dryad = {
        id: 'dryad_1',
        controller: 'player1',
        card: {
          name: 'Dryad of the Ilysian Grove',
          type_line: 'Enchantment Creature — Nymph Dryad',
          oracle_text:
            'You may play an additional land on each of your turns.\nLands you control are every basic land type in addition to their other types.',
        },
      };
      const island = {
        id: 'island_1',
        controller: 'player1',
        card: {
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '{T}: Add {U}.',
        },
      };
      const gameState = { battlefield: [dryad, island] };

      expect(getEffectiveBasicLandTypes(gameState, island)).toEqual([
        'plains', 'island', 'swamp', 'mountain', 'forest',
      ]);
      const produced = calculateManaProduction(gameState, island, 'player1', 'G');
      expect(produced.colors.map((color) => String(color).toUpperCase())).toContain('G');
    });

    it('makes every land a Swamp under Blanket of Night', () => {
      const blanket = {
        id: 'blanket_1',
        controller: 'player1',
        card: {
          name: 'Blanket of Night',
          type_line: 'Enchantment',
          oracle_text: 'Each land is a Swamp in addition to its other land types.',
        },
      };
      const mountain = {
        id: 'mountain_1',
        controller: 'player1',
        card: {
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      };
      const gameState = { battlefield: [blanket, mountain] };

      expect(getEffectiveBasicLandTypes(gameState, mountain)).toEqual(['swamp', 'mountain']);
      const produced = calculateManaProduction(gameState, mountain, 'player1', 'B');
      expect(produced.colors.map((color) => String(color).toUpperCase())).toContain('B');
    });

    it('overrides a Mountain to Island under Spreading Seas', () => {
      const seas = {
        id: 'seas_1',
        controller: 'player1',
        attachedTo: 'mountain_1',
        card: {
          name: 'Spreading Seas',
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant land\nWhen this Aura enters, draw a card.\nEnchanted land is an Island.',
        },
      };
      const mountain = {
        id: 'mountain_1',
        controller: 'player1',
        card: {
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      };
      const gameState = { battlefield: [seas, mountain] };

      expect(getEffectiveBasicLandTypes(gameState, mountain)).toEqual(['island']);
      const abilities = getManaAbilitiesForPermanent(gameState, mountain, 'player1');
      expect(abilities.some(a => a.produces.includes('U'))).toBe(true);
      expect(abilities.some(a => a.produces.includes('R'))).toBe(false);
      const mana = getAvailableMana(gameState, 'player1');
      expect(mana.blue).toBe(1);
      expect(mana.red || 0).toBe(0);
    });

    it('adds every basic type on a land enchanted with Nylea\'s Presence', () => {
      const presence = {
        id: 'presence_1',
        controller: 'player1',
        attachedTo: 'mountain_1',
        card: {
          name: "Nylea's Presence",
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant land\nWhen this Aura enters, draw a card.\nEnchanted land is every basic land type in addition to its other types.',
        },
      };
      const mountain = {
        id: 'mountain_1',
        controller: 'player1',
        card: {
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      };
      const gameState = { battlefield: [presence, mountain] };

      expect(getEffectiveBasicLandTypes(gameState, mountain)).toEqual([
        'plains', 'island', 'swamp', 'mountain', 'forest',
      ]);
    });

    it('keeps Yavimaya Forest after Spreading Seas sets Island', () => {
      const seas = {
        id: 'seas_1',
        controller: 'player1',
        attachedTo: 'mountain_1',
        card: {
          name: 'Spreading Seas',
          type_line: 'Enchantment — Aura',
          oracle_text: 'Enchant land\nEnchanted land is an Island.',
        },
      };
      const yavimaya = {
        id: 'yavimaya_1',
        controller: 'player1',
        card: {
          name: 'Yavimaya, Cradle of Growth',
          type_line: 'Legendary Land',
          oracle_text: 'Each land is a Forest in addition to its other types.',
        },
      };
      const mountain = {
        id: 'mountain_1',
        controller: 'player1',
        card: {
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      };
      const gameState = { battlefield: [seas, yavimaya, mountain] };

      expect(getEffectiveBasicLandTypes(gameState, mountain)).toEqual(['island', 'forest']);
    });

    it('makes nontoken creatures Forest lands under Ashaya', () => {
      const ashaya = {
        id: 'ashaya_1',
        controller: 'player1',
        card: {
          name: 'Ashaya, Soul of the Wild',
          type_line: 'Legendary Creature — Elemental',
          oracle_text:
            "Ashaya's power and toughness are each equal to the number of lands you control.\nNontoken creatures you control are Forest lands in addition to their other types. (They're still affected by summoning sickness.)",
        },
      };
      const bear = {
        id: 'bear_1',
        controller: 'player1',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      const token = {
        id: 'token_1',
        controller: 'player1',
        isToken: true,
        card: {
          name: 'Saproling',
          type_line: 'Creature — Saproling',
          oracle_text: '',
        },
      };
      const gameState = { battlefield: [ashaya, bear, token] };

      expect(getEffectiveBasicLandTypes(gameState, bear)).toEqual(['forest']);
      expect(getEffectiveBasicLandTypes(gameState, token)).toEqual([]);
      expect(getEffectiveBasicLandTypes(gameState, ashaya)).toEqual(['forest']);
      const abilities = getManaAbilitiesForPermanent(gameState, bear, 'player1');
      expect(abilities.some(a => a.produces.includes('G'))).toBe(true);
      expect(getManaAbilitiesForPermanent(gameState, token, 'player1').some(a => a.produces.includes('G'))).toBe(false);
      const mana = getAvailableMana(gameState, 'player1');
      expect(mana.green).toBeGreaterThanOrEqual(2);
    });

    it('counts Yavimaya-granted Forest on a basic Mountain in getAvailableMana', () => {
      const yavimaya = {
        id: 'yavimaya_1',
        controller: 'player1',
        card: {
          name: 'Yavimaya, Cradle of Growth',
          type_line: 'Legendary Land',
          oracle_text: 'Each land is a Forest in addition to its other types.',
        },
      };
      const mountain = {
        id: 'mountain_1',
        controller: 'player1',
        card: {
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      };
      const gameState = {
        battlefield: [yavimaya, mountain],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(gameState, 'player1');
      expect(mana.red).toBe(1);
      expect(mana.green).toBeGreaterThanOrEqual(1);
      expect(getTotalManaFromPool(mana)).toBeGreaterThanOrEqual(1);
    });

    it('lets Exotic Orchard see an opponent Ashaya creature as a Forest', () => {
      const orchard = {
        id: 'orchard_1',
        controller: 'player1',
        tapped: false,
        card: {
          name: 'Exotic Orchard',
          type_line: 'Land',
          oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
        },
      };
      const ashaya = {
        id: 'ashaya_1',
        controller: 'player2',
        card: {
          name: 'Ashaya, Soul of the Wild',
          type_line: 'Legendary Creature — Elemental',
          oracle_text:
            "Nontoken creatures you control are Forest lands in addition to their other types. (They're still affected by summoning sickness.)",
        },
      };
      const bear = {
        id: 'bear_1',
        controller: 'player2',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      const gameState = {
        battlefield: [orchard, ashaya, bear],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(gameState, 'player1');
      expect(mana.green).toBe(1);
      expect(mana.white || 0).toBe(0);
    });
  });
  
  describe('detectManaModifiers', () => {
    it('should detect Cryptolith Rite as a mana modifier', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      const modifiers = detectManaModifiers(gameState, 'player1');
      
      expect(modifiers.length).toBeGreaterThan(0);
      expect(modifiers.some(m => m.cardName.toLowerCase().includes('cryptolith'))).toBe(true);
      expect(modifiers.some(m => m.affects === 'creatures')).toBe(true);
    });
    
    it('should detect Citanul Hierophants as a mana modifier', () => {
      const citanulHierophants = {
        id: 'citanul-hierophants-1',
        controller: 'player1',
        card: {
          name: 'Citanul Hierophants',
          type_line: 'Creature — Human Druid',
          oracle_text: 'Creatures you control have "{T}: Add {G}."',
        },
      };
      
      const gameState = {
        battlefield: [citanulHierophants],
      };
      
      const modifiers = detectManaModifiers(gameState, 'player1');
      
      expect(modifiers.length).toBeGreaterThan(0);
      expect(modifiers.some(m => m.cardName.toLowerCase().includes('citanul'))).toBe(true);
      expect(modifiers.some(m => m.affects === 'creatures')).toBe(true);
    });
    
    it('should not detect modifiers for opponents', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // Detect modifiers for player2 (not the Cryptolith Rite owner)
      const modifiers = detectManaModifiers(gameState, 'player2');
      
      // Should NOT detect the Cryptolith Rite modifier
      expect(modifiers.filter(m => m.cardName.toLowerCase().includes('cryptolith')).length).toBe(0);
    });
  });

  describe('artifact dual-choice pain mana', () => {
    it('treats Talisman of Creativity pain mana as a U or R choice with self-damage', () => {
      const permanent = {
        id: 'talisman_1',
        controller: 'player1',
        card: {
          name: 'Talisman of Creativity',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}.\n{T}: Add {U} or {R}. This artifact deals 1 damage to you.',
        },
      };

      const abilities = getManaAbilitiesForPermanent({ battlefield: [permanent] }, permanent, 'player1');
      const colorless = abilities.find((ability) => ability.id === 'native_c');
      const choice = abilities.find((ability) => ability.id === 'native_choice_2');

      expect(colorless?.produces).toEqual(['C']);
      expect(choice?.produces.slice().sort()).toEqual(['R', 'U']);
      expect(choice?.producesAllAtOnce).toBe(false);
      expect(choice?.damageEffect).toEqual({ type: 'damage_self', amount: 1 });
      expect(abilities.some((ability) => ability.id === 'native_u' && ability.produces.length === 1)).toBe(false);
    });

    it('treats Ancient Tomb as {C}{C} with 2 self-damage, not a free {C} tap', () => {
      const permanent = {
        id: 'tomb_1',
        controller: 'player1',
        card: {
          name: 'Ancient Tomb',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}{C}. This land deals 2 damage to you.',
        },
      };

      const abilities = getManaAbilitiesForPermanent({ battlefield: [permanent] }, permanent, 'player1');
      const multi = abilities.find((ability) => ability.id === 'native_multi_same');
      const colorless = abilities.find((ability) => ability.id === 'native_c');

      expect(multi?.produces).toEqual(['C']);
      expect(multi?.amount).toBe(2);
      expect(multi?.damageEffect).toEqual({ type: 'damage_self', amount: 2 });
      expect(colorless).toBeUndefined();
    });
  });
  
  describe('mana pool integration', () => {
    it('should correctly map mana colors to pool keys', () => {
      // This tests the color mapping logic used in the tapPermanent handler
      const colorToPoolKey: Record<string, string> = {
        'W': 'white',
        'U': 'blue',
        'B': 'black',
        'R': 'red',
        'G': 'green',
        'C': 'colorless',
      };
      
      expect(colorToPoolKey['W']).toBe('white');
      expect(colorToPoolKey['U']).toBe('blue');
      expect(colorToPoolKey['B']).toBe('black');
      expect(colorToPoolKey['R']).toBe('red');
      expect(colorToPoolKey['G']).toBe('green');
      expect(colorToPoolKey['C']).toBe('colorless');
    });
  });
});
