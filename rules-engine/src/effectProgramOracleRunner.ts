import type { GameState } from '../../shared/src';
import { ChoiceEventType, type ChoiceOption, type ChoiceResponse } from './choiceEventsTypes';
import { applyOracleIRStepsToGameState } from './oracleIRExecutor';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import type { OracleIRExecutionContext, OracleIRExecutionOptions, OracleIRExecutionResult } from './oracleIRExecutionTypes';
import { parseOracleTextToIR } from './oracleIRParser';
import type { OracleIRResult } from './oracleIR';
import {
  buildEffectProgramFromOracleIR,
  createChoiceEventFromEffectProgramChoiceRequest,
  runEffectProgram,
  type BuildEffectProgramFromOracleIRInput,
  type EffectProgram,
  type EffectProgramCommandResult,
  type EffectProgramCommandStep,
  type EffectProgramChoiceStep,
  type EffectProgramHandlerArgs,
  type EffectProgramHandlers,
  type EffectProgramRunResult,
  type EffectProgramRuntime,
} from './effectProgram';

export interface OracleIRCommandExecutionEvent {
  readonly type: 'oracle_ir_execution';
  readonly stepId: string;
  readonly appliedStepKinds: readonly string[];
  readonly skippedStepKinds: readonly string[];
  readonly automationGapCount: number;
  readonly pendingOptionalStepCount: number;
}

export interface BuildEffectProgramsFromOracleTextInput {
  readonly idPrefix: string;
  readonly oracleText: string;
  readonly controllerId: BuildEffectProgramFromOracleIRInput['controllerId'];
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly sourceImage?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface BuildEffectProgramsFromOracleTextResult {
  readonly ir: OracleIRResult;
  readonly programs: readonly EffectProgram[];
}

interface DerivedOracleIRContextBindings {
  targetCreatureId?: string;
  targetPermanentId?: string;
  targetSpellId?: string;
  selectorContext?: Record<string, unknown>;
}

export function createOracleIRCommandHandler(
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): (args: EffectProgramHandlerArgs<GameState, EffectProgramCommandStep>) => EffectProgramCommandResult<GameState> {
  return ({ state, step, runtime }) => {
    if (step.command.kind !== 'oracle_ir_step') {
      return { state };
    }

    const oracleCommand = step.command as { readonly kind: 'oracle_ir_step'; readonly step: import('./oracleIR').OracleEffectStep };
    const execution = applyOracleIRStepsToGameState(
      state,
      [oracleCommand.step],
      createOracleIRContextWithEffectProgramBindings(ctx, runtime),
      createOracleIROptionsWithEffectProgramBindings(options, runtime, step)
    );
    return {
      state: execution.state,
      events: [createOracleIRCommandExecutionEvent(step.id, execution)],
    };
  };
}

export function runOracleEffectProgram(
  runtime: EffectProgramRuntime<GameState>,
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {},
  handlers: Omit<EffectProgramHandlers<GameState>, 'applyCommand'> & {
    readonly applyCommand?: EffectProgramHandlers<GameState>['applyCommand'];
  } = {}
): EffectProgramRunResult<GameState> {
  const oracleCommandHandler = createOracleIRCommandHandler(ctx, options);

  return runEffectProgram(runtime, {
    ...handlers,
    createChoiceEvent: handlers.createChoiceEvent ?? createOracleIRChoiceEvent,
    evaluateCondition: handlers.evaluateCondition ?? ((args) => {
      const evaluation = evaluateConditionalWrapperCondition({
        condition: args.step.condition as any,
        nextState: args.state,
        controllerId: ctx.controllerId,
        ctx: createOracleIRContextWithEffectProgramBindings(ctx, args.runtime),
        lastActionOutcome: null,
        lastConditionalEvaluation: null,
      });
      return evaluation === null ? 'unknown' : evaluation;
    }),
    applyCommand: (args) => {
      if (args.step.command.kind === 'oracle_ir_step') {
        return oracleCommandHandler(args);
      }

      return handlers.applyCommand?.(args) ?? args.state;
    },
  });
}

function createOracleIRChoiceEvent(
  args: EffectProgramHandlerArgs<GameState, EffectProgramChoiceStep>
) {
  const request = args.step.choiceRequest;
  if (!request) {
    return undefined;
  }

  const payload = request.payload || {};
  if (request.type === ChoiceEventType.TARGET_SELECTION && !hasNonEmptyChoiceOptions(payload.validTargets)) {
    const oracleStep = (payload as any).oracleStep;
    const validTargets = buildOracleIRTargetSelectionOptions(
      args.state,
      args.runtime.program.controllerId,
      oracleStep,
      args.runtime.program.sourceId
    );
    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          validTargets,
          targetTypes: inferOracleIRTargetTypes(oracleStep),
          minTargets: Number((payload as any).minTargets ?? 1),
          maxTargets: Number((payload as any).maxTargets ?? 1),
          targetDescription: String((oracleStep as any)?.raw || request.description),
        },
      },
    });
  }

  if (request.type === ChoiceEventType.PLAYER_CHOICE && !hasNonEmptyChoiceOptions(payload.validPlayers)) {
    const oracleStep = (payload as any).oracleStep;
    const validPlayers = buildOracleIRPlayerChoiceOptions(args.state, args.runtime.program.controllerId, oracleStep);
    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          validPlayers,
          allowSelf: shouldOracleIRPlayerChoiceAllowSelf(oracleStep),
          allowOpponents: true,
        },
      },
    });
  }

  return createChoiceEventFromEffectProgramChoiceRequest({ request });
}

