import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('activateManaAbility replay semantics', () => {
  it('replays recorded mana deltas and recorded life loss exactly', () => {
    const game = createInitialGameState('t_activate_mana_ability_recorded_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'reef_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'reef_card_1',
          name: 'Shivan Reef',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{T}: Add {U} or {R}. Shivan Reef deals 1 damage to you.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'reef_1',
      abilityId: 'tap-mana-u',
      manaColor: 'U',
      addedMana: { blue: 1 },
      lifeLost: 1,
    } as any);

    expect((game.state as any).battlefield[0].tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).life?.[p1]).toBe(39);
    expect((game.state as any).players?.find((player: any) => player.id === p1)?.life).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[p1]).toBe(1);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(1);
  });

  it('replays legacy thin mana events by inferring the mana added', () => {
    const game = createInitialGameState('t_activate_mana_ability_legacy_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'forest_1',
      abilityId: 'tap-mana-g',
      manaColor: 'G',
    } as any);

    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 });
    expect((game.state as any).battlefield[0].tapped).toBe(true);
  });

  it('replays legacy pain-land events by inferring the life loss', () => {
    const game = createInitialGameState('t_activate_mana_ability_legacy_pain_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'reef_legacy_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'reef_legacy_card_1',
          name: 'Shivan Reef',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{T}: Add {U} or {R}. Shivan Reef deals 1 damage to you.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'reef_legacy_1',
      abilityId: 'tap-mana-r',
      manaColor: 'R',
    } as any);

    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 });
    expect((game.state as any).life?.[p1]).toBe(39);
    expect((game.state as any).players?.find((player: any) => player.id === p1)?.life).toBe(39);
  });

  it('replays a multi-ability land mana activation without sacrificing the land', () => {
    const game = createInitialGameState('t_activate_mana_ability_myriad_landscape_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'myriad_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'myriad_card_1',
          name: 'Myriad Landscape',
          type_line: 'Land',
          oracle_text: 'Myriad Landscape enters the battlefield tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'myriad_1',
      abilityId: 'myriad_1-ability-0',
      manaColor: 'C',
      addedMana: { colorless: 1 },
    } as any);

    expect((game.state as any).battlefield).toHaveLength(1);
    expect((game.state as any).battlefield[0]?.id).toBe('myriad_1');
    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).zones[p1]?.graveyard ?? []).toHaveLength(0);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 });
  });

  it('replays recorded mana even after a prior activation-cost sacrifice removed the source', () => {
    const game = createInitialGameState('t_activate_mana_ability_sacrificed_source_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'treasure_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact — Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'treasure_1',
      abilityText: '{T}, Sacrifice this artifact: Add one mana of any color.',
      activatedAbilityText: '{T}, Sacrifice this artifact: Add one mana of any color.',
      tappedPermanents: ['treasure_1'],
      sacrificedPermanents: ['treasure_1'],
      lifePaidForCost: 0,
    } as any);

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'treasure_1',
      manaColor: 'G',
      addedMana: { green: 1 },
    } as any);

    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 });
  });

  it('replays storage-counter mana activations with recorded counter removal', () => {
    const game = createInitialGameState('t_activate_mana_ability_storage_counter_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'calciform_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { storage: 3 },
        card: {
          id: 'calciform_card_1',
          name: 'Calciform Pools',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{1}, {T}: Put a storage counter on Calciform Pools.\n{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'calciform_1',
      abilityId: 'calciform_1-ability-2',
      cardName: 'Calciform Pools',
      abilityText: '{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
      activatedAbilityText: '{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
      tappedPermanents: ['calciform_1'],
      removedCountersForCost: [{ permanentId: 'calciform_1', counterType: 'storage', count: 3 }],
    } as any);

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'calciform_1',
      abilityId: 'calciform_1-ability-2',
      manaColor: 'MULTI',
      addedMana: { white: 2, blue: 1 },
    } as any);

    const permanent = (game.state as any).battlefield[0];
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number(permanent?.counters?.storage || 0)).toBe(0);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 2, blue: 1, black: 0, red: 0, green: 0, colorless: 0 });
  });
});