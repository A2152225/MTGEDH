/**
 * Origin parent: server/src/state/modules/triggers/delayed-end-step-watchers.ts
 * Cluster: bound-object ids and delayed destroy/exile/sacrifice stack fields
 *   shared by end-step and end-of-combat delayed-registry collectors.
 * Public: readDelayedAntecedentIds, delayedCleanupStackFieldsFromRegistry
 */

export type DelayedZoneCleanupAction = 'destroy' | 'exile' | 'sacrifice';

export function readDelayedAntecedentIds(delayed: {
  targets?: readonly string[];
  effectData?: Record<string, unknown>;
  eventDataSnapshot?: { targetPermanentId?: string; chosenObjectIds?: readonly string[] };
}): string[] {
  const fromEffect = Array.isArray(delayed.effectData?.lastAntecedentBattlefieldPermanentIds)
    ? delayed.effectData.lastAntecedentBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const fromTargets = Array.isArray(delayed.targets)
    ? delayed.targets.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const fromChosen = Array.isArray(delayed.eventDataSnapshot?.chosenObjectIds)
    ? delayed.eventDataSnapshot.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const snapshotTarget = String(delayed.eventDataSnapshot?.targetPermanentId || '').trim();
  return Array.from(new Set([
    ...fromEffect,
    ...fromTargets,
    ...fromChosen,
    ...(snapshotTarget ? [snapshotTarget] : []),
  ]));
}

function inferDelayedZoneAction(effect: string): DelayedZoneCleanupAction | undefined {
  const lower = effect.trim().toLowerCase();
  if (/^destroy\b/.test(lower)) return 'destroy';
  if (/^exile\b/.test(lower)) return 'exile';
  if (
    /^sacrifice\b/.test(lower)
    || /^(?:you|they|that player|that opponent|each player|each opponent)\s+sacrifices?\b/.test(lower)
  ) {
    return 'sacrifice';
  }
  return undefined;
}

export function delayedCleanupStackFieldsFromRegistry(delayed: {
  sourceName?: string;
  effect?: string;
  targets?: readonly string[];
  effectData?: Record<string, unknown>;
  eventDataSnapshot?: { targetPermanentId?: string; chosenObjectIds?: readonly string[] };
}): {
  lastAntecedentBattlefieldPermanentIds: string[];
  delayedAction?: DelayedZoneCleanupAction;
  delayedPermanentIds?: string[];
  delayedSourceName?: string;
} {
  const lastAntecedentBattlefieldPermanentIds = readDelayedAntecedentIds(delayed);
  const stamped = String(delayed.effectData?.delayedAction || '').trim().toLowerCase();
  const delayedAction: DelayedZoneCleanupAction | undefined =
    stamped === 'destroy' || stamped === 'exile' || stamped === 'sacrifice'
      ? stamped
      : inferDelayedZoneAction(String(delayed.effect || ''));
  if (!delayedAction || lastAntecedentBattlefieldPermanentIds.length === 0) {
    return { lastAntecedentBattlefieldPermanentIds };
  }
  return {
    lastAntecedentBattlefieldPermanentIds,
    delayedAction,
    delayedPermanentIds: lastAntecedentBattlefieldPermanentIds,
    delayedSourceName: String(delayed.sourceName || 'Delayed trigger'),
  };
}
