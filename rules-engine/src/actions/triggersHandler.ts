/**
 * actions/triggersHandler.ts
 * 
 * Handles triggered abilities (Rule 603).
 * Processes events and queues triggers for the stack.
 */

import type { GameState, KnownCardRef, BattlefieldPermanent } from '../../../shared/src';
import {
  TriggerEvent,
  executeTriggeredAbilityEffectWithOracleIR,
  processEvent,
  processEventAndExecuteTriggeredOracle,
  putTriggersOnStack,
  createEmptyTriggerQueue,
  buildTriggerEventDataFromPayloads,
  buildResolutionEventDataFromGameState,
  type TriggeredAbility,
  type TriggerEventData,
  parseTriggeredAbilitiesFromText,
} from '../triggeredAbilities';
import {
  checkDelayedTriggers,
  processDelayedTriggers,
  type DelayedTriggerRegistry,
} from '../delayedTriggeredAbilities';
import { 
  hasSpecialTriggeredAbility, 
  getTriggeredAbilityConfig,
  isETBTokenCreator,
  getETBTokenConfig,
} from '../cards';
import { hasChangeling, getAllCreatureTypes } from '../tribalSupport';
import { getCardManaValue } from '../oracleIRExecutorPlayerUtils';

export interface TriggerResult {
  state: GameState;
  triggersAdded: number;
  oracleStepsApplied?: number;
  oracleStepsSkipped?: number;
  oracleExecutions?: number;
  oracleAutomationGaps?: number;
  logs: string[];
}

export interface TriggerProcessingOptions {
  /**
   * When true, triggered ability effect text is executed immediately via Oracle IR
   * (deterministic subset only) in addition to queueing stack trigger objects.
   */
  autoExecuteOracle?: boolean;
  /** Forwarded to Oracle IR execution when autoExecuteOracle is enabled. */
  allowOptional?: boolean;
  /**
   * Optional resolution-time trigger context used for intervening-if rechecks
   * during auto Oracle execution.
   */
  resolutionEventData?: TriggerEventData;
}

export interface StepTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional delayed trigger registry to consume for this step. Defaults to state.delayedTriggerRegistry. */
  delayedTriggerRegistry?: DelayedTriggerRegistry;
  /** Current turn number for delayed-trigger timing checks. Defaults to state.turnNumber/state.turn. */
  turnNumber?: number;
}

export interface ETBTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the entering permanent context. */
  eventData?: TriggerEventData;
}

export interface LandfallTriggerProcessingOptions extends Omit<TriggerProcessingOptions, 'autoExecuteOracle'> {
  /** Optional explicit event data to merge into the landfall trigger context. */
  eventData?: TriggerEventData;
}

export interface DiesTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data for the dying object when current state cannot fully infer it. */
  eventData?: TriggerEventData;
  /** Include battlefield abilities that watch a controlled creature dying. Defaults to true. */
  includeControlledCreatureDeath?: boolean;
}

export interface SpellCastTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the cast-spell context. */
  eventData?: TriggerEventData;
}

export interface DrawTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the draw trigger context. */
  eventData?: TriggerEventData;
}

export interface CombatDamageTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into each combat-damage assignment context. */
  eventData?: TriggerEventData;
}

export interface BecomesBlockedTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the blocked-attacker context. */
  eventData?: TriggerEventData;
}

export interface DelayedTriggerEventCheck {
  readonly type: 'end_step' | 'upkeep' | 'combat_end' | 'combat_begin' | 'cleanup' | 'permanent_left' | 'dies' | 'control_lost' | 'turn_start';
  readonly playerId?: string;
  readonly activePlayerId?: string;
  readonly permanentId?: string;
  readonly currentTurn?: number;
  readonly eligibleTriggerIds?: ReadonlySet<string>;
}

export interface DelayedEventTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional delayed trigger registry to process. Defaults to state.delayedTriggerRegistry. */
  delayedTriggerRegistry?: DelayedTriggerRegistry;
}

export interface CombatDamageTriggerAssignment {
  readonly attackerId?: string;
  readonly damage?: number;
  readonly defendingPlayerId?: string;
  readonly targetPlayerId?: string;
  readonly targetOpponentId?: string;
}

export interface AttackTriggerAssignment {
  readonly attackerId?: string;
  readonly defendingPlayerId?: string;
  readonly targetPlayerId?: string;
  readonly targetOpponentId?: string;
  readonly eventData?: TriggerEventData;
}

export interface BecomesBlockedTriggerAssignment {
  readonly attackerId?: string;
  readonly defendingPlayerId?: string;
}

function getStackItems(state: GameState): any[] {
  const rawStack = (state as any)?.stack;
  if (Array.isArray(rawStack)) return rawStack;
  if (Array.isArray((rawStack as any)?.objects)) return [...(rawStack as any).objects];
  return [];
}

function findCardInPlayersGraveyards(state: GameState, cardId: string): { playerId: string; card: any } | null {
  const normalizedCardId = String(cardId || '').trim();
  if (!normalizedCardId) return null;

  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim();
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === normalizedCardId);
    if (card && playerId) {
      return { playerId, card };
    }
  }

  return null;
}

