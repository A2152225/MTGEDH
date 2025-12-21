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
  [event: string]: (...args: any[]) => void;
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

  // ===== RANDOMNESS EVENTS =====
  
  // Roll a die (d6, d20, d100, etc.)
  rollDie: (payload: { gameId: GameID; sides: number }) => void;
  
  // Flip a coin
  flipCoin: (payload: { gameId: GameID }) => void;

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
  setAutoPassForTurn: (payload: { gameId: GameID; enabled: boolean }) => void;
  claimPriority: (payload: { gameId: GameID }) => void;
  setStop: (payload: { gameId: GameID; phase: string; enabled: boolean }) => void;
  checkCanRespond: (payload: { gameId: GameID }) => void;
  
  // ===== IGNORED CARDS FOR AUTO-PASS =====
  // Add a card to the ignore list (auto-pass will skip these cards when checking abilities)
  ignoreCardForAutoPass: (payload: { 
    gameId: GameID; 
    permanentId: string;
    cardName: string;
  }) => void;
  
  // Remove a card from the ignore list
  unignoreCardForAutoPass: (payload: { 
    gameId: GameID; 
    permanentId: string;
  }) => void;
  
  // Clear all ignored cards
  clearIgnoredCards: (payload: { gameId: GameID }) => void;
  
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
  exchangeTextBoxes: (payload: {
    gameId: GameID;
    sourcePermanentId: string;
    targetPermanentId: string;
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
  
  // Respond to a Kynaios and Tiro style choice (play land or draw/decline)
  kynaiosChoiceResponse: (payload: {
    gameId: GameID;
    sourceController: PlayerID;
    choice: 'play_land' | 'draw_card' | 'decline';
    landCardId?: string;  // Optional but should be provided when choice is 'play_land'
  }) => void;

  // ===== GAME MANAGEMENT EVENTS =====
  
  // Leave a game (disconnect cleanly)
  leaveGame: (payload: { gameId: GameID }) => void;
  
  // Delete a game
  // claimedPlayerId is optional - used when socket hasn't joined a game yet
  // but the client knows their player ID from localStorage/session
  deleteGame: (payload: { gameId: GameID; claimedPlayerId?: PlayerID }) => void;

  // ===== PRE-GAME / MULLIGAN EVENTS =====
  
  // Keep current hand
  keepHand: (payload: { gameId: GameID }) => void;
  
  // Take a mulligan
  mulligan: (payload: { gameId: GameID }) => void;
  
  // Randomize starting player
  randomizeStartingPlayer: (payload: { gameId: GameID }) => void;

  // ===== GAMEPLAY ACTION EVENTS =====
  
  // Request to cast a spell - triggers target selection if needed, then payment
  // MTG Rule 601.2: Choose targets (601.2c) before paying costs (601.2h)
  requestCastSpell: (payload: { gameId: GameID; cardId: string; faceIndex?: number }) => void;
  
  // Complete spell cast with targets and payment (after target selection and payment)
  completeCastSpell: (payload: { 
    gameId: GameID; 
    cardId: string; 
    targets?: string[]; 
    payment?: Array<{ permanentId?: string; lifePayment?: number }>; 
    faceIndex?: number;
    effectId?: string;
    xValue?: number;
  }) => void;
  
  // Resolve a cascade decision (cast the revealed card or decline)
  resolveCascade: (payload: { gameId: GameID; effectId: string; cast: boolean }) => void;
  
  // Play a land from hand
  playLand: (payload: { gameId: GameID; cardId: string; selectedFace?: number }) => void;
  
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
  librarySearchSelect: (payload: { gameId: GameID; selectedCardIds: string[]; moveTo: string; targetPlayerId?: string; splitAssignments?: { toBattlefield: string[]; toHand: string[] } }) => void;
  
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
  castSpellFromHand: (payload: { gameId: GameID; cardId: string; targets?: string[]; payment?: any[]; xValue?: number }) => void;

  // ===== POSITION / UI EVENTS =====
  
  // Update permanent position (for 3D/drag-drop UIs)
  updatePermanentPos: (payload: { gameId: GameID; permanentId: string; x: number; y: number; z?: number }) => void;

  // ===== PHASE NAVIGATION =====
  
  // Skip to a specific phase
  skipToPhase: (payload: { gameId: GameID; targetPhase: string; targetStep?: string }) => void;

  // ===== SCRY/SURVEIL =====
  
  // Confirm scry result
  confirmScry: (payload: { gameId: GameID; keepTopOrder: Array<{ id: string }>; bottomOrder: Array<{ id: string }> }) => void;
  
  // Confirm surveil result
  confirmSurveil: (payload: { gameId: GameID; toGraveyard: Array<{ id: string }>; keepTopOrder: Array<{ id: string }> }) => void;

  // ===== PONDER-STYLE EFFECTS =====
  // Cascade prompt - controller chooses whether to cast the revealed card
  cascadePrompt: (payload: {
    gameId: GameID;
    effectId: string;
    playerId: PlayerID;
    sourceName: string;
    cascadeNumber: number;
    totalCascades: number;
    hitCard: KnownCardRef;
    exiledCards: KnownCardRef[];
  }) => void;
  
  // Cascade resolution acknowledgement (close modal on client)
  cascadeComplete: (payload: { gameId: GameID; effectId: string }) => void;
  
  // ===== PONDER-STYLE EFFECTS =====
  
  // Confirm Spy Network effect (look at target, then reorder own library)
  confirmSpyNetwork: (payload: {
    gameId: GameID;
    effectId: string;
    newLibraryOrder: string[];  // Your library cards in new order (top first)
  }) => void;

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

  // ===== MANA POOL MANIPULATION =====
  
  // Add mana to pool (manual adjustment or from effects)
  addManaToPool: (payload: { 
    gameId: GameID; 
    color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    amount: number;
    /** If adding restricted mana, specify the restriction type */
    restriction?: 'creatures' | 'abilities' | 'colorless_spells' | 'artifacts' | 'legendary' | 
                  'multicolored' | 'commander' | 'activated_abilities' | 'instant_sorcery' | 'specific_card';
    /** For specific_card restriction, the card/permanent ID */
    restrictedTo?: string;
    /** Source permanent that produced this mana */
    sourceId?: string;
    /** Source permanent name */
    sourceName?: string;
  }) => void;
  
  // Remove mana from pool (manual adjustment)
  removeManaFromPool: (payload: {
    gameId: GameID;
    color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    amount: number;
    /** If removing from restricted pool, specify the index */
    restrictedIndex?: number;
  }) => void;
  
  // Set mana pool doesn't empty (for Horizon Stone, Omnath, etc.)
  setManaPoolDoesNotEmpty: (payload: {
    gameId: GameID;
    sourceId: string;
    sourceName: string;
    /** 
     * Target color to convert mana to. Examples:
     * - 'colorless' for Kruphix, God of Horizons and Horizon Stone
     * - 'black' for Omnath, Locus of All
     * - 'red' for Ozai, the Phoenix King
     * If omitted, mana is preserved as-is without conversion
     */
    convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    /** @deprecated Use convertsTo: 'colorless' instead */
    convertsToColorless?: boolean;
  }) => void;
  
  // Remove mana pool doesn't empty effect (when source leaves battlefield)
  removeManaPoolDoesNotEmpty: (payload: {
    gameId: GameID;
    sourceId: string;
  }) => void;

  // ===== PERMANENT MANIPULATION =====
  
  // Tap a permanent
  tapPermanent: (payload: { gameId: GameID; permanentId: string }) => void;
  
  // Untap a permanent
  untapPermanent: (payload: { gameId: GameID; permanentId: string }) => void;
  
  // Sacrifice a permanent
  sacrificePermanent: (payload: { gameId: GameID; permanentId: string }) => void;
  
  // Activate ability on battlefield permanent
  activateBattlefieldAbility: (payload: { gameId: GameID; permanentId: string; abilityId: string }) => void;
  
  // Select mana color when tapping a creature for any color mana (e.g., Cryptolith Rite)
  manaColorSelect: (payload: { 
    gameId: GameID; 
    permanentId: string; 
    selectedColor: 'W' | 'U' | 'B' | 'R' | 'G';
  }) => void;

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
  
  // ===== REPLAY VIEWER EVENTS =====
  
  // Start watching a replay
  startReplay: (payload: { gameId: GameID }) => void;
  
  // Playback controls
  replayPlay: () => void;
  replayPause: () => void;
  replayStepForward: () => void;
  replayStepBackward: () => void;
  replayJumpTo: (payload: { eventIndex: number }) => void;
  
  // Set playback speed (ms per event)
  replaySetSpeed: (payload: { speed: number }) => void;
  
  // Set focused player for the replay view
  replaySetFocusPlayer: (payload: { playerId: PlayerID | null }) => void;
  
  // Get list of players in replay (for focus selection UI)
  replayGetPlayers: () => void;
  
  // Get event list for scrubber/timeline UI
  replayGetEvents: () => void;
  
  // Stop/close the replay session
  replayStop: () => void;
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

  // ===== RANDOMNESS EVENTS =====
  
  // Die roll result
  dieRollResult: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    playerName: string;
    sides: number;
    result: number;
    timestamp: number;
  }) => void;
  
  // Coin flip result
  coinFlipResult: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    playerName: string;
    result: 'heads' | 'tails';
    timestamp: number;
  }) => void;

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
  
  // Can respond check response
  canRespondResponse: (payload: {
    canRespond: boolean;
    canAct: boolean;
    reason?: string;
  }) => void;
  
  // ===== IGNORED CARDS FOR AUTO-PASS =====
  
  // Ignored cards list updated (sent to all clients)
  ignoredCardsUpdated: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    ignoredCards: Array<{
      permanentId: string;
      cardName: string;
      imageUrl?: string;
    }>;
  }) => void;
  
  // Card automatically removed from ignore list (e.g., when targeted by opponent)
  cardUnignoredAutomatically: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    permanentId: string;
    cardName: string;
    reason: string;  // e.g., "targeted by opponent's spell"
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
  
  // Payment required - sent after targets are selected (or if no targets needed)
  // MTG Rule 601.2h: Pay costs after all other choices are made
  paymentRequired: (payload: {
    gameId: GameID;
    cardId: string;
    cardName: string;
    manaCost: string;
    effectId: string;
    targets?: string[];  // Targets already selected
    imageUrl?: string;
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
  
  // ===== PONDER-STYLE EFFECTS =====
  
  // Spy Network request - look at target player's info, then reorder own library
  spyNetworkRequest: (payload: {
    gameId: GameID;
    effectId: string;
    playerId: PlayerID;           // Player making the decision (caster)
    targetPlayerId: PlayerID;     // Whose info is being spied on
    targetPlayerName: string;
    cardName: string;
    cardImageUrl?: string;
    // Target's revealed info
    targetHand: KnownCardRef[];
    targetTopCard: KnownCardRef | null;
    targetFaceDownCreatures: KnownCardRef[];
    // Caster's cards to reorder
    yourTopCards: KnownCardRef[];
    timeoutMs?: number;
  }) => void;
  
  // Spy Network completed
  spyNetworkComplete: (payload: {
    gameId: GameID;
    effectId: string;
    playerId: PlayerID;
    cardName: string;
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
  
  // ===== KYNAIOS AND TIRO STYLE CHOICE (Multi-player land/draw) =====
  
  // Kynaios and Tiro choice - prompts each player to play a land or draw a card
  kynaiosChoice: (payload: {
    gameId: GameID;
    sourceController: PlayerID;
    sourceName: string;
    isController: boolean;  // Whether this player is the source controller
    canPlayLand: boolean;   // Whether this player has lands in hand
    landsInHand: Array<{ id: string; name: string; imageUrl?: string }>;
    options: Array<'play_land' | 'draw_card' | 'decline'>;
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
  
  // Mana pool update notification
  manaPoolUpdate: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    manaPool: {
      white: number;
      blue: number;
      black: number;
      red: number;
      green: number;
      colorless: number;
      restricted?: Array<{
        color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
        amount: number;
        restriction: string;
        restrictedTo?: string;
        sourceId?: string;
        sourceName?: string;
      }>;
      doesNotEmpty?: boolean;
      convertsToColorless?: boolean;
      noEmptySourceIds?: string[];
    };
    /** Total mana in pool (including restricted) */
    totalMana: number;
    /** Reason for the update */
    reason?: string;
  }) => void;
  
  // Mana color choice prompt (for creatures with "any color" mana abilities)
  manaColorChoice: (payload: {
    gameId: GameID;
    permanentId: string;
    cardName: string;
    availableColors: string[];
    grantedBy?: string; // ID of the permanent granting the ability (e.g., Cryptolith Rite)
    totalAmount?: number;
    isAnyColor?: boolean;
    message?: string;
  }) => void;

  // ===== REPLAY VIEWER EVENTS (SERVER -> CLIENT) =====
  
  // Replay session started
  replayStarted: (payload: {
    gameId: GameID;
    totalEvents: number;
    playbackSpeed: number;
    state: any; // Initial game state view for replay
  }) => void;
  
  // Replay state update (sent during playback or after step/jump)
  replayStateUpdate: (payload: {
    // Metadata
    gameId: GameID;
    isReplay: boolean;
    eventIndex: number;
    totalEvents: number;
    currentEvent: any | null;
    isPlaying: boolean;
    playbackSpeed: number;
    focusedPlayerId: PlayerID | null;
    
    // Game state (full visibility in replay mode)
    phase?: string;
    step?: string;
    turn?: number;
    turnPlayer?: PlayerID;
    priority?: PlayerID;
    stack?: any[];
    battlefield?: any[];
    players?: any[];
    life?: Record<PlayerID, number>;
    zones?: Record<PlayerID, any>;
    commandZone?: any;
  }) => void;
  
  // Playback state changed
  replayPlaying: (payload: { isPlaying: boolean }) => void;
  replayPaused: (payload: { isPlaying: boolean }) => void;
  
  // Playback speed changed
  replaySpeedChanged: (payload: { speed: number }) => void;
  
  // Replay completed (reached end of events)
  replayComplete: (payload: {
    gameId: GameID;
    totalEvents: number;
  }) => void;
  
  // Replay session stopped
  replayStopped: (payload: Record<string, never>) => void;
  
  // Player list for focus selection
  replayPlayers: (payload: {
    gameId: GameID;
    players: Array<{
      id: PlayerID;
      name: string;
      isAI: boolean;
    }>;
    focusedPlayerId: PlayerID | null;
  }) => void;
  
  // Event list for timeline/scrubber UI
  replayEventList: (payload: {
    gameId: GameID;
    events: Array<{
      index: number;
      type: string;
      playerId?: PlayerID;
      summary: string;
    }>;
    currentEventIndex: number;
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
