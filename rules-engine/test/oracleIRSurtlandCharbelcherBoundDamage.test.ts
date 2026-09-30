import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const SURTLAND_TEXT =
  "Whenever this creature attacks, you may sacrifice another creature. When you do, this creature deals damage equal to the sacrificed creature's power to any target. If the sacrificed creature was a Giant, this creature deals twice that much damage instead.";
const CHARBELCHER_TEXT =
  'Reveal cards from the top of your library until you reveal a land card. This artifact deals damage equal to the number of nonland cards revealed this way to any target. If the revealed land card was a Mountain, this artifact deals double that damage instead. Put the revealed cards on the bottom of your library in any order.';

const permanent = (id: string, typeLine: string, power: string, extra: Record<string, unknown> = {}) => ({
  id,
  controller: 'p1',
  owner: 'p1',
  counters: {},
  card: { name: id, type_line: typeLine, power, toughness: '3', oracle_text: '' },
  ...extra,
});
const card = (name: string, typeLine: string) => ({ id: `${name}-card`, name, type_line: typeLine });

function surtlandLife(sacrificedTypeLine: string): number {
  const steps = parseOracleTextToIR(SURTLAND_TEXT, 'Surtland Flinger').abilities.flatMap((a: any) => a.steps);
  const state: any = {
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    life: { p1: 40, p2: 40 },
    battlefield: [permanent('flinger', 'Creature — Giant Berserker', '4'), permanent('fodder', sacrificedTypeLine, '3')],
    turnNumber: 2,
  };
  const result: any = applyOracleIRStepsToGameState(
    state,
    steps as any,
    { controllerId: 'p1', sourceId: 'flinger', sourceName: 'Surtland Flinger', selectorContext: { targetPlayerId: 'p2', chosenObjectIds: ['fodder'] } } as any,
    { allowOptional: true },
  );
  return result.state.life.p2;
}

function charbelcherLife(landName: string): { life: number; log: string[] } {
  const steps = parseOracleTextToIR(CHARBELCHER_TEXT, 'Goblin Charbelcher').abilities.flatMap((a: any) => a.steps);
  const state: any = {
    players: [
      { id: 'p1', life: 40, library: [card('A', 'Instant'), card('B', 'Sorcery'), card('C', 'Creature — Elf'), card(landName, `Basic Land — ${landName}`), card('Z', 'Land')] },
      { id: 'p2', life: 40 },
    ],
    life: { p1: 40, p2: 40 },
    battlefield: [permanent('belcher', 'Artifact', '0')],
    turnNumber: 2,
  };
  const result: any = applyOracleIRStepsToGameState(
    state,
    steps as any,
    { controllerId: 'p1', sourceId: 'belcher', sourceName: 'Goblin Charbelcher', selectorContext: { targetPlayerId: 'p2' } } as any,
  );
  return { life: result.state.life.p2, log: result.log };
}

describe('Surtland Flinger: sacrificed Giant doubles the damage', () => {
  it('parses the doubled damage as a conditional inside the reflexive trigger, with no leftover residual', () => {
    const steps: any[] = parseOracleTextToIR(SURTLAND_TEXT, 'Surtland Flinger').abilities.flatMap((a: any) => a.steps);
    expect(steps.map((s) => s.kind)).toEqual(['sacrifice', 'schedule_delayed_trigger']);
    const nested = steps[1].steps;
    expect(nested).toHaveLength(1);
    expect(nested[0].kind).toBe('conditional');
    expect(nested[0].condition.raw).toBe('the sacrificed creature was a giant');
    expect(nested[0].steps[0].amount.multiplier).toBe(2);
    expect(nested[0].elseSteps[0].amount.multiplier).toBeUndefined();
  });

  it('deals twice the sacrificed power when the sacrificed creature was a Giant', () => {
    expect(surtlandLife('Creature — Giant')).toBe(34);
  });

  it('deals the plain sacrificed power otherwise', () => {
    expect(surtlandLife('Creature — Elf')).toBe(37);
  });
});

describe('Goblin Charbelcher: Mountain doubles the damage', () => {
  it('folds the doubled damage into a conditional', () => {
    const steps: any[] = parseOracleTextToIR(CHARBELCHER_TEXT, 'Goblin Charbelcher').abilities.flatMap((a: any) => a.steps);
    expect(steps[1].kind).toBe('conditional');
    expect(steps[1].condition.raw).toBe('the revealed land card was a mountain');
  });

  it('deals double the nonland count when the revealed land is a Mountain', () => {
    expect(charbelcherLife('Mountain').life).toBe(34);
  });

  it('deals the nonland count when the revealed land is not a Mountain', () => {
    expect(charbelcherLife('Forest').life).toBe(37);
  });
});

describe('Batch389 bound-target damage is no longer log-only', () => {
  const baseCtx = { controllerId: 'p1', sourceId: 'src', sourceName: 'Src' } as any;

  it('this permanent deals N damage to that creature marks damage on the bound creature', () => {
    const step: any = {
      kind: 'deal_damage',
      amount: { kind: 'number', value: 3 },
      source: { kind: 'raw', text: 'this permanent' },
      target: { kind: 'raw', text: 'that creature' },
      raw: 'This permanent deals 3 damage to that creature',
    };
    const state: any = {
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: { p1: 40, p2: 40 },
      battlefield: [permanent('victim', 'Creature — Bear', '2', { controller: 'p2' })],
      turnNumber: 2,
    };
    const result: any = applyOracleIRStepsToGameState(state, [step], { ...baseCtx, targetCreatureId: 'victim' });
    expect(result.state.battlefield.find((p: any) => p.id === 'victim').markedDamage).toBe(3);
  });

  it('this permanent deals that much damage to target player makes the player lose life', () => {
    const step: any = {
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'that much' },
      source: { kind: 'raw', text: 'this permanent' },
      target: { kind: 'raw', text: 'target player or planeswalker' },
      raw: 'This permanent deals that much damage to target player or planeswalker',
    };
    const state: any = {
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: { p1: 40, p2: 40 },
      battlefield: [],
      turnNumber: 2,
    };
    const result: any = applyOracleIRStepsToGameState(state, [step], {
      ...baseCtx,
      referenceAmount: 4,
      selectorContext: { targetPlayerId: 'p2' },
    });
    expect(result.state.life.p2).toBe(36);
  });

  it('this permanent deals that much damage to a bound planeswalker removes loyalty', () => {
    const step: any = {
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'that much' },
      source: { kind: 'raw', text: 'this permanent' },
      target: { kind: 'raw', text: 'target player or planeswalker' },
      raw: 'This permanent deals that much damage to target player or planeswalker',
    };
    const state: any = {
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: { p1: 40, p2: 40 },
      battlefield: [permanent('walker', 'Legendary Planeswalker — Test', '0', { controller: 'p2', loyalty: 5, counters: { loyalty: 5 } })],
      turnNumber: 2,
    };
    const result: any = applyOracleIRStepsToGameState(state, [step], {
      ...baseCtx,
      referenceAmount: 2,
      targetPermanentId: 'walker',
    });
    const walker = result.state.battlefield.find((p: any) => p.id === 'walker');
    expect(walker.loyalty).toBe(3);
    expect(result.state.life.p2).toBe(40);
  });
});