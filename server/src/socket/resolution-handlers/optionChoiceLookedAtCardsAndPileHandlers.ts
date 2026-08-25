/**
 * socket/resolution-handlers/optionChoiceLookedAtCardsAndPileHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the three OPTION_CHOICE prompts about a set of cards the player was shown -
 * `chooseLookedAtCardsDestinationChoice` (send the chosen card to one zone and the rest to another,
 * optionally randomizing the leftovers), `payManaToLookAndChooseCardChoice` (spend X from the pool,
 * then queue the destination prompt over the top X cards) and `choosePileFromSplitChoice` (take one
 * of two piles: either move both piles to their destinations or sacrifice the chosen pile).
 * Public entry symbols: handleChooseLookedAtCardsDestinationChoice,
 * handlePayManaToLookAndChooseCardChoice, handleChoosePileFromSplitChoice.
 *
 * Every branch always returned, so each call site is `await handler(...); return;`. The pile branch
 * keeps its dynamic import of `movePermanentToGraveyard`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** Send the chosen looked-at card to one zone and the rest to another. */
export async function handleChooseLookedAtCardsDestinationChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const chosenCardId = extractOptionChoiceSelectionId(response.selections);
  const controllerId = (stepData.chooseLookedAtCardsDestinationController as string | undefined) || playerId;
  const sourceName = (stepData.chooseLookedAtCardsDestinationSourceName as string | undefined) || step.sourceName || 'Ability';
  const topCardIds: string[] = Array.isArray(stepData.chooseLookedAtCardsDestinationTopCardIds)
    ? stepData.chooseLookedAtCardsDestinationTopCardIds.map(String)
    : [];
  const chosenZone = String(stepData.chooseLookedAtCardsDestinationChosenZone || '').toLowerCase();
  const otherZone = String(stepData.chooseLookedAtCardsDestinationOtherZone || '').toLowerCase();
  const otherCardPatch = stepData.chooseLookedAtCardsDestinationOtherCardPatch as Record<string, any> | undefined;
  const randomizeOtherOrder = stepData.chooseLookedAtCardsDestinationRandomizeOtherOrder === true;
  if (!chosenCardId || topCardIds.length < 1) {
    debugWarn(2, `[Resolution] chooseLookedAtCardsDestinationChoice: invalid selection or missing card ids`);
    return;
  }

  const state = game.state || {};
  const zones = (state.zones = state.zones || {});
  const z = (zones[controllerId] = zones[controllerId] || {
    library: [],
    libraryCount: 0,
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
  });
  const lib: any[] = Array.isArray(z.library) ? z.library : [];
  const hand: any[] = Array.isArray(z.hand) ? z.hand : [];
  const gy: any[] = Array.isArray(z.graveyard) ? z.graveyard : (z.graveyard = []);

  const removed: any[] = [];
  for (const cid of topCardIds) {
    const idx = lib.findIndex((c: any) => c?.id === cid);
    if (idx >= 0) removed.push(lib.splice(idx, 1)[0]);
  }
  while (removed.length < topCardIds.length && lib.length > 0) removed.push(lib.shift());

  const chosen = removed.find((c: any) => String(c?.id) === String(chosenCardId)) || removed[0];
  const others = removed.filter((c: any) => String(c?.id) !== String(chosen?.id));

  const moveCard = (card: any, destination: string) => {
    if (!card) return;
    if (destination === 'hand') {
      hand.push({ ...card, zone: 'hand' });
      return;
    }
    if (destination === 'graveyard') {
      gy.unshift({ ...card, zone: 'graveyard' });
      return;
    }
    if (destination === 'top_library') {
      lib.unshift({ ...card, zone: 'library' });
      return;
    }
    if (destination === 'bottom_library') {
      lib.push({ ...card, zone: 'library' });
      return;
    }
    if (destination === 'exile') {
      const exile: any[] = Array.isArray(z.exile) ? z.exile : (z.exile = []);
      exile.push({ ...card, zone: 'exile', ...(otherCardPatch || {}) });
    }
  };

  moveCard(chosen, chosenZone);
  if (randomizeOtherOrder && others.length > 1) {
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
  }
  for (const other of others) moveCard(other, otherZone);

  z.library = lib;
  z.hand = hand;
  z.graveyard = gy;
  z.libraryCount = lib.length;
  z.handCount = hand.length;
  z.graveyardCount = gy.length;
  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'chooseLookedAtCardsDestinationResolve', {
      playerId,
      controllerId,
      sourceId: String(step.sourceId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      chosenCardId: String(chosen?.id || chosenCardId),
      topCardIds,
      chosenZone,
      otherZone,
      chosenCard: chosen ? { ...chosen } : undefined,
      otherCards: others.map((card: any) => ({ ...card })),
      otherCardPatch: otherCardPatch ? { ...otherCardPatch } : undefined,
      randomizeOtherOrder,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(chooseLookedAtCardsDestinationResolve) failed:', err);
  }

  const message =
    chosenZone === 'hand' && otherZone === 'bottom_library'
      ? `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into their hand and put the other on the bottom of their library.`
      : chosenZone === 'hand' && otherZone === 'graveyard'
        ? `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into their hand and put the other into their graveyard.`
        : chosenZone === 'graveyard' && otherZone === 'top_library'
          ? `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into their graveyard.`
          : chosenZone === 'hand' && otherZone === 'exile'
            ? `${sourceName}: ${getPlayerName(game, controllerId)} put ${chosen?.name || 'a card'} into hand and exiled the other card.`
          : `${sourceName}: ${getPlayerName(game, controllerId)} moved the looked-at cards.`;

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

/** Pay X, look at the top X cards, then choose one to keep. */
export async function handlePayManaToLookAndChooseCardChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const chosenX = Number(extractOptionChoiceSelectionId(response.selections) || 0);
  const controllerId = (stepData.payManaToLookAndChooseCardController as string | undefined) || playerId;
  const sourceName = (stepData.payManaToLookAndChooseCardSourceName as string | undefined) || step.sourceName || 'Ability';
  const state = game.state || {};
  const zones = (state.zones = state.zones || {});
  const z = (zones[controllerId] = zones[controllerId] || { library: [], libraryCount: 0, hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 });
  const lib: any[] = Array.isArray(z.library) ? z.library : [];

  const pool = { ...(((state as any).manaPool?.[controllerId] || {}) as any) };
  const paymentManaDelta: Record<string, number> = {};
  let remaining = Math.max(0, chosenX);
  const spendOrder = ['colorless', 'white', 'blue', 'black', 'red', 'green'];
  for (const color of spendOrder) {
    if (remaining <= 0) break;
    const available = Number(pool[color] || 0);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    pool[color] = available - take;
    paymentManaDelta[color] = Number(paymentManaDelta[color] || 0) - take;
    remaining -= take;
  }
  if (!(state as any).manaPool) (state as any).manaPool = {};
  (state as any).manaPool[controllerId] = pool;

  if (chosenX <= 0 || lib.length === 0) {
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'payManaToLookAndChooseCardChoiceResolve', {
        playerId,
        controllerId,
        sourceId: String(step.sourceId || '').trim() || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        chosenAmount: chosenX,
        lookedAtCardIds: [],
        paymentManaDelta,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(payManaToLookAndChooseCardChoiceResolve) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} paid ${chosenX} and looked at 0 cards.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const top = lib.slice(0, chosenX);
  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controllerId,
    description: `${sourceName}: Choose a card to put into your hand`,
    mandatory: true,
    sourceName,
    options: top.map((c: any) => ({
      id: c?.id,
      label: c?.name || 'Unknown',
      description: c?.type_line,
      imageUrl: c?.image_uris?.normal || c?.image_uris?.art_crop || c?.image_uris?.small,
    })),
    minSelections: 1,
    maxSelections: 1,
    chooseLookedAtCardsDestinationChoice: true,
    chooseLookedAtCardsDestinationController: controllerId,
    chooseLookedAtCardsDestinationSourceName: sourceName,
    chooseLookedAtCardsDestinationTopCardIds: top.map((c: any) => c?.id).filter(Boolean),
    chooseLookedAtCardsDestinationChosenZone: 'hand',
    chooseLookedAtCardsDestinationOtherZone: 'bottom_library',
    chooseLookedAtCardsDestinationRandomizeOtherOrder: true,
  } as any);

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'payManaToLookAndChooseCardChoiceResolve', {
      playerId,
      controllerId,
      sourceId: String(step.sourceId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      chosenAmount: chosenX,
      lookedAtCardIds: top.map((card: any) => String(card?.id || '')).filter(Boolean),
      paymentManaDelta,
      queuedResolutionStep,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(payManaToLookAndChooseCardChoiceResolve) failed:', err);
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}

/** Take one of two piles: either move both piles to their destinations, or sacrifice the chosen one. */
export async function handleChoosePileFromSplitChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  if (choiceId !== 'pileA' && choiceId !== 'pileB') {
    debugWarn(2, `[Resolution] choosePileFromSplitChoice: invalid choice ${choiceId}`);
    return;
  }

  const sourceName = String(stepData.choosePileFromSplitSourceName || step.sourceName || 'Ability');
  const resolvedStepId = String(step.id || '').trim() || undefined;
  const items: any[] = Array.isArray(stepData.choosePileFromSplitItems) ? stepData.choosePileFromSplitItems : [];
  const originalOrder: string[] = Array.isArray(stepData.choosePileFromSplitOriginalOrder)
    ? stepData.choosePileFromSplitOriginalOrder.map(String)
    : items.map((c: any) => c?.id).filter(Boolean);
  const pileA: string[] = Array.isArray(stepData.choosePileFromSplitPileA) ? stepData.choosePileFromSplitPileA.map(String) : [];
  const pileB: string[] = Array.isArray(stepData.choosePileFromSplitPileB) ? stepData.choosePileFromSplitPileB.map(String) : [];
  const action = String(stepData.choosePileFromSplitChosenAction || '');

  const chosenIds = choiceId === 'pileA' ? pileA : pileB;
  const otherIds = choiceId === 'pileA' ? pileB : pileA;

  const byId = new Map(items.map((c: any) => [String(c?.id || ''), c]));
  const orderedIds = (ids: string[]) => {
    const set = new Set(ids);
    return originalOrder.filter((id) => set.has(id));
  };

  if (action === 'move_cards') {
    const movePlayerId = String(stepData.choosePileFromSplitMovePlayerId || playerId);
    const chosenCards = orderedIds(chosenIds).map((id) => byId.get(id)).filter(Boolean);
    const otherCards = orderedIds(otherIds).map((id) => byId.get(id)).filter(Boolean);
    const chosenDestination = String(stepData.choosePileFromSplitChosenDestination || 'hand');
    const otherDestination = String(stepData.choosePileFromSplitOtherDestination || 'library');

    const state = game.state || {};
    const zones = (state.zones = state.zones || {});
    const z = (zones[movePlayerId] = zones[movePlayerId] || {
      library: [],
      libraryCount: 0,
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    const chosenZone: any[] = Array.isArray((z as any)[chosenDestination]) ? (z as any)[chosenDestination] : [];
    const otherZone: any[] = Array.isArray((z as any)[otherDestination]) ? (z as any)[otherDestination] : [];

    for (const c of chosenCards) chosenZone.push({ ...c, zone: chosenDestination });
    for (const c of otherCards) otherZone.push({ ...c, zone: otherDestination });

    (z as any)[chosenDestination] = chosenZone;
    (z as any)[otherDestination] = otherZone;
    if (chosenDestination === 'hand') z.handCount = chosenZone.length;
    if (chosenDestination === 'library') z.libraryCount = chosenZone.length;
    if (otherDestination === 'hand') z.handCount = otherZone.length;
    if (otherDestination === 'library') z.libraryCount = otherZone.length;

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'choosePileFromSplitResolve', {
        playerId,
        sourceName,
        resolvedStepId,
        choiceId,
        action: 'move_cards',
        movePlayerId,
        chosenDestination,
        otherDestination,
        chosenCards: chosenCards.map((card: any) => ({ ...card })),
        otherCards: otherCards.map((card: any) => ({ ...card })),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist choosePileFromSplitResolve(move_cards):', err);
    }
  } else if (action === 'sacrifice_permanents') {
    const targetPlayerId = String(stepData.choosePileFromSplitTargetPlayerId || playerId);
    const toSacrifice = choiceId === 'pileA' ? pileA : pileB;

    if (!toSacrifice.length) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, targetPlayerId)} chose an empty pile to sacrifice.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const ctx = {
      gameId,
      state: game.state,
      commandZone: (game.state as any).commandZone || {},
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    } as unknown as GameContext;

    const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
    for (const permId of toSacrifice) {
      try {
        const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === String(permId)) as any;
        const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
          ? { ...(permanent.card || {}), zone: 'graveyard' }
          : null;
        const graveyardOwnerId = String(permanent?.owner || permanent?.controller || targetPlayerId || '').trim();
        const moved = movePermanentToGraveyard(ctx, permId, true);
        if (moved && tokenGraveyardSnapshot && graveyardOwnerId) {
          const zones = ((game.state as any).zones = (game.state as any).zones || {});
          const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
            hand: [],
            handCount: 0,
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          });
          playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

          const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
            if (!card) return false;
            const cardId = String((card as any).id || '').trim();
            const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
            if (cardId && snapshotId) return cardId === snapshotId;
            return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
          });

          if (!alreadyPresent) {
            (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
            playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'choosePileFromSplitResolve', {
        playerId,
        sourceName,
        resolvedStepId,
        choiceId,
        action: 'sacrifice_permanents',
        targetPlayerId,
        permanentIds: toSacrifice,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist choosePileFromSplitResolve(sacrifice_permanents):', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, targetPlayerId)} sacrificed ${toSacrifice.length} permanent${toSacrifice.length !== 1 ? 's' : ''}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const chatMessage = String(stepData.choosePileFromSplitChatMessage || '');
  if (chatMessage) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: chatMessage,
      ts: Date.now(),
    });
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}
