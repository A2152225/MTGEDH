import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { isRoomDoorLocked } from '../src/state/modules/triggers/room.js';

describe('roomDoorChoice replay coverage', () => {
  const oracle =
    'When you unlock this door, this Room deals 6 damage to target creature an opponent controls.';

  it('replays roomDoorChoice unlock and clears the queued prompt', () => {
    const gameId = 'room_door_choice_replay_unlock';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game as any).gameId = gameId;

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: true,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    ResolutionQueueManager.addStep(gameId, {
      id: 'room_door_choice_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Lock or unlock a door of Cramped Vents // Access Maze?',
      mandatory: true,
      roomDoorLockOrUnlock: true,
      roomPermanentId: 'room-1',
      sourceId: 'room-1',
    } as any);

    game.applyEvent!({
      type: 'roomDoorChoice',
      playerId: p1,
      roomPermanentId: 'room-1',
      choiceId: 'unlock',
      resolvedStepId: 'room_door_choice_step_1',
    } as any);

    expect(isRoomDoorLocked(permanent)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === 'room_door_choice_step_1')).toBe(false);
    expect(((game.state as any).stack || []).some((item: any) => item.triggerType === 'unlock_door')).toBe(true);
  });

  it('replays roomDoorChoice lock without firing unlock-door triggers', () => {
    const gameId = 'room_door_choice_replay_lock';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game as any).gameId = gameId;

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: false,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    ResolutionQueueManager.addStep(gameId, {
      id: 'room_door_choice_step_2',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Lock or unlock a door of Cramped Vents // Access Maze?',
      mandatory: true,
      roomDoorLockOrUnlock: true,
      roomPermanentId: 'room-1',
      sourceId: 'room-1',
    } as any);

    game.applyEvent!({
      type: 'roomDoorChoice',
      playerId: p1,
      roomPermanentId: 'room-1',
      choiceId: 'lock',
      resolvedStepId: 'room_door_choice_step_2',
    } as any);

    expect(isRoomDoorLocked(permanent)).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === 'room_door_choice_step_2')).toBe(false);
    expect(((game.state as any).stack || []).some((item: any) => item.triggerType === 'unlock_door')).toBe(false);
  });
});
