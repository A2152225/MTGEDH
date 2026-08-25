// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyScryStep, applyFatesealStep, applyVoteStep, applyClashStep.
// Public entries: applyScryStep, applyFatesealStep, applyVoteStep, applyClashStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { commitLibraryTopObservation } from './oracleIRExecutorCardZoneTransitionCommit';
import {
  resolveStepAmountForPlayer,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  collectTopLibraryObservationForPlayers,
  deriveWinningVoteChoice,
  getCardManaValue,
  quantityToNumber,
  resolvePlayers,
} from './oracleIRExecutorPlayerUtils';
import { usedOracleIrServerBridge } from './oracleIRStepLedgerRuntime';

export function applyScryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'scry' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped scry (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const amount = resolveStepAmountForPlayer(
    state,
    ctx.controllerId,
    step.amount,
    ctx,
    players.length === 1 ? players[0] : step.whereX ? players[0] : undefined,
    { whereX: step.whereX },
  );
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped scry (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Scry ${amount} (no-op): ${step.raw}`],
      lastScryLookedAtCount: 0,
    };
  }

  if (ctx.selectorContext?.scryResolutionComplete === true) {
    const keepTopOrder = Array.isArray(ctx.selectorContext?.keepTopOrder)
      ? ctx.selectorContext.keepTopOrder
      : [];
    const bottomOrder = Array.isArray(ctx.selectorContext?.bottomOrder)
      ? ctx.selectorContext.bottomOrder
      : [];
    const lookedCount = keepTopOrder.length + bottomOrder.length;
    return {
      applied: true,
      state,
      log: [`Scry ${lookedCount} (resolution applied): ${step.raw}`],
      lastScryLookedAtCount: lookedCount,
      skipLedgerFlush: true,
    };
  }

  const { cards: observedCards, lookedCount } = collectTopLibraryObservationForPlayers(state, players, amount);
  const observationCarryOver = observedCards.length > 0
    ? { lastMovedCards: observedCards, lastScryLookedAtCount: lookedCount }
    : { lastScryLookedAtCount: 0 };
  let ledgerRecordedViaBridge = false;
  const bridgeOptions = usedOracleIrServerBridge(ctx)
    ? { ctx, stepIndex: Number(ctx.currentStepIndex), stepKind: step.kind }
    : undefined;

  // Empty library: Scry N is a no-op (same as surveil). Do not block later
  // independent instructions such as "scry 1 and you gain 1 life".
  const wouldNeedChoice = observedCards.length > 0;

  if (wouldNeedChoice) {
    if (bridgeOptions && observedCards.length > 0 && Number.isFinite(bridgeOptions.stepIndex)) {
      const observation = commitLibraryTopObservation({
        playerId: ctx.controllerId,
        cards: observedCards,
        stepIndex: Number(bridgeOptions.stepIndex),
        stepKind: String(bridgeOptions.stepKind || 'scry'),
        cause: 'oracle_ir:scry',
        ctx: bridgeOptions.ctx,
      });
      if (observation.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state,
          log: [`Scry ${amount} halted for replacement: ${step.raw}`],
          lastScryLookedAtCount: lookedCount,
        }, ledgerRecordedViaBridge);
      }
      if (observation.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }
    }
    return withDiscardLedgerFlags({
      applied: false,
      message: `Skipped scry (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
      ...observationCarryOver,
    }, ledgerRecordedViaBridge);
  }

  return {
    applied: true,
    state,
    log: [`Scry ${amount} (no cards in library): ${step.raw}`],
    lastScryLookedAtCount: 0,
  };
}

