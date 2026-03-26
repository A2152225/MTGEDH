/**
 * actions/triggersHandler.ts
 * 
 * Handles triggered abilities (Rule 603).
 * Processes events and queues triggers for the stack.
 */

import type { GameState, KnownCardRef, BattlefieldPermanent } from '../../../shared/src';
import {
  TriggerEvent,
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

export interface CombatDamageTriggerAssignment {
  readonly attackerId?: string;
  readonly damage?: number;
  readonly defendingPlayerId?: string;
  readonly targetPlayerId?: string;
  readonly targetOpponentId?: string;
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
  
  // Scan all permanents on centralized battlefield for triggered abilities
  for (const perm of state.battlefield || []) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;
    
    const cardName = card.name || '';
    const oracleText = card.oracle_text || '';
    const controllerId = perm.controller || '';
    
    // Check for special card-specific triggers first
    if (hasSpecialTriggeredAbility(cardName)) {
      const config = getTriggeredAbilityConfig(cardName);
      if (config) {
        abilities.push({
          id: `${perm.id}-special-trigger`,
          sourceId: perm.id,
          sourceName: cardName,
          controllerId: controllerId,
          keyword: 'whenever' as any,
          event: config.triggerEvent,
          condition: config.triggerCondition,
          effect: config.effect,
          optional: config.requiresChoice,
        });
      }
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
    );
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
  
  return abilities;
}

/**
 * Check for enter the battlefield triggers
 */
export function checkETBTriggers(
  state: GameState,
  permanentId: string,
  controllerId: string
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

  return processTriggers(state, TriggerEvent.ENTERS_BATTLEFIELD, etbAbilities, eventData);
}

/**
 * Check for dies triggers
 */
export function checkDiesTriggers(
  state: GameState,
  permanentId: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const diesAbilities = abilities.filter(a => 
    a.event === TriggerEvent.DIES
  );
  
  return processTriggers(state, TriggerEvent.DIES, diesAbilities);
}

/**
 * Check for beginning of step triggers
 */
export function checkStepTriggers(
  state: GameState,
  event: TriggerEvent,
  activePlayerId?: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const stepAbilities = abilities.filter(a => a.event === event);

  const eventData = activePlayerId
    ? {
        sourceControllerId: activePlayerId,
        isYourTurn: true,
      }
    : undefined;

  return processTriggers(state, event, stepAbilities, eventData);
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
  landPlayerId: string
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
      buildTriggerEventDataFromPayloads(landPlayerId, { affectedPlayerIds: [landPlayerId] })
    )
  );
}

/**
 * Check for spell cast triggers (e.g., Aetherflux Reservoir)
 */
export function checkSpellCastTriggers(
  state: GameState,
  casterId: string,
  castSpellId?: string,
  castCard?: KnownCardRef
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const spellCastAbilities = abilities.filter(a => 
    a.event === TriggerEvent.SPELL_CAST &&
    a.controllerId === casterId
  );
  const stackSpell = getStackItems(state).find(item => {
    if (String((item as any)?.type || '').trim().toLowerCase() !== 'spell') return false;
    const itemId = String((item as any)?.id || '').trim();
    const itemControllerId = String((item as any)?.controller || (item as any)?.controllerId || '').trim();
    if (castSpellId && itemId !== String(castSpellId || '').trim()) return false;
    return itemControllerId === String(casterId || '').trim();
  }) as any;
  const stackSpellId = String(castSpellId || stackSpell?.id || '').trim() || undefined;
  const stackSpellTargets = Array.isArray(stackSpell?.targets) ? stackSpell.targets : [];
  const spellManaValue = getCardManaValue(castCard || stackSpell?.card);
  
  return processTriggersAutoOracle(
    state,
    TriggerEvent.SPELL_CAST,
    spellCastAbilities,
    buildResolutionEventDataFromGameState(
      state,
      casterId,
      buildTriggerEventDataFromPayloads(casterId, {
        sourceId: stackSpellId,
        sourceControllerId: casterId,
        targetId: stackSpellTargets[0],
        targetPermanentId: stackSpellTargets[0],
        targetPlayerId: stackSpellTargets[0],
        affectedPlayerIds: [casterId],
        spellType: String(castCard?.type_line || '').trim() || undefined,
        ...(spellManaValue !== null ? { spellManaValue } : {}),
      })
    )
  );
}

/**
 * Check for card draw triggers (e.g., Smothering Tithe)
 */
export function checkDrawTriggers(
  state: GameState,
  drawingPlayerId: string,
  isOpponentDraw: boolean = false
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
    buildTriggerEventDataFromPayloads(
      undefined,
      {
        targetPlayerId: drawingPlayerId,
        ...(isOpponentDraw ? { targetOpponentId: drawingPlayerId } : {}),
        affectedPlayerIds: [drawingPlayerId],
        affectedOpponentIds: isOpponentDraw ? [drawingPlayerId] : undefined,
      }
    )
  );
}

/**
 * Check triggers that care about combat damage to players and provide
 * relational opponent context for Oracle IR automation.
 */
export function checkCombatDamageToPlayerTriggers(
  state: GameState,
  sourceControllerId: string,
  assignments: readonly CombatDamageTriggerAssignment[] = []
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
      eventData
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
    const eventData = buildTriggerEventDataFromPayloads(
      sourceControllerId,
      { attackers: assignmentList }
    );

    const result = processTriggersAutoOracle(
      nextState,
      TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
      fallbackAbilities,
      eventData
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
  assignments: readonly BecomesBlockedTriggerAssignment[] = []
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
      eventData
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
