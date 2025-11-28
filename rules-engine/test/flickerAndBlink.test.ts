/**
 * Tests for flickering and blinking effects
 */
import { describe, it, expect } from 'vitest';
import {
  FlickerTiming,
  FlickerReturnController,
  parseFlickerEffect,
  executeFlicker,
  returnFlickeredPermanent,
  checkDelayedFlickerReturns,
  isFlickerCard,
  getFlickerEffectForCard,
  handleCommanderFlicker,
  COMMON_FLICKER_CARDS,
} from '../src/flickerAndBlink';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

// Helper to create a test permanent
function createTestPermanent(
  id: string,
  name: string,
  oracleText: string = '',
  controllerId: string = 'player1',
  options: Partial<BattlefieldPermanent> = {}
): BattlefieldPermanent {
  return {
    id,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: false,
    counters: {},
    attachments: [],
    modifiers: [],
    card: {
      id,
      name,
      type_line: 'Creature',
      oracle_text: oracleText,
      colors: [],
    } as KnownCardRef,
    ...options,
  } as BattlefieldPermanent;
}

describe('Flicker Effect Parsing', () => {
  describe('parseFlickerEffect', () => {
    it('should parse immediate flicker effect', () => {
      const oracleText = 'Exile target creature you control, then return that card to the battlefield under your control.';
      const effect = parseFlickerEffect(oracleText, 'source-1', 'Cloudshift', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.timing).toBe(FlickerTiming.IMMEDIATE);
      expect(effect!.returnController).toBe(FlickerReturnController.YOUR_CONTROL);
    });
    
    it('should parse delayed end step flicker', () => {
      const oracleText = 'Exile target creature you control. At the beginning of the next end step, return it to the battlefield under its owner\'s control.';
      const effect = parseFlickerEffect(oracleText, 'source-1', 'Flickerwisp', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.timing).toBe(FlickerTiming.END_STEP);
      expect(effect!.returnController).toBe(FlickerReturnController.OWNER);
    });
    
    it('should parse when-exiler-leaves flicker', () => {
      // This oracle text has "exile" and "return" pattern that parseFlickerEffect detects
      const oracleText = 'When this creature enters the battlefield, exile target creature an opponent controls. When this creature leaves the battlefield, return the exiled card to the battlefield under its owner\'s control.';
      const effect = parseFlickerEffect(oracleText, 'source-1', 'Fiend Hunter', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.timing).toBe(FlickerTiming.WHEN_EXILER_LEAVES);
    });
    
    it('should parse flicker with counter bonus', () => {
      // Use more standard pattern for counter detection
      const oracleText = 'Exile target creature you control, then return it to the battlefield with a +1/+1 counter on it under your control.';
      const effect = parseFlickerEffect(oracleText, 'source-1', 'Essence Flux', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.counterType).toBe('+1/+1');
      expect(effect!.counterCount).toBe(1);
    });
    
    it('should detect tapped return', () => {
      const oracleText = 'Exile another target creature, then return that card to the battlefield tapped under its owner\'s control.';
      const effect = parseFlickerEffect(oracleText, 'source-1', 'Eldrazi Displacer', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.tapped).toBe(true);
    });
    
    it('should return null for non-flicker cards', () => {
      const oracleText = 'Destroy target creature.';
      const effect = parseFlickerEffect(oracleText, 'source-1', 'Murder', 'player1');
      
      expect(effect).toBeNull();
    });
    
    it('should return null for exile-only effects', () => {
      const oracleText = 'Exile target creature.';
      const effect = parseFlickerEffect(oracleText, 'source-1', 'Swords to Plowshares', 'player1');
      
      expect(effect).toBeNull();
    });
  });
});

