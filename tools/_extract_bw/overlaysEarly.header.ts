// Origin parent: client/src/App.tsx
// Cluster moved: early play overlays (PhaseNavigator through player-choice modal).
// Public entry symbols: renderAppPlayOverlaysEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import { socket } from "../socket";
import { PhaseNavigator } from "../components/PhaseNavigator";
import { CommanderSelectModal } from "../components/CommanderSelectModal";
import CommanderConfirmModal from "../components/CommanderConfirmModal";
import { ScrySurveilModal } from "../components/ScrySurveilModal";
import { ExploreModal } from "../components/ExploreModal";
import { BatchExploreModal } from "../components/BatchExploreModal";
import { OpponentMayPayModal } from "../components/OpponentMayPayModal";
import { LoopShortcutConsentModal } from "../components/LoopShortcutConsentModal";
import { TapUntapTargetModal } from "../components/TapUntapTargetModal";
import { CounterMovementModal } from "../components/CounterMovementModal";
import { StationCreatureSelectionModal } from "../components/StationCreatureSelectionModal";
import { PlayerTargetSelectionModal } from "../components/PlayerTargetSelectionModal";

export function renderAppPlayOverlaysEarly(p: Record<string, any>) {
  const {
    allPlayersHaveDecks,
    allPlayersKeptHands,
    batchExploreIndividual,
    batchExplorePrompt,
    cmdModalOpen,
    cmdSuggestedGameId,
    cmdSuggestedNames,
    confirmOpen,
    confirmPayload,
    confirmVotes,
    counterMovementModalData,
    counterMovementModalOpen,
    damageReplacementEffectActiveCount,
    damageReplacementMode,
    setDamageReplacementMode,
    setReplacementEffectSettingsOpen,
    debugData,
    debugLoading,
    debugOpen,
    effectiveGameId,
    explorePrompt,
    fetchDebug,
    fightTargetModalData,
    fightTargetModalOpen,
    handleCommanderConfirm,
    imagePref,
    importedCandidates,
    loopShortcutConsentPrompt,
    opponentMayPayPrompt,
    opponentMayPayStepId,
    peek,
    phaseAdvanceBlockReason,
    priority,
    resolutionPlayerChoiceModalData,
    resolutionPlayerChoiceModalOpen,
    resolutionPlayerNames,
    resolutionPromptOpen,
    respondToConfirm,
    safeView,
    setBatchExploreIndividual,
    setBatchExplorePrompt,
    setCmdModalOpen,
    setCounterMovementModalData,
    setCounterMovementModalOpen,
    setDebugOpen,
    setExplorePrompt,
    setFightTargetModalData,
    setFightTargetModalOpen,
    setLoopShortcutConsentPrompt,
    setOpponentMayPayPrompt,
    setOpponentMayPayStepId,
    setPeek,
    setPhaseNavigatorAdvancing,
    setResolutionPlayerChoiceModalData,
    setResolutionPlayerChoiceModalOpen,
    setStationCreatureSelectionData,
    setStationCreatureSelectionOpen,
    setTapUntapTargetModalData,
    setTapUntapTargetModalOpen,
    showCommanderGallery,
    showMobileChrome,
    showUtilityRail,
    stationCreatureSelectionData,
    stationCreatureSelectionOpen,
    tapUntapTargetModalData,
    tapUntapTargetModalOpen,
    view,
    you,
  } = p;
  return (
    <>
