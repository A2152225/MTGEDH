// server/src/socket/combat-handlers/combatDeclareBlockersRequest.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: the declareBlockers socket.on body plus the private helpers it
// closes over (battlefield name lookup, declare-blockers chat, triggered-ability
// persist).
// Public entry symbols: handleDeclareBlockers, executeDeclareBlockers,
//   lookupBattlefieldPermanentName, emitDeclareBlockersChat, persistTriggeredAbilityPush.

import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { formatDeclareBlockersMessage } from "../../../../shared/src/gameLogFormat.js";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if.js";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import {
  parseGroupedPermanentRef,
  resolveGroupedAttackerRef,
  resolveGroupedPermanentRef,
} from "../tokenGroupResolve.js";
import { broadcastGame, ensureGame, getEffectivePower, getMaxGenericManaAvailable, getPlayerName } from "../util.js";
import {
  canBlockAttacker,
  isCurrentlyCreature,
} from "./combatLegalityGates.js";
import { findMustBeBlockedIfAbleViolation } from "./combatMustBeBlockedIfAble.js";
import { findBlockerCapacityViolation } from "./combatBlockerCapacity.js";
import { findMinimumBlockersViolation } from "./combatMinimumBlockers.js";
import { findMaximumBlockersViolation } from "./combatBatch30BlockLimits.js"; // B30
import {
  collectBlockLifeTax,
  collectBlockTax,
  collectMaxBlockersEachCombat,
} from "../../state/modules/staticEffectSpecAttackYouTax.js";
import { collectBlockerSelfTax } from "../../../../shared/src/combatAttackerSelfTax.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";

export function lookupBattlefieldPermanentName(battlefield: any[], permanentId: string): string {
  const perm = battlefield.find((entry: any) => entry?.id === permanentId);
  return perm?.card?.name || perm?.card?.card_faces?.[0]?.name || 'Creature';
}

export function emitDeclareBlockersChat(
  io: Server,
  gameId: string,
  game: any,
  playerId: PlayerID,
  blockers: Array<{ blockerId: string; attackerId: string }>,
  prefix?: string,
): void {
  const battlefield = game.state?.battlefield || [];
  const message = formatDeclareBlockersMessage(
    getPlayerName(game, playerId),
    blockers,
    (permanentId) => lookupBattlefieldPermanentName(battlefield, permanentId),
  );
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: prefix ? `${prefix}${message}` : message,
    ts: Date.now(),
  });
}

export function persistTriggeredAbilityPush(
  gameId: string,
  game: any,
  payload: Record<string, unknown>,
  reason: string
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', payload);
  } catch (err) {
    debugWarn(1, `[combat] appendEvent(pushTriggeredAbility ${reason}) failed:`, err);
  }
}

function applyBlockerAssignment(
  game: any,
  playerId: PlayerID,
  blocker: { blockerId: string; attackerId: string },
  blockerCreature: any,
  attackerCreature: any,
): void {
  (blockerCreature as any).blocking = (blockerCreature as any).blocking || [];
  (blockerCreature as any).blocking.push(blocker.attackerId);

  try {
    (blockerCreature as any).blockedThisTurn = true;
    const stateAny = game.state as any;
    stateAny.attackedOrBlockedThisCombatByPermanentId = stateAny.attackedOrBlockedThisCombatByPermanentId || {};
    stateAny.attackedOrBlockedThisCombatByPermanentId[String(blocker.blockerId)] = true;

    stateAny.blockersDeclaredThisCombatByPlayer = stateAny.blockersDeclaredThisCombatByPlayer || {};
    stateAny.blockersDeclaredThisCombatByPlayer[String(playerId)] = Array.isArray(stateAny.blockersDeclaredThisCombatByPlayer[String(playerId)])
      ? stateAny.blockersDeclaredThisCombatByPlayer[String(playerId)]
      : [];
    const list = stateAny.blockersDeclaredThisCombatByPlayer[String(playerId)];
    const bid = String(blocker.blockerId);
    if (bid && !list.some((e: any) => String(e?.id ?? e?.creatureId ?? e).trim() === bid)) {
      list.push({
        id: bid,
        name: String((blockerCreature as any)?.card?.name ?? (blockerCreature as any)?.name ?? ''),
        type_line: String((blockerCreature as any)?.card?.type_line ?? ''),
      });
    }
  } catch {
    // best-effort only
  }

  (attackerCreature as any).blockedBy = (attackerCreature as any).blockedBy || [];
  (attackerCreature as any).blockedBy.push(blocker.blockerId);

  try {
    (attackerCreature as any).wasBlockedThisTurn = true;
  } catch {
    // best-effort only
  }
}

