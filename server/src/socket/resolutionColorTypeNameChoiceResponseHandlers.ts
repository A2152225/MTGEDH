/**
 * socket/resolutionColorTypeNameChoiceResponseHandlers.ts
 *
 * COLOR_CHOICE / BASIC_LAND_TYPE_CHOICE / CREATURE_TYPE_CHOICE / CARD_NAME_CHOICE
 * response handlers. Extracted from resolution.ts; wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import { appendCastSpellContinuationEvent } from "./resolutionSyntheticCastSocketUtils.js";
import { emitToPlayer, getPlayerName, persistAndResolveTopOfStack } from "./util.js";

/**
 * Handle Color Choice response
 * Player chooses a color for a permanent that entered the battlefield
 */
export async function handleColorChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  
  if (!selection || typeof selection !== 'string') {
    debugWarn(2, `[Resolution] Color choice missing selection`);
    return;
  }
  
  // Validate color choice
  const validColors = ['white', 'blue', 'black', 'red', 'green'];
  const colorLower = selection.toLowerCase();
  if (!validColors.includes(colorLower)) {
    debugWarn(2, `[Resolution] Invalid color choice: ${selection}`);
    return;
  }
  
  const permanentId = (step as any).permanentId || (step as any).sourceId;
  const spellId = (step as any).spellId;
  const cardName = (step as any).cardName || (step as any).sourceName || 'Permanent';
  
  // Check if this is a spell color choice (instant/sorcery on stack)
  // vs a permanent ETB color choice
  const state = game.state || {};
  
  if (spellId) {
    // This is a spell on the stack that needs color choice (e.g., Brave the Elements)
    const stack = state.stack || [];
    const spellOnStack = stack.find((s: any) =>
      s.id === spellId
      || s.cardId === spellId
      || s.card?.id === spellId
    );
    
    if (spellOnStack) {
      // Store chosen color on the spell
      spellOnStack.chosenColor = colorLower;
      if (spellOnStack.card && typeof spellOnStack.card === 'object') {
        spellOnStack.card.chosenColor = colorLower;
      }
      
      debug(2, `[Resolution] Spell color choice: ${cardName} -> ${colorLower}, will re-resolve`);
      
      // Append event for replay
      try {
        await appendEvent(gameId, (game as any).seq || 0, "colorChoice", {
          playerId: pid,
          resolvedStepId: String(step.id || '').trim(),
          resolvedStepType: String(step.type || '').trim(),
          spellId: spellId,
          cardName: cardName,
          color: colorLower,
        });
      } catch (e) {
        debugWarn(1, "[Resolution] Failed to persist spell color choice event:", e);
      }
      
      // Send chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} chose ${selection} for ${cardName}.`,
        ts: Date.now(),
      });
      
      // Bump sequence before re-resolving
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      if (persistAndResolveTopOfStack(game, gameId, {
        playerId: pid,
        spellId,
        cardName,
        reason: 'spellColorChoice',
      })) {
        debug(2, `[Resolution] Resumed stack resolution after spell color choice for ${cardName}`);
      } else {
        debugWarn(1, `[Resolution] Game missing resolveTopOfStack after spell color choice for ${cardName}`);
      }
      return;
    }

    debugWarn(2, `[Resolution] Spell color choice: spell ${spellId} not found on stack for ${cardName}`);
  }
  
  // Default case: permanent ETB color choice
  const battlefield = state.battlefield || [];
  const permanent = battlefield.find((p: any) => p.id === permanentId);
  
  if (!permanent) {
    debugWarn(2, `[Resolution] Color choice: permanent ${permanentId} not found`);
    return;
  }
  
  // Store the chosen color on the permanent
  permanent.chosenColor = colorLower;
  const reason = String((step as any).reason || (step as any).description || '').toLowerCase();
  const oracleLower = String(permanent.card?.oracle_text || '').toLowerCase();
  if (reason.includes('color word') || /choose a colou?r word/i.test(oracleLower)) {
    permanent.chosenColorWord = colorLower;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.chosenColorWord = colorLower;
    }
  }
  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card.chosenColor = colorLower;
  }
  
  // Append event for replay
  try {
    await appendEvent(gameId, (game as any).seq || 0, "colorChoice", {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      resolvedStepType: String(step.type || '').trim(),
      permanentId: permanentId,
      cardName: cardName,
      color: colorLower,
      ...(permanent.chosenColorWord ? { colorWord: permanent.chosenColorWord } : {}),
    });
  } catch (e) {
    debugWarn(1, "[Resolution] Failed to persist color choice event:", e);
  }
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} chose ${selection} for ${cardName}.`,
    ts: Date.now(),
  });
  
  debug(2, `[Resolution] Color choice completed: ${cardName} -> ${selection}`);
}

export async function handleBasicLandTypeChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const rawSelection = response.selections as any;
  const selectionRaw = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  const selection = typeof selectionRaw === 'string'
    ? selectionRaw
    : String((selectionRaw as any)?.value || (selectionRaw as any)?.label || (selectionRaw as any)?.id || '').trim();

  const validTypes = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const normalized = validTypes.find((landType) => landType.toLowerCase() === selection.toLowerCase())
    || validTypes.find((landType) => selection.toLowerCase().includes(landType.toLowerCase()));
  if (!normalized) {
    debugWarn(2, `[Resolution] Invalid basic land type choice: ${selection}`);
    return;
  }

  const permanentId = (step as any).permanentId || (step as any).sourceId;
  const cardName = (step as any).cardName || (step as any).sourceName || 'Permanent';
  const battlefield = game.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p.id === permanentId);
  if (!permanent) {
    debugWarn(2, `[Resolution] Basic land type choice: permanent ${permanentId} not found`);
    return;
  }

  permanent.chosenBasicLandType = normalized;
  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card.chosenBasicLandType = normalized;
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'basicLandTypeChoice', {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      resolvedStepType: String(step.type || '').trim(),
      permanentId,
      cardName,
      basicLandType: normalized,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist basic land type choice event:', e);
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} chose ${normalized} for ${cardName}.`,
    ts: Date.now(),
  });

  debug(2, `[Resolution] Basic land type choice completed: ${cardName} -> ${normalized}`);
}

