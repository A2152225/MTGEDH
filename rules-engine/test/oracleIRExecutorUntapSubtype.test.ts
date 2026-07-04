import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR untap all creature subtype', () => {
  it('untaps all permanents of a creature subtype you control', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [{ id: p1, name: 'P1' }],
      battlefield: [
        {
          id: 'elf-1',
          controller: p1,
          tapped: true,
          card: { type_line: 'Creature — Elf' },
        },
        {
          id: 'elf-2',
          controller: p1,
          tapped: false,
          card: { type_line: 'Creature — Elf Warrior' },
        },
        {
          id: 'goblin-1',
          controller: p1,
          tapped: true,
          card: { type_line: 'Creature — Goblin' },
        },
      ],
    } as unknown as GameState;

    const effect = 'untap all elves you control';
    const steps = collectOracleEffectSteps(effect, 'Source');
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({ controllerId: p1, sourceName: 'Source' }),
    );

    expect(result.skippedSteps).toEqual([]);
    const elf1 = (result.state.battlefield as any[]).find((perm) => perm.id === 'elf-1');
    const goblin1 = (result.state.battlefield as any[]).find((perm) => perm.id === 'goblin-1');
    expect(elf1?.tapped).toBe(false);
    expect(goblin1?.tapped).toBe(true);
  });
});
