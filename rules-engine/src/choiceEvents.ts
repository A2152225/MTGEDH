/**
 * choiceEvents.ts
 * 
 * Comprehensive choice event system for MTG Online-style gameplay.
 * This module centralizes all player choice events and their emission.
 * 
 * Choice events are emitted when the game engine requires player input
 * for decisions that cannot be automated. The UI layer listens for these
 * events and displays appropriate modals/popups.
 * 
 * Categories of choices:
 * 1. Manual Required (by design):
 *    - Target Selection
 *    - Mode Selection
 *    - X Value Selection
 *    - Attacker Declaration
 *    - Blocker Declaration
 *    - May Ability Resolution
 * 
 * 2. Enhanced Partial Implementations:
 *    - Combat Damage Assignment (complex blocking)
 *    - Cleanup Step Hand Size (discard selection)
 *    - Token Zone Movement (cease to exist notification)
 *    - Same Controller Trigger Order
 *    - Player Chooses Replacement Effect
 * 
 * 3. Pending Items (newly added):
 *    - Copy Zone Movement (Rule 704.5e)
 *    - Win Effect Cards (Rule 104.2b)
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';

/**
 * All possible choice event types
 */
export enum ChoiceEventType {
  // Manual Required
  TARGET_SELECTION = 'target_selection',
  MODE_SELECTION = 'mode_selection',
  X_VALUE_SELECTION = 'x_value_selection',
  ATTACKER_DECLARATION = 'attacker_declaration',
  BLOCKER_DECLARATION = 'blocker_declaration',
  MAY_ABILITY = 'may_ability',
  
  // Combat
  COMBAT_DAMAGE_ASSIGNMENT = 'combat_damage_assignment',
  BLOCKER_ORDER = 'blocker_order',
  DAMAGE_DIVISION = 'damage_division',
  
  // Cleanup & Hand Management
  DISCARD_SELECTION = 'discard_selection',
  HAND_TO_BOTTOM = 'hand_to_bottom',
  
  // Zone Movement
  TOKEN_CEASES_TO_EXIST = 'token_ceases_to_exist',
  COPY_CEASES_TO_EXIST = 'copy_ceases_to_exist',
  COMMANDER_ZONE_CHOICE = 'commander_zone_choice',
  
  // Triggers
  TRIGGER_ORDER = 'trigger_order',
  TRIGGER_TARGET = 'trigger_target',
  
  // Replacement Effects
  REPLACEMENT_EFFECT_CHOICE = 'replacement_effect_choice',
  
  // Win Effects
  WIN_EFFECT_TRIGGERED = 'win_effect_triggered',
  CANT_LOSE_PREVENTED = 'cant_lose_prevented',
  
  // Mana
  MANA_PAYMENT_CHOICE = 'mana_payment_choice',
  
  // Other
  COLOR_CHOICE = 'color_choice',
  CREATURE_TYPE_CHOICE = 'creature_type_choice',
  CARD_NAME_CHOICE = 'card_name_choice',
  NUMBER_CHOICE = 'number_choice',
  PLAYER_CHOICE = 'player_choice',
  OPTION_CHOICE = 'option_choice',
}

/**
 * Base interface for all choice events
 */
export interface BaseChoiceEvent {
  readonly id: string;
  readonly type: ChoiceEventType;
  readonly playerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly sourceImage?: string;
  readonly description: string;
  readonly mandatory: boolean;
  readonly timestamp: number;
  readonly timeoutMs?: number;
}

/**
 * Option for a choice
 */
export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** For ordered choices, the current order index */
  readonly orderIndex?: number;
}

/**
 * Target selection event
 */
export interface TargetSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.TARGET_SELECTION;
  readonly validTargets: readonly ChoiceOption[];
  readonly targetTypes: readonly string[];
  readonly minTargets: number;
  readonly maxTargets: number;
  /** Filter text for display (e.g., "target creature or planeswalker") */
  readonly targetDescription: string;
}

