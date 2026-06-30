import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.ts';

describe('oracle IR gap batch399 — flicker those cards return', () => {
  it('returns exiled creatures to the battlefield for Displace', () => {
    const ir = parseOracleTextToIR(
      "Exile up to two target creatures you control, then return those cards to the battlefield under their owner's control.",
      'Displace',
    );
    const steps = ir.abilities?.[0]?.steps || [];
    expect(steps.map((step) => step.kind)).toEqual(['exile', 'move_zone']);

    const state = {
      players: [{ id: 'p1', library: [], hand: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'bf-creature-1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'bf-creature-1-card', name: 'Audit Creature', type_line: 'Creature — Human' },
          type_line: 'Creature — Human',
        },
        {
          id: 'bf-creature-2',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'bf-creature-2-card', name: 'Audit Creature 2', type_line: 'Creature — Elf' },
          type_line: 'Creature — Elf',
        },
      ],
    } as any;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      selectorContext: { chosenObjectIds: ['bf-creature-1', 'bf-creature-2'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.skippedSteps?.length || 0).toBe(0);
    const returnedCreatures = (result.state.battlefield || []).filter((perm: any) =>
      /creature/i.test(String(perm?.type_line || perm?.card?.type_line || ''))
    );
    expect(returnedCreatures.length).toBe(2);
    expect(result.state.players[0].exile?.length || 0).toBe(0);
  });
});
