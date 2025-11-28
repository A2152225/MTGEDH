/**
 * flickerAndBlink.ts
 * 
 * Implements exile-and-return effects commonly known as "flickering" or "blinking".
 * 
 * Common cards that use this mechanic:
 * - Restoration Angel: "exile another target creature you control, then return that card"
 * - Cloudshift: "Exile target creature you control, then return that card"
 * - Thassa, Deep-Dwelling: "exile up to one other target creature you control"
 * - Essence Flux: "Exile target creature you control, then return it"
 * - Conjurer's Closet: "exile target creature, return at end of turn"
 * - Brago, King Eternal: "exile any number of target nonland permanents"
 * - Deadeye Navigator: "exile this creature, then return it"
 * 
 * Rules Reference:
 * - Rule 400.7: When an object moves from one zone to another, it becomes a new object
 * - Rule 406: The exile zone
 * - Rule 603: Triggered abilities (ETB triggers fire when returned)
 * - Rule 611.2c: If a permanent leaves and returns, it's a new object
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import { TriggerEvent, type TriggeredAbility, type TriggerInstance, createTriggerInstance } from './triggeredAbilities';

/**
 * Flicker timing types
 */
export enum FlickerTiming {
  /** Return immediately (same resolution) - Cloudshift, Restoration Angel */
  IMMEDIATE = 'immediate',
  /** Return at beginning of next end step - Conjurer's Closet */
  END_STEP = 'end_step',
  /** Return at beginning of next upkeep */
  NEXT_UPKEEP = 'next_upkeep',
  /** Return at end of turn (during cleanup) */
  END_OF_TURN = 'end_of_turn',
  /** Owner's next turn */
  OWNERS_NEXT_TURN = 'owners_next_turn',
  /** Return when the exiling permanent leaves */
  WHEN_EXILER_LEAVES = 'when_exiler_leaves',
  /** Player chooses when to return (activated ability) */
  ON_DEMAND = 'on_demand',
}

/**
 * Flicker return controller options
 */
export enum FlickerReturnController {
  /** Return under owner's control */
  OWNER = 'owner',
  /** Return under controller's control (at time of exile) */
  CONTROLLER = 'controller',
  /** Return under your control (the flicker source's controller) */
  YOUR_CONTROL = 'your_control',
}

/**
 * Flicker effect definition
 */
export interface FlickerEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly timing: FlickerTiming;
  readonly returnController: FlickerReturnController;
  readonly tapped?: boolean; // Return tapped?
  readonly modified?: boolean; // Returns with counters or abilities?
  readonly counterType?: string; // E.g., "+1/+1" for Essence Flux on Spirits
  readonly counterCount?: number;
  readonly grantedAbility?: string;
}

/**
 * Object exiled by a flicker effect, awaiting return
 */
export interface FlickeredObject {
  readonly id: string;
  /** Original permanent ID (no longer valid after exile) */
  readonly originalPermanentId: string;
  /** Card data for recreation */
  readonly card: KnownCardRef;
  /** Original owner */
  readonly ownerId: PlayerID;
  /** Controller at time of exile */
  readonly controllerId: PlayerID;
  /** The flicker effect that exiled this */
  readonly flickerEffectId: string;
  /** Source name for logging */
  readonly sourceName: string;
  /** When this was exiled */
  readonly exiledAt: number;
  /** When to return */
  readonly returnTiming: FlickerTiming;
  /** Who controls on return */
  readonly returnController: FlickerReturnController;
  /** Returns tapped? */
  readonly returnsTapped?: boolean;
  /** Counters to add on return */
  readonly countersOnReturn?: { type: string; count: number };
  /** Abilities granted on return */
  readonly abilitiesOnReturn?: string[];
  /** Was this a token? Tokens can't return from exile */
  readonly wasToken: boolean;
  /** Was commander? */
  readonly wasCommander?: boolean;
  /** Attachments that were on this permanent */
  readonly attachments?: string[];
}

