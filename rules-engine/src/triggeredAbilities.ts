/**
 * Rule 603: Handling Triggered Abilities
 * 
 * Triggered abilities watch for events and trigger when those events occur.
 * They use "when," "whenever," or "at."
 * 
 * Based on MagicCompRules 20251114.txt
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { StackObject } from './spellCasting';
import type { OracleIRExecutionEventHint } from './oracleIRExecutor';
import type { OracleIRExecutionOptions, OracleIRExecutionResult } from './oracleIRExecutor';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from './oracleIRExecutor';
import { parseOracleTextToIR } from './oracleIRParser';

/**
 * Rule 603.1: Triggered ability keywords
 */
export enum TriggerKeyword {
  WHEN = 'when',       // One-time events
  WHENEVER = 'whenever', // Each time event happens
  AT = 'at',          // Beginning/end of phase/step
}

/**
 * Common trigger events
 */
export enum TriggerEvent {
  // Zone changes
  ENTERS_BATTLEFIELD = 'enters_battlefield',
  LEAVES_BATTLEFIELD = 'leaves_battlefield',
  DIES = 'dies',
  DRAWN = 'drawn',
  DISCARDED = 'discarded',
  EXILED = 'exiled',
  PUT_INTO_GRAVEYARD = 'put_into_graveyard',
  PUT_INTO_HAND = 'put_into_hand',
  RETURNED_TO_HAND = 'returned_to_hand',
  MILLED = 'milled',
  
  // Combat
  ATTACKS = 'attacks',
  ATTACKS_ALONE = 'attacks_alone',
  BLOCKS = 'blocks',
  BLOCKED = 'blocked',
  BECOMES_BLOCKED = 'becomes_blocked',
  UNBLOCKED = 'unblocked',
  DEALS_DAMAGE = 'deals_damage',
  DEALS_COMBAT_DAMAGE = 'deals_combat_damage',
  DEALS_COMBAT_DAMAGE_TO_PLAYER = 'deals_combat_damage_to_player',
  DEALT_DAMAGE = 'dealt_damage',
  DEALT_COMBAT_DAMAGE = 'dealt_combat_damage',
  COMBAT_DAMAGE_STEP = 'combat_damage_step',
  
  // Turn structure
  BEGINNING_OF_TURN = 'beginning_of_turn',
  BEGINNING_OF_UPKEEP = 'beginning_of_upkeep',
  BEGINNING_OF_DRAW_STEP = 'beginning_of_draw_step',
  BEGINNING_OF_PRECOMBAT_MAIN = 'beginning_of_precombat_main',
  BEGINNING_OF_COMBAT = 'beginning_of_combat',
  BEGINNING_OF_DECLARE_ATTACKERS = 'beginning_of_declare_attackers',
  BEGINNING_OF_DECLARE_BLOCKERS = 'beginning_of_declare_blockers',
  BEGINNING_OF_POSTCOMBAT_MAIN = 'beginning_of_postcombat_main',
  END_OF_TURN = 'end_of_turn',
  BEGINNING_OF_END_STEP = 'beginning_of_end_step',
  END_OF_COMBAT = 'end_of_combat',
  CLEANUP_STEP = 'cleanup_step',
  
  // Spells and abilities
  SPELL_CAST = 'spell_cast',
  CREATURE_SPELL_CAST = 'creature_spell_cast',
  NONCREATURE_SPELL_CAST = 'noncreature_spell_cast',
  INSTANT_OR_SORCERY_CAST = 'instant_or_sorcery_cast',
  ABILITY_ACTIVATED = 'ability_activated',
  ABILITY_TRIGGERED = 'ability_triggered',
  SPELL_COUNTERED = 'spell_countered',
  
  // State changes
  BECOMES_TAPPED = 'becomes_tapped',
  BECOMES_UNTAPPED = 'becomes_untapped',
  COUNTER_PLACED = 'counter_placed',
  COUNTER_REMOVED = 'counter_removed',
  GAINED_LIFE = 'gained_life',
  LOST_LIFE = 'lost_life',
  LIFE_PAID = 'life_paid',
  
  // Token and permanent changes
  TOKEN_CREATED = 'token_created',
  TRANSFORMED = 'transformed',
  BECAME_MONSTROUS = 'became_monstrous',
  BECAME_RENOWNED = 'became_renowned',
  EQUIPPED = 'equipped',
  ENCHANTED = 'enchanted',
  ATTACHED = 'attached',
  
  // Player actions
  LANDFALL = 'landfall',
  SEARCHED_LIBRARY = 'searched_library',
  SHUFFLED_LIBRARY = 'shuffled_library',
  SCRIED = 'scried',
  SURVEIL = 'surveil',
  EXPLORED = 'explored',
  
  // Sacrifice triggers
  SACRIFICED = 'sacrificed',
  CREATURE_SACRIFICED = 'creature_sacrificed',
  ARTIFACT_SACRIFICED = 'artifact_sacrificed',
  
  // Other common triggers
  TARGETED = 'targeted',
  DESTROYED = 'destroyed',
  REGENERATED = 'regenerated',
  CONTROLLED_CREATURE_DIED = 'controlled_creature_died',
  OPPONENT_CREATURE_DIED = 'opponent_creature_died',
}

/**
 * Triggered ability definition
 */
export interface TriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly keyword: TriggerKeyword;
  readonly event: TriggerEvent;
  /** Legacy/general condition field retained for compatibility. */
  readonly condition?: string;
  /** Trigger-context filter inferred from trigger condition text. */
  readonly triggerFilter?: string;
  /** Intervening-if clause text from trigger condition (if present). */
  readonly interveningIfClause?: string;
  /** True when the trigger has an intervening-if clause in its oracle text. */
  readonly hasInterveningIf?: boolean;
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly optional?: boolean; // "may" trigger
}

/**
 * Trigger instance waiting to be put on stack
 */
export interface TriggerInstance {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly effect: string;
  readonly triggerFilter?: string;
  readonly interveningIfClause?: string;
  readonly hasInterveningIf?: boolean;
  /** Trigger-time snapshot for future resolution-time rule checks. */
  readonly triggerEventDataSnapshot?: TriggerEventData;
  /** Cached trigger-time truth value for intervening-if clauses. */
  readonly interveningIfWasTrueAtTrigger?: boolean;
  readonly targets?: readonly string[];
  readonly timestamp: number;
  readonly hasTriggered: boolean;
  readonly onStack: boolean;
}

/**
 * Trigger queue for managing pending triggers
 */
