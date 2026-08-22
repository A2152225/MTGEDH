import type { BattlefieldPermanent } from '../../../shared/src';

/**
 * Expand server TokenOptimization groups (`group_*` + tokenCount / groupedTokenIds)
 * into individual permanents with real member IDs.
 *
 * Emit collapses identical tokens (same name/controller/tap/sick/etc.) into one entry.
 * Mana-source / LandRow stays collapsed (group id + Nx badge); server resolves group_*
 * on activate/cast/equip/ward payment. FreeField may still expand for free positioning.
 */
export function expandGroupedTokensForDisplay(
  permanents: readonly BattlefieldPermanent[],
): BattlefieldPermanent[] {
  const expanded: BattlefieldPermanent[] = [];
  for (const perm of permanents) {
    const groupedIds = (perm as any).groupedTokenIds as string[] | undefined;
    const tokenCount = Number((perm as any).tokenCount || 0);
    const memberCount = Array.isArray(groupedIds) && groupedIds.length > 0
      ? groupedIds.length
      : tokenCount;
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
        } as BattlefieldPermanent);
      }
    } else {
      expanded.push(perm);
    }
  }
  return expanded;
}
