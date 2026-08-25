// Origin parent: client/src/App.tsx
// Cluster moved: cast/combat/resolution modal confirm handlers (handleCastSpellConfirm through playLandWithPromptSync)
// Public entry symbols: useAppPlayModalHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React from "react";
import type { PaymentItem } from "../../../shared/src";
import type { CombatControlDeclarations } from "../components/CombatControlModal";
import type { AttackerSelection, BlockerSelection } from "../components/CombatSelectionModal";
import { socket } from "../socket";
import { debug } from "../utils/debug";

export function useAppPlayModalHandlers(p: Record<string, any>) {
  const {
    clashData,
    combatControlMode,
    combatMode,
    fatesealData,
    hideawayChoiceData,
    ignoredTriggerSources,
    librarySearchData,
    lifeRedistributionData,
    openingHandActionsStepId,
    proliferateData,
    returnControlledPermanentData,
    safeView,
    setCastSpellModalOpen,
    setClashData,
    setClashModalOpen,
    setCombatControlModalOpen,
    setCombatModalError,
    setCombatModalMinimized,
    setFatesealData,
    setFatesealModalOpen,
    setHideawayChoiceData,
    setHideawayChoiceModalOpen,
    setIgnoredTriggerSources,
    setLibrarySearchData,
    setLibrarySearchModalOpen,
    setLifeRedistributionData,
    setLifeRedistributionModalOpen,
    setOpeningHandActionsModalOpen,
    setOpeningHandActionsStepId,
    setPendingTriggers,
    setProliferateData,
    setProliferateModalOpen,
    setReturnControlledPermanentData,
    setReturnControlledPermanentModalOpen,
    setSpellToCast,
    setTargetModalData,
    setTargetModalOpen,
    setTriggerModalOpen,
    setTriggerOrderStepId,
    setUndoModalOpen,
    setUndoRequestData,
    setVoteData,
    setVoteModalOpen,
    spellToCast,
    targetModalData,
    triggerOrderStepId,
    undoRequestData,
    voteData,
  } = p;
