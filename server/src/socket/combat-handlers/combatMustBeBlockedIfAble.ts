// server/src/socket/combat-handlers/combatMustBeBlockedIfAble.ts
// Origin parent: server/src/socket/combat-handlers/combatDeclareBlockersRequest.ts
// Cluster: Phase 5 must-block declare-blockers enforcement from derived
//   StaticEffectSpec grants (aura/equipment host or self). No card-name
//   routing. All-able vs at-least-one are distinct grants. "If able" reuses
//   canBlockAttacker plus creature/tap gates.
// Public: attackerHasMustBeBlockedIfAble, attackerHasAllAbleCreaturesMustBlock,
//   attackerMustBeBlockedByKeywords, attackerIsAttackingDefender,
//   listAttackersAgainstDefender, findMustBeBlockedIfAbleViolation,
//   resolveMustBeBlockedIfAbleAssignments.

import { getContinuousGrantedAbilitiesForPermanent } from '../../state/modules/staticEffectSpec.js';
import {
  ALL_ABLE_CREATURES_MUST_BLOCK,
  MUST_BE_BLOCKED_IF_ABLE,
} from '../../state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlocked.js';
import { keywordFromMustBeBlockedByAbility } from '../../state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlockedByType.js';
import {
  canBlockAttacker,
  hasEffectiveAbility,
  isCurrentlyCreature,
} from './combatLegalityGates.js';

export type MustBeBlockedIfAbleViolation = {
  code: 'MUST_BE_BLOCKED_IF_ABLE';
  message: string;
  attackerIds: string[];
};

export type BlockerAssignment = {
  blockerId: string;
  attackerId: string;
};

function permanentHasGrantedAbility(
  permanent: any,
  state: unknown,
  ability: string,
): boolean {
  const abilities = getContinuousGrantedAbilitiesForPermanent(permanent, state);
  const needle = String(ability || '').trim().toLowerCase();
  return abilities.some(
    (entry) => String(entry || '').trim().toLowerCase() === needle,
  );
}

export function attackerHasMustBeBlockedIfAble(permanent: any, state: unknown): boolean {
  return permanentHasGrantedAbility(permanent, state, MUST_BE_BLOCKED_IF_ABLE);
}

export function attackerHasAllAbleCreaturesMustBlock(permanent: any, state: unknown): boolean {
  return permanentHasGrantedAbility(permanent, state, ALL_ABLE_CREATURES_MUST_BLOCK);
}

export function attackerMustBeBlockedByKeywords(permanent: any, state: unknown): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const ability of getContinuousGrantedAbilitiesForPermanent(permanent, state)) {
    const keyword = keywordFromMustBeBlockedByAbility(ability);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }
  return keywords;
}

function attackerHasAnyBlockRequirement(permanent: any, state: unknown): boolean {
  return attackerHasMustBeBlockedIfAble(permanent, state)
    || attackerHasAllAbleCreaturesMustBlock(permanent, state)
    || attackerMustBeBlockedByKeywords(permanent, state).length > 0;
}

function readPermanentId(permanent: any): string {
  return String(permanent?.id || '').trim();
}

function readControllerId(permanent: any): string {
  return String(permanent?.controller || '').trim();
}

function isAttackingPermanent(permanent: any): boolean {
  if (!permanent) return false;
  if (permanent.attacking === true || permanent.isAttacking === true) return true;
  return Boolean(String(permanent.attacking || '').trim());
}

export function attackerIsAttackingDefender(
  attacker: any,
  defendingPlayerId: string,
  battlefield: any[],
): boolean {
  const defenderId = String(defendingPlayerId || '').trim();
  if (!defenderId || !isAttackingPermanent(attacker)) return false;
  if (readControllerId(attacker) === defenderId) return false;

  const explicitTargetPlayer = String(
    attacker?.targetPlayerId || attacker?.defendingPlayerId || '',
  ).trim();
  if (explicitTargetPlayer) return explicitTargetPlayer === defenderId;

  const attacking = attacker.attacking;
  // Boolean attacking flags have no defender id. Do not attribute them to
  // every opponent (multiplayer). Require a player or permanent target.
  if (attacking === true || attacker.isAttacking === true) return false;

  const targetRef = String(attacking || attacker?.targetPermanentId || '').trim();
  if (!targetRef) return false;
  if (targetRef === defenderId) return true;

  const targetPerm = battlefield.find((perm: any) => readPermanentId(perm) === targetRef);
  return Boolean(targetPerm && readControllerId(targetPerm) === defenderId);
}

