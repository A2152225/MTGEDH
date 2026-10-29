/**
 * socket/resolution-handlers/resolutionPendingCastPaymentPrompt.ts
 *
 * Origin parent: server/src/socket/resolution.ts.
 * Cluster moved: the pending-cast payment prompt family - cost-metadata normalization, the
 * MANA_PAYMENT_CHOICE cost/presentation field builders, the final mana-cost string builder, and
 * the "additional cost is done, now ask for payment" emitter used by the no-target cast flow.
 * Public entry symbols: ensurePendingCastCostMetadata, buildPendingCastPaymentStepCostFields,
 * buildSpellPaymentPresentationFields, buildPendingCastPaymentManaCost,
 * emitPendingCastPaymentIfNeeded.
 *
 * Extracted as groundwork for the TARGET_SELECTION branch extracts, which need the emitter without
 * capturing resolution.ts closures. Must not import resolution.ts.
 */

import { buildCommanderFreeCastPaymentExtras } from "../../state/modules/alternate-costs.js";
import {
  expandManaCostWithReplicate,
  parseReplicateManaCost,
  readReplicateCount,
} from "../../state/modules/replicateCastUtils.js";
import { buildNormalizedManaPaymentModel } from "../../state/modules/mana-check.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
} from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import {
  buildPaymentCostAdjustmentPayload,
  formatManaCostWithCostAdjustment,
  getSpellModeAdditionalCost,
  resolveEffectiveSpellBaseManaCost,
  type CostReductionMetadata,
  type PendingCastCostMetadata,
} from "../game-actions.js";
import { appendCastSpellContinuationEvent } from "../resolutionSyntheticCastSocketUtils.js";

function createEmptyPendingCostReduction(): CostReductionMetadata {
  return {
    generic: 0,
    colors: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    messages: [],
  };
}

function normalizePendingCastCostMetadata(pendingCast: any): PendingCastCostMetadata {
  const existing = pendingCast?.costMetadata && typeof pendingCast.costMetadata === 'object'
    ? pendingCast.costMetadata
    : {};
  const legacyReduction = pendingCast?.costReduction && typeof pendingCast.costReduction === 'object'
    ? pendingCast.costReduction
    : undefined;
  const reductionSource = existing.costReduction && typeof existing.costReduction === 'object'
    ? existing.costReduction
    : legacyReduction;
  const staticTaxSource = existing.staticCostTax && typeof existing.staticCostTax === 'object'
    ? existing.staticCostTax
    : {};
  const genericCostTax = Math.max(0, Number(
    Number.isFinite(Number(existing.genericCostTax))
      ? existing.genericCostTax
      : (Number.isFinite(Number(staticTaxSource.generic)) ? staticTaxSource.generic : pendingCast?.externalCostTax)
  ) || 0);
  const taxMessages = Array.isArray(staticTaxSource.messages)
    ? [...staticTaxSource.messages]
    : (Array.isArray(pendingCast?.externalCostTaxMessages) ? [...pendingCast.externalCostTaxMessages] : []);
  const emptyReduction = createEmptyPendingCostReduction();
  const costReduction: CostReductionMetadata = {
    generic: Math.max(0, Number(reductionSource?.generic || 0)),
    colors: { ...emptyReduction.colors, ...(reductionSource?.colors || {}) },
    messages: Array.isArray(reductionSource?.messages) ? [...reductionSource.messages] : [],
  };
  const paymentCostAdjustment = existing.paymentCostAdjustment || pendingCast?.paymentCostAdjustment;
  const isFreeCast =
    pendingCast?.castWithoutPayingManaCost === true
    || String(pendingCast?.forcedAlternateCostId || '').trim().toLowerCase() === 'free'
    || existing.paymentModel?.castWithoutPayingManaCost === true
    || String(existing.paymentModel?.forcedAlternateCostId || '').trim().toLowerCase() === 'free';
  const existingPaymentModel = existing.paymentModel && typeof existing.paymentModel === 'object'
    ? existing.paymentModel
    : undefined;
  const paymentModel = isFreeCast
    ? buildNormalizedManaPaymentModel({
        originalManaCost: String(existingPaymentModel?.originalManaCost || pendingCast?.card?.mana_cost || pendingCast?.rawManaCost || ''),
        effectiveManaCost: '{0}',
        castWithoutPayingManaCost: true,
        forcedAlternateCostId: String(
          pendingCast?.forcedAlternateCostId
          || existingPaymentModel?.forcedAlternateCostId
          || 'free',
        ).trim() || 'free',
        additionalCosts: Array.isArray(existingPaymentModel?.additionalCosts)
          ? existingPaymentModel.additionalCosts
          : (Array.isArray(pendingCast?.additionalCosts) ? pendingCast.additionalCosts : []),
      })
    : existingPaymentModel;

  return {
    costReduction,
    staticCostTax: { generic: genericCostTax, messages: taxMessages },
    genericCostTax,
    ...(paymentCostAdjustment ? { paymentCostAdjustment } : {}),
    ...(paymentModel ? { paymentModel } : {}),
  };
}

