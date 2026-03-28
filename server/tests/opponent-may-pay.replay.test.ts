import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('opponent may pay replay semantics', () => {
  it('replays a paid choice by consuming the deciding player mana', () => {
    const game = createInitialGameState('t_opponent_may_pay_replay_pay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };

    game.applyEvent({
      type: 'opponentMayPayResolve',
      playerId: p1,
      decidingPlayer: p1,
      promptId: 'prompt_pay',
      willPay: true,
      sourceName: 'Smothering Tithe',
      sourceController: p2,
      manaCost: '{2}',
      declineEffect: 'Create a Treasure token',
    } as any);

    expect((game.state as any).manaPool[p1]).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.card?.name === 'Treasure')).toBe(false);
  });

  it('replays declined draw effects for the source controller', () => {
    const game = createInitialGameState('t_opponent_may_pay_replay_draw');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.importDeckResolved(p2, [
      {
        id: 'draw_target_1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '({T}: Add {U}.)',
      },
    ]);

    game.applyEvent({
      type: 'opponentMayPayResolve',
      playerId: p1,
      decidingPlayer: p1,
      promptId: 'prompt_draw',
      willPay: false,
      sourceName: 'Rhystic Study',
      sourceController: p2,
      declineEffect: 'Draw a card',
      triggerText: 'Rhystic Study triggers: Pay {1} or its controller draws a card.',
    } as any);

    expect(((game.state as any).zones?.[p2]?.hand || []).map((card: any) => card?.id)).toEqual(['draw_target_1']);
    expect((game.state as any).zones?.[p2]?.libraryCount).toBe(0);
  });

  it('replays declined treasure effects for the source controller', () => {
    const game = createInitialGameState('t_opponent_may_pay_replay_treasure');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.applyEvent({
      type: 'opponentMayPayResolve',
      playerId: p1,
      decidingPlayer: p1,
      promptId: 'prompt_treasure',
      willPay: false,
      sourceName: 'Smothering Tithe',
      sourceController: p2,
      declineEffect: 'Create a Treasure token',
      triggerText: 'Smothering Tithe triggers: Pay {2} or its controller creates a Treasure token.',
    } as any);

    const treasures = ((game.state as any).battlefield || []).filter(
      (perm: any) => perm?.controller === p2 && perm?.card?.name === 'Treasure'
    );
    expect(treasures).toHaveLength(1);
    expect(treasures[0]?.card?.type_line).toBe('Token Artifact — Treasure');
  });

  it('prefers persisted declined draw counts over replay heuristics', () => {
    const game = createInitialGameState('t_opponent_may_pay_replay_recorded_draw');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.importDeckResolved(p2, [
      {
        id: 'recorded_draw_1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '({T}: Add {U}.)',
      },
    ]);

    game.applyEvent({
      type: 'opponentMayPayResolve',
      playerId: p1,
      decidingPlayer: p1,
      promptId: 'prompt_recorded_draw',
      willPay: false,
      sourceName: 'Custom Archive Trigger',
      sourceController: p2,
      declineEffect: 'Do the unusual archive thing.',
      triggerText: 'Custom Archive Trigger resolves.',
      declineDrawCount: 1,
    } as any);

    expect(((game.state as any).zones?.[p2]?.hand || []).map((card: any) => card?.id)).toEqual(['recorded_draw_1']);
    expect((game.state as any).zones?.[p2]?.libraryCount).toBe(0);
  });

  it('prefers persisted declined treasure counts over replay heuristics', () => {
    const game = createInitialGameState('t_opponent_may_pay_replay_recorded_treasure');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.applyEvent({
      type: 'opponentMayPayResolve',
      playerId: p1,
      decidingPlayer: p1,
      promptId: 'prompt_recorded_treasure',
      willPay: false,
      sourceName: 'Custom Cache Trigger',
      sourceController: p2,
      declineEffect: 'Do the unusual cache thing.',
      triggerText: 'Custom Cache Trigger resolves.',
      declineTreasureCount: 2,
    } as any);

    const treasures = ((game.state as any).battlefield || []).filter(
      (perm: any) => perm?.controller === p2 && perm?.card?.name === 'Treasure'
    );
    expect(treasures).toHaveLength(2);
  });
});