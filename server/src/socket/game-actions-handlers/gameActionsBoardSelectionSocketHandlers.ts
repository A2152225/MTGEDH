/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handlers for
 * requestGraveyardTargets, requestOpponentSelection,
 * requestSacrificeSelection, and changePermanentControl.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handleGraveyardTargetsRequest,
 * handleOpponentSelectionRequest, handleSacrificeSelectionRequest,
 * handleChangePermanentControlRequest.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import { syncPreparedPermanentAfterControlChange } from "../../state/modules/prepared.js";
import { registerControlEffect } from "../../state/modules/continuousEffectRegistry.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { enqueueEdictCreatureSacrificeStep } from "../sacrifice-resolution.js";
import { broadcastGame, ensureGame, getPlayerName } from "../util";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

// ==========================================================================
// GRAVEYARD TARGET SELECTION (Resolution Queue)
// ==========================================================================

/**
 * Legacy entrypoint: Request graveyard card selection.
 * This previously emitted a bespoke `graveyardTargetsResponse` and expected a
 * bespoke `confirmGraveyardTargets` follow-up. It now enqueues a Resolution Queue
 * step so the unified interaction UI can handle it.
 */
export async function handleGraveyardTargetsRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    effectId?: unknown;
    cardName?: unknown;
    filter?: unknown;
    minTargets?: unknown;
    maxTargets?: unknown;
    targetPlayerId?: unknown;
    destination?: unknown;
    title?: unknown;
    description?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const effectId = payload?.effectId;
  const cardName = payload?.cardName;
  const filter = payload?.filter;
  const minTargets = payload?.minTargets;
  const maxTargets = payload?.maxTargets;
  const targetPlayerId = payload?.targetPlayerId;
  const destination = payload?.destination;
  const title = payload?.title;
  const description = payload?.description;

  if (!gameId || typeof gameId !== 'string') return;
  if (!effectId || typeof effectId !== 'string') return;
  if (!cardName || typeof cardName !== 'string') return;
  if (!(filter === undefined || (typeof filter === 'object' && !Array.isArray(filter)))) return;
  if (typeof minTargets !== 'number' || typeof maxTargets !== 'number') return;
  if (!(targetPlayerId === undefined || typeof targetPlayerId === 'string')) return;
  if (!(destination === undefined || destination === 'hand' || destination === 'battlefield' || destination === 'library_top' || destination === 'library_bottom' || destination === 'exile')) return;
  if (!(title === undefined || typeof title === 'string')) return;
  if (!(description === undefined || typeof description === 'string')) return;

  try {
    if (!ensureInGameRoom(gameId, { code: 'NOT_IN_GAME', message: 'Not in game.' })) return;

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    const searchPlayerId = (targetPlayerId as string | undefined) || playerId;
    const zones = game.state.zones?.[searchPlayerId];
    const gy = zones && Array.isArray((zones as any).graveyard) ? ((zones as any).graveyard as any[]) : [];

    const filterObj = (filter as { types?: string[]; subtypes?: string[]; excludeTypes?: string[] } | undefined) || {};
    const validTargets = gy.filter((card: any) => {
      if (!card) return false;
      const typeLine = String(card.type_line || '').toLowerCase();

      if (filterObj.types && filterObj.types.length > 0) {
        if (!filterObj.types.some(t => typeLine.includes(String(t).toLowerCase()))) return false;
      }

      if (filterObj.subtypes && filterObj.subtypes.length > 0) {
        if (!filterObj.subtypes.some(st => typeLine.includes(String(st).toLowerCase()))) return false;
      }

      if (filterObj.excludeTypes && filterObj.excludeTypes.length > 0) {
        if (filterObj.excludeTypes.some(et => typeLine.includes(String(et).toLowerCase()))) return false;
      }

      return true;
    }).map((card: any) => ({
      id: String(card.id),
      name: String(card.name || card.id),
      typeLine: card.type_line,
      manaCost: card.mana_cost,
      imageUrl: card.image_uris?.small || card.image_uris?.normal,
    }));

    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as any)
      .find((s: any) => (s as any)?.type === ResolutionStepType.GRAVEYARD_SELECTION && String((s as any)?.effectId || '') === String(effectId));

    if (!existing) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.GRAVEYARD_SELECTION,
        playerId: playerId as any,
        sourceName: cardName,
        sourceId: effectId,
        description: String((description as string | undefined) || `Select card(s) from ${getPlayerName(game, searchPlayerId)}'s graveyard.`),
        mandatory: Number(minTargets || 0) > 0,
        effectId,
        cardName,
        title: String((title as string | undefined) || cardName || 'Select from Graveyard'),
        targetPlayerId: searchPlayerId,
        filter: filterObj,
        minTargets: Number(minTargets || 0),
        maxTargets: Number(maxTargets || 1),
        destination: (destination as 'hand' | 'battlefield' | 'library_top' | 'library_bottom' | 'exile' | undefined) || 'hand',
        validTargets,
        imageUrl: undefined,
      } as any);
    }

    debug(2, `[requestGraveyardTargets] (Resolution Queue) ${playerId} selecting from ${searchPlayerId}'s graveyard for ${cardName} (${validTargets.length} candidate(s))`);
  } catch (err: any) {
    debugError(1, `requestGraveyardTargets error for game ${gameId}:`, err);
    socket.emit("error", { code: "GRAVEYARD_TARGETS_ERROR", message: err?.message ?? String(err) });
  }
}

