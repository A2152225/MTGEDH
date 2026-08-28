/**
 * Origin: combat.ts / damage-received.ts / dealt-damage-watchers.ts
 * Cluster: "any target that isn't a [type]" damage-redirect targeting
 * Public: parseAnyTargetThatIsntCreatureType, excludedCreatureTypeFromDamageTargetType
 */
import { normalizeCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';

export type AnyNonCreatureTypeTarget = `any_non_${string}`;

export function parseAnyTargetThatIsntCreatureType(
  oracleLower: string,
): { targetType: AnyNonCreatureTypeTarget; targetRestriction: string } | null {
  const match = String(oracleLower || '').match(/any target that isn't an? ([a-z]+)/i);
  const typeName = match ? normalizeCreatureTypeWord(String(match[1] || '')) : null;
  if (!typeName) return null;
  const pretty = `${typeName.charAt(0).toUpperCase()}${typeName.slice(1)}`;
  return {
    targetType: `any_non_${typeName}`,
    targetRestriction: `that isn't a ${pretty}`,
  };
}

export function excludedCreatureTypeFromDamageTargetType(targetType: string): string | null {
  const match = String(targetType || '').match(/^any_non_(.+)$/);
  return match ? String(match[1] || '').trim().toLowerCase() || null : null;
}
