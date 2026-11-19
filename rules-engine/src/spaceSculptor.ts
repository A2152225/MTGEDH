/**
 * Space sculptor (CR 702.158). One keyword splits creatures into alpha, beta,
 * and gamma sectors. A designation sticks until no space sculptor remains.
 * Public: SPACE_SCULPTOR_SECTORS, oracleHasSpaceSculptor, isSpaceSculptorSector,
 *   sectorsAreDifferent.
 */

export const SPACE_SCULPTOR_SECTORS = ['alpha', 'beta', 'gamma'] as const;

export type SpaceSculptorSector = (typeof SPACE_SCULPTOR_SECTORS)[number];

export function oracleHasSpaceSculptor(oracleText: string): boolean {
  return /(?:^|\n)\s*space sculptor\b/i.test(String(oracleText || ''));
}

export function isSpaceSculptorSector(value: unknown): value is SpaceSculptorSector {
  return SPACE_SCULPTOR_SECTORS.includes(String(value || '').trim().toLowerCase() as SpaceSculptorSector);
}

/** Under the same-sector combat rule, a missing designation is not a shared sector. */
export function sectorsAreDifferent(attackerSector: unknown, blockerSector: unknown): boolean {
  const attacker = String(attackerSector || '').trim().toLowerCase();
  const blocker = String(blockerSector || '').trim().toLowerCase();
  return !attacker || !blocker || attacker !== blocker;
}
