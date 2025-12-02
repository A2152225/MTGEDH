/**
 * phaseTransitionTriggers.ts
 * 
 * Comprehensive trigger wiring for phase/step transitions.
 * Ensures the game loop properly detects and places triggers on the stack
 * at each phase transition, and that steps do not advance until the stack is empty.
 * 
 * Based on MagicCompRules 20251114.txt:
 * - Rule 500.2: Phase/step ends when stack is empty and all players pass
 * - Rule 502: Untap Step
 * - Rule 503: Upkeep Step  
 * - Rule 504: Draw Step
 * - Rule 506-511: Combat Phase steps
 * - Rule 513: End Step
 * - Rule 514: Cleanup Step
 * - Rule 603: Handling Triggered Abilities
 * - Rule 703: Turn-Based Actions
 */

import type { TriggerEvent, TriggeredAbility, TriggerInstance, TriggerQueue } from './triggeredAbilities';
import { 
  createTriggerInstance, 
  queueTrigger, 
  createEmptyTriggerQueue,
  processEvent,
  TriggerEvent as TE,
  findTriggeringAbilities 
} from './triggeredAbilities';
import { 
  checkDelayedTriggers,
  processDelayedTriggers,
  type DelayedTriggerRegistry 
} from './delayedTriggeredAbilities';
import type { Stack } from './stackOperations';
import { isStackEmpty } from './stackOperations';

/**
 * Phase/step types for trigger checking
 */
export enum PhaseStep {
  UNTAP = 'untap',
  UPKEEP = 'upkeep',
  DRAW = 'draw',
  PRECOMBAT_MAIN = 'precombat_main',
  BEGINNING_OF_COMBAT = 'beginning_of_combat',
  DECLARE_ATTACKERS = 'declare_attackers',
  DECLARE_BLOCKERS = 'declare_blockers',
  COMBAT_DAMAGE = 'combat_damage',
  END_OF_COMBAT = 'end_of_combat',
  POSTCOMBAT_MAIN = 'postcombat_main',
  END_STEP = 'end_step',
  CLEANUP = 'cleanup',
}

/**
 * Result of checking phase transition readiness
 */
export interface PhaseTransitionCheck {
  /** Can advance to next step/phase */
  readonly canAdvance: boolean;
  /** Reason if cannot advance */
  readonly reason?: string;
  /** Triggers that need to be placed on stack first */
  readonly pendingTriggers: readonly TriggerInstance[];
  /** Is the stack currently empty */
  readonly stackEmpty: boolean;
  /** Are there any pending actions that must complete first */
  readonly hasPendingActions: boolean;
}

/**
 * Context for trigger detection at phase transitions
 */
export interface PhaseTransitionContext {
  readonly currentStep: PhaseStep;
  readonly activePlayerId: string;
  readonly turnNumber: number;
  readonly stack: Stack;
  readonly abilities: readonly TriggeredAbility[];
  readonly delayedTriggerRegistry?: DelayedTriggerRegistry;
  readonly permanentStates?: readonly PermanentState[];
  readonly playerStates?: readonly PlayerState[];
}

/**
 * Permanent state for trigger context
 */
export interface PermanentState {
  readonly id: string;
  readonly name: string;
  readonly controllerId: string;
  readonly tapped: boolean;
  readonly doesntUntap?: boolean;
  readonly types: readonly string[];
  readonly counters?: Record<string, number>;
  readonly markedDamage?: number;
}

/**
 * Player state for trigger context
 */
export interface PlayerState {
  readonly id: string;
  readonly handSize: number;
  readonly maxHandSize: number;
  readonly lifeTotal: number;
}

/**
 * Mapping of phase steps to their trigger events
 */
const STEP_TRIGGER_EVENTS: Record<PhaseStep, TriggerEvent | null> = {
  [PhaseStep.UNTAP]: null, // Untap has no trigger event (no priority)
  [PhaseStep.UPKEEP]: TE.BEGINNING_OF_UPKEEP,
  [PhaseStep.DRAW]: TE.BEGINNING_OF_DRAW_STEP,
  [PhaseStep.PRECOMBAT_MAIN]: TE.BEGINNING_OF_PRECOMBAT_MAIN,
  [PhaseStep.BEGINNING_OF_COMBAT]: TE.BEGINNING_OF_COMBAT,
  [PhaseStep.DECLARE_ATTACKERS]: TE.BEGINNING_OF_DECLARE_ATTACKERS,
  [PhaseStep.DECLARE_BLOCKERS]: TE.BEGINNING_OF_DECLARE_BLOCKERS,
  [PhaseStep.COMBAT_DAMAGE]: TE.COMBAT_DAMAGE_STEP,
  [PhaseStep.END_OF_COMBAT]: TE.END_OF_COMBAT,
  [PhaseStep.POSTCOMBAT_MAIN]: TE.BEGINNING_OF_POSTCOMBAT_MAIN,
  [PhaseStep.END_STEP]: TE.BEGINNING_OF_END_STEP,
  [PhaseStep.CLEANUP]: TE.CLEANUP_STEP,
};

