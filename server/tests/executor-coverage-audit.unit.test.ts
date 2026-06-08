import { describe, expect, it } from 'vitest';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  classifyExecutionResult,
  collectAutoSelectedModeIds,
  countOracleSteps,
  dryRunOracleSteps,
} from '../scripts/executor-coverage-audit.ts';

describe('executor coverage audit helpers', () => {
  it('counts recognized vs unknown nested steps', () => {
    const counts = countOracleSteps([
      { kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw: 'Draw a card.' } as any,
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'If you do' },
        steps: [{ kind: 'unknown', raw: 'do something weird' } as any],
        raw: 'If you do, do something weird',
      } as any,
    ]);
    expect(counts.total).toBe(3);
    expect(counts.unknown).toBe(1);
    expect(counts.recognized).toBe(2);
  });

  it('auto-selects the first choose_mode label', () => {
    const ids = collectAutoSelectedModeIds([
      {
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
        modes: [
          { label: 'Mode A', raw: '• Draw a card.', steps: [] },
          { label: 'Mode B', raw: '• Destroy target creature.', steps: [] },
        ],
        raw: 'Choose one.',
      } as any,
    ]);
    expect(ids).toEqual(['Mode A']);
  });

  it('classifies a clean draw effect as fully applied', () => {
    const record = dryRunOracleSteps(
      [{ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw: 'Draw a card.' } as any],
      'Test Card',
      []
    );
    expect(record.status).toBe('fully_applied');
    expect(record.applied).toBeGreaterThan(0);
    expect(record.skipped).toBe(0);
  });

  it('classifies unknown IR as ir_gap without executing', () => {
    const record = classifyExecutionResult(
      { state: buildAuditFixtureState(), log: [], appliedSteps: [], skippedSteps: [], automationGaps: [], pendingOptionalSteps: [] },
      { total: 1, unknown: 1, recognized: 0 },
      ['weird clause']
    );
    expect(record.status).toBe('ir_gap');
  });

  it('builds an execution context with target bindings', () => {
    const ctx = buildAuditExecutionContext('Sol Ring');
    expect(ctx.controllerId).toBe('p1');
    expect(ctx.targetCreatureId).toBe('bf-creature-1');
    expect(ctx.selectorContext?.targetSpellId).toBe('stack-spell-1');
  });
});
