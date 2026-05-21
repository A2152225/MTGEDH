import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent';
import { getCastableSpellCandidates, getPlayableLandCandidates } from '../src/state/modules/can-respond';
import { applyAutomaticDungeonRoomTokenEffects } from '../src/state/modules/dungeon-effects';
import { nextTurn } from '../src/state/modules/turn';
import { tryResolvePlaneswalkerLoyaltyTemplate } from '../src/state/planeswalker/templates/resolve';
import {
  buildDurableLandPlayPermission,
  buildDurableCommandZonePermission,
  buildDurableGraveyardActivationPermission,
  buildDurableGraveyardPermission,
  buildDurableLibraryPermission,
  buildDurablePlayableFromExilePermission,
  clearTemporaryDurableGraveyardPermissions,
  getActiveDurablePermissions,
  getDurableCommandZonePermissionForCard,
  getDurableGraveyardActivationPermissionForCard,
  getDurableLibraryPermissionForCard,
  getDurablePlayableFromExilePermissionForCard,
  playerHasDurableLandPlayPermission,
} from '../src/state/modules/durable-permissions';
import { addGraveyardCastingPermission, clearTemporaryPlayableFromGraveyardPermissions, getActiveGraveyardCastingPermissions } from '../src/state/modules/graveyard-permissions';
import { updateLandPlayPermissions } from '../src/state/modules/land-permissions';
import type { GameContext } from '../src/state/context';
import type { PlayerID } from '../../shared/src';
import { ResolutionQueueManager } from '../src/state/resolution/index';

