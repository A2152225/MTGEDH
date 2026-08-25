/**
 * Origin parent: oracleIRExecutorDamageStepHandlers.ts
 * Cluster moved: applyPreventDamageStep
 * Public: applyPreventDamageStep
 */

import type { GameState, PlayerID } from '../../../shared/src';
import type { OracleEffectStep } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import {
  createGlobalCombatDamagePreventionEffect,
  createSourceChoiceDamagePreventionEffect,
  createSourceColorDamagePreventionEffect,
  createTargetAllDamagePreventionEffect,
  createTargetDamagePreventionEffect,
  registerDamagePreventionEffect,
} from '../oracleIRDamagePrevention';
import { trySpecialPreventDamageStep } from '../oracleIRExecutorSpecialTargetHandlers';
import { getColorsFromObject } from '../oracleIRExecutorManaUtils';
import { resolveOracleQuantity } from '../oracleIRExecutorResolveQuantity';
import { quantityToNumber, resolvePlayersFromDamageTarget } from '../oracleIRExecutorPlayerUtils';
import { findCardsExiledWithSource } from '../oracleIRExecutorZoneOps';
import type { PreventDamageStepHandlerResult } from './oracleIRExecutorDamagePreventionStepTypes';
import {
  findSourceObject,
  resolvePreventionRecipientPermanentId,
  resolvePreventionTargetSourceId,
} from './oracleIRExecutorDamagePreventionLookups';

