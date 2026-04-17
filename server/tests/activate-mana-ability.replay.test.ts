import { describe, expect, it } from 'vitest';

import { snapshotCreatureSpellHasteManaLowerBound } from '../src/socket/util.js';
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
      lifeLossIsDamage: true,
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

  it('replays pay-life mana activations without counting them as damage', () => {
    const game = createInitialGameState('t_activate_mana_ability_pay_life_not_damage_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'confluence_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'confluence_card_1',
          name: 'Mana Confluence',
          type_line: 'Land',
          oracle_text: '{T}, Pay 1 life: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'confluence_1',
      abilityId: 'confluence_1-ability-0',
      manaColor: 'W',
      lifeLossIsDamage: false,
    } as any);

    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).life?.[p1]).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[p1] ?? 0).toBe(0);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(1);
  });

  it('replays activation-cost life separately from legacy pay-life mana results', () => {
    const game = createInitialGameState('t_activate_mana_ability_pay_life_activation_cost_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'caves_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'caves_card_1',
          name: 'Caves of Koilos',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{T}, Pay 1 life: Add {W} or {B}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'caves_1',
      abilityId: 'native_pay_life',
      abilityText: '',
      activatedAbilityText: '',
      tappedPermanents: ['caves_1'],
      lifePaidForCost: 1,
    } as any);

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'caves_1',
      abilityId: 'native_pay_life',
      manaColor: 'B',
      addedMana: { black: 1 },
    } as any);

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).life?.[p1]).toBe(39);
    expect((game.state as any).players?.find((player: any) => player.id === p1)?.life).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[p1] ?? 0).toBe(0);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(1);
  });

  it('replays thin legacy multi-color mana events without collapsing to the first color', () => {
    const game = createInitialGameState('t_activate_mana_ability_legacy_multi_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'rakdos_carnarium_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'rakdos_carnarium_card_1',
          name: 'Rakdos Carnarium',
          type_line: 'Land',
          oracle_text: 'Rakdos Carnarium enters tapped.\nWhen Rakdos Carnarium enters, return a land you control to its owner\'s hand.\n{T}: Add {B}{R}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'rakdos_carnarium_1',
      abilityId: 'native_multi',
      manaColor: 'MULTI',
    } as any);

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 1, red: 1, green: 0, colorless: 0 });
  });

  it('replays thin exact-line mana events using the persisted selected amount', () => {
    const game = createInitialGameState('t_activate_mana_ability_exact_line_amount_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'azure_dynamo_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'azure_dynamo_card_1',
          name: 'Azure Dynamo',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice this artifact: Add {U}.\n{T}: Add {U}{U}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'azure_dynamo_1',
      abilityId: 'azure_dynamo_card_1-ability-1',
      manaColor: 'U',
    } as any);

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 });
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

  it('replays recorded Arena-style haste-granting mana provenance', () => {
    const game = createInitialGameState('t_activate_mana_ability_haste_provenance_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'arena_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'arena_card_1',
          name: 'Arena of Glory',
          type_line: 'Land',
          oracle_text: 'This land enters tapped unless you control a Mountain.\n{T}: Add {R}.\n{R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn. (An exerted permanent won\'t untap during your next untap step.)',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateManaAbility',
      playerId: p1,
      permanentId: 'arena_1',
      abilityId: 'arena_1-ability-1',
      manaColor: 'MULTI',
      addedMana: { red: 2 },
      manaGrantsCreatureSpellHasteUntilEndOfTurn: true,
    } as any);

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 });
    expect(snapshotCreatureSpellHasteManaLowerBound((game.state as any), p1)).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 2,
      green: 0,
      colorless: 0,
    });
  });
});