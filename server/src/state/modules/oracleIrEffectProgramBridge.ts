import type { PlayerID } from '../../../../shared/src/index.js';
import type { ChoiceResponse } from '../../../../rules-engine/src/choiceEventsTypes.js';
import type { OracleIRCommandExecutionEvent } from '../../../../rules-engine/src/effectProgramOracleRunner.js';
import type { OracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import type {
  EffectProgramChoiceStep,
  EffectProgramCommandStep,
  EffectProgramRunResult,
  EffectProgramStep,
} from '../../../../rules-engine/src/effectProgram.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { appendCopyTriggeredAbilityResolveEvent } from './triggerAbilityCopyUtils.js';
import { queueCopySpellStackPushFromOracleIRResult } from './oracleIrServerCopySpellSync.js';
import { persistEffectProgramReplayMutationsFromRun } from '../effects/effectProgramReplayMutationPersistence.js';

export interface EffectProgramOracleIrBridgeConfig {
  readonly irCtx: OracleIRExecutionContext;
  readonly controller: PlayerID;
  readonly sourceName?: string;
  readonly sourceId?: string;
  readonly triggerItem?: unknown;
}

function effectProgramSelectionIncludes(selections: ChoiceResponse['selections'] | undefined, expected: string): boolean {
  if (typeof selections === 'string') {
    return selections === expected;
  }
  if (Array.isArray(selections)) {
    return selections.some((selection) => {
      if (typeof selection === 'string') return selection === expected;
      if (selection && typeof selection === 'object' && 'id' in selection) {
        return String((selection as { id?: string }).id || '') === expected;
      }
      return false;
    });
  }
  return false;
}

function programIncludesAbilityCopyStep(steps: readonly EffectProgramStep[]): boolean {
  return steps.some((step) => {
    if (step.kind !== 'command' || step.command?.kind !== 'oracle_ir_step') return false;
    const oracleStep = step.command.step as { kind?: string; target?: { text?: string } };
    return oracleStep.kind === 'copy_spell'
      && /ability/i.test(String(oracleStep.target?.text || ''));
  });
}

function findOptionalPayManaMayChoiceStep(
  steps: readonly EffectProgramStep[],
): { readonly choiceStep: EffectProgramChoiceStep; readonly manaCost: string } | undefined {
  for (const step of steps) {
    if (step.kind !== 'choice' || !String(step.id || '').endsWith(':may-choice')) continue;
    const bindingKey = String(step.bindingKey || '').trim();
    if (!bindingKey) continue;

    const commandStep = steps.find((candidate): candidate is EffectProgramCommandStep =>
      candidate.kind === 'command'
      && candidate.guard?.bindingKey === bindingKey
      && candidate.command?.kind === 'oracle_ir_step'
      && (candidate.command.step as { kind?: string; optional?: boolean }).kind === 'pay_mana'
      && (candidate.command.step as { optional?: boolean }).optional === true,
    );
    if (!commandStep || commandStep.command?.kind !== 'oracle_ir_step') continue;

    const payStep = commandStep.command.step as { mana?: string };
    return {
      choiceStep: step,
      manaCost: String(payStep.mana || '').trim(),
    };
  }

  return undefined;
}

function runEventsIncludedAbilityCopy(events: readonly unknown[]): boolean {
  return events.some((event) => {
    if (!event || typeof event !== 'object') return false;
    const typed = event as Partial<OracleIRCommandExecutionEvent>;
    return typed.type === 'oracle_ir_execution'
      && (typed.execution?.appliedSteps || []).some((step) => step.kind === 'copy_spell');
  });
}

function resolveTriggeringStackItemId(triggerItem: any, irCtx: OracleIRExecutionContext): string {
  return String(
    triggerItem?.triggeringStackItemId
    || triggerItem?.effectData?.triggeringStackItemId
    || irCtx.targetSpellId
    || irCtx.selectorContext?.targetSpellId
    || '',
  ).trim();
}

/** Bridge deferred Oracle IR automation gaps (stack copies) after Effect Program command steps. */
export function bridgeOracleIrEffectProgramRunEvents(
  ctx: GameContext,
  state: any,
  events: readonly unknown[],
  bridge: EffectProgramOracleIrBridgeConfig,
): void {
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const typed = event as Partial<OracleIRCommandExecutionEvent>;
    if (typed.type !== 'oracle_ir_execution' || !typed.execution) continue;

    queueCopySpellStackPushFromOracleIRResult(ctx, state, typed.execution, {
      controller: bridge.controller,
      sourceName: bridge.sourceName || bridge.irCtx.sourceName,
      sourceId: bridge.sourceId || bridge.irCtx.sourceId,
      irCtx: bridge.irCtx,
      sourceItem: bridge.triggerItem,
    });
  }
}

