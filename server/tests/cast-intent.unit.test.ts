import { describe, expect, it } from 'vitest';

import {
  buildFreeCastIntentFields,
  buildPersistedCastPermissionFields,
  buildPersistedFreeCastIntentFields,
  buildPersistedWebSlingingCastIntentFields,
  isFreeCastIntent,
  preferCandidateByCastPermissionId,
  resolveCastPermissionId,
  resolveDurablePermissionForCastReplay,
  stampCastPermissionId,
} from '../src/state/modules/castIntent.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { cardMayBeCastWithMayhem } from '../src/state/modules/keywordCastMechanics.js';
import { buildDurableGraveyardPermission } from '../src/state/modules/durable-permissions.js';
import type { PlayerID } from '../../shared/src/index.js';

describe('cast intent adapter', () => {
  it('aliases castPermissionId / graveyardPermissionId / permissionId', () => {
    expect(resolveCastPermissionId({ castPermissionId: 'a' })).toBe('a');
    expect(resolveCastPermissionId({ graveyardPermissionId: 'b' })).toBe('b');
    expect(resolveCastPermissionId({ permissionId: 'c' })).toBe('c');
    expect(resolveCastPermissionId({ card: { graveyardPermissionId: 'nested' } })).toBe('nested');
    expect(buildPersistedCastPermissionFields({ permissionId: 'perm_1' })).toEqual({
      castPermissionId: 'perm_1',
      graveyardPermissionId: 'perm_1',
    });

    const target: Record<string, any> = {};
    stampCastPermissionId(target, 'perm_2');
    expect(target).toEqual({ castPermissionId: 'perm_2', graveyardPermissionId: 'perm_2' });
  });

  it('normalizes free-cast payment intent without inventing permission identity', () => {
    expect(isFreeCastIntent({ castWithoutPayingManaCost: true })).toBe(true);
    expect(isFreeCastIntent({ alternateCostId: 'free' })).toBe(true);
    expect(isFreeCastIntent({ graveyardPermissionCostMode: 'without_paying_mana_cost' })).toBe(true);
    expect(buildFreeCastIntentFields(undefined, { force: true })).toEqual({
      alternateCostId: 'free',
      castWithoutPayingManaCost: true,
    });
    expect(buildPersistedFreeCastIntentFields({ castWithoutPayingManaCost: true })).toEqual({
      alternateCostId: 'free',
      castWithoutPayingManaCost: true,
    });
    expect(buildPersistedFreeCastIntentFields({}, 'warp')).toEqual({});
  });

  it('prefers the candidate matching the requested castPermissionId', () => {
    const candidates = [
      { castMethod: 'mayhem', graveyardPermissionId: 'mayhem_a' },
      { castMethod: 'graveyard_permanent', castPermissionId: 'perm_b', graveyardPermissionId: 'perm_b' },
    ] as any[];
    expect(preferCandidateByCastPermissionId(candidates, 'perm_b')).toMatchObject({
      castPermissionId: 'perm_b',
    });
    expect(preferCandidateByCastPermissionId(candidates, undefined)).toBe(candidates[0]);
  });

  it('persists Web-slinging cast-intent fields from the alternate-cost path', () => {
    expect(buildPersistedWebSlingingCastIntentFields({
      webSlingingReturnedCreatureId: 'creature_1',
    }, 'web_slinging')).toEqual({
      alternateCostId: 'web_slinging',
      webSlingingCostWasPaid: true,
      webSlingingReturnedCreatureId: 'creature_1',
    });
    expect(buildPersistedWebSlingingCastIntentFields({}, 'mayhem')).toEqual({});
  });

  it('prefers durable permission id lookup during cast replay', () => {
    const state = {
      durablePermissions: [
        { id: 'perm_keep', kind: 'cast_from_graveyard', usageLimit: { maxUses: 1, used: 0, usedThisTurn: 0 } },
      ],
    };
    const resolved = resolveDurablePermissionForCastReplay(
      state,
      { castPermissionId: 'perm_keep' },
      { id: 'other_match_by_card' },
    );
    expect(resolved).toMatchObject({ id: 'perm_keep' });
  });

  it('stamps Mayhem candidates with a stable castPermissionId alias', () => {
    const card = {
      id: 'mayhem-card',
      name: 'Mayhem spell',
      mana_cost: '{5}{R}',
      type_line: 'Sorcery',
      oracle_text: 'Mayhem {0} (You may cast this card from your graveyard for its mayhem cost if you discarded it this turn.)',
      discardedOnTurn: 7,
      discardedByPlayerId: 'p1',
    };
    const state = {
      turnNumber: 7,
      zones: { p1: { hand: [], graveyard: [card] } },
      battlefield: [],
      stack: [],
    };
    expect(cardMayBeCastWithMayhem(state, 'p1', card)).toBe(true);
    const candidate = getCastableSpellCandidates({ state } as any, 'p1' as any, { mode: 'main' })
      .find((entry) => entry.castMethod === 'mayhem');
    expect(candidate?.castPermissionId).toEqual(expect.any(String));
    expect(candidate?.graveyardPermissionId).toBe(candidate?.castPermissionId);
    expect(String(candidate?.castPermissionId || '')).toContain('mayhem');
  });

  it('surfaces free-cast intent on one GY permission candidate without duplicates', () => {
    const creature = {
      id: 'sable_1',
      name: 'Bronze Sable',
      type_line: 'Artifact Creature — Sable',
      mana_cost: '{2}',
      oracle_text: '',
    };
    const state = {
      turnNumber: 8,
      zones: {
        p1: {
          hand: [],
          graveyard: [creature],
          exile: [],
        },
      },
      durablePermissions: [
        buildDurableGraveyardPermission({
          id: 'durable_chainer_creature_1',
          playerId: 'p1' as PlayerID,
          permission: 'cast',
          cardFilter: { qualifier: 'creature spell' },
          costMode: 'without_paying_mana_cost',
          duration: 'this_turn',
          turnApplied: 8,
          sourceId: 'chainer_1',
          sourceName: 'Chainer, Nightmare Adept',
          usageLimit: { type: 'once', maxUses: 1 },
          replacement: { exileAfterResolution: true, sourceName: 'Chainer, Nightmare Adept' },
        }),
      ],
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    };

    const candidates = getCastableSpellCandidates({ state } as any, 'p1' as any, { mode: 'main' })
      .filter((candidate) => String(candidate.card?.id || '') === creature.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      castMethod: 'graveyard_permanent',
      castPermissionId: 'durable_chainer_creature_1',
      graveyardPermissionId: 'durable_chainer_creature_1',
      graveyardPermissionCostMode: 'without_paying_mana_cost',
      alternateCostId: 'free',
      castWithoutPayingManaCost: true,
      manaCost: '',
      exileAfterResolution: true,
    });
  });
});
