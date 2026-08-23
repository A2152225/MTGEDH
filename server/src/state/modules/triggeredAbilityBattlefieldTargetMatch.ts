import { getEffectiveColors } from './effectiveColors.js';

export const PERMANENT_TRIGGER_TARGET_TYPES = new Set([
  'creature',
  'permanent',
  'artifact',
  'enchantment',
  'land',
  'planeswalker',
  'battle',
  'creature or planeswalker',
  'artifact or enchantment',
  'aura or equipment',
  'artifact, enchantment, or land',
  'noncreature artifact',
  'nonland permanent',
  'noncreature permanent',
  'any target',
  'any_target',
]);

export type TriggeredBattlefieldTargetFilterMetadata = {
  targetFilterTypes?: string[];
  targetFilterRequiredTypeWords?: string[];
  targetFilterExcludeTypes?: string[];
  /** Ugin-style: permanent that is one or more colors (not colorless). */
  targetFilterRequiresOneOrMoreColors?: boolean;
};

function typeLineHasWord(typeLine: string, word: string): boolean {
  const needle = String(word || '').trim().toLowerCase();
  if (!needle) return false;
  return new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(typeLine);
}

/**
 * Generic battlefield type match for triggered-ability TARGET_SELECTION prompts.
 * Prefer oracle-driven compound phrases ("artifact, enchantment, or land") over card tables.
 */
export function matchesTriggeredBattlefieldTarget(
  targetType: string,
  typeLine: string,
  metadata?: TriggeredBattlefieldTargetFilterMetadata,
  permanent?: { colors?: readonly string[]; colorAdditions?: readonly string[]; card?: any; id?: string } | null,
  gameState?: unknown,
): boolean {
  const normalizedType = String(targetType || '').toLowerCase().trim();
  const normalizedTypeLine = String(typeLine || '').toLowerCase();
  let matchesBaseTargetType = false;

  switch (normalizedType) {
    case 'permanent':
      matchesBaseTargetType = true;
      break;
    case 'any':
    case 'any target':
    case 'any_target':
      matchesBaseTargetType =
        normalizedTypeLine.includes('creature')
        || normalizedTypeLine.includes('planeswalker')
        || normalizedTypeLine.includes('battle');
      break;
    case 'creature':
      matchesBaseTargetType = normalizedTypeLine.includes('creature');
      break;
    case 'artifact':
      matchesBaseTargetType = normalizedTypeLine.includes('artifact');
      break;
    case 'enchantment':
      matchesBaseTargetType = normalizedTypeLine.includes('enchantment');
      break;
    case 'land':
      matchesBaseTargetType = normalizedTypeLine.includes('land');
      break;
    case 'planeswalker':
      matchesBaseTargetType = normalizedTypeLine.includes('planeswalker');
      break;
    case 'battle':
      matchesBaseTargetType = normalizedTypeLine.includes('battle');
      break;
    case 'creature or planeswalker':
      matchesBaseTargetType =
        normalizedTypeLine.includes('creature') || normalizedTypeLine.includes('planeswalker');
      break;
    case 'artifact or enchantment':
      matchesBaseTargetType =
        normalizedTypeLine.includes('artifact') || normalizedTypeLine.includes('enchantment');
      break;
    case 'aura or equipment':
      matchesBaseTargetType =
        typeLineHasWord(normalizedTypeLine, 'aura') || typeLineHasWord(normalizedTypeLine, 'equipment');
      break;
    case 'artifact, enchantment, or land':
      matchesBaseTargetType =
        normalizedTypeLine.includes('artifact')
        || normalizedTypeLine.includes('enchantment')
        || normalizedTypeLine.includes('land');
      break;
    case 'noncreature artifact':
      matchesBaseTargetType =
        normalizedTypeLine.includes('artifact') && !normalizedTypeLine.includes('creature');
      break;
    case 'nonland permanent':
      matchesBaseTargetType = !normalizedTypeLine.includes('land');
      break;
    case 'noncreature permanent':
      matchesBaseTargetType = !normalizedTypeLine.includes('creature');
      break;
    default:
      matchesBaseTargetType = false;
      break;
  }

  if (!matchesBaseTargetType) {
    return false;
  }

  if (Array.isArray(metadata?.targetFilterTypes) && metadata.targetFilterTypes.length > 0) {
    const matchesIncludedType = metadata.targetFilterTypes.some((type) =>
      normalizedTypeLine.includes(String(type || '').toLowerCase()),
    );
    if (!matchesIncludedType) {
      return false;
    }
  }

  if (Array.isArray(metadata?.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0) {
    const matchesRequiredWords = metadata.targetFilterRequiredTypeWords.every((word) =>
      typeLineHasWord(normalizedTypeLine, String(word || '')),
    );
    if (!matchesRequiredWords) {
      return false;
    }
  }

  if (Array.isArray(metadata?.targetFilterExcludeTypes) && metadata.targetFilterExcludeTypes.length > 0) {
    const matchesExcludedType = metadata.targetFilterExcludeTypes.some((type) =>
      normalizedTypeLine.includes(String(type || '').toLowerCase()),
    );
    if (matchesExcludedType) {
      return false;
    }
  }

  if (metadata?.targetFilterRequiresOneOrMoreColors === true) {
    const colors = getEffectiveColors(permanent || { card: { type_line: typeLine } }, gameState);
    if (!Array.isArray(colors) || colors.length === 0) {
      return false;
    }
  }

  return true;
}
