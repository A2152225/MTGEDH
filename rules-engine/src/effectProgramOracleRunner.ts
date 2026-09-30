import type { GameState } from '../../shared/src';
import { ChoiceEventType, type ChoiceResponse } from './choiceEventsTypes';
import { applyOracleIRStepsToGameState } from './oracleIRExecutor';
import {
  applyGrantGraveyardPermissionStep,
  applyModifyGraveyardPermissionsStep,
  buildDiscardSelectionOptions,
} from './oracleIRExecutorPlayerStepHandlers';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import { applyProliferateSelectedTargetIds, getProliferateChoiceTargets } from './oracleIRExecutorKeywordStepHandlers';
import type { OracleIRExecutionContext, OracleIRExecutionOptions, OracleIRExecutionResult } from './oracleIRExecutionTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { buildSacrificeTargetSelectionOptions } from './oracleIRExecutorBattlefieldStepHandlers';
import { executePopulate, getPopulateTargets } from './keywordActions/populate';
import { parseOracleTextToIR } from './oracleIRParser';
import type { OracleEffectStep, OracleIRResult } from './oracleIR';
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
import {
  normalizeChoiceResponseSelection,
  normalizeChoiceResponseSelections,
} from './effectProgramOracleRunner-handlers/effectProgramOracleRunnerChoiceNormalize';
import {
  buildOracleIRPlayerChoiceOptions,
  buildOracleIRTargetSelectionOptions,
  hasNonEmptyChoiceOptions,
  inferOracleIRTargetTypes,
  shouldOracleIRPlayerChoiceAllowSelf,
} from './effectProgramOracleRunner-handlers/effectProgramOracleRunnerChoiceOptions';
import {
  buildPopulateTargetChoiceOption,
  findBattlefieldPermanent,
  isLandCard,
  readPermanentName,
  resolveExploreTargetId,
  resolvePopulatePlayerId,
} from './effectProgramOracleRunner-handlers/effectProgramOracleRunnerChoiceLookups';
import {
  findFatesealTargetPlayerId,
  getPlayerLibrary,
  normalizeSelectionIdList,
  normalizeTopLibraryPromptCard,
  quantityToStaticNumber,
  readFirstSelectionForBinding,
  resolveTopLibraryChoicePlayerId,
} from './effectProgramOracleRunner-handlers/effectProgramOracleRunnerLibraryLookups';
import {
  findClashOpponentPlayerId,
  resolveClashPlayerId,
} from './effectProgramOracleRunner-handlers/effectProgramOracleRunnerClashLookups';
import {
  LAST_ACTION_OUTCOME_BINDING,
  LAST_GRANTED_GRAVEYARD_CARDS_BINDING,
  LAST_GRANTED_GRAVEYARD_PERMISSION_IDS_BINDING,
  LAST_MOVED_CARDS_BINDING,
  LAST_REVEALED_CARD_COUNT_BINDING,
  LAST_SACRIFICED_PERMANENTS_BINDING,
} from './effectProgramOracleRunner-handlers/effectProgramOracleRunnerBindingKeys';
import {
  createOracleIRContextWithEffectProgramBindings,
  createOracleIROptionsWithEffectProgramBindings,
} from './effectProgramOracleRunner-handlers/effectProgramOracleRunnerContextBindings';

