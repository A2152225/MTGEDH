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

  it('replays owner-routed graveyard-to-library moves to the selected card owner\'s library', () => {
    const game = createInitialGameState('t_confirm_graveyard_targets_owner_library');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: [{ id: 'p1_lib_1', name: 'P1 Top', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        library: [{ id: 'p2_lib_1', name: 'P2 Top', type_line: 'Instant', zone: 'library' }],
        libraryCount: 1,
        graveyard: [
          {
            id: 'opp_target_1',
            name: 'Target Card',
            type_line: 'Sorcery',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      [p1, [{ id: 'p1_lib_1', name: 'P1 Top', type_line: 'Artifact', zone: 'library' }]],
      [p2, [{ id: 'p2_lib_1', name: 'P2 Top', type_line: 'Instant', zone: 'library' }]],
    ]);

    game.applyEvent({
      type: 'confirmGraveyardTargets',
      playerId: p1,
      targetPlayerId: p2,
      selectedCardIds: ['opp_target_1'],
      destination: 'library_top',
      destinationUsesSelectedCardOwner: true,
    } as any);

    expect((game.state as any).zones?.[p2]?.graveyardCount).toBe(0);
    const p2Library = (game as any).libraries.get(p2) || [];
    expect(p2Library.map((card: any) => card.id)).toEqual(['opp_target_1', 'p2_lib_1']);
    const p1Library = (game as any).libraries.get(p1) || [];
    expect(p1Library.map((card: any) => card.id)).toEqual(['p1_lib_1']);
  });

  it('replays battlefield-entry modifiers for face-down and suspected graveyard returns', () => {
    const game = createInitialGameState('t_confirm_graveyard_targets_face_down_suspected');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [
          {
            id: 'modded_return_card_1',
            name: 'Ashcloud Phoenix',
            type_line: 'Creature - Phoenix',
            oracle_text: 'Flying',
            power: '4',
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
      selectedCardIds: ['modded_return_card_1'],
      createdPermanentIds: ['modded_return_perm_1'],
      destination: 'battlefield',
      battlefieldTapped: true,
      battlefieldCounters: { finality: 1 },
      battlefieldFaceDown: true,
      battlefieldSuspected: true,
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]).toMatchObject({
      id: 'modded_return_perm_1',
      tapped: true,
      counters: { finality: 1 },
      isFaceDown: true,
      faceDownType: 'effect',
      suspected: true,
      isSuspected: true,
      card: {
        name: 'Face-down Creature',
        suspected: true,
        isSuspected: true,
      },
      faceUpCard: {
        id: 'modded_return_card_1',
      },
    });
    expect((game.state as any).zones?.[p1]?.graveyardCount).toBe(0);
  });

  it('replays face-down graveyard returns that immediately turn face up', () => {
    const game = createInitialGameState('t_confirm_graveyard_targets_face_down_turn_up');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [
          {
            id: 'turned_up_return_card_1',
            name: 'Hidden Meadow',
            type_line: 'Land',
            oracle_text: '',
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
      selectedCardIds: ['turned_up_return_card_1'],
      createdPermanentIds: ['turned_up_return_perm_1'],
      destination: 'battlefield',
      battlefieldFaceDown: true,
      battlefieldTurnFaceUp: true,
      battlefieldControllerMode: 'owner',
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]).toMatchObject({
      id: 'turned_up_return_perm_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'turned_up_return_card_1',
        name: 'Hidden Meadow',
        type_line: 'Land',
      },
    });
    expect(battlefield[0]?.isFaceDown).not.toBe(true);
    expect(battlefield[0]?.faceUpCard).toBeUndefined();
    expect((game.state as any).zones?.[p1]?.graveyardCount).toBe(0);
  });
});