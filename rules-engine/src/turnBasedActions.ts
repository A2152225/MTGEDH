/**
 * Rule 703: Turn-Based Actions
 * 
 * Turn-based actions are game actions that happen automatically when certain
 * steps or phases begin, or when each step and phase ends. Turn-based actions
 * don't use the stack.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 703
 */

/**
 * Rule 703.1: Definition
 * 
 * Turn-based actions are game actions that happen automatically when certain
 * steps or phases begin, or when each step and phase ends. Turn-based actions
 * don't use the stack.
 */

export interface TurnBasedAction {
  readonly type: TurnBasedActionType;
  readonly affectedObjectIds: readonly string[];
  readonly description: string;
}

export enum TurnBasedActionType {
  // Rule 703.4a - Untap step: phasing
  PHASING = 'phasing',
  
  // Rule 703.4b - Untap step: day/night check
  DAY_NIGHT_CHECK = 'day-night-check',
  
  // Rule 703.4c - Untap step: untap
  UNTAP = 'untap',
  
  // Rule 703.4d - Draw step: draw card
  DRAW = 'draw',
  
  // Rule 703.4e - Archenemy precombat main: set scheme in motion
  SCHEME_ACTION = 'scheme-action',
  
  // Rule 703.4f - Precombat main: lore counters on Sagas
  LORE_COUNTER = 'lore-counter',
  
  // Rule 703.4g - Precombat main: roll to visit Attractions
  ROLL_ATTRACTIONS = 'roll-attractions',
  
  // Rule 703.4h - Beginning of combat: choose defending player
  CHOOSE_DEFENDER = 'choose-defender',
  
  // Rule 703.4i - Declare attackers: declare attackers
  DECLARE_ATTACKERS = 'declare-attackers',
  
  // Rule 703.4j - Declare blockers: declare blockers
  DECLARE_BLOCKERS = 'declare-blockers',
  
  // Rule 703.4k - Combat damage: assign damage
  ASSIGN_COMBAT_DAMAGE = 'assign-combat-damage',
  
  // Rule 703.4m - Combat damage: deal damage
  DEAL_COMBAT_DAMAGE = 'deal-combat-damage',
  
  // Rule 703.4n - Cleanup: discard to hand size
  DISCARD_TO_HAND_SIZE = 'discard-to-hand-size',
  
  // Rule 703.4p - Cleanup: remove damage and end effects
  CLEANUP_DAMAGE_AND_EFFECTS = 'cleanup-damage-and-effects',
  
  // Rule 703.4q - End of step/phase: empty mana pools
  EMPTY_MANA_POOLS = 'empty-mana-pools',
}

/**
 * Rule 703.2: Not controlled by any player
 * 
 * Turn-based actions are not controlled by any player.
 */
export const TURN_BASED_ACTIONS_NO_CONTROLLER = true;

/**
 * Rule 703.3: Turn-based actions happen first
 * 
 * Whenever a step or phase begins, if it's a step or phase that has any
 * turn-based action associated with it, those turn-based actions are
 * automatically dealt with first. This happens before state-based actions are
 * checked, before triggered abilities are put on the stack, and before players
 * receive priority.
 */
export const TURN_BASED_ACTIONS_HAPPEN_FIRST = true;

/**
 * Rule 703.4a: Phasing (Untap step)
 * 
 * Immediately after the untap step begins, all phased-in permanents with
 * phasing that the active player controls phase out, and all phased-out
 * permanents that the active player controlled when they phased out phase in.
 * This all happens simultaneously.
 */
export function performPhasing(
  activePlayerId: string,
  phasedInPermanents: readonly string[],
  phasedOutPermanents: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.PHASING,
    affectedObjectIds: [...phasedInPermanents, ...phasedOutPermanents],
    description: `Phasing action: ${phasedInPermanents.length} phase out, ${phasedOutPermanents.length} phase in (Rule 703.4a)`,
  };
}

/**
 * Rule 703.4b: Day/Night check (Untap step)
 * 
 * Immediately after the phasing action has been completed during the untap step,
 * if the game has either the day or night designation, it checks to see whether
 * that designation should change. If it's neither day nor night, this check
 * doesn't happen.
 */