export interface TriggerQueue {
  readonly triggers: readonly TriggerInstance[];
}

/**
 * Create empty trigger queue
 */
export function createEmptyTriggerQueue(): TriggerQueue {
  return { triggers: [] };
}

/**
 * Rule 603.2: When a triggered ability triggers
 */
export function createTriggerInstance(
  ability: TriggeredAbility,
  timestamp: number,
  eventDataSnapshot?: TriggerEventData
): TriggerInstance {
  const interveningIfWasTrueAtTrigger = ability.interveningIfClause
    ? evaluateTriggerCondition(ability.interveningIfClause, ability.controllerId, eventDataSnapshot)
    : undefined;

  return {
    id: `trigger-${timestamp}-${ability.id}`,
    abilityId: ability.id,
    sourceId: ability.sourceId,
    sourceName: ability.sourceName,
    controllerId: ability.controllerId,
    effect: ability.effect,
    triggerFilter: ability.triggerFilter,
    interveningIfClause: ability.interveningIfClause,
    hasInterveningIf: ability.hasInterveningIf,
    ...(eventDataSnapshot ? { triggerEventDataSnapshot: eventDataSnapshot } : {}),
    ...(interveningIfWasTrueAtTrigger !== undefined ? { interveningIfWasTrueAtTrigger } : {}),
    targets: ability.targets,
    timestamp,
    hasTriggered: true,
    onStack: false,
  };
}

/**
 * Add trigger to queue
 */
export function queueTrigger(
  queue: Readonly<TriggerQueue>,
  trigger: TriggerInstance
): TriggerQueue {
  return {
    triggers: [...queue.triggers, trigger],
  };
}

/**
 * Rule 603.3: Triggered abilities go on stack next time player gets priority
 * Rule 603.3b: APNAP (Active Player, Non-Active Player) order
 */
export function putTriggersOnStack(
  queue: Readonly<TriggerQueue>,
  activePlayerId: string,
  turnOrder?: readonly string[]
): {
  queue: TriggerQueue;
  stackObjects: StackObject[];
  log: string[];
} {
  if (queue.triggers.length === 0) {
    return {
      queue,
      stackObjects: [],
      log: [],
    };
  }
  
  const logs: string[] = [];
  const normalizedTurnOrder = Array.isArray(turnOrder)
    ? turnOrder
        .map(id => String(id || '').trim())
        .filter(Boolean)
    : [];
  const activeIndexInTurnOrder = normalizedTurnOrder.indexOf(activePlayerId);
  const playerApnapRank = new Map<string, number>();
  if (activeIndexInTurnOrder >= 0) {
    for (let offset = 0; offset < normalizedTurnOrder.length; offset++) {
      const idx = (activeIndexInTurnOrder + offset) % normalizedTurnOrder.length;
      const playerId = normalizedTurnOrder[idx];
      if (!playerApnapRank.has(playerId)) {
        playerApnapRank.set(playerId, offset);
      }
    }
  }
  
  // Sort triggers by APNAP order
  const sorted = [...queue.triggers].sort((a, b) => {
    const rankA = playerApnapRank.get(a.controllerId);
    const rankB = playerApnapRank.get(b.controllerId);

    if (rankA !== undefined && rankB !== undefined && rankA !== rankB) {
      return rankA - rankB;
    }

    // Fallback when full turn order is unavailable.
    if (a.controllerId === activePlayerId && b.controllerId !== activePlayerId) {
      return -1;
    }
    if (a.controllerId !== activePlayerId && b.controllerId === activePlayerId) {
      return 1;
    }
    // Then by timestamp (order they triggered)
    return a.timestamp - b.timestamp;
  });
  
  // Convert to stack objects
  const stackObjects: StackObject[] = sorted.map(trigger => {
    logs.push(`${trigger.sourceName} triggered ability goes on stack`);
    const triggerMetaBase = buildStackTriggerMetaFromEventData(
      trigger.effect,
      trigger.sourceId,
      trigger.controllerId,
      trigger.triggerEventDataSnapshot
    );
    
    return {
      id: trigger.id,
      spellId: trigger.abilityId,
      cardName: `${trigger.sourceName} trigger`,
      controllerId: trigger.controllerId,
      targets: trigger.targets || [],
      triggerMeta: {
        ...triggerMetaBase,
        triggerFilter: trigger.triggerFilter,
        interveningIfClause: trigger.interveningIfClause,
        hasInterveningIf: trigger.hasInterveningIf,
        interveningIfWasTrueAtTrigger: trigger.interveningIfWasTrueAtTrigger,
      },
      timestamp: trigger.timestamp,
      type: 'ability',
    };
  });
  
  // Clear the queue
  return {
    queue: createEmptyTriggerQueue(),
    stackObjects,
    log: logs,
  };
}

/**
 * Check if an event would trigger an ability
 * 
 * This implementation checks:
 * 1. Event type matching
 * 2. Condition evaluation (e.g., "if you control a creature")
 * 3. Controller/filter matching (e.g., "you" vs "opponent" triggers)
 * 
 * @param ability - The triggered ability to check
 * @param event - The event that occurred
 * @param eventData - Context data for condition evaluation including battlefield state,
 *                    source/target information, life totals, etc. See TriggerEventData interface.
 * @returns true if the event would trigger the ability
 */
