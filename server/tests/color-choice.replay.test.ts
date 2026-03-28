import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('color choice replay semantics', () => {
  it('replays spell color choices onto the unresolved stack item', () => {
    const game = createInitialGameState('t_spell_color_choice_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).stack = [
      {
        id: 'spell_stack_1',
        cardId: 'spell_stack_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'spell_stack_1',
          name: 'Brave the Elements',
          type_line: 'Instant',
          oracle_text: 'Choose a color. White creatures you control gain protection from the chosen color until end of turn.',
        },
      },
    ];

    game.applyEvent({
      type: 'colorChoice',
      playerId: p1,
      spellId: 'spell_stack_1',
      cardName: 'Brave the Elements',
      color: 'white',
    } as any);

    expect(((game.state as any).stack || [])[0]?.chosenColor).toBe('white');
  });

  it('replays permanent color choices onto the chosen permanent', () => {
    const game = createInitialGameState('t_permanent_color_choice_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'caged_sun_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'caged_sun_card',
          name: 'Caged Sun',
          type_line: 'Artifact',
        },
      },
    ];

    game.applyEvent({
      type: 'colorChoice',
      playerId: p1,
      permanentId: 'caged_sun_1',
      cardName: 'Caged Sun',
      color: 'blue',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenColor).toBe('blue');
  });
});