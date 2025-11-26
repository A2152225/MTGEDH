/**
 * prioritySystem.ts
 * 
 * Enhanced priority system implementing Rule 117: Timing and Priority
 * 
 * Features:
 * - Auto-pass toggle for players who want to pass automatically
 * - Non-active player prompts with proper APNAP ordering
 * - Draw step auto-proceed with careful timing for triggers
 * - Priority windows for different game phases
 */

/**
 * Priority settings for a player
 */
export interface PlayerPrioritySettings {
  readonly playerId: string;
  /** Auto-pass priority when no legal actions are available */
  readonly autoPassWhenEmpty: boolean;
  /** Auto-pass during opponents' turns (yield to end of turn) */
  readonly autoPassOnOpponentTurn: boolean;
  /** Auto-pass through draw step (but still trigger abilities) */
  readonly autoPassDrawStep: boolean;
  /** Stop on all triggers (even if auto-passing) */
  readonly stopOnTriggers: boolean;
  /** Stop at specific phases */
  readonly stopPhases: readonly string[];
}

/**
 * Default priority settings
 */
export const DEFAULT_PRIORITY_SETTINGS: PlayerPrioritySettings = {
  playerId: '',
  autoPassWhenEmpty: true,
  autoPassOnOpponentTurn: false,
  autoPassDrawStep: true,
  stopOnTriggers: true,
  stopPhases: ['UPKEEP', 'MAIN1', 'DECLARE_ATTACKERS', 'MAIN2', 'END'],
};

/**
 * Create priority settings for a player
 */
export function createPrioritySettings(
  playerId: string,
  overrides?: Partial<PlayerPrioritySettings>
): PlayerPrioritySettings {
  return {
    ...DEFAULT_PRIORITY_SETTINGS,
    playerId,
    ...overrides,
  };
}

/**
 * Priority state for the game
 */
export interface PriorityState {
  readonly currentPlayer: string;
  readonly activePlayer: string;
  readonly turnOrder: readonly string[];
  readonly passedThisRound: ReadonlySet<string>;
  readonly stackSize: number;
  readonly playerSettings: ReadonlyMap<string, PlayerPrioritySettings>;
  readonly pendingTriggers: number;
  readonly waitingForResponse: boolean;
}

/**
 * Priority check result
 */
export interface PriorityCheckResult {
  readonly shouldAutoPass: boolean;
  readonly reason?: string;
  readonly needsPrompt: boolean;
  readonly promptReason?: string;
}

/**
 * Check if a player should auto-pass priority
 */
export function checkAutoPass(
  state: PriorityState,
  playerId: string,
  currentPhase: string,
  currentStep: string,
  hasLegalActions: boolean
): PriorityCheckResult {
  const settings = state.playerSettings.get(playerId) || DEFAULT_PRIORITY_SETTINGS;
  const isActivePlayer = playerId === state.activePlayer;
  
  // Never auto-pass if there are pending triggers to respond to
  if (state.pendingTriggers > 0 && settings.stopOnTriggers) {
    return {
      shouldAutoPass: false,
      needsPrompt: true,
      promptReason: 'Pending triggers require response',
    };
  }
  
  // Never auto-pass if waiting for a specific response
  if (state.waitingForResponse) {
    return {
      shouldAutoPass: false,
      needsPrompt: true,
      promptReason: 'Waiting for response',
    };
  }
  
  // Check if this is a stop phase for the player
  if (settings.stopPhases.includes(currentStep) || settings.stopPhases.includes(currentPhase)) {
    if (isActivePlayer) {
      return {
        shouldAutoPass: false,
        needsPrompt: true,
        promptReason: `Stop phase: ${currentStep || currentPhase}`,
      };
    }
  }
  
  // Auto-pass if no legal actions and setting enabled
  if (!hasLegalActions && settings.autoPassWhenEmpty) {
    return {
      shouldAutoPass: true,
      reason: 'No legal actions available',
      needsPrompt: false,
    };
  }
  
  // Auto-pass on opponent's turn if setting enabled
  if (!isActivePlayer && settings.autoPassOnOpponentTurn) {
    // But not if there's something on the stack
    if (state.stackSize === 0) {
      return {
        shouldAutoPass: true,
        reason: 'Auto-pass on opponent turn',
        needsPrompt: false,
      };
    }
  }
  
  // Auto-pass through draw step if setting enabled
  if (currentStep === 'DRAW' && settings.autoPassDrawStep && !isActivePlayer) {
    return {
      shouldAutoPass: true,
      reason: 'Auto-pass draw step',
      needsPrompt: false,
    };
  }
  
  // Default: require prompt
  return {
    shouldAutoPass: false,
    needsPrompt: true,
    promptReason: 'Normal priority',
  };
}

