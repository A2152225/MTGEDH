// Types for abilities as defined in rule 113
import type { PlayerID } from '../../../shared/src';

export type AbilityType = 'activated' | 'triggered' | 'static' | 'mana' | 'loyalty' | 'spell';

// Base ability interface
export interface Ability {
  readonly id: string;
  readonly type: AbilityType;
  readonly sourceId: string; // Card or permanent that has this ability
  readonly text: string; // Oracle text of the ability
}

// Activated ability (rule 602)
// Written as "[Cost]: [Effect.] [Activation instructions (if any).]"
export interface ActivatedAbility extends Ability {
  readonly type: 'activated' | 'mana' | 'loyalty';
  readonly cost: Cost;
  readonly effect: Effect;
  readonly activationRestrictions?: ActivationRestriction[];
  readonly timingRestriction?: 'sorcery' | 'instant' | 'any';
}

// Triggered ability (rule 603)
// Written as "[When/Whenever/At] [trigger condition], [effect]"
export interface TriggeredAbility extends Ability {
  readonly type: 'triggered';
  readonly triggerCondition: TriggerCondition;
  readonly effect: Effect;
  readonly isOptional: boolean; // Contains "may"
  readonly interveningIf?: Condition; // Intervening 'if' clause (rule 603.4)
}

// Static ability (rule 604)
export interface StaticAbility extends Ability {
  readonly type: 'static';
  readonly effect: ContinuousEffect;
}

// Spell ability (rule 113.3a)
export interface SpellAbility extends Ability {
  readonly type: 'spell';
  readonly effect: Effect;
}

// Activation restrictions
export type ActivationRestriction = 
  | { type: 'once-per-turn' }
  | { type: 'X-times-per-turn'; count: number }
  | { type: 'only-during-phase'; phase: string }
  | { type: 'only-during-step'; step: string }
  | { type: 'controller-control'; sourceId: string };

// Trigger conditions (rule 603)
export type TriggerCondition =
  | { type: 'enters-battlefield'; filter?: ObjectFilter }
  | { type: 'leaves-battlefield'; filter?: ObjectFilter }
  | { type: 'becomes-tapped'; filter?: ObjectFilter }
  | { type: 'becomes-untapped'; filter?: ObjectFilter }
  | { type: 'phase-begin'; phase: string }
  | { type: 'step-begin'; step: string }
  | { type: 'cast-spell'; filter?: ObjectFilter }
  | { type: 'ability-activated'; filter?: AbilityFilter }
  | { type: 'dealt-damage'; filter?: DamageFilter }
  | { type: 'dies'; filter?: ObjectFilter }
  | { type: 'attacks'; filter?: ObjectFilter }
  | { type: 'blocks'; filter?: ObjectFilter }
  | { type: 'countered'; filter?: ObjectFilter }
  | { type: 'state-trigger'; condition: Condition };

export interface ObjectFilter {
  types?: string[];
  subtypes?: string[];
  colors?: string[];
  controller?: 'you' | 'opponent' | 'any';
  other?: boolean; // "another" or "other"
}

export interface AbilityFilter {
  abilityType?: AbilityType;
  sourceFilter?: ObjectFilter;
}

export interface DamageFilter {
  source?: ObjectFilter;
  target?: ObjectFilter;
  combat?: boolean;
}

// Conditions for various checks
export type Condition =
  | { type: 'life-total'; player: 'you' | 'opponent'; comparison: '<' | '>' | '<=' | '>=' | '=='; value: number }
  | { type: 'controls'; player: 'you' | 'opponent'; filter: ObjectFilter; count?: number }
  | { type: 'in-graveyard'; player: 'you' | 'opponent'; filter: ObjectFilter; count?: number }
  | { type: 'custom'; check: string };

// Effects
export type Effect =
  | DamageEffect
  | DrawEffect
  | DiscardEffect
  | DestroyEffect
  | ExileEffect
  | SearchLibraryEffect
  | PutOntoBattlefieldEffect
  | TapEffect
  | UntapEffect
  | GainLifeEffect
  | LoseLifeEffect
  | CreateTokenEffect
  | AddManaEffect
  | CounterEffect
  | ModifyEffect
  | CustomEffect;

export interface DamageEffect {
  readonly type: 'damage';
  readonly amount: number | 'X';
  readonly targets: TargetRequirement[];
}

export interface DrawEffect {
  readonly type: 'draw';
  readonly player: 'you' | 'opponent' | 'each-player';
  readonly count: number;
}

export interface DiscardEffect {
  readonly type: 'discard';
  readonly player: 'you' | 'opponent' | 'each-player';
  readonly count: number | 'hand';
  readonly random?: boolean;
}

export interface DestroyEffect {
  readonly type: 'destroy';
  readonly targets: TargetRequirement[];
}

export interface ExileEffect {
  readonly type: 'exile';
  readonly targets: TargetRequirement[];
}

export interface SearchLibraryEffect {
  readonly type: 'search-library';
  readonly player: 'you' | 'target-player';
  readonly filter: ObjectFilter;
  readonly count: number;
  readonly reveal: boolean;
  readonly destination: 'hand' | 'battlefield' | 'graveyard' | 'top-of-library' | 'bottom-of-library';
  readonly tapped?: boolean; // For battlefield destination
  readonly shuffle: boolean;
}