/**
 * Delayed return trigger for non-immediate flickers
 */
export interface DelayedFlickerReturn {
  readonly id: string;
  readonly flickeredObjectId: string;
  readonly triggerCondition: FlickerTiming;
  /** Whose end step / upkeep triggers return (for end_step, next_upkeep) */
  readonly triggerPlayerId?: PlayerID;
  /** For WHEN_EXILER_LEAVES: the permanent that when leaving triggers return */
  readonly exilerPermanentId?: string;
  readonly createdAt: number;
}

/**
 * Result of a flicker action
 */
export interface FlickerResult {
  readonly success: boolean;
  readonly exiledPermanents: readonly FlickeredObject[];
  readonly delayedReturns: readonly DelayedFlickerReturn[];
  readonly immediateReturns: readonly FlickeredObject[];
  readonly logs: readonly string[];
  readonly ltbTriggers: readonly TriggerInstance[];
}

/**
 * Result of returning a flickered object
 */
export interface FlickerReturnResult {
  readonly success: boolean;
  readonly newPermanentId?: string;
  readonly etbTriggers: readonly TriggerInstance[];
  readonly logs: readonly string[];
  readonly error?: string;
}

/**
 * Parse flicker effect from oracle text
 */
export function parseFlickerEffect(
  oracleText: string,
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID
): FlickerEffect | null {
  const text = oracleText.toLowerCase();
  
  // Must have "exile" and "return" in some form
  if (!text.includes('exile') || !text.includes('return')) {
    return null;
  }
  
  // Determine timing
  let timing = FlickerTiming.IMMEDIATE;
  let returnController = FlickerReturnController.OWNER;
  let returnsTapped = false;
  let counterType: string | undefined;
  let counterCount = 1;
  
  // Check for delayed return patterns
  if (text.includes('at the beginning of') && text.includes('end step')) {
    timing = FlickerTiming.END_STEP;
  } else if (text.includes('next end step')) {
    timing = FlickerTiming.END_STEP;
  } else if (text.includes('at the beginning of') && text.includes('upkeep')) {
    timing = FlickerTiming.NEXT_UPKEEP;
  } else if (text.includes('end of turn')) {
    timing = FlickerTiming.END_OF_TURN;
  } else if (text.includes('leaves the battlefield')) {
    timing = FlickerTiming.WHEN_EXILER_LEAVES;
  } else if (text.includes('then return') || text.includes('then returns')) {
    timing = FlickerTiming.IMMEDIATE;
  }
  
  // Check return controller
  if (text.includes('under your control') || text.includes('under its owner\'s control')) {
    if (text.includes('your control')) {
      returnController = FlickerReturnController.YOUR_CONTROL;
    } else {
      returnController = FlickerReturnController.OWNER;
    }
  }
  
  // Check if returns tapped
  if (text.includes('return') && text.includes('tapped')) {
    returnsTapped = true;
  }
  
  // Check for counter bonuses (like Essence Flux)
  const counterMatch = text.match(/with (?:a|(\d+)) \+1\/\+1 counters?/i);
  if (counterMatch) {
    counterType = '+1/+1';
    counterCount = counterMatch[1] ? parseInt(counterMatch[1], 10) : 1;
  }
  
  return {
    id: `flicker-${sourceId}-${Date.now()}`,
    sourceId,
    sourceName,
    controllerId,
    timing,
    returnController,
    tapped: returnsTapped,
    counterType,
    counterCount,
  };
}

/**
 * Execute a flicker effect on target permanents
 * 
 * @param targets - Permanents to flicker
 * @param effect - The flicker effect to apply
 * @param timestamp - Current game timestamp
 * @returns Result of the flicker operation
 */
