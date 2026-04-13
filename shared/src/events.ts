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

  // NOTE: deck import confirmations are handled via Resolution Queue (submitResolutionResponse)

  // debug / admin
  dumpCommanderState: (payload: { gameId: GameID }) => void;
  dumpLibrary: (payload: { gameId: GameID }) => void;
  dumpImportedDeckBuffer: (payload: { gameId: GameID }) => void;

  // ===== PRIORITY / INTERACTION EVENTS =====
  
  // Automation control
  setAutoPass: (payload: { gameId: GameID; enabled: boolean; syncOnly?: boolean }) => void;
  setAutoPassForTurn: (payload: { gameId: GameID; enabled: boolean }) => void;
  claimPriority: (payload: { gameId: GameID }) => void;
  setStop: (payload: { gameId: GameID; phase: string; enabled: boolean }) => void;
  checkCanRespond: (payload: { gameId: GameID }) => void;
  setTriggerShortcut: (payload: { gameId: GameID; cardName: string; preference: string; triggerDescription?: string }) => void;
  yieldToTriggerSource: (payload: { gameId: GameID; sourceId: string; sourceName?: string }) => void;
  unyieldToTriggerSource: (payload: { gameId: GameID; sourceId: string }) => void;
  
  // ===== IGNORED CARDS FOR AUTO-PASS =====
  // Add a card to the ignore list (auto-pass will skip these cards when checking abilities)
  ignoreCardForAutoPass: (payload: { 
    gameId: GameID; 
    permanentId?: string;
    cardId?: string;
    cardName: string;
    zone?: string;
    imageUrl?: string;
  }) => void;
  
  // Remove a card from the ignore list
  unignoreCardForAutoPass: (payload: { 
    gameId: GameID; 
    permanentId?: string;
    cardId?: string;
  }) => void;
  
  // Clear all ignored cards
  clearIgnoredCards: (payload: { gameId: GameID }) => void;
  
  // Combat declarations
  declareAttackers: (payload: { gameId: GameID; attackers: Array<{ attackerId?: string; creatureId?: string; defendingPlayer?: PlayerID; targetPlayerId?: string; targetPermanentId?: string }> }) => void;
  declareBlockers: (payload: { gameId: GameID; blockers: Array<{ blockerId: string; attackerId: string }> }) => void;
  combatPreviewAttackers: (payload: { gameId: GameID; targets: Record<string, string> }) => void;
  
  exchangeTextBoxes: (payload: {
    gameId: GameID;
    sourcePermanentId: string;
    targetPermanentId: string;
  }) => void;
  
  // Commander zone choice
  commanderZoneChoice: (payload: { gameId: GameID; commanderId: string; moveToCommandZone: boolean }) => void;
  
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
  requestCastSpell: (payload: { gameId: GameID; cardId: string; faceIndex?: number; fromZone?: 'hand' | 'graveyard' | 'exile' }) => void;
  
  // Complete spell cast with targets and payment (after target selection and payment)
  completeCastSpell: (payload: { 
    gameId: GameID; 
    cardId: string; 
    targets?: string[]; 
    payment?: Array<{ permanentId?: string; lifePayment?: number }>; 
    faceIndex?: number;
    effectId?: string;
    alternateCostId?: string;
    xValue?: number;
    convokeTappedCreatures?: string[];
  }) => void;
  
  // Play a land from hand
  playLand: (payload: { gameId: GameID; cardId: string; selectedFace?: number; fromZone?: 'hand' | 'graveyard' | 'exile' }) => void;

  // ===== TRIGGER HANDLING EVENTS =====

  // Sacrifice unless pay choice
  sacrificeUnlessPayChoice: (payload: { gameId: GameID; permanentId: string; pay?: boolean; payMana?: boolean }) => void;

  // ===== LIBRARY SEARCH EVENTS =====

  // ===== OPENING HAND ACTIONS =====

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

  // NOTE: judge confirmations are handled via Resolution Queue (submitResolutionResponse)

  // ===== SPELL CASTING =====
  
  // Cast spell from hand (with payment info)
  castSpellFromHand: (payload: { gameId: GameID; cardId: string; targets?: string[]; payment?: any[]; skipInteractivePrompts?: boolean; alternateCostId?: string; xValue?: number; convokeTappedCreatures?: string[]; phyrexianChoices?: any }) => void;

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
  // ===== MULLIGAN EVENTS =====
  
  // Put cards to bottom after mulligan
  mulliganPutToBottom: (payload: { gameId: GameID; cardIds: string[] }) => void;
  
  // Cleanup discard
  cleanupDiscard: (payload: { gameId: GameID; cardIds: string[] }) => void;

  // ===== CREATURE TYPE SELECTION =====

  // ===== SACRIFICE SELECTION =====
  
  // Sacrifice selection (for effects that require sacrificing)
  sacrificeSelected: (payload: { gameId: GameID; permanentIds?: string[]; permanentId?: string; triggerId?: string }) => void;

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
  activateBattlefieldAbility: (payload: { gameId: GameID; permanentId: string; abilityId: string; xValue?: number }) => void;
  
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
  nameInUse: (payload: {
    gameId: GameID;
    playerName: string;
    options: Array<{
      action: 'reconnect' | 'newName' | 'cancel';
      fixedPlayerId?: PlayerID;
    }>;
    meta?: {
      isConnected?: boolean;
    };
  }) => void;
  state: (payload: { view: any }) => void;
  stateDiff: (payload: { diff: any }) => void;
  priority: (payload: { player: PlayerID | null }) => void;
  gameOver: (payload: {
    gameId: GameID;
    type: 'victory' | 'defeat' | 'eliminated' | 'draw';
    winnerId?: PlayerID;
    winnerName?: string;
    loserId?: PlayerID;
    loserName?: string;
    message?: string;
  }) => void;
  playerEliminated: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    playerName: string;
    reason?: string;
  }) => void;
  playerConceded: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    playerName: string;
    message?: string;
  }) => void;

  // chat
  chat: (msg: ChatMsg) => void;

  // deck import helpers
  deckImportMissing: (payload: { gameId: GameID; missing: string[] }) => void;
  importedDeckCandidates: (payload: { gameId: GameID; candidates: KnownCardRef[] }) => void;

  // import confirmation workflow
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

  // Can respond check response
  canRespondResponse: (payload: {
    canRespond: boolean;
    canAct: boolean;
    reason?: string;
  }) => void;

  // Mulligan status updates from the rules bridge
  mulliganDecision: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    kept: boolean;
    newHandSize: number;
    timestamp: number;
  }) => void;
  mulliganCompleted: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    mulliganCount: number;
    timestamp: number;
  }) => void;
  
  // ===== IGNORED CARDS FOR AUTO-PASS =====
  
  // Ignored cards list updated (sent to all clients)
  ignoredCardsUpdated: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    ignoredCards: Array<{
      permanentId: string;
      cardId?: string;
      cardName: string;
      imageUrl?: string;
      zone?: string;
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

  // Auto-pass toggle confirmation for the acting player
  autoPassToggled: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    enabled: boolean;
    success: boolean;
  }) => void;

  // Live UI preview for attacker allocation during declare attackers
  combatPreviewAttackers: (payload: {
    gameId: GameID;
    attackerPlayerId: PlayerID;
    targets: Record<string, string>;
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

  // Batch trigger resolution summary for the resolving player
  triggersResolved: (payload: {
    gameId: GameID;
    playerId: PlayerID;
    totalCount: number;
    sources: Array<{
      sourceKey: string;
      sourceName: string;
      count: number;
      effect: string;
      imageUrl?: string;
    }>;
  }) => void;

  // Explicit notification that the player currently has no pending resolution step
  noResolutionStep: (payload: { gameId?: GameID }) => void;
  
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
