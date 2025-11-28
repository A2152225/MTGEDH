/**
 * Rule 603: Handling Triggered Abilities
 * 
 * Triggered abilities watch for events and trigger when those events occur.
 * They use "when," "whenever," or "at."
 * 
 * Based on MagicCompRules 20251114.txt
 */

import type { StackObject } from './spellCasting';

/**
 * Rule 603.1: Triggered ability keywords
 */
export enum TriggerKeyword {
  WHEN = 'when',       // One-time events
  WHENEVER = 'whenever', // Each time event happens
  AT = 'at',          // Beginning/end of phase/step
}

/**
 * Common trigger events
 */
export enum TriggerEvent {
  // Zone changes
  ENTERS_BATTLEFIELD = 'enters_battlefield',
  LEAVES_BATTLEFIELD = 'leaves_battlefield',
  DIES = 'dies',
  DRAWN = 'drawn',
  DISCARDED = 'discarded',
  EXILED = 'exiled',
  PUT_INTO_GRAVEYARD = 'put_into_graveyard',
  PUT_INTO_HAND = 'put_into_hand',
  RETURNED_TO_HAND = 'returned_to_hand',
  MILLED = 'milled',
  
  // Combat
  ATTACKS = 'attacks',
  ATTACKS_ALONE = 'attacks_alone',
  BLOCKS = 'blocks',
  BLOCKED = 'blocked',
  BECOMES_BLOCKED = 'becomes_blocked',
  UNBLOCKED = 'unblocked',
  DEALS_DAMAGE = 'deals_damage',
  DEALS_COMBAT_DAMAGE = 'deals_combat_damage',
  DEALS_COMBAT_DAMAGE_TO_PLAYER = 'deals_combat_damage_to_player',
  DEALT_DAMAGE = 'dealt_damage',
  DEALT_COMBAT_DAMAGE = 'dealt_combat_damage',
  COMBAT_DAMAGE_STEP = 'combat_damage_step',
  
  // Turn structure
  BEGINNING_OF_TURN = 'beginning_of_turn',
  BEGINNING_OF_UPKEEP = 'beginning_of_upkeep',
  BEGINNING_OF_DRAW_STEP = 'beginning_of_draw_step',
  BEGINNING_OF_PRECOMBAT_MAIN = 'beginning_of_precombat_main',
  BEGINNING_OF_COMBAT = 'beginning_of_combat',
  BEGINNING_OF_DECLARE_ATTACKERS = 'beginning_of_declare_attackers',
  BEGINNING_OF_DECLARE_BLOCKERS = 'beginning_of_declare_blockers',
  BEGINNING_OF_POSTCOMBAT_MAIN = 'beginning_of_postcombat_main',
  END_OF_TURN = 'end_of_turn',
  BEGINNING_OF_END_STEP = 'beginning_of_end_step',
  END_OF_COMBAT = 'end_of_combat',
  CLEANUP_STEP = 'cleanup_step',
  
  // Spells and abilities
  SPELL_CAST = 'spell_cast',
  CREATURE_SPELL_CAST = 'creature_spell_cast',
  NONCREATURE_SPELL_CAST = 'noncreature_spell_cast',
  INSTANT_OR_SORCERY_CAST = 'instant_or_sorcery_cast',
  ABILITY_ACTIVATED = 'ability_activated',
  ABILITY_TRIGGERED = 'ability_triggered',
  SPELL_COUNTERED = 'spell_countered',
  
  // State changes
  BECOMES_TAPPED = 'becomes_tapped',
  BECOMES_UNTAPPED = 'becomes_untapped',
  COUNTER_PLACED = 'counter_placed',
  COUNTER_REMOVED = 'counter_removed',
  GAINED_LIFE = 'gained_life',
  LOST_LIFE = 'lost_life',
  LIFE_PAID = 'life_paid',
  
  // Token and permanent changes
  TOKEN_CREATED = 'token_created',
  TRANSFORMED = 'transformed',
  BECAME_MONSTROUS = 'became_monstrous',
  BECAME_RENOWNED = 'became_renowned',
  EQUIPPED = 'equipped',
  ENCHANTED = 'enchanted',
  ATTACHED = 'attached',
  