// ==========================================================================
// OPPONENT SELECTION (Secret Rendezvous, etc.)
// ==========================================================================

/**
 * Request opponent selection for effects like Secret Rendezvous
 */
export async function handleOpponentSelectionRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    effectId?: unknown;
    cardName?: unknown;
    description?: unknown;
    minOpponents?: unknown;
    maxOpponents?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const effectId = payload?.effectId;
  const cardName = payload?.cardName;
  const description = payload?.description;
  const minOpponents = payload?.minOpponents;
  const maxOpponents = payload?.maxOpponents;

  if (!gameId || typeof gameId !== 'string') return;
  if (!effectId || typeof effectId !== 'string') return;
  if (!cardName || typeof cardName !== 'string') return;
  if (typeof description !== 'string') return;
  if (typeof minOpponents !== 'number' || typeof maxOpponents !== 'number') return;

  try {
    if (!ensureInGameRoom(gameId, { code: 'NOT_IN_GAME', message: 'Not in game.' })) return;

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    const players = game.state?.players || [];
    const opponents = players.filter((p: any) => p && p.id !== playerId).map((p: any) => ({
      id: p.id,
      name: p.name || p.id,
      life: game.state.life?.[p.id] ?? 40,
      libraryCount: game.state.zones?.[p.id]?.libraryCount ?? 0,
      isOpponent: true,
    }));

    // Unified Resolution Queue prompt
    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as any)
      .find((s: any) => (s as any)?.opponentSelection === true && String((s as any)?.effectId || (s as any)?.sourceId || '') === String(effectId));

    if (!existing) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: playerId as any,
        sourceName: cardName,
        sourceId: effectId,
        description,
        mandatory: minOpponents > 0,
        validTargets: opponents.map((o: any) => ({
          id: o.id,
          label: o.name,
          // Client target selection modal infers target kind from `type` or well-known `description`.
          // Use `player` so opponent selections render as player targets.
          type: 'player',
          description: 'player',
        })),
        targetTypes: ['player'],
        minTargets: Math.max(0, minOpponents),
        maxTargets: Math.max(0, maxOpponents),
        targetDescription: 'opponent',
        opponentSelection: true,
        effectId,
        cardName,
      } as any);
    }

    debug(2, `[requestOpponentSelection] Requesting opponent selection for ${cardName}`);
  } catch (err: any) {
    debugError(1, `requestOpponentSelection error for game ${gameId}:`, err);
    socket.emit("error", { code: "OPPONENT_SELECTION_ERROR", message: err?.message ?? String(err) });
  }
}

// ==========================================================================
// SACRIFICE SELECTION FOR EDICT EFFECTS (Grave Pact, Dictate of Erebos, etc.)
// ==========================================================================

/**
 * Request sacrifice selection from a player due to an edict effect
 */
