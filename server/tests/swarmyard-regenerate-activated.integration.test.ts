import { beforeEach, describe, expect, it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';
import { buildActivatedAbilityValidTargets } from '../src/socket/resolutionActivatedAbilityTargetingUtils.js';

const SWARMYARD_REGEN =
  '{T}: Regenerate target Insect, Rat, Spider, or Squirrel.';

function makeCtx(gameId: string, extras: { insect?: boolean; secondRat?: boolean } = {}) {
  const battlefield: any[] = [
    {
      id: 'yard',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'y', name: 'Swarmyard', type_line: 'Land', oracle_text: SWARMYARD_REGEN },
    },
    {
      id: 'rat',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'r', name: 'Pack Rat', type_line: 'Creature — Rat' },
    },
    {
      id: 'bear',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'b', name: 'Bear', type_line: 'Creature — Bear' },
    },
  ];
  if (extras.insect) {
    battlefield.push({
      id: 'insect',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'i', name: 'Bug', type_line: 'Creature — Insect' },
    });
  }
  if (extras.secondRat) {
    battlefield.push({
      id: 'rat2',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'r2', name: 'Other Rat', type_line: 'Creature — Rat' },
    });
  }
  const state: any = {
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    life: { p1: 40, p2: 40 },
    turnNumber: 2,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield,
    zones: {
      p1: { hand: [], library: [], graveyard: [], exile: [] },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  };
  return { state, gameId, bumpSeq: () => {}, libraries: new Map() } as any;
}

describe('Swarmyard regenerate via Oracle IR', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  it('activation targeting accepts Rat and Insect for the subtype union', () => {
    const reqs = parseTargetRequirements(SWARMYARD_REGEN);
    expect(reqs.targetTypes.map((t) => String(t).toLowerCase()).sort()).toEqual([
      'insect',
      'rat',
      'spider',
      'squirrel',
    ]);
    const ctx = makeCtx('swarm_targets', { insect: true });
    const ids = buildActivatedAbilityValidTargets(ctx, 'p1', reqs, {
      sourcePermanentId: 'yard',
      abilityText: SWARMYARD_REGEN,
    }).map((t) => t.id).sort();
    expect(ids).toEqual(['insect', 'rat']);
  });

  it('regenerates a bound Rat target', () => {
    const gameId = `swarm_bound_${Date.now()}`;
    const ctx = makeCtx(gameId, { insect: true });
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Swarmyard',
      oracleText: SWARMYARD_REGEN,
      sourcePermanentId: 'yard',
      sourceItem: { id: 'stk_s', source: 'yard', targets: ['rat'] },
      targets: ['rat'],
      allowOptional: true,
    });
    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    const shields = Array.isArray((ctx.state as any).regenerationShields)
      ? (ctx.state as any).regenerationShields
      : [];
    expect(shields.some((s: any) => String(s?.permanentId || s?.id || '') === 'rat')).toBe(true);
  });

  it('rejects a Bear that is outside the subtype union', () => {
    const gameId = `swarm_bear_${Date.now()}`;
    const ctx = makeCtx(gameId);
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Swarmyard',
      oracleText: SWARMYARD_REGEN,
      sourcePermanentId: 'yard',
      sourceItem: { id: 'stk_s2', source: 'yard', targets: ['bear'] },
      targets: ['bear'],
      allowOptional: true,
    });
    expect(result.handled).toBe(false);
    expect(result.applied).toBe(0);
  });

  it('fails all-or-nothing when multiple legal creatures exist and no target is bound', () => {
    const gameId = `swarm_multi_${Date.now()}`;
    const ctx = makeCtx(gameId, { insect: true });
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Swarmyard',
      oracleText: SWARMYARD_REGEN,
      sourcePermanentId: 'yard',
      sourceItem: { id: 'stk_s3', source: 'yard' },
      allowOptional: true,
    });
    expect(result.handled).toBe(false);
    expect(result.applied).toBe(0);
  });
});
