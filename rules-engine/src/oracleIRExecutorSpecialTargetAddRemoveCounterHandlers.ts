/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialAddCounterStep, trySpecialRemoveCounterStep
 */
import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { tryBatch386RemoveCounterStep } from './oracleIRExecutorSpecialTargetHandlersBatch386Bulk';
import { tryBatch388RemoveCounterStep } from './oracleIRExecutorSpecialTargetHandlersBatch388Bulk';
import { tryBatch389RemoveCounterStep } from './oracleIRExecutorSpecialTargetHandlersBatch389Bulk';
import {
  collectBoundIds,
  normalizeClause,
  normalizeRaw,
  readContextualCardsFromCtx,
  typeLineHasSubtype,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';
import { resolveContextualCreature } from './oracleIRExecutorSpecialTargetResolve';

export function trySpecialAddCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const counterName = String(step.counter || '+1/+1').trim();

  if (/total power of creatures goaded this way/.test(raw)) {
    const amount = Math.max(1, Number(ctx.referenceAmount ?? 6));
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== sourceId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} ${counterName} counter(s) for goaded power`],
    };
  }

  if (/number of elves you control/.test(raw)) {
    const elfCount = Math.max(1, Number(ctx.referenceAmount ?? 2));
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (!permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + elfCount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${elfCount} ${counterName} counter(s) per elf count`],
    };
  }

  if (/growth counters on this enchantment/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const amount = Math.max(1, Number((source as any)?.counters?.growth ?? ctx.referenceAmount ?? 3));
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || sourceId).trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (id !== targetId && id !== sourceId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} ${counterName} counter(s) from growth counters`],
    };
  }

  if (/ingredient counters on this enchantment/.test(raw)) {
    return trySpecialAddCounterStep(
      state,
      { ...step, raw: 'put x +1/+1 counters on it, where x is the number of growth counters on this enchantment' } as any,
      ctx
    );
  }

  if (/mana value minus 4/.test(raw)) {
    const movedCards = [
      ...readContextualCardsFromCtx(ctx),
      ...(Array.isArray((ctx as any).lastCreatedTokens) ? (ctx as any).lastCreatedTokens : []),
    ];
    const creatureCard = movedCards.find((card: any) =>
      /\bcreature\b/i.test(String(card?.type_line || card?.cardType || ''))
    );
    const mv = creatureCard ? getCardManaValue(creatureCard) : Number(ctx.referenceAmount ?? 3);
    const amount = Math.max(0, (mv ?? 3) - 4);
    const targetId = String(
      creatureCard?.id || ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (targetId && id !== targetId) return perm;
      if (!targetId && !permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} ${counterName} counter(s) from mana value minus 4`],
    };
  }

  if (/put (?:two|\d+) loyalty counters on it for each planeswalker destroyed this way/i.test(raw)) {
    const amountMatch = raw.match(/put (two|\d+) loyalty counters on it/i);
    const perDestroyed =
      String(amountMatch?.[1] || '2').toLowerCase() === 'two'
        ? 2
        : Number.parseInt(String(amountMatch?.[1] || '2'), 10);
    const destroyedCount = Math.max(
      1,
      collectBoundIds(ctx).filter((id) => {
        const perm = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === id
        );
        return perm && permanentMatchesType(perm, 'planeswalker');
      }).length || 1
    );
    const amount = Math.max(0, (Number.isFinite(perDestroyed) ? perDestroyed : 2) * destroyedCount);
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const chosenIds = collectBoundIds(ctx);
    const targetId = String(
      chosenIds.find((id) => {
        const perm = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === id
        );
        return (
          perm &&
          permanentMatchesType(perm, 'planeswalker') &&
          String((perm as any)?.controller || '').trim() === controllerId
        );
      }) ||
        ((state.battlefield || []) as any[]).find(
          (perm: any) =>
            permanentMatchesType(perm, 'planeswalker') &&
            String(perm?.controller || '').trim() === controllerId
        )?.id ||
        ''
    ).trim();
    if (!targetId) {
      return { applied: true, state, log: ['No planeswalker you control for loyalty counters'] };
    }
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters.loyalty = (Number(counters.loyalty ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Added ${amount} loyalty counter(s) to ${targetId}`],
    };
  }

  if (/put a takeover counter on it/.test(raw)) {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (targetId && id !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters.takeover = (Number(counters.takeover ?? 0) || 0) + 1;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Added takeover counter'],
    };
  }

  return null;
}


function removeCounterFromPermanents(
  state: GameState,
  targetIds: Set<string>,
  counterName: string,
  amount: number | 'all'
): SpecialTargetStepResult {
  let removed = 0;
  const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    const id = String(perm?.id || '').trim();
    if (!targetIds.has(id)) return perm;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const current = Number(counters[counterName] ?? 0) || 0;
    if (current <= 0) return perm;
    const delta = amount === 'all' ? current : Math.min(current, amount);
    removed += delta;
    const next = current - delta;
    if (next > 0) counters[counterName] = next;
    else delete counters[counterName];
    return { ...perm, counters };
  });
  if (amount !== 'all' && typeof amount === 'number' && amount > 0 && removed < amount) {
    return {
      applied: false,
      message: `Skipped remove counter (not enough counters): remove ${amount} ${counterName} counter(s)`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          counter: counterName,
          availableCount: removed,
          requiredCount: amount,
        },
      },
    };
  }

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Removed ${removed} ${counterName} counter(s)`],
  };
}

