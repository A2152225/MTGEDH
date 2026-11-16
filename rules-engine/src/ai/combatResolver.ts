/**
 * Pure combat resolver for Phase 2 planners (P2-1).
 *
 * Origin: AI_Upgrade Phase 0-2 plan P2-1.
 * Public entry symbols: DefenderState, CombatOutcome, resolveCombat.
 *
 * Models two damage steps (first/double strike, then regular). Handles
 * deathtouch, trample, indestructible, lifelink, marked damage, multi-blocker
 * assignment (most valuable blockers first), and commander damage to 21.
 * Sets uncertain when involved creatures mention regeneration / protection /
 * prevention / replacement that the model skips.
 */

import type { CombatCreature } from '../combatAutomation.js';
import type { BlockAssignment } from '../aiEngineBlockPlanning.js';

export interface DefenderState {
  id: string;
  life: number;
  /** Damage already taken from each attacking commander, keyed by card id. */
  commanderDamageTaken: Record<string, number>;
}

export interface CombatOutcome {
  deaths: string[];
  lifeLost: Record<string, number>;
  lifeGained: Record<string, number>;
  /** defender id → commander card id → damage dealt this combat */
  commanderDamage: Record<string, Record<string, number>>;
  defendersKilled: string[];
  uncertain: boolean;
}

const UNCERTAIN_RE =
  /\b(regenerat\w*|protection from|prevent(?:s|ed|ing)?(?:\s+all)?(?:\s+combat)?\s+damage|instead|redirect|replace)\b/i;

function markedDamage(c: CombatCreature): number {
  const fromField = Number(c.damage) || 0;
  const perm: any = c.permanent;
  const raw = perm?.damageMarked ?? perm?.markedDamage ?? perm?.damage ?? perm?.counters?.damage ?? 0;
  const fromPerm = Number(raw);
  const n = Number.isFinite(fromPerm) && fromPerm > 0 ? fromPerm : 0;
  return Math.max(fromField, n);
}

function remainingToughness(c: CombatCreature, damageSoFar: number): number {
  return Math.max(0, c.toughness - markedDamage(c) - damageSoFar);
}

function creatureValue(c: CombatCreature): number {
  let v = c.power + c.toughness;
  if (c.keywords.deathtouch) v += 2;
  if (c.keywords.flying) v += 1;
  if (c.keywords.lifelink) v += 1;
  if (isCommander(c)) v += 8;
  return v;
}

function isCommander(c: CombatCreature): boolean {
  const perm: any = c.permanent;
  return Boolean(perm?.isCommander === true || perm?.card?.zone === 'command');
}

function commanderIdentityKeys(c: CombatCreature): string[] {
  const perm: any = c.permanent;
  return [perm?.card?.id, perm?.id, c.id, `${c.controllerId}-${c.name}`, c.name]
    .map((k) => String(k || ''))
    .filter(Boolean);
}

/** Prefer an existing table key (perm id vs card id) so 17+5 reaches 21. */
function commanderDamageKey(
  c: CombatCreature,
  existing: Record<string, number> | undefined,
): string {
  const keys = commanderIdentityKeys(c);
  if (existing) {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(existing, k)) return k;
    }
  }
  return keys[0] || c.id;
}

function dealsInStep(
  c: CombatCreature,
  step: 'first' | 'regular',
): boolean {
  const fs = c.keywords.firstStrike || c.keywords.doubleStrike;
  if (step === 'first') return fs;
  // Regular step: everyone without first strike, plus double strike again.
  if (c.keywords.doubleStrike) return true;
  if (c.keywords.firstStrike) return false;
  return true;
}

function powerThisStep(c: CombatCreature, step: 'first' | 'regular'): number {
  if (!dealsInStep(c, step)) return 0;
  return Math.max(0, c.power);
}

function textUncertain(c: CombatCreature): boolean {
  const perm: any = c.permanent;
  const text = String(perm?.card?.oracle_text || perm?.oracleText || '');
  return UNCERTAIN_RE.test(text);
}

function addLife(
  map: Record<string, number>,
  id: string,
  amount: number,
): void {
  if (amount <= 0) return;
  map[id] = (map[id] || 0) + amount;
}