  // Player actions
  LANDFALL = 'landfall',
  SEARCHED_LIBRARY = 'searched_library',
  SHUFFLED_LIBRARY = 'shuffled_library',
  SCRIED = 'scried',
  SURVEIL = 'surveil',
  EXPLORED = 'explored',
  
  // Sacrifice triggers
  SACRIFICED = 'sacrificed',
  CREATURE_SACRIFICED = 'creature_sacrificed',
  ARTIFACT_SACRIFICED = 'artifact_sacrificed',
  
  // Other common triggers
  TARGETED = 'targeted',
  DESTROYED = 'destroyed',
  REGENERATED = 'regenerated',
  CONTROLLED_CREATURE_DIED = 'controlled_creature_died',
  OPPONENT_CREATURE_DIED = 'opponent_creature_died',
}

/**
 * Triggered ability definition
 */
export interface TriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly keyword: TriggerKeyword;
  readonly event: TriggerEvent;
  readonly condition?: string;
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly optional?: boolean; // "may" trigger
}

/**
 * Trigger instance waiting to be put on stack
 */
export interface TriggerInstance {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly timestamp: number;
  readonly hasTriggered: boolean;
  readonly onStack: boolean;
}

/**
 * Trigger queue for managing pending triggers
 */
export interface TriggerQueue {
  readonly triggers: readonly TriggerInstance[];
}

/**
 * Create empty trigger queue
 */
export function createEmptyTriggerQueue(): TriggerQueue {
  return { triggers: [] };
}

/**
 * Rule 603.2: When a triggered ability triggers
 */
export function createTriggerInstance(
  ability: TriggeredAbility,
  timestamp: number
): TriggerInstance {
  return {
    id: `trigger-${timestamp}-${ability.id}`,
    abilityId: ability.id,
    sourceId: ability.sourceId,
    sourceName: ability.sourceName,
    controllerId: ability.controllerId,
    effect: ability.effect,
    targets: ability.targets,
    timestamp,
    hasTriggered: true,
    onStack: false,
  };
}

/**
 * Add trigger to queue
 */
export function queueTrigger(
  queue: Readonly<TriggerQueue>,
  trigger: TriggerInstance
): TriggerQueue {
  return {
    triggers: [...queue.triggers, trigger],
  };
}

/**
 * Rule 603.3: Triggered abilities go on stack next time player gets priority
 * Rule 603.3b: APNAP (Active Player, Non-Active Player) order
 */
export function putTriggersOnStack(
  queue: Readonly<TriggerQueue>,
  activePlayerId: string
): {
  queue: TriggerQueue;
  stackObjects: StackObject[];
  log: string[];
} {
  if (queue.triggers.length === 0) {
    return {
      queue,
      stackObjects: [],
      log: [],
    };
  }
  
  const logs: string[] = [];
  
  // Sort triggers by APNAP order
  const sorted = [...queue.triggers].sort((a, b) => {
    // Active player's triggers first
    if (a.controllerId === activePlayerId && b.controllerId !== activePlayerId) {
      return -1;
    }
    if (a.controllerId !== activePlayerId && b.controllerId === activePlayerId) {
      return 1;
    }
    // Then by timestamp (order they triggered)
    return a.timestamp - b.timestamp;
  });
  
  // Convert to stack objects
  const stackObjects: StackObject[] = sorted.map(trigger => {
    logs.push(`${trigger.sourceName} triggered ability goes on stack`);
    
    return {
      id: trigger.id,
      spellId: trigger.abilityId,
      cardName: `${trigger.sourceName} trigger`,
      controllerId: trigger.controllerId,
      targets: trigger.targets || [],
      timestamp: trigger.timestamp,
      type: 'ability',
    };
  });
  
  // Clear the queue
  return {
    queue: createEmptyTriggerQueue(),
    stackObjects,
    log: logs,
  };
}

