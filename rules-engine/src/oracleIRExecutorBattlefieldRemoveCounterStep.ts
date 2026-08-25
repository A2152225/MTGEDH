// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveRemoveCounterTargets, applyRemoveCounterStep.
// Public entry: applyRemoveCounterStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { findCardZoneLocation } from './oracleIRExecutorBattlefieldCardZoneLocation';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { trySpecialRemoveCounterStep } from './oracleIRExecutorSpecialTargetHandlers';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function resolveRemoveCounterTargets(
  battlefield: readonly BattlefieldPermanent[],
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  const normalizedTargetText = normalizeBattlefieldTargetReferenceText(
    String((step.target as any)?.text || '')
  ).toLowerCase();
  const counterName = String(step.counter || '').trim();

  const controlledCreatureOrPlaneswalker = normalizedTargetText.match(
    /^a (creature or planeswalker|planeswalker or creature) you control$/
  );
  if (controlledCreatureOrPlaneswalker) {
    const controllerId = String(ctx.controllerId || '').trim();
    const candidates = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, 'creature') || permanentMatchesType(perm, 'planeswalker');
    });
    const withNamedCounter = counterName
      ? candidates.filter((perm: any) => Number((perm as any)?.counters?.[counterName] ?? 0) > 0)
      : candidates.filter((perm: any) =>
          Object.values(((perm as any)?.counters || {}) as Record<string, number>).some(count => Number(count) > 0)
        );
    const resolved = (withNamedCounter.length > 0 ? withNamedCounter : candidates).slice(0, 1);
    return resolved;
  }

  if (/^among creatures you control$/i.test(normalizedTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number((perm as any)?.counters?.['+1/+1'] ?? 0) > 0;
    });
  }

  if (/^any number of \+1\/\+1 counters from among creatures you control$/i.test(normalizedTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number((perm as any)?.counters?.['+1/+1'] ?? 0) > 0;
    });
  }

  const permanentOrSuspended = normalizedTargetText.match(
    /^target (?:permanent or suspended card|suspended card or permanent)$/
  );
  if (permanentOrSuspended) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatches = battlefield.filter((perm: any) =>
      boundIds.includes(String((perm as any)?.id || '').trim())
    );
    if (boundMatches.length > 0) return boundMatches.slice(0, 1);
  }

  if (/^this aura$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    if (source) return [source];
  }

  if (/^that creature$/i.test(normalizedTargetText)) {
    const targetId = String(
      ctx.targetCreatureId || ctx.enchantedPermanentId || ctx.lastReferencedPermanentId || ''
    ).trim();
    if (targetId) {
      const match = battlefield.find((perm: any) => String(perm?.id || '').trim() === targetId);
      if (match) return [match];
    }
  }

  if (/^it$/i.test(normalizedTargetText) || /^this (?:creature|permanent)$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      const source = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
      if (source) return [source];
    }
  }

  if (/^target creature$/i.test(normalizedTargetText)) {
    const explicitTargetId = String(
      ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ''
    ).trim();
    if (explicitTargetId) {
      const explicit = battlefield.find((perm: any) => String(perm?.id || '').trim() === explicitTargetId);
      if (explicit) return [explicit];
    }
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatches = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(permanentId)) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (boundMatches.length > 0) {
      if (counterName) {
        const withNamedCounter = boundMatches.filter(
          (perm: any) => Number((perm as any)?.counters?.[counterName] ?? 0) > 0
        );
        if (withNamedCounter.length > 0) return withNamedCounter.slice(0, 1);
      }
      return boundMatches.slice(0, 1);
    }
  }

  if (/^target permanent$/i.test(normalizedTargetText) || /^target nonland permanent$/i.test(normalizedTargetText)) {
    const explicitTargetId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    if (explicitTargetId) {
      const explicit = battlefield.find((perm: any) => String(perm?.id || '').trim() === explicitTargetId);
      if (explicit) return [explicit];
    }
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatches = battlefield.filter((perm: any) =>
      boundIds.includes(String((perm as any)?.id || '').trim())
    );
    if (boundMatches.length > 0) return boundMatches.slice(0, 1);
  }

  if (/^target noncreature artifact$/i.test(normalizedTargetText) || /noncreature artifact$/i.test(normalizedTargetText)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      return permanentMatchesType(perm, 'artifact') && !permanentMatchesType(perm, 'creature');
    });
    if (matches.length > 0) return matches.slice(0, 1);
    return battlefield
      .filter(
        (perm: any) =>
          permanentMatchesType(perm, 'artifact') && !permanentMatchesType(perm, 'creature')
      )
      .slice(0, 1);
  }

  if (/^them$/i.test(normalizedTargetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const matches = battlefield.filter((perm: any) =>
      ids.includes(String((perm as any)?.id || '').trim())
    );
    if (matches.length > 0) return matches;
  }

  return resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
}

