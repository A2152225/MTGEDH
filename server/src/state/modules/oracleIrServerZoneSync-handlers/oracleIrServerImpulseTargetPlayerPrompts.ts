// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerImpulseTargetPlayerPrompts.ts
// Origin parent: oracleIrServerApplyOnServer / impulse exile bridges.
// Cluster: bridge unbound impulse_exile_top target_opponent / target_player gaps
//   (Chaos Wand: "Target opponent exiles cards from the top...") to TARGET_SELECTION
//   so multi-opponent games do not AON when the ability resolves without a bound target.
// Public entry symbols: isImpulseExileTargetPlayerChoiceStep,
//   queueImpulseExileTargetPlayerPromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer. Pattern: oracleIrServerHandCardToExilePrompts
//   + add_counter TARGET_SELECTION (oracleIrChoiceStepJson resume).

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { attachOracleIrResumeMetadata, isOracleIrPlayerChoiceGap } from '../oracleIrServerPromptResumeUtils.js';

type ImpulseExileTopStep = Extract<OracleEffectStep, { kind: 'impulse_exile_top' }>;

/** True when this impulse step needs a chosen target player/opponent before exile. */
export function isImpulseExileTargetPlayerChoiceStep(step: unknown): boolean {
  const impulse = step as ImpulseExileTopStep | undefined;
  if (!impulse || impulse.kind !== 'impulse_exile_top') return false;
  const whoKind = String((impulse.who as any)?.kind || '').trim();
  return whoKind === 'target_opponent' || whoKind === 'target_player';
}

function listEligibleTargetPlayers(
  state: any,
  controller: string,
  whoKind: string,
): Array<{ id: string; label: string; type: string; description: string }> {
  const players = Array.isArray(state?.players) ? state.players : [];
  const options: Array<{ id: string; label: string; type: string; description: string }> = [];
  for (const player of players) {
    const id = String(player?.id || '').trim();
    if (!id) continue;
    if (player?.hasLeft || player?.leftGame || player?.conceded) continue;
    if (whoKind === 'target_opponent' && id === controller) continue;
    const name = String(player?.name || id).trim() || id;
    options.push({
      id,
      label: name,
      // Client target modal infers player targets from type/description.
      type: 'player',
      description: whoKind === 'target_opponent' ? 'opponent' : 'player',
    });
  }
  return options;
}

export function queueImpulseExileTargetPlayerPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const controller = String(params.controller || '').trim();
  if (!controller) return;
  const queuedKeys = new Set<string>();

  for (const step of result.skippedSteps || []) {
    if (!isImpulseExileTargetPlayerChoiceStep(step)) continue;
    const raw = String((step as any).raw || '');
    const isChoiceGap = (result.automationGaps || []).some((gap) =>
      String(gap.stepKind || '') === 'impulse_exile_top'
      && String(gap.raw || '') === raw
      && isOracleIrPlayerChoiceGap(gap));
    if (!isChoiceGap) continue;
    if (queuedKeys.has(raw)) continue;
    queuedKeys.add(raw);

    const whoKind = String((step as any)?.who?.kind || '').trim();
    const validTargets = listEligibleTargetPlayers(state, controller, whoKind);
    if (validTargets.length === 0) continue;

    const targetTypes = whoKind === 'target_opponent' ? ['opponent'] : ['player'];
    const targetDescription = whoKind === 'target_opponent' ? 'target opponent' : 'target player';

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controller as PlayerID,
      description: `${sourceName}: Choose ${targetDescription}.`,
      mandatory: true,
      sourceId,
      sourceName,
      validTargets,
      targetTypes,
      minTargets: 1,
      maxTargets: 1,
      targetDescription,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as Record<string, unknown>, result, { ...params, sourceName, sourceId }) as any);
  }
}
