// Origin parent: client/src/App.tsx
// Cluster moved: dismissResolutionStepUi callback (clears resolution-prompt modal state).
// Public entry symbols: useAppDismissResolutionStepUi.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";

export function useAppDismissResolutionStepUi(p: Record<string, any>) {
  const {
    setActiveResolutionPrompt,
    setAdditionalCostModalOpen,
    setAnyColorManaModalOpen,
    setCardNameChoiceModalOpen,
    setCascadeModalOpen,
    setCascadePrompt,
    setCastSpellModalOpen,
    setCastingModeModalOpen,
    setClashModalOpen,
    setColorChoiceModalOpen,
    setCounterMovementModalOpen,
    setCreatureTypeModalOpen,
    setDanceWithCalamityCastModalOpen,
    setDanceWithCalamityCastRequest,
    setDanceWithCalamityModalOpen,
    setDanceWithCalamityRequest,
    setDiscardCount,
    setDiscardCurrentHandSize,
    setDiscardMaxHandSize,
    setDiscardModalOpen,
    setDiscardResolutionDescription,
    setDiscardResolutionHand,
    setDiscardResolutionReason,
    setDiscardResolutionStepId,
    setDiscardResolutionTitle,
    setExplorePrompt,
    setBatchExploreIndividual,
    setBatchExplorePrompt,
    setFatesealModalOpen,
    setFightTargetModalOpen,
    setGraveyardSelectionModalOpen,
    setHideawayChoiceModalOpen,
    setJoinForcesModalOpen,
    setKynaiosChoiceModalOpen,
    setLibrarySearchModalOpen,
    setLifePaymentModalOpen,
    setLifeRedistributionData,
    setLifeRedistributionModalOpen,
    setLimDulsVaultModalOpen,
    setLimDulsVaultRequest,
    setManaDistributionModalOpen,
    setMayAbilityModalOpen,
    setMinimizedResolutionStep,
    setModalSpellModalOpen,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setMutateModalOpen,
    setOpeningHandActionsModalOpen,
    setOpeningHandActionsStepId,
    setOpponentMayPayPrompt,
    setOpponentMayPayStepId,
    setOptionChoiceModalOpen,
    setPeek,
    setPendingSpellXSelection,
    setPendingTriggers,
    setPhyrexianManaModalOpen,
    setPonderModalOpen,
    setPonderRequest,
    setProliferateModalOpen,
    setReplacementEffectModalOpen,
    setResolutionPlayerChoiceModalOpen,
    setReturnControlledPermanentModalOpen,
    setSpellToCast,
    setSquadCostModalOpen,
    setStationCreatureSelectionOpen,
    setTapUntapTargetModalOpen,
    setTargetModalOpen,
    setTemptingOfferModalOpen,
    setTriggerModalOpen,
    setTriggerOrderStepId,
    setTwoPileSplitModalOpen,
    setVoteModalOpen,
  } = p;
  const dismissResolutionStepUi = React.useCallback(() => {
    setReturnControlledPermanentModalOpen(false);
    setHideawayChoiceModalOpen(false);
    setProliferateModalOpen(false);
    setLifeRedistributionModalOpen(false);
    setLifeRedistributionData(null);
    setFatesealModalOpen(false);
    setClashModalOpen(false);
    setVoteModalOpen(false);
    setTriggerModalOpen(false);
    setPendingTriggers([]);
    setTriggerOrderStepId(null);
    setMulliganBottomModalOpen(false);
    setMulliganBottomStepId(null);
    setDiscardModalOpen(false);
    setDiscardCount(0);
    setDiscardMaxHandSize(7);
    setDiscardCurrentHandSize(null);
    setDiscardResolutionStepId(null);
    setDiscardResolutionReason('cleanup');
    setDiscardResolutionTitle(null);
    setDiscardResolutionDescription(null);
    setDiscardResolutionHand([]);
    setOpeningHandActionsModalOpen(false);
    setOpeningHandActionsStepId(null);
    setLibrarySearchModalOpen(false);
    setTargetModalOpen(false);
    setCreatureTypeModalOpen(false);
    setJoinForcesModalOpen(false);
    setTemptingOfferModalOpen(false);
    setKynaiosChoiceModalOpen(false);
    setOptionChoiceModalOpen(false);
    setTwoPileSplitModalOpen(false);
    setPonderModalOpen(false);
    setPonderRequest(null);
    setLimDulsVaultModalOpen(false);
    setLimDulsVaultRequest(null);
    setDanceWithCalamityModalOpen(false);
    setDanceWithCalamityRequest(null);
    setDanceWithCalamityCastModalOpen(false);
    setDanceWithCalamityCastRequest(null);
    setCascadeModalOpen(false);
    setCascadePrompt(null);
    setTapUntapTargetModalOpen(false);
    setFightTargetModalOpen(false);
    setCounterMovementModalOpen(false);
    setStationCreatureSelectionOpen(false);
    setResolutionPlayerChoiceModalOpen(false);
    setManaDistributionModalOpen(false);
    setAdditionalCostModalOpen(false);
    setSquadCostModalOpen(false);
    setCastingModeModalOpen(false);
    setMayAbilityModalOpen(false);
    setLifePaymentModalOpen(false);
    setColorChoiceModalOpen(false);
    setCardNameChoiceModalOpen(false);
    setAnyColorManaModalOpen(false);
    setPhyrexianManaModalOpen(false);
    setModalSpellModalOpen(false);
    setReplacementEffectModalOpen(false);
    setMutateModalOpen(false);
    setGraveyardSelectionModalOpen(false);
    setMinimizedResolutionStep(null);
    setActiveResolutionPrompt(null);
    // Spell payment modal is opened from mana_payment_choice prompts; always clear it
    // when the resolution queue is dismissed so loop replay cannot leave it stuck open.
    setCastSpellModalOpen(false);
    setSpellToCast(null);
    // Scry/surveil/bottom-order live in `peek`, not a *ModalOpen flag.
    setPeek(null);
    setExplorePrompt(null);
    setBatchExplorePrompt(null);
    setBatchExploreIndividual(null);
    setOpponentMayPayPrompt(null);
    setOpponentMayPayStepId(null);
    setPendingSpellXSelection(null);
  }, []);


  return { dismissResolutionStepUi };
}
