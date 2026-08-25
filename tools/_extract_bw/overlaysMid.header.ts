// Origin parent: client/src/App.tsx
// Cluster moved: mana-distribution through exile overlays
// Public entry symbols: renderAppPlayOverlaysMid.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import type { KnownCardRef } from "../../../shared/src";
import { ManaDistributionModal } from "../components/ManaDistributionModal";
import { CounterDistributionModal } from "../components/CounterDistributionModal";
import { AdditionalCostModal } from "../components/AdditionalCostModal";
import { SquadCostModal } from "../components/SquadCostModal";
import { CastingModeSelectionModal } from "../components/CastingModeSelectionModal";
import { ModalSpellSelectionModal } from "../components/ModalSpellSelectionModal";
import { ReplacementEffectOrderModal } from "../components/ReplacementEffectOrderModal";
import { GraveyardViewModal } from "../components/GraveyardViewModal";
import { ExileViewModal } from "../components/ExileViewModal";
import { MayAbilityModal } from "../components/MayAbilityModal";

export function renderAppPlayOverlaysMid(p: Record<string, any>) {
  const {
    additionalCostModalData,
    additionalCostModalOpen,
    appearanceSettings,
    castingModeModalData,
    castingModeModalOpen,
    counterDistributionModalData,
    counterDistributionModalOpen,
    exileModalOpen,
    exileModalPlayerId,
    graveyardModalOpen,
    graveyardModalPlayerId,
    handleExileAbility,
    handleGraveyardAbility,
    ignoredCardIds,
    manaDistributionModalData,
    manaDistributionModalOpen,
    manaPool,
    mayAbilityModalData,
    mayAbilityModalOpen,
    minimizeResolutionStep,
    modalSpellModalData,
    modalSpellModalOpen,
    replacementEffectModalData,
    replacementEffectModalOpen,
    resolutionPromptOpen,
    safeView,
    setAdditionalCostModalData,
    setAdditionalCostModalOpen,
    setCastingModeModalData,
    setCastingModeModalOpen,
    setCounterDistributionModalData,
    setCounterDistributionModalOpen,
    setExileModalOpen,
    setExileModalPlayerId,
    setGraveyardModalOpen,
    setGraveyardModalPlayerId,
    setManaDistributionModalData,
    setManaDistributionModalOpen,
    setMayAbilityModalData,
    setMayAbilityModalOpen,
    setMinimizedResolutionStep,
    setModalSpellModalData,
    setModalSpellModalOpen,
    setReplacementEffectModalData,
    setReplacementEffectModalOpen,
    setSquadCostModalData,
    setSquadCostModalOpen,
    squadCostModalData,
    squadCostModalOpen,
    you,
  } = p;
  return (
    <>
