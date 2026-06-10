import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../rules-engine/src/oracleIR.js';
import {
  applyOracleIRStepsToGameState,
  type OracleIRExecutionContext,
  type OracleIRExecutionOptions,
  type OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveOracleQuantity } from '../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import type { GameContext } from '../context.js';
import { applyMillReplacements } from './game-state-effects.js';
import { processMillTriggers } from './zones.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';

/**
 * The live server stores libraries in ctx.libraries and zone summaries in state.zones,
 * while rules-engine Oracle IR reads/writes player.library on state.players.
 * Hydrate before IR execution and sync back afterward.
 */
export function hydrateOracleIRPlayerZonesFromContext(ctx: GameContext, state: any): void {
  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  if (!libraries || typeof libraries.get !== 'function') return;

  // Rules-engine zone ops can read/write through this map when player.library is empty.
  (state as any).__serverLibraries = libraries;

  const zones = state.zones || {};
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const library = libraries.get(playerId as PlayerID);
    if (Array.isArray(library)) {
      player.library = library.map((card: any) => ({ ...card, zone: card?.zone || 'library' }));
    }

    const playerZones = zones[playerId] || {};
    if (Array.isArray(playerZones.graveyard)) {
      player.graveyard = playerZones.graveyard.map((card: any) => ({ ...card, zone: card?.zone || 'graveyard' }));
    }
    if (Array.isArray(playerZones.hand)) {
      player.hand = playerZones.hand.map((card: any) => ({ ...card, zone: card?.zone || 'hand' }));
    }
    if (Array.isArray(playerZones.exile)) {
      player.exile = playerZones.exile.map((card: any) => ({ ...card, zone: card?.zone || 'exile' }));
    }
  }
}

export function snapshotGraveyardCardIds(state: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    out.set(playerId, new Set(graveyard.map((card: any) => String(card?.id || '')).filter(Boolean)));
  }
  return out;
}

export function syncOracleIRPlayerZonesToContext(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  graveyardBefore: Map<string, Set<string>>,
): void {
  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  if (!libraries || typeof libraries.set !== 'function') return;

  const zones = state.zones = state.zones || {};
  let changed = false;

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const playerZones = zones[playerId] = zones[playerId] || {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      libraryCount: 0,
    };

    if (Array.isArray(player.library)) {
      libraries.set(playerId as PlayerID, [...player.library]);
      playerZones.libraryCount = player.library.length;
      changed = true;
    }

    if (Array.isArray(player.graveyard)) {
      const previousIds = graveyardBefore.get(playerId) || new Set<string>();
      const newlyMilled = player.graveyard.filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && !previousIds.has(cardId);
      });

      playerZones.graveyard = [...player.graveyard];
      playerZones.graveyardCount = player.graveyard.length;
      changed = true;

      for (const card of newlyMilled) {
        recordCardPutIntoGraveyardThisTurn(ctx, playerId, card, { fromBattlefield: false });
      }
      if (newlyMilled.length > 0) {
        try {
          processMillTriggers(ctx, playerId, newlyMilled, controller);
        } catch {
          // best-effort
        }
      }
    }

    if (Array.isArray(player.hand)) {
      playerZones.hand = [...player.hand];
      playerZones.handCount = player.hand.length;
      changed = true;
    }

    if (Array.isArray(player.exile)) {
      playerZones.exile = [...player.exile];
      playerZones.exileCount = player.exile.length;
      changed = true;
    }
  }

  delete (state as any).__serverLibraries;

  if (changed && typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }
}

function resolveMillTargetPlayerId(
  who: any,
  controller: PlayerID,
  targetPlayerId: PlayerID | undefined,
  state: any,
): PlayerID | undefined {
  if (who?.kind === 'target_player' || who?.kind === 'target_opponent') {
    return targetPlayerId;
  }
  if (who?.kind === 'you') {
    return controller;
  }
  if (who?.kind === 'each_opponent') {
    const opponents = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((id: string) => id && id !== String(controller));
    return opponents.length === 1 ? (opponents[0] as PlayerID) : undefined;
  }
  return targetPlayerId;
}

export function applyMillReplacementEffectsToSteps(
  ctx: GameContext,
  steps: OracleEffectStep[],
  controller: PlayerID,
  targetPlayerId: PlayerID | undefined,
  state: any,
  irCtx: OracleIRExecutionContext,
): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind !== 'mill') return step;

    const millTarget = resolveMillTargetPlayerId((step as any).who, controller, targetPlayerId, state);
    if (!millTarget) return step;

    const baseCount = resolveOracleQuantity(
      state,
      controller,
      (step as any).amount as OracleQuantity,
      irCtx,
      { whereX: (step as any).whereX },
    );
    if (baseCount === null || baseCount <= 0) return step;

    const { finalCount } = applyMillReplacements(ctx, baseCount, String(controller), String(millTarget));
    if (finalCount === baseCount) return step;

    return {
      ...step,
      amount: { kind: 'number', value: finalCount, raw: String(finalCount) },
    } as OracleEffectStep;
  });
}

export function applyOracleIRStepsOnServer(
  ctx: GameContext,
  state: any,
  steps: readonly OracleEffectStep[],
  irCtx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions,
  params?: {
    controller?: PlayerID;
    targetPlayerId?: PlayerID;
    applyMillReplacements?: boolean;
  },
): OracleIRExecutionResult {
  hydrateOracleIRPlayerZonesFromContext(ctx, state);
  const graveyardBefore = snapshotGraveyardCardIds(state);

  const controller = (params?.controller || irCtx.controllerId) as PlayerID;
  const adjustedSteps = params?.applyMillReplacements === false
    ? [...steps]
    : applyMillReplacementEffectsToSteps(
        ctx,
        [...steps],
        controller,
        params?.targetPlayerId,
        state,
        irCtx,
      );

  const result = applyOracleIRStepsToGameState(state, adjustedSteps, irCtx, options);
  Object.assign(state, result.state);
  syncOracleIRPlayerZonesToContext(ctx, state, controller, graveyardBefore);
  return result;
}
