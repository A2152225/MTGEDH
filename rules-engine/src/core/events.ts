/**
 * core/events.ts
 * 
 * Centralized event definitions for the Rules Engine.
 * All events that can be emitted by the engine are defined here.
 */

/**
 * Engine events that can be observed by UI and simulation layers
 */
export enum RulesEngineEvent {
  // Game flow
  GAME_STARTED = 'gameStarted',
  TURN_STARTED = 'turnStarted',
  PHASE_STARTED = 'phaseStarted',
  STEP_STARTED = 'stepStarted',
  PRIORITY_PASSED = 'priorityPassed',
  
  // Mulligan
  MULLIGAN_DECISION = 'mulliganDecision',
  MULLIGAN_COMPLETED = 'mulliganCompleted',
  
  // Spell casting
  SPELL_CAST = 'spellCast',
  SPELL_COUNTERED = 'spellCountered',
  SPELL_RESOLVED = 'spellResolved',
  
  // Abilities
  ABILITY_ACTIVATED = 'abilityActivated',
  ABILITY_RESOLVED = 'abilityResolved',
  TRIGGERED_ABILITY = 'triggeredAbility',
  
  // Mana
  MANA_ABILITY_ACTIVATED = 'manaAbilityActivated',
  MANA_ADDED = 'manaAdded',
  MANA_SPENT = 'manaSpent',
  MANA_POOL_EMPTIED = 'manaPoolEmptied',
  
  // Combat
  COMBAT_DECLARED = 'combatDeclared',
  ATTACKERS_DECLARED = 'attackersDeclared',
  BLOCKERS_DECLARED = 'blockersDeclared',
  DAMAGE_ASSIGNED = 'damageAssigned',
  DAMAGE_DEALT = 'damageDealt',
  COMBAT_ENDED = 'combatEnded',
  
  // State changes
  STATE_BASED_ACTIONS = 'stateBasedActions',
  PLAYER_LOST = 'playerLost',
  PLAYER_WON = 'playerWon',
  GAME_ENDED = 'gameEnded',
  
  // Card actions
  CARD_DRAWN = 'cardDrawn',
  CARD_DISCARDED = 'cardDiscarded',
  PERMANENT_DESTROYED = 'permanentDestroyed',
  PERMANENT_LEFT_BATTLEFIELD = 'permanentLeftBattlefield',
  CREATURE_DIED = 'creatureDied',
  CARD_EXILED = 'cardExiled',
  PERMANENT_TAPPED = 'permanentTapped',
  PERMANENT_UNTAPPED = 'permanentUntapped',
  
  // Fetch land and tutor actions
  PERMANENT_SACRIFICED = 'permanentSacrificed',
  LIBRARY_SEARCHED = 'librarySearched',
  LIBRARY_SHUFFLED = 'libraryShuffled',
  CARD_PUT_ONTO_BATTLEFIELD = 'cardPutOntoBattlefield',
  CARD_PUT_INTO_HAND = 'cardPutIntoHand',
  LIFE_PAID = 'lifePaid',
  
  // Zone transitions
  ZONE_CHANGE = 'zoneChange',
  CARD_REVEALED = 'cardRevealed',
  
  // Life changes
  LIFE_GAINED = 'lifeGained',
  LIFE_LOST = 'lifeLost',
}

export interface RulesEvent {
  readonly type: RulesEngineEvent;
  readonly timestamp: number;
  readonly gameId: string;
  readonly data: any;
}

/**
 * Event emitter interface for the rules engine
 */
export interface EventEmitter {
  emit(event: RulesEvent): void;
  on(eventType: RulesEngineEvent, callback: (event: RulesEvent) => void): void;
  off(eventType: RulesEngineEvent, callback: (event: RulesEvent) => void): void;
}
