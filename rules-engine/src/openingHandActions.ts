/**
 * Opening Hand Actions (Pre-Game Effects)
 * 
 * Implements special abilities that can be activated before the game begins,
 * specifically during the pre-game phase after mulligans are complete.
 * 
 * Types of opening hand effects:
 * 
 * 1. Leyline Effects (e.g., Leyline of Sanctity, Leyline of the Void):
 *    "If this card is in your opening hand, you may begin the game with it on the battlefield."
 *    These cards enter the battlefield before the first turn begins.
 * 
 * 2. Chancellor Effects (e.g., Chancellor of the Forge, Chancellor of the Annex):
 *    "You may reveal this card from your opening hand. If you do, [effect] at the beginning of the first upkeep."
 *    These create delayed triggered abilities for the first upkeep.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 103.6
 * Rule 103.6: Some cards allow a player to take actions with them from their opening hand.
 * Once the mulligan process is complete, the starting player may take any such actions in the
 * order of their choice. Then each other player in turn order may do the same.
 */

/**
 * Types of opening hand actions
 */
export enum OpeningHandActionType {
  /** Begin the game with card on battlefield (Leyline-style) */
  BEGIN_ON_BATTLEFIELD = 'begin_on_battlefield',
  
  /** Reveal to create a delayed trigger for first upkeep (Chancellor-style) */
  REVEAL_FOR_TRIGGER = 'reveal_for_trigger',
  
  /** Other custom opening hand effects */
  CUSTOM = 'custom',
}

/**
 * Definition of an opening hand action for a card
 */
export interface OpeningHandAction {
  readonly type: OpeningHandActionType;
  readonly cardId: string;
  readonly cardName: string;
  readonly controllerId: string;
  
  /** For REVEAL_FOR_TRIGGER: the effect that triggers at first upkeep */
  readonly delayedTriggerEffect?: string;
  
  /** For REVEAL_FOR_TRIGGER: tokens to create, damage to deal, etc. */
  readonly triggerData?: OpeningHandTriggerData;
}

/**
 * Data for delayed triggers from reveal effects
 */
export interface OpeningHandTriggerData {
  /** Type of effect */
  readonly effectType: 'create_token' | 'deal_damage' | 'gain_life' | 'draw_card' | 'counter_spell' | 'custom';
  
  /** For token creation */
  readonly tokenName?: string;
  readonly tokenCount?: number;
  readonly tokenPower?: number;
  readonly tokenToughness?: number;
  readonly tokenAbilities?: readonly string[];
  
  /** For damage/life effects */
  readonly amount?: number;
  readonly targetType?: 'each_opponent' | 'target_player' | 'you';
  
  /** Custom effect description */
  readonly customEffect?: string;
}

/**
 * Result of processing opening hand actions
 */
export interface OpeningHandResult {
  readonly permanentsToAdd: readonly OpeningHandPermanent[];
  readonly delayedTriggers: readonly DelayedTrigger[];
  readonly cardsRevealed: readonly string[];
  readonly log: readonly string[];
}

/**
 * A permanent to add to the battlefield from opening hand
 */
export interface OpeningHandPermanent {
  readonly cardId: string;
  readonly cardName: string;
  readonly controllerId: string;
  readonly ownerId: string;
  readonly card: any; // Full card data
}

/**
 * A delayed trigger for the first upkeep
 */
export interface DelayedTrigger {
  readonly sourceCardId: string;
  readonly sourceCardName: string;
  readonly controllerId: string;
  readonly triggerData: OpeningHandTriggerData;
  readonly triggersAt: 'first_upkeep';
}

/**
 * Check if a card has an opening hand action based on its oracle text
 */
export function detectOpeningHandAction(card: {
  id: string;
  name: string;
  oracle_text?: string;
  type_line?: string;
}): OpeningHandActionType | null {
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Leyline pattern: "If ~ is in your opening hand, you may begin the game with it on the battlefield"
  if (
    oracleText.includes('opening hand') &&
    oracleText.includes('begin the game') &&
    oracleText.includes('battlefield')
  ) {
    return OpeningHandActionType.BEGIN_ON_BATTLEFIELD;
  }
  
  // Chancellor pattern: "You may reveal this card from your opening hand"
  if (
    oracleText.includes('reveal this card from your opening hand') ||
    oracleText.includes('reveal ~ from your opening hand')
  ) {
    return OpeningHandActionType.REVEAL_FOR_TRIGGER;
  }
  
  return null;
}