export interface OracleIRCommandExecutionEvent {
  readonly type: 'oracle_ir_execution';
  readonly stepId: string;
  readonly appliedStepKinds: readonly string[];
  readonly skippedStepKinds: readonly string[];
  readonly automationGapCount: number;
  readonly pendingOptionalStepCount: number;
  /** Full executor result so server bridges (e.g. deferred stack copies) after Effect Program commands. */
  readonly execution?: OracleIRExecutionResult;
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


export type OracleIREffectProgramHandlerOverrides = Omit<EffectProgramHandlers<GameState>, 'applyCommand'> & {
  readonly applyCommand?: EffectProgramHandlers<GameState>['applyCommand'];
};

export function createOracleIRCommandHandler(
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): (args: EffectProgramHandlerArgs<GameState, EffectProgramCommandStep>) => EffectProgramCommandResult<GameState> {
  return ({ state, step, runtime }) => {
    if (step.command.kind !== 'oracle_ir_step') {
      return { state };
    }

    const oracleCommand = step.command as { readonly kind: 'oracle_ir_step'; readonly step: import('./oracleIR').OracleEffectStep };
    const exploreResult = applyExploreChoiceCommand(state, oracleCommand.step, step, runtime, ctx);
    if (exploreResult) {
      return exploreResult;
    }

    const proliferateResult = applyProliferateChoiceCommand(state, oracleCommand.step, step, runtime);
    if (proliferateResult) {
      return proliferateResult;
    }

    const clashResult = applyClashChoiceCommand(state, oracleCommand.step, step, runtime, ctx);
    if (clashResult) {
      return clashResult;
    }

    const populateResult = applyPopulateChoiceCommand(state, oracleCommand.step, step, runtime, ctx);
    if (populateResult) {
      return populateResult;
    }

    const topLibraryResult = applyTopLibraryChoiceCommand(state, oracleCommand.step, step, runtime, ctx);
    if (topLibraryResult) {
      return topLibraryResult;
    }

    const graveyardGrantResult = applyGraveyardPermissionGrantCommand(state, oracleCommand.step, step, runtime, ctx);
    if (graveyardGrantResult) {
      return graveyardGrantResult;
    }

    const graveyardPermissionModifierResult = applyGraveyardPermissionModifierCommand(state, oracleCommand.step, step, runtime);
    if (graveyardPermissionModifierResult) {
      return graveyardPermissionModifierResult;
    }

    const execution = applyOracleIRStepsToGameState(
      state,
      [oracleCommand.step],
      createOracleIRContextWithEffectProgramBindings(ctx, runtime),
      createOracleIROptionsWithEffectProgramBindings(options, runtime, step)
    );
    const bindings: Record<string, unknown> = {};
    if (execution.lastStepOutcome) {
      bindings[LAST_ACTION_OUTCOME_BINDING] = execution.lastStepOutcome;
    }
    if (Array.isArray(execution.lastMovedCards) && execution.lastMovedCards.length > 0) {
      bindings[LAST_MOVED_CARDS_BINDING] = execution.lastMovedCards;
    }
    if (typeof execution.lastRevealedCardCount === 'number' && execution.lastRevealedCardCount > 0) {
      bindings[LAST_REVEALED_CARD_COUNT_BINDING] = execution.lastRevealedCardCount;
    }
    if (Array.isArray((execution as any).lastSacrificedPermanents) && (execution as any).lastSacrificedPermanents.length > 0) {
      bindings[LAST_SACRIFICED_PERMANENTS_BINDING] = (execution as any).lastSacrificedPermanents;
    }
    return {
      state: execution.state,
      ...(Object.keys(bindings).length > 0 ? { bindings } : {}),
      events: [createOracleIRCommandExecutionEvent(step.id, execution)],
    };
  };
}

function applyGraveyardPermissionGrantCommand(
  state: GameState,
  oracleStep: OracleEffectStep,
  commandStep: EffectProgramCommandStep,
  runtime: EffectProgramRuntime<GameState>,
  ctx: OracleIRExecutionContext
): EffectProgramCommandResult<GameState> | undefined {
  if (oracleStep.kind !== 'grant_graveyard_permission') return undefined;

  const result = applyGrantGraveyardPermissionStep(
    state,
    oracleStep,
    createOracleIRContextWithEffectProgramBindings(ctx, runtime)
  ) as any;
  if ('message' in result) return undefined;

  return {
    state: result.state,
    bindings: {
      [LAST_GRANTED_GRAVEYARD_CARDS_BINDING]: Array.isArray(result.lastGrantedGraveyardCards)
        ? result.lastGrantedGraveyardCards
        : [],
      [LAST_GRANTED_GRAVEYARD_PERMISSION_IDS_BINDING]: Array.isArray(result.lastGrantedGraveyardPermissionIds)
        ? result.lastGrantedGraveyardPermissionIds
        : [],
    },
    events: [createDirectOracleIRCommandExecutionEvent(commandStep.id, [oracleStep.kind], [])],
  };
}

function applyGraveyardPermissionModifierCommand(
  state: GameState,
  oracleStep: OracleEffectStep,
  commandStep: EffectProgramCommandStep,
  runtime: EffectProgramRuntime<GameState>
): EffectProgramCommandResult<GameState> | undefined {
  if (oracleStep.kind !== 'modify_graveyard_permissions') return undefined;

  const lastGrantedGraveyardCards = runtime.bindings[LAST_GRANTED_GRAVEYARD_CARDS_BINDING];
  const lastGrantedGraveyardPermissionIds = runtime.bindings[LAST_GRANTED_GRAVEYARD_PERMISSION_IDS_BINDING];
  if (!Array.isArray(lastGrantedGraveyardCards)) return undefined;

  const result = applyModifyGraveyardPermissionsStep(state, oracleStep, {
    lastGrantedGraveyardCards,
    lastGrantedGraveyardPermissionIds: Array.isArray(lastGrantedGraveyardPermissionIds) ? lastGrantedGraveyardPermissionIds : [],
  }) as any;
  if ('message' in result) {
    return {
      state,
      events: [createDirectOracleIRCommandExecutionEvent(commandStep.id, [], [oracleStep.kind])],
    };
  }

  return {
    state: result.state,
    events: [createDirectOracleIRCommandExecutionEvent(commandStep.id, [oracleStep.kind], [])],
  };
}

function createDirectOracleIRCommandExecutionEvent(
  stepId: string,
  appliedStepKinds: readonly string[],
  skippedStepKinds: readonly string[]
): OracleIRCommandExecutionEvent {
  return {
    type: 'oracle_ir_execution',
    stepId,
    appliedStepKinds,
    skippedStepKinds,
    automationGapCount: 0,
    pendingOptionalStepCount: 0,
  };
}

export function runOracleEffectProgram(
  runtime: EffectProgramRuntime<GameState>,
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {},
  handlers: OracleIREffectProgramHandlerOverrides = {}
): EffectProgramRunResult<GameState> {
  return runEffectProgram(runtime, createOracleIREffectProgramHandlers(ctx, options, handlers));
}

export function createOracleIREffectProgramHandlers(
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {},
  handlers: OracleIREffectProgramHandlerOverrides = {}
): EffectProgramHandlers<GameState> {
  const oracleCommandHandler = createOracleIRCommandHandler(ctx, options);

  return {
    ...handlers,
    createChoiceEvent: handlers.createChoiceEvent ?? ((args) => createOracleIRChoiceEvent(args, ctx)),
    evaluateCondition: handlers.evaluateCondition ?? ((args) => {
      const boundOutcome = args.runtime.bindings[LAST_ACTION_OUTCOME_BINDING] as {
        readonly kind?: string;
        readonly stepKind?: string;
        readonly count?: number;
      } | undefined;
      const lastActionOutcome = boundOutcome?.kind && boundOutcome?.stepKind
        ? {
          kind: boundOutcome.kind,
          stepKind: boundOutcome.stepKind,
          ...(typeof boundOutcome.count === 'number' ? { count: boundOutcome.count } : {}),
        } as any
        : null;

      const evaluation = evaluateConditionalWrapperCondition({
        condition: args.step.condition as any,
        nextState: args.state,
        controllerId: ctx.controllerId,
        ctx: createOracleIRContextWithEffectProgramBindings(ctx, args.runtime),
        lastActionOutcome,
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
  };
}

function createOracleIRChoiceEvent(
  args: EffectProgramHandlerArgs<GameState, EffectProgramChoiceStep>,
  ctx: OracleIRExecutionContext
) {
  const request = args.step.choiceRequest;
  if (!request) {
    return undefined;
  }

  const payload = request.payload || {};
  if (request.type === ChoiceEventType.TARGET_SELECTION && String((payload as any).oracleStepKind || '') === 'sacrifice') {
    const oracleStep = (payload as any).oracleStep as OracleEffectStep | undefined;
    const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, args.runtime);
    const built = oracleStep && oracleStep.kind === 'sacrifice'
      ? buildSacrificeTargetSelectionOptions(args.state, oracleStep, executionContext)
      : null;
    if (!built) {
      return undefined;
    }

    const choosingPlayerId =
      resolvePlayers(args.state, (oracleStep as any).who, executionContext)[0] ||
      args.runtime.program.controllerId;

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        playerId: choosingPlayerId as any,
        payload: {
          ...payload,
          validTargets: built.options,
          targetTypes: ['permanent'],
          minTargets: built.minTargets,
          maxTargets: built.maxTargets,
          targetDescription: String((oracleStep as any)?.raw || request.description),
        },
      },
    });
  }

  if (request.type === ChoiceEventType.DISCARD_SELECTION && String((payload as any).oracleStepKind || '') === 'discard') {
    const oracleStep = (payload as any).oracleStep as OracleEffectStep | undefined;
    const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, args.runtime);
    const built = oracleStep && oracleStep.kind === 'discard'
      ? buildDiscardSelectionOptions(args.state, oracleStep, executionContext)
      : null;
    if (!built) {
      return undefined;
    }

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        playerId: built.playerId as any,
        payload: {
          ...payload,
          hand: built.options,
          discardCount: built.discardCount,
          minDiscardCount: built.minDiscardCount,
          maxDiscardCount: built.maxDiscardCount,
          anyNumberDiscard: built.anyNumberDiscard === true,
          currentHandSize: built.currentHandSize,
          maxHandSize: built.maxHandSize,
          reason: 'effect',
        },
      },
    });
  }

  if (request.type === ChoiceEventType.TARGET_SELECTION && String((payload as any).oracleStepKind || '') === 'populate') {
    const oracleStep = (payload as any).oracleStep as OracleEffectStep | undefined;
    const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, args.runtime);
    const playerId = resolvePopulatePlayerId(args.state, oracleStep, executionContext) || args.runtime.program.controllerId;
    const validTargets = getPopulateTargets(args.state.battlefield || [], playerId)
      .map(token => buildPopulateTargetChoiceOption(token));

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          validTargets,
          targetTypes: ['creature token'],
          minTargets: validTargets.length > 0 ? 1 : 0,
          maxTargets: validTargets.length > 0 ? 1 : 0,
          targetDescription: String((oracleStep as any)?.raw || request.description),
        },
      },
    });
  }

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
    const validPlayers = buildOracleIRPlayerChoiceOptions(
      args.state,
      args.runtime.program.controllerId,
      oracleStep,
      {
        runtime: args.runtime,
        distinctPlayerTargets: Boolean((payload as any).distinctPlayerTargets),
      },
    );
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

  if (request.type === ChoiceEventType.EXPLORE_DECISION) {
    const oracleStep = (payload as any).oracleStep as OracleEffectStep | undefined;
    const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, args.runtime);
    const permanentId = resolveExploreTargetId(args.state, oracleStep, executionContext);
    if (!permanentId) {
      return undefined;
    }

    const permanent = findBattlefieldPermanent(args.state, permanentId);
    const controllerId = String((permanent as any)?.controller || executionContext.controllerId || args.runtime.program.controllerId || '').trim();
    const library = getPlayerLibrary(args.state, controllerId);
    const revealedCard = normalizeTopLibraryPromptCard(library[0]);

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          permanentId,
          permanentName: readPermanentName(permanent, permanentId),
          revealedCard,
          isLand: isLandCard(library[0]),
        },
      },
    });
  }

  if (request.type === ChoiceEventType.PROLIFERATE) {
    const availableTargets = getProliferateChoiceTargets(args.state);
    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          proliferateId: String((payload as any).proliferateId || `${args.runtime.program.id}:${args.step.id}`),
          availableTargets,
        },
      },
    });
  }

  if (request.type === ChoiceEventType.CLASH) {
    const oracleStep = (payload as any).oracleStep as OracleEffectStep | undefined;
    const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, args.runtime);
    const targetBindingKey = String((payload as any).targetBindingKey || '');
    const selectedOpponentId = readFirstSelectionForBinding(args.runtime, targetBindingKey);
    const clashRole = String((payload as any).clashRole || 'controller');
    const playerId = clashRole === 'opponent'
      ? selectedOpponentId
      : resolveClashPlayerId(args.state, oracleStep, executionContext) || args.runtime.program.controllerId;
    if (!playerId) {
      return undefined;
    }

    const opponentId = clashRole === 'opponent'
      ? executionContext.controllerId || args.runtime.program.controllerId
      : selectedOpponentId;
    const revealedCard = normalizeTopLibraryPromptCard(getPlayerLibrary(args.state, playerId)[0]);

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        playerId: playerId as any,
        payload: {
          ...payload,
          revealedCard,
          ...(opponentId ? { opponentId } : {}),
        },
      },
    });
  }

  if (request.type === ChoiceEventType.SCRY || request.type === ChoiceEventType.SURVEIL) {
    const oracleStep = (payload as any).oracleStep as OracleEffectStep | undefined;
    const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, args.runtime);
    const playerId = resolveTopLibraryChoicePlayerId(
      args.state,
      oracleStep,
      executionContext,
      args.runtime.program.controllerId
    );
    if (!playerId) {
      return undefined;
    }

    const amount = quantityToStaticNumber((oracleStep as any)?.amount) ?? Number((payload as any).scryCount ?? (payload as any).surveilCount ?? 0);
    const actualCount = Math.max(0, Math.min(amount, getPlayerLibrary(args.state, playerId).length));
    const cards = getPlayerLibrary(args.state, playerId)
      .slice(0, actualCount)
      .map(card => normalizeTopLibraryPromptCard(card));

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        playerId: playerId as any,
        payload: {
          ...payload,
          cards,
          ...(request.type === ChoiceEventType.SCRY ? { scryCount: actualCount } : { surveilCount: actualCount }),
        },
      },
    });
  }

  if (request.type === ChoiceEventType.X_VALUE_SELECTION && (payload as any).maxFromReferenceAmount === true) {
    const maxX = Math.max(0, Math.floor(Number(ctx.referenceAmount ?? 0)));
    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          minX: 0,
          maxX,
        },
      },
    });
  }

  if (request.type === ChoiceEventType.FATESEAL) {
    const oracleStep = (payload as any).oracleStep as OracleEffectStep | undefined;
    const targetBindingKey = String((payload as any).targetBindingKey || '');
    const opponentId = readFirstSelectionForBinding(args.runtime, targetBindingKey);
    if (!opponentId) {
      return undefined;
    }

    const amount = quantityToStaticNumber((oracleStep as any)?.amount) ?? Number((payload as any).fatesealCount ?? 0);
    const opponentLibrary = getPlayerLibrary(args.state, opponentId);
    const actualCount = Math.max(0, Math.min(amount, opponentLibrary.length));
    const opponent = (args.state.players || []).find(player => String(player?.id || '') === opponentId) as any;
    const cards = opponentLibrary.slice(0, actualCount).map(card => normalizeTopLibraryPromptCard(card));

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          opponentId,
          opponentName: String(opponent?.name || opponentId),
          cards,
          fatesealCount: actualCount,
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
    execution,
  };
}

