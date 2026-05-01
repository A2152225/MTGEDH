import type { GameState, PlayerID } from '../../shared/src';
import { ChoiceEventType, type ChoiceEvent, type ChoiceOption, type ChoiceResponse } from './choiceEventsTypes';
import type { OracleClauseCondition, OracleEffectStep } from './oracleIR';

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

const ORACLE_CHOICE_STEP_KINDS = new Set<string>([
  'choose_opponent',
  'choose_color',
  'choose_creature_type',
  'choose_card_name',
  'choose_mode',
  'choose_target_creature',
  'explore',
  'proliferate',
  'scry',
  'surveil',
]);

export function createEffectProgramRuntime<S>(args: {
  readonly program: EffectProgram;
  readonly state: S;
  readonly cursor?: number;
  readonly bindings?: Readonly<Record<string, unknown>>;
}): EffectProgramRuntime<S> {
  return {
    program: args.program,
    state: args.state,
    cursor: args.cursor ?? 0,
    bindings: args.bindings ?? {},
  };
}

export function bindEffectProgramChoiceResponse<S>(
  runtime: EffectProgramRuntime<S>,
  response: ChoiceResponse,
  bindingKey?: string
): EffectProgramRuntime<S> {
  const currentStep = runtime.program.steps[runtime.cursor];
  const resolvedBindingKey = bindingKey || (currentStep?.kind === 'choice' ? currentStep.bindingKey : response.eventId);

  return {
    ...runtime,
    bindings: {
      ...runtime.bindings,
      [resolvedBindingKey]: response,
    },
  };
}

