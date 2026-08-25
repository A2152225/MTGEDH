/**
 * socket/resolution-handlers/optionChoiceMayRevealHandWinHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster: OPTION_CHOICE resume for may-reveal-hand / if-you-do four-zone
 *   named-copy win (Hedron Alignment family). Generic — uses the source's
 *   current name at execute time, not a hardcoded card name.
 * Public: handleMayRevealHandWinIfOwnNamedChoice
 *
 * Called directly from optionChoiceResponseHandlers. Must not import
 * resolution.ts or applyInstantSorcerySpecialCaseSpellEffects.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { applyWinIfOwnNamedInFourZones } from "../../../../rules-engine/src/oracleIRExecutorMayRevealHandWinIfOwnNamed.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";
import { getPlayerName } from "../util.js";

function readChooserHand(state: any, playerId: string): any[] {
  const player = Array.isArray(state?.players)
    ? state.players.find((entry: any) => String(entry?.id || '').trim() === playerId)
    : undefined;
  const fromPlayer = Array.isArray(player?.hand) ? player.hand : [];
  const fromZones = Array.isArray(state?.zones?.[playerId]?.hand) ? state.zones[playerId].hand : [];
  return fromPlayer.length > 0 ? fromPlayer : fromZones;
}

function cardDisplayName(card: any): string {
  return String(card?.name || card?.card?.name || card?.id || 'Unknown').trim();
}

export async function handleMayRevealHandWinIfOwnNamedChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = String(response.playerId || '').trim();
  const controllerId = String(stepData.oracleIrControllerId || playerId || '').trim();
  const sourceName = String(stepData.oracleIrSourceName || step.sourceName || 'Ability').trim() || 'Ability';
  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const state = game?.state;

  if (!choiceId || choiceId === 'decline' || choiceId === 'dont') {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId as any)} declined to reveal their hand.`,
      ts: Date.now(),
    });
    if (typeof game?.bumpSeq === 'function') game.bumpSeq();
    return;
  }

  if (choiceId !== 'reveal') return;

  const hand = readChooserHand(state, controllerId);
  const handNames = hand.map((card) => cardDisplayName(card)).filter(Boolean);
  const revealed = handNames.length > 0 ? handNames.join(', ') : '(empty)';
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId as any)} reveals their hand: ${revealed}.`,
    ts: Date.now(),
  });

  if (!state || !controllerId) {
    if (typeof game?.bumpSeq === 'function') game.bumpSeq();
    return;
  }

  const description = String(stepData.description || '').trim();
  const winReason = /win the game/i.test(description)
    ? description
    : `${sourceName}: you win the game`;
  const next = applyWinIfOwnNamedInFourZones(
    state,
    controllerId,
    sourceName,
    winReason,
  );
  Object.assign(state, next);
  if (state.winner && !state.gameOver) {
    state.gameOver = true;
  }
  if (typeof game?.bumpSeq === 'function') game.bumpSeq();
}
