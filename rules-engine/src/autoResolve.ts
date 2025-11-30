/**
 * autoResolve.ts
 * 
 * Handles auto-resolve and auto-choice settings for triggered abilities.
 * This allows players to:
 * 1. Auto-pass on certain trigger types (always decline to respond)
 * 2. Auto-choose a default option for "pay X or Y happens" triggers
 * 
 * Common use cases:
 * - Rhystic Study: Opponent can auto-pay {1} or auto-let controller draw
 * - Smothering Tithe: Opponent can auto-pay {2} or auto-give controller Treasure
 * - Mystic Remora: Opponent can auto-pay {4} or auto-let controller draw
 * - Propaganda/Ghostly Prison: Attacker can auto-pay or auto-not attack
 * 
 * Rules Reference:
 * - Rule 603.5: Ordering of triggered abilities (APNAP)
 * - Rule 117.3c: Priority and passing
 */

import type { PlayerID } from '../../shared/src';

/**
 * Types of auto-resolve behavior
 */
export enum AutoResolveType {
  /** Always pass priority for this trigger (let it resolve) */
  AUTO_PASS = 'auto_pass',
  /** Always choose to pay the cost */
  AUTO_PAY = 'auto_pay',
  /** Always decline to pay (let the effect happen) */
  AUTO_DECLINE = 'auto_decline',
  /** Always ask the player (default behavior) */
  ALWAYS_ASK = 'always_ask',
}

/**
 * Auto-resolve setting for a specific trigger
 */
export interface AutoResolveSetting {
  readonly id: string;
  readonly playerId: PlayerID;
  /** Card name that owns the trigger (e.g., "Rhystic Study") */
  readonly triggerSource: string;
  /** Permanent ID if tracking a specific permanent */
  readonly permanentId?: string;
  /** The chosen auto-resolve behavior */
  readonly behavior: AutoResolveType;
  /** Optional: for triggers with multiple choices, the specific choice */
  readonly chosenOption?: string;
  /** When this setting was created */
  readonly createdAt: number;
  /** Whether this setting applies only to the current game or persists */
  readonly persistent: boolean;
}

/**
 * Known "pay or" triggers and their default options
 */
export interface PayOrTriggerDefinition {
  readonly cardName: string;
  readonly triggerDescription: string;
  readonly paymentCost: string;        // e.g., "{1}", "{2}", "{4}"
  readonly paymentDescription: string; // e.g., "Pay {1}"
  readonly declineEffect: string;      // e.g., "Controller draws a card"
  readonly affectsController: boolean; // Whether the trigger owner benefits from decline
  readonly affectsOpponent: boolean;   // Whether opponent must make the choice
}

/**
 * Well-known "pay or" triggers in MTG
 */
export const KNOWN_PAY_OR_TRIGGERS: Record<string, PayOrTriggerDefinition> = {
  'Rhystic Study': {
    cardName: 'Rhystic Study',
    triggerDescription: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    paymentCost: '{1}',
    paymentDescription: 'Pay {1}',
    declineEffect: 'Controller draws a card',
    affectsController: true,
    affectsOpponent: true,
  },
  'Smothering Tithe': {
    cardName: 'Smothering Tithe',
    triggerDescription: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
    paymentCost: '{2}',
    paymentDescription: 'Pay {2}',
    declineEffect: 'Controller creates a Treasure token',
    affectsController: true,
    affectsOpponent: true,
  },
  'Mystic Remora': {
    cardName: 'Mystic Remora',
    triggerDescription: 'Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.',
    paymentCost: '{4}',
    paymentDescription: 'Pay {4}',
    declineEffect: 'Controller draws a card',
    affectsController: true,
    affectsOpponent: true,
  },
  'Propaganda': {
    cardName: 'Propaganda',
    triggerDescription: 'Creatures can\'t attack you unless their controller pays {2} for each creature they control that\'s attacking you.',
    paymentCost: '{2}',
    paymentDescription: 'Pay {2} per attacker',
    declineEffect: 'Creature can\'t attack',
    affectsController: false,
    affectsOpponent: true,
  },
  'Ghostly Prison': {
    cardName: 'Ghostly Prison',
    triggerDescription: 'Creatures can\'t attack you unless their controller pays {2} for each creature they control that\'s attacking you.',
    paymentCost: '{2}',
    paymentDescription: 'Pay {2} per attacker',
    declineEffect: 'Creature can\'t attack',
    affectsController: false,
    affectsOpponent: true,
  },
  'Sphere of Safety': {
    cardName: 'Sphere of Safety',
    triggerDescription: 'Creatures can\'t attack you unless their controller pays {X} for each creature they control that\'s attacking you, where X is the number of enchantments you control.',
    paymentCost: '{X}',
    paymentDescription: 'Pay {X} per attacker',
    declineEffect: 'Creature can\'t attack',
    affectsController: false,
    affectsOpponent: true,
  },
  'Consecrated Sphinx': {
    cardName: 'Consecrated Sphinx',
    triggerDescription: 'Whenever an opponent draws a card, you may draw two cards.',
    paymentCost: '',
    paymentDescription: 'Draw two cards',
    declineEffect: 'Draw nothing',
    affectsController: true,
    affectsOpponent: false,
  },
  'Land Tax': {
    cardName: 'Land Tax',
    triggerDescription: 'At the beginning of your upkeep, if an opponent controls more lands than you, you may search your library for up to three basic land cards.',
    paymentCost: '',
    paymentDescription: 'Search for lands',
    declineEffect: 'Don\'t search',
    affectsController: true,
    affectsOpponent: false,
  },
};

