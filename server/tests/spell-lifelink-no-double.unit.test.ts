import { expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';

const rs = { id: 'rs', controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: 'rsc', name: 'Radiant Scrollwielder', type_line: 'Creature \u2014 Dwarf Cleric', oracle_text: 'Instant and sorcery spells you control have lifelink.', power: '2', toughness: '4', colors: ['R', 'W'] } };

function run(targets: any[], bf: any[] = []) {
  const g: any = createInitialGameState('lifelink_no_double_' + Math.random());
  g.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' });
  g.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' });
  g.state.battlefield = [JSON.parse(JSON.stringify(rs)), ...bf];
  g.state.life.p1 = 30; g.state.life.p2 = 40;
  g.state.stack = [{ id: 'bolt_st', type: 'spell', controller: 'p1', card: { id: 'boltc', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}' }, targets }];
  g.resolveTopOfStack();
  return g;
}

it('Bolt to a player with granted lifelink gains exactly 3 (no double count between spell paths)', () => {
  const g = run(['p2']);
  console.log('LIFE', g.state.life.p1, g.state.life.p2);
  expect(g.state.life.p2).toBe(37);
  expect(g.state.life.p1).toBe(33);
});

it('Bolt to a creature with granted lifelink gains exactly 3', () => {
  const bear = { id: 'bear', controller: 'p2', owner: 'p2', tapped: false, counters: {}, card: { id: 'bearc', name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '4' } };
  const g = run([{ kind: 'permanent', id: 'bear' }], [bear]);
  console.log('LIFE2', g.state.life.p1, JSON.stringify(g.state.battlefield.find((p: any) => p.id === 'bear')));
  expect(g.state.life.p1).toBe(33);
});
