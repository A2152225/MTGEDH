/**
 * Tests for permanent ability discovery
 * 
 * This module tests the integration between oracleTextParser and the
 * ability discovery system for permanents on the battlefield.
 */
import { describe, it, expect } from 'vitest';
import {
  discoverPermanentAbilities,
  discoverZoneCardAbilities,
  discoverPlayerAbilities,
  getManaAbilitiesFromPermanent,
  getNonManaAbilitiesFromPermanent,
  toActivatedAbility,
  permanentHasActivatedAbilities,
  permanentHasManaAbilities,
} from '../src/permanentAbilityDiscovery';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

// Helper to create a test permanent
function createTestPermanent(
  id: string,
  name: string,
  oracleText: string,
  controllerId: string = 'player-1',
  typeLine: string = 'Creature'
): BattlefieldPermanent {
  return {
    id,
    controller: controllerId,
    owner: controllerId,
    card: {
      id: `card-${id}`,
      name,
      oracle_text: oracleText,
      type_line: typeLine,
    } as KnownCardRef,
  };
}

describe('Permanent Ability Discovery', () => {
  describe('discoverPermanentAbilities', () => {
    it('should discover basic tap mana ability', () => {
      const permanent = createTestPermanent(
        'forest-1',
        'Forest',
        '{T}: Add {G}.',
        'player-1',
        'Basic Land — Forest'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      expect(result.hasManaAbilities).toBe(true);
      expect(result.abilities.length).toBeGreaterThan(0);
      
      const manaAbility = result.abilities.find(a => a.isManaAbility);
      expect(manaAbility).toBeDefined();
      expect(manaAbility?.cost).toBe('{T}');
      expect(manaAbility?.effect).toContain('Add');
    });
    
    it('should discover activated ability with mana cost', () => {
      const permanent = createTestPermanent(
        'prodigal-1',
        'Prodigal Pyromancer',
        '{T}: Prodigal Pyromancer deals 1 damage to any target.',
        'player-1',
        'Creature — Human Wizard'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      expect(result.abilities.length).toBeGreaterThan(0);
      
      const ability = result.abilities[0];
      expect(ability.isManaAbility).toBe(false);
      expect(ability.targets).toContain('any');
    });
    
    it('should discover planeswalker loyalty abilities', () => {
      const permanent = createTestPermanent(
        'jace-1',
        'Jace, the Mind Sculptor',
        '+2: Look at the top card of target player\'s library.\n−1: Return target creature to its owner\'s hand.\n−12: Exile all cards from target player\'s library.',
        'player-1',
        'Legendary Planeswalker — Jace'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasLoyaltyAbilities).toBe(true);
      expect(result.abilities.filter(a => a.isLoyaltyAbility).length).toBeGreaterThan(0);
    });
    
    it('should discover ability with sacrifice cost', () => {
      const permanent = createTestPermanent(
        'viscera-1',
        'Viscera Seer',
        'Sacrifice a creature: Scry 1.',
        'player-1',
        'Creature — Vampire Wizard'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      const ability = result.abilities[0];
      expect(ability.additionalCosts).toBeDefined();
      expect(ability.additionalCosts?.some(c => c.type === 'sacrifice')).toBe(true);
    });

    it('should preserve filtered discard wording for battlefield ability discovery', () => {
      const permanent = createTestPermanent(
        'looter-1',
        'Filtered Looter',
        'Discard a land card: Draw a card.',
        'player-1',
        'Creature'
      );

      const result = discoverPermanentAbilities(permanent, 'player-1');
      const ability = result.abilities[0];
      const discardCost = ability.additionalCosts?.find(c => c.type === 'discard');
      expect(discardCost?.description).toBe('Discard a land card');
    });

    it('should preserve scoped counter removal wording for battlefield ability discovery', () => {
      const permanent = createTestPermanent(
        'counter-1',
        'Counter Engine',
        'Remove a +1/+1 counter from a creature you control: Draw a card.',
        'player-1',
        'Creature'
      );

      const result = discoverPermanentAbilities(permanent, 'player-1');
      const ability = result.abilities[0];
      const counterCost = ability.additionalCosts?.find(c => c.type === 'remove_counter');
      expect(counterCost?.description).toBe('Remove 1 +1/+1 counter(s) from a creature you control');
    });
    
    it('should discover ability with pay life cost', () => {
      const permanent = createTestPermanent(
        'mana-confluence-1',
        'Mana Confluence',
        '{T}, Pay 1 life: Add one mana of any color.',
        'player-1',
        'Land'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasManaAbilities).toBe(true);
      const ability = result.abilities.find(a => a.isManaAbility);
      expect(ability).toBeDefined();
      expect(ability?.additionalCosts?.some(c => c.type === 'life')).toBe(true);
    });

    it('should preserve self-exile wording for exile costs', () => {
      const permanent = createTestPermanent(
        'bottle-1',
        'Test Bottle',
        '{T}, Exile this artifact: Draw a card.',
        'player-1',
        'Artifact'
      );

      const result = discoverPermanentAbilities(permanent, 'player-1');

      expect(result.hasActivatedAbilities).toBe(true);
      const ability = result.abilities[0];
      const exileCost = ability.additionalCosts?.find(c => c.type === 'exile');
      expect(exileCost).toBeDefined();
      expect(exileCost?.description).toBe('Exile this artifact');
    });
    
    it('should not discover triggered abilities as activated', () => {
      const permanent = createTestPermanent(
        'mulldrifter-1',
        'Mulldrifter',
        'Flying\nWhen Mulldrifter enters the battlefield, draw two cards.',
        'player-1',
        'Creature — Elemental'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      // Should not have activated abilities (only triggered)
      const activatedAbilities = result.abilities.filter(
        a => !a.effect.toLowerCase().startsWith('when') && 
             !a.effect.toLowerCase().startsWith('whenever')
      );
      expect(activatedAbilities.filter(a => 
        a.cost.toLowerCase().includes('when') || 
        a.cost.toLowerCase().includes('whenever')
      ).length).toBe(0);
    });
    
    it('should detect sorcery speed restriction', () => {
      const permanent = createTestPermanent(
        'creature-1',
        'Test Creature',
        '{1}{G}: Target creature gets +1/+1 until end of turn. Activate only as a sorcery.',
        'player-1',
        'Creature'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      const ability = result.abilities[0];
      expect(ability.restrictions?.some(r => r.requiresSorceryTiming)).toBe(true);
    });
    
    it('should detect once per turn restriction', () => {
      const permanent = createTestPermanent(
        'creature-1',
        'Test Creature',
        '{T}: Draw a card. Activate only once each turn.',
        'player-1',
        'Creature'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      const ability = result.abilities[0];
      expect(ability.restrictions?.some(r => r.maxPerTurn === 1)).toBe(true);
    });
    
    it('should discover keyword abilities with costs', () => {
      const permanent = createTestPermanent(
        'equipment-1',
        'Sword of Test',
        'Equipped creature gets +2/+2.\nEquip {2}',
        'player-1',
        'Artifact — Equipment'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      const equipAbility = result.abilities.find(a => a.isKeywordAbility);
      expect(equipAbility).toBeDefined();
      expect(equipAbility?.cost).toBe('{2}');
      expect(equipAbility?.effect).toBe('Attach this permanent to target creature you control. Activate only as a sorcery.');
      expect(equipAbility?.targets).toContain('creature');
      expect(equipAbility?.restrictions?.some(r => r.requiresSorceryTiming)).toBe(true);
    });

    it('should discover outlast as a real activated keyword ability', () => {
      const permanent = createTestPermanent(
        'falconer-1',
        'Abzan Falconer',
        'Outlast {1}{W}',
        'player-1',
        'Creature — Human Soldier'
      );

      const result = discoverPermanentAbilities(permanent, 'player-1');

      expect(result.hasActivatedAbilities).toBe(true);
      const outlastAbility = result.abilities.find(a => a.isKeywordAbility);
      expect(outlastAbility).toBeDefined();
      expect(outlastAbility?.cost).toBe('{1}{W}, {T}');
      expect(outlastAbility?.effect).toBe('Put a +1/+1 counter on this creature. Activate only as a sorcery.');
      expect(outlastAbility?.restrictions?.some(r => r.requiresSorceryTiming)).toBe(true);
    });

    it('should discover fortify as a real activated keyword ability', () => {
      const permanent = createTestPermanent(
        'garrison-1',
        'Darksteel Garrison',
        'Fortify {3}',
        'player-1',
        'Artifact — Fortification'
      );

      const result = discoverPermanentAbilities(permanent, 'player-1');

      expect(result.hasActivatedAbilities).toBe(true);
      const fortifyAbility = result.abilities.find(a => a.isKeywordAbility);
      expect(fortifyAbility).toBeDefined();
      expect(fortifyAbility?.cost).toBe('{3}');
      expect(fortifyAbility?.effect).toBe('Attach this permanent to target land you control. Activate only as a sorcery.');
      expect(fortifyAbility?.targets).toContain('land');
      expect(fortifyAbility?.restrictions?.some(r => r.requiresSorceryTiming)).toBe(true);
    });
  });
  
  describe('discoverPlayerAbilities', () => {
    it('should discover abilities from multiple permanents', () => {
      const permanents: BattlefieldPermanent[] = [
        createTestPermanent('forest-1', 'Forest', '{T}: Add {G}.', 'player-1', 'Land'),
        createTestPermanent('island-1', 'Island', '{T}: Add {U}.', 'player-1', 'Land'),
        createTestPermanent('enemy-1', 'Enemy Forest', '{T}: Add {G}.', 'player-2', 'Land'),
      ];
      
      const results = discoverPlayerAbilities(permanents, 'player-1');
      
      // Should only find player-1's permanents
      expect(results.size).toBe(2);
      expect(results.has('forest-1')).toBe(true);
      expect(results.has('island-1')).toBe(true);
      expect(results.has('enemy-1')).toBe(false);
    });
  });
  
  describe('getManaAbilitiesFromPermanent', () => {
    it('should return only mana abilities', () => {
      const permanent = createTestPermanent(
        'dual-1',
        'Dual Purpose',
        '{T}: Add {G}.\n{2}{G}: Target creature gets +2/+2.',
        'player-1',
        'Land Creature'
      );
      
      const manaAbilities = getManaAbilitiesFromPermanent(permanent, 'player-1');
      
      expect(manaAbilities.length).toBe(1);
      expect(manaAbilities[0].isManaAbility).toBe(true);
      expect(manaAbilities[0].effect).toContain('Add');
    });
  });
  
  describe('getNonManaAbilitiesFromPermanent', () => {
    it('should return only non-mana abilities', () => {
      const permanent = createTestPermanent(
        'dual-1',
        'Dual Purpose',
        '{T}: Add {G}.\n{2}{G}: Target creature gets +2/+2.',
        'player-1',
        'Land Creature'
      );
      
      const nonManaAbilities = getNonManaAbilitiesFromPermanent(permanent, 'player-1');
      
      expect(nonManaAbilities.length).toBeGreaterThan(0);
      expect(nonManaAbilities.every(a => !a.isManaAbility)).toBe(true);
    });
  });
  
  describe('toActivatedAbility', () => {
    it('should convert DiscoveredAbility to ActivatedAbility format', () => {
      const permanent = createTestPermanent(
        'forest-1',
        'Forest',
        '{T}: Add {G}.',
        'player-1',
        'Land'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      const discovered = result.abilities[0];
      const converted = toActivatedAbility(discovered);
      
      expect(converted.id).toBe(discovered.id);
      expect(converted.sourceId).toBe(discovered.sourceId);
      expect(converted.sourceName).toBe(discovered.sourceName);
      expect(converted.controllerId).toBe(discovered.controllerId);
      expect(converted.effect).toBe(discovered.effect);
      expect(converted.isManaAbility).toBe(discovered.isManaAbility);
    });
  });
  
  describe('permanentHasActivatedAbilities', () => {
    it('should return true for permanent with activated abilities', () => {
      const permanent = createTestPermanent(
        'forest-1',
        'Forest',
        '{T}: Add {G}.',
        'player-1',
        'Land'
      );
      
      expect(permanentHasActivatedAbilities(permanent)).toBe(true);
    });
    
    it('should return false for permanent without activated abilities', () => {
      const permanent = createTestPermanent(
        'vanilla-1',
        'Vanilla Creature',
        '',
        'player-1',
        'Creature'
      );
      
      expect(permanentHasActivatedAbilities(permanent)).toBe(false);
    });
    
    it('should return true for card in ACTIVATED_ABILITY_CARDS config', () => {
      const permanent = createTestPermanent(
        'squirrel-nest-1',
        'Squirrel Nest',
        'Enchant land\nEnchanted land has "{T}: Create a 1/1 green Squirrel creature token."',
        'player-1',
        'Enchantment — Aura'
      );
      
      expect(permanentHasActivatedAbilities(permanent)).toBe(true);
    });
  });
  
  describe('permanentHasManaAbilities', () => {
    it('should return true for lands with mana abilities', () => {
      const permanent = createTestPermanent(
        'forest-1',
        'Forest',
        '{T}: Add {G}.',
        'player-1',
        'Land'
      );
      
      expect(permanentHasManaAbilities(permanent)).toBe(true);
    });
    
    it('should return true for mana rocks', () => {
      const permanent = createTestPermanent(
        'sol-ring-1',
        'Sol Ring',
        '{T}: Add {C}{C}.',
        'player-1',
        'Artifact'
      );
      
      expect(permanentHasManaAbilities(permanent)).toBe(true);
    });
    
    it('should return true for "mana of any color" abilities', () => {
      const permanent = createTestPermanent(
        'chromatic-1',
        'Chromatic Lantern',
        'Lands you control have "{T}: Add one mana of any color."',
        'player-1',
        'Artifact'
      );
      
      expect(permanentHasManaAbilities(permanent)).toBe(true);
    });
    
    it('should return false for creatures without mana abilities', () => {
      const permanent = createTestPermanent(
        'creature-1',
        'Test Creature',
        '{T}: Target player draws a card.',
        'player-1',
        'Creature'
      );
      
      expect(permanentHasManaAbilities(permanent)).toBe(false);
    });
  });
  
  describe('Integration with card-specific configs', () => {
    it('should use card-specific config for Drowner of Secrets', () => {
      const permanent = createTestPermanent(
        'drowner-1',
        'Drowner of Secrets',
        'Tap an untapped Merfolk you control: Target player mills a card.',
        'player-1',
        'Creature — Merfolk Wizard'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      expect(result.abilities.length).toBeGreaterThan(0);
    });
    
    it('should avoid duplicates between config and parsed abilities', () => {
      const permanent = createTestPermanent(
        'squirrel-nest-1',
        'Squirrel Nest',
        'Enchant land\nEnchanted land has "{T}: Create a 1/1 green Squirrel creature token."',
        'player-1',
        'Enchantment — Aura'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      // Should not have duplicate abilities
      const uniqueAbilities = new Set(
        result.abilities.map(a => `${a.cost}:${a.effect}`)
      );
      expect(uniqueAbilities.size).toBe(result.abilities.length);
    });
  });

  describe('Zone-scoped ability discovery', () => {
    it('discovers Summon the School graveyard activation with its filtered tap cost intact', () => {
      const card: KnownCardRef = {
        id: 'summon-card',
        name: 'Summon the School',
        oracle_text: 'Create two 1/1 blue Merfolk Wizard creature tokens. Tap four untapped Merfolk you control: Return Summon the School from your graveyard to your hand.',
        type_line: 'Tribal Sorcery - Merfolk',
      } as KnownCardRef;

      const result = discoverZoneCardAbilities(card, 'summon-card', 'player-1', 'graveyard');
      const ability = result.abilities[0];

      expect(result.hasActivatedAbilities).toBe(true);
      expect(ability?.sourceZone).toBe('graveyard');
      expect(ability?.cost).toBe('Tap four untapped Merfolk you control');
      expect(ability?.effect).toBe('Return this permanent from your graveyard to your hand.');
      expect(ability?.additionalCosts?.[0]?.type).toBe('tap');
      expect(ability?.additionalCosts?.[0]?.description).toBe('Tap four untapped merfolk you control');
    });

    it('discovers Disturb as a graveyard-zone keyword ability', () => {
      const card: KnownCardRef = {
        id: 'geist-front',
        name: 'Benevolent Geist',
        oracle_text: 'Disturb {1}{W}',
        type_line: 'Creature — Spirit',
      } as KnownCardRef;

      const result = discoverZoneCardAbilities(card, 'geist-front', 'player-1', 'graveyard');
      const ability = result.abilities[0];

      expect(result.hasActivatedAbilities).toBe(true);
      expect(ability?.isKeywordAbility).toBe(true);
      expect(ability?.sourceZone).toBe('graveyard');
      expect(ability?.cost).toBe('{1}{W}');
    });

    it('discovers Encore as a graveyard-zone activation with self-exile and sorcery restriction', () => {
      const card: KnownCardRef = {
        id: 'encore-card',
        name: 'Impaler Shrike',
        oracle_text: 'Flying\nWhen Impaler Shrike dies, you may draw three cards.\nEncore {5}{U}{U}',
        type_line: 'Creature - Bird Horror',
      } as KnownCardRef;

      const result = discoverZoneCardAbilities(card, 'encore-card', 'player-1', 'graveyard');
      const ability = result.abilities.find(candidate => candidate.isKeywordAbility);

      expect(result.hasActivatedAbilities).toBe(true);
      expect(ability?.sourceZone).toBe('graveyard');
      expect(ability?.cost).toBe('{5}{U}{U}, Exile this card from your graveyard');
      expect(ability?.additionalCosts?.map(cost => cost.type)).toContain('exile');
      expect(ability?.restrictions?.some(restriction => restriction.requiresSorceryTiming)).toBe(true);
    });

    it('discovers Channel as a hand-zone activation with a discard cost', () => {
      const card: KnownCardRef = {
        id: 'channel-card',
        name: 'Twinshot Sniper',
        oracle_text: 'Channel — {1}{R}, Discard this card: It deals 2 damage to any target.',
        type_line: 'Artifact Creature - Goblin Archer',
      } as KnownCardRef;

      const result = discoverZoneCardAbilities(card, 'channel-card', 'player-1', 'hand');
      const ability = result.abilities[0];

      expect(result.hasActivatedAbilities).toBe(true);
      expect(ability?.sourceZone).toBe('hand');
      expect(ability?.cost).toBe('{1}{R}, Discard this card');
      expect(ability?.additionalCosts?.map(cost => cost.type)).toContain('discard');
    });

    it('discovers Forecast as a hand-zone activation with reveal and upkeep restrictions', () => {
      const card: KnownCardRef = {
        id: 'forecast-card',
        name: 'Pride of the Clouds',
        oracle_text: 'Forecast — {2}{W}, Reveal this card from your hand: Create a 1/1 white and blue Bird creature token with flying. Activate only during your upkeep and only once each turn.',
        type_line: 'Creature - Human Wizard',
      } as KnownCardRef;

      const result = discoverZoneCardAbilities(card, 'forecast-card', 'player-1', 'hand');
      const ability = result.abilities[0];

      expect(result.hasActivatedAbilities).toBe(true);
      expect(ability?.sourceZone).toBe('hand');
      expect(ability?.additionalCosts?.map(cost => cost.type)).toContain('reveal');
      expect(ability?.restrictions?.some(restriction => restriction.requiresUpkeep)).toBe(true);
      expect(ability?.restrictions?.some(restriction => restriction.maxPerTurn === 1)).toBe(true);
    });

    it('discovers Transmute as a hand-zone activation with discard and sorcery restrictions', () => {
      const card: KnownCardRef = {
        id: 'transmute-card',
        name: 'Muddle the Mixture',
        oracle_text: 'Transmute {1}{U}{U}',
        type_line: 'Instant',
      } as KnownCardRef;

      const result = discoverZoneCardAbilities(card, 'transmute-card', 'player-1', 'hand');
      const ability = result.abilities[0];

      expect(result.hasActivatedAbilities).toBe(true);
      expect(ability?.sourceZone).toBe('hand');
      expect(ability?.cost).toBe('{1}{U}{U}, Discard this card');
      expect(ability?.additionalCosts?.map(cost => cost.type)).toContain('discard');
      expect(ability?.restrictions?.some(restriction => restriction.requiresSorceryTiming)).toBe(true);
    });

    it('discovers Transfigure as a battlefield activation with a sacrifice cost and sorcery restriction', () => {
      const card: KnownCardRef = {
        id: 'transfigure-card',
        name: 'Fleshwrither',
        oracle_text: 'Transfigure {1}{B}{B}',
        type_line: 'Creature - Horror',
      } as KnownCardRef;

      const permanent = createTestPermanent(
        'transfigure-card',
        'Fleshwrither',
        'Transfigure {1}{B}{B}',
        'player-1',
        'Creature - Horror'
      );
      const result = discoverPermanentAbilities(permanent, 'player-1');
      const ability = result.abilities[0];

      expect(result.hasActivatedAbilities).toBe(true);
      expect(ability?.sourceZone).toBe('battlefield');
      expect(ability?.cost).toBe('{1}{B}{B}, Sacrifice this permanent');
      expect(ability?.additionalCosts?.map(cost => cost.type)).toContain('sacrifice');
      expect(ability?.restrictions?.some(restriction => restriction.requiresSorceryTiming)).toBe(true);
    });
  });
  
  describe('Parse result exposure', () => {
    it('should expose the full parse result for advanced usage', () => {
      const permanent = createTestPermanent(
        'complex-1',
        'Complex Card',
        'Flying\n{T}: Add {G}.\nWhen this enters the battlefield, draw a card.',
        'player-1',
        'Creature'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.parseResult).toBeDefined();
      expect(result.parseResult?.keywords).toContain('flying');
      expect(result.parseResult?.isActivated).toBe(true);
      expect(result.parseResult?.isTriggered).toBe(true);
    });
  });
  
  describe('Optional abilities (isOptional field)', () => {
    it('should detect optional activated abilities with "you may"', () => {
      const permanent = createTestPermanent(
        'optional-1',
        'Optional Card',
        '{T}: You may draw a card.',
        'player-1',
        'Artifact'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      const ability = result.abilities[0];
      expect(ability.isOptional).toBe(true);
    });
    
    it('should not mark mandatory abilities as optional', () => {
      const permanent = createTestPermanent(
        'mandatory-1',
        'Mandatory Card',
        '{T}: Draw a card.',
        'player-1',
        'Artifact'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.hasActivatedAbilities).toBe(true);
      const ability = result.abilities[0];
      expect(ability.isOptional).toBeFalsy();
    });
  });
  
  describe('Modal abilities (modes field)', () => {
    it('should detect modal abilities through parseResult', () => {
      const permanent = createTestPermanent(
        'modal-1',
        'Modal Card',
        'Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.',
        'player-1',
        'Artifact'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      // Modal parsing is detected at the parse result level
      // The current parser detects modality through "choose one" and bullet points
      expect(result.parseResult?.hasModes).toBe(true);
      expect(result.hasModes).toBe(true);
    });
  });
  
  describe('Choice requirements (requiresChoice field)', () => {
    it('should detect color choice requirements through parseResult', () => {
      const permanent = createTestPermanent(
        'color-choice-1',
        'Color Choice Card',
        'As this enters the battlefield, choose a color.',
        'player-1',
        'Artifact'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      // Choice requirements are detected in replacement effects and exposed at result level
      expect(result.hasChoiceRequirements).toBe(true);
      expect(result.parseResult?.abilities.some(a => a.requiresChoice !== undefined)).toBe(true);
    });
    
    it('should detect choice requirements in activated abilities', () => {
      const permanent = createTestPermanent(
        'activated-choice-1',
        'Activated Choice Card',
        '{T}: Choose a color. Add one mana of that color.',
        'player-1',
        'Artifact'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      // This should have an activated ability with a choice requirement in its effect
      expect(result.hasActivatedAbilities).toBe(true);
      const ability = result.abilities[0];
      // The choice is in the effect text (case-insensitive check)
      expect(ability.effect.toLowerCase()).toContain('choose');
    });
    
    it('should detect creature type choice requirements', () => {
      const permanent = createTestPermanent(
        'type-choice-1',
        'Type Choice Card',
        'As this enters the battlefield, choose a creature type.',
        'player-1',
        'Artifact'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      expect(result.parseResult?.abilities.some(a => 
        a.requiresChoice?.choiceType === 'creature_type'
      )).toBe(true);
    });
  });
  
  describe('Backwards compatibility', () => {
    it('should still expose rawParsedAbility for full access', () => {
      const permanent = createTestPermanent(
        'test-1',
        'Test Card',
        '{T}: You may draw a card.',
        'player-1',
        'Artifact'
      );
      
      const result = discoverPermanentAbilities(permanent, 'player-1');
      
      const ability = result.abilities[0];
      expect(ability.rawParsedAbility).toBeDefined();
      expect(ability.rawParsedAbility?.isOptional).toBe(true);
      expect(ability.rawParsedAbility?.type).toBeDefined();
      expect(ability.rawParsedAbility?.text).toBeDefined();
    });
  });
});
