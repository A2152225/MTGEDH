/**
 * Per-effect "you may" auto-preferences, including conditional skip-until-targets-change.
 */

export type MayAutoPreferenceScalar = 'yes' | 'no' | number;
/** Stored form after server expands a no-until-targets-change request. */
export type MayAutoPreferenceStored =
  | MayAutoPreferenceScalar
  | `no_until_targets:${string}`;

/** Client/server request token — server expands to a fingerprint snapshot. */
export const NO_UNTIL_TARGETS_CHANGE_REQUEST = 'no_until_targets_change' as const;
export const NO_UNTIL_TARGETS_CHANGE_PREFIX = 'no_until_targets:' as const;

export function supportsNoUntilTargetsChangePreference(effectText: string): boolean {
  const text = String(effectText || '').toLowerCase();
  return /destroy target artifact or enchantment/.test(text)
    || (/destroy target/.test(text) && /artifact/.test(text) && /enchantment/.test(text));
}

/**
 * Fingerprint of currently legal Aura Shards–style destroy targets.
 * Sorted permanent ids so adds/removes/swaps all count as a change.
 */
export function fingerprintArtifactEnchantmentTargets(
  battlefield: readonly any[] | undefined | null,
): string {
  const ids = (Array.isArray(battlefield) ? battlefield : [])
    .filter((permanent) => {
      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return typeLine.includes('artifact') || typeLine.includes('enchantment');
    })
    .map((permanent) => String(permanent?.id || '').trim())
    .filter(Boolean)
    .sort();
  return ids.length > 0 ? ids.join(',') : 'none';
}

export function buildNoUntilTargetsChangeValue(fingerprint: string): MayAutoPreferenceStored {
  return `${NO_UNTIL_TARGETS_CHANGE_PREFIX}${String(fingerprint || 'none')}` as MayAutoPreferenceStored;
}

export function parseNoUntilTargetsChangeFingerprint(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(NO_UNTIL_TARGETS_CHANGE_PREFIX)) {
    return undefined;
  }
  return value.slice(NO_UNTIL_TARGETS_CHANGE_PREFIX.length);
}

export function isMayAutoPreferenceStoredValue(value: unknown): value is MayAutoPreferenceStored {
  if (value === 'yes' || value === 'no') return true;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return true;
  return parseNoUntilTargetsChangeFingerprint(value) !== undefined;
}

/**
 * If a no-until-targets preference still matches the battlefield, return 'no'.
 * If targets changed, clear the stale preference and return undefined (ask again).
 */
export function resolveNoUntilTargetsChangePreference(
  state: any,
  playerId: string,
  storageKey: string,
  autoPref: unknown,
  effectText: string,
): 'no' | undefined {
  const fingerprint = parseNoUntilTargetsChangeFingerprint(autoPref);
  if (fingerprint === undefined) return undefined;

  const prefs = state?.mayAutoPreferences?.[playerId];
  const clearPref = () => {
    if (prefs && storageKey) {
      delete prefs[storageKey];
    }
  };

  if (!supportsNoUntilTargetsChangePreference(effectText)) {
    clearPref();
    return undefined;
  }

  const current = fingerprintArtifactEnchantmentTargets(state?.battlefield);
  if (current === fingerprint) {
    return 'no';
  }

  clearPref();
  return undefined;
}

/** Peek whether a no-until pref still matches — does not clear stale prefs. */
export function matchesNoUntilTargetsChangePreference(
  state: any,
  autoPref: unknown,
  effectText: string,
): boolean {
  const fingerprint = parseNoUntilTargetsChangeFingerprint(autoPref);
  if (fingerprint === undefined) return false;
  if (!supportsNoUntilTargetsChangePreference(effectText)) return false;
  return fingerprintArtifactEnchantmentTargets(state?.battlefield) === fingerprint;
}

export function formatMayAutoPreferenceLabel(value: unknown): string {
  if (value === 'yes') return 'Always Yes';
  if (value === 'no') return 'Always No';
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return `Yes ×${value} remaining`;
  }
  if (parseNoUntilTargetsChangeFingerprint(value) !== undefined) {
    return 'No until targets change';
  }
  return String(value ?? 'Unknown');
}

/** Split `source:effect` keys for display. */
export function splitMayAutoPreferenceEffectKey(effectKey: string): {
  sourceName: string;
  effectText: string;
} {
  const raw = String(effectKey || '').trim();
  const idx = raw.indexOf(':');
  if (idx < 0) {
    return { sourceName: raw || 'Ability', effectText: '' };
  }
  return {
    sourceName: raw.slice(0, idx).trim() || 'Ability',
    effectText: raw.slice(idx + 1).trim(),
  };
}
