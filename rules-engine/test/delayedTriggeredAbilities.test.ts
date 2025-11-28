/**
 * Tests for delayed triggered abilities
 */
import { describe, it, expect } from 'vitest';
import {
  DelayedTriggerTiming,
  createDelayedTriggerRegistry,
  createDelayedTrigger,
  registerDelayedTrigger,
  checkDelayedTriggers,
  processDelayedTriggers,
  expireDelayedTriggers,
  parseDelayedTriggerFromText,
  createFlickerReturnTrigger,
  createSacrificeAtEndTrigger,
  createWhenLeavesTrigger,
  createNextUpkeepTrigger,
} from '../src/delayedTriggeredAbilities';

describe('Delayed Triggered Abilities', () => {
  describe('createDelayedTriggerRegistry', () => {
    it('should create an empty registry', () => {
      const registry = createDelayedTriggerRegistry();
      
      expect(registry.triggers).toHaveLength(0);
      expect(registry.firedTriggerIds).toHaveLength(0);
    });
  });
  
  describe('createDelayedTrigger', () => {
    it('should create a delayed trigger', () => {
      const trigger = createDelayedTrigger(
        'source-1',
        'Test Card',
        'player1',
        DelayedTriggerTiming.NEXT_END_STEP,
        'Return exiled card',
        1
      );
      
      expect(trigger.sourceId).toBe('source-1');
      expect(trigger.sourceName).toBe('Test Card');
      expect(trigger.controllerId).toBe('player1');
      expect(trigger.timing).toBe(DelayedTriggerTiming.NEXT_END_STEP);
      expect(trigger.effect).toBe('Return exiled card');
      expect(trigger.createdOnTurn).toBe(1);
      expect(trigger.fired).toBe(false);
      expect(trigger.oneShot).toBe(true);
    });
    
    it('should include optional parameters', () => {
      const trigger = createDelayedTrigger(
        'source-1',
        'Test Card',
        'player1',
        DelayedTriggerTiming.WHEN_LEAVES,
        'Return exiled card',
        1,
        {
          watchingPermanentId: 'perm-1',
          targets: ['target-1', 'target-2'],
          oneShot: false,
        }
      );
      
      expect(trigger.watchingPermanentId).toBe('perm-1');
      expect(trigger.targets).toHaveLength(2);
      expect(trigger.oneShot).toBe(false);
    });
  });
  
  describe('registerDelayedTrigger', () => {
    it('should add trigger to registry', () => {
      const registry = createDelayedTriggerRegistry();
      const trigger = createDelayedTrigger(
        'source-1', 'Test', 'player1', 
        DelayedTriggerTiming.NEXT_END_STEP, 'Effect', 1
      );
      
      const updated = registerDelayedTrigger(registry, trigger);
      
      expect(updated.triggers).toHaveLength(1);
    });
    
    it('should accumulate triggers', () => {
      let registry = createDelayedTriggerRegistry();
      
      registry = registerDelayedTrigger(registry, 
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.NEXT_END_STEP, 'E1', 1)
      );
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s2', 'T2', 'p1', DelayedTriggerTiming.NEXT_UPKEEP, 'E2', 1)
      );
      
      expect(registry.triggers).toHaveLength(2);
    });
  });
  
  describe('checkDelayedTriggers', () => {
    it('should fire end step triggers at end step', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.NEXT_END_STEP, 'E1', 1)
      );
      
      const { triggersToFire, remainingTriggers } = checkDelayedTriggers(registry, {
        type: 'end_step',
        activePlayerId: 'p1',
      });
      
      expect(triggersToFire).toHaveLength(1);
      expect(remainingTriggers).toHaveLength(0); // One-shot removed
    });
    
    it('should not fire end step triggers at upkeep', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.NEXT_END_STEP, 'E1', 1)
      );
      
      const { triggersToFire } = checkDelayedTriggers(registry, {
        type: 'upkeep',
        activePlayerId: 'p1',
      });
      
      expect(triggersToFire).toHaveLength(0);
    });
    
    it('should fire your end step triggers only on your end step', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'player1', DelayedTriggerTiming.YOUR_NEXT_END_STEP, 'E1', 1)
      );
      
      // Not player1's end step
      const { triggersToFire: noFire } = checkDelayedTriggers(registry, {
        type: 'end_step',
        activePlayerId: 'player2',
      });
      expect(noFire).toHaveLength(0);
      
      // Player1's end step
      const { triggersToFire: fire } = checkDelayedTriggers(registry, {
        type: 'end_step',
        activePlayerId: 'player1',
      });
      expect(fire).toHaveLength(1);
    });
    
    it('should fire upkeep triggers at upkeep', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.NEXT_UPKEEP, 'E1', 1)
      );
      
      const { triggersToFire } = checkDelayedTriggers(registry, {
        type: 'upkeep',
        activePlayerId: 'p1',
      });
      
      expect(triggersToFire).toHaveLength(1);
    });
    
    it('should fire when-leaves triggers when permanent leaves', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'Fiend Hunter', 'p1', DelayedTriggerTiming.WHEN_LEAVES, 'Return card', 1, {
          watchingPermanentId: 'fiend-hunter-perm'
        })
      );
      
      // Wrong permanent
      const { triggersToFire: noFire } = checkDelayedTriggers(registry, {
        type: 'permanent_left',
        permanentId: 'other-perm',
      });
      expect(noFire).toHaveLength(0);
      
      // Correct permanent
      const { triggersToFire: fire } = checkDelayedTriggers(registry, {
        type: 'permanent_left',
        permanentId: 'fiend-hunter-perm',
      });
      expect(fire).toHaveLength(1);
    });
    
    it('should fire end of combat triggers', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.END_OF_COMBAT, 'E1', 1)
      );
      
      const { triggersToFire } = checkDelayedTriggers(registry, {
        type: 'combat_end',
      });
      
      expect(triggersToFire).toHaveLength(1);
    });
    
    it('should keep non-one-shot triggers', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.EACH_END_STEP, 'E1', 1, {
          oneShot: false,
        })
      );
      
      const { triggersToFire, remainingTriggers } = checkDelayedTriggers(registry, {
        type: 'end_step',
      });
      
      expect(triggersToFire).toHaveLength(1);
      expect(remainingTriggers).toHaveLength(1); // Still there
    });
    
    it('should fire next turn triggers', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.NEXT_TURN, 'E1', 1)
      );
      
      // Same turn
      const { triggersToFire: noFire } = checkDelayedTriggers(registry, {
        type: 'turn_start',
        currentTurn: 1,
      });
      expect(noFire).toHaveLength(0);
      
      // Next turn
      const { triggersToFire: fire } = checkDelayedTriggers(registry, {
        type: 'turn_start',
        currentTurn: 2,
      });
      expect(fire).toHaveLength(1);
    });
  });
  
  describe('processDelayedTriggers', () => {
    it('should create trigger instances', () => {
      const trigger = createDelayedTrigger(
        'source-1', 'Test Card', 'player1',
        DelayedTriggerTiming.NEXT_END_STEP, 'Return card', 1
      );
      
      const instances = processDelayedTriggers([trigger], Date.now());
      
      expect(instances).toHaveLength(1);
      expect(instances[0].sourceName).toBe('Test Card');
    });
  });
  
  describe('expireDelayedTriggers', () => {
    it('should remove expired triggers', () => {
      let registry = createDelayedTriggerRegistry();
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s1', 'T1', 'p1', DelayedTriggerTiming.UNTIL_END_OF_TURN, 'E1', 1)
      );
      registry = registerDelayedTrigger(registry,
        createDelayedTrigger('s2', 'T2', 'p1', DelayedTriggerTiming.NEXT_UPKEEP, 'E2', 1)
      );
      
      const expired = expireDelayedTriggers(registry, DelayedTriggerTiming.UNTIL_END_OF_TURN);
      
      expect(expired.triggers).toHaveLength(1);
      expect(expired.triggers[0].sourceName).toBe('T2');
    });
  });
  
  describe('parseDelayedTriggerFromText', () => {
    it('should parse next end step trigger', () => {
      const text = 'At the beginning of the next end step, return the exiled card to the battlefield.';
      const trigger = parseDelayedTriggerFromText(text, 's1', 'Test', 'p1', 1);
      
      expect(trigger).not.toBeNull();
      expect(trigger!.timing).toBe(DelayedTriggerTiming.NEXT_END_STEP);
    });
    
    it('should parse your next end step trigger', () => {
      const text = 'At the beginning of your next end step, sacrifice this creature.';
      const trigger = parseDelayedTriggerFromText(text, 's1', 'Test', 'p1', 1);
      
      expect(trigger).not.toBeNull();
      expect(trigger!.timing).toBe(DelayedTriggerTiming.YOUR_NEXT_END_STEP);
    });
    
    it('should parse end of combat trigger', () => {
      const text = 'At end of combat, sacrifice this creature.';
      const trigger = parseDelayedTriggerFromText(text, 's1', 'Test', 'p1', 1);
      
      expect(trigger).not.toBeNull();
      expect(trigger!.timing).toBe(DelayedTriggerTiming.END_OF_COMBAT);
    });
    
    it('should parse next upkeep trigger', () => {
      const text = 'At the beginning of your next upkeep, you may draw a card.';
      const trigger = parseDelayedTriggerFromText(text, 's1', 'Test', 'p1', 1);
      
      expect(trigger).not.toBeNull();
      expect(trigger!.timing).toBe(DelayedTriggerTiming.YOUR_NEXT_UPKEEP);
    });
    
    it('should parse until end of turn', () => {
      const text = 'Target creature gets +2/+2 until end of turn.';
      const trigger = parseDelayedTriggerFromText(text, 's1', 'Test', 'p1', 1);
      
      expect(trigger).not.toBeNull();
      expect(trigger!.timing).toBe(DelayedTriggerTiming.UNTIL_END_OF_TURN);
    });
    
    it('should return null for non-delayed trigger text', () => {
      const text = 'Whenever a creature enters the battlefield, draw a card.';
      const trigger = parseDelayedTriggerFromText(text, 's1', 'Test', 'p1', 1);
      
      expect(trigger).toBeNull();
    });
  });
  
  describe('Template functions', () => {
    it('should create flicker return trigger', () => {
      const trigger = createFlickerReturnTrigger(
        'source-1', 'Cloudshift', 'player1',
        'Mulldrifter', 1, ['exiled-card-1']
      );
      
      expect(trigger.timing).toBe(DelayedTriggerTiming.NEXT_END_STEP);
      expect(trigger.effect).toContain('Mulldrifter');
      expect(trigger.targets).toHaveLength(1);
    });
    
    it('should create sacrifice at end trigger', () => {
      const trigger = createSacrificeAtEndTrigger(
        'source-1', 'Sneak Attack', 'player1',
        'creature-perm-1', 1
      );
      
      expect(trigger.timing).toBe(DelayedTriggerTiming.NEXT_END_STEP);
      expect(trigger.effect).toContain('Sacrifice');
    });
    
    it('should create when-leaves trigger', () => {
      const trigger = createWhenLeavesTrigger(
        'source-1', 'Fiend Hunter', 'player1',
        'fiend-hunter-perm', 'Return exiled card', 1,
        ['exiled-card-1']
      );
      
      expect(trigger.timing).toBe(DelayedTriggerTiming.WHEN_LEAVES);
      expect(trigger.watchingPermanentId).toBe('fiend-hunter-perm');
    });
    
    it('should create next upkeep trigger', () => {
      const trigger = createNextUpkeepTrigger(
        'source-1', 'Pact of Negation', 'player1',
        'Pay 3UU or lose the game', 1
      );
      
      expect(trigger.timing).toBe(DelayedTriggerTiming.YOUR_NEXT_UPKEEP);
    });
  });
});
