/**
 * Tests for zone change tracking
 */
import { describe, it, expect } from 'vitest';
import {
  Zone,
  ZoneChangeCause,
  createZoneChangeTracker,
  createZoneChangeEvent,
  getTriggerEventForZoneChange,
  getSecondaryTriggerEvents,
  trackZoneChange,
  processPendingZoneChanges,
  clearProcessedChanges,
  checkETBTriggers,
  checkLTBTriggers,
  checkDiesTriggers,
  checkSacrificeTriggers,
  getAllZoneChangeTriggers,
} from '../src/zoneChangeTracking';
import { TriggerEvent } from '../src/triggeredAbilities';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

// Helper to create a test permanent
function createTestPermanent(
  id: string,
  name: string,
  oracleText: string = '',
  controllerId: string = 'player1'
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
  } as BattlefieldPermanent;
}

describe('Zone Change Tracking', () => {
  describe('createZoneChangeTracker', () => {
    it('should create an empty tracker', () => {
      const tracker = createZoneChangeTracker();
      
      expect(tracker.pendingChanges).toHaveLength(0);
      expect(tracker.recentChanges).toHaveLength(0);
      expect(tracker.timestamp).toBeDefined();
    });
  });
  
  describe('createZoneChangeEvent', () => {
    it('should create a zone change event', () => {
      const event = createZoneChangeEvent(
        'perm-1',
        'Test Creature',
        Zone.HAND,
        Zone.BATTLEFIELD,
        'player1',
        'player1'
      );
      
      expect(event.objectId).toBe('perm-1');
      expect(event.objectName).toBe('Test Creature');
      expect(event.fromZone).toBe(Zone.HAND);
      expect(event.toZone).toBe(Zone.BATTLEFIELD);
      expect(event.controllerId).toBe('player1');
    });
    
    it('should include optional data', () => {
      const card = { id: 'card-1', name: 'Test' } as KnownCardRef;
      const event = createZoneChangeEvent(
        'perm-1',
        'Test Creature',
        Zone.BATTLEFIELD,
        Zone.GRAVEYARD,
        'player1',
        'player1',
        {
          card,
          isToken: false,
          isCommander: true,
          cause: ZoneChangeCause.DIED,
          context: { wasLethalDamage: true },
        }
      );
      
      expect(event.card).toBe(card);
      expect(event.isToken).toBe(false);
      expect(event.isCommander).toBe(true);
      expect(event.cause).toBe(ZoneChangeCause.DIED);
      expect(event.context?.wasLethalDamage).toBe(true);
    });
  });
  
  describe('getTriggerEventForZoneChange', () => {
    it('should detect ETB', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1'
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.ENTERS_BATTLEFIELD);
    });
    
    it('should detect LTB', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.HAND, 'p1', 'p1'
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.LEAVES_BATTLEFIELD);
    });
    
    it('should detect dies', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'p1', 'p1',
        { cause: ZoneChangeCause.DIED }
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.DIES);
    });
    
    it('should detect exile', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.EXILE, 'p1', 'p1'
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.EXILED);
    });
    
    it('should detect draw', () => {
      const event = createZoneChangeEvent(
        'card-1', 'Test', Zone.LIBRARY, Zone.HAND, 'p1', 'p1'
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.DRAWN);
    });
    
    it('should detect discard', () => {
      const event = createZoneChangeEvent(
        'card-1', 'Test', Zone.HAND, Zone.GRAVEYARD, 'p1', 'p1'
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.DISCARDED);
    });
    
    it('should detect milled', () => {
      const event = createZoneChangeEvent(
        'card-1', 'Test', Zone.LIBRARY, Zone.GRAVEYARD, 'p1', 'p1'
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.MILLED);
    });
    
    it('should detect bounced to hand', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.HAND, 'p1', 'p1',
        { cause: ZoneChangeCause.BOUNCED }
      );
      expect(getTriggerEventForZoneChange(event)).toBe(TriggerEvent.LEAVES_BATTLEFIELD);
    });
  });
  
  describe('getSecondaryTriggerEvents', () => {
    it('should add sacrifice trigger for sacrificed creatures', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'p1', 'p1',
        { 
          cause: ZoneChangeCause.SACRIFICED,
          card: { id: '1', name: 'Test', type_line: 'Creature' } as KnownCardRef,
        }
      );
      
      const secondary = getSecondaryTriggerEvents(event);
      expect(secondary).toContain(TriggerEvent.SACRIFICED);
      expect(secondary).toContain(TriggerEvent.CREATURE_SACRIFICED);
    });
    
    it('should add artifact sacrifice trigger', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'p1', 'p1',
        { 
          cause: ZoneChangeCause.SACRIFICED,
          card: { id: '1', name: 'Test', type_line: 'Artifact' } as KnownCardRef,
        }
      );
      
      const secondary = getSecondaryTriggerEvents(event);
      expect(secondary).toContain(TriggerEvent.ARTIFACT_SACRIFICED);
    });
    
    it('should add landfall for land ETB', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1',
        { card: { id: '1', name: 'Forest', type_line: 'Basic Land - Forest' } as KnownCardRef }
      );
      
      const secondary = getSecondaryTriggerEvents(event);
      expect(secondary).toContain(TriggerEvent.LANDFALL);
    });
    
    it('should add token created for new tokens', () => {
      const event = createZoneChangeEvent(
        'token-1', 'Zombie Token', Zone.EXILE, Zone.BATTLEFIELD, 'p1', 'p1',
        { isToken: true, cause: ZoneChangeCause.TOKEN_CREATED }
      );
      
      const secondary = getSecondaryTriggerEvents(event);
      expect(secondary).toContain(TriggerEvent.TOKEN_CREATED);
    });
  });
  
  describe('trackZoneChange', () => {
    it('should add pending change to tracker', () => {
      const tracker = createZoneChangeTracker();
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1'
      );
      
      const updated = trackZoneChange(tracker, event, []);
      
      expect(updated.pendingChanges).toHaveLength(1);
      expect(updated.recentChanges).toHaveLength(1);
    });
    
    it('should accumulate multiple changes', () => {
      let tracker = createZoneChangeTracker();
      
      tracker = trackZoneChange(tracker, 
        createZoneChangeEvent('perm-1', 'Test 1', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1'),
        []
      );
      tracker = trackZoneChange(tracker,
        createZoneChangeEvent('perm-2', 'Test 2', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1'),
        []
      );
      
      expect(tracker.pendingChanges).toHaveLength(2);
      expect(tracker.recentChanges).toHaveLength(2);
    });
  });
  
  describe('processPendingZoneChanges', () => {
    it('should mark changes as processed', () => {
      let tracker = createZoneChangeTracker();
      tracker = trackZoneChange(tracker,
        createZoneChangeEvent('perm-1', 'Test', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1'),
        []
      );
      
      const { tracker: newTracker } = processPendingZoneChanges(tracker);
      
      expect(newTracker.pendingChanges[0].processed).toBe(true);
    });
    
    it('should collect all triggers', () => {
      const trigger = {
        id: 'trigger-1',
        sourceId: 'perm-1',
        sourceName: 'Test',
        controllerId: 'p1',
        keyword: 'when' as any,
        event: TriggerEvent.ENTERS_BATTLEFIELD,
        effect: 'Test effect',
      };
      
      let tracker = createZoneChangeTracker();
      tracker = trackZoneChange(tracker,
        createZoneChangeEvent('perm-1', 'Test', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1'),
        [trigger]
      );
      
      const { allTriggers } = processPendingZoneChanges(tracker);
      
      expect(allTriggers.length).toBe(1);
    });
  });
  
  describe('clearProcessedChanges', () => {
    it('should remove processed changes', () => {
      let tracker = createZoneChangeTracker();
      tracker = trackZoneChange(tracker,
        createZoneChangeEvent('perm-1', 'Test', Zone.HAND, Zone.BATTLEFIELD, 'p1', 'p1'),
        []
      );
      
      const { tracker: processed } = processPendingZoneChanges(tracker);
      const cleared = clearProcessedChanges(processed);
      
      expect(cleared.pendingChanges).toHaveLength(0);
    });
  });
});

describe('ETB Triggers', () => {
  describe('checkETBTriggers', () => {
    it('should detect self ETB trigger', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Mulldrifter', Zone.HAND, Zone.BATTLEFIELD, 'player1', 'player1'
      );
      
      const permanents = [
        createTestPermanent('perm-1', 'Mulldrifter', 'When Mulldrifter enters the battlefield, draw two cards.')
      ];
      
      const triggers = checkETBTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(1);
    });
    
    it('should detect other ETB watcher', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test Creature', Zone.HAND, Zone.BATTLEFIELD, 'player1', 'player1'
      );
      
      const permanents = [
        createTestPermanent('perm-1', 'Test Creature', ''),
        createTestPermanent('perm-2', 'Soul Warden', 'Whenever a creature enters the battlefield, you gain 1 life.')
      ];
      
      const triggers = checkETBTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(1);
      expect(triggers[0].sourceId).toBe('perm-2');
    });
    
    it('should not trigger for non-ETB zone changes', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1'
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Soul Warden', 'Whenever a creature enters the battlefield, you gain 1 life.')
      ];
      
      const triggers = checkETBTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(0);
    });
  });
});

