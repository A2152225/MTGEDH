import React, { useMemo, useRef, useState, useEffect } from "react";
import { socket } from "./socket";
import type {
  ClientGameView,
  PlayerID,
  KnownCardRef,
  ChatMsg,
  BattlefieldPermanent,
  CardRef,
  ManaPool,
} from "../../shared/src";
import { TableLayout } from "./components/TableLayout";
import { CardPreviewLayer } from "./components/CardPreviewLayer";
import CommanderConfirmModal from "./components/CommanderConfirmModal";
import { CommanderSelectModal } from "./components/CommanderSelectModal";
import NameInUseModal from "./components/NameInUseModal";
import { ZonesPanel } from "./components/ZonesPanel";
import { ScrySurveilModal } from "./components/ScrySurveilModal";
import { FatesealModal } from "./components/FatesealModal";
import { ClashModal } from "./components/ClashModal";
import { VoteModal } from "./components/VoteModal";
import { CastSpellModal } from "./components/CastSpellModal";
import { CombatSelectionModal, type AttackerSelection, type BlockerSelection } from "./components/CombatSelectionModal";
import { BounceLandChoiceModal } from "./components/BounceLandChoiceModal";
import { CardSelectionModal } from "./components/CardSelectionModal";
import { TriggeredAbilityModal, type TriggerPromptData } from "./components/TriggeredAbilityModal";
import { MulliganBottomModal } from "./components/MulliganBottomModal";
import { DiscardSelectionModal } from "./components/DiscardSelectionModal";
import { OpeningHandActionsModal } from "./components/OpeningHandActionsModal";
import { LibrarySearchModal } from "./components/LibrarySearchModal";
import { TargetSelectionModal, type TargetOption } from "./components/TargetSelectionModal";
import { ProliferateModal, type ProliferateTarget } from "./components/ProliferateModal";
import { UndoRequestModal, type UndoRequestData } from "./components/UndoRequestModal";
import { SplitCardChoiceModal, type CardFaceOption } from "./components/SplitCardChoiceModal";
import { CreatureTypeSelectModal } from "./components/CreatureTypeSelectModal";
import { AppearanceSettingsModal } from "./components/AppearanceSettingsModal";
import { LifePaymentModal } from "./components/LifePaymentModal";
import { ManaPaymentTriggerModal } from "./components/ManaPaymentTriggerModal";
import { ColorChoiceModal } from "./components/ColorChoiceModal";
import { CardNameChoiceModal } from "./components/CardNameChoiceModal";
import { AnyColorManaModal } from "./components/AnyColorManaModal";
import { ManaDistributionModal } from "./components/ManaDistributionModal";
import { AdditionalCostModal } from "./components/AdditionalCostModal";
import { SquadCostModal } from "./components/SquadCostModal";
import { PhyrexianManaChoiceModal } from "./components/PhyrexianManaChoiceModal";
import { CastingModeSelectionModal, type CastingMode } from "./components/CastingModeSelectionModal";
import { MDFCFaceSelectionModal, type CardFace } from "./components/MDFCFaceSelectionModal";
import { ModalSpellSelectionModal, type SpellMode } from "./components/ModalSpellSelectionModal";
import { ReplacementEffectOrderModal, type ReplacementEffectItem, type OrderingMode } from "./components/ReplacementEffectOrderModal";
import { ReplacementEffectSettingsPanel } from "./components/ReplacementEffectSettingsPanel";
import { GraveyardViewModal } from "./components/GraveyardViewModal";
import { ExileViewModal } from "./components/ExileViewModal";
import { JoinForcesModal, type JoinForcesRequest } from "./components/JoinForcesModal";
import { TemptingOfferModal, type TemptingOfferRequest } from "./components/TemptingOfferModal";
import { KynaiosChoiceModal, type KynaiosChoiceRequest } from "./components/KynaiosChoiceModal";
import { OptionChoiceModal, type OptionChoiceRequest } from "./components/OptionChoiceModal";
import { TwoPileSplitModal, type TwoPileSplitRequest } from "./components/TwoPileSplitModal";
import { CommanderZoneChoiceModal } from "./components/CommanderZoneChoiceModal";
import { TapUntapTargetModal } from "./components/TapUntapTargetModal";
import { CounterMovementModal } from "./components/CounterMovementModal";
import { StationCreatureSelectionModal, type StationCreature, type StationInfo } from "./components/StationCreatureSelectionModal";
import { PlayerTargetSelectionModal, type PlayerTarget } from "./components/PlayerTargetSelectionModal";
import { PonderModal, type PeekCard, type PonderVariant } from "./components/PonderModal";
import { ExploreModal, type ExploreCard } from "./components/ExploreModal";
import { BatchExploreModal, type ExploreResult } from "./components/BatchExploreModal";
import { CascadeModal } from "./components/CascadeModal";
import { OpponentMayPayModal, type OpponentMayPayPrompt } from "./components/OpponentMayPayModal";
import { MutateTargetModal, type MutateTarget } from "./components/MutateTargetModal";
import { IgnoredCardsPanel, type IgnoredCard, type IgnoredCardZone } from "./components/IgnoredCardsPanel";
import { type ImagePref } from "./components/BattlefieldGrid";
import GameList from "./components/GameList";
import { useGameSocket } from "./hooks/useGameSocket";
import type { PaymentItem, ManaColor, PendingCommanderZoneChoice, TriggerShortcut } from "../../shared/src";
import { GameStatusIndicator } from "./components/GameStatusIndicator";
import { CreateGameModal, type GameCreationConfig } from "./components/CreateGameModal";
import { PhaseNavigator } from "./components/PhaseNavigator";
import { DeckManagerModal } from "./components/DeckManagerModal";
import {
  type AppearanceSettings,
  loadAppearanceSettings,
  saveAppearanceSettings,
  getBackgroundStyle,
  getTextColorsForBackground,
} from "./utils/appearanceSettings";
import { prettyPhase, prettyStep, isLandTypeLine } from "./utils/gameDisplayHelpers";
import { isCurrentlyCreature } from "./utils/creatureUtils";
import { IgnoredTriggersPanel } from "./components/IgnoredTriggersPanel";
import { PriorityModal } from "./components/PriorityModal";
import { AutoPassSettingsPanel } from "./components/AutoPassSettingsPanel";
import { TriggerShortcutsPanel } from "./components/TriggerShortcutsPanel";
import { DraggableSettingsPanel } from "./components/DraggableSettingsPanel";
import { debug, debugWarn, debugError } from "./utils/debug";