export function checkTrigger(
  ability: TriggeredAbility,
  event: TriggerEvent,
  eventData?: TriggerEventData
): boolean {
  // First check event type
  if (ability.event !== event) {
    return false;
  }
  
  // Check trigger filter (from trigger condition parsing) first.
  if (ability.triggerFilter) {
    if (!evaluateTriggerCondition(ability.triggerFilter, ability.controllerId, eventData)) {
      return false;
    }
  }

  // Intervening-if clause must be true both when triggering and when resolving.
  // Here we enforce the trigger-time check.
  if (ability.interveningIfClause) {
    if (!evaluateTriggerCondition(ability.interveningIfClause, ability.controllerId, eventData)) {
      return false;
    }
  }

  // Legacy/general condition fallback.
  if (ability.condition && !ability.triggerFilter && !ability.interveningIfClause) {
    if (!evaluateTriggerCondition(ability.condition, ability.controllerId, eventData)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Event data passed to triggered ability checks
 */
export interface TriggerEventData {
  readonly sourceId?: string;
  readonly sourceControllerId?: string;
  readonly targetId?: string;
  readonly targetControllerId?: string;
  /** Explicit player-target binding when known at trigger resolution time. */
  readonly targetPlayerId?: string;
  /** Explicit opponent-target binding when known at trigger resolution time. */
  readonly targetOpponentId?: string;
  readonly permanentTypes?: readonly string[];
  readonly creatureCount?: number;
  readonly landCount?: number;
  readonly artifactCount?: number;
  readonly enchantmentCount?: number;
  readonly lifeTotal?: number;
  readonly lifeLost?: number;
  readonly lifeGained?: number;
  readonly damageDealt?: number;
  readonly cardsDrawn?: number;
  readonly spellType?: string;
  readonly isYourTurn?: boolean;
  readonly isOpponentsTurn?: boolean;
  readonly creatureTypes?: readonly string[];
  readonly colors?: readonly string[];
  readonly controlledCreatures?: readonly string[];
  readonly controlledPermanents?: readonly string[];
  readonly graveyard?: readonly string[];
  readonly hand?: readonly string[];
  /** Generic affected player ids for the triggering event. */
  readonly affectedPlayerIds?: readonly string[];
  /** Affected opponent ids for the triggering event. */
  readonly affectedOpponentIds?: readonly string[];
  /** Opponents dealt damage by the triggering event/source (Breeches-style antecedent). */
  readonly opponentsDealtDamageIds?: readonly string[];
  readonly battlefield?: readonly { id: string; types?: string[]; controllerId?: string }[];
}

/**
 * Build normalized trigger event data from one or more heterogeneous payloads.
 *
 * This centralizes best-effort target/relational extraction so trigger call sites
 * (combat, spell-cast, draw, etc.) can supply context with consistent shape.
 */
export function buildTriggerEventDataFromPayloads(
  sourceControllerId?: string,
  ...payloads: any[]
): TriggerEventData {
  const toId = (value: any): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const id = String(value).trim();
    return id.length > 0 ? id : undefined;
  };

  const pickFirstString = (...values: any[]): string | undefined => {
    for (const value of values) {
      const id = toId(value);
      if (id) return id;
    }
    return undefined;
  };

  const normalizedSourceControllerId = toId(sourceControllerId);

  const scalarString = (field: string): string | undefined => {
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const value = toId((payload as any)[field]);
      if (value) return value;
    }
    return undefined;
  };

  const scalarNumber = (field: string): number | undefined => {
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const raw = (payload as any)[field];
      if (raw === undefined || raw === null) continue;
      const num = Number(raw);
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  };

  const scalarBool = (field: string): boolean | undefined => {
    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const raw = (payload as any)[field];
      if (typeof raw === 'boolean') return raw;
    }
    return undefined;
  };

  const collectIds = (...fields: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: any) => {
      const id = toId(value);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };

    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      for (const field of fields) {
        const value = (payload as any)[field];
        if (Array.isArray(value)) {
          for (const item of value) push(item);
        } else {
          push(value);
        }
      }
    }

    return out;
  };

  const collectCombatOpponentIds = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: any) => {
      const id = toId(value);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };

    const processAssignments = (assignments: any[]) => {
      for (const assignment of assignments) {
        if (!assignment || typeof assignment !== 'object') continue;
        push((assignment as any).defendingPlayerId);
        push((assignment as any).targetOpponentId);
        push((assignment as any).targetPlayerId);
      }
    };

    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      const direct = (payload as any).attackers;
      if (Array.isArray(direct)) processAssignments(direct);
      const damageAssignments = (payload as any).damageAssignments;
      if (Array.isArray(damageAssignments)) processAssignments(damageAssignments);
      const combatAttackers = (payload as any).combat?.attackers;
      if (Array.isArray(combatAttackers)) processAssignments(combatAttackers);
    }

    return out;
  };

  const explicitAffectedPlayerIds = collectIds('affectedPlayerIds');
  const explicitAffectedOpponentIds = collectIds('affectedOpponentIds');
  const explicitOpponentsDealtDamageIds = collectIds('opponentsDealtDamageIds');
  const combatOpponentIds = collectCombatOpponentIds();
  const singleton = (ids: readonly string[]): string | undefined =>
    Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;
  const isOpponentId = (id: string | undefined): boolean =>
    Boolean(id) && (!normalizedSourceControllerId || id !== normalizedSourceControllerId);

  const targetIds = collectIds(
    'target',
    'targetId',
    'targetPlayerId',
    'targetOpponentId',
    'targets',
    'targetIds',
    'targetPlayerIds',
    'targetOpponentIds'
  );

  const playerScopedTargetIds = collectIds(
    'targetPlayerId',
    'targetOpponentId',
    'targetPlayerIds',
    'targetOpponentIds'
  );

  const explicitTargetPlayerId = scalarString('targetPlayerId');
  const explicitTargetOpponentId = scalarString('targetOpponentId');

  const targetPlayerId = pickFirstString(
    explicitTargetPlayerId,
    explicitTargetOpponentId,
    singleton(explicitAffectedPlayerIds)
  );

  const targetOpponentId = pickFirstString(
    (() => {
      const id = explicitTargetOpponentId;
      return isOpponentId(id) ? id : undefined;
    })(),
    singleton(explicitAffectedOpponentIds.filter(id => isOpponentId(id))),
    singleton(explicitOpponentsDealtDamageIds.filter(id => isOpponentId(id))),
    singleton(combatOpponentIds.filter(id => isOpponentId(id)))
  );

  const affectedPlayerIds =
    explicitAffectedPlayerIds.length > 0
      ? explicitAffectedPlayerIds
      : playerScopedTargetIds.length > 0
        ? playerScopedTargetIds
        : undefined;

  const affectedOpponentIdsRaw =
    explicitAffectedOpponentIds.length > 0
      ? explicitAffectedOpponentIds
      : combatOpponentIds.length > 0
        ? combatOpponentIds
        : affectedPlayerIds?.filter(id => id !== sourceControllerId) || [];
  const affectedOpponentIdsSanitized = affectedOpponentIdsRaw.filter(id => isOpponentId(id));

  const opponentsDealtDamageIdsRaw =
    explicitOpponentsDealtDamageIds.length > 0
      ? explicitOpponentsDealtDamageIds
      : combatOpponentIds;
  const opponentsDealtDamageIdsSanitized = opponentsDealtDamageIdsRaw.filter(id => isOpponentId(id));

  const sourceId = scalarString('sourceId');
  const targetId = scalarString('targetId') ?? targetPlayerId ?? targetOpponentId;

  return {
    sourceId,
    sourceControllerId: normalizedSourceControllerId,
    targetId,
    targetControllerId: scalarString('targetControllerId'),
    targetPlayerId,
    targetOpponentId,
    lifeTotal: scalarNumber('lifeTotal'),
    lifeLost: scalarNumber('lifeLost'),
    lifeGained: scalarNumber('lifeGained'),
    damageDealt: scalarNumber('damageDealt'),
    cardsDrawn: scalarNumber('cardsDrawn'),
    spellType: scalarString('spellType'),
    isYourTurn: scalarBool('isYourTurn'),
    isOpponentsTurn: scalarBool('isOpponentsTurn'),
    affectedPlayerIds: affectedPlayerIds && affectedPlayerIds.length > 0 ? affectedPlayerIds : undefined,
    affectedOpponentIds:
      affectedOpponentIdsSanitized.length > 0 ? affectedOpponentIdsSanitized : undefined,
    opponentsDealtDamageIds:
      opponentsDealtDamageIdsSanitized.length > 0 ? opponentsDealtDamageIdsSanitized : undefined,
  };
}

