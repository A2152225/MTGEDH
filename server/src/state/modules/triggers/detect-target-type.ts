/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: effect-text target type helper used by leftover detectors
 * Public: detectTargetType
 */

/**
 * Helper to detect target type from effect text
 */
export function detectTargetType(effectText: string): string | undefined {
  const lower = effectText.toLowerCase();
  
  if (lower.includes('target creature')) return 'creature';
  if (lower.includes('target player')) return 'player';
  if (lower.includes('target permanent')) return 'permanent';
  if (lower.includes('target spell')) return 'spell';
  if (lower.includes('target artifact')) return 'artifact';
  if (lower.includes('target enchantment')) return 'enchantment';
  if (lower.includes('target land')) return 'land';
  if (lower.includes('any target')) return 'any';
  
  return undefined;
}
