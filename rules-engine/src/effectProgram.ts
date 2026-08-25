import type { GameState, PlayerID } from '../../shared/src';
import { ChoiceEventType, type ChoiceEvent, type ChoiceOption, type ChoiceResponse } from './choiceEventsTypes';
import { isEachPlayerMayPutCountersOnCreatureTheyControlStep } from './oracleIRCounterPlacement';

import type {
  EffectProgramStepKind,
  EffectProgramClauseRef,
  EffectProgramStepGuard,
  BaseEffectProgramStep,
  EffectProgramConditionStep,
  EffectProgramCommand,
  EffectProgramCommandStep,
  EffectProgramChoiceRequest,
  EffectProgramChoiceEventInput,
  EffectProgramChoiceStep,
  EffectProgramKeywordStep,
  EffectProgramNoteStep,
  EffectProgramStep,
  EffectProgram,
  EffectProgramRuntime,
  EffectProgramTraceEntry,
  EffectProgramConditionEvaluation,
  EffectProgramHandlerArgs,
  EffectProgramCommandResult,
  EffectProgramHandlers,
  EffectProgramChoicePause,
  EffectProgramRunStatus,
  EffectProgramRunResult,
  BuildEffectProgramFromOracleIRInput,
} from './effectProgram-handlers/effectProgramTypes.js';
import { BASIC_LAND_TYPE_OPTIONS } from './effectProgram-handlers/effectProgramTypes.js';
export type {
  EffectProgramStepKind,
  EffectProgramClauseRef,
  EffectProgramStepGuard,
  BaseEffectProgramStep,
  EffectProgramConditionStep,
  EffectProgramCommand,
  EffectProgramCommandStep,
  EffectProgramChoiceRequest,
  EffectProgramChoiceEventInput,
  EffectProgramChoiceStep,
  EffectProgramKeywordStep,
  EffectProgramNoteStep,
  EffectProgramStep,
  EffectProgram,
  EffectProgramRuntime,
  EffectProgramTraceEntry,
  EffectProgramConditionEvaluation,
  EffectProgramHandlerArgs,
  EffectProgramCommandResult,
  EffectProgramHandlers,
  EffectProgramChoicePause,
  EffectProgramRunStatus,
  EffectProgramRunResult,
  BuildEffectProgramFromOracleIRInput,
} from './effectProgram-handlers/effectProgramTypes.js';


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

    case ChoiceEventType.BASIC_LAND_TYPE_CHOICE:
      return {
        ...base,
        type: ChoiceEventType.BASIC_LAND_TYPE_CHOICE,
        options: asChoiceOptions(payload.options) || BASIC_LAND_TYPE_OPTIONS.map((landType, idx) => ({
          id: `basic_land_${idx}`,
          label: landType,
          value: landType,
        })),
        minSelections: asNumber(payload.minSelections, 1),
        maxSelections: asNumber(payload.maxSelections, 1),
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

    case ChoiceEventType.MODE_SELECTION: {
      const pBudgetRaw = Number(payload.pBudget);
      const hasPBudget = Number.isFinite(pBudgetRaw) && pBudgetRaw > 0;
      const canRepeatModes = asBoolean(payload.canRepeatModes, asBoolean(payload.allowDuplicates, false));
      return {
        ...base,
        type: ChoiceEventType.MODE_SELECTION,
        modes: asChoiceOptions(payload.modes) || [],
        minModes: asNumber(payload.minModes, 1),
        maxModes: asNumber(payload.maxModes, 1),
        allowDuplicates: canRepeatModes,
        ...(hasPBudget ? { pBudget: Math.floor(pBudgetRaw), canRepeatModes } : {}),
      } as ChoiceEvent;
    }

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

    case ChoiceEventType.DISCARD_SELECTION:
      return {
        ...base,
        type: ChoiceEventType.DISCARD_SELECTION,
        hand: asChoiceOptions(payload.hand) || [],
        discardCount: asNumber(payload.discardCount, 1),
        ...(payload.anyNumberDiscard === true ? { anyNumberDiscard: true } : {}),
        ...(payload.minDiscardCount !== undefined ? { minDiscardCount: asNumber(payload.minDiscardCount, 0) } : {}),
        ...(payload.maxDiscardCount !== undefined ? { maxDiscardCount: asNumber(payload.maxDiscardCount, 0) } : {}),
        currentHandSize: asNumber(payload.currentHandSize, 0),
        maxHandSize: asNumber(payload.maxHandSize, 0),
        reason: payload.reason === 'cleanup' ? 'cleanup' : 'effect',
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

export { buildEffectProgramFromOracleIR } from './effectProgram-handlers/effectProgramAppendOracleStep.js';

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
    return selections.some((selection) => normalizeGuardSelection(selection) === expected);
  }

  return selections !== undefined && normalizeGuardSelection(selections) === expected;
}

function responseSelectionEquals(
  selections: ChoiceResponse['selections'] | undefined,
  expected: string | number | boolean
): boolean {
  const expectedText = String(expected);
  if (Array.isArray(selections)) {
    return selections.length === 1 && normalizeGuardSelection(selections[0]) === expectedText;
  }

  return selections !== undefined && normalizeGuardSelection(selections) === expectedText;
}

function normalizeGuardSelection(selection: unknown): string {
  if (selection === undefined || selection === null) return '';
  if (typeof selection === 'string' || typeof selection === 'number' || typeof selection === 'boolean') {
    return String(selection).trim();
  }
  if (typeof selection === 'object') {
    const record = selection as Record<string, unknown>;
    for (const key of ['id', 'value', 'label', 'selection']) {
      if (record[key] !== undefined && record[key] !== null) {
        return String(record[key]).trim();
      }
    }
  }
  return '';
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
