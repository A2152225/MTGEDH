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

  it('strips hand ghosts when effectProgramZoneMove BF-enters from snapshot (undo splice miss)', () => {
    const game = createInitialGameState('t_effect_program_zone_move_dual_zone');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = {
      id: 'sphere_1',
      name: "Commander's Sphere",
      type_line: 'Artifact',
      mana_cost: '{3}',
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [{ ...card, zone: 'hand' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game.state as any).battlefield = [];

    // Simulate undo/replay where cardId no longer matches the hand entry id prefix,
    // so source splice misses and only the card snapshot is available.
    game.applyEvent({
      type: 'effectProgramZoneMove',
      playerId: p1,
      fromPlayerId: p1,
      cardId: 'sphere_MISSING',
      fromZone: 'hand',
      toZone: 'battlefield',
      permanentId: 'perm_sphere_1',
      card,
      effectProgramMutation: true,
    } as any);

    expect((game.state as any).battlefield.map((perm: any) => perm.card?.id)).toEqual(['sphere_1']);
    expect((game.state as any).zones[p1].hand).toEqual([]);
    expect((game.state as any).zones[p1].handCount).toBe(0);
  });

  it('strips hand ghosts when effectProgramZoneMove enters graveyard from snapshot', () => {
    const game = createInitialGameState('t_effect_program_zone_move_gy_dual');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = {
      id: 'delta_gy',
      name: 'Polluted Delta',
      type_line: 'Land',
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [{ ...card, zone: 'hand' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    game.applyEvent({
      type: 'effectProgramZoneMove',
      playerId: p1,
      fromPlayerId: p1,
      cardId: 'delta_MISSING',
      fromZone: 'hand',
      toZone: 'graveyard',
      card,
      effectProgramMutation: true,
    } as any);

    expect((game.state as any).zones[p1].graveyard.map((entry: any) => entry.id)).toEqual(['delta_gy']);
    expect((game.state as any).zones[p1].hand).toEqual([]);
    expect((game.state as any).zones[p1].handCount).toBe(0);
  });

  it('strips hand ghosts for putCardFromHandOntoBattlefield snapshot fallback', () => {
    const game = createInitialGameState('t_put_from_hand_dual_zone');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const card = {
      id: 'sphere_2',
      name: "Commander's Sphere",
      type_line: 'Artifact',
      mana_cost: '{3}',
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [{ ...card, zone: 'hand' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'putCardFromHandOntoBattlefield',
      playerId: p1,
      cardId: 'sphere_MISSING',
      permanentId: 'perm_sphere_2',
      card,
    } as any);

    expect((game.state as any).battlefield.map((perm: any) => perm.card?.id)).toEqual(['sphere_2']);
    expect((game.state as any).zones[p1].hand).toEqual([]);
    expect((game.state as any).zones[p1].handCount).toBe(0);
  });
});
