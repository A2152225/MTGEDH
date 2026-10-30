/**
 * socket/resolution-handlers/sanitizeStepForClient.ts
 *
 * Origin parent: server/src/socket/resolution.ts.
 * Cluster moved: sanitizeStepForClient (strip internal fields and hydrate presentation).
 * Public entry symbols: sanitizeStepForClient.
 *
 * Parent re-exports this symbol. Must not import resolution.ts.
 */

import {
  ResolutionStepType,
  type ResolutionStep,
  type TargetSelectionStep,
} from "../../state/resolution/index.js";
import { inferResolutionStepMandatory } from "../../state/resolution/mandatoryInference.js";
import { refreshCounterPlacementResolutionStepForClient } from "../../state/modules/triggerCounterPlacementPromptUtils.js";
import { refreshKynaiosLandPlayResolutionStepForClient } from "../../state/modules/triggerLandPlayPromptUtils.js";
import { buildOraclePromptContext, getOracleTextFromResolutionStep } from "../../utils/oraclePromptContext.js";
import { getOptionalPaymentValidationFailure, isOptionalPaymentPromptStep } from "../optional-payment-prompts.js";
import { getTypeSpecificFields } from "../resolutionStepTypeSpecificFieldsUtils.js";
import { ensureGame } from "../util.js";
import { getPanglacialCastableCards } from "./panglacialSearchCastUtils.js";
import { getFilteredValidTargetsForStep } from "./resolutionTargetSelectionDistinctTargetUtils.js";
import { hydrateSpellPaymentPresentationFieldsForClient } from "./spellPaymentPresentationSanitizeUtils.js";
import { resolveResolutionPromptCause } from "../../state/modules/resolutionPromptCause.js";
import { getAffordableXHintForCostPerX } from "../../state/modules/spellXCastUtils.js";
import { flagbearerRequiredTargetIds } from "../../state/modules/flagbearerTargeting.js";
import {
  buildRepeatedZoneDraftCardChoiceInfo,
  filterLegalRepeatedZoneDraftCardIds,
} from "../../../../rules-engine/src/oracleIRExecutorRepeatedZoneDraft.js";