/**
 * Delayed trigger event types for each step
 */
const DELAYED_TRIGGER_EVENTS: Record<PhaseStep, 'end_step' | 'upkeep' | 'combat_end' | 'combat_begin' | 'cleanup' | 'turn_start' | null> = {
  [PhaseStep.UNTAP]: null,
  [PhaseStep.UPKEEP]: 'upkeep',
  [PhaseStep.DRAW]: null,
  [PhaseStep.PRECOMBAT_MAIN]: null,
  [PhaseStep.BEGINNING_OF_COMBAT]: 'combat_begin',
  [PhaseStep.DECLARE_ATTACKERS]: null,
  [PhaseStep.DECLARE_BLOCKERS]: null,
  [PhaseStep.COMBAT_DAMAGE]: null,
  [PhaseStep.END_OF_COMBAT]: 'combat_end',
  [PhaseStep.POSTCOMBAT_MAIN]: null,
  [PhaseStep.END_STEP]: 'end_step',
  [PhaseStep.CLEANUP]: 'cleanup',
};

/**
 * Rule 500.2: Check if a step/phase can advance
 * 
 * A step/phase ends only when:
 * 1. The stack is empty
 * 2. All players have passed priority in succession
 * 3. All triggers for this step have been placed on the stack
 * 
 * @param context - Current game state context
 * @returns PhaseTransitionCheck indicating if advancement is possible
 */
export function canAdvancePhase(context: PhaseTransitionContext): PhaseTransitionCheck {
  const { stack, currentStep, abilities, activePlayerId, delayedTriggerRegistry, turnNumber } = context;
  
  // Check if stack is empty
  const stackEmpty = isStackEmpty(stack);
  if (!stackEmpty) {
    return {
      canAdvance: false,
      reason: 'Stack must be empty before advancing to next step/phase',
      pendingTriggers: [],
      stackEmpty: false,
      hasPendingActions: true,
    };
  }
  
  // Collect all triggers that should fire at this step transition
  const pendingTriggers: TriggerInstance[] = [];
  const timestamp = Date.now();
  
  // 1. Check for regular triggered abilities for this step
  const triggerEvent = STEP_TRIGGER_EVENTS[currentStep];
  if (triggerEvent !== null) {
    const eventData = {
      isYourTurn: true, // Context would provide this
      sourceControllerId: activePlayerId,
    };
    
    const triggeredAbilities = findTriggeringAbilities(abilities, triggerEvent, eventData);
    for (const ability of triggeredAbilities) {
      pendingTriggers.push(createTriggerInstance(ability, timestamp));
    }
  }
  
  // 2. Check for delayed triggers
  if (delayedTriggerRegistry) {
    const delayedEventType = DELAYED_TRIGGER_EVENTS[currentStep];
    if (delayedEventType) {
      const delayedCheck = checkDelayedTriggers(delayedTriggerRegistry, {
        type: delayedEventType,
        activePlayerId,
        currentTurn: turnNumber,
      });
      
      const delayedInstances = processDelayedTriggers(delayedCheck.triggersToFire, timestamp);
      pendingTriggers.push(...delayedInstances);
    }
  }
  
  // If there are pending triggers, they must be placed on stack first
  if (pendingTriggers.length > 0) {
    return {
      canAdvance: false,
      reason: `${pendingTriggers.length} trigger(s) must be placed on stack`,
      pendingTriggers,
      stackEmpty: true,
      hasPendingActions: true,
    };
  }
  
  // All conditions met - can advance
  return {
    canAdvance: true,
    pendingTriggers: [],
    stackEmpty: true,
    hasPendingActions: false,
  };
}

/**
 * Collect all triggers for a specific step beginning
 */
