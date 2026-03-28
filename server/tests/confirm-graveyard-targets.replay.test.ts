import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('confirmGraveyardTargets replay semantics', () => {
  it('replays graveyard-to-battlefield moves with the persisted permanent ids', () => {
    const game = createInitialGameState('t_confirm_graveyard_targets_replay_ids');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [
          {
            id: 'returned_card_1',
            name: 'Reassembling Skeleton',
            type_line: 'Creature — Skeleton Warrior',
            oracle_text: '{1}{B}: Return Reassembling Skeleton from your graveyard to the battlefield tapped.',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };

    game.applyEvent({
      type: 'confirmGraveyardTargets',
      playerId: p1,
      selectedCardIds: ['returned_card_1'],
      createdPermanentIds: ['returned_perm_1'],
      destination: 'battlefield',
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('returned_perm_1');
    expect(battlefield[0]?.card?.id).toBe('returned_card_1');
    expect((game.state as any).zones?.[p1]?.graveyardCount).toBe(0);
  });

  it('falls back to deterministic replay ids for legacy events without persisted permanent ids', () => {
    const game = createInitialGameState('t_confirm_graveyard_targets_replay_legacy_ids');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [
          {
            id: 'legacy_returned_card_1',
            name: 'Bloodsoaked Champion',
            type_line: 'Creature — Human Warrior',
            oracle_text: '{1}{B}: Return Bloodsoaked Champion from your graveyard to the battlefield.',
            power: '2',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };

    game.applyEvent({
      type: 'confirmGraveyardTargets',
      playerId: p1,
      selectedCardIds: ['legacy_returned_card_1'],
      destination: 'battlefield',
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).toContain('perm_legacy_returned_card_1');
    expect(battlefield[0]?.card?.id).toBe('legacy_returned_card_1');
  });
});