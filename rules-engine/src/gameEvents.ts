/**
 * gameEvents.ts
 * 
 * Comprehensive event-based trigger system for MTG rules engine.
 * Implements Rule 603: Handling Triggered Abilities
 * 
 * This module provides:
 * - Event type definitions for all game events that can trigger abilities
 * - Event processing and trigger detection
 * - Support for cards like Smothering Tithe (draw triggers)
 * - APNAP ordering for triggers
 */

/**
 * Comprehensive game event types that can trigger abilities
 */
export enum GameEventType {
  // Zone change events
  CARD_DRAWN = 'card_drawn',
  CARD_DISCARDED = 'card_discarded',
  ENTERS_BATTLEFIELD = 'enters_battlefield',
  LEAVES_BATTLEFIELD = 'leaves_battlefield',
  DIES = 'dies',
  EXILED = 'exiled',
  PUT_INTO_GRAVEYARD = 'put_into_graveyard',
  PUT_INTO_HAND = 'put_into_hand',
  PUT_ON_BATTLEFIELD = 'put_on_battlefield',
  LIBRARY_SEARCHED = 'library_searched',
  LIBRARY_SHUFFLED = 'library_shuffled',
  
  // Turn structure events
  TURN_STARTED = 'turn_started',
  PHASE_STARTED = 'phase_started',
  STEP_STARTED = 'step_started',
  UNTAP_STEP = 'untap_step',
  UPKEEP_STARTED = 'upkeep_started',
  DRAW_STEP_STARTED = 'draw_step_started',
  MAIN_PHASE_STARTED = 'main_phase_started',
  COMBAT_STARTED = 'combat_started',
  END_STEP_STARTED = 'end_step_started',
  CLEANUP_STARTED = 'cleanup_started',
  TURN_ENDED = 'turn_ended',
  
  // Combat events
  ATTACKERS_DECLARED = 'attackers_declared',
  BLOCKERS_DECLARED = 'blockers_declared',
  COMBAT_DAMAGE_DEALT = 'combat_damage_dealt',
  CREATURE_ATTACKS = 'creature_attacks',
  CREATURE_BLOCKS = 'creature_blocks',
  CREATURE_BLOCKED = 'creature_blocked',
  CREATURE_UNBLOCKED = 'creature_unblocked',
  
  // Damage events
  DAMAGE_DEALT = 'damage_dealt',
  DAMAGE_DEALT_TO_PLAYER = 'damage_dealt_to_player',
  DAMAGE_DEALT_TO_CREATURE = 'damage_dealt_to_creature',
  DAMAGE_DEALT_TO_PLANESWALKER = 'damage_dealt_to_planeswalker',
  LIFE_LOST = 'life_lost',
  LIFE_GAINED = 'life_gained',
  
  // Counter events
  COUNTER_PLACED = 'counter_placed',
  COUNTER_REMOVED = 'counter_removed',
  
  // Spell and ability events
  SPELL_CAST = 'spell_cast',
  ABILITY_ACTIVATED = 'ability_activated',
  SPELL_COUNTERED = 'spell_countered',
  SPELL_RESOLVED = 'spell_resolved',
  
  // Token events
  TOKEN_CREATED = 'token_created',
  
  // Permanent state changes
  PERMANENT_TAPPED = 'permanent_tapped',
  PERMANENT_UNTAPPED = 'permanent_untapped',
  PERMANENT_SACRIFICED = 'permanent_sacrificed',
  PERMANENT_DESTROYED = 'permanent_destroyed',
  
  // Player events
  PRIORITY_PASSED = 'priority_passed',
  PLAYER_LOST = 'player_lost',
  PLAYER_WON = 'player_won',
  
  // Special events
  LANDFALL = 'landfall',           // Land enters battlefield under your control
  LIFE_PAID = 'life_paid',
  MANA_PRODUCED = 'mana_produced',
}

/**
 * Base game event interface
 */
export interface GameEvent {
  readonly type: GameEventType;
  readonly timestamp: number;
  readonly sourceId?: string;
  readonly sourceControllerId?: string;
  readonly data: GameEventData;
}

/**
 * Event data specific to different event types
 */
export interface GameEventData {
  // Common fields
  playerId?: string;
  cardId?: string;
  cardName?: string;
  permanentId?: string;
  
  // Zone change specific
  fromZone?: string;
  toZone?: string;
  
  // Damage specific
  amount?: number;
  source?: string;
  target?: string;
  isCombat?: boolean;
  
  // Counter specific
  counterType?: string;
  counterCount?: number;
  
