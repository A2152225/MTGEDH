import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionContext, OracleIRExecutionOptions } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { ChoiceResponse } from '../../../../rules-engine/src/choiceEventsTypes.js';
import {
  buildEffectProgramFromOracleIR,
  createEffectProgramRuntime,
  type EffectProgram,
} from '../../../../rules-engine/src/effectProgram.js';
import {
  createOracleIREffectProgramHandlers,
  runOracleEffectProgram,
} from '../../../../rules-engine/src/effectProgramOracleRunner.js';
import type { GameContext } from '../context.js';
import { startEffectProgramResolution } from '../effects/effectProgramResolutionService.js';
import {
  buildShadowProbeContext,
  hydrateOracleIRPlayerZonesFromContext,
  snapshotGraveyardCardIds,
  syncOracleIRPlayerZonesToContext,
} from './oracleIrServerZoneSync.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { isEachPlayerMayPutLandFromHandStep, isControllerMayPutLandFromHandStep } from './triggerLandPlayPromptUtils.js';

const EFFECT_PROGRAM_ORCHESTRATION_KINDS = new Set<string>([
  'choose_mode',
  'fateseal',
  'clash',
  'player_choice',
]);

const OPTIONAL_NO_CHOICE_KINDS = new Set<string>([
  'grant_exile_permission',
  'grant_graveyard_permission',
  'grant_graveyard_keyword_ability',
  'modify_graveyard_permissions',
  // Optional tutors queue LIBRARY_SEARCH directly (optional flag + filtered cards).
  'search_library',
]);

const SEQUENTIAL_CHOICE_KINDS = new Set<string>([
  'choose_mode',
  'choose_color',
  'choose_creature_type',
  'choose_card_name',
  'choose_opponent',
  'choose_target_creature',
  'player_choice',
  'fateseal',
  'clash',
  'scry',
  'surveil',
  'discard',
  'sacrifice',
  'unless_pays_mana',
  'unless_pays_life',
  'explore',
  'proliferate',
  'populate',
]);

function stepOptionalRequiresChoice(step: OracleEffectStep): boolean {
  if ((step as { optional?: boolean }).optional !== true) return false;
  if (isEachPlayerMayPutLandFromHandStep(step)) return false;
  if (isControllerMayPutLandFromHandStep(step)) return false;
  return !OPTIONAL_NO_CHOICE_KINDS.has(String(step.kind || ''));
}

function countSequentialChoiceSteps(steps: readonly OracleEffectStep[]): number {
  let count = 0;
  for (const step of steps) {
    if (!step || step.kind === 'unknown') continue;
    if (SEQUENTIAL_CHOICE_KINDS.has(String(step.kind))) {
      count += 1;
      continue;
    }
    if (stepOptionalRequiresChoice(step)) {
      count += 1;
    }
  }
  return count;
}

export function requiresEffectProgramOrchestration(
  steps: readonly OracleEffectStep[],
  selectedModeIds?: readonly string[],
): boolean {
  if (!Array.isArray(steps) || steps.length === 0) return false;

  const hasUnresolvedChooseMode = steps.some((step) => step.kind === 'choose_mode')
    && (!Array.isArray(selectedModeIds) || selectedModeIds.length === 0);
  if (hasUnresolvedChooseMode) return true;

  if (steps.some((step) => EFFECT_PROGRAM_ORCHESTRATION_KINDS.has(String(step.kind))
    && step.kind !== 'choose_mode')) {
    return true;
  }

  if (steps.some((step) => stepOptionalRequiresChoice(step))) {
    return true;
  }

  const chooseCreatureTypeIndex = steps.findIndex((step) => step.kind === 'choose_creature_type');
  if (
    chooseCreatureTypeIndex >= 0
    && steps.slice(chooseCreatureTypeIndex + 1).some((step) => step.kind !== 'unknown')
  ) {
    return true;
  }

  return countSequentialChoiceSteps(steps) >= 2;
}

function buildPresetEffectProgramBindings(
  program: EffectProgram,
  irCtx: OracleIRExecutionContext,
): Record<string, ChoiceResponse> {
  const bindings: Record<string, ChoiceResponse> = {};
  const presetCreatureType = String(
    irCtx.selectorContext?.chosenCreatureType || (irCtx as { chosenCreatureType?: string }).chosenCreatureType || '',
  ).trim();
  if (!presetCreatureType) return bindings;

  for (const step of program.steps) {
    if (step.kind !== 'choice') continue;
    const oracleStepKind = String((step.choiceRequest?.payload as any)?.oracleStepKind || '');
    if (oracleStepKind !== 'choose_creature_type') continue;
    bindings[step.bindingKey] = {
      eventId: step.bindingKey,
      playerId: irCtx.controllerId,
      selections: [presetCreatureType],
      cancelled: false,
      timestamp: Date.now(),
    };
  }

  return bindings;
}

