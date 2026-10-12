import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('mulligan completion replay semantics', () => {
  it('replays keepHand by preserving mulligan bookkeeping', () => {
    const game = createInitialGameState('t_keep_hand_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    (game.state as any).mulliganState = {
      [p1]: {
        hasKeptHand: false,
        mulligansTaken: 2,
        pendingBottomCount: 2,
        pendingBottomStepId: 'bottom_step_1',
      },
    };

    game.applyEvent({
      type: 'keepHand',
      playerId: p1,
      mulligansTaken: 2,
    } as any);

    expect((game.state as any).mulliganState?.[p1]).toEqual({
      hasKeptHand: true,
      mulligansTaken: 2,
      pendingBottomCount: 0,
      pendingBottomStepId: null,
    });
  });

  it('replays mulliganPutToBottom by moving cards and preserving final mulligan state', () => {
    const game = createInitialGameState('t_mulligan_put_to_bottom_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    game.importDeckResolved(p1, [
      { id: 'lib_1', name: 'Plains', type_line: 'Basic Land — Plains', zone: 'library' },
    ] as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'hand_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'hand' },
          { id: 'hand_2', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'hand' },
          { id: 'hand_3', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'hand' },
        ],
        handCount: 3,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 1,
      },
    };
    (game.state as any).mulliganState = {
      [p1]: {
        hasKeptHand: false,
        mulligansTaken: 2,
        pendingBottomCount: 2,
        pendingBottomStepId: 'bottom_step_2',
      },
    };

    game.applyEvent({
      type: 'mulliganPutToBottom',
      playerId: p1,
      cardIds: ['hand_2', 'hand_1'],
      mulligansTaken: 2,
    } as any);

    expect(((game.state as any).zones?.[p1]?.hand || []).map((card: any) => card.id)).toEqual(['hand_3']);
    expect((game.state as any).zones?.[p1]?.handCount).toBe(1);
    expect((game.state as any).zones?.[p1]?.libraryCount).toBe(3);
    expect(game.peekTopN(p1, 10).map((card: any) => card.id)).toEqual(['lib_1', 'hand_2', 'hand_1']);
    expect((game.state as any).mulliganState?.[p1]).toEqual({
      hasKeptHand: true,
      mulligansTaken: 2,
      pendingBottomCount: 0,
      pendingBottomStepId: null,
    });
  });

  it('replays a recorded mulligan redraw without keeping the previous hand or drawing a random extra seven', () => {
    const game = createInitialGameState('t_mulligan_recorded_redraw');
    const p1 = 'p1' as PlayerID;
    const deck = Array.from({ length: 21 }, (_, index) => ({
      id: `c${index + 1}`,
      name: `Card ${index + 1}`,
      type_line: 'Creature',
      zone: 'library',
    }));
    const opening = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    const firstRedraw = ['c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14'];
    const secondRedraw = ['c15', 'c16', 'c17', 'c18', 'c19', 'c20', 'c21'];

    game.replay!([
      { type: 'deckImportResolved', playerId: p1, cards: deck },
      { type: 'drawCards', playerId: p1, count: 7, drawnCardIds: opening },
      { type: 'drawCards', playerId: p1, count: 7, drawnCardIds: firstRedraw },
      { type: 'mulligan', playerId: p1, mulliganNumber: 1 },
      { type: 'drawCards', playerId: p1, count: 7, drawnCardIds: secondRedraw },
      { type: 'mulligan', playerId: p1, mulliganNumber: 2 },
      { type: 'mulliganPutToBottom', playerId: p1, cardIds: ['c15'], mulligansTaken: 2 },
    ] as any);

    expect(((game.state as any).zones?.[p1]?.hand || []).map((card: any) => card.id)).toEqual([
      'c16', 'c17', 'c18', 'c19', 'c20', 'c21',
    ]);
    expect((game.state as any).zones?.[p1]?.handCount).toBe(6);
  });
});

describe('cleanup discard replay step alignment', () => {
  it('draws the recorded draw-step card when cleanupDiscard is its own event', () => {
    const game = createInitialGameState('t_cleanup_draw_align');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const library = [
      { id: 'library_top', name: 'Library Top', type_line: 'Creature — Human', zone: 'library' },
      { id: 'real_draw', name: 'Real Draw', type_line: 'Creature — Human', zone: 'library' },
    ];
    game.importDeckResolved(p1, [
      ...library,
      { id: 'keep', name: 'Keep', type_line: 'Creature — Human', zone: 'library' },
      { id: 'discard_me', name: 'Discard Me', type_line: 'Creature — Human', zone: 'library' },
    ] as any);

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      { id: 'keep', name: 'Keep', type_line: 'Creature — Human', zone: 'hand' },
      { id: 'discard_me', name: 'Discard Me', type_line: 'Creature — Human', zone: 'hand' },
    ];
    zones.handCount = 2;
    zones.library = library;
    zones.libraryCount = library.length;
    (game as any).libraries.set(p1, library.map((card) => ({ ...card })));
    (game.state as any).phase = 'ending';
    (game.state as any).step = 'END';
    (game.state as any).turnPlayer = p1;
    (game.state as any).turnNumber = 1;
    (game.state as any).activePlayer = p1;

    game.replay!([
      { type: 'nextStep', reason: 'allPlayersPassed' },
      { type: 'cleanupDiscard', playerId: p1, cardIds: ['discard_me'] },
      { type: 'nextStep', reason: 'cleanupDiscardResolved' },
      { type: 'nextStep', reason: 'autoPassAdvance' },
      { type: 'nextStep', reason: 'allPlayersPassed', drawnCardIds: ['real_draw'] },
    ] as any);

    const handIds = ((game.state as any).zones?.[p1]?.hand || []).map((card: any) => card.id);
    expect(handIds).toContain('keep');
    expect(handIds).toContain('real_draw');
    expect(handIds).not.toContain('discard_me');
    expect(handIds).not.toContain('library_top');
    expect(String((game.state as any).step || '').toUpperCase()).toBe('DRAW');
  });
});