import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParserParseOracleTextToIR';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

// Issue #74: Hero of Bladehold's battle cry pumped itself when the trigger context carried the
// attacking source as targetCreatureId; "each other attacking creature" is a group selector.
describe('issue #74: battle cry group selector ignores the bound trigger creature', () => {
  it('pumps only the other attackers', () => {
    const HERO = 'Battle cry (Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn.)\nWhenever this creature attacks, create two 1/1 white Soldier creature tokens that are tapped and attacking.';
    const ir = parseOracleTextToIR(HERO, 'Hero of Bladehold');
    const mk = (id: string) => ({ id, controller: 'p1', owner: 'p1', attacking: 'p2', basePower: 3, baseToughness: 4, card: { name: id, type_line: 'Creature - Human Knight', power: '3', toughness: '4' } });
    const state: any = { players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [mk('hero'), mk('other')], turnNumber: 21 };
    const r: any = applyOracleIRStepsToGameState(state, ir.abilities[0].steps as any, { controllerId: 'p1', sourceId: 'hero', sourceName: 'Hero of Bladehold', targetCreatureId: 'hero' } as any);
    const byId = (id: string) => r.state.battlefield.find((p: any) => p.id === id);
    expect(byId('hero').modifiers ?? []).toHaveLength(0);
    expect(byId('other').modifiers).toEqual([expect.objectContaining({ power: 1, toughness: 0 })]);
  });
});
