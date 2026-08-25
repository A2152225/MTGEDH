/**
 * socket/resolution-handlers/optionChoiceDungeonRoomPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the three OPTION_CHOICE prompts a dungeon room asks once it has been entered -
 * `dungeonRoomPenaltyChoice` (pay by discarding or sacrificing, or take the life loss when the player
 * declines or has nothing to pay with), `dungeonRoomFreeCastFromHandChoice` (cast one revealed card
 * for free or keep them) and `dungeonRoomThroneChoice` (Throne of the Dead Three: put the chosen
 * creature from the library onto the battlefield with three +1/+1 counters and hexproof, then
 * shuffle).
 * Public entry symbols: handleDungeonRoomPenaltyChoice, handleDungeonRoomFreeCastFromHandChoice,
 * handleDungeonRoomThroneChoice.
 *
 * Every branch always returned, so each call site is `await handler(...); return;`. The Throne branch
 * keeps its dynamic imports so the battlefield-entry helpers stay lazily loaded.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  applyDungeonTargetPlayerEffect,
  buildDungeonRoomPenaltyFollowUpStep,
} from "../../state/modules/dungeon-effects.js";
import {
  ResolutionQueueManager,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debugWarn } from "../../utils/debug.js";
import { requestCastSpellForSocket } from "../game-actions.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { putCardOntoBattlefield } from "../resolutionPutCardOntoBattlefieldUtils.js";
import { emitToPlayer, getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** A room whose cost is "discard a card / sacrifice a permanent, or lose N life". */
export async function handleDungeonRoomPenaltyChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceData = stepData.dungeonRoomPenaltyChoice as any;
  const choiceId = String(extractOptionChoiceSelectionId(response.selections) || '').trim().toLowerCase();
  const affectedPlayerId = String(step.playerId || playerId || '').trim();
  const sourceId = String(step.sourceId || '').trim();
  const sourceName = String(choiceData.sourceName || step.sourceName || 'Dungeon').trim() || 'Dungeon';
  const dungeonId = String(choiceData.dungeonId || '').trim();
  const roomId = String(choiceData.roomId || '').trim();
  const amount = Math.max(0, Number(choiceData.amount || 0));
  const paymentType = String(choiceData.paymentType || '').trim().toLowerCase();
  const wantsToPay =
    (paymentType === 'discard' && choiceId === 'discard_card') ||
    (paymentType === 'sacrifice' && choiceId === 'sacrifice_permanent');

  const appendChoiceResolveEvent = async (choice: 'discard' | 'sacrifice' | 'lose_life') => {
    try {
      await appendEvent(
        gameId,
        Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
        'dungeonRoomPenaltyChoiceResolve',
        {
          playerId: affectedPlayerId,
          resolvedStepId: String(step.id || '').trim(),
          sourceId,
          sourceName,
          dungeonId,
          currentRoomId: roomId,
          amount,
          choice,
        },
      );
    } catch (err) {
      debugWarn(1, '[resolution] appendEvent(dungeonRoomPenaltyChoiceResolve) failed:', err);
    }
  };

  if (!wantsToPay) {
    applyDungeonTargetPlayerEffect(game as any, affectedPlayerId as PlayerID, {
      dungeonId,
      roomId,
      amount,
    });
    await appendChoiceResolveEvent('lose_life');

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, affectedPlayerId)} loses ${amount} life because of ${sourceName}.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const followUpStep = buildDungeonRoomPenaltyFollowUpStep(
    game as any,
    affectedPlayerId as PlayerID,
    {
      dungeonId,
      roomId,
      amount,
      paymentType: paymentType as 'discard' | 'sacrifice',
      sourceName,
    },
    sourceId,
  );

  if (!followUpStep) {
    applyDungeonTargetPlayerEffect(game as any, affectedPlayerId as PlayerID, {
      dungeonId,
      roomId,
      amount,
    });
    await appendChoiceResolveEvent('lose_life');

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, affectedPlayerId)} loses ${amount} life because of ${sourceName}.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  await appendChoiceResolveEvent(paymentType === 'discard' ? 'discard' : 'sacrifice');

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, followUpStep as any);
  appendQueuedResolutionPromptEvent(game, gameId, {
    playerId: affectedPlayerId,
    sourceId: String((queuedResolutionStep as any)?.sourceId || sourceId || '').trim(),
    queuedResolutionStep,
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: paymentType === 'discard'
      ? `${getPlayerName(game, affectedPlayerId)} chose to discard a card for ${sourceName}.`
      : `${getPlayerName(game, affectedPlayerId)} chose to sacrifice a permanent for ${sourceName}.`,
    ts: Date.now(),
  });
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}