export function createChoiceEventFromEffectProgramChoiceRequest(
  input: EffectProgramChoiceEventInput
): ChoiceEvent {
  const request = input.request;
  const payload = request.payload || {};
  const base = {
    id: input.eventId || createEffectProgramChoiceEventId(),
    type: request.type as ChoiceEventType,
    playerId: request.playerId,
    sourceId: request.sourceId,
    sourceName: request.sourceName,
    sourceImage: request.sourceImage,
    description: request.description,
    mandatory: request.mandatory,
    timestamp: input.timestamp ?? Date.now(),
  };

  switch (request.type) {
    case ChoiceEventType.COLOR_CHOICE:
      return {
        ...base,
        type: ChoiceEventType.COLOR_CHOICE,
        colors: asChoiceOptions(payload.colors) || defaultColorOptions(),
        minColors: asNumber(payload.minColors, 1),
        maxColors: asNumber(payload.maxColors, 1),
      };

    case ChoiceEventType.CREATURE_TYPE_CHOICE:
      return {
        ...base,
        type: ChoiceEventType.CREATURE_TYPE_CHOICE,
        suggestedTypes: asStringArray(payload.suggestedTypes) || [],
        allowCustom: asBoolean(payload.allowCustom, true),
      };

    case ChoiceEventType.CARD_NAME_CHOICE:
      return {
        ...base,
        type: ChoiceEventType.CARD_NAME_CHOICE,
        options: asChoiceOptions(payload.options) || [],
        allowCustom: asBoolean(payload.allowCustom, true),
      } as unknown as ChoiceEvent;

    case ChoiceEventType.NUMBER_CHOICE:
      return {
        ...base,
        type: ChoiceEventType.NUMBER_CHOICE,
        minValue: asNumber(payload.minValue, 0),
        maxValue: asNumber(payload.maxValue, 99),
        defaultValue: typeof payload.defaultValue === 'number' ? payload.defaultValue : undefined,
      };

    case ChoiceEventType.EXPLORE_DECISION:
      return {
        ...base,
        type: ChoiceEventType.EXPLORE_DECISION,
        permanentId: String(payload.permanentId || ''),
        permanentName: String(payload.permanentName || payload.permanentId || 'Creature'),
        revealedCard: asCardRef(payload.revealedCard),
        isLand: asBoolean(payload.isLand, false),
      };

    case ChoiceEventType.PROLIFERATE:
      return {
        ...base,
        type: ChoiceEventType.PROLIFERATE,
        proliferateId: String(payload.proliferateId || base.id),
        availableTargets: asProliferateTargets(payload.availableTargets),
      };

    case ChoiceEventType.CLASH:
      return {
        ...base,
        type: ChoiceEventType.CLASH,
        revealedCard: asCardRef(payload.revealedCard),
        opponentId: typeof payload.opponentId === 'string' ? payload.opponentId as PlayerID : undefined,
      };

    case ChoiceEventType.PLAYER_CHOICE:
      return {
        ...base,
        type: ChoiceEventType.PLAYER_CHOICE,
        validPlayers: asPlayerChoices(payload.validPlayers),
        allowSelf: asBoolean(payload.allowSelf, true),
        allowOpponents: asBoolean(payload.allowOpponents, true),
      };

    case ChoiceEventType.TARGET_SELECTION:
      return {
        ...base,
        type: ChoiceEventType.TARGET_SELECTION,
        validTargets: asChoiceOptions(payload.validTargets) || [],
        targetTypes: asStringArray(payload.targetTypes) || [],
        minTargets: asNumber(payload.minTargets, 1),
        maxTargets: asNumber(payload.maxTargets, 1),
        targetDescription: String(payload.targetDescription || request.description),
      };

    case ChoiceEventType.MODE_SELECTION:
      return {
        ...base,
        type: ChoiceEventType.MODE_SELECTION,
        modes: asChoiceOptions(payload.modes) || [],
        minModes: asNumber(payload.minModes, 1),
        maxModes: asNumber(payload.maxModes, 1),
        allowDuplicates: asBoolean(payload.allowDuplicates, false),
      };

    case ChoiceEventType.X_VALUE_SELECTION:
      return {
        ...base,
        type: ChoiceEventType.X_VALUE_SELECTION,
        minX: asNumber(payload.minX, 0),
        maxX: asNumber(payload.maxX, 99),
        costPerX: typeof payload.costPerX === 'string' ? payload.costPerX : undefined,
      };

    case ChoiceEventType.SCRY:
      return {
        ...base,
        type: ChoiceEventType.SCRY,
        cards: asCardRefs(payload.cards),
        scryCount: asNumber(payload.scryCount, 0),
      };

    case ChoiceEventType.SURVEIL:
      return {
        ...base,
        type: ChoiceEventType.SURVEIL,
        cards: asCardRefs(payload.cards),
        surveilCount: asNumber(payload.surveilCount, 0),
      };

    case ChoiceEventType.FATESEAL:
      return {
        ...base,
        type: ChoiceEventType.FATESEAL,
        opponentId: String(payload.opponentId || ''),
        opponentName: String(payload.opponentName || payload.opponentId || 'opponent'),
        cards: asCardRefs(payload.cards),
        fatesealCount: asNumber(payload.fatesealCount, 0),
      };

    default:
      return {
        ...base,
        type: ChoiceEventType.OPTION_CHOICE,
        options: asChoiceOptions(payload.options) || [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: asNumber(payload.minSelections, request.mandatory ? 1 : 0),
        maxSelections: asNumber(payload.maxSelections, 1),
      };
  }
}

export function runEffectProgram<S = GameState>(
  runtime: EffectProgramRuntime<S>,
  handlers: EffectProgramHandlers<S> = {}
): EffectProgramRunResult<S> {
  let state = runtime.state;
  let program = runtime.program;
  let cursor = runtime.cursor;
  let bindings: Record<string, unknown> = { ...runtime.bindings };
  const trace: EffectProgramTraceEntry[] = [];
  const events: unknown[] = [];

  while (cursor < program.steps.length) {
    const step = program.steps[cursor];
    const guarded = evaluateStepGuard(step, bindings);

    if (!guarded.allowed) {
      trace.push({
        stepId: step.id,
        kind: step.kind,
        outcome: guarded.halt ? 'halted' : 'skipped',
        message: guarded.reason,
      });

      if (guarded.halt) {
        return buildRunResult('halted', state, program, cursor, bindings, trace, events, step, guarded.reason);
      }

      cursor += 1;
      continue;
    }

    const stepRuntime = createEffectProgramRuntime({ program, state, cursor, bindings });

    if (step.kind === 'note') {
      trace.push({ stepId: step.id, kind: step.kind, outcome: 'applied', message: step.message });
      cursor += 1;
      continue;
    }

    if (step.kind === 'condition') {
      const evaluation = normalizeConditionEvaluation(
        handlers.evaluateCondition?.({ state, step, runtime: stepRuntime }) ?? 'unknown'
      );

      if (evaluation.value === 'unknown') {
        const action = step.onUnknown ?? 'block';
        trace.push({
          stepId: step.id,
          kind: step.kind,
          outcome: action === 'continue' ? 'skipped' : action === 'halt' ? 'halted' : 'blocked',
          message: evaluation.reason,
        });

        if (action === 'continue') {
          cursor += 1;
          continue;
        }

        return buildRunResult(action === 'halt' ? 'halted' : 'blocked', state, program, cursor, bindings, trace, events, step, evaluation.reason || 'condition_unknown');
      }

      if (evaluation.value === false) {
        const falseAction = step.onFalse?.action ?? 'halt';
        const nextCursor = resolveFalseConditionCursor(program, cursor, step);
        trace.push({
          stepId: step.id,
          kind: step.kind,
          outcome: falseAction === 'halt' ? 'halted' : 'skipped',
          message: evaluation.reason,
        });

        if (falseAction === 'halt') {
          return buildRunResult('halted', state, program, nextCursor, bindings, trace, events, step, evaluation.reason || 'condition_false');
        }

        cursor = nextCursor;
        continue;
      }

      trace.push({ stepId: step.id, kind: step.kind, outcome: 'applied' });
      cursor += 1;
      continue;
    }

    if (step.kind === 'choice') {
      if (bindings[step.bindingKey] !== undefined) {
        trace.push({ stepId: step.id, kind: step.kind, outcome: 'applied' });
        cursor += 1;
        continue;
      }

      const choiceEvent = step.choiceEvent
        ?? handlers.createChoiceEvent?.({ state, step, runtime: stepRuntime })
        ?? (step.choiceRequest ? createChoiceEventFromEffectProgramChoiceRequest({ request: step.choiceRequest }) : undefined);
      if (!choiceEvent) {
        trace.push({ stepId: step.id, kind: step.kind, outcome: 'blocked', message: 'choice_event_missing' });
        return buildRunResult('blocked', state, program, cursor, bindings, trace, events, step, 'choice_event_missing');
      }

      const pausedRuntime = createEffectProgramRuntime({ program, state, cursor, bindings });
      const pendingChoice: EffectProgramChoicePause<S> = { runtime: pausedRuntime, step, choiceEvent };
      trace.push({ stepId: step.id, kind: step.kind, outcome: 'waiting' });

      return {
        status: 'waiting_for_choice',
        state,
        runtime: pausedRuntime,
        pendingChoice,
        trace,
        events,
      };
    }

    if (step.kind === 'keyword') {
      const expandedSteps = handlers.expandKeyword?.({ state, step, runtime: stepRuntime });

      if (!expandedSteps) {
        trace.push({ stepId: step.id, kind: step.kind, outcome: 'blocked', message: 'keyword_handler_missing' });
        return buildRunResult('blocked', state, program, cursor, bindings, trace, events, step, 'keyword_handler_missing');
      }

      const nextSteps = [
        ...program.steps.slice(0, cursor),
        ...expandedSteps,
        ...program.steps.slice(cursor + 1),
      ];
      program = { ...program, steps: nextSteps };
      trace.push({ stepId: step.id, kind: step.kind, outcome: 'expanded' });

      if (expandedSteps.length === 0) {
        cursor += 1;
      }
      continue;
    }

    if (step.kind === 'command') {
      if (!handlers.applyCommand) {
        trace.push({ stepId: step.id, kind: step.kind, outcome: 'blocked', message: 'command_handler_missing' });
        return buildRunResult('blocked', state, program, cursor, bindings, trace, events, step, 'command_handler_missing');
      }

      const commandResult = handlers.applyCommand({ state, step, runtime: stepRuntime });
      const normalized = normalizeCommandResult(commandResult);
      state = normalized.state;
      bindings = { ...bindings, ...(normalized.bindings || {}) };
      events.push(...(normalized.events || []));
      trace.push({ stepId: step.id, kind: step.kind, outcome: 'applied' });
      cursor += 1;
      continue;
    }
  }

  return {
    status: 'completed',
    state,
    runtime: createEffectProgramRuntime({ program, state, cursor, bindings }),
    trace,
    events,
  };
}

let effectProgramChoiceEventCounter = 0;

function createEffectProgramChoiceEventId(): string {
  effectProgramChoiceEventCounter += 1;
  return `effect-choice-${Date.now()}-${effectProgramChoiceEventCounter}`;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}

function asChoiceOptions(value: unknown): readonly ChoiceOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value
    .filter(option => option && typeof option === 'object' && typeof (option as any).id === 'string')
    .map(option => ({
      ...(option as any),
      id: String((option as any).id),
      label: String((option as any).label || (option as any).id),
    }));

  return options;
}