export function applyFatesealStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'fateseal' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped fateseal (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped fateseal (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped fateseal (requires deterministic controller): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const actingPlayerId = players[0];
  const targets = resolvePlayers(state, step.target, ctx).filter(playerId => playerId !== actingPlayerId);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped fateseal (unsupported target selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (targets.length !== 1) {
    return {
      applied: false,
      message: `Skipped fateseal (requires deterministic opponent): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetPlayerId = targets[0];
  const targetPlayer = state.players.find((player: any) => String(player?.id || '').trim() === String(targetPlayerId || '').trim()) as any;
  if (!targetPlayer) {
    return {
      applied: false,
      message: `Skipped fateseal (target player not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const library = Array.isArray(targetPlayer.library) ? targetPlayer.library : [];
  const lookedAtCount = Math.min(Math.max(0, amount), library.length);
  return {
    applied: true,
    state,
    log: [
      lookedAtCount > 0
        ? `${actingPlayerId} fatesealed ${targetPlayerId} for ${lookedAtCount} card(s) and left them in the same order`
        : `${actingPlayerId} fatesealed ${targetPlayerId} for 0 card(s)`,
    ],
  };
}

export function applyVoteStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'vote' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const voters = resolvePlayers(state, step.voters, ctx);
  if (voters.length === 0) {
    return {
      applied: false,
      message: `Skipped vote (unsupported voter selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const ballot = step.ballot || 'labels';
  const hintCounts =
    ctx.voteChoiceCounts && typeof ctx.voteChoiceCounts === 'object'
      ? Object.fromEntries(
          Object.entries(ctx.voteChoiceCounts).map(([key, value]) => [
            String(key || '').trim().toLowerCase(),
            Number(value) || 0,
          ])
        )
      : null;

  // Player/permanent ballots (Secret council) need tallies before follow-on effects can scale.
  if (ballot === 'players' || ballot === 'permanents') {
    if (!hintCounts || Object.keys(hintCounts).length === 0) {
      return {
        applied: false,
        message: `Skipped vote (requires ${ballot} ballot selections): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const receivedByPlayer =
      ballot === 'players'
        ? { ...hintCounts }
        : ((state as any).votesReceivedByPlayer && typeof (state as any).votesReceivedByPlayer === 'object'
            ? { ...(state as any).votesReceivedByPlayer }
            : {});
    const receivedByPermanent =
      ballot === 'permanents' ? { ...hintCounts } : ((state as any).votesReceivedByPermanent || {});

    return {
      applied: true,
      state: {
        ...(state as any),
        lastVoteResults: hintCounts,
        voteResults: hintCounts,
        votesReceivedByPlayer: receivedByPlayer,
        votesReceivedByPermanent: receivedByPermanent,
        lastVoteMeta: {
          secret: Boolean(step.secret),
          ballot,
          ...(step.ballotFilter ? { ballotFilter: step.ballotFilter } : {}),
          voters,
        },
      } as GameState,
      log: [
        `${voters.length} player(s) voted${step.secret ? ' secretly' : ''} (${ballot} ballot)`,
      ],
    };
  }

  const normalizedChoices = (step.choices || []).map(choice => String(choice || '').trim().toLowerCase()).filter(Boolean);
  const winningVoteChoice = deriveWinningVoteChoice(ctx);
  if (typeof winningVoteChoice === 'undefined') {
    return {
      applied: false,
      message: `Skipped vote (requires vote choices): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (hintCounts && normalizedChoices.length > 0) {
    const overlap = normalizedChoices.some((choice) => Object.prototype.hasOwnProperty.call(hintCounts, choice));
    if (!overlap) {
      return {
        applied: false,
        message: `Skipped vote (requires vote choices): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
  }

  if (winningVoteChoice === '') {
    return {
      applied: false,
      message: `Skipped vote (winning choice unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const nextState = {
    ...(state as any),
    ...(hintCounts
      ? {
          lastVoteResults: hintCounts,
          voteResults: hintCounts,
        }
      : {}),
    lastVoteMeta: {
      secret: Boolean(step.secret),
      ballot: 'labels' as const,
      voters,
      winningVoteChoice,
    },
  } as GameState;

  if (winningVoteChoice === null) {
    return {
      applied: true,
      state: nextState,
      log: [`${voters.length} player(s) voted and the vote tied`],
    };
  }

  const normalizedWinner = String(winningVoteChoice).toLowerCase();
  if (normalizedChoices.length > 0 && !normalizedChoices.includes(normalizedWinner)) {
    return {
      applied: false,
      message: `Skipped vote (winning choice not in parsed choices): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  return {
    applied: true,
    state: nextState,
    log: [
      `${voters.length} player(s) voted and ${String(winningVoteChoice)} won`,
    ],
  };
}

export function applyClashStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'clash' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped clash (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped clash (requires deterministic player): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const playerId = players[0];
  const player = state.players.find((p: any) => String(p?.id || '').trim() === String(playerId || '').trim()) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped clash (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let opponentId: PlayerID | null = null;
  if (step.opponent) {
    const opponents = resolvePlayers(state, step.opponent, ctx);
    if (opponents.length === 0) {
      const controllerOpponents = (state.players || []).filter((p: any) => String(p?.id || '').trim() !== String(playerId || '').trim());
      return {
        applied: false,
        message: `Skipped clash (requires opponent selection): ${step.raw}`,
        reason: controllerOpponents.length > 1 ? 'player_choice_required' : 'unsupported_player_selector',
        options: { classification: controllerOpponents.length > 1 ? 'player_choice' : 'ambiguous' },
      };
    }
    if (opponents.length !== 1) {
      return {
        applied: false,
        message: `Skipped clash (requires deterministic opponent): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    opponentId = opponents[0];
  }

  const playerTopCard = Array.isArray(player.library) && player.library.length > 0 ? player.library[0] : null;
  const playerManaValue = Math.max(0, Number(getCardManaValue(playerTopCard) ?? 0));
  const log: string[] = [];

  if (playerTopCard) {
    log.push(`${playerId} clashed and revealed ${String(playerTopCard?.name || 'a card')} (MV ${playerManaValue})`);
  } else {
    log.push(`${playerId} clashed but had no card to reveal`);
  }

  let lastClashWon = Boolean(playerTopCard);
  if (opponentId) {
    const opponent = state.players.find((p: any) => String(p?.id || '').trim() === String(opponentId || '').trim()) as any;
    if (!opponent) {
      return {
        applied: false,
        message: `Skipped clash (opponent not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const opponentTopCard = Array.isArray(opponent.library) && opponent.library.length > 0 ? opponent.library[0] : null;
    const opponentManaValue = Math.max(0, Number(getCardManaValue(opponentTopCard) ?? 0));
    if (opponentTopCard) {
      log.push(`${opponentId} revealed ${String(opponentTopCard?.name || 'a card')} (MV ${opponentManaValue})`);
    } else {
      log.push(`${opponentId} had no card to reveal`);
    }

    lastClashWon = playerTopCard !== null && playerManaValue > opponentManaValue;
  }

  log.push(lastClashWon ? `${playerId} won the clash` : `${playerId} did not win the clash`);
  return {
    applied: true,
    state,
    log,
    lastClashWon,
  };
}