/**
 * Assign `budget` damage from an attacker onto blockers ordered by value
 * (most valuable first). Returns leftover budget (trample fodder) and deaths.
 */
function assignToBlockers(
  budget: number,
  deathtouch: boolean,
  blockers: CombatCreature[],
  damageTaken: Map<string, number>,
  skipDead: Set<string>,
): { leftover: number; killed: string[]; dealt: number } {
  let left = budget;
  let dealt = 0;
  const killed: string[] = [];
  const ordered = [...blockers]
    .filter((b) => !skipDead.has(b.id))
    .sort((a, b) => creatureValue(b) - creatureValue(a));

  for (const b of ordered) {
    if (left <= 0) break;
    if (b.keywords.indestructible) {
      // Still mark damage for toughness tracking / trample calc, but no death.
      const need = remainingToughness(b, damageTaken.get(b.id) || 0);
      const take = Math.min(left, Math.max(need, 1));
      damageTaken.set(b.id, (damageTaken.get(b.id) || 0) + take);
      left -= take;
      dealt += take;
      continue;
    }
    const rem = remainingToughness(b, damageTaken.get(b.id) || 0);
    if (rem <= 0) {
      killed.push(b.id);
      skipDead.add(b.id);
      continue;
    }
    const lethal = deathtouch ? 1 : rem;
    const take = Math.min(left, lethal);
    damageTaken.set(b.id, (damageTaken.get(b.id) || 0) + take);
    left -= take;
    dealt += take;
    if (take >= lethal) {
      killed.push(b.id);
      skipDead.add(b.id);
    }
  }
  return { leftover: left, killed, dealt };
}

