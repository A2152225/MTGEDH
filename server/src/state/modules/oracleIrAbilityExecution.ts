import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import type { GameContext } from '../context.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerZoneSync.js';
import { debug, debugWarn } from '../../utils/debug.js';

const ORACLE_IR_ACTIVATED_STEP_KINDS = new Set<string>([
  'move_zone',
  'roll_die',
  'die_roll_results',
  'copy_spell',
  'draw',
  'scry',
  'surveil',
  'gain_life',
  'lose_life',
  'deal_damage',
  'destroy',
  'exile_top',
  'impulse_exile_top',
  'add_counter',
  'create_token',
  'tap_or_untap',
  'add_mana',
  'mill',
  'discard',
  'choose_mode',
  'conditional',
  'connive',
  'player_choice',
  'fight',
  'search_library',
  'sacrifice',
  'counter_spell',
  'proliferate',
  'open_attraction',
  'roll_visit_attractions',
]);

function extractActivatedEffectText(oracleText: string): string {
  const raw = String(oracleText || '').trim();
  if (!raw) return '';
  const powerUpSplit = raw.match(/^Power-up\s*[—-]\s*[^:]+:\s*(.+)$/is);
  if (powerUpSplit) return String(powerUpSplit[1] || '').trim();
  const colonSplit = raw.match(/^[^:]+:\s*(.+)$/s);
  return colonSplit ? String(colonSplit[1] || '').trim() : raw;
}

function collectAbilitySteps(oracleText: string, sourceName: string): OracleEffectStep[] {
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
    const steps = collectAbilitySteps(params.oracleText, params.sourceName);
    if (steps.length === 0) {
      return { handled: false, applied: 0, pendingOptional: false };
    }

    const supportedSteps = steps.filter(
      (step) => step && step.kind !== 'unknown' && ORACLE_IR_ACTIVATED_STEP_KINDS.has(String(step.kind)),
    );
    if (supportedSteps.length === 0) {
      return { handled: false, applied: 0, pendingOptional: false };
    }

    const state = (ctx as any).state;
    const targetBinding = inferTargetBinding(state, params.targets || []);
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: params.controller,
        sourceId: params.stackItemId || params.sourcePermanentId,
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

    const result = applyOracleIRStepsOnServer(ctx, state, supportedSteps, irCtx, {
      allowOptional: params.allowOptional ?? true,
      selectedModeIds: params.selectedModeIds,
    }, {
      controller: params.controller,
      targetPlayerId: targetBinding.targetPlayerId,
      applyMillReplacements: true,
    });

    const applied = result.appliedSteps.length;
    const pendingOptional = (result.pendingOptionalSteps || []).length > 0;
    const handled = applied > 0 || pendingOptional;

    if (handled) {
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
