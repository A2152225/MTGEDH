import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { resolveGreatestManaValueAmongRevealedThisWay } from '../src/oracleIRExecutorRevealedCardsThisWay.js';

const ALEXANDER_ABILITY =
  "{T}: Each player reveals the top card of their library, then draws a card. Alexander deals X damage to a random opponent, where X is the greatest mana value among cards revealed this way.";

function baseState(): GameState {
  return {
    turnNumber: 5,
    players: [
      {
        id: 'p1',
        life: 40,
        hand: [],
        library: [{ id: 'l1', name: 'Sol Ring', type_line: 'Artifact', cmc: 1, mana_cost: '{1}' }],
        graveyard: [],
        exile: [],
      },
      {
        id: 'p2',
        life: 40,
        hand: [],
        library: [{ id: 'l2', name: 'Counterspell', type_line: 'Instant', cmc: 2, mana_cost: '{U}{U}' }],
        graveyard: [],
        exile: [],
      },
    ],
    battlefield: [
      {
        id: 'alex',
        controller: 'p1',
        owner: 'p1',
        card: { name: "Alexander, Ship's Fool", type_line: 'Legendary Creature — Klingon Human' },
      },
    ],
  } as unknown as GameState;
}

describe("Alexander, Ship's Fool — greatest MV among revealed this way", () => {
  it('resolves greatest mana value among revealed cards', () => {
    const amount = resolveGreatestManaValueAmongRevealedThisWay(
      'the greatest mana value among cards revealed this way',
      {
        controllerId: 'p1',
        lastRevealedCards: [
          { id: 'a', name: 'Sol Ring', cmc: 1, mana_cost: '{1}' },
          { id: 'b', name: 'Counterspell', cmc: 2, mana_cost: '{U}{U}' },
        ],
      } as any,
    );
    expect(amount).toBe(2);
  });

  it('deals X damage to a random opponent after each-player reveal', () => {
    const ir = parseOracleTextToIR(ALEXANDER_ABILITY, "Alexander, Ship's Fool");
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'deal_damage')).toBe(true);

    const state = baseState();
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'alex',
        sourceName: "Alexander, Ship's Fool",
        sourceObjectType: 'ability',
        selectorContext: {},
      } as any),
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(
      expect.arrayContaining(['reveal_top', 'deal_damage']),
    );
    expect(result.skippedSteps.some((step) => step.kind === 'deal_damage')).toBe(false);
    const p2 = (result.state.players || []).find((player: any) => player.id === 'p2') as any;
    expect(Number(p2?.life)).toBe(38);
  });
});
