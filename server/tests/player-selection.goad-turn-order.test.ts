import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { applyPlayerSelectionEffect } from '../src/socket/player-selection.js';
import { getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

function createMockIo() {
  return {
    to: () => ({ emit: () => undefined }),
    emit: () => undefined,
  } as any;
}

describe('player selection goad turn-order semantics', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete('test_player_selection_goad_turn_order' as any);
    games.delete('test_player_selection_goad_turn_order_extra' as any);
  });

  it('sets goad expiry to the choosing player\'s next turn in multiplayer order', () => {
    const gameId = 'test_player_selection_goad_turn_order';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
      { id: 'p4', name: 'P4', spectator: false, life: 40 },
    ];
    (game.state as any).turnOrder = ['p1', 'p2', 'p3', 'p4'];
    (game.state as any).turnPlayer = 'p1';
    (game.state as any).turnDirection = 1;
    (game.state as any).turnNumber = 5;
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'creature_1',
          name: 'Test Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    applyPlayerSelectionEffect(
      createMockIo(),
      gameId,
      'p1' as any,
      'p2' as any,
      'Control Changer',
      {
        type: 'control_change',
        permanentId: 'perm_1',
        goadsOnChange: true,
      },
    );

    const permanent = (game.state as any).battlefield[0];
    expect(permanent.controller).toBe('p2');
    expect(permanent.goadedBy).toContain('p1');
    expect(permanent.goadedUntil?.p1).toBe(9);
  });

  it('respects queued extra turns when setting goad expiry', () => {
    const gameId = 'test_player_selection_goad_turn_order_extra';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).turnOrder = ['p1', 'p2', 'p3'];
    (game.state as any).turnPlayer = 'p1';
    (game.state as any).turnDirection = 1;
    (game.state as any).turnNumber = 5;
    (game.state as any).extraTurns = [
      { playerId: 'p1', afterTurnNumber: 5, source: 'Time Warp', createdAt: 0 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'perm_2',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'creature_2',
          name: 'Test Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    applyPlayerSelectionEffect(
      createMockIo(),
      gameId,
      'p1' as any,
      'p2' as any,
      'Control Changer',
      {
        type: 'control_change',
        permanentId: 'perm_2',
        goadsOnChange: true,
      },
    );

    const permanent = (game.state as any).battlefield[0];
    expect(permanent.goadedUntil?.p1).toBe(6);
  });

  it('replays persisted control-change player selection state', () => {
    const gameId = 'test_player_selection_goad_turn_order';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
      { id: 'p4', name: 'P4', spectator: false, life: 40 },
    ];
    (game.state as any).turnOrder = ['p1', 'p2', 'p3', 'p4'];
    (game.state as any).turnPlayer = 'p1';
    (game.state as any).turnDirection = 1;
    (game.state as any).turnNumber = 5;
    (game.state as any).zones = {
      p1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    game.importDeckResolved('p1' as any, [
      {
        id: 'draw_1',
        name: 'Drawn Card',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'library',
      },
    ] as any);
    (game.state as any).zones.p1.hand = [];
    (game.state as any).zones.p1.handCount = 0;
    (game.state as any).battlefield = [
      {
        id: 'perm_3',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'creature_3',
          name: 'Replay Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    applyPlayerSelectionEffect(
      createMockIo(),
      gameId,
      'p1' as any,
      'p2' as any,
      'Control Changer',
      {
        type: 'control_change',
        permanentId: 'perm_3',
        goadsOnChange: true,
        mustAttackEachCombat: true,
        cantAttackOwner: true,
        drawCards: 1,
      },
    );

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'playerSelection') as any;
    expect(persisted).toBeDefined();
    expect(persisted.payload?.goadExpiryTurn).toBe(9);
    expect(persisted.payload?.effectData?.drawCards).toBe(1);

    const replayGame = createInitialGameState('test_player_selection_goad_turn_order_replay');

    (replayGame.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
      { id: 'p4', name: 'P4', spectator: false, life: 40 },
    ];
    (replayGame.state as any).turnOrder = ['p1', 'p2', 'p3', 'p4'];
    (replayGame.state as any).turnPlayer = 'p1';
    (replayGame.state as any).turnDirection = 1;
    (replayGame.state as any).turnNumber = 5;
    (replayGame.state as any).zones = {
      p1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    replayGame.importDeckResolved('p1' as any, [
      {
        id: 'draw_1',
        name: 'Drawn Card',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'library',
      },
    ] as any);
    (replayGame.state as any).zones.p1.hand = [];
    (replayGame.state as any).zones.p1.handCount = 0;
    (replayGame.state as any).battlefield = [
      {
        id: 'perm_3',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'creature_3',
          name: 'Replay Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    replayGame.applyEvent({
      type: 'playerSelection',
      ...((persisted as any).payload || {}),
    });

    const replayPermanent = (replayGame.state as any).battlefield[0];
    expect(replayPermanent.controller).toBe('p2');
    expect(replayPermanent.mustAttackEachCombat).toBe(true);
    expect(replayPermanent.cantAttackOwner).toBe(true);
    expect(replayPermanent.ownerId).toBe('p1');
    expect(replayPermanent.goadedBy).toContain('p1');
    expect(replayPermanent.goadedUntil?.p1).toBe(9);
    expect((replayGame.state as any).zones?.p1?.hand?.map((card: any) => card.id)).toEqual(['draw_1']);
  });

  it('replays persisted chosen-player selection state', () => {
    const game = createInitialGameState('test_player_selection_choice_replay');

    (game.state as any).battlefield = [
      {
        id: 'perm_4',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'artifact_4',
          name: 'Stuffy Doll',
          type_line: 'Artifact Creature — Construct',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'playerSelection',
      choosingPlayerId: 'p1',
      selectedPlayerId: 'p3',
      cardName: 'Stuffy Doll',
      effectType: 'set_chosen_player',
      permanentId: 'perm_4',
      effectData: {
        type: 'set_chosen_player',
        permanentId: 'perm_4',
      },
      wasTimeout: false,
    } as any);

    expect(((game.state as any).battlefield[0] as any).chosenPlayer).toBe('p3');
  });
});