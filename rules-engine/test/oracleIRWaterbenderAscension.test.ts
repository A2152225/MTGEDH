import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';

const controllerId = 'p1' as PlayerID;

const WATERBENDER_ORACLE =
  "Whenever a creature you control deals combat damage to a player, put a quest counter on this enchantment. Then if it has four or more quest counters on it, draw a card.\nWaterbend {4}: Target creature can't be blocked this turn. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)";

describe('Waterbender Ascension grant_temporary_ability target', () => {
  it('applies unblockable grant to a bound target creature', () => {
    const ir = parseOracleTextToIR(WATERBENDER_ORACLE, 'Waterbender Ascension');
    const grantStep = ir.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'grant_temporary_ability');
    expect(grantStep).toBeTruthy();

    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', card: { type_line: 'Creature — Human' } },
        ],
      } as GameState,
      grantStep ? [grantStep] : [],
      {
        controllerId,
        sourceId: 'enchant-1',
        targetCreatureId: 'bf-target',
        selectorContext: { chosenObjectIds: ['bf-target'] },
      } as any,
      { allowOptional: true },
    );

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
  });
});
