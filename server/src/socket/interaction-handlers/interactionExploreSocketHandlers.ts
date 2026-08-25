/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: registerInteractionHandlers socket handlers for
 * beginExplore and beginBatchExplore.
 *
 * These were arrow bodies inside registerInteractionHandlers. They take
 * io/socket and ensureInRoomAndSeated explicitly; registration now just
 * calls them.
 *
 * Public entry symbols: handleBeginExploreRequest, handleBeginBatchExploreRequest.
 */
import type { Server, Socket } from "socket.io";
import { getPlayerName } from "../util";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { getBattlefield, type EnsureInRoomAndSeated } from "./interactionRoomAndBattlefield.js";

// Explore: Reveal top card, if land put in hand, else +1/+1 counter and may put in graveyard
export async function handleBeginExploreRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  payload?: { gameId?: unknown; permanentId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  const permanentId = payload?.permanentId;

  if (!permanentId || typeof permanentId !== 'string') return;

  const ctx = ensureInRoomAndSeated(gameId);
  if (!ctx) return;

  const { gameId: gid, game, pid } = ctx;
  const cards = game.peekTopN(pid, 1);
  
  if (!cards || cards.length === 0) {
    // Empty library - creature still explores but nothing happens
    io.to(gid).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: gid,
      from: "system",
      message: `${getPlayerName(game, pid)}'s creature explores (empty library).`,
      ts: Date.now(),
    });
    return;
  }

  const revealedCard = cards[0];
  const typeLine = (revealedCard.type_line || "").toLowerCase();
  const isLand = typeLine.includes("land");

  // Find the exploring permanent for its name
  const battlefield = getBattlefield(game);
  const exploringPerm = battlefield.find((p: any) => p.id === permanentId && p.controller === pid);
  const exploringName = exploringPerm?.card?.name || "Creature";

  // Migrate legacy explorePrompt flow to Resolution Queue.
  ResolutionQueueManager.addStep(gid, {
    type: ResolutionStepType.EXPLORE_DECISION,
    playerId: pid as any,
    mandatory: true,
    sourceId: permanentId,
    sourceName: exploringName,
    description: `${exploringName} explores`,
    permanentId,
    permanentName: exploringName,
    revealedCard,
    isLand,
  } as any);

  // Announce the reveal to all players
  io.to(gid).emit("chat", {
    id: `m_${Date.now()}`,
    gameId: gid,
    from: "system",
    message: `${getPlayerName(game, pid)}'s ${exploringName} explores, revealing ${revealedCard.name}${isLand ? " (land)" : ""}.`,
    ts: Date.now(),
  });
}

// Batch Explore: Handle multiple creatures exploring at once (e.g., Hakbal triggers)
// NOTE: This implementation peeks at the top card multiple times (once in beginBatchExplore
// and once in the Resolution Queue response handler). This is acceptable because
// peekTopN doesn't modify the library - it only reveals what's there. The actual card
// movement happens when the Resolution Queue step is completed via applyEvent("exploreResolve").
export async function handleBeginBatchExploreRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  payload?: { gameId?: unknown; permanentIds?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  const permanentIds = (payload as any)?.permanentIds as unknown;

  const ctx = ensureInRoomAndSeated(gameId);
  if (!ctx) return;

  const { gameId: gid, game, pid } = ctx;
  
  if (!permanentIds || !Array.isArray(permanentIds) || permanentIds.length === 0) {
    return;
  }

  const explores: Array<{
    permanentId: string;
    permanentName: string;
    revealedCard: any;
    isLand: boolean;
  }> = [];

  for (const permanentId of permanentIds) {
    const cards = game.peekTopN(pid, 1);
    
    if (!cards || cards.length === 0) {
      continue;
    }

    const revealedCard = cards[0];
    const typeLine = (revealedCard.type_line || "").toLowerCase();
    const isLand = typeLine.includes("land");

    const battlefield = game.state?.battlefield || [];
    const exploringPerm = battlefield.find((p: any) => p.id === permanentId && p.controller === pid);
    const exploringName = exploringPerm?.card?.name || "Creature";

    explores.push({
      permanentId,
      permanentName: exploringName,
      revealedCard,
      isLand,
    });
  }

  if (explores.length === 0) {
    io.to(gid).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: gid,
      from: "system",
      message: `${getPlayerName(game, pid)}'s creatures explore (empty library).`,
      ts: Date.now(),
    });
    return;
  }

  // Migrate legacy batchExplorePrompt flow to Resolution Queue.
  ResolutionQueueManager.addStep(gid, {
    type: ResolutionStepType.BATCH_EXPLORE_DECISION,
    playerId: pid as any,
    mandatory: true,
    sourceName: 'Explore',
    description: `Resolve ${explores.length} explore decision${explores.length === 1 ? '' : 's'}`,
    explores,
  } as any);

  const revealedNames = explores.map(e => e.revealedCard.name).join(", ");
  io.to(gid).emit("chat", {
    id: `m_${Date.now()}`,
    gameId: gid,
    from: "system",
    message: `${getPlayerName(game, pid)}'s creatures explore, revealing ${revealedNames}.`,
    ts: Date.now(),
  });
}
