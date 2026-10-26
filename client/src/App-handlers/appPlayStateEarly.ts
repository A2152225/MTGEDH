// Origin parent: client/src/App.tsx
// Cluster moved: early play modal and combat state
// Public entry symbols: useAppPlayStateEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo, useRef, useState } from "react";
import { buildBattlefieldSpellAlternateCosts } from "../utils/battlefieldSpellAlternateCosts";
import type { PaymentCostAdjustment, KnownCardRef } from "../../../shared/src";
import type { ImagePref } from "../components/BattlefieldGrid";
import type { ExploreResult } from "../components/BatchExploreModal";
import type { AlternateCost } from "../components/CastSpellModal";
import type { ExploreCard } from "../components/ExploreModal";
import type { LifeRedistributionPlayer } from "../components/LifeRedistributionModal";
import type { MobilePlaySheet } from "../components/MobilePlaySheets";
import type { OpponentMayPayPrompt } from "../components/OpponentMayPayModal";
import type { ProliferateTarget } from "../components/ProliferateModal";
import type { CardFaceOption } from "../components/SplitCardChoiceModal";
import type { TargetOption, TargetSelectionGroup } from "../components/TargetSelectionModal";
import type { TriggerPromptData } from "../components/TriggeredAbilityModal";
import type { UndoBoundaryPreview, UndoRequestData } from "../components/UndoRequestModal";
import type { AppearanceSettings } from "../utils/appearanceSettings";
import { loadAppearanceSettings, saveAppearanceSettings } from "../utils/appearanceSettings";