function createSingleOracleIRCommandExecutionEvent(
  stepId: string,
  stepKind: string,
  applied: boolean
): OracleIRCommandExecutionEvent {
  return {
    type: 'oracle_ir_execution',
    stepId,
    appliedStepKinds: applied ? [stepKind] : [],
    skippedStepKinds: applied ? [] : [stepKind],
    automationGapCount: applied ? 0 : 1,
    pendingOptionalStepCount: 0,
  };
}

function applyTopLibraryChoiceCommand(
  state: GameState,
  oracleStep: OracleEffectStep,
  commandStep: EffectProgramCommandStep,
  runtime: EffectProgramRuntime<GameState>,
  ctx: OracleIRExecutionContext
): EffectProgramCommandResult<GameState> | undefined {
  const kind = String((oracleStep as any)?.kind || '');
  if (kind !== 'scry' && kind !== 'surveil' && kind !== 'fateseal') {
    return undefined;
  }

  const bindingKey = commandStep.guard?.bindingKey;
  const response = bindingKey ? runtime.bindings[bindingKey] as ChoiceResponse | undefined : undefined;
  if (!response || response.cancelled) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, kind, false)],
    };
  }

  const playerId = kind === 'fateseal'
    ? findFatesealTargetPlayerId(runtime, commandStep)
    : resolveTopLibraryChoicePlayerId(
        state,
        oracleStep,
        createOracleIRContextWithEffectProgramBindings(ctx, runtime),
        runtime.program.controllerId
      );
  if (!playerId) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, kind, false)],
    };
  }

  const library = getPlayerLibrary(state, playerId);
  const amount = quantityToStaticNumber((oracleStep as any).amount);
  if (amount === undefined || amount <= 0) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, kind, amount !== undefined)],
    };
  }

  const actualCount = Math.min(amount, library.length);
  if (actualCount <= 0) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, kind, true)],
    };
  }

  const topCards = library.slice(0, actualCount);
  const topCardById = new Map(topCards.map(card => [String((card as any)?.id || ''), card]));
  const selection = normalizeTopLibraryChoiceSelection(response.selections, kind);
  const selectedIds = [...selection.keepTopOrder, ...selection.bottomOrGraveyardOrder];
  const valid = selectedIds.length === topCards.length
    && new Set(selectedIds).size === selectedIds.length
    && selectedIds.every(id => topCardById.has(id));

  if (!valid) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, kind, false)],
    };
  }

  const keepTopCards = selection.keepTopOrder.map(id => ({ ...topCardById.get(id), zone: 'library' }));
  const remainingLibrary = library.slice(actualCount);
  const nextPlayers = state.players.map(player => {
    if (String(player.id) !== playerId) {
      return player;
    }

    if (kind === 'scry' || kind === 'fateseal') {
      const bottomCards = selection.bottomOrGraveyardOrder.map(id => ({ ...topCardById.get(id), zone: 'library' }));
      return {
        ...player,
        library: [...keepTopCards, ...remainingLibrary, ...bottomCards],
      } as any;
    }

    const graveyardCards = selection.bottomOrGraveyardOrder.map(id => ({ ...topCardById.get(id), zone: 'graveyard', faceDown: false }));
    return {
      ...player,
      library: [...keepTopCards, ...remainingLibrary],
      graveyard: [...(((player as any).graveyard || []) as any[]), ...graveyardCards],
    } as any;
  });

  return {
    state: {
      ...state,
      players: nextPlayers,
    },
    events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, kind, true)],
  };
}

