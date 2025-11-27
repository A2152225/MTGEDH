import React, { useMemo, useState, useEffect } from "react";
import { socket } from "./socket";
import type {
  ClientGameView,
  PlayerID,
  KnownCardRef,
  ChatMsg,
  BattlefieldPermanent,
  CardRef,
  CardFace,
} from "../../shared/src";
import { TableLayout } from "./components/TableLayout";
import { CardPreviewLayer } from "./components/CardPreviewLayer";
import CommanderConfirmModal from "./components/CommanderConfirmModal";
import { CommanderSelectModal } from "./components/CommanderSelectModal";
import NameInUseModal from "./components/NameInUseModal";
import { ZonesPanel } from "./components/ZonesPanel";
import { ScrySurveilModal } from "./components/ScrySurveilModal";
import { CastSpellModal } from "./components/CastSpellModal";
import { CombatSelectionModal, type AttackerSelection, type BlockerSelection } from "./components/CombatSelectionModal";
import { ShockLandChoiceModal } from "./components/ShockLandChoiceModal";
import { BounceLandChoiceModal } from "./components/BounceLandChoiceModal";
import { TriggeredAbilityModal, type TriggerPromptData } from "./components/TriggeredAbilityModal";
import { MulliganBottomModal } from "./components/MulliganBottomModal";
import { DiscardSelectionModal } from "./components/DiscardSelectionModal";
import { OpeningHandActionsModal } from "./components/OpeningHandActionsModal";
import { LibrarySearchModal } from "./components/LibrarySearchModal";
import { TargetSelectionModal, type TargetOption } from "./components/TargetSelectionModal";
import { UndoRequestModal, type UndoRequestData } from "./components/UndoRequestModal";
import { SplitCardChoiceModal, type CardFaceOption } from "./components/SplitCardChoiceModal";
import { type ImagePref } from "./components/BattlefieldGrid";
import GameList from "./components/GameList";
import { useGameSocket } from "./hooks/useGameSocket";
import type { PaymentItem, ManaColor } from "../../shared/src";
import { GameStatusIndicator } from "./components/GameStatusIndicator";
import { CreateGameModal, type GameCreationConfig } from "./components/CreateGameModal";
import { PhaseNavigator } from "./components/PhaseNavigator";
import { DeckManagerModal } from "./components/DeckManagerModal";