function buildObjectTypeTokens(object: any): string[] {
  return String(object?.type_line || object?.card?.type_line || '')
    .split(/[\s\u2014-]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function looksLikeSelfDiesTrigger(ability: TriggeredAbility): boolean {
  const sourceText = `${String((ability as any)?.triggerFilter || '')} ${String((ability as any)?.condition || '')}`.toLowerCase();
  return (
    sourceText.includes('this creature') ||
    sourceText.includes('this permanent') ||
    sourceText.includes('this card') ||
    sourceText.includes('it had no +1/+1 counters on it') ||
    sourceText.includes('it had no -1/-1 counters on it')
  );
}

/**
 * Process triggered abilities for an event
 */
export function processTriggers(
  state: GameState,
  event: TriggerEvent,
  registeredAbilities: TriggeredAbility[],
  eventData?: TriggerEventData,
  options: TriggerProcessingOptions = {}
): TriggerResult {
  const logs: string[] = [];
  const autoExecuteOracle = Boolean(options.autoExecuteOracle);

  let nextState = state;
  let triggerInstances = processEvent(event, registeredAbilities, eventData);
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;

  if (autoExecuteOracle) {
    const execution = processEventAndExecuteTriggeredOracle(
      nextState,
      event,
      registeredAbilities,
      eventData,
      {
        allowOptional: options.allowOptional,
        resolutionEventData: options.resolutionEventData,
      }
    );
    nextState = execution.state;
    triggerInstances = [...execution.triggers];
    oracleStepsApplied = execution.executions.reduce((sum, r) => sum + (r.appliedSteps?.length || 0), 0);
    oracleStepsSkipped = execution.executions.reduce((sum, r) => sum + (r.skippedSteps?.length || 0), 0);
    oracleAutomationGaps = execution.executions.reduce((sum, r) => sum + (r.automationGaps?.length || 0), 0);
    oracleExecutions = execution.executions.length;
    logs.push(
      `[triggers] Oracle auto-execution: executions=${oracleExecutions}, applied=${oracleStepsApplied}, skipped=${oracleStepsSkipped}, gaps=${oracleAutomationGaps}`
    );
    logs.push(...execution.log);
  }
  
  if (triggerInstances.length === 0) {
    return { state: nextState, triggersAdded: 0, oracleStepsApplied, oracleStepsSkipped, oracleExecutions, oracleAutomationGaps, logs };
  }
  
  // Queue triggers
  let queue = createEmptyTriggerQueue();
  for (const trigger of triggerInstances) {
    queue = { triggers: [...queue.triggers, trigger] };
  }
  
  // Put on stack in APNAP order
  const activePlayerId = state.players[state.activePlayerIndex || 0]?.id || '';
  const apnapTurnOrder = (() => {
    const ids = (state.players || []).map(p => String((p as any)?.id || '').trim()).filter(Boolean);
    if (ids.length === 0) return ids;
    const activeIdx = ids.indexOf(activePlayerId);
    if (activeIdx < 0) return ids;
    return [...ids.slice(activeIdx), ...ids.slice(0, activeIdx)];
  })();
  const { stackObjects, log } = putTriggersOnStack(queue, activePlayerId, apnapTurnOrder);
  
  logs.push(...log);
  
  // Add to game stack
  const updatedStack = [...(nextState.stack || []), ...stackObjects];
  
  return {
    state: { ...nextState, stack: updatedStack as any },
    triggersAdded: stackObjects.length,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

/**
 * Convenience wrapper for deterministic trigger automation.
 */
export function processTriggersAutoOracle(
  state: GameState,
  event: TriggerEvent,
  registeredAbilities: TriggeredAbility[],
  eventData?: TriggerEventData,
  options: Omit<TriggerProcessingOptions, 'autoExecuteOracle'> = {}
): TriggerResult {
  return processTriggers(state, event, registeredAbilities, eventData, {
    ...options,
    autoExecuteOracle: true,
  });
}

/**
 * Find all triggered abilities on permanents
 * 
 * This enhanced version checks:
 * 1. Card-specific configurations from our cards module
 * 2. Parsed oracle text patterns
 * 3. Special trigger types (tribal, landfall, etc.)
 */
export function findTriggeredAbilities(state: GameState): TriggeredAbility[] {
  const abilities: TriggeredAbility[] = [];
  const looksLikeZoneActiveGraveyardTrigger = (oracleText: string): boolean => {
    const normalized = String(oracleText || '').replace(/\u2019/g, "'").toLowerCase();
    if (!/\b(?:when|whenever|at)\b/.test(normalized)) return false;
    return (
      normalized.includes('this card is in your graveyard') ||
      normalized.includes('return this card from your graveyard') ||
      normalized.includes('cast it from your graveyard') ||
      normalized.includes('cast this card from your graveyard')
    );
  };
  const normalizeTriggerEffectText = (text: string): string =>
    String(text || '')
      .replace(/\u2019/g, "'")
      .trim()
      .toLowerCase()
      .replace(
        /\bthat player may pay (\{[^}]+\})\.\s*if they do(?:n't| not),\s*/g,
        'unless that player pays $1 '
      )
      .replace(
        /\byou create a ([^.]+?) unless that player pays (\{[^}]+\})\.?/g,
        'unless that player pays $2 create a $1'
      )
      .replace(/\byou\s+(create|gain|draw|return|put|copy|sacrifice|exile|destroy|tap|untap)\b/g, '$1')
      .replace(/^you\s+/, '')
      .replace(/\s+/g, ' ');
  
  // Scan all permanents on centralized battlefield for triggered abilities
  for (const perm of state.battlefield || []) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;
    
    const cardName = card.name || '';
    const oracleText = card.oracle_text || '';
    const controllerId = perm.controller || '';
    
    // Check for special card-specific triggers first
    const specialTriggerConfig = hasSpecialTriggeredAbility(cardName)
      ? getTriggeredAbilityConfig(cardName)
      : undefined;

    if (specialTriggerConfig) {
        abilities.push({
          id: `${perm.id}-special-trigger`,
          sourceId: perm.id,
          sourceName: cardName,
          controllerId: controllerId,
          keyword: 'whenever' as any,
          event: specialTriggerConfig.triggerEvent,
          condition: specialTriggerConfig.triggerCondition,
          effect: specialTriggerConfig.effect,
          optional: specialTriggerConfig.requiresChoice,
        });
    }
    
    // Check for ETB token creator triggers
    if (isETBTokenCreator(cardName)) {
      const etbConfig = getETBTokenConfig(cardName);
      if (etbConfig) {
        abilities.push({
          id: `${perm.id}-etb-tokens`,
          sourceId: perm.id,
          sourceName: cardName,
          controllerId: controllerId,
          keyword: 'when' as any,
          event: TriggerEvent.ENTERS_BATTLEFIELD,
          effect: `Create ${etbConfig.tokenCount} ${etbConfig.tokenType} token(s).`,
        });
      }
    }
    
    // Parse additional triggers from oracle text
    const parsedTriggers = parseTriggeredAbilitiesFromText(
      oracleText,
      perm.id,
      controllerId,
      cardName
    ).filter(trigger => {
      if (!specialTriggerConfig) return true;
      return !(
        trigger.event === specialTriggerConfig.triggerEvent &&
        normalizeTriggerEffectText(String(trigger.effect || '')) ===
          normalizeTriggerEffectText(String(specialTriggerConfig.effect || ''))
      );
    });
    abilities.push(...parsedTriggers);
  }

  for (const player of state.players || []) {
    const controllerId = String((player as any)?.id || '').trim();
    if (!controllerId) continue;

    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    for (const card of graveyard) {
      const cardId = String((card as any)?.id || '').trim();
      const cardName = String((card as any)?.name || '').trim();
      const oracleText = String((card as any)?.oracle_text || '').trim();
      if (!cardId || !cardName || !oracleText || !looksLikeZoneActiveGraveyardTrigger(oracleText)) continue;

      const parsedTriggers = parseTriggeredAbilitiesFromText(
        oracleText,
        cardId,
        controllerId,
        cardName
      );
      abilities.push(...parsedTriggers);
    }

    const emblems = Array.isArray((player as any)?.emblems) ? (player as any).emblems : [];
    for (const emblem of emblems) {
      const emblemId = String((emblem as any)?.id || '').trim();
      const emblemName = String((emblem as any)?.name || 'Emblem').trim() || 'Emblem';
      const abilityTexts = Array.isArray((emblem as any)?.abilities) ? (emblem as any).abilities : [];

      for (const abilityText of abilityTexts) {
        const parsedTriggers = parseTriggeredAbilitiesFromText(
          String(abilityText || ''),
          emblemId || `${controllerId}-emblem`,
          controllerId,
          emblemName
        );
        abilities.push(...parsedTriggers);
      }
    }
  }

  for (const stackItem of getStackItems(state)) {
    if (String((stackItem as any)?.type || '').trim().toLowerCase() !== 'spell') continue;

    const stackCard = (((stackItem as any)?.card || (stackItem as any)?.spell || {}) as KnownCardRef);
    const stackSpellId = String((stackItem as any)?.id || '').trim();
    const stackControllerId = String((stackItem as any)?.controller || (stackItem as any)?.controllerId || '').trim();
    const stackCardName = String((stackItem as any)?.cardName || stackCard?.name || '').trim();
    const stackOracleText = String(stackCard?.oracle_text || (stackItem as any)?.oracle_text || '').trim();
    if (!stackSpellId || !stackControllerId || !stackCardName || !stackOracleText) continue;

    const parsedTriggers = parseTriggeredAbilitiesFromText(
      stackOracleText,
      stackSpellId,
      stackControllerId,
      stackCardName
    );
    abilities.push(...parsedTriggers);
  }

  const dedupedAbilities: TriggeredAbility[] = [];
  const seenAbilitySignatures = new Set<string>();
  const normalizeSignaturePart = (value: unknown): string =>
    String(value ?? '')
      .replace(/\u2019/g, "'")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  for (const ability of abilities) {
    const signature = [
      normalizeSignaturePart((ability as any)?.sourceId),
      normalizeSignaturePart((ability as any)?.controllerId),
      normalizeSignaturePart((ability as any)?.event),
      normalizeSignaturePart((ability as any)?.condition),
      normalizeSignaturePart((ability as any)?.triggerFilter),
      normalizeSignaturePart((ability as any)?.interveningIfClause),
      normalizeTriggerEffectText(String((ability as any)?.effect || '')),
    ].join('|');

    if (seenAbilitySignatures.has(signature)) continue;
    seenAbilitySignatures.add(signature);
    dedupedAbilities.push(ability);
  }

  return dedupedAbilities;
}

/**
 * Check for enter the battlefield triggers
 */
export function checkETBTriggers(
  state: GameState,
  permanentId: string,
  controllerId: string,
  options: ETBTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const enteringPermanent = ((state.battlefield || []) as any[]).find(
    perm => String((perm as any)?.id || '').trim() === String(permanentId || '').trim()
  ) as any;
  const etbAbilities = abilities.filter(a => a.event === TriggerEvent.ENTERS_BATTLEFIELD);

  if (etbAbilities.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const eventData = buildResolutionEventDataFromGameState(
    state,
    controllerId,
    buildTriggerEventDataFromPayloads(
      controllerId,
      options.eventData,
      {
        sourceId: permanentId,
        targetPermanentId: permanentId,
        targetId: permanentId,
        sourceControllerId: controllerId,
        sourceOwnerId: String((enteringPermanent as any)?.owner || (enteringPermanent as any)?.ownerId || controllerId).trim() || undefined,
        sourceIsToken: Boolean((enteringPermanent as any)?.isToken),
        permanentTypes: String((enteringPermanent as any)?.card?.type_line || (enteringPermanent as any)?.type_line || '')
          .split(/[\s\u2014-]+/)
          .map(part => part.trim())
          .filter(Boolean),
        creatureTypes: String((enteringPermanent as any)?.card?.type_line || (enteringPermanent as any)?.type_line || '')
          .split(/[\s\u2014-]+/)
          .map(part => part.trim())
          .filter(Boolean),
        keywords: Array.isArray((enteringPermanent as any)?.card?.keywords) ? (enteringPermanent as any).card.keywords : undefined,
        counters: (enteringPermanent as any)?.counters,
        castFromZone:
          String((enteringPermanent as any)?.castFromZone || (enteringPermanent as any)?.card?.castFromZone || '').trim() || undefined,
        enteredFromZone:
          String((enteringPermanent as any)?.enteredFromZone || (enteringPermanent as any)?.card?.enteredFromZone || '').trim() || undefined,
      }
    )
  );

  return processTriggers(state, TriggerEvent.ENTERS_BATTLEFIELD, etbAbilities, eventData, options);
}

/**
 * Check for dies triggers
 */
export function checkDiesTriggers(
  state: GameState,
  permanentId: string,
  options: DiesTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const graveyardMatch = findCardInPlayersGraveyards(state, permanentId);
  const inferredCard = graveyardMatch?.card;
  const inferredOwnerId = graveyardMatch?.playerId;
  const inferredControllerId =
    String(options.eventData?.sourceControllerId || inferredCard?.controller || inferredOwnerId || '').trim() || undefined;
  const deadCardTriggers =
    inferredCard?.oracle_text && inferredControllerId
      ? parseTriggeredAbilitiesFromText(
          String(inferredCard.oracle_text || ''),
          String(permanentId || '').trim(),
          inferredControllerId,
          String(inferredCard.name || permanentId || '').trim() || String(permanentId || '').trim()
        ).filter(ability => ability.event === TriggerEvent.DIES && looksLikeSelfDiesTrigger(ability))
      : [];

  const diesAbilities = [
    ...abilities.filter(a => a.event === TriggerEvent.DIES),
    ...deadCardTriggers,
  ];
  const controlledCreatureDiesAbilities =
    options.includeControlledCreatureDeath === false
      ? []
      : abilities.filter(a => a.event === TriggerEvent.CONTROLLED_CREATURE_DIED);

  const baseEventData = buildTriggerEventDataFromPayloads(
    inferredControllerId || inferredOwnerId,
    {
      sourceId: permanentId,
      targetPermanentId: permanentId,
      targetId: permanentId,
      sourceControllerId: inferredControllerId,
      sourceOwnerId: options.eventData?.sourceOwnerId || inferredOwnerId,
      sourceIsToken: options.eventData?.sourceIsToken ?? Boolean((inferredCard as any)?.isToken),
      sourceIsFaceDown: options.eventData?.sourceIsFaceDown ?? Boolean((inferredCard as any)?.faceDown),
      permanentTypes:
        options.eventData?.permanentTypes ||
        buildObjectTypeTokens(inferredCard),
      creatureTypes:
        options.eventData?.creatureTypes ||
        buildObjectTypeTokens(inferredCard),
      keywords:
        options.eventData?.keywords ||
        (Array.isArray((inferredCard as any)?.keywords) ? (inferredCard as any).keywords : undefined),
      colors:
        options.eventData?.colors ||
        (Array.isArray((inferredCard as any)?.colors) ? (inferredCard as any).colors : undefined),
      counters: options.eventData?.counters || (inferredCard as any)?.counters,
      attachedByPermanentIds: options.eventData?.attachedByPermanentIds,
      castFromZone: options.eventData?.castFromZone || String((inferredCard as any)?.castFromZone || '').trim() || undefined,
      enteredFromZone:
        options.eventData?.enteredFromZone || String((inferredCard as any)?.enteredFromZone || '').trim() || undefined,
    },
    options.eventData
  );
  const eventData = buildResolutionEventDataFromGameState(
    state,
    inferredControllerId || inferredOwnerId || '',
    baseEventData
  );

  let nextState = state;
  let triggersAdded = 0;
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;
  const logs: string[] = [];

  const processEventType = (event: TriggerEvent, registeredAbilities: TriggeredAbility[]): void => {
    if (registeredAbilities.length === 0) return;
    const result = processTriggers(nextState, event, registeredAbilities, eventData, options);
    nextState = result.state;
    triggersAdded += result.triggersAdded;
    oracleStepsApplied += result.oracleStepsApplied || 0;
    oracleStepsSkipped += result.oracleStepsSkipped || 0;
    oracleExecutions += result.oracleExecutions || 0;
    oracleAutomationGaps += result.oracleAutomationGaps || 0;
    logs.push(...(result.logs || []));
  };

  processEventType(TriggerEvent.DIES, diesAbilities);
  processEventType(TriggerEvent.CONTROLLED_CREATURE_DIED, controlledCreatureDiesAbilities);

  return {
    state: nextState,
    triggersAdded,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

/**
 * Check for beginning of step triggers
 */
export function checkStepTriggers(
  state: GameState,
  event: TriggerEvent,
  activePlayerId?: string,
  options: StepTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const stepAbilities = abilities.filter(a => a.event === event);
  const logs: string[] = [];
  const autoExecuteOracle = Boolean(options.autoExecuteOracle);
  let nextState = state;
  let triggerInstances: any[] = [];
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;

  const controllerIds = Array.from(
    new Set(stepAbilities.map(ability => String(ability.controllerId || '').trim()).filter(Boolean))
  );

  if (controllerIds.length === 0 && activePlayerId) {
    controllerIds.push(String(activePlayerId).trim());
  }

  for (const controllerId of controllerIds) {
    const controllerAbilities = stepAbilities.filter(
      ability => String(ability.controllerId || '').trim() === controllerId
    );
    if (controllerAbilities.length === 0) continue;

    const eventData = buildResolutionEventDataFromGameState(
      nextState,
      controllerId,
      buildTriggerEventDataFromPayloads(activePlayerId || controllerId, {
        sourceControllerId: activePlayerId || controllerId,
        affectedPlayerIds: activePlayerId ? [activePlayerId] : undefined,
      })
    );

    if (autoExecuteOracle) {
      const execution = processEventAndExecuteTriggeredOracle(
        nextState,
        event,
        controllerAbilities,
        eventData,
        {
          allowOptional: options.allowOptional,
          resolutionEventData: options.resolutionEventData,
        }
      );
      nextState = execution.state;
      triggerInstances.push(...execution.triggers);
      oracleStepsApplied += execution.executions.reduce((sum, r) => sum + (r.appliedSteps?.length || 0), 0);
      oracleStepsSkipped += execution.executions.reduce((sum, r) => sum + (r.skippedSteps?.length || 0), 0);
      oracleAutomationGaps += execution.executions.reduce((sum, r) => sum + (r.automationGaps?.length || 0), 0);
      oracleExecutions += execution.executions.length;
      logs.push(...execution.log);
      continue;
    }

    triggerInstances.push(...processEvent(event, controllerAbilities, eventData));
  }

  const delayedTriggerRegistry =
    options.delayedTriggerRegistry ||
    (((state as any).delayedTriggerRegistry || undefined) as DelayedTriggerRegistry | undefined);
  let updatedDelayedRegistry = delayedTriggerRegistry;
  const delayedEventType =
    event === TriggerEvent.BEGINNING_OF_UPKEEP
      ? 'upkeep'
      : event === TriggerEvent.BEGINNING_OF_END_STEP
        ? 'end_step'
        : event === TriggerEvent.BEGINNING_OF_COMBAT
          ? 'combat_begin'
          : event === TriggerEvent.END_OF_COMBAT
            ? 'combat_end'
            : event === TriggerEvent.CLEANUP_STEP
              ? 'cleanup'
              : null;

  if (delayedTriggerRegistry && delayedEventType) {
    const delayedCheck = checkDelayedTriggers(delayedTriggerRegistry, {
      type: delayedEventType,
      activePlayerId: activePlayerId as any,
      currentTurn:
        options.turnNumber ??
        Number((state as any).turnNumber ?? (state as any).turn ?? 0) ??
        0,
    });

    if (delayedCheck.triggersToFire.length > 0) {
      updatedDelayedRegistry = {
        ...delayedTriggerRegistry,
        triggers: delayedCheck.remainingTriggers,
        firedTriggerIds: [
          ...(Array.isArray(delayedTriggerRegistry.firedTriggerIds) ? delayedTriggerRegistry.firedTriggerIds : []),
          ...delayedCheck.triggersToFire.map(trigger => trigger.id),
        ],
      };

      triggerInstances.push(...processDelayedTriggers(delayedCheck.triggersToFire, Date.now()));
      logs.push(...delayedCheck.triggersToFire.map(trigger => `${trigger.sourceName} delayed trigger processed`));

      if (autoExecuteOracle) {
        for (const delayedTrigger of delayedCheck.triggersToFire) {
          const execution = executeTriggeredAbilityEffectWithOracleIR(
            nextState,
            {
              controllerId: delayedTrigger.controllerId,
              sourceId: delayedTrigger.sourceId,
              sourceName: delayedTrigger.sourceName,
              effect: delayedTrigger.effect,
            },
            delayedTrigger.eventDataSnapshot,
            { allowOptional: options.allowOptional }
          );
          nextState = execution.state;
          oracleExecutions += 1;
          oracleStepsApplied += execution.appliedSteps.length;
          oracleStepsSkipped += execution.skippedSteps.length;
          oracleAutomationGaps += execution.automationGaps.length;
          logs.push(...execution.log);
        }
      }
    }
  }

  if (autoExecuteOracle) {
    logs.unshift(
      `[triggers] Oracle auto-execution: executions=${oracleExecutions}, applied=${oracleStepsApplied}, skipped=${oracleStepsSkipped}, gaps=${oracleAutomationGaps}`
    );
  }

  if (triggerInstances.length === 0) {
    return {
      state: updatedDelayedRegistry
        ? ({ ...(nextState as any), delayedTriggerRegistry: updatedDelayedRegistry } as any)
        : nextState,
      triggersAdded: 0,
      oracleStepsApplied,
      oracleStepsSkipped,
      oracleExecutions,
      oracleAutomationGaps,
      logs,
    };
  }

  let queue = createEmptyTriggerQueue();
  for (const trigger of triggerInstances) {
    queue = { triggers: [...queue.triggers, trigger] };
  }

  const activeId = activePlayerId || state.players[state.activePlayerIndex || 0]?.id || '';
  const apnapTurnOrder = (() => {
    const ids = (state.players || []).map(p => String((p as any)?.id || '').trim()).filter(Boolean);
    if (ids.length === 0) return ids;
    const activeIdx = ids.indexOf(activeId);
    if (activeIdx < 0) return ids;
    return [...ids.slice(activeIdx), ...ids.slice(0, activeIdx)];
  })();
  const { stackObjects, log } = putTriggersOnStack(queue, activeId, apnapTurnOrder);
  logs.push(...log);

  return {
    state: {
      ...(nextState as any),
      ...(updatedDelayedRegistry ? { delayedTriggerRegistry: updatedDelayedRegistry } : {}),
      stack: [...(nextState.stack || []), ...stackObjects] as any,
    } as any,
    triggersAdded: stackObjects.length,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

/**
 * Check delayed triggers tied to non-step events such as dies, leaves, and control-loss.
 */
export function checkDelayedEventTriggers(
  state: GameState,
  currentEvent: DelayedTriggerEventCheck,
  options: DelayedEventTriggerProcessingOptions = {}
): TriggerResult {
  const delayedTriggerRegistry =
    options.delayedTriggerRegistry ||
    (((state as any).delayedTriggerRegistry || undefined) as DelayedTriggerRegistry | undefined);

  if (!delayedTriggerRegistry) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const delayedCheck = checkDelayedTriggers(delayedTriggerRegistry, currentEvent as any);
  if (delayedCheck.triggersToFire.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const updatedDelayedRegistry: DelayedTriggerRegistry = {
    ...delayedTriggerRegistry,
    triggers: delayedCheck.remainingTriggers,
    firedTriggerIds: [
      ...(Array.isArray(delayedTriggerRegistry.firedTriggerIds) ? delayedTriggerRegistry.firedTriggerIds : []),
      ...delayedCheck.triggersToFire.map(trigger => trigger.id),
    ],
  };

  const logs = delayedCheck.triggersToFire.map(trigger => `${trigger.sourceName} delayed trigger processed`);
  const autoExecuteOracle = Boolean(options.autoExecuteOracle);
  let nextState = state;
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;

  if (autoExecuteOracle) {
    for (const delayedTrigger of delayedCheck.triggersToFire) {
      const execution = executeTriggeredAbilityEffectWithOracleIR(
        nextState,
        {
          controllerId: delayedTrigger.controllerId,
          sourceId: delayedTrigger.sourceId,
          sourceName: delayedTrigger.sourceName,
          effect: delayedTrigger.effect,
        },
        delayedTrigger.eventDataSnapshot,
        { allowOptional: options.allowOptional }
      );
      nextState = execution.state;
      oracleExecutions += 1;
      oracleStepsApplied += execution.appliedSteps.length;
      oracleStepsSkipped += execution.skippedSteps.length;
      oracleAutomationGaps += execution.automationGaps.length;
      logs.push(...execution.log);
    }

    logs.unshift(
      `[triggers] Oracle auto-execution: executions=${oracleExecutions}, applied=${oracleStepsApplied}, skipped=${oracleStepsSkipped}, gaps=${oracleAutomationGaps}`
    );
  }

  const triggerInstances = processDelayedTriggers(delayedCheck.triggersToFire, Date.now());
  const activePlayerId =
    String(currentEvent.activePlayerId || state.players[state.activePlayerIndex || 0]?.id || (state as any).turnPlayer || '').trim();
  const apnapTurnOrder = (() => {
    const ids = (state.players || []).map(p => String((p as any)?.id || '').trim()).filter(Boolean);
    if (ids.length === 0) return ids;
    const activeIdx = ids.indexOf(activePlayerId);
    if (activeIdx < 0) return ids;
    return [...ids.slice(activeIdx), ...ids.slice(0, activeIdx)];
  })();
  const { stackObjects, log } = putTriggersOnStack({ triggers: triggerInstances }, activePlayerId, apnapTurnOrder);
  logs.push(...log);

  return {
    state: {
      ...(nextState as any),
      delayedTriggerRegistry: updatedDelayedRegistry,
      stack: [...(nextState.stack || []), ...stackObjects] as any,
    } as any,
    triggersAdded: stackObjects.length,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

/**
 * Check for tribal spell cast triggers (e.g., Deeproot Waters for Merfolk spells)
 * Takes into account changeling and Kindred/tribal subtype-bearing spells.
 */
export function checkTribalCastTriggers(
  state: GameState,
  castCard: KnownCardRef,
  casterId: string,
  options: Omit<TriggerProcessingOptions, 'resolutionEventData'> & { resolutionEventData?: TriggerEventData } = {}
): TriggerResult {
  const logs: string[] = [];
  const triggeredAbilities: TriggeredAbility[] = [];
  
  // Get the relevant creature-type subtypes of the cast spell.
  const typeLine = castCard.type_line || '';
  const oracleText = castCard.oracle_text || '';

  // Handle noncreature subtype-bearing spells such as Kindred Sorceries.
  const isChangelingCard = hasChangeling(oracleText, typeLine);
  const creatureTypes = isChangelingCard 
    ? getAllCreatureTypes(typeLine, oracleText)
    : getAllCreatureTypes(typeLine, '');

  if (creatureTypes.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }
  
  // Find all tribal triggers on battlefield (only for controller)
  for (const perm of state.battlefield || []) {
    if (perm.controller !== casterId) continue; // Only trigger for controller
    
    const permCard = perm.card as KnownCardRef;
    if (!permCard) continue;
    
    const cardName = permCard.name || '';
    
    // Check for special tribal triggers (Deeproot Waters, etc.)
    if (hasSpecialTriggeredAbility(cardName)) {
      const config = getTriggeredAbilityConfig(cardName);
      if (config?.triggerEvent === TriggerEvent.CREATURE_SPELL_CAST && config.creatureTypeFilter) {
        // Check if the cast spell matches the required creature type.
        const requiredType = config.creatureTypeFilter.toLowerCase();
        const matchesType = creatureTypes.some(t => t.toLowerCase() === requiredType);
        
        if (matchesType) {
          logs.push(`${cardName} triggered from casting ${castCard.name}`);
          triggeredAbilities.push({
            id: `${perm.id}-tribal-cast-${Date.now()}`,
            sourceId: perm.id,
            sourceName: cardName,
            controllerId: perm.controller || casterId,
            keyword: 'whenever' as any,
            event: TriggerEvent.CREATURE_SPELL_CAST,
            effect: config.effect,
            optional: config.requiresChoice,
          });
        }
      }
    }
  }
  
  if (triggeredAbilities.length === 0) {
    return { state, triggersAdded: 0, logs };
  }

  const result = processTriggers(
    state,
    TriggerEvent.CREATURE_SPELL_CAST,
    triggeredAbilities,
    buildTriggerEventDataFromPayloads(casterId, { affectedPlayerIds: [casterId] }),
    {
      autoExecuteOracle: options.autoExecuteOracle ?? true,
      allowOptional: options.allowOptional,
      resolutionEventData: options.resolutionEventData,
    }
  );

  return {
    ...result,
    logs: [...logs, ...(result.logs || [])],
  };
}

/**
 * Check for landfall triggers (e.g., Tireless Provisioner)
 */
export function checkLandfallTriggers(
  state: GameState,
  landPlayerId: string,
  options: LandfallTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const landfallAbilities = abilities.filter(a => 
    a.event === TriggerEvent.LANDFALL &&
    a.controllerId === landPlayerId
  );
  
  return processTriggersAutoOracle(
    state,
    TriggerEvent.LANDFALL,
    landfallAbilities,
    buildResolutionEventDataFromGameState(
      state,
      landPlayerId,
      buildTriggerEventDataFromPayloads(landPlayerId, options.eventData, { affectedPlayerIds: [landPlayerId] })
    ),
    options
  );
}

/**
 * Check for spell cast triggers (e.g., Aetherflux Reservoir)
 */
export function checkSpellCastTriggers(
  state: GameState,
  casterId: string,
  castSpellId?: string,
  castCard?: KnownCardRef,
  options: SpellCastTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const stackSpell = getStackItems(state).find(item => {
    if (String((item as any)?.type || '').trim().toLowerCase() !== 'spell') return false;
    const itemId = String((item as any)?.id || '').trim();
    const itemControllerId = String((item as any)?.controller || (item as any)?.controllerId || '').trim();
    if (castSpellId && itemId !== String(castSpellId || '').trim()) return false;
    return itemControllerId === String(casterId || '').trim();
  }) as any;
  const stackSpellId = String(castSpellId || stackSpell?.id || '').trim() || undefined;
  const stackSpellTargets = Array.isArray(stackSpell?.targets) ? stackSpell.targets : [];
  const resolvedCastCard = castCard || stackSpell?.card;
  const resolvedSpellType = String(resolvedCastCard?.type_line || '').trim();
  const normalizedSpellType = resolvedSpellType.toLowerCase();
  const spellManaValue = getCardManaValue(resolvedCastCard);
  const spellCastCountThisTurn = Number((((state as any)?.spellsCastThisTurn || {})?.[casterId] || 0));
  const noncreatureSpellCastCountThisTurn = Number(
    ((((state as any)?.noncreatureSpellsCastThisTurn || {})?.[casterId] || 0))
  );
  const relevantEvents: TriggerEvent[] = [TriggerEvent.SPELL_CAST];

  if (normalizedSpellType) {
    if (normalizedSpellType.includes('creature')) {
      relevantEvents.push(TriggerEvent.CREATURE_SPELL_CAST);
    } else {
      relevantEvents.push(TriggerEvent.NONCREATURE_SPELL_CAST);
    }

    if (normalizedSpellType.includes('instant') || normalizedSpellType.includes('sorcery')) {
      relevantEvents.push(TriggerEvent.INSTANT_OR_SORCERY_CAST);
    }
  }

  const baseEventData = buildTriggerEventDataFromPayloads(
    casterId,
    options.eventData,
    {
      sourceId: stackSpellId,
      sourceControllerId: casterId,
      targetId: stackSpellTargets[0],
      targetPermanentId: stackSpellTargets[0],
      targetPlayerId: stackSpellTargets[0],
      affectedPlayerIds: [casterId],
      spellType: resolvedSpellType || undefined,
      ...(spellManaValue !== null ? { spellManaValue } : {}),
      ...(Number.isFinite(spellCastCountThisTurn) ? { spellCastCountThisTurn } : {}),
      ...(Number.isFinite(noncreatureSpellCastCountThisTurn) ? { noncreatureSpellCastCountThisTurn } : {}),
    }
  );

  let nextState = state;
  let triggersAdded = 0;
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;
  const logs: string[] = [];

  for (const event of relevantEvents) {
    const matchingAbilities = abilities.filter(ability => ability.event === event);
    if (matchingAbilities.length === 0) continue;

    const abilityControllers = [...new Set(matchingAbilities.map(ability => String(ability.controllerId || '').trim()).filter(Boolean))];
    for (const abilityControllerId of abilityControllers) {
      const controllerAbilities = matchingAbilities.filter(
        ability => String(ability.controllerId || '').trim() === abilityControllerId
      );
      if (controllerAbilities.length === 0) continue;

      const eventData = buildResolutionEventDataFromGameState(
        nextState,
        abilityControllerId,
        baseEventData
      );
      const result = processTriggersAutoOracle(nextState, event, controllerAbilities, eventData, options);
      nextState = result.state;
      triggersAdded += result.triggersAdded;
      oracleStepsApplied += result.oracleStepsApplied || 0;
      oracleStepsSkipped += result.oracleStepsSkipped || 0;
      oracleExecutions += result.oracleExecutions || 0;
      oracleAutomationGaps += result.oracleAutomationGaps || 0;
      logs.push(...(result.logs || []));
    }
  }

  return {
    state: nextState,
    triggersAdded,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

/**
 * Check for card draw triggers (e.g., Smothering Tithe)
 */
export function checkDrawTriggers(
  state: GameState,
  drawingPlayerId: string,
  isOpponentDraw: boolean = false,
  options: DrawTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const drawAbilities = abilities.filter(a => {
    if (a.event !== TriggerEvent.DRAWN) return false;
    
    // Filter by condition (opponent draw, etc.)
    if (a.condition === 'opponent' && !isOpponentDraw) return false;
    if (a.condition === 'you' && isOpponentDraw) return false;
    
    return true;
  });
  
  return processTriggersAutoOracle(
    state,
    TriggerEvent.DRAWN,
    drawAbilities,
    buildResolutionEventDataFromGameState(
      state,
      drawingPlayerId,
      buildTriggerEventDataFromPayloads(
        drawingPlayerId,
        options.eventData,
        {
          targetPlayerId: drawingPlayerId,
          ...(isOpponentDraw ? { targetOpponentId: drawingPlayerId } : {}),
          affectedPlayerIds: [drawingPlayerId],
          affectedOpponentIds: isOpponentDraw ? [drawingPlayerId] : undefined,
        }
      )
    ),
    options
  );
}

/**
 * Check triggers that fire when one or more creatures attack.
 */
export function checkAttackTriggers(
  state: GameState,
  assignments: readonly AttackTriggerAssignment[] = [],
  options: Omit<TriggerProcessingOptions, 'resolutionEventData'> & { resolutionEventData?: TriggerEventData } = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const attackAbilities = abilities.filter(a => a.event === TriggerEvent.ATTACKS);
  if (attackAbilities.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const assignmentList = Array.isArray(assignments) ? assignments : [];
  let nextState = state;
  let triggersAdded = 0;
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;
  const logs: string[] = [];

  const attackedOpponentsByController = new Map<string, string[]>();
  for (const assignment of assignmentList) {
    const attackerId = String(assignment.attackerId || '').trim();
    if (!attackerId) continue;
    const attacker = ((state.battlefield || []) as any[]).find(
      permanent => String((permanent as any)?.id || '').trim() === attackerId
    ) as any;
    const controllerId = String((attacker as any)?.controller || '').trim();
    const opponentId = String(
      assignment.defendingPlayerId || assignment.targetOpponentId || assignment.targetPlayerId || ''
    ).trim();
    if (!controllerId || !opponentId) continue;
    const current = attackedOpponentsByController.get(controllerId) || [];
    if (!current.includes(opponentId)) current.push(opponentId);
    attackedOpponentsByController.set(controllerId, current);
  }

  for (const assignment of assignmentList) {
    const attackerId = String(assignment.attackerId || '').trim();
    if (!attackerId) continue;

    const attacker = ((nextState.battlefield || []) as any[]).find(
      permanent => String((permanent as any)?.id || '').trim() === attackerId
    ) as any;
    const controllerId = String((attacker as any)?.controller || '').trim();
    if (!controllerId) continue;

    const relevantAbilities = attackAbilities.filter(ability => String(ability.sourceId || '').trim() === attackerId);
    if (relevantAbilities.length === 0) continue;

    const targetOpponentId =
      String(assignment.targetOpponentId || assignment.defendingPlayerId || '').trim() || undefined;
    const targetPlayerId =
      String(assignment.targetPlayerId || assignment.defendingPlayerId || '').trim() || undefined;

    const eventData = buildResolutionEventDataFromGameState(
      nextState,
      controllerId,
      buildTriggerEventDataFromPayloads(
        controllerId,
        {
          sourceId: attackerId,
          sourceControllerId: controllerId,
          sourceOwnerId: String((attacker as any)?.owner || (attacker as any)?.ownerId || controllerId).trim() || undefined,
          targetOpponentId,
          targetPlayerId,
          affectedOpponentIds: attackedOpponentsByController.get(controllerId),
        },
        assignment.eventData
      )
    );

    const result = processTriggersAutoOracle(nextState, TriggerEvent.ATTACKS, relevantAbilities, eventData, options);
    nextState = result.state;
    triggersAdded += result.triggersAdded;
    oracleStepsApplied += result.oracleStepsApplied || 0;
    oracleStepsSkipped += result.oracleStepsSkipped || 0;
    oracleExecutions += result.oracleExecutions || 0;
    oracleAutomationGaps += result.oracleAutomationGaps || 0;
    logs.push(...(result.logs || []));
  }

  return {
    state: nextState,
    triggersAdded,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

/**
 * Check triggers that fire when a creature attacks alone.
 */
export function checkAttacksAloneTriggers(
  state: GameState,
  attackerId: string,
  options: Omit<TriggerProcessingOptions, 'resolutionEventData'> & { resolutionEventData?: TriggerEventData } = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const aloneAbilities = abilities.filter(a => a.event === TriggerEvent.ATTACKS_ALONE);
  if (aloneAbilities.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const attacker = ((state.battlefield || []) as any[]).find(
    permanent => String((permanent as any)?.id || '').trim() === String(attackerId || '').trim()
  ) as any;
  const controllerId = String((attacker as any)?.controller || '').trim();
  if (!controllerId) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const controllerAbilities = aloneAbilities.filter(
    ability => String(ability.controllerId || '').trim() === controllerId
  );
  if (controllerAbilities.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const defendingPlayerId =
    String((attacker as any)?.defendingPlayerId || (attacker as any)?.attacking || '').trim() || undefined;
  const eventData = buildResolutionEventDataFromGameState(
    state,
    controllerId,
    buildTriggerEventDataFromPayloads(controllerId, {
      sourceId: attackerId,
      targetPermanentId: attackerId,
      targetId: attackerId,
      sourceControllerId: controllerId,
      sourceOwnerId: String((attacker as any)?.owner || (attacker as any)?.ownerId || controllerId).trim() || undefined,
      targetOpponentId: defendingPlayerId,
      targetPlayerId: defendingPlayerId,
      affectedOpponentIds: defendingPlayerId ? [defendingPlayerId] : undefined,
    })
  );

  return processTriggersAutoOracle(state, TriggerEvent.ATTACKS_ALONE, controllerAbilities, eventData, options);
}

/**
 * Check triggers that care about combat damage to players and provide
 * relational opponent context for Oracle IR automation.
 */
export function checkCombatDamageToPlayerTriggers(
  state: GameState,
  sourceControllerId: string,
  assignments: readonly CombatDamageTriggerAssignment[] = [],
  options: CombatDamageTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const combatAbilities = abilities.filter(a => a.event === TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
  if (combatAbilities.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }

  const assignmentList = Array.isArray(assignments) ? assignments : [];
  const matchedAbilityIds = new Set<string>();
  let nextState = state;
  let triggersAdded = 0;
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;
  const logs: string[] = [];

  for (const assignment of assignmentList) {
    const attackerId = String(assignment.attackerId || '').trim();
    if (!attackerId) continue;

    const attacker = ((nextState.battlefield || []) as any[]).find(
      permanent => String((permanent as any)?.id || '').trim() === attackerId
    ) as any;
    const controllerId = String((attacker as any)?.controller || sourceControllerId || '').trim();
    if (!controllerId) continue;

    const relevantAbilities = combatAbilities.filter(ability => String(ability.sourceId || '').trim() === attackerId);
    if (relevantAbilities.length === 0) continue;

    for (const ability of relevantAbilities) {
      const abilityId = String(ability.id || '').trim();
      if (abilityId) matchedAbilityIds.add(abilityId);
    }

    const eventData = buildResolutionEventDataFromGameState(
      nextState,
      controllerId,
      buildTriggerEventDataFromPayloads(
        controllerId,
        options.eventData,
        {
          attackers: [assignment],
          sourceId: attackerId,
          targetPermanentId: attackerId,
          targetOpponentId: String(assignment.defendingPlayerId || assignment.targetOpponentId || '').trim() || undefined,
          targetPlayerId: String(assignment.defendingPlayerId || assignment.targetPlayerId || '').trim() || undefined,
          sourceControllerId: controllerId,
          sourceOwnerId: String((attacker as any)?.owner || (attacker as any)?.ownerId || controllerId).trim() || undefined,
          sourceRenowned:
            typeof (attacker as any)?.isRenowned === 'boolean'
              ? Boolean((attacker as any).isRenowned)
              : typeof (attacker as any)?.renowned === 'boolean'
                ? Boolean((attacker as any).renowned)
                : false,
          permanentTypes: String((attacker as any)?.card?.type_line || (attacker as any)?.type_line || '')
            .split(/[\s\u2014-]+/)
            .map(part => part.trim())
            .filter(Boolean),
          creatureTypes: String((attacker as any)?.card?.type_line || (attacker as any)?.type_line || '')
            .split(/[\s\u2014-]+/)
            .map(part => part.trim())
            .filter(Boolean),
          keywords: Array.isArray((attacker as any)?.card?.keywords) ? (attacker as any).card.keywords : undefined,
          counters: (attacker as any)?.counters,
        }
      )
    );

    const result = processTriggersAutoOracle(
      nextState,
      TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
      relevantAbilities,
      eventData,
      options
    );
    nextState = result.state;
    triggersAdded += result.triggersAdded;
    oracleStepsApplied += result.oracleStepsApplied || 0;
    oracleStepsSkipped += result.oracleStepsSkipped || 0;
    oracleExecutions += result.oracleExecutions || 0;
    oracleAutomationGaps += result.oracleAutomationGaps || 0;
    logs.push(...(result.logs || []));
  }

  const fallbackAbilities = combatAbilities.filter(
    ability => !matchedAbilityIds.has(String(ability.id || '').trim())
  );
  if (fallbackAbilities.length > 0) {
    const eventData = buildResolutionEventDataFromGameState(
      nextState,
      sourceControllerId,
      buildTriggerEventDataFromPayloads(
        sourceControllerId,
        options.eventData,
        { attackers: assignmentList }
      )
    );

    const result = processTriggersAutoOracle(
      nextState,
      TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
      fallbackAbilities,
      eventData,
      options
    );
    nextState = result.state;
    triggersAdded += result.triggersAdded;
    oracleStepsApplied += result.oracleStepsApplied || 0;
    oracleStepsSkipped += result.oracleStepsSkipped || 0;
    oracleExecutions += result.oracleExecutions || 0;
    oracleAutomationGaps += result.oracleAutomationGaps || 0;
    logs.push(...(result.logs || []));
  }

  return {
    state: nextState,
    triggersAdded,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

/**
 * Check triggers that care about a creature becoming blocked.
 * This currently scopes to the blocked attacker itself, which is the needed
 * runtime seam for self-source keywords like Afflict.
 */
export function checkBecomesBlockedTriggers(
  state: GameState,
  assignments: readonly BecomesBlockedTriggerAssignment[] = [],
  options: BecomesBlockedTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const blockedAbilities = abilities.filter(a => a.event === TriggerEvent.BECOMES_BLOCKED);
  if (blockedAbilities.length === 0 || assignments.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }

  let nextState = state;
  let triggersAdded = 0;
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;
  const logs: string[] = [];

  for (const assignment of assignments) {
    const attackerId = String(assignment.attackerId || '').trim();
    if (!attackerId) continue;

    const attacker = ((nextState.battlefield || []) as any[]).find(
      permanent => String((permanent as any)?.id || '').trim() === attackerId
    ) as any;
    const controllerId = String((attacker as any)?.controller || '').trim();
    if (!controllerId) continue;

    const relevantAbilities = blockedAbilities.filter(ability => String(ability.sourceId || '').trim() === attackerId);
    if (relevantAbilities.length === 0) continue;

    const eventData = buildResolutionEventDataFromGameState(
      nextState,
      controllerId,
      buildTriggerEventDataFromPayloads(
        controllerId,
        options.eventData,
        {
          sourceId: attackerId,
          targetPermanentId: attackerId,
          targetOpponentId: String(assignment.defendingPlayerId || '').trim() || undefined,
          targetPlayerId: String(assignment.defendingPlayerId || '').trim() || undefined,
          sourceControllerId: controllerId,
          sourceOwnerId: String((attacker as any)?.owner || (attacker as any)?.ownerId || controllerId).trim() || undefined,
          permanentTypes: String((attacker as any)?.card?.type_line || (attacker as any)?.type_line || '')
            .split(/[\s\u2014-]+/)
            .map(part => part.trim())
            .filter(Boolean),
          creatureTypes: String((attacker as any)?.card?.type_line || (attacker as any)?.type_line || '')
            .split(/[\s\u2014-]+/)
            .map(part => part.trim())
            .filter(Boolean),
        }
      )
    );

    const result = processTriggersAutoOracle(
      nextState,
      TriggerEvent.BECOMES_BLOCKED,
      relevantAbilities,
      eventData,
      options
    );

    nextState = result.state;
    triggersAdded += result.triggersAdded;
    oracleStepsApplied += result.oracleStepsApplied || 0;
    oracleStepsSkipped += result.oracleStepsSkipped || 0;
    oracleExecutions += result.oracleExecutions || 0;
    oracleAutomationGaps += result.oracleAutomationGaps || 0;
    logs.push(...(result.logs || []));
  }

  return {
    state: nextState,
    triggersAdded,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}