describe('Flicker Execution', () => {
  describe('executeFlicker', () => {
    it('should exile a permanent immediately', () => {
      const permanent = createTestPermanent('perm-1', 'Test Creature');
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Cloudshift',
        controllerId: 'player1',
        timing: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
      };
      
      const result = executeFlicker([permanent], effect, Date.now());
      
      expect(result.success).toBe(true);
      expect(result.exiledPermanents.length).toBe(1);
      expect(result.immediateReturns.length).toBe(1);
      expect(result.delayedReturns.length).toBe(0);
    });
    
    it('should create delayed return for end step timing', () => {
      const permanent = createTestPermanent('perm-1', 'Test Creature');
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Flickerwisp',
        controllerId: 'player1',
        timing: FlickerTiming.END_STEP,
        returnController: FlickerReturnController.OWNER,
      };
      
      const result = executeFlicker([permanent], effect, Date.now());
      
      expect(result.success).toBe(true);
      expect(result.exiledPermanents.length).toBe(1);
      expect(result.immediateReturns.length).toBe(0);
      expect(result.delayedReturns.length).toBe(1);
      expect(result.delayedReturns[0].triggerCondition).toBe(FlickerTiming.END_STEP);
    });
    
    it('should track token permanents', () => {
      const tokenPermanent = createTestPermanent('perm-1', 'Token Creature', '', 'player1', {
        isToken: true,
      });
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Cloudshift',
        controllerId: 'player1',
        timing: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
      };
      
      const result = executeFlicker([tokenPermanent], effect, Date.now());
      
      expect(result.success).toBe(true);
      expect(result.exiledPermanents[0].wasToken).toBe(true);
      expect(result.immediateReturns.length).toBe(0); // Tokens can't return
      expect(result.logs.some(log => log.includes('ceases to exist'))).toBe(true);
    });
    
    it('should handle multiple permanents', () => {
      const perm1 = createTestPermanent('perm-1', 'Creature A');
      const perm2 = createTestPermanent('perm-2', 'Creature B');
      const perm3 = createTestPermanent('perm-3', 'Creature C');
      
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Eerie Interlude',
        controllerId: 'player1',
        timing: FlickerTiming.END_STEP,
        returnController: FlickerReturnController.YOUR_CONTROL,
      };
      
      const result = executeFlicker([perm1, perm2, perm3], effect, Date.now());
      
      expect(result.success).toBe(true);
      expect(result.exiledPermanents.length).toBe(3);
      expect(result.delayedReturns.length).toBe(3);
    });
    
    it('should create LTB triggers', () => {
      const permanent = createTestPermanent(
        'perm-1', 
        'Fiend Hunter',
        'When Fiend Hunter leaves the battlefield, return the exiled card.'
      );
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Cloudshift',
        controllerId: 'player1',
        timing: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
      };
      
      const result = executeFlicker([permanent], effect, Date.now());
      
      expect(result.ltbTriggers.length).toBe(1);
    });
  });
});

describe('Flicker Return', () => {
  describe('returnFlickeredPermanent', () => {
    it('should return a flickered permanent', () => {
      const flickeredObj = {
        id: 'flickered-1',
        originalPermanentId: 'perm-1',
        card: { id: 'card-1', name: 'Test Creature' } as KnownCardRef,
        ownerId: 'player1',
        controllerId: 'player1',
        flickerEffectId: 'effect-1',
        sourceName: 'Cloudshift',
        exiledAt: Date.now(),
        returnTiming: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        wasToken: false,
      };
      
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Cloudshift',
        controllerId: 'player1',
        timing: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
      };
      
      const result = returnFlickeredPermanent(flickeredObj, effect, Date.now());
      
      expect(result.success).toBe(true);
      expect(result.newPermanentId).toBeDefined();
      expect(result.etbTriggers.length).toBe(1);
    });
    
    it('should not return tokens', () => {
      const flickeredToken = {
        id: 'flickered-1',
        originalPermanentId: 'perm-1',
        card: { id: 'card-1', name: 'Token Creature' } as KnownCardRef,
        ownerId: 'player1',
        controllerId: 'player1',
        flickerEffectId: 'effect-1',
        sourceName: 'Cloudshift',
        exiledAt: Date.now(),
        returnTiming: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        wasToken: true,
      };
      
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Cloudshift',
        controllerId: 'player1',
        timing: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
      };
      
      const result = returnFlickeredPermanent(flickeredToken, effect, Date.now());
      
      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('token');
    });
    
    it('should apply counters on return', () => {
      const flickeredObj = {
        id: 'flickered-1',
        originalPermanentId: 'perm-1',
        card: { id: 'card-1', name: 'Spirit Creature' } as KnownCardRef,
        ownerId: 'player1',
        controllerId: 'player1',
        flickerEffectId: 'effect-1',
        sourceName: 'Essence Flux',
        exiledAt: Date.now(),
        returnTiming: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        wasToken: false,
        countersOnReturn: { type: '+1/+1', count: 1 },
      };
      
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Essence Flux',
        controllerId: 'player1',
        timing: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        counterType: '+1/+1',
        counterCount: 1,
      };
      
      const result = returnFlickeredPermanent(flickeredObj, effect, Date.now());
      
      expect(result.success).toBe(true);
      expect(result.logs.some(log => log.includes('+1/+1 counter'))).toBe(true);
    });
    
    it('should return tapped when specified', () => {
      const flickeredObj = {
        id: 'flickered-1',
        originalPermanentId: 'perm-1',
        card: { id: 'card-1', name: 'Test Creature' } as KnownCardRef,
        ownerId: 'player1',
        controllerId: 'player1',
        flickerEffectId: 'effect-1',
        sourceName: 'Eldrazi Displacer',
        exiledAt: Date.now(),
        returnTiming: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        wasToken: false,
        returnsTapped: true,
      };
      
      const effect = {
        id: 'effect-1',
        sourceId: 'source-1',
        sourceName: 'Eldrazi Displacer',
        controllerId: 'player1',
        timing: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        tapped: true,
      };
      
      const result = returnFlickeredPermanent(flickeredObj, effect, Date.now());
      
      expect(result.success).toBe(true);
      expect(result.logs.some(log => log.includes('enters tapped'))).toBe(true);
    });
  });
});

