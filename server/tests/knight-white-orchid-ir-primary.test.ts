import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('Knight IR conditional search_library', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    ResolutionQueueManager.removeQueue('knight_ir_direct');
  });

  it('does NOT queue library search when condition is false (direct IR execution)', () => {
    const gameId = 'knight_ir_direct';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });

    g.importDeckResolved(p1, [
      { id: 'plains_lib', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    ]);

    for (let i = 0; i < 5; i++) {
      g.state.battlefield = g.state.battlefield || [];
      g.state.battlefield.push({
        id: `p1_${i}`,
        controller: p1,
        owner: p1,
        card: { id: `p1_${i}`, name: 'Plains', type_line: 'Basic Land — Plains' },
      } as any);
      g.state.battlefield.push({
        id: `p2_${i}`,
        controller: p2,
        owner: p2,
        card: { id: `p2_${i}`, name: 'Mountain', type_line: 'Basic Land — Mountain' },
      } as any);
    }

    const effect =
      'if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.';

    g.state.stack = [{
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: p1,
      sourceName: 'Knight of the White Orchid',
      description: effect,
      effect,
      triggerType: 'etb',
    } as any];

    g.resolveTopOfStack();

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.filter((s) => s.type === ResolutionStepType.LIBRARY_SEARCH)).toHaveLength(0);
  });
});
