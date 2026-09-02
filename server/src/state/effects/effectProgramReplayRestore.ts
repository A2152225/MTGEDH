import type { PlayerID } from '../../../../shared/src/index.js';
import { buildEffectProgramFromOracleIR, createEffectProgramRuntime } from '../../../../rules-engine/src/effectProgram.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { createOracleIREffectProgramHandlers } from '../../../../rules-engine/src/effectProgramOracleRunner.js';
import { ResolutionQueueManager, type ResolutionStep } from '../resolution/index.js';
import { collectTriggerExecutionSteps, buildTriggerExecutionOptionsFromSteps } from '../modules/oracleIrTriggerExecutionHelpers.js';
import { collectOracleEffectSteps } from '../modules/trigger-runtime-wiring.js';
import { resolveTriggerStackItemEffectText } from '../modules/triggerStackItemEffectText.js';
import { hydrateOracleIRPlayerZonesFromContext } from '../modules/oracleIrServerZoneSync.js';
import { extractOracleCardLookupKeys } from '../modules/oracleIrCompiledOverlayLookup.js';
import { debug, debugWarn } from '../../utils/debug.js';
import {
  getEffectProgramRuntimeForStep,
  restoreEffectProgramRuntimeStoreEntry,
  resumeEffectProgramResolution,
} from './effectProgramResolutionService.js';
import {
  readEffectProgramQueueMetadata,
  type EffectProgramQueueMetadata,
} from './effectProgramQueueAdapter.js';
import { ResolutionStepStatus, ResolutionStepType, type ResolutionStepResponse } from '../resolution/index.js';
import { isPerPlayerOptionalEffectText } from '../../../../rules-engine/src/oracleIRPerPlayerOptional.js';
import type { OracleIRExecutionOptions } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';

function getGameContext(game: any): any {
  return (game as any)?.ctx || game;
}

function findStackItemForEffectProgram(
  state: any,
  metadata: NonNullable<ReturnType<typeof readEffectProgramQueueMetadata>>,
  step: ResolutionStep,
): any {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const sourceId = String(metadata.effectProgramSourceId || step.sourceId || '').trim();
  const sourceName = String(metadata.effectProgramSourceName || step.sourceName || '').trim();
  const deferredItem = (step as any)?.deferredTriggeredAbilityItem;

  if (sourceId) {
    const byId = stack.find((item: any) =>
      String(item?.id || '') === sourceId
      || String(item?.cardId || '') === sourceId
      || String(item?.card?.id || '') === sourceId
      || String(item?.source || '') === sourceId,
    );
    if (byId) return byId;
    // Known source id missed — last-known deferred item, never a different same-named stack object.
    if (deferredItem && typeof deferredItem === 'object') return deferredItem;
    return undefined;
  }

  if (deferredItem && typeof deferredItem === 'object') {
    return deferredItem;
  }

  if (sourceName) {
    const byName = stack.find((item: any) =>
      String(item?.sourceName || '') === sourceName
      || String(item?.card?.name || '') === sourceName,
    );
    if (byName) return byName;
  }

  return undefined;
}

function hydrateGameStateForEffectProgram(game: any): any {
  const ctx = getGameContext(game);
  const state = (ctx as any)?.state || (game as any)?.state;
  if (!state) return state;
  hydrateOracleIRPlayerZonesFromContext(ctx, state);
  return state;
}

