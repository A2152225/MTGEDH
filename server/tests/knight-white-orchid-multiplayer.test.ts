import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';

function seedLands(g: any, counts: Record<string, number>) {
  const bf: any[] = [];
  for (const [pid, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      bf.push({
        id: `${pid}_land_${i}`,
        controller: pid,
        owner: pid,
        card: {
          id: `${pid}_land_${i}`,
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '',
        },
      });
    }
  }
  g.state.battlefield = bf;
}

describe('Knight of the White Orchid - multiplayer tied for most lands', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('knight_mp_tied');
  });

  it('should NOT trigger when tied for most lands in 4-player (real oracle text)', () => {
    const gameId = 'knight_mp_tied';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const p4 = 'p4' as PlayerID;

    for (const [id, name] of [[p1, 'P1'], [p2, 'P2'], [p3, 'P3'], [p4, 'P4']] as const) {
      g.applyEvent({ type: 'join', playerId: id, name });
    }

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.importDeckResolved(p1, [
      { id: 'plains_lib', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    ]);

    // p1 tied for most with p2/p3; p4 behind
    seedLands(g, { p1: 5, p2: 5, p3: 5, p4: 3 });

    const local = lookupLocalCardByNameSync('Knight of the White Orchid');
    expect(local?.oracle_text).toBeTruthy();

    const knight: any = {
      id: 'knight_1',
      name: local!.name,
      type_line: local!.type_line,
      oracle_text: local!.oracle_text,
    };

    g.state.zones = g.state.zones || {};
    g.state.zones[p1] = g.state.zones[p1] || { hand: [], library: [], graveyard: [], exile: [] };
    (g.state.zones[p1] as any).hand = [knight];

    g.state.stack = [{
      id: 'spell_knight',
      type: 'spell',
      controller: p1,
      card: knight,
      targets: [],
    } as any];

    g.resolveTopOfStack();

    expect(g.state.stack.length).toBe(0);
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.filter((s) => s.type === ResolutionStepType.LIBRARY_SEARCH)).toHaveLength(0);
  });
});