/**
 * Build stack trigger metadata from normalized trigger event context.
 */
export function buildStackTriggerMetaFromEventData(
  effectText: string | undefined,
  sourceId: string,
  sourceControllerId: string,
  eventData?: TriggerEventData
): {
  effectText?: string;
  triggerEventDataSnapshot?: {
    sourceId?: string;
    sourceControllerId?: string;
    targetId?: string;
    targetControllerId?: string;
    targetPlayerId?: string;
    targetOpponentId?: string;
    affectedPlayerIds?: readonly string[];
    affectedOpponentIds?: readonly string[];
    opponentsDealtDamageIds?: readonly string[];
    lifeTotal?: number;
    lifeLost?: number;
    lifeGained?: number;
    damageDealt?: number;
    cardsDrawn?: number;
    isYourTurn?: boolean;
    isOpponentsTurn?: boolean;
    battlefield?: readonly { id: string; types?: string[]; controllerId?: string }[];
  };
} {
  const normalized = buildTriggerEventDataFromPayloads(
    sourceControllerId,
    eventData,
    { sourceId, sourceControllerId }
  );

  return {
    effectText,
    triggerEventDataSnapshot: {
      sourceId: normalized.sourceId,
      sourceControllerId: normalized.sourceControllerId,
      targetId: normalized.targetId,
      targetControllerId: normalized.targetControllerId,
      targetPlayerId: normalized.targetPlayerId,
      targetOpponentId: normalized.targetOpponentId,
      affectedPlayerIds: normalized.affectedPlayerIds,
      affectedOpponentIds: normalized.affectedOpponentIds,
      opponentsDealtDamageIds: normalized.opponentsDealtDamageIds,
      lifeTotal: normalized.lifeTotal,
      lifeLost: normalized.lifeLost,
      lifeGained: normalized.lifeGained,
      damageDealt: normalized.damageDealt,
      cardsDrawn: normalized.cardsDrawn,
      isYourTurn: normalized.isYourTurn,
      isOpponentsTurn: normalized.isOpponentsTurn,
      battlefield: normalized.battlefield,
    },
  };
}

/**
 * Convert trigger-event context into Oracle IR execution hints.
 *
 * This lets trigger resolution feed relational selectors (for example
 * "each of those opponents") into the Oracle IR executor without bespoke
 * per-card plumbing.
 */
export function buildOracleIRExecutionEventHintFromTriggerData(
  eventData?: TriggerEventData
): OracleIRExecutionEventHint | undefined {
  if (!eventData) return undefined;

  const normalizeId = (value: unknown): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  };

  const normalizedSourceControllerId = String(eventData.sourceControllerId || '').trim() || undefined;
  const normalizedTargetPlayerId = normalizeId(eventData.targetPlayerId);
  const normalizedRawTargetOpponentId = normalizeId(eventData.targetOpponentId);

  const isOpponentId = (id: string | undefined): boolean => {
    if (!id) return false;
    return !normalizedSourceControllerId || id !== normalizedSourceControllerId;
  };

  const dedupe = (ids: readonly string[] | undefined): readonly string[] | undefined => {
    if (!Array.isArray(ids) || ids.length === 0) return undefined;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out.length > 0 ? out : undefined;
  };

  const dedupeOpponents = (ids: readonly string[] | undefined): readonly string[] | undefined =>
    dedupe((ids || []).filter(id => isOpponentId(id)));

  const singleton = (ids: readonly string[] | undefined): string | undefined =>
    Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;

  const dedupedAffectedOpponents = dedupeOpponents(eventData.affectedOpponentIds);
  const dedupedOpponentsDealtDamage = dedupeOpponents(eventData.opponentsDealtDamageIds);

  const targetOpponentId = isOpponentId(normalizedRawTargetOpponentId)
    ? normalizedRawTargetOpponentId
    : singleton(dedupedAffectedOpponents) ??
      singleton(dedupedOpponentsDealtDamage);

  const hint: OracleIRExecutionEventHint = {
    targetPlayerId: normalizedTargetPlayerId,
    targetOpponentId,
    affectedPlayerIds: dedupe(eventData.affectedPlayerIds),
    affectedOpponentIds: dedupedAffectedOpponents,
    opponentsDealtDamageIds: dedupedOpponentsDealtDamage,
  };

  if (
    !hint.targetPlayerId &&
    !hint.targetOpponentId &&
    !hint.affectedPlayerIds &&
    !hint.affectedOpponentIds &&
    !hint.opponentsDealtDamageIds
  ) {
    return undefined;
  }

  return hint;
}

/**
 * Build resolution-time trigger context from current game state.
 *
 * This provides a practical baseline for intervening-if resolution checks,
 * even when full event replay context is unavailable.
 */
