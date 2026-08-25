/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Battlefield permanent resolvers for special-target steps.
 * Public: resolveSourcePermanent, resolveEnchantedHost, resolveContextualCreature
 */
import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { collectBoundIds } from './oracleIRExecutorSpecialTargetOps';

export function resolveSourcePermanent(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): any | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  return sourceId
    ? battlefield.find((perm) => String((perm as any)?.id || '').trim() === sourceId)
    : undefined;
}

export function resolveEnchantedHost(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): BattlefieldPermanent | undefined {
  const source = resolveSourcePermanent(battlefield, ctx);
  const attachedToId = String((source as any)?.attachedTo || (source as any)?.enchanting || '').trim();
  return attachedToId
    ? battlefield.find((perm) => String((perm as any)?.id || '').trim() === attachedToId)
    : undefined;
}

export function resolveContextualCreature(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): BattlefieldPermanent | undefined {
  const ids = collectBoundIds(ctx);
  for (const id of ids) {
    const match = battlefield.find((perm) => String((perm as any)?.id || '').trim() === id);
    if (match && permanentMatchesType(match, 'creature')) return match;
  }
  const creatures = battlefield.filter((perm) => permanentMatchesType(perm, 'creature'));
  return creatures.length === 1 ? creatures[0] : creatures.find((perm) => permanentMatchesType(perm, 'creature'));
}