export function restoreEffectProgramRuntimeForPendingStep(
  game: any,
  gameId: string,
  step: ResolutionStep,
): boolean {
  if ((step as any)?.effectProgramPrompt !== true) return false;
  if (getEffectProgramRuntimeForStep(gameId, step.id)) return true;

  const metadata = readEffectProgramQueueMetadata(step);
  if (!metadata) return false;

  const effectProgramFamily = String(metadata.effectProgramFamily || (step as any)?.effectProgramFamily || '').trim();
  if (effectProgramFamily === 'optional_triggered_ability') {
    const effectText = [
      (step as any)?.effectText,
      (step as any)?.fullAbilityText,
      step.description,
      (step as any)?.triggerDescription,
    ].filter(Boolean).join(' ');
    if (isPerPlayerOptionalEffectText(effectText)) {
      return false;
    }
  }

  const state = hydrateGameStateForEffectProgram(game);
  const stackItem = findStackItemForEffectProgram(state, metadata, step);
  const controller = String(step.playerId || stackItem?.controller || '').trim() as PlayerID;
  if (!controller) return false;

  const sourceName = String(metadata.effectProgramSourceName || step.sourceName || stackItem?.sourceName || stackItem?.card?.name || 'Ability');
  const sourceId = String(metadata.effectProgramSourceId || step.sourceId || stackItem?.id || stackItem?.card?.id || '').trim();
  const family = String(metadata.effectProgramFamily || (step as any)?.effectProgramFamily || 'trigger_resolution').trim();

  let steps;
  let executionOptions: OracleIRExecutionOptions = { allowOptional: true };
  let sourceObjectType: 'spell' | 'ability' = 'ability';

  if (
    stackItem?.type === 'spell'
    || family.includes('spell')
    || family === 'spell_resolution'
  ) {
    sourceObjectType = 'spell';
    const oracleText = String(stackItem?.card?.oracle_text || (step as any)?.oracleText || '').trim();
    if (!oracleText) return false;
    const cardKeys = extractOracleCardLookupKeys({
      cardName: sourceName,
      sourceName,
      triggerItem: stackItem,
    });
    steps = collectOracleEffectSteps(oracleText, sourceName, cardKeys);
  } else if (family === 'activated_ability_resolution') {
    // P2c: restore activated-ability Effect Programs after reconnect/replay.
    sourceObjectType = 'ability';
    const oracleText = String(
      stackItem?.activatedOracleText
      || stackItem?.abilityText
      || stackItem?.description
      || stackItem?.card?.oracle_text
      || (step as any)?.oracleText
      || (step as any)?.effectText
      || '',
    ).trim();
    if (!oracleText) return false;
    const cardKeys = extractOracleCardLookupKeys({
      cardName: sourceName,
      sourceName,
      triggerItem: stackItem,
      card: stackItem?.card,
    });
    steps = collectOracleEffectSteps(oracleText, sourceName, cardKeys);
  } else {
    const effectText = resolveTriggerStackItemEffectText(stackItem || {}, { state });
    if (!effectText) return false;
    steps = collectTriggerExecutionSteps(effectText, sourceName, stackItem);
    executionOptions = buildTriggerExecutionOptionsFromSteps(steps, stackItem);
  }

  if (!Array.isArray(steps) || steps.length === 0) return false;

  try {
    const chosenColor = String(stackItem?.chosenColor || stackItem?.card?.chosenColor || '').trim();
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: controller,
        sourceId,
        sourceName,
        sourceObjectType,
        selectorContext: {
          ...(chosenColor ? { chosenMana: chosenColor } : {}),
        },
      },
      {},
    );

    const program = buildEffectProgramFromOracleIR({
      id: metadata.effectProgramId,
      controllerId: controller,
      sourceId,
      sourceName,
      steps,
      metadata: {
        family,
        ...(stackItem ? { triggerItem: stackItem, spellItem: stackItem } : {}),
      },
    });

    const handlers = createOracleIREffectProgramHandlers(
      { ...irCtx, deferStackSpellCopiesToServer: true },
      executionOptions,
    );

    const runtime = createEffectProgramRuntime({
      program,
      state,
      cursor: metadata.effectProgramCursor,
      bindings: {},
    });

    restoreEffectProgramRuntimeStoreEntry(gameId, step.id, {
      runtime,
      handlers: handlers as any,
      oracleIrBridge: {
        irCtx: { ...irCtx, deferStackSpellCopiesToServer: true },
        controller,
        sourceName,
        sourceId,
        triggerItem: stackItem,
      },
    });

    debug(2, `[effectProgramReplay] Restored runtime for ${sourceName} step ${step.id} (${step.type})`);
    return true;
  } catch (err) {
    debugWarn(1, `[effectProgramReplay] Failed to restore runtime for ${sourceName}:`, err);
    return false;
  }
}

