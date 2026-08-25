// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: buildExploreDecisionFromStep, applyExploreStep, applyManifestDreadStep,
// applyConniveStep, applyRegisterLoseGameReplacementStep, applyGainLifeStep,
// applyLoseLifeStep, applyAddPlayerCounterStep, applyDoublePlayerCountersStep,
// applyDrawStep (+ exclusive resolveDynamicDrawAmount/readPower/resolveSourcePower).
// Public entries: buildExploreDecisionFromStep, applyExploreStep, applyManifestDreadStep,
// applyConniveStep, applyRegisterLoseGameReplacementStep, applyGainLifeStep,
// applyLoseLifeStep, applyAddPlayerCounterStep, applyDoublePlayerCountersStep, applyDrawStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';
import { resolveBoundSelfOrSourceCreatureTargetId } from './oracleIRExecutorBoundSelfCreatureTarget';
import { resolveCreatureTargetIds } from './oracleIRExecutorCreatureStepUtils';
import { buildEffectBridgeOptions } from './oracleIRExecutorDamageTransitionCommit';
import { collectForEachReferenceBattlefieldPermanentIds } from './oracleIRExecutorForEachQuantity';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  permanentHasSubtype,
  permanentIsCreature,
  readPermanentPower,
} from './oracleIRExecutorPlayerAddManaAmount';
import {
  filterChosenHandCardIds,
  getNormalizedChosenIds,
  resolveStepAmountForPlayer,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  adjustLife,
  adjustPlayerCounter,
  discardCardsForPlayer,
  discardSpecificCardsForPlayer,
  drawCardsForPlayer,
  getCardManaValue,
  getCardTypeLineLower,
  quantityToNumber,
  readPlayerZoneCards,
  resolvePlayers,
  resolveVotesReceivedQuantity,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerUtils';
import { resolveVariableAmount } from './oracleIRExecutorPlayerVariableAmount';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
} from './oracleIRExecutorZoneOps';

function readPower(value: any): number {
  if (!value) return 0;
  if (typeof value.effectivePower === 'number') return value.effectivePower;
  let power = typeof value.basePower === 'number' ? value.basePower : undefined;
  if (typeof power !== 'number') {
    const rawPower = value.card?.power ?? value.power;
    power = typeof rawPower === 'string' ? Number.parseInt(rawPower, 10) : Number(rawPower);
  }
  if (!Number.isFinite(power)) power = 0;
  const counters = (value.counters || {}) as Record<string, number>;
  power += Math.max(0, Number(counters['+1/+1']) || 0);
  power -= Math.max(0, Number(counters['-1/-1']) || 0);
  return power;
}

function resolveSourcePower(state: GameState, ctx: OracleIRExecutionContext): number | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  const source = ((state.battlefield || []) as any[]).find((perm) => String(perm?.id || '').trim() === sourceId);
  return source ? Math.max(0, readPower(source)) : null;
}

function resolveDynamicDrawAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'draw' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): number | null {
  const amountRaw = String((step.amount as any)?.raw || '').trim().toLowerCase();
  if (/the milled card'?s mana value/.test(amountRaw)) {
    const milled = [
      ...(Array.isArray((ctx as any).lastMilledCards) ? (ctx as any).lastMilledCards : []),
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    if (milled.length > 0) {
      const manaValue = getCardManaValue(milled[milled.length - 1]);
      if (manaValue !== null) return manaValue;
    }
  }

  const fromShared = resolveOracleQuantity(state, ctx.controllerId, step.amount, ctx, {
    whereX: step.whereX,
    runtime,
  });
  if (fromShared !== null) return fromShared;

  if (step.amount.kind === 'source_power') return resolveSourcePower(state, ctx);
  if (step.amount.kind === 'greatest_power_among_creatures_you_control') {
    const controllerId = String(ctx.controllerId || '').trim();
    const excludeSubtype = step.amount.excludeSubtype;
    const powers = ((state.battlefield || []) as any[])
      .filter((permanent) => String(permanent?.controller || '').trim() === controllerId)
      .filter(permanentIsCreature)
      .filter((permanent) => !permanentHasSubtype(permanent, excludeSubtype))
      .map(readPermanentPower)
      .filter((value): value is number => value !== null);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }
  if (step.amount.kind === 'votes_received') {
    return resolveVotesReceivedQuantity(state, String(ctx.controllerId || ''), step.amount);
  }
  if (step.amount.kind === 'votes_for_choice') {
    const fromState = Number(
      (state as any)?.lastVoteResults?.[String(step.amount.choice || '').toLowerCase()] ??
        (state as any)?.voteResults?.[String(step.amount.choice || '').toLowerCase()]
    );
    if (Number.isFinite(fromState)) {
      const multiplier = Number.isFinite(Number(step.amount.multiplier))
        ? Math.max(0, Math.trunc(Number(step.amount.multiplier)))
        : 1;
      return Math.max(0, Math.floor(fromState * multiplier));
    }
  }
  return quantityToNumber(step.amount, ctx);
}

export function buildExploreDecisionFromStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'explore' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly playerId: PlayerID;
  readonly permanentId: string;
  readonly permanentName: string;
  readonly revealedCard: {
    readonly id: string;
    readonly name: string;
    readonly type_line?: string;
    readonly imageUrl?: string;
    readonly cmc?: number;
  };
  readonly isLand: boolean;
} | null {
  let targetId = resolveBoundSelfOrSourceCreatureTargetId(state, step.target, ctx);
  if (!targetId) {
    const targetIds = resolveCreatureTargetIds(state, step.target, ctx);
    targetId = targetIds[0];
  }
  if (!targetId) return null;

  const target = (state.battlefield || []).find(
    (perm: any) => String(perm?.id || '').trim() === targetId
  ) as any;
  if (!target) return null;

  const controllerId = String(target?.controller || ctx.controllerId || '').trim() as PlayerID;
  const player = state.players.find((entry: any) => String(entry?.id || '').trim() === controllerId) as any;
  if (!player) return null;

  const library = Array.isArray(player.library) ? player.library : [];
  if (library.length <= 0) return null;

  const topCard = library[0];
  const isLand = getCardTypeLineLower(topCard).includes('land');

  return {
    playerId: controllerId,
    permanentId: targetId,
    permanentName: String(target?.card?.name || target?.name || targetId || 'Creature'),
    revealedCard: {
      id: String(topCard?.id || topCard?.card?.id || 'revealed-card'),
      name: String(topCard?.name || topCard?.card?.name || 'Unknown'),
      type_line: String(topCard?.type_line || topCard?.card?.type_line || ''),
      imageUrl: topCard?.imageUrl || topCard?.image_uris?.normal || topCard?.card?.image_uris?.normal,
      cmc: Number(topCard?.cmc ?? topCard?.card?.cmc ?? 0) || 0,
    },
    isLand,
  };
}

export function applyExploreStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'explore' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  let targetIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetIds.length === 0) {
    const singleTargetId = resolveBoundSelfOrSourceCreatureTargetId(state, step.target, ctx);
    if (singleTargetId) targetIds = [singleTargetId];
  }
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped explore (requires deterministic target): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const remainingPermanentIds = targetIds.length > 1 ? targetIds.slice(1) : [];
  const targetId = targetIds[0];

  const battlefield = [...((state.battlefield || []) as any[])];
  const targetIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === targetId);
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped explore (target not on battlefield): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const target = battlefield[targetIndex] as any;
  const controllerId = String(target?.controller || ctx.controllerId || '').trim();
  const player = state.players.find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped explore (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  if (library.length <= 0) {
    return {
      applied: true,
      state,
      log: [`${targetId} explored, but ${controllerId} had no cards to reveal`],
    };
  }

  const topCard = library[0];
  const typeLine = getCardTypeLineLower(topCard);
  const nextPlayers = state.players.map((p: any) => ({ ...p }));
  const playerIndex = nextPlayers.findIndex((p: any) => String(p?.id || '').trim() === controllerId);
  if (playerIndex < 0) {
    return {
      applied: false,
      message: `Skipped explore (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const log: string[] = [`${targetId} explored and revealed ${String(topCard?.name || 'a card')}`];
  if (typeLine.includes('land') && remainingPermanentIds.length === 0) {
    library.shift();
    hand.push(topCard);
    nextPlayers[playerIndex] = {
      ...nextPlayers[playerIndex],
      library,
      hand,
    };
    return {
      applied: true,
      state: { ...(state as any), players: nextPlayers as any } as GameState,
      log: [...log, `${controllerId} put the revealed land into their hand`],
    };
  }

  // Keeping the revealed nonland card on top is the no-op branch of the choice, so it is the safe
  // default when the caller asked for deterministic resolution instead of a prompt - matching how
  // scry, surveil and look_select_top treat interactivePlayerChoices === false.
  const exploreToGraveyard =
    ctx.selectorContext?.exploreToGraveyard ?? (ctx.interactivePlayerChoices === false ? false : undefined);
  if (typeof exploreToGraveyard !== 'boolean') {
    return {
      applied: false,
      message: `Skipped explore (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          permanentId: targetId,
          revealedCardId: String(topCard?.id || topCard?.card?.id || ''),
          isLand: typeLine.includes('land'),
          ...(remainingPermanentIds.length > 0 ? { remainingPermanentIds } : {}),
        },
      },
    };
  }

  const counters = { ...((target?.counters || {}) as Record<string, number>) };
  const currentCount = Number(counters['+1/+1'] ?? 0);
  counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + 1;
  battlefield[targetIndex] = {
    ...target,
    counters,
  };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  if (exploreToGraveyard) {
    library.shift();
    graveyard.push({ ...topCard, zone: 'graveyard', faceDown: false });
  }

  nextPlayers[playerIndex] = {
    ...nextPlayers[playerIndex],
    library,
    graveyard,
  };

  return {
    applied: true,
    state: { ...(state as any), players: nextPlayers as any, battlefield } as GameState,
    log: [
      ...log,
      exploreToGraveyard
        ? `Added 1 +1/+1 counter to ${targetId} and milled the revealed card`
        : `Added 1 +1/+1 counter to ${targetId} and left the revealed card on top`,
    ],
  };
}