export function executeFlicker(
  targets: readonly BattlefieldPermanent[],
  effect: FlickerEffect,
  timestamp: number
): FlickerResult {
  const exiledPermanents: FlickeredObject[] = [];
  const delayedReturns: DelayedFlickerReturn[] = [];
  const immediateReturns: FlickeredObject[] = [];
  const logs: string[] = [];
  const ltbTriggers: TriggerInstance[] = [];
  
  for (const target of targets) {
    const card = target.card as KnownCardRef;
    if (!card) continue;
    
    const wasToken = target.isToken === true;
    
    // Create the flickered object record
    const flickeredObj: FlickeredObject = {
      id: `flickered-${target.id}-${timestamp}`,
      originalPermanentId: target.id,
      card,
      ownerId: target.owner,
      controllerId: target.controller,
      flickerEffectId: effect.id,
      sourceName: effect.sourceName,
      exiledAt: timestamp,
      returnTiming: effect.timing,
      returnController: effect.returnController,
      returnsTapped: effect.tapped,
      countersOnReturn: effect.counterType ? {
        type: effect.counterType,
        count: effect.counterCount || 1,
      } : undefined,
      wasToken,
      wasCommander: target.isCommander,
      attachments: target.attachments,
    };
    
    exiledPermanents.push(flickeredObj);
    logs.push(`${card.name} is exiled by ${effect.sourceName}`);
    
    // Create LTB trigger instance
    const ltbTrigger = createLTBTrigger(target, timestamp);
    if (ltbTrigger) {
      ltbTriggers.push(ltbTrigger);
    }
    
    // Tokens cease to exist when they leave the battlefield
    if (wasToken) {
      logs.push(`${card.name} ceases to exist (token)`);
      continue;
    }
    
    // Handle return timing
    if (effect.timing === FlickerTiming.IMMEDIATE) {
      immediateReturns.push(flickeredObj);
    } else {
      // Create delayed trigger
      const delayedReturn: DelayedFlickerReturn = {
        id: `delayed-return-${flickeredObj.id}`,
        flickeredObjectId: flickeredObj.id,
        triggerCondition: effect.timing,
        triggerPlayerId: effect.controllerId,
        exilerPermanentId: effect.timing === FlickerTiming.WHEN_EXILER_LEAVES 
          ? effect.sourceId 
          : undefined,
        createdAt: timestamp,
      };
      delayedReturns.push(delayedReturn);
      logs.push(`${card.name} will return ${getTimingDescription(effect.timing)}`);
    }
  }
  
  return {
    success: exiledPermanents.length > 0,
    exiledPermanents,
    delayedReturns,
    immediateReturns,
    logs,
    ltbTriggers,
  };
}

/**
 * Get human-readable description of return timing
 */
function getTimingDescription(timing: FlickerTiming): string {
  switch (timing) {
    case FlickerTiming.IMMEDIATE:
      return 'immediately';
    case FlickerTiming.END_STEP:
      return 'at the beginning of the next end step';
    case FlickerTiming.NEXT_UPKEEP:
      return 'at the beginning of the next upkeep';
    case FlickerTiming.END_OF_TURN:
      return 'at end of turn';
    case FlickerTiming.OWNERS_NEXT_TURN:
      return 'at the beginning of its owner\'s next turn';
    case FlickerTiming.WHEN_EXILER_LEAVES:
      return 'when the exiling permanent leaves the battlefield';
    case FlickerTiming.ON_DEMAND:
      return 'when you choose';
    default:
      return 'later';
  }
}

/**
 * Create an LTB (leaves the battlefield) trigger for a permanent
 */
function createLTBTrigger(
  permanent: BattlefieldPermanent,
  timestamp: number
): TriggerInstance | null {
  const card = permanent.card as KnownCardRef;
  if (!card) return null;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Check for LTB triggers in oracle text
  const hasLTB = oracleText.includes('leaves the battlefield') ||
                 oracleText.includes('left the battlefield');
  
  if (!hasLTB) return null;
  
  // Create an LTB triggered ability
  const ability: TriggeredAbility = {
    id: `${permanent.id}-ltb`,
    sourceId: permanent.id,
    sourceName: card.name || 'Unknown',
    controllerId: permanent.controller,
    keyword: 'when' as any,
    event: TriggerEvent.LEAVES_BATTLEFIELD,
    effect: 'LTB effect',
  };
  
  return createTriggerInstance(ability, timestamp);
}

