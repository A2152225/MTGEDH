import { describe, expect, it } from 'vitest';

import { applyCreatureDamageFromSource } from '../src/state/modules/combat-damage-processing.js';
import { runSBA } from '../src/state/modules/counters_tokens.js';

describe('combat deathtouch SBA integration', () => {
  it('marks deathtouch damage and destroys blockers after runSBA', () => {
    const attacker = {
      id: 'attacker_1',
      controller: 'p1',
      card: {
        id: 'attacker_card',
        name: 'Deathtouch Trampler',
        type_line: 'Creature',
        oracle_text: 'Deathtouch, trample',
        keywords: ['Deathtouch', 'Trample'],
        power: '6',
        toughness: '5',
      },
    };

    const blockers = ['squirrel_1', 'squirrel_2', 'squirrel_3', 'squirrel_4'].map((id, index) => ({
      id,
      controller: 'p2',
      owner: 'p2',
      card: {
        id: `${id}_card`,
        name: 'Squirrel',
        type_line: 'Token Creature — Squirrel',
        power: '2',
        toughness: '2',
      },
      markedDamage: 0,
    }));

    const state: any = {
      battlefield: [attacker, ...blockers],
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      zones: {
        p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
        p2: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      },
      life: { p1: 40, p2: 40 },
      commandZone: {},
      emblems: [],
      conspiracies: [],
      manaPool: {},
    };

    const ctx = { state, bumpSeq: () => {} } as any;

    for (const blocker of blockers) {
      const result = applyCreatureDamageFromSource(ctx, attacker, blocker, 1, 'markedDamage');
      expect(result.appliedAmount).toBe(1);
      expect(blocker.deathtouchDamageMarked).toBe(true);
      expect(blocker.markedDamage).toBe(1);
    }

    runSBA(ctx);

    expect(state.battlefield.map((perm: any) => perm.id)).toEqual(['attacker_1']);
    expect(state.zones.p2.graveyard).toHaveLength(0);
  });

  it('destroys non-token creatures into the graveyard', () => {
    const attacker = {
      id: 'attacker_1',
      controller: 'p1',
      card: {
        id: 'attacker_card',
        name: 'Deathtouch Assassin',
        type_line: 'Creature',
        oracle_text: 'Deathtouch',
        keywords: ['Deathtouch'],
        power: '3',
        toughness: '3',
      },
    };

    const blocker = {
      id: 'soldier_1',
      controller: 'p2',
      owner: 'p2',
      card: {
        id: 'soldier_card',
        name: 'Soldier',
        type_line: 'Creature — Human Soldier',
        power: '2',
        toughness: '2',
      },
      markedDamage: 0,
    };

    const state: any = {
      battlefield: [attacker, blocker],
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      zones: {
        p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
        p2: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      },
      life: { p1: 40, p2: 40 },
      commandZone: {},
      emblems: [],
      conspiracies: [],
      manaPool: {},
    };

    const ctx = { state, bumpSeq: () => {} } as any;
    applyCreatureDamageFromSource(ctx, attacker, blocker, 1, 'markedDamage');
    runSBA(ctx);

    expect(state.battlefield.map((perm: any) => perm.id)).toEqual(['attacker_1']);
    expect(state.zones.p2.graveyard).toHaveLength(1);
    expect(state.zones.p2.graveyard[0]?.name).toBe('Soldier');
  });
});