function applyExploreChoiceCommand(
  state: GameState,
  oracleStep: OracleEffectStep,
  commandStep: EffectProgramCommandStep,
  runtime: EffectProgramRuntime<GameState>,
  ctx: OracleIRExecutionContext
): EffectProgramCommandResult<GameState> | undefined {
  if (String((oracleStep as any)?.kind || '') !== 'explore') {
    return undefined;
  }

  const bindingKey = commandStep.guard?.bindingKey;
  const response = bindingKey ? runtime.bindings[bindingKey] as ChoiceResponse | undefined : undefined;
  if (!response || response.cancelled) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'explore', false)],
    };
  }

  const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, runtime);
  const selection = normalizeExploreChoiceSelection(response.selections);
  const permanentId = selection.permanentId || resolveExploreTargetId(state, oracleStep, executionContext);
  if (!permanentId) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'explore', false)],
    };
  }

  const battlefield = [...(((state as any).battlefield || []) as any[])];
  const permanentIndex = battlefield.findIndex(permanent => String(permanent?.id || '').trim() === permanentId);
  if (permanentIndex < 0) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'explore', false)],
    };
  }

  const permanent = battlefield[permanentIndex] as any;
  const controllerId = String(permanent?.controller || executionContext.controllerId || runtime.program.controllerId || '').trim();
  const playerIndex = (state.players || []).findIndex(player => String((player as any)?.id || '').trim() === controllerId);
  if (playerIndex < 0) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'explore', false)],
    };
  }

  const player = (state.players as any[])[playerIndex] as any;
  const library = Array.isArray(player.library) ? [...player.library] : [];
  if (library.length <= 0) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'explore', true)],
    };
  }

  const topCard = library[0];
  const nextPlayers = (state.players as any[]).map(playerState => ({ ...playerState }));
  if (isLandCard(topCard)) {
    nextPlayers[playerIndex] = {
      ...nextPlayers[playerIndex],
      library: library.slice(1),
      hand: [...(Array.isArray(player.hand) ? player.hand : []), { ...topCard, zone: 'hand' }],
    };
    return {
      state: { ...(state as any), players: nextPlayers as any } as GameState,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'explore', true)],
    };
  }

  const counters = { ...((permanent?.counters || {}) as Record<string, number>) };
  const currentCount = Number(counters['+1/+1'] ?? 0);
  counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + 1;
  battlefield[permanentIndex] = {
    ...permanent,
    counters,
  };

  if (selection.toGraveyard) {
    nextPlayers[playerIndex] = {
      ...nextPlayers[playerIndex],
      library: library.slice(1),
      graveyard: [
        ...(Array.isArray(player.graveyard) ? player.graveyard : []),
        { ...topCard, zone: 'graveyard', faceDown: false },
      ],
    };
  }

  return {
    state: {
      ...(state as any),
      players: nextPlayers as any,
      battlefield: battlefield as any,
    } as GameState,
    events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'explore', true)],
  };
}