/**
 * Mode selection event
 */
export interface ModeSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.MODE_SELECTION;
  readonly modes: readonly ChoiceOption[];
  readonly minModes: number;
  readonly maxModes: number;
  /** Whether the same mode can be chosen multiple times */
  readonly allowDuplicates: boolean;
}

/**
 * X value selection event
 */
export interface XValueSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.X_VALUE_SELECTION;
  readonly minX: number;
  readonly maxX: number;
  readonly costPerX?: string;
}

/**
 * Attacker declaration event
 */
export interface AttackerDeclarationEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.ATTACKER_DECLARATION;
  readonly legalAttackers: readonly ChoiceOption[];
  readonly defendingPlayers: readonly { id: PlayerID; name: string }[];
  /** Attack cost requirements (e.g., Propaganda) */
  readonly attackCosts?: readonly {
    permanentId: string;
    permanentName: string;
    costDescription: string;
  }[];
}

/**
 * Blocker declaration event
 */
export interface BlockerDeclarationEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.BLOCKER_DECLARATION;
  readonly legalBlockers: readonly ChoiceOption[];
  readonly attackers: readonly {
    id: string;
    name: string;
    imageUrl?: string;
    power: number;
    keywords: readonly string[];
  }[];
  /** Blocking restrictions (e.g., menace, flying) */
  readonly restrictions: readonly {
    attackerId: string;
    restriction: string;
  }[];
}

/**
 * May ability event
 */
export interface MayAbilityEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.MAY_ABILITY;
  readonly abilityText: string;
  /** Cost to pay if choosing yes */
  readonly cost?: string;
  /** Default choice if timeout */
  readonly defaultChoice: 'yes' | 'no';
}

/**
 * Combat damage assignment event
 */
export interface CombatDamageAssignmentEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.COMBAT_DAMAGE_ASSIGNMENT;
  readonly attackerId: string;
  readonly attackerName: string;
  readonly attackerPower: number;
  readonly blockers: readonly {
    id: string;
    name: string;
    toughness: number;
    existingDamage: number;
    lethalDamage: number;
  }[];
  /** Whether the attacker has trample */
  readonly hasTrample: boolean;
  /** Defending player ID for trample damage */
  readonly defendingPlayerId?: PlayerID;
}

/**
 * Blocker order event
 */
export interface BlockerOrderEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.BLOCKER_ORDER;
  readonly attackerId: string;
  readonly attackerName: string;
  readonly blockers: readonly ChoiceOption[];
}

/**
 * Discard selection event
 */
export interface DiscardSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.DISCARD_SELECTION;
  readonly hand: readonly ChoiceOption[];
  readonly discardCount: number;
  readonly currentHandSize: number;
  readonly maxHandSize: number;
  /** Reason for discard (cleanup, spell effect, etc.) */
  readonly reason: 'cleanup' | 'effect';
}

/**
 * Token ceases to exist notification
 */
export interface TokenCeasesToExistEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.TOKEN_CEASES_TO_EXIST;
  readonly tokenIds: readonly string[];
  readonly tokenNames: readonly string[];
  readonly zone: string;
  readonly reason: string;
}

/**
 * Copy ceases to exist notification (Rule 704.5e)
 */
export interface CopyCeasesToExistEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.COPY_CEASES_TO_EXIST;
  readonly copyId: string;
  readonly copyName: string;
  readonly copyType: 'spell' | 'card';
  readonly zone: string;
  readonly originalId?: string;
  readonly originalName?: string;
}

/**
 * Commander zone choice event
 */
export interface CommanderZoneChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.COMMANDER_ZONE_CHOICE;
  readonly commanderId: string;
  readonly commanderName: string;
  readonly fromZone: 'graveyard' | 'exile';
  readonly toZone: 'command' | 'graveyard' | 'exile';
}

/**
 * Trigger order event
 */