describe('Delayed Flicker Returns', () => {
  describe('checkDelayedFlickerReturns', () => {
    it('should trigger end step returns', () => {
      const delayedReturns = [{
        id: 'delayed-1',
        flickeredObjectId: 'flickered-1',
        triggerCondition: FlickerTiming.END_STEP,
        triggerPlayerId: 'player1',
        createdAt: Date.now(),
      }];
      
      const triggered = checkDelayedFlickerReturns(delayedReturns, {
        type: 'end_step',
        playerId: 'player1',
      });
      
      expect(triggered.length).toBe(1);
    });
    
    it('should not trigger end step returns during upkeep', () => {
      const delayedReturns = [{
        id: 'delayed-1',
        flickeredObjectId: 'flickered-1',
        triggerCondition: FlickerTiming.END_STEP,
        triggerPlayerId: 'player1',
        createdAt: Date.now(),
      }];
      
      const triggered = checkDelayedFlickerReturns(delayedReturns, {
        type: 'upkeep',
        playerId: 'player1',
      });
      
      expect(triggered.length).toBe(0);
    });
    
    it('should trigger when exiler leaves', () => {
      const delayedReturns = [{
        id: 'delayed-1',
        flickeredObjectId: 'flickered-1',
        triggerCondition: FlickerTiming.WHEN_EXILER_LEAVES,
        exilerPermanentId: 'fiend-hunter-1',
        createdAt: Date.now(),
      }];
      
      const triggered = checkDelayedFlickerReturns(delayedReturns, {
        type: 'permanent_left',
        permanentId: 'fiend-hunter-1',
      });
      
      expect(triggered.length).toBe(1);
    });
    
    it('should not trigger when wrong permanent leaves', () => {
      const delayedReturns = [{
        id: 'delayed-1',
        flickeredObjectId: 'flickered-1',
        triggerCondition: FlickerTiming.WHEN_EXILER_LEAVES,
        exilerPermanentId: 'fiend-hunter-1',
        createdAt: Date.now(),
      }];
      
      const triggered = checkDelayedFlickerReturns(delayedReturns, {
        type: 'permanent_left',
        permanentId: 'other-permanent',
      });
      
      expect(triggered.length).toBe(0);
    });
  });
});

