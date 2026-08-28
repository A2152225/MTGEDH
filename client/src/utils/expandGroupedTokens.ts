import type { BattlefieldPermanent } from '../../../shared/src';

/** Same threshold TokenGroups uses before collapsing a seat into the management UI. */
export const TOKEN_COLLAPSE_THRESHOLD = 5;

/**
 * How many real token objects an emit battlefield entry represents.
 * Server TokenOptimization can collapse 20 identical tokens into one
 * `isGroupedTokens` row with `tokenCount` / `groupedTokenIds`.
 */
export function groupedTokenMemberCount(perm: BattlefieldPermanent): number {
  if ((perm as any).isGroupedTokens !== true) return 1;
  const groupedIds = (perm as any).groupedTokenIds as string[] | undefined;
  if (Array.isArray(groupedIds) && groupedIds.length > 0) return groupedIds.length;
  const tokenCount = Math.floor(Number((perm as any).tokenCount || 0));
  return tokenCount > 1 ? tokenCount : 1;
}

export function tokenDisplayInstanceCount(perm: BattlefieldPermanent): number {
  return groupedTokenMemberCount(perm);
}

export function countTokenDisplayInstances(permanents: readonly BattlefieldPermanent[]): number {
  let total = 0;
  for (const perm of permanents) {
    total += tokenDisplayInstanceCount(perm);
  }
  return total;
}

/**
 * Route a seat's creature tokens through TokenGroups instead of FreeField.
 * Must count grouped `tokenCount`, not emit row count — otherwise a 20-stack
 * looks like 1 card, Token Management never opens, and FreeField re-expands
 * the stack into 20 tiles (lag on every AI broadcast).
 */
export function shouldCollapseTokenGroups(
  tokens: readonly BattlefieldPermanent[],
  threshold: number = TOKEN_COLLAPSE_THRESHOLD,
): boolean {
  return countTokenDisplayInstances(tokens) >= threshold;
}

/**
 * Expand server TokenOptimization groups (`group_*` + tokenCount / groupedTokenIds)
 * into individual permanents with real member IDs.
 *
 * Emit collapses identical tokens (same name/controller/tap/sick/etc.) into one entry.
 * Mana-source / LandRow and TokenGroups stay collapsed (group id + Nx badge); server
 * resolves group_* on activate/cast/equip/ward payment. Do not use this on the
 * live battlefield layout — expanding undoes emit grouping and recreates per-token DOM.
 */
export function expandGroupedTokensForDisplay(
  permanents: readonly BattlefieldPermanent[],
): BattlefieldPermanent[] {
  const expanded: BattlefieldPermanent[] = [];
  for (const perm of permanents) {
    const groupedIds = (perm as any).groupedTokenIds as string[] | undefined;
    const memberCount = groupedTokenMemberCount(perm);
    const shouldExpand =
      (perm as any).isGroupedTokens === true
      && memberCount > 1;

    if (shouldExpand) {
      const groupId = String(perm.id || `group_${(perm as any).originalId || 'token'}`);
      for (let i = 0; i < memberCount; i += 1) {
        const tokenId =
          Array.isArray(groupedIds) && i < groupedIds.length
            ? String(groupedIds[i])
            : `${groupId}_virtual_${i}`;
        // Keep a pointer to the group / siblings so activation emit can recover real ids
        // if a caller still holds a group_* reference.
        expanded.push({
          ...perm,
          id: tokenId,
          isGroupedTokens: false,
          tokenCount: 1,
          groupedTokenIds: undefined,
          originalId: (perm as any).originalId || (Array.isArray(groupedIds) ? groupedIds[0] : undefined),
          _expandedFromGroupId: groupId,
          _expandedGroupMemberIds: Array.isArray(groupedIds) ? groupedIds.slice() : undefined,
          _virtualFromGroup: groupId,
          _virtualIndex: i,
        } as BattlefieldPermanent);
      }
    } else {
      expanded.push(perm);
    }
  }
  return expanded;
}
