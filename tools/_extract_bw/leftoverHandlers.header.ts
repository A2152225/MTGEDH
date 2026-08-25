// Origin parent: client/src/App.tsx
// Cluster moved: leftover loop-shortcut create-game undo and socket effects
// Public entry symbols: useAppPlayLeftoverHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useState } from "react";
import type { BattlefieldPermanent } from "../../../shared/src";
import type { GameCreationConfig } from "../components/CreateGameModal";
import { socket } from "../socket";
import { canCreatureAttackNow } from "../utils/creatureUtils";
import { useAppLoopShortcutHandlers } from "./appLoopShortcutHandlers";
import { useAppPlaySocketEffects } from "./appPlaySocketEffects";

export function useAppPlayLeftoverHandlers(p: Record<string, any>) {
  const {
    activeResolutionPrompt,
    autoPassForTurn,
    autoPassSteps,
    availableUndoCount,
    combatModalOpen,
    combatModalReadOnly,
    combatMode,
    combatPreviewAttackTargets,
    connected,
    createGameModalOpen,
    hadPriorityRef,
    hasAutoSkippedAttackers,
    hasShownBlockersModal,
    lastCanRespond,
    lastCombatErrorSeenRef,
    lastError,
    lastPriorityStep,
    minimizedResolutionStep,
    myPendingResolutionCount,
    pendingTriggers,
    priority,
    safeView,
    setAiControlEnabled,
    setAiStrategy,
    setAvailableUndoCount,
    setCombatControlModalOpen,
    setCombatControlMode,
    setCombatModalError,
    setCombatModalMinimized,
    setCombatModalOpen,
    setCombatModalReadOnly,
    setCombatMode,
    setCombatPreviewAttackTargets,
    setDamageReplacementMode,
    setDeckValidation,
    setGameIdInput,
    setIgnoredCards,
    setIgnoredTriggerSources,
    setManaPool,
    setNameInUsePayload,
    setNameInput,
    setPriorityModalOpen,
    setReplacementEffectModalData,
    setReplacementEffectModalOpen,
    setSavedDecks,
    setShowNameInUseModal,
    setSmartUndoCounts,
    setUndoModalOpen,
    setUndoRequestData,
    setUndoTurnPhaseTargets,
    smartUndoCounts,
    undoRequestData,
    you,
  } = p;
