// Origin parent: rules-engine/src/effectProgram.ts
// Cluster moved: public Effect Program types/interfaces plus ORACLE_CHOICE_STEP_KINDS
// and BASIC_LAND_TYPE_OPTIONS.
// Public entry symbols: EffectProgramStepKind, EffectProgramClauseRef, EffectProgramStepGuard,
// BaseEffectProgramStep, EffectProgramConditionStep, EffectProgramCommand, EffectProgramCommandStep,
// EffectProgramChoiceRequest, EffectProgramChoiceEventInput, EffectProgramChoiceStep,
// EffectProgramKeywordStep, EffectProgramNoteStep, EffectProgramStep, EffectProgram,
// EffectProgramRuntime, EffectProgramTraceEntry, EffectProgramConditionEvaluation,
// EffectProgramHandlerArgs, EffectProgramCommandResult, EffectProgramHandlers,
// EffectProgramChoicePause, EffectProgramRunStatus, EffectProgramRunResult,
// BuildEffectProgramFromOracleIRInput, ORACLE_CHOICE_STEP_KINDS, BASIC_LAND_TYPE_OPTIONS.
// Leaf must not import effectProgram.ts or effectProgram-handlers/index.ts.

import type { GameState, PlayerID } from '../../../shared/src';
import type { ChoiceEvent, ChoiceEventType } from '../choiceEventsTypes';
import type { OracleClauseCondition, OracleEffectStep } from '../oracleIR';

export type EffectProgramStepKind = 'condition' | 'command' | 'choice' | 'keyword' | 'note';

export interface EffectProgramClauseRef {
  readonly abilityIndex?: number;
  readonly clauseIndex?: number;
  readonly raw?: string;
}

export interface EffectProgramStepGuard {
  readonly bindingKey: string;
  readonly selectionIncludes?: string;
  readonly selectionEquals?: string | number | boolean;
  readonly cancelledEquals?: boolean;
  readonly onFalse?: 'skip' | 'halt';
}

export interface BaseEffectProgramStep {
  readonly id: string;
  readonly kind: EffectProgramStepKind;
  readonly clause?: EffectProgramClauseRef;
  readonly raw?: string;
  readonly guard?: EffectProgramStepGuard;
}

export interface EffectProgramConditionStep extends BaseEffectProgramStep {
  readonly kind: 'condition';
  readonly condition: OracleClauseCondition | { readonly kind: string; readonly raw?: string };
  readonly interveningIf?: boolean;
  readonly onFalse?:
    | { readonly action: 'halt' }
    | { readonly action: 'continue' }
    | { readonly action: 'skip_to_step'; readonly stepId: string };
  readonly onUnknown?: 'block' | 'halt' | 'continue';
}

export type EffectProgramCommand =
  | { readonly kind: 'oracle_ir_step'; readonly step: OracleEffectStep }
  | { readonly kind: string; readonly [key: string]: unknown };

export interface EffectProgramCommandStep extends BaseEffectProgramStep {
  readonly kind: 'command';
  readonly command: EffectProgramCommand;
}

export interface EffectProgramChoiceRequest {
  readonly type: ChoiceEventType | string;
  readonly playerId: PlayerID;
  readonly description: string;
  readonly mandatory: boolean;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly sourceImage?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface EffectProgramChoiceEventInput {
  readonly request: EffectProgramChoiceRequest;
  readonly eventId?: string;
  readonly timestamp?: number;
}

export interface EffectProgramChoiceStep extends BaseEffectProgramStep {
  readonly kind: 'choice';
  readonly bindingKey: string;
  readonly choiceEvent?: ChoiceEvent;
  readonly choiceRequest?: EffectProgramChoiceRequest;
}

export interface EffectProgramKeywordStep extends BaseEffectProgramStep {
  readonly kind: 'keyword';
  readonly keyword: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface EffectProgramNoteStep extends BaseEffectProgramStep {
  readonly kind: 'note';
  readonly message: string;
}

export type EffectProgramStep =
  | EffectProgramConditionStep
  | EffectProgramCommandStep
  | EffectProgramChoiceStep
  | EffectProgramKeywordStep
  | EffectProgramNoteStep;

export interface EffectProgram {
  readonly id: string;
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly sourceImage?: string;
  readonly steps: readonly EffectProgramStep[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EffectProgramRuntime<S = GameState> {
  readonly program: EffectProgram;
  readonly state: S;
  readonly cursor: number;
  readonly bindings: Readonly<Record<string, unknown>>;
}

export interface EffectProgramTraceEntry {
  readonly stepId: string;
  readonly kind: EffectProgramStepKind;
  readonly outcome: 'applied' | 'skipped' | 'waiting' | 'blocked' | 'halted' | 'expanded';
  readonly message?: string;
}

export type EffectProgramConditionEvaluation =
  | boolean
  | 'unknown'
  | { readonly value: boolean | 'unknown'; readonly reason?: string };

export interface EffectProgramHandlerArgs<S, TStep extends EffectProgramStep = EffectProgramStep> {
  readonly state: S;
  readonly step: TStep;
  readonly runtime: EffectProgramRuntime<S>;
}

export interface EffectProgramCommandResult<S> {
  readonly state: S;
  readonly bindings?: Readonly<Record<string, unknown>>;
  readonly events?: readonly unknown[];
}

export interface EffectProgramHandlers<S = GameState> {
  readonly evaluateCondition?: (
    args: EffectProgramHandlerArgs<S, EffectProgramConditionStep>
  ) => EffectProgramConditionEvaluation;
  readonly applyCommand?: (
    args: EffectProgramHandlerArgs<S, EffectProgramCommandStep>
  ) => S | EffectProgramCommandResult<S>;
  readonly createChoiceEvent?: (
    args: EffectProgramHandlerArgs<S, EffectProgramChoiceStep>
  ) => ChoiceEvent | undefined;
  readonly expandKeyword?: (
    args: EffectProgramHandlerArgs<S, EffectProgramKeywordStep>
  ) => readonly EffectProgramStep[] | undefined;
}

export interface EffectProgramChoicePause<S = GameState> {
  readonly runtime: EffectProgramRuntime<S>;
  readonly step: EffectProgramChoiceStep;
  readonly choiceEvent: ChoiceEvent;
}

export type EffectProgramRunStatus = 'completed' | 'waiting_for_choice' | 'blocked' | 'halted';

export interface EffectProgramRunResult<S = GameState> {
  readonly status: EffectProgramRunStatus;
  readonly state: S;
  readonly runtime: EffectProgramRuntime<S>;
  readonly pendingChoice?: EffectProgramChoicePause<S>;
  readonly blockedStep?: EffectProgramStep;
  readonly reason?: string;
  readonly trace: readonly EffectProgramTraceEntry[];
  readonly events: readonly unknown[];
}

export interface BuildEffectProgramFromOracleIRInput {
  readonly id: string;
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly sourceImage?: string;
  readonly steps: readonly OracleEffectStep[];
  readonly interveningIf?: string | OracleClauseCondition;
  readonly abilityIndex?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const ORACLE_CHOICE_STEP_KINDS = new Set<string>([
  'choose_opponent',
  'choose_color',
  'choose_creature_type',
  'choose_basic_land_type',
  'choose_card_name',
  'choose_mode',
  'choose_target_creature',
  'explore',
  'proliferate',
  'scry',
  'surveil',
]);

export const BASIC_LAND_TYPE_OPTIONS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
