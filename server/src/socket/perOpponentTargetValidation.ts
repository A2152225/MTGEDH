export type PerOpponentTargetOption = {
  readonly id: string;
  readonly controller?: string;
};

export function validatePerOpponentTargetSelections(args: {
  readonly selections: readonly string[];
  readonly validTargets: readonly PerOpponentTargetOption[];
  readonly targetsPerOpponent: Record<string, readonly PerOpponentTargetOption[]>;
  readonly minTargetsPerOpponent?: number;
  readonly maxTargetsPerOpponent?: number;
}): string | null {
  const uniqueSelections = Array.from(new Set(args.selections.map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueSelections.length !== args.selections.length) {
    return 'duplicate target id(s) selected';
  }

  const minPer = Math.max(0, Number(args.minTargetsPerOpponent ?? 0));
  const maxPer = Math.max(minPer, Number(args.maxTargetsPerOpponent ?? 1));
  const validTargetIds = new Set(
    args.validTargets.map((target) => String(target.id || '').trim()).filter(Boolean),
  );

  for (const id of uniqueSelections) {
    if (!validTargetIds.has(id)) {
      return `target not in valid targets list: ${id}`;
    }
  }

  const controllerByTargetId = new Map<string, string>();
  for (const target of args.validTargets) {
    const id = String(target.id || '').trim();
    const controller = String(target.controller || '').trim();
    if (id && controller) controllerByTargetId.set(id, controller);
  }

  const selectedByController = new Map<string, string[]>();
  for (const id of uniqueSelections) {
    const controller = controllerByTargetId.get(id);
    if (!controller) continue;
    const bucket = selectedByController.get(controller) || [];
    bucket.push(id);
    selectedByController.set(controller, bucket);
  }

  for (const [, selectedIds] of selectedByController) {
    if (selectedIds.length > maxPer) {
      return `too many targets selected for one opponent (max ${maxPer})`;
    }
  }

  for (const [opponentId, oppTargets] of Object.entries(args.targetsPerOpponent)) {
    const allowedIds = new Set(
      (oppTargets || []).map((target) => String(target.id || '').trim()).filter(Boolean),
    );
    if (allowedIds.size === 0) continue;

    const selectedForOpp = uniqueSelections.filter((id) => allowedIds.has(id));
    if (selectedForOpp.length > maxPer) {
      return `too many targets selected for opponent ${opponentId}`;
    }
    if (selectedForOpp.length < minPer) {
      return `not enough targets selected for opponent ${opponentId} (need ${minPer})`;
    }
  }

  return null;
}
