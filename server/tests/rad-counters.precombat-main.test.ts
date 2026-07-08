import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import { processRadCountersAtPrecombatMain } from '../src/state/modules/triggers/rad-counters.js';

describe('Rad counters at precombat main (Rule 728.1)', () => {
  it('mills equal to rad count and removes rad for each nonland milled', () => {
    const g = createInitialGameState('rad_precombat_main');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.importDeckResolved(p1, [
      { id: 'c1', name: 'Lightning Bolt', type_line: 'Instant' } as any,
      { id: 'c2', name: 'Shock', type_line: 'Instant' } as any,
      { id: 'c3', name: 'Plains', type_line: 'Basic Land — Plains' } as any,
    ]);

    (g.state as any).players = [{ id: p1, name: 'P1', life: 20, counters: { rad: 2 } }];
    (g.state as any).life = { [p1]: 20 };
    (g.state as any).radCounters = { [p1]: 2 };

    const lifeBefore = (g.state as any).life[p1] ?? 20;
    const libraryBefore = g.state.zones?.[p1]?.libraryCount ?? 0;

    const changed = processRadCountersAtPrecombatMain(g as any, p1);

    expect(changed).toBe(true);
    expect(g.state.zones?.[p1]?.libraryCount).toBe(libraryBefore - 2);
    expect(g.state.zones?.[p1]?.graveyardCount).toBe(2);

    const lifeAfter = (g.state as any).players.find((p: any) => p.id === p1)?.life;
    expect(lifeAfter).toBe(lifeBefore - 2);

    const radAfter = (g.state as any).radCounters?.[p1] ?? (g.state as any).players.find((p: any) => p.id === p1)?.counters?.rad;
    expect(radAfter).toBe(0);
  });

  it('does not remove rad counters for milled lands', () => {
    const g = createInitialGameState('rad_land_mill');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.importDeckResolved(p1, [
      { id: 'c1', name: 'Plains', type_line: 'Basic Land — Plains' } as any,
      { id: 'c2', name: 'Island', type_line: 'Basic Land — Island' } as any,
    ]);

    (g.state as any).players = [{ id: p1, name: 'P1', life: 20, counters: { rad: 2 } }];
    (g.state as any).life = { [p1]: 20 };
    (g.state as any).radCounters = { [p1]: 2 };

    processRadCountersAtPrecombatMain(g as any, p1);

    const lifeAfter = (g.state as any).players.find((p: any) => p.id === p1)?.life;
    expect(lifeAfter).toBe(20);

    const radAfter = (g.state as any).radCounters?.[p1];
    expect(radAfter).toBe(2);
  });

  it('runs rad processing when advancing to MAIN1 via nextStep', () => {
    const g = createInitialGameState('rad_nextstep_main1');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.importDeckResolved(p1, [
      { id: 'c1', name: 'Lightning Bolt', type_line: 'Instant' } as any,
    ]);

    (g.state as any).turnPlayer = p1;
    (g.state as any).activePlayer = p1;
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'DRAW';
    (g.state as any).players = [{ id: p1, name: 'P1', life: 20, counters: { rad: 1 } }];
    (g.state as any).radCounters = { [p1]: 1 };

    g.applyEvent({ type: 'nextStep' });

    expect(g.state.zones?.[p1]?.graveyardCount).toBe(1);
    expect((g.state as any).radCounters?.[p1]).toBe(0);
  });
});
