// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: oracleIrBattlefieldRemovalOptions, buildPermanentCardWithStats.
// Public entries: those two helpers.

import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  oracleIrBattlefieldRemovalBridgeOptions,
  type FinalizeBattlefieldRemovalOptions,
} from './oracleIRExecutorBattlefieldOps';

export function oracleIrBattlefieldRemovalOptions(
  ctx: OracleIRExecutionContext,
  stepKind: string,
): FinalizeBattlefieldRemovalOptions | undefined {
  return oracleIrBattlefieldRemovalBridgeOptions(ctx, stepKind);
}

export function buildPermanentCardWithStats(perm: any, zone: string): any {
  const base = buildZoneObjectWithRetainedCounters((perm as any)?.card, perm, zone);
  const power = (perm as any)?.effectivePower ?? (perm as any)?.power ?? (perm as any)?.basePower ?? (perm as any)?.card?.power;
  const toughness =
    (perm as any)?.effectiveToughness ?? (perm as any)?.toughness ?? (perm as any)?.baseToughness ?? (perm as any)?.card?.toughness;
  const owner = (perm as any)?.owner ?? (perm as any)?.ownerId ?? (perm as any)?.controller ?? (perm as any)?.controllerId;
  const controller = (perm as any)?.controller ?? (perm as any)?.controllerId ?? owner;
  return {
    ...base,
    ...(owner ? { owner, ownerId: owner } : {}),
    ...(controller ? { controller, controllerId: controller } : {}),
    ...(power !== undefined && power !== null ? { power } : {}),
    ...(toughness !== undefined && toughness !== null ? { toughness } : {}),
  };
}
