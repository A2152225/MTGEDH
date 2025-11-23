// Types for replacement effects (rule 614) and prevention effects (rule 615)
import type { PlayerID } from '../../../shared/src';
import type { ObjectFilter } from './abilities';

// Replacement effect (rule 614)
export interface ReplacementEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly type: ReplacementEffectType;
  readonly layer: number; // For ordering multiple replacement effects
  readonly duration?: 'this-turn' | 'end-of-combat' | 'permanent';
  readonly usedUp: boolean;
}

export type ReplacementEffectType =
  | EntersReplacementEffect
  | DamageReplacementEffect
  | DrawReplacementEffect
  | DestroyReplacementEffect
  | SkipEffect
  | CustomReplacementEffect;

// Enters-the-battlefield replacement (rule 614.12)
// "[This permanent] enters with...", "As [this permanent] enters...", "[This permanent] enters as..."
export interface EntersReplacementEffect {
  readonly type: 'enters-battlefield';
  readonly targetId: string; // The permanent entering
  readonly modification: EnterModification;
}

export type EnterModification =
  | { type: 'enters-tapped' } // Most common - "enters the battlefield tapped"
  | { type: 'enters-with-counters'; counterType: string; count: number }
  | { type: 'enters-as-copy'; copyOf: string }
  | { type: 'enters-with-ability'; abilityText: string }
  | { type: 'choose-mode'; modes: string[] }
  | { type: 'custom'; description: string };

// Damage replacement (rule 614.9)
export interface DamageReplacementEffect {
  readonly type: 'damage';
  readonly modification: DamageModification;
  readonly filter?: DamageEventFilter;
}

export type DamageModification =
  | { type: 'prevent-all' }
  | { type: 'prevent-amount'; amount: number }
  | { type: 'double' }
  | { type: 'redirect'; newTarget: string }
  | { type: 'modify'; multiplier: number };

export interface DamageEventFilter {
  readonly source?: ObjectFilter;
  readonly target?: ObjectFilter;
  readonly combat?: boolean;
}

// Draw replacement (rule 614.11)
export interface DrawReplacementEffect {
  readonly type: 'draw';
  readonly player: PlayerID;
  readonly modification: DrawModification;
}

export type DrawModification =
  | { type: 'skip' }
  | { type: 'draw-extra'; count: number }
  | { type: 'draw-instead'; effect: string };

// Destruction replacement (regeneration, rule 614.8)
export interface DestroyReplacementEffect {
  readonly type: 'destroy';
  readonly targetId: string;
  readonly modification: 'regenerate' | 'indestructible';
}

// Skip effects (rule 614.10)
export interface SkipEffect {
  readonly type: 'skip';
  readonly skipTarget: 'step' | 'phase' | 'turn';
  readonly which?: string; // Which step/phase
}

export interface CustomReplacementEffect {
  readonly type: 'custom';
  readonly description: string;
}

// Prevention effects (rule 615)
export interface PreventionEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly type: PreventionEffectType;
  readonly remaining: number | 'infinite'; // For "prevent the next X damage"
  readonly duration?: 'this-turn' | 'permanent';
}

export type PreventionEffectType =
  | { type: 'prevent-damage'; amount: number | 'all'; source?: ObjectFilter; target?: ObjectFilter }
  | { type: 'prevent-next-from-source'; sourceId: string };

// Event that may be replaced
export type GameEvent =
  | EnterBattlefieldEvent
  | LeaveBattlefieldEvent
  | DamageEvent
  | DrawEvent
  | DestroyEvent
  | TapEvent
  | UntapEvent
  | CastSpellEvent
  | ActivateAbilityEvent;

export interface EnterBattlefieldEvent {
  readonly id: string;
  readonly type: 'enter-battlefield';
  readonly permanentId: string;
  readonly controller: PlayerID;
  readonly tapped: boolean;
  readonly counters: ReadonlyMap<string, number>;
  readonly timestamp: number;
}

export interface LeaveBattlefieldEvent {
  readonly id: string;
  readonly type: 'leave-battlefield';
  readonly permanentId: string;
  readonly destination: 'hand' | 'graveyard' | 'exile' | 'library' | 'command';
  readonly timestamp: number;
}

export interface DamageEvent {
  readonly id: string;
  readonly type: 'damage';
  readonly sourceId: string;
  readonly targetId: string;
  readonly amount: number;
  readonly combat: boolean;
  readonly timestamp: number;
}

export interface DrawEvent {
  readonly id: string;
  readonly type: 'draw';
  readonly player: PlayerID;
  readonly count: number;
  readonly timestamp: number;
}

export interface DestroyEvent {
  readonly id: string;
  readonly type: 'destroy';
  readonly targetId: string;
  readonly timestamp: number;
}

export interface TapEvent {
  readonly id: string;
  readonly type: 'tap';
  readonly permanentId: string;
  readonly timestamp: number;
}

export interface UntapEvent {
  readonly id: string;
  readonly type: 'untap';
  readonly permanentId: string;
  readonly timestamp: number;
}

export interface CastSpellEvent {
  readonly id: string;
  readonly type: 'cast-spell';
  readonly spellId: string;
  readonly controller: PlayerID;
  readonly timestamp: number;
}

export interface ActivateAbilityEvent {
  readonly id: string;
  readonly type: 'activate-ability';
  readonly abilityId: string;
  readonly controller: PlayerID;
  readonly timestamp: number;
}