export function applyManifestDreadStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'manifest_dread' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped manifest dread (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const movedCards: any[] = [];
  const movedPermanentIds: string[] = [];

  for (const playerId of players) {
    const player = nextState.players.find((p: any) => String(p?.id || '').trim() === String(playerId || '').trim()) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped manifest dread (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    if (library.length <= 0) {
      log.push(`${playerId} manifested dread, but had no cards in library`);
      continue;
    }

    const looked = library.slice(0, 2);
    const manifestedCard = looked[0];
    const rest = looked.slice(1);
    const keptLibrary = library.slice(looked.length);
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const newPermanent = createBattlefieldPermanentsFromCards(
      [manifestedCard],
      playerId,
      playerId,
      false,
      true,
      undefined,
      'library'
    );
    const updatedPlayers = nextState.players.map((p: any) =>
      String(p?.id || '').trim() === String(playerId || '').trim()
        ? ({
            ...p,
            library: keptLibrary,
            graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(nextState, rest)],
          } as any)
        : p
    );
    nextState = addBattlefieldPermanentsToState(
      { ...(nextState as any), players: updatedPlayers as any } as GameState,
      newPermanent as any
    );
    movedCards.push(manifestedCard, ...rest);
    movedPermanentIds.push(...newPermanent.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    log.push(
      `${playerId} manifested ${String(manifestedCard?.name || 'a card')} from among the top ${looked.length} card(s) of their library`
    );
    if (rest.length > 0) {
      log.push(`${playerId} put ${rest.length} remaining looked card(s) into their graveyard`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastMovedCards: movedCards,
  };
}

export function applyConniveStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'connive' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const targetId = resolveBoundSelfOrSourceCreatureTargetId(state, step.target, ctx);
  const controllerId = (String(ctx.controllerId || 'p1').trim() || 'p1') as PlayerID;

  let amount =
    resolveOracleQuantity(state, controllerId, step.amount, ctx, {
      targetCreatureId: targetId,
      runtime,
    }) ?? quantityToNumber(step.amount, ctx);

  if (amount === null) {
    const raw = String(step.amount?.kind === 'reference_amount' ? step.amount.raw : step.raw || '');
    const whereMatch = raw.match(/where x is (.+)$/i);
    if (whereMatch) {
      amount = evaluateModifyPtWhereX(
        state,
        controllerId,
        `X is ${String(whereMatch[1] || '').trim()}`,
        targetId,
        ctx,
        runtime
      );
    }
  }

  if (amount === null || amount <= 0) {
    return {
      applied: false,
      message: `Skipped connive (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  if (!targetId) {
    return {
      applied: false,
      message: `Skipped connive (requires deterministic target): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const battlefield = [...((state.battlefield || []) as any[])];
  const targetIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === targetId);
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped connive (target not on battlefield): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const target = battlefield[targetIndex] as any;
  const targetControllerId = String(target?.controller || ctx.controllerId || '').trim();
  const player = state.players.find((p: any) => String(p?.id || '').trim() === targetControllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped connive (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const handLength = Array.isArray(player.hand) ? player.hand.length : 0;
  const libraryLength = Array.isArray(player.library) ? player.library.length : 0;
  let chosenIds = [...filterChosenHandCardIds(state, targetControllerId as PlayerID, getNormalizedChosenIds(ctx))];
  if (chosenIds.length > amount) {
    chosenIds = chosenIds.slice(0, amount);
  }
  if (chosenIds.length > 0 && chosenIds.length !== amount) {
    chosenIds = [];
  }

  if (chosenIds.length > 0) {
    if (chosenIds.length !== amount) {
      return {
        applied: false,
        message: `Skipped connive (expected ${amount} discard choice(s), got ${chosenIds.length}): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const discardResult = discardSpecificCardsForPlayer(state, targetControllerId as PlayerID, chosenIds);
    if (!discardResult.applied) {
      return {
        applied: false,
        message: `Skipped connive (invalid discard choice): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const discardedNonlands = discardResult.discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length;
    let nextState = discardResult.state as GameState;
    const log = [...discardResult.log];

    if (discardedNonlands > 0) {
      const counters = { ...((target?.counters || {}) as Record<string, number>) };
      const currentCount = Number(counters['+1/+1'] ?? 0);
      counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + discardedNonlands;
      battlefield[targetIndex] = {
        ...target,
        counters,
      };
      nextState = { ...(nextState as any), battlefield } as GameState;
      log.push(`Added ${discardedNonlands} +1/+1 counter(s) to ${targetId}`);
    }

    return {
      applied: true,
      state: nextState,
      log,
      lastDiscardedCardCount: discardResult.discardedCount,
      lastDiscardedCards: discardResult.discardedCards,
      lastMovedCards: discardResult.discardedCards,
    };
  }

  const drawnCount = Math.min(amount, Math.max(0, libraryLength));
  if (handLength + drawnCount < amount) {
    return {
      applied: false,
      message: `Skipped connive (not enough cards to discard): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const drawResult = drawCardsForPlayer(state, targetControllerId as PlayerID, amount);
  const playerAfterDraw = drawResult.state.players.find((entry: any) => String(entry?.id || '').trim() === targetControllerId) as any;
  const handAfterDraw = Array.isArray(playerAfterDraw?.hand) ? playerAfterDraw.hand : [];

  if (handAfterDraw.length > amount) {
    return {
      applied: false,
      state: drawResult.state,
      message: `Skipped connive (requires discard choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const discardResult = discardCardsForPlayer(drawResult.state, targetControllerId as PlayerID, amount);
  const discardedNonlands = discardResult.discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length;
  const log = [...drawResult.log, ...discardResult.log];

  if (discardedNonlands > 0) {
    const counters = { ...((target?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters['+1/+1'] ?? 0);
    counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + discardedNonlands;
    battlefield[targetIndex] = {
      ...target,
      counters,
    };
    return {
      applied: true,
      state: { ...(discardResult.state as any), battlefield } as GameState,
      log: [...log, `Added ${discardedNonlands} +1/+1 counter(s) to ${targetId}`],
      lastDiscardedCardCount: discardResult.discardedCount,
      lastDiscardedCards: discardResult.discardedCards,
      lastMovedCards: discardResult.discardedCards,
    };
  }

  return {
    applied: true,
    state: discardResult.state,
    log,
    lastDiscardedCardCount: discardResult.discardedCount,
    lastDiscardedCards: discardResult.discardedCards,
    lastMovedCards: discardResult.discardedCards,
  };
}

export function applyRegisterLoseGameReplacementStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'register_lose_game_replacement' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped lose-game replacement registration (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const drawCount = Math.max(0, Number(step.drawCount) || 0);
  const lifeTotal = Math.max(0, Number(step.lifeTotal) || 0);
  const sourceName = String(ctx.sourceName || '').trim() || 'Unknown source';
  const nextState = { ...(state as any) } as GameState;
  const pending = Array.isArray((nextState as any).pendingLoseGameReplacements)
    ? [...(nextState as any).pendingLoseGameReplacements]
    : [];

  for (const playerId of players) {
    pending.push({
      playerId,
      drawCount,
      lifeTotal,
      sourceName,
      expiresAt: step.expiresAt || 'end_of_turn',
    });
  }

  (nextState as any).pendingLoseGameReplacements = pending;
  return {
    applied: true,
    state: nextState,
    log: [`Registered lose-the-game replacement for ${players.join(', ')}`],
  };
}

function readExiledPermanentPower(entry: any): number {
  const numeric = Number(
    entry?.effectivePower ?? entry?.power ?? entry?.basePower ?? entry?.card?.power,
  );
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

export function applyGainLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  if (step.who.kind === 'each_controller_of_those') {
    const amountIsItsManaValue =
      (step.amount.kind === 'reference_amount' && /^its mana value$/i.test(String(step.amount.raw || ''))) ||
      (step.amount.kind === 'object_stat' && step.amount.stat === 'mana_value');
    if (amountIsItsManaValue) {
      const cards = [
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
        ...(Array.isArray((ctx as any).lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
      ] as any[];
      if (cards.length > 0) {
        let nextState = state;
        const log: string[] = [];
        let totalGained = 0;
        const replayMutations: OracleIRReplayMutation[] = [];
        for (const card of cards) {
          const playerId = String(card?.controller || card?.controllerId || controllerId || '').trim() as PlayerID;
          const amount = Math.max(0, getCardManaValue(card) ?? (Number(card?.cmc ?? card?.manaValue ?? 0) || 0));
          if (!playerId || amount <= 0) continue;
          const result = adjustLife(nextState, playerId, amount);
          nextState = result.state;
          log.push(...result.log);
          totalGained += amount;
          replayMutations.push({ kind: 'adjustLife', playerId, delta: amount });
        }
        if (totalGained > 0) {
          return {
            applied: true,
            state: nextState,
            log,
            count: totalGained,
            replayMutations,
          };
        }
      }
    }
  }

  if (
    step.amount?.kind === 'object_stat' &&
    step.amount.stat === 'power' &&
    (step.amount.subject === 'it' || step.amount.subject === 'that_creature') &&
    step.who?.kind === 'target_player'
  ) {
    const exiledSnapshots = Array.isArray(runtime?.lastMovedCards) && runtime.lastMovedCards.length > 0
      ? runtime.lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
    if (exiledSnapshots.length > 1) {
      let nextState = state;
      const log: string[] = [];
      const replayMutations: OracleIRReplayMutation[] = [];
      let totalGained = 0;
      for (const snapshot of exiledSnapshots) {
        const playerId = String(snapshot?.controller || snapshot?.controllerId || '').trim() as PlayerID;
        const amount = readExiledPermanentPower(snapshot);
        if (!playerId || amount <= 0) continue;
        const result = adjustLife(nextState, playerId, amount);
        nextState = result.state;
        log.push(...result.log);
        totalGained += amount;
        replayMutations.push({ kind: 'adjustLife', playerId, delta: amount });
      }
      if (totalGained > 0) {
        return {
          applied: true,
          state: nextState,
          log,
          count: totalGained,
          replayMutations,
        };
      }
    }
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life gain (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  let lastCount = 0;
  const replayMutations: OracleIRReplayMutation[] = [];
  for (const playerId of players) {
    const amount =
      resolveStepAmountForPlayer(state, controllerId, step.amount, ctx, playerId, {
        whereX: step.whereX,
        runtime,
      }) ??
      resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped life gain (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    lastCount = amount;
    const result = adjustLife(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
    if (amount > 0) {
      replayMutations.push({ kind: 'adjustLife', playerId, delta: amount });
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    count: lastCount,
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}

export function applyLoseLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'lose_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life loss (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  let totalLifeLost = 0;
  const replayMutations: OracleIRReplayMutation[] = [];
  const firstAmount =
    resolveStepAmountForPlayer(state, controllerId, step.amount, ctx, players[0], {
      whereX: step.whereX,
      runtime,
    }) ??
    resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (
    step.optional === true
    && ctx?.interactivePlayerChoices
    && firstAmount !== null
    && firstAmount > 0
  ) {
    return {
      applied: false,
      message: `Deferred optional life payment (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: { lifeAmount: firstAmount },
      },
    };
  }
  for (const playerId of players) {
    const amount =
      playerId === players[0] && firstAmount !== null
        ? firstAmount
        : resolveStepAmountForPlayer(state, controllerId, step.amount, ctx, playerId, {
            whereX: step.whereX,
            runtime,
          }) ??
          resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped life loss (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }

    const playerBefore = nextState.players.find((player) => player.id === playerId) as any;
    const previousLife = Number(playerBefore?.life);
    const result = adjustLife(nextState, playerId, -amount);
    nextState = result.state;
    log.push(...result.log);

    const playerAfter = nextState.players.find((player) => player.id === playerId) as any;
    const nextLife = Number(playerAfter?.life);
    if (Number.isFinite(previousLife) && Number.isFinite(nextLife)) {
      totalLifeLost += Math.max(0, previousLife - nextLife);
    }
    if (amount > 0) {
      replayMutations.push({ kind: 'adjustLife', playerId, delta: -amount });
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    count: totalLifeLost,
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}

export function applyAddPlayerCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_player_counter' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped player counter addition (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped player counter addition (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustPlayerCounter(nextState, playerId, step.counter, amount);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped player counter addition (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }
    nextState = result.state;
  }

  return { applied: true, state: nextState, log };
}

function collectPlayerCounters(player: any, state: GameState, playerId: PlayerID): Record<string, number> {
  const counters: Record<string, number> = { ...((player?.counters || {}) as Record<string, number>) };
  const assign = (counter: string, value: unknown) => {
    const amount = Math.max(0, Number(value) || 0);
    if (amount > 0) counters[counter] = Math.max(amount, Number(counters[counter]) || 0);
  };
  assign('poison', player?.poisonCounters ?? (state as any)?.poisonCounters?.[playerId]);
  assign('energy', player?.energyCounters ?? player?.energy);
  assign('experience', player?.experienceCounters ?? player?.experience ?? (state as any)?.experienceCounters?.[playerId]);
  assign('rad', player?.radCounters);
  assign('ticket', player?.ticketCounters);
  return Object.fromEntries(
    Object.entries(counters)
      .map(([counter, amount]) => [counter, Math.max(0, Number(amount) || 0)] as const)
      .filter(([, amount]) => amount > 0)
  );
}

export function applyDoublePlayerCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'double_player_counters' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped player counter doubling (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const player = nextState.players.find((candidate) => candidate.id === playerId) as any;
    const counters = collectPlayerCounters(player, nextState, playerId);
    for (const [counter, amount] of Object.entries(counters)) {
      const result = adjustPlayerCounter(nextState, playerId, counter, amount);
      log.push(...result.log);
      if (!result.applied) {
        return {
          applied: false,
          message: log.join('\n') || `Skipped player counter doubling (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
        };
      }
      nextState = result.state;
    }
  }

  return { applied: true, state: nextState, log };
}

export function applyDrawStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'draw' }>,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped draw (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  let lastCount = 0;
  let lastAntecedentBattlefieldPermanentIds: string[] | undefined;
  const replayMutations: OracleIRReplayMutation[] = [];
  const bridgeOptions = buildEffectBridgeOptions(ctx, 'draw');
  let ledgerRecordedViaBridge = false;
  for (const playerId of players) {
    const amount =
      resolveStepAmountForPlayer(state, ctx.controllerId, step.amount, ctx, playerId, {
        whereX: step.whereX,
        runtime,
      }) ?? resolveDynamicDrawAmount(state, step, {
        ...ctx,
        selectorContext: { ...(ctx.selectorContext || {}), targetPlayerId: playerId },
      }, runtime);
    if (amount === null) {
      return {
        applied: false,
        message: `Skipped draw (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    if (step.amount?.kind === 'reference_amount') {
      const antecedentIds = collectForEachReferenceBattlefieldPermanentIds(
        state,
        ctx.controllerId,
        String(step.amount.raw || ''),
        ctx,
        { runtime, targetPlayerId: playerId },
      );
      if (antecedentIds.length > 0) {
        lastAntecedentBattlefieldPermanentIds = [...antecedentIds];
      }
    }
    lastCount = amount;
    const playerBeforeDraw = nextState.players.find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
    const handIdsBeforeDraw = new Set(
      readPlayerZoneCards(nextState, playerId, playerBeforeDraw, 'hand')
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean),
    );
    const result = drawCardsForPlayer(nextState, playerId, amount, bridgeOptions);
    if (result.halted) {
      return withDiscardLedgerFlags({
        applied: true,
        state: nextState,
        log,
        count: 0,
      }, ledgerRecordedViaBridge);
    }
    nextState = result.state;
    log.push(...result.log);
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    if (amount > 0) {
      const playerAfterDraw = nextState.players.find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
      const drawnCardIds = readPlayerZoneCards(nextState, playerId, playerAfterDraw, 'hand')
        .map((card: any) => String(card?.id || '').trim())
        .filter((id: string) => id && !handIdsBeforeDraw.has(id));
      replayMutations.push({
        kind: 'drawCards',
        playerId,
        count: amount,
        ...(drawnCardIds.length > 0 ? { drawnCardIds } : {}),
      });
    }
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    count: lastCount,
    ...(lastAntecedentBattlefieldPermanentIds
      ? { lastAntecedentBattlefieldPermanentIds }
      : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  }, ledgerRecordedViaBridge);
}
