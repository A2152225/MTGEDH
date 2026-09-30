import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseForAsLongAsLinkCondition } from '../src/oracleIRParserForAsLongAsPtClauses';

const creature = (id: string, controller = 'p1') => ({
  id, controller, owner: controller, tapped: false,
  card: { id: `c-${id}`, name: `Bear ${id}`, type_line: 'Creature - Bear', power: '2', toughness: '2' },
});

function stepsOf(text: string, name: string): any[] {
  const ir: any = parseOracleTextToIR(text, name);
  return ir.abilities.flatMap((a: any) => a.steps);
}

describe('for as long as P/T pumps: parse + executor stamping', () => {
  it('parses the link condition kinds', () => {
    expect(parseForAsLongAsLinkCondition('this artifact remains tapped')).toEqual({ kind: 'source_tapped' });
    expect(parseForAsLongAsLinkCondition('this Equipment remains attached to it')).toEqual({ kind: 'source_attached' });
    expect(parseForAsLongAsLinkCondition('you control this creature')).toEqual({ kind: 'controller_controls_source' });
    expect(parseForAsLongAsLinkCondition('you control a Forest')).toEqual({ kind: 'controller_controls_matching', matching: 'forest' });
    expect(parseForAsLongAsLinkCondition('it is your turn')).toBeNull();
  });

  it('Flowstone Armor / Thran Weaponry / attach / control parse with a linkCondition and no residual', () => {
    const cases: Array<[string, string, string, any]> = [
      ['Flowstone Armor', 'Target creature gets +1/-1 for as long as this artifact remains tapped.', 'Target creature', { kind: 'source_tapped' }],
      ['Thran Weaponry', 'All creatures get +2/+2 for as long as this artifact remains tapped.', 'All creatures', { kind: 'source_tapped' }],
      ['Attach', 'Target creature gets +2/+2 for as long as this Equipment remains attached to it.', 'Target creature', { kind: 'source_attached' }],
      ['Control', 'Target creature gets +1/+1 for as long as you control this creature.', 'Target creature', { kind: 'controller_controls_source' }],
      ['Verdant Crown', 'Target creature gets +2/+2 for as long as you control a Forest.', 'Target creature', { kind: 'controller_controls_matching', matching: 'forest' }],
    ];
    for (const [name, text, target, link] of cases) {
      const steps = stepsOf(text, name);
      expect(steps).toHaveLength(1);
      expect(steps[0].kind).toBe('grant_static_ability');
      expect(steps[0].target.text).toBe(target);
      expect(steps[0].linkCondition).toEqual(link);
    }
  });

  it('executing Thran Weaponry stamps every creature with a source-linked modifier', () => {
    const steps = stepsOf('All creatures get +2/+2 for as long as this artifact remains tapped.', 'Thran Weaponry');
    const state: any = {
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: {}, turnNumber: 4,
      battlefield: [creature('a'), creature('b', 'p2'),
        { id: 'tw', controller: 'p1', owner: 'p1', tapped: true, card: { id: 'tw', name: 'Thran Weaponry', type_line: 'Artifact' } }],
    };
    const res = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1', sourceId: 'tw', sourceName: 'Thran Weaponry',
    } as any, { allowOptional: true });
    const bf: any[] = (res.state as any).battlefield;
    for (const id of ['a', 'b']) {
      const mods = bf.find(p => p.id === id).modifiers;
      expect(mods).toHaveLength(1);
      expect(mods[0]).toMatchObject({
        type: 'powerToughness', power: 2, toughness: 2, sourceId: 'tw', linkCondition: { kind: 'source_tapped' }, linkControllerId: 'p1',
      });
    }
  });
});