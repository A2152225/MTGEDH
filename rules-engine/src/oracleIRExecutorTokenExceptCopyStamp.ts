/**
 * Extracted from oracleIRExecutorTokenCopySource.ts.
 * Cluster: stamp except-copy addAbilities onto token grantedAbilities (haste + quoted triggers).
 * Public: stampCopiedTokenExceptGrantedAbilities.
 */

import type { CopyTokenOverrides } from '../../shared/src/copyTokenOverrides.js';

export function stampCopiedTokenExceptGrantedAbilities<T>(
  token: T,
  overrides: CopyTokenOverrides | undefined,
): T {
  if (!token || typeof token !== 'object') return token;
  const addAbilities = Array.isArray(overrides?.addAbilities) ? overrides.addAbilities : [];
  if (addAbilities.length === 0) return token;

  const perm = token as T & { grantedAbilities?: string[]; summoningSickness?: boolean };
  const nextGranted = Array.isArray(perm.grantedAbilities) ? [...perm.grantedAbilities] : [];
  for (const ability of addAbilities) {
    const text = String(ability || '').trim();
    if (!text) continue;
    if (nextGranted.some((entry) => String(entry || '').trim().toLowerCase() === text.toLowerCase())) {
      continue;
    }
    nextGranted.push(text);
  }
  perm.grantedAbilities = nextGranted;
  if (nextGranted.some((entry) => String(entry || '').trim().toLowerCase() === 'haste')) {
    perm.summoningSickness = false;
  }
  return token;
}
