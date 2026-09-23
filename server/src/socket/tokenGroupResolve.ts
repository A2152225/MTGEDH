import type { PlayerID } from '../../../shared/src/index.js';

type TokenGroupMemberPredicate = (perm: any) => boolean;

export function registerTokenGroupMembers(
  game: any,
  groupId: string,
  memberIds: readonly string[],
): void {
  if (!game || !groupId) return;
  const members = memberIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (members.length === 0) return;
  game._tokenGroupMembers = game._tokenGroupMembers || {};
  game._tokenGroupMembers[groupId] = members;
}

export function getTokenGroupMembers(game: any, groupId: string): string[] {
  const stored = game?._tokenGroupMembers?.[groupId];
  if (Array.isArray(stored) && stored.length > 0) {
    return stored.slice();
  }
  return rebuildTokenGroupMembersFromBattlefield(game, groupId);
}

function getGroupPrototype(game: any, groupId: string): any | null {
  const battlefield = game?.state?.battlefield || [];
  const direct = battlefield.find((perm: any) => String(perm?.id || '') === groupId);
  if (direct) return direct;

  if (!groupId.startsWith('group_')) return null;
  const originalId = groupId.slice('group_'.length);
  return battlefield.find((perm: any) => String(perm?.id || '') === originalId) || null;
}

function matchesGroupPrototype(perm: any, prototype: any, options?: { ignoreTapState?: boolean }): boolean {
  if (!perm || !prototype) return false;
  if (perm.controller !== prototype.controller) return false;

  const prototypeIsToken = prototype.isToken === true;
  const permIsToken = perm.isToken === true;
  // Token piles and land piles both use group_* refs; do not mix kinds.
  if (prototypeIsToken !== permIsToken) return false;
  if (!prototypeIsToken) {
    const prototypeType = String(prototype.card?.type_line || '').toLowerCase();
    const permType = String(perm.card?.type_line || '').toLowerCase();
    if (!prototypeType.includes('land') || !permType.includes('land')) return false;
  }

  const prototypeName = String(prototype.card?.name || '');
  const permName = String(perm.card?.name || '');
  if (prototypeName && permName !== prototypeName) return false;

  if (!options?.ignoreTapState) {
    if (!!perm.tapped !== !!prototype.tapped) return false;
    if (!!perm.summoningSickness !== !!prototype.summoningSickness) return false;
  }

  const prototypePower = prototype.effectivePower ?? prototype.basePower ?? prototype.card?.power;
  const permPower = perm.effectivePower ?? perm.basePower ?? perm.card?.power;
  const prototypeToughness = prototype.effectiveToughness ?? prototype.baseToughness ?? prototype.card?.toughness;
  const permToughness = perm.effectiveToughness ?? perm.baseToughness ?? perm.card?.toughness;
  if (prototypePower !== undefined && permPower !== undefined && prototypePower !== permPower) return false;
  if (prototypeToughness !== undefined && permToughness !== undefined && prototypeToughness !== permToughness) return false;

  return true;
}

export function rebuildTokenGroupMembersFromBattlefield(game: any, groupId: string): string[] {
  const battlefield = game?.state?.battlefield || [];
  const groupEntry = battlefield.find((perm: any) => String(perm?.id || '') === groupId);
  if (Array.isArray(groupEntry?.groupedTokenIds) && groupEntry.groupedTokenIds.length > 0) {
    const ids = groupEntry.groupedTokenIds.map((id: unknown) => String(id)).filter(Boolean);
    registerTokenGroupMembers(game, groupId, ids);
    return ids;
  }

  const prototype = getGroupPrototype(game, groupId);
  if (!prototype) return [];

  // Ignore live tap/sick on the prototype: after a partial tap (or post-restart),
  // the named original id may already be tapped while siblings are still untapped.
  const members = battlefield
    .filter((perm: any) => {
      if (!perm || perm.isGroupedTokens === true) return false;
      if (String(perm?.id || '').startsWith('group_')) return false;
      return matchesGroupPrototype(perm, prototype, { ignoreTapState: true });
    })
    .map((perm: any) => String(perm.id))
    .filter(Boolean);

  if (members.length > 0) {
    registerTokenGroupMembers(game, groupId, members);
  }
  return members;
}

