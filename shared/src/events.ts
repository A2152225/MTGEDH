// shared/src/events.ts
// Socket.IO event contract used by both client and server.
// Keep synchronized between runtime code.

export type GameID = string;
export type PlayerID = string;
export type PermanentID = string;
export type CardID = string;

export type ChatMsg = {
  id: string;
  gameId: GameID;
  from: PlayerID | 'system';
  message: string;
  ts: number;
};

export type KnownCardRef = {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: { small?: string; normal?: string; art_crop?: string };
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: { small?: string; normal?: string; art_crop?: string };
    power?: string;
    toughness?: string;
  }>;
  layout?: string;
  mana_cost?: string;
  power?: string | number;
  toughness?: string | number;
};

// Events sent from client -> server
export interface ClientToServerEvents {
  // basic lobby / connection
  joinGame: (payload: { gameId: GameID; playerName: string; spectator?: boolean; seatToken?: string; fixedPlayerId?: PlayerID }) => void;
  requestState: (payload: { gameId: GameID }) => void;

  // chat
  chat: (payload: ChatMsg) => void;

  // deck import / management
  importDeck: (payload: { gameId: GameID; list: string; deckName?: string; save?: boolean }) => void;
  useSavedDeck: (payload: { gameId: GameID; deckId: string }) => void;
  getImportedDeckCandidates: (payload: { gameId: GameID }) => void;
  
  // saved deck CRUD
  saveDeck: (payload: { gameId: GameID; name: string; list: string; cacheCards?: boolean }) => void;
  listSavedDecks: (payload: { gameId: GameID }) => void;
  getSavedDeck: (payload: { gameId: GameID; deckId: string }) => void;
  renameSavedDeck: (payload: { gameId: GameID; deckId: string; name: string }) => void;
  deleteSavedDeck: (payload: { gameId: GameID; deckId: string }) => void;