export interface StartOracleEffectProgramOnServerParams {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly sourceId?: string;
  readonly sourceImage?: string;
  readonly steps: readonly OracleEffectStep[];
  readonly irCtx: OracleIRExecutionContext;
  readonly executionOptions?: OracleIRExecutionOptions;
  readonly programIdPrefix: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StartOracleEffectProgramOnServerResult {
  readonly handled: boolean;
  readonly waitingForChoice: boolean;
  readonly completed: boolean;
}

function syncCompletedEffectProgramState(
  ctx: GameContext,
  controller: PlayerID,
  graveyardBefore: Map<string, Set<string>>,
): void {
  const state = (ctx as any).state;
  if (!state) return;
  syncOracleIRPlayerZonesToContext(ctx, state, controller, graveyardBefore);
}

export function probeOracleEffectProgramShadow(
  ctx: GameContext,
  params: StartOracleEffectProgramOnServerParams,
): boolean {
  try {
    const shadowCtx = buildShadowProbeContext(ctx);
    const state = structuredClone((shadowCtx as any).state);
    hydrateOracleIRPlayerZonesFromContext(shadowCtx, state);
    const program = buildEffectProgramFromOracleIR({
      id: `${params.programIdPrefix}:effect-program`,
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      sourceImage: params.sourceImage,
      steps: params.steps,
      metadata: params.metadata,
    });
    const initialBindings = buildPresetEffectProgramBindings(program, params.irCtx);
    const runtime = createEffectProgramRuntime({ program, state, bindings: initialBindings });
    const runResult = runOracleEffectProgram(
      runtime,
      params.irCtx,
      params.executionOptions || { allowOptional: true },
    );
    return runResult.status === 'waiting_for_choice' || runResult.status === 'completed';
  } catch (err) {
    debugWarn(1, `[oracleIR-shadow] Effect Program probe failed for ${params.sourceName}:`, err);
    return false;
  }
}

export function startOracleEffectProgramOnServer(
  ctx: GameContext,
  params: StartOracleEffectProgramOnServerParams,
): StartOracleEffectProgramOnServerResult {
  const gameId = String((ctx as any).gameId || 'unknown');
  if (gameId === 'unknown') {
    return { handled: false, waitingForChoice: false, completed: false };
  }

  const state = (ctx as any).state;
  hydrateOracleIRPlayerZonesFromContext(ctx, state);
  const graveyardBefore = snapshotGraveyardCardIds(state);

  try {
    const program = buildEffectProgramFromOracleIR({
      id: `${params.programIdPrefix}:effect-program`,
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      sourceImage: params.sourceImage,
      steps: params.steps,
      metadata: params.metadata,
    });
    const initialBindings = buildPresetEffectProgramBindings(program, params.irCtx);

    const handlers = createOracleIREffectProgramHandlers(
      params.irCtx,
      params.executionOptions || { allowOptional: true },
    );

    const result = startEffectProgramResolution({
      game: ctx,
      gameId,
      program,
      handlers: handlers as any,
      persistPrompt: true,
      initialBindings,
      queueExtraConfig: {
        sourceId: params.sourceId,
        sourceName: params.sourceName,
        sourceImage: params.sourceImage,
      },
    });

    if (result.status === 'completed') {
      syncCompletedEffectProgramState(ctx, params.controller, graveyardBefore);
    }

    const handled = result.status === 'waiting_for_choice' || result.status === 'completed';
    if (handled) {
      debug(
        2,
        `[oracleIR] Effect Program for ${params.sourceName}: ${result.status}` +
          (result.queuedStep ? ` (queued ${String((result.queuedStep as any).type || 'step')})` : ''),
      );
    }

    return {
      handled,
      waitingForChoice: result.status === 'waiting_for_choice',
      completed: result.status === 'completed',
    };
  } catch (err) {
    debugWarn(1, `[oracleIR] Effect Program start failed for ${params.sourceName}:`, err);
    return { handled: false, waitingForChoice: false, completed: false };
  }
}
