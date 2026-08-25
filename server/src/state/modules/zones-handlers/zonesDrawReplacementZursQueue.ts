// server/src/state/modules/zones-handlers/zonesDrawReplacementZursQueue.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: getOpponentsForPlayer, queueZursWeirdingOpponentStep,
// getPlayerNameFromState, queueZursWeirdingDrawReplacementStep.
// Public entry symbols: getOpponentsForPlayer, queueZursWeirdingOpponentStep,
// queueZursWeirdingDrawReplacementStep.

import type { PlayerID } from "../../../../../shared/src/types.js";
import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";

export function getOpponentsForPlayer(state: any, playerId: string): string[] {
  const players = Array.isArray(state?.players) ? state.players : [];
  return players
    .map((player: any) => String(player?.id || '').trim())
    .filter((id: string) => id.length > 0 && id !== String(playerId || '').trim());
}

export function queueZursWeirdingOpponentStep(
  ctx: GameContext,
  playerId: string,
  revealedCard: any,
  remainingDrawCountAfterChoice: number,
  opponentIndex: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const pending = (ctx.state as any).zursWeirdingPendingDraw;
  const opponents = Array.isArray(pending?.opponents) ? pending.opponents : getOpponentsForPlayer(ctx.state, playerId);
  const decidingOpponentId = String(opponents[opponentIndex] || '').trim();
  if (!decidingOpponentId) {
    return false;
  }

  const cardName = String(revealedCard?.name || 'the top card of the library').trim() || 'the top card of the library';
  ResolutionQueueManager.addStep(gameId, {
    id: uid('zurs_weirding'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: decidingOpponentId as PlayerID,
    sourceId: String(pending?.sourceName || "Zur's Weirding"),
    sourceName: String(pending?.sourceName || "Zur's Weirding"),
    description: `Zur's Weirding: ${getPlayerNameFromState(ctx.state, playerId)} would draw ${cardName}. You may pay 2 life to put it into their graveyard.`,
    mandatory: false,
    minSelections: 0,
    maxSelections: 1,
    zursWeirdingOpponentChoice: true,
    drawingPlayerId: playerId,
    decidingOpponentId,
    opponentIndex,
    revealedCard: {
      id: String(revealedCard?.id || '').trim(),
      name: cardName,
    },
    remainingDrawCountAfterChoice,
    opponents,
    options: [
      { id: 'pay_2_life', label: 'Pay 2 life (put card in graveyard)' },
      { id: 'decline', label: 'Decline' },
    ],
  } as any);
  return true;
}

function getPlayerNameFromState(state: any, playerId: string): string {
  const players = Array.isArray(state?.players) ? state.players : [];
  const player = players.find((entry: any) => String(entry?.id || '') === String(playerId || ''));
  return String(player?.name || playerId || 'Player');
}

export function queueZursWeirdingDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const library = ctx.libraries.get(playerId as PlayerID) || [];
  if (library.length === 0) return false;

  const topCard = library[0];
  const opponents = getOpponentsForPlayer(ctx.state, playerId);
  (ctx.state as any).zursWeirdingPendingDraw = {
    drawingPlayerId: playerId,
    sourceName: String(metadata?.sourceName || "Zur's Weirding"),
    revealedCard: {
      id: String(topCard?.id || '').trim(),
      name: String(topCard?.name || 'Card').trim() || 'Card',
    },
    remainingDrawCountAfterChoice,
    opponents,
    nextOpponentIndex: 0,
  };

  if (opponents.length === 0) {
    return false;
  }

  return queueZursWeirdingOpponentStep(ctx, playerId, topCard, remainingDrawCountAfterChoice, 0);
}