describe('Common Flicker Cards', () => {
  describe('isFlickerCard', () => {
    it('should recognize Cloudshift', () => {
      expect(isFlickerCard('Cloudshift')).toBe(true);
    });
    
    it('should recognize Restoration Angel', () => {
      expect(isFlickerCard('Restoration Angel')).toBe(true);
    });
    
    it('should not recognize non-flicker cards', () => {
      expect(isFlickerCard('Lightning Bolt')).toBe(false);
    });
  });
  
  describe('getFlickerEffectForCard', () => {
    it('should get effect for Cloudshift', () => {
      const effect = getFlickerEffectForCard('Cloudshift', 'source-1', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.timing).toBe(FlickerTiming.IMMEDIATE);
      expect(effect!.returnController).toBe(FlickerReturnController.YOUR_CONTROL);
    });
    
    it('should get effect for Conjurer\'s Closet', () => {
      const effect = getFlickerEffectForCard('Conjurer\'s Closet', 'source-1', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.timing).toBe(FlickerTiming.END_STEP);
    });
    
    it('should get effect for Eldrazi Displacer', () => {
      const effect = getFlickerEffectForCard('Eldrazi Displacer', 'source-1', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.tapped).toBe(true);
    });
    
    it('should get effect for Essence Flux', () => {
      const effect = getFlickerEffectForCard('Essence Flux', 'source-1', 'player1');
      
      expect(effect).not.toBeNull();
      expect(effect!.counterType).toBe('+1/+1');
    });
    
    it('should return null for unknown cards', () => {
      const effect = getFlickerEffectForCard('Unknown Card', 'source-1', 'player1');
      
      expect(effect).toBeNull();
    });
  });
  
  describe('COMMON_FLICKER_CARDS', () => {
    it('should include key flicker cards', () => {
      expect(COMMON_FLICKER_CARDS['Cloudshift']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Restoration Angel']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Ephemerate']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Conjurer\'s Closet']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Thassa, Deep-Dwelling']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Brago, King Eternal']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Deadeye Navigator']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Yorion, Sky Nomad']).toBeDefined();
      expect(COMMON_FLICKER_CARDS['Fiend Hunter']).toBeDefined();
    });
  });
});

describe('Commander Flicker Handling', () => {
  describe('handleCommanderFlicker', () => {
    it('should allow commander to go to command zone', () => {
      const flickeredCommander = {
        id: 'flickered-1',
        originalPermanentId: 'perm-1',
        card: { id: 'card-1', name: 'Korvold, Fae-Cursed King' } as KnownCardRef,
        ownerId: 'player1',
        controllerId: 'player1',
        flickerEffectId: 'effect-1',
        sourceName: 'Swords to Plowshares',
        exiledAt: Date.now(),
        returnTiming: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.OWNER,
        wasToken: false,
        wasCommander: true,
      };
      
      const result = handleCommanderFlicker(flickeredCommander, true);
      
      expect(result.goesToCommandZone).toBe(true);
      expect(result.log).toContain('command zone');
    });
    
    it('should allow commander to go to exile when player chooses', () => {
      const flickeredCommander = {
        id: 'flickered-1',
        originalPermanentId: 'perm-1',
        card: { id: 'card-1', name: 'Korvold, Fae-Cursed King' } as KnownCardRef,
        ownerId: 'player1',
        controllerId: 'player1',
        flickerEffectId: 'effect-1',
        sourceName: 'Cloudshift',
        exiledAt: Date.now(),
        returnTiming: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        wasToken: false,
        wasCommander: true,
      };
      
      const result = handleCommanderFlicker(flickeredCommander, false);
      
      expect(result.goesToCommandZone).toBe(false);
      expect(result.log).toContain('exile');
    });
    
    it('should not affect non-commanders', () => {
      const flickeredNonCommander = {
        id: 'flickered-1',
        originalPermanentId: 'perm-1',
        card: { id: 'card-1', name: 'Mulldrifter' } as KnownCardRef,
        ownerId: 'player1',
        controllerId: 'player1',
        flickerEffectId: 'effect-1',
        sourceName: 'Cloudshift',
        exiledAt: Date.now(),
        returnTiming: FlickerTiming.IMMEDIATE,
        returnController: FlickerReturnController.YOUR_CONTROL,
        wasToken: false,
        wasCommander: false,
      };
      
      const result = handleCommanderFlicker(flickeredNonCommander, true);
      
      expect(result.goesToCommandZone).toBe(false);
      expect(result.log).toBe('');
    });
  });
});