/**
 * Check if an event would trigger an ability
 * 
 * This implementation checks:
 * 1. Event type matching
 * 2. Condition evaluation (e.g., "if you control a creature")
 * 3. Controller/filter matching (e.g., "you" vs "opponent" triggers)
 * 
 * @param ability - The triggered ability to check
 * @param event - The event that occurred
 * @param eventData - Context data for condition evaluation including battlefield state,
 *                    source/target information, life totals, etc. See TriggerEventData interface.
 * @returns true if the event would trigger the ability
 */
export function checkTrigger(
  ability: TriggeredAbility,
  event: TriggerEvent,
  eventData?: TriggerEventData
): boolean {
  // First check event type
  if (ability.event !== event) {
    return false;
  }
  
  // Check condition if present
  if (ability.condition) {
    if (!evaluateTriggerCondition(ability.condition, ability.controllerId, eventData)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Event data passed to triggered ability checks
 */
export interface TriggerEventData {
  readonly sourceId?: string;
  readonly sourceControllerId?: string;
  readonly targetId?: string;
  readonly targetControllerId?: string;
  readonly permanentTypes?: readonly string[];
  readonly creatureCount?: number;
  readonly landCount?: number;
  readonly artifactCount?: number;
  readonly enchantmentCount?: number;
  readonly lifeTotal?: number;
  readonly lifeLost?: number;
  readonly lifeGained?: number;
  readonly damageDealt?: number;
  readonly cardsDrawn?: number;
  readonly spellType?: string;
  readonly isYourTurn?: boolean;
  readonly isOpponentsTurn?: boolean;
  readonly creatureTypes?: readonly string[];
  readonly colors?: readonly string[];
  readonly controlledCreatures?: readonly string[];
  readonly controlledPermanents?: readonly string[];
  readonly graveyard?: readonly string[];
  readonly hand?: readonly string[];
  readonly battlefield?: readonly { id: string; types?: string[]; controllerId?: string }[];
}

/**
 * Evaluate a trigger condition string against the event data
 * 
 * Supports common condition patterns:
 * - "you" - triggers only for controller
 * - "opponent" - triggers only for opponents
 * - "if you control a creature" - checks creature presence
 * - "if you control X or more creatures" - checks creature count
 * - "if an opponent controls a creature" - opponent check
 * - "if your life total is X or less" - life total check
 * - "if a creature you control has power X or greater" - power check
 */
export function evaluateTriggerCondition(
  condition: string,
  controllerId: string,
  eventData?: TriggerEventData
): boolean {
  if (!condition || !eventData) {
    return true; // No condition to check or no data - allow trigger
  }
  
  const conditionLower = condition.toLowerCase().trim();
  
  // Controller filter checks
  if (conditionLower === 'you' || conditionLower === 'your') {
    return eventData.sourceControllerId === controllerId;
  }
  
  if (conditionLower === 'opponent' || conditionLower === 'an opponent') {
    return eventData.sourceControllerId !== undefined && 
           eventData.sourceControllerId !== controllerId;
  }
  
  if (conditionLower === 'each') {
    return true; // Triggers for everyone
  }
  
  // "if you control" checks
  if (conditionLower.includes('if you control')) {
    return evaluateControlCondition(conditionLower, controllerId, eventData);
  }
  
  // "if an opponent controls" checks
  if (conditionLower.includes('if an opponent controls')) {
    return evaluateOpponentControlCondition(conditionLower, controllerId, eventData);
  }
  
  // Life total checks
  if (conditionLower.includes('life total')) {
    return evaluateLifeTotalCondition(conditionLower, eventData);
  }
  
  // Graveyard checks
  if (conditionLower.includes('graveyard')) {
    return evaluateGraveyardCondition(conditionLower, eventData);
  }
  
  // Hand size checks
  if (conditionLower.includes('cards in hand')) {
    return evaluateHandCondition(conditionLower, eventData);
  }
  
  // Turn checks
  if (conditionLower.includes('your turn')) {
    return eventData.isYourTurn === true;
  }
  
  if (conditionLower.includes("opponent's turn") || conditionLower.includes('opponents turn')) {
    return eventData.isOpponentsTurn === true;
  }
  
  // Default: allow the trigger (unknown condition patterns)
  return true;
}

/**
 * Evaluate "if you control X" conditions
 */
function evaluateControlCondition(
  condition: string,
  controllerId: string,
  eventData: TriggerEventData
): boolean {
  // Count controlled permanents by type
  const controlledByPlayer = (eventData.battlefield || []).filter(
    p => p.controllerId === controllerId
  );
  
  // "if you control a creature"
  if (condition.includes('a creature') || condition.includes('creature')) {
    const creatures = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'creature')
    );
    
    // Check for count requirements ("X or more creatures")
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+creatures?/);
    if (countMatch) {
      return creatures.length >= parseInt(countMatch[1], 10);
    }
    
    return creatures.length > 0;
  }
  
  // "if you control an artifact"
  if (condition.includes('an artifact') || condition.includes('artifact')) {
    const artifacts = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'artifact')
    );
    
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+artifacts?/);
    if (countMatch) {
      return artifacts.length >= parseInt(countMatch[1], 10);
    }
    
    return artifacts.length > 0;
  }
  
  // "if you control an enchantment"
  if (condition.includes('an enchantment') || condition.includes('enchantment')) {
    const enchantments = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'enchantment')
    );
    
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+enchantments?/);
    if (countMatch) {
      return enchantments.length >= parseInt(countMatch[1], 10);
    }
    
    return enchantments.length > 0;
  }
  
  // "if you control X or more permanents"
  if (condition.includes('permanent')) {
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+permanents?/);
    if (countMatch) {
      return controlledByPlayer.length >= parseInt(countMatch[1], 10);
    }
    return controlledByPlayer.length > 0;
  }
  
  return true;
}

