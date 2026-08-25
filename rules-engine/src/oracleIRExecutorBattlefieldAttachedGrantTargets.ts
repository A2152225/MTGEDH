// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveAttachedStaticAbilityGrantTargets.
// Public entry: resolveAttachedStaticAbilityGrantTargets.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';

export function resolveAttachedStaticAbilityGrantTargets(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target || target.kind !== 'raw') return [];
  const normalized = String((target as any).text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return [];
  const sourcePermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId) as any;

  const sourceSelfMatch = normalized.match(/^this\s+(creature|land|saga|permanent|enchantment)$/i);
  if (sourceSelfMatch) {
    if (!sourcePermanent) return [];
    const requiredType = String(sourceSelfMatch[1] || '').toLowerCase() === 'saga' ? 'enchantment' : String(sourceSelfMatch[1] || '').toLowerCase();
    if (requiredType !== 'permanent' && !permanentMatchesType(sourcePermanent, requiredType as any)) return [];
    return [sourcePermanent];
  }

  const attachedTargetMatch = normalized.match(/^(?:equipped|enchanted)\s+(creature|land|permanent)$/i);
  if (!attachedTargetMatch || !sourcePermanent) return [];

  const attachedToId = String(sourcePermanent.attachedTo || sourcePermanent.enchanting || '').trim();
  if (!attachedToId) return [];
  const attachedPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId);
  if (!attachedPermanent) return [];

  const requiredType = String(attachedTargetMatch[1] || '').trim().toLowerCase();
  if (requiredType !== 'permanent' && !permanentMatchesType(attachedPermanent, requiredType as any)) return [];
  return [attachedPermanent];
}

