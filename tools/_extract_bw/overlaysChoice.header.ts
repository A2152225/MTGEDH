// Origin parent: client/src/App.tsx
// Cluster moved: triggered-ability through phyrexian-mana overlays
// Public entry symbols: renderAppPlayOverlaysChoice.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import type { KnownCardRef } from "../../../shared/src";
import { TriggeredAbilityModal } from "../components/TriggeredAbilityModal";
import { MulliganBottomModal } from "../components/MulliganBottomModal";
import { DiscardSelectionModal } from "../components/DiscardSelectionModal";
import { OpeningHandActionsModal } from "../components/OpeningHandActionsModal";
import { LibrarySearchModal } from "../components/LibrarySearchModal";
import { TargetSelectionModal } from "../components/TargetSelectionModal";
import { UndoRequestModal } from "../components/UndoRequestModal";
import { SplitCardChoiceModal } from "../components/SplitCardChoiceModal";
import { CreatureTypeSelectModal } from "../components/CreatureTypeSelectModal";
import { LifePaymentModal } from "../components/LifePaymentModal";
import { ColorChoiceModal } from "../components/ColorChoiceModal";
import { CardNameChoiceModal } from "../components/CardNameChoiceModal";
import { AnyColorManaModal } from "../components/AnyColorManaModal";
import { PhyrexianManaChoiceModal } from "../components/PhyrexianManaChoiceModal";

export function renderAppPlayOverlaysChoice(p: Record<string, any>) {
  const {
    anyColorManaModalData,
    anyColorManaModalOpen,
    cardNameChoiceModalData,
    cardNameChoiceModalOpen,
    colorChoiceModalData,
    colorChoiceModalOpen,
    confirmId,
    creatureTypeModalData,
    creatureTypeModalOpen,
    discardAnyNumber,
    discardCount,
    discardCurrentHandSize,
    discardMaxCount,
    discardMaxHandSize,
    discardMinCount,
    discardModalOpen,
    discardResolutionDescription,
    discardResolutionHand,
    discardResolutionReason,
    discardResolutionStepId,
    discardResolutionTitle,
    handleLibrarySearchCancel,
    handleLibrarySearchCastWhileSearching,
    handleLibrarySearchConfirm,
    handleOpeningHandActionsConfirm,
    handleOpeningHandActionsSkip,
    handleOrderTriggersConfirm,
    handleSplitCardCancel,
    handleSplitCardChoose,
    handleTargetCancel,
    handleTargetConfirm,
    handleUndoApprove,
    handleUndoCancel,
    handleUndoReject,
    layout,
    librarySearchData,
    librarySearchModalOpen,
    lifePaymentModalData,
    lifePaymentModalOpen,
    mulliganBottomCount,
    mulliganBottomModalOpen,
    mulliganBottomStepId,
    openingHandActionsModalOpen,
    openingHandActionsStepId,
    pendingTriggers,
    phyrexianManaModalData,
    phyrexianManaModalOpen,
    resolutionPromptOpen,
    safeView,
    setAnyColorManaModalData,
    setAnyColorManaModalOpen,
    setCardNameChoiceModalData,
    setCardNameChoiceModalOpen,
    setColorChoiceModalData,
    setColorChoiceModalOpen,
    setCreatureTypeModalData,
    setCreatureTypeModalOpen,
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
    setLifePaymentModalData,
    setLifePaymentModalOpen,
    setMulliganBottomCount,
    setMulliganBottomLastSubmittedStepId,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setPhyrexianManaModalData,
    setPhyrexianManaModalOpen,
    splitCardData,
    splitCardModalOpen,
    targetModalData,
    targetModalOpen,
    triggerModalOpen,
    triggerOrderStepId,
    undoModalOpen,
    undoRequestData,
    you,
  } = p;
  return (
    <>
