/**
 * modalTriggeredAbilities.test.ts
 * 
 * Tests for modal triggered abilities including:
 * - Black Market Connections (choose up to 3)
 * - Command cards (choose 2)
 * - Entwine (choose 1 OR pay entwine to get both)
 * - Spree (choose 1+ with costs per mode)
 * - Tiered (choose 1 with cost)
 * - Escalate (choose 1+, pay per additional mode)
 * - Cipher (encode spell, cast on combat damage)
 */

import { describe, it, expect } from 'vitest';
import {
  parseModalTriggeredAbility,
  parseModalTriggerText,
  validateModalTriggerSelection,
  getSelectedModeEffects,
  isBlackMarketConnections,
  createBlackMarketConnectionsAbility,
  createSpreeAbilityModes,
  createTieredAbilityModes,
  createEscalateAbilityModes,
  calculateEscalateCost,
  createCommandAbilityModes,
  createCrypticCommandModes,
  createKolaghansCommandModes,
  createEntwineAbilityModes,
  applyEntwine,
  validateEntwineSelection,
  createCipherRegistry,
  getValidCipherTargets,
  createCipherEncodingChoice,
  validateCipherEncodingTarget,
  encodeSpellOntoCreature,
  getEncodedSpells,
  removeEncodedSpells,
  checkCipherTriggers,
  createCipherCastEvent,
  getValidNinjutsuTargets,
  canActivateNinjutsu,
  createNinjutsuActivationChoice,
  validateNinjutsuTarget,
  processNinjutsuActivation,
} from '../src/modalTriggeredAbilities';

