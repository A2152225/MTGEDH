/**
 * Section 6: Spells, Abilities, and Effects (Rules 600+)
 * 
 * Implements rules for casting spells, activating abilities, triggered abilities,
 * resolving spells and abilities, and handling continuous effects.
 * 
 * Based on MagicCompRules 20251114.txt
 */

import { ManaCost } from './mana';
import { Cost, CostType, CompositeCost } from './costs';
import { TargetType } from './targets';

/**
 * Rule 601: Casting Spells
 * 
 * The process of casting a spell involves multiple steps that must be performed
 * in order (Rule 601.2):
 * 1. Announce spell (Rule 601.2a)
 * 2. Choose modes (Rule 601.2b)
 * 3. Choose targets (Rule 601.2c)
 * 4. Choose how the spell will be paid for (Rule 601.2f)
 * 5. Determine total cost (Rule 601.2f)
 * 6. Activate mana abilities (Rule 601.2g)
 * 7. Pay costs (Rule 601.2h)
 * 8. Spell becomes cast (Rule 601.2i)
 */

export enum CastingStep {
  ANNOUNCE = 'announce',           // Rule 601.2a
  CHOOSE_MODES = 'choose_modes',    // Rule 601.2b
  CHOOSE_TARGETS = 'choose_targets', // Rule 601.2c
  CHOOSE_PAYMENT = 'choose_payment', // Rule 601.2f
  DETERMINE_COST = 'determine_cost', // Rule 601.2f
  ACTIVATE_MANA = 'activate_mana',   // Rule 601.2g
  PAY_COSTS = 'pay_costs',          // Rule 601.2h
  SPELL_CAST = 'spell_cast'         // Rule 601.2i
}

export interface CastingProcess {
  readonly spellId: string;
  readonly controllerId: string;
  readonly currentStep: CastingStep;
  readonly modes?: readonly string[];
  readonly targets?: readonly string[];
  readonly manaCost?: ManaCost;
  readonly additionalCosts?: readonly Cost[];
  readonly totalCost?: Cost | CompositeCost;
  readonly complete: boolean;
}

/**
 * Rule 601.2: Casting steps
 */
export function createCastingProcess(spellId: string, controllerId: string): CastingProcess {
  return {
    spellId,
    controllerId,
    currentStep: CastingStep.ANNOUNCE,
    complete: false
  };
}

/**
 * Rule 601.2a: Announce the spell
 */
export function announceSpell(process: CastingProcess): CastingProcess {
  if (process.currentStep !== CastingStep.ANNOUNCE) {
    throw new Error('Cannot announce spell - wrong step');
  }
  
  return {
    ...process,
    currentStep: CastingStep.CHOOSE_MODES
  };
}

/**
 * Rule 601.2b: Choose modes if modal
 */
export function chooseModes(process: CastingProcess, modes?: readonly string[]): CastingProcess {
  if (process.currentStep !== CastingStep.CHOOSE_MODES) {
    throw new Error('Cannot choose modes - wrong step');
  }
  
  return {
    ...process,
    modes,
    currentStep: CastingStep.CHOOSE_TARGETS
  };
}

/**
 * Rule 601.2c: Choose targets
 */
export function chooseTargets(process: CastingProcess, targets?: readonly string[]): CastingProcess {
  if (process.currentStep !== CastingStep.CHOOSE_TARGETS) {
    throw new Error('Cannot choose targets - wrong step');
  }
  
  return {
    ...process,
    targets,
    currentStep: CastingStep.CHOOSE_PAYMENT
  };
}

/**
 * Rule 601.2f: Determine total cost
 */
