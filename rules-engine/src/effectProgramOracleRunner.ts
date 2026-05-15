import type { GameState } from '../../shared/src';
import { ChoiceEventType, type ChoiceOption, type ChoiceResponse } from './choiceEventsTypes';
import { applyOracleIRStepsToGameState } from './oracleIRExecutor';
import {
  applyGrantGraveyardPermissionStep,
  applyModifyGraveyardPermissionsStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import { applyProliferateSelectedTargetIds, getProliferateChoiceTargets } from './oracleIRExecutorKeywordStepHandlers';
import type { OracleIRExecutionContext, OracleIRExecutionOptions, OracleIRExecutionResult } from './oracleIRExecutionTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
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
  lastClashWon?: boolean;
  selectorContext?: Record<string, unknown>;
}

const LAST_GRANTED_GRAVEYARD_CARDS_BINDING = '__oracleLastGrantedGraveyardCards';
const LAST_GRANTED_GRAVEYARD_PERMISSION_IDS_BINDING = '__oracleLastGrantedGraveyardPermissionIds';

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

    const topLibraryResult = applyTopLibraryChoiceCommand(state, oracleCommand.step, step, runtime);
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
    return {
      state: execution.state,
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
    const amount = quantityToStaticNumber((oracleStep as any)?.amount) ?? Number((payload as any).scryCount ?? (payload as any).surveilCount ?? 0);
    const actualCount = Math.max(0, Math.min(amount, getPlayerLibrary(args.state, args.runtime.program.controllerId).length));
    const cards = getPlayerLibrary(args.state, args.runtime.program.controllerId)
      .slice(0, actualCount)
      .map(card => normalizeTopLibraryPromptCard(card));

    return createChoiceEventFromEffectProgramChoiceRequest({
      request: {
        ...request,
        payload: {
          ...payload,
          cards,
          ...(request.type === ChoiceEventType.SCRY ? { scryCount: actualCount } : { surveilCount: actualCount }),
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
  runtime: EffectProgramRuntime<GameState>
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
    : runtime.program.controllerId;
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

function resolveClashPlayerId(
  state: GameState,
  oracleStep: OracleEffectStep | undefined,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!oracleStep || String((oracleStep as any).kind || '') !== 'clash') {
    return undefined;
  }

  const players = resolvePlayers(state, (oracleStep as any).who, ctx);
  return players.length === 1 ? String(players[0]) : undefined;
}

function findClashOpponentPlayerId(
  runtime: EffectProgramRuntime<GameState>,
  commandStep: EffectProgramCommandStep,
  oracleStep: OracleEffectStep,
  state: GameState,
  ctx: OracleIRExecutionContext
): string | undefined {
  const opponentBindingKey = findClashTargetBindingKey(runtime, commandStep);
  const selectedOpponentId = readFirstSelectionForBinding(runtime, opponentBindingKey);
  if (selectedOpponentId) {
    return selectedOpponentId;
  }

  if (!(oracleStep as any).opponent) {
    return undefined;
  }

  const opponents = resolvePlayers(state, (oracleStep as any).opponent, ctx);
  return opponents.length === 1 ? String(opponents[0]) : undefined;
}

function findClashTargetBindingKey(
  runtime: EffectProgramRuntime<GameState>,
  commandStep: EffectProgramCommandStep
): string {
  const commandIndex = runtime.program.steps.findIndex(step => step.id === commandStep.id);
  const searchSteps = commandIndex >= 0 ? runtime.program.steps.slice(0, commandIndex) : runtime.program.steps;
  for (const step of searchSteps) {
    if (step.kind !== 'choice') continue;
    const payload = step.choiceRequest?.payload as any;
    if (String(payload?.oracleStepKind || '') === 'clash_target') {
      return step.bindingKey;
    }
  }
  return '';
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

function resolvePopulatePlayerId(
  state: GameState,
  oracleStep: OracleEffectStep | undefined,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!oracleStep || String((oracleStep as any).kind || '') !== 'populate') {
    return undefined;
  }

  const players = resolvePlayers(state, (oracleStep as any).who, ctx);
  return players.length === 1 ? String(players[0]) : undefined;
}

function buildPopulateTargetChoiceOption(token: any): ChoiceOption {
  const id = String(token?.id || '').trim();
  const name = String(token?.card?.name || token?.name || id || 'Creature Token');
  return {
    id,
    label: name,
    description: 'Creature token',
    imageUrl: token?.imageUrl || token?.card?.imageUrl || token?.card?.image_uris?.normal,
  };
}

function resolveExploreTargetId(
  state: GameState,
  oracleStep: OracleEffectStep | undefined,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!oracleStep || String((oracleStep as any).kind || '') !== 'explore' || !(oracleStep as any).target) {
    return undefined;
  }

  return resolveSingleCreatureTargetId(state, (oracleStep as any).target, ctx);
}

function findBattlefieldPermanent(state: GameState, permanentId: string): any | undefined {
  return (((state as any).battlefield || []) as any[])
    .find(permanent => String(permanent?.id || '').trim() === permanentId);
}

function readPermanentName(permanent: any, fallbackId: string): string {
  return String(permanent?.card?.name || permanent?.name || fallbackId || 'Creature');
}

function isLandCard(card: any): boolean {
  return getCardTypeLine(card).includes('land');
}

function getCardTypeLine(card: any): string {
  return String(card?.type_line || card?.card?.type_line || '').toLowerCase();
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

function findFatesealTargetPlayerId(
  runtime: EffectProgramRuntime<GameState>,
  commandStep: EffectProgramCommandStep
): string | undefined {
  const fatesealBindingKey = commandStep.guard?.bindingKey;
  const fatesealChoiceStep = runtime.program.steps.find(step => (
    step.kind === 'choice' &&
    step.bindingKey === fatesealBindingKey &&
    String(step.choiceEvent?.type || step.choiceRequest?.type || '') === ChoiceEventType.FATESEAL
  ));
  const targetBindingKey = fatesealChoiceStep?.kind === 'choice'
    ? String((fatesealChoiceStep.choiceRequest?.payload as any)?.targetBindingKey || '')
    : '';
  return readFirstSelectionForBinding(runtime, targetBindingKey);
}

function readFirstSelectionForBinding(
  runtime: EffectProgramRuntime<GameState>,
  bindingKey: string
): string | undefined {
  if (!bindingKey) {
    return undefined;
  }

  const response = runtime.bindings[bindingKey] as ChoiceResponse | undefined;
  if (!response || response.cancelled) {
    return undefined;
  }

  return normalizeChoiceResponseSelections(response)[0];
}

function normalizeSelectionIdList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(selection => normalizeChoiceResponseSelection(selection)).filter(Boolean);
}

function getPlayerLibrary(state: GameState, playerId: string): readonly any[] {
  const player = (state.players || []).find(candidate => String(candidate?.id || '') === playerId) as any;
  return Array.isArray(player?.library) ? player.library : [];
}

function normalizeTopLibraryPromptCard(card: any): Record<string, unknown> {
  return {
    id: String(card?.id || ''),
    name: String(card?.name || card?.card?.name || card?.id || 'Unknown Card'),
    type_line: card?.type_line || card?.card?.type_line,
    oracle_text: card?.oracle_text || card?.card?.oracle_text,
    imageUrl: card?.imageUrl || card?.image_uris?.normal || card?.card?.imageUrl || card?.card?.image_uris?.normal,
    mana_cost: card?.mana_cost || card?.card?.mana_cost,
    cmc: card?.cmc ?? card?.card?.cmc,
  };
}

function quantityToStaticNumber(quantity: unknown): number | undefined {
  if ((quantity as any)?.kind === 'number' && Number.isFinite(Number((quantity as any).value))) {
    return Number((quantity as any).value);
  }

  return undefined;
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
    lastClashWon: typeof derived.lastClashWon === 'boolean' ? derived.lastClashWon : ctx.lastClashWon,
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

  for (const binding of Object.values(runtime.bindings)) {
    if (binding && typeof binding === 'object' && typeof (binding as any).lastClashWon === 'boolean') {
      derived.lastClashWon = (binding as any).lastClashWon;
    }
  }

  if (
    !derived.targetCreatureId &&
    !derived.targetPermanentId &&
    !derived.targetSpellId &&
    typeof derived.lastClashWon !== 'boolean' &&
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

  const targetKind = String((oracleStep as any)?.target?.kind || '');
  if (targetKind === 'target_opponent' || targetKind === 'each_opponent') {
    return false;
  }

  const raw = String((oracleStep as any)?.raw || '').toLowerCase();
  return !/\bopponent\b/.test(raw);
}
