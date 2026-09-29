// rules-engine/src/oracleIRExecutorEffectTimestamps.ts
// Continuous-effect ordering for Oracle IR "becomes an X/Y" / "has base power and toughness X/Y"
// setters (modifier type `setPowerToughness`, layer 7b). CR 613.7: when several effects set the same
// characteristic, the one with the latest timestamp wins.
//
// Setters get two ordering fields when they are created:
//  - `timestamp`: strictly increasing across all setter modifiers on the battlefield, so two
//    Oracle IR setters resolve last-timestamp-wins regardless of array order.
//  - `battlefieldPosition` / `battlefieldAnchorId`: where the setter falls relative to permanents
//    that were already on the battlefield (their battlefield index is the timestamp proxy used for
//    Aura and static set-base effects), so an Aura that enters later still overrides an older
//    setter and an older Aura does not override a newer setter.
// Public entry symbols: nextEffectTimestamp, describeSetterOrdering.

import type { GameState } from '../../shared/src';

export interface SetterOrdering {
  readonly timestamp: number;
  readonly battlefieldPosition: number;
  readonly battlefieldAnchorId?: string;
}

/** One more than the highest timestamp on any modifier currently on the battlefield. */
export function nextEffectTimestamp(state: GameState): number {
  let max = 0;
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const permanent of battlefield) {
    const modifiers = Array.isArray(permanent?.modifiers) ? permanent.modifiers : [];
    for (const modifier of modifiers) {
      const value = Number(modifier?.timestamp);
      if (Number.isFinite(value) && value > max) max = value;
    }
  }
  return max + 1;
}

export function describeSetterOrdering(state: GameState): SetterOrdering {
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const last = battlefield.length > 0 ? battlefield[battlefield.length - 1] : undefined;
  const anchorId = String(last?.id || '').trim();
  return {
    timestamp: nextEffectTimestamp(state),
    battlefieldPosition: battlefield.length,
    ...(anchorId ? { battlefieldAnchorId: anchorId } : {}),
  };
}
