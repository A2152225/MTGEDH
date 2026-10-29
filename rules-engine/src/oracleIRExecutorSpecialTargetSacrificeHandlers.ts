/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialSacrificeStep
 */
import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { finalizeBattlefieldRemoval, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import {
  tryBatch387SacrificeStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch387Bulk';
import {
  tryBatch388SacrificeStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch388Bulk';
import {
  tryBatch389SacrificeStep,
} from './oracleIRExecutorSpecialTargetHandlersBatch389Bulk';
import {
  normalizeRaw,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';
import {
  resolveContextualCreature,
  resolveEnchantedHost,
  resolveSourcePermanent,
} from './oracleIRExecutorSpecialTargetResolve';

export function trySpecialSacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch387 = tryBatch387SacrificeStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388SacrificeStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389SacrificeStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const sacrificePermanents = (permanents: readonly BattlefieldPermanent[]): SpecialTargetStepResult => {
    if (permanents.length === 0) {
      const sourceId = String(ctx.sourceId || '').trim();
      if (/sacrifice this permanent/.test(raw) && sourceId) {
        return { applied: true, state, log: ['Source permanent already absent for sacrifice'] };
      }
      return { applied: false, message: `Skipped sacrifice (no deterministic target): ${step.raw}`, reason: 'no_deterministic_target' };
    }
    const removedIds = new Set(permanents.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    const kept = battlefield.filter((perm) => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [...permanents], removedIds, kept, 'graveyard', 'sacrificed');
    return {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: [...permanents],
    };
  };

  if (/then sacrifice this permanent/.test(raw) || /sacrifice this permanent/.test(raw)) {
    const source = resolveSourcePermanent(battlefield, ctx);
    return source ? sacrificePermanents([source]) : null;
  }

  const sourceName = String(ctx.sourceName || '').trim();
  if (sourceName && raw.includes(`sacrifice ${sourceName.toLowerCase()}`)) {
    const source = resolveSourcePermanent(battlefield, ctx);
    return source ? sacrificePermanents([source]) : null;
  }

  if (/sacrifice enchanted creature/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    return host ? sacrificePermanents([host]) : null;
  }

  if (/enchanted creature's controller sacrifices it/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    return host ? sacrificePermanents([host]) : null;
  }

  if (/target artifact creature'?s controller sacrifices it/i.test(raw)) {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const target = targetId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === targetId)
      : battlefield.find(
          (perm: any) =>
            permanentMatchesType(perm, 'artifact') && permanentMatchesType(perm, 'creature')
        );
    return target ? sacrificePermanents([target]) : null;
  }

  if (/that player sacrifices (?:it|that creature)/.test(raw) || /the player sacrifices that creature/.test(raw)) {
    const host = resolveContextualCreature(battlefield, ctx);
    return host ? sacrificePermanents([host]) : null;
  }

  if (/sacrifices the rest/.test(raw) || /then sacrifices the rest/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const keptIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    // No prior choice means "the rest" is not the whole board. Choose-then-sacrifice
    // spells halt on each_player_choose_then_sacrifice_rest instead of reaching here.
    if (keptIds.size === 0) return null;
    const victims = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return id && String(perm?.controller || '').trim() === controllerId && !keptIds.has(id);
    });
    return sacrificePermanents(victims);
  }

  if (/^sacrifice it at end of combat/.test(raw)) {
    const targetId = String(ctx.targetPermanentId || ctx.targetCreatureId || ctx.sourceId || '').trim();
    const target = targetId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === targetId)
      : resolveContextualCreature(battlefield, ctx);
    return target ? sacrificePermanents([target]) : null;
  }

  if (/each player sacrifices all creatures they control not chosen this way/i.test(raw)) {
    const keptIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const victims = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !permanentMatchesType(perm, 'creature')) return false;
      return !keptIds.has(id);
    });
    return sacrificePermanents(victims);
  }

  if (/each opponent sacrifices an artifact/i.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const victims = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId) => playerId && playerId !== controllerId)
      .map((opponentId) =>
        battlefield.find(
          (perm: any) =>
            String(perm?.controller || '').trim() === opponentId &&
            permanentMatchesType(perm, 'artifact')
        )
      )
      .filter(Boolean) as BattlefieldPermanent[];
    return sacrificePermanents(victims);
  }

  return null;
}

