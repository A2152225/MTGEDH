import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const AZOR_ABILITY =
  "{1}, {T}: Draw a card, then exile a card from your hand. If cards with five or more different mana values are exiled with Azor's Gateway, you gain 5 life, untap Azor's Gateway, and transform it.";

function baseState(): GameState {
  return {
    turnNumber: 5,
    players: [
      {
        id: 'p1',
        life: 40,
        hand: [
          { id: 'h1', name: 'Island', type_line: 'Basic Land — Island', cmc: 0 },
          { id: 'h2', name: 'Opt', type_line: 'Instant', cmc: 1, mana_cost: '{U}' },
        ],
        library: [{ id: 'l1', name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 }],
        graveyard: [],
        exile: [],
      },
      { id: 'p2', life: 40, hand: [], library: [], graveyard: [], exile: [] },
    ],
    battlefield: [
      {
        id: 'azor',
        controller: 'p1',
        owner: 'p1',
        tapped: true,
        card: { name: "Azor's Gateway", type_line: 'Legendary Artifact' },
      },
    ],
  } as unknown as GameState;
}

describe("Azor's Gateway — exile a card from your hand", () => {
  it('requires a player choice when the hand has multiple cards', () => {
    const ir = parseOracleTextToIR(AZOR_ABILITY, "Azor's Gateway");
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'azor',
        sourceName: "Azor's Gateway",
        sourceObjectType: 'ability',
        selectorContext: {},
      } as any),
      { allowOptional: true },
    );

    expect(result.appliedSteps.some((step) => step.kind === 'draw')).toBe(true);
    expect(result.skippedSteps.some((step) => step.kind === 'move_zone')).toBe(true);
    expect(result.automationGaps || []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepKind: 'move_zone',
          reasonCode: 'player_choice_required',
          classification: 'player_choice',
        }),
      ]),
    );
  });

  it('exiles the chosen hand card when preferred ids are bound', () => {
    const ir = parseOracleTextToIR(AZOR_ABILITY, "Azor's Gateway");
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const state = baseState();
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'azor',
        sourceName: "Azor's Gateway",
        sourceObjectType: 'ability',
        selectorContext: { chosenObjectIds: ['h2'] },
      } as any),
      { allowOptional: true },
    );

    expect(result.skippedSteps.some((step) => step.kind === 'move_zone')).toBe(false);
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(
      expect.arrayContaining(['draw', 'move_zone']),
    );
    const p1 = (result.state.players || []).find((player: any) => player.id === 'p1') as any;
    expect((p1?.hand || []).some((card: any) => card.id === 'h2')).toBe(false);
    const exiled = (p1?.exile || []).find((card: any) => card.id === 'h2');
    expect(exiled).toBeTruthy();
    expect(String(exiled?.exiledWithSourceId || '')).toBe('azor');
  });
});
