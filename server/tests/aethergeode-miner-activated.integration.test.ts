import { beforeEach, describe, expect, it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const AETHERGEODE =
  "Pay {E}{E}: Exile this creature, then return it to the battlefield under its owner's control.";

function makeCtx(gameId: string) {
  const state: any = {
    players: [
      { id: 'p1', name: 'P1', life: 40, counters: { energy: 2 } },
      { id: 'p2', name: 'P2', life: 40 },
    ],
    life: { p1: 40, p2: 40 },
    energy: { p1: 2, p2: 0 },
    turnNumber: 5,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield: [
      {
        id: 'miner',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'miner_c',
          name: 'Aethergeode Miner',
          type_line: 'Creature — Dwarf Scout',
          oracle_text: AETHERGEODE,
        },
      },
    ],
    zones: {
      p1: { hand: [], library: [], graveyard: [], exile: [], handCount: 0, libraryCount: 0 },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  };
  return {
    state,
    gameId,
    bumpSeq: () => {},
    libraries: new Map([['p1', []], ['p2', []]]),
  } as any;
}

describe('Aethergeode Miner activated flicker via Oracle IR', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  it('exiles then returns the source when sourcePermanentId is bound', () => {
    const gameId = `aethergeode_${Date.now()}`;
    const ctx = makeCtx(gameId);
    const beforeId = 'miner';

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Aethergeode Miner',
      oracleText: AETHERGEODE,
      sourcePermanentId: beforeId,
      sourceItem: { id: 'stk_energy', source: beforeId },
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    const battlefield = ctx.state.battlefield || [];
    expect(battlefield.some((perm: any) => String(perm?.card?.name || '') === 'Aethergeode Miner')).toBe(true);
    expect(battlefield.some((perm: any) => String(perm?.id || '') === beforeId)).toBe(false);
    expect((ctx.state.zones?.p1?.exile || []).length).toBe(0);
    expect(ResolutionQueueManager.getQueue(gameId)?.steps?.length || 0).toBe(0);
  });

  it('reads source from sourceItem.source when sourcePermanentId is omitted', () => {
    const gameId = `aethergeode_item_${Date.now()}`;
    const ctx = makeCtx(gameId);

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Aethergeode Miner',
      oracleText: AETHERGEODE,
      stackItemId: 'stk_only',
      sourceItem: { id: 'stk_only', source: 'miner' },
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    expect((ctx.state.battlefield || []).some((perm: any) => String(perm?.card?.name || '') === 'Aethergeode Miner')).toBe(true);
  });

  it('falls back to unique controller+name when stack item omits source', () => {
    const gameId = `aethergeode_name_${Date.now()}`;
    const ctx = makeCtx(gameId);

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Aethergeode Miner',
      oracleText: AETHERGEODE,
      stackItemId: 'stk_orphan',
      sourceItem: { id: 'stk_orphan' },
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    expect((ctx.state.battlefield || []).some((perm: any) => String(perm?.card?.name || '') === 'Aethergeode Miner')).toBe(true);
    expect((ctx.state.battlefield || []).some((perm: any) => String(perm?.id || '') === 'miner')).toBe(false);
  });
});
