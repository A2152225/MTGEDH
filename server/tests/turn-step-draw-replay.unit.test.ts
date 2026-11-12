import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

describe('draw-step replay uses persisted card ids', () => {
  it('draws the recorded ids even when a dual-zone ghost sits on top of the library', () => {
    const game = createInitialGameState('draw_step_by_id');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ghost = { id: 'already_on_bf', name: 'Worn Powerstone', type_line: 'Artifact' };
    const real = { id: 'real_draw', name: 'Lightning Bolt', type_line: 'Instant' };
    const other = { id: 'other', name: 'Mountain', type_line: 'Basic Land — Mountain' };
    (game as any).libraries.set(p1, [{ ...ghost }, { ...real }, { ...other }]);
    game.state.zones = game.state.zones || {};
    game.state.zones[p1] = {
      hand: [],
      handCount: 0,
      libraryCount: 3,
      graveyard: [],
      graveyardCount: 0,
    } as any;
    (game.state as any).turnPlayer = p1;
    (game.state as any).turnNumber = 2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).battlefield = [{
      id: 'perm_ghost',
      controller: p1,
      owner: p1,
      card: { ...ghost, zone: 'battlefield' },
    }];
    (game as any).isReplaying = true;

    game.applyEvent({ type: 'nextStep', drawnCardIds: ['real_draw'] } as any);

    expect((game.state.zones[p1].hand || []).map((card: any) => card.id)).toEqual(['real_draw']);
    const lib = (game as any).libraries.get(p1) || [];
    expect(lib.map((card: any) => card.id)).toEqual(['already_on_bf', 'other']);
  });

  it('replays Kami-style two-card draw ids (base + additional) without grabbing library top', () => {
    const game = createInitialGameState('draw_step_kami_two_ids');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const plains = { id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains' };
    const cube = { id: 'cube_1', name: 'Class-4 Tactical Cube', type_line: 'Artifact' };
    const bauble = { id: 'bauble_1', name: "Wayfarer's Bauble", type_line: 'Artifact' };
    const topTrap = { id: 'trap_top', name: 'Should Not Draw', type_line: 'Instant' };

    // Plains already in hand before draw; cube+bauble mid-library; trap on top.
    (game as any).libraries.set(p1, [{ ...topTrap }, { ...cube }, { ...bauble }]);
    game.state.zones = game.state.zones || {};
    game.state.zones[p1] = {
      hand: [{ ...plains }],
      handCount: 1,
      libraryCount: 3,
      graveyard: [],
      graveyardCount: 0,
    } as any;
    (game.state as any).turnPlayer = p1;
    (game.state as any).turnNumber = 2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game as any).additionalDrawsPerTurn = { [p1]: 1 };
    (game.state as any).additionalDrawsPerTurn = { [p1]: 1 };
    (game.state as any).battlefield = [{
      id: 'kami_1',
      controller: 'p2',
      owner: 'p2',
      card: {
        name: 'Kami of the Crescent Moon',
        type_line: 'Legendary Creature — Spirit',
        oracle_text: "At the beginning of each player's draw step, that player draws an additional card.",
      },
    }];

    // Live-equivalent: persist the two drawn ids, then a follow-up action, then undo it.
    const events = [
      { type: 'nextStep', drawnCardIds: ['cube_1', 'bauble_1'] },
      { type: 'nextStep' },
    ];
    game.replay!(events as any);

    expect((game.state.zones[p1].hand || []).map((c: any) => c.id).sort()).toEqual(
      ['bauble_1', 'cube_1', 'plains_1'],
    );
    expect((game.state.zones[p1].hand || []).map((c: any) => c.name)).not.toContain('Should Not Draw');

    // Undo the MAIN1 advance: hand must still be plains + the same two draw-step cards.
    game.reset!(true);
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game as any).libraries.set(p1, [{ ...topTrap }, { ...cube }, { ...bauble }]);
    game.state.zones = game.state.zones || {};
    game.state.zones[p1] = {
      hand: [{ ...plains }],
      handCount: 1,
      libraryCount: 3,
      graveyard: [],
      graveyardCount: 0,
    } as any;
    (game.state as any).turnPlayer = p1;
    (game.state as any).turnNumber = 2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game as any).additionalDrawsPerTurn = { [p1]: 1 };
    (game.state as any).additionalDrawsPerTurn = { [p1]: 1 };

    game.replay!([events[0]] as any);
    const hand = (game.state.zones[p1].hand || []).map((c: any) => ({ id: c.id, name: c.name }));
    expect(hand.map((c) => c.id)).toEqual(['plains_1', 'cube_1', 'bauble_1']);
    expect(hand.map((c) => c.name)).toEqual(['Plains', 'Class-4 Tactical Cube', "Wayfarer's Bauble"]);
    expect(((game as any).libraries.get(p1) || []).map((c: any) => c.id)).toEqual(['trap_top']);
  });
});
