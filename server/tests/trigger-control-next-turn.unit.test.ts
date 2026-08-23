import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyControlOfTargetOpponentNextTurnFromTrigger,
  isControlOfTargetOpponentNextTurnEffect,
} from '../src/state/modules/triggerControlNextTurnUtils.js';

vi.mock('../src/state/modules/turn.js', () => ({
  addExtraTurn: vi.fn(),
}));

import { addExtraTurn } from '../src/state/modules/turn.js';

describe('triggerControlNextTurnUtils (generic control-next-turn)', () => {
  it('detects Promised-End-style control-next-turn oracle text', () => {
    expect(
      isControlOfTargetOpponentNextTurnEffect(
        "you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn",
      ),
    ).toBe(true);
    expect(isControlOfTargetOpponentNextTurnEffect('gain control of target creature')).toBe(false);
  });

  it('registers control-next-turn and drawback extra turn from full oracle clause', () => {
    const ctx = {} as any;
    const state = {} as any;

    expect(
      applyControlOfTargetOpponentNextTurnFromTrigger({
        ctx,
        controller: 'p1' as PlayerID,
        sourceName: 'Test Control Next Turn',
        description:
          "You gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.",
        triggerItem: { targets: ['p2'] },
        state,
      }),
    ).toBe(true);

    expect(state.controlledPlayerNextTurn.p2).toBe('p1');
    expect(addExtraTurn).toHaveBeenCalledWith(ctx, 'p2', 'Test Control Next Turn');
  });

  it('registers control-next-turn without extra turn when drawback text is absent', () => {
    vi.mocked(addExtraTurn).mockClear();
    const ctx = {} as any;
    const state = {} as any;

    expect(
      applyControlOfTargetOpponentNextTurnFromTrigger({
        ctx,
        controller: 'p1' as PlayerID,
        sourceName: 'Control Only',
        description: "You gain control of target opponent during that player's next turn.",
        triggerItem: { targets: ['p2'] },
        state,
      }),
    ).toBe(true);

    expect(state.controlledPlayerNextTurn.p2).toBe('p1');
    expect(addExtraTurn).not.toHaveBeenCalled();
  });
});
