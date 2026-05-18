import { describe, expect, it } from 'vitest';

import { getPlayableLandCandidates } from '../src/state/modules/can-respond';
import {
  buildDurableLandPlayPermission,
  buildDurableCommandZonePermission,
  buildDurableLibraryPermission,
  buildDurablePlayableFromExilePermission,
  getActiveDurablePermissions,
  getDurableCommandZonePermissionForCard,
  getDurableLibraryPermissionForCard,
  getDurablePlayableFromExilePermissionForCard,
  playerHasDurableLandPlayPermission,
} from '../src/state/modules/durable-permissions';
import { addGraveyardCastingPermission, clearTemporaryPlayableFromGraveyardPermissions } from '../src/state/modules/graveyard-permissions';
import { updateLandPlayPermissions } from '../src/state/modules/land-permissions';
import type { GameContext } from '../src/state/context';
import type { PlayerID } from '../../shared/src';

function createTestContext(state: any): GameContext {
  return {
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {},
  } as any;
}

describe('durable permissions', () => {
  it('mirrors static battlefield land-play permissions into durable state', () => {
    const game = {
      state: {
        turnNumber: 3,
        landPlayPermissions: {},
        battlefield: [
          {
            id: 'crucible_perm_1',
            controller: 'p1',
            card: {
              id: 'crucible_card_1',
              name: 'Crucible of Worlds',
              type_line: 'Artifact',
              oracle_text: 'You may play lands from your graveyard.',
            },
          },
          {
            id: 'ramunap_perm_1',
            controller: 'p1',
            card: {
              id: 'ramunap_card_1',
              name: 'Ramunap Excavator',
              type_line: 'Creature — Naga Cleric',
              oracle_text: 'You may play land cards from your graveyard.',
            },
          },
        ],
      },
    };

    updateLandPlayPermissions(game, 'p1');

    expect(game.state.landPlayPermissions.p1).toEqual(['graveyard']);
    expect(playerHasDurableLandPlayPermission(game.state, 'p1' as PlayerID, 'graveyard')).toBe(true);
    expect(getActiveDurablePermissions(game.state, { playerId: 'p1' as PlayerID, kind: 'land_play' })).toEqual([
      expect.objectContaining({
        grantedTo: 'p1',
        sourceName: 'Crucible of Worlds',
        sourceZone: 'battlefield',
        allowedSourceZones: ['graveyard'],
        cardFilter: { typeLineIncludes: ['land'] },
      }),
      expect.objectContaining({
        grantedTo: 'p1',
        sourceName: 'Ramunap Excavator',
        sourceZone: 'battlefield',
        allowedSourceZones: ['graveyard'],
        cardFilter: { typeLineIncludes: ['land'] },
      }),
    ]);
  });

  it('uses durable land-play permissions when generating graveyard land candidates', () => {
    const ctx = createTestContext({
      turnNumber: 4,
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      stack: [],
      landsPlayedThisTurn: { p1: 0 },
      durablePermissions: [
        buildDurableLandPlayPermission({
          playerId: 'p1' as PlayerID,
          zone: 'graveyard',
          sourceId: 'crucible_card_1',
          sourceObjectId: 'crucible_perm_1',
          sourceName: 'Crucible of Worlds',
          sourceText: 'You may play lands from your graveyard.',
          turnApplied: 4,
        }),
      ],
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [
            {
              id: 'wasteland_1',
              name: 'Wasteland',
              type_line: 'Land',
              oracle_text: '{T}: Add {C}.',
            },
          ],
          graveyardCount: 1,
          exile: [],
          exileCount: 0,
          libraryCount: 0,
        },
      },
    });

    expect(getPlayableLandCandidates(ctx, 'p1' as PlayerID)).toEqual([
      expect.objectContaining({
        sourceZone: 'graveyard',
        card: expect.objectContaining({ id: 'wasteland_1' }),
      }),
    ]);
  });

  it('mirrors first-class graveyard cast permissions into durable state', () => {
    const state: any = { turnNumber: 5 };

    const permission = addGraveyardCastingPermission(state, {
      id: 'chainer_permission_1',
      playerId: 'p1',
      permission: 'cast',
      cardFilter: { qualifier: 'creature spell' },
      costMode: 'without_paying_mana_cost',
      duration: 'this_turn',
      turnApplied: 5,
      sourceId: 'chainer_1',
      sourceName: 'Chainer, Nightmare Adept',
      usageLimit: { type: 'once', maxUses: 1 },
      replacement: { exileAfterResolution: true, sourceName: 'Chainer, Nightmare Adept' },
    });

    expect(permission).toBeDefined();
    expect(getActiveDurablePermissions(state, { playerId: 'p1' as PlayerID, kind: 'graveyard_permission' })).toEqual([
      expect.objectContaining({
        id: 'chainer_permission_1',
        kind: 'graveyard_permission',
        grantedTo: 'p1',
        allowedAction: 'cast',
        allowedSourceZones: ['graveyard'],
        allowedDestination: 'stack',
        sourceId: 'chainer_1',
        sourceName: 'Chainer, Nightmare Adept',
        sourceZone: 'graveyard',
        cardFilter: { qualifier: 'creature spell' },
        costMode: 'without_paying_mana_cost',
        duration: 'this_turn',
        usageLimit: { type: 'once', maxUses: 1 },
        replacement: { exileAfterResolution: true, sourceName: 'Chainer, Nightmare Adept' },
        metadata: { graveyardPermissionId: 'chainer_permission_1' },
      }),
    ]);
  });

  it('clears temporary durable graveyard permissions with the legacy temporary cleanup', () => {
    const state: any = { turnNumber: 9 };

    addGraveyardCastingPermission(state, {
      id: 'temporary_graveyard_permission_1',
      playerId: 'p1',
      permission: 'cast',
      cardFilter: { cardIds: ['sable_1'] },
      costMode: 'normal',
      duration: 'this_turn',
      turnApplied: 9,
      sourceName: 'Temporary Source',
    });
    addGraveyardCastingPermission(state, {
      id: 'static_graveyard_permission_1',
      playerId: 'p1',
      permission: 'play',
      cardFilter: { qualifier: 'lands' },
      costMode: 'normal',
      duration: 'static',
      turnApplied: 9,
      sourceName: 'Static Source',
    });

    expect(getActiveDurablePermissions(state, { playerId: 'p1' as PlayerID, kind: 'graveyard_permission' })).toHaveLength(2);
    expect(clearTemporaryPlayableFromGraveyardPermissions(state)).toBe(1);

    expect((state.graveyardCastingPermissions || []).map((entry: any) => entry.id)).toEqual(['static_graveyard_permission_1']);
    expect(getActiveDurablePermissions(state, { playerId: 'p1' as PlayerID, kind: 'graveyard_permission' })).toEqual([
      expect.objectContaining({
        id: 'static_graveyard_permission_1',
        duration: 'static',
        allowedAction: 'play',
      }),
    ]);
  });

  it('builds active durable playable-from-exile permissions for exact exiled cards', () => {
    const state: any = {
      turnNumber: 12,
      durablePermissions: [
        buildDurablePlayableFromExilePermission({
          playerId: 'p1' as PlayerID,
          cardIds: ['exiled_spell_1'],
          action: 'cast',
          duration: 'until_end_of_next_turn',
          turnApplied: 11,
          expiresAtTurn: 12,
          sourceName: 'Siphon Insight',
          costMode: 'without_paying_mana_cost',
          spendManaAsThoughAnyType: true,
        }),
      ],
    };

    expect(getDurablePlayableFromExilePermissionForCard(state, 'p1' as PlayerID, {
      id: 'exiled_spell_1',
      name: 'Lightning Bolt',
      type_line: 'Instant',
    }, 'cast')).toEqual(expect.objectContaining({
      kind: 'playable_from_exile',
      grantedTo: 'p1',
      allowedAction: 'cast',
      allowedSourceZones: ['exile'],
      cardFilter: { affectedCardIds: ['exiled_spell_1'] },
      costMode: 'without_paying_mana_cost',
      metadata: expect.objectContaining({ spendManaAsThoughAnyType: true }),
    }));
    expect(getDurablePlayableFromExilePermissionForCard(state, 'p1' as PlayerID, {
      id: 'other_exiled_spell_1',
      name: 'Opt',
      type_line: 'Instant',
    }, 'cast')).toBeUndefined();
  });

  it('builds active durable top-library permissions with type filters and flash timing', () => {
    const state: any = {
      turnNumber: 14,
      durablePermissions: [
        buildDurableLibraryPermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'while_source_remains',
          turnApplied: 14,
          sourceId: 'forge_card_1',
          sourceObjectId: 'forge_perm_1',
          sourceName: 'Mystic Forge',
          typeLineIncludes: ['artifact'],
          costMode: 'without_paying_mana_cost',
          spendManaAsThoughAnyType: true,
          grantsFlash: true,
        }),
      ],
    };

    expect(getDurableLibraryPermissionForCard(state, 'p1' as PlayerID, {
      id: 'mind_stone_1',
      name: 'Mind Stone',
      type_line: 'Artifact',
    }, 'cast')).toEqual(expect.objectContaining({
      kind: 'library_permission',
      grantedTo: 'p1',
      allowedAction: 'cast',
      allowedSourceZones: ['library'],
      sourceName: 'Mystic Forge',
      sourceObjectId: 'forge_perm_1',
      cardFilter: { typeLineIncludes: ['artifact'] },
      costMode: 'without_paying_mana_cost',
      metadata: expect.objectContaining({ spendManaAsThoughAnyType: true }),
      timingOverride: { asThoughFlash: true },
    }));
    expect(getDurableLibraryPermissionForCard(state, 'p1' as PlayerID, {
      id: 'forest_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
    }, 'cast')).toBeUndefined();
  });

  it('builds active durable command-zone permissions for commander metadata', () => {
    const state: any = {
      turnNumber: 15,
      durablePermissions: [
        buildDurableCommandZonePermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'this_turn',
          turnApplied: 15,
          expiresAtTurn: 15,
          sourceName: 'Command Beacon Emblem',
          cardIds: ['commander_1'],
          costMode: 'without_paying_mana_cost',
          spendManaAsThoughAnyType: true,
          grantsFlash: true,
        }),
      ],
    };

    expect(getDurableCommandZonePermissionForCard(state, 'p1' as PlayerID, {
      id: 'commander_1',
      name: 'Test Commander',
      type_line: 'Legendary Creature — Wizard',
    }, 'cast')).toEqual(expect.objectContaining({
      kind: 'command_zone_permission',
      grantedTo: 'p1',
      allowedAction: 'cast',
      allowedSourceZones: ['command'],
      allowedDestination: 'stack',
      sourceName: 'Command Beacon Emblem',
      cardFilter: { affectedCardIds: ['commander_1'] },
      costMode: 'without_paying_mana_cost',
      metadata: expect.objectContaining({ spendManaAsThoughAnyType: true }),
      timingOverride: { asThoughFlash: true },
    }));
    expect(getDurableCommandZonePermissionForCard(state, 'p1' as PlayerID, {
      id: 'other_commander_1',
      name: 'Other Commander',
      type_line: 'Legendary Creature — Warrior',
    }, 'cast')).toBeUndefined();
  });
});