/** Persist optional-pay mana replay when Effect Program pay_mana succeeds after a may-choice. */
export function maybeEmitPaidOptionalManaFromEffectProgram(
  ctx: GameContext,
  runResult: EffectProgramRunResult,
  bridge: EffectProgramOracleIrBridgeConfig,
  resolvedStepId?: string,
): void {
  if (runResult.status !== 'completed') return;
  if ((ctx as any).isReplaying) return;

  const optionalPay = findOptionalPayManaMayChoiceStep(runResult.runtime.program.steps);
  if (!optionalPay?.manaCost) return;

  const bindingKey = String(optionalPay.choiceStep.bindingKey || '').trim();
  if (!bindingKey) return;

  const response = runResult.runtime.bindings[bindingKey] as Partial<ChoiceResponse> | undefined;
  if (!response || !effectProgramSelectionIncludes(response.selections, 'yes')) return;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  const program = runResult.runtime.program;
  const triggerItem = bridge.triggerItem as Record<string, unknown> | undefined;
  try {
    appendEvent(
      gameId,
      Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
      'optionalPaymentPromptResolve',
      {
        playerId: bridge.controller,
        sourceId: String(bridge.sourceId || bridge.irCtx.sourceId || triggerItem?.source || triggerItem?.permanentId || '').trim() || undefined,
        sourceName: String(bridge.sourceName || bridge.irCtx.sourceName || '').trim() || undefined,
        resolvedStepId: String(resolvedStepId || optionalPay.choiceStep.id || '').trim() || undefined,
        choiceId: 'pay',
        optionalPaymentValidationKind: 'mana',
        manaCost: optionalPay.manaCost,
        effectProgram: {
          effectProgramId: program.id,
          effectProgramFamily: typeof program.metadata?.family === 'string' ? program.metadata.family : undefined,
          effectProgramSourceId: String(bridge.sourceId || bridge.irCtx.sourceId || '').trim() || undefined,
          effectProgramSourceName: String(bridge.sourceName || bridge.irCtx.sourceName || '').trim() || undefined,
          effectProgramCursor: Number(runResult.runtime.cursor || 0),
          effectProgramStepId: String(optionalPay.choiceStep.id || '').trim(),
          effectProgramBindingKey: bindingKey,
          effectProgramClause: optionalPay.choiceStep.clause,
        },
      },
    );
  } catch (err) {
    debugWarn(
      1,
      `[oracleIR] appendEvent(optionalPaymentPromptResolve) failed for ${String(bridge.sourceName || 'Ability')}:`,
      err,
    );
  }
}

/** Persist legacy-compatible decline replay when optional pay-to-copy ability is declined via Effect Program. */
export function maybeEmitDeclinedOptionalAbilityCopyFromEffectProgram(
  ctx: GameContext,
  runResult: EffectProgramRunResult,
  events: readonly unknown[],
  bridge: EffectProgramOracleIrBridgeConfig,
): void {
  if (runResult.status !== 'completed') return;
  if ((ctx as any).isReplaying) return;
  if (runEventsIncludedAbilityCopy(events)) return;

  const program = runResult.runtime.program;
  if (!programIncludesAbilityCopyStep(program.steps)) return;

  const optionalPay = findOptionalPayManaMayChoiceStep(program.steps);
  if (!optionalPay) return;

  const bindingKey = String(optionalPay.choiceStep.bindingKey || '').trim();
  if (!bindingKey) return;

  const response = runResult.runtime.bindings[bindingKey] as Partial<ChoiceResponse> | undefined;
  if (!response || effectProgramSelectionIncludes(response.selections, 'yes')) return;

  const triggerItem = bridge.triggerItem as Record<string, unknown> | undefined;
  const triggeringStackItemId = resolveTriggeringStackItemId(triggerItem, bridge.irCtx);

  appendCopyTriggeredAbilityResolveEvent(ctx, {
    sourceId: String(bridge.sourceId || bridge.irCtx.sourceId || triggerItem?.source || triggerItem?.permanentId || '').trim() || undefined,
    sourceName: String(bridge.sourceName || bridge.irCtx.sourceName || 'Ability').trim() || 'Ability',
    controllerId: bridge.controller,
    paid: false,
    manaCost: optionalPay.manaCost || undefined,
    triggerStackItemId: String(triggerItem?.id || '').trim() || undefined,
    triggeringStackItemId: triggeringStackItemId || undefined,
  });
}

/** Persist replay-sourced mutations from effect-program oracle_ir_execution events. */
export function persistEffectProgramStateMutationsFromRun(
  ctx: GameContext,
  events: readonly unknown[],
  bridge?: EffectProgramOracleIrBridgeConfig,
): void {
  persistEffectProgramReplayMutationsFromRun(ctx, events, bridge);
}
