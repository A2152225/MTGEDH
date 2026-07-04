import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function setupLibrary(game: any, playerId: PlayerID, cardIds: string[]) {
  const cards = cardIds.map((id, index) => ({
    id,
    name: `Card ${index + 1}`,
    type_line: 'Instant',
    zone: 'library',
  }));
  game.libraries.set(playerId, cards);
  (game.state as any).zones = (game.state as any).zones || {};
  (game.state as any).zones[playerId] = {
    ...(game.state as any).zones[playerId],
    libraryCount: cards.length,
    graveyard: [],
    graveyardCount: 0,
    hand: [],
    handCount: 0,
  };
}

describe('effect program zone mutation replay', () => {
  it('replays mill events emitted from effect-program persistence', () => {
    const game = createInitialGameState('t_effect_program_mill_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    setupLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3']);

    game.applyEvent({
      type: 'mill',
      playerId: p2,
      count: 2,
      effectProgramMutation: true,
    } as any);

    expect(game.libraries.get(p2)?.map((card: any) => card.id)).toEqual(['mill-3']);
    expect((game.state as any).zones[p2].graveyard.map((card: any) => card.id)).toEqual(['mill-1', 'mill-2']);
  });

  it('replays createToken executeEffect events idempotently', () => {
    const game = createInitialGameState('t_effect_program_token_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const tokenEvent = {
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: p1,
      tokenData: {
        id: 'token_replay_1',
        name: 'Soldier',
        typeLine: 'Creature — Soldier',
        power: 1,
        toughness: 1,
        colors: ['W'],
        abilities: [],
        hasHaste: false,
      },
      effectProgramMutation: true,
    };

    game.applyEvent(tokenEvent as any);
    game.applyEvent(tokenEvent as any);

    const tokens = (game.state as any).battlefield.filter((perm: any) => perm?.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.id).toBe('token_replay_1');
    expect(tokens[0]?.controller).toBe(p1);
  });

  it('replays effectProgramZoneMove for graveyard to hand returns', () => {
    const game = createInitialGameState('t_effect_program_zone_move_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = { id: 'gy-1', name: 'Recovered Spell', type_line: 'Sorcery' };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [{ ...card, zone: 'graveyard' }],
        graveyardCount: 1,
      },
    };

    game.applyEvent({
      type: 'effectProgramZoneMove',
      playerId: p1,
      fromPlayerId: p1,
      cardId: 'gy-1',
      fromZone: 'graveyard',
      toZone: 'hand',
      card,
      effectProgramMutation: true,
    } as any);

    expect((game.state as any).zones[p1].hand.map((entry: any) => entry.id)).toEqual(['gy-1']);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(0);
  });
});
