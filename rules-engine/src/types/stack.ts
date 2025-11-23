// Types for the stack (rule 405) and priority (rule 117)
import type { PlayerID } from '../../../shared/src';
import type { ActivatedAbility, TriggeredAbility, SpellAbility } from './abilities';

// Stack object (rule 405)
export interface StackObject {
  readonly id: string;
  readonly type: 'spell' | 'ability';
  readonly controller: PlayerID;
  readonly timestamp: number;
}

// Spell on the stack
export interface StackedSpell extends StackObject {
  readonly type: 'spell';
  readonly cardId: string;
  readonly manaCost: ManaAmount;
  readonly targets: readonly string[];
  readonly ability: SpellAbility;
  readonly resolving: boolean;
}

// Ability on the stack (rule 113.1c)
export interface StackedAbility extends StackObject {
  readonly type: 'ability';
  readonly ability: ActivatedAbility | TriggeredAbility;
  readonly sourceId: string;
  readonly targets: readonly string[];
  readonly resolving: boolean;
}

// Stack state
export interface StackState {
  readonly objects: readonly StackObject[];
  readonly triggeredAbilitiesWaiting: readonly PendingTriggeredAbility[];
}

// Pending triggered ability that hasn't been put on stack yet (rule 603.3)
export interface PendingTriggeredAbility {
  readonly id: string;
  readonly ability: TriggeredAbility;
  readonly controller: PlayerID;
  readonly sourceId: string;
  readonly triggeredAt: number;
}

// Priority state (rule 117)
export interface PriorityState {
  readonly currentPlayer: PlayerID;
  readonly passedPlayers: readonly PlayerID[]; // Players who have passed in succession
  readonly canAct: boolean; // False if waiting for something to resolve
}

// Mana amount (for spell costs)
export interface ManaAmount {
  readonly white?: number;
  readonly blue?: number;
  readonly black?: number;
  readonly red?: number;
  readonly green?: number;
  readonly colorless?: number;
  readonly generic?: number;
}

// Priority action
export type PriorityAction =
  | { type: 'pass' }
  | { type: 'cast-spell'; spellId: string; targets?: string[] }
  | { type: 'activate-ability'; abilityId: string; targets?: string[] }
  | { type: 'play-land'; landId: string }
  | { type: 'special-action'; actionType: string };

// Result of priority check (rule 117.4)
export interface PriorityResult {
  readonly allPassed: boolean; // True if all players passed in succession
  readonly shouldResolve: boolean; // True if top of stack should resolve
  readonly shouldEndPhase: boolean; // True if phase/step should end
}
