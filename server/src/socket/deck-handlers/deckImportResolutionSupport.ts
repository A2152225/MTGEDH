/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: MIN_PRECON_DECK_SIZE, unique card instance ids,
 * createDeckResolutionStatusReporter, and enqueueImportWipeConfirmToResolutionQueue.
 *
 * Public entry symbols: MIN_PRECON_DECK_SIZE, generateUniqueCardInstanceId,
 * createDeckResolutionStatusReporter, enqueueImportWipeConfirmToResolutionQueue.
 */
import * as crypto from "node:crypto";
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src";
import type { ResolveDeckListStatus } from "../../services/deckImport.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import type { PendingConfirm } from "./deckImportConfirmState.js";

// Minimum number of cards to consider a precon import as a "full deck"
export const MIN_PRECON_DECK_SIZE = 50;

/**
 * Generate a unique instance ID for a card to avoid duplicate ID issues
 * when importing multiple copies of the same card (e.g., 12 Forests).
 * The generated ID includes the original Scryfall ID for reference.
 * Uses crypto.randomBytes for better uniqueness guarantees.
 */
let cardInstanceCounter = 0;
export function generateUniqueCardInstanceId(scryfallId: string): string {
  // Use a combination of counter, timestamp, and random bytes for uniqueness
  const counter = (++cardInstanceCounter).toString(36);
  const timestamp = Date.now().toString(36);
  // Use crypto for better randomness
  const randomBytes = crypto.randomBytes(4).toString('hex');
  return `${scryfallId}_${timestamp}_${counter}_${randomBytes}`;
}

export function createDeckResolutionStatusReporter(
  io: Server,
  socket: Socket,
  gameId: string,
  scope: string,
  options: {
    playerId?: PlayerID;
    slowFallbackNotice?: "room" | "socket" | "none";
  } = {},
) {
  let lastLogAt = 0;
  let slowFallbackNotified = false;

  return (status: ResolveDeckListStatus) => {
    const now = Date.now();
    const shouldLog =
      status.phase === "start" ||
      status.phase === "scryfall-slow" ||
      status.phase === "local-load" ||
      status.phase === "done" ||
      status.completed >= status.total ||
      now - lastLogAt >= 1500;

    if (shouldLog) {
      debug(1, `[deck] ${scope} ${status.phase}`, {
        gameId,
        playerId: options.playerId,
        source: status.source,
        completed: status.completed,
        total: status.total,
        message: status.message,
      });
      lastLogAt = now;
    }

    if (!slowFallbackNotified && status.phase === "scryfall-slow") {
      slowFallbackNotified = true;
      const payload = {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Scryfall is slow to respond. Falling back to local card data for deck import.`,
        ts: Date.now(),
      };
      if (options.slowFallbackNotice === "room") {
        io.to(gameId).emit("chat", payload);
      } else if (options.slowFallbackNotice === "socket") {
        socket.emit("chat", payload);
      }
    }
  };
}

/**
 * Deck socket handlers with:
 * - deck import resolution (batch + fallback)
 * - per-game per-player import buffer (_lastImportedDecks)
 * - unanimous import-wipe confirmation workflow (timeout => cancel)
 * - getImportedDeckCandidates read-only accessor
 * - saved deck CRUD (saveDeck, updateSavedDeck, listSavedDecks, getSavedDeck, renameSavedDeck, deleteSavedDeck)
 *
 * Behavior:
 * - Single-player / PRE_GAME imports auto-apply for the importer only (no room wipe).
 * - Multiplayer mid-game imports require unanimous consent and perform the full reset/wipe flow.
 *
 * This file is a merged variant: it restores the original branch content and merges in
 * the importer-only shortcut + robustness fixes (active-player detection, seq===0 handling,
 * libraryCount assignment from parsedCount, and immediate emission of candidates to importer).
 */

export function enqueueImportWipeConfirmToResolutionQueue(
  gameId: string,
  confirmId: string,
  pendingConfirm: PendingConfirm,
  voters: PlayerID[],
  timeoutMs: number
) {
  try {
    const initiator = pendingConfirm.initiator;
    const deckName = pendingConfirm.deckName;
    const resolvedCount = pendingConfirm.resolvedCards?.length || 0;
    const expectedCount = pendingConfirm.parsedCount;

    for (const pid of voters) {
      // Initiator is auto-yes in the legacy flow.
      if (pid === initiator) continue;

      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find(s => (s as any)?.importWipeConfirm === true && String((s as any)?.confirmId || '') === String(confirmId));
      if (existing) continue;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: pid,
        sourceName: 'Deck Import',
        description: `Confirm deck import wipe${deckName ? `: ${deckName}` : ''}. This will reset the game state.`,
        mandatory: true,
        timeoutMs,
        options: [
          { id: 'accept', label: 'Approve' },
          { id: 'decline', label: 'Reject' },
        ],
        minSelections: 1,
        maxSelections: 1,

        importWipeConfirm: true,
        kind: 'import',
        confirmId,
        initiator,
        deckName,
        resolvedCount,
        expectedCount,
        voters,
      } as any);
    }
  } catch (err) {
    debugWarn(1, 'enqueueImportWipeConfirmToResolutionQueue failed', err);
  }
}

