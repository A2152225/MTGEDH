/**
 * Season-style "{P} worth of modes" selection helpers.
 * Shared by client modal UX and server MODE_SELECTION validation.
 */

export type PBudgetModeOption = {
  readonly id: string;
  readonly pCost?: number;
};

export function modePCost(mode: PBudgetModeOption | undefined): number {
  const raw = Number(mode?.pCost);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  // Modes without an explicit cost count as 1 {P} when a budget is active.
  return 1;
}

export function sumSelectedPCost(
  selectedModeIds: readonly string[],
  modes: readonly PBudgetModeOption[],
): number {
  const byId = new Map(modes.map((mode) => [String(mode.id || '').trim(), mode] as const));
  let total = 0;
  for (const rawId of selectedModeIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    total += modePCost(byId.get(id));
  }
  return total;
}

export function canAddModeUnderPBudget(
  selectedModeIds: readonly string[],
  modeId: string,
  modes: readonly PBudgetModeOption[],
  pBudget: number,
  canRepeatModes: boolean,
): boolean {
  const id = String(modeId || '').trim();
  if (!id || !(Number.isFinite(pBudget) && pBudget > 0)) return false;
  if (!canRepeatModes && selectedModeIds.some((entry) => String(entry) === id)) {
    return false;
  }
  const mode = modes.find((entry) => String(entry.id || '').trim() === id);
  if (!mode) return false;
  const nextCost = sumSelectedPCost(selectedModeIds, modes) + modePCost(mode);
  return nextCost <= pBudget;
}

export function isValidPBudgetSelection(
  selectedModeIds: readonly string[],
  modes: readonly PBudgetModeOption[],
  pBudget: number,
  options?: {
    readonly minModes?: number;
    readonly canRepeatModes?: boolean;
  },
): boolean {
  if (!(Number.isFinite(pBudget) && pBudget > 0)) return false;
  const minModes = Math.max(0, Number(options?.minModes ?? 0) || 0);
  const canRepeatModes = Boolean(options?.canRepeatModes);
  if (selectedModeIds.length < minModes) return false;

  const byId = new Map(modes.map((mode) => [String(mode.id || '').trim(), mode] as const));
  for (const rawId of selectedModeIds) {
    const id = String(rawId || '').trim();
    if (!id || !byId.has(id)) return false;
  }

  if (!canRepeatModes) {
    const unique = new Set(selectedModeIds.map((id) => String(id)));
    if (unique.size !== selectedModeIds.length) return false;
  }

  return sumSelectedPCost(selectedModeIds, modes) <= pBudget;
}

/**
 * Greedy AI fill: pick highest-scoring affordable modes (with optional repeats)
 * until the budget is exhausted or no mode fits.
 */
export function choosePBudgetModeSelections(
  modes: readonly (PBudgetModeOption & { score?: number })[],
  pBudget: number,
  options?: {
    readonly minModes?: number;
    readonly canRepeatModes?: boolean;
  },
): string[] {
  if (!(Number.isFinite(pBudget) && pBudget > 0) || modes.length === 0) return [];
  const canRepeatModes = Boolean(options?.canRepeatModes);
  const minModes = Math.max(0, Number(options?.minModes ?? 0) || 0);
  const ranked = [...modes]
    .map((mode) => ({
      id: String(mode.id || '').trim(),
      pCost: modePCost(mode),
      score: Number(mode.score) || 0,
    }))
    .filter((mode) => Boolean(mode.id))
    .sort((a, b) => b.score - a.score || a.pCost - b.pCost);

  const selected: string[] = [];
  let spent = 0;

  const tryAdd = (mode: { id: string; pCost: number }): boolean => {
    if (spent + mode.pCost > pBudget) return false;
    if (!canRepeatModes && selected.includes(mode.id)) return false;
    selected.push(mode.id);
    spent += mode.pCost;
    return true;
  };

  // Prefer highest score while budget remains.
  let progress = true;
  while (progress && spent < pBudget) {
    progress = false;
    for (const mode of ranked) {
      if (tryAdd(mode)) {
        progress = true;
        if (!canRepeatModes) break;
        // With repeats, keep taking the best affordable mode until budget fills.
        break;
      }
    }
  }

  // Ensure minModes if still affordable (fill cheapest remaining).
  if (selected.length < minModes) {
    const cheapest = [...ranked].sort((a, b) => a.pCost - b.pCost);
    for (const mode of cheapest) {
      if (selected.length >= minModes) break;
      tryAdd(mode);
    }
  }

  return selected;
}
