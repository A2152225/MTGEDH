// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveRecentlyMovedBattlefieldPermanents.
// Public entry: resolveRecentlyMovedBattlefieldPermanents.

import type { BattlefieldPermanent } from '../../shared/src';
import type { RecentBattlefieldRuntime } from './oracleIRExecutorBattlefieldStepTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';

export function resolveRecentlyMovedBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  runtime?: RecentBattlefieldRuntime
): BattlefieldPermanent[] {
  if (!target || target.kind !== 'raw') return [];
  const recentIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
    ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (recentIds.length === 0) return [];

  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return [];

  const singular = /^(?:it|that card|that creature|that permanent|that token)$/i.test(normalized);
  const plural =
    /^(?:them|those creatures|those permanents|those auras)$/i.test(normalized);
  if (!singular && !plural) return [];

  const requiredType =
    /those auras/i.test(normalized) ? 'enchantment' :
    normalized.includes('creature') ? 'creature' :
    normalized.includes('permanent') || normalized === 'it' || normalized === 'that card' || normalized === 'them'
      ? 'permanent'
      : undefined;

  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!recentIds.includes(permanentId)) return false;
    if (requiredType && !permanentMatchesType(perm, requiredType as any)) return false;
    if (/those auras/i.test(normalized) && !/\baura\b/i.test(getExecutorTypeLineLower(perm))) return false;
    return true;
  });

  return singular ? matches.slice(0, 1) : matches;
}