export function buildEffectProgramsFromOracleText(
  input: BuildEffectProgramsFromOracleTextInput
): BuildEffectProgramsFromOracleTextResult {
  const ir = parseOracleTextToIR(input.oracleText, input.sourceName);
  const programs = ir.abilities.map((ability, abilityIndex) => buildEffectProgramFromOracleIR({
    id: `${input.idPrefix}:ability-${abilityIndex}`,
    controllerId: input.controllerId,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceImage: input.sourceImage,
    steps: ability.steps,
    interveningIf: ability.interveningIf,
    abilityIndex,
    metadata: {
      ...(input.metadata || {}),
      abilityType: ability.type,
      abilityText: ability.text,
      effectText: ability.effectText,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
    },
  }));

  return { ir, programs };
}

function createOracleIRCommandExecutionEvent(
  stepId: string,
  execution: OracleIRExecutionResult
): OracleIRCommandExecutionEvent {
  return {
    type: 'oracle_ir_execution',
    stepId,
    appliedStepKinds: execution.appliedSteps.map(step => step.kind),
    skippedStepKinds: execution.skippedSteps.map(step => step.kind),
    automationGapCount: execution.automationGaps.length,
    pendingOptionalStepCount: execution.pendingOptionalSteps.length,
  };
}

function createOracleIRContextWithEffectProgramBindings(
  ctx: OracleIRExecutionContext,
  runtime: EffectProgramRuntime<GameState>
): OracleIRExecutionContext {
  const derived = deriveOracleIRContextFromEffectProgramBindings(runtime);
  if (!derived) {
    return ctx;
  }

  return {
    ...ctx,
    targetCreatureId: derived.targetCreatureId || ctx.targetCreatureId,
    targetPermanentId: derived.targetPermanentId || ctx.targetPermanentId,
    targetSpellId: derived.targetSpellId || ctx.targetSpellId,
    selectorContext: {
      ...(ctx.selectorContext || {}),
      ...(derived.selectorContext || {}),
    },
  };
}

function createOracleIROptionsWithEffectProgramBindings(
  options: OracleIRExecutionOptions,
  runtime: EffectProgramRuntime<GameState>,
  commandStep?: EffectProgramCommandStep
): OracleIRExecutionOptions {
  const selectedModeIds = findSelectedModeIdsForCommand(runtime, commandStep);
  if (selectedModeIds.length > 0) {
    return {
      ...options,
      selectedModeIds,
    };
  }

  return options;
}

function findSelectedModeIdsForCommand(
  runtime: EffectProgramRuntime<GameState>,
  commandStep?: EffectProgramCommandStep
): readonly string[] {
  const preferredBindingKey = commandStep?.guard?.bindingKey;
  if (preferredBindingKey) {
    const preferred = readSelectedModeIdsForBinding(runtime, preferredBindingKey);
    if (preferred.length > 0) {
      return preferred;
    }
  }

  const commandIndex = commandStep
    ? runtime.program.steps.findIndex(step => step.id === commandStep.id)
    : -1;
  if (commandIndex > 0) {
    for (let index = commandIndex - 1; index >= 0; index -= 1) {
      const step = runtime.program.steps[index];
      if (step?.kind !== 'choice') {
        continue;
      }

      const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
      if (choiceType !== ChoiceEventType.MODE_SELECTION) {
        continue;
      }

      const selectedModeIds = readSelectedModeIdsForBinding(runtime, step.bindingKey);
      if (selectedModeIds.length > 0) {
        return selectedModeIds;
      }
    }
  }

  for (const step of runtime.program.steps) {
    if (step.kind !== 'choice') {
      continue;
    }

    const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
    if (choiceType !== ChoiceEventType.MODE_SELECTION) {
      continue;
    }

    const response = runtime.bindings[step.bindingKey] as ChoiceResponse | undefined;
    if (!response || response.cancelled) {
      continue;
    }

    const selectedModeIds = readSelectedModeIdsForBinding(runtime, step.bindingKey);
    if (selectedModeIds.length > 0) {
      return selectedModeIds;
    }
  }

  return [];
}

