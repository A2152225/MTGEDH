import { describe, expect, it } from 'vitest';
import { analyzeCardTriggers } from '../src/state/modules/triggers/registry.js';
import {
  applyRoomDoorLockOrUnlockChoice,
  detectRoomUnlockDoorTriggers,
  extractRoomUnlockDoorEffect,
  handleRoomDoorStateOnEnter,
  isRoomDoorLocked,
  lockRoomDoor,
  tryApplyRoomDoorStateFromResolvedEffect,
  unlockRoomDoor,
} from '../src/state/modules/triggers/room.js';
import { extractTriggeredEffectFromTimingMatch } from '../../rules-engine/src/triggerEffectTextExtraction.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import {
  isOracleIrTriggerPrimaryEnabled,
  tryResolveTriggerViaOracleIR,
} from '../src/state/modules/oracleIrTriggerExecution.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';

describe('room unlock door trigger wiring', () => {
  const oracle =
    'When you unlock this door, this Room deals 6 damage to target creature an opponent controls.';

  it('registers unlock_door timing in analyzeCardTriggers', () => {
    const triggers = analyzeCardTriggers(
      { name: 'Cramped Vents // Access Maze', oracle_text: oracle },
      'room-1',
      'p1',
    );
    expect(triggers.some((trigger) => trigger.timing === 'unlock_door')).toBe(true);
  });

  it('detects unlock-door effects with full multi-sentence extraction', () => {
    const match = oracle.match(/when you unlock this door,?\s*([^.]+)/i);
    expect(match).toBeTruthy();
    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!, 1);
    expect(effect.toLowerCase()).toContain('deals 6 damage');

    const detected = detectRoomUnlockDoorTriggers(
      { name: 'Cramped Vents // Access Maze', oracle_text: oracle },
      { id: 'room-1' },
    );
    expect(detected).toHaveLength(1);
    expect(detected[0]?.triggerType).toBe('unlock_door');
    expect(extractRoomUnlockDoorEffect(oracle)?.toLowerCase()).toContain('deals 6 damage');
  });

  it('parses unlock-door damage to wired IR steps', () => {
    const effect = extractRoomUnlockDoorEffect(oracle)!;
    const steps = collectOracleEffectSteps(effect, 'Cramped Vents // Access Maze');
    expect(steps.some((step) => step.kind === 'deal_damage')).toBe(true);
    expect(isTriggerEffectFullyIrWired(effect, 'Cramped Vents // Access Maze')).toBe(true);
  });

  it('queues unlock-door trigger on room enter and marks door unlocked', () => {
    const game = createInitialGameState('room_unlock_queue');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent = {
      id: 'room-1',
      controller: p1,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    handleRoomDoorStateOnEnter(game as any, permanent, p1);

    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) => item.triggerType === 'unlock_door')).toBe(true);
    expect(isRoomDoorLocked(permanent)).toBe(false);
  });

  it('unlockRoomDoor on a locked room queues trigger once', () => {
    const game = createInitialGameState('room_midgame_unlock');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: true,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    expect(unlockRoomDoor(game as any, 'room-1', p1)).toBe(true);
    expect(isRoomDoorLocked(permanent)).toBe(false);
    expect(((game.state as any).stack || []).filter((item: any) => item.triggerType === 'unlock_door')).toHaveLength(1);

    expect(unlockRoomDoor(game as any, 'room-1', p1)).toBe(false);
    expect(((game.state as any).stack || []).filter((item: any) => item.triggerType === 'unlock_door')).toHaveLength(1);
  });

  it('tryApplyRoomDoorUnlockFromResolvedEffect unlocks targeted room doors', () => {
    const game = createInitialGameState('room_unlock_effect_hook');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: true,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    const applied = tryApplyRoomDoorStateFromResolvedEffect(
      game as any,
      p1,
      'Unlock a locked door of up to one target Room you control.',
      { targets: ['room-1'] },
    );

    expect(applied).toBe(true);
    expect(isRoomDoorLocked(permanent)).toBe(false);
    expect(((game.state as any).stack || []).some((item: any) => item.triggerType === 'unlock_door')).toBe(true);
  });

  it('lockRoomDoor locks an unlocked room door', () => {
    const game = createInitialGameState('room_lock_door');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: false,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    expect(lockRoomDoor(game as any, 'room-1')).toBe(true);
    expect(isRoomDoorLocked(permanent)).toBe(true);
    expect(lockRoomDoor(game as any, 'room-1')).toBe(false);
  });

  it('tryApplyRoomDoorStateFromResolvedEffect queues lock-or-unlock choice', () => {
    const game = createInitialGameState('room_lock_or_unlock_choice');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game as any).gameId = 'room_lock_or_unlock_choice';

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: true,
      card: { name: 'Ghostly Keybearer Room', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    const applied = tryApplyRoomDoorStateFromResolvedEffect(
      game as any,
      p1,
      'Lock or unlock a door of target Room you control.',
      { targets: ['room-1'], sourceName: 'Ghostly Keybearer' },
    );

    expect(applied).toBe(true);
    expect(isRoomDoorLocked(permanent)).toBe(true);
  });

  it('applyRoomDoorLockOrUnlockChoice unlocks and locks targeted room doors', () => {
    const game = createInitialGameState('room_apply_choice');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: true,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    expect(applyRoomDoorLockOrUnlockChoice(game as any, p1, 'room-1', 'unlock')).toBe(true);
    expect(isRoomDoorLocked(permanent)).toBe(false);
    expect(((game.state as any).stack || []).some((item: any) => item.triggerType === 'unlock_door')).toBe(true);

    expect(applyRoomDoorLockOrUnlockChoice(game as any, p1, 'room-1', 'lock')).toBe(true);
    expect(isRoomDoorLocked(permanent)).toBe(true);
  });

  it('roomDoorChoice replay event applies lock or unlock state', () => {
    const game = createInitialGameState('room_door_choice_replay');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const permanent = {
      id: 'room-1',
      controller: p1,
      doorLocked: false,
      card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
    };
    (game.state as any).battlefield = [permanent];

    game.applyEvent!({
      type: 'roomDoorChoice',
      playerId: p1,
      roomPermanentId: 'room-1',
      choiceId: 'lock',
    } as any);

    expect(isRoomDoorLocked(permanent)).toBe(true);
  });

  it('primary mode resolves unlock-door damage via Oracle IR', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'room_unlock_ir_primary';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'room-1',
        controller: p1,
        card: { name: 'Cramped Vents // Access Maze', oracle_text: oracle, type_line: 'Room' },
      },
      {
        id: 'bear-1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        power: 2,
        toughness: 2,
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    const effect = extractRoomUnlockDoorEffect(oracle)!;
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Cramped Vents // Access Maze',
      effectText: effect,
      triggerItem: {
        id: 'unlock-trigger-1',
        source: 'room-1',
        permanentId: 'room-1',
        triggerType: 'unlock_door',
      },
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThan(0);
  });
});
