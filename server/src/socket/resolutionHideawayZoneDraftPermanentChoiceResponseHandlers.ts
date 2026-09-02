/**
 * socket/resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.ts
 *
 * RETURN_CONTROLLED_PERMANENT_CHOICE / HIDEAWAY_CHOICE / REPEATED_ZONE_DRAFT
 * response handlers. Split from resolutionJoinForcesTemptingZoneChoiceResponseHandlers.ts
 * (kept as a thin re-export barrel). Wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { removePermanent } from "../state/modules/counters_tokens.js";
import { storeHideawayExiledCard } from "../state/modules/hideawayExile.js";
import { maybeResumeOracleIRStepsAfterResolution } from "../state/modules/oracleIrServerZoneSync.js";
import { movePermanentToHand } from "../state/modules/zones.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { parsePT, uid } from "../state/utils.js";
import { debug, debugWarn } from "../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "./resolutionCloneQueuedPromptUtils.js";
import { broadcastGame, getPlayerName } from "./util.js";
import {
  buildRepeatedZoneDraftCardChoiceInfo,
  filterLegalRepeatedZoneDraftCardIds,
  findExiledDraftCard,
  findNextRepeatedZoneDraftChooserIndex,
  isRepeatedZoneDraftPickLegal,
  repeatedZoneDraftNeedsExplicitAttachId,
  resolveRepeatedZoneDraftAuraAttachId,
} from "../../../rules-engine/src/oracleIRExecutorRepeatedZoneDraft.js";
import { recordDeferredChaosEtbPermanentId } from "../state/modules/oracleIrChaosResolutionTriggerHold.js";

/**
 * Handle Return Controlled Permanent Choice response.
 * The current primary caller is a bounce-land ETB trigger, but the handler is generic.
 */
export function handleReturnControlledPermanentChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract selected permanent ID from selection
  let returnPermanentId = '';
  if (typeof selection === 'string') {
    returnPermanentId = selection;
  } else if (Array.isArray(selection) && selection.length > 0) {
    returnPermanentId = selection[0];
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    returnPermanentId = (selection as any).permanentId || (selection as any).returnPermanentId || '';
  }
  
  if (!returnPermanentId) {
    debugWarn(1, `[Resolution] Return-controlled-permanent choice: no permanent selected by ${pid}`);
    return;
  }
  
  const stepData = step as any;
  const sourceName = stepData.returnControlledPermanentSourceName || stepData.sourceName || 'Return Controlled Permanent';
  const destination = String(stepData.returnControlledPermanentDestination || 'hand').toLowerCase();
  const stackItemId = stepData.stackItemId;
  const optionsToChoose = stepData.returnControlledPermanentOptions || [];
  
  debug(2, `[Resolution] Return-controlled-permanent choice: player=${pid} returns ${returnPermanentId}`);
  
  // Validate that the selected permanent is in the list of valid choices.
  const validPermanentIds = new Set(optionsToChoose.map((option: any) => option.permanentId));
  if (!validPermanentIds.has(returnPermanentId)) {
    debugWarn(1, `[Resolution] Invalid return-controlled-permanent choice: ${returnPermanentId} not in valid options`);
    return;
  }
  
  // Ensure game state and battlefield exist
  game.state = (game.state || {}) as any;
  game.state.battlefield = game.state.battlefield || [];
  
  const battlefield = game.state.battlefield;
  
  // Find the permanent to return.
  const permanentToReturn = battlefield.find((p: any) => 
    p.id === returnPermanentId && p.controller === pid
  );
  
  if (!permanentToReturn) {
    debugWarn(1, `[Resolution] Permanent to return not found: ${returnPermanentId}`);
    return;
  }
  
  const returnedPermanentName = (permanentToReturn as any).card?.name || 'Permanent';
  
  if (destination === 'hand') {
    movePermanentToHand(game as any, returnPermanentId);
  } else {
    removePermanent(game as any, returnPermanentId);
  }
  
  // If this was triggered from the stack, remove the stack item
  if (stackItemId) {
    const stack = (game.state as any).stack || [];
    const stackIndex = stack.findIndex((item: any) => item.id === stackItemId);
    if (stackIndex !== -1) {
      stack.splice(stackIndex, 1);
      debug(2, `[Resolution] Removed bounce land trigger from stack (id: ${stackItemId})`);
    }
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'bounceLandChoice', {
      playerId: pid,
      resolvedStepId: String((step as any).id || '').trim(),
      returnedLandId: returnPermanentId,
      returnPermanentId,
      destination,
      stackItemId: stackItemId ? String(stackItemId) : undefined,
      sourceName,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(bounceLandChoice) failed:', err);
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)}'s ${sourceName} returns ${returnedPermanentName} to ${destination}.`,
    ts: Date.now(),
  });
  
  // NOTE: Priority restoration is handled automatically by the ResolutionQueue system
  // via the priority management handler (initializePriorityResolutionHandler).
  // When the last resolution step completes, exitResolutionMode() is called automatically.
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
}

