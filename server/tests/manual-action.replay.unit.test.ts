import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyManualAction } from '../src/state/modules/manualActionApply.js';
import type { PlayerID } from '../../shared/src';

function seedTwoCardLibrary(game: any, playerId: PlayerID) {
  const cards = [
    { id: 'island_1', name: 'Island', type_line: 'Basic Land — Island' },
    { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
  ];
  game.libraries.set(playerId, cards);
  game.state.zones = game.state.zones || {};
  game.state.zones[playerId] = {
    ...(game.state.zones[playerId] || {}),
    hand: [],
    handCount: 0,
    library: cards,
    libraryCount: 2,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

describe('manualAction replay', () => {
  it('draws, records card ids, and replays the same cards into hand', () => {
    const live = createInitialGameState('t_manual_draw_live');
    const p1 = 'p1' as PlayerID;
    live.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    seedTwoCardLibrary(live, p1);

    const payload: any = { verb: 'draw_x', actorId: p1, targetPlayerId: p1, count: 1 };
    const result = applyManualAction((live as any).ctx || live, payload);
    expect(result.ok).toBe(true);
    expect(payload.drawnCardIds).toEqual(['island_1']);
    expect((live.state.zones as any)[p1].hand.map((c: any) => c.id)).toEqual(['island_1']);
    expect(((live as any).libraries.get(p1) || []).map((c: any) => c.id)).toEqual(['forest_1']);

    const replay = createInitialGameState('t_manual_draw_replay');
    replay.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    seedTwoCardLibrary(replay, p1);
    replay.applyEvent({ type: 'manualAction', ...payload });
    expect((replay.state.zones as any)[p1].hand.map((c: any) => c.id)).toEqual(['island_1']);
    expect(((replay as any).libraries.get(p1) || []).map((c: any) => c.id)).toEqual(['forest_1']);
  });

  it('moves a battlefield permanent to the graveyard and replays the same move', () => {
    const live = createInitialGameState('t_manual_destroy_live');
    const p1 = 'p1' as PlayerID;
    live.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    live.state.battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ] as any;

    const payload: any = {
      verb: 'destroy',
      actorId: p1,
      objectIds: ['bear_1'],
    };
    const result = applyManualAction((live as any).ctx || live, payload);
    expect(result.ok).toBe(true);
    expect(live.state.battlefield).toHaveLength(0);
    expect((live.state.zones as any)[p1].graveyard.map((c: any) => c.name)).toEqual(['Grizzly Bears']);

    const replay = createInitialGameState('t_manual_destroy_replay');
    replay.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    replay.state.battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ] as any;
    replay.applyEvent({ type: 'manualAction', ...payload });
    expect(replay.state.battlefield).toHaveLength(0);
    expect((replay.state.zones as any)[p1].graveyard.map((c: any) => c.name)).toEqual(['Grizzly Bears']);
  });

  it('adjusts life and taps, then replays both events', () => {
    const live = createInitialGameState('t_manual_life_tap_live');
    const p1 = 'p1' as PlayerID;
    live.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    live.state.life = { [p1]: 40 } as any;
    live.state.battlefield = [
      {
        id: 'sol_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'sol_card', name: 'Sol Ring', type_line: 'Artifact' },
      },
    ] as any;

    applyManualAction((live as any).ctx || live, {
      verb: 'gain_lose_life',
      actorId: p1,
      targetPlayerId: p1,
      amount: -7,
    } as any);
    applyManualAction((live as any).ctx || live, {
      verb: 'tap_untap',
      actorId: p1,
      objectIds: ['sol_1'],
      tapped: true,
    } as any);
    expect((live.state.life as any)[p1]).toBe(33);
    expect((live.state.battlefield as any)[0].tapped).toBe(true);

    const replay = createInitialGameState('t_manual_life_tap_replay');
    replay.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    replay.state.life = { [p1]: 40 } as any;
    replay.state.battlefield = [
      {
        id: 'sol_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'sol_card', name: 'Sol Ring', type_line: 'Artifact' },
      },
    ] as any;
    replay.applyEvent({
      type: 'manualAction',
      verb: 'gain_lose_life',
      actorId: p1,
      targetPlayerId: p1,
      amount: -7,
    } as any);
    replay.applyEvent({
      type: 'manualAction',
      verb: 'tap_untap',
      actorId: p1,
      objectIds: ['sol_1'],
      tapped: true,
    } as any);
    expect((replay.state.life as any)[p1]).toBe(33);
    expect((replay.state.battlefield as any)[0].tapped).toBe(true);
  });

  it('marks nonlethal creature damage, then a later hit that reaches toughness goes to the graveyard', () => {
    const live = createInitialGameState('t_manual_dmg_live');
    const p1 = 'p1' as PlayerID;
    live.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    live.state.battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        basePower: 5,
        baseToughness: 5,
        card: { id: 'bear_card', name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '5', toughness: '5' },
      },
    ] as any;

    const lash: any = { verb: 'deal_damage', actorId: p1, objectIds: ['bear_1'], amount: 4 };
    const lashResult = applyManualAction((live as any).ctx || live, lash);
    expect(lashResult.ok).toBe(true);
    expect(live.state.battlefield).toHaveLength(1);
    expect((live.state.battlefield as any)[0].damageMarked).toBe(4);

    const bolt: any = { verb: 'deal_damage', actorId: p1, objectIds: ['bear_1'], amount: 3 };
    const boltResult = applyManualAction((live as any).ctx || live, bolt);
    expect(boltResult.ok).toBe(true);
    expect(live.state.battlefield).toHaveLength(0);
    expect((live.state.zones as any)[p1].graveyard.map((c: any) => c.name)).toEqual(['Craw Wurm']);

    const replay = createInitialGameState('t_manual_dmg_replay');
    replay.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    replay.state.battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        basePower: 5,
        baseToughness: 5,
        card: { id: 'bear_card', name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '5', toughness: '5' },
      },
    ] as any;
    replay.applyEvent({ type: 'manualAction', ...lash });
    expect(replay.state.battlefield).toHaveLength(1);
    expect((replay.state.battlefield as any)[0].damageMarked).toBe(4);
    replay.applyEvent({ type: 'manualAction', ...bolt });
    expect(replay.state.battlefield).toHaveLength(0);
    expect((replay.state.zones as any)[p1].graveyard.map((c: any) => c.name)).toEqual(['Craw Wurm']);
  });
});