export function determineTotalCost(
  process: CastingProcess,
  manaCost: ManaCost,
  additionalCosts?: readonly Cost[]
): CastingProcess {
  if (process.currentStep !== CastingStep.CHOOSE_PAYMENT && 
      process.currentStep !== CastingStep.DETERMINE_COST) {
    throw new Error('Cannot determine cost - wrong step');
  }
  
  // Create mana cost as a proper Cost object
  const manaCostItem: Cost = {
    type: CostType.MANA,
    description: 'Mana cost',
    isOptional: false,
    isMandatory: true
  };
  
  // Total cost includes mana cost + additional costs
  const totalCost: CompositeCost = {
    type: 'composite',
    costs: [
      manaCostItem,
      ...(additionalCosts || [])
    ],
    isAdditional: false,
    isAlternative: false
  };
  
  return {
    ...process,
    manaCost,
    additionalCosts,
    totalCost,
    currentStep: CastingStep.ACTIVATE_MANA
  };
}

/**
 * Rule 601.2h: Pay all costs
 */
export function payCosts(process: CastingProcess): CastingProcess {
  if (process.currentStep !== CastingStep.PAY_COSTS) {
    throw new Error('Cannot pay costs - wrong step');
  }
  
  return {
    ...process,
    currentStep: CastingStep.SPELL_CAST,
    complete: true
  };
}

/**
 * Rule 601.3: Illegal spell
 * A spell becomes illegal if all its targets become illegal
 */
export function isSpellIllegal(targets: readonly string[], legalTargets: readonly string[]): boolean {
  if (targets.length === 0) return false;
  
  return targets.every(target => !legalTargets.includes(target));
}

/**
 * Rule 602: Activating Activated Abilities
 * 
 * Similar to casting spells but for activated abilities (Rule 602.2):
 * 1. Announce ability (Rule 602.2a)
 * 2. Choose modes (Rule 602.2b)
 * 3. Choose targets (Rule 602.2c)
 * 4. Determine total cost (Rule 602.2e)
 * 5. Activate mana abilities (Rule 602.2f)
 * 6. Pay costs (Rule 602.2g)
 * 7. Ability is activated (Rule 602.2h)
 */

export enum ActivationStep {
  ANNOUNCE = 'announce',
  CHOOSE_MODES = 'choose_modes',
  CHOOSE_TARGETS = 'choose_targets',
  DETERMINE_COST = 'determine_cost',
  ACTIVATE_MANA = 'activate_mana',
  PAY_COSTS = 'pay_costs',
  ABILITY_ACTIVATED = 'ability_activated'
}

export interface ActivationProcess {
  readonly abilityId: string;
  readonly controllerId: string;
  readonly sourceId: string;
  readonly currentStep: ActivationStep;
  readonly modes?: readonly string[];
  readonly targets?: readonly string[];
  readonly cost?: Cost;
  readonly complete: boolean;
}

/**
 * Rule 602.2: Activation steps
 */
export function createActivationProcess(
  abilityId: string,
  controllerId: string,
  sourceId: string
): ActivationProcess {
  return {
    abilityId,
    controllerId,
    sourceId,
    currentStep: ActivationStep.ANNOUNCE,
    complete: false
  };
}

/**
 * Rule 602.5: Activated abilities with restrictions
 * Some abilities can only be activated at certain times
 */
export interface ActivationRestriction {
  readonly onlyAsSorcery?: boolean;        // "Activate only as a sorcery"
  readonly onlyDuringCombat?: boolean;     // "Activate only during combat"
  readonly onlyOnYourTurn?: boolean;       // "Activate only during your turn"
  readonly limitPerTurn?: number;          // "Activate only once each turn"
  readonly requiresTap?: boolean;          // Part of cost, but worth tracking
}

/**
 * Rule 602.5b: Check if activation restrictions are met
 */