export function buildResolutionEventDataFromGameState(
  state: GameState,
  controllerId: string,
  base?: TriggerEventData
): TriggerEventData {
  const normalizeId = (value: unknown): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  };

  const normalizedControllerId = normalizeId(controllerId) ?? normalizeId(base?.sourceControllerId);
  const normalizedTurnPlayerId = normalizeId((state as any).turnPlayer);

  const battlefield = ((state.battlefield || []) as any[]).map(p => ({
    id: normalizeId(p?.id) || '',
    controllerId: normalizeId(p?.controller) || '',
    types: String((p?.card?.type_line || '') as any)
      .split(/[\s—-]+/)
      .map(t => t.trim())
      .filter(Boolean),
  }));

  const controller = (state.players || []).find(
    (p: any) => normalizeId(p?.id) === normalizedControllerId
  ) as any;
  const hasValidController = Boolean(controller);
  const resolvedLifeTotal = (() => {
    const controllerLife = Number(controller?.life);
    if (Number.isFinite(controllerLife)) return controllerLife;
    const baseLife = Number(base?.lifeTotal);
    return Number.isFinite(baseLife) ? baseLife : undefined;
  })();

  return {
    ...base,
    sourceControllerId: normalizedControllerId,
    lifeTotal: resolvedLifeTotal,
    isYourTurn:
      hasValidController && normalizedTurnPlayerId !== undefined
        ? normalizedTurnPlayerId === normalizedControllerId
        : Boolean(base?.isYourTurn),
    isOpponentsTurn:
      hasValidController && normalizedTurnPlayerId !== undefined
        ? normalizedTurnPlayerId !== normalizedControllerId
        : Boolean(base?.isOpponentsTurn),
    battlefield,
  };
}

/**
 * Execute a triggered ability's effect text through the Oracle IR parser/executor.
 *
 * This is the integration seam that lets trigger pipelines pass `TriggerEventData`
 * and automatically resolve contextual selectors such as "each of those opponents"
 * or target-bound selectors in multiplayer.
 */
export function executeTriggeredAbilityEffectWithOracleIR(
  state: GameState,
  ability: Pick<TriggeredAbility, 'controllerId' | 'sourceId' | 'sourceName' | 'effect'>,
  eventData?: TriggerEventData,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
  const ir = parseOracleTextToIR(ability.effect, ability.sourceName);
  const steps = ir.abilities.flatMap(a => a.steps);

  const hint = buildOracleIRExecutionEventHintFromTriggerData(eventData);
  const ctx = buildOracleIRExecutionContext(
    {
      controllerId: ability.controllerId as PlayerID,
      sourceId: ability.sourceId,
      sourceName: ability.sourceName,
    },
    hint
  );

  return applyOracleIRStepsToGameState(state, steps, ctx, options);
}

export interface ProcessEventOracleExecutionResult {
  readonly state: GameState;
  readonly triggers: readonly TriggerInstance[];
  readonly executions: readonly OracleIRExecutionResult[];
  readonly log: readonly string[];
}

export interface ProcessEventOracleExecutionOptions extends OracleIRExecutionOptions {
  /**
   * Optional resolution-time context. When provided, intervening-if clauses are
   * rechecked against this data instead of trigger-time event data.
   */
  readonly resolutionEventData?: TriggerEventData;
}

/**
 * Convenience helper: find triggered abilities for an event, create trigger
 * instances, and immediately execute their effect text via Oracle IR.
 *
 * This keeps deterministic trigger automation in a single call path while
 * preserving trigger instance creation for external stack/visibility systems.
 */
export function processEventAndExecuteTriggeredOracle(
  state: GameState,
  event: TriggerEvent,
  abilities: readonly TriggeredAbility[],
  eventData?: TriggerEventData,
  options: ProcessEventOracleExecutionOptions = {}
): ProcessEventOracleExecutionResult {
  const triggeredAbilities = findTriggeringAbilities(abilities, event, eventData);
  const timestamp = Date.now();

  const triggers: TriggerInstance[] = [];
  const executions: OracleIRExecutionResult[] = [];
  const log: string[] = [];

  let nextState = state;

  for (let idx = 0; idx < triggeredAbilities.length; idx++) {
    const ability = triggeredAbilities[idx];
    const trigger = createTriggerInstance(ability, timestamp + idx, eventData);
    triggers.push(trigger);

    if (ability.interveningIfClause) {
      const resolutionData =
        options.resolutionEventData ?? buildResolutionEventDataFromGameState(nextState, ability.controllerId, eventData);
      const stillTrue = evaluateTriggerCondition(ability.interveningIfClause, ability.controllerId, resolutionData);
      if (!stillTrue) {
        log.push(`${ability.sourceName} trigger skipped at resolution (intervening-if false)`);
        continue;
      }
    }

    const execution = executeTriggeredAbilityEffectWithOracleIR(nextState, ability, eventData, options);
    executions.push(execution);
    nextState = execution.state;

    log.push(`${ability.sourceName} triggered ability processed`);
    log.push(...execution.log);
  }

  return {
    state: nextState,
    triggers,
    executions,
    log,
  };
}

/**
 * Evaluate a trigger condition string against the event data
 * 
 * Supports common condition patterns:
 * - "you" - triggers only for controller
 * - "opponent" - triggers only for opponents
 * - "if you control a creature" - checks creature presence
 * - "if you control X or more creatures" - checks creature count
 * - "if an opponent controls a creature" - opponent check
 * - "if your life total is X or less" - life total check
 * - "if a creature you control has power X or greater" - power check
 * 
 * @returns true if condition is met, false otherwise
 * Note: Returns true when no condition exists (unconditional trigger)
 * Returns false when eventData is missing but condition requires it (safety default)
 */
export function evaluateTriggerCondition(
  condition: string,
  controllerId: string,
  eventData?: TriggerEventData
): boolean {
  // No condition means unconditional trigger
  if (!condition) {
    return true;
  }
  
  // If we have a condition but no event data, we can't evaluate - be conservative
  if (!eventData) {
    // For simple controller checks, we can still evaluate without full eventData
    const conditionLower = condition.toLowerCase().trim();
    if (conditionLower === 'you' || conditionLower === 'your' || 
        conditionLower === 'opponent' || conditionLower === 'an opponent' ||
        conditionLower === 'each') {
      // These need eventData to evaluate properly
      return false;
    }
    // For complex conditions without data, default to false (safe)
    return false;
  }
  
  const conditionLower = condition.toLowerCase().trim();
  
  // Controller filter checks
  if (conditionLower === 'you' || conditionLower === 'your') {
    return eventData.sourceControllerId === controllerId;
  }
  
  if (conditionLower === 'opponent' || conditionLower === 'an opponent') {
    return eventData.sourceControllerId !== undefined && 
           eventData.sourceControllerId !== controllerId;
  }
  
  if (conditionLower === 'each') {
    return true; // Triggers for everyone
  }
  
  // "if you control" checks (also support normalized form "you control ...")
  if (conditionLower.includes('if you control') || conditionLower.startsWith('you control ')) {
    return evaluateControlCondition(conditionLower, controllerId, eventData);
  }
  
  // "if an opponent controls" checks (also support normalized form "an opponent controls ...")
  if (conditionLower.includes('if an opponent controls') || conditionLower.startsWith('an opponent controls ')) {
    return evaluateOpponentControlCondition(conditionLower, controllerId, eventData);
  }
  
  // Life total checks
  if (conditionLower.includes('life total')) {
    return evaluateLifeTotalCondition(conditionLower, eventData);
  }
  
  // Graveyard checks
  if (conditionLower.includes('graveyard')) {
    return evaluateGraveyardCondition(conditionLower, eventData);
  }
  
  // Hand size checks
  if (conditionLower.includes('cards in hand')) {
    return evaluateHandCondition(conditionLower, eventData);
  }
  
  // Turn checks
  if (conditionLower.includes('your turn')) {
    return eventData.isYourTurn === true;
  }
  
  if (conditionLower.includes("opponent's turn") || conditionLower.includes('opponents turn')) {
    return eventData.isOpponentsTurn === true;
  }
  
  // Unknown condition pattern - be conservative and don't trigger
  // This prevents false positives for unrecognized conditions
  return false;
}