export function listAttackersAgainstDefender(battlefield: any[], defendingPlayerId: string): any[] {
  const bf = Array.isArray(battlefield) ? battlefield : [];
  return bf.filter((perm) => attackerIsAttackingDefender(perm, defendingPlayerId, bf));
}

function creatureCanAssignAsBlocker(
  blocker: any,
  attacker: any,
  battlefield: any[],
  defendingPlayerId: string,
  state?: unknown,
): boolean {
  if (!blocker || !attacker) return false;
  if (readControllerId(blocker) !== String(defendingPlayerId || '').trim()) return false;
  if (!isCurrentlyCreature(blocker, battlefield, defendingPlayerId)) return false;
  if (blocker.tapped) return false;
  return canBlockAttacker(blocker, attacker, battlefield, defendingPlayerId, state).canBlock;
}

function permanentHasRequiredBlockKeyword(
  permanent: any,
  keyword: string,
  battlefield: any[],
  defendingPlayerId: string,
  state: unknown,
): boolean {
  const needle = String(keyword || '').trim().toLowerCase();
  if (!needle) return false;
  if (hasEffectiveAbility(permanent, needle, battlefield, defendingPlayerId).hasAbility) {
    return true;
  }
  return getContinuousGrantedAbilitiesForPermanent(permanent, state).some(
    (entry) => String(entry || '').trim().toLowerCase() === needle,
  );
}

function creatureCanAssignAsTypedBlocker(
  blocker: any,
  attacker: any,
  keyword: string,
  battlefield: any[],
  defendingPlayerId: string,
  state: unknown,
): boolean {
  if (!creatureCanAssignAsBlocker(blocker, attacker, battlefield, defendingPlayerId, state)) {
    return false;
  }
  return permanentHasRequiredBlockKeyword(
    blocker,
    keyword,
    battlefield,
    defendingPlayerId,
    state,
  );
}

function assignmentMapFrom(
  assignments: readonly BlockerAssignment[],
): Map<string, string> {
  const assignmentByBlockerId = new Map<string, string>();
  for (const entry of assignments || []) {
    const blockerId = String(entry?.blockerId || '').trim();
    const attackerId = String(entry?.attackerId || '').trim();
    if (blockerId && attackerId) assignmentByBlockerId.set(blockerId, attackerId);
  }
  return assignmentByBlockerId;
}

function assignedToOtherAllAbleTheyCanBlock(
  candidate: any,
  assignedTo: string,
  battlefield: any[],
  defendingPlayerId: string,
  state: unknown,
): boolean {
  const assignedAttacker = battlefield.find((perm: any) => readPermanentId(perm) === assignedTo);
  if (!attackerHasAllAbleCreaturesMustBlock(assignedAttacker, state)) return false;
  return creatureCanAssignAsBlocker(candidate, assignedAttacker, battlefield, defendingPlayerId, state);
}

/**
 * All-able leftover: this creature can block the lure-style attacker and is
 * unused, or is assigned only to a non-all-able attacker. Assignment to
 * another all-able attacker they can legally block is a legal CR 509
 * alternative, not an idle leftover.
 */
