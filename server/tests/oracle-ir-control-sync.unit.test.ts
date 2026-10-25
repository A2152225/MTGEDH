import { describe, expect, it, vi } from 'vitest';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { registerControlEffect } from '../src/state/modules/continuousEffectRegistry.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';

function setup() {
  const bear = { id: 'bear', owner: 'p2', controller: 'p2', tapped: false, counters: {},
    card: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2' } } as any;
  const state: any = {
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    life: { p1: 40, p2: 40 },
    battlefield: [bear], stack: [], turnNumber: 1, turn: 1,
    zones: { p1: { hand: [], library: [], graveyard: [], exile: [] }, p2: { hand: [], library: [], graveyard: [], exile: [] } },
  };
  const ctx: any = { gameId: 'test_ir_control_sync', state, libraries: new Map([['p1', []], ['p2', []]]), bumpSeq: vi.fn(), io: { to: () => ({ emit: vi.fn() }) } };
  return { bear, state, ctx };
}

function run(ctx: any, state: any, text: string, target?: string) {
  const steps = parseOracleTextToIR(text, 'Test Source').abilities?.[0]?.steps || [];
  expect(steps.length).toBeGreaterThan(0);
  const irCtx = buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Test Source', ...(target ? { targetPermanentId: target } : {}) } as any);
  applyOracleIRStepsOnServer(ctx, state, steps, irCtx, { allowOptional: false }, { controller: 'p1' });
}

describe('applyOracleIRStepsOnServer syncs controllers from the control registry', () => {
  it('a stale controller field is corrected from the registry after any IR execution', () => {
    const { bear, state, ctx } = setup();
    registerControlEffect(state, { permanentId: 'bear', originalController: 'p2', newController: 'p1', duration: 'permanent', sourceId: 'earlier_steal' } as any);
    expect(bear.controller).toBe('p2');
    run(ctx, state, 'You gain 1 life.');
    expect(state.battlefield.find((p: any) => p.id === 'bear')?.controller).toBe('p1');
  });

  it('an IR gain-control step leaves registry and controller in agreement', () => {
    const { state, ctx } = setup();
    run(ctx, state, 'Gain control of target creature.', 'bear');
    const bear = state.battlefield.find((p: any) => p.id === 'bear');
    expect(bear?.controller).toBe('p1');
    const entries = [...(state.permanentControlEffects || []), ...(state.controlChangeEffects || [])]
      .filter((e: any) => String(e.permanentId) === 'bear');
    expect(entries.some((e: any) => e.newController === 'p1')).toBe(true);
  });
});