export function trySpecialRemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386RemoveCounterStep(state, step, ctx);
  if (batch386) return batch386;
  const batch388 = tryBatch388RemoveCounterStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389RemoveCounterStep(state, step, ctx);
  if (batch389) return batch389;

  const raw = normalizeRaw(step);
  const target = normalizeClause(String((step.target as any)?.text || ''));
  const counterName = String(step.counter || '+1/+1').trim();

  if (/remove that many reprieve counters from this creature/.test(raw)) {
    const amount = Math.max(1, Number(ctx.referenceAmount ?? 2));
    const sourceId = String(ctx.sourceId || ctx.targetCreatureId || '').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (sourceId && id !== sourceId) return perm;
      if (!sourceId && !permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.reprieve ?? 0) || 0;
      if (current > 0) counters.reprieve = Math.max(0, current - amount);
      if (Number(counters.reprieve ?? 0) <= 0) delete counters.reprieve;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Removed up to ${amount} reprieve counter(s) from this creature`],
    };
  }

  if (target === 'among creatures you control') {
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (!permanentMatchesType(perm, 'creature')) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      if (Number(counters[counterName] ?? 0) > 0) delete counters[counterName];
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Removed ${counterName} counters from controlled creatures`],
    };
  }

  if (
    target === 'among permanents on the battlefield' ||
    /remove any number of counters from among permanents on the battlefield/i.test(raw)
  ) {
    let removedTotal = 0;
    const battlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      for (const [name, value] of Object.entries(counters)) {
        const count = Number(value) || 0;
        if (count <= 0) continue;
        removedTotal += count;
        delete counters[name];
      }
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Removed ${removedTotal} counter(s) from permanents on the battlefield`],
      count: removedTotal,
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const controllerId = String(ctx.controllerId || 'p1').trim();

  if (/remove a bait counter from this equipment/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    return removeCounterFromPermanents(state, new Set([sourceId].filter(Boolean)), 'bait', 1);
  }

  if (/remove a -1\/-1 counter from each creature you control/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter(
          (perm) =>
            permanentMatchesType(perm, 'creature') &&
            String((perm as any)?.controller || '').trim() === controllerId
        )
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, '-1/-1', 1);
  }

  if (/remove all hourglass counters from permanents that player controls/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter((perm) => String((perm as any)?.controller || '').trim() !== controllerId)
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'hourglass', 'all');
  }

  if (/remove all rope counters from all creatures/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter((perm) => permanentMatchesType(perm, 'creature'))
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'rope', 'all');
  }

  if (/remove all flood counters from them/i.test(raw) || target === 'remove all flood counters from them') {
    const boundIds = new Set(collectBoundIds(ctx));
    const ids = new Set(
      battlefield
        .filter((perm) => {
          const id = String((perm as any)?.id || '').trim();
          return boundIds.size === 0 || boundIds.has(id);
        })
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'flood', 'all');
  }

  if (/remove a time counter from each other card you own in exile/i.test(raw)) {
    const ownerId = String(ctx.controllerId || 'p1').trim();
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === ownerId) as any;
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    const sourceId = String(ctx.sourceId || '').trim();
    let removed = 0;
    const nextExile = exile.map((card: any) => {
      const id = String(card?.id || '').trim();
      if (sourceId && id === sourceId) return card;
      const counters = { ...((card?.counters || {}) as Record<string, number>) };
      const current = Number(counters.time ?? 0) || 0;
      if (current <= 0) return card;
      counters.time = Math.max(0, current - 1);
      if (counters.time <= 0) delete counters.time;
      removed += 1;
      return { ...card, counters };
    });
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === ownerId ? { ...entry, exile: nextExile } : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Removed time counters from ${removed} exiled card(s)`],
      count: removed,
    };
  }

  if (/remove a loyalty counter from each of any number of permanents you control/.test(raw)) {
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    let affected = 0;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      if (chosenIds.size > 0 && !chosenIds.has(id)) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.loyalty ?? 0) || 0;
      if (current <= 0) return perm;
      counters.loyalty = Math.max(0, current - 1);
      if (counters.loyalty <= 0) delete counters.loyalty;
      affected += 1;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Removed loyalty counters from ${affected} permanent(s)`],
      count: affected,
    };
  }

  if (/remove a lore counter from each of any number of sagas you control/.test(raw)) {
    const ids = new Set(
      battlefield
        .filter(
          (perm) =>
            String((perm as any)?.controller || '').trim() === controllerId &&
            typeLineHasSubtype(perm, 'saga')
        )
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    );
    return removeCounterFromPermanents(state, ids, 'lore', 1);
  }

  if (/remove three quest counters from among permanents you control/.test(raw)) {
    let remaining = 3;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (remaining <= 0) return perm;
      if (String(perm?.controller || '').trim() !== controllerId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.quest ?? 0) || 0;
      if (current <= 0) return perm;
      const delta = Math.min(current, remaining);
      remaining -= delta;
      const next = current - delta;
      if (next > 0) counters.quest = next;
      else delete counters.quest;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed quest counters from controlled permanents'],
    };
  }

  if (/remove up to three stun counters from among all permanents/.test(raw)) {
    let remaining = 3;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (remaining <= 0) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const current = Number(counters.stun ?? 0) || 0;
      if (current <= 0) return perm;
      const delta = Math.min(current, remaining);
      remaining -= delta;
      const next = current - delta;
      if (next > 0) counters.stun = next;
      else delete counters.stun;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Removed stun counters from permanents'],
    };
  }

  if (/remove a \+1\/\+1 counter from each of two creatures you control/.test(raw)) {
    const controlled = battlefield.filter(
      (perm) =>
        permanentMatchesType(perm, 'creature') &&
        String((perm as any)?.controller || '').trim() === controllerId
    );
    const ids = new Set(controlled.slice(0, 2).map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    return removeCounterFromPermanents(state, ids, '+1/+1', 1);
  }

  if (/remove a \+1\/\+1 counter from this creature for each card in target opponent's hand/.test(raw)) {
    const handSize = Number(ctx.referenceAmount ?? 2);
    const sourceId = String(ctx.sourceId || '').trim();
    return removeCounterFromPermanents(state, new Set([sourceId].filter(Boolean)), '+1/+1', Math.max(0, handSize));
  }

  if (/remove a counter from another target permanent or opponent/.test(raw)) {
    const boundIds = collectBoundIds(ctx).filter((id) => id !== String(ctx.sourceId || '').trim());
    const targetId = boundIds[0] || 'bf-opponent-creature';
    return removeCounterFromPermanents(state, new Set([targetId]), counterName, 1);
  }

  if (/remove a counter from her/.test(raw)) {
    const host = resolveContextualCreature(battlefield, ctx);
    if (!host) return null;
    const hostId = String((host as any)?.id || '').trim();
    const perm: any = battlefield.find((entry) => String((entry as any)?.id || '').trim() === hostId);
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const counterKey = Object.keys(counters).find((key) => Number(counters[key]) > 0);
    if (!counterKey) return { applied: true, state, log: ['No counters to remove from her'] };
    return removeCounterFromPermanents(state, new Set([hostId]), counterKey, 1);
  }

  if (
    /remove a -1\/-1 counter from target creature you control/.test(raw) ||
    /remove a -1\/-1 counter from another target creature you control/.test(raw) ||
    /remove a \+1\/\+1 counter from target creature an opponent controls/.test(raw) ||
    /remove any number of counters from target creature you control/.test(raw)
  ) {
    const host = resolveContextualCreature(battlefield, ctx);
    if (!host) return null;
    const amount = /any number/.test(raw) ? 'all' : 1;
    return removeCounterFromPermanents(
      state,
      new Set([String((host as any)?.id || '').trim()]),
      counterName,
      amount
    );
  }

  if (/remove (?:an?|two|three|\d+) \w[\w /+-]* counter(?:s)? from this aura/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const amountMatch = raw.match(/remove (two|three|\d+|an?) /i);
    const amountWord = String(amountMatch?.[1] || 'a').toLowerCase();
    const amount =
      amountWord === 'two' ? 2 : amountWord === 'three' ? 3 : amountWord === 'an' || amountWord === 'a' ? 1 : Number(amountWord);
    return removeCounterFromPermanents(
      state,
      new Set([sourceId].filter(Boolean)),
      counterName,
      Number.isFinite(amount) && amount > 0 ? amount : 1
    );
  }

  if (/remove a sleep counter from that creature/.test(raw)) {
    const targetId = String(
      ctx.targetCreatureId || ctx.enchantedPermanentId || ctx.lastReferencedPermanentId || 'bf-creature-1'
    ).trim();
    return removeCounterFromPermanents(state, new Set([targetId]), 'sleep', 1);
  }

  if (/remove two time counters from target permanent or suspended card/.test(raw)) {
    const targetId = String(ctx.targetPermanentId || 'bf-creature-1').trim();
    return removeCounterFromPermanents(state, new Set([targetId]), 'time', 2);
  }

  return null;
}