/**
 * Evaluate "if an opponent controls X" conditions
 */
function evaluateOpponentControlCondition(
  condition: string,
  controllerId: string,
  eventData: TriggerEventData
): boolean {
  // Get opponent-controlled permanents
  const opponentPermanents = (eventData.battlefield || []).filter(
    p => p.controllerId !== controllerId && p.controllerId !== undefined
  );
  
  if (condition.includes('creature')) {
    const creatures = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'creature')
    );
    return creatures.length > 0;
  }
  
  if (condition.includes('artifact')) {
    const artifacts = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'artifact')
    );
    return artifacts.length > 0;
  }
  
  return opponentPermanents.length > 0;
}

/**
 * Evaluate life total conditions
 */
function evaluateLifeTotalCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  if (eventData.lifeTotal === undefined) return true;
  
  // "life total is X or less"
  const lessMatch = condition.match(/life\s+total\s+is\s+(\d+)\s+or\s+less/);
  if (lessMatch) {
    return eventData.lifeTotal <= parseInt(lessMatch[1], 10);
  }
  
  // "life total is X or greater"
  const greaterMatch = condition.match(/life\s+total\s+is\s+(\d+)\s+or\s+greater/);
  if (greaterMatch) {
    return eventData.lifeTotal >= parseInt(greaterMatch[1], 10);
  }
  
  return true;
}

/**
 * Evaluate graveyard conditions
 */
function evaluateGraveyardCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  const graveyardSize = eventData.graveyard?.length || 0;
  
  // "X or more cards in your graveyard"
  const countMatch = condition.match(/(\d+)\s+or\s+more\s+cards?\s+in/);
  if (countMatch) {
    return graveyardSize >= parseInt(countMatch[1], 10);
  }
  
  // "a creature card in your graveyard"
  if (condition.includes('creature card')) {
    // Would need type info in graveyard data
    return graveyardSize > 0;
  }
  
  return true;
}

/**
 * Evaluate hand size conditions
 */
function evaluateHandCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  const handSize = eventData.hand?.length || 0;
  
  // "X or more cards in hand"
  const moreMatch = condition.match(/(\d+)\s+or\s+more\s+cards\s+in\s+hand/);
  if (moreMatch) {
    return handSize >= parseInt(moreMatch[1], 10);
  }
  
  // "X or fewer cards in hand"
  const fewerMatch = condition.match(/(\d+)\s+or\s+fewer\s+cards\s+in\s+hand/);
  if (fewerMatch) {
    return handSize <= parseInt(fewerMatch[1], 10);
  }
  
  // "no cards in hand"
  if (condition.includes('no cards in hand')) {
    return handSize === 0;
  }
  
  return true;
}

