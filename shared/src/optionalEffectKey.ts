import {
  isMayAutoPreferenceStoredValue,
  type MayAutoPreferenceStored,
} from './mayAutoPreference.js';

/**
 * Normalized keys for per-effect "you may" auto-preferences.
 * Strips trailing punctuation so "gain 1 life" and "gain 1 life." match.
 */
export function normalizeOptionalEffectKeyPart(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '');
}

export function buildOptionalEffectKey(sourceName: string, effectText: string): string {
  return `${normalizeOptionalEffectKeyPart(sourceName)}:${normalizeOptionalEffectKeyPart(effectText)}`;
}

export function findMayAutoPreferenceEntry(
  prefs: Record<string, MayAutoPreferenceStored | undefined> | undefined,
  effectKey: string,
): { key: string; value: MayAutoPreferenceStored } | undefined {
  if (!prefs) return undefined;

  const direct = prefs[effectKey];
  if (isMayAutoPreferenceStoredValue(direct)) {
    return { key: effectKey, value: direct };
  }

  const normalizedTarget = normalizeOptionalEffectKeyPart(effectKey);
  for (const [key, value] of Object.entries(prefs)) {
    if (!isMayAutoPreferenceStoredValue(value)) {
      continue;
    }
    if (normalizeOptionalEffectKeyPart(key) === normalizedTarget) {
      return { key, value };
    }
  }

  return undefined;
}
