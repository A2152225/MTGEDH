// Origin parent: client/src/App.tsx
// Cluster moved: resolutionStepPrompt late branches (hideaway_choice through trigger_order).
// Public entry symbols: handleAppResolutionStepPromptLate.
// Leaf must not import App.tsx or App-handlers/index.ts.

import type { CastingMode } from "../components/CastingModeSelectionModal";
import type { JoinForcesRequest } from "../components/JoinForcesModal";
import type { SpellMode } from "../components/ModalSpellSelectionModal";
import type { TargetOption, TargetSelectionGroup } from "../components/TargetSelectionModal";
import type { TemptingOfferRequest } from "../components/TemptingOfferModal";
import type { TriggerPromptData } from "../components/TriggeredAbilityModal";
import { buildLibrarySearchModalStateFromStep } from "../utils/resolutionChoicePrimitives";
import { isResolutionStepMandatory } from "../utils/resolutionStepUtils";

export function handleAppResolutionStepPromptLate(
  step: any,
  payload: { gameId: string; step: any },
  p: Record<string, any>,
) {
  const {
    confirmId,
    resolutionPlayerNames,
    safeView,
    setAdditionalCostModalData,
    setAdditionalCostModalOpen,
    setBatchExploreIndividual,
    setBatchExplorePrompt,
    setCardNameChoiceModalData,
    setCardNameChoiceModalOpen,
    setCascadeModalOpen,
    setCascadePrompt,
    setCastingModeModalData,
    setCastingModeModalOpen,
    setClashData,
    setClashModalOpen,
    setColorChoiceModalData,
    setColorChoiceModalOpen,
    setCreatureTypeModalData,
    setCreatureTypeModalOpen,
    setDanceWithCalamityCastModalOpen,
    setDanceWithCalamityCastRequest,
    setDanceWithCalamityModalOpen,
    setDanceWithCalamityRequest,
    setExplorePrompt,
    setFatesealData,
    setFatesealModalOpen,
    setHideawayChoiceData,
    setHideawayChoiceModalOpen,
    setJoinForcesContributions,
    setJoinForcesModalOpen,
    setJoinForcesRequest,
    setJoinForcesResponded,
    setLibrarySearchData,
    setLibrarySearchModalOpen,
    setLifeRedistributionData,
    setLifeRedistributionModalOpen,
    setLimDulsVaultModalOpen,
    setLimDulsVaultRequest,
    setMayAbilityModalData,
    setMayAbilityModalOpen,
    setModalSpellModalData,
    setModalSpellModalOpen,
    setOpeningHandActionsModalOpen,
    setOpeningHandActionsStepId,
    setPeek,
    setPendingTriggers,
    setPonderModalOpen,
    setPonderRequest,
    setProliferateData,
    setProliferateModalOpen,
    setResolutionPlayerChoiceModalData,
    setResolutionPlayerChoiceModalOpen,
    setSquadCostModalData,
    setSquadCostModalOpen,
    setTargetModalData,
    setTargetModalOpen,
    setTemptingOfferAcceptedBy,
    setTemptingOfferModalOpen,
    setTemptingOfferRequest,
    setTemptingOfferResponded,
    setTriggerModalOpen,
    setTriggerOrderStepId,
    setVoteData,
    setVoteModalOpen,
    you,
  } = p;
  if (false) {
    /* seam so the extracted else-if chain stays byte-identical */
  }
