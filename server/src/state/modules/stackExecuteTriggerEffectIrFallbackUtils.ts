import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyOracleIRTriggerUncategorizedFallback } from './oracleIrTriggerUncategorizedFallback.js';
import { applyCopyPermanentTriggerStep, queueOptionalSelfCopyFromControlledCreature } from './trigger-copy-permanent.js';
import { resolveTriggeredAbilityTargetPlayerId } from './triggerSourceUtils.js';
import { buildStackOracleIRContext } from './oracleIrStackContextUtils.js';
import {
  createEquippedCreatureCopyTokenFromEquipment as createEquippedCreatureCopyTokenCore,
} from './oracleIrTriggerLegacyTokenHandlers.js';

function createEquippedCreatureCopyTokenFromEquipment(
  ctx: GameContext,
  controller: PlayerID,
  equipmentPermanentId: string,
  triggerDescription: string,
  grantsHasteFromStep = false,
): number {
  return createEquippedCreatureCopyTokenCore(
    ctx,
    controller,
    equipmentPermanentId,
    triggerDescription,
    grantsHasteFromStep,
  );
}

const triggerUncategorizedFallbackDeps = {
  applyCopyPermanentTriggerStep,
  queueOptionalSelfCopyFromControlledCreature,
  createEquippedCreatureCopyTokenFromEquipment,
};

export function applyOracleIRFallbackForTriggeredEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
): number {
  const text = String(description || '').trim();
  if (!text) return 0;

  const targets = Array.isArray(triggerItem?.targets) ? triggerItem.targets : [];
  let targetPlayerId = String(
    targets[0]?.id || targets[0] || triggerItem?.targetPlayerId || ''
  ).trim() as PlayerID;
  if (!targetPlayerId) {
    targetPlayerId = resolveTriggeredAbilityTargetPlayerId((ctx as any).state, triggerItem) as PlayerID;
  }

  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || ''
  ).trim();
  if (!targetPlayerId && sourcePermanentId) {
    const sourcePermanent = ((ctx as any).state?.battlefield || []).find(
      (permanent: any) => String(permanent?.id || '').trim() === sourcePermanentId
    ) as any;
    const enchantedTarget = String(
      sourcePermanent?.attachedTo ||
        sourcePermanent?.enchanting ||
        sourcePermanent?.enchantedPlayerId ||
        ''
    ).trim();
    if (enchantedTarget) {
      targetPlayerId = enchantedTarget as PlayerID;
    }
  }
  const sourceId = String(triggerItem?.id || triggerItem?.sourceId || sourcePermanentId || '').trim();

  const normalizedTargetIds = targets
    .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
    .filter(Boolean);
  const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
  let targetPermanentId: string | undefined;
  for (const targetId of normalizedTargetIds) {
    if (battlefield.some((permanent: any) => String(permanent?.id || '').trim() === targetId)) {
      targetPermanentId = targetId;
      break;
    }
  }

  const lifeLostReference = Number((triggerItem as any)?.effectData?.lifeLost ?? 0);
  const losingPlayerId = String(
    (triggerItem as any)?.effectData?.losingPlayerId ||
      (triggerItem as any)?.triggeringPlayer ||
      (triggerItem as any)?.targetPlayer ||
      ''
  ).trim() as PlayerID;

  const irCtx = buildStackOracleIRContext(controller, {
    xValue: typeof triggerItem?.xValue === 'number' ? triggerItem.xValue : undefined,
    sourceId: sourcePermanentId || sourceId,
    targetPlayerId: (targetPlayerId || losingPlayerId || undefined) as PlayerID | undefined,
    targetPermanentId,
    chosenObjectIds: normalizedTargetIds.length > 0 ? normalizedTargetIds : undefined,
    referenceAmount: Number.isFinite(lifeLostReference) && lifeLostReference > 0 ? lifeLostReference : undefined,
  });

  return applyOracleIRTriggerUncategorizedFallback(
    ctx,
    controller,
    sourceName,
    text,
    triggerItem,
    irCtx,
    triggerUncategorizedFallbackDeps,
  );
}