/**
 * Evaluate "if you control X" conditions
 */
function evaluateControlCondition(
  condition: string,
  controllerId: string,
  eventData: TriggerEventData
): boolean {
  // Count controlled permanents by type
  const controlledByPlayer = (eventData.battlefield || []).filter(
    p => p.controllerId === controllerId
  );
  
  // "if you control a creature"
  if (condition.includes('a creature') || condition.includes('creature')) {
    const creatures = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'creature')
    );
    
    // Check for count requirements ("X or more creatures")
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+creatures?/);
    if (countMatch) {
      return creatures.length >= parseInt(countMatch[1], 10);
    }
    
    return creatures.length > 0;
  }
  
  // "if you control an artifact"
  if (condition.includes('an artifact') || condition.includes('artifact')) {
    const artifacts = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'artifact')
    );
    
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+artifacts?/);
    if (countMatch) {
      return artifacts.length >= parseInt(countMatch[1], 10);
    }
    
    return artifacts.length > 0;
  }
  
  // "if you control an enchantment"
  if (condition.includes('an enchantment') || condition.includes('enchantment')) {
    const enchantments = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'enchantment')
    );
    
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+enchantments?/);
    if (countMatch) {
      return enchantments.length >= parseInt(countMatch[1], 10);
    }
    
    return enchantments.length > 0;
  }
  
  // "if you control X or more permanents"
  if (condition.includes('permanent')) {
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+permanents?/);
    if (countMatch) {
      return controlledByPlayer.length >= parseInt(countMatch[1], 10);
    }
    return controlledByPlayer.length > 0;
  }
  
  return true;
}

/**
 * Evaluate "if an opponent controls X" conditions
 */
function evaluateOpponentControlCondition(
  condition: string,
  controllerId: string,
  eventData: TriggerEventData
): boolean {
  // Get opponent-controlled permanents
  const opponentPermanents = (eventData.battlefield || []).filter(
    p => p.controllerId !== controllerId && p.controllerId !== undefined
  );
  
  if (condition.includes('creature')) {
    const creatures = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'creature')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+creatures?/);
    if (countMatch) {
      return creatures.length >= parseInt(countMatch[1], 10);
    }
    return creatures.length > 0;
  }
  
  if (condition.includes('artifact')) {
    const artifacts = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'artifact')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+artifacts?/);
    if (countMatch) {
      return artifacts.length >= parseInt(countMatch[1], 10);
    }
    return artifacts.length > 0;
  }

  if (condition.includes('enchantment')) {
    const enchantments = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'enchantment')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+enchantments?/);
    if (countMatch) {
      return enchantments.length >= parseInt(countMatch[1], 10);
    }
    return enchantments.length > 0;
  }

  if (condition.includes('land')) {
    const lands = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'land')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+lands?/);
    if (countMatch) {
      return lands.length >= parseInt(countMatch[1], 10);
    }
    return lands.length > 0;
  }

  if (condition.includes('planeswalker')) {
    const planeswalkers = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'planeswalker')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+planeswalkers?/);
    if (countMatch) {
      return planeswalkers.length >= parseInt(countMatch[1], 10);
    }
    return planeswalkers.length > 0;
  }

  if (condition.includes('permanent')) {
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+permanents?/);
    if (countMatch) {
      return opponentPermanents.length >= parseInt(countMatch[1], 10);
    }
    return opponentPermanents.length > 0;
  }
  
  return opponentPermanents.length > 0;
}

/**
 * Evaluate life total conditions
 */
function evaluateLifeTotalCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  if (eventData.lifeTotal === undefined) return true;
  
  // "life total is X or less"
  const lessMatch = condition.match(/life\s+total\s+is\s+(\d+)\s+or\s+less/);
  if (lessMatch) {
    return eventData.lifeTotal <= parseInt(lessMatch[1], 10);
  }
  
  // "life total is X or greater"
  const greaterMatch = condition.match(/life\s+total\s+is\s+(\d+)\s+or\s+greater/);
  if (greaterMatch) {
    return eventData.lifeTotal >= parseInt(greaterMatch[1], 10);
  }
  
  return true;
}

/**
 * Evaluate graveyard conditions
 */
function evaluateGraveyardCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  const graveyardSize = eventData.graveyard?.length || 0;
  
  // "X or more cards in your graveyard"
  const countMatch = condition.match(/(\d+)\s+or\s+more\s+cards?\s+in/);
  if (countMatch) {
    return graveyardSize >= parseInt(countMatch[1], 10);
  }
  
  // "a creature card in your graveyard"
  if (condition.includes('creature card')) {
    // Would need type info in graveyard data
    return graveyardSize > 0;
  }
  
  return true;
}

/**
 * Evaluate hand size conditions
 */
function evaluateHandCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  const handSize = eventData.hand?.length || 0;
  
  // "X or more cards in hand"
  const moreMatch = condition.match(/(\d+)\s+or\s+more\s+cards\s+in\s+hand/);
  if (moreMatch) {
    return handSize >= parseInt(moreMatch[1], 10);
  }
  
  // "X or fewer cards in hand"
  const fewerMatch = condition.match(/(\d+)\s+or\s+fewer\s+cards\s+in\s+hand/);
  if (fewerMatch) {
    return handSize <= parseInt(fewerMatch[1], 10);
  }
  
  // "no cards in hand"
  if (condition.includes('no cards in hand')) {
    return handSize === 0;
  }
  
  return true;
}

/**
 * Find all abilities that trigger from an event
 */
