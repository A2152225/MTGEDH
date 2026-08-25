// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: collectSacrificeChoiceBoundIds.
// Public entry: collectSacrificeChoiceBoundIds.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';

export function collectSacrificeChoiceBoundIds(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
): string[] {
  const permanentIds = new Set(
    battlefield
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean),
  );
  return collectBoundBattlefieldIds(ctx).filter((id) => permanentIds.has(id));
}
