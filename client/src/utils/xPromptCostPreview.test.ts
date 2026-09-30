import { describe, expect, it } from 'vitest';
import { formatXCostPreview } from '../components/XValueSelectionModal';
import { buildPendingSpellXSelectionFromStep } from './resolutionChoicePrimitives';

describe('X prompt cost preview', () => {
  it('formats generic per-X costs as a single total', () => {
    expect(formatXCostPreview('{1}', 0)).toBe('{0}');
    expect(formatXCostPreview('{1}', 3)).toBe('{3}');
    expect(formatXCostPreview('{2}', 3)).toBe('{6}');
  });
  it('repeats colored per-X symbols', () => {
    expect(formatXCostPreview('{G}', 2)).toBe('{G}{G}');
  });
  it('carries costPerX and the server max onto the pending X selection', () => {
    const pending = buildPendingSpellXSelectionFromStep({ id: 's', sourceName: 'Well of Lost Dreams', description: 'Pay {X}', minX: 0, maxX: 3, costPerX: '{1}' });
    expect(pending.costPerX).toBe('{1}');
    expect(pending.maxValue).toBe(3);
  });
});