export function canActivateWithRestrictions(
  restriction: ActivationRestriction,
  context: {
    hasPriority: boolean;
    isMainPhase: boolean;
    isOwnTurn: boolean;
    isStackEmpty: boolean;
    isCombat: boolean;
    activationsThisTurn: number;
    sourceTapped: boolean;
  }
): boolean {
  // Rule 602.5a: "Activate only as a sorcery"
  if (restriction.onlyAsSorcery) {
    if (!context.hasPriority || !context.isMainPhase || 
        !context.isOwnTurn || !context.isStackEmpty) {
      return false;
    }
  }
  
  // "Activate only during combat"
  if (restriction.onlyDuringCombat && !context.isCombat) {
    return false;
  }
  
  // "Activate only during your turn"
  if (restriction.onlyOnYourTurn && !context.isOwnTurn) {
    return false;
  }
  
  // Per-turn limit
  if (restriction.limitPerTurn !== undefined && 
      context.activationsThisTurn >= restriction.limitPerTurn) {
    return false;
  }
  
  // Tap requirement
  if (restriction.requiresTap && context.sourceTapped) {
    return false;
  }
  
  return true;
}

/**
 * Rule 603: Handling Triggered Abilities
 * 
 * Triggered abilities use words "when," "whenever," or "at" (Rule 603.1)
 */

export enum TriggerType {
  WHEN = 'when',           // One-time event
  WHENEVER = 'whenever',   // Each time event occurs
  AT = 'at'               // Beginning/end of phase/step
}

export interface TriggerCondition {
  readonly type: TriggerType;
  readonly event: string;               // e.g., "enters-the-battlefield"
  readonly filter?: string;             // e.g., "creature you control"
  readonly zone?: string;               // Where ability must be when triggered
}

export interface TriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly controllerId: string;
  readonly trigger: TriggerCondition;
  readonly effect: string;
  readonly targets?: readonly TargetType[];
  readonly intervening?: boolean;       // Rule 603.4: Intervening "if" clause
}

/**
 * Rule 603.2: When triggered ability triggers
 * Creates a trigger instance that will be put on the stack
 */
export interface TriggerInstance {
  readonly abilityId: string;
  readonly sourceId: string;
  readonly controllerId: string;
  readonly timestamp: number;
  readonly targets?: readonly string[];
  readonly hasTriggered: boolean;
  readonly onStack: boolean;
}

/**
 * Rule 603.3: Triggered ability goes on stack next time player would get priority
 */
export function createTriggerInstance(
  ability: TriggeredAbility,
  timestamp: number
): TriggerInstance {
  return {
    abilityId: ability.id,
    sourceId: ability.sourceId,
    controllerId: ability.controllerId,
    timestamp,
    hasTriggered: true,
    onStack: false
  };
}

/**
 * Rule 603.3: Put triggered abilities on stack
 * APNAP order applies (Rule 603.3b)
 */
export function putTriggersOnStack(
  triggers: readonly TriggerInstance[],
  activePlayer: string
): readonly TriggerInstance[] {
  // Sort by APNAP order, then by timestamp
  const sorted = [...triggers].sort((a, b) => {
    // Active player's triggers first
    if (a.controllerId === activePlayer && b.controllerId !== activePlayer) return -1;
    if (a.controllerId !== activePlayer && b.controllerId === activePlayer) return 1;
    
    // Then by timestamp
    return a.timestamp - b.timestamp;
  });
  
  return sorted.map(t => ({ ...t, onStack: true }));
}

/**
 * Rule 608: Resolving Spells and Abilities
 * 
 * When a spell or ability resolves from the stack (Rule 608.2)
 */

export interface ResolutionContext {
  readonly objectId: string;
  readonly controllerId: string;
  readonly targets: readonly string[];
  readonly chosenModes?: readonly string[];
  readonly isSpell: boolean;
}

/**
 * Rule 608.2: Resolution steps
 */
export enum ResolutionStep {
  CHECK_LEGALITY = 'check_legality',     // Rule 608.2b
  PERFORM_EFFECTS = 'perform_effects',   // Rule 608.2c-e
  RESOLVE_COMPLETE = 'resolve_complete'
}