/** Normalize (and cache on the pending cast) the cost reduction / tax metadata. */
export function ensurePendingCastCostMetadata(pendingCast: any): PendingCastCostMetadata {
  const costMetadata = normalizePendingCastCostMetadata(pendingCast);
  if (pendingCast && typeof pendingCast === 'object') {
    pendingCast.costMetadata = costMetadata;
  }
  return costMetadata;
}

function hasVisibleCostReduction(reduction: CostReductionMetadata): boolean {
  return Number(reduction.generic || 0) > 0
    || Object.values(reduction.colors || {}).some((amount) => Number(amount) > 0)
    || reduction.messages.length > 0;
}

/** Cost fields for a MANA_PAYMENT_CHOICE step built from a pending cast. */
export function buildPendingCastPaymentStepCostFields(
  pendingCast: any,
  originalManaCost: string,
  adjustedManaCost: string,
): { manaCost: string; costAdjustment: any; costReduction?: CostReductionMetadata } {
  const costMetadata = ensurePendingCastCostMetadata(pendingCast);

  return {
    manaCost: adjustedManaCost,
    costAdjustment: costMetadata.paymentCostAdjustment
      ? { ...costMetadata.paymentCostAdjustment, adjustedManaCost }
      : buildPaymentCostAdjustmentPayload(
          originalManaCost,
          adjustedManaCost,
          costMetadata.costReduction,
          costMetadata.genericCostTax,
          costMetadata.staticCostTax.messages,
        ),
    costReduction: hasVisibleCostReduction(costMetadata.costReduction) ? costMetadata.costReduction : undefined,
  };
}

/** Presentation fields (oracle text, type line, alternate costs) for payment prompts. */
export function buildSpellPaymentPresentationFields(
  pendingCast: any,
  options?: { game?: any; playerId?: string },
): Record<string, unknown> {
  const oracleText = String(pendingCast?.oracleText || pendingCast?.card?.oracle_text || '').trim();
  const typeLine = String(
    pendingCast?.typeLine
    || pendingCast?.type_line
    || pendingCast?.card?.type_line
    || pendingCast?.card?.typeLine
    || '',
  ).trim();
  const fields: Record<string, unknown> = {};
  if (oracleText) fields.oracleText = oracleText;
  // CastSpellModal / restricted-mana purpose need Artifact (Vehicle, Equipment, etc.).
  if (typeLine) {
    fields.typeLine = typeLine;
    fields.type_line = typeLine;
  }

  let extraAlternateCosts = Array.isArray(pendingCast?.extraAlternateCosts)
    ? [...pendingCast.extraAlternateCosts]
    : [];

  const game = options?.game;
  const playerId = String(options?.playerId || pendingCast?.playerId || '').trim();
  if (game && playerId) {
    const commanderFreeCtx = {
      state: game.state,
      commandZone: (game as any).commandZone ?? game.state?.commandZone ?? {},
    } as any;
    const commanderFree = buildCommanderFreeCastPaymentExtras(
      commanderFreeCtx,
      playerId as any,
      pendingCast?.card || { oracle_text: oracleText, name: pendingCast?.cardName },
    );
    if (commanderFree) {
      fields.preferredAlternateCostId =
        pendingCast?.preferredAlternateCostId
        || pendingCast?.forcedAlternateCostId
        || commanderFree.preferredAlternateCostId;
      const existingIds = new Set(extraAlternateCosts.map((c: any) => String(c?.id || '')));
      for (const extra of commanderFree.extraAlternateCosts) {
        if (existingIds.has(extra.id)) {
          extraAlternateCosts = extraAlternateCosts.map((c: any) =>
            String(c?.id || '') === extra.id ? { ...c, ...extra } : c
          );
        } else {
          extraAlternateCosts.push(extra);
          existingIds.add(extra.id);
        }
      }
    }
  }

  if (pendingCast?.preferredAlternateCostId) {
    fields.preferredAlternateCostId = pendingCast.preferredAlternateCostId;
  }

  const isForcedFreeCast =
    String(pendingCast?.forcedAlternateCostId || '').trim().toLowerCase() === 'free'
    || pendingCast?.castWithoutPayingManaCost === true;
  if (isForcedFreeCast) {
    const existingIds = new Set(extraAlternateCosts.map((c: any) => String(c?.id || '')));
    if (!existingIds.has('free')) {
      extraAlternateCosts.push({
        id: 'free',
        label: 'Free Cast',
        description: 'Cast without paying its mana cost',
        manaCost: '{0}',
      });
    }
    if (!fields.preferredAlternateCostId) {
      fields.preferredAlternateCostId = 'free';
    }
  }

  if (extraAlternateCosts.length > 0) {
    fields.extraAlternateCosts = extraAlternateCosts;
  }
  if (pendingCast?.fromZone) fields.fromZone = pendingCast.fromZone;
  return fields;
}