export function findTriggeringAbilities(
  abilities: readonly TriggeredAbility[],
  event: TriggerEvent,
  eventData?: TriggerEventData
): TriggeredAbility[] {
  return abilities.filter(ability => checkTrigger(ability, event, eventData));
}

/**
 * Process an event and create trigger instances
 */
export function processEvent(
  event: TriggerEvent,
  abilities: readonly TriggeredAbility[],
  eventData?: TriggerEventData
): TriggerInstance[] {
  const triggeredAbilities = findTriggeringAbilities(abilities, event, eventData);
  const timestamp = Date.now();
  
  return triggeredAbilities.map(ability =>
    createTriggerInstance(ability, timestamp, eventData)
  );
}

/**
 * Common triggered ability templates
 */

/**
 * Enter the battlefield trigger
 */
export function createETBTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  targets?: string[]
): TriggeredAbility {
  return {
    id: `${sourceId}-etb`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.ENTERS_BATTLEFIELD,
    effect,
    targets,
  };
}

/**
 * Dies trigger
 */
export function createDiesTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-dies`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.DIES,
    effect,
  };
}

/**
 * Beginning of upkeep trigger
 */
export function createUpkeepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-upkeep`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.AT,
    event: TriggerEvent.BEGINNING_OF_UPKEEP,
    effect,
  };
}

/**
 * Attacks trigger
 */
export function createAttacksTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-attacks`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.ATTACKS,
    effect,
  };
}

/**
 * Beginning of end step trigger
 */
export function createEndStepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-end-step`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.AT,
    event: TriggerEvent.BEGINNING_OF_END_STEP,
    effect,
  };
}

/**
 * Landfall trigger
 */
export function createLandfallTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-landfall`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.LANDFALL,
    effect,
  };
}

/**
 * Combat damage to player trigger
 */
export function createCombatDamageToPlayerTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-combat-damage-player`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
    effect,
  };
}

/**
 * Spell cast trigger
 */
export function createSpellCastTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  filter?: { cardType?: string; controller?: 'you' | 'opponent' | 'any' }
): TriggeredAbility {
  let event = TriggerEvent.SPELL_CAST;
  if (filter?.cardType === 'creature') {
    event = TriggerEvent.CREATURE_SPELL_CAST;
  } else if (filter?.cardType === 'noncreature') {
    event = TriggerEvent.NONCREATURE_SPELL_CAST;
  } else if (filter?.cardType === 'instant' || filter?.cardType === 'sorcery') {
    event = TriggerEvent.INSTANT_OR_SORCERY_CAST;
  }
  
  return {
    id: `${sourceId}-spell-cast`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
    condition: filter?.controller,
  };
}

/**
 * Life gain trigger
 */
