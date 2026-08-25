// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: normalizeArmyCreatureSelectorText, resolveDeterministicArmyCreatureSelection.
// Public entries: those two helpers.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';

export function normalizeArmyCreatureSelectorText(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined
): string | null {
  if (!target || target.kind !== 'raw') return null;
  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return null;
  return /^(?:target |an |a )?army creature you control$/i.test(normalized) ? normalized : null;
}

export function resolveDeterministicArmyCreatureSelection(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  if (!normalizeArmyCreatureSelectorText(target)) return null;

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return [];

  const matches = battlefield.filter((perm: any) => {
    if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
    if (!permanentMatchesType(perm, 'creature')) return false;
    return new RegExp(`(^|[^a-z])army($|[^a-z])`, 'i').test(getExecutorTypeLineLower(perm));
  });

  return matches.length === 1 ? matches : [];
}

