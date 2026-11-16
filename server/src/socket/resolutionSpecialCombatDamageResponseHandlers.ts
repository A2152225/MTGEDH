/**
 * socket/resolutionSpecialCombatDamageResponseHandlers.ts
 *
 * TARGET_SELECTION / COMBAT_DAMAGE_ASSIGNMENT responses for Cunning Giant
 * and Butcher Orgg family assignment. Public:
 * handleSpecialCombatDamageAssignmentResponse.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { debug, debugWarn, debugError } from '../utils/debug.js';
import { broadcastGame } from './util.js';
import { applySpecialCombatDamageAssignmentResponse } from '../state/modules/turn-handlers/combatSpecialDamageAssignment.js';

function firstId(value: unknown): string {
  if (Array.isArray(value) && value.length) {
    const first = value[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object') return String((first as any).id || (first as any).value || '').trim();
    return String(first || '').trim();
  }
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String((value as any).id || (value as any).value || '').trim();
  return '';
}

function parseShares(value: unknown): Array<{ target: string; amount: number }> {
  if (Array.isArray(value)) {
    return value.map((entry: any) => {
      if (entry && typeof entry === 'object') {
        const target = String(entry.target || entry.id || entry.blockerId || '').trim();
        const amount = Math.max(0, Math.floor(Number(entry.amount ?? entry.damage ?? 0)));
        return { target, amount };
      }
      return { target: '', amount: 0 };
    }).filter((entry) => entry.target && entry.amount > 0);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([target, amount]) => ({
      target: String(target),
      amount: Math.max(0, Math.floor(Number(amount || 0))),
    })).filter((entry) => entry.target && entry.amount > 0);
  }
  return [];
}

export async function handleSpecialCombatDamageAssignmentResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.specialCombatDamageAssignment !== true) return false;
  const attackerId = String(step.attackerId || step.sourceId || '').trim();
  const mode = String(step.specialCombatDamageMode || '').trim();
  if (!attackerId) return true;

  try {
    const targetId = firstId(response?.selections);
    const shares = parseShares(response?.selections?.shares ?? response?.shares ?? response?.assignments ?? response?.selections);
    applySpecialCombatDamageAssignmentResponse(game, {
      attackerId,
      mode,
      cancelled: response?.cancelled === true || (!targetId && mode === 'redirect-unblocked'),
      targetId,
      shares,
    });

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'specialCombatDamageAssignmentResolve', {
        playerId: String(step.playerId || response?.playerId || '').trim(),
        attackerId,
        mode,
        cancelled: response?.cancelled === true,
        targetId,
        shares,
        resolvedStepId: String(step.id || '').trim() || undefined,
        isFirstStrikePhase: (game as any)._pendingCombatDamageFirstStrike,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist specialCombatDamageAssignmentResolve event:', err);
    }

    const isFirstStrikePhase = (game as any)._pendingCombatDamageFirstStrike;
    try {
      const turn = await import('../state/modules/turn.js');
      if (typeof (turn as any).dealCombatDamage === 'function') {
        (turn as any).dealCombatDamage(game, isFirstStrikePhase);
      }
    } catch (err) {
      debugError(1, '[handleSpecialCombatDamageAssignmentResponse] resume dealCombatDamage failed:', err);
    }

    broadcastGame(io, game, gameId);
    debug(2, `[handleSpecialCombatDamageAssignmentResponse] ${mode} for ${attackerId}`);
  } catch (err) {
    debugError(1, '[handleSpecialCombatDamageAssignmentResponse] Error:', err);
  }
  return true;
}
