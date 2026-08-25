// Origin parent: client/src/App.tsx
// Cluster moved: leftover derived effects and memos
// Public entry symbols: useAppPlayDerivedEffects.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useEffect, useMemo } from "react";
import type { BattlefieldPermanent, ChatMsg, KnownCardRef } from "../../../shared/src";
import { useGameStateLog } from "../hooks/useGameStateLog";
import { useRandomDeckPicker } from "../hooks/useRandomDeckPicker";
import { socket } from "../socket";
import { toast } from "../components/ToastHost";
import { isLandTypeLine, prettyPhase, prettyStep } from "../utils/gameDisplayHelpers";
import { buildAvailableManaSourcesForPlayer } from "../utils/manaSourceBuilder";

export function useAppPlayDerivedEffects(p: Record<string, any>) {
  const {
    autoAdvancePhases,
    batchExplorePrompt,
    chat,
    cmdModalOpen,
    cmdSuggestedGameId,
    discardCount,
    discardModalOpen,
    explorePrompt,
    gameIdInput,
    hasPromptedDeckImport,
    importedCandidates,
    layout,
    mobilePlayLayout,
    mulliganBottomLastSubmittedStepId,
    mulliganBottomModalOpen,
    peek,
    phaseNavigatorAdvancing,
    previousTurnRef,
    priority,
    requestImportDeck,
    requestUseSavedDeck,
    safeView,
    setChat,
    setFocusedPlayerId,
    setGameOverData,
    setGameOverModalOpen,
    setJoinCollapsed,
    setMobilePlaySheet,
    setMulliganBottomCount,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setPeek,
    setShowDeckImportPrompt,
    setTableDeckMgrOpen,
    setYourTurnBannerVisible,
    showDeckImportPrompt,
    utilityRailCollapsed,
    view,
    viewportWidth,
    you,
    yourTurnBannerVisible,
  } = p;