function readSelectedModeIdsForBinding(
  runtime: EffectProgramRuntime<GameState>,
  bindingKey: string
): readonly string[] {
  const step = runtime.program.steps.find(candidate => candidate.kind === 'choice' && candidate.bindingKey === bindingKey);
  if (step?.kind !== 'choice') {
    return [];
  }

  const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
  if (choiceType !== ChoiceEventType.MODE_SELECTION) {
    return [];
  }

  const response = runtime.bindings[bindingKey] as ChoiceResponse | undefined;
  if (!response || response.cancelled) {
    return [];
  }

  return normalizeChoiceResponseSelections(response);
}

function deriveOracleIRContextFromEffectProgramBindings(
  runtime: EffectProgramRuntime<GameState>
): DerivedOracleIRContextBindings | undefined {
  const selectorContext: Record<string, unknown> = {};
  const derived: DerivedOracleIRContextBindings = {};

  for (const step of runtime.program.steps) {
    if (step.kind !== 'choice') {
      continue;
    }

    const response = runtime.bindings[step.bindingKey] as ChoiceResponse | undefined;
    if (!response || response.cancelled) {
      continue;
    }

    const selections = normalizeChoiceResponseSelections(response);
    const firstSelection = selections[0];
    if (!firstSelection) {
      continue;
    }

    const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
    if (choiceType === ChoiceEventType.TARGET_SELECTION) {
      selectorContext.chosenObjectIds = selections;
      const targetKind = classifyChoiceTarget(runtime.state, firstSelection, runtime.program.controllerId);
      if (targetKind === 'player') {
        selectorContext.targetPlayerId = firstSelection;
        if (firstSelection !== runtime.program.controllerId) {
          selectorContext.targetOpponentId = firstSelection;
        }
      } else if (targetKind === 'creature') {
        derived.targetCreatureId = firstSelection;
        derived.targetPermanentId = firstSelection;
      } else {
        derived.targetPermanentId = firstSelection;
      }
      continue;
    }

    if (choiceType === ChoiceEventType.PLAYER_CHOICE) {
      selectorContext.targetPlayerId = firstSelection;
      if (firstSelection !== runtime.program.controllerId) {
        selectorContext.targetOpponentId = firstSelection;
      }
      continue;
    }

    if (choiceType === ChoiceEventType.COLOR_CHOICE) {
      selectorContext.chosenMana = normalizeChosenManaSelection(firstSelection);
      continue;
    }

    if (choiceType === ChoiceEventType.CREATURE_TYPE_CHOICE) {
      selectorContext.chosenCreatureType = firstSelection;
      continue;
    }

    if (choiceType === ChoiceEventType.CARD_NAME_CHOICE) {
      selectorContext.chosenCardName = firstSelection;
      continue;
    }

    const oracleStepKind = String((step.choiceRequest?.payload as any)?.oracleStepKind || '');
    if (oracleStepKind === 'choose_target_creature') {
      selectorContext.chosenObjectIds = selections;
      derived.targetCreatureId = firstSelection;
      derived.targetPermanentId = firstSelection;
    }
  }

  if (
    !derived.targetCreatureId &&
    !derived.targetPermanentId &&
    !derived.targetSpellId &&
    Object.keys(selectorContext).length === 0
  ) {
    return undefined;
  }

  return {
    ...derived,
    selectorContext,
  };
}

function normalizeChoiceResponseSelections(response: ChoiceResponse): readonly string[] {
  const selections = response.selections;
  if (Array.isArray(selections)) {
    return selections.map(selection => normalizeChoiceResponseSelection(selection)).filter(Boolean);
  }

  if (typeof selections === 'number' || typeof selections === 'boolean') {
    return [String(selections)];
  }

  return [];
}

