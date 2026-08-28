/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityPassCombatExecutors.ts
 * Cluster: AI declare-blockers generic block tax (Archangel source_is_attacking
 *   plus this-turn War Cadence stamps). Pay if affordable; otherwise drop
 *   optional unique blockers. Keep must-block-if-able. Empty declare when all
 *   remaining blockers are optional and still unaffordable. Refuse only when
 *   remaining required blockers still cannot be paid.
 * Public: applyAIDeclareBlockersBlockTax
 * Leaf must not import ai.ts or ai-handlers/index.ts.
 */

import type { PlayerID } from '../../../../shared/src/types.js';
import { collectBlockTax } from '../../state/modules/staticEffectSpecAttackYouTax.js';
import { findMustBeBlockedIfAbleViolation } from '../combat-handlers/combatMustBeBlockedIfAble.js';
import {
  broadcastManaPoolUpdate,
  getMaxGenericManaAvailable,
  getOrInitManaPool,
  payGenericManaWithAvailableSources,
} from '../util.js';
import { debug, debugWarn } from '../../utils/debug.js';

export interface AIDeclareBlockersAssignment {
  blockerId: string;
  attackerId: string;
}

function uniqueBlockerIds(assignments: AIDeclareBlockersAssignment[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const blockerId = String(assignment?.blockerId || '').trim();
    if (!blockerId || seen.has(blockerId)) continue;
    seen.add(blockerId);
    ids.push(blockerId);
  }
  return ids;
}

export function applyAIDeclareBlockersBlockTax(args: {
  io: any;
  game: any;
  gameId: string;
  playerId: PlayerID;
  assignments: AIDeclareBlockersAssignment[];
}): { ok: boolean; assignments: AIDeclareBlockersAssignment[] } {
  const { io, game, gameId, playerId } = args;
  let assignments = Array.isArray(args.assignments) ? [...args.assignments] : [];
  const state = game.state as any;
  const perBlockerTax = collectBlockTax(state);
  const costPer = Number(perBlockerTax.cost || 0) || 0;
  if (costPer <= 0) {
    return { ok: true, assignments };
  }

  const dropOptionalUntilAffordable = (): boolean => {
    while (true) {
      const unique = uniqueBlockerIds(assignments);
      const total = costPer * unique.length;
      const available = getMaxGenericManaAvailable(state, playerId, {
        excludedPermanentIds: unique,
      });
      if (total <= available) return true;

      let dropped = false;
      for (let i = unique.length - 1; i >= 0; i--) {
        const candidate = unique[i];
        const next = assignments.filter((assignment) =>
          String(assignment?.blockerId || '').trim() !== candidate,
        );
        if (findMustBeBlockedIfAbleViolation({
          state,
          defendingPlayerId: playerId,
          assignments: next,
        })) {
          continue;
        }
        assignments = next;
        dropped = true;
        break;
      }
      if (!dropped) return false;
    }
  };

  if (!dropOptionalUntilAffordable()) {
    debugWarn(1, '[AI] Refusing declare blockers that cannot pay block tax:', {
      gameId,
      playerId,
      costPer,
      sources: perBlockerTax.sources,
    });
    return { ok: false, assignments };
  }

  const unique = uniqueBlockerIds(assignments);
  const amount = costPer * unique.length;
  if (amount <= 0) {
    return { ok: true, assignments };
  }

  const payment = payGenericManaWithAvailableSources(state, playerId, amount, {
    excludedPermanentIds: unique,
  });
  if (!payment.ok) {
    debugWarn(1, '[AI] Block tax payment failed after trim:', {
      gameId,
      playerId,
      amount,
      error: payment.error,
    });
    return { ok: false, assignments };
  }

  debug(1, '[AI] Paid block tax:', {
    gameId,
    playerId,
    amount,
    sources: perBlockerTax.sources,
  });
  broadcastManaPoolUpdate(
    io,
    gameId,
    playerId,
    getOrInitManaPool(state, playerId) as any,
    'Paid block cost',
    game,
  );
  return { ok: true, assignments };
}
