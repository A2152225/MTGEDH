/**
 * Origin parent: rules-engine/src/ai/attackPlanner.ts / aiEngineCombatSupport.ts
 *
 * Cluster moved: cheap lethal-only attack declaration used when full planAttacks
 * is skipped on large boards (shouldUseAttackPlannerFast). Avoids the greedy
 * planAttacksFast overcommit while still closing games v0 may miss.
 *
 * Public entry symbols: planLethalAttacksOnly.
 */

import type { BattlefieldPermanent, PlayerID } from '../../../shared/src/types.js';
import {
  createCombatCreature,
  type CombatCreature,
} from '../combatAutomation.js';
import { playerIsLegalAttackTarget } from '../playerInGameStatus.js';
import type { AttackDeclaration, AttackPlanResult } from './attackPlanner.js';
import { findLethal } from './lethalCheck.js';
import type { DefenderState } from './combatResolver.js';
import { estimateCrackBack } from './crackBack.js';

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

function readHandSize(gameState: any, playerId: string): number {
  const zones = gameState?.zones?.[playerId];
  if (Array.isArray(zones?.hand)) return zones.hand.length;
  const player = (gameState?.players || []).find((p: any) => p?.id === playerId);
  if (Array.isArray(player?.hand)) return player.hand.length;
  return 0;
}

function untappedManaSources(
  battlefield: readonly BattlefieldPermanent[],
  playerId: string,
): number {
  let n = 0;
  for (const p of battlefield) {
    if (p.controller !== playerId || p.tapped) continue;
    const text = String((p.card as any)?.oracle_text || '').toLowerCase();
    const type = String((p.card as any)?.type_line || '').toLowerCase();
    if (type.includes('land') || text.includes('{t}: add') || text.includes('add {')) n += 1;
  }
  return n;
}

function blockersFor(
  battlefield: readonly BattlefieldPermanent[],
  defenderId: string,
): CombatCreature[] {
  return battlefield
    .filter((p) => {
      if (p.controller !== defenderId || p.tapped) return false;
      const type = String((p.card as any)?.type_line || '').toLowerCase();
      return type.includes('creature');
    })
    .map((p) => createCombatCreature(p, battlefield));
}

/**
 * Run findLethal only (tight wall). Returns null when no lethal plan fits the budget.
 * Callers should fall through to the v0 declare path on null.
 */
export function planLethalAttacksOnly(args: {
  gameState: any;
  playerId: PlayerID;
  legalAttackerIds: readonly string[];
  goaded: readonly AttackDeclaration[];
  battlefield?: readonly BattlefieldPermanent[];
  /** Hard wall in ms (default 8). */
  maxMs?: number;
}): AttackPlanResult | null {
  const t0 = nowMs();
  const maxMs = Math.max(1, Number(args.maxMs) || 8);
  const deadline = t0 + maxMs;
  const playerId = args.playerId;
  const battlefield = (args.battlefield
    || args.gameState?.battlefield
    || []) as BattlefieldPermanent[];

  const goadedIds = new Set(args.goaded.map((g) => g.creatureId));
  const attackerIds = [
    ...args.legalAttackerIds.filter((id) => !goadedIds.has(id)),
    ...args.goaded.map((g) => g.creatureId),
  ];
  if (attackerIds.length === 0) return null;

  const attackers: CombatCreature[] = [];
  for (const id of attackerIds) {
    if (nowMs() > deadline) return null;
    const perm = battlefield.find((p) => String(p?.id || '') === id);
    if (!perm) continue;
    attackers.push(createCombatCreature(perm, battlefield));
  }
  if (attackers.length === 0) return null;

  const opponents = (args.gameState?.players || []).filter((p: any) =>
    playerIsLegalAttackTarget(p, playerId),
  );
  if (opponents.length === 0) return null;

  const cmdTable = (defenderId: string): Record<string, number> => {
    const raw = args.gameState?.commanderDamage?.[defenderId] || {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[String(k)] = n;
    }
    return out;
  };

  const defenders: DefenderState[] = opponents.map((p: any) => ({
    id: String(p.id),
    life: readLife(args.gameState, String(p.id)),
    commanderDamageTaken: cmdTable(String(p.id)),
  }));

  const blockersByDefender = new Map<string, readonly CombatCreature[]>();
  const trickRisk: Record<string, boolean> = {};
  for (const d of defenders) {
    if (nowMs() > deadline) return null;
    blockersByDefender.set(d.id, blockersFor(battlefield, d.id));
    trickRisk[d.id] =
      untappedManaSources(battlefield, d.id) > 0
      && readHandSize(args.gameState, d.id) > 0;
  }

  const plans = findLethal({
    attackers,
    defenders,
    blockersByDefender,
    trickRisk,
    deadlineMs: deadline,
  });
  if (plans.length === 0) return null;

  // Prefer guaranteed lethal, then crack-safe unless_trick (mirror planAttacks).
  const ranked = [...plans].sort((a, b) => {
    const g = Number(a.certainty === 'guaranteed') - Number(b.certainty === 'guaranteed');
    if (g !== 0) return -g;
    return readLife(args.gameState, a.targetId) - readLife(args.gameState, b.targetId);
  });

  const myCreatures = battlefield
    .filter((p) => {
      if (p.controller !== playerId || p.tapped) return false;
      const type = String((p.card as any)?.type_line || '').toLowerCase();
      return type.includes('creature');
    })
    .map((p) => createCombatCreature(p, battlefield));

  for (const best of ranked) {
    if (nowMs() > deadline) return null;
    if (!best) continue;
    if (best.certainty === 'guaranteed') {
      const t1 = nowMs();
      return {
        attackers: best.attackers,
        ms: t1 - t0,
        reason: `lethal-only:${best.targetId}`,
      };
    }
    if (best.certainty !== 'unless_trick') continue;
    const attackingIds = new Set(best.attackers.map((a) => a.creatureId));
    const myUntappedBlockers = myCreatures.filter((c) => !attackingIds.has(c.id));
    const crack = estimateCrackBack({
      lifeAfterCombat: readLife(args.gameState, playerId),
      myUntappedBlockers,
      opponents: opponents.map((o: any) => ({
        id: String(o.id),
        attackers: blockersFor(battlefield, String(o.id)),
      })),
      commanderDamageTaken: cmdTable(playerId),
      myId: playerId,
    });
    if (crack.lethal) continue;
    const t1 = nowMs();
    return {
      attackers: best.attackers,
      ms: t1 - t0,
      reason: `lethal-only-unless-trick:${best.targetId}`,
    };
  }

  return null;
}