export interface ResolutionProcess {
  readonly context: ResolutionContext;
  readonly currentStep: ResolutionStep;
  readonly illegal: boolean;
  readonly complete: boolean;
}

/**
 * Rule 608.2b: Check if spell/ability is illegal
 * All targets must still be legal
 */
export function checkResolutionLegality(
  context: ResolutionContext,
  legalTargets: readonly string[]
): { illegal: boolean; reason?: string } {
  if (context.targets.length === 0) {
    return { illegal: false };
  }
  
  const allTargetsIllegal = context.targets.every(
    target => !legalTargets.includes(target)
  );
  
  if (allTargetsIllegal) {
    return { 
      illegal: true, 
      reason: 'All targets are illegal' 
    };
  }
  
  return { illegal: false };
}

/**
 * Rule 608.2g: Spell goes to appropriate zone after resolving
 * - Instant/Sorcery -> graveyard
 * - Permanent spell -> battlefield
 * - Ability -> ceases to exist
 */
export function getDestinationAfterResolution(
  isSpell: boolean,
  isPermanent: boolean
): 'graveyard' | 'battlefield' | 'ceases' {
  if (!isSpell) return 'ceases'; // Abilities
  if (isPermanent) return 'battlefield';
  return 'graveyard'; // Instant/Sorcery
}

/**
 * Rule 611: Continuous Effects
 * 
 * Continuous effects modify characteristics or change control (Rule 611.1)
 */

export enum EffectDuration {
  CONTINUOUS = 'continuous',           // Static ability
  UNTIL_END_OF_TURN = 'until_eot',    // "until end of turn"
  UNTIL_END_OF_COMBAT = 'until_eoc',  // "until end of combat"
  AS_LONG_AS = 'as_long_as',          // "as long as [condition]"
  PERMANENT = 'permanent'              // Counters, etc.
}

export interface ContinuousEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly duration: EffectDuration;
  readonly layer: number;               // Rule 613: Layer system
  readonly affectedObjects: readonly string[];
  readonly modification: string;        // Text description
  readonly timestamp: number;
}

/**
 * Rule 611.2: Continuous effect can be generated by:
 * - Static abilities
 * - Resolution of spells/abilities
 * - Application of characteristic-defining abilities
 */
export function createContinuousEffect(
  sourceId: string,
  duration: EffectDuration,
  layer: number,
  modification: string,
  timestamp: number,
  affectedObjects: readonly string[] = []
): ContinuousEffect {
  return {
    id: `${sourceId}-${timestamp}`,
    sourceId,
    duration,
    layer,
    affectedObjects,
    modification,
    timestamp
  };
}

/**
 * Rule 611.3: Continuous effect expires based on duration
 */
export function hasEffectExpired(
  effect: ContinuousEffect,
  context: {
    isEndOfTurn: boolean;
    isEndOfCombat: boolean;
    conditionMet: boolean;
  }
): boolean {
  switch (effect.duration) {
    case EffectDuration.UNTIL_END_OF_TURN:
      return context.isEndOfTurn;
    
    case EffectDuration.UNTIL_END_OF_COMBAT:
      return context.isEndOfCombat;
    
    case EffectDuration.AS_LONG_AS:
      return !context.conditionMet;
    
    case EffectDuration.CONTINUOUS:
    case EffectDuration.PERMANENT:
      return false;
    
    default:
      return false;
  }
}

/**
 * Rule 613: Interaction of Continuous Effects
 * 
 * Continuous effects are applied in layer order (Rule 613.1)
 * Seven layers exist for determining object characteristics
 */

export enum Layer {
  COPY_EFFECTS = 1,              // Rule 613.1a
  CONTROL_EFFECTS = 2,           // Rule 613.1b
  TEXT_CHANGING_EFFECTS = 3,     // Rule 613.1c
  TYPE_CHANGING_EFFECTS = 4,     // Rule 613.1d
  COLOR_CHANGING_EFFECTS = 5,    // Rule 613.1e
  ABILITY_EFFECTS = 6,           // Rule 613.1f
  POWER_TOUGHNESS_EFFECTS = 7    // Rule 613.1g
}