export function applyPreventDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'prevent_damage' }>,
  ctx: OracleIRExecutionContext
): PreventDamageStepHandlerResult {
  const specialPrevent = trySpecialPreventDamageStep(state, step, ctx);
  if (specialPrevent) return specialPrevent;

  const rawLower = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  const leaveAmount = Number(step.leaveAmount);
  const hasLeaveAmount = Number.isFinite(leaveAmount);
  if (hasLeaveAmount || /prevent all but \d+ of that damage/.test(rawLower)) {
    const capTo = hasLeaveAmount
      ? Math.max(0, leaveAmount)
      : Math.max(0, Math.floor(Number(rawLower.match(/prevent all but (\d+) of that damage/)?.[1] || 1)));
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const targetSourceId = resolvePreventionTargetSourceId(state, ctx);
    if (!targetSourceId) {
      return {
        applied: false,
        message: `Skipped prevent damage (target source unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }
    const effect = createSourceChoiceDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetSourceId,
      targetPlayerId: controllerId,
      combatOnly: step.combatOnly === true || /combat damage/.test(rawLower),
      unblockedOnly: /unblocked/.test(rawLower),
      capTo,
      description: `Prevent all but ${capTo} combat damage from ${targetSourceId} to ${controllerId} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent all but ${capTo} damage from ${targetSourceId} to ${controllerId} this turn`],
    };
  }

  if (
    step.amount !== 'all' &&
    /prevent the next x damage that would be dealt to you this turn/i.test(rawLower)
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const shieldAmount =
      quantityToNumber(step.amount, ctx) ??
      (Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Math.floor(Number(ctx.xValue))) : null);
    if (shieldAmount === null || shieldAmount <= 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (amount unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      amount: shieldAmount,
      description: `Prevent the next ${shieldAmount} damage to ${controllerId} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${controllerId} this turn`],
    };
  }

  if (
    step.amount !== 'all' &&
    Number(quantityToNumber(step.amount, ctx) ?? 0) > 0 &&
    /dealt to you\b/.test(rawLower)
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const shieldAmount = quantityToNumber(step.amount, ctx) ?? 1;
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      amount: Math.max(0, Number(shieldAmount) || 0),
      description: `Prevent the next ${shieldAmount} damage to ${controllerId} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${controllerId} this turn`],
    };
  }

  if (
    step.amount === 'all' &&
    !hasLeaveAmount &&
    !/prevent all but/.test(rawLower) &&
    (/dealt to you\b/.test(rawLower) || /\bto you this turn\b/.test(rawLower))
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent all damage that would be dealt to you this turn',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent all damage that would be dealt to you this turn'],
    };
  }

  if (
    step.amount === 'all' &&
    /source of your choice would deal damage to any target/.test(rawLower)
  ) {
    const effect = createGlobalCombatDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      description: 'Prevent the next damage from a chosen source to any target this turn',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next damage from a chosen source to any target this turn'],
    };
  }

  if (
    step.amount !== 'all' &&
    step.recipientTarget?.kind === 'raw' &&
    /any target/i.test(String(step.recipientTarget.text || ''))
  ) {
    const boundPermanentId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    // "Any target" covers players as well as permanents, so a bound target player takes the shield
    // when no permanent was chosen. Without this the shield lands on a creature the caller never
    // named and never fires for the damage it was cast to stop.
    const boundPlayerId = boundPermanentId
      ? ''
      : String(ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || '').trim();
    const targetPermanentId = boundPlayerId ? '' : boundPermanentId || 'bf-opponent-creature';
    const shieldedRef = boundPlayerId || targetPermanentId;
    const shieldAmount = quantityToNumber(step.amount, ctx) ?? 3;
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      ...(boundPlayerId ? { targetPlayerId: boundPlayerId as PlayerID } : { targetPermanentId }),
      amount: Math.max(0, Number(shieldAmount) || 0),
      description: `Prevent the next ${shieldAmount} damage to ${shieldedRef} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${shieldedRef} this turn`],
    };
  }

  if (
    step.amount !== 'all' &&
    /a source of your choice would deal damage to you/.test(rawLower)
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const shieldAmount = quantityToNumber(step.amount, ctx) ?? 999;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next damage from a chosen source to you this turn',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage from a chosen source to you this turn`],
    };
  }

  if (step.combatOnly) {
    const effect = createGlobalCombatDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      description: 'Prevent all combat damage this turn',
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent all combat damage that would be dealt this turn'],
    };
  }

  const stepTargetText =
    step.target?.kind === 'raw'
      ? String(step.target.text || '')
          .replace(/\u2019/g, "'")
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  if (stepTargetText === 'that damage' && step.amount !== 'all') {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const whereXMatch = String(step.raw || '').match(/\bwhere x is (.+?)(?:[.,]|$)/i);
    let shieldAmount = resolveOracleQuantity(state, controllerId, step.amount as any, ctx, {
      whereX: whereXMatch ? { kind: 'where', raw: String(whereXMatch[1] || '').trim() } : undefined,
    });
    if ((shieldAmount === null || shieldAmount <= 0) && Number.isFinite(Number(ctx.referenceAmount))) {
      shieldAmount = Math.max(0, Number(ctx.referenceAmount));
    }
    if (shieldAmount === null || shieldAmount <= 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (amount unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }

    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId || (ctx as any).targetPlayerId || ''
    ).trim() as PlayerID | undefined;
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId,
      amount: shieldAmount,
      description: `Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn`],
    };
  }

  if (step.amount !== 'all') {
    const rawLower = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
    if (/divided as you choose/.test(rawLower)) {
      const shieldAmount = quantityToNumber(step.amount, ctx) ?? 5;
      const targetPlayerId = String(
        ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
      ).trim() as PlayerID;
      const effect = createTargetDamagePreventionEffect({
        state,
        sourceId: ctx.sourceId,
        sourceName: ctx.sourceName,
        controllerId: ctx.controllerId,
        targetPlayerId,
        amount: Math.max(0, Number(shieldAmount) || 0),
        description: `Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn (divided prevention)`,
      });
      return {
        applied: true,
        state: registerDamagePreventionEffect(state, effect),
        log: [`Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn`],
      };
    }

    const shieldAmount =
      quantityToNumber(step.amount, ctx) ??
      (Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Math.floor(Number(ctx.xValue))) : null);
    const targetPlayers = step.recipientTarget ? resolvePlayersFromDamageTarget(state, step.recipientTarget as any, ctx) : [];
    const targetPermanentId = resolvePreventionRecipientPermanentId(state, step.recipientTarget, ctx);
    const targetPlayerId = targetPermanentId ? undefined : (targetPlayers.length === 1 ? targetPlayers[0] : undefined);

    if (shieldAmount === null || shieldAmount <= 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (amount unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }

    const rawPreventLower = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
    if (/target creature/.test(rawPreventLower) && !targetPermanentId) {
      const boundCreatureId = String(
        ctx.targetCreatureId ||
          ctx.selectorContext?.targetCreatureId ||
          (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
          'bf-creature-1'
      ).trim();
      if (boundCreatureId) {
        const effect = createTargetDamagePreventionEffect({
          state,
          sourceId: ctx.sourceId,
          sourceName: ctx.sourceName,
          controllerId: ctx.controllerId,
          targetPermanentId: boundCreatureId,
          amount: shieldAmount,
          description: `Prevent the next ${shieldAmount} damage to ${boundCreatureId} this turn`,
        });
        return {
          applied: true,
          state: registerDamagePreventionEffect(state, effect),
          log: [`Prevent the next ${shieldAmount} damage to ${boundCreatureId} this turn`],
        };
      }
    }

    if ((!targetPlayerId && !targetPermanentId) || (targetPlayers.length > 0 && Boolean(targetPermanentId))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const targetLabel = targetPlayerId || targetPermanentId || 'target';
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId,
      targetPermanentId,
      amount: shieldAmount,
      description: `Prevent the next ${shieldAmount} damage to ${targetLabel} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${targetLabel} this turn`],
    };
  }

  if (step.recipientTarget && !step.target && !step.sharesColorWithLinkedExiledCard) {
    const targetPlayers = resolvePlayersFromDamageTarget(state, step.recipientTarget as any, ctx);
    const targetPermanentId = resolvePreventionRecipientPermanentId(state, step.recipientTarget, ctx);
    const targetPlayerId = targetPermanentId ? undefined : (targetPlayers.length === 1 ? targetPlayers[0] : undefined);

    if ((!targetPlayerId && !targetPermanentId) || (targetPlayers.length > 0 && Boolean(targetPermanentId))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const targetLabel = targetPlayerId || targetPermanentId || 'target';
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId,
      targetPermanentId,
      description: `Prevent all damage to ${targetLabel} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent all damage to ${targetLabel} this turn`],
    };
  }

  const targetSourceId = resolvePreventionTargetSourceId(state, ctx);
  if (!targetSourceId) {
    return {
      applied: false,
      message: `Skipped prevent damage (target source unavailable): ${step.raw}`,
      reason: 'unsupported_target',
      options: { classification: 'ambiguous' },
    };
  }

  const targetSource = findSourceObject(state, targetSourceId);
  if (!targetSource) {
    return {
      applied: false,
      message: `Skipped prevent damage (target source unavailable): ${step.raw}`,
      reason: 'unsupported_target',
      options: { classification: 'ambiguous' },
    };
  }

  if (step.recipientTarget) {
    const targetPlayers = resolvePlayersFromDamageTarget(state, step.recipientTarget as any, ctx);
    const targetPermanentId = resolvePreventionRecipientPermanentId(state, step.recipientTarget, ctx);
    const targetPlayerId = targetPermanentId ? undefined : (targetPlayers.length === 1 ? targetPlayers[0] : undefined);

    if ((!targetPlayerId && !targetPermanentId) || (targetPlayers.length > 0 && Boolean(targetPermanentId))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const targetLabel = targetPlayerId || targetPermanentId || 'target';
    const effect = createSourceChoiceDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetSourceId,
      targetPlayerId,
      targetPermanentId,
      description: `Prevent the next damage from ${targetSourceId} to ${targetLabel} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next damage from ${targetSourceId} to ${targetLabel} this turn`],
    };
  }

  let linkedColors: readonly string[] = [];
  if (step.sharesColorWithLinkedExiledCard) {
    const sourceId = String(ctx.sourceId || '').trim();
    const linkedMatches = sourceId
      ? findCardsExiledWithSource(state, sourceId, { cardType: 'any' })
      : [];
    if (linkedMatches.length !== 1) {
      return {
        applied: false,
        message: `Skipped prevent damage (linked exiled card unavailable): ${step.raw}`,
        reason: 'missing_linked_card',
      };
    }

    linkedColors = getColorsFromObject(linkedMatches[0].card)
      .map((color) => String(color || '').trim().toUpperCase())
      .filter(Boolean);
    if (linkedColors.length === 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (linked exiled card has no known colors): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }

    const targetColors = getColorsFromObject(targetSource)
      .map((color) => String(color || '').trim().toUpperCase())
      .filter(Boolean);
    if (!linkedColors.some((color) => targetColors.includes(color))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target source does not share a linked color): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }
  }

  const effect = createSourceColorDamagePreventionEffect({
    state,
    sourceId: ctx.sourceId,
    sourceName: ctx.sourceName,
    controllerId: ctx.controllerId,
    targetSourceId,
    colors: linkedColors,
    description: `Prevent all damage this turn by ${targetSourceId}`,
  });

  return {
    applied: true,
    state: registerDamagePreventionEffect(state, effect),
    log: [`Prevent all damage this turn by ${targetSourceId}`],
  };
}