export function createLifeGainTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-life-gain`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.GAINED_LIFE,
    effect,
  };
}

/**
 * Sacrifice trigger
 */
export function createSacrificeTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  filter?: { permanentType?: string }
): TriggeredAbility {
  let event = TriggerEvent.SACRIFICED;
  if (filter?.permanentType === 'creature') {
    event = TriggerEvent.CREATURE_SACRIFICED;
  } else if (filter?.permanentType === 'artifact') {
    event = TriggerEvent.ARTIFACT_SACRIFICED;
  }
  
  return {
    id: `${sourceId}-sacrifice`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
  };
}

/**
 * Parsed trigger information from oracle text
 */
export interface ParsedTrigger {
  readonly keyword: TriggerKeyword;
  readonly event: TriggerEvent;
  readonly condition?: string;
  readonly effect: string;
  readonly optional: boolean;
  readonly selfTrigger: boolean;
  readonly interveningIf?: string;
}

/**
 * Parse triggered abilities from oracle text
 * Returns all triggers found in the text
 */
export function parseTriggeredAbilitiesFromText(
  oracleText: string,
  permanentId: string,
  controllerId: string,
  cardName: string
): TriggeredAbility[] {
  const abilities: TriggeredAbility[] = [];
  const text = oracleText.toLowerCase();
  
  // Pattern for triggered abilities
  // Matches: "When/Whenever/At the beginning of [event], [effect]"
  const triggerPattern = /\b(when(?:ever)?|at(?:\s+the\s+beginning\s+of)?)\s+([^,]+),\s*([^.]+\.?)/gi;
  
  let match;
  let index = 0;
  
  while ((match = triggerPattern.exec(text)) !== null) {
    const keyword = match[1].toLowerCase().startsWith('at') 
      ? TriggerKeyword.AT 
      : match[1].toLowerCase() === 'whenever' 
        ? TriggerKeyword.WHENEVER 
        : TriggerKeyword.WHEN;
    
    const triggerCondition = match[2].trim();
    let effect = match[3].trim();
    
    // Detect the event type from the trigger condition
    const eventInfo = detectEventFromCondition(triggerCondition);
    
    // Check for optional triggers ("you may")
    const optional = effect.includes('you may') || effect.includes('may have');
    
    // Check for intervening-if clause.
    // Common forms:
    // - "Whenever X, if Y, Z." (leading in effect segment)
    // - "Whenever X if Y, Z." (embedded in trigger-condition segment)
    let interveningIf = triggerCondition.includes(' if ')
      ? triggerCondition.split(' if ')[1]
      : undefined;

    if (!interveningIf) {
      const leadingIf = effect.match(/^if\s+([^,]+),\s*(.+)$/i);
      if (leadingIf) {
        interveningIf = String(leadingIf[1] || '').trim();
        effect = String(leadingIf[2] || '').trim();
      }
    }
    
    // Check if this is a self-trigger
    const selfTrigger = triggerCondition.includes('this creature') ||
                        triggerCondition.includes('this permanent') ||
                        triggerCondition.includes(`${cardName.toLowerCase()}`);
    
    const triggerFilter = eventInfo.filter;
    const hasInterveningIf = Boolean(interveningIf);

    abilities.push({
      id: `${permanentId}-trigger-${index}`,
      sourceId: permanentId,
      sourceName: cardName,
      controllerId,
      keyword,
      event: eventInfo.event,
      condition: triggerFilter || interveningIf,
      ...(triggerFilter ? { triggerFilter } : {}),
      ...(interveningIf ? { interveningIfClause: interveningIf } : {}),
      ...(hasInterveningIf ? { hasInterveningIf } : {}),
      effect,
      optional,
    });
    
    index++;
  }
  
  return abilities;
}

/**
 * Detect the event type from a trigger condition string
 */
function detectEventFromCondition(condition: string): { event: TriggerEvent; filter?: string } {
  const text = condition.toLowerCase();
  
  // ETB triggers
  if (text.includes('enters the battlefield') || text.includes('enters')) {
    if (text.includes('a land') || text.includes('land you control')) {
      return { event: TriggerEvent.LANDFALL };
    }
    return { event: TriggerEvent.ENTERS_BATTLEFIELD };
  }
  
  // Death triggers
  if (text.includes('dies') || text.includes('is put into a graveyard from the battlefield')) {
    if (text.includes('another creature') || text.includes('a creature you control')) {
      return { event: TriggerEvent.CONTROLLED_CREATURE_DIED };
    }
    return { event: TriggerEvent.DIES };
  }
  
  // Combat triggers
  if (text.includes('attacks')) {
    if (text.includes('attacks alone')) {
      return { event: TriggerEvent.ATTACKS_ALONE };
    }
    return { event: TriggerEvent.ATTACKS };
  }
  
  if (text.includes('blocks')) {
    return { event: TriggerEvent.BLOCKS };
  }
  
  if (text.includes('becomes blocked')) {
    return { event: TriggerEvent.BECOMES_BLOCKED };
  }
  
  if (text.includes('deals combat damage to a player') || 
      text.includes('deals combat damage to an opponent')) {
    return { event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER };
  }
  
  if (text.includes('deals combat damage')) {
    return { event: TriggerEvent.DEALS_COMBAT_DAMAGE };
  }
  
  if (text.includes('deals damage')) {
    return { event: TriggerEvent.DEALS_DAMAGE };
  }
  
  // Turn structure triggers
  if (text.includes('beginning of your upkeep') || text.includes('your upkeep')) {
    return { event: TriggerEvent.BEGINNING_OF_UPKEEP, filter: 'your' };
  }
  
  if (text.includes('beginning of each upkeep') || text.includes('each player\'s upkeep')) {
    return { event: TriggerEvent.BEGINNING_OF_UPKEEP, filter: 'each' };
  }
  
  if (text.includes('upkeep')) {
    return { event: TriggerEvent.BEGINNING_OF_UPKEEP };
  }
  
  if (text.includes('beginning of combat') || text.includes('combat on your turn')) {
    return { event: TriggerEvent.BEGINNING_OF_COMBAT };
  }
  
  if (text.includes('end step') || text.includes('end of turn') || text.includes('your end step')) {
    return { event: TriggerEvent.BEGINNING_OF_END_STEP };
  }
  
  if (text.includes('end of combat')) {
    return { event: TriggerEvent.END_OF_COMBAT };
  }
  
  // Spell cast triggers
  if (text.includes('casts a spell') || text.includes('you cast')) {
    if (text.includes('creature spell')) {
      return { event: TriggerEvent.CREATURE_SPELL_CAST };
    }
    if (text.includes('noncreature spell')) {
      return { event: TriggerEvent.NONCREATURE_SPELL_CAST };
    }
    if (text.includes('instant') || text.includes('sorcery')) {
      return { event: TriggerEvent.INSTANT_OR_SORCERY_CAST };
    }
    return { event: TriggerEvent.SPELL_CAST };
  }
  
  // Draw triggers
  if (text.includes('draws a card') || text.includes('draw a card')) {
    return { event: TriggerEvent.DRAWN };
  }
  
  // Discard triggers
  if (text.includes('discards a card') || text.includes('discard a card')) {
    return { event: TriggerEvent.DISCARDED };
  }
  
  // Life triggers
  if (text.includes('gains life') || text.includes('gain life')) {
    return { event: TriggerEvent.GAINED_LIFE };
  }
  
  if (text.includes('loses life') || text.includes('lose life')) {
    return { event: TriggerEvent.LOST_LIFE };
  }
  
  // Sacrifice triggers
  if (text.includes('sacrifice')) {
    if (text.includes('creature')) {
      return { event: TriggerEvent.CREATURE_SACRIFICED };
    }
    if (text.includes('artifact')) {
      return { event: TriggerEvent.ARTIFACT_SACRIFICED };
    }
    return { event: TriggerEvent.SACRIFICED };
  }
  
  // Tapped/untapped triggers
  if (text.includes('becomes tapped') || text.includes('taps')) {
    return { event: TriggerEvent.BECOMES_TAPPED };
  }
  
  if (text.includes('becomes untapped') || text.includes('untaps')) {
    return { event: TriggerEvent.BECOMES_UNTAPPED };
  }
  
  // Counter triggers
  if (text.includes('counter') && text.includes('placed')) {
    return { event: TriggerEvent.COUNTER_PLACED };
  }
  
  if (text.includes('counter') && text.includes('removed')) {
    return { event: TriggerEvent.COUNTER_REMOVED };
  }
  
  // Token triggers
  if (text.includes('token') && (text.includes('created') || text.includes('enters'))) {
    return { event: TriggerEvent.TOKEN_CREATED };
  }
  
  // Exile triggers
  if (text.includes('exiled') || text.includes('is exiled')) {
    return { event: TriggerEvent.EXILED };
  }
  
  // Target triggers
  if (text.includes('becomes the target') || text.includes('is targeted')) {
    return { event: TriggerEvent.TARGETED };
  }
  
  // Leaves/left battlefield triggers
  if (text.includes('leaves the battlefield') || text.includes('left the battlefield')) {
    return { event: TriggerEvent.LEAVES_BATTLEFIELD };
  }
  
  // Return to hand triggers
  if (text.includes('returned to') && text.includes('hand')) {
    return { event: TriggerEvent.RETURNED_TO_HAND };
  }
  
  // Generic ETB trigger if "enters" is in the text
  if (text.includes('enters')) {
    return { event: TriggerEvent.ENTERS_BATTLEFIELD };
  }
  
  // For unrecognized patterns, return a custom event to avoid false matches
  // Callers should handle CUSTOM events appropriately
  return { event: TriggerEvent.ENTERS_BATTLEFIELD, filter: 'unknown_trigger_pattern' };
}

/**
 * Check if an event matches any of multiple trigger events
 * (for compound triggers like "whenever ~ attacks or blocks")
 */
export function checkMultipleTriggers(
  events: TriggerEvent[],
  currentEvent: TriggerEvent
): boolean {
  return events.includes(currentEvent);
}

/**
 * Create a compound trigger that fires on multiple events
 */
export function createCompoundTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  events: TriggerEvent[],
  effect: string
): TriggeredAbility[] {
  return events.map((event, index) => ({
    id: `${sourceId}-compound-${index}`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
  }));
}
