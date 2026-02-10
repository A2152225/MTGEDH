import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { createContext } from '../src/state/context';
import { processLinkedExileReturns } from '../src/state/modules/triggers/linked-exile';
import type { PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('playableFromExile lifecycle (server)', () => {
  it('consumes playableFromExile and strips tags when casting from exile', () => {
    const g = createInitialGameState('t_pfe_cast_consume');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // Minimal setup for castSpell.
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    const cardId = 'spell_exile_1';
    (g.state as any).playableFromExile = { [p1]: { [cardId]: 999 } };

    (g.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: cardId,
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            mana_cost: '{R}',
            zone: 'exile',
            canBePlayedBy: [p1],
            playableUntilTurn: 999,
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    g.applyEvent({ type: 'castSpell', playerId: p1, cardId, targets: [] });

    expect((g.state as any).playableFromExile?.[p1]?.[cardId]).toBeUndefined();

    const stackItem = (g.state as any).stack?.find((s: any) => s?.card?.id === cardId);
    expect(stackItem).toBeTruthy();
    expect(stackItem.card?.canBePlayedBy).toBeUndefined();
    expect(stackItem.card?.playableUntilTurn).toBeUndefined();
  });

  it('consumes legacy array-shaped playableFromExile when casting from exile', () => {
    const g = createInitialGameState('t_pfe_cast_consume_array');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // Minimal setup for castSpell.
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    const cardId = 'spell_exile_1';
    (g.state as any).playableFromExile = { [p1]: [cardId] };

    (g.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: cardId,
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            mana_cost: '{R}',
            zone: 'exile',
            canBePlayedBy: [p1],
            playableUntilTurn: 999,
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    g.applyEvent({ type: 'castSpell', playerId: p1, cardId, targets: [] });

    expect((g.state as any).playableFromExile?.[p1]).toEqual([]);

    const stackItem = (g.state as any).stack?.find((s: any) => s?.card?.id === cardId);
    expect(stackItem).toBeTruthy();
    expect(stackItem.card?.canBePlayedBy).toBeUndefined();
    expect(stackItem.card?.playableUntilTurn).toBeUndefined();
  });

  it('consumes playableFromExile and strips tags when playing land from exile', () => {
    const g = createInitialGameState('t_pfe_land_consume');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const cardId = 'land_exile_1';
    (g.state as any).playableFromExile = { [p1]: { [cardId]: 999 } };

    (g.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: cardId,
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '',
            zone: 'exile',
            canBePlayedBy: [p1],
            playableUntilTurn: 999,
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    g.applyEvent({ type: 'playLand', playerId: p1, cardId });

    expect((g.state as any).playableFromExile?.[p1]?.[cardId]).toBeUndefined();

    const perm = (g.state as any).battlefield?.find(
      (p: any) => p?.card?.id === cardId && p?.controller === p1
    );
    expect(perm).toBeTruthy();
    expect(perm.card?.canBePlayedBy).toBeUndefined();
    expect(perm.card?.playableUntilTurn).toBeUndefined();
  });

  it('consumes legacy array-shaped playableFromExile when playing land from exile', () => {
    const g = createInitialGameState('t_pfe_land_consume_array');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const cardId = 'land_exile_1';
    (g.state as any).playableFromExile = { [p1]: [cardId] };

    (g.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: cardId,
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '',
            zone: 'exile',
            canBePlayedBy: [p1],
            playableUntilTurn: 999,
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    g.applyEvent({ type: 'playLand', playerId: p1, cardId });

    expect((g.state as any).playableFromExile?.[p1]).toEqual([]);

    const perm = (g.state as any).battlefield?.find(
      (p: any) => p?.card?.id === cardId && p?.controller === p1
    );
    expect(perm).toBeTruthy();
    expect(perm.card?.canBePlayedBy).toBeUndefined();
    expect(perm.card?.playableUntilTurn).toBeUndefined();
  });

  it('prunes expired numeric entries on nextTurn', () => {
    const g = createInitialGameState('t_pfe_prune_next_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    // Force a known turn number so pruning is deterministic.
    (g.state as any).turnNumber = 5;
    (g.state as any).turn = 5;
    (g.state as any).turnPlayer = p1;

    (g.state as any).playableFromExile = {
      [p1]: {
        expired: 5,
        stillOk: 6,
        nonNumeric: 'forever',
      },
      // Array-shaped entry should be skipped (legacy format).
      [p2]: ['x', 'y'],
    };

    g.applyEvent({ type: 'nextTurn' }); // turnNumber increments to 6

    expect((g.state as any).turnNumber).toBe(6);
    expect((g.state as any).playableFromExile[p1].expired).toBeUndefined();
    expect((g.state as any).playableFromExile[p1].stillOk).toBe(6);
    expect((g.state as any).playableFromExile[p1].nonNumeric).toBe('forever');
    expect((g.state as any).playableFromExile[p2]).toEqual(['x', 'y']);
  });

  it('cleans up playableFromExile when a card leaves exile via linked-exile return', () => {
    const ctx = createContext('t_pfe_linked_exile_cleanup') as any;

    const p1 = 'p1' as PlayerID;
    const exilingPermanentId = 'perm_exiler_1';
    const cardId = 'exiled_1';

    const exiledCard: any = {
      id: cardId,
      name: 'Shock',
      type_line: 'Instant',
      oracle_text: 'Shock deals 2 damage to any target.',
      mana_cost: '{R}',
      zone: 'exile',
      canBePlayedBy: [p1],
      playableUntilTurn: 999,
    };

    (ctx.state as any).playableFromExile = { [p1]: { [cardId]: 999 } };
    (ctx.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [exiledCard],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };
    (ctx.state as any).battlefield = [];
    (ctx.state as any).linkedExiles = [
      {
        id: 'le_1',
        exilingPermanentId,
        exilingPermanentName: 'Oblivion Ring',
        exiledCardId: cardId,
        exiledCard,
        exiledCardName: exiledCard.name,
        originalOwner: p1,
        originalController: p1,
        returnCondition: 'ltb',
      },
    ];

    processLinkedExileReturns(ctx, exilingPermanentId);

    expect((ctx.state as any).playableFromExile?.[p1]?.[cardId]).toBeUndefined();
    expect((ctx.state as any).zones?.[p1]?.exile).toEqual([]);

    const perm = (ctx.state as any).battlefield?.find((p: any) => p?.card?.id === cardId);
    expect(perm).toBeTruthy();
    expect(perm.card?.canBePlayedBy).toBeUndefined();
    expect(perm.card?.playableUntilTurn).toBeUndefined();
  });
});