function normalizeChoiceResponseSelection(selection: unknown): string {
  if (selection === undefined || selection === null) {
    return '';
  }

  if (typeof selection === 'string' || typeof selection === 'number' || typeof selection === 'boolean') {
    return String(selection).trim();
  }

  if (typeof selection === 'object') {
    const record = selection as Record<string, unknown>;
    for (const key of ['id', 'value', 'selection', 'selectedId', 'selectedCardId', 'selectedTargetId', 'target']) {
      if (record[key] !== undefined && record[key] !== null) {
        return String(record[key]).trim();
      }
    }
    return '';
  }

  return String(selection).trim();
}

function classifyChoiceTarget(
  state: GameState,
  targetId: string,
  controllerId: string
): 'creature' | 'permanent' | 'player' {
  const player = (state.players || []).find(candidate => String(candidate.id || '').trim() === targetId);
  if (player) {
    return 'player';
  }

  const permanent = ((state as any).battlefield || []).find((candidate: any) => String(candidate?.id || '').trim() === targetId);
  const typeLine = String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || '').toLowerCase();
  if (typeLine.includes('creature')) {
    return 'creature';
  }

  void controllerId;
  return 'permanent';
}

function normalizeChosenManaSelection(selection: string): string {
  const normalized = selection.trim();
  if (/^\{[WUBRG]\}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }

  if (/^[WUBRG]$/i.test(normalized)) {
    return `{${normalized.toUpperCase()}}`;
  }

  const colorNameToSymbol: Record<string, string> = {
    white: '{W}',
    blue: '{U}',
    black: '{B}',
    red: '{R}',
    green: '{G}',
  };
  return colorNameToSymbol[normalized.toLowerCase()] || normalized.toUpperCase();
}

function hasNonEmptyChoiceOptions(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function inferOracleIRTargetTypes(oracleStep: unknown): readonly string[] {
  const kind = String((oracleStep as any)?.kind || '');
  if (kind === 'choose_target_creature') {
    return ['creature'];
  }

  return ['object'];
}

function buildOracleIRTargetSelectionOptions(
  state: GameState,
  controllerId: string,
  oracleStep: unknown,
  programSourceId?: string
): readonly ChoiceOption[] {
  const kind = String((oracleStep as any)?.kind || '');
  if (kind !== 'choose_target_creature') {
    return [];
  }

  const rawTargetText = String(
    (oracleStep as any)?.target?.text ||
    (oracleStep as any)?.target?.raw ||
    (oracleStep as any)?.raw ||
    ''
  ).toLowerCase();
  const requiresYouControl = /\byou control\b/.test(rawTargetText);
  const requiresOpponentControl = /\bopponents? controls?\b|\ban opponent controls\b/.test(rawTargetText);
  const requiresNotYouControl = /\byou (?:do not|don['’]t) control\b/.test(rawTargetText);
  const sourceId = String((oracleStep as any)?.sourceId || programSourceId || '').trim();

  return (((state as any).battlefield || []) as any[])
    .filter(permanent => {
      const permanentId = String(permanent?.id || '').trim();
      if (!permanentId || (sourceId && permanentId === sourceId && /\banother\b/.test(rawTargetText))) {
        return false;
      }

      const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) {
        return false;
      }

      const permanentController = String(permanent?.controller || '').trim();
      if (requiresYouControl && permanentController !== controllerId) {
        return false;
      }

      if ((requiresOpponentControl || requiresNotYouControl) && permanentController === controllerId) {
        return false;
      }

      return true;
    })
    .map(permanent => {
      const id = String(permanent?.id || '').trim();
      const name = String(permanent?.card?.name || permanent?.name || id);
      return {
        id,
        label: name,
        description: String(permanent?.card?.type_line || permanent?.type_line || 'Creature'),
      };
    });
}

function buildOracleIRPlayerChoiceOptions(
  state: GameState,
  controllerId: string,
  oracleStep: unknown
): readonly { id: string; name: string }[] {
  const kind = String((oracleStep as any)?.kind || '');
  const allowSelf = shouldOracleIRPlayerChoiceAllowSelf(oracleStep);
  return (state.players || [])
    .filter(player => {
      const playerId = String(player?.id || '').trim();
      if (!playerId) {
        return false;
      }

      if ((kind === 'choose_opponent' || !allowSelf) && playerId === controllerId) {
        return false;
      }

      return true;
    })
    .map(player => ({
      id: String(player.id),
      name: String((player as any).name || player.id),
    }));
}

function shouldOracleIRPlayerChoiceAllowSelf(oracleStep: unknown): boolean {
  const kind = String((oracleStep as any)?.kind || '');
  if (kind === 'choose_opponent') {
    return false;
  }

  const raw = String((oracleStep as any)?.raw || '').toLowerCase();
  return !/\bopponent\b/.test(raw);
}
