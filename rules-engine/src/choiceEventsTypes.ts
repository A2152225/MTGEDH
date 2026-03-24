import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../shared/src';

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
  readonly orderIndex?: number;
}

export interface TargetSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.TARGET_SELECTION;
  readonly validTargets: readonly ChoiceOption[];
  readonly targetTypes: readonly string[];
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly targetDescription: string;
}

export interface ModeSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.MODE_SELECTION;
  readonly modes: readonly ChoiceOption[];
  readonly minModes: number;
  readonly maxModes: number;
  readonly allowDuplicates: boolean;
}

export interface XValueSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.X_VALUE_SELECTION;
  readonly minX: number;
  readonly maxX: number;
  readonly costPerX?: string;
}

export interface AttackerDeclarationEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.ATTACKER_DECLARATION;
  readonly legalAttackers: readonly ChoiceOption[];
  readonly defendingPlayers: readonly { id: PlayerID; name: string }[];
  readonly attackCosts?: readonly {
    permanentId: string;
    permanentName: string;
    costDescription: string;
  }[];
}

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
  readonly restrictions: readonly {
    attackerId: string;
    restriction: string;
  }[];
}

export interface MayAbilityEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.MAY_ABILITY;
  readonly abilityText: string;
  readonly cost?: string;
  readonly defaultChoice: 'yes' | 'no';
}

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
  readonly hasTrample: boolean;
  readonly defendingPlayerId?: PlayerID;
}

export interface BlockerOrderEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.BLOCKER_ORDER;
  readonly attackerId: string;
  readonly attackerName: string;
  readonly blockers: readonly ChoiceOption[];
}

export interface DiscardSelectionEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.DISCARD_SELECTION;
  readonly hand: readonly ChoiceOption[];
  readonly discardCount: number;
  readonly currentHandSize: number;
  readonly maxHandSize: number;
  readonly reason: 'cleanup' | 'effect';
}

export interface TokenCeasesToExistEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.TOKEN_CEASES_TO_EXIST;
  readonly tokenIds: readonly string[];
  readonly tokenNames: readonly string[];
  readonly zone: string;
  readonly reason: string;
}

export interface CopyCeasesToExistEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.COPY_CEASES_TO_EXIST;
  readonly copyId: string;
  readonly copyName: string;
  readonly copyType: 'spell' | 'card';
  readonly zone: string;
  readonly originalId?: string;
  readonly originalName?: string;
}

export interface CommanderZoneChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.COMMANDER_ZONE_CHOICE;
  readonly commanderId: string;
  readonly commanderName: string;
  readonly fromZone: 'graveyard' | 'exile';
  readonly toZone: 'command' | 'graveyard' | 'exile';
}

export interface TriggerOrderEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.TRIGGER_ORDER;
  readonly triggers: readonly ChoiceOption[];
  readonly requireAll: boolean;
}

export interface ReplacementEffectChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.REPLACEMENT_EFFECT_CHOICE;
  readonly replacementEffects: readonly ChoiceOption[];
  readonly affectedEvent: string;
  readonly affectedPlayerId: PlayerID;
}

export interface WinEffectTriggeredEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.WIN_EFFECT_TRIGGERED;
  readonly winningPlayerId: PlayerID;
  readonly winReason: string;
  readonly sourceId: string;
  readonly sourceName: string;
}

export interface ColorChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.COLOR_CHOICE;
  readonly colors: readonly ChoiceOption[];
  readonly minColors: number;
  readonly maxColors: number;
}

export interface CreatureTypeChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.CREATURE_TYPE_CHOICE;
  readonly suggestedTypes: readonly string[];
  readonly allowCustom: boolean;
}

export interface NumberChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.NUMBER_CHOICE;
  readonly minValue: number;
  readonly maxValue: number;
  readonly defaultValue?: number;
}

export interface PlayerChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.PLAYER_CHOICE;
  readonly validPlayers: readonly { id: PlayerID; name: string }[];
  readonly allowSelf: boolean;
  readonly allowOpponents: boolean;
}

export interface OptionChoiceEvent extends BaseChoiceEvent {
  readonly type: ChoiceEventType.OPTION_CHOICE;
  readonly options: readonly ChoiceOption[];
  readonly minSelections: number;
  readonly maxSelections: number;
}

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

export interface ChoiceResponse {
  readonly eventId: string;
  readonly playerId: PlayerID;
  readonly selections: readonly string[] | number | boolean;
  readonly cancelled: boolean;
  readonly timestamp: number;
}

export interface ChoiceEventEmitter {
  emit(event: ChoiceEvent): void;
  onResponse(eventId: string, response: ChoiceResponse): void;
}

export type {
  BattlefieldPermanent,
  KnownCardRef,
  PlayerID,
};