function asPlayerChoices(value: unknown): readonly { id: PlayerID; name: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(player => player && typeof player === 'object' && typeof (player as any).id === 'string')
    .map(player => ({
      id: String((player as any).id),
      name: String((player as any).name || (player as any).id),
    }));
}

function asProliferateTargets(value: unknown): readonly {
  readonly id: string;
  readonly name: string;
  readonly counters: Readonly<Record<string, number>>;
  readonly isPlayer: boolean;
  readonly type?: 'permanent' | 'player';
  readonly controller?: PlayerID;
}[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(target => target && typeof target === 'object' && typeof (target as any).id === 'string')
    .map(target => {
      const isPlayer = (target as any).isPlayer === true || (target as any).type === 'player';
      const controller = typeof (target as any).controller === 'string' ? String((target as any).controller) as PlayerID : undefined;
      return {
        id: String((target as any).id),
        name: String((target as any).name || (target as any).id),
        counters: asCounterRecord((target as any).counters),
        isPlayer,
        type: isPlayer ? 'player' as const : 'permanent' as const,
        ...(controller ? { controller } : {}),
      };
    });
}

function asCounterRecord(value: unknown): Readonly<Record<string, number>> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const counters: Record<string, number> = {};
  for (const [counter, count] of Object.entries(value as Record<string, unknown>)) {
    const numericCount = Number(count);
    if (counter && Number.isFinite(numericCount) && numericCount > 0) {
      counters[counter] = numericCount;
    }
  }
  return counters;
}

function asCardRefs(value: unknown): readonly import('../../shared/src').KnownCardRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(card => card && typeof card === 'object' && typeof (card as any).id === 'string')
    .map(card => ({ ...(card as any), id: String((card as any).id) }));
}

function asCardRef(value: unknown): import('../../shared/src').KnownCardRef {
  if (value && typeof value === 'object' && typeof (value as any).id === 'string') {
    return { ...(value as any), id: String((value as any).id) };
  }

  return { id: '', name: 'Unknown Card' } as import('../../shared/src').KnownCardRef;
}