/**
 * Find all abilities that trigger from an event
 */
export function findTriggeringAbilities(
  abilities: readonly TriggeredAbility[],
  event: TriggerEvent,
  eventData?: TriggerEventData
): TriggeredAbility[] {
  return abilities.filter(ability => checkTrigger(ability, event, eventData));
}

/**
 * Process an event and create trigger instances
 */
export function processEvent(
  event: TriggerEvent,
  abilities: readonly TriggeredAbility[],
  eventData?: TriggerEventData
): TriggerInstance[] {
  const triggeredAbilities = findTriggeringAbilities(abilities, event, eventData);
  const timestamp = Date.now();
  
  return triggeredAbilities.map(ability =>
    createTriggerInstance(ability, timestamp)
  );
}

/**
 * Common triggered ability templates
 */

/**
 * Enter the battlefield trigger
 */
export function createETBTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  targets?: string[]
): TriggeredAbility {
  return {
    id: `${sourceId}-etb`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.ENTERS_BATTLEFIELD,
    effect,
    targets,
  };
}

/**
 * Dies trigger
 */
export function createDiesTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-dies`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.DIES,
    effect,
  };
}

/**
 * Beginning of upkeep trigger
 */
export function createUpkeepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-upkeep`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.AT,
    event: TriggerEvent.BEGINNING_OF_UPKEEP,
    effect,
  };
}

/**
 * Attacks trigger
 */
export function createAttacksTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-attacks`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.ATTACKS,
    effect,
  };
}

/**
 * Beginning of end step trigger
 */
export function createEndStepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-end-step`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.AT,
    event: TriggerEvent.BEGINNING_OF_END_STEP,
    effect,
  };
}

/**
 * Landfall trigger
 */
export function createLandfallTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-landfall`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.LANDFALL,
    effect,
  };
}

/**
 * Combat damage to player trigger
 */
export function createCombatDamageToPlayerTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-combat-damage-player`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
    effect,
  };
}

/**
 * Spell cast trigger
 */
export function createSpellCastTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  filter?: { cardType?: string; controller?: 'you' | 'opponent' | 'any' }
): TriggeredAbility {
  let event = TriggerEvent.SPELL_CAST;
  if (filter?.cardType === 'creature') {
    event = TriggerEvent.CREATURE_SPELL_CAST;
  } else if (filter?.cardType === 'noncreature') {
    event = TriggerEvent.NONCREATURE_SPELL_CAST;
  } else if (filter?.cardType === 'instant' || filter?.cardType === 'sorcery') {
    event = TriggerEvent.INSTANT_OR_SORCERY_CAST;
  }
  
  return {
    id: `${sourceId}-spell-cast`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
    condition: filter?.controller,
  };
}

/**
 * Life gain trigger
 */