/**
 * Commit already-validated blocker assignments (live path after tax=0, or after
 * the defender pays Archangel of Tithes block tax).
 */
export async function executeDeclareBlockers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  resolvedBlockers: Array<{ blockerId: string; attackerId: string }>,
  options?: {
    blockCostPaid?: boolean;
    blockCostAmount?: number;
    blockCostSources?: string[];
    blockCostTappedPermanents?: string[];
    blockCostSacrificedPermanents?: string[];
    blockCostPaymentManaDelta?: Record<string, number>;
  },
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) {
    throw Object.assign(new Error('Game not found'), { code: 'DECLARE_BLOCKERS_ERROR' });
  }
  const battlefield = game.state?.battlefield || [];

  for (const blocker of resolvedBlockers) {
    const blockerCreature = battlefield.find((perm: any) =>
      perm.id === blocker.blockerId &&
      perm.controller === playerId
    );
    const attackerCreature = battlefield.find((perm: any) =>
      perm.id === blocker.attackerId &&
      (perm as any).attacking
    );
    if (!blockerCreature || !attackerCreature) {
      throw Object.assign(
        new Error(`Creature ${blocker.blockerId} not found or attacker is not attacking`),
        { code: 'DECLARE_BLOCKERS_ERROR' },
      );
    }
    applyBlockerAssignment(game, playerId, blocker, blockerCreature, attackerCreature);
  }

  if (typeof (game as any).declareBlockers === "function") {
    try {
      (game as any).declareBlockers(playerId, resolvedBlockers);
    } catch (e) {
      debugWarn(1, "[combat] game.declareBlockers failed:", e);
    }
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, "declareBlockers", {
      playerId,
      blockers: resolvedBlockers,
      ...(options?.blockCostPaid
        ? {
            blockCostPaid: true,
            blockCostAmount: options.blockCostAmount,
            blockCostSources: options.blockCostSources,
            tappedPermanents: options.blockCostTappedPermanents,
            sacrificedPermanents: options.blockCostSacrificedPermanents,
            paymentManaDelta: options.blockCostPaymentManaDelta,
          }
        : {}),
    });
  } catch (e) {
    debugWarn(1, "[combat] Failed to persist declareBlockers event:", e);
  }

  emitDeclareBlockersChat(io, gameId, game, playerId, resolvedBlockers);

  try {
    const blockingCreatures = resolvedBlockers.map(b =>
      battlefield.find((perm: any) => perm.id === b.blockerId)
    ).filter(Boolean);

    {
      const ctx = {
        state: game.state,
        bumpSeq: () => {
          if (typeof (game as any).bumpSeq === "function") {
            (game as any).bumpSeq();
          }
        }
      };

      const { getBlockTriggersForCreatures, getBlockedTriggersForCreatures } = await import("../../state/modules/triggers/index.js");

      const blockTriggers = getBlockTriggersForCreatures(
        ctx as any,
        blockingCreatures,
        playerId
      );
      const blockedCreatures = Array.from(
        new Map(
          resolvedBlockers
            .map((blocker) => battlefield.find((perm: any) => perm?.id === blocker.attackerId && (perm as any).attacking))
            .filter(Boolean)
            .map((creature: any) => [String(creature.id || ''), creature])
        ).values()
      );
      const blockedTriggers = getBlockedTriggersForCreatures(
        ctx as any,
        blockedCreatures,
        playerId
      );
      const { getParsedAttacksUnblockedTriggers, claimAttacksUnblockedEmission } = await import("../../state/modules/triggers/combatBlockedIrTriggers.js");
      const unblockedTriggers = claimAttacksUnblockedEmission(game.state, String(playerId))
        ? getParsedAttacksUnblockedTriggers(ctx as any, playerId)
        : [];
      const triggers = orderTriggersByAPNAP(ctx as any, [...blockTriggers, ...blockedTriggers, ...unblockedTriggers]);

      if (triggers.length > 0) {
        debug(2, `[combat] Found ${triggers.length} block trigger(s) for game ${gameId}`);

        for (const trigger of triggers) {
          const triggerControllerId = ((trigger as any).controllerId || playerId) as PlayerID;
          try {
            const controller = String(triggerControllerId);
            const sourcePerm = battlefield.find((p: any) => p?.id === (trigger as any).permanentId);
            const raw = String(trigger.description || trigger.effect || '').trim();
            let textForEval = raw;
            const hasTriggerPrefix = /^(?:when|whenever|at)\b/i.test(textForEval);
            const triggerTypeForEval = String((trigger as any).triggerType || 'blocks');
            if (!hasTriggerPrefix && textForEval) {
              const oracleLower = String(sourcePerm?.card?.oracle_text || '').toLowerCase();
              if (triggerTypeForEval === 'blocked' || triggerTypeForEval === 'afflict' || triggerTypeForEval === 'flanking' || triggerTypeForEval === 'rampage') {
                textForEval = `Whenever ~ becomes blocked, ${textForEval}`;
              } else if (triggerTypeForEval === 'attacks_unblocked') {
                textForEval = `Whenever ~ attacks and isn't blocked, ${textForEval}`;
              } else if (triggerTypeForEval === 'bushido') {
                textForEval = `Whenever ~ blocks or becomes blocked, ${textForEval}`;
              } else if (oracleLower.includes('blocks a creature')) {
                textForEval = `Whenever ~ blocks a creature, ${textForEval}`;
              } else {
                textForEval = `Whenever ~ blocks, ${textForEval}`;
              }
            }

            const valueObj = (trigger as any).value && typeof (trigger as any).value === 'object' ? (trigger as any).value : undefined;
            const blockedCreatureId = String(valueObj?.blockedCreatureId || '');
            const blockedCreature = blockedCreatureId
              ? battlefield.find((p: any) => p?.id === blockedCreatureId)
              : undefined;
            const blockedCreatureControllerId = String(blockedCreature?.controller || '');

            const defendingPlayerId = String(playerId || '');

            const ok = isInterveningIfSatisfied(
              ctx as any,
              controller,
              textForEval,
              sourcePerm,
              {
                ...(defendingPlayerId ? { defendingPlayerId } : {}),
                ...(/\bthat player\b/i.test(textForEval) && blockedCreatureControllerId
                  ? {
                      thatPlayerId: blockedCreatureControllerId,
                      referencedPlayerId: blockedCreatureControllerId,
                      theirPlayerId: blockedCreatureControllerId,
                    }
                  : {}),
              }
            );
            if (ok === false) {
              debug(2, `[combat] Skipping block trigger due to unmet intervening-if: ${trigger.cardName} - ${trigger.description}`);
              continue;
            }
          } catch {
            // Conservative fallback: keep the trigger if evaluation fails.
          }

          game.state.stack = game.state.stack || [];
          const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const stackTriggerType = String((trigger as any).triggerType || 'blocks');
          const stackItem: any = {
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerControllerId,
            source: trigger.permanentId,
            permanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: stackTriggerType,
            mandatory: trigger.mandatory,
            value: trigger.value,
          };

          const defendingPlayerId = String((trigger.value as any)?.defendingPlayer || '');
          if (defendingPlayerId) {
            stackItem.defendingPlayer = defendingPlayerId;
            stackItem.targetPlayer = defendingPlayerId;
          }

          game.state.stack.push(stackItem);
          persistTriggeredAbilityPush(gameId, game, {
            triggerId,
            sourceId: trigger.permanentId,
            permanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            controllerId: triggerControllerId,
            description: trigger.description,
            triggerType: stackTriggerType,
            effect: String((trigger as any).effect || trigger.description || '').trim(),
            mandatory: trigger.mandatory,
            ...(typeof trigger.value !== 'undefined' ? { value: trigger.value } : {}),
            ...(stackItem.targetPlayer ? { targetPlayer: stackItem.targetPlayer } : {}),
            ...(stackItem.defendingPlayer ? { defendingPlayer: stackItem.defendingPlayer } : {}),
          }, 'block trigger');

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`,
            ts: Date.now(),
          });
        }
      }
    }
  } catch (triggerErr) {
    debugWarn(1, "[combat] Error processing block triggers:", triggerErr);
  }

  const state = game.state as any;
  state.blockersDeclaredBy = state.blockersDeclaredBy || [];
  if (!state.blockersDeclaredBy.includes(playerId)) {
    state.blockersDeclaredBy.push(playerId);
  }

  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }

  broadcastGame(io, game, gameId);

  debug(2, `[combat] Player ${playerId} declared ${resolvedBlockers.length} blockers in game ${gameId}`);
}

/**
 * Declare blockers - defending player selects which creatures block which attackers
 *
 * Payload:
 * - gameId: string
 * - blockers: Array<{ blockerId: string; attackerId: string }>
 */
export async function handleDeclareBlockers(
  io: Server,
  socket: Socket,
  payload?: {
    gameId?: unknown;
    blockers?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const blockers = payload?.blockers;

  if (!gameId || typeof gameId !== 'string') {
    socket.emit?.('error', { code: 'DECLARE_BLOCKERS_ERROR', message: 'Missing gameId' } as any);
    return;
  }
  if (!Array.isArray(blockers)) {
    socket.emit?.('error', { code: 'DECLARE_BLOCKERS_ERROR', message: 'Invalid blockers payload' } as any);
    return;
  }

  try {

    const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
    if (!playerId) {
      socket.emit?.('error', { code: 'DECLARE_BLOCKERS_ERROR', message: 'Player not identified' } as any);
      return;
    }

    const socketGameId = (socket.data as any)?.gameId;
    if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' } as any);
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' } as any);
      return;
    }

    const players = ((game.state as any)?.players || []) as any[];
    const me = players.find((p: any) => p?.id === playerId);
    if (!me || me?.spectator || me?.isSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
      return;
    }

    const step = String((game.state as any).step || "").toLowerCase();
    if (step !== "declareblockers" && step !== "declare_blockers") {
      socket.emit("error", {
        code: "WRONG_STEP",
        message: "Can only declare blockers during the declare blockers step",
      });
      return;
    }

    // Validate blockers
    const battlefield = game.state?.battlefield || [];

    // IMPORTANT: Resolve grouped token IDs to actual token IDs
    // When the client sends a grouped token ID (e.g., "group_perm_xxx"),
    // we need to find an available token from that group to use as the blocker.
    // Attacker refs can also be stale group_* ids if emit still grouped attacking tokens.
    const resolvedBlockers: Array<{ blockerId: string; attackerId: string }> = [];
    const usedTokenIds = new Set<string>(); // Track which tokens have been assigned

    for (const blocker of blockers as Array<{ blockerId: string; attackerId: string }>) {
      let actualBlockerId = blocker.blockerId;
      let actualAttackerId = String(blocker.attackerId || '').trim();

      const resolvedBlockerId = resolveGroupedPermanentRef(game, playerId, blocker.blockerId, {
        usedIds: usedTokenIds,
        predicate: (perm: any) => {
          if (perm.tapped) return false;
          if (Array.isArray(perm.blocking) && perm.blocking.length > 0) return false;
          return true;
        },
      });

      if (resolvedBlockerId) {
        actualBlockerId = resolvedBlockerId;
        usedTokenIds.add(actualBlockerId);
        if (actualBlockerId !== blocker.blockerId) {
          debug(2, `[combat] Resolved grouped token ${blocker.blockerId} to actual token ${actualBlockerId}`);
        }
      } else if (parseGroupedPermanentRef(blocker.blockerId)) {
        socket.emit("error", {
          code: "NO_AVAILABLE_TOKEN",
          message: `No available token to block with for ${blocker.blockerId}`,
        });
        return;
      }

      // Stale clients may still send emit-time group_* attacker ids. Map those onto a
      // real attacking permanent. Multiple blockers on the same group ref multi-block
      // the same resolved attacker (matches the single grouped attacker card in the UI).
      const resolvedAttackerId = resolveGroupedAttackerRef(game, actualAttackerId);
      if (resolvedAttackerId) {
        if (resolvedAttackerId !== actualAttackerId) {
          debug(2, `[combat] Resolved grouped attacker ${actualAttackerId} to ${resolvedAttackerId}`);
        }
        actualAttackerId = resolvedAttackerId;
      } else if (parseGroupedPermanentRef(actualAttackerId)) {
        socket.emit("error", {
          code: "INVALID_ATTACKER",
          message: `Attacker ${actualAttackerId} not found or is not attacking`,
        });
        return;
      }

      resolvedBlockers.push({ blockerId: actualBlockerId, attackerId: actualAttackerId });
    }

    const uniqueBlockerIds = new Set(
      resolvedBlockers.map((entry) => String(entry.blockerId || '').trim()).filter(Boolean),
    );
    const globalBlockCap = collectMaxBlockersEachCombat(game.state);
    if (globalBlockCap.max != null && uniqueBlockerIds.size > globalBlockCap.max) {
      socket.emit("error", {
        code: "TOO_MANY_BLOCKERS",
        message: `No more than ${globalBlockCap.max} creatures can block this combat.`,
      });
      return;
    }

    const capacityViolation = findBlockerCapacityViolation((game.state as any)?.battlefield || [], resolvedBlockers);
    if (capacityViolation) {
      socket.emit("error", {
        code: "BLOCKER_CAPACITY_EXCEEDED",
        message: `${capacityViolation.name} can block at most ${capacityViolation.capacity} creature(s) this combat.`,
      });
      return;
    }

    const mustBlockViolation = findMustBeBlockedIfAbleViolation({
      state: game.state,
      defendingPlayerId: playerId,
      assignments: resolvedBlockers,
    });
    if (mustBlockViolation) {
      socket.emit("error", {
        code: mustBlockViolation.code,
        message: mustBlockViolation.message,
      });
      return;
    }

    // Validate assignments before charging block tax.
    for (const blocker of resolvedBlockers) {
      // Find the blocker creature
      const blockerCreature = battlefield.find((perm: any) =>
        perm.id === blocker.blockerId &&
        perm.controller === playerId
      );

      if (!blockerCreature) {
        socket.emit("error", {
          code: "INVALID_BLOCKER",
          message: `Creature ${blocker.blockerId} not found or not controlled by you`,
        });
        return;
      }

      // Check if permanent is actually a creature (Rule 509.1a)
      // Enchantments, artifacts without animation, lands, etc. cannot block
      // Pass battlefield and controller for proper devotion calculation (Gods)
      if (!isCurrentlyCreature(blockerCreature, battlefield, playerId)) {
        socket.emit("error", {
          code: "NOT_A_CREATURE",
          message: `${(blockerCreature as any).card?.name || "This permanent"} is not a creature and cannot block`,
        });
        return;
      }

      // Check if blocker is tapped
      if ((blockerCreature as any).tapped) {
        socket.emit("error", {
          code: "BLOCKER_TAPPED",
          message: `${(blockerCreature as any).card?.name || "Creature"} is tapped and cannot block`,
        });
        return;
      }

      // Find the attacker being blocked
      const attackerCreature = battlefield.find((perm: any) =>
        perm.id === blocker.attackerId &&
        (perm as any).attacking
      );

      if (!attackerCreature) {
        socket.emit("error", {
          code: "INVALID_ATTACKER",
          message: `Attacker ${blocker.attackerId} not found or is not attacking`,
        });
        return;
      }

      // Use the comprehensive evasion check that considers granted abilities and "as though" effects
      const blockCheck = canBlockAttacker(blockerCreature, attackerCreature, battlefield, playerId, game.state);
      if (!blockCheck.canBlock) {
        socket.emit("error", {
          code: "CANT_BLOCK",
          message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (${blockCheck.reason})`,
        });
        return;
      }

      // Additional evasion checks not covered by canBlockAttacker (fear, intimidate, skulk, menace)
      const attackerText = ((attackerCreature as any).card?.oracle_text || "").toLowerCase();
      const blockerText = ((blockerCreature as any).card?.oracle_text || "").toLowerCase();
      const attackerKeywords = (attackerCreature as any).card?.keywords || [];
      const blockerKeywords = (blockerCreature as any).card?.keywords || [];

      // Fear: can only be blocked by artifact creatures or black creatures
      const attackerHasFear = attackerText.includes("fear") ||
        attackerKeywords.some((k: string) => k.toLowerCase() === 'fear');
      if (attackerHasFear) {
        const blockerCard = (blockerCreature as any).card;
        const isArtifact = blockerCard?.type_line?.toLowerCase().includes('artifact');
        const isBlack = blockerCard?.colors?.includes('B');
        if (!isArtifact && !isBlack) {
          socket.emit("error", {
            code: "CANT_BLOCK_FEAR",
            message: `${blockerCard?.name} can't block ${(attackerCreature as any).card?.name} (fear)`,
          });
          return;
        }
      }

      // Intimidate: can only be blocked by artifact creatures or creatures that share a color
      const attackerHasIntimidate = attackerText.includes("intimidate") ||
        attackerKeywords.some((k: string) => k.toLowerCase() === 'intimidate');
      if (attackerHasIntimidate) {
        const blockerCard = (blockerCreature as any).card;
        const attackerCard = (attackerCreature as any).card;
        const isArtifact = blockerCard?.type_line?.toLowerCase().includes('artifact');
        const sharesColor = (attackerCard?.colors || []).some((c: string) =>
          (blockerCard?.colors || []).includes(c)
        );
        if (!isArtifact && !sharesColor) {
          socket.emit("error", {
            code: "CANT_BLOCK_INTIMIDATE",
            message: `${blockerCard?.name} can't block ${attackerCard?.name} (intimidate)`,
          });
          return;
        }
      }

      // Skulk: can't be blocked by creatures with greater power
      const attackerHasSkulk = attackerText.includes("skulk") ||
        attackerKeywords.some((k: string) => k.toLowerCase() === 'skulk');
      if (attackerHasSkulk) {
        const blockerPower = getEffectivePower(blockerCreature, game.state);
        const attackerPower = getEffectivePower(attackerCreature, game.state);
        if (blockerPower > attackerPower) {
          socket.emit("error", {
            code: "CANT_BLOCK_SKULK",
            message: `${(blockerCreature as any).card?.name} (power ${blockerPower}) can't block ${(attackerCreature as any).card?.name} (skulk, power ${attackerPower})`,
          });
          return;
        }
      }
    }

    const minimumViolation = findMinimumBlockersViolation(battlefield, resolvedBlockers);
    if (minimumViolation) {
      socket.emit("error", {
        code: "TOO_FEW_BLOCKERS",
        message: `${minimumViolation.name} can't be blocked except by ${minimumViolation.required} or more creatures.`,
      });
      return;
    }

    const maximumViolation = findMaximumBlockersViolation(battlefield, resolvedBlockers); // B30
    if (maximumViolation) {
      socket.emit("error", {
        code: "TOO_MANY_BLOCKERS",
        message: `${maximumViolation.name} can't be blocked by more than ${maximumViolation.max} creature${maximumViolation.max === 1 ? '' : 's'}.`,
      });
      return;
    }

    const perBlockerTax = collectBlockTax(game.state);
    let selfTaxTotal = 0;
    const selfTaxSources: string[] = [];
    for (const blockerId of uniqueBlockerIds) {
      const blockerCreature = battlefield.find((perm: any) => String(perm?.id || '') === String(blockerId));
      const selfTax = collectBlockerSelfTax(blockerCreature, battlefield, {
        players: game.state?.players,
      });
      selfTaxTotal += selfTax.cost;
      for (const source of selfTax.sources) {
        if (!selfTaxSources.includes(source)) selfTaxSources.push(source);
      }
    }
    const totalBlockCostRequired = perBlockerTax.cost * uniqueBlockerIds.size + selfTaxTotal;
    const attackerById = new Map(
      battlefield.map((perm: any) => [String(perm?.id || ''), perm]),
    );
    const lifeTax = collectBlockLifeTax(game.state, {
      uniqueBlockerIds,
      blockerIsTaxed: (blocker, sourceController) => {
        const blockerId = String(blocker.id || '');
        return resolvedBlockers.some((entry: any) => {
          if (String(entry?.blockerId || '') !== blockerId) return false;
          const attacker = attackerById.get(String(entry?.attackerId || ''));
          return String(attacker?.controller || '') === String(sourceController || '');
        });
      },
    });
    const totalBlockLifeRequired = lifeTax.cost;
    const blockSources = [...perBlockerTax.sources, ...selfTaxSources, ...lifeTax.sources];
    if (totalBlockCostRequired > 0 || totalBlockLifeRequired > 0) {
      const totalAvailable = getMaxGenericManaAvailable(game.state, playerId, {
        excludedPermanentIds: [...uniqueBlockerIds],
      });

      if (totalBlockCostRequired > 0 && totalAvailable < totalBlockCostRequired) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA_FOR_BLOCK",
          message: `Cannot block. Need to pay {${totalBlockCostRequired}} for ${blockSources.join(', ')}. You have {${totalAvailable}} available.`,
        });
        return;
      }
      const playerLife = Number(
        game.state?.life?.[playerId]
        ?? (game.state?.players || []).find((entry: any) => String(entry?.id || '') === String(playerId))?.life
        ?? 40,
      );
      if (totalBlockLifeRequired > 0 && playerLife <= totalBlockLifeRequired) {
        socket.emit("error", {
          code: "INSUFFICIENT_LIFE_FOR_BLOCK",
          message: `Cannot block. Need to pay ${totalBlockLifeRequired} life for ${lifeTax.sources.join(', ')}.`,
        });
        return;
      }

      const existingPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
        .find((step: any) => step?.blockCostPayment === true);

      if (!existingPrompt) {
        const manaLabel = totalBlockCostRequired > 0 ? `{${totalBlockCostRequired}}` : '';
        const lifeLabel = totalBlockLifeRequired > 0 ? `${totalBlockLifeRequired} life` : '';
        const costLabel = [manaLabel, lifeLabel].filter(Boolean).join(' and ');
        const blockCostStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: playerId as any,
          sourceName: 'Block Cost',
          description: `Pay ${costLabel} to block (${blockSources.join(', ')})`,
          mandatory: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            { id: 'pay_block_cost', label: `Pay ${costLabel} and block` },
            { id: 'cancel_block', label: 'Cancel block' },
          ],
          blockCostPayment: true,
          blockCostAmount: totalBlockCostRequired,
          blockCostLifeAmount: totalBlockLifeRequired,
          blockCostSources: blockSources,
          blockers: resolvedBlockers,
        } as any);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'resolveTopOfStackPrompt', {
            playerId,
            sourceId: 'block-cost',
            queuedResolutionStep: { ...(blockCostStep as any) },
          });
        } catch (err) {
          debugWarn(1, '[combat] appendEvent(resolveTopOfStackPrompt blockCostPayment) failed:', err);
        }
      }

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }

    await executeDeclareBlockers(io, gameId, playerId, resolvedBlockers);

    // NOTE: Do NOT auto-advance the step here!
    // Per MTG rules, after blockers are declared, all players get priority
    // to cast instants and activate abilities before combat damage.
    // The step will advance when all players pass priority in succession.
    // The client should emit "passPriority" or "nextStep" when ready to proceed.

  } catch (err: any) {
    debugError(1, `[combat] declareBlockers error for game ${gameId}:`, err);
    socket.emit("error", {
      code: err?.code || "DECLARE_BLOCKERS_ERROR",
      message: err?.message ?? String(err),
    });
  }
}