function defaultColorOptions(): readonly ChoiceOption[] {
  return [
    { id: 'W', label: 'White' },
    { id: 'U', label: 'Blue' },
    { id: 'B', label: 'Black' },
    { id: 'R', label: 'Red' },
    { id: 'G', label: 'Green' },
  ];
}

export function buildEffectProgramFromOracleIR(input: BuildEffectProgramFromOracleIRInput): EffectProgram {
  const steps: EffectProgramStep[] = [];
  const interveningIfCondition = normalizeInterveningIfCondition(input.interveningIf);
  const oracleSteps = unwrapMatchingLeadingConditional(input.steps, interveningIfCondition);

  if (interveningIfCondition) {
    steps.push({
      id: `${input.id}:intervening-if`,
      kind: 'condition',
      clause: {
        abilityIndex: input.abilityIndex,
        raw: interveningIfCondition.raw,
      },
      raw: interveningIfCondition.raw,
      condition: interveningIfCondition,
      interveningIf: true,
      onFalse: { action: 'halt' },
      onUnknown: 'block',
    });
  }

  oracleSteps.forEach((oracleStep, clauseIndex) => {
    const baseId = `${input.id}:clause-${clauseIndex}`;
    const nextStep = oracleSteps[clauseIndex + 1];
    const skipTargetStepId = nextStep
      ? getFirstLoweredOracleStepId(`${input.id}:clause-${clauseIndex + 1}`, nextStep, steps)
      : undefined;

    appendOracleStepToEffectProgram({
      input,
      steps,
      oracleStep,
      clauseIndex,
      baseId,
      skipTargetStepId,
    });
  });

  return {
    id: input.id,
    controllerId: input.controllerId,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceImage: input.sourceImage,
    steps,
    metadata: input.metadata,
  };
}