function blockerIsIdleVersusAllAbleAttacker(
  candidate: any,
  attacker: any,
  attackerId: string,
  battlefield: any[],
  defendingPlayerId: string,
  assignmentByBlockerId: Map<string, string>,
  state: unknown,
): boolean {
  const candidateId = readPermanentId(candidate);
  if (!candidateId) return false;
  if (!creatureCanAssignAsBlocker(candidate, attacker, battlefield, defendingPlayerId, state)) {
    return false;
  }
  const assignedTo = assignmentByBlockerId.get(candidateId);
  if (!assignedTo) return true;
  if (assignedTo === attackerId) return false;
  return !assignedToOtherAllAbleTheyCanBlock(
    candidate,
    assignedTo,
    battlefield,
    defendingPlayerId,
    state,
  );
}

function blockerIsAvailableForAtLeastOneAttacker(
  candidate: any,
  attacker: any,
  attackerId: string,
  battlefield: any[],
  defendingPlayerId: string,
  assignmentByBlockerId: Map<string, string>,
  state: unknown,
): boolean {
  const candidateId = readPermanentId(candidate);
  if (!candidateId) return false;
  if (!creatureCanAssignAsBlocker(candidate, attacker, battlefield, defendingPlayerId, state)) {
    return false;
  }
  const assignedTo = assignmentByBlockerId.get(candidateId);
  if (!assignedTo) return true;
  if (assignedTo === attackerId) return false;
  const assignedAttacker = battlefield.find((perm: any) => readPermanentId(perm) === assignedTo);
  return !attackerHasAnyBlockRequirement(assignedAttacker, state);
}

function blockerIsAvailableForTypedAttacker(
  candidate: any,
  attacker: any,
  attackerId: string,
  keyword: string,
  battlefield: any[],
  defendingPlayerId: string,
  assignmentByBlockerId: Map<string, string>,
  state: unknown,
): boolean {
  const candidateId = readPermanentId(candidate);
  if (!candidateId) return false;
  if (!creatureCanAssignAsTypedBlocker(
    candidate,
    attacker,
    keyword,
    battlefield,
    defendingPlayerId,
    state,
  )) {
    return false;
  }
  const assignedTo = assignmentByBlockerId.get(candidateId);
  if (!assignedTo) return true;
  if (assignedTo === attackerId) return false;
  const assignedAttacker = battlefield.find((perm: any) => readPermanentId(perm) === assignedTo);
  return !attackerHasAnyBlockRequirement(assignedAttacker, state);
}

function attackerIsBlockedByKeywordCreature(
  attackerId: string,
  keyword: string,
  battlefield: any[],
  defendingPlayerId: string,
  assignmentByBlockerId: Map<string, string>,
  state: unknown,
): boolean {
  for (const [blockerId, assignedAttackerId] of assignmentByBlockerId) {
    if (assignedAttackerId !== attackerId) continue;
    const blocker = battlefield.find((perm: any) => readPermanentId(perm) === blockerId);
    if (!blocker) continue;
    if (permanentHasRequiredBlockKeyword(
      blocker,
      keyword,
      battlefield,
      defendingPlayerId,
      state,
    )) {
      return true;
    }
  }
  return false;
}

function findAvailableLegalBlockerId(args: {
  state: any;
  defendingPlayerId: string;
  attackerId: string;
  assignments: readonly BlockerAssignment[];
}): string | null {
  const battlefield = Array.isArray(args.state?.battlefield) ? args.state.battlefield : [];
  const attacker = battlefield.find((perm: any) => readPermanentId(perm) === args.attackerId);
  if (!attacker) return null;
  const assignmentByBlockerId = assignmentMapFrom(args.assignments);
  const typedKeywords = attackerMustBeBlockedByKeywords(attacker, args.state)
    .filter((keyword) => !attackerIsBlockedByKeywordCreature(
      args.attackerId,
      keyword,
      battlefield,
      args.defendingPlayerId,
      assignmentByBlockerId,
      args.state,
    ));
  if (typedKeywords.length > 0) {
    const keyword = typedKeywords[0];
    const typedCandidate = battlefield.find((entry: any) =>
      blockerIsAvailableForTypedAttacker(
        entry,
        attacker,
        args.attackerId,
        keyword,
        battlefield,
        args.defendingPlayerId,
        assignmentByBlockerId,
        args.state,
      ),
    );
    return typedCandidate ? readPermanentId(typedCandidate) : null;
  }
  const isAllAble = attackerHasAllAbleCreaturesMustBlock(attacker, args.state);
  const candidate = battlefield.find((entry: any) => (
    isAllAble
      ? blockerIsIdleVersusAllAbleAttacker(
        entry,
        attacker,
        args.attackerId,
        battlefield,
        args.defendingPlayerId,
        assignmentByBlockerId,
        args.state,
      )
      : blockerIsAvailableForAtLeastOneAttacker(
        entry,
        attacker,
        args.attackerId,
        battlefield,
        args.defendingPlayerId,
        assignmentByBlockerId,
        args.state,
      )
  ));
  return candidate ? readPermanentId(candidate) : null;
}

