import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { executeCleanupStep } from '../src/actions/turnActions';

const REINS_ORACLE =
  'Untap all creatures you control and all creatures target opponent controls. You and that opponent each gain control of all creatures the other controls until end of turn. Those creatures gain haste until end of turn.';

function hasHaste(permanent: any): boolean {
  if ((permanent?.grantedAbilities || []).includes('haste')) return true;
  const temporary = Array.isArray(permanent?.temporaryEffects) ? permanent.temporaryEffects : [];
  return temporary.some((effect: any) => /haste/i.test(String(effect?.description || effect?.text || '')));
}

function makeState(): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    id: 'reins-of-power',
    format: 'commander',
    turnNumber: 1,
    turnPlayer: p1,
    players: [
      { id: p1, name: 'P1', seat: 0, life: 40, hand: [], library: [], graveyard: [], exile: [], counters: {} },
      { id: p2, name: 'P2', seat: 1, life: 40, hand: [], library: [], graveyard: [], exile: [], counters: {} },
    ],
    turnOrder: [p1, p2],
    battlefield: [
      { id: 'a1', controller: p1, owner: p1, card: { id: 'a1c', name: 'Bear', type_line: 'Creature — Bear' }, tapped: true },
      { id: 'a2', controller: p1, owner: p1, card: { id: 'a2c', name: 'Elf', type_line: 'Creature — Elf' }, tapped: true },
      { id: 'b1', controller: p2, owner: p2, card: { id: 'b1c', name: 'Goblin', type_line: 'Creature — Goblin' }, tapped: true },
      { id: 'land', controller: p1, owner: p1, card: { id: 'lc', name: 'Forest', type_line: 'Basic Land — Forest' } },
    ],
  } as GameState;
}

describe('Reins of Power mass exchange_control', () => {
  it('parses untap, mass exchange, and haste', () => {
    const ir = parseOracleTextToIR(REINS_ORACLE, 'Reins of Power');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toEqual([
      'tap_or_untap',
      'exchange_control',
      'grant_temporary_ability',
    ]);
    expect(steps[0]).toMatchObject({
      kind: 'tap_or_untap',
      mode: 'untap',
    });
    expect(String((steps[0] as any)?.target?.text || '')).toBe(
      'all creatures you control and all creatures target opponent controls',
    );
    expect(steps[1]).toMatchObject({
      kind: 'exchange_control',
      first: { kind: 'raw', text: 'all creatures you control' },
      second: { kind: 'raw', text: 'all creatures that opponent controls' },
    });
  });

  it('swaps all creatures, grants haste, and reverts at cleanup', () => {
    const steps = parseOracleTextToIR(REINS_ORACLE, 'Reins of Power').abilities.flatMap(
      (ability) => ability.steps || [],
    );
    const result = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        targetPlayerId: 'p2' as PlayerID,
        targetOpponentId: 'p2' as PlayerID,
      }),
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual([
      'tap_or_untap',
      'exchange_control',
      'grant_temporary_ability',
    ]);
    expect(result.automationGaps).toEqual([]);

    const battlefield = result.state.battlefield as any[];
    const a1 = battlefield.find((perm) => perm.id === 'a1');
    const a2 = battlefield.find((perm) => perm.id === 'a2');
    const b1 = battlefield.find((perm) => perm.id === 'b1');
    const land = battlefield.find((perm) => perm.id === 'land');

    expect(a1.controller).toBe('p2');
    expect(a2.controller).toBe('p2');
    expect(b1.controller).toBe('p1');
    expect(land.controller).toBe('p1');
    expect(a1.tapped).toBe(false);
    expect(a2.tapped).toBe(false);
    expect(b1.tapped).toBe(false);
    expect(hasHaste(a1)).toBe(true);
    expect(hasHaste(a2)).toBe(true);
    expect(hasHaste(b1)).toBe(true);
    expect(hasHaste(land)).toBe(false);

    const effects = (result.state as any).controlChangeEffects || [];
    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ permanentId: 'a1', originalController: 'p1', newController: 'p2', duration: 'until_end_of_turn' }),
        expect.objectContaining({ permanentId: 'b1', originalController: 'p2', newController: 'p1', duration: 'until_end_of_turn' }),
      ]),
    );

    const cleanup = executeCleanupStep(result.state, 'p1' as PlayerID);
    const after = cleanup.state.battlefield as any[];
    expect(after.find((perm) => perm.id === 'a1')?.controller).toBe('p1');
    expect(after.find((perm) => perm.id === 'a2')?.controller).toBe('p1');
    expect(after.find((perm) => perm.id === 'b1')?.controller).toBe('p2');
  });
});