export interface ReplayEffectProgramChoicePayload {
  readonly playerId: string;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly resolvedStepId: string;
  readonly effectProgram: EffectProgramQueueMetadata;
  readonly choiceBinding: {
    readonly bindingKey: string;
    readonly response: {
      readonly eventId?: string;
      readonly playerId: string;
      readonly selections?: unknown;
      readonly cancelled?: boolean;
      readonly timestamp?: number;
    };
  };
  readonly deferredTriggeredAbilityItem?: unknown;
}

function mergeEffectProgramReplayStateIntoContext(ctx: any, game: any): void {
  const nextState = (game as any)?.state;
  if (!nextState || !ctx?.state) {
    return;
  }

  if (nextState.life && typeof nextState.life === 'object') {
    ctx.state.life = { ...nextState.life };
  }

  if (Array.isArray(nextState.players)) {
    ctx.state.players = nextState.players.map((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || ctx.state.life?.[playerId] === undefined) {
        return player;
      }
      return {
        ...player,
        life: ctx.state.life[playerId],
      };
    });
  }

  if (nextState.zones && typeof nextState.zones === 'object') {
    ctx.state.zones = nextState.zones;
  }
}

export function buildResolutionStepFromReplayChoicePayload(
  payload: ReplayEffectProgramChoicePayload,
): ResolutionStep {
  const metadata = payload.effectProgram;
  const replayStep = {
    id: payload.resolvedStepId,
    type: ResolutionStepType.OPTION_CHOICE as const,
    playerId: payload.playerId,
    sourceId: payload.sourceId,
    sourceName: payload.sourceName,
    description: payload.sourceName || 'Resolve effect choice',
    mandatory: true,
    status: ResolutionStepStatus.PENDING,
    createdAt: payload.choiceBinding.response.timestamp ?? Date.now(),
    priority: 0,
    options: [],
    minSelections: 0,
    maxSelections: 1,
    effectProgramPrompt: true,
    effectProgramId: metadata.effectProgramId,
    effectProgramFamily: metadata.effectProgramFamily,
    effectProgramSourceId: metadata.effectProgramSourceId,
    effectProgramSourceName: metadata.effectProgramSourceName,
    effectProgramCursor: metadata.effectProgramCursor,
    effectProgramStepId: metadata.effectProgramStepId,
    effectProgramBindingKey: metadata.effectProgramBindingKey,
    effectProgramClause: metadata.effectProgramClause,
    ...(payload.deferredTriggeredAbilityItem
      ? { deferredTriggeredAbilityItem: payload.deferredTriggeredAbilityItem }
      : {}),
  };
  return replayStep;
}

export function applyEffectProgramChoiceBindingOnReplay(
  ctx: any,
  gameId: string,
  payload: ReplayEffectProgramChoicePayload,
  options: { readonly queuePendingChoices?: boolean } = {},
): boolean {
  const step = buildResolutionStepFromReplayChoicePayload(payload);
  const game = {
    state: ctx.state,
    ctx,
    libraries: ctx.libraries,
    isReplaying: true,
    bumpSeq: typeof ctx.bumpSeq === 'function' ? () => ctx.bumpSeq() : undefined,
  };

  if (!restoreEffectProgramRuntimeForPendingStep(game, gameId, step)) {
    return false;
  }

  const bindingResponse = payload.choiceBinding.response;
  const response: ResolutionStepResponse = {
    stepId: payload.resolvedStepId,
    playerId: String(bindingResponse.playerId || payload.playerId || '').trim(),
    selections: bindingResponse.selections as ResolutionStepResponse['selections'],
    cancelled: bindingResponse.cancelled === true,
    timestamp: bindingResponse.timestamp ?? Date.now(),
  };

  const resumed = resumeEffectProgramResolution({
    game,
    gameId,
    step,
    response,
    persistPrompt: false,
    queuePendingChoices: options.queuePendingChoices ?? false,
  });

  if (!resumed.resumed) {
    return false;
  }

  mergeEffectProgramReplayStateIntoContext(ctx, game);
  return true;
}

export function restoreAllPendingEffectProgramRuntimes(game: any, gameId: string): number {
  const queue = ResolutionQueueManager.getQueue(gameId);
  let restored = 0;
  for (const step of queue.steps) {
    if (restoreEffectProgramRuntimeForPendingStep(game, gameId, step)) {
      restored += 1;
    }
  }
  return restored;
}