type NamedAttacker = { id: string; name: string };

function pushNamedAttacker(list: NamedAttacker[], attacker: any, attackerId: string): void {
  list.push({
    id: attackerId,
    name: String(attacker?.card?.name || attacker?.name || 'This creature'),
  });
}

function violationFrom(
  attackers: NamedAttacker[],
  allAble: boolean,
  keyword?: string,
): MustBeBlockedIfAbleViolation {
  const names = attackers.map((entry) => entry.name);
  const typedKeyword = String(keyword || '').trim();
  const message = typedKeyword
    ? (names.length === 1
      ? `${names[0]} must be blocked by a creature with ${typedKeyword} if able`
      : `The following attacker(s) must be blocked by a creature with ${typedKeyword} if able: ${names.join(', ')}`)
    : allAble
      ? (names.length === 1
        ? `All creatures able to block ${names[0]} must do so`
        : `All creatures able to block the following attacker(s) must do so: ${names.join(', ')}`)
      : (names.length === 1
        ? `${names[0]} must be blocked if able`
        : `The following attacker(s) must be blocked if able: ${names.join(', ')}`);
  return {
    code: 'MUST_BE_BLOCKED_IF_ABLE',
    message,
    attackerIds: attackers.map((entry) => entry.id),
  };
}

/**
 * All-able (Lure family): every remaining creature that can block that
 * attacker must be assigned to it, or to another all-able attacker they can
 * legally block (CR 509 — do not reject an equally complete assignment).
 * At-least-one: each granted attacker that is still unblocked needs at least
 * one unused legal blocker. A blocker already assigned to another requirement
 * attacker is spent.
 * Typed `must_be_blocked_by_<keyword>`: skip is illegal only when a legal
 * blocker with that keyword is still unused. Ground (etc.) creatures are
 * not forced, and skip stays legal when no matching blocker can block.
 */
