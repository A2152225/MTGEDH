import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { createCopyTokensOfCard, createToken } from '../src/state/modules/counters_tokens.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('createToken live semantics', () => {
  it('does not give summoning sickness to noncreature tokens', () => {
    const game = createInitialGameState('t_create_token_live_noncreature');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    createToken(game as any, p1, 'Treasure', 1, undefined, undefined, {
      colors: [],
      typeLine: 'Token Artifact — Treasure',
      abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
      isArtifact: true,
    });

    const token = ((game.state as any).battlefield || []).find((perm: any) => perm?.card?.name === 'Treasure');
    expect(token).toBeTruthy();
    expect(token?.summoningSickness).toBe(false);
  });

  it('does not give summoning sickness to creature tokens with haste', () => {
    const game = createInitialGameState('t_create_token_live_haste');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    createToken(game as any, p1, 'Elemental', 1, 1, 1, {
      colors: ['R'],
      typeLine: 'Token Creature — Elemental',
      abilities: ['Haste'],
    });

    const token = ((game.state as any).battlefield || []).find((perm: any) => perm?.card?.name === 'Elemental');
    expect(token).toBeTruthy();
    expect(token?.summoningSickness).toBe(false);
  });

  it('keeps summoning sickness on copied creatures without haste and removes it for haste copies', () => {
    const game = createInitialGameState('t_create_copy_token_live_haste');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    createCopyTokensOfCard(game as any, p1, {
      id: 'bear_source',
      name: 'Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
      mana_cost: '{1}{G}',
    }, 1);

    createCopyTokensOfCard(game as any, p1, {
      id: 'phoenix_source',
      name: 'Phoenix',
      type_line: 'Creature — Phoenix',
      oracle_text: 'Flying, haste',
      keywords: ['Flying', 'Haste'],
      power: '2',
      toughness: '2',
      mana_cost: '{1}{R}',
    }, 1);

    const battlefield = (game.state as any).battlefield || [];
    const bearCopy = battlefield.find((perm: any) => perm?.card?.name === 'Bear');
    const phoenixCopy = battlefield.find((perm: any) => perm?.card?.name === 'Phoenix');

    expect(bearCopy?.summoningSickness).toBe(true);
    expect(phoenixCopy?.summoningSickness).toBe(false);
  });
});