function createTestContext(state: any): GameContext {
  return {
    state,
    commandZone: state.commandZone || {},
    libraries: new Map(),
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

  it('synthesizes static battlefield graveyard permissions in the shared reader', () => {
    const state: any = {
      turnNumber: 8,
      turnPlayer: 'p1',
      battlefield: [
        {
          id: 'serra_perm_1',
          controller: 'p1',
          card: {
            id: 'serra_card_1',
            name: 'Serra Paragon',
            type_line: 'Creature — Angel',
            oracle_text: 'Flying\nOnce during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life."',
          },
        },
      ],
    };

    expect(getActiveGraveyardCastingPermissions(state, 'p1' as PlayerID, { permission: 'play' })).toEqual([
      expect.objectContaining({
        playerId: 'p1',
        permission: 'play',
        sourceName: 'Serra Paragon',
        sourceText: expect.stringContaining('Once during each of your turns'),
        cardFilter: { qualifier: 'a land' },
        usageLimit: { type: 'once_per_turn', maxUses: 1 },
        replacement: expect.objectContaining({
          leaveBattlefieldDestination: 'exile',
          leaveBattlefieldLifeGain: 2,
          sourceName: 'Serra Paragon',
        }),
      }),
    ]);

    expect(getActiveGraveyardCastingPermissions(state, 'p1' as PlayerID, { permission: 'cast' })).toEqual([
      expect.objectContaining({
        playerId: 'p1',
        permission: 'cast',
        sourceName: 'Serra Paragon',
        sourceText: expect.stringContaining('Once during each of your turns'),
        cardFilter: { qualifier: 'a permanent spell with mana value 3 or less' },
        usageLimit: { type: 'once_per_turn', maxUses: 1 },
        replacement: expect.objectContaining({
          leaveBattlefieldDestination: 'exile',
          leaveBattlefieldLifeGain: 2,
          sourceName: 'Serra Paragon',
        }),
      }),
    ]);

    state.turnPlayer = 'p2';
    expect(getActiveGraveyardCastingPermissions(state, 'p1' as PlayerID, { permission: 'play' })).toEqual([]);
    expect(getActiveGraveyardCastingPermissions(state, 'p1' as PlayerID, { permission: 'cast' })).toEqual([]);
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

  it('filters exhausted durable permissions by usage counters', () => {
    const state: any = {
      turnNumber: 10,
      durablePermissions: [
        buildDurablePlayableFromExilePermission({
          playerId: 'p1' as PlayerID,
          cardIds: ['spent_exile_spell'],
          action: 'cast',
          duration: 'this_turn',
          turnApplied: 10,
          expiresAtTurn: 10,
          sourceName: 'Spent Impulse',
          usageLimit: { type: 'once', maxUses: 1, used: 1 },
        }),
        buildDurableLibraryPermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'this_turn',
          turnApplied: 10,
          expiresAtTurn: 10,
          sourceName: 'Spent Library Window',
          typeLineIncludes: ['artifact'],
          usageLimit: { type: 'once_per_turn', usedThisTurn: 1 },
        }),
        buildDurableCommandZonePermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'this_turn',
          turnApplied: 10,
          expiresAtTurn: 10,
          sourceName: 'Partial Command Window',
          cardIds: ['available_commander'],
          usageLimit: { type: 'limited', maxUses: 2, used: 1 },
        }),
      ],
    };

    expect(getDurablePlayableFromExilePermissionForCard(state, 'p1' as PlayerID, {
      id: 'spent_exile_spell',
      name: 'Spent Spell',
      type_line: 'Sorcery',
    }, 'cast')).toBeUndefined();
    expect(getDurableLibraryPermissionForCard(state, 'p1' as PlayerID, {
      id: 'spent_top_spell',
      name: 'Spent Artifact',
      type_line: 'Artifact',
    }, 'cast')).toBeUndefined();
    expect(getDurableCommandZonePermissionForCard(state, 'p1' as PlayerID, {
      id: 'available_commander',
      name: 'Available Commander',
      type_line: 'Legendary Creature — Wizard',
    }, 'cast')).toEqual(expect.objectContaining({
      kind: 'command_zone_permission',
      usageLimit: { type: 'limited', maxUses: 2, used: 1 },
    }));
  });

  it('filters durable permissions by duration windows and explicit expiry turns', () => {
    const state: any = {
      turnNumber: 7,
      battlefield: [
        {
          id: 'timed_source_perm_1',
          controller: 'p1',
          card: {
            id: 'timed_source_card_1',
            name: 'Timed Source',
            type_line: 'Artifact',
            oracle_text: 'You may cast artifact spells this turn.',
          },
        },
      ],
      durablePermissions: [
        buildDurableLibraryPermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'until_end_of_turn',
          turnApplied: 7,
          sourceName: 'Current EOT Alias',
          typeLineIncludes: ['artifact'],
        }),
        buildDurableLibraryPermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'turn',
          turnApplied: 7,
          sourceName: 'Current Turn Alias',
          typeLineIncludes: ['enchantment'],
        }),
        buildDurableLibraryPermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'eot',
          turnApplied: 6,
          sourceName: 'Expired EOT Alias',
          typeLineIncludes: ['creature'],
        }),
        buildDurablePlayableFromExilePermission({
          playerId: 'p1' as PlayerID,
          cardIds: ['next_turn_spell_1'],
          action: 'cast',
          duration: 'until_end_of_next_turn',
          turnApplied: 6,
          sourceName: 'Next Turn Window',
        }),
        buildDurableCommandZonePermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'static',
          turnApplied: 5,
          expiresAtTurn: 6,
          sourceName: 'Expired Explicit Static',
          cardIds: ['expired_commander_1'],
        }),
        buildDurableLibraryPermission({
          playerId: 'p1' as PlayerID,
          action: 'cast',
          duration: 'while_source_remains',
          turnApplied: 5,
          expiresAtTurn: 6,
          sourceId: 'timed_source_card_1',
          sourceObjectId: 'timed_source_perm_1',
          sourceName: 'Expired Source Window',
          typeLineIncludes: ['artifact'],
        }),
      ],
    };

    expect(getActiveDurablePermissions(state, { playerId: 'p1' as PlayerID }).map((permission) => permission.sourceName)).toEqual([
      'Current EOT Alias',
      'Current Turn Alias',
      'Next Turn Window',
    ]);
  });

  it('clears end-of-turn durable graveyard permission aliases', () => {
    const state: any = {
      turnNumber: 8,
      durablePermissions: [
        buildDurableGraveyardPermission({
          id: 'graveyard_until_eot_alias',
          playerId: 'p1' as PlayerID,
          permission: 'cast',
          duration: 'until_end_of_turn',
          turnApplied: 8,
          sourceName: 'Temporary Alias',
        }),
        buildDurableGraveyardPermission({
          id: 'graveyard_until_next_turn',
          playerId: 'p1' as PlayerID,
          permission: 'cast',
          duration: 'until_end_of_next_turn',
          turnApplied: 8,
          sourceName: 'Next Turn Permission',
        }),
        buildDurableGraveyardPermission({
          id: 'graveyard_static',
          playerId: 'p1' as PlayerID,
          permission: 'cast',
          duration: 'static',
          turnApplied: 8,
          sourceName: 'Static Permission',
        }),
      ],
    };

    expect(clearTemporaryDurableGraveyardPermissions(state)).toBe(1);
    expect(state.durablePermissions.map((permission: any) => permission.id)).toEqual([
      'graveyard_until_next_turn',
      'graveyard_static',
    ]);
  });

  it('tracks durable graveyard activation permissions for keyword-granted abilities', () => {
    const card = {
      id: 'unearth_grave_1',
      name: 'Unearthed Test Creature',
      type_line: 'Artifact Creature',
      oracle_text: '',
    };
    const permission = buildDurableGraveyardActivationPermission({
      playerId: 'p1' as PlayerID,
      keyword: 'unearth',
      cardIds: ['unearth_grave_1'],
      cost: '{3}',
      duration: 'end_of_turn',
      turnApplied: 8,
      sourceId: 'grant_source_1',
      sourceName: 'Ghost Ark',
    });
    const state: any = {
      turnNumber: 8,
      durablePermissions: [permission],
    };

    expect(getDurableGraveyardActivationPermissionForCard(state, 'p1' as PlayerID, card, 'unearth')).toEqual(
      expect.objectContaining({
        allowedAction: 'activate',
        allowedSourceZones: ['graveyard'],
        allowedDestination: 'stack',
        metadata: expect.objectContaining({
          graveyardKeyword: 'unearth',
          cost: '{3}',
        }),
      }),
    );
    expect(getDurableGraveyardActivationPermissionForCard(state, 'p1' as PlayerID, card, 'embalm')).toBeUndefined();

    expect(clearTemporaryDurableGraveyardPermissions(state)).toBe(1);
    expect(state.durablePermissions).toEqual([]);
  });

  it('filters durable permissions while player-control conditions remain true', () => {
    const permission = buildDurableGraveyardPermission({
      id: 'conditional_graveyard_cast_permission',
      playerId: 'p1' as PlayerID,
      permission: 'cast',
      cardFilter: { qualifier: 'creature spell' },
      duration: 'static',
      turnApplied: 8,
      sourceName: 'Zombie Gate',
      condition: {
        type: 'player_controls_permanent_type',
        typeLineIncludes: ['zombie'],
      },
    });
    const state: any = {
      turnNumber: 8,
      battlefield: [
        {
          id: 'zombie_perm_1',
          controller: 'p1',
          card: {
            id: 'zombie_card_1',
            name: 'Walking Corpse',
            type_line: 'Creature — Zombie',
            oracle_text: '',
          },
        },
      ],
      durablePermissions: [permission],
    };

    expect(getActiveDurablePermissions(state, { playerId: 'p1' as PlayerID, kind: 'graveyard_permission' })).toEqual([
      expect.objectContaining({
        id: 'conditional_graveyard_cast_permission',
        condition: {
          type: 'player_controls_permanent_type',
          typeLineIncludes: ['zombie'],
        },
      }),
    ]);

    state.battlefield = [
      {
        id: 'spirit_perm_1',
        controller: 'p1',
        card: {
          id: 'spirit_card_1',
          name: 'Lantern Spirit',
          type_line: 'Creature — Spirit',
          oracle_text: '',
        },
      },
    ];

    expect(getActiveDurablePermissions(state, { playerId: 'p1' as PlayerID, kind: 'graveyard_permission' })).toHaveLength(0);
  });

  it('uses Lukka-style durable exile permissions only while the planeswalker condition remains true', () => {
    const exiledCreature = {
      id: 'lukka_exiled_creature_1',
      name: 'Coppercoat Outcast',
      type_line: 'Creature — Human Soldier',
      mana_cost: '',
      oracle_text: '',
    };
    const ctx = createTestContext({
      turnNumber: 6,
      turnPlayer: 'p1',
      activePlayer: 'p1',
      priorityPlayer: 'p1',
      phase: 'main',
      step: 'main1',
      players: [{ id: 'p1' }, { id: 'p2' }],
      stack: [],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      },
      battlefield: [
        {
          id: 'lukka_perm_1',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'lukka_card_1',
            name: 'Lukka, Coppercoat Outcast',
            type_line: 'Legendary Planeswalker — Lukka',
            oracle_text: '',
          },
        },
      ],
      manaPool: {},
      durablePermissions: [],
    }) as any;
    ctx.libraries.set('p1', [exiledCreature]);

    const resolved = tryResolvePlaneswalkerLoyaltyTemplate(
      ctx,
      'p1' as PlayerID,
      'Lukka, Coppercoat Outcast',
      'Exile the top one card of your library. Creature cards exiled this way gain "You may cast this card from exile as long as you control a Lukka planeswalker."',
      { source: 'lukka_perm_1' },
    );

    expect(resolved).toBe(true);
    expect(ctx.state.zones.p1.exile).toEqual([
      expect.objectContaining({
        id: 'lukka_exiled_creature_1',
        playFromExileRequiresControllerPlaneswalkerNameIncludes: 'lukka',
      }),
    ]);
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[0], 'cast')).toEqual(
      expect.objectContaining({
        allowedAction: 'cast',
        condition: expect.objectContaining({
          type: 'player_controls_permanent_type',
          typeLineIncludes: ['planeswalker'],
          nameIncludes: ['lukka'],
        }),
      }),
    );
    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'lukka_exiled_creature_1')).toBe(true);

    ctx.state.battlefield = [];

    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[0], 'cast')).toBeUndefined();
    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'lukka_exiled_creature_1')).toBe(false);
  });

  it('mirrors live Runestone Caverns exile-play room permissions into durable state', () => {
    const ctx = createTestContext({
      turnNumber: 9,
      turnPlayer: 'p1',
      activePlayer: 'p1',
      priorityPlayer: 'p1',
      phase: 'main',
      step: 'main1',
      players: [{ id: 'p1' }, { id: 'p2' }],
      stack: [],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 2, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      },
      battlefield: [],
      landsPlayedThisTurn: { p1: 0 },
      durablePermissions: [],
    }) as any;
    const exiledSpell = {
      id: 'runestone_spell_1',
      name: 'Runestone Spark',
      type_line: 'Sorcery',
      mana_cost: '',
      oracle_text: '',
    };
    const exiledLand = {
      id: 'runestone_land_1',
      name: 'Runestone Meadow',
      type_line: 'Land',
      oracle_text: '',
    };
    ctx.libraries.set('p1', [exiledSpell, exiledLand]);

    const events = applyAutomaticDungeonRoomTokenEffects(ctx, 'p1' as PlayerID, {
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      currentRoomId: 'runestone_caverns',
      currentRoomName: 'Runestone Caverns',
    } as any);

    expect(events).toEqual([
      expect.objectContaining({
        effectType: 'dungeonExileCards',
        grantPlayableFromExile: true,
      }),
    ]);
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[0], 'cast')).toEqual(
      expect.objectContaining({
        allowedAction: 'play',
        sourceName: 'Runestone Caverns',
      }),
    );
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[1], 'play')).toEqual(
      expect.objectContaining({
        allowedAction: 'play',
        sourceName: 'Runestone Caverns',
      }),
    );
    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'runestone_spell_1')).toBe(true);
    expect(getPlayableLandCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'runestone_land_1')).toBe(true);
  });

  it('mirrors planeswalker this-turn top-library play grants into durable exile permissions', () => {
    const ctx = createTestContext({
      turnNumber: 10,
      turnPlayer: 'p1',
      activePlayer: 'p1',
      priorityPlayer: 'p1',
      phase: 'main',
      step: 'main1',
      players: [{ id: 'p1' }, { id: 'p2' }],
      stack: [],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 2, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      },
      battlefield: [],
      landsPlayedThisTurn: { p1: 0 },
      durablePermissions: [],
    }) as any;
    ctx.libraries.set('p1', [
      {
        id: 'planeswalker_top_spell_1',
        name: 'Sparkbolt',
        type_line: 'Sorcery',
        mana_cost: '',
        oracle_text: '',
      },
      {
        id: 'planeswalker_top_land_1',
        name: 'Sparkfield',
        type_line: 'Land',
        oracle_text: '',
      },
    ]);

    const resolved = tryResolvePlaneswalkerLoyaltyTemplate(
      ctx,
      'p1' as PlayerID,
      'Test Planeswalker',
      'Exile the top two cards of your library. You may play them this turn.',
      { source: 'test_planeswalker_perm_1' },
    );

    expect(resolved).toBe(true);
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[0], 'cast')).toEqual(
      expect.objectContaining({
        allowedAction: 'play',
        duration: 'this_turn',
        expiresAtTurn: 10,
        sourceName: 'Test Planeswalker',
      }),
    );
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[1], 'play')).toEqual(
      expect.objectContaining({
        allowedAction: 'play',
        duration: 'this_turn',
        expiresAtTurn: 10,
      }),
    );
    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'planeswalker_top_spell_1')).toBe(true);
    expect(getPlayableLandCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'planeswalker_top_land_1')).toBe(true);
  });

  it('mirrors planeswalker red top-card cast grants into durable exile permissions', () => {
    const ctx = createTestContext({
      turnNumber: 11,
      turnPlayer: 'p1',
      activePlayer: 'p1',
      priorityPlayer: 'p1',
      phase: 'main',
      step: 'main1',
      players: [{ id: 'p1' }, { id: 'p2' }],
      stack: [],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      },
      battlefield: [],
      durablePermissions: [],
    }) as any;
    ctx.libraries.set('p1', [{
      id: 'planeswalker_red_spell_1',
      name: 'Red Spark',
      type_line: 'Instant',
      mana_cost: '',
      colors: ['R'],
      oracle_text: '',
    }]);

    const resolved = tryResolvePlaneswalkerLoyaltyTemplate(
      ctx,
      'p1' as PlayerID,
      'Red Test Planeswalker',
      "Exile the top card of your library. If it's red, you may cast it this turn.",
      { source: 'red_test_planeswalker_perm_1' },
    );

    expect(resolved).toBe(true);
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[0], 'cast')).toEqual(
      expect.objectContaining({
        allowedAction: 'cast',
        duration: 'this_turn',
        expiresAtTurn: 11,
        sourceName: 'Red Test Planeswalker',
      }),
    );
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[0], 'play')).toBeUndefined();
    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'planeswalker_red_spell_1')).toBe(true);
  });

  it('mirrors planeswalker cast-or-decline prompts into durable one-shot exile permissions', () => {
    const gameId = 'durable_planeswalker_one_shot_exile_prompt';
    ResolutionQueueManager.removeQueue(gameId);
    const ctx = createTestContext({
      gameId,
      turnNumber: 12,
      turnPlayer: 'p1',
      activePlayer: 'p1',
      priorityPlayer: 'p1',
      phase: 'main',
      step: 'main1',
      players: [{ id: 'p1' }, { id: 'p2' }],
      stack: [],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      },
      battlefield: [],
      durablePermissions: [],
    }) as any;
    ctx.gameId = gameId;
    ctx.libraries.set('p1', [{
      id: 'planeswalker_prompt_spell_1',
      name: 'Prompt Spark',
      type_line: 'Instant',
      mana_cost: '',
      oracle_text: '',
    }]);

    const resolved = tryResolvePlaneswalkerLoyaltyTemplate(
      ctx,
      'p1' as PlayerID,
      'Prompt Chandra',
      "Exile the top card of your library. You may cast that card. If you don't, Prompt Chandra deals 3 damage to each opponent.",
      { source: 'prompt_chandra_perm_1' },
    );

    expect(resolved).toBe(true);
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, ctx.state.zones.p1.exile[0], 'cast')).toEqual(
      expect.objectContaining({
        allowedAction: 'cast',
        duration: 'one_shot',
        expiresAtTurn: 12,
        usageLimit: expect.objectContaining({ type: 'one_shot', maxUses: 1 }),
        sourceName: 'Prompt Chandra',
      }),
    );
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((step: any) => String(step?.castFromExileCardId || '') === 'planeswalker_prompt_spell_1')).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('resets durable once-per-turn usage counters on nextTurn', () => {
    const topSpell = {
      id: 'top_artifact_once_each_turn',
      name: 'Mind Stone',
      type_line: 'Artifact',
      mana_cost: '{2}',
      oracle_text: '{T}: Add {C}.',
    };
    const permission = buildDurableLibraryPermission({
      playerId: 'p1' as PlayerID,
      action: 'cast',
      duration: 'static',
      turnApplied: 5,
      sourceName: 'Per-Turn Top Cast',
      typeLineIncludes: ['artifact'],
      usageLimit: { type: 'once_per_turn', used: 2, usedThisTurn: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 5,
      turnPlayer: 'p1',
      players: [{ id: 'p1' }, { id: 'p2' }],
      stack: [],
      battlefield: [],
      durablePermissions: [permission],
    }) as any;

    expect(getDurableLibraryPermissionForCard(ctx.state, 'p1' as PlayerID, topSpell, 'cast')).toBeUndefined();

    nextTurn(ctx);

    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once_per_turn',
      used: 2,
      usedThisTurn: 0,
    });
    expect(getDurableLibraryPermissionForCard(ctx.state, 'p1' as PlayerID, topSpell, 'cast')).toEqual(expect.objectContaining({
      id: permission.id,
    }));
  });

  it('records durable top-library cast permission usage after a successful replayed cast', () => {
    const topSpell = {
      id: 'top_mind_stone_once',
      name: 'Mind Stone',
      type_line: 'Artifact',
      mana_cost: '{2}',
      oracle_text: '{T}: Add {C}.',
    };
    const permission = buildDurableLibraryPermission({
      playerId: 'p1' as PlayerID,
      action: 'cast',
      duration: 'this_turn',
      turnApplied: 10,
      expiresAtTurn: 10,
      sourceName: 'One Top Cast',
      typeLineIncludes: ['artifact'],
      usageLimit: { type: 'once', maxUses: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 10,
      stack: [],
      battlefield: [],
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], libraryCount: 1 },
      },
      durablePermissions: [permission],
    }) as any;
    ctx.libraries.set('p1', [topSpell]);

    applyEvent(ctx, {
      type: 'castSpell',
      playerId: 'p1',
      cardId: topSpell.id,
      fromZone: 'library',
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once',
      maxUses: 1,
      used: 1,
      usedThisTurn: 1,
    });
    expect(getDurableLibraryPermissionForCard(ctx.state, 'p1' as PlayerID, topSpell, 'cast')).toBeUndefined();
  });

  it('records durable command-zone cast permission usage after a successful replayed commander cast', () => {
    const commander = {
      id: 'command_once_1',
      name: 'Tatyova, Benthic Druid',
      type_line: 'Legendary Creature — Merfolk Druid',
      mana_cost: '{3}{G}{U}',
      oracle_text: 'Whenever a land enters the battlefield under your control, you gain 1 life and draw a card.',
    };
    const permission = buildDurableCommandZonePermission({
      playerId: 'p1' as PlayerID,
      action: 'cast',
      duration: 'this_turn',
      turnApplied: 10,
      expiresAtTurn: 10,
      sourceName: 'One Command Cast',
      cardIds: [commander.id],
      usageLimit: { type: 'once', maxUses: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 10,
      stack: [],
      battlefield: [],
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], libraryCount: 0 },
      },
      commandZone: {
        p1: {
          commanderIds: [commander.id],
          commanderCards: [commander],
          inCommandZone: [commander.id],
          taxById: { [commander.id]: 0 },
        },
      },
      durablePermissions: [permission],
    }) as any;

    applyEvent(ctx, {
      type: 'castSpell',
      playerId: 'p1',
      cardId: commander.id,
      fromZone: 'command',
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once',
      maxUses: 1,
      used: 1,
      usedThisTurn: 1,
    });
    expect(getDurableCommandZonePermissionForCard(ctx.state, 'p1' as PlayerID, commander, 'cast')).toBeUndefined();
  });

  it('records durable top-library land permission usage after a successful replayed land play', () => {
    const topLand = {
      id: 'top_forest_once',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '({T}: Add {G}.)',
    };
    const permission = buildDurableLibraryPermission({
      playerId: 'p1' as PlayerID,
      action: 'play',
      duration: 'this_turn',
      turnApplied: 10,
      expiresAtTurn: 10,
      sourceName: 'One Top Land',
      typeLineIncludes: ['land'],
      usageLimit: { type: 'once', maxUses: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 10,
      stack: [],
      battlefield: [],
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], libraryCount: 1 },
      },
      durablePermissions: [permission],
    }) as any;
    ctx.libraries.set('p1', [topLand]);

    applyEvent(ctx, {
      type: 'playLand',
      playerId: 'p1',
      cardId: topLand.id,
      fromZone: 'library',
    } as any);

    expect(ctx.state.battlefield).toEqual([
      expect.objectContaining({
        controller: 'p1',
        card: expect.objectContaining({ id: topLand.id }),
      }),
    ]);
    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once',
      maxUses: 1,
      used: 1,
      usedThisTurn: 1,
    });
    expect(getDurableLibraryPermissionForCard(ctx.state, 'p1' as PlayerID, topLand, 'play')).toBeUndefined();
  });

  it('records durable exile cast permission usage after a successful replayed cast', () => {
    const shock = {
      id: 'exile_shock_once',
      name: 'Shock',
      type_line: 'Instant',
      mana_cost: '{R}',
      oracle_text: 'Shock deals 2 damage to any target.',
      zone: 'exile',
    };
    const opt = {
      id: 'exile_opt_once',
      name: 'Opt',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text: 'Scry 1. Draw a card.',
      zone: 'exile',
    };
    const permission = buildDurablePlayableFromExilePermission({
      playerId: 'p1' as PlayerID,
      cardIds: [shock.id, opt.id],
      action: 'cast',
      duration: 'this_turn',
      turnApplied: 10,
      expiresAtTurn: 10,
      sourceName: 'Two-Card Impulse',
      usageLimit: { type: 'once', maxUses: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 10,
      stack: [],
      battlefield: [],
      playableFromExile: { p1: { [shock.id]: 10, [opt.id]: 10 } },
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [shock, opt], exileCount: 2, libraryCount: 0 },
      },
      durablePermissions: [permission],
    }) as any;

    applyEvent(ctx, {
      type: 'castSpell',
      playerId: 'p1',
      cardId: shock.id,
      card: shock,
      fromZone: 'exile',
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once',
      maxUses: 1,
      used: 1,
      usedThisTurn: 1,
    });
    expect(ctx.state.durablePermissions[0].cardFilter.affectedCardIds).toEqual([opt.id]);
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, opt, 'cast')).toBeUndefined();
  });

  it('records durable exile land permission usage after a successful replayed land play', () => {
    const mountain = {
      id: 'exile_mountain_once',
      name: 'Mountain',
      type_line: 'Basic Land — Mountain',
      oracle_text: '({T}: Add {R}.)',
      zone: 'exile',
    };
    const island = {
      id: 'exile_island_once',
      name: 'Island',
      type_line: 'Basic Land — Island',
      oracle_text: '({T}: Add {U}.)',
      zone: 'exile',
    };
    const permission = buildDurablePlayableFromExilePermission({
      playerId: 'p1' as PlayerID,
      cardIds: [mountain.id, island.id],
      action: 'play',
      duration: 'this_turn',
      turnApplied: 10,
      expiresAtTurn: 10,
      sourceName: 'Two-Card Land Impulse',
      usageLimit: { type: 'once', maxUses: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 10,
      stack: [],
      battlefield: [],
      landsPlayedThisTurn: { p1: 0 },
      playableFromExile: { p1: { [mountain.id]: 10, [island.id]: 10 } },
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [mountain, island], exileCount: 2, libraryCount: 0 },
      },
      durablePermissions: [permission],
    }) as any;

    applyEvent(ctx, {
      type: 'playLand',
      playerId: 'p1',
      cardId: mountain.id,
      card: mountain,
      fromZone: 'exile',
    } as any);

    expect(ctx.state.battlefield).toEqual([
      expect.objectContaining({
        controller: 'p1',
        card: expect.objectContaining({ id: mountain.id }),
      }),
    ]);
    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once',
      maxUses: 1,
      used: 1,
      usedThisTurn: 1,
    });
    expect(ctx.state.durablePermissions[0].cardFilter.affectedCardIds).toEqual([island.id]);
    expect(getDurablePlayableFromExilePermissionForCard(ctx.state, 'p1' as PlayerID, island, 'play')).toBeUndefined();
  });

  it('records durable graveyard cast permission usage after a successful replayed cast', () => {
    const graveyardCreature = {
      id: 'graveyard_bear_once',
      name: 'Runeclaw Bear',
      type_line: 'Creature — Bear',
      mana_cost: '{1}{G}',
      oracle_text: '',
      zone: 'graveyard',
    };
    const permission = buildDurableGraveyardPermission({
      id: 'graveyard_cast_once_permission',
      playerId: 'p1' as PlayerID,
      permission: 'cast',
      cardFilter: { qualifier: 'creature spell' },
      duration: 'this_turn',
      turnApplied: 10,
      sourceName: 'One Graveyard Cast',
      usageLimit: { type: 'once', maxUses: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 10,
      stack: [],
      battlefield: [],
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [graveyardCreature], graveyardCount: 1, exile: [], exileCount: 0, libraryCount: 0 },
      },
      durablePermissions: [permission],
    }) as any;

    applyEvent(ctx, {
      type: 'castSpell',
      playerId: 'p1',
      cardId: graveyardCreature.id,
      card: graveyardCreature,
      fromZone: 'graveyard',
    } as any);

    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once',
      maxUses: 1,
      used: 1,
      usedThisTurn: 1,
    });
    expect(getActiveDurablePermissions(ctx.state, { playerId: 'p1' as PlayerID, kind: 'graveyard_permission' })).toHaveLength(0);
  });

  it('records durable graveyard land-play permission usage after a successful replayed land play', () => {
    const wasteland = {
      id: 'graveyard_wasteland_once',
      name: 'Wasteland',
      type_line: 'Land',
      oracle_text: '{T}: Add {C}.',
      zone: 'graveyard',
    };
    const permission = buildDurableLandPlayPermission({
      playerId: 'p1' as PlayerID,
      zone: 'graveyard',
      sourceId: 'crucible_card_1',
      sourceObjectId: 'crucible_perm_1',
      sourceName: 'Crucible of Worlds',
      sourceText: 'You may play lands from your graveyard.',
      turnApplied: 10,
      usageLimit: { type: 'once', maxUses: 1 },
    });
    const ctx = createTestContext({
      turnNumber: 10,
      stack: [],
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
      ],
      landsPlayedThisTurn: { p1: 0 },
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [wasteland], graveyardCount: 1, exile: [], exileCount: 0, libraryCount: 0 },
      },
      durablePermissions: [permission],
    }) as any;

    applyEvent(ctx, {
      type: 'playLand',
      playerId: 'p1',
      cardId: wasteland.id,
      card: wasteland,
      fromZone: 'graveyard',
    } as any);

    expect(ctx.state.battlefield.map((permanent: any) => String(permanent?.card?.id || ''))).toContain(wasteland.id);
    expect(ctx.state.durablePermissions[0].usageLimit).toEqual({
      type: 'once',
      maxUses: 1,
      used: 1,
      usedThisTurn: 1,
    });
    expect(getActiveDurablePermissions(ctx.state, { playerId: 'p1' as PlayerID, kind: 'land_play' })).toHaveLength(0);
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
          grantsFlash: true,
          timingOverride: { ignoreTiming: true },
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
      timingOverride: { asThoughFlash: true, ignoreTiming: true },
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
      battlefield: [
        {
          id: 'forge_perm_1',
          controller: 'p1',
          card: {
            id: 'forge_card_1',
            name: 'Mystic Forge',
            type_line: 'Artifact',
            oracle_text: 'You may look at the top card of your library any time.',
          },
        },
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

  it('deactivates durable while-source-remains permissions when the source permanent is gone', () => {
    const state: any = {
      turnNumber: 14,
      battlefield: [],
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
        }),
      ],
    };

    expect(getActiveDurablePermissions(state, { playerId: 'p1' as PlayerID, kind: 'library_permission' })).toHaveLength(0);
    expect(getDurableLibraryPermissionForCard(state, 'p1' as PlayerID, {
      id: 'mind_stone_1',
      name: 'Mind Stone',
      type_line: 'Artifact',
    }, 'cast')).toBeUndefined();
  });

  it('merges durable top-library timing overrides with flash grants', () => {
    const permission = buildDurableLibraryPermission({
      playerId: 'p1' as PlayerID,
      action: 'cast',
      duration: 'this_turn',
      turnApplied: 15,
      expiresAtTurn: 15,
      sourceName: 'Timed Library Window',
      typeLineIncludes: ['artifact'],
      grantsFlash: true,
      timingOverride: { duringYourTurnOnly: true, sorcerySpeedOnly: false },
    });

    expect(permission.timingOverride).toEqual({
      asThoughFlash: true,
      duringYourTurnOnly: true,
      sorcerySpeedOnly: false,
    });
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
          timingOverride: { ignoreTiming: true },
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
      timingOverride: { asThoughFlash: true, ignoreTiming: true },
    }));
    expect(getDurableCommandZonePermissionForCard(state, 'p1' as PlayerID, {
      id: 'other_commander_1',
      name: 'Other Commander',
      type_line: 'Legendary Creature — Warrior',
    }, 'cast')).toBeUndefined();
  });
});