// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: choice-backed Oracle IR command appliers run by createOracleIRCommandHandler
// (scry / surveil / fateseal top-library order, explore, proliferate, clash, populate) plus their
// selection normalizers.
// Public entry symbols: applyTopLibraryChoiceCommand, applyExploreChoiceCommand,
// applyProliferateChoiceCommand, applyClashChoiceCommand, applyPopulateChoiceCommand.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import { ChoiceEventType, type ChoiceResponse } from '../choiceEventsTypes';
import type { EffectProgramCommandResult, EffectProgramCommandStep, EffectProgramRuntime } from '../effectProgram';
import type { OracleEffectStep } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { applyProliferateSelectedTargetIds } from '../oracleIRExecutorKeywordStepHandlers';
import { executePopulate } from '../keywordActions/populate';
import { normalizeChoiceResponseSelection, normalizeChoiceResponseSelections } from './effectProgramOracleRunnerChoiceNormalize';
import { isLandCard, resolveExploreTargetId, resolvePopulatePlayerId } from './effectProgramOracleRunnerChoiceLookups';
import {
  findFatesealTargetPlayerId,
  getPlayerLibrary,
  normalizeSelectionIdList,
  quantityToStaticNumber,
  resolveTopLibraryChoicePlayerId,
} from './effectProgramOracleRunnerLibraryLookups';
import { findClashOpponentPlayerId, resolveClashPlayerId } from './effectProgramOracleRunnerClashLookups';
import { createOracleIRContextWithEffectProgramBindings } from './effectProgramOracleRunnerContextBindings';
import { createSingleOracleIRCommandExecutionEvent } from './effectProgramOracleRunnerCommandEvents';

export function applyTopLibraryChoiceCommand(
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

export function applyExploreChoiceCommand(
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

export function applyProliferateChoiceCommand(
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

export function applyClashChoiceCommand(
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

export function applyPopulateChoiceCommand(
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
