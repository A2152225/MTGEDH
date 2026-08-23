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
  const modeById = new Map(
    ((step as any).modes || []).map((mode: any) => [String(mode?.label || '').trim(), mode] as const)
  );
  const allModeLabels = Array.from(modeById.keys()).filter(Boolean);
  const sourceWasKicked = ctx.wasKicked === true
    || (ctx as any).selectorContext?.wasKicked === true;
  const kickerChooseBoth = Boolean((step as any).kickerChooseBoth);
  const forceBothFromKicker = kickerChooseBoth && sourceWasKicked && allModeLabels.length > 0;

  let rawSelectedModeIds = Array.isArray(options.selectedModeIds)
    ? options.selectedModeIds
    : null;
  if (!rawSelectedModeIds && forceBothFromKicker) {
    rawSelectedModeIds = allModeLabels;
  }
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

  const canRepeatModes = Boolean((step as any).canRepeatModes);
  const normalizedSelectedModeIds = rawSelectedModeIds
    .map(id => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);
  const rememberChosenModes = Boolean((step as any).rememberChosenModes);
  const modeMemoryKey = String(ctx.sourceId || ctx.sourceName || (step as any).raw || 'choose-mode').trim();
  const priorModeChoices = rememberChosenModes
    ? new Set(
      Array.isArray((state as any)?.chosenModeHistory?.[modeMemoryKey])
        ? (state as any).chosenModeHistory[modeMemoryKey].map((id: any) => String(id || '').trim()).filter(Boolean)
        : []
    )
    : new Set<string>();
  const hasDuplicateModeSelection =
    !canRepeatModes &&
    normalizedSelectedModeIds.some((id, index) => normalizedSelectedModeIds.indexOf(id) !== index);
  const selectedModes = normalizedSelectedModeIds
    .map(id => modeById.get(id))
    .filter((mode): mode is { label: string; steps: readonly OracleEffectStep[]; pCost?: number } => Boolean(mode));
  let minModes = Math.max(0, Number((step as any).minModes ?? 0) || 0);
  const maxModesRaw = Number((step as any).maxModes ?? -1);
  let maxModes = Number.isFinite(maxModesRaw) && maxModesRaw >= 0 ? maxModesRaw : Infinity;
  if (Boolean((step as any).teamworkChooseBoth) && ctx.teamworkWasPaid === true) {
    const modeCount = Array.isArray((step as any).modes) ? (step as any).modes.length : 0;
    maxModes = Math.min(2, modeCount > 0 ? modeCount : 2);
  }
  if (forceBothFromKicker) {
    const modeCount = allModeLabels.length;
    minModes = modeCount;
    maxModes = modeCount;
  }
  const pBudgetRaw = Number((step as any).pBudget ?? NaN);
  const hasPBudget = Number.isFinite(pBudgetRaw) && pBudgetRaw > 0;
  const selectedPCost = selectedModes.reduce(
    (sum, mode) => sum + (Number.isFinite(Number(mode.pCost)) ? Number(mode.pCost) : 0),
    0,
  );
  // For {P}-budget modes, maxModes is a soft upper bound; the budget is authoritative.
  if (hasPBudget) {
    maxModes = Infinity;
  }

  if (
    hasDuplicateModeSelection ||
    selectedModes.length !== normalizedSelectedModeIds.length ||
    selectedModes.length < minModes ||
    selectedModes.length > maxModes ||
    (hasPBudget && selectedPCost > pBudgetRaw) ||
    (rememberChosenModes && normalizedSelectedModeIds.some(id => priorModeChoices.has(id)))
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

  if (rememberChosenModes) {
    const chosenModeHistory = {
      ...(((nextState as any).chosenModeHistory || {}) as Record<string, readonly string[]>),
      [modeMemoryKey]: Array.from(new Set([...priorModeChoices, ...normalizedSelectedModeIds])),
    };
    nextState = { ...(nextState as any), chosenModeHistory } as GameState;
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
