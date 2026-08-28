import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

// Oracle from mtg_data.db (Monstrous Vortex)
const VORTEX_ORACLE =
  "Whenever you cast a creature spell with power 5 or greater, discover X, where X is that spell's mana value. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)";

function discoverLibrary() {
  return [
    { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    { id: 'mv7-1', name: 'Seven Drop', type_line: 'Creature — Dragon', cmc: 7, mana_value: 7, power: '5', toughness: '5' },
    { id: 'mv6-1', name: 'Six Drop', type_line: 'Creature — Dinosaur', cmc: 6, mana_value: 6, power: '7', toughness: '6' },
    { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, mana_value: 1 },
  ];
}

function discoverSteps() {
  const ir = parseOracleTextToIR(VORTEX_ORACLE, 'Monstrous Vortex');
  return ir.abilities.find((ability) =>
    ability.steps.some((step) => step.kind === 'impulse_exile_top'),
  )?.steps ?? [];
}

describe("Discover X where X is that spell's mana value", () => {
  it('parses discover into impulse until that spell mana value', () => {
    const steps = discoverSteps();
    const impulse = steps.find((step) => step.kind === 'impulse_exile_top') as any;
    expect(impulse).toBeTruthy();
    expect(String(impulse?.amount?.raw || '')).toMatch(/that spell'?s mana value/i);
  });

  it('uses the triggering spell mana value as the discover threshold', () => {
    const steps = discoverSteps();
    expect(steps.some((step) => step.kind === 'impulse_exile_top')).toBe(true);

    const start = {
      players: [
        {
          id: 'p1',
          seat: 0,
          library: discoverLibrary(),
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'vortex_1',
          controller: 'p1',
          card: {
            name: 'Monstrous Vortex',
            type_line: 'Enchantment',
            oracle_text: VORTEX_ORACLE,
          },
        },
      ],
      stack: [
        {
          id: 'stack_titan',
          type: 'spell',
          controller: 'p1',
          card: {
            id: 'titan_1',
            name: 'Test Titan',
            type_line: 'Creature — Giant',
            power: '5',
            toughness: '5',
            cmc: 8,
            mana_value: 8,
          },
        },
      ],
    } as any;

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceName: 'Monstrous Vortex',
        targetSpellId: 'stack_titan',
        selectorContext: { targetSpellId: 'stack_titan' },
      }, {
        targetSpellId: 'stack_titan',
        spellManaValue: 8,
      }),
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toContain('impulse_exile_top');
    const player = result.state.players.find((entry: any) => entry.id === 'p1');
    const exileNames = (player?.exile || []).map((card: any) => String(card?.name || ''));
    // Forest (land) + Seven Drop (MV 7 <= 8, stop). Six Drop/Bolt stay in library.
    expect(exileNames).toContain('Seven Drop');
    expect(exileNames).not.toContain('Six Drop');
    expect(exileNames).not.toContain('Lightning Bolt');
  });

  it('resolves that spell mana value from the stack when the hint omits spellManaValue', () => {
    const steps = discoverSteps();
    const start = {
      players: [
        {
          id: 'p1',
          seat: 0,
          library: discoverLibrary(),
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
      stack: [
        {
          id: 'stack_titan',
          type: 'spell',
          controller: 'p1',
          card: {
            id: 'titan_1',
            name: 'Test Titan',
            type_line: 'Creature — Giant',
            power: '5',
            toughness: '5',
            cmc: 8,
            mana_value: 8,
          },
        },
      ],
    } as any;

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceName: 'Monstrous Vortex',
        targetSpellId: 'stack_titan',
        selectorContext: { targetSpellId: 'stack_titan' },
      }),
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toContain('impulse_exile_top');
    const player = result.state.players.find((entry: any) => entry.id === 'p1');
    const exileNames = (player?.exile || []).map((card: any) => String(card?.name || ''));
    expect(exileNames).toContain('Seven Drop');
    expect(exileNames).not.toContain('Lightning Bolt');
  });
});
