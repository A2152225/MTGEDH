import { describe, expect, it } from 'vitest';
import type { BattlefieldPermanent } from '../../shared/src';
import {
  countTokenDisplayInstances,
  expandGroupedTokensForDisplay,
  groupedTokenMemberCount,
  shouldCollapseTokenGroups,
  tokenDisplayInstanceCount,
  TOKEN_COLLAPSE_THRESHOLD,
} from '../src/utils/expandGroupedTokens';
import { groupCreatures } from '../src/components/CombatSelectionModal-handlers/combatSelectionModalGroupCreatures';

function token(partial: Partial<BattlefieldPermanent> & { id: string }): BattlefieldPermanent {
  return {
    controller: 'ai1' as any,
    owner: 'ai1' as any,
    isToken: true,
    card: { name: 'Soldier', type_line: 'Token Creature — Soldier' } as any,
    ...partial,
  } as BattlefieldPermanent;
}

describe('token display instance counts', () => {
  it('counts a grouped emit stack by tokenCount / groupedTokenIds, not as one card', () => {
    const stack = token({
      id: 'group_tok_a',
      isGroupedTokens: true,
      tokenCount: 20,
      groupedTokenIds: Array.from({ length: 20 }, (_, i) => `tok_${i}`),
    });
    expect(tokenDisplayInstanceCount(stack)).toBe(20);
    expect(countTokenDisplayInstances([stack])).toBe(20);
    expect(shouldCollapseTokenGroups([stack])).toBe(true);
    expect(TOKEN_COLLAPSE_THRESHOLD).toBe(5);
  });

  it('does not collapse a four-token grouped stack below the management threshold', () => {
    const stack = token({
      id: 'group_tok_b',
      isGroupedTokens: true,
      tokenCount: 4,
      groupedTokenIds: ['a', 'b', 'c', 'd'],
    });
    expect(shouldCollapseTokenGroups([stack])).toBe(false);
  });

  it('sums mixed sick/untapped groups so a 20-token swarm still uses Token Management', () => {
    const sick = token({
      id: 'group_sick',
      isGroupedTokens: true,
      tokenCount: 18,
      groupedTokenIds: Array.from({ length: 18 }, (_, i) => `sick_${i}`),
      summoningSickness: true,
    });
    const ready = token({
      id: 'group_ready',
      isGroupedTokens: true,
      tokenCount: 2,
      groupedTokenIds: ['ready_0', 'ready_1'],
    });
    expect(countTokenDisplayInstances([sick, ready])).toBe(20);
    expect(shouldCollapseTokenGroups([sick, ready])).toBe(true);
  });

  it('counts ungrouped tokens as one each', () => {
    const tokens = [token({ id: 'a' }), token({ id: 'b' }), token({ id: 'c' })];
    expect(countTokenDisplayInstances(tokens)).toBe(3);
    expect(shouldCollapseTokenGroups(tokens)).toBe(false);
  });

  it('expands groupedTokenIds even when tokenCount is missing', () => {
    const stack = token({
      id: 'group_tok_c',
      isGroupedTokens: true,
      groupedTokenIds: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(groupedTokenMemberCount(stack)).toBe(5);
    const expanded = expandGroupedTokensForDisplay([stack]);
    expect(expanded.map((perm) => perm.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    const grouped = groupCreatures(expanded);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].creatures).toHaveLength(5);
    expect(groupCreatures([stack])[0].creatures).toHaveLength(5);
  });
});
