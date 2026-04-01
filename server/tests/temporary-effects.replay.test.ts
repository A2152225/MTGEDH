import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('temporary and counter replay semantics', () => {
  it('replays Giant Growth by restoring its until-end-of-turn +3/+3 modifier on resolution', () => {
    const game = createInitialGameState('t_giant_growth_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).turnNumber = 3;
    (game.state as any).battlefield = [
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        temporaryPTMods: [],
        temporaryAbilities: [],
        card: {
          id: 'creature_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'spell_stack_1',
        type: 'spell',
        controller: p1,
        source: 'hand',
        targets: ['creature_1'],
        card: {
          id: 'giant_growth_1',
          name: 'Giant Growth',
          type_line: 'Instant',
          oracle_text: 'Target creature gets +3/+3 until end of turn.',
          mana_cost: '{G}',
          zone: 'stack',
        },
      },
    ];

    game.applyEvent({ type: 'resolveTopOfStack', playerId: p1 } as any);

    const creature = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'creature_1');
    const temporaryPTMods = Array.isArray(creature?.temporaryPTMods) ? creature.temporaryPTMods : [];

    expect(((game.state as any).stack || [])).toHaveLength(0);
    expect(temporaryPTMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          power: 3,
          toughness: 3,
        }),
      ])
    );
  });

  it('replays temporary keyword grants from resolved spells', () => {
    const game = createInitialGameState('t_temp_keyword_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).turnNumber = 3;
    (game.state as any).battlefield = [
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        temporaryPTMods: [],
        temporaryAbilities: [],
        card: {
          id: 'creature_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'spell_stack_2',
        type: 'spell',
        controller: p1,
        source: 'hand',
        targets: ['creature_1'],
        card: {
          id: 'flight_spell_1',
          name: 'Leap Test',
          type_line: 'Instant',
          oracle_text: 'Target creature gains flying until end of turn.',
          mana_cost: '{U}',
          zone: 'stack',
        },
      },
    ];

    game.applyEvent({ type: 'resolveTopOfStack', playerId: p1 } as any);

    const creature = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'creature_1');
    const temporaryAbilities = Array.isArray(creature?.temporaryAbilities) ? creature.temporaryAbilities : [];

    expect(((game.state as any).stack || [])).toHaveLength(0);
    expect(temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ability: 'flying',
        }),
      ])
    );
  });

  it('resolves leading-clause target creature grants with quoted combat replacement text', () => {
    const game = createInitialGameState('t_sokrates_grant_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).turnNumber = 3;
    (game.state as any).battlefield = [
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        temporaryPTMods: [],
        temporaryAbilities: [],
        card: {
          id: 'creature_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'ability_stack_1',
        type: 'ability',
        controller: p1,
        source: 'sokrates_1',
        sourceName: 'Sokrates, Athenian Teacher',
        description: 'Until end of turn, target creature gains "If this creature would deal combat damage to a player, prevent that damage. This creature\'s controller and that player each draw half that many cards, rounded down."',
        targets: ['creature_1'],
      },
    ];

    game.resolveTopOfStack();

    const creature = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'creature_1');
    const temporaryAbilities = Array.isArray(creature?.temporaryAbilities) ? creature.temporaryAbilities : [];

    expect(((game.state as any).stack || [])).toHaveLength(0);
    expect(temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ability: "if this creature would deal combat damage to a player, prevent that damage. this creature's controller and that player each draw half that many cards, rounded down.",
        }),
      ])
    );
  });

  it('replays level up activations by restoring the level counter after the stack resolves', () => {
    const game = createInitialGameState('t_level_up_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'leveler_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'leveler_card_1',
          name: 'Joraga Treespeaker',
          type_line: 'Creature - Elf Druid',
          oracle_text: 'Level up {1}{G}\nLEVEL 1-4\nElves you control have "{T}: Add {G}{G}."',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'leveler_1',
      abilityId: 'leveler_card_1-level-up-0',
      cardName: 'Joraga Treespeaker',
      abilityText: 'Level up',
      activatedAbilityText: 'Level up {1}{G}',
      abilityType: 'level_up',
      levelUpParams: { amount: 1 },
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect(((game.state as any).stack || [])).toHaveLength(1);

    game.resolveTopOfStack();

    const leveler = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'leveler_1');
    expect(((game.state as any).stack || [])).toHaveLength(0);
    expect(Number(leveler?.counters?.level || 0)).toBe(1);
  });
});