export async function handleCreatureTypeChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  if (!selection || typeof selection !== 'string') {
    debugWarn(2, `[Resolution] Creature type choice missing selection`);
    return;
  }
  
  const permanentId = (step as any).permanentId || (step as any).sourceId;
  const spellId = (step as any).spellId;
  const beholdCastCardId = String((step as any).beholdCastCardId || '').trim();
  const cardName = (step as any).cardName || (step as any).sourceName || 'Permanent';
  const state = game.state || {};

  if (beholdCastCardId) {
    const zones = (state as any)?.zones?.[pid];
    const hand = Array.isArray(zones?.hand) ? zones.hand : [];
    const spellCard = hand.find((card: any) => card && String(card.id || '') === beholdCastCardId);
    if (!spellCard) {
      debugWarn(2, `[Resolution] Behold cast creature type choice: card ${beholdCastCardId} not found in hand`);
      return;
    }

    (spellCard as any).chosenCreatureType = selection;
    const castArgs = (step as any).castSpellFromHandArgs || {};
    const beholdCount = Math.max(1, Number((step as any).spellBeholdCount || 2));
    const { buildBeholdSelectionOptions } = await import('../state/modules/chosen-creature-type.js');
    const { handCards, battlefieldCreatures } = buildBeholdSelectionOptions(
      state,
      String(pid),
      selection,
      hand,
      beholdCastCardId,
    );

    if (handCards.length + battlefieldCreatures.length < beholdCount) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'CANNOT_PAY_COST',
        message: `Cannot behold ${beholdCount} ${selection} creature(s): only ${handCards.length + battlefieldCreatures.length} available.`,
      });
      return;
    }

    const beholdPaymentStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
      playerId: pid as any,
      sourceId: beholdCastCardId,
      sourceName: cardName,
      sourceImage: (step as any).sourceImage,
      description: `Behold ${beholdCount} ${selection} creature${beholdCount === 1 ? '' : 's'} to cast ${cardName}.`,
      mandatory: true,
      cardId: beholdCastCardId,
      cardName,
      costType: 'behold',
      amount: beholdCount,
      chosenCreatureType: selection,
      title: `Behold ${beholdCount} ${selection} creature${beholdCount === 1 ? '' : 's'}`,
      imageUrl: (step as any).sourceImage,
      availableCards: handCards.map((card: any) => ({
        id: card.id,
        name: card.name,
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
        typeLine: card.type_line,
        zone: 'hand',
      })),
      availableTargets: battlefieldCreatures.map((perm: any) => ({
        id: perm.id,
        name: perm.card?.name || 'Unknown',
        imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        typeLine: perm.card?.type_line,
        zone: 'battlefield',
      })),
      castSpellFromHandArgs: castArgs,
    } as any);

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: pid,
      cardId: beholdCastCardId,
      queuedResolutionStep: {
        ...(beholdPaymentStep as any),
      },
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} chose ${selection} to behold for ${cardName}.`,
      ts: Date.now(),
    });
    return;
  }

  if (spellId) {
    const stack = Array.isArray(state.stack) ? state.stack : [];
    const spellOnStack = stack.find((stackItem: any) => stackItem && (stackItem.id === spellId || stackItem.cardId === spellId));

    if (!spellOnStack) {
      debugWarn(2, `[Resolution] Creature type choice: spell ${spellId} not found on stack`);
      return;
    }

    (spellOnStack as any).chosenCreatureType = selection;
    if (spellOnStack.card && typeof spellOnStack.card === 'object') {
      (spellOnStack.card as any).chosenCreatureType = selection;
    }

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'creatureTypeSelected', {
        playerId: pid,
        resolvedStepId: String(step.id || '').trim(),
        resolvedStepType: String(step.type || '').trim(),
        spellId,
        cardName,
        creatureType: selection,
      });
    } catch (e) {
      debugWarn(1, '[Resolution] Failed to persist spell creature type choice event:', e);
    }

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} chose ${selection} for ${cardName}.`,
      ts: Date.now(),
    });

    debug(2, `[Resolution] Spell creature type choice completed: ${cardName} -> ${selection}`);
    return;
  }

  const { applyCreatureTypeSelection } = await import("./creature-type.js");
  applyCreatureTypeSelection(io, game, gameId, pid, permanentId, cardName, selection, false, {
    resolvedStepId: String(step.id || '').trim(),
    resolvedStepType: String(step.type || '').trim(),
  });
}