export interface TriggerOrderEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.TRIGGER_ORDER;
  readonly triggers: readonly ChoiceOption[];
  /** Whether all triggers must be ordered or some can be skipped */
  readonly requireAll: boolean;
}

/**
 * Replacement effect choice event
 */
export interface ReplacementEffectChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.REPLACEMENT_EFFECT_CHOICE;
  readonly replacementEffects: readonly ChoiceOption[];
  readonly affectedEvent: string;
  /** The player affected by the event (may differ from choosing player) */
  readonly affectedPlayerId: PlayerID;
}

/**
 * Win effect triggered event
 */
export interface WinEffectTriggeredEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.WIN_EFFECT_TRIGGERED;
  readonly winningPlayerId: PlayerID;
  readonly winReason: string;
  readonly sourceId: string;
  readonly sourceName: string;
}

/**
 * Color choice event
 */
export interface ColorChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.COLOR_CHOICE;
  readonly colors: readonly ChoiceOption[];
  readonly minColors: number;
  readonly maxColors: number;
}

/**
 * Creature type choice event
 */
export interface CreatureTypeChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.CREATURE_TYPE_CHOICE;
  readonly suggestedTypes: readonly string[];
  readonly allowCustom: boolean;
}

/**
 * Number choice event
 */
export interface NumberChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.NUMBER_CHOICE;
  readonly minValue: number;
  readonly maxValue: number;
  readonly defaultValue?: number;
}

/**
 * Player choice event
 */
export interface PlayerChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.PLAYER_CHOICE;
  readonly validPlayers: readonly { id: PlayerID; name: string }[];
  readonly allowSelf: boolean;
  readonly allowOpponents: boolean;
}

/**
 * Generic option choice event
 */
export interface OptionChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.OPTION_CHOICE;
  readonly options: readonly ChoiceOption[];
  readonly minSelections: number;
  readonly maxSelections: number;
}

/**
 * Union of all choice events
 */
export type ChoiceEvent =
  | TargetSelectionEvent
  | ModeSelectionEvent
  | XValueSelectionEvent
  | AttackerDeclarationEvent
  | BlockerDeclarationEvent
  | MayAbilityEvent
  | CombatDamageAssignmentEvent
  | BlockerOrderEvent
  | DiscardSelectionEvent
  | TokenCeasesToExistEvent
  | CopyCeasesToExistEvent
  | CommanderZoneChoiceEvent
  | TriggerOrderEvent
  | ReplacementEffectChoiceEvent
  | WinEffectTriggeredEvent
  | ColorChoiceEvent
  | CreatureTypeChoiceEvent
  | NumberChoiceEvent
  | PlayerChoiceEvent
  | OptionChoiceEvent;

/**
 * Response to a choice event
 */
export interface ChoiceResponse {
  readonly eventId: string;
  readonly playerId: PlayerID;
  readonly selections: readonly string[] | number | boolean;
  readonly cancelled: boolean;
  readonly timestamp: number;
}

/**
 * Choice event emitter interface
 */
export interface ChoiceEventEmitter {
  emit(event: ChoiceEvent): void;
  onResponse(eventId: string, response: ChoiceResponse): void;
}

// =============================================================================
// Factory Functions
// =============================================================================

let eventIdCounter = 0;

function generateEventId(): string {
  return `choice-${Date.now()}-${++eventIdCounter}`;
}

/**
 * Create a target selection event
 */
export function createTargetSelectionEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  validTargets: readonly { id: string; name: string; imageUrl?: string }[],
  targetTypes: readonly string[],
  minTargets: number,
  maxTargets: number,
  mandatory: boolean = true,
  sourceImage?: string
): TargetSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.TARGET_SELECTION,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `Choose target${maxTargets > 1 ? 's' : ''} for ${sourceName}`,
    mandatory,
    timestamp: Date.now(),
    validTargets: validTargets.map(t => ({
      id: t.id,
      label: t.name,
      imageUrl: t.imageUrl,
    })),
    targetTypes,
    minTargets,
    maxTargets,
    targetDescription: targetTypes.join(' or '),
  };
}