describe('LTB Triggers', () => {
  describe('checkLTBTriggers', () => {
    it('should detect self LTB trigger', () => {
      const card = { 
        id: 'card-1', 
        name: 'Fiend Hunter', 
        oracle_text: 'When Fiend Hunter leaves the battlefield, return the exiled card.' 
      } as KnownCardRef;
      
      const event = createZoneChangeEvent(
        'perm-1', 'Fiend Hunter', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { card }
      );
      
      const triggers = checkLTBTriggers(event, [], Date.now());
      
      expect(triggers.length).toBe(1);
    });
    
    it('should detect other LTB watcher', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test Creature', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1'
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Stalking Vengeance', 'Whenever a creature you control leaves the battlefield, it deals damage.')
      ];
      
      const triggers = checkLTBTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(1);
    });
  });
});

describe('Dies Triggers', () => {
  describe('checkDiesTriggers', () => {
    it('should detect self dies trigger', () => {
      const card = { 
        id: 'card-1', 
        name: 'Blood Artist', 
        oracle_text: 'When Blood Artist dies, target player loses 1 life.' 
      } as KnownCardRef;
      
      const event = createZoneChangeEvent(
        'perm-1', 'Blood Artist', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { card, cause: ZoneChangeCause.DIED }
      );
      
      const triggers = checkDiesTriggers(event, [], Date.now());
      
      expect(triggers.length).toBe(1);
    });
    
    it('should not trigger for tokens', () => {
      const event = createZoneChangeEvent(
        'token-1', 'Zombie Token', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { isToken: true, cause: ZoneChangeCause.DIED }
      );
      
      const triggers = checkDiesTriggers(event, [], Date.now());
      
      expect(triggers.length).toBe(0);
    });
    
    it('should detect whenever a creature dies watcher', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test Creature', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { cause: ZoneChangeCause.DIED }
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Blood Artist', 'Whenever a creature dies, target opponent loses 1 life.')
      ];
      
      const triggers = checkDiesTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(1);
    });
    
    it('should detect controlled creature dies trigger', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test Creature', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { cause: ZoneChangeCause.DIED }
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Cruel Celebrant', 'Whenever a creature you control dies, each opponent loses 1 life.')
      ];
      
      const triggers = checkDiesTriggers(event, permanents, Date.now());
      
      // Should have both the general dies trigger and the controlled creature dies trigger
      expect(triggers.length).toBeGreaterThanOrEqual(1);
    });
    
    it('should not trigger from non-graveyard destination', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.EXILE, 'player1', 'player1'
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Blood Artist', 'Whenever a creature dies, target opponent loses 1 life.')
      ];
      
      const triggers = checkDiesTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(0);
    });
  });
});

