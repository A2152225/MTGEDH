// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerDieRollAgainPrompts.ts
// Origin parent: oracleIrServerApplyOnServer.ts
// B52 "you may roll again" d20 bands (Delina): the executor sets state.pendingDieRollAgain when an optional
// re-roll is offered. This asks that player yes/no through the generic OPTION_CHOICE prompt and, on "yes",
// re-executes [roll_die, die_roll_results] so the table applies again (and re-offers if it lands on that band).
// Either answer clears the pending flag; the caller then resumes any remaining ability steps.
// Public: queueDieRollAgainPromptFromOracleIRResult, applyDieRollAgainChoiceFromResolution, buildDieRollAgainSteps.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionContext, OracleIRExecutionResult } from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { extractWarpWorldChoiceId } from './oracleIrServerWarpWorldChoicePrompts.js';

/** The roll_die + die_roll_results pair that re-runs the table whose band offered the re-roll. */
export function buildDieRollAgainSteps(pending: any, steps: readonly any[]): OracleEffectStep[] | null {
  const tables = (steps || []).filter((s: any) => s && s.kind === 'die_roll_results');
  if (!tables.length) return null;
  const raw = String(pending?.raw || '');
  const table = tables.find((t: any) => Array.isArray(t.results) && t.results.some((b: any) => String(b?.raw || '') === raw))
    || tables[tables.length - 1];
  const sides = Number(pending?.sides) || Number((table as any).sides) || 20;
  return [{ kind: 'roll_die', who: { kind: 'you' }, sides, raw: `roll a d${sides}` } as any, table as OracleEffectStep];
}

export function queueDieRollAgainPromptFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: { controller: PlayerID; sourceName?: string; sourceId?: string; irCtx: OracleIRExecutionContext },
): void {
  const pending = state?.pendingDieRollAgain;
  if (!pending) return;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;
  const queue = ResolutionQueueManager.getQueue(gameId);
  if ((queue?.steps || []).some((s: any) => s?.dieRollAgainChoice === true)) return;
  const steps = buildDieRollAgainSteps(pending, result.appliedSteps || []);
  if (!steps) { delete state.pendingDieRollAgain; return; }
  const playerId = String(pending.playerId || params.controller || '').trim() as PlayerID;
  const sourceName = String(pending.sourceName || params.sourceName || 'Ability').trim() || 'Ability';
  const targetPermanentId = String((params.irCtx as any)?.targetPermanentId || '').trim();
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    mandatory: true,
    sourceId: params.sourceId,
    sourceName,
    description: `${sourceName}: You may roll the d${steps[0] && (steps[0] as any).sides} again.`,
    minSelections: 1,
    maxSelections: 1,
    dieRollAgainChoice: true,
    oracleIrChoiceStepJson: JSON.stringify(steps),
    oracleIrControllerId: playerId,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: sourceName,
    ...(targetPermanentId ? { oracleIrTargetPermanentId: targetPermanentId } : {}),
    options: [
      { id: 'roll_again', label: 'Roll again', description: String(pending.raw || '') },
      { id: 'stop', label: "Don't roll again" },
    ],
  } as any);
}

type ResumeFn = (ctx: GameContext, params: any) => OracleIRExecutionResult | null;

/** undefined = not a die-roll-again step; otherwise the (possibly empty) resumed result. */
export function applyDieRollAgainChoiceFromResolution(
  ctx: GameContext,
  step: any,
  response: { readonly selections?: unknown },
  resume: ResumeFn,
): OracleIRExecutionResult | null | undefined {
  if (step?.dieRollAgainChoice !== true) return undefined;
  const state: any = (ctx as any).state;
  if (state) delete state.pendingDieRollAgain;
  const choice = extractWarpWorldChoiceId(response.selections).toLowerCase();
  const empty = { state, log: [], appliedSteps: [], skippedSteps: [], automationGaps: [], pendingOptionalSteps: [] } as any;
  if (choice !== 'roll_again') return empty;
  let steps: OracleEffectStep[] = [];
  try { steps = JSON.parse(String(step.oracleIrChoiceStepJson || '[]')); } catch { steps = []; }
  if (!Array.isArray(steps) || !steps.length) return empty;
  const targetPermanentId = String(step.oracleIrTargetPermanentId || '').trim();
  return resume(ctx, {
    controller: String(step.oracleIrControllerId || step.playerId || '').trim() as PlayerID,
    sourceId: String(step.oracleIrSourceId || step.sourceId || '').trim() || undefined,
    sourceName: String(step.oracleIrSourceName || step.sourceName || '').trim() || undefined,
    steps,
    selectorContext: targetPermanentId ? { targetPermanentId } : {},
  }) || empty;
}
