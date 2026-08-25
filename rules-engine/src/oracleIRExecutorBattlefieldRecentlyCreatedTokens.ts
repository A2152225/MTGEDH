// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveRecentlyCreatedTokenPermanents.
// Public entry: resolveRecentlyCreatedTokenPermanents.

import type { BattlefieldPermanent } from '../../shared/src';
import type { RecentBattlefieldRuntime } from './oracleIRExecutorBattlefieldStepTypes';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';

export function resolveRecentlyCreatedTokenPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  runtime?: RecentBattlefieldRuntime
): BattlefieldPermanent[] {
  if (!target || target.kind !== 'raw') return [];
  const recentIds = Array.isArray(runtime?.lastCreatedTokenIds)
    ? runtime.lastCreatedTokenIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (recentIds.length === 0) return [];

  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return [];

  const singular = /^(?:it|that token|the token|that creature|the creature)$/i.test(normalized);
  const plural = /^(?:them|those tokens|those creatures)$/i.test(normalized);
  if (!singular && !plural) return [];

  const requireCreature = /creature/i.test(normalized);
  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!recentIds.includes(permanentId)) return false;
    if (!(perm as any)?.isToken) return false;
    if (requireCreature && !permanentMatchesType(perm, 'creature')) return false;
    return true;
  });

  return singular ? matches.slice(0, 1) : matches;
}

