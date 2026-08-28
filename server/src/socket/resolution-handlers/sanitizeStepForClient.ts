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