export function sanitizeStepForClient(gameId: string, step: ResolutionStep): any {
  const oracleText = getOracleTextFromResolutionStep(step);
  const oracleContext = oracleText ? buildOraclePromptContext(oracleText) : undefined;

  const typeSpecificFields = getTypeSpecificFields(step);
  if (step.type === ResolutionStepType.TARGET_SELECTION) {
    const targetStep = step as TargetSelectionStep;
    const filtered = getFilteredValidTargetsForStep(gameId, targetStep);
    if (filtered !== targetStep.validTargets) {
      (typeSpecificFields as any).validTargets = filtered;
    }
    try {
      const game = ensureGame(gameId);
      const required = game ? flagbearerRequiredTargetIds(game.state, String(step.playerId || ''), { ...targetStep, validTargets: filtered }) : [];
      if (required.length > 0) (typeSpecificFields as any).requiredFlagbearerIds = required;
    } catch {
      // presentation only
    }
  }

  if (step.type === ResolutionStepType.MANA_PAYMENT_CHOICE) {
    hydrateSpellPaymentPresentationFieldsForClient(
      gameId,
      step,
      typeSpecificFields,
      oracleText,
    );
  }

  if (
    step.type === ResolutionStepType.OPTION_CHOICE
    && isOptionalPaymentPromptStep(step as any)
  ) {
    try {
      const game = ensureGame(gameId);
      const payChoiceId = String((step as any).optionalPaymentPayChoiceId || 'pay').trim();
      const validationFailure = game
        ? getOptionalPaymentValidationFailure(game, String(step.playerId || ''), step as any, payChoiceId)
        : null;
      if (validationFailure) {
        const options = Array.isArray((typeSpecificFields as any).options)
          ? (typeSpecificFields as any).options
          : (Array.isArray((step as any).options) ? (step as any).options : []);
        (typeSpecificFields as any).options = options.map((option: any) => {
          if (String(option?.id || '') !== payChoiceId) return option;
          return {
            ...option,
            disabled: true,
            description: `${validationFailure.message} Minimize this prompt to tap mana sources.`,
          };
        });
      }
    } catch {
      // best-effort affordability presentation; submission is still server-validated
    }
  }

  // "You may pay {X}, where X is ..." prompts: tell the client how many X the player's current mana can
  // actually pay for, so the modal can show it (and cap its suggestion) next to the per-X cost.
  if (
    step.type === ResolutionStepType.X_VALUE_SELECTION
    && typeof (step as any).costPerX === 'string'
    && (typeSpecificFields as any).affordableXHint === undefined
  ) {
    try {
      const game = ensureGame(gameId);
      const hint = game
        ? getAffordableXHintForCostPerX(game, String(step.playerId || ''), String((step as any).costPerX), (typeSpecificFields as any).maxValue)
        : undefined;
      if (hint !== undefined) (typeSpecificFields as any).affordableXHint = hint;
    } catch {
      // best-effort presentation hint; the submission itself is validated server-side
    }
  }

  if (
    step.type === ResolutionStepType.KYNAIOS_CHOICE
    || (
      step.type === ResolutionStepType.OPTION_CHOICE
      && (
        (step as any).landPlayOrFallbackOptions
        || (step as any).kynaiosBatchId
      )
    )
  ) {
    try {
      const game = ensureGame(gameId);
      const refreshed = refreshKynaiosLandPlayResolutionStepForClient(
        game?.state,
        { ...step, ...typeSpecificFields },
      );
      typeSpecificFields.isController = refreshed.isController;
      typeSpecificFields.canPlayLand = refreshed.canPlayLand;
      typeSpecificFields.landsInHand = refreshed.landsInHand;
      typeSpecificFields.options = refreshed.options;
      typeSpecificFields.landPlayOrFallbackIsController = refreshed.landPlayOrFallbackIsController;
      typeSpecificFields.landPlayOrFallbackCanPlayLand = refreshed.landPlayOrFallbackCanPlayLand;
      typeSpecificFields.landPlayOrFallbackLandsInHand = refreshed.landPlayOrFallbackLandsInHand;
      typeSpecificFields.landPlayOrFallbackOptions = refreshed.landPlayOrFallbackOptions;
    } catch {
      // best-effort refresh from live hand
    }
  }

  if (
    step.type === ResolutionStepType.OPTION_CHOICE
    && ((step as any).counterPlacementTrigger === true || (step as any).agitatorAntTrigger === true)
  ) {
    try {
      const game = ensureGame(gameId);
      const refreshed = refreshCounterPlacementResolutionStepForClient(
        game?.state,
        { ...step, ...typeSpecificFields },
      );
      typeSpecificFields.options = refreshed.options;
      typeSpecificFields.availableCreatures = refreshed.availableCreatures;
      typeSpecificFields.counterPlacementTrigger = refreshed.counterPlacementTrigger;
      typeSpecificFields.agitatorAntTrigger = refreshed.agitatorAntTrigger;
      typeSpecificFields.effectType = refreshed.effectType ?? (step as any).effectType;
      typeSpecificFields.conditionalEffect = refreshed.conditionalEffect ?? (step as any).conditionalEffect;
      typeSpecificFields.sourceController = refreshed.sourceController ?? (step as any).sourceController;
      typeSpecificFields.triggerDescription = refreshed.triggerDescription ?? (step as any).triggerDescription;
    } catch {
      // best-effort refresh from live battlefield
    }
  }

  if (step.type === ResolutionStepType.LIBRARY_SEARCH) {
    const castableWhileSearchingCards = getPanglacialCastableCards(gameId, step);
    if (castableWhileSearchingCards.length > 0) {
      (typeSpecificFields as any).castableWhileSearchingCards = castableWhileSearchingCards;
    }
  }

  let causeFields = resolveResolutionPromptCause(step);
  if (causeFields && !causeFields.causeImage) {
    try {
      const game = ensureGame(gameId);
      causeFields = resolveResolutionPromptCause(step, game?.state) || causeFields;
    } catch {
      // image lookup is best-effort; name/label already resolved
    }
  }

  if (step.type === ResolutionStepType.REPEATED_ZONE_DRAFT) {
    try {
      const game = ensureGame(gameId);
      const remaining = Array.isArray((step as any).remainingCardIds)
        ? (step as any).remainingCardIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [];
      const chooserId = String(step.playerId || '').trim();
      if (game?.state && chooserId && remaining.length > 0) {
        const legalIds = filterLegalRepeatedZoneDraftCardIds(game.state, remaining, chooserId);
        const cards = legalIds
          .map((id) => buildRepeatedZoneDraftCardChoiceInfo(game.state, id, chooserId))
          .filter(Boolean);
        if (cards.length > 0) (typeSpecificFields as any).cards = cards;
      }
    } catch {
      // Keep the stored card snapshot when the live exile lookup fails.
    }
  }

  return {
    id: step.id,
    type: step.type,
    playerId: step.playerId,
    description: step.description,
    mandatory: inferResolutionStepMandatory(step as any),
    sourceId: step.sourceId,
    sourceName: step.sourceName,
    sourceImage: step.sourceImage,
    createdAt: step.createdAt,
    timeoutMs: step.timeoutMs,
    oracleContext,
    ...(causeFields || {}),
    // Include type-specific fields
    ...typeSpecificFields,
  };
}
