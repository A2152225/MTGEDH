import { describe, expect, it } from 'vitest';
import { applyScheduleDelayedTriggerStep } from '../src/oracleIRExecutorBattlefieldDelayedTriggerSteps';

describe('round 24 next-cast rider deferral', () => {
  it('defers an on_event "when you next cast" rider to the server instead of the next end step', () => {
    const state: any = { players: [{ id: 'p1' }], battlefield: [], stack: [] };
    const step: any = { kind: 'schedule_delayed_trigger', timing: 'on_event', raw: 'when you next cast an instant or sorcery spell this turn, copy it', effect: 'copy it', steps: [] };
    const r: any = applyScheduleDelayedTriggerStep(state, step, { controllerId: 'p1', sourceName: 'Najal, the Storm Runner' } as any);
    expect(r.applied).toBe(true);
    expect(r.log).toContain('Deferred next-cast rider to server');
    expect(r.state.delayedTriggers || []).toHaveLength(0);
  });
});
