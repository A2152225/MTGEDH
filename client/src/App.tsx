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
import { SacrificeUnlessPayModal } from "./components/SacrificeUnlessPayModal";
import { TriggeredAbilityModal, type TriggerPromptData } from "./components/TriggeredAbilityModal";
import { MulliganBottomModal } from "./components/MulliganBottomModal";
import { DiscardSelectionModal } from "./components/DiscardSelectionModal";
import { OpeningHandActionsModal } from "./components/OpeningHandActionsModal";
import { LibrarySearchModal } from "./components/LibrarySearchModal";
import { TargetSelectionModal, type TargetOption } from "./components/TargetSelectionModal";
import { UndoRequestModal, type UndoRequestData } from "./components/UndoRequestModal";
import { SplitCardChoiceModal, type CardFaceOption } from "./components/SplitCardChoiceModal";
import { CreatureTypeSelectModal } from "./components/CreatureTypeSelectModal";
import { AppearanceSettingsModal } from "./components/AppearanceSettingsModal";
import { GraveyardViewModal } from "./components/GraveyardViewModal";
import { JoinForcesModal, type JoinForcesRequest } from "./components/JoinForcesModal";
import { TemptingOfferModal, type TemptingOfferRequest } from "./components/TemptingOfferModal";
import { type ImagePref } from "./components/BattlefieldGrid";
import GameList from "./components/GameList";
import { useGameSocket } from "./hooks/useGameSocket";
import type { PaymentItem, ManaColor } from "../../shared/src";
import { GameStatusIndicator } from "./components/GameStatusIndicator";
import { CreateGameModal, type GameCreationConfig } from "./components/CreateGameModal";
import { PhaseNavigator } from "./components/PhaseNavigator";
import { DeckManagerModal } from "./components/DeckManagerModal";
import {
  type AppearanceSettings,
  loadAppearanceSettings,
  saveAppearanceSettings,
} from "./utils/appearanceSettings";
import { IgnoredTriggersPanel } from "./components/IgnoredTriggersPanel";
import { PriorityModal } from "./components/PriorityModal";
import { AutoPassSettingsPanel } from "./components/AutoPassSettingsPanel";

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

  // Appearance settings state (cached in localStorage)
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(
    () => loadAppearanceSettings()
  );
  const [appearanceModalOpen, setAppearanceModalOpen] = useState(false);

  // Handle appearance settings update
  const handleAppearanceSettingsApply = (settings: AppearanceSettings) => {
    setAppearanceSettings(settings);
    // Already saved in modal, but ensure sync
    saveAppearanceSettings(settings);
  };

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
  
  // Sacrifice unless pay modal state (Transguild Promenade, Gateway Plaza, etc.)
  const [sacrificeUnlessPayModalOpen, setSacrificeUnlessPayModalOpen] = useState(false);
  const [sacrificeUnlessPayData, setSacrificeUnlessPayData] = useState<{
    permanentId: string;
    cardName: string;
    manaCost: string;
    imageUrl?: string;
  } | null>(null);
  
  // Triggered ability modal state
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [pendingTriggers, setPendingTriggers] = useState<TriggerPromptData[]>([]);
  // Track sources that the player wants to auto-resolve (shortcut)
  // Map from sourceKey to { sourceName, count, effect }
  const [ignoredTriggerSources, setIgnoredTriggerSources] = useState<Map<string, { 
    sourceName: string; 
    count: number; 
    effect: string;
    imageUrl?: string;
  }>>(new Map());
  
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
  
  // Creature type selection modal state (for Cavern of Souls, Kindred Discovery, etc.)
  const [creatureTypeModalOpen, setCreatureTypeModalOpen] = useState(false);
  const [creatureTypeModalData, setCreatureTypeModalData] = useState<{
    confirmId: string;
    permanentId: string;
    cardName: string;
    reason: string;
  } | null>(null);
  
  // Sacrifice selection modal state (for Grave Pact, Dictate of Erebos, etc.)
  const [sacrificeModalOpen, setSacrificeModalOpen] = useState(false);
  const [sacrificeModalData, setSacrificeModalData] = useState<{
    triggerId: string;
    sourceName: string;
    sourceController: string;
    reason: string;
    creatures: Array<{
      id: string;
      name: string;
      imageUrl?: string;
      typeLine?: string;
    }>;
  } | null>(null);
  
  // Undo request modal state
  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [undoRequestData, setUndoRequestData] = useState<UndoRequestData | null>(null);
  const [undoCount, setUndoCount] = useState<number>(1); // Number of actions to undo
  const [availableUndoCount, setAvailableUndoCount] = useState<number>(0); // Available events to undo
  
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
  // Track if we've already auto-skipped attackers for this combat step
  const hasAutoSkippedAttackers = React.useRef<string | null>(null);
  // Track if we've already shown the attackers modal for this combat step (prevents re-opening after selection)
  const hasShownAttackersModal = React.useRef<string | null>(null);
  // External control for deck manager visibility in TableLayout
  const [tableDeckMgrOpen, setTableDeckMgrOpen] = useState(false);
  
  // Graveyard View Modal state
  const [graveyardModalOpen, setGraveyardModalOpen] = useState(false);
  const [graveyardModalPlayerId, setGraveyardModalPlayerId] = useState<string | null>(null);
  
  // Join Forces Modal state (Collective Voyage, Minds Aglow, etc.)
  const [joinForcesModalOpen, setJoinForcesModalOpen] = useState(false);
  const [joinForcesRequest, setJoinForcesRequest] = useState<JoinForcesRequest | null>(null);
  const [joinForcesContributions, setJoinForcesContributions] = useState<Record<string, number>>({});
  const [joinForcesResponded, setJoinForcesResponded] = useState<string[]>([]);
  
  // Tempting Offer Modal state (Tempt with Reflections, Tempt with Discovery, etc.)
  const [temptingOfferModalOpen, setTemptingOfferModalOpen] = useState(false);
  const [temptingOfferRequest, setTemptingOfferRequest] = useState<TemptingOfferRequest | null>(null);
  const [temptingOfferResponded, setTemptingOfferResponded] = useState<string[]>([]);
  const [temptingOfferAcceptedBy, setTemptingOfferAcceptedBy] = useState<string[]>([]);

  // Priority Modal state - shows when player receives priority on step changes
  const [priorityModalOpen, setPriorityModalOpen] = useState(false);
  const lastPriorityStep = React.useRef<string | null>(null);
  
  // Auto-pass steps - which steps to automatically pass priority on
  const [autoPassSteps, setAutoPassSteps] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mtgedh:autoPassSteps');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch { /* ignore */ }
    return new Set();
  });
  
  // Toggle auto-pass for a specific step
  const handleToggleAutoPass = React.useCallback((step: string, enabled: boolean) => {
    setAutoPassSteps(prev => {
      const next = new Set(prev);
      if (enabled) {
        next.add(step);
      } else {
        next.delete(step);
      }
      try {
        localStorage.setItem('mtgedh:autoPassSteps', JSON.stringify([...next]));
      } catch { /* ignore */ }
      return next;
    });
  }, []);
  
  // Clear all auto-pass settings
  const handleClearAllAutoPass = React.useCallback(() => {
    setAutoPassSteps(new Set());
    try {
      localStorage.removeItem('mtgedh:autoPassSteps');
    } catch { /* ignore */ }
  }, []);

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
  
  // Track when PhaseNavigator is actively advancing through phases
  // This prevents auto-advance from interfering with manual phase navigation
  const [phaseNavigatorAdvancing, setPhaseNavigatorAdvancing] = useState(false);

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
    const stackLength = (safeView as any).stack?.length || 0;
    const turnId = `${safeView.turn}-${step}`; // Unique ID for this combat step
    
    // Only show attacker modal on your turn during declare attackers step
    if (step === "declareattackers" || step === "declare_attackers") {
      if (isYourTurn) {
        // Don't show the modal if we've already shown it for this step
        if (hasShownAttackersModal.current === turnId) {
          return;
        }
        
        // Check if there are any valid creatures that can attack
        const validAttackers = (safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
          if (p.controller !== you) return false;
          const typeLine = (p.card as KnownCardRef)?.type_line?.toLowerCase() || '';
          if (!typeLine.includes('creature')) return false;
          // Check if creature can attack (not tapped, no summoning sickness unless haste, no defender)
          if (p.tapped) return false;
          return canCreatureAttack(p);
        });
        
        if (validAttackers.length === 0) {
          // No valid attackers - auto-skip declare attackers
          // Only skip if stack is empty and we haven't already skipped for this step
          if (stackLength === 0 && hasAutoSkippedAttackers.current !== turnId) {
            hasAutoSkippedAttackers.current = turnId;
            socket.emit("skipDeclareAttackers", { gameId: safeView.id });
          }
          // Don't show the modal either way
          setCombatModalOpen(false);
        } else {
          setCombatMode('attackers');
          setCombatModalOpen(true);
          hasShownAttackersModal.current = turnId; // Mark that we've shown the modal
        }
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
      // Reset auto-skip tracker when we leave combat steps
      if (hasAutoSkippedAttackers.current) {
        hasAutoSkippedAttackers.current = null;
      }
      // Reset shown attackers modal tracker when we leave combat steps
      if (hasShownAttackersModal.current) {
        hasShownAttackersModal.current = null;
      }
    }
  }, [safeView, you]);

  // Priority modal logic - show when you gain priority on step changes
  React.useEffect(() => {
    if (!safeView || !you) return;
    
    const step = String((safeView as any).step || "").toLowerCase();
    const priority = (safeView as any).priority;
    const youHavePriority = priority === you;
    const stackLength = (safeView as any).stack?.length || 0;
    
    // Only show priority modal when:
    // 1. You have priority
    // 2. The stack is empty (not responding to something)
    // 3. The step changed since last time we showed the modal
    // 4. We're not in a combat modal already
    // 5. Auto-pass is not enabled for this step
    
    const stepKey = step.replace('_', '').toLowerCase();
    const shouldAutoPass = autoPassSteps.has(stepKey) || autoPassSteps.has(step);
    
    if (youHavePriority && stackLength === 0 && !combatModalOpen) {
      // Check if this is a new step
      if (lastPriorityStep.current !== step) {
        lastPriorityStep.current = step;
        
        if (shouldAutoPass) {
          // Auto-pass priority
          socket.emit("passPriority", { gameId: safeView.id, by: you });
          setPriorityModalOpen(false);
        } else {
          // Show priority modal for this step
          // Don't show for main phases (main1, main2, main, postcombat_main) - those are obvious
          const isMainPhase = step.includes('main') || step === 'main1' || step === 'main2';
          if (!isMainPhase) {
            setPriorityModalOpen(true);
          }
        }
      }
    } else {
      // Close priority modal if we don't have priority or stack is not empty
      setPriorityModalOpen(false);
    }
  }, [safeView, you, combatModalOpen, autoPassSteps]);

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

  // Sacrifice unless pay prompt listener (Transguild Promenade, Gateway Plaza, Rupture Spire)
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id) {
        setSacrificeUnlessPayData({
          permanentId: payload.permanentId,
          cardName: payload.cardName,
          manaCost: payload.manaCost,
          imageUrl: payload.imageUrl,
        });
        setSacrificeUnlessPayModalOpen(true);
      }
    };
    socket.on("sacrificeUnlessPayPrompt", handler);
    return () => {
      socket.off("sacrificeUnlessPayPrompt", handler);
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
        const trigger = payload.trigger;
        // Check if this source is in the ignored list (auto-resolve shortcut)
        const sourceKey = trigger.sourceId || trigger.sourceName;
        if (sourceKey && ignoredTriggerSources.has(sourceKey)) {
          // Increment the count for this ignored source
          setIgnoredTriggerSources(prev => {
            const next = new Map(prev);
            const existing = next.get(sourceKey);
            if (existing) {
              next.set(sourceKey, { ...existing, count: existing.count + 1 });
            }
            return next;
          });
          // Auto-resolve this trigger without showing modal
          socket.emit("resolveTrigger", {
            gameId: safeView.id,
            triggerId: trigger.id,
            choice: { accepted: true, autoResolved: true },
          });
          return;
        }
        setPendingTriggers(prev => [...prev, payload.trigger]);
        setTriggerModalOpen(true);
      }
    };
    socket.on("triggerPrompt", handler);
    return () => {
      socket.off("triggerPrompt", handler);
    };
  }, [safeView?.id, ignoredTriggerSources]);

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

  // Creature type selection listener (for Cavern of Souls, Kindred Discovery, etc.)
  React.useEffect(() => {
    const handler = (payload: {
      confirmId: string;
      gameId: string;
      permanentId: string;
      cardName: string;
      reason: string;
    }) => {
      if (payload.gameId === safeView?.id) {
        setCreatureTypeModalData({
          confirmId: payload.confirmId,
          permanentId: payload.permanentId,
          cardName: payload.cardName,
          reason: payload.reason,
        });
        setCreatureTypeModalOpen(true);
      }
    };
    socket.on("creatureTypeSelectionRequest", handler);
    return () => {
      socket.off("creatureTypeSelectionRequest", handler);
    };
  }, [safeView?.id]);

  // Sacrifice selection listener (for Grave Pact, Dictate of Erebos, etc.)
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      triggerId: string;
      sourceName: string;
      sourceController: string;
      reason: string;
      creatures: Array<{
        id: string;
        name: string;
        imageUrl?: string;
        typeLine?: string;
      }>;
    }) => {
      if (payload.gameId === safeView?.id) {
        setSacrificeModalData({
          triggerId: payload.triggerId,
          sourceName: payload.sourceName,
          sourceController: payload.sourceController,
          reason: payload.reason,
          creatures: payload.creatures,
        });
        setSacrificeModalOpen(true);
      }
    };
    socket.on("sacrificeSelectionRequest", handler);
    return () => {
      socket.off("sacrificeSelectionRequest", handler);
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

  // Listen for undo count updates
  React.useEffect(() => {
    const handleUndoCountUpdate = (payload: { gameId: string; eventCount: number }) => {
      if (payload.gameId === safeView?.id) {
        setAvailableUndoCount(payload.eventCount);
      }
    };

    socket.on("undoCountUpdate", handleUndoCountUpdate);

    return () => {
      socket.off("undoCountUpdate", handleUndoCountUpdate);
    };
  }, [safeView?.id]);

  // Request undo count on game state changes (no polling to reduce overhead)
  React.useEffect(() => {
    if (!safeView?.id) return;
    
    // Request undo count on game state change
    socket.emit("getUndoCount", { gameId: safeView.id });
  }, [safeView?.id, safeView?.turn, safeView?.step, safeView?.priority]);

  // Join Forces socket event handlers
  React.useEffect(() => {
    const handleJoinForcesRequest = (payload: JoinForcesRequest) => {
      if (payload.gameId === safeView?.id) {
        setJoinForcesRequest(payload);
        setJoinForcesContributions({});
        setJoinForcesResponded([]);
        setJoinForcesModalOpen(true);
      }
    };
    
    const handleJoinForcesUpdate = (payload: {
      id: string;
      playerId: string;
      contribution: number;
      responded: string[];
      contributions: Record<string, number>;
    }) => {
      if (joinForcesRequest?.id === payload.id) {
        setJoinForcesResponded(payload.responded);
        setJoinForcesContributions(payload.contributions);
      }
    };
    
    const handleJoinForcesComplete = (payload: { id: string }) => {
      if (joinForcesRequest?.id === payload.id) {
        setJoinForcesModalOpen(false);
        setJoinForcesRequest(null);
        setJoinForcesContributions({});
        setJoinForcesResponded([]);
      }
    };
    
    socket.on("joinForcesRequest", handleJoinForcesRequest);
    socket.on("joinForcesUpdate", handleJoinForcesUpdate);
    socket.on("joinForcesComplete", handleJoinForcesComplete);
    
    return () => {
      socket.off("joinForcesRequest", handleJoinForcesRequest);
      socket.off("joinForcesUpdate", handleJoinForcesUpdate);
      socket.off("joinForcesComplete", handleJoinForcesComplete);
    };
  }, [safeView?.id, joinForcesRequest?.id]);

  // Tempting Offer socket event handlers
  React.useEffect(() => {
    const handleTemptingOfferRequest = (payload: TemptingOfferRequest) => {
      if (payload.gameId === safeView?.id) {
        setTemptingOfferRequest(payload);
        setTemptingOfferResponded([]);
        setTemptingOfferAcceptedBy([]);
        setTemptingOfferModalOpen(true);
      }
    };
    
    const handleTemptingOfferUpdate = (payload: {
      id: string;
      playerId: string;
      accepted: boolean;
      responded: string[];
      acceptedBy: string[];
    }) => {
      if (temptingOfferRequest?.id === payload.id) {
        setTemptingOfferResponded(payload.responded);
        setTemptingOfferAcceptedBy(payload.acceptedBy);
      }
    };
    
    const handleTemptingOfferComplete = (payload: { id: string }) => {
      if (temptingOfferRequest?.id === payload.id) {
        setTemptingOfferModalOpen(false);
        setTemptingOfferRequest(null);
        setTemptingOfferResponded([]);
        setTemptingOfferAcceptedBy([]);
      }
    };
    
    socket.on("temptingOfferRequest", handleTemptingOfferRequest);
    socket.on("temptingOfferUpdate", handleTemptingOfferUpdate);
    socket.on("temptingOfferComplete", handleTemptingOfferComplete);
    
    return () => {
      socket.off("temptingOfferRequest", handleTemptingOfferRequest);
      socket.off("temptingOfferUpdate", handleTemptingOfferUpdate);
      socket.off("temptingOfferComplete", handleTemptingOfferComplete);
    };
  }, [safeView?.id, temptingOfferRequest?.id]);

  const isTable = layout === "table";
  const canPass = !!safeView && !!you && safeView.priority === you;
  const isYouPlayer =
    !!safeView && !!you && Array.isArray(safeView.players) && safeView.players.some((p) => p.id === you);

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

  // Show mulligan buttons if player hasn't kept their hand yet
  // This should work even if we've moved past PRE_GAME (e.g., to UNTAP)
  // because the player still needs to keep their hand before continuing
  const needsToKeepHand = isYouPlayer && !hasKeptHand && pendingBottomCount === 0;
  
  // Can mulligan if haven't kept and haven't hit max mulligans
  const canMulligan = needsToKeepHand && mulligansTaken < 6;
  const canKeepHand = needsToKeepHand;
  
  // Show the mulligan UI if in pre-game OR if hand hasn't been kept yet
  const showMulliganUI = (isPreGame || !hasKeptHand) && isYouPlayer;

  // Check if all players have kept their hands
  const allPlayersKeptHands = useMemo(() => {
    if (!safeView) return false;
    const players = safeView.players || [];
    const mulliganStateAll = (safeView as any).mulliganState || {};
    
    for (const player of players) {
      if ((player as any).spectator) continue;
      const state = mulliganStateAll[player.id];
      if (!state || !state.hasKeptHand) {
        return false;
      }
    }
    return players.length > 0;
  }, [safeView]);

  // Check if all players have imported decks (library + hand > 0)
  const allPlayersHaveDecks = useMemo(() => {
    if (!safeView) return false;
    const players = safeView.players || [];
    const zones = safeView.zones || {};
    
    for (const player of players) {
      if ((player as any).spectator) continue;
      const playerZones = zones[player.id];
      const libraryCount = playerZones?.libraryCount ?? 0;
      const handCount = playerZones?.handCount ?? 0;
      if (libraryCount === 0 && handCount === 0) {
        return false;
      }
    }
    return players.length > 0;
  }, [safeView]);

  // Determine reason why phase advancement might be blocked (only during pregame)
  const phaseAdvanceBlockReason = useMemo(() => {
    if (!isPreGame) return null; // Only block during pregame
    if (!allPlayersHaveDecks) return 'Waiting for all players to import decks';
    if (!allPlayersKeptHands) return 'Waiting for all players to keep hands';
    return null;
  }, [isPreGame, allPlayersHaveDecks, allPlayersKeptHands]);

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
    // Don't auto-advance if PhaseNavigator is actively advancing through phases
    // This prevents interference when user clicks to advance to a specific phase
    if (phaseNavigatorAdvancing) return;
    // Only auto-advance if it's our turn and we have priority
    if (safeView.priority !== you) return;
    if (safeView.turnPlayer !== you) return;
    
    // Only auto-advance during certain phases/steps
    const step = String(safeView.step || '').toLowerCase();
    const phase = String(safeView.phase || '').toLowerCase();
    
    // Don't auto-advance if there's something on the stack
    if ((safeView as any).stack?.length > 0) return;
    
    // Don't auto-advance during cleanup if we have pending discard selection
    const isCleanup = step === 'cleanup' || phase.includes('cleanup');
    if (isCleanup && pendingDiscardSelection && pendingDiscardSelection.count > 0) return;
    
    // Phases/steps that can be auto-advanced:
    // - untap step (no player usually needs to respond)
    // - cleanup step (usually just pass unless special abilities like Sundial of the Infinite)
    // Note: Not auto-advancing draw step as the player may want to cast instants after drawing
    const autoAdvanceableSteps = ['untap', 'cleanup'];
    
    // Check if we're in an auto-advance step
    const shouldAutoAdvance = 
      autoAdvanceableSteps.includes(step) ||
      phase.includes('untap') ||
      isCleanup;
    
    if (shouldAutoAdvance) {
      // Small delay to allow any animations/updates
      const timer = setTimeout(() => {
        socket.emit('nextStep', { gameId: safeView.id });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [autoAdvancePhases, safeView, you, phaseNavigatorAdvancing]);

  const canAdvanceStep = useMemo(() => {
    if (!safeView || !you) return false;
    // During pregame, must have all players ready before advancing
    if (isPreGame && (!allPlayersHaveDecks || !allPlayersKeptHands)) return false;
    if (safeView.turnPlayer === you) return true;
    const phaseStr = String(safeView.phase || "").toUpperCase();
    if (phaseStr === "PRE_GAME" && safeView.players?.[0]?.id === you)
      return true;
    return false;
  }, [safeView, you, isPreGame, allPlayersHaveDecks, allPlayersKeptHands]);

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
    
    // Parse mana production from oracle text - handles multiple patterns:
    // 1. Consecutive symbols: "Add {C}{C}" (Sol Ring)
    // 2. Choice patterns: "Add {R}, {G}, or {W}" (Jungle Shrine, tri-lands)
    // 3. Two-color patterns: "Add {W} or {U}" (dual lands like Adarkar Wastes)
    // 4. Multiple add abilities: "Add {C}. Add {B} or {G}." (Llanowar Wastes)
    
    // Find ALL "Add" statements in the oracle text (handles multiple mana abilities)
    const addStatementMatches = text.matchAll(/add\s+([^.]+)/gi);
    const colorSet = new Set<ManaColor>();
    let hasMultiMana = false;
    
    for (const match of addStatementMatches) {
      const addStatement = match[1];
      
      // Extract all mana symbols from this add statement
      const symbolMatches = addStatement.match(/\{[wubrgc]\}/gi) || [];
      
      // Count each symbol type for multi-mana sources like Sol Ring
      const symbolCounts: Record<string, number> = { w: 0, u: 0, b: 0, r: 0, g: 0, c: 0 };
      for (const sym of symbolMatches) {
        const color = sym.replace(/[{}]/g, '').toLowerCase();
        if (color in symbolCounts) {
          symbolCounts[color]++;
        }
      }
      
      // Check if this is a "choice" pattern (has "or" or commas between symbols)
      // or a "multi-mana" pattern (consecutive symbols like {C}{C})
      // Examples:
      // - Choice: "{R}, {G}, or {W}" (Jungle Shrine), "{R} or {G}" (Temple of Abandon)
      // - Multi-mana: "{C}{C}" (Sol Ring), "{G}{G}" (some enchantments)
      const isChoicePattern = addStatement.includes(' or ') || 
                              addStatement.includes(',');
      
      if (isChoicePattern) {
        // For choice patterns, add each unique color once
        if (symbolCounts.w > 0) colorSet.add('W');
        if (symbolCounts.u > 0) colorSet.add('U');
        if (symbolCounts.b > 0) colorSet.add('B');
        if (symbolCounts.r > 0) colorSet.add('R');
        if (symbolCounts.g > 0) colorSet.add('G');
        if (symbolCounts.c > 0) colorSet.add('C');
      } else {
        // For multi-mana patterns (like Sol Ring {C}{C}), add each occurrence
        // This means Sol Ring will have ['C', 'C'] to indicate 2 colorless mana
        for (let i = 0; i < symbolCounts.w; i++) colorSet.add('W');
        for (let i = 0; i < symbolCounts.u; i++) colorSet.add('U');
        for (let i = 0; i < symbolCounts.b; i++) colorSet.add('B');
        for (let i = 0; i < symbolCounts.r; i++) colorSet.add('R');
        for (let i = 0; i < symbolCounts.g; i++) colorSet.add('G');
        // For colorless multi-mana, we need to track duplicates
        if (symbolCounts.c > 1) {
          hasMultiMana = true;
          // Add duplicates to colors array (colorSet only stores unique values)
          for (let i = 0; i < symbolCounts.c; i++) colors.push('C');
        } else if (symbolCounts.c > 0) {
          colorSet.add('C');
        }
      }
    }
    
    // Add all unique colors from the set (avoiding duplicates for choice patterns)
    // But skip if we already added multi-mana colorless directly
    for (const c of colorSet) {
      if (!(c === 'C' && hasMultiMana)) {
        colors.push(c);
      }
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
    const rawKeywords = (card as any).keywords;
    const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
    const rawGrantedAbilities = (perm as any).grantedAbilities;
    const grantedAbilities = Array.isArray(rawGrantedAbilities) ? rawGrantedAbilities : [];
    
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

  // Sacrifice unless pay handlers (Transguild Promenade, Gateway Plaza, etc.)
  const handleSacrificeUnlessPayMana = () => {
    if (!safeView || !sacrificeUnlessPayData) return;
    socket.emit("sacrificeUnlessPayChoice", {
      gameId: safeView.id,
      permanentId: sacrificeUnlessPayData.permanentId,
      payMana: true,
    });
    setSacrificeUnlessPayModalOpen(false);
    setSacrificeUnlessPayData(null);
  };

  const handleSacrificeUnlessPaySacrifice = () => {
    if (!safeView || !sacrificeUnlessPayData) return;
    socket.emit("sacrificeUnlessPayChoice", {
      gameId: safeView.id,
      permanentId: sacrificeUnlessPayData.permanentId,
      payMana: false,
    });
    setSacrificeUnlessPayModalOpen(false);
    setSacrificeUnlessPayData(null);
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

  // Handle "ignore this source" from modal - auto-resolve all future triggers from this source
  const handleIgnoreTriggerSource = (triggerId: string, sourceId: string, sourceName: string) => {
    if (!safeView) return;
    
    // Find the trigger to get its effect and image
    const trigger = pendingTriggers.find(t => t.id === triggerId);
    const effect = trigger?.effect || '';
    const imageUrl = trigger?.imageUrl;
    
    // Add source to ignored map (use sourceId if available, fallback to sourceName)
    const sourceKey = sourceId || sourceName;
    setIgnoredTriggerSources(prev => {
      const next = new Map(prev);
      next.set(sourceKey, { sourceName, count: 1, effect, imageUrl });
      return next;
    });
    
    // Resolve this trigger
    socket.emit("resolveTrigger", {
      gameId: safeView.id,
      triggerId,
      choice: { accepted: true, autoResolved: true },
    });
    
    // Remove this trigger from pending
    setPendingTriggers(prev => prev.filter(t => t.id !== triggerId));
    if (pendingTriggers.length <= 1) {
      setTriggerModalOpen(false);
    }
  };

  // Handle "ignore this source" from stack UI - for triggers already on stack
  const handleIgnoreTriggerSourceFromStack = (sourceId: string, sourceName: string, effect: string, imageUrl?: string) => {
    const sourceKey = sourceId || sourceName;
    setIgnoredTriggerSources(prev => {
      const next = new Map(prev);
      next.set(sourceKey, { sourceName, count: 0, effect, imageUrl });
      return next;
    });
  };

  // Stop ignoring a trigger source
  const handleStopIgnoringSource = (sourceKey: string) => {
    setIgnoredTriggerSources(prev => {
      const next = new Map(prev);
      next.delete(sourceKey);
      return next;
    });
  };

  // Handle ordering of multiple simultaneous triggers
  const handleOrderTriggersConfirm = (orderedTriggerIds: string[]) => {
    if (!safeView) return;
    socket.emit("orderTriggers", {
      gameId: safeView.id,
      orderedTriggerIds,
    });
    // Clear all the ordered triggers from pending
    setPendingTriggers(prev => prev.filter(t => !orderedTriggerIds.includes(t.id)));
    setTriggerModalOpen(false);
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

  const handleRequestUndo = (count: number = 1) => {
    if (!safeView) return;
    // Clamp between 1 and available count (max 50)
    const maxUndo = Math.min(availableUndoCount, 50);
    const actionsToUndo = Math.max(1, Math.min(maxUndo, count));
    socket.emit("requestUndo", {
      gameId: safeView.id,
      actionsToUndo,
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

  // Join Forces contribution handler
  const handleJoinForcesContribute = (amount: number) => {
    if (!safeView || !joinForcesRequest) return;
    socket.emit("contributeJoinForces", {
      gameId: safeView.id,
      joinForcesId: joinForcesRequest.id,
      amount,
    });
  };

  // Tempting Offer response handler
  const handleTemptingOfferRespond = (accept: boolean) => {
    if (!safeView || !temptingOfferRequest) return;
    socket.emit("respondTemptingOffer", {
      gameId: safeView.id,
      temptingOfferId: temptingOfferRequest.id,
      accept,
    });
  };

  // Graveyard view handler
  const handleViewGraveyard = (playerId: string) => {
    setGraveyardModalPlayerId(playerId);
    setGraveyardModalOpen(true);
  };

  // Graveyard ability activation handler
  const handleGraveyardAbility = (cardId: string, abilityId: string, card: KnownCardRef) => {
    if (!safeView) return;
    
    // Emit the graveyard ability activation to the server
    socket.emit("activateGraveyardAbility", {
      gameId: safeView.id,
      cardId,
      abilityId,
      cardName: card.name,
    });
    
    setGraveyardModalOpen(false);
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
    const rawKeywords = (card as any).keywords;
    const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
    const rawGrantedAbilities = (perm as any).grantedAbilities;
    const grantedAbilities = Array.isArray(rawGrantedAbilities) ? rawGrantedAbilities : [];
    
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

  // Get creatures that can block - different rules than attacking
  // Creatures with summoning sickness CAN block
  // Creatures with defender CAN block  
  // Only tapped creatures cannot block
  const myBlockerCreatures = useMemo(() => {
    if (!safeView || !you) return [];
    return (safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
      if (p.controller !== you) return false;
      const typeLine = (p.card as KnownCardRef)?.type_line?.toLowerCase() || '';
      if (!typeLine.includes('creature')) return false;
      // Tapped creatures cannot block
      if (p.tapped) return false;
      // All untapped creatures can block (even with summoning sickness or defender)
      return true;
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
                <button
                  onClick={() => setAppearanceModalOpen(true)}
                  style={{
                    backgroundColor: "#6366f1",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: "4px 12px",
                    cursor: "pointer",
                  }}
                  title="Customize table and play area colors"
                >
                  🎨 Appearance
                </button>
              </div>

              <div style={{ marginTop: 8 }}>
                <GameList onJoin={joinFromList} currentPlayerId={you} />
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
          {/* Mulligan buttons - visible when player needs to keep their hand */}
          {/* Show even after moving past PRE_GAME if hand hasn't been kept */}
          {showMulliganUI && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: 6,
                border: !hasKeptHand && !isPreGame ? "2px solid #e53e3e" : "1px solid #c6a6ff",
                borderRadius: 6,
                background: !hasKeptHand && !isPreGame ? "#fff5f5" : "#f8f0ff",
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
                  {!isPreGame && (
                    <span style={{ fontSize: 12, color: "#e53e3e", fontWeight: 600 }}>
                      ⚠️ Keep your hand to continue!
                    </span>
                  )}
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
                  {/* Random starting player button - only show if no turn player set yet */}
                  {!safeView?.turnPlayer && (
                    <button
                      onClick={() => socket.emit("randomizeStartingPlayer", { gameId: safeView?.id })}
                      style={{
                        background: "#805ad5",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        padding: "4px 12px",
                        cursor: "pointer",
                        marginLeft: 8,
                      }}
                      title="Randomly select which player goes first"
                    >
                      🎲 Random Start
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Spacer to push buttons to the right when no mulligan panel */}
          {!showMulliganUI && <div style={{ flex: 1 }} />}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
              <select
                value={undoCount}
                onChange={(e) => setUndoCount(Number(e.target.value))}
                disabled={!isYouPlayer || availableUndoCount === 0}
                style={{
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: '1px solid #4b5563',
                  background: '#374151',
                  color: '#fff',
                  fontSize: 12,
                  cursor: isYouPlayer && availableUndoCount > 0 ? 'pointer' : 'not-allowed',
                }}
                title={availableUndoCount > 0 ? `Number of actions to undo (${availableUndoCount} available)` : 'No actions to undo'}
              >
                {availableUndoCount > 0 
                  ? Array.from({ length: Math.min(availableUndoCount, 50) }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))
                  : <option value={1}>0</option>
                }
              </select>
              <button
                onClick={() => handleRequestUndo(undoCount)}
                disabled={!isYouPlayer || availableUndoCount === 0}
                style={{
                  background: availableUndoCount > 0 ? '#6b7280' : '#4b5563',
                  opacity: availableUndoCount > 0 ? 1 : 0.5,
                }}
                title={availableUndoCount > 0 
                  ? `Request to undo ${undoCount} action${undoCount > 1 ? 's' : ''} (requires all players to approve)`
                  : 'No actions to undo'
                }
              >
                ⏪ Undo ({availableUndoCount})
              </button>
            </div>
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
              players={safeView.players || []}
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
              life={safeView.life}
              poisonCounters={(safeView as any).poisonCounters}
              experienceCounters={(safeView as any).experienceCounters}
              energyCounters={(safeView as any).energyCounters}
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
              appearanceSettings={appearanceSettings}
              onViewGraveyard={handleViewGraveyard}
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
              ignoredTriggerSources={ignoredTriggerSources}
              onIgnoreTriggerSource={handleIgnoreTriggerSourceFromStack}
              onStopIgnoringSource={handleStopIgnoringSource}
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
          allPlayersReady={allPlayersHaveDecks && allPlayersKeptHands}
          phaseAdvanceBlockReason={phaseAdvanceBlockReason}
          onNextStep={() => socket.emit("nextStep", { gameId: safeView.id })}
          onPassPriority={() => socket.emit("passPriority", { gameId: safeView.id, by: you })}
          onAdvancingChange={setPhaseNavigatorAdvancing}
          onSkipToPhase={(targetPhase, targetStep) => socket.emit("skipToPhase", { gameId: safeView.id, targetPhase, targetStep })}
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

      {/* Appearance Settings Modal */}
      <AppearanceSettingsModal
        open={appearanceModalOpen}
        onClose={() => setAppearanceModalOpen(false)}
        onApply={handleAppearanceSettingsApply}
      />

      {/* Combat Selection Modal */}
      <CombatSelectionModal
        open={combatModalOpen}
        mode={combatMode}
        availableCreatures={combatMode === 'blockers' ? myBlockerCreatures : myCreatures}
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

      {/* Sacrifice Unless Pay Modal (Transguild Promenade, Gateway Plaza, etc.) */}
      <SacrificeUnlessPayModal
        open={sacrificeUnlessPayModalOpen}
        cardName={sacrificeUnlessPayData?.cardName || ''}
        cardImageUrl={sacrificeUnlessPayData?.imageUrl}
        manaCost={sacrificeUnlessPayData?.manaCost || '{1}'}
        onPayMana={handleSacrificeUnlessPayMana}
        onSacrifice={handleSacrificeUnlessPaySacrifice}
      />

      {/* Triggered Ability Modal */}
      <TriggeredAbilityModal
        open={triggerModalOpen}
        triggers={pendingTriggers}
        onResolve={handleResolveTrigger}
        onSkip={handleSkipTrigger}
        onOrderConfirm={handleOrderTriggersConfirm}
        onIgnoreSource={handleIgnoreTriggerSource}
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

      {/* Creature Type Selection Modal */}
      <CreatureTypeSelectModal
        open={creatureTypeModalOpen}
        title={`Choose a Creature Type for ${creatureTypeModalData?.cardName || 'this card'}`}
        description={creatureTypeModalData?.reason}
        cardName={creatureTypeModalData?.cardName}
        onSelect={(creatureType) => {
          if (creatureTypeModalData && safeView?.id) {
            socket.emit("creatureTypeSelected", {
              gameId: safeView.id,
              confirmId: creatureTypeModalData.confirmId,
              creatureType,
            });
            setCreatureTypeModalOpen(false);
            setCreatureTypeModalData(null);
          }
        }}
        onCancel={() => {
          setCreatureTypeModalOpen(false);
          setCreatureTypeModalData(null);
        }}
      />

      {/* Sacrifice Selection Modal (for Grave Pact, Dictate of Erebos, etc.) */}
      <TargetSelectionModal
        open={sacrificeModalOpen}
        title={`Sacrifice a Creature`}
        description={sacrificeModalData ? `${sacrificeModalData.sourceName} triggers: ${sacrificeModalData.reason}` : undefined}
        targets={sacrificeModalData?.creatures.map(c => ({
          id: c.id,
          type: 'permanent' as const,
          name: c.name,
          imageUrl: c.imageUrl,
          typeLine: c.typeLine,
        })) || []}
        minTargets={1}
        maxTargets={1}
        onConfirm={(selectedIds) => {
          if (selectedIds.length > 0 && sacrificeModalData && safeView?.id) {
            socket.emit("sacrificeSelected", {
              gameId: safeView.id,
              triggerId: sacrificeModalData.triggerId,
              permanentId: selectedIds[0],
            });
            setSacrificeModalOpen(false);
            setSacrificeModalData(null);
          }
        }}
        onCancel={() => {
          // Sacrifice is mandatory - inform the user they must select
          alert("You must sacrifice a creature to this triggered ability.");
        }}
      />

      {/* Graveyard View Modal */}
      <GraveyardViewModal
        open={graveyardModalOpen}
        cards={useMemo(() => {
          if (!safeView || !graveyardModalPlayerId) return [];
          const zones = safeView.zones?.[graveyardModalPlayerId];
          const graveyard = zones?.graveyard || [];
          return graveyard.filter((c: any) => c && c.name) as KnownCardRef[];
        }, [safeView, graveyardModalPlayerId])}
        playerId={graveyardModalPlayerId || ''}
        canActivate={you === graveyardModalPlayerId}
        onClose={() => {
          setGraveyardModalOpen(false);
          setGraveyardModalPlayerId(null);
        }}
        onActivateAbility={handleGraveyardAbility}
      />

      {/* Join Forces Modal (Collective Voyage, Minds Aglow, etc.) */}
      <JoinForcesModal
        open={joinForcesModalOpen}
        request={joinForcesRequest}
        currentPlayerId={you || ''}
        playerNames={useMemo(() => {
          const names: Record<string, string> = {};
          if (safeView?.players) {
            for (const p of safeView.players) {
              names[p.id] = p.name || p.id;
            }
          }
          return names;
        }, [safeView?.players])}
        responded={joinForcesResponded}
        contributions={joinForcesContributions}
        availableMana={useMemo(() => {
          if (!safeView || !you) return 0;
          // Count untapped lands as available mana
          const battlefield = safeView.battlefield || [];
          return battlefield.filter((p: any) => 
            p.controller === you && 
            !p.tapped &&
            (p.card?.type_line || '').toLowerCase().includes('land')
          ).length;
        }, [safeView, you])}
        onContribute={handleJoinForcesContribute}
        onClose={() => setJoinForcesModalOpen(false)}
      />

      {/* Tempting Offer Modal (Tempt with Reflections, Tempt with Discovery, etc.) */}
      <TemptingOfferModal
        open={temptingOfferModalOpen}
        request={temptingOfferRequest}
        currentPlayerId={you || ''}
        playerNames={useMemo(() => {
          const names: Record<string, string> = {};
          if (safeView?.players) {
            for (const p of safeView.players) {
              names[p.id] = p.name || p.id;
            }
          }
          return names;
        }, [safeView?.players])}
        responded={temptingOfferResponded}
        acceptedBy={temptingOfferAcceptedBy}
        onRespond={handleTemptingOfferRespond}
        onClose={() => setTemptingOfferModalOpen(false)}
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

      {/* Ignored Triggers Panel - Separate, persistent UI for viewing/managing auto-resolved triggers */}
      <IgnoredTriggersPanel
        ignoredSources={ignoredTriggerSources}
        onStopIgnoring={handleStopIgnoringSource}
        you={you || undefined}
      />

      {/* Priority Modal - Shows when you gain priority on step changes */}
      <PriorityModal
        open={priorityModalOpen}
        step={(safeView as any)?.step || ''}
        phase={(safeView as any)?.phase || ''}
        onTake={() => {
          setPriorityModalOpen(false);
          // Player wants to take action - just close the modal, they can cast from hand/activate abilities
        }}
        onPass={() => {
          setPriorityModalOpen(false);
          if (safeView) {
            socket.emit("passPriority", { gameId: safeView.id });
          }
        }}
        autoPassSteps={autoPassSteps}
        onToggleAutoPass={handleToggleAutoPass}
      />

      {/* Auto-Pass Settings Panel - Always visible when in game, positioned in bottom-right */}
      {safeView && you && (
        <div style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 50,
          maxWidth: 280,
        }}>
          <AutoPassSettingsPanel
            autoPassSteps={autoPassSteps}
            onToggleAutoPass={handleToggleAutoPass}
            onClearAll={handleClearAllAutoPass}
          />
        </div>
      )}
    </div>
  );
}

export default App;