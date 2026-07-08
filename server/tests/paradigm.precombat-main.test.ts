import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';

describe('Paradigm precombat main trigger', () => {
  it('queues optional paradigm triggers at precombat main', () => {
    const g = createInitialGameState('paradigm_precombat_main');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    (g.state as any).turnPlayer = p1;
    (g.state as any).activePlayer = p1;
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'DRAW';
    (g.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [
          {
            id: 'paradigm_card',
            name: 'Paradigm Spell',
            paradigmActive: true,
            paradigmController: p1,
          },
        ],
        exileCount: 1,
      },
    };

    g.applyEvent({ type: 'nextStep' });

    const paradigmTrigger = ((g.state as any).stack || []).find(
      (item: any) => item?.triggerType === 'paradigm',
    );
    expect(paradigmTrigger).toBeTruthy();
    expect(paradigmTrigger?.mandatory).toBe(false);
    expect(String(paradigmTrigger?.description || '')).toMatch(/you may cast a copy/i);
  });
});