describe('Modal Triggered Abilities', () => {
  describe('Black Market Connections', () => {
    it('should detect Black Market Connections pattern', () => {
      const oracleText = 'At the beginning of your precombat main phase, choose up to three —';
      expect(isBlackMarketConnections(oracleText)).toBe(true);
    });
    
    it('should not detect non-BMC patterns', () => {
      const oracleText = 'At the beginning of your upkeep, draw a card.';
      expect(isBlackMarketConnections(oracleText)).toBe(false);
    });
    
    it('should create BMC ability with 0-3 mode selection', () => {
      const ability = createBlackMarketConnectionsAbility('bmc-1', 'player-1');
      
      expect(ability.sourceName).toBe('Black Market Connections');
      expect(ability.modes.length).toBe(3);
      expect(ability.minModes).toBe(0); // "choose up to" means can choose 0
      expect(ability.maxModes).toBe(3);
      expect(ability.canRepeatModes).toBe(false);
    });
    
    it('should validate selecting 0 modes (skip trigger)', () => {
      const ability = createBlackMarketConnectionsAbility('bmc-1', 'player-1');
      const selection = validateModalTriggerSelection(ability, []);
      
      expect(selection.isValid).toBe(true);
      expect(selection.selectedModeIds.length).toBe(0);
    });
    
    it('should validate selecting 1 mode', () => {
      const ability = createBlackMarketConnectionsAbility('bmc-1', 'player-1');
      const selection = validateModalTriggerSelection(ability, ['sell-contraband']);
      
      expect(selection.isValid).toBe(true);
      expect(selection.totalCost).toContain('1 life');
    });
    
    it('should validate selecting all 3 modes', () => {
      const ability = createBlackMarketConnectionsAbility('bmc-1', 'player-1');
      const selection = validateModalTriggerSelection(ability, [
        'sell-contraband',
        'buy-information',
        'hire-mercenary',
      ]);
      
      expect(selection.isValid).toBe(true);
      expect(selection.selectedModeIds.length).toBe(3);
    });
    
    it('should reject duplicate mode selection', () => {
      const ability = createBlackMarketConnectionsAbility('bmc-1', 'player-1');
      const selection = validateModalTriggerSelection(ability, [
        'sell-contraband',
        'sell-contraband',
      ]);
      
      expect(selection.isValid).toBe(false);
      expect(selection.errors.some(e => e.includes('same mode'))).toBe(true);
    });
    
    it('should get selected mode effects', () => {
      const ability = createBlackMarketConnectionsAbility('bmc-1', 'player-1');
      const effects = getSelectedModeEffects(ability, ['buy-information', 'hire-mercenary']);
      
      expect(effects.length).toBe(2);
      expect(effects[0].text).toBe('Buy Information');
      expect(effects[1].text).toBe('Hire a Mercenary');
    });
  });
  
  describe('Command Cards (Choose Two)', () => {
    it('should create Cryptic Command with choose-two', () => {
      const ability = createCrypticCommandModes('cc-1', 'player-1');
      
      expect(ability.sourceName).toBe('Cryptic Command');
      expect(ability.modes.length).toBe(4);
      expect(ability.minModes).toBe(2);
      expect(ability.maxModes).toBe(2);
    });
    
    it('should validate selecting exactly 2 modes', () => {
      const ability = createCrypticCommandModes('cc-1', 'player-1');
      const selection = validateModalTriggerSelection(ability, [
        'command-mode-0', // Counter
        'command-mode-3', // Draw
      ]);
      
      expect(selection.isValid).toBe(true);
    });
    
    it('should reject selecting only 1 mode', () => {
      const ability = createCrypticCommandModes('cc-1', 'player-1');
      const selection = validateModalTriggerSelection(ability, ['command-mode-0']);
      
      expect(selection.isValid).toBe(false);
      expect(selection.errors.some(e => e.includes('at least 2'))).toBe(true);
    });
    
    it('should reject selecting 3 modes', () => {
      const ability = createCrypticCommandModes('cc-1', 'player-1');
      const selection = validateModalTriggerSelection(ability, [
        'command-mode-0',
        'command-mode-1',
        'command-mode-2',
      ]);
      
      expect(selection.isValid).toBe(false);
      expect(selection.errors.some(e => e.includes('at most 2'))).toBe(true);
    });
    
    it('should create Kolaghans Command', () => {
      const ability = createKolaghansCommandModes('kc-1', 'player-1');
      
      expect(ability.sourceName).toBe('Kolaghan\'s Command');
      expect(ability.modes.length).toBe(4);
      expect(ability.minModes).toBe(2);
      expect(ability.maxModes).toBe(2);
    });
  });
  
  describe('Entwine', () => {
    it('should create entwine ability with 1 mode by default', () => {
      const ability = createEntwineAbilityModes(
        'tooth-1',
        'Tooth and Nail',
        'player-1',
        [
          { text: 'Search for creatures', effect: 'Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle.' },
          { text: 'Put creatures onto battlefield', effect: 'Put up to two creature cards from your hand onto the battlefield.' },
        ],
        '{2}'
      );
      
      expect(ability.minModes).toBe(1);
      expect(ability.maxModes).toBe(1);
      expect(ability.entwineCost).toBe('{2}');
      expect(ability.isEntwined).toBe(false);
    });
    
    it('should allow applying entwine to get all modes', () => {
      const ability = createEntwineAbilityModes(
        'tooth-1',
        'Tooth and Nail',
        'player-1',
        [
          { text: 'Search', effect: 'Search effect' },
          { text: 'Put', effect: 'Put effect' },
        ],
        '{2}'
      );
      
      const entwined = applyEntwine(ability);
      
      expect(entwined.minModes).toBe(2);
      expect(entwined.maxModes).toBe(2);
      expect(entwined.isEntwined).toBe(true);
    });
    
    it('should validate entwine selection requires all modes', () => {
      const ability = createEntwineAbilityModes(
        'tooth-1',
        'Tooth and Nail',
        'player-1',
        [
          { text: 'Mode 1', effect: 'Effect 1' },
          { text: 'Mode 2', effect: 'Effect 2' },
        ],
        '{2}'
      );
      
      // Entwined but only selected 1 mode
      const selection = validateEntwineSelection(ability, ['entwine-mode-0'], true);
      
      expect(selection.isValid).toBe(false);
      expect(selection.errors.some(e => e.includes('all modes must be selected'))).toBe(true);
    });
    
    it('should validate entwine selection with all modes', () => {
      const ability = createEntwineAbilityModes(
        'tooth-1',
        'Tooth and Nail',
        'player-1',
        [
          { text: 'Mode 1', effect: 'Effect 1' },
          { text: 'Mode 2', effect: 'Effect 2' },
        ],
        '{2}'
      );
      
      const selection = validateEntwineSelection(ability, ['entwine-mode-0', 'entwine-mode-1'], true);
      
      expect(selection.isValid).toBe(true);
      expect(selection.totalCost).toBe('{2}');
    });
  });
  
  describe('Spree', () => {
    it('should create spree ability with costs per mode', () => {
      const ability = createSpreeAbilityModes(
        'spree-1',
        'Spree Spell',
        'player-1',
        [
          { text: 'Mode 1', cost: '{W}', effect: 'Gain 3 life' },
          { text: 'Mode 2', cost: '{R}', effect: 'Deal 3 damage' },
          { text: 'Mode 3', cost: '{G}', effect: 'Create a 3/3 token' },
        ]
      );
      
      expect(ability.minModes).toBe(1);
      expect(ability.maxModes).toBe(3);
      expect(ability.modes[0].cost).toBe('{W}');
      expect(ability.modes[1].cost).toBe('{R}');
    });
    
    it('should calculate total spree cost', () => {
      const ability = createSpreeAbilityModes(
        'spree-1',
        'Spree Spell',
        'player-1',
        [
          { text: 'Mode 1', cost: '{W}', effect: 'Effect 1' },
          { text: 'Mode 2', cost: '{R}', effect: 'Effect 2' },
        ]
      );
      
      const selection = validateModalTriggerSelection(ability, ['spree-mode-0', 'spree-mode-1']);
      
      expect(selection.isValid).toBe(true);
      expect(selection.totalCost).toContain('{W}');
      expect(selection.totalCost).toContain('{R}');
    });
  });
  
  describe('Tiered', () => {
    it('should create tiered ability with exactly 1 mode', () => {
      const ability = createTieredAbilityModes(
        'tiered-1',
        'Tiered Spell',
        'player-1',
        [
          { text: 'Basic', cost: '{1}', effect: 'Draw a card' },
          { text: 'Advanced', cost: '{3}', effect: 'Draw 2 cards' },
          { text: 'Ultimate', cost: '{5}', effect: 'Draw 3 cards' },
        ]
      );
      
      expect(ability.minModes).toBe(1);
      expect(ability.maxModes).toBe(1); // Tiered always chooses exactly 1
    });
    
    it('should reject selecting multiple modes', () => {
      const ability = createTieredAbilityModes(
        'tiered-1',
        'Tiered Spell',
        'player-1',
        [
          { text: 'Basic', cost: '{1}', effect: 'Effect 1' },
          { text: 'Advanced', cost: '{3}', effect: 'Effect 2' },
        ]
      );
      
      const selection = validateModalTriggerSelection(ability, ['tiered-mode-0', 'tiered-mode-1']);
      
      expect(selection.isValid).toBe(false);
    });
  });
  
  describe('Escalate', () => {
    it('should create escalate ability', () => {
      const ability = createEscalateAbilityModes(
        'escalate-1',
        'Collective Brutality',
        'player-1',
        [
          { text: 'Mode 1', effect: 'Effect 1' },
          { text: 'Mode 2', effect: 'Effect 2' },
          { text: 'Mode 3', effect: 'Effect 3' },
        ],
        'Discard a card'
      );
      
      expect(ability.minModes).toBe(1);
      expect(ability.maxModes).toBe(3);
      expect(ability.escalateCost).toBe('Discard a card');
      
      // First mode is free
      expect(ability.modes[0].cost).toBeUndefined();
      // Additional modes cost escalate
      expect(ability.modes[1].cost).toBe('Discard a card');
    });
    
    it('should calculate escalate cost correctly', () => {
      expect(calculateEscalateCost(1, '{1}')).toEqual({ count: 0, totalCost: 'None' });
      expect(calculateEscalateCost(2, '{1}')).toEqual({ count: 1, totalCost: '1 × {1}' });
      expect(calculateEscalateCost(3, '{1}')).toEqual({ count: 2, totalCost: '2 × {1}' });
    });
  });
  
  describe('Cipher', () => {
    it('should create empty cipher registry', () => {
      const registry = createCipherRegistry();
      expect(registry.encodedSpells).toEqual([]);
    });
    
    it('should encode spell onto creature', () => {
      let registry = createCipherRegistry();
      
      registry = encodeSpellOntoCreature(
        registry,
        'spell-1',
        'Hands of Binding',
        'Tap target creature...',
        'creature-1',
        'Invisible Stalker',
        'player-1'
      );
      
      expect(registry.encodedSpells.length).toBe(1);
      expect(registry.encodedSpells[0].spellName).toBe('Hands of Binding');
      expect(registry.encodedSpells[0].encodedOnCreatureName).toBe('Invisible Stalker');
    });
    
    it('should get encoded spells for a creature', () => {
      let registry = createCipherRegistry();
      
      registry = encodeSpellOntoCreature(
        registry,
        'spell-1',
        'Spell 1',
        'Effect 1',
        'creature-1',
        'Creature 1',
        'player-1'
      );
      
      registry = encodeSpellOntoCreature(
        registry,
        'spell-2',
        'Spell 2',
        'Effect 2',
        'creature-2',
        'Creature 2',
        'player-1'
      );
      
      const spells = getEncodedSpells(registry, 'creature-1');
      
      expect(spells.length).toBe(1);
      expect(spells[0].spellName).toBe('Spell 1');
    });
    
    it('should remove encoded spells when creature leaves', () => {
      let registry = createCipherRegistry();
      
      registry = encodeSpellOntoCreature(
        registry,
        'spell-1',
        'Spell 1',
        'Effect 1',
        'creature-1',
        'Creature 1',
        'player-1'
      );
      
      registry = removeEncodedSpells(registry, 'creature-1');
      
      expect(registry.encodedSpells.length).toBe(0);
    });
    
    it('should check cipher triggers on combat damage', () => {
      let registry = createCipherRegistry();
      
      registry = encodeSpellOntoCreature(
        registry,
        'spell-1',
        'Hands of Binding',
        'Tap target creature...',
        'creature-1',
        'Invisible Stalker',
        'player-1'
      );
      
      const triggers = checkCipherTriggers(registry, 'creature-1', 'player-2');
      
      expect(triggers.length).toBe(1);
      expect(triggers[0].description).toContain('Invisible Stalker dealt combat damage');
      expect(triggers[0].description).toContain('Hands of Binding');
    });
    
    it('should create cipher cast event as may ability', () => {
      const encodedSpell = {
        spellId: 'spell-1',
        spellName: 'Hands of Binding',
        spellOracleText: 'Tap target creature...',
        encodedOnCreatureId: 'creature-1',
        encodedOnCreatureName: 'Invisible Stalker',
        controllerId: 'player-1' as const,
        timestamp: Date.now(),
      };
      
      const event = createCipherCastEvent('player-1', encodedSpell);
      
      expect(event.type).toBe('cipher_cast');
      expect(event.isMay).toBe(true);
      expect(event.spellName).toBe('Hands of Binding');
    });
    
    it('should get valid cipher encoding targets (only controlled creatures)', () => {
      const creatures = [
        { id: 'creature-1', name: 'My Creature', controllerId: 'player-1' as const },
        { id: 'creature-2', name: 'Opponent Creature', controllerId: 'player-2' as const },
        { id: 'creature-3', name: 'My Other Creature', controllerId: 'player-1' as const },
      ];
      
      const validTargets = getValidCipherTargets(creatures, 'player-1');
      
      expect(validTargets.length).toBe(2);
      expect(validTargets.every(t => t.controllerId === 'player-1')).toBe(true);
      expect(validTargets.some(t => t.creatureName === 'My Creature')).toBe(true);
      expect(validTargets.some(t => t.creatureName === 'My Other Creature')).toBe(true);
    });
    
    it('should create cipher encoding choice with valid targets', () => {
      const creatures = [
        { id: 'creature-1', name: 'Invisible Stalker', controllerId: 'player-1' as const },
        { id: 'creature-2', name: 'Enemy Creature', controllerId: 'player-2' as const },
      ];
      
      const choice = createCipherEncodingChoice(
        'spell-1',
        'Hands of Binding',
        'player-1',
        creatures
      );
      
      expect(choice.type).toBe('cipher_encoding');
      expect(choice.isMay).toBe(true);
      expect(choice.validTargets.length).toBe(1);
      expect(choice.validTargets[0].creatureName).toBe('Invisible Stalker');
      expect(choice.description).toContain('cipher');
      expect(choice.description).toContain('Hands of Binding');
    });
    
    it('should validate cipher encoding target selection', () => {
      const creatures = [
        { id: 'creature-1', name: 'Valid Target', controllerId: 'player-1' as const },
      ];
      
      const choice = createCipherEncodingChoice(
        'spell-1',
        'Spell',
        'player-1',
        creatures
      );
      
      // Valid selection
      const validResult = validateCipherEncodingTarget(choice, 'creature-1');
      expect(validResult.isValid).toBe(true);
      expect(validResult.skipEncoding).toBe(false);
      
      // Skip encoding (chose not to encode)
      const skipResult = validateCipherEncodingTarget(choice, null);
      expect(skipResult.isValid).toBe(true);
      expect(skipResult.skipEncoding).toBe(true);
      
      // Invalid target
      const invalidResult = validateCipherEncodingTarget(choice, 'creature-999');
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.error).toContain('not a valid target');
    });
    
    it('should handle no valid cipher targets', () => {
      const creatures = [
        { id: 'creature-1', name: 'Enemy Only', controllerId: 'player-2' as const },
      ];
      
      const choice = createCipherEncodingChoice(
        'spell-1',
        'Spell',
        'player-1',
        creatures
      );
      
      expect(choice.validTargets.length).toBe(0);
    });
  });
  
  describe('parseModalTriggerText', () => {
    it('should parse "choose one or more" pattern', () => {
      const result = parseModalTriggerText(
        'At the beginning of your upkeep, choose one or more — • Mode 1 • Mode 2'
      );
      
      expect(result.isModal).toBe(true);
      expect(result.minModes).toBe(1);
      // maxModes will be adjusted to actual mode count
    });
    
    it('should parse "choose up to two" pattern', () => {
      const result = parseModalTriggerText(
        'When this enters the battlefield, choose up to two — • Mode 1 • Mode 2'
      );
      
      expect(result.isModal).toBe(true);
      expect(result.minModes).toBe(0);
      expect(result.maxModes).toBe(2);
    });
    
    it('should parse "choose two" pattern', () => {
      const result = parseModalTriggerText(
        'When you cast this spell, choose two — • Mode 1 • Mode 2 • Mode 3'
      );
      
      expect(result.isModal).toBe(true);
      expect(result.minModes).toBe(2);
      expect(result.maxModes).toBe(2);
    });
    
    it('should not parse non-modal text', () => {
      const result = parseModalTriggerText(
        'When this enters the battlefield, draw a card.'
      );
      
      expect(result.isModal).toBe(false);
    });
  });
  
  describe('Ninjutsu', () => {
    const createAttackingCreatures = () => [
      { id: 'creature-1', name: 'Unblocked Attacker', controllerId: 'player-1' as const, isBlocked: false },
      { id: 'creature-2', name: 'Blocked Attacker', controllerId: 'player-1' as const, isBlocked: true },
      { id: 'creature-3', name: 'Enemy Attacker', controllerId: 'player-2' as const, isBlocked: false },
    ];
    
    it('should get valid Ninjutsu targets (unblocked attackers you control)', () => {
      const creatures = createAttackingCreatures();
      const validTargets = getValidNinjutsuTargets(creatures, 'player-1');
      
      expect(validTargets.length).toBe(1);
      expect(validTargets[0].creatureName).toBe('Unblocked Attacker');
      expect(validTargets[0].isUnblocked).toBe(true);
      expect(validTargets[0].isValid).toBe(true);
    });
    
    it('should not include blocked creatures as valid targets', () => {
      const creatures = createAttackingCreatures();
      const validTargets = getValidNinjutsuTargets(creatures, 'player-1');
      
      expect(validTargets.some(t => t.creatureName === 'Blocked Attacker')).toBe(false);
    });
    
    it('should not include opponent creatures as valid targets', () => {
      const creatures = createAttackingCreatures();
      const validTargets = getValidNinjutsuTargets(creatures, 'player-1');
      
      expect(validTargets.some(t => t.creatureName === 'Enemy Attacker')).toBe(false);
    });
    
    it('should check if Ninjutsu can be activated', () => {
      const creatures = createAttackingCreatures();
      
      // Valid activation during declare blockers step
      const validResult = canActivateNinjutsu(creatures, 'player-1', 'declare_blockers');
      expect(validResult.canActivate).toBe(true);
      expect(validResult.validTargetCount).toBe(1);
      
      // Invalid during main phase
      const invalidResult = canActivateNinjutsu(creatures, 'player-1', 'main');
      expect(invalidResult.canActivate).toBe(false);
      expect(invalidResult.reason).toContain('after blockers are declared');
    });
    
    it('should not allow Ninjutsu with no valid targets', () => {
      const creatures = [
        { id: 'creature-1', name: 'Blocked', controllerId: 'player-1' as const, isBlocked: true },
      ];
      
      const result = canActivateNinjutsu(creatures, 'player-1', 'declare_blockers');
      
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('No unblocked attacking creatures');
    });
    
    it('should create Ninjutsu activation choice', () => {
      const creatures = createAttackingCreatures();
      
      const choice = createNinjutsuActivationChoice(
        'ninja-1',
        'Yuriko, the Tiger\'s Shadow',
        '{U}{B}',
        'player-1',
        creatures
      );
      
      expect(choice.type).toBe('ninjutsu_activation');
      expect(choice.ninjaCardName).toBe('Yuriko, the Tiger\'s Shadow');
      expect(choice.ninjutsuCost).toBe('{U}{B}');
      expect(choice.validTargets.length).toBe(1);
      expect(choice.description).toContain('Ninjutsu');
      expect(choice.description).toContain('unblocked attacking creature');
    });
    
    it('should validate Ninjutsu target selection', () => {
      const creatures = createAttackingCreatures();
      const choice = createNinjutsuActivationChoice(
        'ninja-1',
        'Ninja',
        '{1}{U}',
        'player-1',
        creatures
      );
      
      // Valid target
      const validResult = validateNinjutsuTarget(choice, 'creature-1');
      expect(validResult.isValid).toBe(true);
      expect(validResult.selectedTarget?.creatureName).toBe('Unblocked Attacker');
      
      // Invalid target (blocked creature - not in valid targets)
      const invalidResult = validateNinjutsuTarget(choice, 'creature-2');
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.error).toContain('not a valid target');
    });
    
    it('should process Ninjutsu activation', () => {
      const creatures = createAttackingCreatures();
      const choice = createNinjutsuActivationChoice(
        'ninja-1',
        'Ink-Eyes, Servant of Oni',
        '{3}{B}{B}',
        'player-1',
        creatures
      );
      
      const result = processNinjutsuActivation(choice, 'creature-1', 'player-2');
      
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.ninjaCardName).toBe('Ink-Eyes, Servant of Oni');
        expect(result.returnedCreatureName).toBe('Unblocked Attacker');
        expect(result.defendingPlayerId).toBe('player-2');
        expect(result.log.length).toBeGreaterThan(0);
        expect(result.log.some(l => l.includes('enters the battlefield tapped and attacking'))).toBe(true);
      }
    });
    
    it('should fail Ninjutsu activation with invalid target', () => {
      const creatures = createAttackingCreatures();
      const choice = createNinjutsuActivationChoice(
        'ninja-1',
        'Ninja',
        '{1}{U}',
        'player-1',
        creatures
      );
      
      const result = processNinjutsuActivation(choice, 'creature-999');
      
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('not a valid target');
      }
    });
  });
});