function normalizeExploreChoiceSelection(
  selections: ChoiceResponse['selections']
): { readonly permanentId?: string; readonly toGraveyard: boolean } {
  const record = selections && typeof selections === 'object' && !Array.isArray(selections)
    ? selections as Readonly<Record<string, unknown>>
    : {};

  const permanentId = normalizeChoiceResponseSelection(record.permanentId ?? record.selectedPermanentId ?? record.target);
  return {
    ...(permanentId ? { permanentId } : {}),
    toGraveyard: record.toGraveyard === true || record.destination === 'graveyard',
  };
}

function applyProliferateChoiceCommand(
  state: GameState,
  oracleStep: OracleEffectStep,
  commandStep: EffectProgramCommandStep,
  runtime: EffectProgramRuntime<GameState>
): EffectProgramCommandResult<GameState> | undefined {
  if (String((oracleStep as any)?.kind || '') !== 'proliferate') {
    return undefined;
  }

  const bindingKey = commandStep.guard?.bindingKey;
  const response = bindingKey ? runtime.bindings[bindingKey] as ChoiceResponse | undefined : undefined;
  if (!response || response.cancelled) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'proliferate', false)],
    };
  }

  const selectedTargetIds = normalizeChoiceResponseSelections(response);
  const result = applyProliferateSelectedTargetIds(state, selectedTargetIds);
  return {
    state: result.state,
    events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'proliferate', true)],
  };
}

