/**
 * classLevelGating.ts - keeps Class permanents' active oracle text in sync with their
 * level (see shared/src/classLevelText.ts). Called from the derived continuous-effects
 * sync (every SBA pass), ETB processing, and after a level-up resolves.
 * Public entry symbols: syncClassLevelGating.
 */
import {
  applyClassLevelGatingToPermanent,
  restoreClassFullOracleText,
} from '../../../../shared/src/classLevelText.js';

export function syncClassLevelGating(state: any): boolean {
  if (!state || typeof state !== 'object') return false;
  let changed = false;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    try {
      if (applyClassLevelGatingToPermanent(perm)) changed = true;
    } catch {
      // gating must never break SBA
    }
  }
  const zones = state.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const playerZones of Object.values(zones) as any[]) {
    for (const key of ['hand', 'graveyard', 'exile']) {
      const list = playerZones?.[key];
      if (!Array.isArray(list)) continue;
      for (const card of list) if (restoreClassFullOracleText(card)) changed = true;
    }
  }
  return changed;
}
