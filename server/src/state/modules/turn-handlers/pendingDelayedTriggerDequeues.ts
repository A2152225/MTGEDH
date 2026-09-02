// server/src/state/modules/turn-handlers/pendingDelayedTriggerDequeues.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the delayed-trigger dequeue helpers that drain state.pending*
// schedules when a step begins and turn them into trigger descriptors -
// next-end-step zone changes, upkeep graveyard returns, upkeep draws, and
// end-of-combat zone changes.
// Public entry symbols: dequeuePendingNextEndStepZoneChangeTriggers,
//   dequeuePendingUpkeepGraveyardReturnTriggers, dequeuePendingUpkeepDrawTriggers,
//   dequeuePendingEndOfCombatZoneChangeTriggers.
// Called from nextStep() in the parent; not part of the public turn.ts API.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { debugWarn } from "../../../utils/debug.js";

export function dequeuePendingNextEndStepZoneChangeTriggers(ctx: GameContext): any[] {
  try {
    const stateAny = (ctx as any).state as any;
    if (!stateAny) return [];

    const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
    const battlefield = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];

    const pendingSac: any[] = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
      ? stateAny.pendingSacrificeAtNextEndStep
      : [];
    const pendingExile: any[] = Array.isArray(stateAny.pendingExileAtNextEndStep)
      ? stateAny.pendingExileAtNextEndStep
      : [];
    const pendingReturnHand: any[] = Array.isArray(stateAny.pendingReturnToHandAtNextEndStep)
      ? stateAny.pendingReturnToHandAtNextEndStep
      : [];
    const pendingDelayedReturns: any[] = Array.isArray(stateAny.pendingDelayedGraveyardReturns)
      ? stateAny.pendingDelayedGraveyardReturns
      : [];

    if (pendingSac.length === 0 && pendingExile.length === 0 && pendingReturnHand.length === 0 && pendingDelayedReturns.length === 0) return [];

    const remainingSac: any[] = [];
    const remainingExile: any[] = [];
    const remainingReturnHand: any[] = [];
    const remainingDelayedReturns: any[] = [];

    type Group = {
      controllerId: string;
      sourceName: string;
      action: 'sacrifice' | 'exile' | 'return_hand';
      permanentIds: string[];
    };

    const groups = new Map<string, Group>();
    const addToGroup = (entry: any, action: Group['action']) => {
      const permanentId = String(entry?.permanentId || '').trim();
      if (!permanentId) return;

      const perm = battlefield.find((p: any) => p?.id === permanentId);
      if (!perm) {
        // If the permanent is already gone, drop the entry.
        return;
      }

      const controllerId = String(entry?.createdBy || perm?.controller || perm?.owner || '').trim();
      if (!controllerId) return;

      const sourceName = String(entry?.sourceName || 'Delayed trigger').trim();
      const key = `${action}|${currentTurn}|${controllerId}|${sourceName}`;

      const existing = groups.get(key);
      if (existing) {
        existing.permanentIds.push(permanentId);
        return;
      }

      groups.set(key, {
        controllerId,
        sourceName,
        action,
        permanentIds: [permanentId],
      });
    };

    for (const entry of pendingSac) {
      const fireAt = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      if (fireAt === currentTurn) {
        addToGroup(entry, 'sacrifice');
      } else {
        remainingSac.push(entry);
      }
    }

    for (const entry of pendingExile) {
      const fireAt = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      if (fireAt === currentTurn) {
        addToGroup(entry, 'exile');
      } else {
        remainingExile.push(entry);
      }
    }

    for (const entry of pendingReturnHand) {
      const fireAt = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      if (fireAt === currentTurn) {
        addToGroup(entry, 'return_hand');
      } else {
        remainingReturnHand.push(entry);
      }
    }

    const delayedReturnTriggers: any[] = [];
    for (const entry of pendingDelayedReturns) {
      const fireAt = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      const fireAtStep = String(entry?.fireAtStep || '').toLowerCase() === 'upkeep' ? 'upkeep' : 'end_step';
      if (fireAtStep !== 'end_step' || fireAt > currentTurn) {
        remainingDelayedReturns.push(entry);
        continue;
      }

      delayedReturnTriggers.push({
        controllerId: String(entry?.createdBy || entry?.zoneOwnerId || '').trim(),
        permanentId: String(entry?.cardId || '').trim(),
        cardName: String(entry?.sourceName || 'Delayed trigger').trim(),
        description: String(entry?.destination || '').toLowerCase() === 'battlefield'
          ? 'Return that card from your graveyard to the battlefield.'
          : 'Return that card from your graveyard to your hand.',
        effect: String(entry?.destination || '').toLowerCase() === 'battlefield'
          ? 'Return that card from your graveyard to the battlefield.'
          : 'Return that card from your graveyard to your hand.',
        mandatory: true,
        stackItem: {
          delayedAction: 'graveyard_return',
          delayedGraveyardReturnEntries: [{
            scheduleId: String(entry?.scheduleId || '').trim() || undefined,
            cardId: String(entry?.cardId || '').trim(),
            zoneOwnerId: String(entry?.zoneOwnerId || '').trim(),
            destination: String(entry?.destination || '').toLowerCase() === 'battlefield' ? 'battlefield' : 'hand',
            destinationUsesSelectedCardOwner: entry?.destinationUsesSelectedCardOwner === true,
            battlefieldControllerMode: String(entry?.battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
            battlefieldControllerId: String(entry?.battlefieldControllerId || '').trim() || undefined,
            battlefieldTapped: entry?.battlefieldTapped === true,
            battlefieldCounters: entry?.battlefieldCounters && typeof entry.battlefieldCounters === 'object'
              ? { ...(entry.battlefieldCounters as Record<string, number>) }
              : undefined,
            battlefieldFaceDown: entry?.battlefieldFaceDown === true ? true : undefined,
            battlefieldSuspected: entry?.battlefieldSuspected === true ? true : undefined,
          }],
          delayedSourceName: String(entry?.sourceName || 'Delayed trigger').trim(),
        },
      });
    }

    stateAny.pendingSacrificeAtNextEndStep = remainingSac;
    stateAny.pendingExileAtNextEndStep = remainingExile;
    stateAny.pendingReturnToHandAtNextEndStep = remainingReturnHand;
    stateAny.pendingDelayedGraveyardReturns = remainingDelayedReturns;

    const triggers: any[] = [];
    for (const group of groups.values()) {
      const effectText =
        group.action === 'sacrifice'
          ? 'Sacrifice them.'
          : group.action === 'return_hand'
            ? 'Return them to their owner\'s hand.'
            : 'Exile them.';

      triggers.push({
        controllerId: group.controllerId,
        permanentId: group.permanentIds[0],
        cardName: group.sourceName,
        description: effectText,
        effect: effectText,
        mandatory: true,
        stackItem: {
          delayedAction: group.action,
          delayedPermanentIds: group.permanentIds,
          delayedSourceName: group.sourceName,
        },
      });
    }

    triggers.push(...delayedReturnTriggers);

    return triggers;
  } catch (err) {
    debugWarn(1, '[turn] Failed to dequeue pending next-end-step zone-change triggers:', err);
    return [];
  }
}

