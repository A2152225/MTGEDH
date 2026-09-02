/**
 * socket/resolutionLibraryLookResponseHandlers.ts
 *
 * Library-look / pile-split resolution response handlers:
 * Fateseal, Clash, Bottom-Order, Ponder, Sequential Oracle-IR pile split,
 * and Two-Pile (N-pile) split.
 *
 * Extracted from resolution.ts. Wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { maybeApplyOracleIrChoiceStepFromResolution, maybeResumeOracleIRStepsAfterResolution } from "../state/modules/oracleIrServerZoneSync.js";
import { sacrificePermanent } from "../state/modules/upkeep-triggers.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { appendQueuedResolutionPromptEvent, cloneZoneCardsForEvent } from "./resolutionCloneQueuedPromptUtils.js";
import { appendGameEvent, broadcastGame, getPlayerName } from "./util.js";

/**
 * Handle Fateseal resolution response
 * 
 * Player looks at the top N cards of opponent's library and decides which to keep
 * on top (in order) and which to put on the bottom (in order).
 * 
 * Reference: Rule 701.29 - Fateseal
 */
export function handleFatesealResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  const fatesealStep = step as any;
  const cards = Array.isArray(fatesealStep.cards) ? fatesealStep.cards : [];
  const byId = new Map<string, any>(cards.map((c: any) => [String(c?.id), c]));

  const normalizeCardList = (v: any): any[] => {
    if (!Array.isArray(v)) return [];
    return v
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
      .map((x: any) => byId.get(String(x)) || (typeof x === 'object' ? x : null))
      .filter(Boolean);
  };

  const keepTopOrder = normalizeCardList(selections?.keepTopOrder);
  const bottomOrder = normalizeCardList(selections?.bottomOrder);
  
  const fatesealCount = fatesealStep.fatesealCount || 0;
  const opponentId = fatesealStep.opponentId;
  
  debug(2, `[Resolution] Fateseal response: player=${pid}, opponent=${opponentId}, count=${fatesealCount}, keepTop=${keepTopOrder.length}, bottom=${bottomOrder.length}`);
  
  // Validate that all cards are accounted for
  const totalCards = keepTopOrder.length + bottomOrder.length;
  if (totalCards !== fatesealCount && totalCards !== cards.length) {
    debugWarn(2, `[Resolution] Fateseal card count mismatch: expected ${fatesealCount}, got ${totalCards}`);
  }
  
  // Get opponent's library
  const lib = (game as any).libraries?.get(opponentId) || [];
  
  // Remove the fatesealed cards from top of library
  lib.splice(0, totalCards);
  
  // Put cards back in chosen order (top cards go on top, bottom cards on bottom)
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    lib.unshift({ ...keepTopOrder[i], zone: 'library' });
  }
  for (const card of bottomOrder) {
    lib.push({ ...card, zone: 'library' });
  }
  
  // Update library count
  const zones = game.state.zones = game.state.zones || {};
  const z = zones[opponentId] = zones[opponentId] || {};
  z.libraryCount = lib.length;
  
  // Emit chat message
  const topCount = keepTopOrder.length;
  const bottomCount = bottomOrder.length;
  let message = `${getPlayerName(game, pid)} fateseals ${fatesealCount} of ${getPlayerName(game, opponentId)}'s library`;
  if (topCount > 0 && bottomCount > 0) {
    message += ` (${topCount} on top, ${bottomCount} on bottom)`;
  } else if (topCount > 0) {
    message += ` (all on top)`;
  } else if (bottomCount > 0) {
    message += ` (all on bottom)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "fatesealResolve", { 
      playerId: pid, 
      resolvedStepId: String((step as any).id || ''),
      opponentId,
      keepTopOrder, 
      bottomOrder 
    });
  } catch {
    // Ignore persistence failures
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Clash resolution response
 * 
 * Player reveals top card and chooses whether to put it on bottom of library.
 * 
 * Reference: Rule 701.30 - Clash
 */
export function handleClashResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: boolean (true = put on bottom, false = keep on top)
  const putOnBottom = selections === true || selections?.putOnBottom === true;
  
  const clashStep = step as any;
  const revealedCard = clashStep.revealedCard;
  const opponentId = clashStep.opponentId;
  
  debug(2, `[Resolution] Clash response: player=${pid}, putOnBottom=${putOnBottom}`);
  
  if (!revealedCard) {
    debugWarn(2, `[Resolution] Clash step missing revealed card`);
    return;
  }
  
  // Get player's library
  const lib = (game as any).libraries?.get(pid) || [];
  
  if (putOnBottom) {
    // Remove from top and put on bottom
    if (lib.length > 0 && lib[0].id === revealedCard.id) {
      const card = lib.shift();
      if (card) {
        lib.push({ ...card, zone: 'library' });
      }
    }
  }
  // If not putting on bottom, card stays on top (no action needed)
  
  // Update library count
  const zones = game.state.zones = game.state.zones || {};
  const z = zones[pid] = zones[pid] || {};
  z.libraryCount = lib.length;
  
  // Emit chat message
  let message = `${getPlayerName(game, pid)} clashes, revealing ${revealedCard.name}`;
  if (opponentId) {
    message = `${getPlayerName(game, pid)} clashes with ${getPlayerName(game, opponentId)}, revealing ${revealedCard.name}`;
  }
  if (putOnBottom) {
    message += ` (put on bottom)`;
  } else {
    message += ` (kept on top)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "clashResolve", { 
      playerId: pid, 
      resolvedStepId: String((step as any).id || ''),
      revealedCard,
      putOnBottom,
      opponentId
    });
  } catch {
    // Ignore persistence failures
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Bottom Order resolution response
 * Player orders a provided list of cards, which are then placed on the bottom of their library
 * in that exact order (bottom -> up).
 */
export function handleBottomOrderResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;

  // Accept either { bottomOrder: [...] } or a raw array.
  const rawBottomOrder =
    selections && typeof selections === 'object' && 'bottomOrder' in selections
      ? (selections as any).bottomOrder
      : selections;

  const bottomIds: string[] = Array.isArray(rawBottomOrder)
    ? rawBottomOrder
        .map((x: any) => (typeof x === 'string' ? x : x?.id))
        .filter(Boolean)
        .map(String)
    : [];

  const bottomStep = step as any;
  const cards: any[] = Array.isArray(bottomStep.cards) ? bottomStep.cards : [];
  const stepCardIds = cards.map((c: any) => String(c?.id)).filter(Boolean);

  debug(2, `[Resolution] Bottom order response: player=${pid}, count=${bottomIds.length}`);

  // Validate: must be a permutation of the provided cards.
  if (bottomIds.length !== stepCardIds.length) {
    debugWarn(2, `[Resolution] bottom_order: card count mismatch (expected ${stepCardIds.length}, got ${bottomIds.length})`);
    return;
  }
  const seen = new Set(bottomIds);
  if (seen.size !== bottomIds.length) {
    debugWarn(2, `[Resolution] bottom_order: duplicate IDs in bottomOrder`);
    return;
  }
  const stepSet = new Set(stepCardIds);
  if (!bottomIds.every(id => stepSet.has(id))) {
    debugWarn(2, `[Resolution] bottom_order: selection contains cards not in original set`);
    return;
  }

  if (String((step as any)?.oracleIrChoiceStepJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    try {
      const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, {
        selections: { bottomOrder: bottomIds },
      });
      if (resumed) {
        maybeResumeOracleIRStepsAfterResolution(ctx, step);
        if (typeof game.bumpSeq === "function") game.bumpSeq();
        broadcastGame(io, game, gameId);
        return;
      }
    } catch (err) {
      debugWarn(1, `[Resolution] bottom_order Oracle IR apply failed:`, err);
      if (typeof game.bumpSeq === "function") game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }
  }

  const byId = new Map<string, any>(cards.map((c: any) => [String(c.id), c]));
  const orderedCards = bottomIds.map(id => byId.get(id)).filter(Boolean);

  const originalLib = (game as any).libraries?.get(pid) || [];
  const lib = Array.isArray(originalLib) ? originalLib.map((card: any) => ({ ...card })) : [];
  for (const card of orderedCards) {
    lib.push({ ...card, zone: 'library' });
  }

  const shuffleAfter = bottomStep.shuffleAfter === true;
  if (shuffleAfter) {
    if (typeof (game as any).shuffleLibrary === 'function') {
      const shadowGame = {
        ...(game as any),
        libraries: new Map((game as any).libraries || []),
      };
      shadowGame.libraries.set(pid, lib);
      shadowGame.shuffleLibrary(pid);
      const shuffled = shadowGame.libraries.get(pid);
      lib.length = 0;
      if (Array.isArray(shuffled)) {
        lib.push(...shuffled.map((card: any) => ({ ...card })));
      }
    } else {
      for (let i = lib.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lib[i], lib[j]] = [lib[j], lib[i]];
      }
    }
  }

  appendGameEvent(game, gameId, 'bottomOrderResolve', {
    playerId: pid,
    effectId: bottomStep.effectId,
    sourceId: bottomStep.sourceId,
    sourceName: bottomStep.sourceName,
    orderedCardIds: bottomIds,
    bottomCards: orderedCards.map((card: any) => ({ ...card, zone: 'library' })),
    shuffleAfter,
    ...(shuffleAfter ? { shuffledLibraryIds: lib.map((card: any) => String(card?.id || '')).filter(Boolean) } : {}),
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} put ${orderedCards.length} card(s) on the bottom of their library in a chosen order${shuffleAfter ? ' and shuffled' : ''}.`,
    ts: Date.now(),
  });
}

/**
 * Handle PONDER_EFFECT response from client
 */
export function handlePonderEffectResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: ResolutionStepResponse
): void {
  try {
    const { playerId } = step;
    const { selections, cancelled } = response;
    const targetPid = step.targetPlayerId || playerId;
    const originalLib = (game as any).libraries?.get(targetPid) || [];
    const lib = Array.isArray(originalLib) ? originalLib.map((card: any) => ({ ...card })) : [];
    
    if (cancelled) {
      appendGameEvent(game, gameId, 'ponderEffectResolve', {
        playerId,
        targetPlayerId: targetPid,
        effectId: step.effectId,
        sourceName: step.sourceName,
        variant: step.variant,
        cancelled: true,
      });

      debug(2, `[handlePonderEffectResponse] ${playerId} cancelled ponder`);
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} cancelled their ponder effect.`,
        ts: Date.now(),
      });
      return;
    }
    
    // selections should be: { newOrder: string[], shouldShuffle: boolean, toHand?: string[] }
    const { newOrder, shouldShuffle, toHand } = selections as any;
    
    // Remove the top N cards that were being reordered
    const cardCount = step.cardCount || step.cards?.length || 0;
    const removedCards: any[] = [];
    for (let i = 0; i < cardCount && lib.length > 0; i++) {
      removedCards.push(lib.shift());
    }
    
    const cardById = new Map(removedCards.map((c: any) => [c.id, c]));
    const toHandCards: any[] = [];
    let drawnCard: any | undefined;
    
    // Move cards to hand if specified (Telling Time style)
    if (toHand && toHand.length > 0) {
      for (const cardId of toHand) {
        const card = cardById.get(cardId);
        if (card) {
          toHandCards.push({ ...card });
          cardById.delete(cardId);
        }
      }
      
      debug(2, `[handlePonderEffectResponse] ${playerId} put ${toHand.length} card(s) to hand`);
    }
    
    if (shouldShuffle) {
      // Shuffle the remaining cards back into library first
      for (const card of cardById.values()) {
        lib.push({ ...card, zone: 'library' });
      }
      
      if (typeof (game as any).shuffleLibrary === "function") {
        const shadowGame = {
          ...(game as any),
          libraries: new Map((game as any).libraries || []),
        };
        shadowGame.libraries.set(targetPid, lib);
        shadowGame.shuffleLibrary(targetPid);
        const shuffled = shadowGame.libraries.get(targetPid);
        lib.length = 0;
        if (Array.isArray(shuffled)) {
          lib.push(...shuffled.map((card: any) => ({ ...card })));
        }
      } else {
        debugWarn(2, "[handlePonderEffectResponse] game.shuffleLibrary not available, using Math.random");
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
      }
      
      debug(2, `[handlePonderEffectResponse] ${targetPid} shuffled their library`);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} shuffled their library.`,
        ts: Date.now(),
      });
    } else {
      // Put cards back in the specified order (newOrder has IDs from top to bottom)
      for (let i = newOrder.length - 1; i >= 0; i--) {
        const card = cardById.get(newOrder[i]);
        if (card) {
          lib.unshift({ ...card, zone: 'library' });
        }
      }
      debug(2, `[handlePonderEffectResponse] ${targetPid} reordered top ${newOrder.length} cards`);
    }
    
    // Draw a card if specified (Ponder draws after reordering/shuffling)
    let drawnCardName: string | undefined;
    if (step.drawAfter && playerId === targetPid) {
      if (lib.length > 0) {
        drawnCard = lib.shift();
        drawnCardName = drawnCard.name;
        
        debug(2, `[handlePonderEffectResponse] ${playerId} drew ${drawnCardName}`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} draws a card.`,
          ts: Date.now(),
        });
      }
    }

    appendGameEvent(game, gameId, 'ponderEffectResolve', {
      playerId,
      targetPlayerId: targetPid,
      effectId: step.effectId,
      sourceName: step.sourceName,
      variant: step.variant,
      shouldShuffle: shouldShuffle === true,
      lookedAtCardIds: removedCards.map((card: any) => String(card?.id || '')).filter(Boolean),
      lookedAtCards: removedCards.map((card: any) => ({ ...card })),
      libraryTopOrder: shouldShuffle ? undefined : (Array.isArray(newOrder) ? newOrder.map((id: any) => String(id || '')).filter(Boolean) : []),
      shuffledLibraryIds: shouldShuffle ? lib.map((card: any) => String(card?.id || '')).filter(Boolean) : undefined,
      toHandCards: cloneZoneCardsForEvent(toHandCards, 'hand'),
      toHandCardIds: toHandCards.map((card: any) => String(card?.id || '')).filter(Boolean),
      drawnCard: drawnCard ? { ...drawnCard, zone: 'hand' } : undefined,
      drawnCardId: drawnCard ? String(drawnCard.id || '') : undefined,
    });
    
    // Log event
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} completed ponder effect (${step.sourceName || 'unknown'})`,
      ts: Date.now(),
    });
  } catch (e) {
    debugError(1, '[handlePonderEffectResponse] Error:', e);
  }
}


export async function handleSequentialOracleIrPileSplitResponse(
  io: Server,
  game: any,
  gameId: string,
  stepData: any,
  response: ResolutionStepResponse,
  piles: string[][],
): Promise<void> {
  const playerOrder = (Array.isArray(stepData.oracleIrPileSplitPlayerOrder)
    ? stepData.oracleIrPileSplitPlayerOrder
    : [response.playerId])
    .map((id: any) => String(id || '').trim())
    .filter(Boolean);
  const currentIndex = Math.max(0, Number(stepData.oracleIrPileSplitPlayerIndex) || 0);
  const currentPlayerId = String(playerOrder[currentIndex] || response.playerId || '').trim();
  const assignmentsByPlayer = {
    ...(stepData.oracleIrPileAssignmentsByPlayer || {}),
    [currentPlayerId]: piles.map((pile) => [...pile]),
  };
  const nextIndex = currentIndex + 1;
  const pileCount = Math.max(2, Math.floor(Number(stepData.pileCount ?? piles.length ?? 2)));
  const sourceName = String(stepData.sourceName || stepData.oracleIrSourceName || 'Ability');

  if (nextIndex < playerOrder.length) {
    const nextPlayerId = String(playerOrder[nextIndex] || '').trim();
    const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
    const controlled = battlefield.filter(
      (perm: any) => String(perm?.controller || '').trim() === nextPlayerId,
    );
    const nextStep = {
      ...stepData,
      playerId: nextPlayerId,
      description: `${sourceName}: Separate all permanents you control into ${pileCount} piles`,
      items: controlled.map((perm: any) => ({
        id: String(perm?.id || ''),
        label: String(perm?.card?.name || perm?.name || perm?.id || 'Permanent'),
        description: String(perm?.card?.type_line || perm?.type_line || ''),
        imageUrl: perm?.card?.image_uris?.normal
          || perm?.card?.image_uris?.small
          || perm?.card?.imageUrl,
      })),
      oracleIrPileSplitPlayerIndex: nextIndex,
      oracleIrPileAssignmentsByPlayer: assignmentsByPlayer,
    } as any;
    delete nextStep.id;
    delete nextStep.status;
    delete nextStep.createdAt;
    delete nextStep.completedAt;
    delete nextStep.response;

    const queuedStep = ResolutionQueueManager.addStep(gameId, nextStep);
    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: nextPlayerId,
      sourceId: String(stepData.sourceId || '').trim(),
      queuedResolutionSteps: [queuedStep],
    });
    broadcastGame(io, game, gameId);
    return;
  }

  const ctx = ((game as any).ctx || game) as any;
  ctx.gameId = gameId;
  ctx.state = game.state;
  const rng = typeof ctx.rng === 'function' ? () => Number(ctx.rng()) || 0 : () => Math.random();
  const randomPileByPlayer: Record<string, number> = {};
  const sacrificedIds: string[] = [];

  for (const playerId of playerOrder) {
    const playerPiles = Array.isArray(assignmentsByPlayer[playerId])
      ? assignmentsByPlayer[playerId]
      : Array.from({ length: pileCount }, () => []);
    const randomIndex = Math.floor(Math.max(0, Math.min(0.999999, rng())) * pileCount);
    randomPileByPlayer[playerId] = randomIndex;

    for (const permanentId of playerPiles[randomIndex] || []) {
      const id = String(permanentId || '').trim();
      if (!id) continue;
      const sacrificedName = sacrificePermanent(ctx, id, playerId);
      if (!sacrificedName) continue;
      sacrificedIds.push(id);
      appendEvent(gameId, (game as any).seq ?? 0, 'sacrificePermanent', {
        playerId,
        permanentId: id,
        sourceId: stepData.sourceId,
        sourceName,
        resolvedStepId: String(stepData.id || ''),
      });
    }
  }

  appendEvent(gameId, (game as any).seq ?? 0, 'randomPileSacrificeResolved', {
    sourceId: stepData.sourceId,
    sourceName,
    playerOrder,
    pileCount,
    assignmentsByPlayer,
    randomPileByPlayer,
    sacrificedIds,
    resolvedStepId: String(stepData.id || ''),
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: each player randomly selected a pile; ${sacrificedIds.length} permanent(s) were sacrificed.`,
    ts: Date.now(),
  });

  maybeResumeOracleIRStepsAfterResolution(ctx, stepData);
  game.state = ctx.state;
  broadcastGame(io, game, gameId);
}