/**
 * Return a flickered permanent to the battlefield
 * Creates a new permanent (Rule 400.7)
 */
export function returnFlickeredPermanent(
  flickeredObj: FlickeredObject,
  flickerEffect: FlickerEffect,
  timestamp: number,
  generateNewId: () => string = () => `perm-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
): FlickerReturnResult {
  const logs: string[] = [];
  const etbTriggers: TriggerInstance[] = [];
  
  // Tokens can't return from exile
  if (flickeredObj.wasToken) {
    return {
      success: false,
      etbTriggers: [],
      logs: [`${flickeredObj.card.name} cannot return (was a token)`],
      error: 'Tokens cease to exist when exiled',
    };
  }
  
  // Determine controller on return
  let returnController: PlayerID;
  switch (flickeredObj.returnController) {
    case FlickerReturnController.OWNER:
      returnController = flickeredObj.ownerId;
      break;
    case FlickerReturnController.YOUR_CONTROL:
      returnController = flickerEffect.controllerId;
      break;
    case FlickerReturnController.CONTROLLER:
    default:
      returnController = flickeredObj.controllerId;
      break;
  }
  
  const newPermanentId = generateNewId();
  
  logs.push(`${flickeredObj.card.name} returns to the battlefield under ${
    returnController === flickeredObj.ownerId ? 'its owner\'s' : 'your'
  } control`);
  
  // Check for counters on return
  if (flickeredObj.countersOnReturn) {
    logs.push(`${flickeredObj.card.name} enters with ${flickeredObj.countersOnReturn.count} ${flickeredObj.countersOnReturn.type} counter(s)`);
  }
  
  // Check if returns tapped
  if (flickeredObj.returnsTapped) {
    logs.push(`${flickeredObj.card.name} enters tapped`);
  }
  
  // Create ETB trigger
  const ability: TriggeredAbility = {
    id: `${newPermanentId}-etb`,
    sourceId: newPermanentId,
    sourceName: flickeredObj.card.name || 'Unknown',
    controllerId: returnController,
    keyword: 'when' as any,
    event: TriggerEvent.ENTERS_BATTLEFIELD,
    effect: 'ETB effect',
  };
  
  etbTriggers.push(createTriggerInstance(ability, timestamp));
  
  return {
    success: true,
    newPermanentId,
    etbTriggers,
    logs,
  };
}

/**
 * Check if delayed flicker returns should trigger
 */
export function checkDelayedFlickerReturns(
  delayedReturns: readonly DelayedFlickerReturn[],
  currentEvent: {
    type: 'end_step' | 'upkeep' | 'cleanup' | 'permanent_left';
    playerId?: PlayerID;
    permanentId?: string;
  }
): DelayedFlickerReturn[] {
  const triggeredReturns: DelayedFlickerReturn[] = [];
  
  for (const delayed of delayedReturns) {
    let shouldTrigger = false;
    
    switch (delayed.triggerCondition) {
      case FlickerTiming.END_STEP:
        if (currentEvent.type === 'end_step') {
          shouldTrigger = true;
        }
        break;
        
      case FlickerTiming.NEXT_UPKEEP:
        if (currentEvent.type === 'upkeep') {
          shouldTrigger = true;
        }
        break;
        
      case FlickerTiming.END_OF_TURN:
        if (currentEvent.type === 'cleanup') {
          shouldTrigger = true;
        }
        break;
        
      case FlickerTiming.WHEN_EXILER_LEAVES:
        if (currentEvent.type === 'permanent_left' &&
            currentEvent.permanentId === delayed.exilerPermanentId) {
          shouldTrigger = true;
        }
        break;
    }
    
    if (shouldTrigger) {
      triggeredReturns.push(delayed);
    }
  }
  
  return triggeredReturns;
}

/**
 * Common flicker effects parsed from well-known cards
 */
export const COMMON_FLICKER_CARDS: Record<string, Partial<FlickerEffect>> = {
  'Cloudshift': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Restoration Angel': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Ephemerate': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Flicker': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.OWNER,
  },
  'Momentary Blink': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Essence Flux': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
    counterType: '+1/+1',
    counterCount: 1,
  },
  'Conjurer\'s Closet': {
    timing: FlickerTiming.END_STEP,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Thassa, Deep-Dwelling': {
    timing: FlickerTiming.END_STEP,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Brago, King Eternal': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Deadeye Navigator': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Yorion, Sky Nomad': {
    timing: FlickerTiming.END_STEP,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Flickerwisp': {
    timing: FlickerTiming.END_STEP,
    returnController: FlickerReturnController.OWNER,
  },
  'Venser, the Sojourner': {
    timing: FlickerTiming.END_STEP,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Eldrazi Displacer': {
    timing: FlickerTiming.IMMEDIATE,
    returnController: FlickerReturnController.YOUR_CONTROL,
    tapped: true,
  },
  'Ghostway': {
    timing: FlickerTiming.END_STEP,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Eerie Interlude': {
    timing: FlickerTiming.END_STEP,
    returnController: FlickerReturnController.YOUR_CONTROL,
  },
  'Glorious Protector': {
    timing: FlickerTiming.WHEN_EXILER_LEAVES,
    returnController: FlickerReturnController.OWNER,
  },
  'Fiend Hunter': {
    timing: FlickerTiming.WHEN_EXILER_LEAVES,
    returnController: FlickerReturnController.OWNER,
  },
  'Banisher Priest': {
    timing: FlickerTiming.WHEN_EXILER_LEAVES,
    returnController: FlickerReturnController.OWNER,
  },
};

/**
 * Detect if a card has a flicker effect
 */
export function isFlickerCard(cardName: string): boolean {
  return cardName in COMMON_FLICKER_CARDS;
}

/**
 * Get flicker effect configuration for a known card
 */
export function getFlickerEffectForCard(
  cardName: string,
  sourceId: string,
  controllerId: PlayerID
): FlickerEffect | null {
  const config = COMMON_FLICKER_CARDS[cardName];
  if (!config) return null;
  
  return {
    id: `flicker-${sourceId}-${Date.now()}`,
    sourceId,
    sourceName: cardName,
    controllerId,
    timing: config.timing || FlickerTiming.IMMEDIATE,
    returnController: config.returnController || FlickerReturnController.OWNER,
    tapped: config.tapped,
    counterType: config.counterType,
    counterCount: config.counterCount,
  };
}

/**
 * Handle commander going to exile - commander replacement effect
 * Rule 903.9a: If a commander would be exiled or put into graveyard,
 * its owner may put it in command zone instead.
 */
export interface CommanderExileChoice {
  readonly permanentId: string;
  readonly cardName: string;
  readonly ownerId: PlayerID;
  readonly chooseCommandZone: boolean;
}

export function handleCommanderFlicker(
  flickeredObj: FlickeredObject,
  playerChoseCommandZone: boolean
): {
  goesToCommandZone: boolean;
  log: string;
} {
  if (!flickeredObj.wasCommander) {
    return {
      goesToCommandZone: false,
      log: '',
    };
  }
  
  if (playerChoseCommandZone) {
    return {
      goesToCommandZone: true,
      log: `${flickeredObj.card.name} is put into the command zone instead of exile`,
    };
  }
  
  return {
    goesToCommandZone: false,
    log: `${flickeredObj.card.name} goes to exile (owner did not choose command zone)`,
  };
}

export default {
  parseFlickerEffect,
  executeFlicker,
  returnFlickeredPermanent,
  checkDelayedFlickerReturns,
  isFlickerCard,
  getFlickerEffectForCard,
  handleCommanderFlicker,
  COMMON_FLICKER_CARDS,
};