/**
 * Player's auto-resolve preferences
 */
export interface PlayerAutoResolvePreferences {
  readonly playerId: PlayerID;
  readonly settings: Map<string, AutoResolveSetting>;
  /** Global default for unknown triggers */
  readonly defaultBehavior: AutoResolveType;
}

/**
 * Create default auto-resolve preferences for a player
 */
export function createDefaultPreferences(playerId: PlayerID): PlayerAutoResolvePreferences {
  return {
    playerId,
    settings: new Map(),
    defaultBehavior: AutoResolveType.ALWAYS_ASK,
  };
}

/**
 * Add or update an auto-resolve setting
 */
export function setAutoResolveSetting(
  preferences: PlayerAutoResolvePreferences,
  triggerSource: string,
  behavior: AutoResolveType,
  permanentId?: string,
  chosenOption?: string,
  persistent: boolean = false
): PlayerAutoResolvePreferences {
  const key = permanentId ? `${triggerSource}:${permanentId}` : triggerSource;
  
  const newSetting: AutoResolveSetting = {
    id: key,
    playerId: preferences.playerId,
    triggerSource,
    permanentId,
    behavior,
    chosenOption,
    createdAt: Date.now(),
    persistent,
  };
  
  const newSettings = new Map(preferences.settings);
  newSettings.set(key, newSetting);
  
  return {
    ...preferences,
    settings: newSettings,
  };
}

/**
 * Remove an auto-resolve setting
 */
export function removeAutoResolveSetting(
  preferences: PlayerAutoResolvePreferences,
  triggerSource: string,
  permanentId?: string
): PlayerAutoResolvePreferences {
  const key = permanentId ? `${triggerSource}:${permanentId}` : triggerSource;
  
  const newSettings = new Map(preferences.settings);
  newSettings.delete(key);
  
  return {
    ...preferences,
    settings: newSettings,
  };
}

/**
 * Get the auto-resolve behavior for a specific trigger
 */
export function getAutoResolveBehavior(
  preferences: PlayerAutoResolvePreferences,
  triggerSource: string,
  permanentId?: string
): AutoResolveType {
  // First check for permanent-specific setting
  if (permanentId) {
    const specificKey = `${triggerSource}:${permanentId}`;
    const specificSetting = preferences.settings.get(specificKey);
    if (specificSetting) {
      return specificSetting.behavior;
    }
  }
  
  // Then check for card name setting
  const cardSetting = preferences.settings.get(triggerSource);
  if (cardSetting) {
    return cardSetting.behavior;
  }
  
  // Fall back to default
  return preferences.defaultBehavior;
}

/**
 * Check if a trigger should be auto-resolved based on player preferences
 */
export function shouldAutoResolve(
  preferences: PlayerAutoResolvePreferences,
  triggerSource: string,
  permanentId?: string
): { autoResolve: boolean; behavior: AutoResolveType; chosenOption?: string } {
  const behavior = getAutoResolveBehavior(preferences, triggerSource, permanentId);
  
  if (behavior === AutoResolveType.ALWAYS_ASK) {
    return { autoResolve: false, behavior };
  }
  
  // Get the chosen option if available
  const key = permanentId ? `${triggerSource}:${permanentId}` : triggerSource;
  const setting = preferences.settings.get(key);
  
  return {
    autoResolve: true,
    behavior,
    chosenOption: setting?.chosenOption,
  };
}

/**
 * Check if a card is a known "pay or" trigger
 */