  // Combat specific
  attackingPlayer?: string;
  defendingPlayer?: string;
  attackers?: readonly string[];
  blockers?: readonly string[];
  
  // Spell/ability specific
  spellId?: string;
  abilityId?: string;
  targets?: readonly string[];
  
  // Life specific
  lifeChange?: number;
  newLifeTotal?: number;
  
  // Draw specific (for triggers like Smothering Tithe)
  drawingPlayer?: string;
  isFirstDrawOfTurn?: boolean;
  
  // Generic data
  [key: string]: unknown;
}

/**
 * Trigger condition for event-based abilities
 */
export interface TriggerCondition {
  readonly eventType: GameEventType;
  readonly filter?: TriggerFilter;
  readonly mandatory: boolean;
  readonly optional?: boolean;  // "You may" triggers
}

/**
 * Filter for trigger conditions
 */
export interface TriggerFilter {
  readonly sourceController?: 'you' | 'opponent' | 'any';
  readonly sourceType?: string;
  readonly targetController?: 'you' | 'opponent' | 'any';
  readonly cardType?: string;
  readonly isFirstOfTurn?: boolean;
  readonly playerFilter?: 'active' | 'nonactive' | 'any';
  readonly custom?: (event: GameEvent) => boolean;
}

/**
 * Triggered ability definition
 */
export interface EventTriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly condition: TriggerCondition;
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly replacement?: boolean;  // Is this a replacement effect?
}

/**
 * Pending trigger waiting to go on the stack
 */
export interface PendingTrigger {
  readonly id: string;
  readonly ability: EventTriggeredAbility;
  readonly event: GameEvent;
  readonly timestamp: number;
  readonly onStack: boolean;
}

/**
 * Create a game event
 */
export function createGameEvent(
  type: GameEventType,
  data: GameEventData,
  sourceId?: string,
  sourceControllerId?: string
): GameEvent {
  return {
    type,
    timestamp: Date.now(),
    sourceId,
    sourceControllerId,
    data,
  };
}

/**
 * Create a card drawn event
 */
export function createCardDrawnEvent(
  playerId: string,
  cardId: string,
  cardName?: string,
  isFirstDrawOfTurn?: boolean
): GameEvent {
  return createGameEvent(
    GameEventType.CARD_DRAWN,
    {
      playerId,
      drawingPlayer: playerId,
      cardId,
      cardName,
      isFirstDrawOfTurn,
    }
  );
}

/**
 * Create a step started event
 */
export function createStepStartedEvent(
  stepName: string,
  activePlayerId: string
): GameEvent {
  return createGameEvent(
    GameEventType.STEP_STARTED,
    {
      playerId: activePlayerId,
      stepName,
    }
  );
}

/**
 * Check if an event matches a trigger condition
 */