/**
 * Parse the trigger data from a Chancellor-style card
 */
export function parseChancellorTrigger(card: {
  id: string;
  name: string;
  oracle_text?: string;
}): OpeningHandTriggerData | null {
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = card.name.toLowerCase();
  
  // Chancellor of the Forge: create 1/1 red Goblin token with haste
  if (cardName.includes('chancellor of the forge')) {
    return {
      effectType: 'create_token',
      tokenName: 'Phyrexian Goblin',
      tokenCount: 1,
      tokenPower: 1,
      tokenToughness: 1,
      tokenAbilities: ['haste'],
    };
  }
  
  // Chancellor of the Annex: counter spell unless they pay 1
  if (cardName.includes('chancellor of the annex')) {
    return {
      effectType: 'counter_spell',
      customEffect: 'Counter target spell unless its controller pays {1}',
    };
  }
  
  // Chancellor of the Dross: each opponent loses 3 life, you gain life equal to life lost
  if (cardName.includes('chancellor of the dross')) {
    return {
      effectType: 'deal_damage',
      amount: 3,
      targetType: 'each_opponent',
      customEffect: 'Each opponent loses 3 life, then you gain life equal to the life lost this way',
    };
  }
  
  // Chancellor of the Spires: each opponent mills 7 cards
  if (cardName.includes('chancellor of the spires')) {
    return {
      effectType: 'custom',
      customEffect: 'Each opponent mills seven cards',
    };
  }
  
  // Chancellor of the Tangle: add one green mana
  if (cardName.includes('chancellor of the tangle')) {
    return {
      effectType: 'custom',
      customEffect: 'Add {G} to your mana pool',
    };
  }
  
  // Generic detection from oracle text
  if (oracleText.includes('create') && oracleText.includes('token')) {
    return {
      effectType: 'create_token',
      customEffect: 'Create a token as described on the card',
    };
  }
  
  return null;
}

/**
 * Create an opening hand action for a card
 */
export function createOpeningHandAction(
  card: {
    id: string;
    name: string;
    oracle_text?: string;
    type_line?: string;
  },
  controllerId: string
): OpeningHandAction | null {
  const actionType = detectOpeningHandAction(card);
  
  if (!actionType) {
    return null;
  }
  
  const action: OpeningHandAction = {
    type: actionType,
    cardId: card.id,
    cardName: card.name,
    controllerId,
  };
  
  if (actionType === OpeningHandActionType.REVEAL_FOR_TRIGGER) {
    const triggerData = parseChancellorTrigger(card);
    if (triggerData) {
      return {
        ...action,
        triggerData,
        delayedTriggerEffect: triggerData.customEffect || `${card.name} trigger effect`,
      };
    }
  }
  
  return action;
}

/**
 * Find all cards in a player's opening hand that have opening hand actions
 */
export function findOpeningHandActions(
  hand: readonly { id: string; name: string; oracle_text?: string; type_line?: string }[],
  playerId: string
): OpeningHandAction[] {
  const actions: OpeningHandAction[] = [];
  
  for (const card of hand) {
    const action = createOpeningHandAction(card, playerId);
    if (action) {
      actions.push(action);
    }
  }
  
  return actions;
}

/**
 * Process a player's opening hand actions
 * Returns the permanents to add to battlefield and delayed triggers to set up
 */
export function processOpeningHandActions(
  actions: readonly OpeningHandAction[],
  hand: any[],
  playerId: string
): OpeningHandResult {
  const permanentsToAdd: OpeningHandPermanent[] = [];
  const delayedTriggers: DelayedTrigger[] = [];
  const cardsRevealed: string[] = [];
  const log: string[] = [];
  
  for (const action of actions) {
    switch (action.type) {
      case OpeningHandActionType.BEGIN_ON_BATTLEFIELD: {
        // Find the card in hand
        const cardIndex = hand.findIndex(c => c && c.id === action.cardId);
        if (cardIndex !== -1) {
          const card = hand[cardIndex];
          permanentsToAdd.push({
            cardId: action.cardId,
            cardName: action.cardName,
            controllerId: playerId,
            ownerId: playerId,
            card,
          });
          log.push(`${playerId} begins the game with ${action.cardName} on the battlefield.`);
        }
        break;
      }
      
      case OpeningHandActionType.REVEAL_FOR_TRIGGER: {
        // Card stays in hand, but create a delayed trigger
        cardsRevealed.push(action.cardId);
        if (action.triggerData) {
          delayedTriggers.push({
            sourceCardId: action.cardId,
            sourceCardName: action.cardName,
            controllerId: playerId,
            triggerData: action.triggerData,
            triggersAt: 'first_upkeep',
          });
          log.push(`${playerId} reveals ${action.cardName} from their opening hand.`);
        }
        break;
      }
    }
  }
  
  return {
    permanentsToAdd,
    delayedTriggers,
    cardsRevealed,
    log,
  };
}

