import type { GameState, PlayerID } from '../../shared/src';
import {
  checkDelayedTriggers,
  createDelayedTriggerRegistry,
  DelayedTriggerTiming,
  processDelayedTriggers,
} from './delayedTriggeredAbilities';
import { createEmptyStack, pushToStack, type Stack } from './stackOperations';
import { putTriggersOnStack } from './triggeredAbilities';

export function getActivePlayerIdFromState(state: GameState): string {
  const activeIndex = Number.isInteger((state as any).activePlayerIndex)
    ? Number((state as any).activePlayerIndex)
    : -1;
  const players = Array.isArray(state.players) ? state.players : [];
  const indexedActivePlayer = activeIndex >= 0 ? players[activeIndex] : undefined;
  return String(indexedActivePlayer?.id || (state as any).turnPlayer || '').trim();
}

export function getTurnOrderFromState(state: GameState): string[] {
  return Array.isArray((state as any).turnOrder)
    ? (state as any).turnOrder
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean)
    : [];
}

export function getPermanentControllerId(permanent: any): string {
  return String(permanent?.controller || permanent?.controllerId || '').trim();
}

export function processControlLossDelayedTriggersForState(args: {
  gameId: string;
  previousState: GameState;
  nextState: GameState;
  getStack: (gameId: string) => Stack | undefined;
  setStack: (gameId: string, stack: Stack) => void;
}): { state: GameState; log: string[] } {
  const { gameId, previousState, nextState, getStack, setStack } = args;
  const previousRegistry = ((previousState as any).delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<typeof createDelayedTriggerRegistry>;
  const nextRegistry = ((nextState as any).delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<typeof createDelayedTriggerRegistry>;
  const watchedTriggers = previousRegistry.triggers.filter(
    trigger => trigger.timing === DelayedTriggerTiming.WHEN_CONTROL_LOST && String(trigger.watchingPermanentId || '').trim().length > 0
  );

  if (watchedTriggers.length === 0) {
    return { state: nextState, log: [] };
  }

  const watchedPermanentIds = new Set(
    watchedTriggers
      .map(trigger => String(trigger.watchingPermanentId || '').trim())
      .filter(Boolean)
  );
  if (watchedPermanentIds.size === 0) {
    return { state: nextState, log: [] };
  }

  const previousBattlefield = Array.isArray((previousState as any).battlefield)
    ? ((previousState as any).battlefield as any[])
    : [];
  const nextBattlefield = Array.isArray((nextState as any).battlefield)
    ? ((nextState as any).battlefield as any[])
    : [];
  const nextBattlefieldById = new Map<string, any>(
    nextBattlefield.map(perm => [String(perm?.id || '').trim(), perm])
  );

  const eligibleTriggerIds = new Set(previousRegistry.triggers.map(trigger => trigger.id));
  let workingRegistry = nextRegistry;
  const firedTriggers = [];

  for (const previousPermanent of previousBattlefield) {
    const permanentId = String(previousPermanent?.id || '').trim();
    if (!permanentId || !watchedPermanentIds.has(permanentId)) {
      continue;
    }

    const previousControllerId = getPermanentControllerId(previousPermanent);
    if (!previousControllerId) {
      continue;
    }

    const nextPermanent = nextBattlefieldById.get(permanentId);
    const nextControllerId = nextPermanent ? getPermanentControllerId(nextPermanent) : '';
    if (nextPermanent && nextControllerId === previousControllerId) {
      continue;
    }

    const delayedCheck = checkDelayedTriggers(workingRegistry, {
      type: 'control_lost',
      permanentId,
      playerId: previousControllerId as PlayerID,
      eligibleTriggerIds,
    });
    if (delayedCheck.triggersToFire.length === 0) {
      continue;
    }

    firedTriggers.push(...delayedCheck.triggersToFire);
    workingRegistry = {
      ...workingRegistry,
      triggers: delayedCheck.remainingTriggers,
      firedTriggerIds: [
        ...workingRegistry.firedTriggerIds,
        ...delayedCheck.triggersToFire.map(trigger => trigger.id),
      ],
    };
  }

  if (firedTriggers.length === 0) {
    return { state: nextState, log: [] };
  }

  const delayedInstances = processDelayedTriggers(firedTriggers, Date.now());
  const stackPlacement = putTriggersOnStack(
    { triggers: delayedInstances },
    getActivePlayerIdFromState(nextState),
    getTurnOrderFromState(nextState)
  );

  let stack = getStack(gameId) || createEmptyStack();
  for (const stackObject of stackPlacement.stackObjects) {
    stack = pushToStack(stack, stackObject).stack;
  }
  setStack(gameId, stack);

  return {
    state: ({
      ...nextState,
      delayedTriggerRegistry: workingRegistry,
      stack: [...((stack.objects as any[]) || [])] as any,
    } as any) as GameState,
    log: firedTriggers.map(trigger => `Delayed trigger fires: ${trigger.sourceName}`),
  };
}

function isPermanentCardInAnyGraveyard(state: GameState, permanentId: string): boolean {
  const targetId = String(permanentId || '').trim();
  if (!targetId) return false;

  for (const player of state.players || []) {
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    if (graveyard.some((card: any) => String(card?.id || '').trim() === targetId)) {
      return true;
    }
  }

  return false;
}

export function processDiesDelayedTriggersForState(args: {
  gameId: string;
  previousState: GameState;
  nextState: GameState;
  getStack: (gameId: string) => Stack | undefined;
  setStack: (gameId: string, stack: Stack) => void;
}): { state: GameState; log: string[] } {
  const { gameId, previousState, nextState, getStack, setStack } = args;
  const previousRegistry = ((previousState as any).delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<typeof createDelayedTriggerRegistry>;
  const nextRegistry = ((nextState as any).delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<typeof createDelayedTriggerRegistry>;
  const watchedTriggers = previousRegistry.triggers.filter(
    trigger => trigger.timing === DelayedTriggerTiming.WHEN_DIES && String(trigger.watchingPermanentId || '').trim().length > 0
  );

  if (watchedTriggers.length === 0) {
    return { state: nextState, log: [] };
  }

  const watchedPermanentIds = new Set(
    watchedTriggers
      .map(trigger => String(trigger.watchingPermanentId || '').trim())
      .filter(Boolean)
  );
  if (watchedPermanentIds.size === 0) {
    return { state: nextState, log: [] };
  }

  const previousBattlefield = Array.isArray((previousState as any).battlefield)
    ? ((previousState as any).battlefield as any[])
    : [];
  const nextBattlefield = Array.isArray((nextState as any).battlefield)
    ? ((nextState as any).battlefield as any[])
    : [];
  const nextBattlefieldById = new Map<string, any>(
    nextBattlefield.map(perm => [String(perm?.id || '').trim(), perm])
  );

  const eligibleTriggerIds = new Set(previousRegistry.triggers.map(trigger => trigger.id));
  let workingRegistry = nextRegistry;
  const firedTriggers = [];
  let expiredTriggerCount = 0;

  for (const previousPermanent of previousBattlefield) {
    const permanentId = String(previousPermanent?.id || '').trim();
    if (!permanentId || !watchedPermanentIds.has(permanentId)) {
      continue;
    }

    if (nextBattlefieldById.has(permanentId)) {
      continue;
    }

    if (!isPermanentCardInAnyGraveyard(nextState, permanentId)) {
      const remainingTriggers = workingRegistry.triggers.filter(trigger => {
        if (trigger.timing !== DelayedTriggerTiming.WHEN_DIES) return true;
        if (String(trigger.watchingPermanentId || '').trim() !== permanentId) return true;
        return !Boolean((trigger.effectData as any)?.expireWhenPermanentLeavesBattlefield);
      });
      expiredTriggerCount += workingRegistry.triggers.length - remainingTriggers.length;
      workingRegistry = {
        ...workingRegistry,
        triggers: remainingTriggers,
      };
      continue;
    }

    const delayedCheck = checkDelayedTriggers(workingRegistry, {
      type: 'dies',
      permanentId,
      playerId: getPermanentControllerId(previousPermanent) as PlayerID,
      eligibleTriggerIds,
    });
    if (delayedCheck.triggersToFire.length === 0) {
      continue;
    }

    firedTriggers.push(...delayedCheck.triggersToFire);
    workingRegistry = {
      ...workingRegistry,
      triggers: delayedCheck.remainingTriggers,
      firedTriggerIds: [
        ...workingRegistry.firedTriggerIds,
        ...delayedCheck.triggersToFire.map(trigger => trigger.id),
      ],
    };
  }

  if (firedTriggers.length === 0) {
    if (expiredTriggerCount === 0) {
      return { state: nextState, log: [] };
    }

    return {
      state: ({
        ...nextState,
        delayedTriggerRegistry: workingRegistry,
      } as any) as GameState,
      log: expiredTriggerCount > 0 ? [`Expired ${expiredTriggerCount} watched dies trigger(s)`] : [],
    };
  }

  const delayedInstances = processDelayedTriggers(firedTriggers, Date.now());
  const stackPlacement = putTriggersOnStack(
    { triggers: delayedInstances },
    getActivePlayerIdFromState(nextState),
    getTurnOrderFromState(nextState)
  );

  let stack = getStack(gameId) || createEmptyStack();
  for (const stackObject of stackPlacement.stackObjects) {
    stack = pushToStack(stack, stackObject).stack;
  }
  setStack(gameId, stack);

  return {
    state: ({
      ...nextState,
      delayedTriggerRegistry: workingRegistry,
      stack: [...((stack.objects as any[]) || [])] as any,
    } as any) as GameState,
    log: firedTriggers.map(trigger => `Delayed dies trigger fires: ${trigger.sourceName}`),
  };
}