/**
 * Handle pile-split responses from clients. The legacy step type name is kept
 * for wire compatibility, but pileCount supports generic N-pile effects.
 */
export async function handleTwoPileSplitResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: ResolutionStepResponse
): Promise<void> {
  const stepData = step as any;
  const selections: any = response.selections;

  const items: any[] = Array.isArray(stepData.items) ? stepData.items : [];
  const itemIds = items.map((it: any) => String(it?.id || '')).filter(Boolean);
  const validIds = new Set(itemIds);
  const pileCount = Math.max(2, Math.floor(Number(stepData.pileCount ?? 2)));

  let piles: string[][] = [];

  if (selections && typeof selections === 'object') {
    if (Array.isArray(selections.piles) && selections.piles.length === pileCount) {
      piles = selections.piles.map((pile: any) =>
        (Array.isArray(pile) ? pile : []).map(String),
      );
    } else if (pileCount === 2 && Array.isArray(selections.pileA) && Array.isArray(selections.pileB)) {
      piles = [selections.pileA.map(String), selections.pileB.map(String)];
    } else if (
      pileCount === 3
      && Array.isArray(selections.pileA)
      && Array.isArray(selections.pileB)
      && Array.isArray(selections.pileC)
    ) {
      piles = [
        selections.pileA.map(String),
        selections.pileB.map(String),
        selections.pileC.map(String),
      ];
    }
  }

  // Normalize: valid IDs only, no dupes, ensure full assignment.
  const seenDuringNormalize = new Set<string>();
  piles = piles.map((pile) => pile.filter((id) => {
    if (!validIds.has(id) || seenDuringNormalize.has(id)) return false;
    seenDuringNormalize.add(id);
    return true;
  }));
  const assigned = new Set(piles.flat());
  if (assigned.size !== itemIds.length) {
    piles = Array.from({ length: pileCount }, () => [] as string[]);
    itemIds.forEach((id, idx) => piles[idx % pileCount].push(id));
  }

  const minPerPile = Number(stepData.minPerPile ?? 0);
  if (minPerPile > 0 && piles.some((pile) => pile.length < minPerPile)) {
    for (const receiver of piles.filter((pile) => pile.length < minPerPile)) {
      const donor = [...piles].sort((a, b) => b.length - a.length)[0];
      while (receiver.length < minPerPile && donor.length > minPerPile) {
        const moved = donor.pop();
        if (moved) receiver.push(moved);
      }
    }
  }

  if (stepData.oracleIrSequentialPileSplit === true) {
    await handleSequentialOracleIrPileSplitResponse(io, game, gameId, stepData, response, piles);
    return;
  }

  const pileA = piles[0] || [];
  const pileB = piles[1] || [];

  if (minPerPile > 0 && (pileA.length < minPerPile || pileB.length < minPerPile)) {
    const donor = pileA.length > pileB.length ? pileA : pileB;
    const receiver = donor === pileA ? pileB : pileA;
    while (receiver.length < minPerPile && donor.length > minPerPile) {
      const moved = donor.pop();
      if (moved) receiver.push(moved);
    }
  }

  if (stepData.choosePileFromSplitChoice === true) {
    const chooserPlayerId = String(stepData.choosePileFromSplitChooserPlayerId || response.playerId);
    const sourceName = String(stepData.choosePileFromSplitSourceName || step.sourceName || 'Ability');
    const splitItems: any[] = Array.isArray(stepData.choosePileFromSplitItems) ? stepData.choosePileFromSplitItems : [];
    const byId = new Map(splitItems.map((item: any) => [String(item?.id || ''), item]));
    const names = (ids: string[]) => ids
      .map((id) => byId.get(id)?.card?.name || byId.get(id)?.name || byId.get(id)?.label)
      .filter(Boolean)
      .join(', ') || '(empty)';

    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: chooserPlayerId as PlayerID,
      description: String(stepData.choosePileFromSplitChoiceDescription || `${sourceName}: Choose a pile`),
      mandatory: true,
      sourceName,
      options: [
        { id: 'pileA', label: `Pile A (${pileA.length})`, description: names(pileA) },
        { id: 'pileB', label: `Pile B (${pileB.length})`, description: names(pileB) },
      ],
      minSelections: 1,
      maxSelections: 1,
      choosePileFromSplitChoice: true,
      choosePileFromSplitChooserPlayerId: chooserPlayerId,
      choosePileFromSplitSourceName: sourceName,
      choosePileFromSplitItems: splitItems,
      choosePileFromSplitOriginalOrder: stepData.choosePileFromSplitOriginalOrder,
      choosePileFromSplitChosenAction: stepData.choosePileFromSplitChosenAction,
      choosePileFromSplitChosenDestination: stepData.choosePileFromSplitChosenDestination,
      choosePileFromSplitOtherDestination: stepData.choosePileFromSplitOtherDestination,
      choosePileFromSplitMovePlayerId: stepData.choosePileFromSplitMovePlayerId,
      choosePileFromSplitTargetPlayerId: stepData.choosePileFromSplitTargetPlayerId,
      choosePileFromSplitChatMessage: stepData.choosePileFromSplitChatMessage,
      choosePileFromSplitPileA: pileA,
      choosePileFromSplitPileB: pileB,
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: chooserPlayerId,
      sourceId: String(stepData.sourceId || step.sourceId || '').trim(),
      queuedResolutionStep,
    });

    const splitMessage = String(stepData.choosePileFromSplitSplitMessage || '');
    if (splitMessage) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: splitMessage,
        ts: Date.now(),
      });
    }
    return;
  }

  debug(2, `[handleTwoPileSplitResponse] No handler for TWO_PILE_SPLIT step ${step.id}`);
}
