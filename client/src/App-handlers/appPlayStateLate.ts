// Origin parent: client/src/App.tsx
// Cluster moved: late play resolution-modal state
// Public entry symbols: useAppPlayStateLate.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useMemo, useState } from "react";
import type { KnownCardRef, ManaPool } from "../../../shared/src";
import { useAppResolutionPromptHelpers } from "./appResolutionPromptHelpers";
import type { CastingMode } from "../components/CastingModeSelectionModal";
import type { GraveyardCard } from "../components/GraveyardSelectionModal";
import type { IgnoredCard } from "../components/IgnoredCardsPanel";
import type { JoinForcesRequest } from "../components/JoinForcesModal";
import type { KynaiosChoiceRequest } from "../components/KynaiosChoiceModal";
import type { MayAbilityModalData } from "../components/MayAbilityModal";
import type { SpellMode } from "../components/ModalSpellSelectionModal";
import type { MutateTarget } from "../components/MutateTargetModal";
import type { OptionChoiceRequest } from "../components/OptionChoiceModal";
import type { PeekCard, PonderVariant } from "../components/PonderModal";
import type { PlayerTarget } from "../components/PlayerTargetSelectionModal";
import type { OrderingMode, ReplacementEffectItem } from "../components/ReplacementEffectOrderModal";
import type { StationCreature, StationInfo } from "../components/StationCreatureSelectionModal";
import type { TemptingOfferRequest } from "../components/TemptingOfferModal";
import type { TwoPileSplitRequest } from "../components/TwoPileSplitModal";
import { useIsTouch } from "../hooks/useIsTouch";
import { useMobilePlayLayout } from "../hooks/useMobilePlayLayout";
import { useViewport } from "../hooks/useViewport";