export function useAppPlayStateEarly(p: Record<string, any>) {
  const {
    safeView,
    you,
  } = p;
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
    mode: "scry" | "surveil" | "bottom_order";
    cards: any[];
    stepId?: string; // For resolution queue
  } | null>(null);

  // Explore modal state
  const [explorePrompt, setExplorePrompt] = useState<{
    stepId: string; // Resolution queue step id
    permanentId: string;
    permanentName: string;
    revealedCard: ExploreCard;
    isLand: boolean;
  } | null>(null);

  // Batch explore modal state
  const [batchExplorePrompt, setBatchExplorePrompt] = useState<{
    stepId: string; // Resolution queue step id
    explores: ExploreResult[];
  } | null>(null);

  // Optional: resolve batch explore decisions one-by-one client-side, then submit once.
  const [batchExploreIndividual, setBatchExploreIndividual] = useState<{
    stepId: string;
    explores: ExploreResult[];
    index: number;
    decisions: Array<{ permanentId: string; toGraveyard: boolean }>;
  } | null>(null);

  // Opponent may pay modal state
  const [opponentMayPayPrompt, setOpponentMayPayPrompt] = useState<OpponentMayPayPrompt | null>(null);
  const [opponentMayPayStepId, setOpponentMayPayStepId] = useState<string | null>(null);

  const [showNameInUseModal, setShowNameInUseModal] = useState(false);
  const [nameInUsePayload, setNameInUsePayload] = useState<any | null>(null);

  // Cast spell modal state - shared between hand casting and commander casting
  const [castSpellModalOpen, setCastSpellModalOpen] = useState(false);
  const [spellToCast, setSpellToCast] = useState<{ 
    cardId: string; 
    cardName: string; 
    manaCost?: string;
    typeLine?: string;
    isActivatedAbilityPayment?: boolean;
    fromZone?: 'hand' | 'graveyard' | 'exile' | 'library' | 'command';
    oracleText?: string;  // Oracle text for parsing alternate costs (Overload, Flashback, Surge, etc.)
    forcedAlternateCostId?: string;
    title?: string;
    confirmLabel?: string;
    manualFloatingManaSelection?: boolean;
    tax?: number;
    isCommander?: boolean;
    targets?: string[];  // Targets selected via requestCastSpell flow
    effectId?: string;   // Effect ID for MTG-compliant flow
    paymentStepId?: string;
    activatingPermanentId?: string;
    excludeActivatingPermanentFromPayment?: boolean;
    xValue?: number;
    costAdjustment?: PaymentCostAdjustment;
    convokeOptions?: {
      availableCreatures: Array<{
        id: string;
        name: string;
        colors: string[];
        canTapFor: string[];
      }>;
      messages: string[];
    };
    sneakOptions?: {
      availableCreatures: Array<{
        id: string;
        name: string;
        attackTarget: string;
        imageUrl?: string;
      }>;
      messages: string[];
    };
    extraAlternateCosts?: AlternateCost[];
  } | null>(null);
    const battlefieldAlternateCosts = useMemo(() => {
      if (!safeView || !you || !spellToCast) return [] as AlternateCost[];
      return buildBattlefieldSpellAlternateCosts({
        spellToCast,
        controllerId: you,
        battlefield: safeView.battlefield,
        emblems: (safeView as any).emblems,
        lastingEffects: (safeView as any).lastingEffects,
      }) as AlternateCost[];
    }, [safeView, spellToCast, you]);

  const [pendingSpellXSelection, setPendingSpellXSelection] = useState<{
    stepId: string;
    cardName: string;
    description?: string;
    minValue: number;
    maxValue: number;
    xCount?: number;
    affordableXHint?: number;
  } | null>(null);

  // Accordion state for Join / Active Games
  const [joinCollapsed, setJoinCollapsed] = useState(false);

  // Create Game modal state
  const [createGameModalOpen, setCreateGameModalOpen] = useState(false);
  const [savedDecks, setSavedDecks] = useState<any[]>([]);

  // Deck Builder modal state (standalone, outside of game)
  const [deckBuilderOpen, setDeckBuilderOpen] = useState(false);
  const [deckBuilderInitialAction, setDeckBuilderInitialAction] = useState<'random' | null>(null);

  // Combat selection modal state
  const [combatModalOpen, setCombatModalOpen] = useState(false);
  const [combatModalMinimized, setCombatModalMinimized] = useState(false);
  const [combatMode, setCombatMode] = useState<'attackers' | 'blockers'>('attackers');
  const [combatModalReadOnly, setCombatModalReadOnly] = useState(false);
  const [combatModalError, setCombatModalError] = useState<string | null>(null);
  const lastCombatErrorSeenRef = useRef<string | null>(null);
  const [combatPreviewAttackTargets, setCombatPreviewAttackTargets] = useState<Record<string, string> | null>(null);
  const [combatControlModalOpen, setCombatControlModalOpen] = useState(false);
  const [combatControlMode, setCombatControlMode] = useState<'attackers' | 'blockers'>('attackers');
  const combatPreviewEmitTimerRef = useRef<any>(null);
  const combatPreviewPendingRef = useRef<Record<string, string> | null>(null);

  React.useEffect(() => {
    if (safeView) return;
    setCombatModalOpen(false);
    setCombatModalMinimized(false);
    setCombatModalReadOnly(false);
    setCombatModalError(null);
    setCombatControlModalOpen(false);
    setCombatPreviewAttackTargets(null);
  }, [safeView]);
  
  // NOTE: Mox Diamond replacement-effect interaction is now handled by the
  // Resolution Queue via a generic option-choice step.
  
  // Return-controlled-permanent prompt state (currently used by bounce-land choice)
  const [returnControlledPermanentModalOpen, setReturnControlledPermanentModalOpen] = useState(false);
  const [returnControlledPermanentData, setReturnControlledPermanentData] = useState<{
    sourceId: string;
    sourceName: string;
    imageUrl?: string;
    optionsToChoose: Array<{ permanentId: string; cardName: string; imageUrl?: string; tapped?: boolean; leaveBattlefieldReplacementDestination?: 'exile'; leaveBattlefieldReplacementSourceName?: string; leaveBattlefieldReplacementLifeGain?: number }>;
    title?: string;
    subtitle?: string;
    oracleText?: string;
    confirmButtonText?: string;
    stackItemId?: string;
    stepId?: string;  // Resolution queue step ID
  } | null>(null);

  const [hideawayChoiceModalOpen, setHideawayChoiceModalOpen] = useState(false);
  const [hideawayChoiceData, setHideawayChoiceData] = useState<{
    sourceName: string;
    imageUrl?: string;
    cards: Array<{
      cardId: string;
      cardName: string;
      imageUrl?: string;
      attachOptions?: Array<{ cardId: string; cardName: string; imageUrl?: string }>;
    }>;
    title?: string;
    subtitle?: string;
    oracleText?: string;
    confirmButtonText?: string;
    mandatory: boolean;
    stepId?: string;
    pendingDraftCardId?: string;
    attachOptions?: Array<{ cardId: string; cardName: string; imageUrl?: string }>;
  } | null>(null);

  // Proliferate modal state
  const [proliferateModalOpen, setProliferateModalOpen] = useState(false);
  const [proliferateData, setProliferateData] = useState<{
    proliferateId: string;
    sourceName: string;
    imageUrl?: string;
    sourceImageUrl?: string;
    validTargets: ProliferateTarget[];
    stepId?: string; // For resolution queue
  } | null>(null);

  const [lifeRedistributionModalOpen, setLifeRedistributionModalOpen] = useState(false);
  const [lifeRedistributionData, setLifeRedistributionData] = useState<{
    redistributionId: string;
    sourceName: string;
    imageUrl?: string;
    players: LifeRedistributionPlayer[];
    stepId?: string;
  } | null>(null);
  
  // Fateseal modal state
  const [fatesealModalOpen, setFatesealModalOpen] = useState(false);
  const [fatesealData, setFatesealData] = useState<{
    opponentId: string;
    opponentName: string;
    cards: any[];
    stepId: string;
    sourceName: string;
  } | null>(null);
  
  // Clash modal state
  const [clashModalOpen, setClashModalOpen] = useState(false);
  const [clashData, setClashData] = useState<{
    revealedCard: any;
    opponentId?: string;
    stepId: string;
    sourceName: string;
  } | null>(null);
  
  // Vote modal state
  const [voteModalOpen, setVoteModalOpen] = useState(false);
  const [voteData, setVoteData] = useState<{
    voteId: string;
    choices: string[];
    votesSubmitted: any[];
    stepId: string;
    sourceName: string;
  } | null>(null);
  
  // NOTE: sacrifice-unless-pay and reveal-land ETB interactions are now handled
  // by the Resolution Queue via generic option-choice steps.
  
  // Triggered ability modal state
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [pendingTriggers, setPendingTriggers] = useState<TriggerPromptData[]>([]);
  const [triggerOrderStepId, setTriggerOrderStepId] = useState<string | null>(null);
  // Track sources that the player wants to auto-resolve (shortcut)
  // Map from sourceKey to { sourceName, count, effect }
  const [ignoredTriggerSources, setIgnoredTriggerSources] = useState<Map<string, { 
    sourceId?: string;
    sourceName: string; 
    count: number; 
    effect: string;
    imageUrl?: string;
  }>>(new Map());
  
  // Mulligan bottom selection modal state (London Mulligan)
  const [mulliganBottomModalOpen, setMulliganBottomModalOpen] = useState(false);
  const [mulliganBottomCount, setMulliganBottomCount] = useState(0);
  const [mulliganBottomStepId, setMulliganBottomStepId] = useState<string | null>(null);
  const [mulliganBottomLastSubmittedStepId, setMulliganBottomLastSubmittedStepId] = useState<string | null>(null);

   // Cleanup discard selection modal state
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [discardCount, setDiscardCount] = useState(0);
  const [discardMinCount, setDiscardMinCount] = useState(0);
  const [discardMaxCount, setDiscardMaxCount] = useState(0);
  const [discardAnyNumber, setDiscardAnyNumber] = useState(false);
  const [discardMaxHandSize, setDiscardMaxHandSize] = useState(7);
  const [discardCurrentHandSize, setDiscardCurrentHandSize] = useState<number | null>(null);
  const [discardResolutionStepId, setDiscardResolutionStepId] = useState<string | null>(null);
  const [discardResolutionReason, setDiscardResolutionReason] = useState<'cleanup' | 'effect'>('cleanup');
  const [discardResolutionTitle, setDiscardResolutionTitle] = useState<string | null>(null);
  const [discardResolutionDescription, setDiscardResolutionDescription] = useState<string | null>(null);
  const [discardResolutionHand, setDiscardResolutionHand] = useState<KnownCardRef[]>([]);
  
  // Game over notification state
  const [gameOverModalOpen, setGameOverModalOpen] = useState(false);
  const [gameOverData, setGameOverData] = useState<{
    type: 'victory' | 'defeat' | 'eliminated' | 'draw';
    message: string;
    winnerId?: string;
    winnerName?: string;
  } | null>(null);
  
  // Opening hand actions modal state (Leylines)
  const [openingHandActionsModalOpen, setOpeningHandActionsModalOpen] = useState(false);
  const [openingHandActionsStepId, setOpeningHandActionsStepId] = useState<string | null>(null);
  
  // Library search modal state (Tutors)
  const [librarySearchModalOpen, setLibrarySearchModalOpen] = useState(false);
  const [librarySearchData, setLibrarySearchData] = useState<{
    cards: KnownCardRef[];
    nonSelectableCards?: KnownCardRef[];
    revealedCards?: KnownCardRef[];
    castableWhileSearchingCards?: KnownCardRef[];
    title: string;
    description?: string;
    filter?: { types?: string[]; subtypes?: string[]; maxCmc?: number };
    minSelections: number;
    maxSelections: number;
    maxTotalManaValue?: number;
    moveTo: 'hand' | 'battlefield' | 'top' | 'graveyard' | 'exile' | 'split';
    mandatory: boolean;
    shuffleAfter: boolean;
    targetPlayerId?: string; // Whose library we're searching (for Gitaxian Probe, etc.)
    // Split destination props
    splitDestination?: boolean;
    toBattlefield?: number;
    toHand?: number;
    entersTapped?: boolean;
    stepId?: string; // For resolution queue system
  } | null>(null);
  
  // Target selection modal state
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [targetModalData, setTargetModalData] = useState<{
    title: string;
    description?: string;
    source?: { name: string; imageUrl?: string };
    contextSteps?: string[];
    selectedMode?: { name: string; description?: string };
    targets: TargetOption[];
    minTargets: number;
    maxTargets: number;
    costPerTarget?: number;
    targetGroups?: TargetSelectionGroup[];
    perOpponent?: boolean;
    opponents?: Array<{ id: string; name: string }>;
    targetsPerOpponent?: Record<string, TargetOption[]>;
    minTargetsPerOpponent?: number;
    maxTargetsPerOpponent?: number;
    effectId?: string; // For tracking which effect requested the targets
    cardId?: string; // The card that is being targeted for
    // Resolution Queue support
    stepId?: string;
    useResolutionQueue?: boolean;
  } | null>(null);
  
  // Creature type selection modal state (for Cavern of Souls, Kindred Discovery, etc.)
  const [creatureTypeModalOpen, setCreatureTypeModalOpen] = useState(false);
  const [creatureTypeModalData, setCreatureTypeModalData] = useState<{
     permanentId?: string;
    cardName: string;
    reason: string;
     stepId: string;
     mandatory: boolean;
     offeredCreatureTypes?: string[];
  } | null>(null);
  
  // Ability sacrifice selection modal state (for Ashnod's Altar, Phyrexian Altar, Mondrak, etc.)
  // (Legacy abilitySacrificeRequest flow removed; sacrifice-as-cost uses Resolution Queue TARGET_SELECTION)
  
  // Undo request modal state
  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [undoRequestData, setUndoRequestData] = useState<UndoRequestData | null>(null);
  const [availableUndoCount, setAvailableUndoCount] = useState<number>(0); // Available events to undo
  
  // Smart undo counts (step, phase, turn)
  const [smartUndoCounts, setSmartUndoCounts] = useState<{
    stepCount: number;
    phaseCount: number;
    previousPhaseCount: number;
    turnCount: number;
    semanticStepCount?: number;
    semanticPhaseCount?: number;
    previews?: {
      step?: UndoBoundaryPreview;
      phase?: UndoBoundaryPreview;
      previousPhase?: UndoBoundaryPreview;
      turn?: UndoBoundaryPreview;
    };
  }>({ stepCount: 0, phaseCount: 0, previousPhaseCount: 0, turnCount: 0, previews: {} });

  const [undoTurnPhaseTargets, setUndoTurnPhaseTargets] = useState<Array<{
    turnNumber?: number;
    phase: string;
    step?: string;
    turnPlayer?: string;
    turnPlayerName?: string;
    round?: number;
    label: string;
    eventsToUndo: number;
  }>>([]);
  
  // AI control state (for autopilot mode)
  const [aiControlEnabled, setAiControlEnabled] = useState(false);
  const [aiStrategy, setAiStrategy] = useState<string>('basic');
  
  // Split/Adventure card choice modal state
  const [splitCardModalOpen, setSplitCardModalOpen] = useState(false);
  const [splitCardData, setSplitCardData] = useState<{
    cardId: string;
    cardName: string;
    layout: string;
    faces: CardFaceOption[];
    canFuse: boolean;
    sourceZone?: 'hand' | 'graveyard' | 'exile' | 'library' | 'command';
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
  // Track if we've already shown the blockers modal for this defend step (prevents re-opening after selection)
  const hasShownBlockersModal = React.useRef<string | null>(null);
  // External control for deck manager visibility in TableLayout
  const [tableDeckMgrOpen, setTableDeckMgrOpen] = useState(false);
  const [topDeckMgrAnchorEl, setTopDeckMgrAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);
  const [mobilePlaySheet, setMobilePlaySheet] = useState<MobilePlaySheet>(null);
  const [utilityRailCollapsed, setUtilityRailCollapsed] = useState(false);
  const [yourTurnBannerVisible, setYourTurnBannerVisible] = useState(false);
  const previousTurnRef = useRef<{ gameId?: string; turnPlayer?: string | null }>({});

  return {
    imagePref,
    setImagePref,
    layout,
    setLayout,
    appearanceSettings,
    setAppearanceSettings,
    appearanceModalOpen,
    setAppearanceModalOpen,
    handleAppearanceSettingsApply,
    peek,
    setPeek,
    explorePrompt,
    setExplorePrompt,
    batchExplorePrompt,
    setBatchExplorePrompt,
    batchExploreIndividual,
    setBatchExploreIndividual,
    opponentMayPayPrompt,
    setOpponentMayPayPrompt,
    opponentMayPayStepId,
    setOpponentMayPayStepId,
    showNameInUseModal,
    setShowNameInUseModal,
    nameInUsePayload,
    setNameInUsePayload,
    castSpellModalOpen,
    setCastSpellModalOpen,
    spellToCast,
    setSpellToCast,
    battlefieldAlternateCosts,
    pendingSpellXSelection,
    setPendingSpellXSelection,
    joinCollapsed,
    setJoinCollapsed,
    createGameModalOpen,
    setCreateGameModalOpen,
    savedDecks,
    setSavedDecks,
    deckBuilderOpen,
    setDeckBuilderOpen,
    deckBuilderInitialAction,
    setDeckBuilderInitialAction,
    combatModalOpen,
    setCombatModalOpen,
    combatModalMinimized,
    setCombatModalMinimized,
    combatMode,
    setCombatMode,
    combatModalReadOnly,
    setCombatModalReadOnly,
    combatModalError,
    setCombatModalError,
    lastCombatErrorSeenRef,
    combatPreviewAttackTargets,
    setCombatPreviewAttackTargets,
    combatControlModalOpen,
    setCombatControlModalOpen,
    combatControlMode,
    setCombatControlMode,
    combatPreviewEmitTimerRef,
    combatPreviewPendingRef,
    returnControlledPermanentModalOpen,
    setReturnControlledPermanentModalOpen,
    returnControlledPermanentData,
    setReturnControlledPermanentData,
    hideawayChoiceModalOpen,
    setHideawayChoiceModalOpen,
    hideawayChoiceData,
    setHideawayChoiceData,
    proliferateModalOpen,
    setProliferateModalOpen,
    proliferateData,
    setProliferateData,
    lifeRedistributionModalOpen,
    setLifeRedistributionModalOpen,
    lifeRedistributionData,
    setLifeRedistributionData,
    fatesealModalOpen,
    setFatesealModalOpen,
    fatesealData,
    setFatesealData,
    clashModalOpen,
    setClashModalOpen,
    clashData,
    setClashData,
    voteModalOpen,
    setVoteModalOpen,
    voteData,
    setVoteData,
    triggerModalOpen,
    setTriggerModalOpen,
    pendingTriggers,
    setPendingTriggers,
    triggerOrderStepId,
    setTriggerOrderStepId,
    ignoredTriggerSources,
    setIgnoredTriggerSources,
    mulliganBottomModalOpen,
    setMulliganBottomModalOpen,
    mulliganBottomCount,
    setMulliganBottomCount,
    mulliganBottomStepId,
    setMulliganBottomStepId,
    mulliganBottomLastSubmittedStepId,
    setMulliganBottomLastSubmittedStepId,
    discardModalOpen,
    setDiscardModalOpen,
    discardCount,
    setDiscardCount,
    discardMinCount,
    setDiscardMinCount,
    discardMaxCount,
    setDiscardMaxCount,
    discardAnyNumber,
    setDiscardAnyNumber,
    discardMaxHandSize,
    setDiscardMaxHandSize,
    discardCurrentHandSize,
    setDiscardCurrentHandSize,
    discardResolutionStepId,
    setDiscardResolutionStepId,
    discardResolutionReason,
    setDiscardResolutionReason,
    discardResolutionTitle,
    setDiscardResolutionTitle,
    discardResolutionDescription,
    setDiscardResolutionDescription,
    discardResolutionHand,
    setDiscardResolutionHand,
    gameOverModalOpen,
    setGameOverModalOpen,
    gameOverData,
    setGameOverData,
    openingHandActionsModalOpen,
    setOpeningHandActionsModalOpen,
    openingHandActionsStepId,
    setOpeningHandActionsStepId,
    librarySearchModalOpen,
    setLibrarySearchModalOpen,
    librarySearchData,
    setLibrarySearchData,
    targetModalOpen,
    setTargetModalOpen,
    targetModalData,
    setTargetModalData,
    creatureTypeModalOpen,
    setCreatureTypeModalOpen,
    creatureTypeModalData,
    setCreatureTypeModalData,
    undoModalOpen,
    setUndoModalOpen,
    undoRequestData,
    setUndoRequestData,
    availableUndoCount,
    setAvailableUndoCount,
    smartUndoCounts,
    setSmartUndoCounts,
    undoTurnPhaseTargets,
    setUndoTurnPhaseTargets,
    aiControlEnabled,
    setAiControlEnabled,
    aiStrategy,
    setAiStrategy,
    splitCardModalOpen,
    setSplitCardModalOpen,
    splitCardData,
    setSplitCardData,
    deckValidation,
    setDeckValidation,
    showDeckImportPrompt,
    setShowDeckImportPrompt,
    hasPromptedDeckImport,
    hasAutoSkippedAttackers,
    hasShownBlockersModal,
    tableDeckMgrOpen,
    setTableDeckMgrOpen,
    topDeckMgrAnchorEl,
    setTopDeckMgrAnchorEl,
    focusedPlayerId,
    setFocusedPlayerId,
    mobilePlaySheet,
    setMobilePlaySheet,
    utilityRailCollapsed,
    setUtilityRailCollapsed,
    yourTurnBannerVisible,
    setYourTurnBannerVisible,
    previousTurnRef,
  };
}