export function isKnownPayOrTrigger(cardName: string): boolean {
  return cardName in KNOWN_PAY_OR_TRIGGERS;
}

/**
 * Get the definition of a known "pay or" trigger
 */
export function getPayOrTriggerDefinition(cardName: string): PayOrTriggerDefinition | undefined {
  return KNOWN_PAY_OR_TRIGGERS[cardName];
}

/**
 * Result of applying auto-resolve to a trigger
 */
export interface AutoResolveResult {
  /** Whether auto-resolve was applied */
  readonly applied: boolean;
  /** The resolution action (if applied) */
  readonly action?: 'pay' | 'decline' | 'pass';
  /** The chosen option (for multi-choice triggers) */
  readonly chosenOption?: string;
  /** Log message describing what happened */
  readonly log: string;
}

/**
 * Apply auto-resolve settings to a trigger
 */
export function applyAutoResolve(
  preferences: PlayerAutoResolvePreferences,
  triggerSource: string,
  permanentId?: string
): AutoResolveResult {
  const { autoResolve, behavior, chosenOption } = shouldAutoResolve(
    preferences,
    triggerSource,
    permanentId
  );
  
  if (!autoResolve) {
    return {
      applied: false,
      log: `Waiting for player decision on ${triggerSource} trigger`,
    };
  }
  
  switch (behavior) {
    case AutoResolveType.AUTO_PASS:
      return {
        applied: true,
        action: 'pass',
        log: `Auto-passing on ${triggerSource} trigger (player preference)`,
      };
      
    case AutoResolveType.AUTO_PAY:
      return {
        applied: true,
        action: 'pay',
        chosenOption,
        log: `Auto-paying for ${triggerSource} trigger (player preference)`,
      };
      
    case AutoResolveType.AUTO_DECLINE:
      return {
        applied: true,
        action: 'decline',
        log: `Auto-declining to pay for ${triggerSource} trigger (player preference)`,
      };
      
    default:
      return {
        applied: false,
        log: `Waiting for player decision on ${triggerSource} trigger`,
      };
  }
}

/**
 * Create a UI-friendly list of auto-resolve options for a trigger
 */
export function getAutoResolveOptionsForTrigger(
  cardName: string
): { value: AutoResolveType; label: string; description: string }[] {
  const definition = KNOWN_PAY_OR_TRIGGERS[cardName];
  
  const options = [
    {
      value: AutoResolveType.ALWAYS_ASK,
      label: 'Always Ask',
      description: 'Always prompt for a decision',
    },
    {
      value: AutoResolveType.AUTO_PASS,
      label: 'Auto-Pass',
      description: 'Automatically pass priority (let trigger resolve)',
    },
  ];
  
  if (definition && definition.paymentCost) {
    options.push({
      value: AutoResolveType.AUTO_PAY,
      label: `Auto-Pay (${definition.paymentCost})`,
      description: definition.paymentDescription,
    });
    options.push({
      value: AutoResolveType.AUTO_DECLINE,
      label: 'Auto-Decline',
      description: definition.declineEffect,
    });
  }
  
  return options;
}

/**
 * Serialize preferences for storage/transmission
 */
export function serializePreferences(preferences: PlayerAutoResolvePreferences): {
  playerId: PlayerID;
  settings: AutoResolveSetting[];
  defaultBehavior: AutoResolveType;
} {
  return {
    playerId: preferences.playerId,
    settings: Array.from(preferences.settings.values()),
    defaultBehavior: preferences.defaultBehavior,
  };
}

/**
 * Deserialize preferences from storage/transmission
 */
export function deserializePreferences(data: {
  playerId: PlayerID;
  settings: AutoResolveSetting[];
  defaultBehavior: AutoResolveType;
}): PlayerAutoResolvePreferences {
  const settings = new Map<string, AutoResolveSetting>();
  for (const setting of data.settings) {
    settings.set(setting.id, setting);
  }
  
  return {
    playerId: data.playerId,
    settings,
    defaultBehavior: data.defaultBehavior,
  };
}

export default {
  AutoResolveType,
  KNOWN_PAY_OR_TRIGGERS,
  createDefaultPreferences,
  setAutoResolveSetting,
  removeAutoResolveSetting,
  getAutoResolveBehavior,
  shouldAutoResolve,
  isKnownPayOrTrigger,
  getPayOrTriggerDefinition,
  applyAutoResolve,
  getAutoResolveOptionsForTrigger,
  serializePreferences,
  deserializePreferences,
};