export async function handleSacrificeSelectionRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    effectId?: unknown;
    sourceName?: unknown;
    targetPlayerId?: unknown;
    permanentType?: unknown;
    count?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const effectId = payload?.effectId;
  const sourceName = payload?.sourceName;
  const targetPlayerId = payload?.targetPlayerId;
  const permanentType = payload?.permanentType;
  const count = payload?.count;

  if (!gameId || typeof gameId !== 'string') return;
  if (!effectId || typeof effectId !== 'string') return;
  if (!sourceName || typeof sourceName !== 'string') return;
  if (!targetPlayerId || typeof targetPlayerId !== 'string') return;
  if (!(permanentType === 'creature' || permanentType === 'artifact' || permanentType === 'enchantment' || permanentType === 'land' || permanentType === 'permanent')) return;
  if (typeof count !== 'number') return;

  try {
    if (!ensureInGameRoom(gameId, { code: 'NOT_IN_GAME', message: 'Not in game.' })) return;

    const game = ensureGame(gameId);
    if (!game) return;

    // Hardening: do not allow a client to enqueue sacrifice prompts for other players.
    // Multi-player edicts should be driven by server-side rules resolution, not client requests.
    const playerId = socket.data?.playerId as any;
    const role = (socket.data as any)?.role;
    const isJudge = role === 'judge';
    if (!isJudge && playerId && targetPlayerId && String(targetPlayerId) !== String(playerId)) {
      socket.emit?.('error', {
        code: 'SACRIFICE_SELECTION_NOT_AUTHORIZED',
        message: 'Not authorized.',
      });
      return;
    }

    // Common edict case (Grave Pact / Dictate of Erebos): sacrifice 1 creature.
    // Use Resolution Queue so the unified interaction UI handles it.
    if (permanentType === 'creature' && count === 1) {
      enqueueEdictCreatureSacrificeStep(io as any, game as any, gameId, targetPlayerId, {
        sourceName,
        sourceControllerId: socket.data.playerId,
        reason: `${sourceName} requires you to sacrifice ${count} ${permanentType}(s)`,
        sourceId: effectId,
      });

      debug(2, `[requestSacrificeSelection] (Resolution Queue) ${targetPlayerId} must sacrifice ${count} ${permanentType}(s) due to ${sourceName}`);
      return;
    }

    const battlefield = game.state?.battlefield || [];
    
    // Find valid permanents to sacrifice for target player
    const eligiblePermanents = battlefield.filter((p: any) => {
      if (!p || p.controller !== targetPlayerId) return false;
      const typeLine = (p.card?.type_line || '').toLowerCase();
      
      if (permanentType === 'permanent') return true;
      return typeLine.includes(permanentType);
    }).map((p: any) => ({
      id: p.id,
      name: p.card?.name || p.id,
      typeLine: p.card?.type_line || '',
      imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      power: p.basePower,
      toughness: p.baseToughness,
    }));

    // Unified Resolution Queue prompt for all remaining sacrifice-selection cases.
    const requiredCount = Math.max(0, Number(count || 0));
    const reason = `${sourceName} requires you to sacrifice ${requiredCount} ${permanentType}(s)`;

    if (eligiblePermanents.length === 0 || requiredCount <= 0) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, targetPlayerId)} has no ${permanentType === 'permanent' ? 'permanents' : `${permanentType}s`} to sacrifice.`,
        ts: Date.now(),
      });
      return;
    }

    // If there's no choice (must sacrifice all available), auto-apply.
    if (eligiblePermanents.length <= requiredCount) {
      const ctx = {
        state: game.state,
        libraries: (game as any).libraries,
        bumpSeq: () => {
          if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        },
        rng: (game as any).rng,
        gameId,
      } as any;

      const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
      const sacrificed: string[] = [];

      for (const p of eligiblePermanents) {
        const perm = (game.state?.battlefield || []).find((bp: any) => bp && bp.id === p.id);
        const nm = String(perm?.card?.name || p.name || 'permanent');
        const ok = movePermanentToGraveyard(ctx, p.id, true);
        if (ok) sacrificed.push(nm);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, targetPlayerId)} sacrifices ${sacrificed.join(', ') || 'permanents'} (${sourceName}).`,
        ts: Date.now(),
      });
      broadcastGame(io, game, gameId);
      return;
    }

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: targetPlayerId as any,
      sourceName,
      sourceId: effectId,
      description: reason,
      mandatory: true,
      validTargets: eligiblePermanents.map((p: any) => ({
        id: p.id,
        label: p.name,
        description: 'permanent',
        imageUrl: p.imageUrl,
        typeLine: p.typeLine,
      })),
      targetTypes: ['permanent'],
      minTargets: requiredCount,
      maxTargets: requiredCount,
      targetDescription: `permanent to sacrifice`,

      sacrificeSelection: true,
      sacrificePermanentType: permanentType,
      sacrificeCount: requiredCount,
      sacrificeReason: reason,
      sacrificeSourceName: sourceName,
      sacrificeEffectId: effectId,
    } as any);

    debug(2, `[requestSacrificeSelection] (Resolution Queue) ${targetPlayerId} must sacrifice ${requiredCount} ${permanentType}(s) due to ${sourceName}`);
  } catch (err: any) {
    debugError(1, `requestSacrificeSelection error for game ${gameId}:`, err);
    socket.emit("error", { code: "SACRIFICE_REQUEST_ERROR", message: err?.message ?? String(err) });
  }
}