/**
 * Create a mode selection event
 */
export function createModeSelectionEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  modes: readonly { id: string; text: string }[],
  minModes: number,
  maxModes: number,
  sourceImage?: string
): ModeSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.MODE_SELECTION,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `Choose ${minModes === maxModes ? minModes : `${minModes}-${maxModes}`} mode${maxModes > 1 ? 's' : ''} for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    modes: modes.map((m, i) => ({
      id: m.id || `mode-${i}`,
      label: m.text,
    })),
    minModes,
    maxModes,
    allowDuplicates: false,
  };
}

/**
 * Create an X value selection event
 */
export function createXValueSelectionEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  minX: number,
  maxX: number,
  sourceImage?: string,
  costPerX?: string
): XValueSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.X_VALUE_SELECTION,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `Choose value for X in ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    minX,
    maxX,
    costPerX,
  };
}

/**
 * Create an attacker declaration event
 */
export function createAttackerDeclarationEvent(
  playerId: PlayerID,
  legalAttackers: readonly BattlefieldPermanent[],
  defendingPlayers: readonly { id: PlayerID; name: string }[],
  attackCosts?: readonly { permanentId: string; permanentName: string; costDescription: string }[]
): AttackerDeclarationEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.ATTACKER_DECLARATION,
    playerId,
    description: 'Declare attackers',
    mandatory: false,
    timestamp: Date.now(),
    legalAttackers: legalAttackers.map(p => {
      const card = p.card as KnownCardRef;
      return {
        id: p.id,
        label: card?.name || 'Creature',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
    defendingPlayers,
    attackCosts,
  };
}

/**
 * Create a blocker declaration event
 */
export function createBlockerDeclarationEvent(
  playerId: PlayerID,
  legalBlockers: readonly BattlefieldPermanent[],
  attackers: readonly { permanent: BattlefieldPermanent; keywords: readonly string[] }[]
): BlockerDeclarationEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.BLOCKER_DECLARATION,
    playerId,
    description: 'Declare blockers',
    mandatory: false,
    timestamp: Date.now(),
    legalBlockers: legalBlockers.map(p => {
      const card = p.card as KnownCardRef;
      return {
        id: p.id,
        label: card?.name || 'Creature',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
    attackers: attackers.map(a => {
      const card = a.permanent.card as KnownCardRef;
      return {
        id: a.permanent.id,
        name: card?.name || 'Creature',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        power: parseInt(String(card?.power || '0'), 10),
        keywords: a.keywords,
      };
    }),
    restrictions: [],
  };
}

/**
 * Create a may ability event
 */
export function createMayAbilityEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  abilityText: string,
  cost?: string,
  sourceImage?: string
): MayAbilityEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.MAY_ABILITY,
    playerId,
    sourceId,
    sourceName,
    sourceImage,
    description: `${sourceName}: ${abilityText}`,
    mandatory: false,
    timestamp: Date.now(),
    abilityText,
    cost,
    defaultChoice: 'no',
  };
}

/**
 * Create a combat damage assignment event
 */
export function createCombatDamageAssignmentEvent(
  playerId: PlayerID,
  attackerId: string,
  attackerName: string,
  attackerPower: number,
  blockers: readonly {
    id: string;
    name: string;
    toughness: number;
    existingDamage: number;
    lethalDamage: number;
  }[],
  hasTrample: boolean,
  defendingPlayerId?: PlayerID
): CombatDamageAssignmentEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COMBAT_DAMAGE_ASSIGNMENT,
    playerId,
    sourceId: attackerId,
    sourceName: attackerName,
    description: `Assign ${attackerPower} damage from ${attackerName}`,
    mandatory: true,
    timestamp: Date.now(),
    attackerId,
    attackerName,
    attackerPower,
    blockers,
    hasTrample,
    defendingPlayerId,
  };
}

/**
 * Create a blocker order event
 */