/**
 * Pass priority and get next player in turn order
 */
export function passPriority(
  state: PriorityState
): PriorityState {
  const currentIndex = state.turnOrder.indexOf(state.currentPlayer);
  const nextIndex = (currentIndex + 1) % state.turnOrder.length;
  const nextPlayer = state.turnOrder[nextIndex];
  
  const newPassedSet = new Set(state.passedThisRound);
  newPassedSet.add(state.currentPlayer);
  
  return {
    ...state,
    currentPlayer: nextPlayer,
    passedThisRound: newPassedSet,
  };
}

/**
 * Reset priority after action taken (resets passed tracking)
 */
export function resetPriorityAfterAction(
  state: PriorityState,
  actingPlayer: string
): PriorityState {
  return {
    ...state,
    currentPlayer: actingPlayer,
    passedThisRound: new Set(),
  };
}

/**
 * Grant priority to active player (used at start of steps)
 */
export function grantPriorityToActivePlayer(
  state: PriorityState
): PriorityState {
  return {
    ...state,
    currentPlayer: state.activePlayer,
    passedThisRound: new Set(),
  };
}

/**
 * Check if all players have passed in succession
 */
export function allPlayersPassed(state: PriorityState): boolean {
  return state.turnOrder.every(playerId => state.passedThisRound.has(playerId));
}

/**
 * Priority action result
 */
export interface PriorityActionResult {
  readonly nextState: PriorityState;
  readonly shouldResolveStack: boolean;
  readonly shouldAdvanceStep: boolean;
  readonly logs: readonly string[];
}

/**
 * Handle a priority pass action
 */
export function handlePriorityPass(
  state: PriorityState,
  playerId: string
): PriorityActionResult {
  const logs: string[] = [];
  
  // Verify it's this player's priority
  if (state.currentPlayer !== playerId) {
    return {
      nextState: state,
      shouldResolveStack: false,
      shouldAdvanceStep: false,
      logs: [`${playerId} does not have priority`],
    };
  }
  
  // Pass priority
  const nextState = passPriority(state);
  logs.push(`${playerId} passes priority`);
  
  // Check if all players have passed
  if (allPlayersPassed(nextState)) {
    if (state.stackSize > 0) {
      // Resolve top of stack
      return {
        nextState: { ...nextState, passedThisRound: new Set() },
        shouldResolveStack: true,
        shouldAdvanceStep: false,
        logs: [...logs, 'All players passed, resolving stack'],
      };
    } else {
      // Advance to next step
      return {
        nextState: { ...nextState, passedThisRound: new Set() },
        shouldResolveStack: false,
        shouldAdvanceStep: true,
        logs: [...logs, 'All players passed, advancing step'],
      };
    }
  }
  
  return {
    nextState,
    shouldResolveStack: false,
    shouldAdvanceStep: false,
    logs,
  };
}

/**
 * Draw step timing configuration
 */
export interface DrawStepTiming {
  /** Delay before auto-proceeding (ms) to allow trigger responses */
  readonly triggerResponseWindow: number;
  /** Whether to wait for explicit pass from active player */
  readonly requireActivePlayerPass: boolean;
  /** Whether to auto-proceed if no triggers detected */
  readonly autoProceedIfNoTriggers: boolean;
}

