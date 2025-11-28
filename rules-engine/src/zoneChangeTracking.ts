/**
 * zoneChangeTracking.ts
 * 
 * Tracks zone changes to properly fire triggers and handle state-based actions.
 * 
 * Common zone change triggers:
 * - ETB (Enters the Battlefield)
 * - LTB (Leaves the Battlefield)
 * - Dies (goes to graveyard from battlefield)
 * - Drawn (moved from library to hand)
 * - Discarded (moved from hand to graveyard)
 * - Exiled (moved to exile zone)
 * - Milled (moved from library to graveyard)
 * 
 * Rules Reference:
 * - Rule 400.7: An object that moves from one zone to another becomes a new object
 * - Rule 603: Triggered abilities
 * - Rule 603.6: Zone-change triggers
 */

import type { PlayerID, KnownCardRef, BattlefieldPermanent, GameState } from '../../shared/src';
import { TriggerEvent, type TriggeredAbility, type TriggerInstance, createTriggerInstance } from './triggeredAbilities';

/**
 * Game zones
 */
export enum Zone {
  LIBRARY = 'library',
  HAND = 'hand',
  BATTLEFIELD = 'battlefield',
  GRAVEYARD = 'graveyard',
  EXILE = 'exile',
  STACK = 'stack',
  COMMAND = 'command',
}

/**
 * Zone change event
 */
export interface ZoneChangeEvent {
  readonly id: string;
  readonly objectId: string;
  readonly objectName: string;
  readonly fromZone: Zone;
  readonly toZone: Zone;
  readonly controllerId: PlayerID;
  readonly ownerId: PlayerID;
  readonly timestamp: number;
  readonly card?: KnownCardRef;
  /** Was this a token? */
  readonly isToken?: boolean;
  /** Is this a commander? */
  readonly isCommander?: boolean;
  /** The cause of the zone change */
  readonly cause?: ZoneChangeCause;
  /** Additional context */
  readonly context?: ZoneChangeContext;
}

/**
 * What caused the zone change
 */
export enum ZoneChangeCause {
  /** Entered battlefield naturally (played, resolved) */
  ENTERED_NORMALLY = 'entered_normally',
  /** Returned from another zone (flicker, resurrect) */
  RETURNED = 'returned',
  /** Bounced back to hand */
  BOUNCED = 'bounced',
  /** Destroyed by effect */
  DESTROYED = 'destroyed',
  /** Died (creature to graveyard) */
  DIED = 'died',
  /** Sacrificed */
  SACRIFICED = 'sacrificed',
  /** Exiled */
  EXILED = 'exiled',
  /** Milled */
  MILLED = 'milled',
  /** Discarded */
  DISCARDED = 'discarded',
  /** Drew a card */
  DREW = 'drew',
  /** Put on top/bottom of library */
  TO_LIBRARY = 'to_library',
  /** Tutored (searched library) */
  TUTORED = 'tutored',
  /** Cast from non-hand zone (graveyard, exile, etc.) */
  CAST = 'cast',
  /** Token created */
  TOKEN_CREATED = 'token_created',
  /** Token ceased to exist */
  TOKEN_CEASED = 'token_ceased',
  /** Flickered/blinked */
  FLICKERED = 'flickered',
  /** Phase out/in */
  PHASED = 'phased',
}

/**
 * Additional context for zone changes
 */
export interface ZoneChangeContext {
  /** Source that caused this change */
  sourceId?: string;
  sourceName?: string;
  /** For flicker effects */
  flickerData?: {
    returnTiming?: string;
    returnController?: string;
  };
  /** For dies triggers - what killed it */
  killedBy?: string;
  /** For sacrifice - sacrificed for what */
  sacrificedFor?: string;
  /** Was lethal damage */
  wasLethalDamage?: boolean;
  /** Was deathtouch damage */
  wasDeathtouch?: boolean;
  /** For milling - how many cards */
  millCount?: number;
  /** For discard - was random? */
  randomDiscard?: boolean;
}

/**
 * Pending zone change waiting to be processed
 */
export interface PendingZoneChange {
  readonly event: ZoneChangeEvent;
  readonly triggersCreated: readonly TriggerInstance[];
  readonly processed: boolean;
}

/**
 * Zone change tracker state
 */