function applyClashChoiceCommand(
  state: GameState,
  oracleStep: OracleEffectStep,
  commandStep: EffectProgramCommandStep,
  runtime: EffectProgramRuntime<GameState>,
  ctx: OracleIRExecutionContext
): EffectProgramCommandResult<GameState> | undefined {
  if (String((oracleStep as any)?.kind || '') !== 'clash') {
    return undefined;
  }

  const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, runtime);
  const playerId = resolveClashPlayerId(state, oracleStep, executionContext) || runtime.program.controllerId;
  const opponentId = findClashOpponentPlayerId(runtime, commandStep, oracleStep, state, executionContext);
  const playerResponse = readClashParticipantResponse(runtime, commandStep, 'controller')
    ?? readChoiceResponseForBinding(runtime, commandStep.guard?.bindingKey);
  const opponentResponse = readClashParticipantResponse(runtime, commandStep, 'opponent');
  const playerTopCard = getPlayerLibrary(state, playerId)[0];
  const opponentTopCard = opponentId ? getPlayerLibrary(state, opponentId)[0] : undefined;
  let nextState = applyClashLibraryChoice(state, playerId, playerResponse);
  if (opponentId) {
    nextState = applyClashLibraryChoice(nextState, opponentId, opponentResponse);
  }

  const lastClashWon = Boolean(playerTopCard) && (!opponentId || readCardManaValue(playerTopCard) > readCardManaValue(opponentTopCard));
  return {
    state: nextState,
    bindings: {
      [`${commandStep.id}:clash-outcome`]: {
        lastClashWon,
        ...(opponentId ? { opponentId } : {}),
      },
    },
    events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'clash', true)],
  };
}