export function collectStepTriggers(
  step: PhaseStep,
  abilities: readonly TriggeredAbility[],
  activePlayerId: string,
  delayedTriggerRegistry?: DelayedTriggerRegistry,
  turnNumber: number = 1
): {
  triggers: readonly TriggerInstance[];
  updatedDelayedRegistry?: DelayedTriggerRegistry;
  log: string[];
} {
  const triggers: TriggerInstance[] = [];
  const log: string[] = [];
  const timestamp = Date.now();
  
  // Get the trigger event for this step
  const triggerEvent = STEP_TRIGGER_EVENTS[step];
  
  if (triggerEvent !== null) {
    const eventData = {
      isYourTurn: true,
      sourceControllerId: activePlayerId,
    };
    
    const triggeredAbilities = findTriggeringAbilities(abilities, triggerEvent, eventData);
    
    for (const ability of triggeredAbilities) {
      const instance = createTriggerInstance(ability, timestamp);
      triggers.push(instance);
      log.push(`${ability.sourceName} triggers at beginning of ${step}`);
    }
  }
  
  // Check delayed triggers
  let updatedDelayedRegistry = delayedTriggerRegistry;
  if (delayedTriggerRegistry) {
    const delayedEventType = DELAYED_TRIGGER_EVENTS[step];
    if (delayedEventType) {
      const delayedCheck = checkDelayedTriggers(delayedTriggerRegistry, {
        type: delayedEventType,
        activePlayerId,
        currentTurn: turnNumber,
      });
      
      const delayedInstances = processDelayedTriggers(delayedCheck.triggersToFire, timestamp);
      triggers.push(...delayedInstances);
      
      for (const delayed of delayedCheck.triggersToFire) {
        log.push(`Delayed trigger fires: ${delayed.sourceName}`);
      }
      
      updatedDelayedRegistry = {
        triggers: delayedCheck.remainingTriggers,
        firedTriggerIds: [
          ...delayedTriggerRegistry.firedTriggerIds,
          ...delayedCheck.triggersToFire.map(t => t.id),
        ],
      };
    }
  }
  
  return {
    triggers,
    updatedDelayedRegistry,
    log,
  };
}

/**
 * Untap step specific checks
 * Rule 502: Untap step
 * - No priority in untap step
 * - Permanents untap (unless "doesn't untap" effects apply)
 * - Phasing happens first
 */
export interface UntapStepResult {
  readonly untappedPermanents: readonly string[];
  readonly permanentsNotUntapped: readonly { id: string; reason: string }[];
  readonly phasingChanges: readonly { id: string; phasedIn: boolean }[];
  readonly log: readonly string[];
}

export function processUntapStep(
  permanents: readonly PermanentState[],
  activePlayerId: string
): UntapStepResult {
  const untappedPermanents: string[] = [];
  const permanentsNotUntapped: { id: string; reason: string }[] = [];
  const phasingChanges: { id: string; phasedIn: boolean }[] = [];
  const log: string[] = [];
  
  log.push('Untap step begins');
  
  for (const permanent of permanents) {
    // Only active player's permanents untap
    if (permanent.controllerId !== activePlayerId) {
      continue;
    }
    
    if (permanent.tapped) {
      if (permanent.doesntUntap) {
        permanentsNotUntapped.push({
          id: permanent.id,
          reason: "Doesn't untap during untap step",
        });
        log.push(`${permanent.name} doesn't untap`);
      } else {
        untappedPermanents.push(permanent.id);
        log.push(`${permanent.name} untaps`);
      }
    }
  }
  
  log.push(`Untapped ${untappedPermanents.length} permanent(s)`);
  
  return {
    untappedPermanents,
    permanentsNotUntapped,
    phasingChanges,
    log,
  };
}

/**
 * Upkeep step trigger collection
 * Rule 503: Upkeep step
 * - All upkeep triggers fire
 * - Cumulative upkeep, age counters, etc.
 */