/** Final mana cost string for a pending cast, including mode/entwine and tax riders. */
export function buildPendingCastPaymentManaCost(pendingCast: any): string {
  const costMetadata = ensurePendingCastCostMetadata(pendingCast);
  const commandAdjustedManaCost = String(costMetadata.paymentCostAdjustment?.adjustedManaCost || '').trim();
  const baseManaCost = String(pendingCast?.fromZone || '') === 'command' && commandAdjustedManaCost
    ? commandAdjustedManaCost
    : formatManaCostWithCostAdjustment(
        resolveEffectiveSpellBaseManaCost(pendingCast),
        costMetadata.costReduction,
        pendingCast?.xValue,
        costMetadata.genericCostTax,
      );
  const spellModeAdditionalCost = getSpellModeAdditionalCost(
    String(pendingCast?.card?.oracle_text || ''),
    pendingCast?.selectedModes,
    pendingCast?.selectedAdditionalCostModes ?? pendingCast?.selectedSpreeModes,
  ) || String(pendingCast?.entwineCost || pendingCast?.card?.entwineCost || '').trim();
  const extraTax = String(pendingCast?.additionalCostTax || '').trim();
  const replicateCost = parseReplicateManaCost(String(pendingCast?.card?.oracle_text || ''));
  const replicateTimes = Math.max(readReplicateCount(pendingCast), readReplicateCount(pendingCast?.card));
  return expandManaCostWithReplicate(
    `${baseManaCost}${spellModeAdditionalCost}${extraTax}`,
    replicateCost,
    replicateTimes,
  );
}

/**
 * After an additional cost is paid for a no-target spell, queue the payment prompt the cast is
 * waiting on (unless one is already queued for that effect).
 */
export function emitPendingCastPaymentIfNeeded(
  game: any,
  gameId: string,
  effectId: string,
  payerId: string,
): void {
  if (!effectId) return;
  const pendingCast = (game.state as any)?.pendingSpellCasts?.[effectId];
  if (!pendingCast) return;
  if (!pendingCast.noTargets) return;
  if (!pendingCast.pendingPaymentAfterAdditionalCost) return;

  const finalManaCost = buildPendingCastPaymentManaCost(pendingCast);

  const existingPaymentStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, payerId as any)
    .find((s: any) =>
      s?.type === ResolutionStepType.MANA_PAYMENT_CHOICE &&
      (s as any)?.spellPaymentRequired === true &&
      String((s as any)?.effectId || '') === String(effectId)
    );

  if (!existingPaymentStep) {
    const paymentCostFields = buildPendingCastPaymentStepCostFields(
      pendingCast,
      String(pendingCast.manaCost || ''),
      finalManaCost,
    );
    const paymentStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: payerId as any,
      sourceId: pendingCast.cardId,
      sourceName: pendingCast.cardName,
      sourceImage: pendingCast.card?.image_uris?.small || pendingCast.card?.image_uris?.normal,
      description: `Pay costs to cast ${pendingCast.cardName}.`,
      mandatory: true,

      spellPaymentRequired: true,
      cardId: pendingCast.cardId,
      cardName: pendingCast.cardName,
      manaCost: paymentCostFields.manaCost,
      xValue: pendingCast.xValue,
      effectId,
      targets: pendingCast.targets,
      imageUrl: pendingCast.card?.image_uris?.small || pendingCast.card?.image_uris?.normal,
      costAdjustment: paymentCostFields.costAdjustment,
      costReduction: paymentCostFields.costReduction,
      convokeOptions: pendingCast.convokeOptions,
      forcedAlternateCostId: pendingCast.forcedAlternateCostId,
      ...buildSpellPaymentPresentationFields(pendingCast, { game, playerId: payerId }),
    } as any);

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: payerId,
      cardId: pendingCast.cardId,
      effectId,
      pendingSpellCast: {
        ...(pendingCast || {}),
      },
      queuedResolutionStep: {
        ...(paymentStep as any),
      },
    });
  }

  pendingCast.pendingPaymentAfterAdditionalCost = false;
  debug(2, `[Resolution] Additional-cost flow complete for no-target spell ${pendingCast.cardName}; requesting payment (${finalManaCost})`);
}
