/**
 * socket/resolutionSyntheticCastSocketUtils.ts
 *
 * Tiny cast-continuation helpers shared by option-choice early specials and
 * color/type choice response handlers. Extracted from resolution.ts so the
 * handler deps seam can inject them without circular factory imports.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { debugWarn } from "../utils/debug.js";
import { emitToPlayer } from "./util.js";

export function appendCastSpellContinuationEvent(
  gameId: string,
  game: any,
  payload: Record<string, unknown>
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'castSpellContinuation', payload);
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(castSpellContinuation) failed:', err);
  }
}


export function createForwardingGameActionSocket(
  io: Server,
  gameId: string,
  playerId: string,
): { socket: any; handlers: Map<string, (...args: any[]) => any> } {
  const handlers = new Map<string, (...args: any[]) => any>();
  const socket: any = {
    data: { gameId, playerId },
    rooms: new Set([gameId]),
    emit: (event: string, payload: any) => {
      emitToPlayer(io, playerId as any, event as any, payload);
    },
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
      return socket;
    },
  };

  return { socket, handlers };
}


export async function restartPlayerCastRequest(
  io: Server,
  gameId: string,
  playerId: string,
  payload: {
    cardId: string;
    faceIndex?: number;
    fromZone?: 'hand' | 'exile' | 'graveyard' | 'library' | 'command';
  },
): Promise<void> {
  const { socket, handlers } = createForwardingGameActionSocket(io, gameId, playerId);
  const { registerGameActions } = await import("./game-actions.js");
  registerGameActions(io, socket as any);

  const requestCastSpell = handlers.get('requestCastSpell');
  if (typeof requestCastSpell !== 'function') {
    throw new Error('Synthetic player socket missing requestCastSpell handler');
  }

  await requestCastSpell({
    gameId,
    cardId: payload.cardId,
    faceIndex: payload.faceIndex,
    fromZone: payload.fromZone,
  });
}

export async function resumePlayerCastSpellFromHand(
  io: Server,
  gameId: string,
  playerId: string,
  payload: {
    cardId: string;
    faceIndex?: number;
    targets?: unknown;
    payment?: unknown;
    skipInteractivePrompts?: boolean;
    skipPriorityCheck?: boolean;
    xValue?: number;
    alternateCostId?: string;
    selectedCastMode?: 'normal' | 'overload';
    convokeTappedCreatures?: string[];
    fromZone?: 'hand' | 'exile' | 'graveyard' | 'library' | 'command';
    bypassExilePermissionCheck?: boolean;
  },
): Promise<void> {
  const { socket, handlers } = createForwardingGameActionSocket(io, gameId, playerId);
  const { registerGameActions } = await import("./game-actions.js");
  registerGameActions(io, socket as any);

  const castSpellFromHand = handlers.get('castSpellFromHand');
  if (typeof castSpellFromHand !== 'function') {
    throw new Error('Synthetic player socket missing castSpellFromHand handler');
  }

  await castSpellFromHand({
    gameId,
    cardId: payload.cardId,
    faceIndex: payload.faceIndex,
    targets: payload.targets,
    payment: payload.payment,
    skipInteractivePrompts: payload.skipInteractivePrompts,
    skipPriorityCheck: payload.skipPriorityCheck,
    xValue: payload.xValue,
    alternateCostId: payload.alternateCostId,
    selectedCastMode: payload.selectedCastMode,
    convokeTappedCreatures: payload.convokeTappedCreatures,
    fromZone: payload.fromZone,
    bypassExilePermissionCheck: payload.bypassExilePermissionCheck,
  });
}

