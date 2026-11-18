import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import { isRoomDoorLocked } from '../src/state/modules/triggers/room.js';

const crampedVents = {
  id: 'room_card_replay',
  name: 'Cramped Vents // Access Maze',
  layout: 'split',
  type_line: 'Enchantment — Room // Enchantment — Room',
  faceIndex: 0,
  card_faces: [
    {
      name: 'Cramped Vents',
      mana_cost: '{3}{B}',
      type_line: 'Enchantment — Room',
      oracle_text: 'When you unlock this door, this Room deals 6 damage to target creature an opponent controls.',
    },
    {
      name: 'Access Maze',
      mana_cost: '{5}{B}',
      type_line: 'Enchantment — Room',
      oracle_text: 'When you unlock this door, draw a card.',
    },
  ],
};

describe('unlockRoomDoorPaid replay', () => {
  it('replays unlockRoomDoorPaid and unlocks the locked door', () => {
    const gameId = 'room_other_door_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent: any = {
      id: 'room-1',
      controller: p1,
      card: { ...crampedVents },
      unlockedDoors: [0],
      unlockedDoorCount: 1,
      doorLocked: true,
    };
    (game.state as any).battlefield = [permanent];

    game.applyEvent!({
      type: 'unlockRoomDoorPaid',
      playerId: p1,
      permanentId: 'room-1',
      faceIndex: 1,
      cardName: crampedVents.name,
      faceName: 'Access Maze',
      manaCost: '{5}{B}',
    } as any);

    expect(permanent.unlockedDoors).toEqual([0, 1]);
    expect(isRoomDoorLocked(permanent)).toBe(false);
    expect(((game.state as any).stack || []).some((item: any) => item.triggerType === 'unlock_door')).toBe(true);
  });
});
