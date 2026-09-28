import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function baseState(battlefield: any[]): GameState {
  return {
    players: [
      { id: p1, life: 40 },
      { id: p2, life: 40 },
    ],
    life: { p1: 40, p2: 40 },
    battlefield,
    turnNumber: 3,
  } as unknown as GameState;
}

function creature(id: string, controller: PlayerID, power: string, toughness: string, extra: any = {}): any {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    type_line: 'Creature - Bear',
    card: { id: `card-${id}`, name: id, type_line: 'Creature - Bear', power, toughness, oracle_text: '' },
    ...extra,
  };
}

function stepsFor(text: string, name: string): any[] {
  return parseOracleTextToIR(text, name).abilities.flatMap((ability) => ability.steps);
}

function markedDamage(state: GameState, id: string): number {
  const perm: any = (state.battlefield || []).find((entry: any) => entry.id === id);
  return Number(perm?.markedDamage ?? perm?.damageMarked ?? 0);
}

function lifeOf(state: GameState, playerId: string): number {
  return Number((state.players.find((player: any) => player.id === playerId) as any)?.life);
}

describe('"damage equal to its power" steps deal real damage using current power', () => {
  it('Justice Strike: target creature deals damage to itself equal to its current power (hook)', () => {
    const state = baseState([creature('bear', p2, '2', '6')]);
    const steps = stepsFor('Target creature deals damage to itself equal to its power.', 'Justice Strike');
    const result = applyOracleIRStepsToGameState(state, steps as any, {
      controllerId: p1,
      sourceId: 'justice-strike',
      sourceName: 'Justice Strike',
      targetCreatureId: 'bear',
      selectorContext: { targetCreatureId: 'bear', chosenObjectIds: ['bear'] },
      // Server hook: printed 2, but anthems/pumps make it a 5/6 right now.
      resolveCurrentPowerToughness: (_gs: any, perm: any) => (perm?.id === 'bear' ? { power: 5, toughness: 6 } : null),
    } as any);
    expect(markedDamage(result.state, 'bear')).toBe(5);
  });

  it('Justice Strike without the hook still counts +1/+1 counters (not printed power)', () => {
    const state = baseState([creature('bear', p2, '2', '6', { counters: { '+1/+1': 2 } })]);
    const steps = stepsFor('Target creature deals damage to itself equal to its power.', 'Justice Strike');
    const result = applyOracleIRStepsToGameState(state, steps as any, {
      controllerId: p1,
      sourceId: 'justice-strike',
      sourceName: 'Justice Strike',
      targetCreatureId: 'bear',
      selectorContext: { targetCreatureId: 'bear', chosenObjectIds: ['bear'] },
    } as any);
    expect(markedDamage(result.state, 'bear')).toBe(4);
  });

  it('Wisecrack wording ("deals damage equal to its power to itself") marks damage too', () => {
    const state = baseState([creature('bear', p2, '3', '5')]);
    const steps = stepsFor('Target creature deals damage equal to its power to itself.', 'Wisecrack');
    const result = applyOracleIRStepsToGameState(state, steps as any, {
      controllerId: p1,
      sourceId: 'wisecrack',
      sourceName: 'Wisecrack',
      targetCreatureId: 'bear',
      selectorContext: { targetCreatureId: 'bear', chosenObjectIds: ['bear'] },
    } as any);
    expect(markedDamage(result.state, 'bear')).toBe(3);
  });

  it("Boros Fury-Shield: the living creature's controller is dealt damage equal to its current power", () => {
    const state = baseState([creature('attacker', p2, '2', '2')]);
    const step = {
      kind: 'deal_damage',
      amount: { kind: 'object_stat', subject: 'source', stat: 'power' },
      source: { kind: 'raw', text: 'Boros Fury-Shield' },
      target: { kind: 'raw', text: "that creature's controller" },
      raw: "Boros Fury-Shield deals damage to that creature's controller equal to the creature's power",
    };
    const result = applyOracleIRStepsToGameState(state, [step] as any, {
      controllerId: p1,
      sourceId: 'fury-shield',
      sourceName: 'Boros Fury-Shield',
      targetCreatureId: 'attacker',
      selectorContext: { targetCreatureId: 'attacker', chosenObjectIds: ['attacker'] },
      resolveCurrentPowerToughness: (_gs: any, perm: any) => (perm?.id === 'attacker' ? { power: 6, toughness: 2 } : null),
    } as any);
    expect(lifeOf(result.state, 'p2')).toBe(34);
    expect(lifeOf(result.state, 'p1')).toBe(40);
  });

  it("Kaervek's Purge: a destroyed creature's controller takes its recorded (last known) power", () => {
    const state = baseState([]);
    const step = {
      kind: 'deal_damage',
      amount: { kind: 'object_stat', subject: 'source', stat: 'power' },
      source: { kind: 'raw', text: "Kaervek's Purge" },
      target: { kind: 'raw', text: "the creature's controller" },
      raw: "Kaervek's Purge deals damage equal to the creature's power to the creature's controller",
    };
    const result = applyOracleIRStepsToGameState(state, [step] as any, {
      controllerId: p1,
      sourceId: 'purge',
      sourceName: "Kaervek's Purge",
      lastDestroyedPermanents: [creature('dead', p2, '4', '4')],
    } as any);
    expect(lifeOf(result.state, 'p2')).toBe(36);
  });
});

describe('pump spells parse into a single modify_pt step', () => {
  it('"gets +2/+2 until end of turn. Draw a card." has one ability and one modify_pt', () => {
    const ir = parseOracleTextToIR('Target creature you control gets +2/+2 until end of turn. Draw a card.', 'Pump Draw');
    const kinds = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));
    expect(ir.abilities).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'modify_pt')).toHaveLength(1);
    expect(kinds).toContain('draw');
  });

  it('pump-then-fight has one modify_pt step', () => {
    const ir = parseOracleTextToIR(
      "Target creature you control gets +1/+0 until end of turn. It fights target creature you don't control.",
      'Pump Fight',
    );
    const kinds = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));
    expect(kinds.filter((kind) => kind === 'modify_pt')).toHaveLength(1);
  });
});
describe('Oracle IR "add mana equal to its power" uses current power', () => {
  it('Gyre Sage-style mana ability reads the current-P/T hook (printed 1, currently 5)', () => {
    const ir = parseOracleTextToIR("{T}: Add an amount of {G} equal to Gyre Sage's power.", 'Gyre Sage');
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    const state = { ...baseState([creature('sage', p1, '1', '1')]), manaPool: {} } as any;
    const result: any = applyOracleIRStepsToGameState(state, steps as any, {
      controllerId: p1,
      sourceId: 'sage',
      sourceName: 'Gyre Sage',
      resolveCurrentPowerToughness: (_gs: any, perm: any) => (perm?.id === 'sage' ? { power: 5, toughness: 1 } : null),
    } as any);
    expect(result.state.manaPool.p1.green).toBe(5);
  });

  it('without the hook, +1/+1 counters still count', () => {
    const ir = parseOracleTextToIR("{T}: Add an amount of {G} equal to Gyre Sage's power.", 'Gyre Sage');
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    const state = { ...baseState([creature('sage', p1, '1', '1', { counters: { '+1/+1': 3 } })]), manaPool: {} } as any;
    const result: any = applyOracleIRStepsToGameState(state, steps as any, {
      controllerId: p1,
      sourceId: 'sage',
      sourceName: 'Gyre Sage',
    } as any);
    expect(result.state.manaPool.p1.green).toBe(4);
  });
});