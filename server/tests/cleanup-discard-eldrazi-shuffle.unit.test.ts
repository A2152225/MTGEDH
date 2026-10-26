import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';

const KOZILEK_ORACLE = 'When Kozilek, Butcher of Truth is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.';

describe('cleanup discard and Eldrazi graveyard shuffle', () => {
  it('shuffles every card discarded at the same time, even when Kozilek is first', () => {
    const g = createInitialGameState('t_kozilek_cleanup_discard');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const zones = (g.state as any).zones[p1];
    zones.hand = [
      { id: 'kozilek', name: 'Kozilek, Butcher of Truth', type_line: 'Legendary Creature — Eldrazi', oracle_text: KOZILEK_ORACLE },
      { id: 'other', name: 'Starstorm', type_line: 'Instant', oracle_text: '' },
    ];
    zones.handCount = 2;
    zones.graveyard = [{ id: 'already', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '' }];
    zones.graveyardCount = 1;
    g.libraries.set(p1, [{ id: 'lib1', name: 'Forest', type_line: 'Basic Land — Forest' } as any]);

    g.applyEvent({ type: 'cleanupDiscard', playerId: p1, cardIds: ['kozilek', 'other'] } as any);

    const graveyard = (g.state as any).zones[p1].graveyard as any[];
    const library = g.libraries.get(p1) || [];
    const libraryIds = library.map((card: any) => card.id);

    expect(graveyard).toEqual([]);
    expect((g.state as any).zones[p1].graveyardCount).toBe(0);
    expect(libraryIds).toEqual(expect.arrayContaining(['lib1', 'kozilek', 'other', 'already']));
    expect(libraryIds).toHaveLength(4);
    expect((g.state as any).zones[p1].hand.map((card: any) => card.id)).toEqual([]);
  });

  it('replay of a destroy zone move removes the creature and ceases tokens', () => {
    const g = createInitialGameState('t_destroy_zone_move_replay');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    (g.state as any).battlefield = [
      {
        id: 'mogg_perm',
        controller: p1,
        owner: p1,
        card: { id: 'mogg_card', name: 'Mogg Maniac', type_line: 'Creature — Goblin' },
      },
      {
        id: 'goblin_token',
        controller: p1,
        owner: p1,
        isToken: true,
        card: { id: 'goblin_token', name: 'Goblin', type_line: 'Creature — Goblin', isToken: true },
      },
    ];
    (g.state as any).zones[p1].graveyard = [];
    (g.state as any).zones[p1].graveyardCount = 0;

    g.applyEvent({
      type: 'effectProgramZoneMove',
      playerId: p1,
      fromPlayerId: p1,
      cardId: 'mogg_card',
      fromZone: 'battlefield',
      toZone: 'graveyard',
      fromPermanentId: 'mogg_perm',
      skipGraveyardEntryTriggers: true,
      card: { id: 'mogg_card', name: 'Mogg Maniac', type_line: 'Creature — Goblin', zone: 'graveyard' },
    } as any);
    g.applyEvent({
      type: 'effectProgramZoneMove',
      playerId: p1,
      fromPlayerId: p1,
      cardId: 'goblin_token',
      fromZone: 'battlefield',
      toZone: 'graveyard',
      fromPermanentId: 'goblin_token',
      skipGraveyardEntryTriggers: true,
      card: { id: 'goblin_token', name: 'Goblin', type_line: 'Creature — Goblin', isToken: true, zone: 'graveyard' },
    } as any);

    expect((g.state as any).battlefield.map((perm: any) => perm.id)).toEqual([]);
    const graveyard = (g.state as any).zones[p1].graveyard as any[];
    expect(graveyard.map((card: any) => card.id)).toEqual(['mogg_card']);
  });

  it('replays a legacy controller-null destroy patch by moving the card to the graveyard', () => {
    const g = createInitialGameState('t_legacy_null_controller_patch');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    (g.state as any).battlefield = [{
      id: 'mogg_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      card: { id: 'mogg_card', name: 'Mogg Maniac', type_line: 'Creature — Goblin' },
    }];
    (g.state as any).zones[p1].graveyard = [];

    g.applyEvent({
      type: 'battlefieldPermanentPatch',
      permanentId: 'mogg_perm',
      patch: { controller: null, tapped: null, summoningSickness: null },
      oracleIrReplayMutation: true,
    } as any);

    expect((g.state as any).battlefield).toEqual([]);
    expect((g.state as any).zones[p1].graveyard.map((card: any) => card.name)).toEqual(['Mogg Maniac']);
  });
});
