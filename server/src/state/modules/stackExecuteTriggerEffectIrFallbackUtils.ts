import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyOracleIRTriggerUncategorizedFallback,
  applyTriggerIrSpecialHandlersOnly,
} from './oracleIrTriggerUncategorizedFallback.js';
import { shouldSkipTriggerUncategorizedFallback } from './oracleIrTriggerLegacyRouting.js';
import { applyCopyPermanentTriggerStep, queueOptionalSelfCopyFromControlledCreature } from './trigger-copy-permanent.js';
import { resolveTriggeredAbilityTargetPlayerId } from './triggerSourceUtils.js';
import { buildStackOracleIRContext } from './oracleIrStackContextUtils.js';
import { inferOracleIrTargetBinding } from '../../../../rules-engine/src/oracleIrTargetBinding.js';
import { tryApplyEachOpponentDamageTrigger, tryApplyTargetedDamageFromEffectText } from './triggerLifeDamageUtils.js';
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
  options?: { readonly skipUncategorizedSpellFallback?: boolean },
): number {
  const text = String(description || '').trim();
  if (!text) return 0;

  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || '',
  ).trim();
  const eachOpponentDamageApplied = tryApplyEachOpponentDamageTrigger(
    ctx,
    controller,
    text,
    sourcePermanentId || undefined,
  );
  if (eachOpponentDamageApplied > 0) {
    return eachOpponentDamageApplied;
  }

  if (tryApplyTargetedDamageFromEffectText(ctx, controller, text, triggerItem)) {
    return 1;
  }

  if (options?.skipUncategorizedSpellFallback) {
    return applyTriggerIrSpecialHandlersOnly(
      ctx,
      controller,
      sourceName,
      text,
      triggerItem,
      triggerUncategorizedFallbackDeps,
    );
  }

  const targets = Array.isArray(triggerItem?.targets) ? triggerItem.targets : [];
  const players = Array.isArray((ctx as any).state?.players) ? (ctx as any).state.players : [];
  const playerIds = new Set(players.map((player: any) => String(player?.id || '')).filter(Boolean));

  let targetPlayerId = String(
    triggerItem?.targetPlayerId || triggerItem?.thatPlayerId || '',
  ).trim() as PlayerID;
  if (!targetPlayerId) {
    const defendingPlayerId = String(triggerItem?.defendingPlayer || '').trim();
    if (defendingPlayerId && !defendingPlayerId.startsWith('perm_') && playerIds.has(defendingPlayerId)) {
      targetPlayerId = defendingPlayerId as PlayerID;
    }
  }

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
  const triggeringStackItemId = String(
    triggerItem?.triggeringStackItemId
      || triggerItem?.effectData?.triggeringStackItemId
      || '',
  ).trim();

  const normalizedTargetIds = targets
    .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
    .filter(Boolean);
  const lifeLostReference = Number((triggerItem as any)?.effectData?.lifeLost ?? 0);
  const lifePaidReference = Number((triggerItem as any)?.effectData?.lifePaid ?? 0);
  const countersPlacedReference = Number((triggerItem as any)?.effectData?.countersPlaced ?? 0);
  const damageReference = Number(
    (triggerItem as any)?.damageAmount ?? (triggerItem as any)?.effectData?.damageAmount ?? 0,
  );
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

  const interveningSubjectPermanentId = String(
    triggerItem?.interveningIfSubjectPermanentId || '',
  ).trim();
  const sourcePermanent = sourcePermanentId
    ? ((ctx as any).state?.battlefield || []).find(
      (permanent: any) => String(permanent?.id || '').trim() === sourcePermanentId,
    )
    : undefined;
  const chosenCreatureType = String(
    triggerItem?.chosenCreatureType
    || triggerItem?.card?.chosenCreatureType
    || sourcePermanent?.chosenCreatureType
    || '',
  ).trim();
  const discardedCardId = String((triggerItem as any)?.effectData?.discardedCardId || '').trim();
  const boundGraveyardCardId = String((triggerItem as any)?.boundGraveyardCardId || '').trim();
  const untappedPermanentId = String((triggerItem as any)?.effectData?.untappedPermanentId || '').trim();
  const untappedPermanentController = String(
    (triggerItem as any)?.effectData?.untappedPermanentController || '',
  ).trim();
  if (!targetPlayerId && untappedPermanentController && playerIds.has(untappedPermanentController)) {
    targetPlayerId = untappedPermanentController as PlayerID;
  }
  const triggeringLandId = String(
    (triggerItem as any)?.triggeringLandId
      || (triggerItem as any)?.effectData?.triggeringLandId
      || '',
  ).trim();
  const chosenObjectIds = Array.from(new Set([
    ...normalizedTargetIds,
    ...(interveningSubjectPermanentId ? [interveningSubjectPermanentId] : []),
    ...(untappedPermanentId ? [untappedPermanentId] : []),
    ...(discardedCardId ? [discardedCardId] : []),
    ...(boundGraveyardCardId ? [boundGraveyardCardId] : []),
    ...(triggeringLandId ? [triggeringLandId] : []),
  ]));
  const targetBinding = inferOracleIrTargetBinding((ctx as any).state, chosenObjectIds, controller);

  const irCtx = buildStackOracleIRContext(controller, {
    xValue: typeof triggerItem?.xValue === 'number' ? triggerItem.xValue : undefined,
    sourceId: sourcePermanentId || sourceId,
    sourceName,
    targetPlayerId: (targetPlayerId || losingPlayerId || undefined) as PlayerID | undefined,
    targetOpponentId: (
      targetPlayerId && String(targetPlayerId) !== String(controller)
        ? targetPlayerId
        : losingPlayerId && String(losingPlayerId) !== String(controller)
          ? losingPlayerId
          : undefined
    ) as PlayerID | undefined,
    targetPermanentId:
      targetBinding.targetPermanentId || interveningSubjectPermanentId || untappedPermanentId || undefined,
    targetCreatureId: targetBinding.targetCreatureId,
    targetSpellId: targetBinding.targetSpellId || triggeringStackItemId || undefined,
    chosenObjectIds: chosenObjectIds.length > 0 ? chosenObjectIds : undefined,
    referenceAmount:
      Number.isFinite(lifeLostReference) && lifeLostReference > 0
        ? lifeLostReference
        : Number.isFinite(lifePaidReference) && lifePaidReference > 0
          ? lifePaidReference
          : Number.isFinite(countersPlacedReference) && countersPlacedReference > 0
            ? countersPlacedReference
            : Number.isFinite(damageReference) && damageReference > 0
              ? damageReference
              : undefined,
    ...(lastAntecedentBattlefieldPermanentIds.length > 0
      ? { lastAntecedentBattlefieldPermanentIds }
      : interveningSubjectPermanentId
        ? { lastAntecedentBattlefieldPermanentIds: [interveningSubjectPermanentId] }
        : {}),
    ...(chosenCreatureType ? { chosenCreatureType } : {}),
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

  const resolvedTargetPermanentId =
    targetBinding.targetPermanentId || interveningSubjectPermanentId || undefined;

  if (
    applied > 0
    && /copy of target creature you control/i.test(text)
    && resolvedTargetPermanentId
  ) {
    const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
    const newestToken = [...battlefield].reverse().find((perm: any) => perm?.isToken === true);
    if (newestToken && !newestToken.copiedFromPermanentId) {
      newestToken.copiedFromPermanentId = resolvedTargetPermanentId;
    }
  }

  return applied;
}