export function matchesTriggerCondition(
  event: GameEvent,
  condition: TriggerCondition,
  controllerId: string,
  activePlayerId: string
): boolean {
  // Check event type
  if (event.type !== condition.eventType) {
    return false;
  }
  
  // Apply filters
  if (condition.filter) {
    const filter = condition.filter;
    
    // Source controller filter
    if (filter.sourceController) {
      const isOwn = event.sourceControllerId === controllerId;
      if (filter.sourceController === 'you' && !isOwn) return false;
      if (filter.sourceController === 'opponent' && isOwn) return false;
    }
    
    // Player filter for events like draw
    if (filter.playerFilter) {
      const eventPlayerId = event.data.playerId || event.data.drawingPlayer;
      const isActive = eventPlayerId === activePlayerId;
      if (filter.playerFilter === 'active' && !isActive) return false;
      if (filter.playerFilter === 'nonactive' && isActive) return false;
    }
    
    // First of turn filter
    if (filter.isFirstOfTurn !== undefined) {
      if (event.data.isFirstDrawOfTurn !== filter.isFirstOfTurn) return false;
    }
    
    // Custom filter
    if (filter.custom && !filter.custom(event)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Find all abilities that trigger from an event
 */
export function findTriggeredAbilitiesForEvent(
  event: GameEvent,
  abilities: readonly EventTriggeredAbility[],
  activePlayerId: string
): EventTriggeredAbility[] {
  return abilities.filter(ability =>
    matchesTriggerCondition(event, ability.condition, ability.controllerId, activePlayerId)
  );
}

/**
 * Create pending triggers from an event
 */
export function createPendingTriggersFromEvent(
  event: GameEvent,
  triggeredAbilities: readonly EventTriggeredAbility[]
): PendingTrigger[] {
  const timestamp = Date.now();
  
  return triggeredAbilities.map((ability, index) => ({
    id: `trigger-${event.type}-${timestamp}-${index}`,
    ability,
    event,
    timestamp: timestamp + index,
    onStack: false,
  }));
}

/**
 * Sort triggers by APNAP order (Active Player, Non-Active Player)
 * Rule 603.3b
 */
export function sortTriggersByAPNAP(
  triggers: readonly PendingTrigger[],
  activePlayerId: string,
  turnOrder: readonly string[]
): PendingTrigger[] {
  return [...triggers].sort((a, b) => {
    const aIsActive = a.ability.controllerId === activePlayerId;
    const bIsActive = b.ability.controllerId === activePlayerId;
    
    // Active player's triggers first
    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;
    
    // Then by turn order for non-active players
    const aIndex = turnOrder.indexOf(a.ability.controllerId);
    const bIndex = turnOrder.indexOf(b.ability.controllerId);
    if (aIndex !== bIndex) return aIndex - bIndex;
    
    // Finally by timestamp
    return a.timestamp - b.timestamp;
  });
}

/**
 * Known draw triggers (like Smothering Tithe)
 */
export const KNOWN_DRAW_TRIGGERS: Record<string, {
  effect: string;
  filter: TriggerFilter;
  mandatory: boolean;
}> = {
  "smothering tithe": {
    effect: "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.",
    filter: {
      sourceController: 'opponent',
      playerFilter: 'any',
    },
    mandatory: true,
  },
  "rhystic study": {
    effect: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
    filter: {
      sourceController: 'opponent',
    },
    mandatory: false,
  },
  "mystic remora": {
    effect: "Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.",
    filter: {
      sourceController: 'opponent',
    },
    mandatory: false,
  },
  "consecrated sphinx": {
    effect: "Whenever an opponent draws a card, you may draw two cards.",
    filter: {
      sourceController: 'opponent',
    },
    mandatory: false,
  },
  "sylvan library": {
    effect: "At the beginning of your draw step, you may draw two additional cards. If you do, pay 4 life for each card drawn this way unless you put it back.",
    filter: {
      playerFilter: 'active',
      isFirstOfTurn: true,
    },
    mandatory: false,
  },
};

/**
 * Detect draw triggers from a permanent's oracle text
 */
export function detectDrawTriggers(
  card: { name?: string; oracle_text?: string },
  permanentId: string,
  controllerId: string
): EventTriggeredAbility[] {
  const abilities: EventTriggeredAbility[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  
  // Check known cards first
  for (const [knownName, info] of Object.entries(KNOWN_DRAW_TRIGGERS)) {
    if (cardName.includes(knownName)) {
      abilities.push({
        id: `${permanentId}-draw-trigger`,
        sourceId: permanentId,
        sourceName: card.name || 'Unknown',
        controllerId,
        condition: {
          eventType: GameEventType.CARD_DRAWN,
          filter: info.filter,
          mandatory: info.mandatory,
        },
        effect: info.effect,
      });
    }
  }
  
  // Generic detection for "whenever a/an opponent draws"
  const opponentDrawMatch = oracleText.match(/whenever an? opponent draws? a card/i);
  if (opponentDrawMatch && !abilities.some(a => a.id === `${permanentId}-draw-trigger`)) {
    // Extract effect text after the trigger condition
    const effectMatch = oracleText.match(/whenever an? opponent draws? a card,?\s*([^.]+)/i);
    abilities.push({
      id: `${permanentId}-draw-trigger`,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      condition: {
        eventType: GameEventType.CARD_DRAWN,
        filter: { sourceController: 'opponent' },
        mandatory: true,
      },
      effect: effectMatch ? effectMatch[1].trim() : 'opponent draw trigger',
    });
  }
  
  // Generic detection for "whenever you draw"
  const youDrawMatch = oracleText.match(/whenever you draw a card/i);
  if (youDrawMatch) {
    const effectMatch = oracleText.match(/whenever you draw a card,?\s*([^.]+)/i);
    abilities.push({
      id: `${permanentId}-self-draw-trigger`,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      condition: {
        eventType: GameEventType.CARD_DRAWN,
        filter: { sourceController: 'you' },
        mandatory: true,
      },
      effect: effectMatch ? effectMatch[1].trim() : 'self draw trigger',
    });
  }
  
  return abilities;
}

export default {
  GameEventType,
  createGameEvent,
  createCardDrawnEvent,
  createStepStartedEvent,
  matchesTriggerCondition,
  findTriggeredAbilitiesForEvent,
  createPendingTriggersFromEvent,
  sortTriggersByAPNAP,
  detectDrawTriggers,
  KNOWN_DRAW_TRIGGERS,
};