export function findMustBeBlockedIfAbleViolation(args: {
  state: any;
  defendingPlayerId: string;
  assignments: readonly BlockerAssignment[];
}): MustBeBlockedIfAbleViolation | null {
  const state = args.state;
  const defendingPlayerId = String(args.defendingPlayerId || '').trim();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (!defendingPlayerId) return null;

  const assignmentByBlockerId = assignmentMapFrom(args.assignments);
  const blockedAttackerIds = new Set(assignmentByBlockerId.values());

  const allAbleUnblocked: NamedAttacker[] = [];
  const allAbleIdle: NamedAttacker[] = [];
  const atLeastOneUnblocked: NamedAttacker[] = [];
  const typedUnblockedByKeyword = new Map<string, NamedAttacker[]>();

  for (const attacker of battlefield) {
    if (!attackerIsAttackingDefender(attacker, defendingPlayerId, battlefield)) continue;
    const attackerId = readPermanentId(attacker);
    if (!attackerId) continue;

    if (attackerHasAllAbleCreaturesMustBlock(attacker, state)) {
      const hasIdle = battlefield.some((candidate: any) =>
        blockerIsIdleVersusAllAbleAttacker(
          candidate,
          attacker,
          attackerId,
          battlefield,
          defendingPlayerId,
          assignmentByBlockerId,
          state,
        ),
      );
      if (!hasIdle) continue;
      if (blockedAttackerIds.has(attackerId)) {
        pushNamedAttacker(allAbleIdle, attacker, attackerId);
      } else {
        pushNamedAttacker(allAbleUnblocked, attacker, attackerId);
      }
      continue;
    }

    if (attackerHasMustBeBlockedIfAble(attacker, state) && !blockedAttackerIds.has(attackerId)) {
      const hasAvailableLegalBlocker = battlefield.some((candidate: any) =>
        blockerIsAvailableForAtLeastOneAttacker(
          candidate,
          attacker,
          attackerId,
          battlefield,
          defendingPlayerId,
          assignmentByBlockerId,
          state,
        ),
      );
      if (hasAvailableLegalBlocker) {
        pushNamedAttacker(atLeastOneUnblocked, attacker, attackerId);
      }
    }

    for (const keyword of attackerMustBeBlockedByKeywords(attacker, state)) {
      if (attackerIsBlockedByKeywordCreature(
        attackerId,
        keyword,
        battlefield,
        defendingPlayerId,
        assignmentByBlockerId,
        state,
      )) {
        continue;
      }
      const hasAvailableTypedBlocker = battlefield.some((candidate: any) =>
        blockerIsAvailableForTypedAttacker(
          candidate,
          attacker,
          attackerId,
          keyword,
          battlefield,
          defendingPlayerId,
          assignmentByBlockerId,
          state,
        ),
      );
      if (!hasAvailableTypedBlocker) continue;
      const list = typedUnblockedByKeyword.get(keyword) || [];
      pushNamedAttacker(list, attacker, attackerId);
      typedUnblockedByKeyword.set(keyword, list);
    }
  }

  if (allAbleUnblocked.length > 0) return violationFrom(allAbleUnblocked, true);
  if (allAbleIdle.length > 0) return violationFrom(allAbleIdle, true);
  if (atLeastOneUnblocked.length > 0) return violationFrom(atLeastOneUnblocked, false);
  for (const [keyword, attackers] of typedUnblockedByKeyword) {
    if (attackers.length > 0) return violationFrom(attackers, false, keyword);
  }
  return null;
}

/**
 * AI / empty-declare repair: assign unused legal blockers to unblocked
 * must-block attackers (all-able first, then at-least-one). Reassigns a
 * blocker only when it is currently assigned to a non-requirement attacker
 * (or, for all-able, a non-all-able attacker). Never invents illegal blocks.
 * Callers must still refuse to stamp a remaining violation.
 */
export function resolveMustBeBlockedIfAbleAssignments(args: {
  state: any;
  defendingPlayerId: string;
  assignments: readonly BlockerAssignment[];
}): BlockerAssignment[] {
  const assignments: BlockerAssignment[] = [];
  const seenBlockers = new Set<string>();
  for (const entry of args.assignments || []) {
    const blockerId = String(entry?.blockerId || '').trim();
    const attackerId = String(entry?.attackerId || '').trim();
    if (!blockerId || !attackerId || seenBlockers.has(blockerId)) continue;
    seenBlockers.add(blockerId);
    assignments.push({ blockerId, attackerId });
  }

  const battlefield = Array.isArray(args.state?.battlefield) ? args.state.battlefield : [];
  const maxPasses = Math.max(4, battlefield.length + 2);
  for (let i = 0; i < maxPasses; i++) {
    const violation = findMustBeBlockedIfAbleViolation({
      state: args.state,
      defendingPlayerId: args.defendingPlayerId,
      assignments,
    });
    if (!violation) return assignments;
    const attackerId = String(violation.attackerIds[0] || '').trim();
    if (!attackerId) break;
    const blockerId = findAvailableLegalBlockerId({
      state: args.state,
      defendingPlayerId: args.defendingPlayerId,
      attackerId,
      assignments,
    });
    if (!blockerId) break;
    const next = assignments.filter((entry) => entry.blockerId !== blockerId);
    next.push({ blockerId, attackerId });
    assignments.length = 0;
    assignments.push(...next);
  }
  return assignments;
}
