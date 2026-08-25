// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: buildDelayedCleanupReference, renderBattlefieldObjectCondition,
// evaluateBattlefieldObjectCondition, registerDelayedBattlefieldAction.
// Public entries: evaluateBattlefieldObjectCondition, registerDelayedBattlefieldAction.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleBattlefieldObjectCondition } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';

export function buildDelayedCleanupReference(permanents: readonly BattlefieldPermanent[]): string {
  if (permanents.length <= 0) return 'that permanent';
  if (permanents.length === 1) {
    const perm = permanents[0];
    if ((perm as any)?.isToken) return 'that token';
    if (permanentMatchesType(perm, 'creature')) return 'that creature';
    return 'that permanent';
  }

  if (permanents.every(perm => Boolean((perm as any)?.isToken))) {
    return 'those tokens';
  }

  if (permanents.every(perm => permanentMatchesType(perm, 'creature'))) {
    return 'those creatures';
  }

  return 'them';
}

function renderBattlefieldObjectCondition(condition?: OracleBattlefieldObjectCondition): string {
  if (!condition) return '';
  if (condition.kind === 'mana_value_compare') {
    return ` if it has mana value ${condition.value} or ${condition.comparator === 'lte' ? 'less' : 'greater'}`;
  }
  if (condition.comparator === 'eq' && condition.value === 0) {
    return ` if there are no ${condition.counter} counters on it`;
  }
  return ` if it has ${condition.value} or ${condition.comparator === 'lte' ? 'less' : 'more'} ${condition.counter} counters on it`;
}

export function evaluateBattlefieldObjectCondition(
  permanent: BattlefieldPermanent,
  condition?: OracleBattlefieldObjectCondition
): boolean | null {
  if (!condition) return true;

  if (condition.kind === 'mana_value_compare') {
    const manaValue = getCardManaValue((permanent as any)?.card || permanent);
    if (manaValue === null) return null;
    return condition.comparator === 'lte' ? manaValue <= condition.value : manaValue >= condition.value;
  }

  const counters = (permanent as any)?.counters;
  const count = Number(counters?.[condition.counter] ?? 0);
  const normalizedCount = Number.isFinite(count) ? count : 0;
  if (condition.comparator === 'lte') return normalizedCount <= condition.value;
  if (condition.comparator === 'gte') return normalizedCount >= condition.value;
  return normalizedCount === condition.value;
}

export function registerDelayedBattlefieldAction(
  state: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  timing: DelayedTriggerTiming,
  action: 'sacrifice' | 'exile',
  permanents: readonly BattlefieldPermanent[],
  condition?: OracleBattlefieldObjectCondition,
  whoText?: string,
  watchingPermanentId?: string
): { state: GameState; log: string[] } {
  const chosenObjectIds = Array.from(
    new Set(permanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean))
  );
  if (chosenObjectIds.length === 0) return { state, log: [] };

  const reference = buildDelayedCleanupReference(permanents);
  const trimmedWhoText = String(whoText || '').trim();
  const effect = (() => {
    if (action === 'exile') return `Exile ${reference}.`;
    if (!trimmedWhoText) return `Sacrifice ${reference}${renderBattlefieldObjectCondition(condition)}.`;

    const subject = trimmedWhoText;
    const lowerSubject = subject.toLowerCase();
    const verb =
      lowerSubject === 'you' || lowerSubject === 'they'
        ? 'sacrifice'
        : 'sacrifices';
    return `${subject} ${verb} ${reference}${renderBattlefieldObjectCondition(condition)}.`;
  })();

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const delayedTrigger = createDelayedTrigger(
    String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
    String(ctx.sourceName || 'Delayed cleanup'),
    controllerId,
    timing,
    effect,
    currentTurn,
    {
      ...(watchingPermanentId ? { watchingPermanentId } : {}),
      targets: [...chosenObjectIds],
      eventDataSnapshot: {
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId: chosenObjectIds.length === 1 ? chosenObjectIds[0] : undefined,
        chosenObjectIds,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [`Scheduled delayed ${action} for ${chosenObjectIds.length} permanent(s) at ${timing.replace(/_/g, ' ')}`],
  };
}