/* App component */
export function App() {
  const {
    connected,
    gameIdInput,
    setGameIdInput,
    nameInput,
    setNameInput,

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
    leaveGame,
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
    oracleText?: string;  // Oracle text for parsing alternate costs (Overload, Flashback, Surge, etc.)
    tax?: number;
    isCommander?: boolean;
    targets?: string[];  // Targets selected via requestCastSpell flow
    effectId?: string;   // Effect ID for MTG-compliant flow
    costReduction?: {
      generic: number;
      colors: Record<string, number>;
      messages: string[];
    };
    convokeOptions?: {
      availableCreatures: Array<{
        id: string;
        name: string;
        colors: string[];
        canTapFor: string[];
      }>;
      messages: string[];
    };
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
  const [combatModalError, setCombatModalError] = useState<string | null>(null);
  const lastCombatErrorSeenRef = useRef<string | null>(null);
  
  // NOTE: Mox Diamond replacement-effect interaction is now handled by the
  // Resolution Queue via a generic option-choice step.
  
  // Bounce land choice modal state
  const [bounceLandModalOpen, setBounceLandModalOpen] = useState(false);
  const [bounceLandData, setBounceLandData] = useState<{
    bounceLandId: string;
    bounceLandName: string;
    imageUrl?: string;
    landsToChoose: Array<{ permanentId: string; cardName: string; imageUrl?: string }>;
    stackItemId?: string;
    stepId?: string;  // Resolution queue step ID
  } | null>(null);

  // Commander replacement (Resolution Queue)
  const [resolutionCommanderZoneChoice, setResolutionCommanderZoneChoice] = useState<
    { stepId: string; choice: any } | null
  >(null);
  
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

   // Cleanup discard selection modal state
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [discardCount, setDiscardCount] = useState(0);
  const [discardMaxHandSize, setDiscardMaxHandSize] = useState(7);
  const [discardResolutionStepId, setDiscardResolutionStepId] = useState<string | null>(null);
  const [discardResolutionReason, setDiscardResolutionReason] = useState<'cleanup' | 'effect'>('cleanup');
  const [discardResolutionTitle, setDiscardResolutionTitle] = useState<string | null>(null);
  const [discardResolutionDescription, setDiscardResolutionDescription] = useState<string | null>(null);
  
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
  
  // Library search modal state (Tutors)
  const [librarySearchModalOpen, setLibrarySearchModalOpen] = useState(false);
  const [librarySearchData, setLibrarySearchData] = useState<{
    cards: KnownCardRef[];
    title: string;
    description?: string;
    filter?: { types?: string[]; subtypes?: string[]; maxCmc?: number };
    maxSelections: number;
    moveTo: 'hand' | 'battlefield' | 'top' | 'graveyard' | 'split';
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
    effectId?: string; // For tracking which effect requested the targets
    cardId?: string; // The card that is being targeted for
    // Resolution Queue support
    stepId?: string;
    useResolutionQueue?: boolean;
  } | null>(null);
  
  // Creature type selection modal state (for Cavern of Souls, Kindred Discovery, etc.)
  const [creatureTypeModalOpen, setCreatureTypeModalOpen] = useState(false);
  const [creatureTypeModalData, setCreatureTypeModalData] = useState<{
    confirmId: string;
    permanentId: string;
    cardName: string;
    reason: string;
    stepId?: string;
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
  
  // Ability sacrifice selection modal state (for Ashnod's Altar, Phyrexian Altar, Mondrak, etc.)
  // (Legacy abilitySacrificeRequest flow removed; sacrifice-as-cost uses Resolution Queue TARGET_SELECTION)
  
  // Undo request modal state
  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [undoRequestData, setUndoRequestData] = useState<UndoRequestData | null>(null);
  const [undoCount, setUndoCount] = useState<number>(1); // Number of actions to undo
  const [availableUndoCount, setAvailableUndoCount] = useState<number>(0); // Available events to undo
  
  // Smart undo counts (step, phase, turn)
  const [smartUndoCounts, setSmartUndoCounts] = useState<{
    stepCount: number;
    phaseCount: number;
    turnCount: number;
  }>({ stepCount: 0, phaseCount: 0, turnCount: 0 });
  
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
  // Track if we've already shown the blockers modal for this defend step (prevents re-opening after selection)
  const hasShownBlockersModal = React.useRef<string | null>(null);
  // External control for deck manager visibility in TableLayout
  const [tableDeckMgrOpen, setTableDeckMgrOpen] = useState(false);
  
  // Graveyard View Modal state
  const [graveyardModalOpen, setGraveyardModalOpen] = useState(false);
  const [graveyardModalPlayerId, setGraveyardModalPlayerId] = useState<string | null>(null);
  
  const [exileModalOpen, setExileModalOpen] = useState(false);
  const [exileModalPlayerId, setExileModalPlayerId] = useState<string | null>(null);
  
  // Ignored cards state (for auto-pass and playability checks)
  const [ignoredCards, setIgnoredCards] = useState<IgnoredCard[]>([]);
  const ignoredCardIds = useMemo(() => new Set(ignoredCards.map(c => c.cardId || c.permanentId)), [ignoredCards]);
  
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
  
  // Kynaios Choice Modal state (Kynaios and Tiro of Meletis style land/draw choice)
  const [kynaiosChoiceModalOpen, setKynaiosChoiceModalOpen] = useState(false);
  const [kynaiosChoiceRequest, setKynaiosChoiceRequest] = useState<KynaiosChoiceRequest | null>(null);

  // Option Choice Modal state (Generic option selection like Agitator Ant)
  const [optionChoiceModalOpen, setOptionChoiceModalOpen] = useState(false);
  const [optionChoiceRequest, setOptionChoiceRequest] = useState<OptionChoiceRequest | null>(null);

  // Two-pile split Modal state ("separate into two piles" effects)
  const [twoPileSplitModalOpen, setTwoPileSplitModalOpen] = useState(false);
  const [twoPileSplitRequest, setTwoPileSplitRequest] = useState<TwoPileSplitRequest | null>(null);

  // Ponder Modal state (Ponder, Index, Telling Time, etc.)
  const [ponderModalOpen, setPonderModalOpen] = useState(false);
  const [ponderRequest, setPonderRequest] = useState<{
    effectId: string;
    cardName: string;
    cardImageUrl?: string;
    cards: PeekCard[];
    variant: PonderVariant;
    canShuffle: boolean;
    drawAfter: boolean;
    pickToHand: number;
    targetPlayerId?: string;
    targetPlayerName?: string;
    isOwnLibrary: boolean;
    stepId?: string;  // For resolution queue integration
  } | null>(null);
  
  // Cascade modal state
  const [cascadeModalOpen, setCascadeModalOpen] = useState(false);
  const [cascadePrompt, setCascadePrompt] = useState<{
    effectId: string;
    sourceName: string;
    cascadeNumber: number;
    totalCascades: number;
    hitCard: KnownCardRef;
    exiledCards: KnownCardRef[];
    stepId: string;  // Resolution queue step ID
    gameId?: string;
    playerId?: string;
  } | null>(null);

  // Priority Modal state - shows when player receives priority on step changes
  const [priorityModalOpen, setPriorityModalOpen] = useState(false);
  const lastPriorityStep = React.useRef<string | null>(null);
  const lastCanRespond = React.useRef<boolean | null>(null);
  
  // Life Payment Modal state - for spells like Toxic Deluge that require paying X life
  const [lifePaymentModalOpen, setLifePaymentModalOpen] = useState(false);
  const [lifePaymentModalData, setLifePaymentModalData] = useState<{
    stepId: string;
    mandatory: boolean;
    cardId: string;
    cardName: string;
    description: string;
    imageUrl?: string;
    currentLife: number;
    minPayment: number;
    maxPayment: number;
  } | null>(null);
  
  // Mana Payment Trigger Modal state - for attack triggers with optional mana payment (e.g., Casal)
  const [manaPaymentTriggerModalOpen, setManaPaymentTriggerModalOpen] = useState(false);
  const [manaPaymentTriggerModalData, setManaPaymentTriggerModalData] = useState<{
    triggerId: string;
    cardName: string;
    cardImageUrl?: string;
    manaCost: string;
    effect: string;
    description: string;
  } | null>(null);
  
  // MDFC Face Selection Modal state - for Modal Double-Faced Cards like Blightstep Pathway
  const [mdfcFaceModalOpen, setMdfcFaceModalOpen] = useState(false);
  const [mdfcFaceModalData, setMdfcFaceModalData] = useState<{
    stepId?: string;
    cardId: string;
    cardName: string;
    title?: string;
    description?: string;
    faces: CardFace[];
  } | null>(null);
  
  // Modal Spell Selection Modal state - for Spree, Choose One/Two, etc.
  const [modalSpellModalOpen, setModalSpellModalOpen] = useState(false);
  const [modalSpellModalData, setModalSpellModalData] = useState<{
    cardId: string;
    cardName: string;
    title?: string;
    description?: string;
    imageUrl?: string;
    modes: SpellMode[];
    modeCount: number;
    canChooseAny?: boolean;
    minModes?: number;
    isSpree?: boolean;
    effectId?: string;
    // If present, this modal answers a Resolution Queue step.
    resolutionStepId?: string;
    mandatory?: boolean;
  } | null>(null);
  
  // Replacement Effect Order Modal state - for custom ordering of damage/life/counter effects
  const [replacementEffectModalOpen, setReplacementEffectModalOpen] = useState(false);
  const [replacementEffectModalData, setReplacementEffectModalData] = useState<{
    effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
    effects: ReplacementEffectItem[];
    baseAmount: number;
    initialMode?: OrderingMode;
    effectId?: string;
  } | null>(null);
  
  // Replacement Effect Settings Panel state
  const [replacementEffectSettingsOpen, setReplacementEffectSettingsOpen] = useState(false);
  
  // Color Choice Modal state - for Caged Sun, Gauntlet of Power, etc.
  const [colorChoiceModalOpen, setColorChoiceModalOpen] = useState(false);
  const [colorChoiceModalData, setColorChoiceModalData] = useState<{
    confirmId: string;
    permanentId?: string;
    spellId?: string;
    cardName: string;
    reason: string;
    imageUrl?: string;
    colors?: ('white' | 'blue' | 'black' | 'red' | 'green')[];
  } | null>(null);

  // Card Name Choice Modal state - for Pithing Needle, Nevermore, etc.
  const [cardNameChoiceModalOpen, setCardNameChoiceModalOpen] = useState(false);
  const [cardNameChoiceModalData, setCardNameChoiceModalData] = useState<{
    stepId: string;
    cardName: string;
    reason: string;
    imageUrl?: string;
    mandatory: boolean;
  } | null>(null);
  
  // Any Color Mana Modal state - for Birds of Paradise, Chromatic Lantern, etc.
  const [anyColorManaModalOpen, setAnyColorManaModalOpen] = useState(false);
  const [anyColorManaModalData, setAnyColorManaModalData] = useState<{
    // If present, this modal is answering a ResolutionQueue step.
    stepId?: string;
    mandatory?: boolean;
    activationId?: string;
    permanentId: string;
    cardName: string;
    amount: number;
    allowedColors?: string[]; // Array of allowed color codes (e.g., ['W', 'U'])
    cardImageUrl?: string;
  } | null>(null);
  
  // Phyrexian Mana Choice Modal state - for cards with {W/P}, {U/P}, etc. costs
  const [phyrexianManaModalOpen, setPhyrexianManaModalOpen] = useState(false);
  const [phyrexianManaModalData, setPhyrexianManaModalData] = useState<{
    // If present, this modal is answering a ResolutionQueue step.
    stepId?: string;
    mandatory?: boolean;
    pendingId: string;
    permanentId?: string;
    cardId?: string;
    castSpellArgs?: {
      gameId: string;
      cardId: string;
      targets?: any[];
      payment?: any[];
      skipInteractivePrompts?: boolean;
      xValue?: number;
      alternateCostId?: string;
      convokeTappedCreatures?: string[];
      phyrexianChoices?: any;
    };
    cardName: string;
    abilityText: string;
    totalManaCost: string;
    genericCost: number;
    phyrexianChoices: Array<{
      index: number;
      colorOption: string;
      colorName: string;
      lifeAmount: number;
      hasColorMana: boolean;
      symbol: string;
    }>;
    playerLife: number;
    cardImageUrl?: string;
  } | null>(null);
  
  // Tap/Untap Target Modal state - for Saryth, Merrow Reejerey, Argothian Elder, etc.
  const [tapUntapTargetModalOpen, setTapUntapTargetModalOpen] = useState(false);
  const [tapUntapTargetModalData, setTapUntapTargetModalData] = useState<{
    stepId: string;
    sourceId: string;
    sourceName: string;
    sourceImageUrl?: string;
    action: 'tap' | 'untap' | 'both';
    targetFilter: {
      types?: ('creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker' | 'permanent')[];
      controller?: 'you' | 'opponent' | 'any';
      tapStatus?: 'tapped' | 'untapped' | 'any';
      excludeSource?: boolean;
    };
    targetCount: number;
    title?: string;
    description?: string;
  } | null>(null);
  
  // Fight Target Modal state - for Brash Taunter, etc.
  const [fightTargetModalOpen, setFightTargetModalOpen] = useState(false);
  const [fightTargetModalData, setFightTargetModalData] = useState<{
    stepId: string;
    sourceId: string;
    sourceName: string;
    sourceImageUrl?: string;
    title?: string;
    description?: string;
    targetFilter?: {
      types?: string[];
      controller?: 'you' | 'opponent' | 'any';
      excludeSource?: boolean;
    };
  } | null>(null);
  
  // Counter Movement Modal state - for Nesting Grounds, etc.
  const [counterMovementModalOpen, setCounterMovementModalOpen] = useState(false);
  const [counterMovementModalData, setCounterMovementModalData] = useState<{
    stepId: string;
    sourceId: string;
    sourceName: string;
    sourceImageUrl?: string;
    sourceFilter?: {
      controller?: 'you' | 'any';
    };
    targetFilter?: {
      controller?: 'you' | 'any';
      excludeSource?: boolean;
    };
    title?: string;
    description?: string;
  } | null>(null);
  
  // Station Creature Selection Modal state (Rule 702.184a)
  const [stationCreatureSelectionOpen, setStationCreatureSelectionOpen] = useState(false);
  const [stationCreatureSelectionData, setStationCreatureSelectionData] = useState<{
    stepId: string;
    station: StationInfo;
    creatures: StationCreature[];
    title: string;
    description: string;
  } | null>(null);
  
  // Resolution Queue Player Choice modal state
  const [resolutionPlayerChoiceModalOpen, setResolutionPlayerChoiceModalOpen] = useState(false);
  const [resolutionPlayerChoiceModalData, setResolutionPlayerChoiceModalData] = useState<{
    stepId: string;
    title: string;
    description?: string;
    source?: {
      name: string;
      imageUrl?: string;
    };
    players: PlayerTarget[];
    opponentOnly?: boolean;
    isOptional?: boolean;
  } | null>(null);
  
  // Mana Distribution Modal state - for Selvala, Heart of the Wilds, etc.
  const [manaDistributionModalOpen, setManaDistributionModalOpen] = useState(false);
  const [manaDistributionModalData, setManaDistributionModalData] = useState<{
    // If present, this modal is answering a ResolutionQueue step.
    stepId?: string;
    mandatory?: boolean;
    gameId: string;
    permanentId: string;
    cardName: string;
    cardImageUrl?: string;
    totalAmount: number;
    availableColors: string[];
    message?: string;
  } | null>(null);
  
  // Additional Cost Modal state - for discard/sacrifice as additional costs
  const [additionalCostModalOpen, setAdditionalCostModalOpen] = useState(false);
  const [additionalCostModalData, setAdditionalCostModalData] = useState<{
    cardId: string;
    cardName: string;
    costType: 'discard' | 'sacrifice';
    amount: number;
    title: string;
    description: string;
    imageUrl?: string;
    availableCards?: Array<{ id: string; name: string; imageUrl?: string }>;
    availableTargets?: Array<{ id: string; name: string; imageUrl?: string; typeLine?: string }>;
    effectId?: string;
    // If present, this modal is being used to answer a ResolutionQueue step.
    resolutionStepId?: string;
    // Whether the resolution step is mandatory (if false, cancel is allowed).
    resolutionStepMandatory?: boolean;
    // Special target id that represents "sacrifice the source" (if allowed by the step).
    resolutionSourceChoiceId?: string;
  } | null>(null);
  
  // Squad Cost Modal state - for paying squad costs multiple times
  const [squadCostModalOpen, setSquadCostModalOpen] = useState(false);
  const [squadCostModalData, setSquadCostModalData] = useState<{
    cardId: string;
    cardName: string;
    squadCost: string;
    imageUrl?: string;
    effectId?: string;
    // If present, this modal answers a Resolution Queue step.
    resolutionStepId?: string;
    mandatory?: boolean;
  } | null>(null);
  
  // Casting Mode Selection Modal state - for overload, abundant harvest, etc.
  const [castingModeModalOpen, setCastingModeModalOpen] = useState(false);
  const [castingModeModalData, setCastingModeModalData] = useState<{
    cardId: string;
    cardName: string;
    source?: string;
    title: string;
    description: string;
    imageUrl?: string;
    modes: CastingMode[];
    effectId?: string;
    // If present, this modal answers a Resolution Queue step.
    resolutionStepId?: string;
    resolutionStepMandatory?: boolean;
  } | null>(null);
  
  // Mana Pool state - tracks floating mana for the current player
  const [manaPool, setManaPool] = useState<ManaPool | null>(null);
  
  // Mutate target selection modal state
  const [mutateModalOpen, setMutateModalOpen] = useState(false);
  const [mutateModalData, setMutateModalData] = useState<{
    cardId: string;
    cardName: string;
    imageUrl?: string;
    power?: string;
    toughness?: string;
    mutateCost: string;
    targets: MutateTarget[];
  } | null>(null);
  
  // Auto-pass steps - which steps to automatically pass priority on
  const [autoPassSteps, setAutoPassSteps] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mtgedh:autoPassSteps');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch {
      /* ignore */
    }
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
      } catch {
        /* ignore */
      }

      // Sync with server: auto-pass is enabled if ANY step is enabled
      if (safeView?.id) {
        socket.emit('setAutoPass', {
          gameId: safeView.id,
          enabled: next.size > 0,
        });
      }

      return next;
    });
  }, [safeView?.id, socket]);
  
  // Clear all auto-pass settings
  const handleClearAllAutoPass = React.useCallback(() => {
    setAutoPassSteps(new Set());
    try {
      localStorage.removeItem('mtgedh:autoPassSteps');
    } catch {
      /* ignore */
    }

    // Sync with server: auto-pass is now disabled
    if (safeView?.id) {
      socket.emit('setAutoPass', {
        gameId: safeView.id,
        enabled: false,
      });
    }
  }, [safeView?.id, socket]);

  // Select all auto-pass settings
  const handleSelectAllAutoPass = React.useCallback(() => {
    const allSteps = new Set([
      'upkeep', 'draw', 'main1', 'begincombat', 'declareattackers',
      'declareblockers', 'damage', 'endcombat', 'main2', 'end'
    ]);
    setAutoPassSteps(allSteps);
    try {
      localStorage.setItem('mtgedh:autoPassSteps', JSON.stringify([...allSteps]));
    } catch {
      /* ignore */
    }

    // Sync with server: auto-pass is now enabled
    if (safeView?.id) {
      socket.emit('setAutoPass', {
        gameId: safeView.id,
        enabled: true,
      });
    }
  }, [safeView?.id, socket]);

  // Auto-pass for rest of turn setting
  // When enabled, forces auto-pass for all remaining priority windows this turn
  const [autoPassForTurn, setAutoPassForTurn] = useState(false);
  
  // Toggle auto-pass for rest of turn
  const handleToggleAutoPassForTurn = React.useCallback(() => {
    setAutoPassForTurn(prev => {
      const newValue = !prev;
      // Sync to server
      if (safeView?.id) {
        socket.emit('setAutoPassForTurn', {
          gameId: safeView.id,
          enabled: newValue,
        });
      }
      return newValue;
    });
  }, [safeView?.id, socket]);
  
  // Reset auto-pass for turn when turn changes
  React.useEffect(() => {
    if (safeView?.turnPlayer) {
      // Reset when turn player changes (new turn started)
      setAutoPassForTurn(false);
      // Also sync to server
      if (safeView?.id) {
        socket.emit('setAutoPassForTurn', {
          gameId: safeView.id,
          enabled: false,
        });
      }
    }
  }, [safeView?.turnPlayer, safeView?.id, socket]);
  
  // Sync auto-pass settings with server when joining/loading a game
  // We need a ref to capture the current autoPassSteps without adding it as a dependency
  const autoPassStepsRef = React.useRef(autoPassSteps);
  React.useEffect(() => {
    autoPassStepsRef.current = autoPassSteps;
  }, [autoPassSteps]);
  
  React.useEffect(() => {
    if (safeView?.id && socket.connected) {
      // Send current auto-pass state to server
      const hasAutoPass = autoPassStepsRef.current.size > 0;
      socket.emit('setAutoPass', {
        gameId: safeView.id,
        enabled: hasAutoPass,
      });
    }
  }, [safeView?.id, socket.connected]); // Only sync when game changes or socket reconnects

  // Listen for auto-pass toggle confirmation from server
  // This updates the client UI when auto-pass is enabled/disabled
  React.useEffect(() => {
    const handleAutoPassToggled = (data: { 
      gameId: string; 
      playerId: string; 
      enabled: boolean; 
      success: boolean; 
    }) => {
      // Only update if it's for this game and this player
      if (data.gameId === safeView?.id && data.playerId === you && data.success) {
        debug(2, '[AutoPass] Server confirmed toggle:', data.enabled ? 'enabled' : 'disabled');
        // The UI state is already updated from the user action
        // This confirms the server processed it correctly
        // If the server state doesn't match, we could sync here
      }
    };

    socket.on('autoPassToggled', handleAutoPassToggled);
    return () => {
      socket.off('autoPassToggled', handleAutoPassToggled);
    };
  }, [safeView?.id, you]);

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

  // Trigger shortcuts panel state
  const [showTriggerShortcuts, setShowTriggerShortcuts] = useState(false);

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
    if (config.includeAI && config.aiOpponents && config.aiOpponents.length > 0) {
      // Create game with multiple AI opponents
      socket.emit('createGameWithMultipleAI' as any, {
        gameId: config.gameId,
        playerName: config.playerName,
        format: config.format,
        startingLife: config.startingLife,
        aiOpponents: config.aiOpponents,
      });
    } else if (config.includeAI) {
      // Legacy: Create game with single AI opponent
      socket.emit('createGameWithAI' as any, {
        gameId: config.gameId,
        playerName: config.playerName,
        format: config.format,
        startingLife: config.startingLife,
        aiName: config.aiName,
        aiStrategy: config.aiStrategy,
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
    const turnPlayer = safeView.turnPlayer;
    const isYourTurn = turnPlayer != null && turnPlayer === you;
    const stackLength = (safeView as any).stack?.length || 0;
    // Include combatNumber to handle multiple combat phases per turn (Aurelia, Combat Celebrant, etc.)
    const combatNumber = (safeView as any).combatNumber || 1;
    const turnId = `${safeView.turn}-${combatNumber}-${step}`; // Unique ID for this combat step
    
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
          // Check if it's currently a creature (handles reconfigure/bestow)
          if (!isCurrentlyCreature(p)) return false;
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
      // Note: attackers can target either a playerId OR a permanentId (planeswalker/battle).
      // If a planeswalker/battle you control is being attacked, you are still the defending player
      // and must be prompted to declare blockers.
      const battlefield = (safeView.battlefield || []) as any[];
      const attackersTargetingYou = battlefield.filter((p: any) => {
        const target = p?.attacking;
        if (!target) return false;
        if (target === you) return true;

        // If the target is a permanent you control (planeswalker/battle), treat as defending.
        if (typeof target === 'string') {
          const targetPerm = battlefield.find((perm: any) => perm?.id === target);
          if (!targetPerm) return false;
          if (targetPerm.controller !== you) return false;
          const typeLine = String(targetPerm.card?.type_line || '').toLowerCase();
          return typeLine.includes('planeswalker') || typeLine.includes('battle');
        }

        return false;
      });

      // IMPORTANT: Do not use a purely client-side "shown once" guard here.
      // If the server rejects an illegal block (e.g. flying/shadow/menace), we must
      // allow the modal to reopen so the player can correct their blockers.
      // Use server-authoritative state: once the player is recorded in blockersDeclaredBy,
      // we stop prompting for blockers.
      const blockersDeclaredBy: string[] = Array.isArray((safeView as any).blockersDeclaredBy)
        ? (safeView as any).blockersDeclaredBy
        : [];

      const youAlreadyDeclared = blockersDeclaredBy.includes(you);
      if (attackersTargetingYou.length > 0 && !youAlreadyDeclared) {
        setCombatMode('blockers');
        setCombatModalOpen(true);
      } else if (youAlreadyDeclared && combatMode === 'blockers' && combatModalOpen) {
        // Server accepted declaration/skip; ensure the modal is closed.
        setCombatModalOpen(false);
        setCombatModalError(null);
      }
    }
    else {
      setCombatModalOpen(false);
      setCombatModalError(null);
      // Reset auto-skip tracker when we leave combat steps
      if (hasAutoSkippedAttackers.current) {
        hasAutoSkippedAttackers.current = null;
      }
      // Reset shown attackers modal tracker when we leave combat steps
      if (hasShownAttackersModal.current) {
        hasShownAttackersModal.current = null;
      }
      // Reset shown blockers modal tracker when we leave combat steps
      if (hasShownBlockersModal.current) {
        hasShownBlockersModal.current = null;
      }
    }
  }, [safeView, you]);

  // If the server rejects an illegal block declaration, it will emit a socket "error".
  // Ensure the blockers modal re-opens (or stays open) and surface the message.
  React.useEffect(() => {
    if (!safeView || !you) return;
    if (!lastError) return;
    if (lastCombatErrorSeenRef.current === lastError) return;
    lastCombatErrorSeenRef.current = lastError;

    const step = String((safeView as any).step || "").toLowerCase();
    if (step !== "declareblockers" && step !== "declare_blockers") return;

    const battlefield = (safeView.battlefield || []) as any[];
    const attackersTargetingYou = battlefield.filter((p: any) => {
      const target = p?.attacking;
      if (!target) return false;
      if (target === you) return true;

      if (typeof target === 'string') {
        const targetPerm = battlefield.find((perm: any) => perm?.id === target);
        if (!targetPerm) return false;
        if (targetPerm.controller !== you) return false;
        const typeLine = String(targetPerm.card?.type_line || '').toLowerCase();
        return typeLine.includes('planeswalker') || typeLine.includes('battle');
      }

      return false;
    });

    const blockersDeclaredBy: string[] = Array.isArray((safeView as any).blockersDeclaredBy)
      ? (safeView as any).blockersDeclaredBy
      : [];
    const youAlreadyDeclared = blockersDeclaredBy.includes(you);

    if (attackersTargetingYou.length > 0 && !youAlreadyDeclared) {
      setCombatMode('blockers');
      setCombatModalError(lastError);
      setCombatModalOpen(true);
    }
  }, [lastError, safeView, you]);

  // Priority modal logic - show when you gain priority on step changes
  React.useEffect(() => {
    if (!safeView || !you) return;
    
    const step = String((safeView as any).step || "").toLowerCase();
    const phaseStr = String((safeView as any).phase || "").toUpperCase();
    const priority = (safeView as any).priority;
    const youHavePriority = priority === you;
    const stackLength = (safeView as any).stack?.length || 0;
    
    // Don't show priority modal during pre-game phase
    // Note: Using same logic as isPreGame memo (uppercase comparison)
    const isPreGamePhase = phaseStr === "" || phaseStr === "PRE_GAME";
    if (isPreGamePhase) {
      setPriorityModalOpen(false);
      return;
    }
    
    // Show priority modal when all of these conditions are met:
    // 1. You have priority
    // 2. The stack is empty (not responding to something)
    // 3. The step changed since last time we showed the modal
    // 4. We're not in a combat modal already
    // 5. Either: auto-pass is NOT enabled for this step, 
    //    OR: it's your turn and you're not using phase navigator,
    //    OR: there are pending triggers to handle
    
    // Check for pending triggers in the game state
    const hasPendingTriggers = pendingTriggers.length > 0;
    
    // Normalize step key - remove underscores and convert to lowercase for consistent comparison
    const stepKey = step.replace(/_/g, '').toLowerCase();
    const autoPassStepEnabled = autoPassSteps.has(stepKey) || autoPassSteps.has(step.toLowerCase());
    
    // Auto-pass activates when:
    // 1. Auto-pass is enabled for this step, AND
    // 2. Either: you are NOT the active player (not your turn), OR you're using phase navigator during a NON-action phase, AND
    // 3. There are no pending triggers to handle
    // 
    // IMPORTANT: The turn player should NEVER auto-pass during their own "action phases":
    // - Main Phase 1 (MAIN1) - can play lands, cast sorcery-speed spells
    // - Main Phase 2 (MAIN2) - can play lands, cast sorcery-speed spells
    // These are the phases where the turn player typically wants to take actions.
    // Even with phaseNavigatorAdvancing=true, we should stop at main phases on your turn.
    const turnPlayer = (safeView as any).turnPlayer;
    const isYourTurn = turnPlayer !== null && turnPlayer !== undefined && turnPlayer === you;
    
    // Action phases are main phases where the turn player can play lands and cast sorcery-speed spells
    // Use stepKey (normalized, lowercase, no underscores) for precise detection
    const isActionPhase = stepKey.includes('main');
    
    // Get action/response capabilities from server (preferred) or calculate from playableCards (fallback)
    // canAct: Can take sorcery-speed actions (play lands, cast sorceries, etc.)
    // canRespond: Can take instant-speed actions (cast instants, activate abilities, etc.)
    const playableCards = (safeView as any).playableCards || [];
    const canAct = (safeView as any).canAct ?? (playableCards.length > 0);
    const canRespond = (safeView as any).canRespond ?? canAct;
    
    // Check if player has creatures for combat (must be untapped and not have summoning sickness)
    const playerCreatures = (safeView.battlefield || []).filter((p: any) => {
      if (p.controller !== you) return false;
      if (!(p.card?.type_line || '').toLowerCase().includes('creature')) return false;
      if (p.tapped) return false;
      // Check summoning sickness - creature must have been on battlefield since start of turn
      // If the creature has 'Haste' keyword, it can attack immediately
      const hasHaste = (p.card?.keywords || []).some((k: string) => k.toLowerCase() === 'haste') ||
                      (p.card?.oracle_text || '').toLowerCase().includes('haste');
      if (p.summoningSick && !hasHaste) return false;
      return true;
    });
    const hasCreaturesToAttack = playerCreatures.length > 0;
    
    // Combat phases detection
    const COMBAT_STEPS = ['combat', 'attack', 'block', 'damage'];
    const isCombatPhase = COMBAT_STEPS.some(phase => stepKey.includes(phase));
    
    // NOTE: Auto-pass logic has been moved to server-side (doAutoPass in util.ts)
    // The server will auto-pass after timeout if player has no actions (canAct/canRespond)
    // This ensures authoritative game state and prevents race conditions.
    //
    // Client-side auto-pass is DISABLED to prevent:
    // 1. Race conditions where client auto-passes before canAct/canRespond is calculated
    // 2. Client/server state desync
    // 3. Priority passing before user can see their options
    //
    // TODO: If we want to support user preferences for auto-pass, those should be sent
    // to the server and the server should handle auto-passing based on those preferences.
    
    // For now, just show priority modal when relevant (not in main phases)
    // BUT also check if player can actually take actions
    if (youHavePriority && stackLength === 0 && !combatModalOpen) {
      const priorityChanged = lastPriorityStep.current !== step;
      
      if (priorityChanged) {
        lastPriorityStep.current = step;
        
        // Show priority modal for non-main-phase steps
        const isMainPhase = step.includes('main') || step === 'main1' || step === 'main2';
        
        // ONLY show modal if:
        // 1. Not in a main phase (main phases are less disruptive)
        // 2. No pending triggers to resolve
        // 3. Player can actually respond (canRespond=true) OR we don't have that info yet
        //
        // The canRespond check prevents showing the modal when the player has no instant-speed actions.
        // If canRespond is undefined, we conservatively show the modal (server hasn't calculated yet).
        const shouldShowModal = !isMainPhase && !hasPendingTriggers && (canRespond === true || canRespond === undefined);
        
        if (shouldShowModal) {
          setPriorityModalOpen(true);
        }
      }
    } else {
      // Close priority modal if we don't have priority or stack is not empty
      setPriorityModalOpen(false);
      // Reset tracking when we don't have priority
      lastCanRespond.current = null;
    }
  }, [safeView, you, combatModalOpen, autoPassSteps, autoPassForTurn, phaseNavigatorAdvancing, pendingTriggers]);

  // Mulligan bottom selection prompt listener (London Mulligan)
  // (Legacy mulliganBottomPrompt removed; mulligan bottom uses Resolution Queue HAND_TO_BOTTOM)

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
            gameId: safeView!.id,
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

  // Listen for batch trigger resolution summary to update auto-resolve counts
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id && payload.playerId === you) {
        // Update counts for each resolved source that we have in ignoredTriggerSources
        setIgnoredTriggerSources(prev => {
          const next = new Map(prev);
          for (const source of (payload.sources || [])) {
            const existing = next.get(source.sourceKey);
            if (existing) {
              // Increment count by number resolved
              next.set(source.sourceKey, {
                ...existing,
                count: existing.count + source.count,
              });
            }
          }
          return next;
        });
      }
    };
    socket.on("triggersResolved", handler);
    return () => {
      socket.off("triggersResolved", handler);
    };
  }, [safeView?.id, you]);

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

  // Ignored cards update listener (for auto-pass and playability checks)
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (payload.gameId === safeView?.id && payload.playerId === you) {
        setIgnoredCards(payload.ignoredCards || []);
      }
    };
    socket.on("ignoredCardsUpdated" as any, handler);
    return () => {
      socket.off("ignoredCardsUpdated" as any, handler);
    };
  }, [safeView?.id, you]);

  // Library search request listener (Tutor effects)
  React.useEffect(() => {
    const handler = (payload: any) => {
      // Only show modal if this is for our game AND either:
      // 1. No playerId specified (direct socket emit to us), OR
      // 2. The playerId matches us (broadcast with player filter)
      if (payload.gameId === safeView?.id && (!payload.playerId || payload.playerId === you)) {
        setLibrarySearchData({
          cards: payload.cards || [],
          title: payload.title || 'Search Library',
          description: payload.description,
          filter: payload.filter,
          maxSelections: payload.maxSelections || 1,
          moveTo: payload.moveTo || 'hand',
          shuffleAfter: payload.shuffleAfter !== false,
          targetPlayerId: payload.targetPlayerId, // For searching opponent's library
          // Split destination props
          splitDestination: payload.splitDestination || false,
          toBattlefield: payload.toBattlefield || 0,
          toHand: payload.toHand || 0,
          entersTapped: payload.entersTapped || false,
        });
        setLibrarySearchModalOpen(true);
      }
    };
    socket.on("librarySearchRequest", handler);
    return () => {
      socket.off("librarySearchRequest", handler);
    };
  }, [safeView?.id, you]);

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

  // Payment required listener (for MTG-compliant spell casting: targets first, then payment)
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      cardId: string;
      cardName: string;
      manaCost: string;
      effectId: string;
      targets?: string[];
      imageUrl?: string;
      // NOTE: Runtime can include legacy shapes here; normalize defensively.
      costReduction?: any;
      convokeOptions?: any;
    }) => {
      if (payload.gameId === safeView?.id) {
        // Transform payload types to match state type.
        // costReduction can be either the documented array form or a legacy object form.
        let transformedCostReduction:
          | { generic: number; colors: Record<string, number>; messages: string[] }
          | undefined;

        const cr = payload.costReduction;
        if (Array.isArray(cr)) {
          transformedCostReduction = {
            generic: cr.reduce((sum, r) => sum + (r?.amount ?? 0), 0),
            colors: {},
            messages: cr.map(r => String(r?.source ?? '')).filter(Boolean),
          };
        } else if (cr && typeof cr === 'object') {
          const generic = typeof cr.generic === 'number' ? cr.generic : 0;
          const colors = cr.colors && typeof cr.colors === 'object' ? cr.colors : {};
          const messages = Array.isArray(cr.messages) ? cr.messages.map((m: any) => String(m)).filter(Boolean) : [];
          if (generic !== 0 || Object.keys(colors).length > 0 || messages.length > 0) {
            transformedCostReduction = { generic, colors, messages };
          }
        }

        // convokeOptions can be either the documented array form or a legacy object form.
        let transformedConvokeOptions:
          | { availableCreatures: Array<{ id: string; name: string; colors: string[]; canTapFor: string[] }>; messages: string[] }
          | undefined;

        const co = payload.convokeOptions;
        if (Array.isArray(co)) {
          transformedConvokeOptions = {
            availableCreatures: co.map(c => ({
              id: c.permanentId,
              name: c.name,
              colors: c.colors,
              canTapFor: c.colors, // Assume creatures can tap for their colors
            })),
            messages: [],
          };
        } else if (co && typeof co === 'object') {
          const availableCreaturesRaw = Array.isArray(co.availableCreatures) ? co.availableCreatures : [];
          const availableCreatures = availableCreaturesRaw
            .map((c: any) => ({
              id: String(c?.id ?? ''),
              name: String(c?.name ?? ''),
              colors: Array.isArray(c?.colors) ? c.colors : [],
              canTapFor: Array.isArray(c?.canTapFor) ? c.canTapFor : (Array.isArray(c?.colors) ? c.colors : []),
            }))
            .filter((c: { id: string; name: string }) => c.id && c.name);
          const messages = Array.isArray(co.messages) ? co.messages.map((m: any) => String(m)).filter(Boolean) : [];
          if (availableCreatures.length > 0 || messages.length > 0) {
            transformedConvokeOptions = { availableCreatures, messages };
          }
        }
        
        // Store the pending targets and effectId so we can include them when casting
        setSpellToCast({
          cardId: payload.cardId,
          cardName: payload.cardName,
          manaCost: payload.manaCost,
          targets: payload.targets,
          effectId: payload.effectId,
          costReduction: transformedCostReduction,
          convokeOptions: transformedConvokeOptions,
        });
        setCastSpellModalOpen(true);
      }
    };
    socket.on("paymentRequired", handler);
    return () => {
      socket.off("paymentRequired", handler);
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

  // Life payment request listener (for Toxic Deluge, Hatred, etc.)
  // Legacy lifePaymentRequest listener removed - now handled via Resolution Queue (life_payment).

  // Life payment complete listener - re-trigger spell cast with life payment info
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      cardId: string;
      lifePayment: number;
      effectId?: string;
    }) => {
      if (payload.gameId === safeView?.id) {
        // Continue the spell cast with the life payment info
        socket.emit("castSpellFromHand", {
          gameId: safeView.id,
          cardId: payload.cardId,
          payment: [{ lifePayment: payload.lifePayment }],
        });
      }
    };
    socket.on("lifePaymentComplete", handler);
    return () => {
      socket.off("lifePaymentComplete", handler);
    };
  }, [safeView?.id]);

  // Attack trigger mana payment prompt listener (for Casal, etc.)
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      triggerId: string;
      cardName: string;
      cardImageUrl?: string;
      manaCost: string;
      effect: string;
      description: string;
    }) => {
      if (payload.gameId === safeView?.id) {
        setManaPaymentTriggerModalData({
          triggerId: payload.triggerId,
          cardName: payload.cardName,
          cardImageUrl: payload.cardImageUrl,
          manaCost: payload.manaCost,
          effect: payload.effect,
          description: payload.description,
        });
        setManaPaymentTriggerModalOpen(true);
      }
    };
    socket.on("attackTriggerManaPaymentPrompt", handler);
    return () => {
      socket.off("attackTriggerManaPaymentPrompt", handler);
    };
  }, [safeView?.id]);

  // Legacy MDFC face selection request listener removed - now handled via Resolution Queue (resolutionStepPrompt).

  // Legacy modalSpellRequest listener removed - now handled via Resolution Queue (mode_selection with multi-select).

  // Replacement Effect Order Request listener - allows player to override damage/life effect ordering
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
      effects: ReplacementEffectItem[];
      baseAmount: number;
      initialMode?: OrderingMode;
      effectId?: string;
    }) => {
      if (payload.gameId === safeView?.id) {
        setReplacementEffectModalData({
          effectType: payload.effectType,
          effects: payload.effects,
          baseAmount: payload.baseAmount,
          initialMode: payload.initialMode,
          effectId: payload.effectId,
        });
        setReplacementEffectModalOpen(true);
      }
    };
    socket.on("replacementEffectOrderRequest", handler);
    return () => {
      socket.off("replacementEffectOrderRequest", handler);
    };
  }, [safeView?.id]);

  // Mana choice prompts are handled via Resolution Queue (resolutionStepPrompt).

  // Legacy additionalCostRequest listener removed - now handled via Resolution Queue (additional_cost_payment).

  // Legacy squadCostRequest listener removed - now handled via Resolution Queue (squad_cost_payment).

  // Legacy modeSelectionRequest listener removed - now handled via Resolution Queue (mode_selection).

  // Resume castSpellFromHand after a Resolution Queue prompt (e.g. Abundant Harvest choice)
  React.useEffect(() => {
    const handler = (payload: any) => {
      if (!safeView?.id || payload?.gameId !== safeView.id) return;
      if (!payload?.cardId) return;

      socket.emit('castSpellFromHand', {
        gameId: safeView.id,
        cardId: payload.cardId,
        payment: payload.payment,
        targets: payload.targets,
        xValue: payload.xValue,
        alternateCostId: payload.alternateCostId,
        skipInteractivePrompts: payload.skipInteractivePrompts,
        convokeTappedCreatures: payload.convokeTappedCreatures,
      } as any);
    };

    socket.on('castSpellFromHandContinue', handler);
    return () => {
      socket.off('castSpellFromHandContinue', handler);
    };
  }, [safeView?.id]);

  // Overload cast request listener - after mode selection, need to pay the overload cost
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      cardId: string;
      cardName: string;
      overloadCost: string;
      effectId?: string;
    }) => {
      if (payload.gameId === safeView?.id) {
        // Open the cast spell modal with the overload cost
        // Find the card in hand to get full details including oracle text
        const hand = (safeView as any).hand || [];
        const cardInHand = hand.find((c: any) => c?.id === payload.cardId);
        
        if (cardInHand) {
          setSpellToCast({
            cardId: payload.cardId,
            cardName: payload.cardName,
            manaCost: cardInHand.mana_cost, // Use the card's normal mana cost
            oracleText: cardInHand.oracle_text, // Include oracle text so alternate costs are parsed
            effectId: payload.effectId,
          });
          setCastSpellModalOpen(true);
        }
      }
    };
    socket.on("overloadCastRequest", handler);
    return () => {
      socket.off("overloadCastRequest", handler);
    };
  }, [safeView?.id, (safeView as any)?.hand]);

  // MDFC face selection complete listener - continue playing the land
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      cardId: string;
      selectedFace: number;
      effectId?: string;
    }) => {
      if (payload.gameId === safeView?.id) {
        // Re-emit playLand with the selected face
        socket.emit("playLand", {
          gameId: safeView.id,
          cardId: payload.cardId,
          selectedFace: payload.selectedFace,
        });
      }
    };
    socket.on("mdfcFaceSelectionComplete", handler);
    return () => {
      socket.off("mdfcFaceSelectionComplete", handler);
    };
  }, [safeView?.id]);

  // Mana pool update listener - update local mana pool state when server sends updates
  React.useEffect(() => {
    const handler = (payload: {
      gameId: string;
      playerId: string;
      manaPool: {
        white: number;
        blue: number;
        black: number;
        red: number;
        green: number;
        colorless: number;
        restricted?: Array<{
          type?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
          amount: number;
          restriction: string;
          restrictedTo?: string;
          sourceId?: string;
          sourceName?: string;
        }>;
        doesNotEmpty?: boolean;
      };
      totalMana: number;
      reason?: string;
    }) => {
      // Only update if this is for the current player
      if (payload.gameId === safeView?.id && payload.playerId === you) {
        setManaPool(payload.manaPool as ManaPool);
      }
    };
    socket.on("manaPoolUpdate", handler);
    return () => {
      socket.off("manaPoolUpdate", handler);
    };
  }, [safeView?.id, you]);

  // Also sync mana pool from state when it changes (fallback for when broadcastGame includes manaPool)
  React.useEffect(() => {
    if (!safeView || !you) return;
    
    const statePool = (safeView as any).manaPool?.[you];
    if (statePool) {
      setManaPool(statePool);
    }
  }, [safeView, you]);

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

    const handleSmartUndoCountsUpdate = (payload: { 
      gameId: string; 
      stepCount: number; 
      phaseCount: number; 
      turnCount: number;
    }) => {
      if (payload.gameId === safeView?.id) {
        setSmartUndoCounts({
          stepCount: payload.stepCount,
          phaseCount: payload.phaseCount,
          turnCount: payload.turnCount,
        });
      }
    };

    socket.on("undoCountUpdate", handleUndoCountUpdate);
    socket.on("smartUndoCountsUpdate", handleSmartUndoCountsUpdate);

    return () => {
      socket.off("undoCountUpdate", handleUndoCountUpdate);
      socket.off("smartUndoCountsUpdate", handleSmartUndoCountsUpdate);
    };
  }, [safeView?.id]);

  // AI control socket event handlers
  React.useEffect(() => {
    const handleAiControlToggled = (payload: { 
      gameId: string; 
      playerId: string; 
      enabled: boolean;
      strategy?: string;
      difficulty?: number;
    }) => {
      if (payload.gameId === safeView?.id && payload.playerId === you) {
        setAiControlEnabled(payload.enabled);
        if (payload.strategy) {
          setAiStrategy(payload.strategy);
        }
      }
    };

    socket.on("aiControlToggled", handleAiControlToggled);

    return () => {
      socket.off("aiControlToggled", handleAiControlToggled);
    };
  }, [safeView?.id, you]);

  // Handler to toggle AI control
  const handleToggleAIControl = React.useCallback((enable: boolean, strategy?: string, difficulty?: number) => {
    if (!safeView?.id) return;
    
    socket.emit("toggleAIControl", {
      gameId: safeView.id,
      enable,
      strategy: strategy || 'basic',
      difficulty: difficulty ?? 0.5,
    });
  }, [safeView?.id]);

  // Request undo count on game state changes (no polling to reduce overhead)
  React.useEffect(() => {
    if (!safeView?.id) return;
    
    // Request undo count and smart undo counts on game state change
    socket.emit("getUndoCount", { gameId: safeView.id });
    socket.emit("getSmartUndoCounts", { gameId: safeView.id });
  }, [safeView?.id, safeView?.turn, safeView?.step, safeView?.priority]);
  
  // Resolution Queue system handler for Kynaios, Join Forces, Tempting Offer, and Bounce Land
  // Listens for resolution step prompts and opens the appropriate modals
  React.useEffect(() => {
    const handleResolutionStepPrompt = (payload: { gameId: string; step: any }) => {
      if (payload.gameId !== safeView?.id) return;
      
      const step = payload.step;

      // Handle Discard Selection resolution step (cleanup discard and discard effects)
      if (step.type === 'discard_selection') {
        const discardCount = Number(step.discardCount || 0);
        if (discardCount > 0) {
          const reason: 'cleanup' | 'effect' = step.reason === 'effect' ? 'effect' : 'cleanup';
          setDiscardCount(discardCount);
          setDiscardMaxHandSize(Number(step.maxHandSize || 7));
          setDiscardResolutionStepId(String(step.id));
          setDiscardResolutionReason(reason);
          setDiscardResolutionTitle(
            reason === 'cleanup'
              ? 'Cleanup Step - Discard to Hand Size'
              : String(step.sourceName || 'Discard')
          );
          setDiscardResolutionDescription(String(step.description || ''));
          setDiscardModalOpen(true);
        }
      }

      // Handle London mulligan bottom selection via Resolution Queue
      else if (step.type === 'hand_to_bottom' && step.reason === 'mulligan') {
        const cardsToBottom = Number(step.cardsToBottom || 0);
        if (cardsToBottom > 0) {
          setMulliganBottomCount(cardsToBottom);
          setMulliganBottomStepId(String(step.id));
          setMulliganBottomModalOpen(true);
        }
      }
      
      // Handle Kynaios choice resolution step
      else if (step.type === 'kynaios_choice') {
        // Convert resolution step to KynaiosChoiceRequest format
        const request: KynaiosChoiceRequest = {
          gameId: payload.gameId,
          sourceController: step.sourceController,
          sourceName: step.sourceName || 'Kynaios and Tiro of Meletis',
          isController: step.isController,
          canPlayLand: step.canPlayLand,
          landsInHand: step.landsInHand || [],
          options: step.options || [],
          stepId: step.id,  // Store the step ID for the response
        };
        
        setKynaiosChoiceRequest(request);
        setKynaiosChoiceModalOpen(true);
      }
      
      // Handle Option Choice resolution step
      else if (step.type === 'option_choice' || step.type === 'modal_choice') {
        if (step.opponentMayPayChoice === true) {
          const prompt: OpponentMayPayPrompt = {
            promptId: String(step.promptId || ''),
            sourceName: String(step.sourceName || 'Triggered Ability'),
            sourceController: String(step.sourceController || ''),
            decidingPlayer: String(step.decidingPlayer || you || ''),
            manaCost: String(step.manaCost || ''),
            declineEffect: String(step.declineEffect || ''),
            triggerText: String(step.triggerText || step.description || ''),
            availableMana: step.availableMana,
          };
          setOpponentMayPayPrompt(prompt);
          setOpponentMayPayStepId(String(step.id));
          return;
        }

        // Generic option choice modal (Agitator Ant and similar)
        const request: OptionChoiceRequest = {
          gameId: payload.gameId,
          stepId: step.id,
          sourceId: step.sourceId,
          sourceName: step.sourceName || 'Make a Choice',
          sourceImage: step.sourceImage,
          description: step.description || '',
          options: step.options || [],
          minSelections: step.minSelections || 0,
          maxSelections: step.maxSelections || 1,
          mandatory: step.mandatory !== false,
        };
        
        setOptionChoiceRequest(request);
        setOptionChoiceModalOpen(true);
      }

      // Mana color selection (any color / distribution) via Resolution Queue
      else if (step.type === 'mana_color_selection') {
        const selectionKind = String(step.selectionKind || 'any_color');

        if (selectionKind === 'distribution') {
          setManaDistributionModalData({
            gameId: payload.gameId,
            stepId: String(step.id),
            mandatory: step.mandatory !== false,
            permanentId: String(step.permanentId || step.sourceId || ''),
            cardName: String(step.cardName || step.sourceName || 'Mana'),
            cardImageUrl: step.sourceImage,
            totalAmount: Number(step.totalAmount ?? step.amount ?? 0),
            availableColors: Array.isArray(step.availableColors) ? step.availableColors : (Array.isArray(step.allowedColors) ? step.allowedColors : ['W','U','B','R','G']),
            message: step.message,
          });
          setManaDistributionModalOpen(true);
        } else {
          setAnyColorManaModalData({
            stepId: String(step.id),
            mandatory: step.mandatory !== false,
            activationId: '',
            permanentId: String(step.permanentId || step.sourceId || ''),
            cardName: String(step.cardName || step.sourceName || 'Mana'),
            amount: Number(step.amount || 1),
            allowedColors: Array.isArray(step.allowedColors) ? step.allowedColors : undefined,
            cardImageUrl: step.sourceImage,
          });
          setAnyColorManaModalOpen(true);
        }
      }

      // Phyrexian mana payment choice via Resolution Queue
      else if (step.type === 'mana_payment_choice' && step.phyrexianManaChoice === true) {
        setPhyrexianManaModalData({
          stepId: String(step.id),
          mandatory: step.mandatory !== false,
          pendingId: String(step.pendingId || ''),
          permanentId: step.permanentId,
          cardId: step.cardId,
          castSpellArgs: step.castSpellArgs,
          cardName: String(step.cardName || step.sourceName || ''),
          abilityText: String(step.abilityText || step.description || ''),
          totalManaCost: String(step.totalManaCost || step.manaCost || ''),
          genericCost: Number(step.genericCost || 0),
          phyrexianChoices: step.phyrexianChoices || [],
          playerLife: Number(step.playerLife || 40),
          cardImageUrl: step.sourceImage,
        });
        setPhyrexianManaModalOpen(true);
      }

      // Handle Two-pile split resolution step
      else if (step.type === 'two_pile_split') {
        const request: TwoPileSplitRequest = {
          gameId: payload.gameId,
          stepId: step.id,
          sourceName: step.sourceName || 'Separate Into Two Piles',
          sourceImage: step.sourceImage,
          description: step.description || '',
          items: step.items || [],
          minPerPile: step.minPerPile ?? 0,
          mandatory: step.mandatory !== false,
        };
        setTwoPileSplitRequest(request);
        setTwoPileSplitModalOpen(true);
      }

      // Tap/Untap target selection via Resolution Queue
      else if (step.type === 'tap_untap_target') {
        setTapUntapTargetModalData({
          stepId: String(step.id),
          sourceId: String(step.sourceId || ''),
          sourceName: String(step.sourceName || 'Ability'),
          sourceImageUrl: step.sourceImage,
          action: step.action || 'tap',
          targetFilter: step.targetFilter || {},
          targetCount: Number(step.targetCount || 1),
          title: step.title,
          description: step.description,
        });
        setTapUntapTargetModalOpen(true);
      }

      // Fight target selection via Resolution Queue
      else if (step.type === 'fight_target') {
        setFightTargetModalData({
          stepId: String(step.id),
          sourceId: String(step.sourceId || ''),
          sourceName: String(step.sourceName || 'Creature'),
          sourceImageUrl: step.sourceImage,
          title: step.title,
          description: step.description,
          targetFilter: step.targetFilter,
        });
        setFightTargetModalOpen(true);
      }

      // Counter target selection via Resolution Queue
      else if (step.type === 'counter_target') {
        const validTargets: TargetOption[] = (step.validTargets || []).map((t: any) => ({
          id: t.id,
          type: 'permanent',
          name: t.label || t.name || 'Unknown',
          displayName: t.label || t.name,
          imageUrl: t.imageUrl,
          controller: t.controller,
          typeLine: t.typeLine,
          life: t.life,
          zone: t.zone,
          owner: t.owner,
          card: t.card,
        }));

        setTargetModalData({
          cardId: step.sourceId || step.id,
          source: { name: step.sourceName || 'Add Counter', imageUrl: step.sourceImage },
          title: step.title || step.description || 'Choose target',
          description: step.description || '',
          targets: validTargets,
          minTargets: step.minTargets || 1,
          maxTargets: step.maxTargets || 1,
          effectId: step.sourceId,
          stepId: step.id,
          useResolutionQueue: true,
        });
        setTargetModalOpen(true);
      }

      // Counter movement via Resolution Queue
      else if (step.type === 'counter_movement') {
        setCounterMovementModalData({
          stepId: String(step.id),
          sourceId: String(step.sourceId || ''),
          sourceName: String(step.sourceName || 'Move Counter'),
          sourceImageUrl: step.sourceImage,
          sourceFilter: step.sourceFilter,
          targetFilter: step.targetFilter,
          title: step.title,
          description: step.description,
        });
        setCounterMovementModalOpen(true);
      }

      // Station creature selection via Resolution Queue
      else if (step.type === 'station_creature_selection') {
        setStationCreatureSelectionData({
          stepId: String(step.id),
          station: step.station,
          creatures: step.creatures || [],
          title: step.title || 'Station',
          description: step.description || '',
        });
        setStationCreatureSelectionOpen(true);
      }

      // MDFC face selection via Resolution Queue
      else if (step.type === 'mdfc_face_selection') {
        setMdfcFaceModalData({
          stepId: String(step.id),
          cardId: String(step.cardId || ''),
          cardName: String(step.cardName || step.sourceName || ''),
          title: step.title,
          description: step.description,
          faces: Array.isArray(step.faces) ? step.faces : [],
        });
        setMdfcFaceModalOpen(true);
      }

      // Life payment (Toxic Deluge, Hatred, etc.) via Resolution Queue
      else if (step.type === 'life_payment') {
        setLifePaymentModalData({
          stepId: String(step.id),
          mandatory: step.mandatory !== false,
          cardId: String(step.cardId || step.sourceId || ''),
          cardName: String(step.cardName || step.sourceName || 'Spell'),
          description: String(step.description || 'Choose an amount of life to pay.'),
          imageUrl: step.sourceImage,
          currentLife: Number(step.currentLife ?? 40),
          minPayment: Number(step.minPayment ?? 0),
          maxPayment: Number(step.maxPayment ?? 0),
        });
        setLifePaymentModalOpen(true);
      }

      // Forbidden Orchard target opponent selection via Resolution Queue
      else if (step.type === 'forbidden_orchard_target') {
        const opponents = Array.isArray(step.opponents) ? step.opponents : [];
        const request: OptionChoiceRequest = {
          gameId: payload.gameId,
          stepId: String(step.id),
          sourceId: String(step.permanentId || step.sourceId || ''),
          sourceName: String(step.cardName || step.sourceName || 'Forbidden Orchard'),
          sourceImage: step.sourceImage,
          description: String(step.description || 'Choose target opponent.'),
          options: opponents.map((p: any) => ({
            id: String(p.id),
            label: String(p.name || p.id),
          })),
          minSelections: 1,
          maxSelections: 1,
          mandatory: true,
        };

        setOptionChoiceRequest(request);
        setOptionChoiceModalOpen(true);
      }
      
      // Handle Bounce Land choice resolution step
      else if (step.type === 'bounce_land_choice') {
        debug(2, '[BounceLand] Received bounce land choice from resolution queue:', step);
        setBounceLandData({
          bounceLandId: step.bounceLandId,
          bounceLandName: step.bounceLandName || step.sourceName || 'Bounce Land',
          imageUrl: step.sourceImage || step.sourceImageUrl,
          landsToChoose: step.landsToChoose || [],
          stackItemId: step.stackItemId,
          stepId: step.id,  // Store the step ID for resolution response
        });
        setBounceLandModalOpen(true);
      }

      // Handle Commander replacement choice (Rule 903.9a) via Resolution Queue
      else if (step.type === 'commander_zone_choice') {
        const choice = {
          commanderId: step.commanderId,
          commanderName: step.commanderName,
          destinationZone: step.fromZone,
          libraryPosition: step.libraryPosition,
          card: step.card,
          exileTag: step.exileTag,
        };
        setResolutionCommanderZoneChoice({ stepId: step.id, choice });
      }
      
      // Handle Join Forces resolution step
      else if (step.type === 'join_forces') {
        const allPlayers = (safeView?.players || []).map(p => p.id);
        const initiatorPlayer = (safeView?.players || []).find(p => p.id === step.initiator);

        // Convert to JoinForcesRequest and open the modal
        const request: JoinForcesRequest = {
          id: step.id,
          gameId: payload.gameId,
          initiator: step.initiator,
          initiatorName: step.isInitiator ? 'You' : (initiatorPlayer?.name || step.initiator),
          cardName: step.cardName || step.sourceName || 'Join Forces',
          effectDescription: step.effectDescription || step.description || '',
          cardImageUrl: step.cardImageUrl || step.sourceImage,
          players: allPlayers,
          timeoutMs: step.timeoutMs || 60000,
        };
        
        // Store stepId for resolution response
        (request as any).stepId = step.id;
        (request as any).isInitiator = step.isInitiator;
        (request as any).availableMana = step.availableMana;
        
        setJoinForcesRequest(request);
        setJoinForcesContributions({});
        setJoinForcesResponded([]);
        setJoinForcesModalOpen(true);
      }
      
      // Handle Tempting Offer resolution step
      else if (step.type === 'tempting_offer') {
        const opponents = (safeView?.players || []).map(p => p.id).filter(pid => pid !== step.initiator);
        const initiatorPlayer = (safeView?.players || []).find(p => p.id === step.initiator);

        // Convert to TemptingOfferRequest and open the modal
        const request: TemptingOfferRequest = {
          id: step.id,
          gameId: payload.gameId,
          initiator: step.initiator,
          initiatorName: step.initiator === you ? 'You' : (initiatorPlayer?.name || step.initiator),
          cardName: step.cardName || step.sourceName || 'Tempting Offer',
          effectDescription: step.effectDescription || step.description || '',
          cardImageUrl: step.cardImageUrl || step.sourceImage,
          opponents,
          timeoutMs: step.timeoutMs || 60000,
        };
        
        // Store stepId for resolution response
        (request as any).stepId = step.id;
        (request as any).isOpponent = step.isOpponent;
        
        setTemptingOfferRequest(request);
        setTemptingOfferResponded([]);
        setTemptingOfferAcceptedBy([]);
        setTemptingOfferModalOpen(true);
      }

      // Handle Player Choice resolution step (generic player selection)
      else if (step.type === 'player_choice') {
        setResolutionPlayerChoiceModalData({
          stepId: step.id,
          title: step.sourceName || 'Choose Player',
          description: step.description || '',
          source: {
            name: step.sourceName || 'Choose Player',
            imageUrl: step.sourceImage,
          },
          players: (step.players || []).map((p: any) => ({
            id: p.id,
            name: p.name || p.id,
            life: p.life ?? 0,
            libraryCount: p.libraryCount,
            isOpponent: Boolean(p.isOpponent),
            isSelf: Boolean(p.isSelf),
          })),
          opponentOnly: Boolean(step.opponentOnly),
          isOptional: Boolean(step.isOptional) || step.mandatory === false,
        });
        setResolutionPlayerChoiceModalOpen(true);
      }
      
      // Handle Cascade resolution step
      else if (step.type === 'cascade') {  // Uses ResolutionStepType.CASCADE on server
        setCascadePrompt({
          gameId: payload.gameId,
          effectId: step.effectId,
          playerId: step.playerId,
          sourceName: step.sourceName || 'Cascade',
          cascadeNumber: step.cascadeNumber || 1,
          totalCascades: step.totalCascades || 1,
          hitCard: step.hitCard,
          exiledCards: step.exiledCards || [],
          stepId: step.id,  // Store the step ID for resolution response
        });
        setCascadeModalOpen(true);
      }
      
      // Handle Scry resolution step
      else if (step.type === 'scry') {
        setPeek({
          mode: 'scry',
          cards: step.cards || [],
          stepId: step.id,
        });
      }
      
      // Handle Surveil resolution step
      else if (step.type === 'surveil') {
        setPeek({
          mode: 'surveil',
          cards: step.cards || [],
          stepId: step.id,
        });
      }

      // Handle Bottom Order resolution step
      else if (step.type === 'bottom_order') {
        setPeek({
          mode: 'bottom_order',
          cards: step.cards || [],
          stepId: step.id,
        });
      }
      
      // Handle Proliferate resolution step
      else if (step.type === 'proliferate') {
        setProliferateData({
          proliferateId: step.proliferateId || step.id,
          sourceName: step.sourceName || 'Proliferate',
          sourceImageUrl: step.sourceImage || step.sourceImageUrl,
          validTargets: step.availableTargets || [],
          stepId: step.id,
        });
        setProliferateModalOpen(true);
      }
      
      // Handle Fateseal resolution step
      else if (step.type === 'fateseal') {
        setFatesealData({
          opponentId: step.opponentId,
          opponentName: step.opponentName || 'opponent',
          cards: step.cards || [],
          stepId: step.id,
          sourceName: step.sourceName || 'Fateseal',
        });
        setFatesealModalOpen(true);
      }
      
      // Handle Clash resolution step
      else if (step.type === 'clash') {
        setClashData({
          revealedCard: step.revealedCard,
          opponentId: step.opponentId,
          stepId: step.id,
          sourceName: step.sourceName || 'Clash',
        });
        setClashModalOpen(true);
      }
      
      // Handle Vote resolution step
      else if (step.type === 'vote') {
        setVoteData({
          voteId: step.voteId || step.id,
          choices: step.choices || [],
          votesSubmitted: step.votesSubmitted || [],
          stepId: step.id,
          sourceName: step.sourceName || 'Vote',
        });
        setVoteModalOpen(true);
      }
      
      // Handle Ponder Effect resolution step
      else if (step.type === 'ponder_effect') {
        setPonderRequest({
          effectId: step.id,
          cardName: step.sourceName || 'Ponder',
          cardImageUrl: step.sourceImage,
          cards: step.cards || [],
          variant: step.variant || 'ponder',
          canShuffle: step.mayShuffleAfter !== false,
          drawAfter: step.drawAfter || false,
          pickToHand: 0,  // Will be determined by variant
          targetPlayerId: step.targetPlayerId || step.playerId,
          targetPlayerName: step.targetPlayerName,
          isOwnLibrary: step.playerId === (step.targetPlayerId || step.playerId),
          stepId: step.id,  // Store for resolution response
        });
        setPonderModalOpen(true);
      }
      
      // Handle Library Search resolution step
      else if (step.type === 'library_search') {
        const isSplit = (step as any).splitDestination === true;
        const destinationRaw = String((step as any).destination || 'hand');
        const entersTapped = Boolean((step as any).entersTapped);
        const moveTo: 'hand' | 'battlefield' | 'top' | 'graveyard' | 'split' = isSplit
          ? 'split'
          : (destinationRaw === 'battlefield' || destinationRaw === 'hand' || destinationRaw === 'top' || destinationRaw === 'graveyard')
            ? destinationRaw
            : 'hand';

        setLibrarySearchData({
          cards: step.availableCards || [],
          title: step.sourceName || 'Search Library',
          description: step.description || step.searchCriteria || 'Search your library',
          filter: step.filter || {},
          maxSelections: step.maxSelections || 1,
          moveTo,
          shuffleAfter: step.shuffleAfter !== false,
          targetPlayerId: (step as any).targetPlayerId || step.playerId,
          splitDestination: (step as any).splitDestination || false,
          toBattlefield: (step as any).toBattlefield || 0,
          toHand: (step as any).toHand || 0,
          entersTapped,
          stepId: step.id,  // Store for resolution response
        });
        setLibrarySearchModalOpen(true);
      }
      // Handle color choice via resolution queue (Throne of Eldraine, Caged Sun, etc.)
      else if (step.type === 'color_choice') {
        setColorChoiceModalData({
          confirmId: step.id,
          permanentId: (step as any).permanentId || step.sourceId,
          spellId: (step as any).spellId,
          cardName: (step as any).cardName || step.sourceName || 'Permanent',
          reason: (step as any).reason || step.description || 'Choose a color',
          imageUrl: step.sourceImage,
          colors: (step as any).colors || ['white', 'blue', 'black', 'red', 'green'],
        });
        setColorChoiceModalOpen(true);
      }
      // Handle card name choice via resolution queue
      else if (step.type === 'card_name_choice') {
        setCardNameChoiceModalData({
          stepId: step.id,
          cardName: (step as any).cardName || step.sourceName || 'Permanent',
          reason: (step as any).reason || step.description || 'Choose a card name',
          imageUrl: step.sourceImage,
          mandatory: step.mandatory !== false,
        });
        setCardNameChoiceModalOpen(true);
      }
      // Handle creature type choice via resolution queue
      else if (step.type === 'creature_type_choice') {
        setCreatureTypeModalData({
          stepId: step.id,
          confirmId: step.id,
          permanentId: (step as any).permanentId,
          cardName: (step as any).cardName || step.sourceName,
          reason: (step as any).reason || step.description,
        });
        setCreatureTypeModalOpen(true);
      }
      // Handle mode selection via resolution queue (modal spells / choice events)
      else if (step.type === 'mode_selection') {
        const minModes = Number(step.minModes ?? 1);
        const maxModes = Number(step.maxModes ?? 1);
        const purpose = String((step as any).modeSelectionPurpose || '');
        const isMultiSelect = maxModes < 0 || maxModes > 1 || minModes > 1 || purpose === 'modalSpell' || purpose === 'spree';

        if (isMultiSelect) {
          const spellModes: SpellMode[] = (step.modes || []).map((m: any, idx: number) => ({
            id: String(m.id ?? `mode_${idx + 1}`),
            name: String(m.label ?? `Mode ${idx + 1}`),
            description: String(m.description ?? ''),
          }));

          setModalSpellModalData({
            cardId: step.sourceId || step.id,
            cardName: step.sourceName || 'Spell',
            description: step.description,
            imageUrl: step.sourceImage,
            modes: spellModes,
            modeCount: maxModes,
            canChooseAny: maxModes < 0,
            minModes: minModes,
            isSpree: purpose === 'spree',
            effectId: step.sourceId,
            resolutionStepId: String(step.id),
            mandatory: step.mandatory !== false,
          });
          setModalSpellModalOpen(true);
          return;
        }

        const modes: CastingMode[] = (step.modes || []).map((m: any, idx: number) => ({
          id: String(m.id ?? `mode_${idx + 1}`),
          name: String(m.label ?? `Mode ${idx + 1}`),
          description: String(m.description ?? ''),
          cost: null,
        }));

        setCastingModeModalData({
          cardId: step.sourceId || step.id,
          cardName: step.sourceName || 'Spell',
          source: step.sourceName,
          title: step.description || 'Choose a mode',
          description: 'Choose a mode before selecting targets.',
          imageUrl: step.sourceImage,
          modes,
          effectId: step.sourceId,
          resolutionStepId: step.id,
          resolutionStepMandatory: step.mandatory !== false,
        });
        setCastingModeModalOpen(true);
      }

      // Additional cost payment (discard/sacrifice) via Resolution Queue
      else if (step.type === 'additional_cost_payment') {
        setAdditionalCostModalData({
          cardId: String(step.cardId || step.sourceId || step.id),
          cardName: String(step.cardName || step.sourceName || 'Spell'),
          costType: (step.costType === 'sacrifice' ? 'sacrifice' : 'discard'),
          amount: Number(step.amount || 0),
          title: String(step.title || step.description || 'Pay additional cost'),
          description: String(step.description || ''),
          imageUrl: step.imageUrl || step.sourceImage,
          availableCards: step.availableCards,
          availableTargets: step.availableTargets,
          effectId: step.sourceId,
          resolutionStepId: String(step.id),
          resolutionStepMandatory: step.mandatory !== false,
        });
        setAdditionalCostModalOpen(true);
      }

      // Squad cost payment via Resolution Queue
      else if (step.type === 'squad_cost_payment') {
        setSquadCostModalData({
          cardId: String(step.cardId || step.sourceId || step.id),
          cardName: String(step.cardName || step.sourceName || 'Spell'),
          squadCost: String(step.squadCost || ''),
          imageUrl: step.imageUrl || step.sourceImage,
          effectId: step.sourceId,
          resolutionStepId: String(step.id),
          mandatory: step.mandatory !== false,
        });
        setSquadCostModalOpen(true);
      }

      // Explore (single) via Resolution Queue
      else if (step.type === 'explore_decision') {
        setBatchExploreIndividual(null);
        setExplorePrompt({
          stepId: String(step.id),
          permanentId: String(step.permanentId || step.sourceId || ''),
          permanentName: String(step.permanentName || step.sourceName || 'Creature'),
          revealedCard: step.revealedCard,
          isLand: Boolean(step.isLand),
        });
      }

      // Batch Explore via Resolution Queue
      else if (step.type === 'batch_explore_decision') {
        setBatchExploreIndividual(null);
        setBatchExplorePrompt({
          stepId: String(step.id),
          explores: step.explores || [],
        });
      }
      // Handle target selection via resolution queue (spell casting, planeswalker abilities, etc.)
      else if (step.type === 'target_selection') {
        const selectedModeRaw = (step as any).selectedMode as { label?: string; description?: string } | undefined;
        const selectedModeUi = selectedModeRaw ? {
          name: String(selectedModeRaw.label || 'Selected mode'),
          description: String(selectedModeRaw.description || ''),
        } : undefined;

        // Convert resolution queue step to target modal format
        const validTargets: TargetOption[] = (step.validTargets || []).map((t: any) => ({
          id: t.id,
          type: (t.type as any) || (t.description === 'player' || t.description === 'permanent' || t.description === 'card' ? t.description : 'permanent'),
          name: t.label || t.name || 'Unknown',
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
          cardId: step.sourceId || '',
          source: { name: step.sourceName || 'Effect', imageUrl: step.sourceImage },
          title: step.description || `Choose target`,
          description: (selectedModeUi?.description && (!step.targetDescription || step.targetDescription === 'target')
            ? selectedModeUi.description
            : (step.targetDescription || '')),
          contextSteps: (step.oracleContext?.steps || step.spellCastContext?.oracleContext?.steps || undefined) as any,
          selectedMode: selectedModeUi,
          targets: validTargets,
          minTargets: step.minTargets || 1,
          maxTargets: step.maxTargets || 1,
          effectId: step.sourceId,
          stepId: step.id,  // Store step ID for resolution response
          useResolutionQueue: true,  // Flag to indicate this came from Resolution Queue
        });
        setTargetModalOpen(true);
      }

      // Handle upkeep sacrifice via resolution queue (Eldrazi Monument, Smokestack, and generic "sacrifice a creature" effects)
      else if (step.type === 'upkeep_sacrifice') {
        const creatures = (step.creatures || []) as Array<{ id: string; name: string; imageUrl?: string }>;
        const allowSourceSacrifice = (step as any).allowSourceSacrifice !== false;
        const sourceToSacrifice = (step as any).sourceToSacrifice as { id: string; name: string; imageUrl?: string } | undefined;

        const resolutionSourceChoiceId = '__SACRIFICE_SOURCE__';
        const availableTargets: Array<{ id: string; name: string; imageUrl?: string; typeLine?: string }> = creatures.map(c => ({
          id: c.id,
          name: c.name,
          imageUrl: c.imageUrl,
          typeLine: 'Creature',
        }));

        if (allowSourceSacrifice && sourceToSacrifice) {
          availableTargets.push({
            id: resolutionSourceChoiceId,
            name: sourceToSacrifice.name || step.sourceName || 'Source',
            imageUrl: sourceToSacrifice.imageUrl,
            typeLine: 'Source',
          });
        }

        setAdditionalCostModalData({
          cardId: step.sourceId || step.id,
          cardName: step.sourceName || 'Sacrifice',
          costType: 'sacrifice',
          amount: 1,
          title: step.sourceName || 'Sacrifice',
          description: step.description || 'Choose a permanent to sacrifice',
          imageUrl: step.sourceImage,
          availableTargets,
          effectId: step.id,
          resolutionStepId: step.id,
          resolutionStepMandatory: step.mandatory !== false,
          resolutionSourceChoiceId: allowSourceSacrifice && sourceToSacrifice ? resolutionSourceChoiceId : undefined,
        });
        setAdditionalCostModalOpen(true);
      }

      // Handle trigger ordering via resolution queue
      else if (step.type === 'trigger_order') {
        const triggers: any[] = (step.triggers || []) as any[];
        const promptTriggers: TriggerPromptData[] = triggers.map((t: any) => ({
          id: t.id,
          sourceId: t.sourceId || '',
          sourceName: t.sourceName || 'Triggered Ability',
          effect: t.effect || t.description || '',
          type: 'order',
          imageUrl: t.imageUrl,
        }));

        setTriggerOrderStepId(step.id);
        setPendingTriggers(promptTriggers);
        setTriggerModalOpen(true);
      }
    };
    
    socket.on("resolutionStepPrompt", handleResolutionStepPrompt);
    
    return () => {
      socket.off("resolutionStepPrompt", handleResolutionStepPrompt);
    };
  }, [safeView?.id]);

  // Mutate target selection listener
  useEffect(() => {
    const handleMutateTargetsResponse = (data: {
      gameId: string;
      cardId: string;
      cardName: string;
      mutateCost: string;
      imageUrl?: string;
      validTargets: MutateTarget[];
    }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      setMutateModalData({
        cardId: data.cardId,
        cardName: data.cardName,
        imageUrl: data.imageUrl,
        mutateCost: data.mutateCost,
        targets: data.validTargets,
      });
      setMutateModalOpen(true);
    };

    const handleRequestMutateTargetSelection = (data: { gameId: string; cardId: string }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      // Request mutate targets from the server
      socket.emit("requestMutateTargets", { gameId: safeView.id, cardId: data.cardId });
    };

    socket.on("mutateTargetsResponse", handleMutateTargetsResponse);
    socket.on("requestMutateTargetSelection", handleRequestMutateTargetSelection);

    return () => {
      socket.off("mutateTargetsResponse", handleMutateTargetsResponse);
      socket.off("requestMutateTargetSelection", handleRequestMutateTargetSelection);
    };
  }, [safeView?.id]);



  // Explore prompt handler
  // Legacy explorePrompt / batchExplorePrompt listeners removed - now handled via Resolution Queue.

  // Interaction request handlers
  useEffect(() => {
    // Tap/Untap Target Request handler
    // tap/untap target selection is handled via Resolution Queue (resolutionStepPrompt)

    return () => {
    };
  }, [safeView?.id]);

  // Scry/Surveil peek handlers
  useEffect(() => {
    const handleScryPeek = (data: { gameId: string; cards: any[] }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      setPeek({ mode: "scry", cards: data.cards });
    };

    const handleSurveilPeek = (data: { gameId: string; cards: any[] }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      setPeek({ mode: "surveil", cards: data.cards });
    };

    socket.on("scryPeek", handleScryPeek);
    socket.on("surveilPeek", handleSurveilPeek);
    return () => {
      socket.off("scryPeek", handleScryPeek);
      socket.off("surveilPeek", handleSurveilPeek);
    };
  }, [safeView?.id]);

  // Game over notification listener
  useEffect(() => {
    const handleGameOver = (data: { 
      gameId: string; 
      type: 'victory' | 'defeat' | 'eliminated' | 'draw';
      winnerId?: string;
      winnerName?: string;
      loserId?: string;
      loserName?: string;
      message?: string;
    }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      
      let notificationType: 'victory' | 'defeat' | 'eliminated' | 'draw' = data.type;
      let message = data.message || '';
      
      // Determine notification type based on who we are
      if (data.type === 'victory' && data.winnerId === you) {
        notificationType = 'victory';
        message = message || "You've Won!";
      } else if (data.type === 'defeat' && data.loserId === you) {
        notificationType = 'defeat';
        message = message || "Defeated";
      } else if (data.type === 'eliminated' && data.loserId === you) {
        notificationType = 'eliminated';
        message = message || "Eliminated";
      } else if (data.type === 'draw') {
        notificationType = 'draw';
        message = message || "Draw!";
      } else if (data.winnerId && data.winnerId !== you) {
        // Someone else won
        notificationType = 'defeat';
        message = `${data.winnerName || 'Opponent'} has won the game`;
      }
      
      setGameOverData({
        type: notificationType,
        message,
        winnerId: data.winnerId,
        winnerName: data.winnerName,
      });
      setGameOverModalOpen(true);
      
      // Auto-close after 3 seconds
      setTimeout(() => {
        setGameOverModalOpen(false);
        setGameOverData(null);
      }, 3000);
    };

    const handlePlayerEliminated = (data: { 
      gameId: string; 
      playerId: string;
      playerName: string;
      reason?: string;
    }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      
      if (data.playerId === you) {
        setGameOverData({
          type: 'eliminated',
          message: 'Eliminated',
        });
        setGameOverModalOpen(true);
        
        setTimeout(() => {
          setGameOverModalOpen(false);
          setGameOverData(null);
        }, 3000);
      }
    };

    const handlePlayerConceded = (data: {
      gameId: string;
      playerId: string;
      playerName: string;
      message?: string;
    }) => {
      if (!safeView || data.gameId !== safeView.id) return;
      
      // If you conceded, show a brief notification
      if (data.playerId === you) {
        setGameOverData({
          type: 'eliminated',
          message: 'You Conceded',
        });
        setGameOverModalOpen(true);
        
        setTimeout(() => {
          setGameOverModalOpen(false);
          setGameOverData(null);
        }, 2000);
      }
    };

    socket.on("gameOver", handleGameOver);
    socket.on("playerEliminated", handlePlayerEliminated);
    socket.on("playerConceded", handlePlayerConceded);
    return () => {
      socket.off("gameOver", handleGameOver);
      socket.off("playerEliminated", handlePlayerEliminated);
      socket.off("playerConceded", handlePlayerConceded);
    };
  }, [safeView?.id, you]);

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

  // Auto-open mulligan bottom modal when pending bottom selection detected (from state)
  React.useEffect(() => {
    if (pendingBottomCount > 0 && !hasKeptHand) {
      setMulliganBottomCount(pendingBottomCount);
      const stepIdFromState = (mulliganState as any)?.pendingBottomStepId;
      if (typeof stepIdFromState === 'string' && stepIdFromState.length > 0) {
        setMulliganBottomStepId(stepIdFromState);
      } else {
        // Best-effort fallback: ask server for the next resolution step
        if (safeView?.id) {
          socket.emit('getMyNextResolutionStep', { gameId: safeView.id });
        }
      }
      setMulliganBottomModalOpen(true);
    }
  }, [pendingBottomCount, hasKeptHand, mulliganState, safeView?.id]);

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
    if (safeView.turnPlayer == null || safeView.turnPlayer !== you) return;
    
    // Only auto-advance during certain phases/steps
    const step = String(safeView.step || '').toLowerCase();
    const phase = String(safeView.phase || '').toLowerCase();
    
    // Don't auto-advance if there's something on the stack
    if ((safeView as any).stack?.length > 0) return;
    
    // Don't auto-advance during cleanup if we have pending discard selection
    const isCleanup = step === 'cleanup' || phase.includes('cleanup');
    if (isCleanup && discardModalOpen && discardCount > 0) return;
    
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
    if (safeView.turnPlayer != null && safeView.turnPlayer === you) return true;
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
    // Get max lands per turn from game state, default to 1 if not set
    const maxLandsPerTurn =
      (safeView as any).maxLandsPerTurn?.[you] || 1;

    if (turnPlayer == null || turnPlayer !== you) return "Not your turn";
    if (!phase || !String(phase).toLowerCase().includes("main")) {
      return "Can only play lands during your main phase";
    }
    if (landsPlayedThisTurn >= maxLandsPerTurn) {
      return maxLandsPerTurn > 1
        ? `You have already played ${landsPlayedThisTurn} land(s) this turn (max ${maxLandsPerTurn})`
        : "You have already played a land this turn";
    }

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
    if (keywords.some((k: string) => k.toLowerCase() === 'haste') ||
        grantedAbilities.some((a: string) => a.toLowerCase().includes('haste')) ||
        /\bhaste\b/i.test(oracleText)) {
      return true;
    }
    
    // 4. Check attached equipment for haste grants (e.g., Lightning Greaves, Swiftfoot Boots)
    const battlefield = safeView?.battlefield || [];
    
    // Helper function to detect if equipment grants haste
    const equipmentGrantsHaste = (equipOracle: string): boolean => {
      if (!equipOracle.includes('equipped creature') && !equipOracle.includes('enchanted creature')) {
        return false;
      }
      return equipOracle.includes('has haste') || 
             equipOracle.includes('have haste') ||
             equipOracle.includes('gains haste') ||
             /(?:equipped|enchanted) creature has (?:[\w\s,]+\s+and\s+)?haste/i.test(equipOracle);
    };
    
    // Check attachedEquipment array
    const attachedEquipment = (perm as any).attachedEquipment || [];
    for (const equipId of attachedEquipment) {
      const equipment = battlefield.find((p: any) => p.id === equipId);
      if (equipment && equipment.card) {
        const equipOracle = ((equipment.card as any).oracle_text || '').toLowerCase();
        if (equipmentGrantsHaste(equipOracle)) {
          return true;
        }
      }
    }
    
    // Also check by attachedTo relationship (in case attachedEquipment isn't set)
    for (const equip of battlefield) {
      if (!equip || !equip.card) continue;
      const equipTypeLine = ((equip.card as any).type_line || '').toLowerCase();
      if (!equipTypeLine.includes('equipment') && !equipTypeLine.includes('aura')) continue;
      if ((equip as any).attachedTo !== perm.id) continue;
      
      const equipOracle = ((equip.card as any).oracle_text || '').toLowerCase();
      if (equipmentGrantsHaste(equipOracle)) {
        return true;
      }
    }
    
    return false;
  };

  // Color mapping for mana symbols - extracted as constant to avoid recreation
  const MANA_COLOR_MAP: Record<string, ManaColor> = {
    'W': 'W', 'U': 'U', 'B': 'B', 'R': 'R', 'G': 'G', 'C': 'C'
  };

  // Get available mana sources (untapped lands and mana-producing artifacts/creatures)
  const getAvailableManaSourcesForPlayer = (playerId: string) => {
    if (!safeView) return [];
    
    const sources: Array<{ id: string; name: string; options: ManaColor[]; amount?: number }> = [];
    
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
      
      // Check if permanent has a special mana amount (from Priest of Titania, Bighorn Rancher, etc.)
      const manaAmount = (perm as any).manaAmount;
      const manaColor = (perm as any).manaColor;
      
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
        // Must have a tap ability that produces mana: "{T}: Add {X}" or "{T}: Add one mana"
        // Be careful not to match "in addition" or "add a counter" or "add it to your hand"
        const hasTapManaAbility = (
          // Pattern 1: {t}: add {X} where X is a mana symbol (single or multiple)
          oracleText.match(/\{t\}:\s*add\s+\{[wubrgc]\}/i) ||
          // Pattern 2: {t}: add {X}{Y} for multi-mana like Sol Ring {C}{C}
          oracleText.match(/\{t\}:\s*add\s+\{[wubrgc]\}\{[wubrgc]\}/i) ||
          // Pattern 3: {t}: add one mana of any color
          oracleText.match(/\{t\}:\s*add\s+one\s+mana/i) ||
          // Pattern 4: {t}: add X mana (for variable amounts)
          oracleText.match(/\{t\}:\s*add\s+\w+\s+mana/i) ||
          // Pattern 5: {t}: add an amount of {X} (Bighorner Rancher, Karametra's Acolyte)
          oracleText.match(/\{t\}:\s*add\s+an\s+amount\s+of\s+\{[wubrgc]\}/i) ||
          // Pattern 6: {t}, sacrifice: add (for treasure-like effects)
          oracleText.match(/\{t\},\s*sacrifice[^:]*:\s*add\s+/i)
        );
        
        if (hasTapManaAbility) {
          // Check for Metalcraft requirement in oracle text (e.g., Mox Opal)
          // Metalcraft - "as long as you control three or more artifacts"
          if (oracleText.includes('metalcraft') || 
              oracleText.includes('three or more artifacts') ||
              oracleText.includes('3 or more artifacts')) {
            if (!checkMetalcraft(playerId)) {
              continue; // Skip if metalcraft not met
            }
          }
          
          // If this permanent has a special mana amount, use that specific color
          if (manaAmount && manaAmount > 0 && manaColor) {
            const mappedColor = MANA_COLOR_MAP[manaColor.toUpperCase()] || 'C';
            sources.push({ id: perm.id, name, options: [mappedColor], amount: manaAmount });
          } else {
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
    }
    
    return sources;
  };

  // Handle cast spell confirmation from modal - works for both hand and commander spells
  const handleCastSpellConfirm = (payment: PaymentItem[], alternateCostId?: string, xValue?: number, convokeTappedCreatures?: string[]) => {
    if (!safeView || !spellToCast) return;
    
    debug(2, `[Client] Casting ${spellToCast.isCommander ? 'commander' : 'spell'}: ${spellToCast.cardName} with payment:`, payment);
    if (convokeTappedCreatures && convokeTappedCreatures.length > 0) {
      debug(2, `[Client] Convoke: tapping ${convokeTappedCreatures.length} creature(s):`, convokeTappedCreatures);
    }
    
    if (spellToCast.isCommander) {
      // Cast commander from command zone
      socket.emit("castCommander", {
        gameId: safeView.id,
        commanderNameOrId: spellToCast.cardId,
        payment: payment.length > 0 ? payment : undefined,
      });
    } else if (spellToCast.effectId) {
      // MTG-compliant flow: targets were already selected, now completing with payment
      // Use completeCastSpell to finalize
      socket.emit("completeCastSpell", {
        gameId: safeView.id,
        cardId: spellToCast.cardId,
        targets: spellToCast.targets,
        payment: payment.length > 0 ? payment : undefined,
        effectId: spellToCast.effectId,
        xValue,
        alternateCostId,
        convokeTappedCreatures,
      });
    } else {
      // Legacy flow: direct cast from hand (will check targets on server)
      socket.emit("castSpellFromHand", {
        gameId: safeView.id,
        cardId: spellToCast.cardId,
        payment: payment.length > 0 ? payment : undefined,
        xValue,
        alternateCostId,
        convokeTappedCreatures,
      });
    }
    
    setCastSpellModalOpen(false);
    setSpellToCast(null);
  };

  const handleCastSpellCancel = () => {
    // Notify server to clean up pending state if this was a MTG-compliant cast with effectId
    if (safeView && spellToCast?.effectId) {
      socket.emit("targetSelectionCancel", {
        gameId: safeView.id,
        cardId: spellToCast.cardId,
        effectId: spellToCast.effectId,
      });
    }
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
    // Defensive validation: ensure commanderId is not undefined or empty
    if (!commanderId || (typeof commanderId === 'string' && commanderId.trim() === '')) {
      console.error('[handleCastCommander] Invalid commanderId:', { commanderId, commanderName });
      alert(`Cannot cast commander: Invalid commander ID. This may be a bug - please refresh and try again.`);
      return;
    }
    
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
    setCombatModalError(null);
    socket.emit("declareBlockers", {
      gameId: safeView.id,
      blockers,
    });
    // Do not close immediately. If the server rejects the blocks, we need to keep (or re-open)
    // the modal so the defending player can correct them.
  };

  const handleSkipCombat = () => {
    if (!safeView) return;
    if (combatMode === 'attackers') {
      socket.emit("skipDeclareAttackers", { gameId: safeView.id });
      setCombatModalOpen(false);
    } else {
      setCombatModalError(null);
      socket.emit("skipDeclareBlockers", { gameId: safeView.id });
      // Same rationale as handleDeclareBlockers: let the server close this via blockersDeclaredBy.
    }
  };

  // Bounce land handler - player selects which land to return
  const handleBounceLandSelect = (permanentId: string) => {
    if (!safeView || !bounceLandData) return;
    
    const stepId = (bounceLandData as any).stepId;
    if (!stepId) {
      debug(1, '[BounceLand] Missing stepId - bounce lands must use resolution queue');
      return;
    }
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: permanentId,
      cancelled: false,
    });
    debug(2, '[BounceLand] Completed resolution step via resolution queue');
    
    setBounceLandModalOpen(false);
    setBounceLandData(null);
  };

  // Proliferate handler - player selects targets to proliferate
  const handleProliferateConfirm = (selectedIds: string[]) => {
    if (!safeView || !proliferateData) return;
    
    // Use the resolution queue system
    if (!proliferateData.stepId) {
      console.error('[Proliferate] Missing stepId - must use resolution queue');
      return;
    }
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: proliferateData.stepId,
      selections: selectedIds,
      cancelled: false,
    });
    
    setProliferateModalOpen(false);
    setProliferateData(null);
  };
  
  // Fateseal handler - player orders opponent's library
  const handleFatesealConfirm = (payload: { keepTopOrder: any[]; bottomOrder: any[] }) => {
    if (!safeView || !fatesealData) return;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: fatesealData.stepId,
      selections: payload,
      cancelled: false,
    });
    
    setFatesealModalOpen(false);
    setFatesealData(null);
  };
  
  // Clash handler - player chooses whether to put card on bottom
  const handleClashConfirm = (putOnBottom: boolean) => {
    if (!safeView || !clashData) return;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: clashData.stepId,
      selections: putOnBottom,
      cancelled: false,
    });
    
    setClashModalOpen(false);
    setClashData(null);
  };
  
  // Vote handler - player submits their vote
  const handleVoteConfirm = (choice: string) => {
    if (!safeView || !voteData) return;
    
    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId: voteData.stepId,
      selections: choice,
      cancelled: false,
    });
    
    setVoteModalOpen(false);
    setVoteData(null);
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
      next.set(sourceKey, { sourceId: sourceId || undefined, sourceName, count: 1, effect, imageUrl });
      return next;
    });

    // Also enable server-side yielding (for stack priority) when possible
    if (sourceId) {
      socket.emit('yieldToTriggerSource', {
        gameId: safeView.id,
        sourceId,
        sourceName,
      });
    }
    
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
    if (!safeView) return;
    const sourceKey = sourceId || sourceName;
    setIgnoredTriggerSources(prev => {
      const next = new Map(prev);
      next.set(sourceKey, { sourceId: sourceId || undefined, sourceName, count: 0, effect, imageUrl });
      return next;
    });

    if (sourceId) {
      socket.emit('yieldToTriggerSource', {
        gameId: safeView.id,
        sourceId,
        sourceName,
      });
    }
  };

  // Stop ignoring a trigger source
  const handleStopIgnoringSource = (sourceKey: string) => {
    if (!safeView) {
      setIgnoredTriggerSources(prev => {
        const next = new Map(prev);
        next.delete(sourceKey);
        return next;
      });
      return;
    }

    const entry = ignoredTriggerSources.get(sourceKey);
    const sourceId = entry?.sourceId;
    if (sourceId) {
      socket.emit('unyieldToTriggerSource', {
        gameId: safeView.id,
        sourceId,
      });
    }
    setIgnoredTriggerSources(prev => {
      const next = new Map(prev);
      next.delete(sourceKey);
      return next;
    });
  };

  // Handle ordering of multiple simultaneous triggers
  const handleOrderTriggersConfirm = (orderedTriggerIds: string[]) => {
    if (!safeView) return;

    // Trigger ordering is handled via Resolution Queue now.
    if (triggerOrderStepId) {
      socket.emit('submitResolutionResponse', {
        gameId: safeView.id,
        stepId: triggerOrderStepId,
        selections: orderedTriggerIds,
        cancelled: false,
      });
      setTriggerOrderStepId(null);
      setPendingTriggers(prev => prev.filter(t => !orderedTriggerIds.includes(t.id)));
      setTriggerModalOpen(false);
      return;
    }

    // No active trigger-order resolution step; just close ordering UI.
    setPendingTriggers(prev => prev.filter(t => !orderedTriggerIds.includes(t.id)));
    setTriggerModalOpen(false);
  };

  // Library search handlers (Tutor effects)
  const handleLibrarySearchConfirm = (
    selectedCardIds: string[], 
    moveTo: string,
    splitAssignments?: { toBattlefield: string[]; toHand: string[] }
  ) => {
    if (!safeView || !librarySearchData) return;
    
    // If we have a stepId, use the resolution queue system
    if ((librarySearchData as any).stepId) {
      socket.emit("submitResolutionResponse", {
        gameId: safeView.id,
        stepId: (librarySearchData as any).stepId,
        selections: selectedCardIds,
        cancelled: false,
        // Include split assignments for Cultivate/Kodama's Reach effects
        splitAssignments,
        moveTo,
      });
    } else {
      // Legacy handler for backward compatibility
      socket.emit("librarySearchSelect", {
        gameId: safeView.id,
        selectedCardIds: selectedCardIds,
        moveTo: moveTo,
        splitAssignments,
      });
    }
    setLibrarySearchModalOpen(false);
    setLibrarySearchData(null);
  };

  const handleLibrarySearchCancel = () => {
    if (!safeView || !librarySearchData) return;
    
    // If we have a stepId, use the resolution queue system
    if ((librarySearchData as any).stepId) {
      socket.emit("submitResolutionResponse", {
        gameId: safeView.id,
        stepId: (librarySearchData as any).stepId,
        selections: [],
        cancelled: true,
      });
    } else {
      // Legacy handler for backward compatibility
      socket.emit("librarySearchCancel", {
        gameId: safeView.id,
      });
    }
    setLibrarySearchModalOpen(false);
    setLibrarySearchData(null);
  };

  // Target selection handlers
  const handleTargetConfirm = (selectedTargetIds: string[]) => {
    if (!safeView || !targetModalData) return;
    
    // Check if this came from Resolution Queue
    if (targetModalData.useResolutionQueue && targetModalData.stepId) {
      // Use Resolution Queue response system
      socket.emit("submitResolutionResponse", {
        gameId: safeView.id,
        stepId: targetModalData.stepId,
        selections: selectedTargetIds,
        cancelled: false,
      });
    } else {
      // Legacy flow using targetSelectionConfirm
      socket.emit("targetSelectionConfirm", {
        gameId: safeView.id,
        cardId: targetModalData?.cardId || "",
        targets: selectedTargetIds,
        effectId: targetModalData?.effectId,
      });
    }
    setTargetModalOpen(false);
    setTargetModalData(null);
  };

  const handleTargetCancel = () => {
    if (!safeView) return;
    
    // Check if this came from Resolution Queue
    if (targetModalData && targetModalData.useResolutionQueue && targetModalData.stepId) {
      // Use Resolution Queue cancel system
      socket.emit("cancelResolutionStep", {
        gameId: safeView.id,
        stepId: targetModalData.stepId,
      });
    } else {
      // Legacy flow using targetSelectionCancel
      socket.emit("targetSelectionCancel", {
        gameId: safeView.id,
        cardId: targetModalData?.cardId || "",
        effectId: targetModalData?.effectId,
      });
    }
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
      type: "action",
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
    
    // Close split card modal
    setSplitCardModalOpen(false);
    setSplitCardData(null);
    
    // Determine face index for MTG-compliant flow
    let faceIndex: number | undefined;
    
    if (fused && cardFaces && cardFaces.length >= 2) {
      // Fuse: special case - for now use legacy flow
      // TODO: Implement fuse handling in requestCastSpell
      const manaCost =
        ((cardFaces[0] as any)?.mana_cost || cardFaces[0]?.manaCost || '') +
        ((cardFaces[1] as any)?.mana_cost || cardFaces[1]?.manaCost || '');
      const displayName = `${cardFaces[0]?.name || 'Left'} // ${cardFaces[1]?.name || 'Right'}`;
      setSpellToCast({
        cardId: splitCardData.cardId,
        cardName: displayName,
        manaCost: manaCost || (card as any).mana_cost,
      });
      setCastSpellModalOpen(true);
      return;
    } else if (faceId.startsWith('face_') && cardFaces) {
      faceIndex = parseInt(faceId.replace('face_', ''), 10);
      // Validate faceIndex bounds
      if (faceIndex < 0 || faceIndex >= cardFaces.length) {
        debugError(1, `[handleSplitCardChoose] Invalid faceIndex: ${faceIndex}`);
        return;
      }
    }
    
    // Use MTG-compliant flow: request targets first if needed
    socket.emit("requestCastSpell", {
      gameId: safeView.id,
      cardId: splitCardData.cardId,
      faceIndex,
    });
  };

  const handleSplitCardCancel = () => {
    setSplitCardModalOpen(false);
    setSplitCardData(null);
  };

  const handleViewGraveyard = (playerId: string) => {
    setGraveyardModalPlayerId(playerId);
    setGraveyardModalOpen(true);
  };

  const handleViewExile = (playerId: string) => {
    setExileModalPlayerId(playerId);
    setExileModalOpen(true);
  };

  const handleGraveyardAbility = (cardId: string, abilityId: string) => {
    if (!safeView?.id) return;
    socket.emit('activateGraveyardAbility', {
      gameId: safeView.id,
      cardId,
      abilityId,
    });
  };

  const handleExileAbility = (cardId: string, abilityId: string) => {
    if (!safeView?.id) return;

    if (abilityId === 'foretell-cast') {
      socket.emit('castForetold', {
        gameId: safeView.id,
        cardId,
      });
      return;
    }

    // Most "cast/play from exile" permissions are handled via the normal cast request.
    socket.emit('requestCastSpell', {
      gameId: safeView.id,
      cardId,
    });
  };

  // Join Forces contribution handler
  // Now uses the unified Resolution Queue system when stepId is present
  const handleJoinForcesContribute = (amount: number) => {
    if (!safeView || !joinForcesRequest) return;
    
    // Check if this is using the new resolution system (has stepId)
    const stepId = (joinForcesRequest as any).stepId;
    
    if (!stepId) return;

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: { amount },
      cancelled: false,
    });
    // Close modal after responding
    setJoinForcesModalOpen(false);
    setJoinForcesRequest(null);
  };

  // Tempting Offer response handler
  // Now uses the unified Resolution Queue system when stepId is present
  const handleTemptingOfferRespond = (accept: boolean) => {
    if (!safeView || !temptingOfferRequest) return;
    
    // Check if this is using the new resolution system (has stepId)
    const stepId = (temptingOfferRequest as any).stepId;
    
    if (!stepId) return;

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: { accept },
      cancelled: false,
    });
    // Close modal after responding
    setTemptingOfferModalOpen(false);
    setTemptingOfferRequest(null);
  };
  
  // Kynaios Choice response handler (Kynaios and Tiro of Meletis style)
  // Now uses the unified Resolution Queue system
  const handleKynaiosChoiceRespond = (choice: 'play_land' | 'draw_card' | 'decline', landCardId?: string) => {
    if (!safeView || !kynaiosChoiceRequest) return;
    
    // Check if this is using the new resolution system (has stepId)
    const stepId = kynaiosChoiceRequest.stepId;

    if (!stepId) return;

    socket.emit("submitResolutionResponse", {
      gameId: safeView.id,
      stepId,
      selections: { choice, landCardId },
      cancelled: false,
    });

    // Close modal after responding
    setKynaiosChoiceModalOpen(false);
    setKynaiosChoiceRequest(null);
  };

  const handleOptionChoiceRespond = (selections: string[]) => {
    if (!safeView?.id || !optionChoiceRequest) return;

    socket.emit('submitResolutionResponse', {
      gameId: safeView.id,
      stepId: optionChoiceRequest.stepId,
      selections,
      cancelled: false,
    });

    setOptionChoiceModalOpen(false);
    setOptionChoiceRequest(null);
  };

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
    // Sources: own oracle text, keywords, granted abilities, and attached equipment
    
    // 1. Check own oracle text and keywords
    if (keywords.some((k: string) => k.toLowerCase() === 'haste') ||
        grantedAbilities.some((a: string) => a.toLowerCase().includes('haste')) ||
        /\bhaste\b/i.test(oracleText)) {
      return true;
    }
    
    // 2. Check attached equipment for haste grants (e.g., Lightning Greaves, Swiftfoot Boots)
    // Pattern: "Equipped creature has haste" or "Equipped creature has shroud and haste"
    const battlefield = safeView?.battlefield || [];
    
    // Helper function to detect if equipment grants haste
    const equipmentGrantsHaste = (equipOracle: string): boolean => {
      if (!equipOracle.includes('equipped creature') && !equipOracle.includes('enchanted creature')) {
        return false;
      }
      return equipOracle.includes('has haste') || 
             equipOracle.includes('have haste') ||
             equipOracle.includes('gains haste') ||
             /(?:equipped|enchanted) creature has (?:[\w\s,]+\s+and\s+)?haste/i.test(equipOracle);
    };
    
    // Check attachedEquipment array
    const attachedEquipment = (perm as any).attachedEquipment || [];
    for (const equipId of attachedEquipment) {
      const equipment = battlefield.find((p: any) => p.id === equipId);
      if (equipment && equipment.card) {
        const equipOracle = ((equipment.card as any).oracle_text || '').toLowerCase();
        if (equipmentGrantsHaste(equipOracle)) {
          return true;
        }
      }
    }
    
    // Also check by attachedTo relationship (in case attachedEquipment isn't set)
    for (const equip of battlefield) {
      if (!equip || !equip.card) continue;
      const equipTypeLine = ((equip.card as any).type_line || '').toLowerCase();
      if (!equipTypeLine.includes('equipment') && !equipTypeLine.includes('aura')) continue;
      if ((equip as any).attachedTo !== perm.id) continue;
      
      const equipOracle = ((equip.card as any).oracle_text || '').toLowerCase();
      if (equipmentGrantsHaste(equipOracle)) {
        return true;
      }
    }
    
    return false;
  };

  // Get creatures for combat modal - filter to only those that can attack
  const myCreatures = useMemo(() => {
    if (!safeView || !you) return [];
    return (safeView.battlefield || []).filter((p: BattlefieldPermanent) => {
      if (p.controller !== you) return false;
      // Check if it's currently a creature (handles reconfigure/bestow)
      if (!isCurrentlyCreature(p)) return false;
      
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
      // Check if it's currently a creature (handles reconfigure/bestow)
      if (!isCurrentlyCreature(p)) return false;
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
      isCurrentlyCreature(p)
    );
  }, [safeView]);

  const defenders = useMemo(() => {
    if (!safeView || !you) return [];
    return (safeView.players || []).filter((p: any) => p.id !== you);
  }, [safeView, you]);

  // Get text colors based on current background setting
  const textColors = getTextColorsForBackground(appearanceSettings.tableBackground);

  return (
    <div
      style={{
        padding: 8,
        fontFamily: "system-ui",
        display: "grid",
        gridTemplateColumns: isTable ? "1fr" : "1.2fr 380px",
        gap: 8,
        minHeight: '100vh',
        ...getBackgroundStyle(appearanceSettings.tableBackground),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* JOIN / ACTIVE GAMES (collapsible/accordion) - at very top */}
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: joinCollapsed ? "4px 8px" : 8,
            background: "rgba(30, 30, 40, 0.95)",
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
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
            <div style={{ fontWeight: 600, fontSize: 12, color: "#e5e5e5", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#a78bfa" }}>🎮</span>
              Join / Active Games
            </div>
            <div style={{ fontSize: 14, color: "#a78bfa" }}>
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
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#e5e5e5",
                    fontSize: 12,
                  }}
                />
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Name"
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#e5e5e5",
                    fontSize: 12,
                  }}
                />
                <button 
                  onClick={handleJoin} 
                  disabled={!connected}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(59, 130, 246, 0.3)",
                    color: "#93c5fd",
                    fontSize: 12,
                    cursor: connected ? "pointer" : "not-allowed",
                  }}
                >
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
                    fontSize: 12,
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
                    fontSize: 12,
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
                  style={{
                    padding: "4px 12px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#9ca3af",
                    fontSize: 12,
                    cursor: connected ? "pointer" : "not-allowed",
                  }}
                >
                  Refresh
                </button>
                <button
                  onClick={() => fetchDebug()}
                  disabled={!connected || !safeView}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#9ca3af",
                    fontSize: 12,
                    cursor: connected && safeView ? "pointer" : "not-allowed",
                  }}
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
                    fontSize: 12,
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

        {/* HEADER (game id, format) */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1 style={{ margin: 0, color: textColors.primary }}>MTGEDH</h1>
            <div style={{ fontSize: 12, color: textColors.secondary }}>
              Game: {effectiveGameId} • Format:{" "}
              {String(safeView?.format ?? "")}
            </div>
          </div>
        </div>

        {/* GAME STATUS INDICATOR - Shows turn, phase, step, priority, special designations, and control buttons */}
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
            isYouPlayer={isYouPlayer}
            gameOver={(safeView as any).gameOver}
            onConcede={() => socket.emit("concede", { gameId: safeView.id })}
            onLeaveGame={() => leaveGame(() => setJoinCollapsed(false))}
            onUndo={(count: number) => handleRequestUndo(count)}
            availableUndoCount={availableUndoCount}
            smartUndoCounts={smartUndoCounts}
            onRollDie={(sides: number) => socket.emit("rollDie", { gameId: safeView.id, sides })}
            onFlipCoin={() => socket.emit("flipCoin", { gameId: safeView.id })}
            aiControlEnabled={aiControlEnabled}
            aiStrategy={aiStrategy}
            onToggleAIControl={handleToggleAIControl}
          />
        )}

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
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: 4,
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
                  counterType: kind,
                  delta,
                })
              }
              onBulkCounter={(ids, deltas) => {
                if (!safeView) return;
                // Apply counter updates to all selected permanents
                for (const id of ids) {
                  socket.emit("updateCountersBulk", {
                    gameId: safeView.id,
                    permanentId: id,
                    counters: deltas,
                  });
                }
              }}
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
                  layout === 'modal_dfc'
                );
                
                if (needsFaceChoice && cardFaces) {
                  // Check if the card has fuse ability
                  const oracleText = ((card as any).oracle_text || '').toLowerCase();
                  const canFuse = layout === 'split' && oracleText.includes('fuse');
                  
                  // Build face options
                  const faces: CardFaceOption[] = cardFaces.map((face, idx) => ({
                    id: `face_${idx}`,
                    name: (face as any).name || `Face ${idx + 1}`,
                    manaCost: (face as any).mana_cost ?? (face as any).manaCost,
                    typeLine: (face as any).type_line ?? (face as any).typeLine,
                    oracleText: (face as any).oracle_text ?? (face as any).oracleText,
                    imageUrl: (face as any).image_uris?.small || (face as any).image_uris?.normal || (face as any).imageUrl,
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
                  // Regular card - use MTG-compliant flow: request targets first, then payment
                  // Server will check if targets are needed and respond appropriately
                  socket.emit("requestCastSpell", {
                    gameId: safeView.id,
                    cardId,
                  });
                }
              }}
              onCastCommander={handleCastCommander}
              reasonCannotPlayLand={reasonCannotPlayLand}
              reasonCannotCast={reasonCannotCast}
              enablePanZoom
              tableCloth={{ imageUrl: "" }}
              worldSize={12000}
              appearanceSettings={appearanceSettings}
              onViewGraveyard={handleViewGraveyard}
              onViewExile={handleViewExile}
              onUpdatePermPos={(id: string, x: number, y: number, z: number) =>
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
              manaPool={manaPool}
              // Mulligan UI props
              showMulliganUI={showMulliganUI}
              hasKeptHand={hasKeptHand}
              mulligansTaken={mulligansTaken}
              pendingBottomCount={pendingBottomCount}
              canKeepHand={canKeepHand}
              canMulligan={canMulligan}
              isPreGame={isPreGame}
              allPlayersKeptHands={allPlayersKeptHands}
              onKeepHand={() => socket.emit("keepHand", { gameId: safeView?.id })}
              onMulligan={() => socket.emit("mulligan", { gameId: safeView?.id })}
              onRandomizeStart={() => socket.emit("randomizeStartingPlayer", { gameId: safeView?.id })}
              onBeginGame={() => socket.emit("nextStep", { gameId: safeView?.id })}
              playableCards={(safeView as any)?.playableCards}
              costAdjustments={(safeView as any)?.costAdjustments}
              ignoredCardIds={ignoredCardIds}
              onIgnoreForAutoPass={(permanentId, cardName, imageUrl) => {
                if (safeView?.id) {
                  socket.emit('ignoreCardForAutoPass' as any, {
                    gameId: safeView.id,
                    permanentId,
                    cardName,
                    zone: 'battlefield',
                    imageUrl,
                  });
                }
              }}
              onUnignoreForAutoPass={(permanentId) => {
                if (safeView?.id) {
                  socket.emit('unignoreCardForAutoPass' as any, {
                    gameId: safeView.id,
                    permanentId,
                  });
                }
              }}
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
          isYourTurn={safeView.turnPlayer != null && safeView.turnPlayer === you}
          hasPriority={safeView.priority === you}
          stackEmpty={!((safeView as any).stack?.length > 0)}
          allPlayersReady={allPlayersHaveDecks && allPlayersKeptHands}
          phaseAdvanceBlockReason={phaseAdvanceBlockReason}
          onNextStep={() => socket.emit("nextStep", { gameId: safeView.id })}
          onPassPriority={() => you && socket.emit("passPriority", { gameId: safeView.id, by: you })}
          onAdvancingChange={setPhaseNavigatorAdvancing}
          onSkipToPhase={(targetPhase: string, targetStep?: string) => socket.emit("skipToPhase", { gameId: safeView.id, targetPhase, targetStep })}
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
            
            // Use the resolution queue system
            if (!peek.stepId) {
              console.error('[Scry/Surveil] Missing stepId - must use resolution queue');
              return;
            }

            const selections =
              peek.mode === "bottom_order"
                ? {
                    bottomOrder: (res.bottomOrder || [])
                      .map((id) => peek.cards.find((c) => c.id === id))
                      .filter(Boolean),
                  }
                : peek.mode === "scry"
                  ? {
                      keepTopOrder: (res.keepTopOrder || [])
                        .map((id) => peek.cards.find((c) => c.id === id))
                        .filter(Boolean),
                      bottomOrder: (res.bottomOrder || [])
                        .map((id) => peek.cards.find((c) => c.id === id))
                        .filter(Boolean),
                    }
                  : {
                      keepTopOrder: (res.keepTopOrder || [])
                        .map((id) => peek.cards.find((c) => c.id === id))
                        .filter(Boolean),
                      toGraveyard: (res.toGraveyard || [])
                        .map((id) => peek.cards.find((c) => c.id === id))
                        .filter(Boolean),
                    };
            
            socket.emit("submitResolutionResponse", {
              gameId: view.id,
              stepId: peek.stepId,
              selections,
              cancelled: false,
            });
            
            setPeek(null);
          }}
        />
      )}

      {/* Explore */}
      {explorePrompt && view && (
        <ExploreModal
          exploringCreature={{
            id: explorePrompt.permanentId,
            name: explorePrompt.permanentName,
          }}
          revealedCard={explorePrompt.revealedCard}
          isLand={explorePrompt.isLand}
          imagePref={imagePref}
          onConfirm={(result) => {
            if (!explorePrompt.stepId) {
              console.warn('[Explore] Missing stepId - must use resolution queue');
              return;
            }

            // If we're resolving a batch explore individually, accumulate decisions client-side
            // and submit them all at the end.
            if (batchExploreIndividual && batchExploreIndividual.stepId === explorePrompt.stepId) {
              const nextDecisions = [...batchExploreIndividual.decisions, {
                permanentId: explorePrompt.permanentId,
                toGraveyard: Boolean(result.toGraveyard),
              }];

              const nextIndex = batchExploreIndividual.index + 1;
              if (nextIndex < batchExploreIndividual.explores.length) {
                const nextExplore = batchExploreIndividual.explores[nextIndex];
                setBatchExploreIndividual({
                  ...batchExploreIndividual,
                  decisions: nextDecisions,
                  index: nextIndex,
                });
                setExplorePrompt({
                  stepId: batchExploreIndividual.stepId,
                  permanentId: nextExplore.permanentId,
                  permanentName: nextExplore.permanentName,
                  revealedCard: nextExplore.revealedCard,
                  isLand: nextExplore.isLand,
                });
                return;
              }

              socket.emit('submitResolutionResponse', {
                gameId: view.id,
                stepId: batchExploreIndividual.stepId,
                selections: { decisions: nextDecisions },
                cancelled: false,
              });

              setBatchExploreIndividual(null);
              setExplorePrompt(null);
              return;
            }

            // Single explore step
            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: explorePrompt.stepId,
              selections: {
                permanentId: explorePrompt.permanentId,
                toGraveyard: Boolean(result.toGraveyard),
              },
              cancelled: false,
            });

            setExplorePrompt(null);
          }}
        />
      )}

      {/* Batch Explore */}
      {batchExplorePrompt && view && (
        <BatchExploreModal
          explores={batchExplorePrompt.explores}
          imagePref={imagePref}
          onResolveAll={(decisions) => {
            if (!batchExplorePrompt.stepId) {
              console.warn('[BatchExplore] Missing stepId - must use resolution queue');
              return;
            }

            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: batchExplorePrompt.stepId,
              selections: { decisions },
              cancelled: false,
            });
            setBatchExplorePrompt(null);
          }}
          onResolveIndividually={() => {
            if (!batchExplorePrompt.stepId) {
              console.warn('[BatchExplore] Missing stepId - must use resolution queue');
              return;
            }

            // Resolve locally one-by-one, then submit once.
            const explores = batchExplorePrompt.explores || [];
            if (explores.length > 0) {
              setBatchExploreIndividual({
                stepId: batchExplorePrompt.stepId,
                explores,
                index: 0,
                decisions: [],
              });

              const firstExplore = explores[0];
              setExplorePrompt({
                stepId: batchExplorePrompt.stepId,
                permanentId: firstExplore.permanentId,
                permanentName: firstExplore.permanentName,
                revealedCard: firstExplore.revealedCard,
                isLand: firstExplore.isLand,
              });
            }
            setBatchExplorePrompt(null);
          }}
        />
      )}

      {/* Opponent May Pay */}
      {opponentMayPayPrompt && view && (
        <OpponentMayPayModal
          prompt={opponentMayPayPrompt}
          onPay={() => {
            if (!opponentMayPayStepId) {
              console.warn('[opponentMayPay] Missing resolution stepId; cannot submit response.');
              return;
            }
            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: opponentMayPayStepId,
              selections: 'pay',
              cancelled: false,
            });
            setOpponentMayPayPrompt(null);
            setOpponentMayPayStepId(null);
          }}
          onDecline={() => {
            if (!opponentMayPayStepId) {
              console.warn('[opponentMayPay] Missing resolution stepId; cannot submit response.');
              return;
            }
            socket.emit('submitResolutionResponse', {
              gameId: view.id,
              stepId: opponentMayPayStepId,
              selections: 'decline',
              cancelled: false,
            });
            setOpponentMayPayPrompt(null);
            setOpponentMayPayStepId(null);
          }}
          onSetShortcut={(preference) => {
            socket.emit("setOpponentMayPayShortcut", {
              gameId: view.id,
              sourceName: opponentMayPayPrompt.sourceName,
              preference,
            });
            setOpponentMayPayPrompt(null);
            setOpponentMayPayStepId(null);
          }}
        />
      )}

      {/* Tap/Untap Target Modal - for abilities that tap/untap targets */}
      <TapUntapTargetModal
        open={tapUntapTargetModalOpen}
        title={tapUntapTargetModalData?.title || tapUntapTargetModalData?.sourceName || "Tap/Untap Target"}
        description={tapUntapTargetModalData?.description}
        source={{
          id: tapUntapTargetModalData?.sourceId || "",
          name: tapUntapTargetModalData?.sourceName || "",
          imageUrl: tapUntapTargetModalData?.sourceImageUrl,
        }}
        action={tapUntapTargetModalData?.action || 'untap'}
        targetFilter={tapUntapTargetModalData?.targetFilter || {}}
        targetCount={tapUntapTargetModalData?.targetCount || 1}
        availablePermanents={safeView?.battlefield || []}
        playerId={you || ""}
        onConfirm={(selectedPermanentIds, action) => {
          if (tapUntapTargetModalData && safeView) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: tapUntapTargetModalData.stepId,
              selections: { targetIds: selectedPermanentIds, action },
              cancelled: false,
            });
            setTapUntapTargetModalOpen(false);
            setTapUntapTargetModalData(null);
          }
        }}
        onCancel={() => {
          if (tapUntapTargetModalData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: tapUntapTargetModalData.stepId,
            });
          }
          setTapUntapTargetModalOpen(false);
          setTapUntapTargetModalData(null);
        }}
      />

      {/* Fight Target Modal - for Brash Taunter and similar fight abilities */}
      <TapUntapTargetModal
        open={fightTargetModalOpen}
        title={fightTargetModalData?.title || `${fightTargetModalData?.sourceName || 'Creature'} - Fight`}
        description={fightTargetModalData?.description}
        source={{
          id: fightTargetModalData?.sourceId || "",
          name: fightTargetModalData?.sourceName || "",
          imageUrl: fightTargetModalData?.sourceImageUrl,
        }}
        action='tap' // Reuse tap UI but it's for fight selection
        targetFilter={{
          types: (fightTargetModalData?.targetFilter?.types || ['creature']) as ('creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker' | 'permanent')[],
          controller: fightTargetModalData?.targetFilter?.controller || 'any',
          tapStatus: 'any', // Fight can target tapped or untapped creatures
          excludeSource: fightTargetModalData?.targetFilter?.excludeSource !== false,
        }}
        targetCount={1}
        availablePermanents={safeView?.battlefield || []}
        playerId={you || ""}
        onConfirm={(selectedPermanentIds) => {
          if (fightTargetModalData && safeView && selectedPermanentIds.length > 0) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: fightTargetModalData.stepId,
              selections: [selectedPermanentIds[0]],
              cancelled: false,
            });
            setFightTargetModalOpen(false);
            setFightTargetModalData(null);
          }
        }}
        onCancel={() => {
          if (fightTargetModalData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: fightTargetModalData.stepId,
            });
          }
          setFightTargetModalOpen(false);
          setFightTargetModalData(null);
        }}
      />

      {/* Counter Movement Modal - for Nesting Grounds and similar abilities */}
      <CounterMovementModal
        open={counterMovementModalOpen}
        title={counterMovementModalData?.title || counterMovementModalData?.sourceName || "Move Counter"}
        description={counterMovementModalData?.description}
        source={{
          id: counterMovementModalData?.sourceId || "",
          name: counterMovementModalData?.sourceName || "",
          imageUrl: counterMovementModalData?.sourceImageUrl,
        }}
        sourceFilter={counterMovementModalData?.sourceFilter}
        targetFilter={counterMovementModalData?.targetFilter}
        availablePermanents={safeView?.battlefield || []}
        playerId={you || ""}
        onConfirm={(sourcePermanentId, targetPermanentId, counterType) => {
          if (counterMovementModalData && safeView) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: counterMovementModalData.stepId,
              selections: {
                sourcePermanentId,
                targetPermanentId,
                counterType,
              },
              cancelled: false,
            });
            setCounterMovementModalOpen(false);
            setCounterMovementModalData(null);
          }
        }}
        onCancel={() => {
          if (counterMovementModalData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: counterMovementModalData.stepId,
            });
          }
          setCounterMovementModalOpen(false);
          setCounterMovementModalData(null);
        }}
      />

      {/* Station Creature Selection Modal (Rule 702.184a) */}
      <StationCreatureSelectionModal
        open={stationCreatureSelectionOpen}
        gameId={safeView?.id || ""}
        activationId={stationCreatureSelectionData?.stepId || ""}
        station={stationCreatureSelectionData?.station || { id: "", name: "", threshold: 0, currentCounters: 0 }}
        creatures={stationCreatureSelectionData?.creatures || []}
        title={stationCreatureSelectionData?.title || "Station"}
        description={stationCreatureSelectionData?.description || ""}
        onConfirm={(creatureId) => {
          if (stationCreatureSelectionData && safeView) {
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: stationCreatureSelectionData.stepId,
              selections: [creatureId],
              cancelled: false,
            });
            setStationCreatureSelectionOpen(false);
            setStationCreatureSelectionData(null);
          }
        }}
        onCancel={() => {
          if (stationCreatureSelectionData && safeView) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: stationCreatureSelectionData.stepId,
            });
          }
          setStationCreatureSelectionOpen(false);
          setStationCreatureSelectionData(null);
        }}
      />

      {/* Resolution Queue Player Choice Modal */}
      <PlayerTargetSelectionModal
        open={resolutionPlayerChoiceModalOpen}
        title={resolutionPlayerChoiceModalData?.title || 'Choose Player'}
        description={resolutionPlayerChoiceModalData?.description}
        source={{
          name: resolutionPlayerChoiceModalData?.source?.name || '',
          imageUrl: resolutionPlayerChoiceModalData?.source?.imageUrl,
        }}
        players={resolutionPlayerChoiceModalData?.players || []}
        opponentOnly={Boolean(resolutionPlayerChoiceModalData?.opponentOnly)}
        minTargets={resolutionPlayerChoiceModalData?.isOptional ? 0 : 1}
        maxTargets={1}
        onConfirm={(selectedPlayerIds) => {
          if (!safeView || !resolutionPlayerChoiceModalData) return;
          const stepId = resolutionPlayerChoiceModalData.stepId;

          if (selectedPlayerIds.length === 0) {
            if (resolutionPlayerChoiceModalData.isOptional) {
              socket.emit('cancelResolutionStep', {
                gameId: safeView.id,
                stepId,
              });
              setResolutionPlayerChoiceModalOpen(false);
              setResolutionPlayerChoiceModalData(null);
            }
            return;
          }

          socket.emit('submitResolutionResponse', {
            gameId: safeView.id,
            stepId,
            selections: selectedPlayerIds,
            cancelled: false,
          });

          setResolutionPlayerChoiceModalOpen(false);
          setResolutionPlayerChoiceModalData(null);
        }}
        onCancel={() => {
          if (!safeView || !resolutionPlayerChoiceModalData) return;
          if (!resolutionPlayerChoiceModalData.isOptional) return;

          socket.emit('cancelResolutionStep', {
            gameId: safeView.id,
            stepId: resolutionPlayerChoiceModalData.stepId,
          });

          setResolutionPlayerChoiceModalOpen(false);
          setResolutionPlayerChoiceModalData(null);
        }}
      />

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
            spectator: false, // Always join as player when reconnecting
            seatToken: token || undefined,
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
            spectator: false, // Always join as player when using new name
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
        oracleText={spellToCast?.oracleText}
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
        floatingMana={manaPool || undefined}
        costReduction={spellToCast?.costReduction}
        convokeOptions={spellToCast?.convokeOptions}
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
        errorMessage={combatMode === 'blockers' ? combatModalError : null}
        isYourTurn={safeView != null && safeView.turnPlayer != null && safeView.turnPlayer === you}
        onConfirm={(selections) => {
          if (combatMode === 'attackers') {
            handleDeclareAttackers(selections as AttackerSelection[]);
          } else {
            handleDeclareBlockers(selections as BlockerSelection[]);
          }
        }}
        onSkip={handleSkipCombat}
        // For blockers mode, don't provide onCancel to prevent accidental closure
        // The modal can only be closed by confirming or skipping blockers
        onCancel={combatMode === 'attackers' ? () => setCombatModalOpen(false) : undefined}
      />

      {/* Bounce Land Choice Modal */}
      <BounceLandChoiceModal
        open={bounceLandModalOpen}
        bounceLandName={bounceLandData?.bounceLandName || ''}
        bounceLandImageUrl={bounceLandData?.imageUrl}
        landsToChoose={bounceLandData?.landsToChoose || []}
        onSelectLand={handleBounceLandSelect}
      />

      {/* Proliferate Modal */}
      <ProliferateModal
        open={proliferateModalOpen}
        sourceName={proliferateData?.sourceName || ''}
        imageUrl={proliferateData?.imageUrl}
        validTargets={proliferateData?.validTargets || []}
        onConfirm={handleProliferateConfirm}
      />
      
      {/* Fateseal Modal */}
      {fatesealModalOpen && fatesealData && view && (
        <FatesealModal
          opponentName={fatesealData.opponentName}
          cards={fatesealData.cards}
          imagePref={imagePref}
          sourceName={fatesealData.sourceName}
          onCancel={() => {
            setFatesealModalOpen(false);
            setFatesealData(null);
          }}
          onConfirm={handleFatesealConfirm}
        />
      )}
      
      {/* Clash Modal */}
      {clashModalOpen && clashData && view && (
        <ClashModal
          revealedCard={clashData.revealedCard}
          imagePref={imagePref}
          sourceName={clashData.sourceName}
          opponentName={clashData.opponentId ? safeView?.players?.find((p: any) => p.id === clashData.opponentId)?.name : undefined}
          onConfirm={handleClashConfirm}
        />
      )}
      
      {/* Vote Modal */}
      {voteModalOpen && voteData && view && (
        <VoteModal
          open={voteModalOpen}
          sourceName={voteData.sourceName}
          choices={voteData.choices}
          votesSubmitted={voteData.votesSubmitted}
          playerNames={useMemo(() => {
            const names: Record<string, string> = {};
            safeView?.players?.forEach((p: any) => {
              names[p.id] = p.username || p.id;
            });
            return names;
          }, [safeView?.players])}
          onConfirm={handleVoteConfirm}
        />
      )}

      {/* Game Over Overlay */}
      {gameOverModalOpen && gameOverData && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              textAlign: 'center',
              color: gameOverData.type === 'victory' ? '#ffd700' : 
                     gameOverData.type === 'draw' ? '#60a5fa' : '#ef4444',
              transform: 'scale(1)',
              opacity: 1,
            }}
          >
            <div
              style={{
                fontSize: gameOverData.type === 'victory' ? '5rem' : '4rem',
                fontWeight: 'bold',
                textShadow: gameOverData.type === 'victory' 
                  ? '0 0 30px rgba(255, 215, 0, 0.8), 0 0 60px rgba(255, 215, 0, 0.4)'
                  : gameOverData.type === 'draw'
                  ? '0 0 30px rgba(96, 165, 250, 0.8)'
                  : '0 0 30px rgba(239, 68, 68, 0.8)',
                marginBottom: '1rem',
              }}
            >
              {gameOverData.type === 'victory' ? '🏆' : 
               gameOverData.type === 'draw' ? '🤝' : '💀'}
            </div>
            <div
              style={{
                fontSize: '3rem',
                fontWeight: 'bold',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {gameOverData.message}
            </div>
            {gameOverData.winnerName && gameOverData.type !== 'victory' && (
              <div
                style={{
                  fontSize: '1.5rem',
                  marginTop: '1rem',
                  opacity: 0.8,
                }}
              >
                Winner: {gameOverData.winnerName}
              </div>
            )}
          </div>
        </div>
      )}

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
            if (!mulliganBottomStepId) {
              console.warn('[mulligan] Missing resolution stepId; cannot submit HAND_TO_BOTTOM selection.');
              return;
            }
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: mulliganBottomStepId,
              selections: cardIds,
              cancelled: false,
            });
          }
          setMulliganBottomModalOpen(false);
          setMulliganBottomCount(0);
          setMulliganBottomStepId(null);
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
        reason={discardResolutionReason}
        title={discardResolutionTitle ?? undefined}
        description={discardResolutionDescription ?? undefined}
        onConfirm={(cardIds) => {
          if (safeView) {
            if (!discardResolutionStepId) {
              console.warn('[discard] Missing resolution stepId; cannot submit discard selection.');
              return;
            }

            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: discardResolutionStepId,
              selections: cardIds,
              cancelled: false,
            });
          }
          setDiscardModalOpen(false);
          setDiscardCount(0);
          setDiscardResolutionStepId(null);
          setDiscardResolutionReason('cleanup');
          setDiscardResolutionTitle(null);
          setDiscardResolutionDescription(null);
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
        splitDestination={librarySearchData?.splitDestination}
        toBattlefield={librarySearchData?.toBattlefield}
        toHand={librarySearchData?.toHand}
        entersTapped={librarySearchData?.entersTapped}
        onConfirm={handleLibrarySearchConfirm}
        onCancel={handleLibrarySearchCancel}
      />

      {/* Target Selection Modal */}
      <TargetSelectionModal
        open={targetModalOpen}
        title={targetModalData?.title || 'Select Targets'}
        description={targetModalData?.description}
        contextSteps={targetModalData?.contextSteps}
        selectedMode={targetModalData?.selectedMode}
        viewerPlayerId={you || undefined}
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
            if (creatureTypeModalData.stepId) {
              socket.emit("submitResolutionResponse", {
                gameId: safeView.id,
                stepId: creatureTypeModalData.stepId,
                selections: creatureType,
                cancelled: false,
              });
            } else {
              socket.emit("creatureTypeSelected", {
                gameId: safeView.id,
                confirmId: creatureTypeModalData.confirmId,
                creatureType,
              });
            }
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

      {/* Life Payment Modal (Toxic Deluge, Hatred, etc.) */}
      <LifePaymentModal
        open={lifePaymentModalOpen}
        cardName={lifePaymentModalData?.cardName || ''}
        description={lifePaymentModalData?.description || ''}
        cardImageUrl={lifePaymentModalData?.imageUrl}
        currentLife={lifePaymentModalData?.currentLife || 40}
        minPayment={lifePaymentModalData?.minPayment || 0}
        maxPayment={lifePaymentModalData?.maxPayment || 0}
        onConfirm={(lifePayment) => {
          if (safeView?.id && lifePaymentModalData) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: lifePaymentModalData.stepId,
              selections: Number(lifePayment),
              cancelled: false,
            });
            setLifePaymentModalOpen(false);
            setLifePaymentModalData(null);
          }
        }}
        onCancel={() => {
          if (lifePaymentModalData?.mandatory) {
            alert('You must choose a life payment amount to continue.');
            return;
          }

          if (safeView?.id && lifePaymentModalData?.stepId) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: lifePaymentModalData.stepId,
            });
          }
          setLifePaymentModalOpen(false);
          setLifePaymentModalData(null);
        }}
      />

      {/* Mana Payment Trigger Modal (Casal attack triggers, etc.) */}
      <ManaPaymentTriggerModal
        open={manaPaymentTriggerModalOpen}
        cardName={manaPaymentTriggerModalData?.cardName || ''}
        cardImageUrl={manaPaymentTriggerModalData?.cardImageUrl}
        manaCost={manaPaymentTriggerModalData?.manaCost || ''}
        effect={manaPaymentTriggerModalData?.effect || ''}
        description={manaPaymentTriggerModalData?.description || ''}
        onPayMana={() => {
          if (safeView?.id && manaPaymentTriggerModalData) {
            socket.emit("respondAttackTriggerPayment", {
              gameId: safeView.id,
              triggerId: manaPaymentTriggerModalData.triggerId,
              payMana: true,
            });
            setManaPaymentTriggerModalOpen(false);
            setManaPaymentTriggerModalData(null);
          }
        }}
        onDecline={() => {
          if (safeView?.id && manaPaymentTriggerModalData) {
            socket.emit("respondAttackTriggerPayment", {
              gameId: safeView.id,
              triggerId: manaPaymentTriggerModalData.triggerId,
              payMana: false,
            });
            setManaPaymentTriggerModalOpen(false);
            setManaPaymentTriggerModalData(null);
          }
        }}
      />

      {/* Color Choice Modal (Caged Sun, Gauntlet of Power, etc.) */}
      <ColorChoiceModal
        open={colorChoiceModalOpen}
        confirmId={colorChoiceModalData?.confirmId || ''}
        cardName={colorChoiceModalData?.cardName || ''}
        reason={colorChoiceModalData?.reason || ''}
        cardImageUrl={colorChoiceModalData?.imageUrl}
        colors={colorChoiceModalData?.colors}
        onConfirm={(selectedColor) => {
          if (safeView?.id && colorChoiceModalData) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: colorChoiceModalData.confirmId,
              selections: selectedColor,
              cancelled: false,
            });
            setColorChoiceModalOpen(false);
            setColorChoiceModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && colorChoiceModalData) {
            socket.emit("cancelColorChoice", {
              gameId: safeView.id,
              confirmId: colorChoiceModalData.confirmId,
            });
          }
          setColorChoiceModalOpen(false);
          setColorChoiceModalData(null);
        }}
      />

      {/* Card Name Choice Modal (Pithing Needle, Nevermore, etc.) */}
      <CardNameChoiceModal
        open={cardNameChoiceModalOpen}
        title={cardNameChoiceModalData ? `Choose a Card Name for ${cardNameChoiceModalData.cardName}` : 'Choose a Card Name'}
        description={cardNameChoiceModalData?.reason}
        cardName={cardNameChoiceModalData?.cardName}
        sourceImageUrl={cardNameChoiceModalData?.imageUrl}
        mandatory={cardNameChoiceModalData?.mandatory ?? true}
        onConfirm={(chosenName) => {
          if (safeView?.id && cardNameChoiceModalData) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: cardNameChoiceModalData.stepId,
              selections: chosenName,
              cancelled: false,
            });
            setCardNameChoiceModalOpen(false);
            setCardNameChoiceModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && cardNameChoiceModalData && cardNameChoiceModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: cardNameChoiceModalData.stepId,
            });
            setCardNameChoiceModalOpen(false);
            setCardNameChoiceModalData(null);
          }
        }}
      />

      {/* Any Color Mana Modal (Birds of Paradise, Chromatic Lantern, etc.) */}
      <AnyColorManaModal
        open={anyColorManaModalOpen}
        activationId={anyColorManaModalData?.activationId || ''}
        permanentId={anyColorManaModalData?.permanentId || ''}
        cardName={anyColorManaModalData?.cardName || ''}
        amount={anyColorManaModalData?.amount || 1}
        allowedColors={anyColorManaModalData?.allowedColors} // Pass allowed colors to filter modal
        cardImageUrl={anyColorManaModalData?.cardImageUrl}
        onConfirm={(chosenColor) => {
          if (safeView?.id && anyColorManaModalData) {
            if (anyColorManaModalData.stepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: anyColorManaModalData.stepId,
                selections: chosenColor,
                cancelled: false,
              });
            }
            setAnyColorManaModalOpen(false);
            setAnyColorManaModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && anyColorManaModalData?.stepId && anyColorManaModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: anyColorManaModalData.stepId,
            });
          }
          setAnyColorManaModalOpen(false);
          setAnyColorManaModalData(null);
        }}
      />

      {/* Phyrexian Mana Choice Modal (Mite Overseer, K'rrik, etc.) */}
      <PhyrexianManaChoiceModal
        open={phyrexianManaModalOpen}
        cardName={phyrexianManaModalData?.cardName || ''}
        abilityText={phyrexianManaModalData?.abilityText || ''}
        totalManaCost={phyrexianManaModalData?.totalManaCost || ''}
        genericCost={phyrexianManaModalData?.genericCost || 0}
        phyrexianChoices={phyrexianManaModalData?.phyrexianChoices || []}
        playerLife={phyrexianManaModalData?.playerLife || 40}
        cardImageUrl={phyrexianManaModalData?.cardImageUrl}
        onConfirm={(choices) => {
          if (safeView?.id && phyrexianManaModalData) {
            // If this prompt came from spell casting, re-emit castSpellFromHand with the choices.
            // Otherwise, it's for an activated ability and we use the existing confirm event.
            if (phyrexianManaModalData.castSpellArgs) {
              socket.emit('castSpellFromHand', {
                ...phyrexianManaModalData.castSpellArgs,
                phyrexianChoices: choices,
              });
            } else if (phyrexianManaModalData.stepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: phyrexianManaModalData.stepId,
                selections: choices,
                cancelled: false,
              });
            }
            setPhyrexianManaModalOpen(false);
            setPhyrexianManaModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && phyrexianManaModalData?.stepId && phyrexianManaModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: phyrexianManaModalData.stepId,
            });
          }
          setPhyrexianManaModalOpen(false);
          setPhyrexianManaModalData(null);
        }}
      />

      {/* Mana Distribution Modal (Selvala, Heart of the Wilds, etc.) */}
      <ManaDistributionModal
        open={manaDistributionModalOpen}
        cardName={manaDistributionModalData?.cardName || ''}
        cardImageUrl={manaDistributionModalData?.cardImageUrl}
        totalAmount={manaDistributionModalData?.totalAmount || 0}
        availableColors={manaDistributionModalData?.availableColors || []}
        message={manaDistributionModalData?.message}
        onConfirm={(distribution) => {
          if (safeView?.id && manaDistributionModalData) {
            if (manaDistributionModalData.stepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: manaDistributionModalData.stepId,
                selections: distribution,
                cancelled: false,
              });
            }
            setManaDistributionModalOpen(false);
            setManaDistributionModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && manaDistributionModalData?.stepId && manaDistributionModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: manaDistributionModalData.stepId,
            });
          }
          setManaDistributionModalOpen(false);
          setManaDistributionModalData(null);
        }}
      />

      {/* Additional Cost Modal (Discard/Sacrifice as additional cost) */}
      <AdditionalCostModal
        open={additionalCostModalOpen}
        cardId={additionalCostModalData?.cardId || ''}
        cardName={additionalCostModalData?.cardName || ''}
        costType={additionalCostModalData?.costType || 'discard'}
        amount={additionalCostModalData?.amount || 0}
        title={additionalCostModalData?.title || ''}
        description={additionalCostModalData?.description || ''}
        imageUrl={additionalCostModalData?.imageUrl}
        availableCards={additionalCostModalData?.availableCards}
        availableTargets={additionalCostModalData?.availableTargets}
        effectId={additionalCostModalData?.effectId}
        canCancel={
          additionalCostModalData?.resolutionStepId
            ? additionalCostModalData?.resolutionStepMandatory === false
            : true
        }
        onConfirm={(selectedIds) => {
          if (safeView?.id && additionalCostModalData) {
            if (additionalCostModalData.resolutionStepId) {
              const chosen = selectedIds[0];
              const selections =
                additionalCostModalData.resolutionSourceChoiceId && chosen === additionalCostModalData.resolutionSourceChoiceId
                  ? { type: 'source' }
                  : chosen;

              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: additionalCostModalData.resolutionStepId,
                selections,
                cancelled: false,
              });
            }
            setAdditionalCostModalOpen(false);
            setAdditionalCostModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && additionalCostModalData?.resolutionStepId && additionalCostModalData?.resolutionStepMandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: additionalCostModalData.resolutionStepId,
            });
          }
          setAdditionalCostModalOpen(false);
          setAdditionalCostModalData(null);
        }}
      />

      {/* Squad Cost Modal (Pay squad cost multiple times) */}
      <SquadCostModal
        open={squadCostModalOpen}
        cardId={squadCostModalData?.cardId || ''}
        cardName={squadCostModalData?.cardName || ''}
        squadCost={squadCostModalData?.squadCost || ''}
        imageUrl={squadCostModalData?.imageUrl}
        effectId={squadCostModalData?.effectId}
        availableMana={(manaPool as unknown as Record<string, number>) || undefined}
        onConfirm={(timesPaid) => {
          if (safeView?.id && squadCostModalData?.resolutionStepId) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: squadCostModalData.resolutionStepId,
              selections: timesPaid,
              cancelled: false,
            });
            setSquadCostModalOpen(false);
            setSquadCostModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && squadCostModalData?.resolutionStepId && squadCostModalData.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: squadCostModalData.resolutionStepId,
            });
          }
          setSquadCostModalOpen(false);
          setSquadCostModalData(null);
        }}
      />

      {/* Casting Mode Selection Modal (Overload, Abundant Harvest, etc.) */}
      <CastingModeSelectionModal
        open={castingModeModalOpen}
        cardId={castingModeModalData?.cardId || ''}
        cardName={castingModeModalData?.cardName || ''}
        source={castingModeModalData?.source}
        title={castingModeModalData?.title || ''}
        description={castingModeModalData?.description || ''}
        imageUrl={castingModeModalData?.imageUrl}
        modes={castingModeModalData?.modes || []}
        effectId={castingModeModalData?.effectId}
        onConfirm={(selectedMode) => {
          if (safeView?.id && castingModeModalData) {
            if (castingModeModalData.resolutionStepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: castingModeModalData.resolutionStepId,
                selections: selectedMode,
                cancelled: false,
              });
            }
            setCastingModeModalOpen(false);
            setCastingModeModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && castingModeModalData?.resolutionStepId && castingModeModalData?.resolutionStepMandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: castingModeModalData.resolutionStepId,
            });
          }
          setCastingModeModalOpen(false);
          setCastingModeModalData(null);
        }}
      />

      {/* MDFC Face Selection Modal (Blightstep Pathway, etc.) */}
      <MDFCFaceSelectionModal
        open={mdfcFaceModalOpen}
        cardName={mdfcFaceModalData?.cardName || ''}
        title={mdfcFaceModalData?.title}
        description={mdfcFaceModalData?.description}
        faces={(mdfcFaceModalData?.faces || []).map((face, index) => ({
          index,
          name: face.name ?? (face as any).name ?? 'Face',
          typeLine: (face as any).type_line ?? (face as any).typeLine ?? '',
          oracleText: (face as any).oracle_text ?? (face as any).oracleText,
          manaCost: (face as any).mana_cost ?? (face as any).manaCost,
          imageUrl: (face as any).image_uris?.normal || (face as any).image_uris?.small || (face as any).imageUrl,
        }))}
        onConfirm={(selectedFace) => {
          if (safeView?.id && mdfcFaceModalData?.stepId) {
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: mdfcFaceModalData.stepId,
              selections: Number(selectedFace),
              cancelled: false,
            });
          }
          setMdfcFaceModalOpen(false);
          setMdfcFaceModalData(null);
        }}
        onCancel={() => {
          setMdfcFaceModalOpen(false);
          setMdfcFaceModalData(null);
        }}
      />

      {/* Modal Spell Selection Modal (Spree, Choose One/Two, Charms, etc.) */}
      <ModalSpellSelectionModal
        open={modalSpellModalOpen}
        cardName={modalSpellModalData?.cardName || ''}
        imageUrl={modalSpellModalData?.imageUrl}
        description={modalSpellModalData?.description}
        modes={modalSpellModalData?.modes || []}
        modeCount={modalSpellModalData?.modeCount || 1}
        canChooseAny={modalSpellModalData?.canChooseAny || modalSpellModalData?.isSpree}
        onConfirm={(selectedModeIds) => {
          if (safeView?.id && modalSpellModalData) {
            if (modalSpellModalData.resolutionStepId) {
              socket.emit('submitResolutionResponse', {
                gameId: safeView.id,
                stepId: modalSpellModalData.resolutionStepId,
                selections: selectedModeIds,
                cancelled: false,
              });
            }
            setModalSpellModalOpen(false);
            setModalSpellModalData(null);
          }
        }}
        onCancel={() => {
          if (safeView?.id && modalSpellModalData?.resolutionStepId && modalSpellModalData?.mandatory === false) {
            socket.emit('cancelResolutionStep', {
              gameId: safeView.id,
              stepId: modalSpellModalData.resolutionStepId,
            });
          }
          setModalSpellModalOpen(false);
          setModalSpellModalData(null);
        }}
      />

      {/* Replacement Effect Order Modal (Minimize/Maximize/Custom) */}
      <ReplacementEffectOrderModal
        open={replacementEffectModalOpen}
        effectType={replacementEffectModalData?.effectType || 'damage'}
        effects={replacementEffectModalData?.effects || []}
        baseAmount={replacementEffectModalData?.baseAmount || 0}
        initialMode={replacementEffectModalData?.initialMode}
        onConfirm={(orderedEffects, mode) => {
          if (safeView?.id && replacementEffectModalData) {
            socket.emit("setReplacementEffectOrder", {
              gameId: safeView.id,
              effectType: replacementEffectModalData.effectType,
              effectIds: orderedEffects.map(e => e.id),
              mode,
              effectId: replacementEffectModalData.effectId,
            });
            setReplacementEffectModalOpen(false);
            setReplacementEffectModalData(null);
          }
        }}
        onCancel={() => {
          setReplacementEffectModalOpen(false);
          setReplacementEffectModalData(null);
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
        playableCards={you === graveyardModalPlayerId ? (safeView as any)?.playableCards : undefined}
        appearanceSettings={appearanceSettings}
        onIgnoreForPlayability={(cardId, cardName, imageUrl) => {
          if (safeView?.id) {
            socket.emit('ignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
              cardName,
              zone: 'graveyard',
              imageUrl,
            });
          }
        }}
        onUnignoreForPlayability={(cardId) => {
          if (safeView?.id) {
            socket.emit('unignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
            });
          }
        }}
        ignoredCardIds={ignoredCardIds}
      />

      {/* Exile View Modal */}
      <ExileViewModal
        open={exileModalOpen}
        cards={useMemo(() => {
          if (!safeView || !exileModalPlayerId) return [];
          const zones = safeView.zones?.[exileModalPlayerId];
          const exile = zones?.exile || [];
          return Array.isArray(exile) ? (exile.filter((c: any) => c && c.name) as KnownCardRef[]) : [];
        }, [safeView, exileModalPlayerId])}
        playerId={exileModalPlayerId || ''}
        canActivate={you === exileModalPlayerId}
        onClose={() => {
          setExileModalOpen(false);
          setExileModalPlayerId(null);
        }}
        onActivateAbility={handleExileAbility}
        playableCards={you === exileModalPlayerId ? (safeView as any)?.playableCards : undefined}
        appearanceSettings={appearanceSettings}
        onIgnoreForPlayability={(cardId, cardName, imageUrl) => {
          if (safeView?.id) {
            socket.emit('ignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
              cardName,
              zone: 'exile',
              imageUrl,
            });
          }
        }}
        onUnignoreForPlayability={(cardId) => {
          if (safeView?.id) {
            socket.emit('unignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
            });
          }
        }}
        ignoredCardIds={ignoredCardIds}
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
          const isLandPermanent = (perm: any): boolean => {
            const card = perm?.card as any;
            if (!card) return false;
            const faces = Array.isArray(card.card_faces) ? (card.card_faces as any[]) : null;
            const layout = String(card.layout || '').toLowerCase();
            if (faces && faces.length >= 2) {
              const backOracle = String(faces[1]?.oracle_text || '');
              const isTransformLike = layout === 'transform' || /transforms from/i.test(backOracle);
              if (isTransformLike) {
                const isTransformed = Boolean(perm.transformed);
                const face = isTransformed ? faces[1] : faces[0];
                return /\bland\b/i.test(String(face?.type_line || ''));
              }
              if (layout === 'modal_dfc') {
                const selected = card.selectedMDFCFace;
                if (typeof selected === 'number' && faces[selected]) {
                  return /\bland\b/i.test(String(faces[selected]?.type_line || ''));
                }
              }
            }
            return /\bland\b/i.test(String(card.type_line || ''));
          };
          return battlefield.filter((p: any) => 
            p.controller === you && 
            !p.tapped &&
            isLandPermanent(p)
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
      
      {/* Kynaios Choice Modal (Kynaios and Tiro of Meletis style land/draw choice) */}
      <KynaiosChoiceModal
        open={kynaiosChoiceModalOpen}
        request={kynaiosChoiceRequest}
        controllerName={useMemo(() => {
          if (!kynaiosChoiceRequest || !safeView?.players) return '';
          const controller = safeView.players.find(p => p.id === kynaiosChoiceRequest.sourceController);
          return controller?.name || kynaiosChoiceRequest.sourceController;
        }, [kynaiosChoiceRequest, safeView?.players])}
        onRespond={handleKynaiosChoiceRespond}
      />

      {/* Generic Option Choice Modal (Agitator Ant and similar effects) */}
      <OptionChoiceModal
        open={optionChoiceModalOpen}
        request={optionChoiceRequest}
        onRespond={handleOptionChoiceRespond}
      />

      {/* Two-pile split Modal (separate into two piles) */}
      <TwoPileSplitModal
        open={twoPileSplitModalOpen}
        request={twoPileSplitRequest}
        onRespond={(payload) => {
          if (!safeView?.id || !twoPileSplitRequest) return;
          socket.emit('submitResolutionResponse', {
            gameId: safeView.id,
            stepId: twoPileSplitRequest.stepId,
            selections: payload,
            cancelled: false,
          });
          setTwoPileSplitModalOpen(false);
          setTwoPileSplitRequest(null);
        }}
      />

      {/* Commander Zone Choice Modal (Rule 903.9a/903.9b) */}
      {resolutionCommanderZoneChoice && (
        <CommanderZoneChoiceModal
          choice={resolutionCommanderZoneChoice.choice}
          onChoice={(moveToCommandZone) => {
            if (!safeView?.id) return;
            socket.emit('submitResolutionResponse', {
              gameId: safeView.id,
              stepId: resolutionCommanderZoneChoice.stepId,
              selections: moveToCommandZone ? 'command' : 'stay',
              cancelled: false,
            });
            setResolutionCommanderZoneChoice(null);
          }}
        />
      )}

      {/* Ponder Modal (Ponder, Index, Telling Time, etc.) */}
      {ponderModalOpen && ponderRequest && (
        <PonderModal
          cards={ponderRequest.cards}
          cardName={ponderRequest.cardName}
          cardImageUrl={ponderRequest.cardImageUrl}
          imagePref={appearanceSettings.imagePref || 'normal'}
          variant={ponderRequest.variant}
          canShuffle={ponderRequest.canShuffle}
          drawAfter={ponderRequest.drawAfter}
          pickToHand={ponderRequest.pickToHand}
          targetPlayerId={ponderRequest.targetPlayerId}
          targetPlayerName={ponderRequest.targetPlayerName}
          isOwnLibrary={ponderRequest.isOwnLibrary}
          onConfirm={(payload) => {
            if (!safeView?.id || !ponderRequest) return;
            
            // Use the resolution queue system
            if (!ponderRequest.stepId) {
              console.error('[Ponder] Missing stepId - must use resolution queue');
              return;
            }
            
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: ponderRequest.stepId,
              selections: {
                newOrder: payload.newOrder,
                shouldShuffle: payload.shouldShuffle,
                toHand: payload.toHand,
              },
              cancelled: false,
            });
            
            setPonderModalOpen(false);
            setPonderRequest(null);
          }}
          onCancel={() => {
            setPonderModalOpen(false);
            setPonderRequest(null);
          }}
        />
      )}
      
      {/* Cascade Modal */}
      {cascadeModalOpen && cascadePrompt && (
        <CascadeModal
          open={cascadeModalOpen}
          sourceName={cascadePrompt.sourceName}
          cascadeNumber={cascadePrompt.cascadeNumber}
          totalCascades={cascadePrompt.totalCascades}
          hitCard={cascadePrompt.hitCard}
          exiledCards={cascadePrompt.exiledCards}
          onCast={() => {
            if (!safeView?.id || !cascadePrompt) return;
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: cascadePrompt.stepId,
              selections: 'cast',  // String value for clarity
              cancelled: false,
            });
            setCascadeModalOpen(false);
            setCascadePrompt(null);
          }}
          onDecline={() => {
            if (!safeView?.id || !cascadePrompt) return;
            socket.emit("submitResolutionResponse", {
              gameId: safeView.id,
              stepId: cascadePrompt.stepId,
              selections: 'decline',  // String value for clarity
              cancelled: false,
            });
            setCascadeModalOpen(false);
            setCascadePrompt(null);
          }}
        />
      )}

      {/* Mutate Target Selection Modal */}
      <MutateTargetModal
        open={mutateModalOpen}
        mutatingCard={{
          id: mutateModalData?.cardId || '',
          name: mutateModalData?.cardName || '',
          imageUrl: mutateModalData?.imageUrl,
          power: mutateModalData?.power,
          toughness: mutateModalData?.toughness,
          mutateCost: mutateModalData?.mutateCost || '',
        }}
        targets={mutateModalData?.targets || []}
        onConfirm={(targetId, onTop) => {
          if (safeView?.id && mutateModalData) {
            socket.emit("confirmMutateTarget", {
              gameId: safeView.id,
              cardId: mutateModalData.cardId,
              targetPermanentId: targetId,
              onTop,
            });
            setMutateModalOpen(false);
            setMutateModalData(null);
          }
        }}
        onCancel={() => {
          setMutateModalOpen(false);
          setMutateModalData(null);
        }}
        onCastNormally={() => {
          if (safeView?.id && mutateModalData) {
            // Cancel mutate, cast normally instead
            socket.emit("castMutateNormally", {
              gameId: safeView.id,
              cardId: mutateModalData.cardId,
            });
            setMutateModalOpen(false);
            setMutateModalData(null);
          }
        }}
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
          // Player wants to take action - notify server to prevent auto-pass
          if (safeView && you) {
            socket.emit("claimPriority", { gameId: safeView.id });
          }
        }}
        onPass={() => {
          setPriorityModalOpen(false);
          if (safeView && you) {
            socket.emit("passPriority", { gameId: safeView.id, by: you });
          }
        }}
        autoPassSteps={autoPassSteps}
        onToggleAutoPass={handleToggleAutoPass}
      />

      {/* Auto-Pass Settings Panel & Trigger Shortcuts - Draggable container in bottom-right */}
      {safeView && you && (
        <DraggableSettingsPanel>
          <AutoPassSettingsPanel
            autoPassSteps={autoPassSteps}
            onToggleAutoPass={handleToggleAutoPass}
            onClearAll={handleClearAllAutoPass}
            onSelectAll={handleSelectAllAutoPass}
            isSinglePlayer={
              // Single player mode: not in pre-game AND only 1 active (non-spectator, non-inactive) player
              !isPreGame && 
              (safeView.players || []).filter((p: any) => !p.spectator && !p.inactive).length === 1
            }
            onToggleAutoPassForTurn={handleToggleAutoPassForTurn}
            autoPassForTurnEnabled={autoPassForTurn}
          />
          {/* Trigger Shortcuts Button */}
          <button
            onClick={() => setShowTriggerShortcuts(true)}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #444',
              backgroundColor: '#2a2a2a',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 13,
            }}
            title="Configure auto-responses for Smothering Tithe, Rhystic Study, etc."
          >
            ⚡ Trigger Shortcuts
          </button>
        </DraggableSettingsPanel>
      )}

      {/* Replacement Effect Settings Panel - Allows customizing effect ordering */}
      {safeView && you && (
        <ReplacementEffectSettingsPanel
          gameId={safeView.id}
          playerId={you}
          open={replacementEffectSettingsOpen}
          onClose={() => setReplacementEffectSettingsOpen(false)}
        />
      )}

      {/* Trigger Shortcuts Panel - Allows setting auto-responses for Smothering Tithe, etc. */}
      {safeView && you && (
        <TriggerShortcutsPanel
          isOpen={showTriggerShortcuts}
          onClose={() => setShowTriggerShortcuts(false)}
          socket={socket}
          gameId={safeView.id}
          playerId={you}
          currentShortcuts={(safeView as any).triggerShortcuts?.[you] || []}
          activeCards={safeView.battlefield?.map((p: any) => p.card?.name || '').filter(Boolean) || []}
        />
      )}

      {/* Ignored Cards Panel - Shows cards ignored for auto-pass */}
      {safeView && you && ignoredCards.length > 0 && (
        <IgnoredCardsPanel
          ignoredCards={ignoredCards}
          you={you}
          onUnignore={(cardId) => {
            socket.emit('unignoreCardForAutoPass' as any, {
              gameId: safeView.id,
              cardId,
            });
          }}
          onClearAll={() => {
            socket.emit('clearIgnoredCards' as any, {
              gameId: safeView.id,
            });
          }}
        />
      )}
    </div>
  );
}

export default App;
