import { describe, expect, it } from 'vitest';

import {
  isGroupedTargetSelectionComplete,
  type TargetSelectionGroup,
} from '../src/components/TargetSelectionModal';
import { formatStackTargetControllerLabel } from '../src/components/CentralStack';

const groups: TargetSelectionGroup[] = [
  {
    playerId: 'p1',
    label: 'Caster',
    required: true,
    minTargets: 1,
    maxTargets: 1,
    targets: [{ id: 'a', name: 'A', type: 'permanent', controller: 'p1' }],
  },
  {
    playerId: 'p2',
    label: 'Opponent',
    required: true,
    minTargets: 1,
    maxTargets: 1,
    targets: [
      { id: 'b', name: 'B', type: 'permanent', controller: 'p2' },
      { id: 'c', name: 'C', type: 'permanent', controller: 'p2' },
    ],
  },
];

describe('grouped target selection UI validation', () => {
  it('requires a valid selection in every player section', () => {
    expect(isGroupedTargetSelectionComplete(new Set(['a', 'b']), groups, 2, 2)).toBe(true);
    expect(isGroupedTargetSelectionComplete(new Set(['a']), groups, 2, 2)).toBe(false);
    expect(isGroupedTargetSelectionComplete(new Set(['b', 'c']), groups, 2, 2)).toBe(false);
  });

  it('shows target controllers by name for stack at-a-glance information', () => {
    const playerNames: Record<string, string> = { p1: 'Alice', p2: 'Bob' };
    expect(formatStackTargetControllerLabel('p1', undefined, (id) => playerNames[id] || id)).toBe('Alice');
    expect(formatStackTargetControllerLabel('p2', 'Opponent Bob', (id) => playerNames[id] || id)).toBe('Opponent Bob');
  });
});
