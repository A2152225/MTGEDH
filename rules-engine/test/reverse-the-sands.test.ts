import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyRedistributeLifeTotalsStep } from '../src/oracleIRExecutorPlayerStepHandlers';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src';

function collectSteps(value: unknown): any[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectSteps);
  const record = value as Record<string, unknown>;
  if (record.kind) return [record];
  return Object.values(record).flatMap(collectSteps);
}

describe('Reverse the Sands life redistribution', () => {
  const oracleText =
    "Redistribute any number of players' life totals. (Each of those players gets one life total back.)";

  it('parses redistribute life totals as redistribute_life_totals step', () => {
    const ir = parseOracleTextToIR(oracleText, 'Reverse the Sands');
    const steps = collectSteps(ir.abilities);
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'redistribute_life_totals',
        raw: "Redistribute any number of players' life totals",
      }),
    ]);
  });

  it('requires player choice until redistribution is supplied', () => {
    const state = {
      players: [
        { id: 'p1', name: 'Alice', life: 20 },
        { id: 'p2', name: 'Bob', life: 30 },
        { id: 'p3', name: 'Carol', life: 40 },
      ],
      life: { p1: 20, p2: 30, p3: 40 },
    } as GameState;

    const step = {
      kind: 'redistribute_life_totals',
      raw: "Redistribute any number of players' life totals",
    } as const;

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1', sourceName: 'Reverse the Sands' });
    const pending = applyRedistributeLifeTotalsStep(state, step, ctx);
    expect(pending.applied).toBe(false);
    expect(pending.reason).toBe('player_choice_required');

    const applied = applyRedistributeLifeTotalsStep(state, step, {
      ...ctx,
      selectorContext: {
        lifeRedistributionByPlayerId: {
          p1: 40,
          p2: 30,
          p3: 20,
        },
      },
    });
    expect(applied.applied).toBe(true);
    expect((applied.state as any).life).toEqual({ p1: 40, p2: 30, p3: 20 });
  });
});
