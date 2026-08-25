// Origin parent: client/src/App.tsx
// Cluster moved: join-forces through may-auto overlays
// Public entry symbols: renderAppPlayOverlaysLate.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo } from "react";
import { socket } from "../socket";
import { DraggableSettingsPanel } from "../components/DraggableSettingsPanel";
import { ReplacementEffectSettingsPanel } from "../components/ReplacementEffectSettingsPanel";
import { JoinForcesModal } from "../components/JoinForcesModal";
import { TemptingOfferModal } from "../components/TemptingOfferModal";
import { KynaiosChoiceModal } from "../components/KynaiosChoiceModal";
import { OptionChoiceModal } from "../components/OptionChoiceModal";
import { TwoPileSplitModal } from "../components/TwoPileSplitModal";
import { PonderModal } from "../components/PonderModal";
import { DanceWithCalamityCastModal, DanceWithCalamityModal } from "../components/DanceWithCalamityModal";
import { LimDulsVaultModal } from "../components/LimDulsVaultModal";
import { CascadeModal } from "../components/CascadeModal";
import { MutateTargetModal } from "../components/MutateTargetModal";
import { GraveyardSelectionModal } from "../components/GraveyardSelectionModal";
import { IgnoredCardsPanel } from "../components/IgnoredCardsPanel";
import { GameCommunicationsPanel } from "../components/GameCommunicationsPanel";
import { IgnoredTriggersPanel } from "../components/IgnoredTriggersPanel";
import { MayAutoPreferencesPanel } from "../components/MayAutoPreferencesPanel";
import { PriorityModal } from "../components/PriorityModal";
import { AutoPassSettingsPanel } from "../components/AutoPassSettingsPanel";
import { TriggerShortcutsPanel } from "../components/TriggerShortcutsPanel";
import { LoopShortcutPanel } from "../components/LoopShortcutPanel";
import { clampLoopShortcutIterations } from "../utils/loopShortcuts";

export function renderAppPlayOverlaysLate(p: Record<string, any>) {
  const {
    appearanceSettings,
    autoPassEmptyStackOnOpponentsTurn,
    autoPassForTurn,
    autoPassSteps,
    cascadeModalOpen,
    cascadePrompt,
    chat,
    danceWithCalamityCastModalOpen,
    danceWithCalamityCastRequest,
    danceWithCalamityModalOpen,
    danceWithCalamityRequest,
    deckValidation,
    gameLogEntries,
    graveyardSelectionModalData,
    graveyardSelectionModalOpen,
    handleClearAllAutoPass,
    handleClearLoopShortcut,
    handleDeleteSavedLoopShortcut,
    handleJoinForcesContribute,
    handleKynaiosChoiceRespond,
    handleLoadSavedLoopShortcut,
    handleOptionChoiceRespond,
    handleRunLoopShortcut,
    handleSaveLoopShortcut,
    handleSelectAllAutoPass,
    handleStartLoopShortcutRecording,
    handleStopIgnoringSource,
    handleStopLoopShortcutRecording,
    handleTemptingOfferRespond,
    handleToggleAutoPass,
    handleToggleAutoPassEmptyStackOnOpponentsTurn,
    handleToggleAutoPassForTurn,
    ignoredCards,
    ignoredTriggerSources,
    imagePref,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    isPreGame,
    joinForcesContributions,
    joinForcesModalOpen,
    joinForcesRequest,
    joinForcesResponded,
    kynaiosChoiceModalOpen,
    kynaiosChoiceRequest,
    layout,
    limDulsVaultModalOpen,
    limDulsVaultRequest,
    loopShortcutItems,
    loopShortcutIterations,
    loopShortcutName,
    loopShortcutStatusText,
    mayAutoPreferenceEntries,
    minimizeResolutionStep,
    mobilePlayLayout,
    mutateModalData,
    mutateModalOpen,
    optionChoiceModalOpen,
    optionChoiceRequest,
    ponderModalOpen,
    ponderRequest,
    priority,
    priorityModalOpen,
    replacementEffectSettingsOpen,
    resolutionPromptOpen,
    resolvePlayerName,
    safeView,
    savedLoopShortcuts,
    sendChat,
    setCascadeModalOpen,
    setCascadePrompt,
    setDanceWithCalamityCastModalOpen,
    setDanceWithCalamityCastRequest,
    setDanceWithCalamityModalOpen,
    setDanceWithCalamityRequest,
    setDeckValidation,
    setGraveyardSelectionModalData,
    setGraveyardSelectionModalOpen,
    setJoinForcesModalOpen,
    setLimDulsVaultModalOpen,
    setLimDulsVaultRequest,
    setLoopShortcutIterations,
    setLoopShortcutName,
    setMutateModalData,
    setMutateModalOpen,
    setPonderModalOpen,
    setPonderRequest,
    setPriorityModalOpen,
    setReplacementEffectSettingsOpen,
    setShowLoopShortcutPanel,
    setShowTriggerShortcuts,
    setTemptingOfferModalOpen,
    setTwoPileSplitModalOpen,
    setTwoPileSplitRequest,
    showLoopShortcutPanel,
    showMobileChrome,
    showTriggerShortcuts,
    showUtilityRail,
    temptingOfferAcceptedBy,
    temptingOfferModalOpen,
    temptingOfferRequest,
    temptingOfferResponded,
    twoPileSplitModalOpen,
    twoPileSplitRequest,
    you,
  } = p;
  return (
    <>
