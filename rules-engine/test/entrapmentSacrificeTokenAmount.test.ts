import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

describe('sacrifice then create tokens where X is that creature toughness', () => {
  it('resolves X from lastSacrificedPermanents after sacrifice in the same IR pass', () => {
    const casterId = 'p_caster' as PlayerID;
    const targetId = 'p_target' as PlayerID;
    const attackerId = 'attacker_1';
    const oracleText =
      "Target player sacrifices an attacking creature of their choice. You create X 1/1 white Soldier creature tokens, where X is that creature's toughness.";
    const steps = parseOracleTextToIR(oracleText, 'Entrapment Maneuver').abilities[0].steps;

    const state = {
      players: [{ id: casterId, seat: 0 }, { id: targetId, seat: 1 }],
      battlefield: [
        {
          id: attackerId,
          controller: targetId,
          owner: targetId,
          attacking: casterId,
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '3' },
        },
        {
          id: 'non_attacker',
          controller: targetId,
          owner: targetId,
          card: { name: 'Elk', type_line: 'Creature — Elk', power: '2', toughness: '2' },
        },
      ],
    } as GameState;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: casterId,
      sourceName: 'Entrapment Maneuver',
      sourceId: 'spell-1',
      targetPlayerId: targetId,
      selectorContext: { targetPlayerId: targetId, chosenObjectIds: [attackerId] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, irCtx, { allowOptional: true });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unknown_amount')).toBe(false);
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['sacrifice', 'create_token']);
    const soldiers = (result.state.battlefield || []).filter((perm) =>
      /soldier/i.test(String((perm as any).card?.name || (perm as any).name || '')),
    );
    expect(soldiers).toHaveLength(3);
    expect(soldiers.every((perm) => String((perm as any).controller || '') === casterId)).toBe(true);
    expect((result.state.battlefield || []).some((perm) => String((perm as any).id || '') === attackerId)).toBe(false);
  });
});
