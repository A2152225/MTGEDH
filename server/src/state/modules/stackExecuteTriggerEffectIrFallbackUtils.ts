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
  const players = Array.isArray((ctx as any).state?.players) ? (ctx as any).state.players : [];
  const playerIds = new Set(players.map((player: any) => String(player?.id || '')).filter(Boolean));

  let targetPlayerId = String(triggerItem?.targetPlayerId || '').trim() as PlayerID;
  if (!targetPlayerId) {
    const defendingPlayerId = String(triggerItem?.defendingPlayer || '').trim();
    if (defendingPlayerId && !defendingPlayerId.startsWith('perm_') && playerIds.has(defendingPlayerId)) {
      targetPlayerId = defendingPlayerId as PlayerID;
    }
  }

  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || ''
  ).trim();
  if (!targetPlayerId && sourcePermanentId) {
    const sourcePermanent = ((ctx as any).state?.battlefield || []).find(
      (permanent: any) => String(permanent?.id || '').trim() === sourcePermanentId
    ) as any;
    const attackingPlayerId = String(sourcePermanent?.attacking || '').trim();
    if (attackingPlayerId && !attackingPlayerId.startsWith('perm_') && playerIds.has(attackingPlayerId)) {
      targetPlayerId = attackingPlayerId as PlayerID;
    }
    const enchantedTarget = String(
      sourcePermanent?.attachedTo ||
        sourcePermanent?.enchanting ||
        sourcePermanent?.enchantedPlayerId ||
        ''
    ).trim();
    if (!targetPlayerId && enchantedTarget && playerIds.has(enchantedTarget)) {
      targetPlayerId = enchantedTarget as PlayerID;
    }
  }
  if (!targetPlayerId) {
    targetPlayerId = resolveTriggeredAbilityTargetPlayerId((ctx as any).state, triggerItem) as PlayerID;
  }
  const sourceId = String(sourcePermanentId || triggerItem?.sourceId || triggerItem?.id || '').trim();

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
  const lastAntecedentBattlefieldPermanentIds = (
    Array.isArray(triggerItem?.lastAntecedentBattlefieldPermanentIds)
      ? triggerItem.lastAntecedentBattlefieldPermanentIds
      : Array.isArray(triggerItem?.antecedentPermanentIds)
        ? triggerItem.antecedentPermanentIds
        : []
  )
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean);

  const irCtx = buildStackOracleIRContext(controller, {
    xValue: typeof triggerItem?.xValue === 'number' ? triggerItem.xValue : undefined,
    sourceId: sourcePermanentId || sourceId,
    targetPlayerId: (targetPlayerId || losingPlayerId || undefined) as PlayerID | undefined,
    targetOpponentId: (
      targetPlayerId && String(targetPlayerId) !== String(controller)
        ? targetPlayerId
        : losingPlayerId && String(losingPlayerId) !== String(controller)
          ? losingPlayerId
          : undefined
    ) as PlayerID | undefined,
    targetPermanentId,
    chosenObjectIds: normalizedTargetIds.length > 0 ? normalizedTargetIds : undefined,
    referenceAmount: Number.isFinite(lifeLostReference) && lifeLostReference > 0 ? lifeLostReference : undefined,
    ...(lastAntecedentBattlefieldPermanentIds.length > 0
      ? { lastAntecedentBattlefieldPermanentIds }
      : {}),
  });

  const applied = applyOracleIRTriggerUncategorizedFallback(
    ctx,
    controller,
    sourceName,
    text,
    triggerItem,
    irCtx,
    triggerUncategorizedFallbackDeps,
  );

  if (
    applied > 0
    && /copy of target creature you control/i.test(text)
    && targetPermanentId
  ) {
    const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
    const newestToken = [...battlefield].reverse().find((perm: any) => perm?.isToken === true);
    if (newestToken && !newestToken.copiedFromPermanentId) {
      newestToken.copiedFromPermanentId = targetPermanentId;
    }
  }

  return applied;
}
