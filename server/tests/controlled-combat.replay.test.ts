import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('controlled combat replay semantics', () => {
  it('replays declareAttackers with attack-cost payment evidence by restoring the sacrificed Treasure and mana spend', () => {
    const game = createInitialGameState('t_attack_cost_declare_attackers_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'attacker_card',
          name: 'Borrowed Attacker',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
      {
        id: 'treasure_1',
        controller: p1,
        owner: p1,
        tapped: false,
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
      type: 'declareAttackers',
      playerId: p1,
      attackers: [
        {
          creatureId: 'attacker_perm',
          targetPlayerId: p2,
        },
      ],
      attackCostPaid: true,
      attackCostAmount: 2,
      sacrificedPermanents: ['treasure_1'],
      paymentManaDelta: { colorless: -1 },
    } as any);

    const attacker = (game.state as any).battlefield.find((perm: any) => perm.id === 'attacker_perm');
    expect(attacker?.attacking).toBe(p2);
    expect(attacker?.tapped).toBe(true);
    expect(attacker?.attackedThisTurn).toBe(true);
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'treasure_1')).toBe(false);
    expect((((game.state as any).zones?.[p1]?.graveyard) || []).some((card: any) => card?.name === 'Treasure')).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays declareControlledAttackers by marking attackers and tapping them', () => {
    const game = createInitialGameState('t_controlled_attackers_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    addPlayer(game, p3, 'P3');

    (game.state as any).battlefield = [
      {
        id: 'attacker_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'attacker_card',
          name: 'Borrowed Attacker',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'declareControlledAttackers',
      playerId: p1,
      attackers: [
        {
          creatureId: 'attacker_perm',
          targetPlayerId: p3,
        },
      ],
      combatControl: 'Master Warcraft',
    } as any);

    const attacker = (game.state as any).battlefield[0];
    expect(attacker.attacking).toBe(p3);
    expect(attacker.tapped).toBe(true);
    expect(attacker.attackedThisTurn).toBe(true);
  });

  it('replays declareControlledBlockers by marking blockers and blocked attackers', () => {
    const game = createInitialGameState('t_controlled_blockers_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).battlefield = [
      {
        id: 'attacker_perm',
        controller: p1,
        owner: p1,
        tapped: true,
        counters: {},
        summoningSickness: false,
        attacking: p2,
        card: {
          id: 'attacker_card',
          name: 'Attacker',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
      {
        id: 'blocker_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'blocker_card',
          name: 'Borrowed Blocker',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'declareControlledBlockers',
      playerId: p1,
      blockers: [
        {
          blockerId: 'blocker_perm',
          attackerId: 'attacker_perm',
        },
      ],
      combatControl: 'Master Warcraft',
    } as any);

    const attacker = (game.state as any).battlefield.find((perm: any) => perm.id === 'attacker_perm');
    const blocker = (game.state as any).battlefield.find((perm: any) => perm.id === 'blocker_perm');
    expect(blocker.blocking).toBe('attacker_perm');
    expect(blocker.blockedThisTurn).toBe(true);
    expect(attacker.blockedBy).toEqual(['blocker_perm']);
    expect(attacker.wasBlockedThisTurn).toBe(true);
  });
});