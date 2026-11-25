import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const SPURNMAGE =
  "{T}: Return two target cards from an opponent's graveyard to their hand. Destroy target attacking creature.";

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [],
        hand: [],
        graveyard: [
          { id: 'gy1', name: 'Shock', type_line: 'Instant' },
          { id: 'gy2', name: 'Bolt', type_line: 'Instant' },
          { id: 'gy3', name: 'Bear', type_line: 'Creature — Bear' },
        ],
        exile: [],
      } as any,
    ],
    battlefield: [
      {
        id: 'atk1',
        name: 'Attacker',
        type_line: 'Creature — Goblin',
        controller: 'p2',
        owner: 'p2',
        attacking: true,
        card: { id: 'atk1', name: 'Attacker', type_line: 'Creature — Goblin' },
      },
    ],
    stack: [],
    ...overrides,
  } as GameState;
}

describe('Spurnmage Advocate N target cards from opponent GY', () => {
  it('parses return-two-target-cards as move_zone to hand', () => {
    const ir = parseOracleTextToIR(SPURNMAGE, 'Spurnmage Advocate');
    const move = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((step) => step.kind === 'move_zone');

    expect(move).toEqual(
      expect.objectContaining({
        kind: 'move_zone',
        to: 'hand',
        what: expect.objectContaining({
          kind: 'raw',
          text: expect.stringMatching(/two target cards from target opponent'?s graveyard/i),
        }),
      }),
    );
  });

  it('returns the bound chosen graveyard cards without a separate targetOpponentId', () => {
    const ir = parseOracleTextToIR(SPURNMAGE, 'Spurnmage Advocate');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const start = makeState();

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: {
        chosenObjectIds: ['gy1', 'gy2', 'atk1'],
      },
      targetCreatureId: 'atk1',
      chosenObjectIds: ['gy1', 'gy2', 'atk1'],
    } as any);

    const p2 = result.state.players.find((p) => p.id === 'p2') as any;
    expect(p2.hand.map((c: any) => c.id).sort()).toEqual(['gy1', 'gy2']);
    expect(p2.graveyard.map((c: any) => c.id)).toContain('gy3');
    expect(p2.graveyard.map((c: any) => c.id)).not.toContain('gy1');
    expect(p2.graveyard.map((c: any) => c.id)).not.toContain('gy2');
    expect(result.appliedSteps.some((s) => s.kind === 'move_zone')).toBe(true);
    expect(result.skippedSteps.some((s) => s.kind === 'move_zone')).toBe(false);
    expect(result.automationGaps?.some((g) => g.stepKind === 'move_zone')).toBeFalsy();
    // Destroy (via flatMapped second clause) may place the attacker in that GY.
    expect(result.appliedSteps.some((s) => s.kind === 'destroy')).toBe(true);
    expect((result.state.battlefield || []).some((perm: any) => perm.id === 'atk1')).toBe(false);
  });
});
