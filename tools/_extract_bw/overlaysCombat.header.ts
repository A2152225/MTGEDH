// Origin parent: client/src/App.tsx
// Cluster moved: name-in-use through game-over overlays
// Public entry symbols: renderAppPlayOverlaysCombat.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import type { BattlefieldPermanent, PlayerRef } from "../../../shared/src";
import { debug } from "../utils/debug";
import { FatesealModal } from "../components/FatesealModal";
import { ClashModal } from "../components/ClashModal";
import { VoteModal } from "../components/VoteModal";
import { CastSpellModal } from "../components/CastSpellModal";
import { CombatSelectionModal } from "../components/CombatSelectionModal";
import { CombatControlModal } from "../components/CombatControlModal";
import { ReturnControlledPermanentChoiceModal } from "../components/ReturnControlledPermanentChoiceModal";
import { CardSelectionModal } from "../components/CardSelectionModal";
import { ProliferateModal } from "../components/ProliferateModal";
import { LifeRedistributionModal } from "../components/LifeRedistributionModal";
import { AppearanceSettingsModal } from "../components/AppearanceSettingsModal";
import { XValueSelectionModal } from "../components/XValueSelectionModal";
import { CreateGameModal } from "../components/CreateGameModal";
import { DeckManagerModal } from "../components/DeckManagerModal";
import NameInUseModal from "../components/NameInUseModal";

export function renderAppPlayOverlaysCombat(p: Record<string, any>) {
  const {
    appearanceModalOpen,
    attackingCreatures,
    castSpellModalOpen,
    castSpellPaymentSources,
    clashData,
    clashModalOpen,
    combatControlEffect,
    combatControlModalOpen,
    combatControlMode,
    combatModalAttackersAvailableCreatures,
    combatModalAttackersDefenders,
    combatModalError,
    combatModalInitialAttackTargets,
    combatModalMinimized,
    combatModalOpen,
    combatModalReadOnly,
    combatMode,
    combatPreviewAttackTargets,
    combatPreviewEmitTimerRef,
    combatPreviewPendingRef,
    createGameModalOpen,
    deckBuilderInitialAction,
    deckBuilderOpen,
    defenderInfoMap,
    defenders,
    fatesealData,
    fatesealModalOpen,
    gameIdInput,
    gameOverData,
    gameOverModalOpen,
    handleAppearanceSettingsApply,
    handleCastSpellCancel,
    handleCastSpellConfirm,
    handleClashConfirm,
    handleCreateGame,
    handleDeclareAttackers,
    handleDeclareBlockers,
    handleDeclareControlledCombat,
    handleFatesealConfirm,
    handleHideawayChoiceCancel,
    handleHideawayChoiceConfirm,
    handleLifeRedistributionConfirm,
    handleProliferateConfirm,
    handleReturnControlledPermanentSelect,
    handleSkipCombat,
    handleVoteConfirm,
    hideawayChoiceData,
    hideawayChoiceModalOpen,
    imagePref,
    lifeRedistributionData,
    lifeRedistributionModalOpen,
    manaPool,
    myBlockerCreatures,
    myCreatures,
    nameInUsePayload,
    nameInput,
    pendingSpellXSelection,
    proliferateData,
    proliferateModalOpen,
    refreshSavedDecks,
    resolutionPromptOpen,
    returnControlledPermanentData,
    returnControlledPermanentModalOpen,
    safeView,
    savedDecks,
    setAppearanceModalOpen,
    setCombatModalMinimized,
    setCreateGameModalOpen,
    setDeckBuilderInitialAction,
    setDeckBuilderOpen,
    setFatesealData,
    setFatesealModalOpen,
    setNameInUsePayload,
    setNameInput,
    setPendingSpellXSelection,
    setShowNameInUseModal,
    showNameInUseModal,
    spellToCast,
    view,
    voteData,
    voteModalOpen,
    you,
  } = p;
  return (
    <>
