// Origin parent: client/src/App.tsx
// Cluster moved: resolutionStepPrompt early branches (discard_selection through bounce land).
// Public entry symbols: handleAppResolutionStepPromptEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import type { KnownCardRef, PaymentCostAdjustment } from "../../../shared/src";
import { buildOptionalEffectKey } from "../../../shared/src/optionalEffectKey";
import type { GraveyardCard } from "../components/GraveyardSelectionModal";
import type { KynaiosChoiceRequest } from "../components/KynaiosChoiceModal";
import type { OpponentMayPayPrompt } from "../components/OpponentMayPayModal";
import type { OptionChoiceRequest } from "../components/OptionChoiceModal";
import type { TargetOption } from "../components/TargetSelectionModal";
import type { TwoPileSplitRequest } from "../components/TwoPileSplitModal";
import { debug } from "../utils/debug";
import {
  buildGenericOptionChoiceRequestFromStep,
  buildPendingSpellXSelectionFromStep,
  isGenericNumberChoiceStep,
  isGenericOptionChoiceFallbackStep,
  isNamedGenericOptionChoiceStep,
} from "../utils/resolutionChoicePrimitives";
import { isResolutionStepMandatory } from "../utils/resolutionStepUtils";

export function handleAppResolutionStepPromptEarly(
  step: any,
  payload: { gameId: string; step: any },
  p: Record<string, any>,
) {
  const {
    discardCount,
    mulliganBottomLastSubmittedStepId,
    openConfirmFromResolutionStep,
    safeView,
    safeViewRef,
    setAnyColorManaModalData,
    setAnyColorManaModalOpen,
    setCastSpellModalOpen,
    setCounterDistributionModalData,
    setCounterDistributionModalOpen,
    setCounterMovementModalData,
    setCounterMovementModalOpen,
    setDiscardAnyNumber,
    setDiscardCount,
    setDiscardCurrentHandSize,
    setDiscardMaxCount,
    setDiscardMaxHandSize,
    setDiscardMinCount,
    setDiscardModalOpen,
    setDiscardResolutionDescription,
    setDiscardResolutionHand,
    setDiscardResolutionReason,
    setDiscardResolutionStepId,
    setDiscardResolutionTitle,
    setFightTargetModalData,
    setFightTargetModalOpen,
    setGraveyardSelectionModalData,
    setGraveyardSelectionModalOpen,
    setKynaiosChoiceModalOpen,
    setKynaiosChoiceRequest,
    setLifePaymentModalData,
    setLifePaymentModalOpen,
    setManaDistributionModalData,
    setManaDistributionModalOpen,
    setMayAbilityModalData,
    setMayAbilityModalOpen,
    setMulliganBottomCount,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setMutateModalData,
    setMutateModalOpen,
    setOpponentMayPayPrompt,
    setOpponentMayPayStepId,
    setOptionChoiceModalOpen,
    setOptionChoiceRequest,
    setPendingSpellXSelection,
    setPhyrexianManaModalData,
    setPhyrexianManaModalOpen,
    setReturnControlledPermanentData,
    setReturnControlledPermanentModalOpen,
    setSpellToCast,
    setStationCreatureSelectionData,
    setStationCreatureSelectionOpen,
    setTapUntapTargetModalData,
    setTapUntapTargetModalOpen,
    setTargetModalData,
    setTargetModalOpen,
    setTwoPileSplitModalOpen,
    setTwoPileSplitRequest,
    you,
  } = p;
