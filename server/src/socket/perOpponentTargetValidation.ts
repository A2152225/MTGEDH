export type PerOpponentTargetOption = {
  readonly id: string;
  readonly controller?: string;
};

export type GroupedTargetSelectionGroup = {
  readonly playerId: string;
  readonly targets: readonly PerOpponentTargetOption[];
  readonly minTargets?: number;
  readonly maxTargets?: number;
  readonly required?: boolean;
};

export function validateGroupedTargetSelections(args: {
  readonly selections: readonly string[];
  readonly validTargets: readonly PerOpponentTargetOption[];
  readonly groups: readonly GroupedTargetSelectionGroup[];
  readonly minTargetsPerGroup?: number;
  readonly maxTargetsPerGroup?: number;
}): string | null {
  const uniqueSelections = Array.from(new Set(args.selections.map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueSelections.length !== args.selections.length) {
    return 'duplicate target id(s) selected';
  }

  const validTargetIds = new Set(
    args.validTargets.map((target) => String(target.id || '').trim()).filter(Boolean),
  );
  for (const id of uniqueSelections) {
    if (!validTargetIds.has(id)) {
      return `target not in valid targets list: ${id}`;
    }
  }

  const groupByTargetId = new Map<string, string>();
  for (const group of args.groups) {
    for (const target of group.targets || []) {
      const id = String(target.id || '').trim();
      if (!id) continue;
      const existingGroup = groupByTargetId.get(id);
      if (existingGroup && existingGroup !== String(group.playerId)) {
        return `target appears in multiple controller groups: ${id}`;
      }
      groupByTargetId.set(id, String(group.playerId));
      if (target.controller && String(target.controller) !== String(group.playerId)) {
        return `target controller does not match group ${group.playerId}: ${id}`;
      }
    }
  }

  for (const id of uniqueSelections) {
    if (!groupByTargetId.has(id)) {
      return `target is not a member of a required controller group: ${id}`;
    }
  }

  for (const group of args.groups) {
    const allowedIds = new Set(
      (group.targets || []).map((target) => String(target.id || '').trim()).filter(Boolean),
    );
    const selectedCount = uniqueSelections.filter((id) => allowedIds.has(id)).length;
    const minPer = Math.max(
      0,
      Number(group.minTargets ?? args.minTargetsPerGroup ?? (group.required ? 1 : 0)),
    );
    const maxPer = Math.max(
      minPer,
      Number(group.maxTargets ?? args.maxTargetsPerGroup ?? 1),
    );
    if (selectedCount > maxPer) {
      return `too many targets selected for player ${group.playerId} (max ${maxPer})`;
    }
    if (selectedCount < minPer) {
      return `not enough targets selected for player ${group.playerId} (need ${minPer})`;
    }
  }

  return null;
}

export function validatePerOpponentTargetSelections(args: {
  readonly selections: readonly string[];
  readonly validTargets: readonly PerOpponentTargetOption[];
  readonly targetsPerOpponent: Record<string, readonly PerOpponentTargetOption[]>;
  readonly minTargetsPerOpponent?: number;
  readonly maxTargetsPerOpponent?: number;
}): string | null {
  return validateGroupedTargetSelections({
    selections: args.selections,
    validTargets: args.validTargets,
    groups: Object.entries(args.targetsPerOpponent).map(([playerId, targets]) => ({
      playerId,
      targets,
      minTargets: args.minTargetsPerOpponent,
      maxTargets: args.maxTargetsPerOpponent,
      required: Number(args.minTargetsPerOpponent ?? 0) > 0,
    })),
    minTargetsPerGroup: args.minTargetsPerOpponent,
    maxTargetsPerGroup: args.maxTargetsPerOpponent,
  });
}
