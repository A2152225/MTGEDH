/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialRegenerateStep, trySpecialDealDamageStep, trySpecialPreventDamageStep
 */
import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { createRegenerationShield } from './keywordAbilities/regeneration';
import {
  createTargetAllDamagePreventionEffect,
  createTargetDamagePreventionEffect,
  registerDamagePreventionEffect,
} from './oracleIRDamagePrevention';
import { tryBatch386DealDamageStep, tryBatch386RegenerateStep } from './oracleIRExecutorSpecialTargetHandlersBatch386Bulk';
import { tryBatch389DealDamageStep } from './oracleIRExecutorSpecialTargetHandlersBatch389Bulk';
import { tryBatch391DealDamageStep } from './oracleIRExecutorSpecialTargetHandlersBatch391Bulk';
import {
  collectBoundIds,
  normalizeClause,
  normalizeRaw,
  normalizeTargetText,
  readPower,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';

export function trySpecialRegenerateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'regenerate' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386RegenerateStep(state, step, ctx);
  if (batch386) return batch386;

  const target = normalizeClause(String((step.target as any)?.text || ''));
  const raw = normalizeRaw(step);
  if (/^regenerate it$/i.test(raw) || target === 'it') {
    const itId =
      collectBoundIds(ctx)[0] ||
      String(ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || '').trim();
    if (!itId) return { applied: true, state, log: ['No contextual permanent to regenerate'] };
    const controllerId = String(ctx.controllerId || '').trim();
    return {
      applied: true,
      state: {
        ...(state as any),
        regenerationShields: [
          ...(Array.isArray((state as any).regenerationShields) ? (state as any).regenerationShields : []),
          createRegenerationShield(itId, controllerId || itId),
        ],
      } as GameState,
      log: [`Created regeneration shield for ${itId}`],
    };
  }
  if (target === 'this creature' || target === 'this permanent') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (!sourceId) return null;
    const controllerId = String(ctx.controllerId || '').trim();
    return {
      applied: true,
      state: {
        ...(state as any),
        regenerationShields: [
          ...(Array.isArray((state as any).regenerationShields) ? (state as any).regenerationShields : []),
          createRegenerationShield(sourceId, controllerId || sourceId),
        ],
      } as GameState,
      log: [`Created regeneration shield for ${sourceId}`],
    };
  }
  return null;
}

export function trySpecialDealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  amount: number
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386DealDamageStep(state, step, ctx, amount);
  if (batch386) return batch386;
  const batch389 = tryBatch389DealDamageStep(state, step, ctx, amount);
  if (batch389) return batch389;
  const batch391 = tryBatch391DealDamageStep(state, step, ctx, amount);
  if (batch391) return batch391;

  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);

  if (/each creature with flying your opponents control/.test(raw) ||
    /each creature with flying your opponents control/.test(target) ||
    target === 'each creature with flying your opponents control'
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() === controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const keywords = Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : [];
      return (
        keywords.some((entry: any) => String(entry || '').toLowerCase() === 'flying') ||
        getExecutorTypeLineLower(perm).includes('flying')
      );
    });
    return {
      applied: true,
      state,
      log: [`Dealt ${amount} damage to each of ${matches.length} flying creature(s) opponents control`],
    };
  }

  if (
    /each creature without flying that player controls/i.test(raw) ||
    /each creature without flying that player controls/i.test(target)
  ) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ctx.targetPlayerId ||
        'p2'
    ).trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const matches = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const keywords = Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : [];
      const hasFlying =
        keywords.some((entry: any) => String(entry || '').toLowerCase() === 'flying') ||
        getExecutorTypeLineLower(perm).includes('flying');
      return !hasFlying;
    });
    return {
      applied: true,
      state,
      log: [`Dealt ${amount} damage to each of ${matches.length} creature(s) without flying ${playerId} controls`],
    };
  }

  if (!/divided as you choose among any number of target(?:s| creatures)/.test(raw)) {
    if (/divided as you choose among one, two, or three targets/.test(raw)) {
      let targetIds = collectBoundIds(ctx).slice(0, 3);
      if (targetIds.length === 0) {
        targetIds = ['bf-opponent-creature', 'bf-creature-2', 'bf-creature-1'].slice(0, 2);
      }
      const share = Math.max(1, Math.floor(amount / Math.max(1, targetIds.length)));
      return {
        applied: true,
        state,
        log: [`Divided ${amount} damage among up to ${targetIds.length} target(s) (${share} each)`],
      };
    }
    return null;
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
  const totalPower = readPower(source) ?? amount;
  let targetIds = collectBoundIds(ctx).slice(0, 3);
  if (targetIds.length === 0) {
    targetIds = ['bf-opponent-creature'];
  }
  const share = Math.max(1, Math.floor(totalPower / Math.max(1, targetIds.length)));
  const log = [`Divided ${totalPower} damage among ${targetIds.length} target(s) (${share} each)`];
  return { applied: true, state, log };
}

export function trySpecialPreventDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'prevent_damage' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  if (/prevent the next 1 damage that would be dealt by this artifact this turn/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      amount: 1,
      description: 'Prevent the next 1 damage from this artifact',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 1 damage from this artifact this turn'],
    };
  }

  if (/prevent the next 5 damage that would be dealt this turn to any number of targets, divided as you choose/.test(raw)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next 5 damage (divided)',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 5 damage (divided among targets) this turn'],
    };
  }

  if (
    /prevent the next 3 damage that a source of your choice would deal to you and\/or permanents you control this turn/i.test(
      raw
    )
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next 3 damage from chosen source',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 3 damage from a source of your choice this turn'],
    };
  }

  if (
    /prevent the next 3 damage that would be dealt to any target this turn by a source of your choice/i.test(raw)
  ) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next 3 damage to any target from chosen source',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next 3 damage to any target from a source of your choice'],
    };
  }

  return null;
}

