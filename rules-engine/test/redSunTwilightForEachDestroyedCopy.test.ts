import { describe, expect, it } from 'vitest';

import { tryParseCreateTokenFollowupModifier } from '../src/oracleIRParserTokenFollowup';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const RED_SUN_RIDER =
  "For each artifact destroyed this way, create a token that's a copy of it. Those tokens gain haste. Exile them at the beginning of the next end step.";
const RED_SUN_FULL =
  "Destroy up to X target artifacts. If X is 5 or more, for each artifact destroyed this way, create a token that's a copy of it. Those tokens gain haste. Exile them at the beginning of the next end step.";

function makeStateWithArtifacts() {
  return {
    players: [{ id: 'p_caster', seat: 0 }, { id: 'p_opp', seat: 1 }],
    battlefield: [
      {
        id: 'art1',
        controller: 'p_opp',
        owner: 'p_opp',
        card: { name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}' },
      },
      {
        id: 'art2',
        controller: 'p_opp',
        owner: 'p_opp',
        card: { name: 'Mana Vault', type_line: 'Artifact', mana_cost: '{1}' },
      },
    ],
  } as any;
}

describe("Red Sun's Twilight for-each destroyed copy rider", () => {
  it('parses token followup modifiers for haste and exile', () => {
    expect(tryParseCreateTokenFollowupModifier('Those tokens gain haste')).toEqual({ grantsHaste: 'permanent' });
    expect(tryParseCreateTokenFollowupModifier('Exile them at the beginning of the next end step')).toEqual({
      atNextEndStep: 'exile',
    });
  });

  it('parses the rider into create_token copy-of-it with haste and exile at next end step', () => {
    const steps = parseOracleTextToIR(RED_SUN_RIDER, "Red Sun's Twilight").abilities[0]?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'x' },
      token: expect.stringMatching(/copy of it/i),
      grantsHaste: 'permanent',
      atNextEndStep: 'exile',
    });
  });

  it('parses full spell into destroy, conditional create_token', () => {
    const steps = parseOracleTextToIR(RED_SUN_FULL, "Red Sun's Twilight").abilities[0]?.steps ?? [];
    expect(steps.map((s) => s.kind)).toEqual(['destroy', 'conditional']);
    expect((steps[1] as any).condition).toMatchObject({
      kind: 'if',
      raw: expect.stringMatching(/x is 5 or more/i),
    });
    expect((steps[1] as any).steps).toHaveLength(1);
    expect((steps[1] as any).steps[0]).toMatchObject({
      kind: 'create_token',
      who: { kind: 'you' },
      token: expect.stringMatching(/copy of it/i),
      grantsHaste: 'permanent',
      atNextEndStep: 'exile',
    });
  });

  it('creates one copy token per destroyed artifact when x >= 5', () => {
    const steps = parseOracleTextToIR(RED_SUN_RIDER, "Red Sun's Twilight").abilities[0]?.steps ?? [];
    const start = makeStateWithArtifacts();
    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext(
        {
          controllerId: 'p_caster',
          xValue: 5,
          lastMovedCards: [
            { id: 'art1', controller: 'p_opp', owner: 'p_opp', card: { name: 'Sol Ring', type_line: 'Artifact' } },
            { id: 'art2', controller: 'p_opp', owner: 'p_opp', card: { name: 'Mana Vault', type_line: 'Artifact' } },
          ],
        },
        {},
      ),
      { allowOptional: true },
    );

    const tokens = (result.state.battlefield || []).filter((p: any) => p.isToken);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((p: any) => p.controller === 'p_caster')).toBe(true);
    expect(tokens.some((p: any) => String(p.card?.name || '').includes('Sol Ring'))).toBe(true);
    expect(tokens.some((p: any) => String(p.card?.name || '').includes('Mana Vault'))).toBe(true);
  });
});
