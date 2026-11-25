import { beforeEach, describe, expect, it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';

const TRISKELION_ABILITY =
  'Remove a +1/+1 counter from this creature: It deals 1 damage to any target.';

function makeCtx(gameId: string) {
  const state: any = {
    players: [
      { id: 'p1', name: 'P1', life: 40 },
      { id: 'p2', name: 'P2', life: 40 },
    ],
    life: { p1: 40, p2: 40 },
    turnNumber: 3,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield: [
      {
        id: 'trisk',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'trisk_c',
          name: 'Triskelion',
          type_line: 'Artifact Creature — Construct',
          oracle_text: TRISKELION_ABILITY,
        },
        counters: { '+1/+1': 2 },
      },
      {
        id: 'bear',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'bear_c', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        damage: 0,
      },
    ],
    zones: {
      p1: { hand: [], library: [], graveyard: [], exile: [] },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  };
  return { state, gameId, bumpSeq: () => {}, libraries: new Map() } as any;
}

describe('Triskelion activated deal_damage via Oracle IR', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  it('parses any-target requirements for the remove-counter ability', () => {
    const reqs = parseTargetRequirements(TRISKELION_ABILITY);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toContain('any');
    expect(reqs.minTargets).toBe(1);
  });

  it('deals 1 damage to a bound creature target', () => {
    const gameId = `trisk_creature_${Date.now()}`;
    const ctx = makeCtx(gameId);
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Triskelion',
      oracleText: TRISKELION_ABILITY,
      sourcePermanentId: 'trisk',
      sourceItem: { id: 'stk_t', source: 'trisk', targets: ['bear'] },
      targets: ['bear'],
      allowOptional: true,
    });
    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    const bear = ctx.state.battlefield.find((p: any) => p.id === 'bear');
    expect(Number(bear?.damage || 0)).toBeGreaterThanOrEqual(1);
  });

  it('deals 1 damage to a bound player target', () => {
    const gameId = `trisk_player_${Date.now()}`;
    const ctx = makeCtx(gameId);
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Triskelion',
      oracleText: TRISKELION_ABILITY,
      sourcePermanentId: 'trisk',
      sourceItem: { id: 'stk_t2', source: 'trisk', targets: ['p2'] },
      targets: ['p2'],
      allowOptional: true,
    });
    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    expect(Number(ctx.state.life?.p2 ?? 40)).toBe(39);
  });

  it('fails all-or-nothing when any-target is unbound (activation must supply targets)', () => {
    const gameId = `trisk_unbound_${Date.now()}`;
    const ctx = makeCtx(gameId);
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Triskelion',
      oracleText: TRISKELION_ABILITY,
      sourcePermanentId: 'trisk',
      sourceItem: { id: 'stk_t3', source: 'trisk' },
      allowOptional: true,
    });
    expect(result.handled).toBe(false);
    expect(result.applied).toBe(0);
  });
});