export interface ZoneChangeTracker {
  readonly pendingChanges: readonly PendingZoneChange[];
  readonly recentChanges: readonly ZoneChangeEvent[];
  readonly timestamp: number;
}

/**
 * Create an empty zone change tracker
 */
export function createZoneChangeTracker(): ZoneChangeTracker {
  return {
    pendingChanges: [],
    recentChanges: [],
    timestamp: Date.now(),
  };
}

/**
 * Create a zone change event
 */
export function createZoneChangeEvent(
  objectId: string,
  objectName: string,
  fromZone: Zone,
  toZone: Zone,
  controllerId: PlayerID,
  ownerId: PlayerID,
  options: {
    card?: KnownCardRef;
    isToken?: boolean;
    isCommander?: boolean;
    cause?: ZoneChangeCause;
    context?: ZoneChangeContext;
  } = {}
): ZoneChangeEvent {
  return {
    id: `zone-change-${objectId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    objectId,
    objectName,
    fromZone,
    toZone,
    controllerId,
    ownerId,
    timestamp: Date.now(),
    card: options.card,
    isToken: options.isToken,
    isCommander: options.isCommander,
    cause: options.cause,
    context: options.context,
  };
}

/**
 * Determine what trigger event corresponds to a zone change
 */
export function getTriggerEventForZoneChange(event: ZoneChangeEvent): TriggerEvent | null {
  // Entering battlefield
  if (event.toZone === Zone.BATTLEFIELD && event.fromZone !== Zone.BATTLEFIELD) {
    return TriggerEvent.ENTERS_BATTLEFIELD;
  }
  
  // Dies (battlefield to graveyard, non-token creature) - check before general LTB
  if (event.fromZone === Zone.BATTLEFIELD && 
      event.toZone === Zone.GRAVEYARD && 
      !event.isToken &&
      (event.cause === ZoneChangeCause.DIED || 
       event.cause === ZoneChangeCause.DESTROYED ||
       event.cause === ZoneChangeCause.SACRIFICED)) {
    return TriggerEvent.DIES;
  }
  
  // Exiled - check before general LTB
  if (event.toZone === Zone.EXILE) {
    return TriggerEvent.EXILED;
  }
  
  // Leaving battlefield (general case - not dies or exile)
  if (event.fromZone === Zone.BATTLEFIELD && event.toZone !== Zone.BATTLEFIELD) {
    return TriggerEvent.LEAVES_BATTLEFIELD;
  }
  
  // Drawn (library to hand)
  if (event.fromZone === Zone.LIBRARY && event.toZone === Zone.HAND) {
    return TriggerEvent.DRAWN;
  }
  
  // Discarded (hand to graveyard)
  if (event.fromZone === Zone.HAND && event.toZone === Zone.GRAVEYARD) {
    return TriggerEvent.DISCARDED;
  }
  
  // Milled (library to graveyard)
  if (event.fromZone === Zone.LIBRARY && event.toZone === Zone.GRAVEYARD) {
    return TriggerEvent.MILLED;
  }
  
  // Returned to hand (any zone to hand, not draw)
  if (event.toZone === Zone.HAND && 
      event.fromZone !== Zone.LIBRARY && 
      event.cause === ZoneChangeCause.BOUNCED) {
    return TriggerEvent.RETURNED_TO_HAND;
  }
  
  // Put into graveyard from non-battlefield
  if (event.toZone === Zone.GRAVEYARD && 
      event.fromZone !== Zone.BATTLEFIELD &&
      event.fromZone !== Zone.LIBRARY &&
      event.fromZone !== Zone.HAND) {
    return TriggerEvent.PUT_INTO_GRAVEYARD;
  }
  
  return null;
}

/**
 * Get secondary trigger events for a zone change
 * Some zone changes fire multiple triggers
 */
export function getSecondaryTriggerEvents(event: ZoneChangeEvent): TriggerEvent[] {
  const secondary: TriggerEvent[] = [];
  
  // Sacrifice triggers in addition to dies
  if (event.cause === ZoneChangeCause.SACRIFICED) {
    secondary.push(TriggerEvent.SACRIFICED);
    
    // Check for creature/artifact sacrifice
    const typeLine = event.card?.type_line?.toLowerCase() || '';
    if (typeLine.includes('creature')) {
      secondary.push(TriggerEvent.CREATURE_SACRIFICED);
    }
    if (typeLine.includes('artifact')) {
      secondary.push(TriggerEvent.ARTIFACT_SACRIFICED);
    }
  }
  
  // Landfall for land entering
  if (event.toZone === Zone.BATTLEFIELD) {
    const typeLine = event.card?.type_line?.toLowerCase() || '';
    if (typeLine.includes('land')) {
      secondary.push(TriggerEvent.LANDFALL);
    }
  }
  
  // Token created
  if (event.isToken && event.toZone === Zone.BATTLEFIELD && 
      event.cause === ZoneChangeCause.TOKEN_CREATED) {
    secondary.push(TriggerEvent.TOKEN_CREATED);
  }
  
  return secondary;
}

/**
 * Track a zone change and create triggers
 */
export function trackZoneChange(
  tracker: Readonly<ZoneChangeTracker>,
  event: ZoneChangeEvent,
  registeredAbilities: readonly TriggeredAbility[]
): ZoneChangeTracker {
  const triggers: TriggerInstance[] = [];
  
  // Get primary trigger event
  const primaryEvent = getTriggerEventForZoneChange(event);
  if (primaryEvent) {
    const matchingAbilities = registeredAbilities.filter(a => a.event === primaryEvent);
    for (const ability of matchingAbilities) {
      triggers.push(createTriggerInstance(ability, event.timestamp));
    }
  }
  
  // Get secondary trigger events
  const secondaryEvents = getSecondaryTriggerEvents(event);
  for (const secEvent of secondaryEvents) {
    const matchingAbilities = registeredAbilities.filter(a => a.event === secEvent);
    for (const ability of matchingAbilities) {
      triggers.push(createTriggerInstance(ability, event.timestamp + 1));
    }
  }
  
  const pendingChange: PendingZoneChange = {
    event,
    triggersCreated: triggers,
    processed: false,
  };
  
  return {
    pendingChanges: [...tracker.pendingChanges, pendingChange],
    recentChanges: [...tracker.recentChanges.slice(-99), event],
    timestamp: event.timestamp,
  };
}

/**
 * Process all pending zone changes and collect triggers
 */
export function processPendingZoneChanges(
  tracker: Readonly<ZoneChangeTracker>
): {
  tracker: ZoneChangeTracker;
  allTriggers: readonly TriggerInstance[];
  logs: readonly string[];
} {
  const allTriggers: TriggerInstance[] = [];
  const logs: string[] = [];
  
  for (const pending of tracker.pendingChanges) {
    if (!pending.processed) {
      allTriggers.push(...pending.triggersCreated);
      
      const event = pending.event;
      logs.push(`${event.objectName} moved from ${event.fromZone} to ${event.toZone}`);
      
      if (pending.triggersCreated.length > 0) {
        logs.push(`  -> ${pending.triggersCreated.length} trigger(s) created`);
      }
    }
  }
  
  // Mark all as processed
  const processedChanges = tracker.pendingChanges.map(p => ({
    ...p,
    processed: true,
  }));
  
  return {
    tracker: {
      ...tracker,
      pendingChanges: processedChanges,
    },
    allTriggers,
    logs,
  };
}

/**
 * Clear processed zone changes
 */
export function clearProcessedChanges(
  tracker: Readonly<ZoneChangeTracker>
): ZoneChangeTracker {
  return {
    ...tracker,
    pendingChanges: tracker.pendingChanges.filter(p => !p.processed),
  };
}

/**
 * Check if an object entering the battlefield triggers any abilities
 */
export function checkETBTriggers(
  event: ZoneChangeEvent,
  battlefieldPermanents: readonly BattlefieldPermanent[],
  timestamp: number
): TriggerInstance[] {
  if (event.toZone !== Zone.BATTLEFIELD) {
    return [];
  }
  
  const triggers: TriggerInstance[] = [];
  
  // Check all permanents for ETB triggers
  for (const perm of battlefieldPermanents) {
    const card = perm.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // Self-ETB trigger
    if (perm.id === event.objectId) {
      if (oracleText.includes('when') && 
          (oracleText.includes('enters the battlefield') || oracleText.includes('enters'))) {
        const ability: TriggeredAbility = {
          id: `${perm.id}-etb`,
          sourceId: perm.id,
          sourceName: card?.name || 'Unknown',
          controllerId: perm.controller,
          keyword: 'when' as any,
          event: TriggerEvent.ENTERS_BATTLEFIELD,
          effect: 'ETB trigger',
        };
        triggers.push(createTriggerInstance(ability, timestamp));
      }
    }
    
    // Other permanents watching for ETB
    if (perm.id !== event.objectId) {
      // Check for "whenever a creature enters" style triggers
      if (oracleText.includes('whenever') && 
          oracleText.includes('enters the battlefield')) {
        const ability: TriggeredAbility = {
          id: `${perm.id}-other-etb`,
          sourceId: perm.id,
          sourceName: card?.name || 'Unknown',
          controllerId: perm.controller,
          keyword: 'whenever' as any,
          event: TriggerEvent.ENTERS_BATTLEFIELD,
          effect: 'Other ETB trigger',
        };
        triggers.push(createTriggerInstance(ability, timestamp));
      }
    }
  }
  
  return triggers;
}

/**
 * Check if an object leaving the battlefield triggers any abilities
 */
export function checkLTBTriggers(
  event: ZoneChangeEvent,
  battlefieldPermanents: readonly BattlefieldPermanent[],
  timestamp: number
): TriggerInstance[] {
  if (event.fromZone !== Zone.BATTLEFIELD) {
    return [];
  }
  
  const triggers: TriggerInstance[] = [];
  
  // The permanent that left had oracle text
  const leavingCard = event.card;
  if (leavingCard) {
    const oracleText = (leavingCard.oracle_text || '').toLowerCase();
    
    // Self-LTB trigger
    if (oracleText.includes('when') && 
        oracleText.includes('leaves the battlefield')) {
      const ability: TriggeredAbility = {
        id: `${event.objectId}-ltb`,
        sourceId: event.objectId,
        sourceName: leavingCard.name || 'Unknown',
        controllerId: event.controllerId,
        keyword: 'when' as any,
        event: TriggerEvent.LEAVES_BATTLEFIELD,
        effect: 'LTB trigger',
      };
      triggers.push(createTriggerInstance(ability, timestamp));
    }
  }
  
  // Check other permanents for LTB watchers
  for (const perm of battlefieldPermanents) {
    const card = perm.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // "Whenever a creature leaves the battlefield" style
    if (oracleText.includes('whenever') && 
        oracleText.includes('leaves the battlefield')) {
      const ability: TriggeredAbility = {
        id: `${perm.id}-other-ltb`,
        sourceId: perm.id,
        sourceName: card?.name || 'Unknown',
        controllerId: perm.controller,
        keyword: 'whenever' as any,
        event: TriggerEvent.LEAVES_BATTLEFIELD,
        effect: 'Other LTB trigger',
      };
      triggers.push(createTriggerInstance(ability, timestamp));
    }
  }
  
  return triggers;
}

/**
 * Check for dies triggers (battlefield to graveyard)
 */
export function checkDiesTriggers(
  event: ZoneChangeEvent,
  battlefieldPermanents: readonly BattlefieldPermanent[],
  timestamp: number
): TriggerInstance[] {
  // Must be going to graveyard from battlefield
  if (event.fromZone !== Zone.BATTLEFIELD || event.toZone !== Zone.GRAVEYARD) {
    return [];
  }
  
  // Tokens don't trigger dies effects
  if (event.isToken) {
    return [];
  }
  
  const triggers: TriggerInstance[] = [];
  
  // The creature that died had oracle text
  const dyingCard = event.card;
  if (dyingCard) {
    const oracleText = (dyingCard.oracle_text || '').toLowerCase();
    
    // Self-dies trigger
    if (oracleText.includes('when') && oracleText.includes('dies')) {
      const ability: TriggeredAbility = {
        id: `${event.objectId}-dies`,
        sourceId: event.objectId,
        sourceName: dyingCard.name || 'Unknown',
        controllerId: event.controllerId,
        keyword: 'when' as any,
        event: TriggerEvent.DIES,
        effect: 'Dies trigger',
      };
      triggers.push(createTriggerInstance(ability, timestamp));
    }
  }
  
  // Check other permanents
  for (const perm of battlefieldPermanents) {
    const card = perm.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // "Whenever a creature dies" or "Whenever another creature dies"
    if (oracleText.includes('whenever') && oracleText.includes('dies')) {
      // Check if it's "another creature" restriction
      const isAnotherRestriction = oracleText.includes('another creature');
      if (isAnotherRestriction && perm.id === event.objectId) {
        continue; // Skip - it's watching for other creatures
      }
      
      const ability: TriggeredAbility = {
        id: `${perm.id}-other-dies`,
        sourceId: perm.id,
        sourceName: card?.name || 'Unknown',
        controllerId: perm.controller,
        keyword: 'whenever' as any,
        event: TriggerEvent.DIES,
        effect: 'Other dies trigger',
      };
      triggers.push(createTriggerInstance(ability, timestamp));
    }
    
    // Check for "controlled creature died"
    if (oracleText.includes('creature you control') && oracleText.includes('dies')) {
      if (event.controllerId === perm.controller) {
        const ability: TriggeredAbility = {
          id: `${perm.id}-controlled-dies`,
          sourceId: perm.id,
          sourceName: card?.name || 'Unknown',
          controllerId: perm.controller,
          keyword: 'whenever' as any,
          event: TriggerEvent.CONTROLLED_CREATURE_DIED,
          effect: 'Controlled creature dies trigger',
        };
        triggers.push(createTriggerInstance(ability, timestamp));
      }
    }
    
    // Check for "opponent's creature died"
    if (oracleText.includes('opponent') && oracleText.includes('creature') && oracleText.includes('dies')) {
      if (event.controllerId !== perm.controller) {
        const ability: TriggeredAbility = {
          id: `${perm.id}-opponent-dies`,
          sourceId: perm.id,
          sourceName: card?.name || 'Unknown',
          controllerId: perm.controller,
          keyword: 'whenever' as any,
          event: TriggerEvent.OPPONENT_CREATURE_DIED,
          effect: 'Opponent creature dies trigger',
        };
        triggers.push(createTriggerInstance(ability, timestamp));
      }
    }
  }
  
  return triggers;
}

/**
 * Check for sacrifice triggers
 */
export function checkSacrificeTriggers(
  event: ZoneChangeEvent,
  battlefieldPermanents: readonly BattlefieldPermanent[],
  timestamp: number
): TriggerInstance[] {
  if (event.cause !== ZoneChangeCause.SACRIFICED) {
    return [];
  }
  
  const triggers: TriggerInstance[] = [];
  const typeLine = (event.card?.type_line || '').toLowerCase();
  
  for (const perm of battlefieldPermanents) {
    const card = perm.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // "Whenever you sacrifice" triggers
    if (oracleText.includes('whenever') && oracleText.includes('sacrifice')) {
      // Check if controller matches
      if (event.controllerId === perm.controller || !oracleText.includes('you sacrifice')) {
        let matchesType = true;
        
        // Check type restrictions
        if (oracleText.includes('sacrifice a creature') && !typeLine.includes('creature')) {
          matchesType = false;
        }
        if (oracleText.includes('sacrifice an artifact') && !typeLine.includes('artifact')) {
          matchesType = false;
        }
        if (oracleText.includes('sacrifice an enchantment') && !typeLine.includes('enchantment')) {
          matchesType = false;
        }
        
        if (matchesType) {
          const ability: TriggeredAbility = {
            id: `${perm.id}-sacrifice`,
            sourceId: perm.id,
            sourceName: card?.name || 'Unknown',
            controllerId: perm.controller,
            keyword: 'whenever' as any,
            event: TriggerEvent.SACRIFICED,
            effect: 'Sacrifice trigger',
          };
          triggers.push(createTriggerInstance(ability, timestamp));
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Get all triggers from a zone change event
 */
export function getAllZoneChangeTriggers(
  event: ZoneChangeEvent,
  battlefieldPermanents: readonly BattlefieldPermanent[],
  timestamp: number
): TriggerInstance[] {
  const triggers: TriggerInstance[] = [];
  
  // Check for ETB
  triggers.push(...checkETBTriggers(event, battlefieldPermanents, timestamp));
  
  // Check for LTB
  triggers.push(...checkLTBTriggers(event, battlefieldPermanents, timestamp));
  
  // Check for dies
  triggers.push(...checkDiesTriggers(event, battlefieldPermanents, timestamp));
  
  // Check for sacrifice
  triggers.push(...checkSacrificeTriggers(event, battlefieldPermanents, timestamp));
  
  return triggers;
}

export default {
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
};