export function resolveCombat(
  attacks: ReadonlyArray<{ attacker: CombatCreature; defenderId: string }>,
  blocks: readonly BlockAssignment[],
  creatures: ReadonlyMap<string, CombatCreature>,
  defenders: readonly DefenderState[],
): CombatOutcome {
  const deaths = new Set<string>();
  const lifeLost: Record<string, number> = {};
  const lifeGained: Record<string, number> = {};
  const commanderDamage: Record<string, Record<string, number>> = {};
  let uncertain = false;

  const defenderById = new Map(defenders.map((d) => [d.id, { ...d }]));
  const cmdTaken: Record<string, Record<string, number>> = {};
  for (const d of defenders) {
    cmdTaken[d.id] = { ...d.commanderDamageTaken };
  }

  const blockersOf = new Map<string, CombatCreature[]>();
  for (const a of attacks) {
    blockersOf.set(a.attacker.id, []);
  }
  for (const b of blocks) {
    const blocker = creatures.get(b.blockerId);
    if (!blocker) continue;
    const list = blockersOf.get(b.attackerId);
    if (list) list.push(blocker);
    else blockersOf.set(b.attackerId, [blocker]);
  }

  for (const { attacker } of attacks) {
    if (textUncertain(attacker)) uncertain = true;
    for (const b of blockersOf.get(attacker.id) || []) {
      if (textUncertain(b)) uncertain = true;
    }
  }

  const damageTaken = new Map<string, number>();
  const deadMidCombat = new Set<string>();

  const applyPlayerDamage = (
    defenderId: string,
    amount: number,
    attacker: CombatCreature,
  ): void => {
    if (amount <= 0) return;
    addLife(lifeLost, defenderId, amount);
    const def = defenderById.get(defenderId);
    if (def) def.life -= amount;
    if (attacker.keywords.lifelink) {
      addLife(lifeGained, attacker.controllerId, amount);
    }
    if (isCommander(attacker)) {
      if (!cmdTaken[defenderId]) cmdTaken[defenderId] = {};
      const cid = commanderDamageKey(attacker, cmdTaken[defenderId]);
      if (!commanderDamage[defenderId]) commanderDamage[defenderId] = {};
      commanderDamage[defenderId][cid] = (commanderDamage[defenderId][cid] || 0) + amount;
      cmdTaken[defenderId][cid] = (cmdTaken[defenderId][cid] || 0) + amount;
    }
  };

  const runStep = (step: 'first' | 'regular'): void => {
    // Damage in a step is simultaneous: compute assignments, then apply deaths.
    type Pending = {
      attacker: CombatCreature;
      defenderId: string;
      atkPower: number;
      blockers: CombatCreature[];
      blockerDamage: number;
      blockerDeathtouch: boolean;
      blockerLifelink: Array<{ id: string; amount: number }>;
      wasBlocked: boolean;
    };
    const pending: Pending[] = [];

    for (const { attacker, defenderId } of attacks) {
      if (deadMidCombat.has(attacker.id)) continue;
      const atkPower = powerThisStep(attacker, step);
      const blockers = (blockersOf.get(attacker.id) || []).filter(
        (b) => !deadMidCombat.has(b.id),
      );

      let blockerDamage = 0;
      let blockerDeathtouch = false;
      const blockerLifelink: Array<{ id: string; amount: number }> = [];
      for (const b of blockers) {
        const bp = powerThisStep(b, step);
        if (bp <= 0) continue;
        blockerDamage += bp;
        if (b.keywords.deathtouch) blockerDeathtouch = true;
        if (b.keywords.lifelink) {
          blockerLifelink.push({ id: b.controllerId, amount: bp });
        }
      }

      // Original declared blockers (even if already dead) — blocked attackers
      // without trample never hit the player (CR 510.1c / 510.1d).
      const wasBlocked = (blockersOf.get(attacker.id) || []).length > 0;

      if (atkPower <= 0 && blockerDamage <= 0) continue;
      pending.push({
        attacker,
        defenderId,
        atkPower,
        blockers,
        blockerDamage,
        blockerDeathtouch,
        blockerLifelink,
        wasBlocked,
      });
    }

    const newlyDead = new Set<string>();

    for (const p of pending) {
      if (p.atkPower <= 0) {
        // Only blockers deal this step.
      } else if (p.blockers.length === 0) {
        if (!p.wasBlocked) {
          applyPlayerDamage(p.defenderId, p.atkPower, p.attacker);
        } else if (p.attacker.keywords.trample) {
          // All blockers already dead from an earlier step: full power trampls.
          applyPlayerDamage(p.defenderId, p.atkPower, p.attacker);
        }
      } else {
        const { leftover, killed, dealt } = assignToBlockers(
          p.atkPower,
          p.attacker.keywords.deathtouch,
          p.blockers,
          damageTaken,
          newlyDead,
        );
        for (const id of killed) {
          deaths.add(id);
          newlyDead.add(id);
        }
        if (p.attacker.keywords.lifelink && dealt > 0) {
          addLife(lifeGained, p.attacker.controllerId, dealt);
        }
        if (p.attacker.keywords.trample && leftover > 0) {
          applyPlayerDamage(p.defenderId, leftover, p.attacker);
        }
      }

      for (const ll of p.blockerLifelink) {
        addLife(lifeGained, ll.id, ll.amount);
      }

      if (p.blockerDamage > 0 && !p.attacker.keywords.indestructible) {
        const rem = remainingToughness(
          p.attacker,
          damageTaken.get(p.attacker.id) || 0,
        );
        if (rem > 0) {
          const lethal = p.blockerDeathtouch ? 1 : rem;
          const take = Math.min(p.blockerDamage, Math.max(lethal, rem));
          damageTaken.set(
            p.attacker.id,
            (damageTaken.get(p.attacker.id) || 0) + take,
          );
          if (take >= lethal) {
            deaths.add(p.attacker.id);
            newlyDead.add(p.attacker.id);
          }
        }
      }
    }

    for (const id of newlyDead) deadMidCombat.add(id);
  };

  runStep('first');
  runStep('regular');

  // Any creature that accumulated lethal damage without being flagged.
  for (const [id, dmg] of damageTaken) {
    const c = creatures.get(id);
    if (!c || c.keywords.indestructible) continue;
    if (remainingToughness(c, 0) - dmg <= 0) deaths.add(id);
  }

  const defendersKilled: string[] = [];
  for (const d of defenderById.values()) {
    if (d.life <= 0) {
      defendersKilled.push(d.id);
      continue;
    }
    const taken = cmdTaken[d.id] || {};
    for (const total of Object.values(taken)) {
      if (total >= 21) {
        defendersKilled.push(d.id);
        break;
      }
    }
  }

  return {
    deaths: [...deaths],
    lifeLost,
    lifeGained,
    commanderDamage,
    defendersKilled,
    uncertain,
  };
}
