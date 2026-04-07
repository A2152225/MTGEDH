import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('creatureTypeSelected replay semantics', () => {
  it('replays chosen creature type onto the selected permanent', () => {
    const game = createInitialGameState('t_creature_type_selected_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'cavern_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'cavern_card_1',
          name: 'Cavern of Souls',
          type_line: 'Land',
        },
      },
    ];

    game.applyEvent({
      type: 'creatureTypeSelected',
      playerId: p1,
      permanentId: 'cavern_1',
      creatureType: 'Wizard',
      cardName: 'Cavern of Souls',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenCreatureType).toBe('Wizard');
  });

  it('replays Morophon mirror state used by live selection handling', () => {
    const game = createInitialGameState('t_creature_type_selected_morophon_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'morophon_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'morophon_card_1',
          name: 'Morophon, the Boundless',
          type_line: 'Legendary Creature — Shapeshifter',
        },
      },
    ];

    game.applyEvent({
      type: 'creatureTypeSelected',
      playerId: p1,
      permanentId: 'morophon_1',
      creatureType: 'Dragon',
      cardName: 'Morophon, the Boundless',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenCreatureType).toBe('Dragon');
    expect((game.state as any).morophonChosenType).toEqual({ morophon_1: 'Dragon' });
  });

  it('falls back to player and card name when replay cannot reconstruct the original permanent id', () => {
    const game = createInitialGameState('t_creature_type_selected_replay_fallback');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'kindred_replay_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'kindred_card_1',
          name: 'Kindred Discovery',
          type_line: 'Enchantment',
        },
      },
    ];

    game.applyEvent({
      type: 'creatureTypeSelected',
      playerId: p1,
      permanentId: 'kindred_live_random_id',
      creatureType: 'Merfolk',
      cardName: 'Kindred Discovery',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenCreatureType).toBe('Merfolk');
    expect((game.state as any).replayPermanentAliases).toEqual({
      kindred_live_random_id: 'kindred_replay_1',
    });
  });
});