export function createLifeGainTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-life-gain`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.GAINED_LIFE,
    effect,
  };
}

/**
 * Sacrifice trigger
 */
export function createSacrificeTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  filter?: { permanentType?: string }
): TriggeredAbility {
  let event = TriggerEvent.SACRIFICED;
  if (filter?.permanentType === 'creature') {
    event = TriggerEvent.CREATURE_SACRIFICED;
  } else if (filter?.permanentType === 'artifact') {
    event = TriggerEvent.ARTIFACT_SACRIFICED;
  }
  
  return {
    id: `${sourceId}-sacrifice`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
  };
}

/**
 * Parsed trigger information from oracle text
 */
export interface ParsedTrigger {
  readonly keyword: TriggerKeyword;
  readonly event: TriggerEvent;
  readonly condition?: string;
  readonly effect: string;
  readonly optional: boolean;
  readonly selfTrigger: boolean;
  readonly interveningIf?: string;
}

/**
 * Parse triggered abilities from oracle text
 * Returns all triggers found in the text
 */
export function parseTriggeredAbilitiesFromText(
  oracleText: string,
  permanentId: string,
  controllerId: string,
  cardName: string
): TriggeredAbility[] {
  const abilities: TriggeredAbility[] = [];
  const text = oracleText.toLowerCase();
  
  // Pattern for triggered abilities
  // Matches: "When/Whenever/At the beginning of [event], [effect]"
  const triggerPattern = /\b(when(?:ever)?|at(?:\s+the\s+beginning\s+of)?)\s+([^,]+),\s*([^.]+\.?)/gi;
  
  let match;
  let index = 0;
  
  while ((match = triggerPattern.exec(text)) !== null) {
    const keyword = match[1].toLowerCase().startsWith('at') 
      ? TriggerKeyword.AT 
      : match[1].toLowerCase() === 'whenever' 
        ? TriggerKeyword.WHENEVER 
        : TriggerKeyword.WHEN;
    
    const triggerCondition = match[2].trim();
    const effect = match[3].trim();
    
    // Detect the event type from the trigger condition
    const eventInfo = detectEventFromCondition(triggerCondition);
    
    // Check for optional triggers ("you may")
    const optional = effect.includes('you may') || effect.includes('may have');
    
    // Check for intervening-if clause
    const interveningIf = triggerCondition.includes(' if ') 
      ? triggerCondition.split(' if ')[1] 
      : undefined;
    
    // Check if this is a self-trigger
    const selfTrigger = triggerCondition.includes('this creature') ||
                        triggerCondition.includes('this permanent') ||
                        triggerCondition.includes(`${cardName.toLowerCase()}`);
    
    abilities.push({
      id: `${permanentId}-trigger-${index}`,
      sourceId: permanentId,
      sourceName: cardName,
      controllerId,
      keyword,
      event: eventInfo.event,
      condition: eventInfo.filter || interveningIf,
      effect,
      optional,
    });
    
    index++;
  }
  
  return abilities;
}

/**
 * Detect the event type from a trigger condition string
 */
function detectEventFromCondition(condition: string): { event: TriggerEvent; filter?: string } {
  const text = condition.toLowerCase();
  
  // ETB triggers
  if (text.includes('enters the battlefield') || text.includes('enters')) {
    if (text.includes('a land') || text.includes('land you control')) {
      return { event: TriggerEvent.LANDFALL };
    }
    return { event: TriggerEvent.ENTERS_BATTLEFIELD };
  }
  
  // Death triggers
  if (text.includes('dies') || text.includes('is put into a graveyard from the battlefield')) {
    if (text.includes('another creature') || text.includes('a creature you control')) {
      return { event: TriggerEvent.CONTROLLED_CREATURE_DIED };
    }
    return { event: TriggerEvent.DIES };
  }
  
  // Combat triggers
  if (text.includes('attacks')) {
    if (text.includes('attacks alone')) {
      return { event: TriggerEvent.ATTACKS_ALONE };
    }
    return { event: TriggerEvent.ATTACKS };
  }
  
  if (text.includes('blocks')) {
    return { event: TriggerEvent.BLOCKS };
  }
  
  if (text.includes('becomes blocked')) {
    return { event: TriggerEvent.BECOMES_BLOCKED };
  }
  
  if (text.includes('deals combat damage to a player') || 
      text.includes('deals combat damage to an opponent')) {
    return { event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER };
  }
  
  if (text.includes('deals combat damage')) {
    return { event: TriggerEvent.DEALS_COMBAT_DAMAGE };
  }
  
  if (text.includes('deals damage')) {
    return { event: TriggerEvent.DEALS_DAMAGE };
  }
  
  // Turn structure triggers
  if (text.includes('beginning of your upkeep') || text.includes('your upkeep')) {
    return { event: TriggerEvent.BEGINNING_OF_UPKEEP, filter: 'your' };
  }
  
  if (text.includes('beginning of each upkeep') || text.includes('each player\'s upkeep')) {
    return { event: TriggerEvent.BEGINNING_OF_UPKEEP, filter: 'each' };
  }
  
  if (text.includes('upkeep')) {
    return { event: TriggerEvent.BEGINNING_OF_UPKEEP };
  }
  
  if (text.includes('beginning of combat') || text.includes('combat on your turn')) {
    return { event: TriggerEvent.BEGINNING_OF_COMBAT };
  }
  
  if (text.includes('end step') || text.includes('end of turn') || text.includes('your end step')) {
    return { event: TriggerEvent.BEGINNING_OF_END_STEP };
  }
  
  if (text.includes('end of combat')) {
    return { event: TriggerEvent.END_OF_COMBAT };
  }
  
  // Spell cast triggers
  if (text.includes('casts a spell') || text.includes('you cast')) {
    if (text.includes('creature spell')) {
      return { event: TriggerEvent.CREATURE_SPELL_CAST };
    }
    if (text.includes('noncreature spell')) {
      return { event: TriggerEvent.NONCREATURE_SPELL_CAST };
    }
    if (text.includes('instant') || text.includes('sorcery')) {
      return { event: TriggerEvent.INSTANT_OR_SORCERY_CAST };
    }
    return { event: TriggerEvent.SPELL_CAST };
  }
  
  // Draw triggers
  if (text.includes('draws a card') || text.includes('draw a card')) {
    return { event: TriggerEvent.DRAWN };
  }
  
  // Discard triggers
  if (text.includes('discards a card') || text.includes('discard a card')) {
    return { event: TriggerEvent.DISCARDED };
  }
  
  // Life triggers
  if (text.includes('gains life') || text.includes('gain life')) {
    return { event: TriggerEvent.GAINED_LIFE };
  }
  
  if (text.includes('loses life') || text.includes('lose life')) {
    return { event: TriggerEvent.LOST_LIFE };
  }
  
  // Sacrifice triggers
  if (text.includes('sacrifice')) {
    if (text.includes('creature')) {
      return { event: TriggerEvent.CREATURE_SACRIFICED };
    }
    if (text.includes('artifact')) {
      return { event: TriggerEvent.ARTIFACT_SACRIFICED };
    }
    return { event: TriggerEvent.SACRIFICED };
  }
  
  // Tapped/untapped triggers
  if (text.includes('becomes tapped') || text.includes('taps')) {
    return { event: TriggerEvent.BECOMES_TAPPED };
  }
  
  if (text.includes('becomes untapped') || text.includes('untaps')) {
    return { event: TriggerEvent.BECOMES_UNTAPPED };
  }
  
  // Counter triggers
  if (text.includes('counter') && text.includes('placed')) {
    return { event: TriggerEvent.COUNTER_PLACED };
  }
  
  if (text.includes('counter') && text.includes('removed')) {
    return { event: TriggerEvent.COUNTER_REMOVED };
  }
  
  // Token triggers
  if (text.includes('token') && (text.includes('created') || text.includes('enters'))) {
    return { event: TriggerEvent.TOKEN_CREATED };
  }
  
  // Exile triggers
  if (text.includes('exiled') || text.includes('is exiled')) {
    return { event: TriggerEvent.EXILED };
  }
  
  // Target triggers
  if (text.includes('becomes the target') || text.includes('is targeted')) {
    return { event: TriggerEvent.TARGETED };
  }
  
  // Leaves/left battlefield triggers
  if (text.includes('leaves the battlefield') || text.includes('left the battlefield')) {
    return { event: TriggerEvent.LEAVES_BATTLEFIELD };
  }
  
  // Return to hand triggers
  if (text.includes('returned to') && text.includes('hand')) {
    return { event: TriggerEvent.RETURNED_TO_HAND };
  }
  
  // Generic ETB trigger if "enters" is in the text
  if (text.includes('enters')) {
    return { event: TriggerEvent.ENTERS_BATTLEFIELD };
  }
  
  // For unrecognized patterns, return a custom event to avoid false matches
  // Callers should handle CUSTOM events appropriately
  return { event: TriggerEvent.ENTERS_BATTLEFIELD, filter: 'unknown_trigger_pattern' };
}

/**
 * Check if an event matches any of multiple trigger events
 * (for compound triggers like "whenever ~ attacks or blocks")
 */
export function checkMultipleTriggers(
  events: TriggerEvent[],
  currentEvent: TriggerEvent
): boolean {
  return events.includes(currentEvent);
}

/**
 * Create a compound trigger that fires on multiple events
 */
export function createCompoundTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  events: TriggerEvent[],
  effect: string
): TriggeredAbility[] {
  return events.map((event, index) => ({
    id: `${sourceId}-compound-${index}`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
  }));
}