/**
 * Rule 613.1g: Power/toughness layer has sublayers
 */
export enum PTSublayer {
  CHARACTERISTIC_DEFINING = 'a',  // Rule 613.1ga
  SET_TO_VALUE = 'b',             // Rule 613.1gb
  MODIFY = 'c',                   // Rule 613.1gc
  COUNTERS = 'd',                 // Rule 613.1gd
  SWITCH = 'e'                    // Rule 613.1ge
}

/**
 * Rule 614: Replacement Effects
 * 
 * Replacement effects use "instead" or modify how events occur (Rule 614.1)
 */

export enum ReplacementType {
  INSTEAD = 'instead',            // "...instead..."
  ENTERS = 'enters',              // "enters the battlefield"
  AS = 'as',                      // "as [this] enters"
  SKIP = 'skip',                  // "skip [event]"
  IF_WOULD = 'if_would'          // "if [event] would..."
}

export interface ReplacementEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly type: ReplacementType;
  readonly event: string;              // What event is being replaced
  readonly replacement: string;        // How it's replaced
  readonly self: boolean;              // Rule 614.12: Self-replacement
}

/**
 * Rule 614.1: Replacement effect watches for particular event
 * and replaces it with different event
 */
export function createReplacementEffect(
  sourceId: string,
  type: ReplacementType,
  event: string,
  replacement: string,
  self: boolean = false
): ReplacementEffect {
  return {
    id: `${sourceId}-replacement`,
    sourceId,
    type,
    event,
    replacement,
    self
  };
}

/**
 * Rule 614.5: Enters-the-battlefield replacement effect
 * "enters the battlefield tapped" or "with counters"
 */
export interface ETBReplacement {
  readonly tapped?: boolean;
  readonly counters?: Map<string, number>;
  readonly chooseColor?: boolean;
  readonly other?: string;
}

/**
 * Rule 614.12: Self-replacement effects
 * Apply before other replacement effects to same event
 */
export function applySelfReplacementFirst(
  effects: readonly ReplacementEffect[],
  eventSourceId: string
): readonly ReplacementEffect[] {
  const selfEffects = effects.filter(e => e.self && e.sourceId === eventSourceId);
  const otherEffects = effects.filter(e => !e.self || e.sourceId !== eventSourceId);
  
  return [...selfEffects, ...otherEffects];
}

/**
 * Rule 615: Prevention Effects
 * 
 * Prevention effects use "prevent" (Rule 615.1)
 */

export interface PreventionEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly damageSource?: string;      // What damage to prevent
  readonly damageTarget?: string;      // Prevent damage to what
  readonly amount?: number;            // Amount to prevent (undefined = all)
  readonly shield: boolean;            // Rule 615.6: Prevention shield
}

/**
 * Rule 615.6: Prevention shield
 * Creates shield that prevents next N damage
 */
export function createPreventionShield(
  sourceId: string,
  amount: number,
  target?: string
): PreventionEffect {
  return {
    id: `${sourceId}-shield`,
    sourceId,
    amount,
    damageTarget: target,
    shield: true
  };
}

/**
 * Rule 615.9: Apply prevention effects
 * Reduce damage by prevention amount
 */
export function applyPrevention(
  damage: number,
  prevention: PreventionEffect
): { remainingDamage: number; shieldRemaining?: number } {
  if (prevention.amount === undefined) {
    // Prevent all
    return { remainingDamage: 0 };
  }
  
  const prevented = Math.min(damage, prevention.amount);
  const remainingDamage = damage - prevented;
  const shieldRemaining = prevention.amount - prevented;
  
  return { 
    remainingDamage,
    shieldRemaining: shieldRemaining > 0 ? shieldRemaining : undefined
  };
}
