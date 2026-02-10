/**
 * Regression: GameSimulator should honor additional land plays.
 */

import { describe, it, expect } from 'vitest';
import { GameSimulator, type CardData } from '../src/GameSimulator';

describe('GameSimulator - land plays per turn', () => {
  it('plays up to computed max lands per turn (e.g., Exploration = +1)', async () => {
    const simulator: any = new GameSimulator();

    const cardDatabase = new Map<string, CardData>([
      [
        'Exploration',
        {
          name: 'Exploration',
          type_line: 'Enchantment',
          oracle_text: 'You may play an additional land on each of your turns.',
          cmc: 1,
        },
      ],
      [
        'Forest',
        {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '',
          cmc: 0,
        },
      ],
    ]);

    simulator['cardDatabase'] = cardDatabase;

    const player: any = {
      id: 'p1',
      name: 'P1',
      life: 40,
      library: [],
      hand: ['Forest', 'Forest', 'Forest'],
      battlefield: [
        {
          id: 'perm-exploration',
          card: 'Exploration',
          tapped: false,
          summoningSickness: false,
          power: 0,
          toughness: 0,
          counters: {},
          damage: 0,
        },
      ],
      graveyard: [],
      exile: [],
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      landsPlayedThisTurn: 0,
      poisonCounters: 0,
      cardsDrawnThisTurn: 0,
      commanderDamage: {},
      hasLost: false,
      commanderInCommandZone: false,
      commanderTax: 0,
    };

    const simState: any = { players: { p1: player }, turn: 1 };
    const config: any = { verbose: false };

    const actions = await simulator['runMainPhase'](config, player, simState);

    expect(actions).toBe(2);
    expect(player.landsPlayedThisTurn).toBe(2);

    const forestsOnBattlefield = player.battlefield.filter((p: any) => p.card === 'Forest');
    expect(forestsOnBattlefield).toHaveLength(2);
  });

  it('respects global additional land effects controlled by opponents', async () => {
    const simulator: any = new GameSimulator();

    const cardDatabase = new Map<string, CardData>([
      [
        'Ghirapur Orrery',
        {
          name: 'Ghirapur Orrery',
          type_line: 'Artifact',
          oracle_text: 'Each player may play an additional land on each of their turns.',
          cmc: 4,
        },
      ],
      [
        'Forest',
        {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '',
          cmc: 0,
        },
      ],
    ]);

    simulator['cardDatabase'] = cardDatabase;

    const player1: any = {
      id: 'p1',
      name: 'P1',
      life: 40,
      library: [],
      hand: ['Forest', 'Forest'],
      battlefield: [],
      graveyard: [],
      exile: [],
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      landsPlayedThisTurn: 0,
      poisonCounters: 0,
      cardsDrawnThisTurn: 0,
      commanderDamage: {},
      hasLost: false,
      commanderInCommandZone: false,
      commanderTax: 0,
    };

    const player2: any = {
      id: 'p2',
      name: 'P2',
      life: 40,
      library: [],
      hand: [],
      battlefield: [
        {
          id: 'perm-orrery',
          card: 'Ghirapur Orrery',
          tapped: false,
          summoningSickness: false,
          power: 0,
          toughness: 0,
          counters: {},
          damage: 0,
        },
      ],
      graveyard: [],
      exile: [],
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      landsPlayedThisTurn: 0,
      poisonCounters: 0,
      cardsDrawnThisTurn: 0,
      commanderDamage: {},
      hasLost: false,
      commanderInCommandZone: false,
      commanderTax: 0,
    };

    const simState: any = { players: { p1: player1, p2: player2 }, turn: 1 };
    const config: any = { verbose: false };

    const actions = await simulator['runMainPhase'](config, player1, simState);

    expect(actions).toBe(2);
    expect(player1.landsPlayedThisTurn).toBe(2);
  });
});