export function createBlockerOrderEvent(
  playerId: PlayerID,
  attackerId: string,
  attackerName: string,
  blockers: readonly BattlefieldPermanent[]
): BlockerOrderEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.BLOCKER_ORDER,
    playerId,
    sourceId: attackerId,
    sourceName: attackerName,
    description: `Order blockers for ${attackerName}`,
    mandatory: true,
    timestamp: Date.now(),
    attackerId,
    attackerName,
    blockers: blockers.map(b => {
      const card = b.card as KnownCardRef;
      return {
        id: b.id,
        label: card?.name || 'Blocker',
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      };
    }),
  };
}

/**
 * Create a discard selection event
 */
export function createDiscardSelectionEvent(
  playerId: PlayerID,
  hand: readonly KnownCardRef[],
  discardCount: number,
  maxHandSize: number,
  reason: 'cleanup' | 'effect',
  sourceId?: string,
  sourceName?: string
): DiscardSelectionEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.DISCARD_SELECTION,
    playerId,
    sourceId,
    sourceName,
    description: reason === 'cleanup'
      ? `Discard ${discardCount} card${discardCount > 1 ? 's' : ''} to hand size`
      : `Discard ${discardCount} card${discardCount > 1 ? 's' : ''}`,
    mandatory: true,
    timestamp: Date.now(),
    hand: hand.map(c => ({
      id: c.id,
      label: c.name,
      imageUrl: c.image_uris?.small || c.image_uris?.normal,
    })),
    discardCount,
    currentHandSize: hand.length,
    maxHandSize,
    reason,
  };
}

/**
 * Create a token ceases to exist event (Rule 704.5d)
 */
export function createTokenCeasesToExistEvent(
  playerId: PlayerID,
  tokens: readonly { id: string; name: string }[],
  zone: string
): TokenCeasesToExistEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.TOKEN_CEASES_TO_EXIST,
    playerId,
    description: `Token${tokens.length > 1 ? 's' : ''} ${tokens.map(t => t.name).join(', ')} ceased to exist`,
    mandatory: false,
    timestamp: Date.now(),
    tokenIds: tokens.map(t => t.id),
    tokenNames: tokens.map(t => t.name),
    zone,
    reason: `Token in ${zone}, not battlefield (Rule 704.5d)`,
  };
}

/**
 * Create a copy ceases to exist event (Rule 704.5e)
 */
export function createCopyCeasesToExistEvent(
  playerId: PlayerID,
  copyId: string,
  copyName: string,
  copyType: 'spell' | 'card',
  zone: string,
  originalId?: string,
  originalName?: string
): CopyCeasesToExistEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COPY_CEASES_TO_EXIST,
    playerId,
    description: `Copy of ${originalName || copyName} ceased to exist`,
    mandatory: false,
    timestamp: Date.now(),
    copyId,
    copyName,
    copyType,
    zone,
    originalId,
    originalName,
  };
}

/**
 * Create a commander zone choice event
 */
export function createCommanderZoneChoiceEvent(
  playerId: PlayerID,
  commanderId: string,
  commanderName: string,
  fromZone: 'graveyard' | 'exile'
): CommanderZoneChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COMMANDER_ZONE_CHOICE,
    playerId,
    sourceId: commanderId,
    sourceName: commanderName,
    description: `${commanderName} would be put into ${fromZone}. Move to command zone?`,
    mandatory: false,
    timestamp: Date.now(),
    commanderId,
    commanderName,
    fromZone,
    toZone: 'command',
  };
}

/**
 * Create a trigger order event
 */
export function createTriggerOrderEvent(
  playerId: PlayerID,
  triggers: readonly { id: string; sourceName: string; description: string }[]
): TriggerOrderEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.TRIGGER_ORDER,
    playerId,
    description: 'Order your triggered abilities on the stack',
    mandatory: true,
    timestamp: Date.now(),
    triggers: triggers.map(t => ({
      id: t.id,
      label: t.sourceName,
      description: t.description,
    })),
    requireAll: true,
  };
}