export interface PutOntoBattlefieldEffect {
  readonly type: 'put-onto-battlefield';
  readonly source: 'hand' | 'graveyard' | 'exile' | 'library';
  readonly filter?: ObjectFilter;
  readonly tapped?: boolean;
  readonly underControl?: 'you' | 'owner';
}

export interface TapEffect {
  readonly type: 'tap';
  readonly targets: TargetRequirement[];
}

export interface UntapEffect {
  readonly type: 'untap';
  readonly targets: TargetRequirement[];
}

export interface GainLifeEffect {
  readonly type: 'gain-life';
  readonly player: 'you' | 'target-player';
  readonly amount: number | 'X';
}

export interface LoseLifeEffect {
  readonly type: 'lose-life';
  readonly player: 'you' | 'opponent' | 'each-player';
  readonly amount: number | 'X';
}

export interface CreateTokenEffect {
  readonly type: 'create-token';
  readonly count: number;
  readonly tokenSpec: {
    name: string;
    types: string[];
    power?: number;
    toughness?: number;
    colors: string[];
    abilities?: string[];
  };
}

export interface AddManaEffect {
  readonly type: 'add-mana';
  readonly mana: ManaAmount;
}

export interface CounterEffect {
  readonly type: 'counter';
  readonly target: 'target-spell' | 'target-ability';
}

export interface ModifyEffect {
  readonly type: 'modify';
  readonly modification: Modification;
}

export interface CustomEffect {
  readonly type: 'custom';
  readonly description: string;
}

// Continuous effects (rule 611)
export type ContinuousEffect =
  | PowerToughnessModification
  | AbilityGrant
  | AbilityRemoval
  | TypeChange
  | ColorChange
  | ControlChange
  | RestrictionEffect
  | CustomContinuousEffect;

export interface PowerToughnessModification {
  readonly type: 'power-toughness';
  readonly filter: ObjectFilter;
  readonly powerMod: number | 'X';
  readonly toughnessMod: number | 'X';
  readonly layer: number;
}

export interface AbilityGrant {
  readonly type: 'ability-grant';
  readonly filter: ObjectFilter;
  readonly ability: Ability;
  readonly layer: number;
}

export interface AbilityRemoval {
  readonly type: 'ability-removal';
  readonly filter: ObjectFilter;
  readonly abilityToRemove: string;
  readonly layer: number;
}

export interface TypeChange {
  readonly type: 'type-change';
  readonly filter: ObjectFilter;
  readonly newTypes: string[];
  readonly layer: number;
}

export interface ColorChange {
  readonly type: 'color-change';
  readonly filter: ObjectFilter;
  readonly colors: string[];
  readonly layer: number;
}

export interface ControlChange {
  readonly type: 'control-change';
  readonly filter: ObjectFilter;
  readonly newController: PlayerID;
  readonly layer: number;
}

export interface RestrictionEffect {
  readonly type: 'restriction';
  readonly restriction: 'cant-attack' | 'cant-block' | 'cant-be-blocked' | 'must-attack';
  readonly filter: ObjectFilter;
  readonly layer: number;
}

export interface CustomContinuousEffect {
  readonly type: 'custom-continuous';
  readonly description: string;
  readonly layer: number;
}

// Modification for modify effects
export type Modification = PowerToughnessModification | AbilityGrant | TypeChange | ColorChange;

// Target requirements
export interface TargetRequirement {
  readonly count: number;
  readonly filter: ObjectFilter;
  readonly optional?: boolean;
}

// Costs (rule 118)
export type Cost =
  | ManaCost
  | TapCost
  | UntapCost
  | SacrificeCost
  | DiscardCost
  | PayLifeCost
  | ExileCost
  | RemoveCountersCost
  | CompositeCost;

export interface ManaCost {
  readonly type: 'mana';
  readonly amount: ManaAmount;
}

export interface TapCost {
  readonly type: 'tap';
  readonly sourceId: string; // Usually the permanent with the ability
}

export interface UntapCost {
  readonly type: 'untap';
  readonly sourceId: string;
}

export interface SacrificeCost {
  readonly type: 'sacrifice';
  readonly filter: ObjectFilter;
  readonly count: number;
}

export interface DiscardCost {
  readonly type: 'discard';
  readonly count: number;
  readonly filter?: ObjectFilter;
}

export interface PayLifeCost {
  readonly type: 'pay-life';
  readonly amount: number | 'X' | 'half';
}

export interface ExileCost {
  readonly type: 'exile';
  readonly source: 'hand' | 'graveyard' | 'battlefield';
  readonly filter: ObjectFilter;
  readonly count: number;
}

export interface RemoveCountersCost {
  readonly type: 'remove-counters';
  readonly counterType: string;
  readonly count: number;
  readonly from: 'this' | ObjectFilter;
}

export interface CompositeCost {
  readonly type: 'composite';
  readonly costs: Cost[];
}

// Mana amounts
export interface ManaAmount {
  readonly white?: number;
  readonly blue?: number;
  readonly black?: number;
  readonly red?: number;
  readonly green?: number;
  readonly colorless?: number;
  readonly generic?: number;
  readonly any?: number; // For "add one mana of any color"
}

// Ability on the stack (rule 113.1c)
export interface StackedAbility {
  readonly id: string;
  readonly ability: ActivatedAbility | TriggeredAbility | SpellAbility;
  readonly controller: PlayerID;
  readonly sourceId: string;
  readonly targets?: readonly string[]; // Chosen targets
  readonly timestamp: number;
  readonly resolving: boolean;
}
