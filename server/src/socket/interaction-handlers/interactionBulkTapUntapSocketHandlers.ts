/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: registerInteractionHandlers socket handlers for
 * bulkTapPermanentsForMana and untapPermanent.
 *
 * Public entry symbols: handleBulkTapPermanentsForManaRequest,
 * handleUntapPermanentRequest.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { queueTapTriggersForTappedPermanents } from "../../state/modules/tap-trigger-queue.js";
import { getManaAbilitiesForPermanent, getManaMultiplier } from "../../state/modules/mana-abilities";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { creatureHasHaste } from "../game-actions.js";
import {
  getTokenGroupMembers,
  parseGroupedPermanentRef,
  resolveGroupedPermanentRef,
} from "../tokenGroupResolve.js";
import { broadcastGame, broadcastManaPoolUpdate, getPlayerName } from "../util";
import { getBattlefield, type EnsureInRoomAndSeated } from "./interactionRoomAndBattlefield.js";

/**
 * Bulk-tap many permanents for mana in one action (Cryptolith Rite token swarms, etc.).
 * Queues a single color / distribution prompt when abilities produce any color.
 */
export async function handleBulkTapPermanentsForManaRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  payload?: { gameId?: unknown; permanentIds?: unknown; count?: unknown },
): Promise<void> {
    const permanentIdsRaw = payload?.permanentIds;
    if (!Array.isArray(permanentIdsRaw) || permanentIdsRaw.length === 0) return;

    const requestedCount = Number(payload?.count);

    const ctx = ensureInRoomAndSeated(payload?.gameId);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;
    const battlefield = getBattlefield(game);
    const candidateRefs = permanentIdsRaw
      .map((id) => String(id || '').trim())
      .filter(Boolean);

    // Prefer an explicit group id when the client sends virtual refs from emit-side grouping.
    const groupRef = candidateRefs.find((id) => id.startsWith('group_') || id.includes('_virtual_'));
    const parsedGroup = groupRef ? parseGroupedPermanentRef(groupRef) : null;
    const groupId = parsedGroup?.groupId || (
      candidateRefs.length === 1 && String(candidateRefs[0]).startsWith('group_')
        ? String(candidateRefs[0])
        : ''
    );

    const groupMemberCount = groupId ? getTokenGroupMembers(game, groupId).length : 0;
    const maxCount = groupId
      ? Math.max(groupMemberCount, candidateRefs.length)
      : candidateRefs.length;
    const count = Number.isFinite(requestedCount) && requestedCount > 0
      ? Math.min(Math.floor(requestedCount), maxCount)
      : maxCount;

    const usedIds = new Set<string>();
    const resolveNextId = (ref: string): string | null => {
      return resolveGroupedPermanentRef(game, pid as any, ref, { usedIds });
    };

    const tappedIds: string[] = [];
    let sampleAbility: ReturnType<typeof getManaAbilitiesForPermanent>[number] | null = null;
    let sampleCardName = 'creature';
    let samplePermanentId = '';
    let sampleImage: string | undefined;
    let manaMultiplier = 1;

    const tryTapResolvedId = (resolvedId: string): boolean => {
      if (!resolvedId || tappedIds.length >= count || usedIds.has(resolvedId)) return false;
      const permanent = battlefield.find((p: any) => p?.id === resolvedId && p?.controller === pid);
      if (!permanent || (permanent as any).tapped) return false;

      const card = (permanent as any).card;
      const cardName = String(card?.name || 'Unknown');
      const typeLine = String(card?.type_line || '').toLowerCase();
      const isCreature = /\bcreature\b/.test(typeLine);
      const isLand = typeLine.includes('land');

      if (isCreature && !isLand) {
        if ((permanent as any).summoningSickness && !creatureHasHaste(permanent, battlefield, pid)) {
          return false;
        }
      }

      const manaAbilities = getManaAbilitiesForPermanent(game.state, permanent, pid)
        .filter((ability) => {
          const cost = String(ability?.cost || '').toLowerCase().replace(/\s+/g, '');
          return cost === '{t}' || cost === 't';
        });
      if (manaAbilities.length === 0) return false;

      const ability = manaAbilities[0];
      if (!sampleAbility) {
        sampleAbility = ability;
        sampleCardName = cardName;
        samplePermanentId = resolvedId;
        sampleImage = (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal;
        manaMultiplier = Math.max(1, Number(getManaMultiplier(game.state, permanent, pid) || 1));
      }

      (permanent as any).tapped = true;
      usedIds.add(resolvedId);
      tappedIds.push(resolvedId);
      return true;
    };

    if (groupId) {
      for (let i = 0; i < count; i += 1) {
        const resolved =
          resolveNextId(`${groupId}_virtual_${i}`)
          || resolveNextId(groupId);
        if (!resolved) break;
        if (!tryTapResolvedId(resolved)) {
          // Skip unusable members so subsequent virtual indexes can resolve.
          usedIds.add(resolved);
        }
      }
    } else {
      for (const ref of candidateRefs) {
        if (tappedIds.length >= count) break;
        const resolved = resolveNextId(ref) || (
          battlefield.some((p: any) => p?.id === ref && p?.controller === pid) ? ref : null
        );
        if (!resolved) continue;
        if (!tryTapResolvedId(resolved)) {
          usedIds.add(resolved);
        }
      }
    }

    if (tappedIds.length === 0 || !sampleAbility) {
      socket.emit('error', {
        code: 'NO_TAPPABLE_MANA_SOURCES',
        message: 'No untapped, usable permanents with tap-for-mana abilities were found.',
      });
      return;
    }

    const produces = Array.isArray(sampleAbility.produces)
      ? sampleAbility.produces.map((c) => String(c || '').toUpperCase()).filter(Boolean)
      : [];
    const perTapAmount = Math.max(1, Number(sampleAbility.amount ?? 1)) * manaMultiplier;
    const totalAmount = perTapAmount * tappedIds.length;

    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
    };

    const colorToPoolKey: Record<string, string> = {
      W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless',
    };

    const needsColorChoice = produces.length > 1
      || (produces.length === 1 && !['W', 'U', 'B', 'R', 'G', 'C'].includes(produces[0]));

    if (typeof game.bumpSeq === 'function') game.bumpSeq();

    for (const permanentId of tappedIds) {
      appendEvent(gameId, (game as any).seq ?? 0, 'tapPermanent', {
        playerId: pid,
        permanentId,
        bulkTapForMana: true,
      });
    }

    queueTapTriggersForTappedPermanents(io, game, gameId, tappedIds, String(pid));

    if (produces.length === 1 && !needsColorChoice) {
      const manaColor = produces[0];
      const poolKey = colorToPoolKey[manaColor] || 'colorless';
      (game.state.manaPool[pid] as any)[poolKey] =
        Number((game.state.manaPool[pid] as any)[poolKey] || 0) + totalAmount;

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} tapped ${tappedIds.length} permanents for ${totalAmount} {${manaColor}} mana.`,
        ts: Date.now(),
      });

      broadcastManaPoolUpdate(
        io,
        gameId,
        pid,
        game.state.manaPool[pid] as any,
        `Bulk tapped ${tappedIds.length} for mana`,
        game,
      );
      broadcastGame(io, game, gameId);
      return;
    }

    // Any-color / multi-choice: one distribution prompt for the full amount.
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: pid as PlayerID,
      sourceId: samplePermanentId,
      sourceName: sampleCardName,
      sourceImage: sampleImage,
      description: `Choose mana colors for ${tappedIds.length} tapped permanents (${totalAmount} total).`,
      mandatory: true,
      selectionKind: 'distribution',
      permanentId: samplePermanentId,
      cardName: sampleCardName,
      amount: totalAmount,
      totalAmount,
      availableColors: produces.filter((c) => ['W', 'U', 'B', 'R', 'G'].includes(c)),
      allowedColors: produces.filter((c) => ['W', 'U', 'B', 'R', 'G'].includes(c)),
      bulkTappedPermanentIds: tappedIds,
    } as any);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} tapped ${tappedIds.length} permanents for mana (choose colors).`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
}

// Untap a permanent on the battlefield
export async function handleUntapPermanentRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  payload?: { gameId?: unknown; permanentId?: unknown },
): Promise<void> {
    const gameIdRaw = payload?.gameId;
    const permanentId = payload?.permanentId;

    if (!permanentId || typeof permanentId !== 'string') return;

    const ctx = ensureInRoomAndSeated(gameIdRaw);
  if (!ctx) return;

  const { gameId, game, pid } = ctx;
  const battlefield = getBattlefield(game);
  
  const permanent = battlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
  if (!permanent) {
    socket.emit("error", {
      code: "PERMANENT_NOT_FOUND",
      message: "Permanent not found or not controlled by you",
    });
    return;
  }
  
  if (!(permanent as any).tapped) {
    socket.emit("error", {
      code: "NOT_TAPPED",
      message: "Permanent is not tapped",
    });
    return;
  }
  
  (permanent as any).tapped = false;
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  
  appendEvent(gameId, (game as any).seq ?? 0, "untapPermanent", { playerId: pid, permanentId });
  
  broadcastGame(io, game, gameId);
}
