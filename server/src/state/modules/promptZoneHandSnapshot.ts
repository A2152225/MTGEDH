/**
 * Zone-hand snapshots for resolveTopOfStackPrompt persistence/replay.
 *
 * Discard (and similar) steps store UI ChoiceOptions in `hand` ({ id, label, imageUrl }).
 * Those must never replace authoritative zone cards. Persist full cards separately in
 * `zoneHandSnapshot` and restore from that on restart/undo replay.
 */

export function isFullHandCardSnapshot(card: unknown): boolean {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  const c = card as Record<string, unknown>;
  if (typeof c.name === 'string' && c.name.trim()) return true;
  if (typeof c.type_line === 'string' && c.type_line.trim()) return true;
  if (typeof c.oracle_text === 'string') return true;
  if (c.image_uris && typeof c.image_uris === 'object') return true;
  return false;
}

export function canRestoreHandFromPromptSnapshot(handSnapshot: unknown): handSnapshot is any[] {
  if (!Array.isArray(handSnapshot) || handSnapshot.length === 0) return false;
  return handSnapshot.every(isFullHandCardSnapshot);
}

export function snapshotPlayerZoneHand(state: any, playerId: string): any[] {
  const pid = String(playerId || '').trim();
  if (!pid || !state) return [];
  const hand = state?.zones?.[pid]?.hand;
  if (!Array.isArray(hand) || hand.length === 0) return [];
  return hand
    .filter((card: any) => card && typeof card === 'object')
    .map((card: any) => ({ ...card, zone: 'hand' }));
}

/**
 * Attach a full-card zone snapshot onto a resolution step before event persistence.
 * Keeps `hand` (ChoiceOptions / UI) unchanged.
 */
export function attachZoneHandSnapshotToStep(
  state: any,
  step: any,
  playerId?: string,
): any {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
  if (Array.isArray(step.zoneHandSnapshot) && step.zoneHandSnapshot.length > 0) {
    return step;
  }
  // Only steps that carry a hand choice list need a zone restore snapshot.
  if (!Array.isArray(step.hand)) return step;

  const pid = String(playerId || step.playerId || '').trim();
  if (!pid) return step;

  const zoneHandSnapshot = snapshotPlayerZoneHand(state, pid);
  if (zoneHandSnapshot.length === 0) return step;

  return {
    ...step,
    zoneHandSnapshot,
  };
}

/**
 * Prefer zoneHandSnapshot; fall back to legacy full-card `hand` arrays.
 * Never returns ChoiceOption-only lists.
 */
export function resolvePromptZoneHandRestore(queuedStep: any): any[] | null {
  if (!queuedStep || typeof queuedStep !== 'object') return null;
  if (canRestoreHandFromPromptSnapshot(queuedStep.zoneHandSnapshot)) {
    return queuedStep.zoneHandSnapshot;
  }
  if (canRestoreHandFromPromptSnapshot(queuedStep.hand)) {
    return queuedStep.hand;
  }
  return null;
}
