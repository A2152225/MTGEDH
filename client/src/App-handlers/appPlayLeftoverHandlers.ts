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
  // Track when PhaseNavigator is actively advancing through phases
  // This prevents auto-advance from interfering with manual phase navigation
  const [phaseNavigatorAdvancing, setPhaseNavigatorAdvancing] = useState(false);

  // Trigger shortcuts panel state
  const [showTriggerShortcuts, setShowTriggerShortcuts] = useState(false);
  const {
    showLoopShortcutPanel,
    setShowLoopShortcutPanel,
    loopShortcutName,
    setLoopShortcutName,
    loopShortcutItems,
    savedLoopShortcuts,
    loopShortcutIterations,
    setLoopShortcutIterations,
    loopShortcutStatusText,
    setLoopShortcutStatusText,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    loopShortcutConsentPrompt,
    setLoopShortcutConsentPrompt,
    loopShortcutAwaitingConsent,
    refreshSavedDecks,
    handleStartLoopShortcutRecording,
    handleStopLoopShortcutRecording,
    handleClearLoopShortcut,
    handleSaveLoopShortcut,
    handleLoadSavedLoopShortcut,
    handleDeleteSavedLoopShortcut,
    handleRunLoopShortcut,
    stopLoopShortcutReplay,
    safeViewRef,
    youRef,
    loopShortcutItemsRef,
    isLoopShortcutRunningRef,
    lastResolutionStepsRef,
    loopShortcutReplayRef,
    loopAutoAnsweredStepIdsRef,
  } = useAppLoopShortcutHandlers({
    safeView,
    you,
    priority,
    lastError,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
    createGameModalOpen,
    setSavedDecks,
    setPriorityModalOpen,
  });

  // Handle game creation
  const handleCreateGame = (config: GameCreationConfig) => {
    if (config.includeAI && config.aiOpponents && config.aiOpponents.length > 0) {
      // Create game with multiple AI opponents
      socket.emit('createGameWithMultipleAI' as any, {
        gameId: config.gameId,
        playerName: config.playerName,
        format: config.format,
        startingLife: config.startingLife,
        seed: config.seed,
        aiOpponents: config.aiOpponents,
      });
    } else if (config.includeAI) {
      // Legacy: Create game with single AI opponent
      socket.emit('createGameWithAI' as any, {
        gameId: config.gameId,
        playerName: config.playerName,
        format: config.format,
        startingLife: config.startingLife,
        seed: config.seed,
        aiName: config.aiName,
        aiDifficulty: config.aiDifficulty,
        aiDeckId: config.aiDeckId,
        aiDeckText: config.aiDeckText,
        aiDeckName: config.aiDeckName,
      });
    } else {
      // Create game without AI (human players only)
      socket.emit('createGame' as any, {
        gameId: config.gameId,
        format: config.format,
        startingLife: config.startingLife,
        seed: config.seed,
      });
    }
    
    // Update the input fields and join the game
    setGameIdInput(config.gameId);
    setNameInput(config.playerName);
    
    // Join the game after a short delay to allow server processing
    setTimeout(() => {
      socket.emit('joinGame', {
        gameId: config.gameId,
        playerName: config.playerName,
        spectator: false,
      });
      
      // If house rules are configured, send them after joining
      if (config.houseRules && Object.keys(config.houseRules).length > 0) {
        setTimeout(() => {
          socket.emit('setHouseRules' as any, {
            gameId: config.gameId,
            houseRules: config.houseRules,
          });
        }, 200);
      }
    }, 100);
  };

  const canCreatureAttack = (perm: BattlefieldPermanent): boolean => {
    return canCreatureAttackNow(perm, safeView?.battlefield || []);
  };

  useAppPlaySocketEffects({
    safeView,
    you,
    canCreatureAttack,
    myPendingResolutionCount,
    activeResolutionPrompt,
    minimizedResolutionStep,
    combatPreviewAttackTargets,
    combatMode,
    combatModalOpen,
    combatModalReadOnly,
    lastError,
    lastCombatErrorSeenRef,
    hasAutoSkippedAttackers,
    hasShownBlockersModal,
    lastPriorityStep,
    hadPriorityRef,
    lastCanRespond,
    autoPassSteps,
    autoPassForTurn,
    phaseNavigatorAdvancing,
    pendingTriggers,
    undoRequestData,
    connected,
    setNameInUsePayload,
    setShowNameInUseModal,
    setCombatControlMode,
    setCombatControlModalOpen,
    setCombatModalOpen,
    setCombatModalError,
    setCombatModalReadOnly,
    setCombatModalMinimized,
    setCombatMode,
    setCombatPreviewAttackTargets,
    setPriorityModalOpen,
    setIgnoredTriggerSources,
    setDeckValidation,
    setIgnoredCards,
    setDamageReplacementMode,
    setReplacementEffectModalOpen,
    setReplacementEffectModalData,
    setManaPool,
    setUndoRequestData,
    setUndoModalOpen,
    setAvailableUndoCount,
    setUndoTurnPhaseTargets,
    setSmartUndoCounts,
    setAiControlEnabled,
    setAiStrategy,
  });

  // Handler to toggle AI control
  const handleToggleAIControl = React.useCallback((enable: boolean, difficulty?: number) => {
    if (!safeView?.id) return;
    
    socket.emit("toggleAIControl", {
      gameId: safeView.id,
      enable,
      difficulty: difficulty ?? 0.5,
    });
  }, [safeView?.id]);

  // Request total undo count on game state changes (no polling to reduce overhead)
  React.useEffect(() => {
    if (!safeView?.id) return;
    
    // Request only the cheap total count here. Smart counts are computed on demand.
    socket.emit("getUndoCount", { gameId: safeView.id });
  }, [safeView]);

  React.useEffect(() => {
    if (!safeView?.id) return;
    if (availableUndoCount <= 0) return;
    if ((smartUndoCounts.stepCount || 0) > 0 || (smartUndoCounts.phaseCount || 0) > 0 || (smartUndoCounts.previousPhaseCount || 0) > 0 || (smartUndoCounts.turnCount || 0) > 0) {
      return;
    }
    socket.emit("getSmartUndoCounts", { gameId: safeView.id });
  }, [availableUndoCount, safeView?.id, smartUndoCounts.phaseCount, smartUndoCounts.previousPhaseCount, smartUndoCounts.stepCount, smartUndoCounts.turnCount]);

  const handleOpenUndoMenu = React.useCallback(() => {
    if (!safeView?.id) return;
    socket.emit("getSmartUndoCounts", { gameId: safeView.id });
  }, [safeView?.id]);

  const handleRequestUndoTurnPhaseTargets = React.useCallback(() => {
    if (!safeView?.id) return;
    socket.emit("getUndoTurnPhaseTargets", { gameId: safeView.id, includeSteps: true });
  }, [safeView?.id]);

  const handleUndoToTurnPhase = React.useCallback((target: { turnNumber?: number; phase: string; step?: string }) => {
    if (!safeView?.id || !target?.phase) return;
    socket.emit("requestUndoToTurnPhase", {
      gameId: safeView.id,
      turnNumber: target.turnNumber,
      phase: target.phase,
      step: target.step,
    });
  }, [safeView?.id]);

  return {
    phaseNavigatorAdvancing,
    setPhaseNavigatorAdvancing,
    showTriggerShortcuts,
    setShowTriggerShortcuts,
    showLoopShortcutPanel,
    setShowLoopShortcutPanel,
    loopShortcutName,
    setLoopShortcutName,
    loopShortcutItems,
    savedLoopShortcuts,
    loopShortcutIterations,
    setLoopShortcutIterations,
    loopShortcutStatusText,
    setLoopShortcutStatusText,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    loopShortcutConsentPrompt,
    setLoopShortcutConsentPrompt,
    loopShortcutAwaitingConsent,
    refreshSavedDecks,
    handleStartLoopShortcutRecording,
    handleStopLoopShortcutRecording,
    handleClearLoopShortcut,
    handleSaveLoopShortcut,
    handleLoadSavedLoopShortcut,
    handleDeleteSavedLoopShortcut,
    handleRunLoopShortcut,
    stopLoopShortcutReplay,
    safeViewRef,
    youRef,
    loopShortcutItemsRef,
    isLoopShortcutRunningRef,
    lastResolutionStepsRef,
    loopShortcutReplayRef,
    loopAutoAnsweredStepIdsRef,
    handleCreateGame,
    canCreatureAttack,
    handleToggleAIControl,
    handleOpenUndoMenu,
    handleRequestUndoTurnPhaseTargets,
    handleUndoToTurnPhase,
  };
}