// ==========================================================================
// CONTROL CHANGE (Humble Defector, Act of Treason, etc.)
// ==========================================================================

/**
 * Change control of a permanent from one player to another.
 * Used by effects like Humble Defector, Act of Treason, Dominate, etc.
 */
export async function handleChangePermanentControlRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    permanentId?: unknown;
    newController?: unknown;
    duration?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const permanentId = payload?.permanentId;
  const newController = payload?.newController;
  const duration = payload?.duration;

  if (!gameId || typeof gameId !== 'string') return;
  if (!permanentId || typeof permanentId !== 'string') return;
  if (!newController || typeof newController !== 'string') return;
  if (!(duration === undefined || duration === 'permanent' || duration === 'eot' || duration === 'turn')) return;

  try {
    if (!ensureInGameRoom(gameId, { code: 'NOT_IN_GAME', message: 'Not in game.' })) return;

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!game || !playerId || spectator) return;

    const battlefield = game.state?.battlefield || [];
    const permanent = battlefield.find((p: any) => p && p.id === permanentId);
    
    if (!permanent) {
      socket.emit("error", { code: "PERMANENT_NOT_FOUND", message: "Permanent not found" });
      return;
    }

    const role = (socket.data as any)?.role;
    const isJudge = role === 'judge';
    if (!isJudge && String(permanent.controller) !== String(playerId)) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized." });
      return;
    }

    const players = ((game.state as any)?.players || []) as any[];
    const targetPlayer = players.find((p: any) => p && String(p.id) === String(newController));
    if (!targetPlayer || targetPlayer.spectator || targetPlayer.isSpectator) {
      socket.emit("error", { code: "INVALID_CONTROLLER", message: "Target controller is not a seated player" });
      return;
    }

    const oldController = permanent.controller;
    const appliedAt = Date.now();
    
    // Change control
    permanent.controller = newController;
    syncPreparedPermanentAfterControlChange(game.state, permanent, String(oldController || ''));
    
    // Track control change for end-of-turn cleanup if temporary
    // Layer 2 registry entry stamped now (temporary ones expire at cleanup).
    registerControlEffect(game.state, {
      permanentId,
      originalController: String(oldController || ''),
      newController,
      duration: duration === 'eot' || duration === 'turn' ? duration : 'permanent',
      appliedAt,
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'changePermanentControl', {
        permanentId,
        oldController,
        newController,
        ...(duration ? { duration } : null),
        ...(duration === 'eot' || duration === 'turn' ? { appliedAt } : null),
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(changePermanentControl) failed:', e);
    }

    const cardName = permanent.card?.name || 'a permanent';
    const oldControllerName = getPlayerName(game, oldController);
    const newControllerName = getPlayerName(game, newController);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `=��� Control of ${cardName} changed from ${oldControllerName} to ${newControllerName}${duration === 'eot' ? ' until end of turn' : ''}.`,
      ts: Date.now(),
    });

    debug(2, `[changePermanentControl] ${cardName} control changed from ${oldController} to ${newController}`);

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `changePermanentControl error for game ${gameId}:`, err);
    socket.emit("error", { code: "CONTROL_CHANGE_ERROR", message: err?.message ?? String(err) });
  }
}