/**
 * Apply opening hand permanents to the battlefield
 */
export function applyOpeningHandPermanents(
  battlefield: any[],
  permanents: readonly OpeningHandPermanent[],
  hand: any[]
): { battlefield: any[]; hand: any[]; log: string[] } {
  const newBattlefield = [...battlefield];
  let newHand = [...hand];
  const log: string[] = [];
  
  for (const perm of permanents) {
    // Remove from hand
    const handIndex = newHand.findIndex(c => c && c.id === perm.cardId);
    if (handIndex !== -1) {
      newHand.splice(handIndex, 1);
    }
    
    // Add to battlefield
    const permanentEntry = {
      id: perm.cardId,
      card: {
        ...perm.card,
        zone: 'battlefield',
      },
      controller: perm.controllerId,
      owner: perm.ownerId,
      tapped: false,
      counters: {},
    };
    
    newBattlefield.push(permanentEntry);
    log.push(`${perm.cardName} enters the battlefield from ${perm.controllerId}'s opening hand.`);
  }
  
  return {
    battlefield: newBattlefield,
    hand: newHand,
    log,
  };
}

/**
 * Check if it's the first upkeep of the game (for Chancellor triggers)
 */
export function isFirstUpkeep(turnNumber: number, step: string): boolean {
  return turnNumber === 1 && (step === 'upkeep' || step === 'UPKEEP');
}

/**
 * Process delayed triggers for first upkeep
 */
export function processFirstUpkeepTriggers(
  delayedTriggers: readonly DelayedTrigger[]
): { effects: any[]; log: string[] } {
  const effects: any[] = [];
  const log: string[] = [];
  
  for (const trigger of delayedTriggers) {
    if (trigger.triggersAt !== 'first_upkeep') continue;
    
    const data = trigger.triggerData;
    
    switch (data.effectType) {
      case 'create_token':
        effects.push({
          type: 'create_token',
          controller: trigger.controllerId,
          tokenName: data.tokenName,
          count: data.tokenCount || 1,
          power: data.tokenPower,
          toughness: data.tokenToughness,
          abilities: data.tokenAbilities,
        });
        log.push(`${trigger.sourceCardName} triggers: Create ${data.tokenCount || 1} ${data.tokenName} token(s).`);
        break;
        
      case 'deal_damage':
        effects.push({
          type: 'damage',
          source: trigger.sourceCardId,
          controller: trigger.controllerId,
          amount: data.amount,
          targetType: data.targetType,
        });
        log.push(`${trigger.sourceCardName} triggers: ${data.customEffect || `Deal ${data.amount} damage.`}`);
        break;
        
      case 'gain_life':
        effects.push({
          type: 'gain_life',
          controller: trigger.controllerId,
          amount: data.amount,
        });
        log.push(`${trigger.sourceCardName} triggers: Gain ${data.amount} life.`);
        break;
        
      case 'draw_card':
        effects.push({
          type: 'draw',
          controller: trigger.controllerId,
          count: data.amount || 1,
        });
        log.push(`${trigger.sourceCardName} triggers: Draw ${data.amount || 1} card(s).`);
        break;
        
      case 'counter_spell':
      case 'custom':
        effects.push({
          type: 'custom',
          controller: trigger.controllerId,
          source: trigger.sourceCardId,
          sourceName: trigger.sourceCardName,
          effect: data.customEffect,
        });
        log.push(`${trigger.sourceCardName} triggers: ${data.customEffect}`);
        break;
    }
  }
  
  return { effects, log };
}

