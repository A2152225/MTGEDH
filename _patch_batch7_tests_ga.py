from pathlib import Path

# game-actions: also map World Anew-style bulk creature control to a clear action
p = Path(r'server/src/socket/game-actions.ts')
t = p.read_text(encoding='utf-8')
old = """            if (/\\bgain control of target opponent\\b/i.test(triggerLower)) {
              triggerPayload.action = 'gain_control_target_opponent';
              triggerPayload.targetType = 'opponent';
            } else if (/\\bdestroy\\b[^.]*\\btarget\\b/i.test(triggerLower)) {"""
new = """            if (/\\bgain control of target opponent\\b/i.test(triggerLower)) {
              triggerPayload.action = 'gain_control_target_opponent';
              triggerPayload.targetType = 'opponent';
            } else if (/\\bgain control of all creatures target player controls\\b/i.test(triggerLower)) {
              triggerPayload.action = 'gain_control_all_creatures_target_player';
              triggerPayload.targetType = 'player';
            } else if (/\\bdestroy\\b[^.]*\\btarget\\b/i.test(triggerLower)) {"""
if old not in t:
    raise SystemExit('game-actions action map missing')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')
print('game-actions updated')

# Unit test for control-next-turn
Path(r'server/tests/trigger-control-next-turn.unit.test.ts').write_text("""import { describe, expect, it, vi } from 'vitest';

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
""", encoding='utf-8')
print('wrote control-next-turn unit test')

# Keep old Emrakul test importing shim alias still works - update it lightly
old_test = Path(r'server/tests/trigger-emrakul-gain-control.test.ts')
old_test.write_text("""import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { applyEmrakulGainControlOfTargetOpponentFromTrigger } from '../src/state/modules/triggerEmrakulGainControlUtils.js';

vi.mock('../src/state/modules/turn.js', () => ({
  addExtraTurn: vi.fn(),
}));

import { addExtraTurn } from '../src/state/modules/turn.js';

describe('triggerEmrakulGainControlUtils (compat shim)', () => {
  it('compat alias still registers control-next-turn + drawback from full text', () => {
    const ctx = {} as any;
    const state = {} as any;

    expect(applyEmrakulGainControlOfTargetOpponentFromTrigger({
      ctx,
      controller: 'p1' as PlayerID,
      sourceName: 'Emrakul',
      description: "You gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.",
      triggerItem: { targets: ['p2'] },
      state,
    })).toBe(true);

    expect(state.controlledPlayerNextTurn.p2).toBe('p1');
    expect(addExtraTurn).toHaveBeenCalledWith(ctx, 'p2', 'Emrakul');
  });
});
""", encoding='utf-8')
print('updated emrakul compat test')
