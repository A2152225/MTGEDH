/**
 * socket/resolutionModalChoiceResponseHandlers.ts
 *
 * MODAL_CHOICE response handler and SOLDIER Military Program helper.
 * Extracted from resolution.ts. Wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { permanentHasCreatureTypeNow } from "../state/creatureTypeNow.js";
import { inferTriggeredAbilityTargetMetadata } from "../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { executeTriggerEffect } from "../state/modules/stackExecuteTriggerEffectUtils.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { parsePT, uid } from "../state/utils.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { debug, debugWarn } from "../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "./resolutionCloneQueuedPromptUtils.js";
import {
  buildTriggeredAbilitySourceContext,
  getResolutionSourcePermanentSnapshot,
} from "./resolutionKeywordChoiceHandlers.js";
import { getPlayerName, persistAndResolveTopOfStack } from "./util.js";

/**
 * Handle Modal Choice response
 * This handles generic modal choices including the "put creature from hand onto battlefield" pattern
 */
export async function handleModalChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections;
  
  // Import utilities dynamically to avoid circular dependencies
  // (resolution.ts <-> stack.ts circular import would cause issues)
  const { uid } = await import("../state/utils.js");
  const { triggerETBEffectsForPermanent } = await import("../state/modules/triggerEtbPermanentEffects.js");
  
  // Get selection - could be string, array of strings, or 'decline'
  let selectedId: string | null = null;
  if (typeof selections === 'string') {
    selectedId = selections === 'decline' ? null : selections;
  } else if (Array.isArray(selections) && selections.length > 0) {
    selectedId = selections[0] === 'decline' ? null : selections[0];
  }
  
  // Check if this is a "put from hand" modal choice
  const modalStep = step as any;
  const putFromHandData = modalStep.putFromHandData;
  
  if (putFromHandData) {
    // Handle putting creature from hand onto battlefield
    if (!selectedId || selectedId === 'decline') {
      // Player declined
      debug(2, `[Resolution] ${step.sourceName || 'Effect'}: Player ${pid} declined to put creature from hand`);
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} chose not to put a creature onto the battlefield.`,
        ts: Date.now(),
      });
      return;
    }
    
    // Verify the selected card is valid
    const validCardIds = new Set(putFromHandData.validCardIds || []);
    if (!validCardIds.has(selectedId)) {
      debugWarn(1, `[Resolution] Invalid card selection: ${selectedId} not in valid cards`);
      return;
    }
    
    // Get player zones
    const zones = game.state?.zones?.[pid];
    if (!zones || !zones.hand) {
      debugWarn(2, `[Resolution] No hand found for player ${pid}`);
      return;
    }
    
    // Find and remove the card from hand
    const cardIndex = zones.hand.findIndex((c: any) => c.id === selectedId);
    if (cardIndex === -1) {
      debugWarn(2, `[Resolution] Selected card ${selectedId} not found in hand`);
      return;
    }
    
    const [card] = zones.hand.splice(cardIndex, 1);
    zones.handCount = zones.hand.length;
    
    // Put onto battlefield
    const battlefield = game.state.battlefield = game.state.battlefield || [];
    const tl = (card.type_line || '').toLowerCase();
    const isCreature = tl.includes('creature');
    const tappedAndAttacking = putFromHandData.tappedAndAttacking === true;
    
    const newPermanent = {
      id: uid("perm"),
      controller: pid,
      owner: pid,
      tapped: tappedAndAttacking,
      counters: {},
      basePower: isCreature ? parsePT(card.power) : undefined,
      baseToughness: isCreature ? parsePT(card.toughness) : undefined,
      // Creatures that enter "tapped and attacking" bypass summoning sickness for this attack
      summoningSickness: isCreature && !tappedAndAttacking,
      isAttacking: tappedAndAttacking,
      card: { ...card, zone: "battlefield" },
    } as any;
    
    battlefield.push(newPermanent);
    
    debug(2, `[Resolution] ${step.sourceName || 'Effect'}: Put ${card.name} onto battlefield${tappedAndAttacking ? ' tapped and attacking' : ''} for ${pid}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} puts ${card.name} onto the battlefield${tappedAndAttacking ? ' tapped and attacking' : ''}.`,
      ts: Date.now(),
    });
    
    // Trigger ETB effects
    try {
      triggerETBEffectsForPermanent(
        {
          state: game.state,
          bumpSeq: () => game.bumpSeq?.(),
          libraries: (game as any).libraries,
          commandZone: (game as any).commandZone || {},
        } as any,
        newPermanent,
        pid
      );
    } catch (err) {
      debugWarn(1, `[Resolution] Error triggering ETB effects:`, err);
    }
    
    // ========================================================================
    // CHECK FOR "AS ENTERS" CHOICES (Greymond, Avacyn's Stalwart, etc.)
    // Cards with "As ~ enters, choose..." need to have those choices made
    // even when put onto the battlefield by effects like Preeminent Captain
    // ========================================================================
    const oracleText = (card.oracle_text || '').toLowerCase();
    
    // Pattern: "As ~ enters, choose X abilities from among A, B, and C"
    // Example: Greymond - "As Greymond enters, choose two abilities from among first strike, vigilance, and lifelink."
    const fromAmongPattern = /as .+? enters(?:,| the battlefield,?)?\s*choose\s+(\w+)\s+(?:abilities?|options?)\s+from\s+among\s+([^.]+)/i;
    const fromAmongMatch = oracleText.match(fromAmongPattern);
    
    let queuedResolutionStep: any;

    if (fromAmongMatch) {
      const numWord = fromAmongMatch[1].toLowerCase();
      const numMap: Record<string, number> = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'a': 1, 'an': 1,
      };
      const choiceCount = numMap[numWord] || parseInt(numWord, 10) || 1;
      
      // Extract the list of options
      const itemList = fromAmongMatch[2];
      const parts = itemList.split(/,\s+(?:and\s+)?|(?:,\s+)?and\s+/);
      const options = parts.map(p => p.trim().replace(/^(a|an|the)\s+/i, '')).filter(p => p.length > 0);
      
      if (options.length >= choiceCount) {
        debug(2, `[Resolution] Detected "As enters" choice for ${card.name}: choose ${choiceCount} from ${options.join(', ')}`);
        
        // Add resolution step for the choice
        queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: pid,
          description: `Choose ${choiceCount} for ${card.name}: ${options.join(', ')}`,
          mandatory: true,
          sourceId: newPermanent.id,
          sourceName: card.name,
          options,
          minSelections: choiceCount,
          maxSelections: choiceCount,
          // Use permanentId for existing handler compatibility
          permanentId: newPermanent.id,
        } as any);
      }
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'putCardFromHandOntoBattlefield', {
        playerId: pid,
        cardId: String(card.id || selectedId || '').trim(),
        permanentId: String(newPermanent.id || '').trim(),
        tappedAndAttacking,
        card: { ...card },
      });
    } catch {
      // ignore persistence failures
    }

    if (queuedResolutionStep) {
      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId: pid,
        sourceId: String(newPermanent.id || '').trim(),
        queuedResolutionStep,
      });
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    return;
  }
  
  const keywordCounterChoiceData = (modalStep as any).keywordCounterChoiceData;
  if (keywordCounterChoiceData) {
    const targetPermanentId = String(keywordCounterChoiceData.targetPermanentId || '');
    const targetName = String(keywordCounterChoiceData.targetName || 'Permanent');
    const sourceName = String(keywordCounterChoiceData.sourceName || modalStep.sourceName || 'Ability');
    const keywordMap = new Map<string, string>();
    for (const keyword of Array.isArray(keywordCounterChoiceData.allowedKeywords)
      ? keywordCounterChoiceData.allowedKeywords
      : []) {
      const canonical = String(keyword).toLowerCase().trim();
      if (!canonical) continue;
      keywordMap.set(canonical.replace(/\s+/g, '_'), canonical);
    }

    let chosen: string | null = null;
    if (typeof selections === 'string') {
      chosen = selections;
    } else if (Array.isArray(selections) && selections.length > 0) {
      chosen = selections[0];
    }

    const chosenKey = String(chosen || '').toLowerCase().trim();
    const counterName = keywordMap.get(chosenKey);
    if (!chosen || chosen === 'decline' || !counterName) {
      debug(2, `[Resolution] Keyword counter choice: no valid choice`);
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      return;
    }

    const battlefield = game.state?.battlefield || [];
    const targetPerm = battlefield.find((p: any) => p.id === targetPermanentId);
    if (!targetPerm) {
      debug(2, `[Resolution] Keyword counter choice: target ${targetPermanentId} no longer on battlefield`);
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      return;
    }

    targetPerm.counters = targetPerm.counters || {};
    const extraCounters = keywordCounterChoiceData.extraCounters && typeof keywordCounterChoiceData.extraCounters === 'object'
      ? keywordCounterChoiceData.extraCounters
      : {};
    for (const [counterKey, counterValue] of Object.entries(extraCounters)) {
      const amount = Number(counterValue || 0);
      if (!counterKey || amount <= 0) continue;
      targetPerm.counters[counterKey] = (targetPerm.counters[counterKey] || 0) + amount;
    }
    targetPerm.counters[counterName] = (targetPerm.counters[counterName] || 0) + 1;

    targetPerm.grantedAbilities = targetPerm.grantedAbilities || [];
    if (!targetPerm.grantedAbilities.includes(counterName)) {
      targetPerm.grantedAbilities.push(counterName);
    }

    targetPerm.card = targetPerm.card || {};
    targetPerm.card.keywords = targetPerm.card.keywords || [];
    const keywordCapitalized = counterName
      .split(' ')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    if (!targetPerm.card.keywords.includes(keywordCapitalized)) {
      targetPerm.card.keywords.push(keywordCapitalized);
    }

    const extraCounterParts = Object.entries(extraCounters)
      .map(([counterKey, counterValue]) => {
        const amount = Number(counterValue || 0);
        if (!counterKey || amount <= 0) return null;
        return `${amount === 1 ? 'a' : amount} ${counterKey} counter${amount === 1 ? '' : 's'}`;
      })
      .filter(Boolean) as string[];

    debug(2, `[Resolution] Keyword counter choice: added ${counterName} to ${targetName} (${targetPermanentId})`);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${sourceName}: ${targetName} gets ${extraCounterParts.length > 0 ? `${extraCounterParts.join(' and ')} and ` : ''}a ${counterName} counter.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    return;
  }

  const triggerData = (modalStep as any).triggerData;
  if (triggerData && String(triggerData.triggerType || '') === 'etb_modal_choice') {
    const permanentId = String(triggerData.sourceId || modalStep.sourceId || modalStep.permanentId || '').trim();
    const battlefield = Array.isArray(game.state?.battlefield) ? (game.state.battlefield as any[]) : [];
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
    const stepOptions = Array.isArray((modalStep as any).options) ? ((modalStep as any).options as any[]) : [];
    const selectedOption = stepOptions.find((option: any) => String(option?.id || '').trim() === String(selectedId || '').trim());
    const selectedMode = selectedOption
      ? {
          id: String(selectedOption.id || selectedId || '').trim(),
          label: String(selectedOption.label || selectedOption.name || selectedOption.description || selectedId || '').trim(),
          description: String(selectedOption.description || selectedOption.label || selectedId || '').trim(),
        }
      : null;

    if (permanent && selectedMode) {
      permanent.selectedMode = { ...selectedMode };
      permanent.card = {
        ...(permanent.card || {}),
        selectedMode: { ...selectedMode },
      };

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'setPermanentSelectedMode', {
          permanentId,
          selectedMode: { ...selectedMode },
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(setPermanentSelectedMode) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} chose ${selectedMode.label} for ${String(modalStep.sourceName || 'this permanent')}.`,
        ts: Date.now(),
      });
    }

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }
    return;
  }
  
  // Generic modal choice handling (fallback for other modal choices)
  debug(2, `[Resolution] Generic modal choice: ${step.description}, selected: ${selectedId || 'none'}`);
  
  // Check if this is a trigger modal choice (e.g., SOLDIER Military Program)
  if (triggerData && triggerData.isSoldierProgram) {
    // Normalize selections to array of strings
    let choiceIds: string[] = [];
    if (typeof selections === 'string') {
      choiceIds = [selections];
    } else if (Array.isArray(selections)) {
      choiceIds = selections as string[];
    }
    
    await handleSoldierProgramChoice(io, game, gameId, pid, choiceIds, triggerData);
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    return;
  }

  if (triggerData && triggerData.modalTrigger) {
    let choiceIds: string[] = [];
    if (typeof selections === 'string') {
      choiceIds = [selections];
    } else if (Array.isArray(selections)) {
      choiceIds = selections.map((selection) => String(selection || '').trim()).filter(Boolean);
    }

    const stepOptions = Array.isArray((modalStep as any).options) ? ((modalStep as any).options as any[]) : [];
    const selectedEffectTexts = choiceIds
      .map((choiceId) => stepOptions.find((option: any) => String(option?.id || '').trim() === choiceId))
      .filter(Boolean)
      .map((option: any) => String(option?.description || option?.value || option?.label || '').trim())
      .filter(Boolean);

    if (selectedEffectTexts.length > 0) {
      const controllerId = String(triggerData.controllerId || pid || '').trim() || String(pid || '');
      const sourceName = String(triggerData.sourceName || modalStep.sourceName || 'Triggered ability').trim() || 'Triggered ability';
      const sourceId = String(triggerData.sourceId || triggerData.source || modalStep.sourceId || modalStep.source || '').trim();
      const triggerType = String(triggerData.triggerType || 'triggered_ability').trim() || 'triggered_ability';
      const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, modalStep as any, sourceId || undefined);
      const normalizedSourceId = String(sourceId || sourcePermanentSnapshot?.id || '').trim();
      const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
      const ctx = {
        state: game.state,
        gameId,
        bumpSeq: () => {
          if (typeof game.bumpSeq === 'function') {
            game.bumpSeq();
          }
        },
        libraries: (game as any).libraries,
        commandZone: (game as any).commandZone || {},
      } as any;

      const sourcePermanent = Array.isArray(game.state?.battlefield)
        ? (game.state.battlefield as any[]).find((permanent: any) => {
            if (normalizedSourceId && String(permanent?.id || '') === normalizedSourceId) {
              return true;
            }
            return String(permanent?.card?.name || permanent?.name || '').trim() === sourceName;
          })
        : undefined;

      for (const effectText of selectedEffectTexts) {
        const metadata = inferTriggeredAbilityTargetMetadata(effectText, {
          gameState: game.state,
          controllerId,
          sourceName,
          sourcePermanent: sourcePermanent || sourcePermanentSnapshot,
        });
        const syntheticTriggerId = uid('trigger');
        const syntheticTriggerItem = {
          id: syntheticTriggerId,
          type: 'triggered_ability',
          controller: controllerId,
          source: normalizedSourceId,
          sourceId: normalizedSourceId,
          sourceName,
          description: effectText,
          triggerType,
          mandatory: triggerData.mandatory !== false,
          effect: effectText,
          ...sourceContext,
          ...(metadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
          ...(metadata.targetType ? { targetType: metadata.targetType } : null),
          ...(metadata.targetConstraint ? { targetConstraint: metadata.targetConstraint } : null),
          ...(metadata.targetZone ? { targetZone: metadata.targetZone } : null),
          ...(metadata.targetDestination ? { targetDestination: metadata.targetDestination } : null),
          ...(metadata.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
          ...(metadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
          ...(metadata.battlefieldControllerMode ? { battlefieldControllerMode: metadata.battlefieldControllerMode } : null),
          ...(metadata.battlefieldCounters ? { battlefieldCounters: metadata.battlefieldCounters } : null),
          ...(metadata.targetAction ? { targetAction: metadata.targetAction } : null),
          ...(Array.isArray(metadata.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
          ...(Array.isArray((metadata as any).targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: (metadata as any).targetFilterRequiredTypeWords } : null),
          ...(Array.isArray(metadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
          ...(metadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
          ...(typeof (metadata as any).targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: (metadata as any).targetFilterExactManaValue } : null),
          ...(typeof (metadata as any).targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: (metadata as any).targetFilterMinManaValue } : null),
          ...(typeof metadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
          ...(typeof metadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: metadata.targetTotalPowerLimit } : null),
          ...(metadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
          ...(metadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
          ...(typeof metadata.minTargets === 'number' ? { minTargets: metadata.minTargets } : null),
          ...(typeof metadata.maxTargets === 'number' ? { maxTargets: metadata.maxTargets } : null),
        } as any;

        game.state.stack = game.state.stack || [];
        (game.state.stack as any[]).push(syntheticTriggerItem);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
            triggerId: syntheticTriggerId,
            sourceId: normalizedSourceId,
            permanentId: normalizedSourceId,
            sourceName,
            controllerId,
            description: effectText,
            triggerType,
            effect: effectText,
            mandatory: triggerData.mandatory !== false,
            ...sourceContext,
            ...(metadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
            ...(metadata.targetType ? { targetType: metadata.targetType } : null),
            ...(metadata.targetConstraint ? { targetConstraint: metadata.targetConstraint } : null),
            ...(metadata.targetZone ? { targetZone: metadata.targetZone } : null),
            ...(metadata.targetDestination ? { targetDestination: metadata.targetDestination } : null),
            ...(metadata.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
            ...(metadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
            ...(metadata.battlefieldControllerMode ? { battlefieldControllerMode: metadata.battlefieldControllerMode } : null),
            ...(metadata.battlefieldCounters ? { battlefieldCounters: metadata.battlefieldCounters } : null),
            ...(metadata.targetAction ? { targetAction: metadata.targetAction } : null),
            ...(Array.isArray(metadata.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
            ...(Array.isArray((metadata as any).targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: (metadata as any).targetFilterRequiredTypeWords } : null),
            ...(Array.isArray(metadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
            ...(metadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
            ...(typeof (metadata as any).targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: (metadata as any).targetFilterExactManaValue } : null),
            ...(typeof (metadata as any).targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: (metadata as any).targetFilterMinManaValue } : null),
            ...(typeof metadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
            ...(typeof metadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: metadata.targetTotalPowerLimit } : null),
            ...(metadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
            ...(metadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
            ...(typeof metadata.minTargets === 'number' ? { minTargets: metadata.minTargets } : null),
            ...(typeof metadata.maxTargets === 'number' ? { maxTargets: metadata.maxTargets } : null),
          });
        } catch (err) {
          debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility modal) failed:', err);
        }

        if (!persistAndResolveTopOfStack(game, gameId, {
          playerId: controllerId,
          sourceName,
          reason: 'modalTriggerChoice',
        })) {
          executeTriggerEffect(ctx as any, controllerId as PlayerID, sourceName, effectText, syntheticTriggerItem);
        }
      }

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      return;
    }
  }
  
  // For generic modal choices without specific data, just log and continue
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

export async function handleSoldierProgramChoice(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  choiceIds: string[],
  triggerData: any
): Promise<void> {
  if (choiceIds.length === 0) {
    debugWarn(1, '[Resolution] SOLDIER Military Program: No choice selected');
    return;
  }
  
  const { createToken } = await import("../state/modules/counters_tokens.js");
  
  const battlefield = game.state.battlefield || [];
  const actionMessages: string[] = [];
  const createdTokenEventPayloads: any[] = [];
  const counterTargetPayloads: any[] = [];
  let queuedResolutionStep: any;
  
  // Card text specifies "up to two Soldiers"
  const MAX_SOLDIERS_FOR_COUNTERS = 2;
  
  // Track if we need to add counters (may need player selection)
  let needsCounterPlacement = false;
  
  // Check what the player chose
  for (const choiceId of choiceIds) {
    if (choiceId === 'create_token' || choiceId === 'both') {
      // Create a 1/1 white Soldier creature token
      // SOLDIER Military Program says: "Create a 1/1 white Soldier creature token"
      const createdTokenIds = createToken(
        {
          state: game.state,
          bumpSeq: () => game.bumpSeq?.(),
          libraries: (game as any).libraries,
          commandZone: (game as any).commandZone || {},
        } as any,
        playerId,
        'Soldier', // token name
        1, // quantity
        1, // basePower
        1, // baseToughness
        {
          colors: ['W'], // White Soldier (not colorless like Myrel's)
          typeLine: 'Token Creature — Soldier',
          skipEventPersistence: true,
        }
      );

      for (const tokenId of Array.isArray(createdTokenIds) ? createdTokenIds : []) {
        const tokenPermanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(tokenId));
        if (!tokenPermanent) continue;
        createdTokenEventPayloads.push({
          effectType: 'createToken',
          controllerId: playerId,
          tokenData: {
            id: String(tokenPermanent.id || tokenId),
            name: String(tokenPermanent.card?.name || 'Soldier'),
            typeLine: String(tokenPermanent.card?.type_line || 'Token Creature — Soldier'),
            power: Number(tokenPermanent.basePower ?? tokenPermanent.card?.power ?? 1),
            toughness: Number(tokenPermanent.baseToughness ?? tokenPermanent.card?.toughness ?? 1),
            colors: Array.isArray(tokenPermanent.card?.colors) ? [...tokenPermanent.card.colors] : ['W'],
            abilities: Array.isArray(tokenPermanent.card?.keywords) ? [...tokenPermanent.card.keywords] : [],
            hasHaste: Array.isArray(tokenPermanent.card?.keywords)
              ? tokenPermanent.card.keywords.some((keyword: any) => String(keyword || '').toLowerCase() === 'haste')
              : false,
          },
        });
      }
      
      actionMessages.push('created a 1/1 white Soldier creature token');
      debug(2, `[Resolution] SOLDIER Military Program: Created white Soldier token for ${playerId}`);
    }
    
    if (choiceId === 'add_counters' || choiceId === 'both') {
      needsCounterPlacement = true;
    }
  }
  
  if (needsCounterPlacement) {
    // Get all Soldiers controlled by this player
    const soldiers = battlefield.filter((p: any) => {
      if (p.controller !== playerId) return false;
      return permanentHasCreatureTypeNow(p, 'soldier');
    });
    
    if (soldiers.length === 0) {
      // No soldiers to boost
      debug(2, `[Resolution] SOLDIER Military Program: No Soldiers to add counters to`);
    } else if (soldiers.length <= MAX_SOLDIERS_FOR_COUNTERS) {
      // Auto-apply counters to all soldiers if 2 or fewer (since it says "up to two")
      for (const soldier of soldiers) {
        soldier.counters = soldier.counters || {};
        soldier.counters['+1/+1'] = (soldier.counters['+1/+1'] || 0) + 1;
        counterTargetPayloads.push({
          playerId,
          sourceName: 'SOLDIER Military Program',
          targetId: String(soldier.id || ''),
          targetName: String(soldier.card?.name || 'Soldier'),
          counterType: '+1/+1',
        });
        debug(2, `[Resolution] SOLDIER Military Program: Added +1/+1 counter to ${soldier.card?.name || soldier.id}`);
      }
      actionMessages.push(`put a +1/+1 counter on ${soldiers.length} Soldier${soldiers.length > 1 ? 's' : ''}`);
    } else {
      // More than 2 soldiers - player needs to select which ones
      debug(2, `[Resolution] SOLDIER Military Program: ${soldiers.length} Soldiers available, prompting player to select up to ${MAX_SOLDIERS_FOR_COUNTERS}`);
      
      // Create a target selection step for selecting up to 2 Soldiers
      queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: playerId,
        description: `SOLDIER Military Program: Choose up to ${MAX_SOLDIERS_FOR_COUNTERS} Soldiers to get +1/+1 counters`,
        mandatory: false, // "up to" means optional
        sourceName: 'SOLDIER Military Program',
        sourceImage: triggerData?.sourceImage,
        validTargets: soldiers.map((s: any) => ({
          id: s.id,
          name: s.card?.name || 'Soldier',
          type: 'permanent',
          controller: s.controller,
          imageUrl: s.card?.image_uris?.small || s.card?.image_uris?.normal,
          power: s.basePower || s.card?.power,
          toughness: s.baseToughness || s.card?.toughness,
        })),
        targetTypes: ['creature'],
        minTargets: 0,
        maxTargets: MAX_SOLDIERS_FOR_COUNTERS,
        targetDescription: `Soldier creatures you control`,
        // Store data for the response handler
        soldierProgramCounters: true,
      } as any);
      
      // Don't add to actionMessages yet - that will happen after selection
    }
  }

  for (const payload of createdTokenEventPayloads) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'executeEffect', payload);
    } catch (e) {
      debugWarn(1, '[Resolution] appendEvent(executeEffect/createToken) failed for SOLDIER Military Program:', e);
    }
  }

  for (const payload of counterTargetPayloads) {
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'counterTargetChosen', payload);
    } catch (e) {
      debugWarn(1, '[Resolution] appendEvent(counterTargetChosen) failed for SOLDIER Military Program:', e);
    }
  }

  if (queuedResolutionStep) {
    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId,
      sourceId: String(triggerData?.sourceId || '').trim(),
      queuedResolutionStep,
    });
  }
  
  if (actionMessages.length > 0) {
    const message = `${getPlayerName(game, playerId)} ${actionMessages.join(' and ')}.`;
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: message,
      ts: Date.now(),
    });
  }
}
