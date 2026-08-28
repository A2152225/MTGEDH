// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: groupCreatures (and CreatureGroup, which it closes over).
// Public entry symbols: groupCreatures, CreatureGroup.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import type { BattlefieldPermanent } from '../../../../shared/src';
import type { DangerIndicators } from './combatSelectionModalCreatureInfo';
import { getCreatureInfo } from './combatSelectionModalCreatureInfo';
import { groupedTokenMemberCount } from '../../utils/expandGroupedTokens';

/**
 * Group identical creatures (tokens) for easier selection
 */
export interface CreatureGroup {
  key: string;
  name: string;
  pt: string;
  creatures: BattlefieldPermanent[];
  isToken: boolean;
  imageUrl?: string;
  dangers: DangerIndicators;
}

export function groupCreatures(creatures: BattlefieldPermanent[]): CreatureGroup[] {
  const map = new Map<string, CreatureGroup>();
  
  for (const c of creatures) {
    const { name, pt, imageUrl, dangers } = getCreatureInfo(c);
    const isToken = !!(c as any).isToken;
    
    // Create a key based on name and P/T for grouping
    const key = `${name}|${pt}|${isToken ? 'token' : 'card'}`;
    
    // Handle server-side grouped tokens (optimization for games with many tokens)
    // If this is a grouped token, we need to expand it into virtual creatures
    if (groupedTokenMemberCount(c) > 1) {
      const tokenCount = groupedTokenMemberCount(c);
      const groupedIds = (c as any).groupedTokenIds as string[] | undefined;
      const groupId = c.id;
      
      // Create virtual creatures for each token in the group
      const existing = map.get(key);
      if (existing) {
        // Add virtual creature references for each token in the group
        for (let i = 0; i < tokenCount; i++) {
          // Use actual ID from groupedIds if available, otherwise create a unique fallback
          const actualId = groupedIds && i < groupedIds.length ? groupedIds[i] : `${groupId}_virtual_${i}`;
          const virtualCreature = {
            ...c,
            id: actualId,
            isGroupedTokens: false, // Not grouped anymore at UI level
            tokenCount: undefined,
            groupedTokenIds: undefined,
            _virtualFromGroup: groupId, // Track which group this came from
            _virtualIndex: i,
          } as BattlefieldPermanent;
          existing.creatures.push(virtualCreature);
        }
      } else {
        const virtualCreatures: BattlefieldPermanent[] = [];
        for (let i = 0; i < tokenCount; i++) {
          // Use actual ID from groupedIds if available, otherwise create a unique fallback
          const actualId = groupedIds && i < groupedIds.length ? groupedIds[i] : `${groupId}_virtual_${i}`;
          const virtualCreature = {
            ...c,
            id: actualId,
            isGroupedTokens: false,
            tokenCount: undefined,
            groupedTokenIds: undefined,
            _virtualFromGroup: groupId,
            _virtualIndex: i,
          } as BattlefieldPermanent;
          virtualCreatures.push(virtualCreature);
        }
        map.set(key, {
          key,
          name,
          pt,
          creatures: virtualCreatures,
          isToken,
          imageUrl,
          dangers,
        });
      }
    } else {
      // Normal creature - add to group as before
      const existing = map.get(key);
      if (existing) {
        existing.creatures.push(c);
      } else {
        map.set(key, {
          key,
          name,
          pt,
          creatures: [c],
          isToken,
          imageUrl,
          dangers,
        });
      }
    }
  }
  
  return Array.from(map.values()).sort((a, b) => {
    // Sort tokens last, then by name
    if (a.isToken !== b.isToken) return a.isToken ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}