export function useAppPlayStateLate(p: Record<string, any>) {
  const {
    confirmId,
    priority,
    safeView,
    you,
  } = p;
  const { width: viewportWidth } = useViewport();
  const isTouch = useIsTouch();
  const mobilePlayLayout = useMobilePlayLayout();
  
  // Graveyard View Modal state
  const [graveyardModalOpen, setGraveyardModalOpen] = useState(false);
  const [graveyardModalPlayerId, setGraveyardModalPlayerId] = useState<string | null>(null);
  
  const [exileModalOpen, setExileModalOpen] = useState(false);
  const [exileModalPlayerId, setExileModalPlayerId] = useState<string | null>(null);
  
  // Ignored cards state (for auto-pass and playability checks)
  const [ignoredCards, setIgnoredCards] = useState<IgnoredCard[]>([]);
  const ignoredCardIds = useMemo(() => new Set(ignoredCards.map(c => c.cardId || c.permanentId)), [ignoredCards]);

  const mayAutoPreferenceEntries = useMemo(() => {
    if (!safeView || !you) return [];
    const prefs = (safeView as any).mayAutoPreferences?.[you];
    if (!prefs || typeof prefs !== 'object') return [];
    return Object.entries(prefs)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([effectKey, value]) => ({
        effectKey,
        value: value as 'yes' | 'no' | number | string,
      }));
  }, [safeView, you]);
  
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
  const [limDulsVaultModalOpen, setLimDulsVaultModalOpen] = useState(false);
  const [limDulsVaultRequest, setLimDulsVaultRequest] = useState<{
    cardName: string;
    cardImageUrl?: string;
    cards: PeekCard[];
    currentLife: number;
    totalLifePaid: number;
    stepId: string;
  } | null>(null);
  const [danceWithCalamityModalOpen, setDanceWithCalamityModalOpen] = useState(false);
  const [danceWithCalamityRequest, setDanceWithCalamityRequest] = useState<{
    cardName: string;
    cardImageUrl?: string;
    exiledCards: PeekCard[];
    totalManaValue: number;
    canContinue: boolean;
    stepId: string;
  } | null>(null);
  const [danceWithCalamityCastModalOpen, setDanceWithCalamityCastModalOpen] = useState(false);
  const [danceWithCalamityCastRequest, setDanceWithCalamityCastRequest] = useState<{
    cardName: string;
    cardImageUrl?: string;
    exiledCards: PeekCard[];
    spellCards: PeekCard[];
    totalManaValue: number;
    stepId: string;
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

  // Priority Modal state - shows when player receives priority and can respond
  const [priorityModalOpen, setPriorityModalOpen] = useState(false);
  const lastPriorityStep = React.useRef<string | null>(null);
  const hadPriorityRef = React.useRef(false);
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
    pBudget?: number;
    canRepeatModes?: boolean;
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

  // Replacement effect ordering (persisted preference) - used for the PhaseNavigator quick toggle.
  type ReplacementEffectMode = 'minimize' | 'maximize' | 'custom' | 'auto';
  const [damageReplacementMode, setDamageReplacementMode] = useState<ReplacementEffectMode>('minimize');
  
  // Color Choice Modal state - for Caged Sun, Gauntlet of Power, etc.
  const [colorChoiceModalOpen, setColorChoiceModalOpen] = useState(false);
  const [colorChoiceModalData, setColorChoiceModalData] = useState<{
    confirmId: string;
    stepId: string;
    permanentId?: string;
    spellId?: string;
    cardName: string;
    reason: string;
    imageUrl?: string;
    colors?: ('white' | 'blue' | 'black' | 'red' | 'green')[];
    mandatory: boolean;
  } | null>(null);

  // Card Name Choice Modal state - for Pithing Needle, Nevermore, etc.
  const [cardNameChoiceModalOpen, setCardNameChoiceModalOpen] = useState(false);
  const [cardNameChoiceModalData, setCardNameChoiceModalData] = useState<{
    stepId: string;
    cardName: string;
    reason: string;
    imageUrl?: string;
    mandatory: boolean;
    restrictionText?: string;
    candidateNames?: string[];
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
    amountByColor?: Partial<Record<'W' | 'U' | 'B' | 'R' | 'G', number>>;
    dynamicAmountSource?: 'devotion' | 'creature_type_count';
    chosenCreatureType?: string;
    cardImageUrl?: string;
  } | null>(null);

  // Tracks pending resolution steps assigned to this player (from resolutionQueueChanged).
  const [myPendingResolutionCount, setMyPendingResolutionCount] = useState(0);
  const {
    minimizedResolutionStep,
    setMinimizedResolutionStep,
    activeResolutionPrompt,
    setActiveResolutionPrompt,
    minimizeResolutionStep,
    restoreResolutionStep,
    isResolutionStepMinimized,
    resolutionPromptOpen,
    scheduleResolutionPromptNudge,
  } = useAppResolutionPromptHelpers();
  
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

  const resolutionPlayerNames = React.useMemo(() => {
    const names: Record<string, string> = {};
    if (safeView?.players) {
      for (const p of safeView.players) {
        names[p.id] = p.name || p.id;
      }
    }
    return names;
  }, [safeView?.players]);

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

  const [counterDistributionModalOpen, setCounterDistributionModalOpen] = useState(false);
  const [counterDistributionModalData, setCounterDistributionModalData] = useState<{
    stepId?: string;
    mandatory?: boolean;
    gameId: string;
    cardName: string;
    cardImageUrl?: string;
    counterType: string;
    totalAmount: number;
    minPerTarget?: number;
    targets: Array<{ id: string; label: string }>;
    message?: string;
  } | null>(null);
  
  // Additional Cost Modal state - for discard/sacrifice as additional costs
  const [additionalCostModalOpen, setAdditionalCostModalOpen] = useState(false);
  const [additionalCostModalData, setAdditionalCostModalData] = useState<{
    cardId: string;
    cardName: string;
    costType: 'discard' | 'sacrifice' | 'remove_counters';
    amount: number;
    title: string;
    description: string;
    imageUrl?: string;
    availableCards?: Array<{ id: string; name: string; imageUrl?: string }>;
    availableTargets?: Array<{ id: string; name: string; imageUrl?: string; typeLine?: string; leaveBattlefieldReplacementDestination?: 'exile'; leaveBattlefieldReplacementSourceName?: string; leaveBattlefieldReplacementLifeGain?: number }>;
    availableCounters?: Array<{ id: string; permanentId: string; permanentName: string; counterType: string; counterIndex: number; name: string; imageUrl?: string; typeLine?: string }>;
    effectId?: string;
    // If present, this modal is being used to answer a ResolutionQueue step.
    resolutionStepId?: string;
    resolutionStepType?: string;
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

  // "You may" optional-ability modal state
  const [mayAbilityModalOpen, setMayAbilityModalOpen] = useState(false);
  const [mayAbilityModalData, setMayAbilityModalData] = useState<MayAbilityModalData | null>(null);
  
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
    stepId?: string;
    mandatory?: boolean;
  } | null>(null);

  // Graveyard selection modal state (Resolution Queue)
  const [graveyardSelectionModalOpen, setGraveyardSelectionModalOpen] = useState(false);
  const [graveyardSelectionModalData, setGraveyardSelectionModalData] = useState<{
    stepId: string;
    mandatory: boolean;
    title: string;
    description: string;
    sourceCard?: { name: string; imageUrl?: string };
    validTargets: GraveyardCard[];
    minTargets: number;
    maxTargets: number;
  } | null>(null);
  

  return {
    viewportWidth,
    isTouch,
    mobilePlayLayout,
    minimizedResolutionStep,
    setMinimizedResolutionStep,
    activeResolutionPrompt,
    setActiveResolutionPrompt,
    minimizeResolutionStep,
    restoreResolutionStep,
    isResolutionStepMinimized,
    resolutionPromptOpen,
    scheduleResolutionPromptNudge,
    graveyardModalOpen,
    setGraveyardModalOpen,
    graveyardModalPlayerId,
    setGraveyardModalPlayerId,
    exileModalOpen,
    setExileModalOpen,
    exileModalPlayerId,
    setExileModalPlayerId,
    ignoredCards,
    setIgnoredCards,
    ignoredCardIds,
    mayAutoPreferenceEntries,
    joinForcesModalOpen,
    setJoinForcesModalOpen,
    joinForcesRequest,
    setJoinForcesRequest,
    joinForcesContributions,
    setJoinForcesContributions,
    joinForcesResponded,
    setJoinForcesResponded,
    temptingOfferModalOpen,
    setTemptingOfferModalOpen,
    temptingOfferRequest,
    setTemptingOfferRequest,
    temptingOfferResponded,
    setTemptingOfferResponded,
    temptingOfferAcceptedBy,
    setTemptingOfferAcceptedBy,
    kynaiosChoiceModalOpen,
    setKynaiosChoiceModalOpen,
    kynaiosChoiceRequest,
    setKynaiosChoiceRequest,
    optionChoiceModalOpen,
    setOptionChoiceModalOpen,
    optionChoiceRequest,
    setOptionChoiceRequest,
    twoPileSplitModalOpen,
    setTwoPileSplitModalOpen,
    twoPileSplitRequest,
    setTwoPileSplitRequest,
    ponderModalOpen,
    setPonderModalOpen,
    ponderRequest,
    setPonderRequest,
    limDulsVaultModalOpen,
    setLimDulsVaultModalOpen,
    limDulsVaultRequest,
    setLimDulsVaultRequest,
    danceWithCalamityModalOpen,
    setDanceWithCalamityModalOpen,
    danceWithCalamityRequest,
    setDanceWithCalamityRequest,
    danceWithCalamityCastModalOpen,
    setDanceWithCalamityCastModalOpen,
    danceWithCalamityCastRequest,
    setDanceWithCalamityCastRequest,
    cascadeModalOpen,
    setCascadeModalOpen,
    cascadePrompt,
    setCascadePrompt,
    priorityModalOpen,
    setPriorityModalOpen,
    lastPriorityStep,
    hadPriorityRef,
    lastCanRespond,
    lifePaymentModalOpen,
    setLifePaymentModalOpen,
    lifePaymentModalData,
    setLifePaymentModalData,
    modalSpellModalOpen,
    setModalSpellModalOpen,
    modalSpellModalData,
    setModalSpellModalData,
    replacementEffectModalOpen,
    setReplacementEffectModalOpen,
    replacementEffectModalData,
    setReplacementEffectModalData,
    replacementEffectSettingsOpen,
    setReplacementEffectSettingsOpen,
    damageReplacementMode,
    setDamageReplacementMode,
    colorChoiceModalOpen,
    setColorChoiceModalOpen,
    colorChoiceModalData,
    setColorChoiceModalData,
    cardNameChoiceModalOpen,
    setCardNameChoiceModalOpen,
    cardNameChoiceModalData,
    setCardNameChoiceModalData,
    anyColorManaModalOpen,
    setAnyColorManaModalOpen,
    anyColorManaModalData,
    setAnyColorManaModalData,
    myPendingResolutionCount,
    setMyPendingResolutionCount,
    phyrexianManaModalOpen,
    setPhyrexianManaModalOpen,
    phyrexianManaModalData,
    setPhyrexianManaModalData,
    tapUntapTargetModalOpen,
    setTapUntapTargetModalOpen,
    tapUntapTargetModalData,
    setTapUntapTargetModalData,
    resolutionPlayerNames,
    fightTargetModalOpen,
    setFightTargetModalOpen,
    fightTargetModalData,
    setFightTargetModalData,
    counterMovementModalOpen,
    setCounterMovementModalOpen,
    counterMovementModalData,
    setCounterMovementModalData,
    stationCreatureSelectionOpen,
    setStationCreatureSelectionOpen,
    stationCreatureSelectionData,
    setStationCreatureSelectionData,
    resolutionPlayerChoiceModalOpen,
    setResolutionPlayerChoiceModalOpen,
    resolutionPlayerChoiceModalData,
    setResolutionPlayerChoiceModalData,
    manaDistributionModalOpen,
    setManaDistributionModalOpen,
    manaDistributionModalData,
    setManaDistributionModalData,
    counterDistributionModalOpen,
    setCounterDistributionModalOpen,
    counterDistributionModalData,
    setCounterDistributionModalData,
    additionalCostModalOpen,
    setAdditionalCostModalOpen,
    additionalCostModalData,
    setAdditionalCostModalData,
    squadCostModalOpen,
    setSquadCostModalOpen,
    squadCostModalData,
    setSquadCostModalData,
    castingModeModalOpen,
    setCastingModeModalOpen,
    castingModeModalData,
    setCastingModeModalData,
    mayAbilityModalOpen,
    setMayAbilityModalOpen,
    mayAbilityModalData,
    setMayAbilityModalData,
    manaPool,
    setManaPool,
    mutateModalOpen,
    setMutateModalOpen,
    mutateModalData,
    setMutateModalData,
    graveyardSelectionModalOpen,
    setGraveyardSelectionModalOpen,
    graveyardSelectionModalData,
    setGraveyardSelectionModalData,
  };
}
