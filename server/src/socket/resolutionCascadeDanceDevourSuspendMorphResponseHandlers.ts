/**
 * socket/resolutionCascadeDanceDevourSuspendMorphResponseHandlers.ts
 *
 * CASCADE / LIFE_REDISTRIBUTION / PRISONERS_DILEMMA_CHOICE /
 * DANCE_WITH_CALAMITY(+cast) / DEVOUR_SELECTION / SUSPEND_CAST /
 * MORPH_TURN_FACE_UP response handlers.
 * Extracted from resolution.ts; wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import type { GameContext } from "../state/context.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../state/modules/oracleIrDeferredStackFinalize.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
  syncAllOracleIRPlayerZonesAfterResolution,
} from "../state/modules/oracleIrServerZoneSync.js";
import {
  applyPrisonersDilemmaBatchResult,
  clearPrisonersDilemmaChoiceBatch,
  recordPrisonersDilemmaChoice,
} from "../state/modules/spellLegacyChoiceBatchUtils.js";
import { processFaceUpTriggers } from "../state/modules/triggerEmissionFamilyUtils.js";
import { sacrificePermanent } from "../state/modules/upkeep-triggers.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { parsePT } from "../state/utils.js";
import { debug, debugWarn } from "../utils/debug.js";
import {
  cloneCascadeLibrary,
  cloneCascadeZoneCard,
  cloneExileStateForEvent,
} from "./resolutionCloneQueuedPromptUtils.js";
import { appendKeywordPromptResolveEvent } from "./resolutionKeywordChoiceHandlers.js";
import {
  processPendingCascades,
  processPendingDanceWithCalamity,
} from "./resolutionProcessPendingHandlers.js";
import { appendGameEvent, getPlayerName } from "./util.js";

export async function handleCascadeResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  // selections can be true (legacy), 'cast', or 'decline'
  const cast = response.selections === true || 
    (typeof response.selections === 'string' && response.selections === 'cast');
  
  const cascadeStep = step as any;
  const effectId = cascadeStep.effectId;
  const pendingCascade = ((game.state as any).pendingCascade || {}) as Record<string, any[]>;
  const playerQueue = Array.isArray(pendingCascade[pid]) ? pendingCascade[pid] : [];
  const queueIndex = playerQueue.findIndex((entry: any) => String(entry?.effectId || '') === String(effectId || ''));
  const entry = queueIndex >= 0 ? playerQueue[queueIndex] : undefined;
  const hitCard = entry?.hitCard || cascadeStep.hitCard;
  const exiledCards = Array.isArray(entry?.exiledCards) ? entry.exiledCards : (cascadeStep.exiledCards || []);
  
  debug(2, `[Resolution] Cascade response: player=${pid}, cast=${cast}, effectId=${effectId}`);
  
  // Get library and zones
  const lib = (game as any).libraries?.get(pid) || [];
  const zones = game.state.zones = game.state.zones || {};
  const z = zones[pid] = zones[pid] || { 
    hand: [], 
    handCount: 0, 
    libraryCount: lib.length, 
    graveyard: [], 
    graveyardCount: 0 
  };
  
  // Bottom the exiled cards (excluding hit card if casting)
  const randomized = [...exiledCards];
  for (let i = randomized.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [randomized[i], randomized[j]] = [randomized[j], randomized[i]];
  }

  const remainingLibrary = cloneCascadeLibrary(lib);
  const bottomCards = randomized
    .filter((card) => !(cast && hitCard && card?.id === hitCard.id))
    .map((card) => cloneCascadeZoneCard(card, 'library'));

  appendGameEvent(game, gameId, 'cascadeResolve', {
    playerId: pid,
    effectId,
    sourceCardId: entry?.sourceCardId || cascadeStep.sourceId,
    sourceName: entry?.sourceName || cascadeStep.sourceName || 'Cascade',
    cascadeNumber: entry?.instance || cascadeStep.cascadeNumber || 1,
    totalCascades: cascadeStep.totalCascades || 1,
    cast,
    hitCard: hitCard ? { ...hitCard } : null,
    exiledCards: exiledCards.map((card: any) => ({ ...card })),
    remainingLibraryIds: remainingLibrary.map((card: any) => String(card?.id || '')).filter(Boolean),
    bottomCardIds: bottomCards.map((card: any) => String(card?.id || '')).filter(Boolean),
  });
  
  // Cast the hit card if chosen
  if (cast && hitCard) {
    appendGameEvent(game, gameId, 'castSpell', {
      playerId: pid,
      cardId: hitCard.id,
      card: { ...hitCard },
      cascade: true,
      fromZone: 'exile',
      castWithoutPayingManaCost: true,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} casts ${hitCard.name} via Cascade.`,
      ts: Date.now(),
    });
  } else if (hitCard) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} declines to cast ${hitCard.name} via Cascade.`,
      ts: Date.now(),
    });
  }

  await processPendingCascades(io, game, gameId);
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

export function handleLifeRedistributionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  const lifeByPlayerId = selections?.lifeByPlayerId ?? selections ?? {};
  const redistributionStep = step as any;
  const redistributionId = redistributionStep.redistributionId;

  debug(2, `[Resolution] Life redistribution response: player=${pid}, participants=${Object.keys(lifeByPlayerId || {}).length}`);

  const ctx = ((game as any).ctx || game) as any;
  ctx.gameId = gameId;
  ctx.state = game.state;

  const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
  if (resumed) {
    maybeResumeOracleIRStepsAfterResolution(ctx, step);
    syncAllOracleIRPlayerZonesAfterResolution(ctx);
  }

  const changes: string[] = [];
  for (const [playerId, lifeRaw] of Object.entries(lifeByPlayerId || {})) {
    const life = Math.max(0, Math.floor(Number(lifeRaw) || 0));
    changes.push(`${getPlayerName(game, String(playerId))} → ${life}`);
  }

  let message = `${getPlayerName(game, pid)} redistributes life totals`;
  if (changes.length > 0) {
    message += `: ${changes.join(', ')}`;
  } else {
    message += ' (no players selected)';
  }

  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });

  try {
    appendEvent(gameId, game.seq ?? 0, "lifeRedistributionResolve", {
      playerId: pid,
      resolvedStepId: String((step as any).id || ''),
      redistributionId,
      lifeByPlayerId,
    });
  } catch {
    // Ignore persistence failures
  }

  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
}

export async function handlePrisonersDilemmaChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = String(response.playerId || '').trim();
  const stepAny = step as any;
  const rawSelection: any = response.selections as any;
  const selectedChoice = String(
    typeof rawSelection === 'string'
      ? rawSelection
      : Array.isArray(rawSelection)
        ? rawSelection[0]
        : rawSelection && typeof rawSelection === 'object'
          ? rawSelection.choice || rawSelection.id || rawSelection.value
          : '',
  ).trim().toLowerCase();

  if (!pid || !['silence', 'snitch'].includes(selectedChoice)) {
    debugWarn(1, `[Resolution] Invalid Prisoner's Dilemma choice: player=${pid} choice=${selectedChoice}`);
    return;
  }

  const batchId = String(stepAny?.prisonersDilemmaBatchId || `${String(stepAny?.prisonersDilemmaSourceId || step.sourceId || '').trim()}:prisoners_dilemma`).trim();
  const sourceId = String(stepAny?.prisonersDilemmaSourceId || step.sourceId || '').trim() || undefined;
  const sourceName = String(stepAny?.prisonersDilemmaSourceName || step.sourceName || "Prisoner's Dilemma").trim() || "Prisoner's Dilemma";
  const controllerId = String(stepAny?.prisonersDilemmaController || '').trim() || undefined;
  const expectedPlayerIds = Array.isArray(stepAny?.prisonersDilemmaExpectedPlayerIds)
    ? stepAny.prisonersDilemmaExpectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];
  const batch = recordPrisonersDilemmaChoice(game.state, batchId, {
    playerId: pid,
    choice: selectedChoice,
    controller: controllerId,
    sourceId,
    sourceName,
    expectedPlayerIds,
  });

  try {
    await appendEvent(gameId, Number((game as any)?.seq?.value ?? (game as any)?.seq ?? 0), 'prisonersDilemmaChoiceResolve', {
      playerId: pid,
      batchId,
      resolvedStepId: String(step.id || '').trim(),
      sourceId,
      sourceName,
      choice: selectedChoice,
      expectedPlayerIds,
    });
  } catch (err) {
    debugWarn(1, "[Resolution] Failed to persist prisonersDilemmaChoiceResolve event:", err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} makes a secret choice for ${sourceName}.`,
    ts: Date.now(),
  });

  const batchChoices = batch?.choices && typeof batch.choices === 'object' && !Array.isArray(batch.choices)
    ? batch.choices
    : {};
  const finalExpectedPlayerIds = expectedPlayerIds.length > 0
    ? expectedPlayerIds
    : Array.isArray(batch?.expectedPlayerIds)
      ? batch.expectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];
  const batchComplete = finalExpectedPlayerIds.length > 0
    ? finalExpectedPlayerIds.every((playerId: string) => ['silence', 'snitch'].includes(String(batchChoices[playerId] || '').trim().toLowerCase()))
    : Object.keys(batchChoices).length > 0;

  if (batchComplete) {
    const finalChoices = Object.fromEntries(
      finalExpectedPlayerIds
        .map((playerId: string) => [playerId, String(batchChoices[playerId] || '').trim().toLowerCase()])
        .filter(([, choice]) => choice === 'silence' || choice === 'snitch'),
    ) as Record<string, string>;
    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as unknown as GameContext;
    const result = applyPrisonersDilemmaBatchResult(ctx, {
      expectedPlayerIds: finalExpectedPlayerIds,
      choices: finalChoices,
    });
    clearPrisonersDilemmaChoiceBatch(game.state, batchId);

    try {
      await appendEvent(gameId, Number((game as any)?.seq?.value ?? (game as any)?.seq ?? 0), 'prisonersDilemmaBatchResolve', {
        batchId,
        sourceId,
        sourceName,
        expectedPlayerIds: finalExpectedPlayerIds,
        choices: finalChoices,
        damageByPlayerId: result.damageByPlayerId,
      });
    } catch (err) {
      debugWarn(1, "[Resolution] Failed to persist prisonersDilemmaBatchResolve event:", err);
    }

    const choiceSummary = finalExpectedPlayerIds
      .map((playerId: string) => `${getPlayerName(game, playerId)}: ${finalChoices[playerId]}`)
      .join(', ');
    const damageSummary = Object.entries(result.damageByPlayerId)
      .map(([playerId, damageAmount]) => `${damageAmount} to ${getPlayerName(game, playerId)}`)
      .join(', ');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: damageSummary
        ? `${sourceName} choices are revealed (${choiceSummary}) and deals ${damageSummary}.`
        : `${sourceName} choices are revealed (${choiceSummary}) and deals no damage.`,
      ts: Date.now(),
    });
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

export function handleDanceWithCalamityResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const danceStep = step as any;
  const pendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[pid] || {};
  const action = String((response.selections as any)?.action || 'stop');
  const sourceName = String(pendingEntry?.sourceName || danceStep.sourceName || 'Dance with Calamity');
  const sourceImage = pendingEntry?.sourceImage || danceStep.sourceImage;
  const effectId = String(pendingEntry?.effectId || danceStep.effectId || danceStep.sourceId || '');
  const exiledCards = Array.isArray(pendingEntry?.exiledCards)
    ? pendingEntry.exiledCards.map((card: any) => ({ ...card, zone: 'exile' }))
    : [];
  const totalManaValueBefore = Number(pendingEntry?.totalManaValue || danceStep.totalManaValue || 0);
  const library = Array.isArray((game as any).libraries?.get(pid))
    ? ((game as any).libraries.get(pid) as any[])
    : [];

  if (action === 'continue') {
    const nextCard = library[0];
    if (!nextCard) {
      appendGameEvent(game, gameId, 'danceWithCalamityResolve', {
        playerId: pid,
        effectId,
        sourceName,
        sourceImage,
        outcome: 'no_more_cards',
        totalManaValue: totalManaValueBefore,
        exiledCards: cloneExileStateForEvent(exiledCards),
        remainingLibraryIds: library.map((card: any) => String(card?.id || '')).filter(Boolean),
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} finishes ${sourceName} because their library is empty.`,
        ts: Date.now(),
      });
      return;
    }

    const nextExiledCards = [...exiledCards, { ...nextCard, zone: 'exile' }];
    const nextLibrary = library.slice(1).map((card: any) => ({ ...card, zone: 'library' }));
    const totalManaValue = totalManaValueBefore + Math.max(0, Number(nextCard?.cmc || 0) || 0);

    if (totalManaValue > 13) {
      appendGameEvent(game, gameId, 'danceWithCalamityResolve', {
        playerId: pid,
        effectId,
        sourceName,
        sourceImage,
        outcome: 'bust',
        totalManaValue,
        exiledCards: cloneExileStateForEvent(nextExiledCards),
        remainingLibraryIds: nextLibrary.map((card: any) => String(card?.id || '')).filter(Boolean),
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} exiles ${nextCard.name} with ${sourceName}, pushing the total mana value to ${totalManaValue}. The cards remain in exile and can't be cast.`,
        ts: Date.now(),
      });
      return;
    }

    appendGameEvent(game, gameId, 'danceWithCalamityContinue', {
      playerId: pid,
      effectId,
      sourceName,
      sourceImage,
      totalManaValue,
      exiledCards: cloneExileStateForEvent(nextExiledCards),
      remainingLibraryIds: nextLibrary.map((card: any) => String(card?.id || '')).filter(Boolean),
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} exiles ${nextCard.name} with ${sourceName}. Total mana value: ${totalManaValue}.`,
      ts: Date.now(),
    });

    processPendingDanceWithCalamity(io, game, gameId);
    return;
  }

  const spellCardIds = exiledCards
    .filter((card: any) => !String(card?.type_line || '').toLowerCase().includes('land'))
    .map((card: any) => String(card?.id || ''))
    .filter(Boolean);

  if (spellCardIds.length === 0) {
    appendGameEvent(game, gameId, 'danceWithCalamityResolve', {
      playerId: pid,
      effectId,
      sourceName,
      sourceImage,
      outcome: exiledCards.length > 0 ? 'no_spells' : 'no_exiles',
      totalManaValue: totalManaValueBefore,
      exiledCards: cloneExileStateForEvent(exiledCards),
      remainingLibraryIds: library.map((card: any) => String(card?.id || '')).filter(Boolean),
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} stops with ${sourceName}, but there are no exiled spells to cast.`,
      ts: Date.now(),
    });
    return;
  }

  appendGameEvent(game, gameId, 'danceWithCalamityBeginCasting', {
    playerId: pid,
    effectId,
    sourceName,
    sourceImage,
    totalManaValue: totalManaValueBefore,
    spellCardIds,
  });

  processPendingDanceWithCalamity(io, game, gameId);
}

export function handleDanceWithCalamityCastSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const castStep = step as any;
  const pendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[pid] || {};
  const effectId = String(pendingEntry?.effectId || castStep.effectId || castStep.sourceId || '');
  const sourceName = String(pendingEntry?.sourceName || castStep.sourceName || 'Dance with Calamity');
  const sourceImage = pendingEntry?.sourceImage || castStep.sourceImage;
  const totalManaValue = Number(pendingEntry?.totalManaValue || castStep.totalManaValue || 0);
  const validSpellIds = new Set(
    (Array.isArray(pendingEntry?.spellCardIds) ? pendingEntry.spellCardIds : (castStep.spellCards || []).map((card: any) => card?.id))
      .map((value: any) => String(value || ''))
      .filter(Boolean)
  );
  const rawOrderedSpellIds = Array.isArray((response.selections as any)?.orderedSpellIds)
    ? (response.selections as any).orderedSpellIds
    : [];
  const seen = new Set<string>();
  const orderedSpellIds = rawOrderedSpellIds
    .map((value: any) => String(value || ''))
    .filter((id: string) => validSpellIds.has(id) && !seen.has(id) && (seen.add(id), true));

  if (orderedSpellIds.length === 0) {
    appendGameEvent(game, gameId, 'danceWithCalamityResolve', {
      playerId: pid,
      effectId,
      sourceName,
      sourceImage,
      outcome: 'no_casts',
      totalManaValue,
      exiledCards: cloneExileStateForEvent(Array.isArray(pendingEntry?.exiledCards) ? pendingEntry.exiledCards : []),
      remainingLibraryIds: (Array.isArray((game as any).libraries?.get(pid)) ? (game as any).libraries.get(pid) : [])
        .map((card: any) => String(card?.id || ''))
        .filter(Boolean),
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} chooses not to cast any exiled spells with ${sourceName}.`,
      ts: Date.now(),
    });
    return;
  }

  appendGameEvent(game, gameId, 'danceWithCalamitySetCastOrder', {
    playerId: pid,
    effectId,
    sourceName,
    sourceImage,
    totalManaValue,
    orderedSpellIds,
  });

  processPendingDanceWithCalamity(io, game, gameId);
}

export function handleDevourSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as string[]; // Array of creature IDs to sacrifice
  
  const devourStep = step as any;
  const devourValue = devourStep.devourValue || 0;
  const creatureId = devourStep.creatureId;
  const availableCreatures = devourStep.availableCreatures || [];
  const selectedIds = Array.isArray(selections) ? selections : [];
  appendKeywordPromptResolveEvent(gameId, game, step, response, {
    keyword: 'devour',
    creatureId,
    devourValue,
    selectedIds,
  });
  
  debug(2, `[Resolution] Devour selection: player=${pid}, devour=${devourValue}, selected ${Array.isArray(selections) ? selections.length : 0} creatures`);
  
  // Validate selections if any
  const availableIds = new Set(availableCreatures.map((c: any) => c.permanentId));
  for (const creatureIdToSac of selectedIds) {
    if (!availableIds.has(creatureIdToSac)) {
      debugWarn(1, `[Resolution] Invalid devour selection: ${creatureIdToSac} not in available creatures`);
      return;
    }
  }
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  
  // Find the devouring creature
  const devouringCreature = battlefield.find((p: any) => p.id === creatureId);
  if (!devouringCreature) {
    debugWarn(1, `[Resolution] Devour: creature ${creatureId} not found on battlefield`);
    return;
  }
  
  // Sacrifice selected creatures
  for (const creatureIdToSac of selectedIds) {
    const idx = battlefield.findIndex((p: any) => p.id === creatureIdToSac);
    if (idx !== -1) {
      const sacrificed = battlefield[idx];
      const sacCard = (sacrificed as any).card;
      sacrificePermanent(game as any, String(creatureIdToSac), pid);
      debug(2, `[Resolution] Devour: Sacrificed ${sacCard?.name || 'creature'}`);
    }
  }
  
  // Add +1/+1 counters to the devouring creature
  const countersToAdd = devourValue * selectedIds.length;
  if (countersToAdd > 0) {
    devouringCreature.counters = devouringCreature.counters || {};
    devouringCreature.counters['+1/+1'] = (devouringCreature.counters['+1/+1'] || 0) + countersToAdd;
    debug(2, `[Resolution] Devour: Added ${countersToAdd} +1/+1 counters to ${devourStep.creatureName}`);
  }
  
  // Send chat message
  const counterText = countersToAdd > 0 ? `, gaining ${countersToAdd} +1/+1 counter${countersToAdd > 1 ? 's' : ''}` : '';
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} sacrificed ${selectedIds.length} creature${selectedIds.length !== 1 ? 's' : ''} to ${devourStep.creatureName}${counterText}.`,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

export async function handleSuspendCastResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const suspendStep = step as any;
  const card = suspendStep.card;
  const timeCounters = suspendStep.timeCounters || 0;

  if (response.cancelled) {
    debug(2, `[Resolution] Suspend cast cancelled: player=${pid}, card=${String(card?.name || '')}`);
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'suspendCard', {
        playerId: pid,
        resolvedStepId: String((step as any).id || '').trim(),
        cardId: card?.id,
        cardName: card?.name,
        cancelled: true,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(suspendCard cancelled) failed:', err);
    }
    return;
  }

  if (!card || !card.id) {
    debugWarn(1, `[Resolution] Suspend cast: missing card data`);
    return;
  }
  
  debug(2, `[Resolution] Suspend cast: player=${pid}, card=${card.name}, timeCounters=${timeCounters}`);
  
  // Remove card from hand
  const state = game.state || {};
  const zones = state.zones = state.zones || {};
  const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, exile: [], exileCount: 0 };
  
  const handIdx = (z.hand || []).findIndex((c: any) => c.id === card.id);
  if (handIdx !== -1) {
    z.hand.splice(handIdx, 1);
    z.handCount = z.hand.length;
  }
  
  // Exile the card with time counters
  z.exile = z.exile || [];
  const suspendedCard = {
    ...card,
    zone: 'exile',
    isSuspended: true,
    timeCounters: timeCounters,
    suspendedBy: pid,
  };
  z.exile.push(suspendedCard);
  z.exileCount = z.exile.length;

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'suspendCard', {
      playerId: pid,
      resolvedStepId: String((step as any).id || '').trim(),
      cardId: card.id,
      cardName: card.name,
      card: suspendedCard,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(suspendCard) failed:', err);
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} suspended ${card.name} with ${timeCounters} time counter${timeCounters !== 1 ? 's' : ''}.`,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Morph Turn Face-Up response
 * Player turns a face-down creature face-up
 */
export function handleMorphTurnFaceUpResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const morphStep = step as any;
  const permanentId = morphStep.permanentId;
  const actualCard = morphStep.actualCard;
  
  if (response.cancelled) {
    debug(2, `[Resolution] Morph turn face-up cancelled for ${permanentId}`);
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'morphTurnFaceUp', {
        playerId: pid,
        resolvedStepId: String((step as any).id || '').trim(),
        permanentId,
        cancelled: true,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(morphTurnFaceUp cancelled) failed:', err);
    }
    return;
  }
  
  debug(2, `[Resolution] Morph turn face-up: player=${pid}, permanent=${permanentId}`);
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  
  // Find the face-down creature
  const creature = battlefield.find((p: any) => p.id === permanentId);
  if (!creature) {
    debugWarn(1, `[Resolution] Morph: creature ${permanentId} not found on battlefield`);
    return;
  }
  
  if (!creature.isFaceDown) {
    debugWarn(1, `[Resolution] Morph: creature ${permanentId} is not face-down`);
    return;
  }
  
  // Turn face-up
  creature.isFaceDown = false;
  creature.card = { ...actualCard, zone: 'battlefield' };
  
  // Update power/toughness from 2/2 to actual values
  const tl = (actualCard.type_line || '').toLowerCase();
  const isCreature = tl.includes('creature');
  if (isCreature) {
    creature.basePower = parsePT((actualCard as any).power);
    creature.baseToughness = parsePT((actualCard as any).toughness);
  }
  
  // Remove face-down specific properties
  delete creature.faceDownType;
  delete creature.morphCost;
  delete creature.faceUpCard;
  delete creature.canTurnFaceUp;

  // Megamorph: putting a +1/+1 counter on the permanent is part of turning it face up.
  const faceUpOracle = String(actualCard?.oracle_text || '').toLowerCase();
  if (/\bmegamorph\b/.test(faceUpOracle)) {
    const counters = creature.counters = creature.counters || {};
    counters['+1/+1'] = (Number(counters['+1/+1']) || 0) + 1;
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'morphTurnFaceUp', {
      playerId: pid,
      resolvedStepId: String((step as any).id || '').trim(),
      permanentId,
      actualCard: { ...actualCard, zone: 'battlefield' },
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(morphTurnFaceUp) failed:', err);
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} turned ${actualCard.name} face-up.`,
    ts: Date.now(),
  });
  
  try {
    const ctx = ((game as any).ctx || game) as GameContext;
    processFaceUpTriggers(ctx, creature);
  } catch (err) {
    debugWarn(1, '[Resolution] processFaceUpTriggers failed:', err);
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