/** Map engine/internal phase enum to human-friendly name */
function prettyPhase(phase?: string | null): string {
  if (!phase) return "-";
  const p = String(phase);
  switch (p) {
    case "PRE_GAME":
    case "preGame":
      return "Pre-game";
    case "beginning":
      return "Beginning phase";
    case "precombatMain":
    case "main1":
      return "Main phase";
    case "combat":
      return "Combat phase";
    case "postcombatMain":
    case "main2":
      return "Main phase 2";
    case "ending":
      return "Ending phase";
    default:
      return p
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/** Map engine/internal step enum to human-friendly name */
function prettyStep(step?: string | null): string {
  if (!step) return "";
  const s = String(step);
  switch (s) {
    case "untap":
      return "Untap step";
    case "upkeep":
      return "Upkeep step";
    case "draw":
      return "Draw step";
    case "main":
      return "Main phase";
    case "beginCombat":
      return "Beginning of combat step";
    case "declareAttackers":
      return "Declare attackers step";
    case "declareBlockers":
      return "Declare blockers step";
    case "combatDamage":
      return "Combat damage step";
    case "endCombat":
      return "End of combat step";
    case "endStep":
    case "end":
      return "End step";
    case "cleanup":
      return "Cleanup step";
    default:
      return s
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

function isLandTypeLine(tl?: string | null): boolean {
  return !!tl && /\bland\b/i.test(tl);
}

/* App component */
export function App() {
  const {
    connected,
    gameIdInput,
    setGameIdInput,
    nameInput,
    setNameInput,
    joinAsSpectator,
    setJoinAsSpectator,

    you,
    view,
    safeView,
    priority,

    chat,
    setChat,
    lastError,
    lastInfo, // currently unused but preserved
    missingImport,
    setMissingImport,

    importedCandidates,
    pendingLocalImport,
    localImportConfirmOpen,

    cmdModalOpen,
    setCmdModalOpen,
    cmdSuggestedNames,
    cmdSuggestedGameId,

    confirmOpen,
    confirmPayload,
    confirmVotes,
    confirmId,

    debugOpen,
    debugLoading,
    debugData,
    setDebugOpen,

    handleJoin,
    joinFromList,
    requestImportDeck,
    requestUseSavedDeck,
    handleLocalImportConfirmChange,
    handleCommanderConfirm,
    fetchDebug,
    respondToConfirm,
  } = useGameSocket();

  const [imagePref, setImagePref] = useState<ImagePref>(
    () =>
      (localStorage.getItem("mtgedh:imagePref") as ImagePref) || "normal"
  );
  const [layout, setLayout] = useState<"rows" | "table">(
    () =>
      (localStorage.getItem("mtgedh:layout") as "rows" | "table") || "table"
  );

  const [peek, setPeek] = useState<{
    mode: "scry" | "surveil";
    cards: any[];
  } | null>(null);

  const [showNameInUseModal, setShowNameInUseModal] = useState(false);
  const [nameInUsePayload, setNameInUsePayload] = useState<any | null>(null);

  // Cast spell modal state - shared between hand casting and commander casting
  const [castSpellModalOpen, setCastSpellModalOpen] = useState(false);
  const [spellToCast, setSpellToCast] = useState<{ 
    cardId: string; 
    cardName: string; 
    manaCost?: string; 
    tax?: number;
    isCommander?: boolean;
  } | null>(null);

  // Accordion state for Join / Active Games
  const [joinCollapsed, setJoinCollapsed] = useState(false);

  // Create Game modal state
  const [createGameModalOpen, setCreateGameModalOpen] = useState(false);
  const [savedDecks, setSavedDecks] = useState<any[]>([]);

  // Deck Builder modal state (standalone, outside of game)
  const [deckBuilderOpen, setDeckBuilderOpen] = useState(false);

  // Combat selection modal state
  const [combatModalOpen, setCombatModalOpen] = useState(false);
  const [combatMode, setCombatMode] = useState<'attackers' | 'blockers'>('attackers');
  
  // Shock land choice modal state
  const [shockLandModalOpen, setShockLandModalOpen] = useState(false);
  const [shockLandData, setShockLandData] = useState<{
    permanentId: string;
    cardName: string;
    imageUrl?: string;
    currentLife?: number;
  } | null>(null);
  
  // Bounce land choice modal state
  const [bounceLandModalOpen, setBounceLandModalOpen] = useState(false);
  const [bounceLandData, setBounceLandData] = useState<{
    bounceLandId: string;
    bounceLandName: string;
    imageUrl?: string;
    landsToChoose: Array<{ permanentId: string; cardName: string; imageUrl?: string }>;
  } | null>(null);
  
  // Triggered ability modal state
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [pendingTriggers, setPendingTriggers] = useState<TriggerPromptData[]>([]);
  
  // Mulligan bottom selection modal state (London Mulligan)
  const [mulliganBottomModalOpen, setMulliganBottomModalOpen] = useState(false);
  const [mulliganBottomCount, setMulliganBottomCount] = useState(0);

   // Cleanup discard selection modal state
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [discardCount, setDiscardCount] = useState(0);
  const [discardMaxHandSize, setDiscardMaxHandSize] = useState(7);
  
  // Opening hand actions modal state (Leylines)
  const [openingHandActionsModalOpen, setOpeningHandActionsModalOpen] = useState(false);
  
  // Library search modal state (Tutors)
  const [librarySearchModalOpen, setLibrarySearchModalOpen] = useState(false);
  const [librarySearchData, setLibrarySearchData] = useState<{
    cards: KnownCardRef[];
    title: string;
    description?: string;
    filter?: { types?: string[]; subtypes?: string[]; maxCmc?: number };
    maxSelections: number;
    moveTo: 'hand' | 'battlefield' | 'top' | 'graveyard';
    shuffleAfter: boolean;
    targetPlayerId?: string; // Whose library we're searching (for Gitaxian Probe, etc.)
  } | null>(null);
  
  // Target selection modal state
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [targetModalData, setTargetModalData] = useState<{
    title: string;
    description?: string;
    source?: { name: string; imageUrl?: string };
    targets: TargetOption[];
    minTargets: number;
    maxTargets: number;
    effectId?: string; // For tracking which effect requested the targets
  } | null>(null);
  
  // Undo request modal state
  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [undoRequestData, setUndoRequestData] = useState<UndoRequestData | null>(null);
  
  // Split/Adventure card choice modal state
  const [splitCardModalOpen, setSplitCardModalOpen] = useState(false);
  const [splitCardData, setSplitCardData] = useState<{
    cardId: string;
    cardName: string;
    layout: string;
    faces: CardFaceOption[];
    canFuse: boolean;
  } | null>(null);
  
  // Deck validation state
  const [deckValidation, setDeckValidation] = useState<{
    format: string;
    cardCount: number;
    illegal: { name: string; reason: string }[];
    warnings: string[];
    valid: boolean;
  } | null>(null);

  // Track if we should prompt for deck import (for new players without a deck)
  const [showDeckImportPrompt, setShowDeckImportPrompt] = useState(false);
  const hasPromptedDeckImport = React.useRef(false);
  // External control for deck manager visibility in TableLayout
  const [tableDeckMgrOpen, setTableDeckMgrOpen] = useState(false);

  // Auto-advance phases/steps setting
  // When enabled, automatically passes priority during untap, draw, and cleanup phases
  // if the player has nothing to do
  const [autoAdvancePhases, setAutoAdvancePhases] = useState(() => {
    try {
      const stored = localStorage.getItem('mtgedh:autoAdvancePhases');
      return stored === 'true';
    } catch {
      return false;
    }
  });
  
  // Toggle auto-advance and persist to localStorage
  const handleToggleAutoAdvance = React.useCallback(() => {
    setAutoAdvancePhases(prev => {
      const next = !prev;
      try {
        localStorage.setItem('mtgedh:autoAdvancePhases', String(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Fetch saved decks when create game modal opens
  const refreshSavedDecks = React.useCallback(() => {
    fetch('/api/decks')
      .then(res => res.ok ? res.json() : { decks: [] })
      .then(data => setSavedDecks(data.decks || []))
      .catch(() => setSavedDecks([]));
  }, []);

  React.useEffect(() => {
    if (createGameModalOpen) {
      refreshSavedDecks();
    }
  }, [createGameModalOpen, refreshSavedDecks]);

  // Handle game creation
  const handleCreateGame = (config: GameCreationConfig) => {
    if (config.includeAI) {
      // Create game with AI opponent
      socket.emit('createGameWithAI' as any, {
        gameId: config.gameId,
        playerName: config.playerName,
        format: config.format,
        startingLife: config.startingLife,
        aiName: config.aiName,
        aiStrategy: config.aiStrategy,
        aiDeckId: config.aiDeckId,
        // New: support importing deck text directly
        aiDeckText: config.aiDeckText,
        aiDeckName: config.aiDeckName,
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
    }, 100);
  };

  React.useEffect(() => {
    const handler = (payload: any) => {
      setNameInUsePayload(payload);
      setShowNameInUseModal(true);
    };
    socket.on("nameInUse", handler);
    return () => {
      socket.off("nameInUse", handler);
    };
  }, []);

  // Combat phase detection - auto-open combat modal when step changes
  React.useEffect(() => {
    if (!safeView || !you) return;
    
    const step = String((safeView as any).step || "").toLowerCase();
    const isYourTurn = safeView.turnPlayer === you;
    
    // Only show attacker modal on your turn during declare attackers step
    if (step === "declareattackers" || step === "declare_attackers") {
      if (isYourTurn) {
        setCombatMode('attackers');
        setCombatModalOpen(true);
      }
    }
    // Show blocker modal when you're being attacked during declare blockers step
    else if (step === "declareblockers" || step === "declare_blockers") {
      // Find if there are attackers targeting you
      const attackersTargetingYou = (safeView.battlefield || []).filter((p: any) => 
        p.attacking === you
      );
      if (attackersTargetingYou.length > 0) {
        setCombatMode('blockers');
        setCombatModalOpen(true);
      }
    }
    else {
      setCombatModalOpen(false);
    }
  }, [safeView, you]);

  // Shock land prompt listener
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setShockLandData({
          permanentId: payload.permanentId,
          cardName: payload.cardName,
          imageUrl: payload.imageUrl,
          currentLife: payload.currentLife,
        });
        setShockLandModalOpen(true);
      }
    };
    socket.on("shockLandPrompt", handler);
    return () => {
      socket.off("shockLandPrompt", handler);
    };
  }, [safeView?.id]);

  // Bounce land prompt listener
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setBounceLandData({
          bounceLandId: payload.bounceLandId,
          bounceLandName: payload.bounceLandName,
          imageUrl: payload.imageUrl,
          landsToChoose: payload.landsToChoose || [],
        });
        setBounceLandModalOpen(true);
      }
    };
    socket.on("bounceLandPrompt", handler);
    return () => {
      socket.off("bounceLandPrompt", handler);
    };
  }, [safeView?.id]);

  // Mulligan bottom selection prompt listener (London Mulligan)
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id && payload.cardsToBottom > 0) {
        setMulliganBottomCount(payload.cardsToBottom);
        setMulliganBottomModalOpen(true);
      }
    };
    socket.on("mulliganBottomPrompt", handler);
    return () => {
      socket.off("mulliganBottomPrompt", handler);
    };
  }, [safeView?.id]);

  // Triggered ability prompt listener
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id && payload.trigger) {
        setPendingTriggers(prev => [...prev, payload.trigger]);
        setTriggerModalOpen(true);
      }
    };
    socket.on("triggerPrompt", handler);
    return () => {
      socket.off("triggerPrompt", handler);
    };
  }, [safeView?.id]);

  // Deck validation result listener
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setDeckValidation({
          format: payload.format,
          cardCount: payload.cardCount,
          illegal: payload.illegal || [],
          warnings: payload.warnings || [],
          valid: payload.valid,
        });
      }
    };
    socket.on("deckValidationResult", handler);
    return () => {
      socket.off("deckValidationResult", handler);
    };
  }, [safeView?.id]);

  // Library search request listener (Tutor effects)
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setLibrarySearchData({
          cards: payload.cards || [],
          title: payload.title || 'Search Library',
          description: payload.description,
          filter: payload.filter,
          maxSelections: payload.maxSelections || 1,
          moveTo: payload.moveTo || 'hand',
          shuffleAfter: payload.shuffleAfter !== false,
          targetPlayerId: payload.targetPlayerId, // For searching opponent's library
        });
        setLibrarySearchModalOpen(true);
      }
    };
    socket.on("librarySearchRequest", handler);
    return () => {
      socket.off("librarySearchRequest", handler);
    };
  }, [safeView?.id]);

  // Target selection request listener
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        // Convert payload targets to TargetOption format
        const targets: TargetOption[] = (payload.targets || []).map((t: any) => ({
          id: t.id,
          type: t.type || 'permanent',
          name: t.name,
          displayName: t.displayName,
          imageUrl: t.imageUrl,
          controller: t.controller,
          typeLine: t.typeLine,
          life: t.life,
          zone: t.zone,
          owner: t.owner,
          card: t.card,
        }));

        setTargetModalData({
          title: payload.title || 'Select Targets',
          description: payload.description,
          source: payload.source,
          targets,
          minTargets: payload.minTargets ?? 1,
          maxTargets: payload.maxTargets ?? 1,
          effectId: payload.effectId,
        });
        setTargetModalOpen(true);
      }
    };
    socket.on("targetSelectionRequest", handler);
    return () => {
      socket.off("targetSelectionRequest", handler);
    };
  }, [safeView?.id]);

  // Opening hand actions prompt listener (for Leylines after mulligan)
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setOpeningHandActionsModalOpen(true);
      }
    };
    socket.on("openingHandActionsPrompt", handler);
    return () => {
      socket.off("openingHandActionsPrompt", handler);
    };
  }, [safeView?.id]);

  // Undo request listener
  React.useEffect(() => {
    const handleUndoRequest = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setUndoRequestData({
          undoId: payload.undoId,
          requesterId: payload.requesterId,
          requesterName: payload.requesterName,
          description: payload.description,
          actionsToUndo: payload.actionsToUndo,
          expiresAt: payload.expiresAt,
          approvals: payload.approvals || {},
          playerIds: payload.playerIds || [],
        });
        setUndoModalOpen(true);
      }
    };

    const handleUndoUpdate = (payload: any) => {
      if (payload.gameId === safeView?.id && undoRequestData?.undoId === payload.undoId) {
        setUndoRequestData(prev => prev ? {
          ...prev,
          approvals: payload.approvals || prev.approvals,
        } : null);
      }
    };

    const handleUndoCancelled = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setUndoModalOpen(false);
        setUndoRequestData(null);
      }
    };

    const handleUndoConfirmed = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setUndoModalOpen(false);
        setUndoRequestData(null);
      }
    };

    socket.on("undoRequest", handleUndoRequest);
    socket.on("undoUpdate", handleUndoUpdate);
    socket.on("undoCancelled", handleUndoCancelled);
    socket.on("undoConfirmed", handleUndoConfirmed);

    return () => {
      socket.off("undoRequest", handleUndoRequest);
      socket.off("undoUpdate", handleUndoUpdate);
      socket.off("undoCancelled", handleUndoCancelled);
      socket.off("undoConfirmed", handleUndoConfirmed);
    };
  }, [safeView?.id, undoRequestData?.undoId]);

  const isTable = layout === "table";
  const canPass = !!safeView && !!you && safeView.priority === you;
  const isYouPlayer =
    !!safeView && !!you && safeView.players.some((p) => p.id === you);

  // Pre-game and mulligan state
  const isPreGame = useMemo(() => {
    if (!safeView) return false;
    const phaseStr = String(safeView.phase || "").toUpperCase();
    return phaseStr === "" || phaseStr === "PRE_GAME";
  }, [safeView]);

  const mulliganState = useMemo(() => {
    if (!safeView || !you) return null;
    return (safeView as any).mulliganState?.[you] || null;
  }, [safeView, you]);

  const hasKeptHand = mulliganState?.hasKeptHand || false;
  const mulligansTaken = mulliganState?.mulligansTaken || 0;
  const pendingBottomCount = mulliganState?.pendingBottomCount || 0;

  // Detect pending discard selection for cleanup step
  const pendingDiscardSelection = useMemo(() => {
    if (!safeView || !you) return null;
    return (safeView as any).pendingDiscardSelection?.[you] || null;
  }, [safeView, you]);

  // Auto-open discard modal when pending discard detected
  React.useEffect(() => {
    if (pendingDiscardSelection && pendingDiscardSelection.count > 0) {
      setDiscardCount(pendingDiscardSelection.count);
      setDiscardMaxHandSize(pendingDiscardSelection.maxHandSize || 7);
      setDiscardModalOpen(true);
    }
  }, [pendingDiscardSelection]);

  // Auto-open mulligan bottom modal when pending bottom selection detected (from state)
  React.useEffect(() => {
    if (pendingBottomCount > 0 && !hasKeptHand) {
      setMulliganBottomCount(pendingBottomCount);
      setMulliganBottomModalOpen(true);
    }
  }, [pendingBottomCount, hasKeptHand]);

  // Can mulligan if in pre-game, haven't kept, and haven't hit max mulligans
  const canMulligan = isPreGame && isYouPlayer && !hasKeptHand && mulligansTaken < 6 && pendingBottomCount === 0;
  const canKeepHand = isPreGame && isYouPlayer && !hasKeptHand && pendingBottomCount === 0;

  // Auto-collapse join panel once you're an active player
  React.useEffect(() => {
    if (isYouPlayer) {
      setJoinCollapsed(true);
    }
  }, [isYouPlayer]);

  // Auto-show deck import prompt for players without a deck (when joining in pre-game)
  React.useEffect(() => {
    if (!isYouPlayer || !isPreGame || !you || !safeView) return;
    if (hasPromptedDeckImport.current) return;

    // Check if player has no cards in library yet
    const zones = safeView.zones?.[you];
    const libraryCount = zones?.libraryCount ?? 0;
    const handCount = zones?.handCount ?? 0;

    // If no deck loaded (library + hand both empty), prompt for deck import
    if (libraryCount === 0 && handCount === 0) {
      hasPromptedDeckImport.current = true;
      setShowDeckImportPrompt(true);
    }
  }, [isYouPlayer, isPreGame, you, safeView]);

  // Reset prompt state when leaving game
  React.useEffect(() => {
    if (!you) {
      hasPromptedDeckImport.current = false;
      setShowDeckImportPrompt(false);
    }
  }, [you]);

  // Auto-advance phases effect
  // Automatically passes priority during phases where the player can't do much:
  // - Untap step (nothing to do during untap except special abilities)
  // - Draw step (after drawing, usually just pass)
  // - Cleanup step (unless special abilities like Sundial of the Infinite)
  React.useEffect(() => {
    if (!autoAdvancePhases || !safeView || !you) return;
    // Only auto-advance if it's our turn and we have priority
    if (safeView.priority !== you) return;
    if (safeView.turnPlayer !== you) return;
    
    // Only auto-advance during certain phases/steps
    const step = String(safeView.step || '').toLowerCase();
    const phase = String(safeView.phase || '').toLowerCase();
    
    // Don't auto-advance if there's something on the stack
    if ((safeView as any).stack?.length > 0) return;
    
    // Phases/steps that can be auto-advanced:
    // - untap step (no player usually needs to respond)
    // - cleanup step (usually just pass unless special abilities like Sundial of the Infinite)
    // Note: Not auto-advancing draw step as the player may want to cast instants after drawing
    const autoAdvanceableSteps = ['untap', 'cleanup'];
    
    // Check if we're in an auto-advance step
    const shouldAutoAdvance = 
      autoAdvanceableSteps.includes(step) ||
      phase.includes('untap') ||
      phase.includes('cleanup');
    
    if (shouldAutoAdvance) {
      // Small delay to allow any animations/updates
      const timer = setTimeout(() => {
        socket.emit('nextStep', { gameId: safeView.id });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [autoAdvancePhases, safeView, you]);

  const canAdvanceStep = useMemo(() => {
    if (!safeView || !you) return false;
    if (safeView.turnPlayer === you) return true;
    const phaseStr = String(safeView.phase || "").toUpperCase();
    if (phaseStr === "PRE_GAME" && safeView.players?.[0]?.id === you)
      return true;
    return false;
  }, [safeView, you]);

  const canAdvanceTurn = canAdvanceStep;

  const effectiveGameId = safeView?.id ?? gameIdInput;

  const showCommanderGallery =
    cmdModalOpen && cmdSuggestedGameId && importedCandidates.length > 0;

  const phaseLabel = prettyPhase(safeView?.phase);
  const stepLabelRaw = safeView?.step ? String(safeView.step) : "";
  const stepLabel = prettyStep(stepLabelRaw);

  // chat send function shared with TableLayout
  const sendChat = (txt: string) => {
    if (!safeView) return;
    const trimmed = txt.trim();

    // Slash command: /judge
    if (trimmed.toLowerCase() === "/judge") {
      socket.emit("requestJudge", { gameId: safeView.id });
      return;
    }

    if (!view) return;
    const payload: ChatMsg = {
      id: `m_${Date.now()}`,
      gameId: view.id,
      from: you ?? "you",
      message: txt,
      ts: Date.now(),
    };
    socket.emit("chat", payload);
    setChat((prev) => [...prev, payload]);
  };

  // Hand interaction helpers: used to gate client UI; server still validates rules.
  const reasonCannotPlayLand = (card: { type_line?: string | null }) => {
    if (!safeView || !you) return "No game state";
    if (!isLandTypeLine(card.type_line)) return "Not a land";

    const turnPlayer = safeView.turnPlayer;
    const phase = safeView.phase;
    const landsPlayedThisTurn =
      (safeView as any).landsPlayedThisTurn?.[you] || 0;

    if (turnPlayer !== you) return "Not your turn";
    if (!phase || !String(phase).toLowerCase().includes("main")) {
      return "Can only play lands during your main phase";
    }
    if (landsPlayedThisTurn >= 1) return "You have already played a land this turn";

    return null;
  };

  const reasonCannotCast = (card: { type_line?: string | null }) => {
    if (!safeView || !you) return "No game state";
    if (isLandTypeLine(card.type_line)) return "Lands are played, not cast";
    // Check priority instead of turn - you can cast instants on other players' turns
    if (safeView.priority !== you) return "You don't have priority";
    return null;
  };

  // Parse mana colors from oracle text for lands and mana-producing permanents
  /**
   * Parse mana colors from oracle text.
   * Returns an array of colors - for cards that produce multiple mana of the same color
   * (like Sol Ring which adds {C}{C}), the color will be duplicated.
   */
  const parseManaColorsFromOracleText = (oracleText: string): ManaColor[] => {
    const colors: ManaColor[] = [];
    const text = oracleText.toLowerCase();
    
    // Check for "any color" or "any one color" patterns (like Command Tower, City of Brass, etc.)
    // This should be checked first as it's the most permissive
    if (text.includes('any color') || text.includes('one mana of any color') || 
        text.includes('mana of any color')) {
      return ['W', 'U', 'B', 'R', 'G'];
    }
    
    // Check for "any type" patterns (e.g., Reflecting Pool) - includes colorless
    if (text.includes('any type')) {
      return ['W', 'U', 'B', 'R', 'G', 'C'];
    }
    
    // Count mana symbols in "add {X}{X}" patterns
    // This handles cards like Sol Ring ({T}: Add {C}{C}) which produce multiple mana
    const addPattern = /add\s+((?:\{[wubrgc]\})+)/gi;
    let match;
    while ((match = addPattern.exec(text)) !== null) {
      const manaSymbols = match[1];
      // Count each symbol type
      const wCount = (manaSymbols.match(/\{w\}/gi) || []).length;
      const uCount = (manaSymbols.match(/\{u\}/gi) || []).length;
      const bCount = (manaSymbols.match(/\{b\}/gi) || []).length;
      const rCount = (manaSymbols.match(/\{r\}/gi) || []).length;
      const gCount = (manaSymbols.match(/\{g\}/gi) || []).length;
      const cCount = (manaSymbols.match(/\{c\}/gi) || []).length;
      
      for (let i = 0; i < wCount; i++) colors.push('W');
      for (let i = 0; i < uCount; i++) colors.push('U');
      for (let i = 0; i < bCount; i++) colors.push('B');
      for (let i = 0; i < rCount; i++) colors.push('R');
      for (let i = 0; i < gCount; i++) colors.push('G');
      for (let i = 0; i < cCount; i++) colors.push('C');
    }
    
    // If no mana symbols found in add patterns, check for basic patterns
    if (colors.length === 0) {
      if (text.includes('{w}') || text.includes('add {w}') || text.includes('white')) colors.push('W');
      if (text.includes('{u}') || text.includes('add {u}') || text.includes('blue')) colors.push('U');
      if (text.includes('{b}') || text.includes('add {b}') || text.includes('black')) colors.push('B');
      if (text.includes('{r}') || text.includes('add {r}') || text.includes('red')) colors.push('R');
      if (text.includes('{g}') || text.includes('add {g}') || text.includes('green')) colors.push('G');
      if (text.includes('{c}') || text.includes('add {c}') || text.includes('colorless')) colors.push('C');
    }
    
    return colors;
  };

  // Check if a card is a fetch land or other "sacrifice to search" land (not a mana source)
  const isFetchLandOrSacrificeSearchLand = (oracleText: string): boolean => {
    const text = oracleText.toLowerCase();
    // Fetch lands typically say "sacrifice" and "search" in oracle text
    // They don't produce mana directly
    if (text.includes('sacrifice') && text.includes('search')) {
      return true;
    }
    // Check for common fetch land patterns
    if (text.includes('sacrifice') && text.includes('put it onto the battlefield')) {
      return true;
    }
    return false;
  };

  // Check if a land actually produces mana (has "add" in its oracle text for mana)
  const landProducesMana = (oracleText: string): boolean => {
    const text = oracleText.toLowerCase();
    // Look for patterns like "add {W}", "add one mana of any color", etc.
    // Must have "add" AND either mana symbols or "mana"
    return text.includes('add') && (text.includes('{') || text.includes('mana'));
  };

  // Check if an artifact meets metalcraft requirement (3+ artifacts on battlefield)
  const checkMetalcraft = (playerId: string): boolean => {
    if (!safeView) return false;
    const battlefield = (safeView.battlefield || []).filter(perm => perm.controller === playerId);
    const artifactCount = battlefield.filter(perm => {
      const card = perm.card;
      if (!card || !('type_line' in card)) return false;
      return ((card as any).type_line || '').toLowerCase().includes('artifact');
    }).length;
    return artifactCount >= 3;
  };

  /**
   * Check if a creature permanent can use tap abilities (considering summoning sickness).
   * Rule 302.6: A creature can't attack or use tap/untap abilities unless it's been 
   * continuously controlled since the turn began, or it has haste.
   * 
   * @param perm The battlefield permanent to check
   * @returns true if the creature can use tap abilities
   */
  const canCreatureUseTapAbility = (perm: BattlefieldPermanent): boolean => {
    // If creature doesn't have summoning sickness, it can tap
    if (!perm.summoningSickness) {
      return true;
    }
    
    // Check for haste - creature can tap even with summoning sickness
    const card = perm.card as KnownCardRef;
    if (!card) return false;
    
    const oracleText = (card.oracle_text || '').toLowerCase();
    // Keywords array from Scryfall data (not in TypeScript interface but present at runtime)
    const keywords = ((card as any).keywords as string[]) || [];
    const grantedAbilities = ((perm as any).grantedAbilities as string[]) || [];
    
    // Check for haste in multiple places:
    // 1. Keywords array from Scryfall data
    // 2. Granted abilities from effects
    // 3. Oracle text (with specific matching)
    const hasHaste = 
      keywords.some((k: string) => k.toLowerCase() === 'haste') ||
      grantedAbilities.some((a: string) => a.toLowerCase().includes('haste')) ||
      /\bhaste\b/i.test(oracleText);
    
    return hasHaste;
  };

  // Get available mana sources (untapped lands and mana-producing artifacts/creatures)
  const getAvailableManaSourcesForPlayer = (playerId: string) => {
    if (!safeView) return [];
    
    const sources: Array<{ id: string; name: string; options: ManaColor[] }> = [];
    
    // Get player's battlefield permanents (filter global battlefield by controller)
    const battlefield = (safeView.battlefield || []).filter(perm => perm.controller === playerId);
    
    for (const perm of battlefield) {
      if (!perm || perm.tapped) continue; // Skip tapped permanents
      
      // Get card info from the permanent - skip hidden cards
      const card = perm.card;
      if (!card || !('name' in card) || !card.name) continue;
      
      const typeLine = (card.type_line || '').toLowerCase();
      const oracleText = ((card as any).oracle_text || '').toLowerCase();
      const name = card.name;
      
      // Skip fetch lands and sacrifice-to-search lands - they don't produce mana
      if (typeLine.includes('land') && isFetchLandOrSacrificeSearchLand(oracleText)) {
        continue;
      }
      
      // Collect colors based on basic land types (handles dual lands like Tropical Island)
      const basicColors: ManaColor[] = [];
      if (typeLine.includes('plains')) basicColors.push('W');
      if (typeLine.includes('island')) basicColors.push('U');
      if (typeLine.includes('swamp')) basicColors.push('B');
      if (typeLine.includes('mountain')) basicColors.push('R');
      if (typeLine.includes('forest')) basicColors.push('G');
      
      if (basicColors.length > 0) {
        // Land has basic land types - use those colors
        sources.push({ id: perm.id, name, options: basicColors });
      } else if (typeLine.includes('land')) {
        // Non-basic land without basic land types - parse oracle text
        // Only include if it actually produces mana
        if (landProducesMana(oracleText)) {
          const oracleColors = parseManaColorsFromOracleText(oracleText);
          if (oracleColors.length > 0) {
            sources.push({ id: perm.id, name, options: oracleColors });
          } else {
            // Default to colorless if we can't determine the colors but it does produce mana
            sources.push({ id: perm.id, name, options: ['C'] });
          }
        }
        // If land doesn't produce mana (e.g., fetch lands), skip it
      } else if (typeLine.includes('artifact') || typeLine.includes('creature')) {
        // For creatures, check summoning sickness - they can't use tap abilities if they have it
        // unless they have haste. Rule 302.6.
        const isCreature = typeLine.includes('creature');
        if (isCreature && !canCreatureUseTapAbility(perm)) {
          continue; // Skip creatures with summoning sickness and no haste
        }
        
        // Check for mana-producing artifacts/creatures
        if (oracleText.includes('add') && (oracleText.includes('mana') || oracleText.includes('{'))) {
          // Check for Metalcraft requirement in oracle text (e.g., Mox Opal)
          // Metalcraft - "as long as you control three or more artifacts"
          if (oracleText.includes('metalcraft') || 
              oracleText.includes('three or more artifacts') ||
              oracleText.includes('3 or more artifacts')) {
            if (!checkMetalcraft(playerId)) {
              continue; // Skip if metalcraft not met
            }
          }
          
          const artifactColors = parseManaColorsFromOracleText(oracleText);
          if (artifactColors.length > 0) {
            sources.push({ id: perm.id, name, options: artifactColors });
          } else {
            // Default to colorless for mana artifacts without specific colors
            sources.push({ id: perm.id, name, options: ['C'] });
          }
        }
      }
    }
    
    return sources;
  };

  // Handle cast spell confirmation from modal - works for both hand and commander spells
  const handleCastSpellConfirm = (payment: PaymentItem[]) => {
    if (!safeView || !spellToCast) return;
    
    console.log(`[Client] Casting ${spellToCast.isCommander ? 'commander' : 'spell'}: ${spellToCast.cardName} with payment:`, payment);
    
    if (spellToCast.isCommander) {
      // Cast commander from command zone
      socket.emit("castCommander", {
        gameId: safeView.id,
        commanderNameOrId: spellToCast.cardId,
        payment: payment.length > 0 ? payment : undefined,
      });
    } else {
      // Cast spell from hand
      socket.emit("castSpellFromHand", {
        gameId: safeView.id,
        cardId: spellToCast.cardId,
        payment: payment.length > 0 ? payment : undefined,
      });
    }
    
    setCastSpellModalOpen(false);
    setSpellToCast(null);
  };

  const handleCastSpellCancel = () => {
    setCastSpellModalOpen(false);
    setSpellToCast(null);
  };

  // Helper to add commander tax to mana cost
  // E.g., "{3}{W}{G}" + tax 2 => "{5}{W}{G}"
  const addTaxToManaCost = (manaCost: string | undefined, tax: number): string => {
    if (!manaCost) {
      return tax > 0 ? `{${tax}}` : '';
    }
    if (tax <= 0) {
      return manaCost;
    }
    
    // Parse existing generic mana from cost
    const tokens = manaCost.match(/\{[^}]+\}/g) || [];
    let existingGeneric = 0;
    const coloredTokens: string[] = [];
    
    for (const t of tokens) {
      const sym = t.replace(/[{}]/g, '');
      if (/^\d+$/.test(sym)) {
        existingGeneric += parseInt(sym, 10);
      } else {
        coloredTokens.push(t);
      }
    }
    
    // Combine generic with tax
    const newGeneric = existingGeneric + tax;
    
    // Reconstruct: generic first, then colored mana
    if (newGeneric > 0) {
      return `{${newGeneric}}` + coloredTokens.join('');
    }
    return coloredTokens.join('');
  };

  // Handle casting commander - opens payment modal
  const handleCastCommander = (commanderId: string, commanderName: string, manaCost?: string, tax?: number) => {
    // Calculate total cost including tax
    const totalManaCost = addTaxToManaCost(manaCost, tax || 0);
    
    setSpellToCast({
      cardId: commanderId,
      cardName: commanderName,
      manaCost: totalManaCost,
      tax,
      isCommander: true,
    });
    setCastSpellModalOpen(true);
  };

  // Combat handlers
  const handleDeclareAttackers = (attackers: AttackerSelection[]) => {
    if (!safeView) return;
    socket.emit("declareAttackers", {
      gameId: safeView.id,
      attackers,
    });
    setCombatModalOpen(false);
  };

  const handleDeclareBlockers = (blockers: BlockerSelection[]) => {
    if (!safeView) return;
    socket.emit("declareBlockers", {
      gameId: safeView.id,
      blockers,
    });
    setCombatModalOpen(false);
  };

  const handleSkipCombat = () => {
    if (!safeView) return;
    if (combatMode === 'attackers') {
      socket.emit("skipDeclareAttackers", { gameId: safeView.id });
    } else {
      socket.emit("skipDeclareBlockers", { gameId: safeView.id });
    }
    setCombatModalOpen(false);
  };

  // Shock land handlers
  const handleShockLandPayLife = () => {
    if (!safeView || !shockLandData) return;
    socket.emit("shockLandChoice", {
      gameId: safeView.id,
      permanentId: shockLandData.permanentId,
      payLife: true,
    });
    setShockLandModalOpen(false);
    setShockLandData(null);
  };

  const handleShockLandTapped = () => {
    if (!safeView || !shockLandData) return;
    socket.emit("shockLandChoice", {
      gameId: safeView.id,
      permanentId: shockLandData.permanentId,
      payLife: false,
    });
    setShockLandModalOpen(false);
    setShockLandData(null);
  };

  // Bounce land handler - player selects which land to return
  const handleBounceLandSelect = (permanentId: string) => {
    if (!safeView || !bounceLandData) return;
    socket.emit("bounceLandChoice", {
      gameId: safeView.id,
      bounceLandId: bounceLandData.bounceLandId,
      returnPermanentId: permanentId,
    });
    setBounceLandModalOpen(false);
    setBounceLandData(null);
  };

  // Trigger handlers
  const handleResolveTrigger = (triggerId: string, choice: any) => {
    if (!safeView) return;
    socket.emit("resolveTrigger", {
      gameId: safeView.id,
      triggerId,
      choice,
    });
    setPendingTriggers(prev => prev.filter(t => t.id !== triggerId));
    if (pendingTriggers.length <= 1) {
      setTriggerModalOpen(false);
    }
  };

  const handleSkipTrigger = (triggerId: string) => {
    if (!safeView) return;
    socket.emit("skipTrigger", {
      gameId: safeView.id,
      triggerId,
    });
    setPendingTriggers(prev => prev.filter(t => t.id !== triggerId));
    if (pendingTriggers.length <= 1) {
      setTriggerModalOpen(false);
    }
  };

  // Library search handlers (Tutor effects)
  const handleLibrarySearchConfirm = (selectedCardIds: string[], moveTo: string) => {
    if (!safeView) return;
    socket.emit("librarySearchSelect", {
      gameId: safeView.id,
      selectedCardIds,
      moveTo,
      targetPlayerId: librarySearchData?.targetPlayerId,
    });
    setLibrarySearchModalOpen(false);
    setLibrarySearchData(null);
  };

  const handleLibrarySearchCancel = () => {
    if (!safeView) return;
    socket.emit("librarySearchCancel", {
      gameId: safeView.id,
    });
    setLibrarySearchModalOpen(false);
    setLibrarySearchData(null);
  };

  // Target selection handlers
  const handleTargetConfirm = (selectedTargetIds: string[]) => {
    if (!safeView || !targetModalData) return;
    socket.emit("targetSelectionConfirm", {
      gameId: safeView.id,
      effectId: targetModalData.effectId,
      selectedTargetIds,
    });
    setTargetModalOpen(false);
    setTargetModalData(null);
  };

  const handleTargetCancel = () => {
    if (!safeView) return;
    socket.emit("targetSelectionCancel", {
      gameId: safeView.id,
      effectId: targetModalData?.effectId,
    });
    setTargetModalOpen(false);
    setTargetModalData(null);
  };

  // Opening hand actions handlers (Leylines)
  const handleOpeningHandActionsConfirm = (selectedCardIds: string[]) => {
    if (!safeView) return;
    socket.emit("playOpeningHandCards", {
      gameId: safeView.id,
      cardIds: selectedCardIds,
    });
    setOpeningHandActionsModalOpen(false);
  };

  const handleOpeningHandActionsSkip = () => {
    if (!safeView) return;
    socket.emit("skipOpeningHandActions", {
      gameId: safeView.id,
    });
    setOpeningHandActionsModalOpen(false);
  };

  // Undo handlers
  const handleUndoApprove = () => {
    if (!safeView || !undoRequestData) return;
    socket.emit("respondUndo", {
      gameId: safeView.id,
      undoId: undoRequestData.undoId,
      approved: true,
    });
  };

  const handleUndoReject = () => {
    if (!safeView || !undoRequestData) return;
    socket.emit("respondUndo", {
      gameId: safeView.id,
      undoId: undoRequestData.undoId,
      approved: false,
    });
    setUndoModalOpen(false);
    setUndoRequestData(null);
  };

  const handleUndoCancel = () => {
    if (!safeView || !undoRequestData) return;
    socket.emit("cancelUndo", {
      gameId: safeView.id,
      undoId: undoRequestData.undoId,
    });
    setUndoModalOpen(false);
    setUndoRequestData(null);
  };

  const handleRequestUndo = () => {
    if (!safeView) return;
    socket.emit("requestUndo", {
      gameId: safeView.id,
      actionsToUndo: 1,
    });
  };

  // Split/Adventure card choice handler
  const handleSplitCardChoose = (faceId: string, fused?: boolean) => {
    if (!splitCardData || !safeView || !you) return;
    
    const zones = safeView.zones?.[you];
    const hand = zones?.hand || [];
    const card = hand.find((c: any) => c?.id === splitCardData.cardId) as KnownCardRef | undefined;
    if (!card) {
      setSplitCardModalOpen(false);
      setSplitCardData(null);
      return;
    }
    
    const cardFaces = (card as any).card_faces as CardFace[] | undefined;
    
    // Determine mana cost based on choice
    let manaCost: string | undefined;
    let displayName = splitCardData.cardName;
    
    if (fused && cardFaces && cardFaces.length >= 2) {
      // Fuse: combine both costs
      manaCost = (cardFaces[0]?.mana_cost || '') + (cardFaces[1]?.mana_cost || '');
      displayName = `${cardFaces[0]?.name || 'Left'} // ${cardFaces[1]?.name || 'Right'}`;
    } else if (faceId.startsWith('face_') && cardFaces) {
      const faceIndex = parseInt(faceId.replace('face_', ''), 10);
      const chosenFace = cardFaces[faceIndex];
      if (chosenFace) {
        manaCost = chosenFace.mana_cost;
        displayName = chosenFace.name || displayName;
      }
    }
    
    // Close split card modal and open payment modal
    setSplitCardModalOpen(false);
    setSplitCardData(null);
    
    setSpellToCast({
      cardId: splitCardData.cardId,
      cardName: displayName,
      manaCost: manaCost || (card as any).mana_cost,
    });
    setCastSpellModalOpen(true);
  };

  const handleSplitCardCancel = () => {
    setSplitCardModalOpen(false);
    setSplitCardData(null);
  };

  /**
   * Check if a creature can attack (considering summoning sickness).
   * Rule 302.6: A creature can't attack unless it's been continuously controlled 
   * since the turn began, or it has haste.
   * Also checks for defender keyword which prevents attacking.
   * 
   * @param perm The battlefield permanent to check
   * @returns true if the creature can attack
   */
  const canCreatureAttack = (perm: BattlefieldPermanent): boolean => {
    const card = perm.card as KnownCardRef;
    if (!card) return false;
    
    const oracleText = (card.oracle_text || '').toLowerCase();
    // Keywords array from Scryfall data (not in TypeScript interface but present at runtime)
    const keywords = ((card as any).keywords as string[]) || [];
    const grantedAbilities = ((perm as any).grantedAbilities as string[]) || [];
    
    // Check for defender - creatures with defender can't attack (unless granted by effects)
    const hasDefender = 
      keywords.some((k: string) => k.toLowerCase() === 'defender') ||
      /\bdefender\b/i.test(oracleText);
    
    // Check if defender has been removed by effects (e.g., "creatures with defender can attack")
    const defenderCanAttack = grantedAbilities.some((a: string) => 
      a.toLowerCase().includes('defender') && a.toLowerCase().includes('attack')
    );
    
    if (hasDefender && !defenderCanAttack) {
      return false;
    }
    
    // Check summoning sickness - only matters if creature has it
    if (!perm.summoningSickness) {
      return true;
    }
    
    // Check for haste - creature can attack even with summoning sickness
    const hasHaste = 
      keywords.some((k: string) => k.toLowerCase() === 'haste') ||
      grantedAbilities.some((a: string) => a.toLowerCase().includes('haste')) ||
      /\bhaste\b/i.test(oracleText);
    
    return hasHaste;
  };

  // Get creatures for combat modal - filter to only those that can attack
  const myCreatures = useMemo(() => {
    if (!safeView || !you) return [];
    return (safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
      if (p.controller !== you) return false;
      const typeLine = (p.card as KnownCardRef)?.type_line?.toLowerCase() || '';
      if (!typeLine.includes('creature')) return false;
      
      // Filter out creatures that cannot attack (summoning sickness without haste, or defender)
      return canCreatureAttack(p);
    });
  }, [safeView, you]);

  const attackingCreatures = useMemo(() => {
    if (!safeView) return [];
    return (safeView.battlefield || []).filter((p: any) => 
      p.attacking && 
      (p.card as KnownCardRef)?.type_line?.toLowerCase().includes('creature')
    );
  }, [safeView]);

  const defenders = useMemo(() => {
    if (!safeView || !you) return [];
    return (safeView.players || []).filter((p: any) => p.id !== you);
  }, [safeView, you]);

  return (
    <div
      style={{
        padding: 12,
        fontFamily: "system-ui",
        display: "grid",
        gridTemplateColumns: isTable ? "1fr" : "1.2fr 380px",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* HEADER (game id, format) */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>MTGEDH</h1>
            <div style={{ fontSize: 12, color: "#666" }}>
              Game: {effectiveGameId} • Format:{" "}
              {String(safeView?.format ?? "")}
            </div>
          </div>
        </div>

        {/* JOIN / ACTIVE GAMES (collapsible/accordion) */}
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 6,
            padding: 8,
            background: "#fafafa",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
            }}
            onClick={() => setJoinCollapsed((c) => !c)}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Join / Active Games
            </div>
            <div style={{ fontSize: 16 }}>
              {joinCollapsed ? "▸" : "▾"}
            </div>
          </div>

          {!joinCollapsed && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                <input
                  value={gameIdInput}
                  onChange={(e) => setGameIdInput(e.target.value as any)}
                  placeholder="Game ID"
                />
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Name"
                />
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={joinAsSpectator}
                    onChange={(e) => setJoinAsSpectator(e.target.checked)}
                  />
                  Spectator
                </label>
                <button onClick={handleJoin} disabled={!connected}>
                  Join
                </button>
                <button
                  onClick={() => setCreateGameModalOpen(true)}
                  disabled={!connected}
                  style={{
                    backgroundColor: "#10b981",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: "4px 12px",
                    cursor: connected ? "pointer" : "not-allowed",
                  }}
                >
                  + Create Game
                </button>
                <button
                  onClick={() => setDeckBuilderOpen(true)}
                  style={{
                    backgroundColor: "#6366f1",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: "4px 12px",
                    cursor: "pointer",
                  }}
                >
                  🗂️ Deck Builder
                </button>
                <button
                  onClick={() =>
                    socket.emit("requestState", { gameId: gameIdInput })
                  }
                  disabled={!connected}
                >
                  Refresh
                </button>
                <button
                  onClick={() => fetchDebug()}
                  disabled={!connected || !safeView}
                >
                  Debug
                </button>
              </div>

              <div style={{ marginTop: 8 }}>
                <GameList onJoin={joinFromList} />
              </div>
            </>
          )}
        </div>

        {/* GAME STATUS INDICATOR - Shows turn, phase, step, priority, special designations */}
        {safeView && (
          <GameStatusIndicator
            turn={safeView.turn}
            phase={safeView.phase}
            step={safeView.step}
            turnPlayer={safeView.turnPlayer}
            priority={safeView.priority}
            players={safeView.players || []}
            you={you || undefined}
            combat={(safeView as any).combat}
            monarch={(safeView as any).monarch}
            initiative={(safeView as any).initiative}
            dayNight={(safeView as any).dayNight}
            cityBlessing={(safeView as any).cityBlessing}
          />
        )}

        {/* CONTROL BAR JUST ABOVE THE TABLE */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 8,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          {/* Mulligan buttons - visible only in pre-game */}
          {isPreGame && isYouPlayer && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: 6,
                border: "1px solid #c6a6ff",
                borderRadius: 6,
                background: "#f8f0ff",
              }}
            >
              {hasKeptHand ? (
                <span style={{ fontSize: 12, color: "#6b46c1", fontWeight: 500 }}>
                  ✓ Hand kept{mulligansTaken > 0 ? ` (${7 - mulligansTaken} cards)` : ""}
                </span>
              ) : pendingBottomCount > 0 ? (
                <span style={{ fontSize: 12, color: "#d69e2e", fontWeight: 500 }}>
                  Select {pendingBottomCount} card{pendingBottomCount !== 1 ? 's' : ''} to put on bottom...
                </span>
              ) : (
                <>
                  <span style={{ fontSize: 12, color: "#553c9a" }}>
                    Mulligans: {mulligansTaken}
                  </span>
                  <button
                    onClick={() => socket.emit("keepHand", { gameId: safeView?.id })}
                    disabled={!canKeepHand}
                    style={{
                      background: "#48bb78",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      padding: "4px 12px",
                      cursor: canKeepHand ? "pointer" : "not-allowed",
                      opacity: canKeepHand ? 1 : 0.5,
                    }}
                  >
                    Keep Hand
                  </button>
                  <button
                    onClick={() => socket.emit("mulligan", { gameId: safeView?.id })}
                    disabled={!canMulligan}
                    style={{
                      background: "#ed8936",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      padding: "4px 12px",
                      cursor: canMulligan ? "pointer" : "not-allowed",
                      opacity: canMulligan ? 1 : 0.5,
                    }}
                  >
                    Mulligan
                  </button>
                </>
              )}
            </div>
          )}

          {/* Spacer to push buttons to the right when no mulligan panel */}
          {(!isPreGame || !isYouPlayer) && <div style={{ flex: 1 }} />}

          {/* Buttons on the right, in a stable group */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: 6,
              border: "1px solid #eee",
              borderRadius: 6,
              background: "#fafafa",
            }}
          >
            <button
              onClick={() =>
                socket.emit("nextStep", { gameId: safeView?.id })
              }
              disabled={!canAdvanceStep}
            >
              Next Step
            </button>
            <button
              onClick={() =>
                socket.emit("nextTurn", { gameId: safeView?.id })
              }
              disabled={!canAdvanceTurn}
            >
              Next Turn
            </button>
            <button
              onClick={() =>
                socket.emit("passPriority", {
                  gameId: safeView?.id,
                  by: you,
                })
              }
              disabled={!canPass}
            >
              Pass Priority
            </button>
            <button
              onClick={handleToggleAutoAdvance}
              style={{
                background: autoAdvancePhases ? '#10b981' : '#6b7280',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: 11,
              }}
              title="Auto-advance through untap/cleanup phases (reduces manual clicking)"
            >
              {autoAdvancePhases ? '⚡ Auto' : '⚡ Manual'}
            </button>
            <button
              onClick={handleRequestUndo}
              disabled={!isYouPlayer}
              style={{
                background: '#6b7280',
                marginLeft: 8,
              }}
              title="Request to undo the last action (requires all players to approve)"
            >
              ⏪ Undo
            </button>
          </div>
        </div>

        {/* IMPORT WARNINGS */}
        {missingImport && missingImport.length > 0 && (
          <div
            style={{
              background: "#fff6d5",
              padding: 10,
              border: "1px solid #f1c40f",
              borderRadius: 6,
            }}
          >
            <strong>Import warning</strong>: Could not resolve these names:{" "}
            {missingImport.slice(0, 10).join(", ")}
            {missingImport.length > 10 ? ", …" : ""}.
            <button
              onClick={() => setMissingImport(null)}
              style={{ marginLeft: 12 }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* DECK IMPORT PROMPT - Shows when player joins without a deck */}
        {showDeckImportPrompt && isPreGame && (
          <div
            style={{
              background: "linear-gradient(135deg, #1e40af 0%, #7c3aed 100%)",
              padding: 16,
              borderRadius: 8,
              marginBottom: 8,
              border: "1px solid #60a5fa",
              boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ fontSize: 32 }}>📚</div>
            <div style={{ flex: 1, color: "#fff" }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                Welcome to the game!
              </div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                Import a deck to get started. You can paste a decklist or load a saved deck.
              </div>
            </div>
            <button
              onClick={() => {
                setShowDeckImportPrompt(false);
                // Note: The deck manager is inside TableLayout - we can signal to open it
                // by scrolling down or via a ref/callback
              }}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 6,
                padding: "8px 16px",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
            <button
              onClick={() => {
                setShowDeckImportPrompt(false);
                // Open the deck manager via state callback
                setTableDeckMgrOpen(true);
              }}
              style={{
                background: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                color: "#1e40af",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Import Deck →
            </button>
          </div>
        )}

        {/* TABLE / PLAYING FIELD (chat handled as overlay inside TableLayout) */}
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 6,
            padding: 8,
          }}
        >
          {safeView ? (
            <TableLayout
              players={safeView.players}
              permanentsByPlayer={
                new Map(
                  (safeView.players || []).map((p: any) => [
                    p.id,
                    (safeView.battlefield || []).filter(
                      (perm: any) => perm.controller === p.id
                    ),
                  ])
                )
              }
              imagePref={imagePref}
              isYouPlayer={isYouPlayer}
              splitLands
              enableReorderForYou={isYouPlayer}
              you={you || undefined}
              zones={safeView.zones}
              commandZone={safeView.commandZone as any}
              format={String(safeView.format || "")}
              showYourHandBelow
              onReorderHand={(order) =>
                safeView &&
                socket.emit("reorderHand", {
                  gameId: safeView.id,
                  order,
                })
              }
              onShuffleHand={() =>
                safeView &&
                socket.emit("shuffleHand", { gameId: safeView.id })
              }
              onRemove={(id) =>
                safeView &&
                socket.emit("removePermanent", {
                  gameId: safeView.id,
                  permanentId: id,
                })
              }
              onCounter={(id, kind, delta) =>
                safeView &&
                socket.emit("updateCounters", {
                  gameId: safeView.id,
                  permanentId: id,
                  deltas: { [kind]: delta },
                })
              }
              onBulkCounter={(ids, deltas) =>
                safeView &&
                socket.emit("updateCountersBulk", {
                  gameId: safeView.id,
                  updates: ids.map((id) => ({ permanentId: id, deltas })),
                })
              }
              onPlayLandFromHand={(cardId) =>
                safeView &&
                socket.emit("playLand", { gameId: safeView.id, cardId })
              }
              onCastFromHand={(cardId) => {
                if (!safeView || !you) return;
                // Find the card in hand to get its name and mana cost
                const zones = safeView.zones?.[you];
                const hand = zones?.hand || [];
                const card = hand.find((c: any) => c?.id === cardId) as KnownCardRef | undefined;
                if (!card) return;
                
                // Check if this is a split/adventure/modal card that needs face selection
                const layout = (card as any).layout || '';
                const cardFaces = (card as any).card_faces as CardFace[] | undefined;
                const hasFaces = cardFaces && cardFaces.length >= 2;
                const needsFaceChoice = hasFaces && (
                  layout === 'split' || 
                  layout === 'adventure' || 
                  layout === 'modal_dfc' ||
                  layout === 'transform'
                );
                
                if (needsFaceChoice && cardFaces) {
                  // Check if the card has fuse ability
                  const oracleText = ((card as any).oracle_text || '').toLowerCase();
                  const canFuse = layout === 'split' && oracleText.includes('fuse');
                  
                  // Build face options
                  const faces: CardFaceOption[] = cardFaces.map((face, idx) => ({
                    id: `face_${idx}`,
                    name: face.name || `Face ${idx + 1}`,
                    manaCost: face.mana_cost,
                    typeLine: face.type_line,
                    oracleText: face.oracle_text,
                    imageUrl: face.image_uris?.small || face.image_uris?.normal,
                    // For adventure cards, the creature (first face) is the default
                    isDefault: layout === 'adventure' && idx === 0,
                  }));
                  
                  // Show split card choice modal
                  setSplitCardData({
                    cardId,
                    cardName: card.name || 'Card',
                    layout,
                    faces,
                    canFuse,
                  });
                  setSplitCardModalOpen(true);
                } else {
                  // Regular card - go directly to payment modal
                  setSpellToCast({
                    cardId,
                    cardName: (card as any).name || 'Card',
                    manaCost: (card as any).mana_cost,
                  });
                  setCastSpellModalOpen(true);
                }
              }}
              onCastCommander={handleCastCommander}
              reasonCannotPlayLand={reasonCannotPlayLand}
              reasonCannotCast={reasonCannotCast}
              threeD={undefined}
              enablePanZoom
              tableCloth={{ imageUrl: "" }}
              worldSize={12000}
              onUpdatePermPos={(id, x, y, z) =>
                safeView &&
                socket.emit("updatePermanentPos", {
                  gameId: safeView.id,
                  permanentId: id,
                  x,
                  y,
                  z,
                })
              }
              onImportDeckText={(txt, nm) => requestImportDeck(txt, nm)}
              onUseSavedDeck={(deckId) => requestUseSavedDeck(deckId)}
              onLocalImportConfirmChange={handleLocalImportConfirmChange}
              externalDeckMgrOpen={tableDeckMgrOpen}
              onDeckMgrOpenChange={setTableDeckMgrOpen}
              gameId={safeView.id}
              stackItems={safeView.stack as any}
              importedCandidates={importedCandidates}
              chatMessages={chat}
              onSendChat={sendChat}
              chatView={view || undefined}
              chatYou={you || undefined}
              priority={safeView.priority}
              phase={String(safeView.phase || '')}
              step={String(safeView.step || '')}
              turnPlayer={safeView.turnPlayer}
            />
          ) : (
            <div style={{ padding: 20, color: "#666" }}>
              No game state yet. Join a game to view table.
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: currently unused (no Quick Actions / Zones) */}
      <div />

      <CardPreviewLayer />

      {/* Phase Navigator - Floating component for quick phase navigation */}
      {safeView && you && (
        <PhaseNavigator
          currentPhase={safeView.phase}
          currentStep={safeView.step}
          turnPlayer={safeView.turnPlayer}
          you={you}
          isYourTurn={safeView.turnPlayer === you}
          hasPriority={safeView.priority === you}
          stackEmpty={!((safeView as any).stack?.length > 0)}
          onNextStep={() => socket.emit("nextStep", { gameId: safeView.id })}
          onPassPriority={() => socket.emit("passPriority", { gameId: safeView.id, by: you })}
        />
      )}

      {/* Commander selection UI */}
      {effectiveGameId &&
        cmdModalOpen &&
        cmdSuggestedGameId === effectiveGameId &&
        (showCommanderGallery ? (
          <CommanderSelectModal
            open={cmdModalOpen}
            onClose={() => setCmdModalOpen(false)}
            deckList={importedCandidates.map((c) => c.name).join("\n")}
            candidates={importedCandidates}
            max={2}
            onConfirm={(names, ids) => {
              handleCommanderConfirm(names, ids);
              setCmdModalOpen(false);
            }}
          />
        ) : (
          <CommanderConfirmModal
            open={cmdModalOpen}
            gameId={effectiveGameId}
            initialNames={cmdSuggestedNames}
            onClose={() => setCmdModalOpen(false)}
            onConfirm={(names) => {
              handleCommanderConfirm(names);
              setCmdModalOpen(false);
            }}
          />
        ))}

      {/* Debug modal */}
      {debugOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            zIndex: 6000,
          }}
        >
          <div
            style={{
              width: 900,
              maxHeight: "80vh",
              overflow: "auto",
              background: "#1e1e1e",
              color: "#fff",
              padding: 12,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>Debug Output</strong>
              <div>
                <button
                  onClick={() => {
                    setDebugOpen(false);
                  }}
                >
                  Close
                </button>
                <button
                  onClick={() => fetchDebug()}
                  disabled={debugLoading}
                  style={{ marginLeft: 8 }}
                >
                  Refresh
                </button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {debugLoading ? (
                <div>Loading...</div>
              ) : (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 11,
                  }}
                >
                  {JSON.stringify(debugData, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import / Judge confirmation modal */}
      {confirmOpen && confirmPayload && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            zIndex: 7000,
          }}
        >
          <div
            style={{
              width: 560,
              background: "#1e1e1e",
              color: "#fff",
              padding: 16,
              borderRadius: 8,
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              {confirmPayload.kind === "judge"
                ? "Judge request"
                : "Confirm importing deck (wipes table)"}
            </h3>
            <div
              style={{
                fontSize: 13,
                opacity: 0.9,
                marginBottom: 8,
              }}
            >
              {confirmPayload.kind === "judge" ? (
                <>
                  Player <strong>{confirmPayload.initiator}</strong> is
                  requesting to become judge (full hand visibility). All active
                  players must approve.
                </>
              ) : (
                <>
                  Player <strong>{confirmPayload.initiator}</strong> is
                  importing a deck
                  {confirmPayload.deckName
                    ? `: ${confirmPayload.deckName}`
                    : ""}
                  .
                </>
              )}
            </div>

            {confirmPayload.kind !== "judge" && (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <div>Resolved cards: {confirmPayload.resolvedCount}</div>
                <div>Declared deck size: {confirmPayload.expectedCount}</div>
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Votes</div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {confirmVotes ? (
                  Object.entries(confirmVotes).map(([pid, v]) => (
                    <div
                      key={pid}
                      style={{
                        padding: 8,
                        background: "#0f0f0f",
                        borderRadius: 6,
                        minWidth: 120,
                      }}
                    >
                      <div style={{ fontSize: 12 }}>
                        {safeView?.players?.find((p: any) => p.id === pid)
                          ?.name ?? pid}
                        {pid === you ? " (you)" : ""}
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          color:
                            v === "yes"
                              ? "#8ef58e"
                              : v === "no"
                              ? "#f58e8e"
                              : "#ddd",
                        }}
                      >
                        {v}
                      </div>
                    </div>
                  ))
                ) : (
                  <div>No votes yet</div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                onClick={() => {
                  // only dismiss locally; actual cancel must come from server
                  // to keep everyone in sync
                }}
              >
                Dismiss
              </button>
              <button
                onClick={() => respondToConfirm(false)}
                style={{ background: "#a00", color: "#fff" }}
              >
                Decline
              </button>
              <button
                onClick={() => respondToConfirm(true)}
                style={{ background: "#0a8", color: "#fff" }}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scry/Surveil */}
      {peek && (
        <ScrySurveilModal
          mode={peek.mode}
          cards={peek.cards}
          imagePref={imagePref}
          onCancel={() => setPeek(null)}
          onConfirm={(res) => {
            if (!view) return;
            if (peek.mode === "scry")
              socket.emit("confirmScry", {
                gameId: view.id,
                keepTopOrder: res.keepTopOrder,
                bottomOrder: res.bottomOrder || [],
              });
            else
              socket.emit("confirmSurveil", {
                gameId: view.id,
                toGraveyard: res.toGraveyard || [],
                keepTopOrder: res.keepTopOrder,
              });
            setPeek(null);
          }}
        />
      )}

      {/* Name-in-use */}
      <NameInUseModal
        open={showNameInUseModal}
        payload={nameInUsePayload}
        onClose={() => {
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
        onReconnect={(fixedPlayerId: string, seatToken?: string) => {
          const gid = nameInUsePayload?.gameId || gameIdInput;
          const pname = nameInUsePayload?.playerName || nameInput;
          const token =
            seatToken ??
            sessionStorage.getItem(`mtgedh:seatToken:${gid}:${pname}`);
          // eslint-disable-next-line no-console
          console.debug("[JOIN_EMIT] reconnect click", {
            gameId: gid,
            playerName: pname,
            fixedPlayerId,
            seatToken: token,
          });
          socket.emit("joinGame", {
            gameId: gid,
            playerName: pname,
            spectator: joinAsSpectator,
            seatToken: token,
            fixedPlayerId,
          });
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
        onNewName={(newName: string) => {
          const gid = nameInUsePayload?.gameId || gameIdInput;
          setNameInput(newName);
          const token =
            sessionStorage.getItem(
              `mtgedh:seatToken:${gid}:${newName}`
            ) || undefined;
          // eslint-disable-next-line no-console
          console.debug("[JOIN_EMIT] new-name join", {
            gameId: gid,
            playerName: newName,
            seatToken: token,
          });
          socket.emit("joinGame", {
            gameId: gid,
            playerName: newName,
            spectator: joinAsSpectator,
            seatToken: token,
          });
          setShowNameInUseModal(false);
          setNameInUsePayload(null);
        }}
      />

      {/* Cast Spell Payment Modal */}
      <CastSpellModal
        open={castSpellModalOpen}
        cardName={spellToCast?.cardName || ''}
        manaCost={spellToCast?.manaCost}
        availableSources={you ? getAvailableManaSourcesForPlayer(you) : []}
        otherCardsInHand={useMemo(() => {
          if (!safeView || !you || !spellToCast) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          // Filter out the card being cast and lands
          return hand
            .filter((c: any) => c?.id !== spellToCast.cardId && c?.name && !(/\bland\b/i.test(c?.type_line || '')))
            .map((c: any) => ({
              id: c.id,
              name: c.name,
              mana_cost: c.mana_cost
            }));
        }, [safeView, you, spellToCast])}
        onConfirm={handleCastSpellConfirm}
        onCancel={handleCastSpellCancel}
      />

      {/* Create Game Modal */}
      <CreateGameModal
        open={createGameModalOpen}
        onClose={() => setCreateGameModalOpen(false)}
        onCreateGame={handleCreateGame}
        savedDecks={savedDecks}
        onRefreshDecks={refreshSavedDecks}
      />

      {/* Standalone Deck Builder Modal */}
      <DeckManagerModal
        open={deckBuilderOpen}
        onClose={() => setDeckBuilderOpen(false)}
        onImportText={(text, name) => {
          // In standalone mode, we just close the modal
          // The deck is saved locally or to server within the modal
          setDeckBuilderOpen(false);
        }}
        gameId={undefined}
        canServer={false}
        wide
      />

      {/* Combat Selection Modal */}
      <CombatSelectionModal
        open={combatModalOpen}
        mode={combatMode}
        availableCreatures={myCreatures}
        attackingCreatures={attackingCreatures}
        defenders={defenders}
        onConfirm={(selections) => {
          if (combatMode === 'attackers') {
            handleDeclareAttackers(selections as AttackerSelection[]);
          } else {
            handleDeclareBlockers(selections as BlockerSelection[]);
          }
        }}
        onSkip={handleSkipCombat}
        onCancel={() => setCombatModalOpen(false)}
      />

      {/* Shock Land Choice Modal */}
      <ShockLandChoiceModal
        open={shockLandModalOpen}
        cardName={shockLandData?.cardName || ''}
        cardImageUrl={shockLandData?.imageUrl}
        currentLife={shockLandData?.currentLife}
        onPayLife={handleShockLandPayLife}
        onEnterTapped={handleShockLandTapped}
      />

      {/* Bounce Land Choice Modal */}
      <BounceLandChoiceModal
        open={bounceLandModalOpen}
        bounceLandName={bounceLandData?.bounceLandName || ''}
        bounceLandImageUrl={bounceLandData?.imageUrl}
        landsToChoose={bounceLandData?.landsToChoose || []}
        onSelectLand={handleBounceLandSelect}
      />

      {/* Triggered Ability Modal */}
      <TriggeredAbilityModal
        open={triggerModalOpen}
        triggers={pendingTriggers}
        onResolve={handleResolveTrigger}
        onSkip={handleSkipTrigger}
      />

      {/* Mulligan Bottom Selection Modal (London Mulligan) */}
      <MulliganBottomModal
        open={mulliganBottomModalOpen}
        hand={useMemo(() => {
          if (!safeView || !you) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          return hand.filter((c: any) => c && c.name) as KnownCardRef[];
        }, [safeView, you])}
        cardsToBottom={mulliganBottomCount}
        onConfirm={(cardIds) => {
          if (safeView) {
            socket.emit("mulliganPutToBottom", { gameId: safeView.id, cardIds });
          }
          setMulliganBottomModalOpen(false);
          setMulliganBottomCount(0);
        }}
        onCancel={() => {
          // Can't cancel - must select cards
          // But allow closing to re-open later if needed
          setMulliganBottomModalOpen(false);
        }}
      />

      {/* Cleanup Step Discard Selection Modal */}
      <DiscardSelectionModal
        open={discardModalOpen}
        hand={useMemo(() => {
          if (!safeView || !you) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          return hand.filter((c: any) => c && c.name) as KnownCardRef[];
        }, [safeView, you])}
        discardCount={discardCount}
        maxHandSize={discardMaxHandSize}
        onConfirm={(cardIds) => {
          if (safeView) {
            socket.emit("cleanupDiscard", { gameId: safeView.id, cardIds });
          }
          setDiscardModalOpen(false);
          setDiscardCount(0);
        }}
      />

      {/* Opening Hand Actions Modal (Leylines) */}
      <OpeningHandActionsModal
        open={openingHandActionsModalOpen}
        hand={useMemo(() => {
          if (!safeView || !you) return [];
          const zones = safeView.zones?.[you];
          const hand = zones?.hand || [];
          return hand.filter((c: any) => c && c.name) as KnownCardRef[];
        }, [safeView, you])}
        onConfirm={handleOpeningHandActionsConfirm}
        onSkip={handleOpeningHandActionsSkip}
      />

      {/* Library Search Modal (Tutors) */}
      <LibrarySearchModal
        open={librarySearchModalOpen}
        cards={librarySearchData?.cards || []}
        playerId={librarySearchData?.targetPlayerId || you || ''}
        title={librarySearchData?.title || 'Search Library'}
        description={librarySearchData?.description}
        filter={librarySearchData?.filter}
        maxSelections={librarySearchData?.maxSelections || 1}
        moveTo={librarySearchData?.moveTo || 'hand'}
        shuffleAfter={librarySearchData?.shuffleAfter ?? true}
        onConfirm={handleLibrarySearchConfirm}
        onCancel={handleLibrarySearchCancel}
      />

      {/* Target Selection Modal */}
      <TargetSelectionModal
        open={targetModalOpen}
        title={targetModalData?.title || 'Select Targets'}
        description={targetModalData?.description}
        source={targetModalData?.source}
        targets={targetModalData?.targets || []}
        minTargets={targetModalData?.minTargets ?? 1}
        maxTargets={targetModalData?.maxTargets ?? 1}
        onConfirm={handleTargetConfirm}
        onCancel={handleTargetCancel}
      />

      {/* Undo Request Modal */}
      <UndoRequestModal
        open={undoModalOpen}
        you={you || ''}
        request={undoRequestData}
        onApprove={handleUndoApprove}
        onReject={handleUndoReject}
        onCancel={handleUndoCancel}
      />

      {/* Split/Adventure Card Choice Modal */}
      <SplitCardChoiceModal
        open={splitCardModalOpen}
        cardName={splitCardData?.cardName || ''}
        layout={splitCardData?.layout || ''}
        faces={splitCardData?.faces || []}
        canFuse={splitCardData?.canFuse}
        onChoose={handleSplitCardChoose}
        onCancel={handleSplitCardCancel}
      />

      {/* Deck Validation Status */}
      {deckValidation && !deckValidation.valid && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 8,
            padding: '12px 16px',
            zIndex: 9000,
            maxWidth: 400,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: '#dc2626' }}>
              ⚠️ Deck Validation Issues
            </span>
            <button
              onClick={() => setDeckValidation(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#7f1d1d' }}>
            {deckValidation.illegal.slice(0, 3).map((i, idx) => (
              <div key={idx}>• {i.name}: {i.reason}</div>
            ))}
            {deckValidation.illegal.length > 3 && (
              <div>...and {deckValidation.illegal.length - 3} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;