export function collectUpkeepTriggers(
  abilities: readonly TriggeredAbility[],
  activePlayerId: string,
  delayedTriggerRegistry?: DelayedTriggerRegistry,
  turnNumber: number = 1
): {
  triggers: readonly TriggerInstance[];
  cumulativeUpkeepTriggers: readonly { permanentId: string; cost: string }[];
  ageCounterTriggers: readonly { permanentId: string; counterType: string }[];
  updatedDelayedRegistry?: DelayedTriggerRegistry;
  log: string[];
} {
  const result = collectStepTriggers(
    PhaseStep.UPKEEP,
    abilities,
    activePlayerId,
    delayedTriggerRegistry,
    turnNumber
  );
  
  // Note: Cumulative upkeep and age counter triggers would be detected
  // from the abilities by checking for specific patterns in their text
  const cumulativeUpkeepTriggers: { permanentId: string; cost: string }[] = [];
  const ageCounterTriggers: { permanentId: string; counterType: string }[] = [];
  
  // Parse abilities for cumulative upkeep pattern
  for (const ability of abilities) {
    if (ability.event === TE.BEGINNING_OF_UPKEEP) {
      const effectLower = ability.effect.toLowerCase();
      
      // Detect cumulative upkeep
      if (effectLower.includes('cumulative upkeep') || effectLower.includes('age counter')) {
        const costMatch = effectLower.match(/pay (.+?) for each age counter/i);
        if (costMatch) {
          cumulativeUpkeepTriggers.push({
            permanentId: ability.sourceId,
            cost: costMatch[1],
          });
          result.log.push(`${ability.sourceName} has cumulative upkeep`);
        }
      }
      
      // Detect age counter abilities (like vanishing, fading)
      if (effectLower.includes('remove') && effectLower.includes('counter')) {
        const counterMatch = effectLower.match(/remove (?:a |an |one )?(\w+) counter/i);
        if (counterMatch) {
          ageCounterTriggers.push({
            permanentId: ability.sourceId,
            counterType: counterMatch[1],
          });
          result.log.push(`${ability.sourceName} removes ${counterMatch[1]} counter`);
        }
      }
    }
  }
  
  return {
    ...result,
    cumulativeUpkeepTriggers,
    ageCounterTriggers,
  };
}

/**
 * Draw step trigger collection
 * Rule 504: Draw step
 * - Active player draws a card (turn-based action)
 * - Draw triggers fire
 * - "Skip your draw step" effects prevent the draw
 */
export interface DrawStepResult {
  readonly shouldDraw: boolean;
  readonly skipReason?: string;
  readonly triggers: readonly TriggerInstance[];
  readonly log: string[];
}

export function collectDrawStepTriggers(
  abilities: readonly TriggeredAbility[],
  activePlayerId: string,
  hasSkipDrawEffect: boolean = false,
  skipEffectSource?: string
): DrawStepResult {
  const log: string[] = [];
  const timestamp = Date.now();
  const triggers: TriggerInstance[] = [];
  
  // Check for skip draw step effect
  if (hasSkipDrawEffect) {
    log.push(`Draw step skipped by ${skipEffectSource || 'an effect'}`);
    return {
      shouldDraw: false,
      skipReason: skipEffectSource || 'Skip draw step effect',
      triggers: [],
      log,
    };
  }
  
  log.push('Draw step begins');
  log.push(`${activePlayerId} draws a card`);
  
  // Collect draw triggers
  const eventData = {
    isYourTurn: true,
    sourceControllerId: activePlayerId,
  };
  
  const triggeredAbilities = findTriggeringAbilities(
    abilities,
    TE.BEGINNING_OF_DRAW_STEP,
    eventData
  );
  
  for (const ability of triggeredAbilities) {
    const instance = createTriggerInstance(ability, timestamp);
    triggers.push(instance);
    log.push(`${ability.sourceName} triggers at beginning of draw step`);
  }
  
  return {
    shouldDraw: true,
    triggers,
    log,
  };
}

/**
 * Combat phase trigger collection
 * Rules 506-511: Combat phase steps
 */
export interface CombatTriggerResult {
  readonly triggers: readonly TriggerInstance[];
  readonly attackTriggers: readonly TriggerInstance[];
  readonly blockTriggers: readonly TriggerInstance[];
  readonly damageTriggers: readonly TriggerInstance[];
  readonly log: string[];
}

