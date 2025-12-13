/**
 * CardAnalyzer.test.ts
 * 
 * Tests for the CardAnalyzer module which provides card analysis,
 * threat assessment, and synergy detection for AI decision-making.
 */

import { describe, it, expect } from 'vitest';
import {
  CardAnalyzer,
  cardAnalyzer,
  CardCategory,
  ThreatLevel,
  SynergyArchetype,
} from '../src/CardAnalyzer';
import type { KnownCardRef, BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';

// Helper to create a mock card
function createMockCard(overrides: Partial<KnownCardRef> & { name: string }): KnownCardRef {
  return {
    id: `card_${overrides.name.toLowerCase().replace(/\s/g, '_')}`,
    type_line: 'Creature',
    oracle_text: '',
    power: '2',
    toughness: '2',
    ...overrides,
  } as KnownCardRef;
}

// Helper to create a mock permanent
function createMockPermanent(card: KnownCardRef, controllerId: string): BattlefieldPermanent {
  return {
    id: `perm_${card.id}`,
    card,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: false,
    counters: {},
  } as BattlefieldPermanent;
}

describe('CardAnalyzer', () => {
  describe('Card Categorization', () => {
    it('should categorize creature cards correctly', () => {
      const creature = createMockCard({
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      });
      
      const analysis = cardAnalyzer.analyzeCard(creature);
      expect(analysis.categories).toContain(CardCategory.CREATURE);
    });
    
    it('should categorize removal spells correctly', () => {
      const removal = createMockCard({
        name: 'Murder',
        type_line: 'Instant',
        oracle_text: 'Destroy target creature.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(removal);
      expect(analysis.categories).toContain(CardCategory.REMOVAL);
    });
    
    it('should categorize board wipes correctly', () => {
      const boardWipe = createMockCard({
        name: 'Wrath of God',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all creatures.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(boardWipe);
      expect(analysis.categories).toContain(CardCategory.BOARD_WIPE);
    });
    
    it('should categorize counterspells correctly', () => {
      const counter = createMockCard({
        name: 'Counterspell',
        type_line: 'Instant',
        oracle_text: 'Counter target spell.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(counter);
      expect(analysis.categories).toContain(CardCategory.COUNTERSPELL);
    });
    
    it('should categorize ramp cards correctly', () => {
      const ramp = createMockCard({
        name: 'Cultivate',
        type_line: 'Sorcery',
        oracle_text: 'Search your library for up to two basic land cards.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(ramp);
      expect(analysis.categories).toContain(CardCategory.RAMP);
    });
    
    it('should categorize sacrifice outlets correctly', () => {
      const sacrificeOutlet = createMockCard({
        name: 'Viscera Seer',
        type_line: 'Creature — Vampire Wizard',
        oracle_text: 'Sacrifice a creature: Scry 1.',
        power: '1',
        toughness: '1',
      });
      
      const analysis = cardAnalyzer.analyzeCard(sacrificeOutlet);
      expect(analysis.categories).toContain(CardCategory.SACRIFICE_OUTLET);
    });
    
    it('should categorize token generators correctly', () => {
      const tokenGenerator = createMockCard({
        name: 'Krenko, Mob Boss',
        type_line: 'Legendary Creature — Goblin Warrior',
        oracle_text: '{T}: Create X 1/1 red Goblin creature tokens.',
        power: '3',
        toughness: '3',
      });
      
      const analysis = cardAnalyzer.analyzeCard(tokenGenerator);
      expect(analysis.categories).toContain(CardCategory.TOKEN_GENERATOR);
    });
    
    it('should categorize card draw correctly', () => {
      const cardDraw = createMockCard({
        name: 'Harmonize',
        type_line: 'Sorcery',
        oracle_text: 'Draw three cards.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(cardDraw);
      expect(analysis.categories).toContain(CardCategory.DRAW);
    });
  });
  
  describe('Death Trigger Detection', () => {
    it('should detect beneficial death triggers on Veteran Explorer', () => {
      const veteranExplorer = createMockCard({
        name: 'Veteran Explorer',
        type_line: 'Creature — Human Soldier Scout',
        oracle_text: 'When Veteran Explorer dies, each player may search their library for up to two basic land cards.',
        power: '1',
        toughness: '1',
      });
      
      const analysis = cardAnalyzer.analyzeCard(veteranExplorer);
      expect(analysis.details.hasDeathTrigger).toBe(true);
      expect(analysis.details.deathTriggerBenefitsMe).toBe(true);
      expect(analysis.details.deathTriggerSymmetric).toBe(true);
      expect(analysis.categories).toContain(CardCategory.DEATH_TRIGGER);
    });
    
    it('should detect death triggers on Sakura-Tribe Elder', () => {
      const ste = createMockCard({
        name: 'Sakura-Tribe Elder',
        type_line: 'Creature — Snake Shaman',
        oracle_text: 'Sacrifice Sakura-Tribe Elder: Search your library for a basic land card.',
        power: '1',
        toughness: '1',
      });
      
      const analysis = cardAnalyzer.analyzeCard(ste);
      // STE has sacrifice ability, not death trigger
      expect(analysis.details.canSacrifice).toBe(true);
      expect(analysis.details.sacrificeTarget).toBe('self');
    });
    
    it('should detect death triggers on Wurmcoil Engine', () => {
      const wurmcoil = createMockCard({
        name: 'Wurmcoil Engine',
        type_line: 'Artifact Creature — Phyrexian Wurm',
        oracle_text: 'Deathtouch, lifelink. When Wurmcoil Engine dies, create two 3/3 colorless Phyrexian Wurm artifact creature tokens.',
        power: '6',
        toughness: '6',
      });
      
      const analysis = cardAnalyzer.analyzeCard(wurmcoil);
      expect(analysis.details.hasDeathTrigger).toBe(true);
      expect(analysis.details.deathTriggerBenefitsMe).toBe(true);
    });
    
    it('should detect death triggers on Solemn Simulacrum', () => {
      const solemn = createMockCard({
        name: 'Solemn Simulacrum',
        type_line: 'Artifact Creature — Golem',
        oracle_text: 'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card. When Solemn Simulacrum dies, you may draw a card.',
        power: '2',
        toughness: '2',
      });
      
      const analysis = cardAnalyzer.analyzeCard(solemn);
      expect(analysis.details.hasDeathTrigger).toBe(true);
      expect(analysis.details.hasETBTrigger).toBe(true);
    });
  });
  
  describe('Threat Level Assessment', () => {
    it('should rate basic creatures as low threat', () => {
      const basicCreature = createMockCard({
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      });
      
      const analysis = cardAnalyzer.analyzeCard(basicCreature);
      expect(analysis.threatLevel).toBeLessThanOrEqual(ThreatLevel.LOW);
    });
    
    it('should rate large creatures with keywords as high threat', () => {
      const bigCreature = createMockCard({
        name: 'Baneslayer Angel',
        type_line: 'Creature — Angel',
        oracle_text: 'Flying, first strike, lifelink, protection from Demons and from Dragons.',
        power: '5',
        toughness: '5',
      });
      
      const analysis = cardAnalyzer.analyzeCard(bigCreature);
      expect(analysis.threatLevel).toBeGreaterThanOrEqual(ThreatLevel.HIGH);
    });
    
    it('should rate planeswalkers as high threat', () => {
      const planeswalker = createMockCard({
        name: 'Teferi, Time Raveler',
        type_line: 'Legendary Planeswalker — Teferi',
        oracle_text: 'Each opponent can cast spells only any time they could cast a sorcery.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(planeswalker);
      expect(analysis.threatLevel).toBeGreaterThanOrEqual(ThreatLevel.HIGH);
    });
    
    it('should rate win condition cards as game-winning threat', () => {
      const winCon = createMockCard({
        name: 'Thassa\'s Oracle',
        type_line: 'Creature — Merfolk Wizard',
        oracle_text: 'When Thassa\'s Oracle enters the battlefield, look at the top X cards of your library. If X is greater than or equal to the number of cards in your library, you win the game.',
        power: '1',
        toughness: '3',
      });
      
      const analysis = cardAnalyzer.analyzeCard(winCon);
      expect(analysis.threatLevel).toBe(ThreatLevel.GAME_WINNING);
    });
  });
  
  describe('Combo Detection', () => {
    it('should identify known combo pieces', () => {
      const dramRev = createMockCard({
        name: 'Dramatic Reversal',
        type_line: 'Instant',
        oracle_text: 'Untap all nonland permanents you control.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(dramRev);
      expect(analysis.comboPotential).toBeGreaterThanOrEqual(7);
    });
    
    it('should detect synergy between combo pieces', () => {
      const dramRev = createMockCard({
        name: 'Dramatic Reversal',
        type_line: 'Instant',
        oracle_text: 'Untap all nonland permanents you control.',
      });
      
      const scepter = createMockCard({
        name: 'Isochron Scepter',
        type_line: 'Artifact',
        oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card.',
      });
      
      const synergy = cardAnalyzer.checkSynergy(dramRev, scepter);
      expect(synergy.hasSynergy).toBe(true);
      expect(synergy.strength).toBeGreaterThanOrEqual(8);
    });
    
    it('should detect aristocrats synergies', () => {
      const bloodArtist = createMockCard({
        name: 'Blood Artist',
        type_line: 'Creature — Vampire',
        oracle_text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
        power: '0',
        toughness: '1',
      });
      
      const visceraSeer = createMockCard({
        name: 'Viscera Seer',
        type_line: 'Creature — Vampire Wizard',
        oracle_text: 'Sacrifice a creature: Scry 1.',
        power: '1',
        toughness: '1',
      });
      
      const synergy = cardAnalyzer.checkSynergy(bloodArtist, visceraSeer);
      expect(synergy.hasSynergy).toBe(true);
    });
  });
  
  describe('Sacrifice Target Selection', () => {
    it('should prefer creatures with beneficial death triggers for sacrifice', () => {
      const playerId = 'player1';
      
      const veteranExplorer = createMockPermanent(
        createMockCard({
          name: 'Veteran Explorer',
          type_line: 'Creature — Human Soldier Scout',
          oracle_text: 'When Veteran Explorer dies, each player may search their library for up to two basic land cards.',
          power: '1',
          toughness: '1',
        }),
        playerId
      );
      
      const grizzlyBears = createMockPermanent(
        createMockCard({
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        }),
        playerId
      );
      
      const result = cardAnalyzer.findBestSacrificeTarget(
        [grizzlyBears, veteranExplorer],
        true // prefer beneficial death
      );
      
      expect(result.creature).not.toBeNull();
      expect(result.creature?.id).toBe(veteranExplorer.id);
      expect(result.reason).toContain('Veteran Explorer');
    });
    
    it('should prefer tokens when no death triggers available', () => {
      const playerId = 'player1';
      
      const token = createMockPermanent(
        createMockCard({
          name: 'Soldier',
          type_line: 'Token Creature — Soldier',
          oracle_text: '',
          power: '1',
          toughness: '1',
        }),
        playerId
      );
      (token as any).isToken = true;
      
      const grizzlyBears = createMockPermanent(
        createMockCard({
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        }),
        playerId
      );
      
      const result = cardAnalyzer.findBestSacrificeTarget(
        [grizzlyBears, token],
        true
      );
      
      // Without death triggers, tokens should be preferred
      expect(result.creature).not.toBeNull();
    });
  });
  
  describe('Symmetric Effect Evaluation', () => {
    it('should recommend using Veteran Explorer when behind on lands', () => {
      const veteranExplorer = createMockCard({
        name: 'Veteran Explorer',
        type_line: 'Creature — Human Soldier Scout',
        oracle_text: 'When Veteran Explorer dies, each player may search their library for up to two basic land cards.',
        power: '1',
        toughness: '1',
      });
      
      // Player has 3 lands, opponents average 5 lands
      const result = cardAnalyzer.shouldUseSymmetricDeathEffect(
        veteranExplorer,
        3,               // own land count
        [5, 5, 5],       // opponent land counts
        [5, 5, 5]        // opponent threat levels
      );
      
      expect(result.shouldUse).toBe(true);
      expect(result.reason).toContain('Behind on lands');
    });
    
    it('should be cautious about using Veteran Explorer when ahead on board', () => {
      const veteranExplorer = createMockCard({
        name: 'Veteran Explorer',
        type_line: 'Creature — Human Soldier Scout',
        oracle_text: 'When Veteran Explorer dies, each player may search their library for up to two basic land cards.',
        power: '1',
        toughness: '1',
      });
      
      // Player has 6 lands, opponents have 5 but high threats
      const result = cardAnalyzer.shouldUseSymmetricDeathEffect(
        veteranExplorer,
        6,               // own land count
        [5, 5, 5],       // opponent land counts
        [15, 15, 15]     // HIGH opponent threat levels
      );
      
      expect(result.shouldUse).toBe(false);
      expect(result.reason).toContain('don\'t help them ramp');
    });
  });
  
  describe('Effect Details Extraction', () => {
    it('should detect combat keywords', () => {
      const creature = createMockCard({
        name: 'Baneslayer Angel',
        type_line: 'Creature — Angel',
        oracle_text: 'Flying, first strike, lifelink, protection from Demons and from Dragons.',
        power: '5',
        toughness: '5',
      });
      
      const analysis = cardAnalyzer.analyzeCard(creature);
      expect(analysis.details.combatKeywords).toContain('flying');
      expect(analysis.details.combatKeywords).toContain('first strike');
      expect(analysis.details.combatKeywords).toContain('lifelink');
    });
    
    it('should detect mana production', () => {
      const manaRock = createMockCard({
        name: 'Sol Ring',
        type_line: 'Artifact',
        oracle_text: '{T}: Add {C}{C}.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(manaRock);
      expect(analysis.details.producesMana).toBe(true);
    });
    
    it('should detect card draw abilities', () => {
      const drawEngine = createMockCard({
        name: 'Rhystic Study',
        type_line: 'Enchantment',
        oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(drawEngine);
      expect(analysis.details.drawsCards).toBe(true);
    });
    
    it('should detect ETB triggers', () => {
      const etbCreature = createMockCard({
        name: 'Mulldrifter',
        type_line: 'Creature — Elemental',
        oracle_text: 'Flying. When Mulldrifter enters the battlefield, draw two cards.',
        power: '2',
        toughness: '2',
      });
      
      const analysis = cardAnalyzer.analyzeCard(etbCreature);
      expect(analysis.details.hasETBTrigger).toBe(true);
      expect(analysis.details.drawsCards).toBe(true);
    });
    
    it('should detect activated abilities', () => {
      const activatedAbility = createMockCard({
        name: 'Birds of Paradise',
        type_line: 'Creature — Bird',
        oracle_text: 'Flying. {T}: Add one mana of any color.',
        power: '0',
        toughness: '1',
      });
      
      const analysis = cardAnalyzer.analyzeCard(activatedAbility);
      expect(analysis.details.hasActivatedAbility).toBe(true);
      expect(analysis.details.producesMana).toBe(true);
    });
    
    it('should detect landfall abilities', () => {
      const landfallCard = createMockCard({
        name: 'Avenger of Zendikar',
        type_line: 'Creature — Elemental',
        oracle_text: 'When Avenger of Zendikar enters the battlefield, create a 0/1 green Plant creature token for each land you control. Landfall — Whenever a land enters the battlefield under your control, you may put a +1/+1 counter on each Plant creature you control.',
        power: '5',
        toughness: '5',
      });
      
      const analysis = cardAnalyzer.analyzeCard(landfallCard);
      expect(analysis.details.hasLandfall).toBe(true);
      expect(analysis.details.hasETBTrigger).toBe(true);
      expect(analysis.details.createsTokens).toBe(true);
    });
  });
  
  describe('Synergy Tags', () => {
    it('should tag aristocrats cards appropriately', () => {
      const bloodArtist = createMockCard({
        name: 'Blood Artist',
        type_line: 'Creature — Vampire',
        oracle_text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
        power: '0',
        toughness: '1',
      });
      
      const analysis = cardAnalyzer.analyzeCard(bloodArtist);
      expect(analysis.synergyTags).toContain('aristocrats');
    });
    
    it('should tag token generators appropriately', () => {
      const tokenGen = createMockCard({
        name: 'Krenko, Mob Boss',
        type_line: 'Legendary Creature — Goblin Warrior',
        oracle_text: '{T}: Create X 1/1 red Goblin creature tokens.',
        power: '3',
        toughness: '3',
      });
      
      const analysis = cardAnalyzer.analyzeCard(tokenGen);
      expect(analysis.synergyTags).toContain('tokens');
    });
    
    it('should tag graveyard cards appropriately', () => {
      const graveyardCard = createMockCard({
        name: 'Animate Dead',
        type_line: 'Enchantment — Aura',
        oracle_text: 'When Animate Dead enters the battlefield, return target creature card from a graveyard to the battlefield.',
      });
      
      const analysis = cardAnalyzer.analyzeCard(graveyardCard);
      expect(analysis.synergyTags).toContain('graveyard');
    });
    
    it('should tag landfall cards appropriately', () => {
      const landfallCard = createMockCard({
        name: 'Omnath, Locus of Rage',
        type_line: 'Legendary Creature — Elemental',
        oracle_text: 'Landfall — Whenever a land enters the battlefield under your control, create a 5/5 red and green Elemental creature token.',
        power: '5',
        toughness: '5',
      });
      
      const analysis = cardAnalyzer.analyzeCard(landfallCard);
      expect(analysis.synergyTags).toContain('landfall');
    });
  });
});
