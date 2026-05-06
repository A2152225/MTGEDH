import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

describe('graveyard permission executor', () => {
  it('marks both lands and spells for a Gaea\'s Will-style graveyard permission clause', () => {
    const ir = parseOracleTextToIR(
      'Until end of turn, you may play lands and cast spells from your graveyard.',
      "Gaea's Will",
    );
    const steps = ir.abilities.flatMap((ability: any) => ability.steps || []);

    const result = applyOracleIRStepsToGameState(
      {
        turnNumber: 4,
        players: [
          {
            id: 'p1',
            name: 'P1',
            seat: 0,
            life: 40,
            library: [],
            hand: [],
            graveyard: [
              { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
              { id: 'consider_1', name: 'Consider', type_line: 'Instant', mana_cost: '{U}' },
            ],
            exile: [],
          } as any,
        ],
      } as any,
      steps,
      {
        controllerId: 'p1',
        sourceId: 'gaea_will_1',
        sourceName: "Gaea's Will",
      },
      { allowOptional: true },
    );

    expect((result.state as any).playableFromGraveyard?.p1?.forest_1).toBe(4);
    expect((result.state as any).playableFromGraveyard?.p1?.consider_1).toBe(4);
  });
});