export function applyRemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialRemoveCounterStep(state, step, ctx);
  if (special) return special;

  const controllerId = (String(ctx.controllerId || '').trim() ||
    String((state.players || [])[0]?.id || '').trim()) as PlayerID;
  const removeAllCounters = step.amount.kind === 'all' || step.amount.kind === 'any_number';
  let amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (!removeAllCounters && amountValue === null) {
    const resolvedAmount = resolveOracleQuantity(state, controllerId, step.amount, ctx, { step });
    amountValue = resolvedAmount === null ? null : resolvedAmount;
  }
  if (!removeAllCounters && (amountValue === null || amountValue <= 0)) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  // Mutated Cultist-style: remove all counters from a targeted player (opponent).
  {
    const effectiveTargetEarly = effectiveStepTarget(step) || step.target;
    const targetTextEarly = effectiveTargetEarly?.kind === 'raw'
      ? String((effectiveTargetEarly as any).text || '').toLowerCase()
      : '';
    const targetPlayerId = String(
      ctx.targetPlayerId
        || (ctx.selectorContext as any)?.targetPlayerId
        || (ctx.selectorContext as any)?.targetOpponentId
        || '',
    ).trim();
    const wantsPlayer = /\bopponent\b/.test(targetTextEarly) || /\bplayer\b/.test(targetTextEarly);
    if (
      wantsPlayer
      && targetPlayerId
      && (step.amount.kind === 'all' || step.amount.kind === 'any_number')
      && (String(step.counter || '').toLowerCase() === 'any'
        || String(step.counter || '').toLowerCase() === 'all'
        || String(step.counter || '').toLowerCase() === 'counter')
    ) {
      const players = Array.isArray((state as any).players) ? [...(state as any).players] : [];
      const idx = players.findIndex((pl: any) => String(pl?.id || '').trim() === targetPlayerId);
      if (idx >= 0) {
        const player = players[idx] as any;
        const counters = { ...((player.counters || {}) as Record<string, number>) };
        let removedTotal = 0;
        for (const [key, value] of Object.entries(counters)) {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            removedTotal += n;
            counters[key] = 0;
          }
        }
        // Also clear common top-level counter fields if present.
        const nextPlayer = { ...player, counters };
        for (const key of ['poisonCounters', 'energyCounters', 'experienceCounters', 'radCounters']) {
          const n = Number((player as any)[key] || 0);
          if (n > 0) {
            removedTotal += n;
            (nextPlayer as any)[key] = 0;
          }
        }
        players[idx] = nextPlayer;
        (ctx as any).countersRemovedThisWay = Number((ctx as any).countersRemovedThisWay || 0) + removedTotal;
        return {
          applied: true,
          state: { ...(state as any), players } as GameState,
          log: [`Removed ${removedTotal} counter(s) from player ${targetPlayerId}`],
        };
      }
    }
  }

  const targets = resolveRemoveCounterTargets((state.battlefield || []) as BattlefieldPermanent[], {
    ...step,
    target: effectiveStepTarget(step) || step.target,
  } as typeof step, ctx);
  const effectiveTarget = effectiveStepTarget(step) || step.target;
  const normalizedTargetText = effectiveTarget.kind === 'raw'
    ? normalizeSelfReferenceText(effectiveTarget.text.trim()).toLowerCase()
    : '';
  if (targets.length === 0 && (step as any).optional === true) {
    return { applied: true, state, log: ['No target chosen for optional remove-counter'] };
  }
  if (
    targets.length === 0 &&
    (normalizedTargetText === 'among creatures you control' ||
      /^any number of \+1\/\+1 counters from among creatures you control$/i.test(normalizedTargetText))
  ) {
    return { applied: true, state, log: ['No +1/+1 counters to remove'] };
  }
  const allowMultipleDeterministicTargets =
    removeAllCounters &&
    (/^(?:all|each)\b/.test(normalizedTargetText) ||
      normalizedTargetText === 'them' ||
      normalizedTargetText === 'among creatures you control' ||
      /^any number of \+1\/\+1 counters from among creatures you control$/i.test(normalizedTargetText));
  if (targets.length > 1 && !allowMultipleDeterministicTargets) {
    return {
      applied: false,
      message: `Skipped remove counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }
  let counterName = String(step.counter || '').trim();
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const battlefieldTarget = targets[0] as any;
  if ((counterName.toLowerCase() === 'any' || counterName.toLowerCase() === 'all') && battlefieldTarget) {
    const counters = { ...(((battlefieldTarget as any).counters || {}) as Record<string, number>) };
    let removedTotal = 0;
    for (const [key, value] of Object.entries(counters)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) {
        removedTotal += n;
        counters[key] = 0;
      }
    }
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const idx = battlefield.findIndex((p) => String((p as any)?.id || '').trim() === String((battlefieldTarget as any).id || '').trim());
    if (idx >= 0) {
      battlefield[idx] = { ...(battlefield[idx] as any), counters } as BattlefieldPermanent;
      (ctx as any).countersRemovedThisWay = Number((ctx as any).countersRemovedThisWay || 0) + removedTotal;
      return {
        applied: true,
        state: { ...(state as any), battlefield } as GameState,
        log: [`Removed ${removedTotal} counter(s) from ${String((battlefieldTarget as any).id || 'permanent')}`],
      };
    }
  }

  if (counterName.toLowerCase() === 'counter' && battlefieldTarget && !allowMultipleDeterministicTargets) {
    const counterKeys = Object.keys((battlefieldTarget?.counters || {}) as Record<string, number>).filter(
      (key) => Number((battlefieldTarget?.counters || {})[key]) > 0
    );
    if (counterKeys.length === 1) {
      counterName = counterKeys[0]!;
    } else if (counterKeys.length > 1) {
      const preferred = counterKeys.find((key) => key === '+1/+1') || counterKeys[0];
      counterName = preferred || counterName;
    }
  }
  if (battlefieldTarget && !allowMultipleDeterministicTargets) {
    const currentCount = Number(battlefieldTarget?.counters?.[counterName] ?? 0);
    const normalizedCount = Number.isFinite(currentCount) ? currentCount : 0;
    const removedCount = removeAllCounters ? normalizedCount : amountValue || 0;
    if (!removeAllCounters && normalizedCount < (amountValue || 0)) {
      return {
        applied: false,
        message: `Skipped remove counter (not enough counters): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            counter: counterName,
            availableCount: normalizedCount,
            requiredCount: amountValue,
            targetId: String(battlefieldTarget?.id || '').trim() || null,
          },
        },
      };
    }

    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== String(battlefieldTarget?.id || '').trim()) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const nextCount = normalizedCount - removedCount;
      if (nextCount > 0) {
        counters[counterName] = nextCount;
      } else {
        delete counters[counterName];
      }
      return {
        ...perm,
        counters,
      };
    });

    return {
      applied: true,
      state: {
        ...(state as any),
        battlefield: nextBattlefield,
      } as GameState,
      count: removedCount,
      log: [`Removed ${removedCount} ${counterName} counter(s)`],
    };
  }

  if (targets.length > 0 && allowMultipleDeterministicTargets) {
    const targetIds = new Set(targets.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    let removedCount = 0;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!targetIds.has(String(perm?.id || '').trim())) return perm;

      const currentCount = Number(perm?.counters?.[counterName] ?? 0);
      const normalizedCount = Number.isFinite(currentCount) ? currentCount : 0;
      if (normalizedCount <= 0) return perm;

      removedCount += normalizedCount;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      delete counters[counterName];
      return {
        ...perm,
        counters,
      };
    });

    return {
      applied: true,
      state: {
        ...(state as any),
        battlefield: nextBattlefield,
      } as GameState,
      count: removedCount,
      log: [`Removed ${removedCount} ${counterName} counter(s)`],
    };
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const location = sourceId ? findCardZoneLocation(state, sourceId) : null;
  if (!location || location.zone !== 'exile') {
    return {
      applied: false,
      message: `Skipped remove counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const ownerId = String(location.playerId || '').trim();
  let removedFromExile = false;
  let availableCount = 0;
  const nextPlayers = (state.players || []).map((player: any) => {
    const playerId = String(player?.id || '').trim();
    if (playerId !== ownerId) return player;

    const exile = Array.isArray(player?.exile) ? player.exile : [];
    let changed = false;
    const nextExile = exile.map((card: any) => {
      if (String(card?.id || '').trim() !== sourceId) return card;
      const currentCount = Number(card?.counters?.[counterName] ?? 0);
      availableCount = Number.isFinite(currentCount) ? currentCount : 0;
      const removedCount = removeAllCounters ? availableCount : amountValue || 0;
      if (!removeAllCounters && availableCount < (amountValue || 0)) return card;

      const counters = { ...((card?.counters || {}) as Record<string, number>) };
      const nextCount = availableCount - removedCount;
      if (nextCount > 0) {
        counters[counterName] = nextCount;
      } else {
        delete counters[counterName];
      }
      changed = true;
      removedFromExile = true;
      return {
        ...card,
        counters,
      };
    });

    return changed ? { ...player, exile: nextExile } : player;
  });

  if (!removedFromExile) {
    return {
      applied: false,
      message: `Skipped remove counter (not enough counters): ${step.raw}`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          counter: counterName,
          availableCount,
          requiredCount: amountValue,
          targetId: sourceId || null,
        },
      },
    };
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      players: nextPlayers as any,
    } as GameState,
    count: removeAllCounters ? availableCount : amountValue || 0,
    log: [`Removed ${removeAllCounters ? availableCount : amountValue || 0} ${counterName} counter(s)`],
  };
}

