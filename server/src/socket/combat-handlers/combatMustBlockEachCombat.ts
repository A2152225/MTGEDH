// server/src/socket/combat-handlers/combatMustBlockEachCombat.ts
// Blocker-side requirement (CR 509.1c): "~ blocks each combat if able"
// (Watchdog, Razorgrass Screen), Berzerker "attacks or blocks each combat if
// able", Grand Melee "all creatures block each combat if able", and Aura /
// Equipment "enchanted|equipped creature blocks each combat if able".
// Wired through findMustBeBlockedIfAbleViolation / resolve..., so the
// declare-blockers request, combat.ts and the AI all honor it.
// Public: creatureHasMustBlockEachCombat, findMustBlockEachCombatViolation,
//   resolveMustBlockEachCombatAssignments.

import { canBlockAttacker, isCurrentlyCreature } from './combatLegalityGates.js';
import { listAttackersAgainstDefender } from './combatMustBeBlockedIfAble.js';

type Assignment = { blockerId: string; attackerId: string };

const SELF_RE = /(?:\bthis creature|~) (?:attacks or )?blocks each combat if able\b/;
const ATTACHED_RE = /\b(?:enchanted|equipped) creature (?:[^.]*?\band )?(?:attacks or )?blocks each combat if able\b/;
const GLOBAL_RE = /\ball creatures (?:attack and )?block each combat if able\b/;

function lowerOracle(perm: any): string {
  return String(perm?.card?.oracle_text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function selfOracle(perm: any): string {
  const name = String(perm?.card?.name || '').toLowerCase().trim();
  let text = lowerOracle(perm);
  if (name) {
    text = text.split(name).join('~');
    const front = name.split(' // ')[0].split(',')[0].trim();
    if (front && front !== name) text = text.split(front).join('~');
  }
  return text;
}

export function creatureHasMustBlockEachCombat(perm: any, battlefield: readonly any[]): boolean {
  if (!perm) return false;
  if (perm.mustBlockEachCombat === true) return true;
  const granted = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
  if (granted.some((a: unknown) => /blocks each combat if able/i.test(String(a || '')))) return true;
  if (SELF_RE.test(selfOracle(perm))) return true;
  const id = String(perm.id || '');
  for (const other of battlefield) {
    if (!other) continue;
    const text = lowerOracle(other);
    if (!text.includes('block')) continue;
    if (GLOBAL_RE.test(text)) return true;
    if (id && String(other.attachedTo || '') === id && ATTACHED_RE.test(text)) return true;
  }
  return false;
}

function blockableAttackersFor(state: any, blocker: any, defendingPlayerId: string): any[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (String(blocker?.controller || '') !== defendingPlayerId) return [];
  if (blocker.tapped) return [];
  if (!isCurrentlyCreature(blocker, battlefield, defendingPlayerId)) return [];
  return listAttackersAgainstDefender(battlefield, defendingPlayerId).filter(
    (attacker: any) => canBlockAttacker(blocker, attacker, battlefield, defendingPlayerId, state).canBlock,
  );
}

function idleRequiredBlockers(state: any, defendingPlayerId: string, assignments: readonly Assignment[]) {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const assigned = new Set(assignments.map((a) => String(a?.blockerId || '')));
  const out: Array<{ blocker: any; attackers: any[] }> = [];
  for (const perm of battlefield) {
    const id = String(perm?.id || '');
    if (!id || assigned.has(id)) continue;
    if (String(perm?.controller || '') !== defendingPlayerId) continue;
    if (!creatureHasMustBlockEachCombat(perm, battlefield)) continue;
    const attackers = blockableAttackersFor(state, perm, defendingPlayerId);
    if (attackers.length > 0) out.push({ blocker: perm, attackers });
  }
  return out;
}

export function findMustBlockEachCombatViolation(args: {
  state: any;
  defendingPlayerId: string;
  assignments: readonly Assignment[];
}): { code: 'MUST_BE_BLOCKED_IF_ABLE'; message: string; attackerIds: string[]; blockerIds: string[] } | null {
  const defendingPlayerId = String(args.defendingPlayerId || '').trim();
  if (!defendingPlayerId) return null;
  const idle = idleRequiredBlockers(args.state, defendingPlayerId, args.assignments || []);
  if (idle.length === 0) return null;
  const names = idle.map((entry) => entry.blocker?.card?.name || entry.blocker?.id).join(', ');
  return {
    code: 'MUST_BE_BLOCKED_IF_ABLE',
    message: `${names} must block each combat if able.`,
    attackerIds: [],
    blockerIds: idle.map((entry) => String(entry.blocker.id)),
  };
}

export function resolveMustBlockEachCombatAssignments(args: {
  state: any;
  defendingPlayerId: string;
  assignments: readonly Assignment[];
}): Assignment[] {
  const next = [...(args.assignments || [])];
  const defendingPlayerId = String(args.defendingPlayerId || '').trim();
  if (!defendingPlayerId) return next;
  for (const entry of idleRequiredBlockers(args.state, defendingPlayerId, next)) {
    next.push({ blockerId: String(entry.blocker.id), attackerId: String(entry.attackers[0].id) });
  }
  return next;
}
