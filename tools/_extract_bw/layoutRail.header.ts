// Origin parent: client/src/App.tsx
// Cluster moved: utility rail and mobile dock
// Public entry symbols: renderAppPlayLayoutRail.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import { readPlayerLife, lifeTotalColor } from "../utils/gameDisplayHelpers";
import type { KnownCardRef, CardFace } from "../../../shared/src";
import { CardPreviewLayer, PreviewSizeControl } from "../components/CardPreviewLayer";
import { MobileActionDock } from "../components/MobileActionDock";
import { YourTurnBanner } from "../components/YourTurnBanner";
import { MobileHandStrip } from "../components/MobileHandStrip";
import { MobilePlaySheets } from "../components/MobilePlaySheets";
import { PhaseNavigator } from "../components/PhaseNavigator";
import { AutoPassSettingsPanel } from "../components/AutoPassSettingsPanel";
import { LoopShortcutPanel } from "../components/LoopShortcutPanel";
import { clampLoopShortcutIterations } from "../utils/loopShortcuts";

export function renderAppPlayLayoutRail(p: Record<string, any>) {
  const {
    allPlayersHaveDecks,
    allPlayersKeptHands,
    appearanceSettings,
    autoPassEmptyStackOnOpponentsTurn,
    autoPassForTurn,
    autoPassSteps,
    autoYesOptional,
    canPass,
    clearPlayerFocus,
    damageReplacementEffectActiveCount,
    damageReplacementMode,
    focusedPlayerId,
    handleClearAllAutoPass,
    handleClearLoopShortcut,
    handleDeckMgrOpenChange,
    handleDeleteSavedLoopShortcut,
    handleFocusPlayer,
    handleIgnoreTriggerSourceFromStack,
    handleLoadSavedLoopShortcut,
    handleRunLoopShortcut,
    handleSaveLoopShortcut,
    handleSelectAllAutoPass,
    handleStartLoopShortcutRecording,
    handleStopIgnoringSource,
    handleStopLoopShortcutRecording,
    handleToggleAutoPass,
    handleToggleAutoPassEmptyStackOnOpponentsTurn,
    handleToggleAutoPassForTurn,
    handleToggleAutoYesOptional,
    ignoredTriggerSources,
    imagePref,
    isLoopShortcutRecording,
    isLoopShortcutRunning,
    isPreGame,
    layout,
    leaveGame,
    loopShortcutItems,
    loopShortcutIterations,
    loopShortcutName,
    loopShortcutStatusText,
    manaPool,
    mobilePlayLayout,
    mobilePlaySheet,
    needsDeckImport,
    openSplitCardChoice,
    phaseAdvanceBlockReason,
    playLandWithPromptSync,
    playerFocusOrder,
    priority,
    reasonCannotCast,
    reasonCannotPlayLand,
    requestCastSpellWithPromptSync,
    safeView,
    savedLoopShortcuts,
    setDamageReplacementMode,
    setJoinCollapsed,
    setLoopShortcutIterations,
    setLoopShortcutName,
    setMobilePlaySheet,
    setPhaseNavigatorAdvancing,
    setReplacementEffectSettingsOpen,
    setShowLoopShortcutPanel,
    setShowTriggerShortcuts,
    setUtilityRailCollapsed,
    showExpandedUtilityRail,
    showLoopShortcutPanel,
    showMobileChrome,
    showUtilityRail,
    utilityRailCollapsed,
    view,
    you,
    yourHandCards,
    yourHandCount,
    yourTurnBannerVisible,
  } = p;
  return (
    <>
