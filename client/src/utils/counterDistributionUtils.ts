export function buildInitialCounterDistribution(targetIds: readonly string[]): Record<string, number> {
  const initial: Record<string, number> = {};
  for (const targetId of targetIds) {
    const id = String(targetId || '').trim();
    if (!id) continue;
    initial[id] = 0;
  }
  return initial;
}

export function getCounterDistributionAllocated(distribution: Readonly<Record<string, number>>): number {
  return Object.values(distribution).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

export function counterDistributionMeetsMinimums(
  distribution: Readonly<Record<string, number>>,
  targetIds: readonly string[],
  minPerTarget: number,
  totalAmount: number,
): boolean {
  const minimum = Math.max(0, Math.floor(minPerTarget));
  if (totalAmount < targetIds.length * minimum) {
    return true;
  }
  return targetIds.every((targetId) => (distribution[targetId] || 0) >= minimum);
}

export function canConfirmCounterDistribution(args: {
  distribution: Readonly<Record<string, number>>;
  targetIds: readonly string[];
  totalAmount: number;
  minPerTarget?: number;
}): boolean {
  const totalAmount = Math.max(0, Math.floor(args.totalAmount));
  const minPerTarget = Math.max(1, Math.floor(args.minPerTarget ?? 1));
  const allocated = getCounterDistributionAllocated(args.distribution);
  if (allocated !== totalAmount) return false;
  return counterDistributionMeetsMinimums(args.distribution, args.targetIds, minPerTarget, totalAmount);
}
