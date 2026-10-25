import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { queueLifeThresholdStateTriggers } from '../src/state/modules/triggers/lifeThresholdStateTriggers.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';

const OPAL = 'When you have 10 or less life, if Opal Avenger is an enchantment, it becomes a 3/5 Soldier creature.';
function setup(id: string) {
  const g: any = createInitialGameState(id);
  g.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' });
  g.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' });
  for (const p of g.state.players) p.life = p.id === 'p1' ? 10 : 40;
  g.state.life = { ...(g.state.life || {}), p1: 10, p2: 40 };
  g.state.battlefield.push({ id: 'opal', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'opal_c', name: 'Opal Avenger', type_line: 'Enchantment', oracle_text: OPAL } });
  const q = queueLifeThresholdStateTriggers(g);
  expect(q).toHaveLength(1);
  if (!(g.state.stack || []).some((s: any) => s.triggerType === 'life_threshold')) g.state.stack.push(q[0]);
  return g;
}
const opal = (g: any) => g.state.battlefield.find((p: any) => p.id === 'opal');

describe('round 27 Opal Avenger resolution + recheck', () => {
  it('becomes a 3/5 Soldier creature and stops being an enchantment', () => {
    const g = setup('r27_opal_a');
    resolveTopOfStack(g);
    const o = opal(g);
    expect(String(o.card.type_line)).toMatch(/^Creature - Soldier$/);
    expect(o.basePower).toBe(3);
    expect(o.baseToughness).toBe(5);
  });
  it('does nothing if it is no longer an enchantment on resolution', () => {
    const g = setup('r27_opal_b');
    opal(g).card.type_line = 'Artifact';
    resolveTopOfStack(g);
    const o = opal(g);
    expect(o.card.type_line).toBe('Artifact');
    expect(o.basePower).toBeUndefined();
  });
});