  // library / search
  searchLibrary: (payload: { gameId: GameID; query: string; limit?: number }) => void;
  selectFromSearch: (payload: { gameId: GameID; cardIds: string[]; moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield'; reveal?: boolean }) => void;

  // commander & commander selection
  // NOTE: commanderIds is optional and supported by server; clients that have resolved IDs (from importedCandidates)
  // should include commanderIds when available. This is backwards-compatible.
  setCommander: (payload: { gameId: GameID; commanderNames: string[]; commanderIds?: string[] }) => void;
  castCommander: (payload: { gameId: GameID; commanderNameOrId: string; payment?: any[] }) => void;
  moveCommanderToCommandZone: (payload: { gameId: GameID; commanderNameOrId: string }) => void;

  // gameplay: simple action emits (examples)
  nextStep: (payload: { gameId: GameID }) => void;
  nextTurn: (payload: { gameId: GameID }) => void;
  passPriority: (payload: { gameId: GameID; by: PlayerID }) => void;

  // state mutation helpers
  shuffleLibrary: (payload: { gameId: GameID; playerId?: PlayerID }) => void;
  drawCards: (payload: { gameId: GameID; count: number; playerId?: PlayerID }) => void;
  shuffleHand: (payload: { gameId: GameID }) => void;
  reorderHand: (payload: { gameId: GameID; order: string[] }) => void;

  // import confirm responses
  confirmImportResponse: (payload: { gameId: GameID; confirmId: string; accept: boolean }) => void;

  // debug / admin
  dumpCommanderState: (payload: { gameId: GameID }) => void;
  dumpLibrary: (payload: { gameId: GameID }) => void;
  dumpImportedDeckBuffer: (payload: { gameId: GameID }) => void;

  // ===== MTG ONLINE-STYLE AUTOMATION EVENTS =====
  
  // Decision responses (targets, modes, X values, etc.)
  submitDecision: (payload: { gameId: GameID; decisionId: string; selection: any }) => void;
  
  // Choice event response (new unified system)
  respondToChoice: (payload: {
    gameId: GameID;
    eventId: string;
    selections: string[] | number | boolean;
    cancelled: boolean;
  }) => void;
  
  // Automation control
  setAutoPass: (payload: { gameId: GameID; enabled: boolean }) => void;
  setStop: (payload: { gameId: GameID; phase: string; enabled: boolean }) => void;
  
  // Combat declarations
  declareAttackers: (payload: { gameId: GameID; attackers: Array<{ attackerId?: string; creatureId?: string; defendingPlayer?: PlayerID; targetPlayerId?: string; targetPermanentId?: string }> }) => void;
  declareBlockers: (payload: { gameId: GameID; blockers: Array<{ blockerId: string; attackerId: string }> }) => void;
  
  // Combat damage assignment (for complex blocking scenarios)
  assignCombatDamage: (payload: {
    gameId: GameID;
    attackerId: string;
    damageAssignments: Array<{ targetId: string; damage: number }>;
  }) => void;
  
  // Blocker ordering (for multiple blockers)
  orderBlockers: (payload: {
    gameId: GameID;
    attackerId: string;
    blockerOrder: string[]; // Ordered list of blocker IDs
  }) => void;
  
  // Spell casting with targets/modes
  castSpell: (payload: { 
    gameId: GameID; 
    cardId: string; 
    targets?: string[]; 
    modes?: string[]; 
    xValue?: number;
    manaPayment?: Array<{ permanentId: string; manaColor: string }>;
  }) => void;
  
  // Activate ability
  activateAbility: (payload: {
    gameId: GameID;
    permanentId: string;
    abilityIndex: number;
    targets?: string[];
    manaPayment?: Array<{ permanentId: string; manaColor: string }>;
  }) => void;
  
  // Mulligan
  mulliganDecision: (payload: { gameId: GameID; keep: boolean }) => void;
  mulliganBottomCards: (payload: { gameId: GameID; cardIds: string[] }) => void;
  
  // Cleanup step discard selection
  discardToHandSize: (payload: { gameId: GameID; cardIds: string[] }) => void;
  
  // Trigger ordering (accepts either triggerOrder or orderedTriggerIds for backwards compatibility)
  orderTriggers: (payload: { gameId: GameID; triggerOrder?: string[]; orderedTriggerIds?: string[] }) => void;
  
  // Replacement effect choice
  chooseReplacementEffect: (payload: { gameId: GameID; effectId: string }) => void;
  
  // Commander zone choice
  commanderZoneChoice: (payload: { gameId: GameID; commanderId: string; moveToCommandZone: boolean }) => void;
  
  // ===== JOIN FORCES / TEMPTING OFFER EVENTS =====
  
  // Initiate a Join Forces effect (e.g., Minds Aglow, Collective Voyage)
  initiateJoinForces: (payload: {
    gameId: GameID;
    cardName: string;
    effectDescription: string;
    cardImageUrl?: string;
  }) => void;
  
  // Submit contribution to a Join Forces effect
  contributeJoinForces: (payload: {
    gameId: GameID;
    joinForcesId: string;
    amount: number;
  }) => void;
  
  // Initiate a Tempting Offer effect (e.g., Tempt with Discovery)
  initiateTemptingOffer: (payload: {
    gameId: GameID;
    cardName: string;
    effectDescription: string;
    cardImageUrl?: string;
  }) => void;
  
  // Respond to a Tempting Offer (accept or decline)
  respondTemptingOffer: (payload: {
    gameId: GameID;
    temptingOfferId: string;
    accept: boolean;
  }) => void;

  // ===== GAME MANAGEMENT EVENTS =====
  
  // Leave a game (disconnect cleanly)
  leaveGame: (payload: { gameId: GameID }) => void;
  
  // Delete a game
  deleteGame: (payload: { gameId: GameID }) => void;

  // ===== PRE-GAME / MULLIGAN EVENTS =====
  
  // Keep current hand
  keepHand: (payload: { gameId: GameID }) => void;
  
  // Take a mulligan
  mulligan: (payload: { gameId: GameID }) => void;
  
  // Randomize starting player
  randomizeStartingPlayer: (payload: { gameId: GameID }) => void;

  // ===== GAMEPLAY ACTION EVENTS =====
  
  // Play a land from hand
  playLand: (payload: { gameId: GameID; cardId: string }) => void;
  
  // Remove a permanent from battlefield
  removePermanent: (payload: { gameId: GameID; permanentId: string; destination?: string }) => void;
  
  // Update counters on a permanent (supports both single counter and deltas object)
  updateCounters: (payload: { gameId: GameID; permanentId: string; counterType?: string; delta?: number; deltas?: Record<string, number> }) => void;
  
  // Update multiple counters at once
  updateCountersBulk: (payload: { gameId: GameID; permanentId: string; counters?: Record<string, number>; updates?: Record<string, number> }) => void;

  // ===== TRIGGER HANDLING EVENTS =====
  
  // Resolve a triggered ability
  resolveTrigger: (payload: { gameId: GameID; triggerId: string; choice?: any; choices?: any }) => void;
  
  // Skip/ignore a triggered ability
  skipTrigger: (payload: { gameId: GameID; triggerId: string }) => void;
  
  // Sacrifice unless pay choice
  sacrificeUnlessPayChoice: (payload: { gameId: GameID; permanentId: string; pay?: boolean; payMana?: boolean }) => void;

  // ===== LIBRARY SEARCH EVENTS =====
  
  // Confirm library search selection
  librarySearchSelect: (payload: { gameId: GameID; cardIds?: string[]; selectedCardIds?: string[]; destination: string; splitAssignments?: { toBattlefield: string[]; toHand: string[] } }) => void;
  
  // Cancel library search
  librarySearchCancel: (payload: { gameId: GameID }) => void;

  // ===== TARGETING EVENTS =====
  
  // Confirm target selection
  targetSelectionConfirm: (payload: { gameId: GameID; cardId: string; targets: string[]; effectId?: string }) => void;
  
  // Cancel target selection
  targetSelectionCancel: (payload: { gameId: GameID; cardId: string; effectId?: string }) => void;

  // ===== OPENING HAND ACTIONS =====
  
  // Play cards from opening hand (e.g., Leylines)
  playOpeningHandCards: (payload: { gameId: GameID; cardIds: string[] }) => void;
  
  // Skip opening hand actions
  skipOpeningHandActions: (payload: { gameId: GameID }) => void;

  // ===== UNDO SYSTEM EVENTS =====
  
  // Request an undo
  requestUndo: (payload: { gameId: GameID; type: string; count?: number; actionsToUndo?: number }) => void;
  
  // Respond to an undo request
  respondUndo: (payload: { gameId: GameID; undoId: string; accept?: boolean; approved?: boolean }) => void;
  
  // Cancel an undo request
  cancelUndo: (payload: { gameId: GameID; undoId: string }) => void;

  // ===== GRAVEYARD ABILITIES =====
  
  // Activate an ability from graveyard (e.g., Flashback)
  activateGraveyardAbility: (payload: { gameId: GameID; cardId: string; abilityIndex?: number; abilityId?: string }) => void;

  // ===== COMBAT SKIP EVENTS =====
  
  // Skip declare attackers step
  skipDeclareAttackers: (payload: { gameId: GameID }) => void;
  
  // Skip declare blockers step
  skipDeclareBlockers: (payload: { gameId: GameID }) => void;

  // ===== LAND ETB CHOICE EVENTS =====
  
  // Shock land choice (pay 2 life or enter tapped)
  shockLandChoice: (payload: { gameId: GameID; permanentId: string; payLife: boolean }) => void;
  
  // Bounce land choice (return a land to hand)
  bounceLandChoice: (payload: { gameId: GameID; bounceLandId: string; returnLandId?: string; returnPermanentId?: string }) => void;

  // ===== UNDO INFO REQUESTS =====
  
  // Get undo count
  getUndoCount: (payload: { gameId: GameID }) => void;
  
  // Get smart undo counts (by step, phase, turn)
  getSmartUndoCounts: (payload: { gameId: GameID }) => void;

  // ===== JUDGE REQUESTS =====
  
  // Request judge assistance
  requestJudge: (payload: { gameId: GameID; reason?: string }) => void;
  
  // Respond to judge confirmation
  judgeConfirmResponse: (payload: { gameId: GameID; confirmId: string; accept: boolean }) => void;

  // ===== SPELL CASTING =====
  
  // Cast spell from hand (with payment info)
  castSpellFromHand: (payload: { gameId: GameID; cardId: string; targets?: string[]; payment?: any[] }) => void;

  // ===== POSITION / UI EVENTS =====
  
  // Update permanent position (for 3D/drag-drop UIs)
  updatePermanentPos: (payload: { gameId: GameID; permanentId: string; x: number; y: number; z?: number }) => void;

  // ===== PHASE NAVIGATION =====
  
  // Skip to a specific phase
  skipToPhase: (payload: { gameId: GameID; targetPhase: string; targetStep?: string }) => void;

  // ===== SCRY/SURVEIL =====
  
  // Confirm scry result
  confirmScry: (payload: { gameId: GameID; topCardIds: string[]; bottomCardIds: string[] }) => void;
  
  // Confirm surveil result
  confirmSurveil: (payload: { gameId: GameID; topCardIds: string[]; graveyardCardIds: string[] }) => void;

  // ===== MULLIGAN EVENTS =====
  
  // Put cards to bottom after mulligan
  mulliganPutToBottom: (payload: { gameId: GameID; cardIds: string[] }) => void;
  
  // Cleanup discard
  cleanupDiscard: (payload: { gameId: GameID; cardIds: string[] }) => void;

  // ===== CREATURE TYPE SELECTION =====
  
  // Creature type selected (for Morophon, Cavern of Souls, etc.)
  creatureTypeSelected: (payload: { gameId: GameID; permanentId?: string; confirmId?: string; creatureType: string }) => void;

  // ===== SACRIFICE SELECTION =====
  
  // Sacrifice selection (for effects that require sacrificing)
  sacrificeSelected: (payload: { gameId: GameID; permanentIds?: string[]; permanentId?: string; triggerId?: string }) => void;
  
  // Ability sacrifice confirm/cancel (for sacrifice-as-cost abilities)
  abilitySacrificeConfirm: (payload: { gameId: GameID; pendingId: string; sacrificeTargetId: string }) => void;
  abilitySacrificeCancel: (payload: { gameId: GameID; pendingId: string }) => void;

  // ===== PERMANENT MANIPULATION =====
  
  // Tap a permanent
  tapPermanent: (payload: { gameId: GameID; permanentId: string }) => void;
  
  // Untap a permanent
  untapPermanent: (payload: { gameId: GameID; permanentId: string }) => void;
  
  // Sacrifice a permanent
  sacrificePermanent: (payload: { gameId: GameID; permanentId: string }) => void;
  
  // Activate ability on battlefield permanent
  activateBattlefieldAbility: (payload: { gameId: GameID; permanentId: string; abilityIndex?: number }) => void;

  // ===== DECK MANAGEMENT EXTENDED =====
  
  // Cache a saved deck's cards
  cacheSavedDeck: (payload: { gameId: GameID; deckId: string }) => void;
  
  // Import a precon deck
  importPreconDeck: (payload: { 
    gameId: GameID; 
    deckId?: string; 
    commanders?: string[]; 
    deckName?: string; 
    setName?: string;
    year?: number | string;
    setCode?: string;
    colorIdentity?: string;
    cacheCards?: boolean;
  }) => void;
}

// Events sent from server -> client
export interface ServerToClientEvents {
  // connection / state
  joined: (payload: { you: PlayerID; seatToken?: string; gameId: GameID }) => void;
  state: (payload: { view: any }) => void;
  stateDiff: (payload: { diff: any }) => void;
  priority: (payload: { player: PlayerID | null }) => void;

  // chat
  chat: (msg: ChatMsg) => void;

  // deck import helpers
  deckImportMissing: (payload: { gameId: GameID; missing: string[] }) => void;
  importedDeckCandidates: (payload: { gameId: GameID; candidates: KnownCardRef[] }) => void;

  // import confirmation workflow
  importWipeConfirmRequest: (payload: any) => void;
  importWipeConfirmUpdate: (payload: any) => void;
  importWipeCancelled: (payload: any) => void;
  importWipeConfirmed: (payload: any) => void;
  importApplied: (payload: { confirmId: string; gameId: GameID; by: PlayerID; deckName?: string; importerOnly?: boolean }) => void;

  // commander suggestions / debug
  suggestCommanders: (payload: { gameId: GameID; names: string[] }) => void;
  debugCommanderState: (payload: any) => void;
  debugLibraryDump: (payload: any) => void;
  debugImportedDeckBuffer: (payload: any) => void;

  // errors / warnings
  error: (payload: { message: string; code?: string }) => void;
  deckError: (payload: { gameId: GameID; message: string }) => void;
  deckValidationResult: (payload: { gameId: GameID; format: string; cardCount: number; illegal: Array<{ name: string; reason: string }>; warnings: string[]; valid: boolean }) => void;

  // saved decks CRUD responses
  savedDecksList: (payload: { gameId: GameID; decks: any[] }) => void;
  savedDeckDetail: (payload: { gameId: GameID; deck: any }) => void;
  deckSaved: (payload: { gameId: GameID; deckId: string }) => void;
  deckRenamed: (payload: { gameId: GameID; deck: any }) => void;
  deckDeleted: (payload: { gameId: GameID; deckId: string }) => void;

  // ===== MTG ONLINE-STYLE AUTOMATION EVENTS =====
  
  // Decision prompts (requires player input)
  pendingDecision: (payload: {
    gameId: GameID;
    decision: {
      id: string;
      type: string;
      playerId: PlayerID;
      sourceId?: string;
      sourceName?: string;
      description: string;
      options?: Array<{ id: string; label: string; description?: string; imageUrl?: string; disabled?: boolean }>;
      minSelections?: number;
      maxSelections?: number;
      targetTypes?: string[];
      minX?: number;
      maxX?: number;
      mandatory: boolean;
      timeoutMs?: number;
    };
  }) => void;
  
  // Decision resolved (for other clients to sync)
  decisionResolved: (payload: { gameId: GameID; decisionId: string; playerId: PlayerID; selection: any }) => void;
  
  // Automation status updates
  automationStatus: (payload: {
    gameId: GameID;
    status: 'running' | 'waiting_for_decision' | 'waiting_for_priority' | 'paused' | 'completed';
    priorityPlayer?: PlayerID;
    pendingDecisionCount?: number;
  }) => void;
  
  // Combat state updates
  combatState: (payload: {
    gameId: GameID;
    phase: 'declareAttackers' | 'declareBlockers' | 'combatDamage' | 'endCombat';
    attackers?: Array<{ permanentId: string; defendingPlayer: PlayerID }>;
    blockers?: Array<{ permanentId: string; blocking: string[] }>;
    damageAssignments?: Array<{ sourceId: string; targetId: string; damage: number }>;
  }) => void;
  
  // Game log / action feed
  gameAction: (payload: {
    gameId: GameID;
    action: string;
    playerId?: PlayerID;
    details?: any;
    timestamp: number;
  }) => void;
  
  // Stack updates (for visual display)
  stackUpdate: (payload: {
    gameId: GameID;
    stack: Array<{
      id: string;
      type: 'spell' | 'ability' | 'triggered_ability';
      name: string;
      controller: PlayerID;
      targets?: string[];
      modes?: string[];
      xValue?: number;
      // For triggered abilities
      source?: string;
      sourceName?: string;
      description?: string;
      triggerType?: string;
      mandatory?: boolean;
    }>;
  }) => void;
  
  // Triggered ability notification
  triggeredAbility: (payload: {
    gameId: GameID;
    triggerId: string;
    playerId: PlayerID;
    sourcePermanentId: string;
    sourceName: string;
    triggerType: string;
    description: string;
    mandatory: boolean;
    value?: number;
  }) => void;
  
  // ===== JOIN FORCES / TEMPTING OFFER EVENTS =====
  
  // Join Forces request - prompts all players to contribute mana
  joinForcesRequest: (payload: {
    gameId: GameID;
    id: string;
    initiator: PlayerID;
    initiatorName: string;
    cardName: string;
    effectDescription: string;
    cardImageUrl?: string;
    players: PlayerID[];
    timeoutMs: number;
  }) => void;
  
  // Join Forces contribution update
  joinForcesUpdate: (payload: {
    gameId: GameID;
    id: string;
    playerId: PlayerID;
    playerName: string;
    contribution: number;
    responded: PlayerID[];
    contributions: Record<PlayerID, number>;
    totalContributions: number;
  }) => void;
  
  // Join Forces completed
  joinForcesComplete: (payload: {
    gameId: GameID;
    id: string;
    cardName: string;
    contributions: Record<PlayerID, number>;
    totalContributions: number;
    initiator: PlayerID;
  }) => void;
  
  // Tempting Offer request - prompts opponents to accept or decline
  temptingOfferRequest: (payload: {
    gameId: GameID;
    id: string;
    initiator: PlayerID;
    initiatorName: string;
    cardName: string;
    effectDescription: string;
    cardImageUrl?: string;
    opponents: PlayerID[];
    timeoutMs: number;
  }) => void;
  
  // Tempting Offer response update
  temptingOfferUpdate: (payload: {
    gameId: GameID;
    id: string;
    playerId: PlayerID;
    playerName: string;
    accepted: boolean;
    responded: PlayerID[];
    acceptedBy: PlayerID[];
  }) => void;
  
  // Tempting Offer completed
  temptingOfferComplete: (payload: {
    gameId: GameID;
    id: string;
    cardName: string;
    acceptedBy: PlayerID[];
    initiator: PlayerID;
    initiatorBonusCount: number; // How many times the initiator gets the effect (1 + acceptedBy.length)
  }) => void;

  // ===== CHOICE EVENTS (Enhanced Decision System) =====
  
  // Generic choice event for all player decisions
  choiceEvent: (payload: {
    gameId: GameID;
    event: {
      id: string;
      type: string; // ChoiceEventType from rules-engine
      playerId: PlayerID;
      sourceId?: string;
      sourceName?: string;
      sourceImage?: string;
      description: string;
      mandatory: boolean;
      timestamp: number;
      timeoutMs?: number;
      // Type-specific fields
      options?: Array<{ id: string; label: string; description?: string; imageUrl?: string; disabled?: boolean }>;
      minSelections?: number;
      maxSelections?: number;
      // For targets
      validTargets?: Array<{ id: string; label: string; imageUrl?: string }>;
      targetTypes?: string[];
      // For X value
      minX?: number;
      maxX?: number;
      // For discard
      discardCount?: number;
      currentHandSize?: number;
      maxHandSize?: number;
      // For combat damage
      attackerPower?: number;
      hasTrample?: boolean;
      blockers?: Array<{ id: string; name: string; toughness: number; existingDamage: number; lethalDamage: number }>;
      // For zone movement notifications
      zone?: string;
      reason?: string;
      // For win effects
      winningPlayerId?: PlayerID;
      winReason?: string;
    };
  }) => void;
  
  // Choice response acknowledgment
  choiceResponse: (payload: {
    gameId: GameID;
    eventId: string;
    playerId: PlayerID;
    selection: any;
    success: boolean;
    error?: string;
  }) => void;
  
  // Copy ceases to exist notification (Rule 704.5e)
  copyCeasesToExist: (payload: {
    gameId: GameID;
    copyId: string;
    copyName: string;
    copyType: 'spell' | 'card';
    zone: string;
    originalName?: string;
    controllerId: PlayerID;
  }) => void;
  
  // Token ceases to exist notification (Rule 704.5d)
  tokenCeasesToExist: (payload: {
    gameId: GameID;
    tokenIds: string[];
    tokenNames: string[];
    zone: string;
    controllerId: PlayerID;
  }) => void;
  
  // Win effect notification (Rule 104.2b)
  winEffectTriggered: (payload: {
    gameId: GameID;
    winningPlayerId: PlayerID;
    winReason: string;
    sourceId: string;
    sourceName: string;
    blockedBy?: string; // If win was prevented by Platinum Angel, etc.
  }) => void;
  
  // Replacement effect choice required
  replacementEffectChoice: (payload: {
    gameId: GameID;
    choosingPlayerId: PlayerID;
    affectedPlayerId: PlayerID;
    affectedEvent: string;
    effects: Array<{
      id: string;
      sourceId: string;
      sourceName: string;
      description: string;
    }>;
  }) => void;

  // generic pushes from server
  // (allow arbitrary other messages depending on server version)
  [event: string]: any;
}

/* Optional inter-server events (kept permissive) */
export interface InterServerEvents {
  // reserved
}

/* Socket.data shape */
export interface SocketData {
  playerId?: PlayerID;
  spectator?: boolean;
}