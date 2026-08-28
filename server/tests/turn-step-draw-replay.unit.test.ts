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
});
