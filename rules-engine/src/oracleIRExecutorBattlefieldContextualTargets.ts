// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: buildContextualBattlefieldTargetIds.
// Public entry: buildContextualBattlefieldTargetIds.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';

export function buildContextualBattlefieldTargetIds(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
  plural: boolean | undefined,
  typeFilter?: ReturnType<typeof parseSimplePermanentTypeFromText>
): string[] {
  const battlefieldIds = new Set(
    battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean)
  );
  const lastMovedBattlefieldIds = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
    ? ctx.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const movedOnBattlefield = lastMovedBattlefieldIds.filter(id => battlefieldIds.has(id));
  if (plural && movedOnBattlefield.length > 0) {
    let resolved = movedOnBattlefield;
    if (typeFilter) {
      const typed = resolved.filter(id => {
        const permanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id);
        return permanent ? permanentMatchesType(permanent, typeFilter) : false;
      });
      if (typed.length > 0) resolved = typed;
    }
    return resolved;
  }

  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
    ...chosenObjectIds,
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.selectorContext?.targetCreatureId || '').trim(),
    String(ctx.selectorContext?.targetPermanentId || '').trim(),
  ]) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }

  const onBattlefield = candidates.filter(id => battlefieldIds.has(id));
  let resolved = onBattlefield.length > 0 ? onBattlefield : candidates;
  if (typeFilter) {
    const typed = resolved.filter(id => {
      const permanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id);
      return permanent ? permanentMatchesType(permanent, typeFilter) : false;
    });
    if (typed.length > 0) resolved = typed;
  }
  return plural ? resolved : resolved.slice(0, 1);
}