export function handleHideawayChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selection = response.selections as any;

  let selectedCardId = '';
  if (typeof selection === 'string') {
    selectedCardId = selection;
  } else if (Array.isArray(selection) && selection.length > 0) {
    selectedCardId = String(selection[0] || '');
  } else if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
    selectedCardId = String(selection.cardId || selection.selectedCardId || selection.id || '');
  }

  selectedCardId = String(selectedCardId || '').trim();
  if (!selectedCardId) {
    debugWarn(1, `[Resolution] Hideaway choice: no card selected by ${pid}`);
    return;
  }

  const stepData = step as any;
  const permanentId = String(stepData.permanentId || stepData.sourceId || '').trim();
  const sourceName = String(stepData.sourceName || 'Hideaway');
  const stackItemId = String(stepData.stackItemId || '').trim();
  const hideawayCards = Array.isArray(stepData.hideawayCards) ? stepData.hideawayCards : [];
  const validIds = new Set(
    hideawayCards
      .map((card: any) => String(card?.cardId || card?.id || '').trim())
      .filter(Boolean),
  );

  if (!validIds.has(selectedCardId)) {
    debugWarn(1, `[Resolution] Invalid hideaway choice: ${selectedCardId} not in valid options`);
    return;
  }

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
  if (!permanent) {
    debugWarn(1, `[Resolution] Hideaway source permanent not found: ${permanentId}`);
    return;
  }

  const library = Array.isArray((game as any).libraries?.get?.(pid))
    ? ((game as any).libraries.get(pid) as any[])
    : [];
  const lookedAtCount = Math.min(hideawayCards.length, library.length);
  const topCards = library.slice(0, lookedAtCount);
  const selectedCard = topCards.find((card: any) => String(card?.id || '') === selectedCardId);

  if (!selectedCard) {
    debugWarn(1, `[Resolution] Hideaway selected card not found in library top cards: ${selectedCardId}`);
    return;
  }

  const remainingCards = topCards.filter((card: any) => String(card?.id || '') !== selectedCardId);
  for (let i = remainingCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remainingCards[i], remainingCards[j]] = [remainingCards[j], remainingCards[i]];
  }

  library.splice(0, lookedAtCount);
  library.push(...remainingCards.map((card: any) => ({ ...card, zone: 'library' })));

  if ((game as any).libraries?.set) {
    (game as any).libraries.set(pid, library);
  }

  game.state = (game.state || {}) as any;
  game.state.zones = game.state.zones || {};
  const zones = game.state.zones;
  const zoneState = (zones[pid] = zones[pid] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    library: [],
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
  zoneState.library = Array.isArray(library) ? library.map((card: any) => ({ ...card, zone: 'library' })) : zoneState.library;
  zoneState.libraryCount = Array.isArray(library) ? library.length : zoneState.libraryCount;

  storeHideawayExiledCard({
    state: game.state,
    playerId: pid,
    permanent,
    selectedCard,
    sourceName,
  });

  if (stackItemId) {
    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    const stackIndex = game.state.stack.findIndex((item: any) => String(item?.id || '') === stackItemId);
    if (stackIndex !== -1) {
      game.state.stack.splice(stackIndex, 1);
    }
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'hideawayChoice', {
      playerId: pid,
      resolvedStepId: String((step as any).id || '').trim(),
      permanentId,
      selectedCardId,
      lookedAtCardIds: topCards.map((card: any) => String(card?.id || '')),
      bottomOrderIds: remainingCards.map((card: any) => String(card?.id || '')),
      stackItemId: stackItemId || undefined,
      sourceName,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(hideawayChoice) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} hides away a card face down with ${sourceName}.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  broadcastGame(io, game, gameId);
}

/**
 * Handle one pick in a repeated rotating zone draft (Thieves' Auction style).
 * Moves the chosen exiled card onto the battlefield under the chooser, then either
 * queues the next chooser's prompt or resumes remaining Oracle IR steps.
 */
export function handleRepeatedZoneDraftResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  if (response.cancelled) {
    debugWarn(1, `[Resolution] Repeated zone draft cancelled by ${response.playerId}`);
    return;
  }

  const stepData = step as any;
  const chooserId = String(response.playerId || step.playerId || '').trim();
  const selection = response.selections as any;
  let selectedCardId = '';
  let preferredAttachId = '';
  if (typeof selection === 'string') selectedCardId = selection;
  else if (Array.isArray(selection) && selection.length > 0) {
    const first = selection[0];
    if (typeof first === 'string') selectedCardId = first;
    else if (first && typeof first === 'object') {
      selectedCardId = String(first.cardId || first.selectedCardId || first.id || '');
      preferredAttachId = String(first.attachId || first.attachedTo || first.hostId || first.playerId || '').trim();
    }
  } else if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
    selectedCardId = String(selection.cardId || selection.selectedCardId || selection.id || '');
    preferredAttachId = String(selection.attachId || selection.attachedTo || selection.hostId || selection.playerId || '').trim();
  }
  selectedCardId = String(selectedCardId || '').trim();
  if (!selectedCardId || !chooserId) {
    debugWarn(1, `[Resolution] Repeated zone draft: missing selection or chooser`);
    return;
  }

  const remainingCardIds = (Array.isArray(stepData.remainingCardIds) ? stepData.remainingCardIds : [])
    .map((id: any) => String(id || '').trim())
    .filter(Boolean);
  if (!remainingCardIds.includes(selectedCardId)) {
    debugWarn(1, `[Resolution] Repeated zone draft: ${selectedCardId} not in remaining pool`);
    return;
  }
  if (!isRepeatedZoneDraftPickLegal(game.state, selectedCardId, chooserId)) {
    debugWarn(1, `[Resolution] Repeated zone draft: ${selectedCardId} is not legally returnable for ${chooserId}`);
    return;
  }
  if (repeatedZoneDraftNeedsExplicitAttachId(game.state, selectedCardId, chooserId) && !preferredAttachId) {
    debugWarn(1, `[Resolution] Repeated zone draft: ${selectedCardId} needs an attach host`);
    return;
  }

  const preview = findExiledDraftCard(game.state, selectedCardId);
  const previewAttachId = preview
    ? resolveRepeatedZoneDraftAuraAttachId(
        game.state,
        preview.card,
        chooserId,
        preferredAttachId || undefined,
      )
    : undefined;
  if (preferredAttachId && previewAttachId !== preferredAttachId) {
    debugWarn(1, `[Resolution] Repeated zone draft: ${preferredAttachId} is not a legal attach target for ${selectedCardId}`);
    return;
  }

  game.state = game.state || {};
  game.state.zones = game.state.zones || {};
  game.state.battlefield = Array.isArray(game.state.battlefield) ? game.state.battlefield : [];

  let ownerId = '';
  let card: any = null;
  for (const [playerId, zones] of Object.entries(game.state.zones as Record<string, any>)) {
    const exile = Array.isArray(zones?.exile) ? zones.exile : [];
    const index = exile.findIndex((entry: any) => String(entry?.id || '') === selectedCardId);
    if (index === -1) continue;
    ownerId = String(playerId);
    [card] = exile.splice(index, 1);
    zones.exileCount = exile.length;
    break;
  }

  if (!card || !ownerId) {
    debugWarn(1, `[Resolution] Repeated zone draft: card ${selectedCardId} not found in exile`);
    return;
  }

  const permanentId = uid('perm');
  const entersTapped = stepData.entersTapped !== false;
  const typeLine = String(card.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const attachId = resolveRepeatedZoneDraftAuraAttachId(
    game.state,
    card,
    chooserId,
    preferredAttachId || undefined,
  );
  const playerIds = new Set(
    ((Array.isArray(game.state.players) ? game.state.players : []) as any[])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean),
  );
  const isPlayerAttach = Boolean(attachId && playerIds.has(attachId));
  game.state.battlefield.push({
    id: permanentId,
    controller: chooserId,
    owner: ownerId,
    tapped: entersTapped,
    counters: {},
    basePower: isCreature ? parsePT(card.power) : undefined,
    baseToughness: isCreature ? parsePT(card.toughness) : undefined,
    summoningSickness: isCreature,
    card: { ...card, zone: 'battlefield' },
    ...(attachId && !isPlayerAttach ? { attachedTo: attachId } : {}),
    ...(isPlayerAttach
      ? { attachedTo: attachId, enchanting: attachId, enchantedPlayerId: attachId }
      : {}),
  });
  if (attachId && !isPlayerAttach) {
    const host = game.state.battlefield.find((perm: any) => String(perm?.id || '') === attachId);
    if (host) {
      const attachments = Array.isArray(host.attachments) ? [...host.attachments] : [];
      if (!attachments.includes(permanentId)) attachments.push(permanentId);
      host.attachments = attachments;
    }
  }

  recordDeferredChaosEtbPermanentId(game.state, permanentId);

  const nextRemaining = remainingCardIds.filter((id: string) => id !== selectedCardId);
  const chooserOrder = (Array.isArray(stepData.chooserOrder) ? stepData.chooserOrder : [chooserId])
    .map((id: any) => String(id || '').trim())
    .filter(Boolean);
  const currentIndex = Number.isFinite(Number(stepData.chooserIndex))
    ? Math.max(0, Number(stepData.chooserIndex))
    : Math.max(0, chooserOrder.indexOf(chooserId));
  const nextChooserStartIndex = chooserOrder.length > 0 ? (currentIndex + 1) % chooserOrder.length : 0;

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'effectProgramZoneMove', {
      playerId: chooserId,
      fromPlayerId: ownerId,
      ownerId,
      controllerId: chooserId,
      cardId: selectedCardId,
      fromZone: 'exile',
      toZone: 'battlefield',
      permanentId,
      card: { ...card },
      tapped: entersTapped,
      entersTapped,
    });
    appendEvent(gameId, (game as any).seq ?? 0, 'repeatedZoneDraftPick', {
      playerId: chooserId,
      cardId: selectedCardId,
      permanentId,
      remainingCardIds: nextRemaining,
      chooserOrder,
      chooserIndex: nextChooserStartIndex,
      sourceId: stepData.sourceId,
      sourceName: stepData.sourceName,
      resolvedStepId: String(stepData.id || step.id || ''),
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(repeatedZoneDraftPick) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, chooserId)} chooses ${card.name || 'a card'} from the auction.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  if (nextRemaining.length > 0 && chooserOrder.length > 0) {
    const nextChooserIndex = findNextRepeatedZoneDraftChooserIndex(
      game.state,
      nextRemaining,
      chooserOrder,
      nextChooserStartIndex,
    );
    if (nextChooserIndex === null) {
      const ctx = ((game as any).ctx || game) as any;
      ctx.gameId = gameId;
      ctx.state = game.state;
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
      game.state = ctx.state;
      broadcastGame(io, game, gameId);
      return;
    }
    const nextChooser = chooserOrder[nextChooserIndex] || chooserOrder[0];
    const legalIds = filterLegalRepeatedZoneDraftCardIds(game.state, nextRemaining, nextChooser);
    const cards = legalIds
      .map((cardId: string) => buildRepeatedZoneDraftCardChoiceInfo(game.state, cardId, nextChooser))
      .filter(Boolean);

    const nextDraftStep = {
      type: ResolutionStepType.REPEATED_ZONE_DRAFT,
      playerId: nextChooser,
      description: String(stepData.description || step.description || 'Choose a card from the exiled pool'),
      mandatory: true,
      sourceId: stepData.sourceId,
      sourceName: stepData.sourceName,
      remainingCardIds: nextRemaining,
      cards,
      chooserOrder,
      chooserIndex: nextChooserIndex,
      entersTapped,
      destination: String(stepData.destination || 'battlefield'),
      oracleIrChoiceStepJson: stepData.oracleIrChoiceStepJson,
      oracleIrResumeStepsJson: stepData.oracleIrResumeStepsJson,
      oracleIrControllerId: stepData.oracleIrControllerId,
      oracleIrSourceId: stepData.oracleIrSourceId,
      oracleIrSourceName: stepData.oracleIrSourceName,
      oracleIrContinuationStepIndex: stepData.oracleIrContinuationStepIndex,
    } as any;

    ResolutionQueueManager.addStep(gameId, nextDraftStep);
    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: String(nextChooser),
      sourceId: String(stepData.sourceId || '').trim(),
      queuedResolutionSteps: [nextDraftStep],
    });
  } else {
    // Draft finished — resume any remaining Oracle IR steps after this choice gap.
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    maybeResumeOracleIRStepsAfterResolution(ctx, step);
    game.state = ctx.state;
  }

  broadcastGame(io, game, gameId);
}
