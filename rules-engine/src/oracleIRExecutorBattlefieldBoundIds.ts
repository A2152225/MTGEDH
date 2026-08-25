// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: collectBoundBattlefieldIds.
// Public entry: collectBoundBattlefieldIds.

import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export function collectBoundBattlefieldIds(ctx: OracleIRExecutionContext): string[] {
  return Array.from(
    new Set(
      [
        String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        String(ctx.selectorContext?.targetPermanentId || '').trim(),
        String(ctx.selectorContext?.targetCreatureId || '').trim(),
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
          : []),
      ].filter(Boolean)
    )
  );
}

