import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { resolveTokenCharacteristicsFromOracleStep } from '../src/tokenCreationDetection';
import type { GameState, PlayerID } from '../../shared/src';

// Oracle text (Outlaws' Merriment, m20/? / eld):
// "At the beginning of your upkeep, choose one at random. Create a red and white creature
// token with those characteristics.
// • 3/1 Human Warrior with trample and haste.
// • 2/1 Human Cleric with lifelink and haste.
// • 1/2 Human Rogue with haste and "When this token enters, it deals 1 damage to any target.""
const upkeepOracle =
  'At the beginning of your upkeep, choose one at random. Create a red and white creature token with those characteristics.\n' +
  '\u2022 3/1 Human Warrior with trample and haste.\n' +
  '\u2022 2/1 Human Cleric with lifelink and haste.\n' +
  '\u2022 1/2 Human Rogue with haste and "When this token enters, it deals 1 damage to any target."';

function collectUpkeepSteps() {
  const ir = parseOracleTextToIR(upkeepOracle, "Outlaws' Merriment");
  const ability = ir.abilities.find((entry) => /beginning of your upkeep/i.test(String(entry.text || '')));
  return ability?.steps || [];
}

describe("Outlaws' Merriment choose_mode with shared lead + characteristic bullets", () => {
  it('parses the shared lead + bullets into a choose_mode step with three create_token modes', () => {
    const steps = collectUpkeepSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'choose_mode', minModes: 1, maxModes: 1 });

    const chooseMode = steps[0] as any;
    expect(chooseMode.modes).toHaveLength(3);
    for (const mode of chooseMode.modes) {
      expect(mode.steps).toHaveLength(1);
      expect(mode.steps[0].kind).toBe('create_token');
      expect(typeof mode.steps[0].token).toBe('string');
    }
  });

  it('each mode create_token descriptor resolves to the correct token characteristics', () => {
    const steps = collectUpkeepSteps();
    const chooseMode = steps[0] as any;
    const tokenSteps = chooseMode.modes.map((mode: any) => mode.steps[0]);

    const warrior = resolveTokenCharacteristicsFromOracleStep(tokenSteps[0].token, tokenSteps[0].raw);
    expect(warrior).toMatchObject({
      power: 3,
      toughness: 1,
      colors: expect.arrayContaining(['R', 'W']),
      types: expect.arrayContaining(['Creature']),
      subtypes: expect.arrayContaining(['Human', 'Warrior']),
      abilities: expect.arrayContaining(['Trample', 'Haste']),
    });

    const cleric = resolveTokenCharacteristicsFromOracleStep(tokenSteps[1].token, tokenSteps[1].raw);
    expect(cleric).toMatchObject({
      power: 2,
      toughness: 1,
      colors: expect.arrayContaining(['R', 'W']),
      subtypes: expect.arrayContaining(['Human', 'Cleric']),
      abilities: expect.arrayContaining(['Lifelink', 'Haste']),
    });

    const rogue = resolveTokenCharacteristicsFromOracleStep(tokenSteps[2].token, tokenSteps[2].raw);
    expect(rogue).toMatchObject({
      power: 1,
      toughness: 2,
      colors: expect.arrayContaining(['R', 'W']),
      subtypes: expect.arrayContaining(['Human', 'Rogue']),
      abilities: expect.arrayContaining([
        'Haste',
        'When this token enters, it deals 1 damage to any target.',
      ]),
    });
  });

  it('executes a single mode create_token step and creates a matching battlefield token', () => {
    const steps = collectUpkeepSteps();
    const chooseMode = steps[0] as any;
    const clericStep = chooseMode.modes[1].steps[0];

    const controller = 'p1' as PlayerID;
    const state: GameState = {
      players: [{ id: controller, name: 'P1' }],
      battlefield: [],
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(state, [clericStep], {
      controllerId: controller,
      sourceId: 'merriment-1',
      sourceName: "Outlaws' Merriment",
    });

    expect(result.appliedSteps.some((step) => step.kind === 'create_token')).toBe(true);
    const createdTokens = (result.state.battlefield || []).filter((perm: any) =>
      String(perm?.card?.type_line || '').includes('Creature')
    );
    expect(createdTokens).toHaveLength(1);
    const token = createdTokens[0] as any;
    expect(Number(token.power ?? token.card?.power)).toBe(2);
    expect(Number(token.toughness ?? token.card?.toughness)).toBe(1);
    expect(String(token.card?.type_line || '')).toMatch(/human/i);
    expect(String(token.card?.type_line || '')).toMatch(/cleric/i);
  });
});