export function parseGroupedPermanentRef(refId: string): { groupId: string; index?: number } | null {
  const id = String(refId || '').trim();
  if (!id) return null;

  const virtualMatch = id.match(/^(.+)_virtual_(\d+)$/);
  if (virtualMatch) {
    return {
      groupId: virtualMatch[1],
      index: Number.parseInt(virtualMatch[2], 10),
    };
  }

  if (id.startsWith('group_')) {
    return { groupId: id };
  }

  return null;
}

export function resolveGroupedPermanentRef(
  game: any,
  playerId: PlayerID,
  refId: string,
  options?: {
    usedIds?: Set<string>;
    predicate?: TokenGroupMemberPredicate;
  },
): string | null {
  const battlefield = game?.state?.battlefield || [];
  const normalizedRef = String(refId || '').trim();
  if (!normalizedRef) return null;

  const direct = battlefield.find(
    (perm: any) => String(perm?.id || '') === normalizedRef && perm?.controller === playerId,
  );
  if (direct) {
    if (options?.predicate && !options.predicate(direct)) return null;
    if (options?.usedIds?.has(normalizedRef)) return null;
    return normalizedRef;
  }

  const parsed = parseGroupedPermanentRef(normalizedRef);
  if (!parsed) return null;

  const members = getTokenGroupMembers(game, parsed.groupId);
  const prototype = getGroupPrototype(game, parsed.groupId);

  const tryMember = (memberId: string): string | null => {
    if (!memberId || options?.usedIds?.has(memberId)) return null;
    const perm = battlefield.find((entry: any) => String(entry?.id || '') === memberId);
    if (!perm || perm.controller !== playerId) return null;
    if (options?.predicate && !options.predicate(perm)) return null;
    return memberId;
  };

  if (parsed.index !== undefined && Number.isFinite(parsed.index) && parsed.index >= 0) {
    const indexedMember = members[parsed.index];
    if (indexedMember) {
      const indexed = tryMember(indexedMember);
      if (indexed) return indexed;
    }
  }

  for (const memberId of members) {
    const resolved = tryMember(memberId);
    if (resolved) return resolved;
  }

  if (!prototype) return null;
  for (const perm of battlefield) {
    // Fall back across tap/sick drift between emit grouping and live board.
    if (!matchesGroupPrototype(perm, prototype, { ignoreTapState: true })) continue;
    const resolved = tryMember(String(perm.id));
    if (resolved) return resolved;
  }

  return null;
}

/**
 * Resolve a client attacker ref that may still be a emit-time `group_*` / `_virtual_` id.
 * Attackers are controlled by the attacking player, so this does not filter by the
 * declaring (defending) player id.
 */
export function resolveGroupedAttackerRef(
  game: any,
  refId: string,
  options?: {
    usedIds?: Set<string>;
  },
): string | null {
  const battlefield = game?.state?.battlefield || [];
  const normalizedRef = String(refId || '').trim();
  if (!normalizedRef) return null;

  const isAttackingPerm = (perm: any): boolean =>
    typeof perm?.attacking === 'string' && perm.attacking.length > 0;

  const direct = battlefield.find(
    (perm: any) => String(perm?.id || '') === normalizedRef && isAttackingPerm(perm),
  );
  if (direct) {
    if (options?.usedIds?.has(normalizedRef)) return null;
    return normalizedRef;
  }

  const parsed = parseGroupedPermanentRef(normalizedRef);
  if (!parsed) return null;

  const members = getTokenGroupMembers(game, parsed.groupId);
  const prototype = getGroupPrototype(game, parsed.groupId);

  const tryMember = (memberId: string): string | null => {
    if (!memberId || options?.usedIds?.has(memberId)) return null;
    const perm = battlefield.find((entry: any) => String(entry?.id || '') === memberId);
    if (!perm || !isAttackingPerm(perm)) return null;
    return memberId;
  };

  if (parsed.index !== undefined && Number.isFinite(parsed.index) && parsed.index >= 0) {
    const indexedMember = members[parsed.index];
    if (indexedMember) {
      const indexed = tryMember(indexedMember);
      if (indexed) return indexed;
    }
  }

  for (const memberId of members) {
    const resolved = tryMember(memberId);
    if (resolved) return resolved;
  }

  if (!prototype) return null;
  for (const perm of battlefield) {
    if (!isAttackingPerm(perm)) continue;
    if (!matchesGroupPrototype(perm, prototype, { ignoreTapState: true })) continue;
    const resolved = tryMember(String(perm.id));
    if (resolved) return resolved;
  }

  return null;
}

