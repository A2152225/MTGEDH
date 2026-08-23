/**
 * socket/resolutionVoteProliferateLimDulResponseHandlers.ts
 *
 * VOTE / PROLIFERATE / LIM_DULS_VAULT response handlers (CR 701.38 / 701.28 / Lim-Dul's Vault).
 * Extracted from resolution.ts and wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { trackCountersPlacedThisTurn } from "../state/modules/counters_tokens.js";
import { maybeResumeOracleIRStepsAfterResolution } from "../state/modules/oracleIrServerZoneSync.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import { processPendingLimDulsVault } from "./resolutionProcessPendingHandlers.js";
import { appendGameEvent, getPlayerName } from "./util.js";

/**
 * Handle Proliferate resolution response
 * 
 * Player chooses any number of permanents and/or players with counters
 * and adds one counter of each kind already there.
 * 
 * Reference: Rule 701.28 - Proliferate
 */
export function handleProliferateResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: string[] (array of target IDs to proliferate)
  const selectedTargetIds = Array.isArray(selections) ? selections : (selections?.selectedTargetIds || []);
  
  const proliferateStep = step as any;
  const proliferateId = proliferateStep.proliferateId;
  
  debug(2, `[Resolution] Proliferate response: player=${pid}, targets=${selectedTargetIds.length}`);
  
  const battlefield = game.state?.battlefield || [];
  const proliferatedTargets: string[] = [];
  
  // Process each selected target
  for (const targetId of selectedTargetIds) {
    // Check if it's a permanent
    const permanent = battlefield.find((p: any) => p?.id === targetId);
    if (permanent && permanent.counters) {
      // Add one counter of each kind the permanent has
      const counters = permanent.counters as Record<string, number>;
      const deltas: Record<string, number> = {};
      for (const counterType of Object.keys(counters)) {
        if (counters[counterType] > 0) {
          deltas[counterType] = 1;
          (permanent.counters as any)[counterType] = counters[counterType] + 1;
        }
      }
      if (Object.keys(deltas).length > 0) {
        trackCountersPlacedThisTurn(game.state, permanent, String(targetId), deltas);
      }
      proliferatedTargets.push(permanent.card?.name || 'permanent');
      continue;
    }
    
    // Check if it's a player
    const players = game.state?.players || [];
    const player = players.find((p: any) => p.id === targetId);
    if (player && player.counters) {
      // Add one counter of each kind the player has
      const counters = player.counters as Record<string, number>;
      for (const counterType of Object.keys(counters)) {
        if (counters[counterType] > 0) {
          player.counters[counterType] = counters[counterType] + 1;
        }
      }
      proliferatedTargets.push(getPlayerName(game, targetId));
    }
  }
  
  // Emit chat message
  let message = `${getPlayerName(game, pid)} proliferates`;
  if (proliferatedTargets.length > 0) {
    message += `: ${proliferatedTargets.join(', ')}`;
  } else {
    message += ` (no targets chosen)`;
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
    appendEvent(gameId, game.seq ?? 0, "proliferateResolve", { 
      playerId: pid, 
      resolvedStepId: String((step as any).id || ''),
      targetIds: selectedTargetIds,
      proliferateId,
    });
  } catch {
    // Ignore persistence failures
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}


/**
 * Handle Vote resolution response
 * 
 * Player votes for one of the available choices. Votes are collected in APNAP order.
 * 
 * Reference: Rule 701.38 - Vote
 */
