/**
 * Crack-back damage estimate for Phase 2 planners (P2-3).
 *
 * Origin: AI_Upgrade Phase 0-2 plan P2-3.
 * Public entry symbols: CRACK_BACK_DISCOUNT, CrackBack, estimateCrackBack.
 *
 * Assumes every opposing creature can attack next turn; remaining blockers
 * stop the largest threats first. Table estimate discounts other opponents
 * because they also attack each other.
 */

import type { CombatCreature } from '../combatAutomation.js';
import { bestDamageSavingBlocks } from './lethalCheck.js';
import { resolveCombat, type DefenderState } from './combatResolver.js';

/** Named discount: other opponents also attack each other (plan default 0.5). */
export const CRACK_BACK_DISCOUNT = 0.5;

export interface CrackBack {
  perOpponent: Record<string, number>;
  worstCase: number;
  tableEstimate: number;
  lethal: boolean;
}

function isCommander(c: CombatCreature): boolean {
  const perm: any = c.permanent;
  return Boolean(perm?.isCommander === true || perm?.card?.zone === 'command');
}

function commanderCardId(c: CombatCreature): string {
  const perm: any = c.permanent;
  return String(perm?.card?.id || c.id);
}

function hitDamage(c: CombatCreature): number {
  return c.keywords.doubleStrike ? c.power * 2 : c.power;
}

export function estimateCrackBack(args: {
  lifeAfterCombat: number;
  myUntappedBlockers: readonly CombatCreature[];
  opponents: ReadonlyArray<{
    id: string;
    attackers: readonly CombatCreature[];
    commanderIds?: readonly string[];
  }>;
  /** Already dealt to me, by commander card id. */
  commanderDamageTaken?: Record<string, number>;
  discount?: number;
  /** My seat id for resolveCombat defender. */
  myId?: string;
}): CrackBack {
  const discount = args.discount ?? CRACK_BACK_DISCOUNT;
  const myId = args.myId || 'me';
  const cmdTaken = { ...(args.commanderDamageTaken || {}) };
  const perOpponent: Record<string, number> = {};

  let cmdLethal = false;

  for (const opp of args.opponents) {
    if (opp.attackers.length === 0) {
      perOpponent[opp.id] = 0;
      continue;
    }

    const creatures = new Map<string, CombatCreature>();
    for (const a of opp.attackers) creatures.set(a.id, a);
    for (const b of args.myUntappedBlockers) creatures.set(b.id, b);

    const defender: DefenderState = {
      id: myId,
      life: args.lifeAfterCombat,
      commanderDamageTaken: cmdTaken,
    };
    const attacks = opp.attackers.map((a) => ({
      attacker: a,
      defenderId: myId,
    }));
    // Prefer blocking the largest attackers first — bestDamageSavingBlocks
    // already ranks by prevention gain, which tracks threat.
    const blocks = bestDamageSavingBlocks(opp.attackers, args.myUntappedBlockers);
    const outcome = resolveCombat(attacks, blocks, creatures, [defender]);
    const lost = outcome.lifeLost[myId] || 0;
    perOpponent[opp.id] = lost;

    // resolveCombat already merges prior commander damage under whatever key
    // the table used (card id vs permanent id).
    if (outcome.defendersKilled.includes(myId)) {
      cmdLethal = true;
    }

    // Commander reaching 21 through blockers is lethal regardless of life.
    for (const a of opp.attackers) {
      if (!isCommander(a)) continue;
      const keys = [commanderCardId(a), a.id, (a.permanent as any)?.id]
        .map((k) => String(k || ''))
        .filter(Boolean);
      let prior = 0;
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(cmdTaken, k)) {
          prior = Number(cmdTaken[k]) || 0;
          break;
        }
      }
      let dealt = 0;
      const dealtTable = outcome.commanderDamage[myId] || {};
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(dealtTable, k)) {
          dealt = Number(dealtTable[k]) || 0;
          break;
        }
      }
      // Fall back to any dealt entry for this combat if keys diverged.
      if (dealt === 0) {
        dealt = Object.values(dealtTable).reduce((s, n) => s + (Number(n) || 0), 0);
      }
      if (prior + dealt >= 21) cmdLethal = true;
    }

    // Unblocked commander damage estimate if resolve left gaps: also check
    // raw hit when no blockers could stop them.
    if (!cmdLethal) {
      for (const a of opp.attackers) {
        if (!isCommander(a)) continue;
        const keys = [commanderCardId(a), a.id, (a.permanent as any)?.id]
          .map((k) => String(k || ''))
          .filter(Boolean);
        let prior = 0;
        for (const k of keys) {
          if (Object.prototype.hasOwnProperty.call(cmdTaken, k)) {
            prior = Number(cmdTaken[k]) || 0;
            break;
          }
        }
        const blocked = blocks.some((b) => b.attackerId === a.id);
        if (blocked && !a.keywords.trample) continue;
        const through = blocked
          ? Math.max(0, hitDamage(a) - (args.myUntappedBlockers
              .filter((b) => blocks.some((x) => x.blockerId === b.id && x.attackerId === a.id))
              .reduce((s, b) => s + Math.min(hitDamage(a), b.toughness), 0)))
          : hitDamage(a);
        if (prior + through >= 21) cmdLethal = true;
      }
    }
  }

  const values = Object.values(perOpponent);
  const worstCase = values.length ? Math.max(...values) : 0;
  const othersSum = values.reduce((s, v) => s + v, 0) - worstCase;
  const tableEstimate = worstCase + discount * Math.max(0, othersSum);
  const lethal = cmdLethal || tableEstimate >= args.lifeAfterCombat;

  return { perOpponent, worstCase, tableEstimate, lethal };
}