export function collectCombatTriggers(
  step: PhaseStep.BEGINNING_OF_COMBAT | PhaseStep.DECLARE_ATTACKERS | 
        PhaseStep.DECLARE_BLOCKERS | PhaseStep.COMBAT_DAMAGE | PhaseStep.END_OF_COMBAT,
  abilities: readonly TriggeredAbility[],
  activePlayerId: string,
  attackingCreatureIds: readonly string[] = [],
  blockingCreatureIds: readonly string[] = []
): CombatTriggerResult {
  const triggers: TriggerInstance[] = [];
  const attackTriggers: TriggerInstance[] = [];
  const blockTriggers: TriggerInstance[] = [];
  const damageTriggers: TriggerInstance[] = [];
  const log: string[] = [];
  const timestamp = Date.now();
  
  // Get step-specific triggers
  const triggerEvent = STEP_TRIGGER_EVENTS[step];
  if (triggerEvent !== null) {
    const eventData = {
      isYourTurn: true,
      sourceControllerId: activePlayerId,
    };
    
    const triggeredAbilities = findTriggeringAbilities(abilities, triggerEvent, eventData);
    for (const ability of triggeredAbilities) {
      const instance = createTriggerInstance(ability, timestamp);
      triggers.push(instance);
      log.push(`${ability.sourceName} triggers at ${step}`);
    }
  }
  
  // Collect attack triggers (for declare attackers step)
  if (step === PhaseStep.DECLARE_ATTACKERS && attackingCreatureIds.length > 0) {
    const attackEventData = {
      isYourTurn: true,
      sourceControllerId: activePlayerId,
    };
    
    const attackAbilities = findTriggeringAbilities(abilities, TE.ATTACKS, attackEventData);
    for (const ability of attackAbilities) {
      // Check if the ability source is one of the attacking creatures
      if (attackingCreatureIds.includes(ability.sourceId)) {
        const instance = createTriggerInstance(ability, timestamp);
        attackTriggers.push(instance);
        log.push(`${ability.sourceName} attack trigger`);
      }
    }
  }
  
  // Collect block triggers (for declare blockers step)
  if (step === PhaseStep.DECLARE_BLOCKERS && blockingCreatureIds.length > 0) {
    const blockEventData = {
      isYourTurn: true,
      sourceControllerId: activePlayerId,
    };
    
    const blockAbilities = findTriggeringAbilities(abilities, TE.BLOCKS, blockEventData);
    for (const ability of blockAbilities) {
      if (blockingCreatureIds.includes(ability.sourceId)) {
        const instance = createTriggerInstance(ability, timestamp);
        blockTriggers.push(instance);
        log.push(`${ability.sourceName} block trigger`);
      }
    }
  }
  
  return {
    triggers,
    attackTriggers,
    blockTriggers,
    damageTriggers,
    log,
  };
}

/**
 * End step trigger collection
 * Rule 513: End step
 * - End of turn triggers fire
 * - Delayed triggers for "at the beginning of the next end step"
 */
export function collectEndStepTriggers(
  abilities: readonly TriggeredAbility[],
  activePlayerId: string,
  delayedTriggerRegistry?: DelayedTriggerRegistry,
  turnNumber: number = 1
): {
  triggers: readonly TriggerInstance[];
  delayedTriggers: readonly TriggerInstance[];
  updatedDelayedRegistry?: DelayedTriggerRegistry;
  log: string[];
} {
  const result = collectStepTriggers(
    PhaseStep.END_STEP,
    abilities,
    activePlayerId,
    delayedTriggerRegistry,
    turnNumber
  );
  
  // Separate delayed triggers from regular triggers for logging
  const delayedTriggers = result.triggers.filter(t => 
    t.id.startsWith('trigger-') && t.sourceName.includes('delayed')
  );
  
  return {
    triggers: result.triggers,
    delayedTriggers,
    updatedDelayedRegistry: result.updatedDelayedRegistry,
    log: result.log,
  };
}

/**
 * Cleanup step processing
 * Rule 514: Cleanup step
 * - Damage is removed from permanents
 * - "Until end of turn" effects end
 * - Active player discards to hand size
 * - Normally no priority unless SBA or triggers
 */
export interface CleanupStepResult {
  readonly damageCleared: readonly string[];
  readonly effectsEnded: readonly string[];
  readonly discardRequired: number;
  readonly needsPriority: boolean;
  readonly pendingTriggers: readonly TriggerInstance[];
  readonly log: string[];
}

