// server/src/state/modules/staticEffectSpecAuraControl.ts
// Origin parent: staticEffectSpec.ts (syncDerivedContinuousEffects).
// Layer 2 control-changing Auras (CR 613.1b): Control Magic / Mind Control / Treachery style
// "You control enchanted creature." Control is derived by continuousEffectRegistry.ts from every
// timestamped control effect (Auras use their attachment timestamp, Threaten-style steals their own),
// so an Aura leaving no longer writes a stale controller back over a later steal.
// Also syncs the layer-6 ability grant/loss timestamps and the trigger-suppression LKI stamp.
// Public entry symbols: syncAuraControlChanges, oracleGrantsAuraControl.

import { syncAbilityEffectTimestamps } from '../../../../rules-engine/src/abilityEffectTimestamps.js';
import { oracleGrantsAuraControl, syncControlFromRegistry } from './continuousEffectRegistry.js';
import { syncTriggeredAbilityLossStamps } from './triggers/triggeredAbilitySuppression.js';

export { oracleGrantsAuraControl };

/** Re-derives controllers (control Auras + registry). Returns true when any controller changed. */
export function syncAuraControlChanges(state: unknown): boolean {
  try { syncAbilityEffectTimestamps(state); } catch { /* best-effort: layer-6 grant/loss stamps */ }
  const changed = syncControlFromRegistry(state).length > 0;
  try { syncTriggeredAbilityLossStamps(state); } catch { /* best-effort: layer-6 LKI stamp for triggers */ }
  return changed;
}
