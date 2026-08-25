// Origin parent: client/src/App.tsx
// Cluster moved: join/header/status column chrome
// Public entry symbols: renderAppPlayLayoutJoin.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import { ResolutionMinimizedChip, ResolutionPromptMinimizeButton } from "../components/ResolutionMinimizedChip";
import { SeatStrip } from "../components/SeatStrip";
import { GameStatusIndicator } from "../components/GameStatusIndicator";
import { DeckManagerModal } from "../components/DeckManagerModal";
import GameList from "../components/GameList";

export function renderAppPlayLayoutJoin(p: Record<string, any>) {
  const {
    activeResolutionPrompt,
    aiControlEnabled,
    aiStrategy,
    availableUndoCount,
    canKeepHand,
    canMulligan,
    canUnkeepHand,
    clearPlayerFocus,
    connected,
    effectiveGameId,
    fetchDebug,
    focusedPlayerId,
    gameIdInput,
    handleDeckMgrOpenChange,
    handleFocusPlayer,
    handleJoin,
    handleOpenUndoMenu,
    handleRequestUndo,
    handleRequestUndoTurnPhaseTargets,
    handleToggleAIControl,
    handleUndoToTurnPhase,
    hasKeptHand,
    isPreGame,
    isResolutionStepMinimized,
    isYouPlayer,
    joinCollapsed,
    joinFromList,
    leaveGame,
    minimizeResolutionStep,
    minimizedResolutionStep,
    missingImport,
    mulligansTaken,
    myPendingResolutionCount,
    nameInput,
    needsDeckImport,
    pendingBottomCount,
    pickRandomDeck,
    pickingRandomDeck,
    priority,
    randomDeckError,
    randomDeckMessage,
    restoreResolutionStep,
    safeView,
    scheduleResolutionPromptNudge,
    setAppearanceModalOpen,
    setCreateGameModalOpen,
    setDeckBuilderOpen,
    setGameIdInput,
    setJoinCollapsed,
    setMissingImport,
    setNameInput,
    setTableDeckMgrOpen,
    setTopDeckMgrAnchorEl,
    showMobileChrome,
    showTopPanelPregameActions,
    smartUndoCounts,
    textColors,
    undoTurnPhaseTargets,
    width,
    you,
    yourLibraryCount,
  } = p;
  return (
    <>