export function dequeuePendingUpkeepGraveyardReturnTriggers(ctx: GameContext, turnPlayer: PlayerID): any[] {
  try {
    const stateAny = (ctx as any).state as any;
    if (!stateAny) return [];

    const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
    const pendingDelayedReturns: any[] = Array.isArray(stateAny.pendingDelayedGraveyardReturns)
      ? stateAny.pendingDelayedGraveyardReturns
      : [];
    if (pendingDelayedReturns.length === 0) return [];

    const remainingDelayedReturns: any[] = [];
    const triggers: any[] = [];

    for (const entry of pendingDelayedReturns) {
      const fireAtStep = String(entry?.fireAtStep || '').toLowerCase() === 'upkeep' ? 'upkeep' : 'end_step';
      const fireAtTurn = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      const fireAtPlayerId = String(entry?.fireAtPlayerId || '').trim();
      if (fireAtStep !== 'upkeep' || fireAtPlayerId !== String(turnPlayer) || fireAtTurn > currentTurn) {
        remainingDelayedReturns.push(entry);
        continue;
      }

      triggers.push({
        controllerId: String(entry?.createdBy || entry?.zoneOwnerId || turnPlayer).trim(),
        permanentId: String(entry?.cardId || '').trim(),
        cardName: String(entry?.sourceName || 'Delayed trigger').trim(),
        description: String(entry?.destination || '').toLowerCase() === 'battlefield'
          ? 'Return that card from your graveyard to the battlefield.'
          : 'Return that card from your graveyard to your hand.',
        effect: String(entry?.destination || '').toLowerCase() === 'battlefield'
          ? 'Return that card from your graveyard to the battlefield.'
          : 'Return that card from your graveyard to your hand.',
        mandatory: true,
        stackItem: {
          delayedAction: 'graveyard_return',
          delayedGraveyardReturnEntries: [{
            scheduleId: String(entry?.scheduleId || '').trim() || undefined,
            cardId: String(entry?.cardId || '').trim(),
            zoneOwnerId: String(entry?.zoneOwnerId || '').trim(),
            destination: String(entry?.destination || '').toLowerCase() === 'battlefield' ? 'battlefield' : 'hand',
            destinationUsesSelectedCardOwner: entry?.destinationUsesSelectedCardOwner === true,
            battlefieldControllerMode: String(entry?.battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
            battlefieldControllerId: String(entry?.battlefieldControllerId || '').trim() || undefined,
            battlefieldTapped: entry?.battlefieldTapped === true,
            battlefieldCounters: entry?.battlefieldCounters && typeof entry.battlefieldCounters === 'object'
              ? { ...(entry.battlefieldCounters as Record<string, number>) }
              : undefined,
            battlefieldFaceDown: entry?.battlefieldFaceDown === true ? true : undefined,
            battlefieldSuspected: entry?.battlefieldSuspected === true ? true : undefined,
          }],
          delayedSourceName: String(entry?.sourceName || 'Delayed trigger').trim(),
        },
      });
    }

    stateAny.pendingDelayedGraveyardReturns = remainingDelayedReturns;
    return triggers;
  } catch (err) {
    debugWarn(1, '[turn] Failed to dequeue pending upkeep graveyard-return triggers:', err);
    return [];
  }
}

export function dequeuePendingUpkeepDrawTriggers(ctx: GameContext): any[] {
  try {
    const stateAny = (ctx as any).state as any;
    if (!stateAny) return [];

    const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
    const pendingDraws: any[] = Array.isArray(stateAny.pendingDelayedDrawsAtNextUpkeep)
      ? stateAny.pendingDelayedDrawsAtNextUpkeep
      : [];
    if (pendingDraws.length === 0) return [];

    const remainingDraws: any[] = [];
    const triggers: any[] = [];

    for (const entry of pendingDraws) {
      const fireAtStep = String(entry?.fireAtStep || 'upkeep').toLowerCase();
      const fireAtTurn = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      if (fireAtStep !== 'upkeep' || fireAtTurn > currentTurn) {
        remainingDraws.push(entry);
        continue;
      }

      const count = Math.max(1, Math.floor(Number(entry?.count || 1)));
      const upTo = entry?.upTo === true;
      const effectText = upTo
        ? (count === 1 ? 'You may draw up to one card.' : `You may draw up to ${count} cards.`)
        : (count === 1 ? 'Draw a card.' : `Draw ${count} cards.`);
      const playerId = String(entry?.playerId || entry?.createdBy || '').trim();
      if (!playerId) continue;

      triggers.push({
        controllerId: playerId,
        permanentId: String(entry?.sourceId || entry?.scheduleId || '').trim(),
        cardName: String(entry?.sourceName || 'Delayed trigger').trim(),
        description: effectText,
        effect: effectText,
        mandatory: true,
        stackItem: {
          delayedAction: 'draw',
          delayedDrawCount: count,
          ...(upTo ? { delayedDrawUpTo: true } : null),
          delayedSourceName: String(entry?.sourceName || 'Delayed trigger').trim(),
          delayedScheduleId: String(entry?.scheduleId || '').trim() || undefined,
        },
      });
    }

    stateAny.pendingDelayedDrawsAtNextUpkeep = remainingDraws;
    return triggers;
  } catch (err) {
    debugWarn(1, '[turn] Failed to dequeue pending upkeep draw triggers:', err);
    return [];
  }
}

export function dequeuePendingEndOfCombatZoneChangeTriggers(ctx: GameContext): any[] {
  try {
    const stateAny = (ctx as any).state as any;
    if (!stateAny) return [];

    const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
    const battlefield = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];

    const pendingSac: any[] = Array.isArray(stateAny.pendingSacrificeAtEndOfCombat)
      ? stateAny.pendingSacrificeAtEndOfCombat
      : [];
    const pendingExile: any[] = Array.isArray(stateAny.pendingExileAtEndOfCombat)
      ? stateAny.pendingExileAtEndOfCombat
      : [];

    if (pendingSac.length === 0 && pendingExile.length === 0) return [];

    const remainingSac: any[] = [];
    const remainingExile: any[] = [];

    type Group = {
      controllerId: string;
      sourceName: string;
      action: 'sacrifice' | 'exile';
      permanentIds: string[];
    };

    const groups = new Map<string, Group>();
    const addToGroup = (entry: any, action: Group['action']) => {
      const permanentId = String(entry?.permanentId || '').trim();
      if (!permanentId) return;

      const perm = battlefield.find((p: any) => p?.id === permanentId);
      if (!perm) {
        return;
      }

      const controllerId = String(entry?.createdBy || perm?.controller || perm?.owner || '').trim();
      if (!controllerId) return;

      const sourceName = String(entry?.sourceName || 'Delayed trigger').trim();
      const key = `${action}|${currentTurn}|${controllerId}|${sourceName}`;

      const existing = groups.get(key);
      if (existing) {
        existing.permanentIds.push(permanentId);
        return;
      }

      groups.set(key, {
        controllerId,
        sourceName,
        action,
        permanentIds: [permanentId],
      });
    };

    for (const entry of pendingSac) {
      const fireAt = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      if (fireAt === currentTurn) {
        addToGroup(entry, 'sacrifice');
      } else {
        remainingSac.push(entry);
      }
    }

    for (const entry of pendingExile) {
      const fireAt = Number(entry?.fireAtTurnNumber ?? 0) || 0;
      if (fireAt === currentTurn) {
        addToGroup(entry, 'exile');
      } else {
        remainingExile.push(entry);
      }
    }

    stateAny.pendingSacrificeAtEndOfCombat = remainingSac;
    stateAny.pendingExileAtEndOfCombat = remainingExile;

    const triggers: any[] = [];
    for (const group of groups.values()) {
      const effectText = group.action === 'sacrifice' ? 'Sacrifice them.' : 'Exile them.';

      triggers.push({
        controllerId: group.controllerId,
        permanentId: group.permanentIds[0],
        cardName: group.sourceName,
        description: effectText,
        effect: effectText,
        mandatory: true,
        stackItem: {
          delayedAction: group.action,
          delayedPermanentIds: group.permanentIds,
          delayedSourceName: group.sourceName,
        },
      });
    }

    return triggers;
  } catch (err) {
    debugWarn(1, '[turn] Failed to dequeue pending end-of-combat zone-change triggers:', err);
    return [];
  }
}