/**
 * Create a replacement effect choice event
 */
export function createReplacementEffectChoiceEvent(
  playerId: PlayerID,
  affectedPlayerId: PlayerID,
  affectedEvent: string,
  replacementEffects: readonly { id: string; sourceName: string; description: string }[]
): ReplacementEffectChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.REPLACEMENT_EFFECT_CHOICE,
    playerId,
    description: `Choose which replacement effect applies to: ${affectedEvent}`,
    mandatory: true,
    timestamp: Date.now(),
    replacementEffects: replacementEffects.map(r => ({
      id: r.id,
      label: r.sourceName,
      description: r.description,
    })),
    affectedEvent,
    affectedPlayerId,
  };
}

/**
 * Create a win effect triggered event
 */
export function createWinEffectTriggeredEvent(
  winningPlayerId: PlayerID,
  winReason: string,
  sourceId: string,
  sourceName: string
): WinEffectTriggeredEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.WIN_EFFECT_TRIGGERED,
    playerId: winningPlayerId,
    sourceId,
    sourceName,
    description: `${sourceName}: ${winReason}`,
    mandatory: false,
    timestamp: Date.now(),
    winningPlayerId,
    winReason,
  };
}

/**
 * Create a color choice event
 */
export function createColorChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  minColors: number = 1,
  maxColors: number = 1
): ColorChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.COLOR_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose ${minColors === maxColors ? minColors : `${minColors}-${maxColors}`} color${maxColors > 1 ? 's' : ''}`,
    mandatory: true,
    timestamp: Date.now(),
    colors: [
      { id: 'W', label: 'White', description: '⚪' },
      { id: 'U', label: 'Blue', description: '🔵' },
      { id: 'B', label: 'Black', description: '⚫' },
      { id: 'R', label: 'Red', description: '🔴' },
      { id: 'G', label: 'Green', description: '🟢' },
    ],
    minColors,
    maxColors,
  };
}

/**
 * Create a creature type choice event
 */
export function createCreatureTypeChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  suggestedTypes: readonly string[] = []
): CreatureTypeChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.CREATURE_TYPE_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose a creature type for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    suggestedTypes: suggestedTypes.length > 0 ? suggestedTypes : [
      'Human', 'Elf', 'Goblin', 'Zombie', 'Soldier', 'Wizard', 'Dragon', 'Angel',
      'Demon', 'Beast', 'Elemental', 'Spirit', 'Vampire', 'Warrior', 'Knight',
    ],
    allowCustom: true,
  };
}

/**
 * Create a number choice event
 */
export function createNumberChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  minValue: number,
  maxValue: number,
  defaultValue?: number
): NumberChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.NUMBER_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose a number for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    minValue,
    maxValue,
    defaultValue,
  };
}

/**
 * Create a player choice event
 */
export function createPlayerChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  validPlayers: readonly { id: PlayerID; name: string }[],
  allowSelf: boolean = true,
  allowOpponents: boolean = true
): PlayerChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.PLAYER_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description: `Choose a player for ${sourceName}`,
    mandatory: true,
    timestamp: Date.now(),
    validPlayers,
    allowSelf,
    allowOpponents,
  };
}

/**
 * Create a generic option choice event
 */
export function createOptionChoiceEvent(
  playerId: PlayerID,
  sourceId: string,
  sourceName: string,
  description: string,
  options: readonly { id: string; label: string; description?: string }[],
  minSelections: number = 1,
  maxSelections: number = 1
): OptionChoiceEvent {
  return {
    id: generateEventId(),
    type: ChoiceEventType.OPTION_CHOICE,
    playerId,
    sourceId,
    sourceName,
    description,
    mandatory: minSelections > 0,
    timestamp: Date.now(),
    options,
    minSelections,
    maxSelections,
  };
}

export default {
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
};
