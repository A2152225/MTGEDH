export enum GameActionType {
  // Connection
  JOIN_GAME = 'joinGame',
  LEAVE_GAME = 'leaveGame',
  SPECTATE_GAME = 'spectateGame',
  
  // Deck management
  LOAD_DECK = 'loadDeck',
  SHUFFLE_LIBRARY = 'shuffleLibrary',
  
  // Priority
  PASS_PRIORITY = 'passPriority',
  HOLD_PRIORITY = 'holdPriority',
  
  // Playing cards
  PLAY_LAND = 'playLand',
  CAST_SPELL = 'castSpell',
  ACTIVATE_ABILITY = 'activateAbility',
  
  // Mana
  TAP_FOR_MANA = 'tapForMana',
  ADD_MANA = 'addMana',
  
  // Card actions
  TAP_CARD = 'tapCard',
  UNTAP_CARD = 'untapCard',
  ADD_COUNTER = 'addCounter',
  REMOVE_COUNTER = 'removeCounter',
  
  // Zones
  MOVE_TO_ZONE = 'moveToZone',
  DRAW_CARD = 'drawCard',
  DISCARD_CARD = 'discardCard',
  MILL_CARDS = 'millCards',
  
  // Targeting
  SELECT_TARGET = 'selectTarget',
  CONFIRM_TARGETS = 'confirmTargets',
  
  // Combat
  DECLARE_ATTACKERS = 'declareAttackers',
  DECLARE_BLOCKERS = 'declareBlockers',
  ASSIGN_DAMAGE = 'assignDamage',
  
  // Tokens
  CREATE_TOKEN = 'createToken',
  
  // Life and counters
  CHANGE_LIFE = 'changeLife',
  ADD_POISON = 'addPoison',
  ADD_EXPERIENCE = 'addExperience',
  
  // Game control
  CONCEDE = 'concede',
  REQUEST_UNDO = 'requestUndo',
  APPROVE_UNDO = 'approveUndo',
  
  // Rules feedback system
  REPORT_AUTOMATION_ERROR = 'reportAutomationError',
  FLAG_INCORRECT_RULING = 'flagIncorrectRuling'
}

export interface GameAction {
  type: GameActionType;
  gameId: string;
  playerId: string;
  timestamp: number;
  data: any;
  automated?: boolean; // Whether this was an automated action
  correctable?: boolean; // Can be flagged for correction
}

export interface AutomationErrorReport {
  id: string;
  gameId: string;
  playerId: string;
  reportedAt: number;
  
  // What happened
  actionType: GameActionType;
  cardInvolved?: string; // Card name
  description: string;
  
  // What should have happened
  expectedBehavior: string;
  
  // Context
  gameState: any; // Snapshot of relevant game state
  rulesReferences?: string[]; // e.g., ["CR 117.1a", "CR 608.2"]
  
  // Status
  status: 'pending' | 'acknowledged' | 'fixed' | 'not_a_bug';
  resolution?: string;
  fixedInVersion?: string;
}