export function performDayNightCheck(
  hasDayOrNight: boolean,
  shouldChange: boolean
): TurnBasedAction | null {
  if (!hasDayOrNight) return null;
  
  return {
    type: TurnBasedActionType.DAY_NIGHT_CHECK,
    affectedObjectIds: [],
    description: shouldChange
      ? 'Day/night designation changes (Rule 703.4b)'
      : 'Day/night designation checked, no change (Rule 703.4b)',
  };
}

/**
 * Rule 703.4c: Untap (Untap step)
 * 
 * Immediately after the game checks to see if its day or night designation
 * should change during the untap step or, if the game doesn't have a day or
 * night designation, immediately after the phasing action has been completed
 * during the untap step, the active player determines which permanents they
 * control will untap. Then they untap them all simultaneously.
 */
export function performUntap(
  activePlayerId: string,
  permanentsToUntap: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.UNTAP,
    affectedObjectIds: permanentsToUntap,
    description: `Untap ${permanentsToUntap.length} permanents (Rule 703.4c)`,
  };
}

/**
 * Rule 703.4d: Draw card (Draw step)
 * 
 * Immediately after the draw step begins, the active player draws a card.
 */
export function performDraw(activePlayerId: string): TurnBasedAction {
  return {
    type: TurnBasedActionType.DRAW,
    affectedObjectIds: [activePlayerId],
    description: 'Active player draws a card (Rule 703.4d)',
  };
}

/**
 * Rule 703.4e: Scheme action (Archenemy variant)
 * 
 * In an Archenemy game, immediately after the archenemy's precombat main phase
 * begins, that player sets the top card of their scheme deck in motion.
 */
export function performSchemeAction(
  archenemuPlayerId: string,
  schemeCardId: string
): TurnBasedAction {
  return {
    type: TurnBasedActionType.SCHEME_ACTION,
    affectedObjectIds: [archenemuPlayerId, schemeCardId],
    description: 'Set scheme in motion (Rule 703.4e)',
  };
}

/**
 * Rule 703.4f: Lore counters (Precombat main phase)
 * 
 * Immediately after a player's precombat main phase begins, that player puts a
 * lore counter on each Saga enchantment they control with one or more chapter
 * abilities. In an Archenemy game, this happens after the archenemy's scheme
 * action.
 */
export function performLoreCounters(
  activePlayerId: string,
  sagaIds: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.LORE_COUNTER,
    affectedObjectIds: sagaIds,
    description: `Put lore counter on ${sagaIds.length} Sagas (Rule 703.4f)`,
  };
}

/**
 * Rule 703.4g: Roll to visit Attractions (Precombat main phase)
 * 
 * Immediately after the action of placing lore counters has been completed, if
 * the active player controls any Attractions, that player rolls to visit their
 * Attractions.
 */
export function performRollAttractions(
  activePlayerId: string,
  attractionIds: readonly string[]
): TurnBasedAction | null {
  if (attractionIds.length === 0) return null;
  
  return {
    type: TurnBasedActionType.ROLL_ATTRACTIONS,
    affectedObjectIds: attractionIds,
    description: `Roll to visit ${attractionIds.length} Attractions (Rule 703.4g)`,
  };
}

/**
 * Rule 703.4h: Choose defending player (Beginning of combat step)
 * 
 * Immediately after the beginning of combat step begins, if the game being
 * played is a multiplayer game in which the active player's opponents don't all
 * automatically become defending players, the active player chooses one of their
 * opponents. That player becomes the defending player.
 */
export function performChooseDefender(
  activePlayerId: string,
  isMultiplayer: boolean,
  chosenDefenderId?: string
): TurnBasedAction | null {
  if (!isMultiplayer) return null;
  
  return {
    type: TurnBasedActionType.CHOOSE_DEFENDER,
    affectedObjectIds: chosenDefenderId ? [chosenDefenderId] : [],
    description: 'Active player chooses defending player (Rule 703.4h)',
  };
}

