/**
 * Bounded attack planner for large boards (Phase 2 perf).
 *
 * Origin: planAttacks skip-to-v0 path burned exclusive AI time on evaluateCombatValue
 * for every legal attacker. This greedy path keeps goad/must-attack, picks a weak
 * defender, and adds a capped set of high-power voluntaries under a hard time budget.
 *
 * Public: planAttacksFast, shouldUseAttackPlannerFast.
 */

import type { BattlefieldPermanent, PlayerID } from '../../../shared/src/types.js';
import { playerIsLegalAttackTarget } from '../playerInGameStatus.js';
import type { AttackDeclaration, AttackPlanResult } from './attackPlanner.js';

/** Prefer fast path when full planAttacks would skip/hang (matches engine thresholds). */
export function shouldUseAttackPlannerFast(
  boardSize: number,
  attackPool: number,
): boolean {
  return boardSize > 24 || attackPool > 8;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function readLife(gameState: any, playerId: string): number {
  const fromMap = gameState?.life?.[playerId];
  if (typeof fromMap === 'number') return fromMap;
  const player = (gameState?.players || []).find((p: any) => p?.id === playerId);
  return typeof player?.life === 'number' ? player.life : 40;
}

function readPower(perm: BattlefieldPermanent): number {
  const n = Number((perm as any)?.power ?? (perm as any)?.card?.power ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function weakestOpponentId(gameState: any, playerId: string): string | null {
  const opponents = (gameState?.players || []).filter((p: any) =>
    playerIsLegalAttackTarget(p, playerId),
  );
  if (opponents.length === 0) return null;
  let best = opponents[0];
  let bestLife = readLife(gameState, String(best.id));
  for (let i = 1; i < opponents.length; i++) {
    const life = readLife(gameState, String(opponents[i].id));
    if (life < bestLife) {
      best = opponents[i];
      bestLife = life;
    }
  }
  return String(best.id);
}

/**
 * Greedy attack declaration for large boards / large attack pools.
 * Always keeps goaded declarations; adds up to maxVoluntary high-power voluntaries.
 */
export function planAttacksFast(args: {
  gameState: any;
  playerId: PlayerID;
  legalAttackerIds: readonly string[];
  goaded: readonly AttackDeclaration[];
  battlefield?: readonly BattlefieldPermanent[];
  /** Cap voluntary additions (default 6). */
  maxVoluntary?: number;
  /** Hard wall budget in ms (default 2). */
  maxMs?: number;
}): AttackPlanResult {
  const t0 = nowMs();
  const maxMs = Math.max(0.5, Number(args.maxMs) || 2);
  const maxVoluntary = Math.max(0, Number(args.maxVoluntary) || 6);
  const battlefield =
    args.battlefield
    || (args.gameState?.battlefield as BattlefieldPermanent[])
    || [];
  const legal = new Set(args.legalAttackerIds.map(String));
  const goadedIds = new Set(args.goaded.map((g) => String(g.creatureId)));

  const fallbackTarget = weakestOpponentId(args.gameState, args.playerId);
  if (!fallbackTarget) {
    return { attackers: [...args.goaded], ms: nowMs() - t0, reason: 'fast:no-opponents' };
  }

  const attackers: AttackDeclaration[] = [];
  const used = new Set<string>();
  for (const g of args.goaded) {
    const id = String(g.creatureId);
    if (!id || used.has(id)) continue;
    if (!legal.has(id) && !goadedIds.has(id)) continue;
    used.add(id);
    attackers.push({
      creatureId: id,
      defendingPlayerId: String(g.defendingPlayerId || fallbackTarget),
    });
  }

  if (nowMs() - t0 > maxMs) {
    return { attackers, ms: nowMs() - t0, reason: 'fast:goaded-only-budget' };
  }

  const voluntary: Array<{ id: string; power: number }> = [];
  for (const id of args.legalAttackerIds) {
    const sid = String(id);
    if (!sid || used.has(sid) || goadedIds.has(sid)) continue;
    const perm = battlefield.find((p) => String(p?.id) === sid);
    if (!perm) continue;
    const power = readPower(perm);
    if (power <= 0) continue;
    voluntary.push({ id: sid, power });
  }
  voluntary.sort((a, b) => b.power - a.power);

  let added = 0;
  for (const entry of voluntary) {
    if (added >= maxVoluntary) break;
    if (nowMs() - t0 > maxMs) break;
    used.add(entry.id);
    attackers.push({ creatureId: entry.id, defendingPlayerId: fallbackTarget });
    added += 1;
  }

  return {
    attackers,
    ms: nowMs() - t0,
    reason: `fast:goaded=${args.goaded.length},voluntary=${added},target=${fallbackTarget}`,
  };
}