export function processCleanupStep(
  permanents: readonly PermanentState[],
  activePlayerId: string,
  playerState: PlayerState,
  abilities: readonly TriggeredAbility[],
  temporaryEffects: readonly string[] = []
): CleanupStepResult {
  const damageCleared: string[] = [];
  const effectsEnded: string[] = [];
  const log: string[] = [];
  const timestamp = Date.now();
  
  log.push('Cleanup step begins');
  
  // Clear damage from permanents
  for (const permanent of permanents) {
    if ((permanent.markedDamage || 0) > 0) {
      damageCleared.push(permanent.id);
      log.push(`Damage cleared from ${permanent.name}`);
    }
  }
  
  // End "until end of turn" effects
  for (const effect of temporaryEffects) {
    effectsEnded.push(effect);
  }
  if (effectsEnded.length > 0) {
    log.push(`${effectsEnded.length} temporary effect(s) ended`);
  }
  
  // Check for discard requirement
  const discardRequired = Math.max(0, playerState.handSize - playerState.maxHandSize);
  if (discardRequired > 0) {
    log.push(`${activePlayerId} must discard ${discardRequired} card(s) to hand size`);
  }
  
  // Check for cleanup triggers (rare but possible)
  const eventData = {
    isYourTurn: true,
    sourceControllerId: activePlayerId,
  };
  
  const triggeredAbilities = findTriggeringAbilities(abilities, TE.CLEANUP_STEP, eventData);
  const pendingTriggers: TriggerInstance[] = [];
  
  for (const ability of triggeredAbilities) {
    const instance = createTriggerInstance(ability, timestamp);
    pendingTriggers.push(instance);
    log.push(`${ability.sourceName} triggers during cleanup`);
  }
  
  // Determine if priority should be given
  // Rule 514.3: Priority is given if SBA occur or triggers go on stack
  const needsPriority = pendingTriggers.length > 0;
  if (needsPriority) {
    log.push('Priority granted during cleanup (triggers waiting)');
  }
  
  return {
    damageCleared,
    effectsEnded,
    discardRequired,
    needsPriority,
    pendingTriggers,
    log,
  };
}

/**
 * Verify that a step transition is valid
 * Ensures all required conditions are met before advancing
 */
export function verifyStepTransition(
  fromStep: PhaseStep,
  toStep: PhaseStep,
  context: PhaseTransitionContext
): {
  valid: boolean;
  reason?: string;
  requiredActions: readonly string[];
} {
  const requiredActions: string[] = [];
  
  // Check stack is empty
  if (!isStackEmpty(context.stack)) {
    return {
      valid: false,
      reason: 'Stack must be empty before step transition',
      requiredActions: ['Resolve all stack items'],
    };
  }
  
  // Check for pending triggers at current step
  const triggerCheck = canAdvancePhase(context);
  if (!triggerCheck.canAdvance) {
    return {
      valid: false,
      reason: triggerCheck.reason,
      requiredActions: [`Place ${triggerCheck.pendingTriggers.length} trigger(s) on stack`],
    };
  }
  
  // Step-specific requirements
  switch (fromStep) {
    case PhaseStep.UNTAP:
      // Untap step has no priority - can always advance after untap actions
      break;
      
    case PhaseStep.CLEANUP:
      // Cleanup may need additional cleanup steps if SBA or triggers occurred
      const cleanupResult = processCleanupStep(
        context.permanentStates || [],
        context.activePlayerId,
        context.playerStates?.[0] || { id: context.activePlayerId, handSize: 0, maxHandSize: 7, lifeTotal: 20 },
        context.abilities
      );
      
      if (cleanupResult.needsPriority) {
        requiredActions.push('Resolve cleanup triggers');
        return {
          valid: false,
          reason: 'Cleanup step has pending triggers',
          requiredActions,
        };
      }
      
      if (cleanupResult.discardRequired > 0) {
        requiredActions.push(`Discard ${cleanupResult.discardRequired} card(s)`);
        return {
          valid: false,
          reason: 'Player must discard to hand size',
          requiredActions,
        };
      }
      break;
  }
  
  return {
    valid: true,
    requiredActions: [],
  };
}

/**
 * Get all triggers that should fire when entering a step
 */
export function getStepEntryTriggers(
  step: PhaseStep,
  context: PhaseTransitionContext
): {
  triggers: readonly TriggerInstance[];
  queue: TriggerQueue;
  log: string[];
} {
  let queue = createEmptyTriggerQueue();
  const log: string[] = [];
  
  const result = collectStepTriggers(
    step,
    context.abilities,
    context.activePlayerId,
    context.delayedTriggerRegistry,
    context.turnNumber
  );
  
  // Add triggers to queue
  for (const trigger of result.triggers) {
    queue = queueTrigger(queue, trigger);
  }
  
  log.push(...result.log);
  
  if (result.triggers.length > 0) {
    log.push(`${result.triggers.length} trigger(s) queued for step ${step}`);
  }
  
  return {
    triggers: result.triggers,
    queue,
    log,
  };
}

export default {
  PhaseStep,
  canAdvancePhase,
  collectStepTriggers,
  processUntapStep,
  collectUpkeepTriggers,
  collectDrawStepTriggers,
  collectCombatTriggers,
  collectEndStepTriggers,
  processCleanupStep,
  verifyStepTransition,
  getStepEntryTriggers,
};
