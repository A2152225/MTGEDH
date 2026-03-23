import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
} from './oracleIRExecutionTypes';

type ChooseModeStep = Extract<OracleEffectStep, { readonly kind: 'choose_mode' }>;

type SkipOptions = {
  readonly pending?: boolean;
  readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
  readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  readonly persist?: boolean;
};

type ApplyNestedSteps = (
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options?: OracleIRExecutionOptions
) => OracleIRExecutionResult;

export type ChooseModeStepResult =
  | {
      readonly kind: 'recorded_skip';
      readonly message: string;
      readonly reason: string;
      readonly options?: SkipOptions;
    }
  | {
      readonly kind: 'applied';
      readonly state: GameState;
      readonly log: readonly string[];
      readonly appliedSteps: readonly OracleEffectStep[];
      readonly skippedSteps: readonly OracleEffectStep[];
      readonly automationGaps: OracleIRExecutionResult['automationGaps'];
      readonly pendingOptionalSteps: readonly OracleEffectStep[];
    };

export function applyChooseModeStep(
  state: GameState,
  step: ChooseModeStep,
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions,
  applyNestedSteps: ApplyNestedSteps
): ChooseModeStepResult {
  const rawSelectedModeIds = Array.isArray(options.selectedModeIds)
    ? options.selectedModeIds
    : null;
  if (!rawSelectedModeIds) {
    return {
      kind: 'recorded_skip',
      message: `Skipped choose_mode step (needs player selection): ${(step as any).raw ?? step.kind}`,
      reason: 'player_choice_required',
      options: {
        pending: true,
        classification: 'player_choice',
      },
    };
  }

  const normalizedSelectedModeIds = rawSelectedModeIds
    .map(id => (typeof id === 'string' ? id.trim() : ''))
    .filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index);
  const modeById = new Map(
    ((step as any).modes || []).map((mode: any) => [String(mode?.label || '').trim(), mode] as const)
  );
  const selectedModes = normalizedSelectedModeIds
    .map(id => modeById.get(id))
    .filter((mode): mode is { label: string; steps: readonly OracleEffectStep[] } => Boolean(mode));
  const minModes = Math.max(0, Number((step as any).minModes ?? 0) || 0);
  const maxModesRaw = Number((step as any).maxModes ?? -1);
  const maxModes = Number.isFinite(maxModesRaw) && maxModesRaw >= 0 ? maxModesRaw : Infinity;

  if (
    selectedModes.length !== normalizedSelectedModeIds.length ||
    selectedModes.length < minModes ||
    selectedModes.length > maxModes
  ) {
    return {
      kind: 'recorded_skip',
      message: `Skipped choose_mode step (invalid mode selection): ${(step as any).raw ?? step.kind}`,
      reason: 'invalid_mode_selection',
      options: {
        pending: true,
        classification: 'invalid_input',
      },
    };
  }

  let nextState = state;
  const log: string[] = [
    `Resolved choose_mode step with ${selectedModes.length} selected mode(s): ${normalizedSelectedModeIds.join(', ') || 'none'}`,
  ];
  const appliedSteps: OracleEffectStep[] = [step];
  const skippedSteps: OracleEffectStep[] = [];
  const automationGaps: OracleIRExecutionResult['automationGaps'][number][] = [];
  const pendingOptionalSteps: OracleEffectStep[] = [];

  for (const mode of selectedModes) {
    const modeResult = applyNestedSteps(
      nextState,
      mode.steps,
      ctx,
      { ...options, selectedModeIds: undefined }
    );
    nextState = modeResult.state;
    log.push(`Resolved mode: ${mode.label}`);
    log.push(...modeResult.log);
    appliedSteps.push(...modeResult.appliedSteps);
    skippedSteps.push(...modeResult.skippedSteps);
    automationGaps.push(...modeResult.automationGaps);
    pendingOptionalSteps.push(...modeResult.pendingOptionalSteps);
  }

  return {
    kind: 'applied',
    state: nextState,
    log,
    appliedSteps,
    skippedSteps,
    automationGaps,
    pendingOptionalSteps,
  };
}
