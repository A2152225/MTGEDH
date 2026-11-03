import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor';
import { applyCounterModifications } from '../src/state/modules/counters_tokens';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor';
import { createEmptyStepLedger } from '../../rules-engine/src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../src/state/modules/oracleIrTransitionPipeline.js';

const D = '\u2014';
const GEORDI = 'If you would put one or more charge counters on an artifact you control, put twice that many charge counters on that artifact instead.';
const ANNEX = 'If one or more charge counters would be put on an artifact you control, that many plus one charge counters are put on it instead.';
const PRAXIS = 'Strange new worlds ' + D + ' All creatures get -X/-X until end of turn, where X is the number of differently named lands you control. If X is 6 or more, create two 2/1 red Klingon Warrior creature tokens with haste.';
const GIFT_TAIL = 'Each opponent reveals cards from the top of their library until they reveal a creature card. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order.';

function lib(id: string) {
  return [
    { id: id + 'a', name: 'Isle', type_line: 'Land' },
    { id: id + 'b', name: 'Rock', type_line: 'Artifact' },
    { id: id + 'c', name: 'Bear', type_line: 'Creature' },
    { id: id + 'd', name: 'Zed', type_line: 'Land' },
  ];
}
function game(lands: number): any {
  return {
    id: 'g', turnPlayer: 'p1', stack: [],
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, hand: [], graveyard: [], exile: [], library: lib(id) })),
    battlefield: [
      ...Array.from({ length: lands }, (_, i) => ({ id: 'l' + i, controller: 'p1', owner: 'p1', counters: {}, card: { name: 'Land' + i, type_line: 'Land' } })),
      { id: 'cr', controller: 'p2', owner: 'p2', counters: {}, card: { name: 'Ogre', type_line: 'Creature', power: '9', toughness: '9' } },
    ],
  };
}
function stepsOf(text: string, name: string): any[] {
  return (parseOracleTextToIR(text, name) as any).abilities.flatMap((a: any) => a.steps);
}
function counterState(sources: string[], targetType: string, targetController = 'p1'): any {
  return {
    battlefield: [
      ...sources.map((o, i) => ({ id: 's' + i, controller: 'p1', card: { name: 'S' + i, type_line: 'Legendary Creature', oracle_text: o } })),
      { id: 't', controller: targetController, card: { name: 'T', type_line: targetType } },
    ],
  };
}

