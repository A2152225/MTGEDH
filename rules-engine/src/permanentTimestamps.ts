// rules-engine/src/permanentTimestamps.ts
// Real continuous-effect timestamps (CR 613.7) for permanents.
//   - `timestamp`: assigned when a permanent enters the battlefield (also the timestamp of its static abilities).
//   - `attachedTimestamp` (+ `attachedTimestampFor`): assigned when an Aura / Equipment becomes attached to a
//     particular object (CR 613.7e: an Aura's effect uses the timestamp of when it became attached).
//   - Oracle IR "becomes an X/Y" setters draw their `timestamp` from the same counter (globalTimestamp: true).
// One monotonically increasing counter per game (`state.timestampCounter`). Values start above
// TIMESTAMP_BASE so stamped permanents always sort after un-stamped legacy ones, which keep using their
// battlefield index as the timestamp proxy (backwards compatible with saved states and unsynced tests).
//
// The stamping helpers are idempotent: an already stamped permanent keeps its timestamp. The server stamps on
// entry/attach in the main paths and lazily for everything else when the derived continuous effects are synced.
// Public entry symbols: TIMESTAMP_BASE, highestAssignedTimestamp, allocateTimestamp, stampPermanentEntryTimestamp,
//   stampAttachmentTimestamp, stampMissingPermanentTimestamps, stampMissingTimestampsOnBattlefieldCopy,
//   readPermanentTimestamp, readAttachmentTimestamp.

/** Floor for real (allocated) timestamps; any value above it is a genuine CR 613.7 timestamp. */
export const REAL_TIMESTAMP_FLOOR = 1000;
/** True when `value` is a real allocated timestamp rather than an unstamped/legacy index proxy. */
export function isRealTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > REAL_TIMESTAMP_FLOOR;
}
/** @deprecated Use REAL_TIMESTAMP_FLOOR / isRealTimestamp. Kept as an alias for existing callers. */
export const TIMESTAMP_BASE = REAL_TIMESTAMP_FLOOR;

function finite(value: unknown): number | undefined {
  const n = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isFinite(n) ? n : undefined;
}

/** Highest timestamp handed out so far (counter, permanent stamps, attach stamps, global setters). */
export function highestAssignedTimestamp(state: any): number {
  let max = Math.max(TIMESTAMP_BASE, finite(state?.timestampCounter) ?? 0);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm) continue;
    max = Math.max(max, finite(perm.timestamp) ?? 0, finite(perm.attachedTimestamp) ?? 0);
    const modifiers = Array.isArray(perm.modifiers) ? perm.modifiers : [];
    for (const modifier of modifiers) {
      if (modifier?.globalTimestamp === true) max = Math.max(max, finite(modifier.timestamp) ?? 0);
    }
  }
  return max;
}

/**
 * Next timestamp (mutates `state.timestampCounter`). Counter-only: the battlefield is scanned just once, to seed a
 * state that has no counter yet (fresh/hand-built states); afterwards every stamp comes from the counter.
 */
export function allocateTimestamp(state: any): number {
  const counter = finite(state?.timestampCounter);
  const next = (counter !== undefined && counter >= TIMESTAMP_BASE ? counter : highestAssignedTimestamp(state)) + 1;
  if (state && typeof state === 'object') state.timestampCounter = next;
  return next;
}

export function readPermanentTimestamp(perm: any): number | undefined {
  const value = finite(perm?.timestamp);
  return value !== undefined && value > TIMESTAMP_BASE ? value : undefined;
}

/** Timestamp of the attachment to its current host, when it has been stamped for that host. */
export function readAttachmentTimestamp(aura: any): number | undefined {
  if (!aura?.attachedTo) return undefined;
  if (String(aura.attachedTimestampFor || '') !== String(aura.attachedTo)) return undefined;
  const value = finite(aura.attachedTimestamp);
  return value !== undefined && value > TIMESTAMP_BASE ? value : undefined;
}

/** A permanent entering the battlefield gets the next timestamp (no-op when already stamped). */
export function stampPermanentEntryTimestamp(state: any, perm: any): void {
  if (!perm || typeof perm !== 'object' || readPermanentTimestamp(perm) !== undefined) return;
  perm.timestamp = allocateTimestamp(state);
}

/** An Aura / Equipment that just became attached gets a new attachment timestamp for that host. */
export function stampAttachmentTimestamp(state: any, attachment: any): void {
  if (!attachment || typeof attachment !== 'object') return;
  if (!attachment.attachedTo) {
    delete attachment.attachedTimestamp;
    delete attachment.attachedTimestampFor;
    return;
  }
  if (readAttachmentTimestamp(attachment) !== undefined) return;
  attachment.attachedTimestamp = allocateTimestamp(state);
  attachment.attachedTimestampFor = String(attachment.attachedTo);
}

/**
 * Lazily stamp everything on the battlefield that has no timestamp yet (battlefield order = entry order) and
 * refresh attachment stamps whose host changed. Returns how many stamps were assigned.
 */
export function stampMissingPermanentTimestamps(state: any): number {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let stamped = 0;
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    if (readPermanentTimestamp(perm) === undefined) {
      perm.timestamp = allocateTimestamp(state);
      stamped += 1;
    }
    if (perm.attachedTo) {
      if (readAttachmentTimestamp(perm) === undefined) {
        perm.attachedTimestamp = allocateTimestamp(state);
        perm.attachedTimestampFor = String(perm.attachedTo);
        stamped += 1;
      }
    } else if (perm.attachedTimestamp !== undefined || perm.attachedTimestampFor !== undefined) {
      delete perm.attachedTimestamp;
      delete perm.attachedTimestampFor;
    }
  }
  return stamped;
}

/**
 * Non-mutating variant for the rules-engine executor (which returns new state objects): returns a copy of the
 * battlefield with missing stamps filled in plus the counter value to persist.
 */
export function stampMissingTimestampsOnBattlefieldCopy(state: any): { battlefield: any[]; timestampCounter: number } {
  const source = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const working: any = { timestampCounter: finite(state?.timestampCounter), battlefield: source.map((perm: any) => (perm && typeof perm === 'object' ? { ...perm } : perm)) };
  stampMissingPermanentTimestamps(working);
  const battlefield = working.battlefield.map((copy: any, index: number) => {
    const original = source[index];
    if (!copy || !original) return original;
    const changed = copy.timestamp !== original.timestamp
      || copy.attachedTimestamp !== original.attachedTimestamp
      || copy.attachedTimestampFor !== original.attachedTimestampFor;
    return changed ? copy : original;
  });
  return { battlefield, timestampCounter: highestAssignedTimestamp(working) };
}