export type RawAttackerSelection = {
  creatureId?: string;
  groupId?: string;
  count?: number;
  targetPlayerId?: string;
  targetPermanentId?: string;
  defendingPlayerId?: string;
};

export type ResolvedAttackerSelection = {
  creatureId: string;
  targetPlayerId?: string;
  targetPermanentId?: string;
  defendingPlayerId?: string;
};

export function normalizeAttackerSelections(
  game: any,
  playerId: PlayerID,
  attackers: readonly RawAttackerSelection[],
  options?: {
    predicate?: TokenGroupMemberPredicate;
  },
): ResolvedAttackerSelection[] {
  const expanded: ResolvedAttackerSelection[] = [];
  const usedIds = new Set<string>();

  for (const attacker of attackers) {
    const groupId = String(attacker.groupId || '').trim();
    const groupCount = Math.max(0, Math.floor(Number(attacker.count) || 0));
    if (groupId && groupCount > 0) {
      for (let i = 0; i < groupCount; i += 1) {
        const resolvedId = resolveGroupedPermanentRef(game, playerId, `${groupId}_virtual_${i}`, {
          usedIds,
          predicate: options?.predicate,
        }) ?? resolveNextGroupMember(game, playerId, groupId, usedIds, options?.predicate);
        if (!resolvedId) {
          throw Object.assign(new Error(`No available token in group ${groupId}`), {
            code: 'INVALID_ATTACKER',
          });
        }
        usedIds.add(resolvedId);
        expanded.push({
          creatureId: resolvedId,
          targetPlayerId: attacker.targetPlayerId,
          targetPermanentId: attacker.targetPermanentId,
          defendingPlayerId: attacker.defendingPlayerId,
        });
      }
      continue;
    }

    const creatureRef = String(attacker.creatureId || '').trim();
    if (!creatureRef) continue;

    const resolvedId = resolveGroupedPermanentRef(game, playerId, creatureRef, {
      usedIds,
      predicate: options?.predicate,
    });
    if (!resolvedId) {
      throw Object.assign(new Error(`Invalid attacker selection: ${creatureRef}`), {
        code: 'DECLARE_ATTACKERS_ERROR',
      });
    }
    usedIds.add(resolvedId);
    expanded.push({
      creatureId: resolvedId,
      targetPlayerId: attacker.targetPlayerId,
      targetPermanentId: attacker.targetPermanentId,
      defendingPlayerId: attacker.defendingPlayerId,
    });
  }

  return expanded;
}

function resolveNextGroupMember(
  game: any,
  playerId: PlayerID,
  groupId: string,
  usedIds: Set<string>,
  predicate?: TokenGroupMemberPredicate,
): string | null {
  const members = getTokenGroupMembers(game, groupId);
  for (const memberId of members) {
    const resolved = resolveGroupedPermanentRef(game, playerId, memberId, { usedIds, predicate });
    if (resolved) return resolved;
  }
  return resolveGroupedPermanentRef(game, playerId, groupId, { usedIds, predicate });
}
