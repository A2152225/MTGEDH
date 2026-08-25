// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: processBecameMonstrousTriggers.
// Public entry symbols: processBecameMonstrousTriggers.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import { findTriggeredAbilities, processTriggersAutoOracle } from '../actions';
import {
  buildResolutionEventDataFromGameState,
  TriggerEvent,
} from '../triggeredAbilities';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterBecameMonstrousHost = any;

export function processBecameMonstrousTriggers(
    gameId: string,
    battlefieldBeforeResolution: readonly any[],
    state: GameState
  ): EngineResult<GameState> {
    const previousById = new Map(
      (Array.isArray(battlefieldBeforeResolution) ? battlefieldBeforeResolution : [])
        .map((perm: any) => [String(perm?.id || '').trim(), perm] as const)
        .filter(([id]) => Boolean(id))
    );
    const newlyMonstrous = ((state.battlefield || []) as any[]).filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      const previous = previousById.get(permanentId);
      const wasMonstrous =
        typeof previous?.isMonstrous === 'boolean'
          ? Boolean(previous.isMonstrous)
          : typeof previous?.monstrous === 'boolean'
            ? Boolean(previous.monstrous)
            : false;
      const isMonstrous =
        typeof perm?.isMonstrous === 'boolean'
          ? Boolean(perm.isMonstrous)
          : typeof perm?.monstrous === 'boolean'
            ? Boolean(perm.monstrous)
            : false;
      return !wasMonstrous && isMonstrous;
    });

    if (newlyMonstrous.length === 0) {
      return { next: state, log: [] };
    }

    let nextState = state;
    const logs: string[] = [];

    for (const permanent of newlyMonstrous) {
      const controllerId = String(permanent?.controller || '').trim();
      const permanentId = String(permanent?.id || '').trim();
      if (!controllerId || !permanentId) continue;

      const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '');
      const types = typeLine
        .split(/[\s\u2014-]+/)
        .map((part: string) => part.trim())
        .filter(Boolean);
      const abilities = findTriggeredAbilities(nextState);
      const triggerResult = processTriggersAutoOracle(
        nextState,
        TriggerEvent.BECAME_MONSTROUS,
        abilities,
        buildResolutionEventDataFromGameState(nextState, controllerId, {
          sourceId: permanentId,
          targetPermanentId: permanentId,
          sourceControllerId: controllerId,
          sourceOwnerId: String(permanent?.owner || permanent?.ownerId || controllerId).trim() || controllerId,
          permanentTypes: types,
          creatureTypes: types,
          counters: permanent?.counters,
          keywords: Array.isArray(permanent?.card?.keywords) ? permanent.card.keywords : undefined,
        })
      );

      nextState = triggerResult.state;
      logs.push(...(triggerResult.logs || []));

      if (triggerResult.triggersAdded > 0 || (triggerResult.oracleExecutions || 0) > 0) {
        logs.push(`[triggers] Processed became monstrous triggers for ${permanentId}`);
      }
    }

    return { next: nextState, log: logs };
}