export function handleVoteResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: string (the chosen option) or { choice: string, voteCount?: number }
  const choice = typeof selections === 'string' ? selections : selections?.choice;
  const voteCount = typeof selections === 'object' ? (selections?.voteCount || 1) : 1;
  
  const voteStep = step as any;
  const voteId = voteStep.voteId;
  const choices = voteStep.choices || [];
  const votesSubmitted = Array.isArray(voteStep.votesSubmitted) ? [...voteStep.votesSubmitted] : [];
  const voterOrder: string[] = Array.isArray(voteStep.oracleIrVoterOrder)
    ? voteStep.oracleIrVoterOrder.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  const secret = Boolean(voteStep.secret);
  
  debug(2, `[Resolution] Vote response: player=${pid}, choice=${choice}, voteCount=${voteCount}`);
  
  if (!choice || !choices.includes(choice)) {
    debugWarn(2, `[Resolution] Invalid vote choice: ${choice}`);
    return;
  }
  
  // Store the vote (this would be used when all votes are collected)
  const voteResult = {
    playerId: pid,
    choice,
    voteCount,
  };
  votesSubmitted.push(voteResult);
  
  // Update game state with the vote
  const voteState = (game.state as any).activeVotes = (game.state as any).activeVotes || {};
  if (!voteState[voteId]) {
    voteState[voteId] = {
      choices,
      votes: [],
    };
  }
  voteState[voteId].votes.push(voteResult);
  
  // Emit chat message (hide secret votes until the ballot closes)
  let message = secret
    ? `${getPlayerName(game, pid)} has voted`
    : `${getPlayerName(game, pid)} votes for "${choice}"`;
  if (!secret && voteCount > 1) {
    message += ` (${voteCount} votes)`;
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
    appendEvent(gameId, game.seq ?? 0, "voteSubmit", { 
      playerId: pid, 
      resolvedStepId: String((step as any).id || ''),
      voteId,
      choices,
      choice,
      voteCount,
      secret,
    });
  } catch {
    // Ignore persistence failures
  }

  const submittedPlayerIds = new Set(votesSubmitted.map((v: any) => String(v?.playerId || '').trim()));
  const remainingVoters = voterOrder.filter((id) => !submittedPlayerIds.has(id));
  if (remainingVoters.length > 0) {
    const nextVoter = String(remainingVoters[0] || '').trim();
    // Rebuild voter-relative ballots (Secret council "another player" excludes the voter).
    let nextChoices = choices;
    try {
      const parsed = JSON.parse(String(voteStep.oracleIrChoiceStepJson || '[]'));
      const voteIrStep = Array.isArray(parsed) ? parsed[0] : null;
      const ballot = String(voteIrStep?.ballot || '').trim();
      const ballotFilter = String(voteIrStep?.ballotFilter || '').toLowerCase();
      if (ballot === 'players' && nextVoter) {
        const players = Array.isArray(game.state?.players)
          ? game.state.players.map((p: any) => String(p?.id || '').trim()).filter(Boolean)
          : [];
        nextChoices = players.filter((id: string) => {
          if (/\banother\s+player\b|\beach\s+other\s+player\b/i.test(ballotFilter) && id === nextVoter) {
            return false;
          }
          return true;
        });
      }
    } catch {
      // keep prior choices
    }
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.VOTE,
      playerId: nextVoter,
      description: String(voteStep.description || 'Vote'),
      mandatory: true,
      sourceId: voteStep.sourceId,
      sourceName: voteStep.sourceName,
      voteId,
      choices: nextChoices,
      votesSubmitted,
      secret,
      oracleIrVoterOrder: voterOrder,
      oracleIrChoiceStepJson: voteStep.oracleIrChoiceStepJson,
      oracleIrControllerId: voteStep.oracleIrControllerId,
      oracleIrSourceId: voteStep.oracleIrSourceId,
      oracleIrSourceName: voteStep.oracleIrSourceName,
      oracleIrResumeStepsJson: voteStep.oracleIrResumeStepsJson,
      oracleIrXValue: voteStep.oracleIrXValue,
    } as any);
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    return;
  }

  // All votes in â€” tally and resume Oracle IR with counts.
  const voteChoiceCounts: Record<string, number> = {};
  for (const entry of votesSubmitted) {
    const key = String(entry?.choice || '').trim().toLowerCase();
    if (!key) continue;
    voteChoiceCounts[key] = (voteChoiceCounts[key] || 0) + (Number(entry?.voteCount) || 1);
  }
  let winningVoteChoice: string | null | undefined = undefined;
  {
    let max = -1;
    let winner: string | null = null;
    let tie = false;
    for (const [key, count] of Object.entries(voteChoiceCounts)) {
      if (count > max) {
        max = count;
        winner = key;
        tie = false;
      } else if (count === max) {
        tie = true;
      }
    }
    if (max >= 0) winningVoteChoice = tie ? null : winner;
  }

  (game.state as any).lastVoteResults = voteChoiceCounts;
  (game.state as any).voteResults = voteChoiceCounts;
  (game.state as any).votesReceivedByPlayer = { ...voteChoiceCounts };
  voteState[voteId].complete = true;
  voteState[voteId].voteChoiceCounts = voteChoiceCounts;

  if (secret) {
    const revealParts = Object.entries(voteChoiceCounts)
      .map(([key, count]) => `${key}: ${count}`)
      .join(', ');
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Votes revealed${revealParts ? ` (${revealParts})` : ''}`,
      ts: Date.now(),
    });
  }

  if (String(voteStep.oracleIrResumeStepsJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumeStep = {
      ...voteStep,
      oracleIrVoteChoiceCounts: voteChoiceCounts,
      oracleIrWinningVoteChoice: winningVoteChoice,
      response,
    };
    maybeResumeOracleIRStepsAfterResolution(ctx, resumeStep);
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}


export function handleLimDulsVaultResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  const action = String(selections?.action || 'finish');
  const orderedIds = Array.isArray(selections?.orderedIds)
    ? selections.orderedIds.map((value: any) => String(value || '')).filter(Boolean)
    : [];
  const vaultStep = step as any;
  const cards: any[] = Array.isArray(vaultStep.cards) ? vaultStep.cards : [];
  const byId = new Map<string, any>(cards.map((card: any) => [String(card?.id || ''), card]));
  const orderedCards = orderedIds.map((id: string) => byId.get(id)).filter(Boolean);

  const originalLib = (game as any).libraries?.get(pid) || [];
  const lib = Array.isArray(originalLib) ? originalLib.map((card: any) => ({ ...card })) : [];
  const extracted = orderedIds.map((id: string) => {
    const idx = lib.findIndex((card: any) => String(card?.id || '') === id);
    if (idx < 0) return null;
    const [removed] = lib.splice(idx, 1);
    return removed;
  }).filter(Boolean) as any[];
  const extractedById = new Map<string, any>(extracted.map((card: any) => [String(card?.id || ''), card]));
  const orderedResolvedCards = orderedIds.map((id: string) => extractedById.get(id)).filter(Boolean);
  const pendingEntry = ((game.state as any)?.pendingLimDulsVault || {})[pid] || {};
  const totalLifePaidBefore = Number(pendingEntry?.totalLifePaid || vaultStep.totalLifePaid || 0);

  if (action === 'continue') {
    appendGameEvent(game, gameId, 'limDulsVaultContinue', {
      playerId: pid,
      effectId: vaultStep.effectId,
      sourceName: vaultStep.sourceName,
      sourceImage: vaultStep.sourceImage,
      orderedBottomIds: orderedIds,
      lifePaid: 1,
      totalLifePaid: totalLifePaidBefore + 1,
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} pays 1 life and continues with ${vaultStep.sourceName || "Lim-Dul's Vault"}.`,
      ts: Date.now(),
    });

    processPendingLimDulsVault(io, game, gameId);
    return;
  }

  let shuffledRemainder = lib.map((card: any) => ({ ...card }));
  if (typeof (game as any).shuffleLibrary === 'function') {
    const shadowGame = {
      ...(game as any),
      libraries: new Map((game as any).libraries || []),
    };
    shadowGame.libraries.set(pid, shuffledRemainder);
    shadowGame.shuffleLibrary(pid);
    const shuffled = shadowGame.libraries.get(pid);
    shuffledRemainder = Array.isArray(shuffled)
      ? shuffled.map((card: any) => ({ ...card }))
      : shuffledRemainder;
  } else {
    for (let i = shuffledRemainder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledRemainder[i], shuffledRemainder[j]] = [shuffledRemainder[j], shuffledRemainder[i]];
    }
  }

  appendGameEvent(game, gameId, 'limDulsVaultResolve', {
    playerId: pid,
    effectId: vaultStep.effectId,
    sourceName: vaultStep.sourceName,
    sourceImage: vaultStep.sourceImage,
    orderedTopIds: orderedIds,
    shuffledRemainderIds: shuffledRemainder.map((card: any) => String(card?.id || '')).filter(Boolean),
    totalLifePaid: totalLifePaidBefore,
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} finishes resolving ${vaultStep.sourceName || "Lim-Dul's Vault"}.`,
    ts: Date.now(),
  });
}