// ============================================================================
// Mulligan Phase Integration
// ============================================================================

/**
 * State for tracking mulligan phase completion
 * Rule 103.5: Mulligan process must complete for all players before opening hand actions
 */
export interface MulliganPhaseState {
  readonly playerIds: readonly string[];
  readonly playersWhoHaveKept: readonly string[];
  readonly isComplete: boolean;
}

/**
 * Create initial mulligan phase state
 */
export function createMulliganPhaseState(playerIds: readonly string[]): MulliganPhaseState {
  return {
    playerIds,
    playersWhoHaveKept: [],
    isComplete: false,
  };
}

/**
 * Record a player keeping their hand
 * Rule 103.5: When all players have kept their hands, mulligan phase is complete
 */
export function playerKeepsHand(
  state: MulliganPhaseState,
  playerId: string
): MulliganPhaseState {
  if (state.playersWhoHaveKept.includes(playerId)) {
    return state; // Already kept
  }
  
  const newPlayersWhoHaveKept = [...state.playersWhoHaveKept, playerId];
  const isComplete = state.playerIds.every(id => newPlayersWhoHaveKept.includes(id));
  
  return {
    ...state,
    playersWhoHaveKept: newPlayersWhoHaveKept,
    isComplete,
  };
}

/**
 * Check if mulligan phase is complete and opening hand actions can be taken
 * Rule 103.6: Opening hand actions occur after mulligans are complete
 */
export function canTakeOpeningHandActions(state: MulliganPhaseState): boolean {
  return state.isComplete;
}

/**
 * State for the opening hand actions phase (after mulligans)
 * Rule 103.6: Starting player takes all their opening hand actions first,
 * then each other player in turn order
 */
export interface OpeningHandActionsPhaseState {
  readonly playerOrder: readonly string[];
  readonly currentPlayerIndex: number;
  readonly playersCompleted: readonly string[];
  readonly isComplete: boolean;
  readonly delayedTriggers: readonly DelayedTrigger[];
}

/**
 * Create opening hand actions phase state
 * @param playerOrder - Players in turn order, starting player first
 */
export function createOpeningHandActionsPhaseState(
  playerOrder: readonly string[]
): OpeningHandActionsPhaseState {
  return {
    playerOrder,
    currentPlayerIndex: 0,
    playersCompleted: [],
    isComplete: playerOrder.length === 0,
    delayedTriggers: [],
  };
}

/**
 * Get the player who should take opening hand actions now
 */
export function getCurrentOpeningHandPlayer(
  state: OpeningHandActionsPhaseState
): string | null {
  if (state.isComplete) return null;
  return state.playerOrder[state.currentPlayerIndex] || null;
}

/**
 * Record that a player has completed their opening hand actions
 * @param state Current phase state
 * @param playerId The player who completed their actions
 * @param newDelayedTriggers Any new delayed triggers created (e.g., Chancellor reveals)
 */
export function playerCompletesOpeningHandActions(
  state: OpeningHandActionsPhaseState,
  playerId: string,
  newDelayedTriggers: readonly DelayedTrigger[] = []
): OpeningHandActionsPhaseState {
  if (state.playersCompleted.includes(playerId)) {
    return state; // Already completed
  }
  
  const newPlayersCompleted = [...state.playersCompleted, playerId];
  const newCurrentPlayerIndex = state.currentPlayerIndex + 1;
  const isComplete = newCurrentPlayerIndex >= state.playerOrder.length;
  
  return {
    ...state,
    currentPlayerIndex: newCurrentPlayerIndex,
    playersCompleted: newPlayersCompleted,
    isComplete,
    delayedTriggers: [...state.delayedTriggers, ...newDelayedTriggers],
  };
}

/**
 * Full pre-game setup sequence result
 */
export interface PreGameSetupResult {
  readonly mulliganState: MulliganPhaseState;
  readonly openingHandActionsState: OpeningHandActionsPhaseState;
  readonly readyToStartGame: boolean;
  readonly log: readonly string[];
}

/**
 * Check if the game is ready to start (all pre-game phases complete)
 */
export function isReadyToStartGame(
  mulliganState: MulliganPhaseState,
  openingHandActionsState: OpeningHandActionsPhaseState
): boolean {
  return mulliganState.isComplete && openingHandActionsState.isComplete;
}
