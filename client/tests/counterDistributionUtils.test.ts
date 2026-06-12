import { describe, expect, it } from 'vitest';
import {
  buildInitialCounterDistribution,
  canConfirmCounterDistribution,
  counterDistributionMeetsMinimums,
  getCounterDistributionAllocated,
} from '../src/utils/counterDistributionUtils';

describe('counterDistributionUtils', () => {
  it('builds zeroed distribution maps for each target id', () => {
    expect(buildInitialCounterDistribution(['t1', 't2'])).toEqual({ t1: 0, t2: 0 });
  });

  it('requires full allocation and per-target minimums before confirm', () => {
    const targets = ['t1', 't2'];
    expect(
      canConfirmCounterDistribution({
        distribution: { t1: 2, t2: 1 },
        targetIds: targets,
        totalAmount: 3,
        minPerTarget: 1,
      }),
    ).toBe(true);
    expect(
      canConfirmCounterDistribution({
        distribution: { t1: 3, t2: 0 },
        targetIds: targets,
        totalAmount: 3,
        minPerTarget: 1,
      }),
    ).toBe(false);
    expect(
      canConfirmCounterDistribution({
        distribution: { t1: 1, t2: 1 },
        targetIds: targets,
        totalAmount: 3,
        minPerTarget: 1,
      }),
    ).toBe(false);
  });

  it('allows uneven minimum enforcement when total cannot satisfy every minimum', () => {
    expect(counterDistributionMeetsMinimums({ t1: 1, t2: 0 }, ['t1', 't2'], 1, 1)).toBe(true);
    expect(getCounterDistributionAllocated({ t1: 2, t2: 1 })).toBe(3);
  });
});
