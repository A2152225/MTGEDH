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
  prefs: Record<string, 'yes' | 'no' | number | undefined> | undefined,
  effectKey: string,
): { key: string; value: 'yes' | 'no' | number } | undefined {
  if (!prefs) return undefined;

  const direct = prefs[effectKey];
  if (direct === 'yes' || direct === 'no' || (typeof direct === 'number' && direct > 0)) {
    return { key: effectKey, value: direct };
  }

  const normalizedTarget = normalizeOptionalEffectKeyPart(effectKey);
  for (const [key, value] of Object.entries(prefs)) {
    if (value !== 'yes' && value !== 'no' && !(typeof value === 'number' && value > 0)) {
      continue;
    }
    if (normalizeOptionalEffectKeyPart(key) === normalizedTarget) {
      return { key, value };
    }
  }

  return undefined;
}