/**
 * Handle Card Name Choice response
 * Player chooses a card name for a permanent (e.g., Pithing Needle, Runed Halo)
 */
export async function handleCardNameChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  
  if (!selection || typeof selection !== 'string') {
    debugWarn(2, `[Resolution] Card name choice missing selection`);
    return;
  }
  
  const permanentId = (step as any).permanentId || (step as any).sourceId;
  const spellId = (step as any).spellId;
  const cardName = (step as any).cardName || (step as any).sourceName || 'Permanent';

  const state = game.state || {};

  if (spellId) {
    const stack = Array.isArray(state.stack) ? state.stack : [];
    const spellOnStack = stack.find((stackItem: any) => stackItem && (stackItem.id === spellId || stackItem.cardId === spellId));

    if (!spellOnStack) {
      debugWarn(2, `[Resolution] Card name choice: spell ${spellId} not found on stack`);
      return;
    }

    (spellOnStack as any).chosenCardName = selection;

    try {
      await appendEvent(gameId, (game as any).seq || 0, "cardNameChoice", {
        playerId: pid,
        resolvedStepId: String(step.id || '').trim(),
        resolvedStepType: String(step.type || '').trim(),
        spellId,
        cardName,
        chosenName: selection,
      });
    } catch (e) {
      debugWarn(1, "[Resolution] Failed to persist spell card name choice event:", e);
    }

    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} chose "${selection}" for ${cardName}.`,
      ts: Date.now(),
    });

    debug(2, `[Resolution] Spell card name choice completed: ${cardName} -> ${selection}`);
    return;
  }

  // Find the permanent on the battlefield
  const battlefield = state.battlefield || [];
  const permanent = battlefield.find((p: any) => p.id === permanentId);
  
  if (!permanent) {
    debugWarn(2, `[Resolution] Card name choice: permanent ${permanentId} not found`);
    return;
  }
  
  // Store the chosen card name on the permanent
  (permanent as any).chosenCardName = selection;
  
  // Append event for replay
  try {
    await appendEvent(gameId, (game as any).seq || 0, "cardNameChoice", {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      resolvedStepType: String(step.type || '').trim(),
      permanentId: permanentId,
      cardName: cardName,
      chosenName: selection,
    });
  } catch (e) {
    debugWarn(1, "[Resolution] Failed to persist card name choice event:", e);
  }
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} chose "${selection}" for ${cardName}.`,
    ts: Date.now(),
  });
  
  debug(2, `[Resolution] Card name choice completed: ${cardName} -> ${selection}`);
}

