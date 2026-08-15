import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { applyGainControlStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { applyChangeTargetStep } from '../src/oracleIRExecutorPlayerStepHandlers.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const CHEFS_KISS_TEXT =
  "Gain control of target spell that targets only a single permanent or player. Copy it, then reselect the targets at random for the spell and the copy. The new targets can't be you or a permanent you control.";

describe('Oracle IR gain control of a stack spell', () => {
  it('transfers the targeted stack spell to the resolving player', () => {
    const ir = parseOracleTextToIR(CHEFS_KISS_TEXT, "Chef's Kiss");
    const gainControl = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((step) => step.kind === 'gain_control');
    expect(gainControl).toMatchObject({ kind: 'gain_control' });

    const state = {
      players: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      stack: [
        {
          id: 'stack-bolt-1',
          type: 'spell',
          controller: 'p2',
          card: { name: 'Lightning Bolt', type_line: 'Instant' },
          targets: ['p1'],
        },
      ],
      battlefield: [],
    } as unknown as GameState;

    const result = applyGainControlStep(
      state,
      gainControl as Extract<typeof gainControl, { kind: 'gain_control' }>,
      {
        controllerId: 'p1',
        sourceId: 'stack-chefs-kiss-1',
        sourceName: "Chef's Kiss",
        targetSpellId: 'stack-bolt-1',
      } as any,
    );

    expect(result.applied).toBe(true);
    expect((result.state as any).stack[0].controller).toBe('p1');
  });

  it('reselects a single-target spell away from you when only one legal target remains', () => {
    const ir = parseOracleTextToIR(CHEFS_KISS_TEXT, "Chef's Kiss");
    const changeTarget = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((step) => step.kind === 'change_target');
    expect(changeTarget).toMatchObject({ kind: 'change_target', random: true });

    const state = {
      players: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      stack: [
        {
          id: 'stack-bolt-1',
          type: 'spell',
          controller: 'p1',
          card: { name: 'Lightning Bolt', type_line: 'Instant' },
          targets: ['p1'],
          copyRetargetValidTargets: [
            { id: 'p1', name: 'P1', type: 'player' },
            { id: 'p2', name: 'P2', type: 'player' },
          ],
        },
      ],
      battlefield: [],
    } as unknown as GameState;

    const result = applyChangeTargetStep(
      state,
      changeTarget as Extract<typeof changeTarget, { kind: 'change_target' }>,
      {
        controllerId: 'p1',
        sourceId: 'stack-chefs-kiss-1',
        sourceName: "Chef's Kiss",
        targetSpellId: 'stack-bolt-1',
      } as any,
    );

    expect(result.applied).toBe(true);
    const retargeted = (result.state as any).stack[0];
    expect(retargeted.targets).toEqual([
      expect.objectContaining({ id: 'p2' }),
    ]);
  });
});