function readClashParticipantResponse(
  runtime: EffectProgramRuntime<GameState>,
  commandStep: EffectProgramCommandStep,
  clashRole: 'controller' | 'opponent'
): ChoiceResponse | undefined {
  const commandIndex = runtime.program.steps.findIndex(step => step.id === commandStep.id);
  const searchSteps = commandIndex >= 0 ? runtime.program.steps.slice(0, commandIndex) : runtime.program.steps;
  for (let index = searchSteps.length - 1; index >= 0; index -= 1) {
    const step = searchSteps[index];
    if (step.kind !== 'choice') continue;
    const payload = step.choiceRequest?.payload as any;
    if (String(step.choiceRequest?.type || step.choiceEvent?.type || '') !== ChoiceEventType.CLASH) continue;
    if (String(payload?.clashRole || 'controller') !== clashRole) continue;
    return readChoiceResponseForBinding(runtime, step.bindingKey);
  }
  return undefined;
}

function readChoiceResponseForBinding(
  runtime: EffectProgramRuntime<GameState>,
  bindingKey: string | undefined
): ChoiceResponse | undefined {
  if (!bindingKey) {
    return undefined;
  }
  const response = runtime.bindings[bindingKey] as ChoiceResponse | undefined;
  return response && !response.cancelled ? response : undefined;
}

