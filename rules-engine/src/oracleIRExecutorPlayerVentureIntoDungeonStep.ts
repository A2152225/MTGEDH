// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyVentureIntoDungeonStep (+ exclusive chosen-dungeon helpers).
// Public entries: applyVentureIntoDungeonStep.

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  getDungeonDefinition,
  getDungeonRoomDefinition,
  getDungeonRoomDefinitionByProgress,
} from './oracleIRExecutorPlayerDungeonDefinitions';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';

function getNormalizedChosenDungeonId(ctx: OracleIRExecutionContext): string | undefined {
  const chosenDungeonId = String(ctx.selectorContext?.chosenDungeonId || '').trim().toLowerCase();
  return chosenDungeonId || undefined;
}

function getNormalizedChosenDungeonRoomId(ctx: OracleIRExecutionContext): string | undefined {
  const chosenDungeonRoomId = String(ctx.selectorContext?.chosenDungeonRoomId || '').trim().toLowerCase();
  return chosenDungeonRoomId || undefined;
}

export function applyVentureIntoDungeonStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'venture_into_dungeon' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const stateAny = state as any;
  const currentProgress = { ...((stateAny.dungeonProgress || {}) as Record<string, any>) };
  const completedThisTurn = { ...((stateAny.dungeonCompletedThisTurn || {}) as Record<string, boolean>) };
  const completedAny = { ...((stateAny.dungeonCompleted || {}) as Record<string, boolean>) };
  const completedCounts = { ...((stateAny.completedDungeons || {}) as Record<string, number>) };
  completedThisTurn[playerId] = false;

  const existing = currentProgress[playerId];
  // Server / interactive path must choose a dungeon (and apply room effects) via
  // resolveVentureProgress. Auto-entering Lost Mine is only for non-interactive RE tests.
  if (ctx.interactivePlayerChoices === true) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (requires server dungeon progress): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }
  if (!existing) {
    const chosenDungeonId = getNormalizedChosenDungeonId(ctx);
    const dungeon = getDungeonDefinition(chosenDungeonId || 'lost_mine') || getDungeonDefinition('lost_mine');
    if (!dungeon || dungeon.rooms.length === 0) {
      return {
        applied: false,
        message: `Skipped venture into the dungeon (no dungeon definition found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const roomIndex = 0;
    const room = dungeon.rooms[0];
    currentProgress[playerId] = {
      dungeonId: dungeon.id,
      dungeonName: dungeon.name,
      roomIndex,
      roomId: room.id,
    };
    return {
      applied: true,
      state: {
        ...stateAny,
        dungeonProgress: currentProgress,
        dungeonCompletedThisTurn: completedThisTurn,
      } as GameState,
      log: [`${playerId} enters ${dungeon.name} (${room.name})`],
      lastDungeonName: dungeon.name,
      lastDungeonRoomName: room.name,
      lastDungeonRoomEffectText: room.effectText,
    };
  }

  const existingDungeon = getDungeonDefinition(String(existing.dungeonId || ''));
  const currentRoom = getDungeonRoomDefinitionByProgress(String(existing.dungeonId || ''), existing);
  if (!existingDungeon || !currentRoom) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (existing dungeon progress is invalid): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const chosenDungeonRoomId = getNormalizedChosenDungeonRoomId(ctx);
  const nextRoomId = (
    chosenDungeonRoomId && currentRoom.nextRoomIds.includes(chosenDungeonRoomId)
      ? chosenDungeonRoomId
      : currentRoom.nextRoomIds[0]
  );
  const nextRoom = getDungeonRoomDefinition(existingDungeon.id, nextRoomId);
  if (!nextRoom) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (next room could not be resolved): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const nextRoomIndex = Math.max(0, Number(existing.roomIndex) || 0) + 1;

  if (nextRoom.nextRoomIds.length === 0) {
    delete currentProgress[playerId];
    completedThisTurn[playerId] = true;
    completedAny[playerId] = true;
    completedCounts[playerId] = Math.max(0, Number(completedCounts[playerId]) || 0) + 1;

    return {
      applied: true,
      state: {
        ...stateAny,
        dungeonProgress: currentProgress,
        dungeonCompletedThisTurn: completedThisTurn,
        dungeonCompleted: completedAny,
        completedDungeons: completedCounts,
      } as GameState,
      log: [`${playerId} completed ${String(existing.dungeonName || 'a dungeon')} (${nextRoom.name})`],
      lastDungeonName: String(existing.dungeonName || 'a dungeon'),
      lastDungeonRoomName: nextRoom.name,
      lastDungeonRoomEffectText: nextRoom.effectText,
    };
  }

  currentProgress[playerId] = {
    ...existing,
    roomIndex: nextRoomIndex,
    roomId: nextRoom.id,
  };
  return {
    applied: true,
    state: {
      ...stateAny,
      dungeonProgress: currentProgress,
      dungeonCompletedThisTurn: completedThisTurn,
    } as GameState,
    log: [`${playerId} ventures further into ${String(existing.dungeonName || 'a dungeon')} (${nextRoom.name})`],
    lastDungeonName: String(existing.dungeonName || 'a dungeon'),
    lastDungeonRoomName: nextRoom.name,
    lastDungeonRoomEffectText: nextRoom.effectText,
  };
}