describe('round 33 control/static', () => {
  it('Praxis: binds X for "If X is 6 or more" from the where-X clause', () => {
    const steps = stepsOf(PRAXIS, 'The Destruction of Praxis');
    const cond = steps.find((s) => s.kind === 'conditional');
    expect(cond?.xWhereRaw).toMatch(/differently named lands/i);
    const six: any = applyOracleIRStepsToGameState(game(6), steps, { controllerId: 'p1', sourceId: 'src' } as any);
    expect(six.state.battlefield.filter((p: any) => p.isToken).length).toBe(2);
    const three: any = applyOracleIRStepsToGameState(game(3), steps, { controllerId: 'p1', sourceId: 'src' } as any);
    expect(three.state.battlefield.filter((p: any) => p.isToken).length).toBe(0);
  });

  it('Converge-style ability word before All creatures get -X/-X parses as modify_pt', () => {
    const steps = stepsOf('Converge ' + D + ' All creatures get -X/-X until end of turn, where X is the number of colors of mana spent to cast this spell.', 'Zed Spell');
    expect(steps.map((s) => s.kind)).toEqual(['modify_pt']);
    const steps2 = stepsOf('Radiance ' + D + ' Destroy target creature.', 'Zed Spell');
    expect(steps2[0]?.kind).toBe('destroy');
  });

  it('Choose one headers are not stripped as ability words', () => {
    const ir: any = parseOracleTextToIR('Choose one ' + D + '\n\u2022 Draw a card.\n\u2022 Destroy target artifact.', 'Zed Spell');
    expect(JSON.stringify(ir)).toMatch(/choose_mode/);
  });

  it('Gift of Perfection: reveal until they reveal a creature, rest to bottom in random order', () => {
    const steps = stepsOf(GIFT_TAIL, 'Gift of Perfection');
    expect(steps.map((s) => s.kind)).toEqual(['reveal_top', 'move_zone']);
    const r: any = applyOracleIRStepsToGameState(game(0), steps, { controllerId: 'p1', sourceId: 'src' } as any);
    const p1 = r.state.players.find((p: any) => p.id === 'p1');
    expect(p1.library.map((c: any) => c.name)).toEqual(['Isle', 'Rock', 'Bear', 'Zed']);
    for (const id of ['p2', 'p3']) {
      const p = r.state.players.find((x: any) => x.id === id);
      expect(p.library[0].name).toBe('Zed');
      expect(p.library.length).toBe(4);
    }
  });

  it('Geordi doubles charge counters on an artifact you control only', () => {
    expect(applyCounterModifications(counterState([GEORDI], 'Artifact'), 't', { charge: 2 }).charge).toBe(4);
    expect(applyCounterModifications(counterState([GEORDI], 'Artifact'), 't', { '+1/+1': 2 })['+1/+1']).toBe(2);
    expect(applyCounterModifications(counterState([GEORDI], 'Creature'), 't', { charge: 2 }).charge).toBe(2);
    expect(applyCounterModifications(counterState([GEORDI], 'Artifact', 'p2'), 't', { charge: 2 }).charge).toBe(2);
  });

  it('Optimization Annex adds one charge counter; stacks with Geordi', () => {
    expect(applyCounterModifications(counterState([ANNEX], 'Artifact'), 't', { charge: 1 }).charge).toBe(2);
    expect(applyCounterModifications(counterState([ANNEX], 'Land'), 't', { charge: 1 }).charge).toBe(1);
    const both = applyCounterModifications(counterState([GEORDI, ANNEX], 'Artifact'), 't', { charge: 1 }).charge;
    expect([3, 4]).toContain(both);
  });

  const CHARGE_SOURCES: Array<[string, string, string, number]> = [
    ['Sarcophagus, Ship of the Dead', 'Legendary Artifact ' + D + ' Spacecraft', "Whenever a creature dies, if Sarcophagus isn't a creature, put a charge counter on it.", 1],
    ['Maturation Chamber', 'Artifact', 'Whenever you cast an artifact spell, put a charge counter on this artifact.', 1],
    ['Door of Destinies', 'Artifact', 'Whenever you cast a spell of the chosen type, put a charge counter on this artifact.', 1],
    ['Romulan Bird-of-Prey', 'Artifact ' + D + ' Spacecraft', "Whenever you cast a noncreature spell, if this Spacecraft isn't a creature, put two charge counters on it.", 2],
    ['U.S.S. Enterprise-D, Galaxy-Class', 'Legendary Artifact ' + D + ' Spacecraft', '', 3],
  ];
  function runChargeSource(name: string, typeLine: string, text: string, base: number, mods: string[]): number {
    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [
        { id: 'src', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'src_c', name, type_line: typeLine, oracle_text: text } },
        ...mods.map((o, i) => ({ id: 'm' + i, controller: 'p1', owner: 'p1', counters: {}, card: { id: 'mc' + i, name: 'Mod' + i, type_line: 'Legendary Creature', oracle_text: o } })),
      ],
    };
    const parsed = text ? stepsOf(text, name).flatMap((s: any) => (s.kind === 'add_counter' ? [s] : [])) : [];
    const steps: any[] = parsed.length > 0 ? parsed : [{ kind: 'add_counter', raw: 'Put charge counters on this Spacecraft', target: { kind: 'raw', text: 'this permanent' }, counter: 'charge', amount: { kind: 'number', value: base } }];
    const haltState: any = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({ state, ledger: createEmptyStepLedger(), interactivePlayerChoices: true, haltState } as any);
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', serverBridge, transitionHaltState: haltState, currentStepIndex: 0 } as any);
    const r: any = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true } as any);
    return Number(r.state.battlefield.find((p: any) => p.id === 'src')?.counters?.charge || 0);
  }

  it('charge counters from Trek/artifact sources are doubled by Geordi and +1 by Annex', () => {
    for (const [name, typeLine, text, base] of CHARGE_SOURCES) {
      expect(runChargeSource(name, typeLine, text, base, []), name).toBe(base);
      expect(runChargeSource(name, typeLine, text, base, [GEORDI]), name).toBe(base * 2);
      expect(runChargeSource(name, typeLine, text, base, [ANNEX]), name).toBe(base + 1);
    }
  });
});