function applyClashLibraryChoice(
  state: GameState,
  playerId: string,
  response: ChoiceResponse | undefined
): GameState {
  if (!response || !normalizeClashPutOnBottom(response.selections)) {
    return state;
  }

  return {
    ...state,
    players: (state.players || []).map(player => {
      if (String((player as any)?.id || '').trim() !== playerId) {
        return player;
      }

      const library = Array.isArray((player as any).library) ? [...(player as any).library] : [];
      if (library.length === 0) {
        return player;
      }

      const [topCard, ...rest] = library;
      return {
        ...(player as any),
        library: [...rest, { ...topCard, zone: 'library' }],
      } as any;
    }),
  } as GameState;
}

function normalizeClashPutOnBottom(selections: ChoiceResponse['selections']): boolean {
  if (typeof selections === 'boolean') {
    return selections;
  }

  if (typeof selections === 'string') {
    return selections === 'bottom' || selections === 'true';
  }

  if (selections && typeof selections === 'object' && !Array.isArray(selections)) {
    const record = selections as Record<string, unknown>;
    return record.putOnBottom === true || record.destination === 'bottom';
  }

  return false;
}

function readCardManaValue(card: unknown): number {
  const value = Number((card as any)?.cmc ?? (card as any)?.manaValue ?? (card as any)?.card?.cmc ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function applyPopulateChoiceCommand(
  state: GameState,
  oracleStep: OracleEffectStep,
  commandStep: EffectProgramCommandStep,
  runtime: EffectProgramRuntime<GameState>,
  ctx: OracleIRExecutionContext
): EffectProgramCommandResult<GameState> | undefined {
  if (String((oracleStep as any)?.kind || '') !== 'populate') {
    return undefined;
  }

  const bindingKey = commandStep.guard?.bindingKey;
  const response = bindingKey ? runtime.bindings[bindingKey] as ChoiceResponse | undefined : undefined;
  if (!response || response.cancelled) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'populate', false)],
    };
  }

  const selectedTokenId = normalizeChoiceResponseSelections(response)[0];
  if (!selectedTokenId) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'populate', true)],
    };
  }

  const executionContext = createOracleIRContextWithEffectProgramBindings(ctx, runtime);
  const playerId = resolvePopulatePlayerId(state, oracleStep, executionContext) || runtime.program.controllerId;
  const result = executePopulate(state.battlefield || [], playerId, selectedTokenId);
  if (!result.newToken) {
    return {
      state,
      events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'populate', false)],
    };
  }

  const newToken = {
    ...(result.newToken as any),
    ownerId: playerId,
    createdBySourceId: String(ctx.sourceId || '').trim() || undefined,
    createdBySourceName: String(ctx.sourceName || '').trim() || undefined,
  };

  return {
    state: {
      ...state,
      battlefield: [...(state.battlefield || []), newToken as any],
    },
    events: [createSingleOracleIRCommandExecutionEvent(commandStep.id, 'populate', true)],
  };
}


function normalizeTopLibraryChoiceSelection(
  selections: ChoiceResponse['selections'],
  kind: 'scry' | 'surveil' | 'fateseal'
): { readonly keepTopOrder: readonly string[]; readonly bottomOrGraveyardOrder: readonly string[] } {
  const record = selections && typeof selections === 'object' && !Array.isArray(selections)
    ? selections as Readonly<Record<string, unknown>>
    : {};

  return {
    keepTopOrder: normalizeSelectionIdList(record.keepTopOrder),
    bottomOrGraveyardOrder: normalizeSelectionIdList(kind === 'surveil' ? record.toGraveyard : record.bottomOrder),
  };
}





