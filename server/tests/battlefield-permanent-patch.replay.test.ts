import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyBattlefieldPermanentReplayPatch,
  diffBattlefieldPermanentReplayPatches,
  persistBattlefieldPermanentPatchesFromOracleIR,
  snapshotBattlefieldPermanentReplayPatches,
} from '../src/state/effects/battlefieldPermanentReplayPersistence.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';

describe('battlefield permanent replay persistence', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('diffs suspect, temporary effects, and P/T bonus changes', () => {
    const before = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [{
        id: 'bear_1',
        controller: 'p2',
        tapped: false,
      }],
    });
    const after = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [{
        id: 'bear_1',
        controller: 'p2',
        tapped: false,
        isSuspected: true,
        temporaryEffects: [{ id: 'fx1', description: "can't attack", expiresAt: 'end_of_turn' }],
        tempPowerBonus: 2,
        tempToughnessBonus: 2,
      }],
    });

    expect(diffBattlefieldPermanentReplayPatches(before, after)).toEqual([{
      permanentId: 'bear_1',
      patch: {
        isSuspected: true,
        temporaryEffects: [{ id: 'fx1', description: "can't attack", expiresAt: 'end_of_turn' }],
        tempPowerBonus: 2,
        tempToughnessBonus: 2,
      },
    }]);
  });

  it('replays battlefieldPermanentPatch onto the matching permanent', () => {
    const game = createInitialGameState('t_battlefield_permanent_patch_replay');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    (game.state as any).battlefield = [{
      id: 'bear_1',
      controller: p1,
      card: { name: 'Bear', type_line: 'Creature — Bear' },
    }];

    game.applyEvent({
      type: 'battlefieldPermanentPatch',
      permanentId: 'bear_1',
      patch: {
        isSuspected: true,
        tempPowerBonus: 1,
        tempToughnessBonus: 1,
      },
      oracleIrReplayMutation: true,
    } as any);

    const perm = (game.state as any).battlefield[0];
    expect(perm.isSuspected).toBe(true);
    expect(perm.tempPowerBonus).toBe(1);
    expect(perm.tempToughnessBonus).toBe(1);
  });

  it('captures controller and canonical Oracle IR modifier changes for replay', () => {
    const before = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [{
        id: 'borrowed_1',
        controller: 'p1',
      }],
    });
    const after = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [{
        id: 'borrowed_1',
        controller: 'p2',
        modifiers: [{
          type: 'powerToughness',
          power: 0,
          toughness: -2,
          sourceId: 'shrink_1',
          duration: 'end_of_turn',
        }],
      }],
    });

    expect(diffBattlefieldPermanentReplayPatches(before, after)).toEqual([{
      permanentId: 'borrowed_1',
      patch: {
        controller: 'p2',
        modifiers: [{
          type: 'powerToughness',
          power: 0,
          toughness: -2,
          sourceId: 'shrink_1',
          duration: 'end_of_turn',
        }],
      },
    }]);
  });

  it('persists battlefieldPermanentPatch events after oracle IR execution', () => {
    const ctx = {
      gameId: 'game_patch',
      seq: 4,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {},
    };
    const before = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [{ id: 'detain_1', controller: 'p2', tapped: false }],
    });
    const afterState = {
      battlefield: [{
        id: 'detain_1',
        controller: 'p2',
        tapped: false,
        temporaryEffects: [{
          id: 'detain_1:temp:1:can-t-attack',
          description: "can't attack",
          expiresAt: 'leaves_battlefield',
        }],
        grantedAbilities: ["can't attack"],
      }],
    };

    persistBattlefieldPermanentPatchesFromOracleIR(ctx as any, before, afterState, {
      sourceId: 'jailer_1',
      sourceName: 'Test Jailer',
    });

    expect(appendEvent).toHaveBeenCalledWith('game_patch', 4, 'battlefieldPermanentPatch', {
      permanentId: 'detain_1',
      patch: {
        temporaryEffects: [{
          id: 'detain_1:temp:1:can-t-attack',
          description: "can't attack",
          expiresAt: 'leaves_battlefield',
        }],
        grantedAbilities: ["can't attack"],
      },
      oracleIrSourceId: 'jailer_1',
      oracleIrSourceName: 'Test Jailer',
      oracleIrReplayMutation: true,
    });
  });

  it('does not turn a permanent that left the battlefield into a null controller patch', () => {
    const before = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [
        { id: 'mogg_1', controller: 'p1', tapped: false, summoningSickness: false },
        { id: 'bear_1', controller: 'p2', tapped: true },
      ],
    });
    const after = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [
        { id: 'bear_1', controller: 'p2', tapped: false },
      ],
    });

    expect(diffBattlefieldPermanentReplayPatches(before, after)).toEqual([{
      permanentId: 'bear_1',
      patch: { tapped: false },
    }]);
  });

  it('removes fields when patch value is null', () => {
    const permanent: any = {
      id: 'bear_1',
      isSuspected: true,
      tempPowerBonus: 2,
    };

    applyBattlefieldPermanentReplayPatch(permanent, {
      isSuspected: null,
      tempPowerBonus: null,
    });

    expect(permanent.isSuspected).toBeUndefined();
    expect(permanent.tempPowerBonus).toBeUndefined();
  });
});
