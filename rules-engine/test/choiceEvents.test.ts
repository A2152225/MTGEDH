/**
 * choiceEvents.test.ts
 * 
 * Tests for the choice event system
 */

import { describe, it, expect } from 'vitest';
import {
  ChoiceEventType,
  createTargetSelectionEvent,
  createModeSelectionEvent,
  createXValueSelectionEvent,
  createAttackerDeclarationEvent,
  createBlockerDeclarationEvent,
  createMayAbilityEvent,
  createCombatDamageAssignmentEvent,
  createBlockerOrderEvent,
  createDiscardSelectionEvent,
  createTokenCeasesToExistEvent,
  createCopyCeasesToExistEvent,
  createCommanderZoneChoiceEvent,
  createTriggerOrderEvent,
  createReplacementEffectChoiceEvent,
  createWinEffectTriggeredEvent,
  createColorChoiceEvent,
  createCreatureTypeChoiceEvent,
  createNumberChoiceEvent,
  createPlayerChoiceEvent,
  createOptionChoiceEvent,
} from '../src/choiceEvents';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

describe('Choice Events', () => {
  describe('createTargetSelectionEvent', () => {
    it('should create a target selection event with valid targets', () => {
      const validTargets = [
        { id: 'target-1', name: 'Grizzly Bears', imageUrl: 'http://example.com/bears.jpg' },
        { id: 'target-2', name: 'Lightning Bolt Target' },
      ];
      
      const event = createTargetSelectionEvent(
        'player-1',
        'spell-1',
        'Lightning Bolt',
        validTargets,
        ['creature', 'player'],
        1,
        1,
        true,
        'http://example.com/bolt.jpg'
      );
      
      expect(event.type).toBe(ChoiceEventType.TARGET_SELECTION);
      expect(event.playerId).toBe('player-1');
      expect(event.sourceId).toBe('spell-1');
      expect(event.sourceName).toBe('Lightning Bolt');
      expect(event.validTargets.length).toBe(2);
      expect(event.targetTypes).toContain('creature');
      expect(event.minTargets).toBe(1);
      expect(event.maxTargets).toBe(1);
      expect(event.mandatory).toBe(true);
    });
    
    it('should create event for "up to" targeting', () => {
      const event = createTargetSelectionEvent(
        'player-1',
        'spell-1',
        'Swords to Plowshares',
        [{ id: 'creature-1', name: 'Target Creature' }],
        ['creature'],
        0,
        1,
        false
      );
      
      expect(event.minTargets).toBe(0);
      expect(event.maxTargets).toBe(1);
      expect(event.mandatory).toBe(false);
    });
  });
  
  describe('createModeSelectionEvent', () => {
    it('should create mode selection for modal spell', () => {
      const modes = [
        { id: 'mode-1', text: 'Destroy target creature' },
        { id: 'mode-2', text: 'Destroy target artifact' },
        { id: 'mode-3', text: 'Destroy target enchantment' },
      ];
      
      const event = createModeSelectionEvent(
        'player-1',
        'spell-1',
        'Abrupt Decay',
        modes,
        1,
        1
      );
      
      expect(event.type).toBe(ChoiceEventType.MODE_SELECTION);
      expect(event.modes.length).toBe(3);
      expect(event.minModes).toBe(1);
      expect(event.maxModes).toBe(1);
      expect(event.allowDuplicates).toBe(false);
    });
    
    it('should support "choose two" modes', () => {
      const event = createModeSelectionEvent(
        'player-1',
        'spell-1',
        'Cryptic Command',
        [
          { id: '1', text: 'Counter target spell' },
          { id: '2', text: 'Return target permanent to hand' },
          { id: '3', text: 'Tap all creatures' },
          { id: '4', text: 'Draw a card' },
        ],
        2,
        2
      );
      
      expect(event.minModes).toBe(2);
      expect(event.maxModes).toBe(2);
    });
  });
  
  describe('createXValueSelectionEvent', () => {
    it('should create X value selection', () => {
      const event = createXValueSelectionEvent(
        'player-1',
        'spell-1',
        'Fireball',
        0,
        10,
        'http://example.com/fireball.jpg',
        '{1}'
      );
      
      expect(event.type).toBe(ChoiceEventType.X_VALUE_SELECTION);
      expect(event.minX).toBe(0);
      expect(event.maxX).toBe(10);
      expect(event.costPerX).toBe('{1}');
    });
  });
  
  describe('createMayAbilityEvent', () => {
    it('should create may ability event', () => {
      const event = createMayAbilityEvent(
        'player-1',
        'trigger-1',
        'Soul Warden',
        'You may gain 1 life',
        undefined,
        'http://example.com/warden.jpg'
      );
      
      expect(event.type).toBe(ChoiceEventType.MAY_ABILITY);
      expect(event.abilityText).toBe('You may gain 1 life');
      expect(event.mandatory).toBe(false);
      expect(event.defaultChoice).toBe('no');
    });
    
    it('should include cost when present', () => {
      const event = createMayAbilityEvent(
        'player-1',
        'trigger-1',
        'Rhystic Study',
        'You may draw a card',
        '{1}'
      );
      
      expect(event.cost).toBe('{1}');
    });
  });
  
  describe('createCombatDamageAssignmentEvent', () => {
    it('should create damage assignment for multiple blockers', () => {
      const blockers = [
        { id: 'blocker-1', name: 'First Blocker', toughness: 3, existingDamage: 0, lethalDamage: 3 },
        { id: 'blocker-2', name: 'Second Blocker', toughness: 2, existingDamage: 0, lethalDamage: 2 },
      ];
      
      const event = createCombatDamageAssignmentEvent(
        'player-1',
        'attacker-1',
        'Big Creature',
        7,
        blockers,
        false,
        undefined
      );
      
      expect(event.type).toBe(ChoiceEventType.COMBAT_DAMAGE_ASSIGNMENT);
      expect(event.attackerId).toBe('attacker-1');
      expect(event.attackerPower).toBe(7);
      expect(event.blockers.length).toBe(2);
      expect(event.hasTrample).toBe(false);
    });
    
    it('should include trample info', () => {
      const event = createCombatDamageAssignmentEvent(
        'player-1',
        'attacker-1',
        'Trample Creature',
        10,
        [{ id: 'blocker-1', name: 'Blocker', toughness: 3, existingDamage: 0, lethalDamage: 3 }],
        true,
        'player-2'
      );
      
      expect(event.hasTrample).toBe(true);
      expect(event.defendingPlayerId).toBe('player-2');
    });
  });
  
  describe('createDiscardSelectionEvent', () => {
    it('should create discard event for cleanup', () => {
      const hand = [
        { id: 'card-1', name: 'Card 1' } as KnownCardRef,
        { id: 'card-2', name: 'Card 2' } as KnownCardRef,
        { id: 'card-3', name: 'Card 3' } as KnownCardRef,
        { id: 'card-4', name: 'Card 4' } as KnownCardRef,
        { id: 'card-5', name: 'Card 5' } as KnownCardRef,
        { id: 'card-6', name: 'Card 6' } as KnownCardRef,
        { id: 'card-7', name: 'Card 7' } as KnownCardRef,
        { id: 'card-8', name: 'Card 8' } as KnownCardRef,
        { id: 'card-9', name: 'Card 9' } as KnownCardRef,
      ];
      
      const event = createDiscardSelectionEvent(
        'player-1',
        hand,
        2,
        7,
        'cleanup'
      );
      
      expect(event.type).toBe(ChoiceEventType.DISCARD_SELECTION);
      expect(event.discardCount).toBe(2);
      expect(event.currentHandSize).toBe(9);
      expect(event.maxHandSize).toBe(7);
      expect(event.reason).toBe('cleanup');
      expect(event.hand.length).toBe(9);
    });
    
    it('should create discard event for spell effect', () => {
      const event = createDiscardSelectionEvent(
        'player-1',
        [{ id: 'card-1', name: 'Card' } as KnownCardRef],
        1,
        7,
        'effect',
        'spell-1',
        'Mind Rot'
      );
      
      expect(event.reason).toBe('effect');
      expect(event.sourceId).toBe('spell-1');
      expect(event.sourceName).toBe('Mind Rot');
    });
  });
  
  describe('createTokenCeasesToExistEvent', () => {
    it('should create token cease to exist notification', () => {
      const tokens = [
        { id: 'token-1', name: 'Zombie Token' },
        { id: 'token-2', name: 'Zombie Token' },
      ];
      
      const event = createTokenCeasesToExistEvent('player-1', tokens, 'graveyard');
      
      expect(event.type).toBe(ChoiceEventType.TOKEN_CEASES_TO_EXIST);
      expect(event.tokenIds.length).toBe(2);
      expect(event.tokenNames).toContain('Zombie Token');
      expect(event.zone).toBe('graveyard');
      expect(event.mandatory).toBe(false);
    });
  });
  
  describe('createCopyCeasesToExistEvent', () => {
    it('should create copy cease to exist event (Rule 704.5e)', () => {
      const event = createCopyCeasesToExistEvent(
        'player-1',
        'copy-1',
        'Copy of Lightning Bolt',
        'spell',
        'graveyard',
        'original-1',
        'Lightning Bolt'
      );
      
      expect(event.type).toBe(ChoiceEventType.COPY_CEASES_TO_EXIST);
      expect(event.copyId).toBe('copy-1');
      expect(event.copyType).toBe('spell');
      expect(event.zone).toBe('graveyard');
      expect(event.originalName).toBe('Lightning Bolt');
    });
  });
  
  describe('createCommanderZoneChoiceEvent', () => {
    it('should create commander zone choice event', () => {
      const event = createCommanderZoneChoiceEvent(
        'player-1',
        'commander-1',
        'Prossh, Skyraider of Kher',
        'graveyard'
      );
      
      expect(event.type).toBe(ChoiceEventType.COMMANDER_ZONE_CHOICE);
      expect(event.commanderId).toBe('commander-1');
      expect(event.commanderName).toBe('Prossh, Skyraider of Kher');
      expect(event.fromZone).toBe('graveyard');
      expect(event.mandatory).toBe(false);
    });
  });
  
  describe('createTriggerOrderEvent', () => {
    it('should create trigger order event', () => {
      const triggers = [
        { id: 'trigger-1', sourceName: 'Soul Warden', description: 'Gain 1 life' },
        { id: 'trigger-2', sourceName: 'Essence Warden', description: 'Gain 1 life' },
        { id: 'trigger-3', sourceName: 'Ajani\'s Welcome', description: 'Gain 1 life' },
      ];
      
      const event = createTriggerOrderEvent('player-1', triggers);
      
      expect(event.type).toBe(ChoiceEventType.TRIGGER_ORDER);
      expect(event.triggers.length).toBe(3);
      expect(event.requireAll).toBe(true);
      expect(event.mandatory).toBe(true);
    });
  });
  
  describe('createReplacementEffectChoiceEvent', () => {
    it('should create replacement effect choice event', () => {
      const effects = [
        { id: 'effect-1', sourceName: 'Rest in Peace', description: 'Exile instead' },
        { id: 'effect-2', sourceName: 'Leyline of the Void', description: 'Exile instead' },
      ];
      
      const event = createReplacementEffectChoiceEvent(
        'player-1',
        'player-2',
        'Card would be put into graveyard',
        effects
      );
      
      expect(event.type).toBe(ChoiceEventType.REPLACEMENT_EFFECT_CHOICE);
      expect(event.replacementEffects.length).toBe(2);
      expect(event.affectedEvent).toBe('Card would be put into graveyard');
      expect(event.affectedPlayerId).toBe('player-2');
    });
  });
  
  describe('createWinEffectTriggeredEvent', () => {
    it('should create win effect event', () => {
      const event = createWinEffectTriggeredEvent(
        'player-1',
        'Empty library draw win',
        'lab-man-1',
        'Laboratory Maniac'
      );
      
      expect(event.type).toBe(ChoiceEventType.WIN_EFFECT_TRIGGERED);
      expect(event.winningPlayerId).toBe('player-1');
      expect(event.winReason).toBe('Empty library draw win');
      expect(event.sourceName).toBe('Laboratory Maniac');
    });
  });
  
  describe('createColorChoiceEvent', () => {
    it('should create color choice event', () => {
      const event = createColorChoiceEvent('player-1', 'spell-1', 'Painter\'s Servant');
      
      expect(event.type).toBe(ChoiceEventType.COLOR_CHOICE);
      expect(event.colors.length).toBe(5);
      expect(event.colors.some(c => c.id === 'W')).toBe(true);
      expect(event.colors.some(c => c.id === 'U')).toBe(true);
      expect(event.colors.some(c => c.id === 'B')).toBe(true);
      expect(event.colors.some(c => c.id === 'R')).toBe(true);
      expect(event.colors.some(c => c.id === 'G')).toBe(true);
    });
  });
  
  describe('createCreatureTypeChoiceEvent', () => {
    it('should create creature type choice event with suggestions', () => {
      const event = createCreatureTypeChoiceEvent(
        'player-1',
        'spell-1',
        'Cavern of Souls',
        ['Human', 'Elf', 'Goblin']
      );
      
      expect(event.type).toBe(ChoiceEventType.CREATURE_TYPE_CHOICE);
      expect(event.suggestedTypes).toContain('Human');
      expect(event.suggestedTypes).toContain('Elf');
      expect(event.allowCustom).toBe(true);
    });
    
    it('should provide default suggestions when none provided', () => {
      const event = createCreatureTypeChoiceEvent('player-1', 'spell-1', 'Metallic Mimic');
      
      expect(event.suggestedTypes.length).toBeGreaterThan(0);
      expect(event.suggestedTypes).toContain('Human');
      expect(event.suggestedTypes).toContain('Elf');
    });
  });
  
  describe('createNumberChoiceEvent', () => {
    it('should create number choice event', () => {
      const event = createNumberChoiceEvent('player-1', 'spell-1', 'Fireball', 0, 10, 5);
      
      expect(event.type).toBe(ChoiceEventType.NUMBER_CHOICE);
      expect(event.minValue).toBe(0);
      expect(event.maxValue).toBe(10);
      expect(event.defaultValue).toBe(5);
    });
  });
  
  describe('createPlayerChoiceEvent', () => {
    it('should create player choice event', () => {
      const players = [
        { id: 'player-1', name: 'Alice' },
        { id: 'player-2', name: 'Bob' },
        { id: 'player-3', name: 'Charlie' },
      ];
      
      const event = createPlayerChoiceEvent(
        'player-1',
        'spell-1',
        'Donate',
        players,
        false,
        true
      );
      
      expect(event.type).toBe(ChoiceEventType.PLAYER_CHOICE);
      expect(event.validPlayers.length).toBe(3);
      expect(event.allowSelf).toBe(false);
      expect(event.allowOpponents).toBe(true);
    });
  });
  
  describe('createOptionChoiceEvent', () => {
    it('should create generic option choice event', () => {
      const options = [
        { id: 'option-1', label: 'Draw a card', description: 'Good for card advantage' },
        { id: 'option-2', label: 'Gain 3 life', description: 'Survives longer' },
      ];
      
      const event = createOptionChoiceEvent(
        'player-1',
        'spell-1',
        'Charm',
        'Choose an option',
        options,
        1,
        1
      );
      
      expect(event.type).toBe(ChoiceEventType.OPTION_CHOICE);
      expect(event.options.length).toBe(2);
      expect(event.minSelections).toBe(1);
      expect(event.maxSelections).toBe(1);
    });
  });
  
  describe('Event IDs are unique', () => {
    it('should generate unique event IDs', () => {
      const event1 = createColorChoiceEvent('player-1', 'spell-1', 'Test');
      const event2 = createColorChoiceEvent('player-1', 'spell-1', 'Test');
      
      expect(event1.id).not.toBe(event2.id);
    });
  });
});
