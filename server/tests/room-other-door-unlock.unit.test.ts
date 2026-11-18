import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import {
  handleRoomDoorStateOnEnter,
  isRoomDoorLocked,
  unlockRoomDoor,
} from '../src/state/modules/triggers/room.js';
import {
  getRoomCastFaceIndex,
  initializeDualRoomDoorsOnEnter,
  isDualDoorRoomCard,
  listLockedRoomDoors,
  payToUnlockRoomDoor,
  syncRoomDoorGrantedUnlockAbilities,
} from '../src/state/modules/roomOtherDoorUnlock.js';

const crampedVents = {
  id: 'room_card_1',
  name: 'Cramped Vents // Access Maze',
  layout: 'split',
  type_line: 'Enchantment — Room // Enchantment — Room',
  faceIndex: 0,
  mana_cost: '{3}{B}',
  oracle_text:
    'When you unlock this door, this Room deals 6 damage to target creature an opponent controls. You gain life equal to the excess damage dealt this way.',
  card_faces: [
    {
      name: 'Cramped Vents',
      mana_cost: '{3}{B}',
      type_line: 'Enchantment — Room',
      oracle_text:
        'When you unlock this door, this Room deals 6 damage to target creature an opponent controls. You gain life equal to the excess damage dealt this way.',
    },
    {
      name: 'Access Maze',
      mana_cost: '{5}{B}',
      type_line: 'Enchantment — Room',
      oracle_text:
        'When you unlock this door, target creature an opponent controls gets -X/-X until end of turn, where X is the number of unlocked doors among Rooms you control.',
    },
  ],
};

describe('Room other-door unlock', () => {
  it('detects dual-door Room cards and lists the locked half', () => {
    expect(isDualDoorRoomCard(crampedVents)).toBe(true);
    const permanent: any = {
      id: 'room-1',
      controller: 'p1',
      card: { ...crampedVents },
    };
    expect(getRoomCastFaceIndex(permanent)).toBe(0);
    initializeDualRoomDoorsOnEnter(permanent);
    expect(permanent.unlockedDoors).toEqual([0]);
    expect(isRoomDoorLocked(permanent)).toBe(true);
    const locked = listLockedRoomDoors(permanent);
    expect(locked).toHaveLength(1);
    expect(locked[0]?.faceIndex).toBe(1);
    expect(locked[0]?.manaCost).toBe('{5}{B}');
    expect(locked[0]?.name).toBe('Access Maze');
    syncRoomDoorGrantedUnlockAbilities(permanent);
    expect(permanent.grantedAbilities?.some((text: string) => /Unlock Access Maze/i.test(text))).toBe(true);
  });

  it('on enter unlocks only the cast door and queues its unlock-door trigger', () => {
    const game = createInitialGameState('room_dual_enter');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent: any = {
      id: 'room-1',
      controller: p1,
      card: { ...crampedVents, faceIndex: 0 },
    };
    (game.state as any).battlefield = [permanent];

    handleRoomDoorStateOnEnter(game as any, permanent, p1);

    expect(permanent.unlockedDoors).toEqual([0]);
    expect(isRoomDoorLocked(permanent)).toBe(true);
    const unlockTriggers = ((game.state as any).stack || []).filter((item: any) => item.triggerType === 'unlock_door');
    expect(unlockTriggers).toHaveLength(1);
    expect(String(unlockTriggers[0]?.effect || '').toLowerCase()).toContain('deals 6 damage');
  });

  it('paying the locked door mana cost unlocks it and fires its unlock trigger', () => {
    const game = createInitialGameState('room_pay_other_door');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'MAIN_1';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 5 },
    };

    const permanent: any = {
      id: 'room-1',
      controller: p1,
      card: { ...crampedVents, faceIndex: 0 },
      unlockedDoors: [0],
      unlockedDoorCount: 1,
      doorLocked: true,
    };
    (game.state as any).battlefield = [permanent];
    syncRoomDoorGrantedUnlockAbilities(permanent);

    const ctx: any = { state: game.state, gameId: 'room_pay_other_door' };
    const paid = payToUnlockRoomDoor(ctx, permanent, p1, 1);
    expect(paid).toEqual(expect.objectContaining({ ok: true }));
    expect(unlockRoomDoor(ctx, 'room-1', p1)).toBe(true);
    expect(permanent.unlockedDoors).toEqual([0, 1]);
    expect(isRoomDoorLocked(permanent)).toBe(false);
    expect(listLockedRoomDoors(permanent)).toHaveLength(0);

    const unlockTriggers = ((game.state as any).stack || []).filter((item: any) => item.triggerType === 'unlock_door');
    expect(unlockTriggers.length).toBeGreaterThanOrEqual(1);
    expect(String(unlockTriggers[unlockTriggers.length - 1]?.effect || '').toLowerCase()).toContain('-x/-x');
  });
});
