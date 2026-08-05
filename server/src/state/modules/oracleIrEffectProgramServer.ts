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
import { isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt } from '../../../../rules-engine/src/oracleIRPerPlayerOptional.js';
import { resolveTriggeredAbilityControllerId } from './triggerSourceUtils.js';

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
  // Optional look-at-top steps queue LIBRARY_SEARCH via applyOracleIRStepsOnServer bridge.
  'look_choose_from_top',
  'look_select_top',
  // Optional put-from-hand queues LIBRARY_SEARCH via move_zone player_choice bridge.
  'move_zone',
  'tap_matching_permanents',
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
  'unless_discards',
  'explore',
  'proliferate',
  'populate',
  'look_top',
  'look_choose_from_top',
  'look_select_top',
  'reveal_top',
  'move_zone',
  'grant_graveyard_permission',
  'modify_graveyard_permissions',
  'attach',
]);

function stepOptionalRequiresChoice(step: OracleEffectStep): boolean {
  if ((step as { optional?: boolean }).optional !== true) return false;
  if (isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt(step)) return false;
  if (step.kind === 'create_token' && (step as { optional?: boolean }).optional === true) return false;
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

const PREFIXED_CHOICE_STEP_KINDS = [
  'choose_creature_type',
  'choose_color',
  'choose_card_name',
  'choose_opponent',
] as const;

function hasPrefixedChoiceWithFollowUpSteps(steps: readonly OracleEffectStep[]): boolean {
  for (const prefixKind of PREFIXED_CHOICE_STEP_KINDS) {
    const prefixIndex = steps.findIndex((step) => step.kind === prefixKind);
    if (
      prefixIndex >= 0
      && steps.slice(prefixIndex + 1).some((step) => step.kind !== 'unknown')
    ) {
      return true;
    }
  }
  return false;
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

  if (hasPrefixedChoiceWithFollowUpSteps(steps)) {
    return true;
  }

  return countSequentialChoiceSteps(steps) >= 2;
}

const REVEAL_LIBRARY_BRIDGE_KINDS = new Set<string>([
  'reveal_top',
  'look_top',
  'look_choose_from_top',
  'look_select_top',
  'search_library',
  'exile_top',
  'impulse_exile_top',
]);

/** player_choice.choice values with dedicated Pattern A queue bridges. */
const DIRECT_IR_PLAYER_CHOICE_KINDS = new Set<string>([
  'odd_even',
  'card_type',
  'letter',
  'text_change',
  'number_of_lands',
]);

/**
 * player_choice + follow-up that is NOT a reveal/library bridge compound
 * and NOT a specialized choice kind already bridged by applyOracleIRStepsOnServer
 * (e.g. Thanos odd_even → OPTION_CHOICE with oracleIrPlayerChoiceKind).
 */
function hasNonLibraryPlayerChoiceCompound(steps: readonly OracleEffectStep[]): boolean {
  const choiceIndex = steps.findIndex((step) => step.kind === 'player_choice');
  if (choiceIndex < 0) return false;
  if (!steps.slice(choiceIndex + 1).some((step) => step.kind !== 'unknown')) return false;
  const choiceKind = String((steps[choiceIndex] as { choice?: string }).choice || '').trim();
  if (choiceKind && DIRECT_IR_PLAYER_CHOICE_KINDS.has(choiceKind)) {
    return false;
  }
  const hasRevealLibraryBridge = steps
    .slice(0, choiceIndex + 1)
    .some((step) => REVEAL_LIBRARY_BRIDGE_KINDS.has(String(step.kind)));
  return !hasRevealLibraryBridge;
}

/**
 * Optional create_token is excluded from stepOptionalRequiresChoice (dedicated bridges),
 * but "you may create … . If you do / Then …" needs EP binding carry-over (P2a).
 */
function hasOptionalCreateTokenWithFollowUp(steps: readonly OracleEffectStep[]): boolean {
  const idx = steps.findIndex(
    (step) => step.kind === 'create_token' && (step as { optional?: boolean }).optional === true,
  );
  if (idx < 0) return false;
  return steps.slice(idx + 1).some((step) => step.kind !== 'unknown');
}

/**
 * Core Effect Program gate for multi-step effects.
 * Effect Program owns: modal, prefixed choose-* compounds, non-library player_choice
 * compounds, fateseal/clash, optional yes/no steps, optional create_token + follow-up.
 * Reveal → player_choice → move/library compounds stay on direct IR (queue bridge).
 */
export function requiresCoreEffectProgramOrchestration(
  steps: readonly OracleEffectStep[],
  selectedModeIds?: readonly string[],
): boolean {
  if (!Array.isArray(steps) || steps.length === 0) return false;

  const hasUnresolvedChooseMode = steps.some((step) => step.kind === 'choose_mode')
    && (!Array.isArray(selectedModeIds) || selectedModeIds.length === 0);
  if (hasUnresolvedChooseMode) return true;

  if (steps.some((step) => step.kind === 'fateseal' || step.kind === 'clash')) {
    return true;
  }

  if (steps.some((step) => stepOptionalRequiresChoice(step))) {
    return true;
  }

  if (hasOptionalCreateTokenWithFollowUp(steps)) {
    return true;
  }

  if (hasPrefixedChoiceWithFollowUpSteps(steps)) {
    return true;
  }

  // P2a: player_choice → command compounds that need EP bindings (not library bridges).
  return hasNonLibraryPlayerChoiceCompound(steps);
}

/** Spell stack/trigger routing — see {@link requiresCoreEffectProgramOrchestration}. */
export const requiresSpellEffectProgramOrchestration = requiresCoreEffectProgramOrchestration;

/** Trigger stack routing — same gate as spells (direct IR for reveal/player_choice compounds). */
export const requiresTriggerEffectProgramOrchestration = requiresCoreEffectProgramOrchestration;

function buildPresetEffectProgramBindings(
  program: EffectProgram,
  irCtx: OracleIRExecutionContext,
): Record<string, ChoiceResponse> {
  const bindings: Record<string, ChoiceResponse> = {};
  const presetSelectionsByOracleStepKind: Record<string, string> = {};

  const presetCreatureType = String(
    irCtx.selectorContext?.chosenCreatureType || (irCtx as { chosenCreatureType?: string }).chosenCreatureType || '',
  ).trim();
  if (presetCreatureType) {
    presetSelectionsByOracleStepKind.choose_creature_type = presetCreatureType;
  }

  const presetChosenMana = String(irCtx.selectorContext?.chosenMana || '').trim();
  if (presetChosenMana) {
    presetSelectionsByOracleStepKind.choose_color = presetChosenMana;
  }

  const presetCardName = String(irCtx.selectorContext?.chosenCardName || '').trim();
  if (presetCardName) {
    presetSelectionsByOracleStepKind.choose_card_name = presetCardName;
  }

  const presetOpponentId = String(
    irCtx.selectorContext?.targetOpponentId || (irCtx as { targetOpponentId?: string }).targetOpponentId || '',
  ).trim();
  if (presetOpponentId) {
    presetSelectionsByOracleStepKind.choose_opponent = presetOpponentId;
  }

  if (Object.keys(presetSelectionsByOracleStepKind).length === 0) {
    return bindings;
  }

  for (const step of program.steps) {
    if (step.kind !== 'choice') continue;
    const oracleStepKind = String((step.choiceRequest?.payload as any)?.oracleStepKind || '');
    const presetSelection = presetSelectionsByOracleStepKind[oracleStepKind];
    if (!presetSelection) continue;
    bindings[step.bindingKey] = {
      eventId: step.bindingKey,
      playerId: irCtx.controllerId,
      selections: [presetSelection],
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
  const triggerItem = (params.metadata as any)?.triggerItem;
  const resolvedController = resolveTriggeredAbilityControllerId(
    state,
    triggerItem,
    params.controller,
  ) || String(params.controller || '').trim();

  if (!resolvedController) {
    debugWarn(
      1,
      `[oracleIR] Refusing Effect Program for ${params.sourceName}: missing controller ` +
      `(would orphan option_choice with null priority)`,
    );
    return { handled: false, waitingForChoice: false, completed: false };
  }

  try {
    const serverIrCtx = {
      ...params.irCtx,
      deferStackSpellCopiesToServer: true,
      controllerId: resolvedController,
    };

    const program = buildEffectProgramFromOracleIR({
      id: `${params.programIdPrefix}:effect-program`,
      controllerId: resolvedController as any,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      sourceImage: params.sourceImage,
      steps: params.steps,
      metadata: params.metadata,
    });
    const initialBindings = buildPresetEffectProgramBindings(program, params.irCtx);

    const handlers = createOracleIREffectProgramHandlers(
      serverIrCtx,
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
      oracleIrBridge: {
        irCtx: serverIrCtx,
        controller: resolvedController as any,
        sourceName: params.sourceName,
        sourceId: params.sourceId,
        triggerItem,
      },
    });

    if (result.status === 'completed') {
      syncCompletedEffectProgramState(ctx, resolvedController as any, graveyardBefore);
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
