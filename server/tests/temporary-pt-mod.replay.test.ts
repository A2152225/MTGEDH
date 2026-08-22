import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyBattlefieldPermanentReplayPatch,
  diffBattlefieldPermanentReplayPatches,
  persistBattlefieldPermanentPatchAfterMutation,
  snapshotBattlefieldPermanentReplayPatches,
  TEMPORARY_PERMANENT_MOD_REPLAY_FIELDS,
  BATTLEFIELD_PERMANENT_REPLAY_PATCH_FIELDS,
} from '../src/state/effects/battlefieldPermanentReplayPersistence.js';
import { applySimpleTargetedTemporarySpellEffects } from '../src/state/modules/oracleIrSpellLegacyTargetBuffUtils.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';

describe('temporary P/T / until-EOT replay persistence (Critical gap #2)', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('includes temporaryAbilities in the shared battlefield patch field list', () => {
    expect(BATTLEFIELD_PERMANENT_REPLAY_PATCH_FIELDS).toContain('temporaryAbilities');
    expect(BATTLEFIELD_PERMANENT_REPLAY_PATCH_FIELDS).toContain('temporaryPTMods');
    expect(TEMPORARY_PERMANENT_MOD_REPLAY_FIELDS).toContain('temporaryPTMods');
    expect(TEMPORARY_PERMANENT_MOD_REPLAY_FIELDS).toContain('temporaryAbilities');
  });

  it('persists temporaryPTMods after live mutation without double-append on replay gate', () => {
    const permanent: any = {
      id: 'bear_1',
      temporaryPTMods: [{ power: 2, toughness: 2, until: 'end_of_turn' }],
      temporaryAbilities: [{ ability: 'haste', expiresAt: 'end_of_turn' }],
    };
    const bumpSeq = vi.fn();
    const ctx = {
      gameId: 'game_temp_pt',
      seq: 7,
      isReplaying: false,
      bumpSeq,
      state: {},
    };

    const ok = persistBattlefieldPermanentPatchAfterMutation(ctx as any, permanent, {
      sourceName: 'Giant Growth',
      fields: ['temporaryPTMods', 'temporaryAbilities'],
    });

    expect(ok).toBe(true);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith('game_temp_pt', 7, 'battlefieldPermanentPatch', expect.objectContaining({
      permanentId: 'bear_1',
      temporaryPermanentModMutation: true,
      patch: {
        temporaryPTMods: [{ power: 2, toughness: 2, until: 'end_of_turn' }],
        temporaryAbilities: [{ ability: 'haste', expiresAt: 'end_of_turn' }],
      },
    }));
    expect(bumpSeq).toHaveBeenCalledTimes(1);

    // Replay / skip gates must not emit again (avoids double-count with applyEvent).
    vi.mocked(appendEvent).mockClear();
    bumpSeq.mockClear();
    expect(persistBattlefieldPermanentPatchAfterMutation({ ...ctx, isReplaying: true } as any, permanent)).toBe(false);
    expect(persistBattlefieldPermanentPatchAfterMutation({ ...ctx, skipEventPersistence: true } as any, permanent)).toBe(false);
    expect(appendEvent).not.toHaveBeenCalled();
    expect(bumpSeq).not.toHaveBeenCalled();
  });

  it('applyEvent(battlefieldPermanentPatch) restores temp P/T and abilities exactly once', () => {
    const game = createInitialGameState('t_temp_pt_mod_replay');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    (game.state as any).battlefield = [{
      id: 'bear_1',
      controller: p1,
      card: { name: 'Bear', type_line: 'Creature — Bear' },
    }];

    const patch = {
      temporaryPTMods: [{ power: 3, toughness: 3, expiresAt: 'end_of_turn', source: 'Giant Growth' }],
      temporaryAbilities: [{ ability: 'trample', expiresAt: 'end_of_turn', source: 'Giant Growth' }],
      grantedAbilities: ['+3/+3 until end of turn'],
    };

    game.applyEvent({
      type: 'battlefieldPermanentPatch',
      permanentId: 'bear_1',
      patch,
      temporaryPermanentModMutation: true,
    } as any);

    const perm = (game.state as any).battlefield[0];
    expect(perm.temporaryPTMods).toEqual(patch.temporaryPTMods);
    expect(perm.temporaryAbilities).toEqual(patch.temporaryAbilities);
    expect(perm.grantedAbilities).toEqual(patch.grantedAbilities);

    // Re-applying the same absolute patch must not accumulate (set, not push).
    game.applyEvent({
      type: 'battlefieldPermanentPatch',
      permanentId: 'bear_1',
      patch,
      temporaryPermanentModMutation: true,
    } as any);
    expect((game.state as any).battlefield[0].temporaryPTMods).toHaveLength(1);
    expect((game.state as any).battlefield[0].temporaryAbilities).toHaveLength(1);
  });

  it('legacy targeted temp buff emits one battlefieldPermanentPatch and does not double-count mods', () => {
    const permanent: any = {
      id: 'target_1',
      card: { name: 'Bear Cub', type_line: 'Creature — Bear' },
    };
    const ctx = {
      gameId: 'game_legacy_buff',
      seq: 3,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {
        turnNumber: 4,
        battlefield: [permanent],
      },
    };

    const applied = applySimpleTargetedTemporarySpellEffects(
      ctx as any,
      'Target creature gets +2/+2 and gains flying until end of turn.',
      ['target_1'],
      'Test Buff',
    );

    expect(applied).toBe(1);
    expect(permanent.temporaryPTMods).toHaveLength(1);
    expect(permanent.temporaryPTMods[0]).toMatchObject({ power: 2, toughness: 2 });
    expect(permanent.temporaryAbilities).toHaveLength(1);
    expect(String(permanent.temporaryAbilities[0].ability)).toContain('flying');

    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(
      'game_legacy_buff',
      3,
      'battlefieldPermanentPatch',
      expect.objectContaining({
        permanentId: 'target_1',
        temporaryPermanentModMutation: true,
        patch: expect.objectContaining({
          temporaryPTMods: permanent.temporaryPTMods,
          temporaryAbilities: permanent.temporaryAbilities,
        }),
      }),
    );

    // Simulate replay of the patch onto a fresh permanent: absolute restore, no extra push.
    const replayPermanent: any = {
      id: 'target_1',
      card: { name: 'Bear Cub', type_line: 'Creature — Bear' },
    };
    const emittedPatch = vi.mocked(appendEvent).mock.calls[0][3].patch;
    applyBattlefieldPermanentReplayPatch(replayPermanent, emittedPatch);
    expect(replayPermanent.temporaryPTMods).toEqual(permanent.temporaryPTMods);
    expect(replayPermanent.temporaryAbilities).toEqual(permanent.temporaryAbilities);
  });

  it('snapshots temporaryAbilities for Oracle IR before/after diffs', () => {
    const before = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [{ id: 'c_1', controller: 'p1' }],
    });
    const after = snapshotBattlefieldPermanentReplayPatches({
      battlefield: [{
        id: 'c_1',
        controller: 'p1',
        temporaryAbilities: [{ ability: 'haste', expiresAt: 'end_of_turn' }],
        temporaryPTMods: [{ power: 1, toughness: 0, until: 'end_of_turn' }],
      }],
    });

    const changes = diffBattlefieldPermanentReplayPatches(before, after);

    expect(changes).toEqual([{
      permanentId: 'c_1',
      patch: {
        temporaryAbilities: [{ ability: 'haste', expiresAt: 'end_of_turn' }],
        temporaryPTMods: [{ power: 1, toughness: 0, until: 'end_of_turn' }],
      },
    }]);
  });
});