function appendOracleStepToEffectProgram(args: {
  readonly input: BuildEffectProgramFromOracleIRInput;
  readonly steps: EffectProgramStep[];
  readonly oracleStep: OracleEffectStep;
  readonly clauseIndex: number;
  readonly baseId: string;
  readonly skipTargetStepId?: string;
}): void {
  const { input, steps, oracleStep, clauseIndex, baseId } = args;

  if ((oracleStep as any)?.kind === 'conditional' && Array.isArray((oracleStep as any).steps)) {
    const condition = normalizeInterveningIfCondition((oracleStep as any).condition);
    const afterConditionalStepId = args.skipTargetStepId || `${baseId}:after-conditional`;
    const innerSteps = (oracleStep as any).steps as readonly OracleEffectStep[];

    if (condition) {
      steps.push({
        id: `${baseId}:condition`,
        kind: 'condition',
        clause: {
          abilityIndex: input.abilityIndex,
          clauseIndex,
          raw: oracleStep.raw,
        },
        raw: oracleStep.raw,
        condition,
        onFalse: { action: 'skip_to_step', stepId: afterConditionalStepId },
        onUnknown: 'block',
      });
    }

    innerSteps.forEach((innerStep, innerIndex) => {
      const nextInnerStep = innerSteps[innerIndex + 1];
      const innerBaseId = `${baseId}:then-${innerIndex}`;
      appendOracleStepToEffectProgram({
        input,
        steps,
        oracleStep: innerStep,
        clauseIndex,
        baseId: innerBaseId,
        skipTargetStepId: nextInnerStep
          ? getFirstLoweredOracleStepId(`${baseId}:then-${innerIndex + 1}`, nextInnerStep, steps)
          : afterConditionalStepId,
      });
    });

    if (!args.skipTargetStepId) {
      steps.push({
        id: afterConditionalStepId,
        kind: 'note',
        clause: {
          abilityIndex: input.abilityIndex,
          clauseIndex,
          raw: oracleStep.raw,
        },
        raw: oracleStep.raw,
        message: 'conditional complete',
      });
    }

    return;
  }

    const clause: EffectProgramClauseRef = {
      abilityIndex: input.abilityIndex,
      clauseIndex,
      raw: oracleStep.raw,
    };

    let guard: EffectProgramStepGuard | undefined;
    if (oracleStepOptionalRequiresChoice(oracleStep)) {
      const bindingKey = `${baseId}:may`;
      steps.push({
        id: `${baseId}:may-choice`,
        kind: 'choice',
        bindingKey,
        clause,
        raw: oracleStep.raw,
        choiceRequest: {
          type: ChoiceEventType.OPTION_CHOICE,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: ${oracleStep.raw || 'Use this optional effect?'}`,
          mandatory: false,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
            minSelections: 1,
            maxSelections: 1,
          },
        },
      });
      guard = { bindingKey, selectionIncludes: 'yes', onFalse: 'skip' };
    }

    if (isSupportedFatesealChoiceStep(oracleStep)) {
      const opponentBindingKey = `${baseId}:opponent-choice`;
      const fatesealBindingKey = `${baseId}:choice`;
      steps.push({
        id: `${baseId}:opponent-choice`,
        kind: 'choice',
        bindingKey: opponentBindingKey,
        clause,
        raw: oracleStep.raw,
        guard,
        choiceRequest: {
          type: ChoiceEventType.PLAYER_CHOICE,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: Choose an opponent for ${oracleStep.raw || 'fateseal'}`,
          mandatory: true,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            oracleStepKind: 'fateseal_target',
            oracleStep,
          },
        },
      });
      steps.push({
        id: `${baseId}:choice`,
        kind: 'choice',
        bindingKey: fatesealBindingKey,
        clause,
        raw: oracleStep.raw,
        guard: { bindingKey: opponentBindingKey, cancelledEquals: false, onFalse: 'skip' },
        choiceRequest: {
          type: ChoiceEventType.FATESEAL,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: ${oracleStep.raw || 'Fateseal'}`,
          mandatory: true,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            oracleStepKind: 'fateseal',
            oracleStep,
            targetBindingKey: opponentBindingKey,
            fatesealCount: quantityToStaticNumber((oracleStep as any).amount) ?? 0,
          },
        },
      });
      steps.push({
        id: `${baseId}:command`,
        kind: 'command',
        clause,
        raw: oracleStep.raw,
        guard: { bindingKey: fatesealBindingKey, cancelledEquals: false, onFalse: 'skip' },
        command: { kind: 'oracle_ir_step', step: oracleStep },
      });
      return;
    }

    if (isSupportedClashChoiceStep(oracleStep)) {
      appendSupportedClashChoiceSteps({
        input,
        steps,
        oracleStep,
        clause,
        baseId,
        guard,
      });
      return;
    }

    if (oracleStepNeedsChoice(oracleStep, steps)) {
      const bindingKey = `${baseId}:choice`;
      steps.push({
        id: `${baseId}:choice`,
        kind: 'choice',
        bindingKey,
        clause,
        raw: oracleStep.raw,
        guard,
        choiceRequest: buildChoiceRequestForOracleStep(input, oracleStep),
      });

      if (oracleChoiceStepNeedsCommandContinuation(oracleStep)) {
        steps.push({
          id: `${baseId}:command`,
          kind: 'command',
          clause,
          raw: oracleStep.raw,
          guard: { bindingKey, cancelledEquals: false, onFalse: 'skip' },
          command: { kind: 'oracle_ir_step', step: oracleStep },
        });
      }
      return;
    }

    steps.push({
      id: `${baseId}:command`,
      kind: 'command',
      clause,
      raw: oracleStep.raw,
      guard,
      command: { kind: 'oracle_ir_step', step: oracleStep },
    });
}

  function getFirstLoweredOracleStepId(
    baseId: string,
    oracleStep: OracleEffectStep,
    priorSteps: readonly EffectProgramStep[] = []
  ): string {
    if ((oracleStep as any)?.kind === 'conditional') {
      return `${baseId}:condition`;
    }

    if (oracleStepOptionalRequiresChoice(oracleStep)) {
      return `${baseId}:may-choice`;
    }

    if (isSupportedFatesealChoiceStep(oracleStep)) {
      return `${baseId}:opponent-choice`;
    }

    if (isSupportedClashChoiceStep(oracleStep)) {
      return (oracleStep as any).opponent ? `${baseId}:opponent-choice` : `${baseId}:choice`;
    }

    return oracleStepNeedsChoice(oracleStep, priorSteps) ? `${baseId}:choice` : `${baseId}:command`;
  }

  function oracleChoiceStepNeedsCommandContinuation(step: OracleEffectStep): boolean {
    const kind = String((step as any).kind || '');
    return kind === 'choose_mode'
      || kind === 'explore'
      || kind === 'proliferate'
      || kind === 'populate'
      || kind === 'scry'
      || kind === 'surveil'
      || (kind === 'add_mana' && (step as any).requiresChosenMana === true);
  }

function oracleStepOptionalRequiresChoice(step: OracleEffectStep): boolean {
  if ((step as any).optional !== true) return false;

  const kind = String((step as any).kind || '');
  return !(
    kind === 'grant_exile_permission' ||
    kind === 'grant_graveyard_permission' ||
    kind === 'grant_graveyard_keyword_ability' ||
    kind === 'modify_graveyard_permissions'
  );
}

function normalizeInterveningIfCondition(
  condition: string | OracleClauseCondition | undefined
): OracleClauseCondition | undefined {
  if (!condition) {
    return undefined;
  }

  if (typeof condition === 'string') {
    const raw = condition.trim();
    return raw ? { kind: 'if', raw } : undefined;
  }

  const raw = String(condition.raw || '').trim();
  return raw ? { ...condition, raw } : undefined;
}

function unwrapMatchingLeadingConditional(
  steps: readonly OracleEffectStep[],
  condition: OracleClauseCondition | undefined
): readonly OracleEffectStep[] {
  if (!condition || steps.length !== 1) {
    return steps;
  }

  const firstStep = steps[0] as any;
  if (firstStep?.kind !== 'conditional' || !Array.isArray(firstStep.steps)) {
    return steps;
  }

  const wrappedCondition = firstStep.condition as OracleClauseCondition | undefined;
  if (normalizeConditionText(wrappedCondition?.raw) !== normalizeConditionText(condition.raw)) {
    return steps;
  }

  return firstStep.steps as readonly OracleEffectStep[];
}

function normalizeConditionText(raw: string | undefined): string {
  return String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function oracleStepNeedsChoice(
  step: OracleEffectStep,
  priorSteps: readonly EffectProgramStep[] = []
): boolean {
  const kind = String((step as any).kind || '');
  if (kind === 'explore' && isSupportedExploreChoiceStep(step)) {
    return true;
  }

  if ((kind === 'scry' || kind === 'surveil') && isSupportedTopLibraryChoiceStep(step)) {
    return true;
  }

  if (kind === 'populate' && isSupportedPopulateChoiceStep(step)) {
    return true;
  }

  if (ORACLE_CHOICE_STEP_KINDS.has(kind) && kind !== 'explore' && kind !== 'scry' && kind !== 'surveil') {
    return true;
  }

  if (kind === 'add_mana' && Array.isArray((step as any).manaOptions) && (step as any).requiresChosenMana === true) {
    return !priorSteps.some(priorStep => (
      priorStep.kind === 'choice' &&
      String((priorStep.choiceRequest?.payload as any)?.oracleStepKind || '') === 'choose_color'
    ));
  }

  return false;
}

function buildChoiceRequestForOracleStep(
  input: BuildEffectProgramFromOracleIRInput,
  step: OracleEffectStep
): EffectProgramChoiceRequest {
  const kind = String((step as any).kind || '');
  const choiceType = mapOracleStepKindToChoiceType(kind);

  return {
    type: choiceType,
    playerId: input.controllerId,
    description: `${input.sourceName || 'Ability'}: ${(step as any).raw || kind}`,
    mandatory: (step as any).optional !== true,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceImage: input.sourceImage,
    payload: buildChoiceRequestPayloadForOracleStep(kind, step),
  };
}

function buildChoiceRequestPayloadForOracleStep(
  kind: string,
  step: OracleEffectStep
): Readonly<Record<string, unknown>> {
  const basePayload = {
    oracleStepKind: kind,
    oracleStep: step,
  };

  if (kind === 'choose_mode') {
    const modes = Array.isArray((step as any).modes) ? (step as any).modes : [];
    return {
      ...basePayload,
      modes: modes.map((mode: any) => {
        const label = String(mode?.label || mode?.raw || '').trim();
        return {
          id: label,
          label,
          description: String(mode?.raw || label),
        };
      }).filter((mode: ChoiceOption) => mode.id),
      minModes: Number((step as any).minModes ?? 1),
      maxModes: normalizeModeSelectionMaxModes((step as any).maxModes, modes.length),
      allowDuplicates: Boolean((step as any).canRepeatModes),
    };
  }

  if (kind === 'choose_color' || kind === 'add_mana') {
    const colors = buildColorChoiceOptionsFromOracleStep(step);
    return {
      ...basePayload,
      ...(colors.length > 0 ? { colors } : {}),
      minColors: 1,
      maxColors: 1,
    };
  }

  if (kind === 'scry') {
    return {
      ...basePayload,
      scryCount: quantityToStaticNumber((step as any).amount) ?? 0,
    };
  }

  if (kind === 'surveil') {
    return {
      ...basePayload,
      surveilCount: quantityToStaticNumber((step as any).amount) ?? 0,
    };
  }

  if (kind === 'proliferate') {
    return {
      ...basePayload,
      proliferateId: `${kind}:${String((step as any).raw || '').trim()}`,
    };
  }

  if (kind === 'populate') {
    return {
      ...basePayload,
      targetTypes: ['creature token'],
      minTargets: 0,
      maxTargets: 1,
      targetDescription: String((step as any).raw || 'Choose a creature token to populate'),
    };
  }

  return basePayload;
}

function isSupportedTopLibraryChoiceStep(step: OracleEffectStep): boolean {
  const whoKind = String((step as any)?.who?.kind || '');
  return whoKind === 'you' && quantityToStaticNumber((step as any).amount) !== undefined;
}

function isSupportedExploreChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'explore') {
    return false;
  }

  const target = (step as any)?.target;
  if (!target || target.kind !== 'raw') {
    return false;
  }

  const text = String(target.text || '').trim().toLowerCase();
  return text === 'this creature' || text === 'this permanent' || text === 'it' || text === 'that creature';
}

function isSupportedFatesealChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'fateseal') {
    return false;
  }

  const whoKind = String((step as any)?.who?.kind || '');
  const targetKind = String((step as any)?.target?.kind || '');
  return whoKind === 'you' && targetKind === 'target_opponent' && quantityToStaticNumber((step as any).amount) !== undefined;
}

function isSupportedClashChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'clash') {
    return false;
  }

  const whoKind = String((step as any)?.who?.kind || '');
  const opponentKind = String((step as any)?.opponent?.kind || '');
  return whoKind === 'you' && (!opponentKind || opponentKind === 'target_opponent');
}

function isSupportedPopulateChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'populate') {
    return false;
  }

  const whoKind = String((step as any)?.who?.kind || '');
  return whoKind === 'you' && quantityToStaticNumber((step as any).amount) === 1;
}

function appendSupportedClashChoiceSteps(args: {
  readonly input: BuildEffectProgramFromOracleIRInput;
  readonly steps: EffectProgramStep[];
  readonly oracleStep: OracleEffectStep;
  readonly clause: EffectProgramClauseRef;
  readonly baseId: string;
  readonly guard?: EffectProgramStepGuard;
}): void {
  const { input, steps, oracleStep, clause, baseId, guard } = args;
  const hasOpponentChoice = Boolean((oracleStep as any).opponent);

  if (hasOpponentChoice) {
    const opponentBindingKey = `${baseId}:opponent-choice`;
    const controllerClashBindingKey = `${baseId}:choice`;
    const opponentClashBindingKey = `${baseId}:opponent-card-choice`;

    steps.push({
      id: `${baseId}:opponent-choice`,
      kind: 'choice',
      bindingKey: opponentBindingKey,
      clause,
      raw: oracleStep.raw,
      guard,
      choiceRequest: {
        type: ChoiceEventType.PLAYER_CHOICE,
        playerId: input.controllerId,
        description: `${input.sourceName || 'Ability'}: Choose an opponent to clash with`,
        mandatory: true,
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        sourceImage: input.sourceImage,
        payload: {
          oracleStepKind: 'clash_target',
          oracleStep,
        },
      },
    });

    steps.push({
      id: `${baseId}:choice`,
      kind: 'choice',
      bindingKey: controllerClashBindingKey,
      clause,
      raw: oracleStep.raw,
      guard: { bindingKey: opponentBindingKey, cancelledEquals: false, onFalse: 'skip' },
      choiceRequest: buildClashChoiceRequest(input, oracleStep, 'controller', opponentBindingKey),
    });

    steps.push({
      id: `${baseId}:opponent-card-choice`,
      kind: 'choice',
      bindingKey: opponentClashBindingKey,
      clause,
      raw: oracleStep.raw,
      guard: { bindingKey: opponentBindingKey, cancelledEquals: false, onFalse: 'skip' },
      choiceRequest: buildClashChoiceRequest(input, oracleStep, 'opponent', opponentBindingKey),
    });

    steps.push({
      id: `${baseId}:command`,
      kind: 'command',
      clause,
      raw: oracleStep.raw,
      guard: { bindingKey: opponentClashBindingKey, cancelledEquals: false, onFalse: 'skip' },
      command: { kind: 'oracle_ir_step', step: oracleStep },
    });
    return;
  }

  const bindingKey = `${baseId}:choice`;
  steps.push({
    id: `${baseId}:choice`,
    kind: 'choice',
    bindingKey,
    clause,
    raw: oracleStep.raw,
    guard,
    choiceRequest: buildClashChoiceRequest(input, oracleStep, 'controller'),
  });
  steps.push({
    id: `${baseId}:command`,
    kind: 'command',
    clause,
    raw: oracleStep.raw,
    guard: { bindingKey, cancelledEquals: false, onFalse: 'skip' },
    command: { kind: 'oracle_ir_step', step: oracleStep },
  });
}

function buildClashChoiceRequest(
  input: BuildEffectProgramFromOracleIRInput,
  oracleStep: OracleEffectStep,
  clashRole: 'controller' | 'opponent',
  targetBindingKey?: string
): EffectProgramChoiceRequest {
  return {
    type: ChoiceEventType.CLASH,
    playerId: input.controllerId,
    description: `${input.sourceName || 'Ability'}: ${oracleStep.raw || 'Clash'}`,
    mandatory: true,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceImage: input.sourceImage,
    payload: {
      oracleStepKind: 'clash',
      oracleStep,
      clashRole,
      ...(targetBindingKey ? { targetBindingKey } : {}),
    },
  };
}

function quantityToStaticNumber(quantity: unknown): number | undefined {
  if ((quantity as any)?.kind === 'number' && Number.isFinite(Number((quantity as any).value))) {
    return Number((quantity as any).value);
  }

  return undefined;
}

function buildColorChoiceOptionsFromOracleStep(step: OracleEffectStep): readonly ChoiceOption[] {
  const options = Array.isArray((step as any).manaOptions)
    ? (step as any).manaOptions
    : Array.isArray((step as any).colors)
      ? (step as any).colors
      : [];

  return options
    .map((option: unknown) => normalizeColorChoiceOption(option))
    .filter((option): option is ChoiceOption => Boolean(option));
}

function normalizeColorChoiceOption(option: unknown): ChoiceOption | undefined {
  const raw = String(option || '').trim();
  const colorSymbol = normalizeColorSymbol(raw);
  if (!colorSymbol) {
    return undefined;
  }

  return {
    id: colorSymbol,
    label: colorSymbolToName(colorSymbol),
  };
}

function normalizeColorSymbol(raw: string): string | undefined {
  const trimmed = raw.trim();
  const symbolMatch = trimmed.match(/^\{?([WUBRG])\}?$/i);
  if (symbolMatch) {
    return symbolMatch[1]!.toUpperCase();
  }

  const nameToSymbol: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
  };
  return nameToSymbol[trimmed.toLowerCase()];
}

function colorSymbolToName(symbol: string): string {
  const names: Record<string, string> = {
    W: 'White',
    U: 'Blue',
    B: 'Black',
    R: 'Red',
    G: 'Green',
  };
  return names[symbol] || symbol;
}

function normalizeModeSelectionMaxModes(maxModes: unknown, modeCount: number): number {
  const numericMax = Number(maxModes);
  if (Number.isFinite(numericMax) && numericMax >= 0) {
    return numericMax;
  }

  return Math.max(1, modeCount);
}

function mapOracleStepKindToChoiceType(kind: string): ChoiceEventType {
  switch (kind) {
    case 'choose_color':
    case 'add_mana':
      return ChoiceEventType.COLOR_CHOICE;
    case 'choose_creature_type':
      return ChoiceEventType.CREATURE_TYPE_CHOICE;
    case 'choose_card_name':
      return ChoiceEventType.CARD_NAME_CHOICE;
    case 'choose_mode':
      return ChoiceEventType.MODE_SELECTION;
    case 'explore':
      return ChoiceEventType.EXPLORE_DECISION;
    case 'proliferate':
      return ChoiceEventType.PROLIFERATE;
    case 'populate':
      return ChoiceEventType.TARGET_SELECTION;
    case 'clash':
      return ChoiceEventType.CLASH;
    case 'choose_opponent':
      return ChoiceEventType.PLAYER_CHOICE;
    case 'choose_target_creature':
      return ChoiceEventType.TARGET_SELECTION;
    case 'scry':
      return ChoiceEventType.SCRY;
    case 'surveil':
      return ChoiceEventType.SURVEIL;
    case 'fateseal':
      return ChoiceEventType.FATESEAL;
    case 'vote':
      return ChoiceEventType.OPTION_CHOICE;
    case 'pay_mana':
      return ChoiceEventType.OPTION_CHOICE;
    default:
      return ChoiceEventType.OPTION_CHOICE;
  }
}

function normalizeConditionEvaluation(evaluation: EffectProgramConditionEvaluation): {
  readonly value: boolean | 'unknown';
  readonly reason?: string;
} {
  if (typeof evaluation === 'object') {
    return evaluation;
  }

  return { value: evaluation };
}

function normalizeCommandResult<S>(result: S | EffectProgramCommandResult<S>): EffectProgramCommandResult<S> {
  if (
    result &&
    typeof result === 'object' &&
    'state' in (result as Record<string, unknown>)
  ) {
    return result as EffectProgramCommandResult<S>;
  }

  return { state: result as S };
}

function evaluateStepGuard(step: EffectProgramStep, bindings: Readonly<Record<string, unknown>>): {
  readonly allowed: boolean;
  readonly halt: boolean;
  readonly reason?: string;
} {
  if (!step.guard) {
    return { allowed: true, halt: false };
  }

  const binding = bindings[step.guard.bindingKey];
  const response = binding as Partial<ChoiceResponse> | undefined;
  let allowed = binding !== undefined;

  if (allowed && step.guard.cancelledEquals !== undefined) {
    allowed = response?.cancelled === step.guard.cancelledEquals;
  }

  if (allowed && step.guard.selectionIncludes !== undefined) {
    allowed = responseSelectionsInclude(response?.selections, step.guard.selectionIncludes);
  }

  if (allowed && step.guard.selectionEquals !== undefined) {
    allowed = responseSelectionEquals(response?.selections, step.guard.selectionEquals);
  }

  return {
    allowed,
    halt: !allowed && step.guard.onFalse === 'halt',
    reason: allowed ? undefined : `guard_failed:${step.guard.bindingKey}`,
  };
}

function responseSelectionsInclude(selections: ChoiceResponse['selections'] | undefined, expected: string): boolean {
  if (Array.isArray(selections)) {
    return selections.includes(expected);
  }

  return selections !== undefined && String(selections) === expected;
}

function responseSelectionEquals(
  selections: ChoiceResponse['selections'] | undefined,
  expected: string | number | boolean
): boolean {
  if (Array.isArray(selections)) {
    return selections.length === 1 && selections[0] === expected;
  }

  return selections === expected;
}

function resolveFalseConditionCursor(
  program: EffectProgram,
  cursor: number,
  step: EffectProgramConditionStep
): number {
  if (!step.onFalse || step.onFalse.action === 'halt') {
    return program.steps.length;
  }

  if (step.onFalse.action === 'continue') {
    return cursor + 1;
  }

  const targetStepId = step.onFalse.stepId;
  const stepIndex = program.steps.findIndex(candidate => candidate.id === targetStepId);
  return stepIndex >= 0 ? stepIndex : program.steps.length;
}

function buildRunResult<S>(
  status: EffectProgramRunStatus,
  state: S,
  program: EffectProgram,
  cursor: number,
  bindings: Readonly<Record<string, unknown>>,
  trace: readonly EffectProgramTraceEntry[],
  events: readonly unknown[],
  blockedStep?: EffectProgramStep,
  reason?: string
): EffectProgramRunResult<S> {
  return {
    status,
    state,
    runtime: createEffectProgramRuntime({ program, state, cursor, bindings }),
    blockedStep,
    reason,
    trace,
    events,
  };
}
