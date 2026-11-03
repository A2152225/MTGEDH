import { describe, it, expect } from 'vitest';
import { inferTriggeredAbilityTargetMetadata, evaluateUpToXTargetCount } from '../src/state/modules/inferTriggeredAbilityTargetMetadata';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor';

const EFFECT = 'put a +1/+1 counter on each of up to X target creatures you control, where X is the number of opponents you attacked this turn.';
const MARTOK = 'Battlefront \u2014 Whenever you attack, ' + EFFECT;
const cr = (id: string) => ({ id, controller: 'p1', owner: 'p1', counters: {}, card: { id: id + '_c', name: 'Bear ' + id, type_line: 'Creature \u2014 Bear', power: '2', toughness: '2', oracle_text: '' } });
function state(attacked: string[]): any {
  return { id: 'g', format: 'commander', turnPlayer: 'p1', priority: 'p1', stack: [], startingLife: 40, life: {},
    attackedPlayersThisTurnByPlayer: { p1: attacked },
    players: ['p1', 'p2', 'p3', 'p4'].map((id, seat) => ({ id, name: id, seat, life: 40, library: [], hand: [], graveyard: [], exile: [] })),
    battlefield: [cr('a'), cr('b'), cr('c')] };
}

describe('ui42 up to X target (Martok)', () => {
  it('min 0, max = opponents attacked this turn', () => {
    const m = inferTriggeredAbilityTargetMetadata(EFFECT, { gameState: state(['p2', 'p3']), controllerId: 'p1' } as any);
    expect(m.requiresTarget).toBe(true);
    expect(m.minTargets).toBe(0);
    expect(m.maxTargets).toBe(2);
  });
  it('X tracks attacked count, 0 when none', () => {
    expect(evaluateUpToXTargetCount(EFFECT.toLowerCase(), { gameState: state(['p2', 'p3', 'p4']), controllerId: 'p1' } as any)).toBe(3);
    expect(evaluateUpToXTargetCount(EFFECT.toLowerCase(), { gameState: state([]), controllerId: 'p1' } as any)).toBe(0);
  });
  it('fixed up to N still works', () => {
    const m = inferTriggeredAbilityTargetMetadata('put a +1/+1 counter on up to one target creature.', { gameState: state([]), controllerId: 'p1' } as any);
    expect([m.minTargets, m.maxTargets]).toEqual([0, 1]);
  });
  it('executor puts counters on the chosen targets', () => {
    const ir: any = parseOracleTextToIR(MARTOK, 'Martok, Hero of the Empire');
    const steps = (ir.abilities || []).flatMap((a: any) => a.steps || []);
    const r: any = applyOracleIRStepsToGameState(state(['p2', 'p3']), steps, { controllerId: 'p1', sourceId: 'm', sourceName: 'Martok', selectorContext: { chosenObjectIds: ['a', 'b'] } } as any);
    const bf = r.state.battlefield;
    expect(bf.find((p: any) => p.id === 'a').counters['+1/+1']).toBe(1);
    expect(bf.find((p: any) => p.id === 'b').counters['+1/+1']).toBe(1);
    expect(bf.find((p: any) => p.id === 'c').counters['+1/+1'] || 0).toBe(0);
  });
});