/**
 * Default draw step timing
 */
export const DEFAULT_DRAW_STEP_TIMING: DrawStepTiming = {
  triggerResponseWindow: 1000, // 1 second window
  requireActivePlayerPass: true,
  autoProceedIfNoTriggers: false,
};

/**
 * Check if draw step should auto-proceed
 * Rule 504: Draw step has a turn-based action (draw card), then players get priority
 */
export function shouldDrawStepAutoProceed(
  state: PriorityState,
  timing: DrawStepTiming,
  hasDrawTriggers: boolean,
  timeSinceDrawStepStart: number
): { shouldProceed: boolean; reason: string } {
  // Never auto-proceed if there are pending triggers
  if (state.pendingTriggers > 0) {
    return {
      shouldProceed: false,
      reason: 'Pending draw triggers',
    };
  }
  
  // If there are draw triggers on permanents, wait for response window
  if (hasDrawTriggers && timeSinceDrawStepStart < timing.triggerResponseWindow) {
    return {
      shouldProceed: false,
      reason: 'Within trigger response window',
    };
  }
  
  // If requiring active player pass, check if they've passed
  if (timing.requireActivePlayerPass && !state.passedThisRound.has(state.activePlayer)) {
    return {
      shouldProceed: false,
      reason: 'Active player has not passed',
    };
  }
  
  // Auto-proceed if no triggers and setting enabled
  if (!hasDrawTriggers && timing.autoProceedIfNoTriggers) {
    return {
      shouldProceed: true,
      reason: 'No draw triggers detected',
    };
  }
  
  // Check if all players have passed
  if (allPlayersPassed(state)) {
    return {
      shouldProceed: true,
      reason: 'All players passed priority',
    };
  }
  
  return {
    shouldProceed: false,
    reason: 'Waiting for players to pass',
  };
}

/**
 * Non-active player prompt types
 */
export enum NonActivePlayerPrompt {
  PRIORITY = 'priority',
  TRIGGER_RESPONSE = 'trigger_response',
  REPLACEMENT_EFFECT = 'replacement_effect',
  SACRIFICE_CHOICE = 'sacrifice_choice',
  DISCARD_CHOICE = 'discard_choice',
  TARGET_CHOICE = 'target_choice',
}

/**
 * Prompt for non-active player
 */
export interface PlayerPrompt {
  readonly playerId: string;
  readonly type: NonActivePlayerPrompt;
  readonly description: string;
  readonly choices?: readonly string[];
  readonly mandatory: boolean;
  readonly timeLimit?: number;
}

/**
 * Create a priority prompt for a player
 */
export function createPriorityPrompt(
  playerId: string,
  reason: string,
  isActive: boolean
): PlayerPrompt {
  return {
    playerId,
    type: NonActivePlayerPrompt.PRIORITY,
    description: isActive 
      ? `Your priority${reason ? ': ' + reason : ''}`
      : `Respond to ${reason}`,
    mandatory: false,
  };
}

/**
 * Create a trigger response prompt
 */
export function createTriggerPrompt(
  playerId: string,
  triggerSource: string,
  triggerEffect: string,
  choices?: readonly string[]
): PlayerPrompt {
  return {
    playerId,
    type: NonActivePlayerPrompt.TRIGGER_RESPONSE,
    description: `${triggerSource}: ${triggerEffect}`,
    choices,
    mandatory: true,
  };
}

export default {
  DEFAULT_PRIORITY_SETTINGS,
  DEFAULT_DRAW_STEP_TIMING,
  createPrioritySettings,
  checkAutoPass,
  passPriority,
  resetPriorityAfterAction,
  grantPriorityToActivePlayer,
  allPlayersPassed,
  handlePriorityPass,
  shouldDrawStepAutoProceed,
  createPriorityPrompt,
  createTriggerPrompt,
  NonActivePlayerPrompt,
};
