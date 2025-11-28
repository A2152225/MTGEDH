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
  saveDeck: (payload: { gameId: GameID; name: string; list: string }) => void;
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
  castCommander: (payload: { gameId: GameID; commanderNameOrId: string }) => void;
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
  
  // Automation control
  setAutoPass: (payload: { gameId: GameID; enabled: boolean }) => void;
  setStop: (payload: { gameId: GameID; phase: string; enabled: boolean }) => void;
  
  // Combat declarations
  declareAttackers: (payload: { gameId: GameID; attackers: Array<{ attackerId: string; defendingPlayer: PlayerID }> }) => void;
  declareBlockers: (payload: { gameId: GameID; blockers: Array<{ blockerId: string; attackerId: string }> }) => void;
  
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