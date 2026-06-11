import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerZoneSync.js';
import { debug, debugWarn } from '../../utils/debug.js';
import {
  getUnwiredOracleEffectStepKinds,
  isActivatedAbilityEffectFullyWired,
  isOracleIrActivatedAbilityHandled,
} from './oracleIrStepWiring.js';

export {
  ORACLE_IR_ACTIVATED_ONLY_STEP_KINDS,
  ORACLE_IR_ACTIVATED_STEP_KINDS,
  areAllOracleEffectStepsRuntimeWired,
  getUnwiredOracleEffectStepKinds,
  isActivatedAbilityEffectFullyWired,
  isOracleEffectStepRuntimeWired,
  isOracleIrActivatedAbilityHandled,
  isOracleIrMandatoryExecutionComplete,
} from './oracleIrStepWiring.js';

function extractActivatedEffectText(oracleText: string): string {
  const raw = String(oracleText || '').trim();
  if (!raw) return '';
  const powerUpSplit = raw.match(/^Power-up\s*[—-]\s*[^:]+:\s*(.+)$/is);
  if (powerUpSplit) return String(powerUpSplit[1] || '').trim();
  const colonSplit = raw.match(/^[^:]+:\s*(.+)$/s);
  return colonSplit ? String(colonSplit[1] || '').trim() : raw;
}

export function collectActivatedAbilitySteps(oracleText: string, sourceName: string): OracleEffectStep[] {
  const effectText = extractActivatedEffectText(oracleText);
  if (!effectText) return [];
  const ir = parseOracleTextToIR(effectText, sourceName);
  return (ir.abilities || []).flatMap((ability) => ability.steps || []);
}

function inferTargetBinding(state: any, targetIds: readonly string[]): {
  targetPermanentId?: string;
  targetPlayerId?: PlayerID;
  chosenObjectIds?: readonly string[];
} {
  if (!Array.isArray(targetIds) || targetIds.length === 0) return {};
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];

  for (const targetId of targetIds) {
    const id = String(targetId || '').trim();
    if (!id) continue;
    if (battlefield.some((permanent: any) => String(permanent?.id || '') === id)) {
      return { targetPermanentId: id, chosenObjectIds: targetIds };
    }
    if (players.some((player: any) => String(player?.id || '') === id)) {
      return { targetPlayerId: id as PlayerID, chosenObjectIds: targetIds };
    }
  }

  return { chosenObjectIds: targetIds };
}

export function tryApplyOracleIRToActivatedAbility(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceName: string;
    oracleText: string;
    sourcePermanentId?: string;
    stackItemId?: string;
    targets?: readonly string[];
    teamworkWasPaid?: boolean;
    giftPromised?: boolean;
    selectedModeIds?: readonly string[];
    allowOptional?: boolean;
  },
): { handled: boolean; applied: number; pendingOptional: boolean } {
  try {
    const steps = collectActivatedAbilitySteps(params.oracleText, params.sourceName);
    if (steps.length === 0) {
      return { handled: false, applied: 0, pendingOptional: false };
    }

    if (steps.some((step) => step.kind === 'unknown')) {
      debug(
        2,
        `[oracleIR] Activated ability not fully wired for ${params.sourceName}: contains unknown step(s)`,
      );
      return { handled: false, applied: 0, pendingOptional: false };
    }

    if (!isActivatedAbilityEffectFullyWired(steps)) {
      const unwired = getUnwiredOracleEffectStepKinds(steps);
      debug(
        2,
        `[oracleIR] Activated ability not fully wired for ${params.sourceName}: ${unwired.join(', ')}`,
      );
      return { handled: false, applied: 0, pendingOptional: false };
    }

    const state = (ctx as any).state;
    const targetBinding = inferTargetBinding(state, params.targets || []);
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: params.controller,
        sourceId: params.sourcePermanentId || params.stackItemId,
        sourceName: params.sourceName,
        sourceObjectType: 'ability',
        ...(typeof params.teamworkWasPaid === 'boolean' ? { teamworkWasPaid: params.teamworkWasPaid } : {}),
        ...(typeof params.giftPromised === 'boolean' ? { giftPromised: params.giftPromised } : {}),
        selectorContext: {
          ...(targetBinding.chosenObjectIds ? { chosenObjectIds: targetBinding.chosenObjectIds } : {}),
          ...(targetBinding.targetPlayerId ? { targetPlayerId: targetBinding.targetPlayerId } : {}),
        },
        ...(targetBinding.targetPermanentId ? { targetPermanentId: targetBinding.targetPermanentId } : {}),
      },
      {
        targetPermanentId: targetBinding.targetPermanentId,
        targetPlayerId: targetBinding.targetPlayerId,
        chosenObjectIds: targetBinding.chosenObjectIds,
        sourceObjectType: 'ability',
      },
    );

    const gameId = String((ctx as any).gameId || 'unknown');
    const queueBefore = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : 0;

    const result = applyOracleIRStepsOnServer(ctx, state, steps, irCtx, {
      allowOptional: params.allowOptional ?? true,
      selectedModeIds: params.selectedModeIds,
    }, {
      controller: params.controller,
      targetPlayerId: targetBinding.targetPlayerId,
      applyMillReplacements: true,
    });

    const queueAfter = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : queueBefore;

    const applied = result.appliedSteps.length;
    const pendingOptional = (result.pendingOptionalSteps || []).length;
    const handled = isOracleIrActivatedAbilityHandled(steps, result, {
      resolutionQueueStepsBefore: queueBefore,
      resolutionQueueStepsAfter: queueAfter,
    });

    if (!handled && applied > 0) {
      debugWarn(
        1,
        `[oracleIR] Refusing partial activated-ability IR for ${params.sourceName}: ` +
          `applied ${applied}/${steps.length} step(s); legacy path will run`,
      );
    } else if (handled) {
      debug(
        2,
        `[oracleIR] Applied ${applied} activated-ability step(s) for ${params.sourceName}` +
          (pendingOptional ? ` (${result.pendingOptionalSteps.length} optional pending)` : ''),
      );
    }

    return { handled, applied, pendingOptional };
  } catch (err) {
    debugWarn(1, `[oracleIR] Activated ability execution failed for ${params.sourceName}:`, err);
    return { handled: false, applied: 0, pendingOptional: false };
  }
}
