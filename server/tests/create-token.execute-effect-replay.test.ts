import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('executeEffect createToken replay semantics', () => {
  it('does not give summoning sickness to noncreature tokens during replay', () => {
    const game = createInitialGameState('t_create_token_noncreature_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: p1,
      tokenData: {
        id: 'treasure_token_1',
        name: 'Treasure',
        typeLine: 'Artifact Token',
        power: 0,
        toughness: 0,
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
      },
    });

    const token = (game.state as any).battlefield?.find((perm: any) => perm?.id === 'treasure_token_1');
    expect(token).toBeTruthy();
    expect(token?.summoningSickness).toBe(false);
  });

  it('keeps summoning sickness on replayed creature tokens without haste', () => {
    const game = createInitialGameState('t_create_token_creature_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: p1,
      tokenData: {
        id: 'bear_token_1',
        name: 'Bear',
        typeLine: 'Token Creature — Bear',
        power: 2,
        toughness: 2,
        abilities: [],
      },
    });

    const token = (game.state as any).battlefield?.find((perm: any) => perm?.id === 'bear_token_1');
    expect(token).toBeTruthy();
    expect(token?.summoningSickness).toBe(true);
  });

  it('does not give summoning sickness to replayed creature tokens with haste', () => {
    const game = createInitialGameState('t_create_token_haste_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: p1,
      tokenData: {
        id: 'haste_token_1',
        name: 'Elemental',
        typeLine: 'Token Creature — Elemental',
        power: 1,
        toughness: 1,
        abilities: ['haste'],
        hasHaste: true,
      },
    });

    const token = (game.state as any).battlefield?.find((perm: any) => perm?.id === 'haste_token_1');
    expect(token).toBeTruthy();
    expect(token?.summoningSickness).toBe(false);
    expect(token?.grantedAbilities).toEqual(['haste']);
  });

  it('restores Helm copy haste badges from older createToken events that only stored keywords', () => {
    const game = createInitialGameState('t_helm_copy_haste_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: p1,
      tokenData: {
        id: 'token-copy-scorpion',
        name: 'The Scorpion God',
        typeLine: 'Creature — God',
        power: 6,
        toughness: 5,
        colors: ['B', 'R'],
        abilities: ['haste'],
        hasHaste: true,
        isCopyToken: true,
        copiedFromPermanentId: 'scorpion',
        oracleText: 'When The Scorpion God dies, return it to its owner\'s hand.\nhaste',
      },
    });

    const token = (game.state as any).battlefield?.find((perm: any) => perm?.id === 'token-copy-scorpion');
    expect(token?.summoningSickness).toBe(false);
    expect(token?.grantedAbilities).toEqual(['haste']);
    expect(token?.card?.keywords).toEqual(['haste']);
  });
});