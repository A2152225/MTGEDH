import { describe, expect, it, vi } from 'vitest';

const replaySpy = vi.fn();

vi.mock('../src/state/modules/applyEvent.js', () => ({
  replay: (...args: unknown[]) => replaySpy(...args),
}));

import { calculateSmartUndoCounts } from '../src/socket/undo-handlers/undoBoundaryPlanning.js';

describe('smart undo counts skip full-log probe when stamps exist', () => {
  it('does not replay the event log when live step is one ahead of the last stamp', () => {
    replaySpy.mockClear();
    const events = [
      { type: 'join', turnNumber: 3, phase: 'ending', step: 'CLEANUP' },
      { type: 'nextTurn', turnNumber: 3, phase: 'beginning', step: 'UNTAP' },
      { type: 'nextStep', turnNumber: 3, phase: 'beginning', step: 'UNTAP' },
    ];
    const game = {
      state: {
        turnNumber: 3,
        phase: 'beginning',
        step: 'UPKEEP',
      },
    };

    const first = calculateSmartUndoCounts(game, events as any);
    const second = calculateSmartUndoCounts(game, events as any);

    expect(first.stepCount).toBe(1);
    expect(first.phaseCount).toBe(2);
    expect(second.stepCount).toBe(first.stepCount);
    expect(replaySpy).not.toHaveBeenCalled();
  });

  it('uses stamped rows across a turn boundary without probing', () => {
    replaySpy.mockClear();
    const events = [
      { type: 'syntheticTurnOneMain', turnNumber: 1, phase: 'ending', step: 'END' },
      { type: 'syntheticTurnOneEnding', turnNumber: 1, phase: 'ending', step: 'END' },
      { type: 'syntheticTurnTwoBeginning', turnNumber: 2, phase: 'beginning', step: 'UNTAP' },
      { type: 'syntheticTurnTwoUpkeep', turnNumber: 2, phase: 'beginning', step: 'UPKEEP' },
    ];
    const game = {
      state: {
        turnNumber: 2,
        phase: 'beginning',
        step: 'UPKEEP',
      },
    };

    const counts = calculateSmartUndoCounts(game, events as any);

    expect(counts.stepCount).toBe(1);
    expect(counts.phaseCount).toBe(2);
    expect(counts.previousPhaseCount).toBe(4);
    expect(counts.turnCount).toBe(2);
    expect(replaySpy).not.toHaveBeenCalled();
  });
});