/**
 * Rule 703.4i: Declare attackers (Declare attackers step)
 * 
 * Immediately after the declare attackers step begins, the active player
 * declares attackers.
 */
export function performDeclareAttackers(
  activePlayerId: string,
  attackerIds: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.DECLARE_ATTACKERS,
    affectedObjectIds: attackerIds,
    description: `Declare ${attackerIds.length} attackers (Rule 703.4i)`,
  };
}

/**
 * Rule 703.4j: Declare blockers (Declare blockers step)
 * 
 * Immediately after the declare blockers step begins, the defending player
 * declares blockers.
 */
export function performDeclareBlockers(
  defendingPlayerId: string,
  blockerIds: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.DECLARE_BLOCKERS,
    affectedObjectIds: blockerIds,
    description: `Declare ${blockerIds.length} blockers (Rule 703.4j)`,
  };
}

/**
 * Rule 703.4k: Assign combat damage (Combat damage step)
 * 
 * Immediately after the combat damage step begins, each player in APNAP order
 * announces how each attacking or blocking creature they control assigns its
 * combat damage.
 */
export function performAssignCombatDamage(
  combatantIds: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.ASSIGN_COMBAT_DAMAGE,
    affectedObjectIds: combatantIds,
    description: `Assign combat damage for ${combatantIds.length} creatures (Rule 703.4k)`,
  };
}

/**
 * Rule 703.4m: Deal combat damage (Combat damage step)
 * 
 * Immediately after combat damage has been assigned during the combat damage
 * step, all combat damage is dealt simultaneously.
 */
export function performDealCombatDamage(
  combatantIds: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.DEAL_COMBAT_DAMAGE,
    affectedObjectIds: combatantIds,
    description: `Deal combat damage simultaneously (Rule 703.4m)`,
  };
}

/**
 * Rule 703.4n: Discard to hand size (Cleanup step)
 * 
 * Immediately after the cleanup step begins, if the active player's hand
 * contains more cards than their maximum hand size (normally seven), they
 * discard enough cards to reduce their hand size to that number.
 */
export function performDiscardToHandSize(
  activePlayerId: string,
  handSize: number,
  maxHandSize: number,
  cardsToDiscard: readonly string[]
): TurnBasedAction | null {
  if (handSize <= maxHandSize) return null;
  
  return {
    type: TurnBasedActionType.DISCARD_TO_HAND_SIZE,
    affectedObjectIds: [activePlayerId, ...cardsToDiscard],
    description: `Discard ${cardsToDiscard.length} cards to hand size (Rule 703.4n)`,
  };
}

/**
 * Rule 703.4p: Remove damage and end effects (Cleanup step)
 * 
 * Immediately after the active player has discarded cards (if necessary) during
 * the cleanup step, all damage is removed from permanents and all "until end of
 * turn" and "this turn" effects end. These actions happen simultaneously.
 */
export function performCleanupDamageAndEffects(
  permanentsWithDamage: readonly string[],
  effectsEnding: readonly string[]
): TurnBasedAction {
  return {
    type: TurnBasedActionType.CLEANUP_DAMAGE_AND_EFFECTS,
    affectedObjectIds: [...permanentsWithDamage, ...effectsEnding],
    description: `Remove damage from ${permanentsWithDamage.length} permanents, end ${effectsEnding.length} effects (Rule 703.4p)`,
  };
}

/**
 * Rule 703.4q: Empty mana pools (End of step/phase)
 * 
 * As each step or phase ends, any unspent mana left in a player's mana pool
 * empties.
 */
export function performEmptyManaPools(
  playersWithMana: readonly string[]
): TurnBasedAction | null {
  if (playersWithMana.length === 0) return null;
  
  return {
    type: TurnBasedActionType.EMPTY_MANA_POOLS,
    affectedObjectIds: playersWithMana,
    description: `Empty mana pools for ${playersWithMana.length} players (Rule 703.4q)`,
  };
}

/**
 * Rule 703.1: Turn-based actions don't use the stack
 */
export const TURN_BASED_ACTIONS_DONT_USE_STACK = true;
