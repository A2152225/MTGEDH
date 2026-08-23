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
  /** Bast / Condemn-style combat role on the target noun phrase. */
  targetCombatRole?: 'attacking' | 'blocking' | 'attacking_or_blocking';
};

export function isPermanentCurrentlyAttacking(permanent: any): boolean {
  if (!permanent) return false;
  if (permanent.isAttacking === true) return true;
  const attacking = permanent.attacking;
  if (typeof attacking === 'string' && attacking.trim().length > 0) return true;
  if (attacking === true) return true;
  return false;
}

export function isPermanentCurrentlyBlocking(permanent: any): boolean {
  if (!permanent) return false;
  if (permanent.isBlocking === true) return true;
  const blocking = permanent.blocking;
  if (Array.isArray(blocking) && blocking.length > 0) return true;
  if (typeof blocking === 'string' && blocking.trim().length > 0) return true;
  return false;
}

export function matchesTriggeredCombatRole(
  permanent: any,
  role: 'attacking' | 'blocking' | 'attacking_or_blocking' | undefined,
): boolean {
  if (!role) return true;
  const attacking = isPermanentCurrentlyAttacking(permanent);
  const blocking = isPermanentCurrentlyBlocking(permanent);
  if (role === 'attacking_or_blocking') return attacking || blocking;
  if (role === 'blocking') return blocking;
  return attacking;
}

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
  permanent?: {
    colors?: readonly string[];
    colorAdditions?: readonly string[];
    card?: any;
    id?: string;
    attacking?: unknown;
    isAttacking?: boolean;
    blocking?: unknown;
    isBlocking?: boolean;
  } | null,
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

  if (metadata?.targetCombatRole && !matchesTriggeredCombatRole(permanent, metadata.targetCombatRole)) {
    return false;
  }

  return true;
}