/** A room that reveals cards and offers one free cast. */
export async function handleDungeonRoomFreeCastFromHandChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceData = stepData.dungeonRoomFreeCastFromHandChoice as any;
  const chosenId = String(extractOptionChoiceSelectionId(response.selections) || 'decline').trim();
  const sourceId = String(step.sourceId || '').trim();
  const sourceName = String(choiceData.sourceName || step.sourceName || 'Dungeon').trim() || 'Dungeon';
  const dungeonId = String(choiceData.dungeonId || '').trim();
  const roomId = String(choiceData.roomId || '').trim();

  try {
    await appendEvent(
      gameId,
      Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
      'dungeonRoomFreeCastChoiceResolve',
      {
        playerId,
        resolvedStepId: String(step.id || '').trim(),
        sourceId,
        sourceName,
        dungeonId,
        currentRoomId: roomId,
        choice: chosenId === 'decline' ? 'decline' : 'cast',
        chosenCardId: chosenId === 'decline' ? undefined : chosenId,
      },
    );
  } catch (err) {
    debugWarn(1, '[resolution] appendEvent(dungeonRoomFreeCastChoiceResolve) failed:', err);
  }

  if (chosenId === 'decline') {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} keeps the revealed cards from ${sourceName}.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const fakeSocket: any = {
    data: { playerId, spectator: false },
    emit: (event: string, payload: unknown) => {
      emitToPlayer(io, playerId as any, event as any, payload);
    },
  };

  await requestCastSpellForSocket(
    io,
    fakeSocket,
    { gameId, cardId: chosenId },
    {
      skipPriorityCheck: true,
      forcedAlternateCostId: 'free',
      castWithoutPayingManaCost: true,
    },
  );

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} casts a revealed card from ${sourceName} without paying its mana cost.`,
    ts: Date.now(),
  });
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}

/** Throne of the Dead Three: put the chosen creature onto the battlefield buffed, then shuffle. */
export async function handleDungeonRoomThroneChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceData = stepData.dungeonRoomThroneChoice as any;
  const chosenId = String(extractOptionChoiceSelectionId(response.selections) || '').trim();
  const sourceId = String(step.sourceId || '').trim();
  const sourceName = String(choiceData.sourceName || step.sourceName || 'Throne of the Dead Three').trim() || 'Throne of the Dead Three';
  const dungeonId = String(choiceData.dungeonId || '').trim();
  const roomId = String(choiceData.roomId || '').trim();
  const revealedCards = Array.isArray(choiceData.revealedCards) ? choiceData.revealedCards as any[] : [];
  const chosenCard = revealedCards.find((card: any) => String(card?.id || '') === chosenId);
  if (!chosenCard) {
    debugWarn(2, '[resolution] dungeonRoomThroneChoice: selected card was not among revealed cards');
    return;
  }

  const state = game.state || {};
  const zones = state.zones = state.zones || {};
  const z = zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
  const lib: any[] = Array.isArray((game as any).libraries?.get?.(playerId)) ? (game as any).libraries.get(playerId) : [];
  const libraryIndex = lib.findIndex((card: any) => String(card?.id || '') === chosenId);
  if (libraryIndex === -1) {
    debugWarn(2, '[resolution] dungeonRoomThroneChoice: selected card is no longer in the library');
    return;
  }

  const [libraryCard] = lib.splice(libraryIndex, 1);
  const random = typeof (game as any).rng === 'function' ? (game as any).rng.bind(game) : Math.random;
  for (let index = lib.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [lib[index], lib[swapIndex]] = [lib[swapIndex], lib[index]];
  }
  z.libraryCount = lib.length;
  (game as any).libraries?.set?.(playerId, lib);

  const { uid, parsePT, cardManaValue } = await import('../../state/utils.js');
  const { applyCounterModifications } = await import('../../state/modules/counters_tokens.js');
  const { getETBTriggersForPermanent } = await import('../../state/modules/triggered-abilities.js');
  const { triggerETBEffectsForPermanent } = await import('../../state/modules/triggerEtbPermanentEffects.js');
  const { detectEntersWithCounters } = await import('../../state/modules/detectEntersWithCounters.js');
  const { creatureWillHaveHaste } = await import('../../state/modules/creatureEntryHasteUtils.js');
  const { checkPermanentEntersTapped } = await import('../../state/modules/triggerPermanentEntersTapped.js');
  const battlefield = state.battlefield = state.battlefield || [];
  const createdPermanentId = await putCardOntoBattlefield(
    libraryCard,
    String(playerId),
    false,
    state,
    battlefield,
    uid,
    parsePT,
    cardManaValue,
    applyCounterModifications,
    getETBTriggersForPermanent,
    triggerETBEffectsForPermanent,
    detectEntersWithCounters,
    creatureWillHaveHaste,
    checkPermanentEntersTapped,
    game,
    io,
    gameId,
  );

  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === createdPermanentId) as any;
  if (permanent) {
    permanent.counters = permanent.counters || {};
    permanent.counters['+1/+1'] = (permanent.counters['+1/+1'] || 0) + 3;
    permanent.grantedAbilities = Array.isArray(permanent.grantedAbilities) ? permanent.grantedAbilities : [];
    if (!permanent.grantedAbilities.includes('Hexproof')) {
      permanent.grantedAbilities.push('Hexproof');
    }
    permanent.untilNextTurnGrants = Array.isArray(permanent.untilNextTurnGrants) ? permanent.untilNextTurnGrants : [];
    permanent.untilNextTurnGrants.push({
      controllerId: String(playerId),
      turnApplied: Number(state.turnNumber || 0),
      grantedAbilities: ['Hexproof'],
      sourceName,
      kind: 'hexproof',
    });
  }

  try {
    await appendEvent(
      gameId,
      Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
      'dungeonRoomThroneResolve',
      {
        playerId,
        resolvedStepId: String(step.id || '').trim(),
        sourceId,
        sourceName,
        dungeonId,
        currentRoomId: roomId,
        selectedCard: { ...libraryCard },
        createdPermanentId,
        turnApplied: Number(state.turnNumber || 0),
        selectedCardId: String(libraryCard?.id || chosenId || '').trim(),
        remainingLibraryIds: lib.map((card: any) => String(card?.id || '')).filter(Boolean),
      },
    );
  } catch (err) {
    debugWarn(1, '[resolution] appendEvent(dungeonRoomThroneResolve) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} puts ${libraryCard?.name || 'a creature'} onto the battlefield from ${sourceName}.`,
    ts: Date.now(),
  });
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}