describe('Sacrifice Triggers', () => {
  describe('checkSacrificeTriggers', () => {
    it('should detect sacrifice trigger', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test Creature', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { 
          cause: ZoneChangeCause.SACRIFICED,
          card: { id: '1', name: 'Test', type_line: 'Creature' } as KnownCardRef 
        }
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Korvold', 'Whenever you sacrifice a permanent, draw a card.')
      ];
      
      const triggers = checkSacrificeTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(1);
    });
    
    it('should check type restrictions', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Sol Ring', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { 
          cause: ZoneChangeCause.SACRIFICED,
          card: { id: '1', name: 'Sol Ring', type_line: 'Artifact' } as KnownCardRef 
        }
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Ruthless Technomancer', 'Whenever you sacrifice a creature, create treasures.')
      ];
      
      const triggers = checkSacrificeTriggers(event, permanents, Date.now());
      
      // Should not trigger because Sol Ring is not a creature
      expect(triggers.length).toBe(0);
    });
    
    it('should not trigger for non-sacrifice causes', () => {
      const event = createZoneChangeEvent(
        'perm-1', 'Test', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
        { cause: ZoneChangeCause.DESTROYED }
      );
      
      const permanents = [
        createTestPermanent('perm-2', 'Korvold', 'Whenever you sacrifice a permanent, draw a card.')
      ];
      
      const triggers = checkSacrificeTriggers(event, permanents, Date.now());
      
      expect(triggers.length).toBe(0);
    });
  });
});

describe('getAllZoneChangeTriggers', () => {
  it('should collect all relevant triggers for ETB', () => {
    const event = createZoneChangeEvent(
      'perm-1', 'Mulldrifter', Zone.HAND, Zone.BATTLEFIELD, 'player1', 'player1'
    );
    
    const permanents = [
      createTestPermanent('perm-1', 'Mulldrifter', 'When Mulldrifter enters the battlefield, draw two cards.'),
      createTestPermanent('perm-2', 'Soul Warden', 'Whenever a creature enters the battlefield, you gain 1 life.')
    ];
    
    const triggers = getAllZoneChangeTriggers(event, permanents, Date.now());
    
    expect(triggers.length).toBe(2);
  });
  
  it('should collect all relevant triggers for dies with sacrifice', () => {
    const event = createZoneChangeEvent(
      'perm-1', 'Blood Artist', Zone.BATTLEFIELD, Zone.GRAVEYARD, 'player1', 'player1',
      { 
        cause: ZoneChangeCause.SACRIFICED,
        card: { id: '1', name: 'Blood Artist', type_line: 'Creature', oracle_text: 'When Blood Artist dies...' } as KnownCardRef 
      }
    );
    
    const permanents = [
      createTestPermanent('perm-2', 'Korvold', 'Whenever you sacrifice a permanent, draw a card.')
    ];
    
    const triggers = getAllZoneChangeTriggers(event, permanents, Date.now());
    
    // Should have LTB, dies, and sacrifice triggers
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });
});
