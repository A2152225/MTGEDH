import { describe, expect, it } from 'vitest';
import { queueRound67StateTriggers } from '../src/state/modules/triggers/round67GameTriggers.js';

function ctxWith(permanents: any[]) {
  return {
    state: { battlefield: permanents, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], turnNumber: 1 },
    bumpSeq() {},
  } as any;
}

function perm(id: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p1',
    card: { name, oracle_text: oracle, type_line: 'Artifact', colors: ['W'] },
    ...extra,
  };
}

describe('round 67 state triggers', () => {
  it('queues a counter threshold once it is reached and not before', () => {
    const oracle = 'When there are four or more page counters on this artifact, exile it.';
    const low = ctxWith([perm('tome', 'Mazemind Tome', oracle, { counters: { page: 3 } })]);
    expect(queueRound67StateTriggers(low)).toHaveLength(0);

    const ready = ctxWith([perm('tome', 'Mazemind Tome', oracle, { counters: { page: 4 } })]);
    expect(queueRound67StateTriggers(ready).length).toBeGreaterThan(0);
    expect(ready.state.stack[0].triggerType).toBe('source_counter_threshold');
    expect(ready.state.stack[0].effect).toMatch(/exile it/i);
    expect(queueRound67StateTriggers(ready)).toHaveLength(0);
  });

  it('queues the calendar at 1000 time counters', () => {
    const oracle = 'When there are 1,000 or more time counters on The Millennium Calendar, sacrifice it and each opponent loses 1,000 life.';
    const game = ctxWith([perm('cal', 'The Millennium Calendar', oracle, { counters: { time: 1000 } })]);
    queueRound67StateTriggers(game);
    expect(game.state.stack[0].effect).toMatch(/sacrifice it/i);
  });

  it('sacrifices Call to Arms when the chosen color is tied or behind', () => {
    const oracle = "When the chosen color isn't the most common color among nontoken permanents the chosen player controls or is tied for most common, sacrifice this enchantment.";
    const arms = perm('arms', 'Call to Arms', oracle, { chosenColor: 'white', chosenPlayerId: 'p2' });
    const bear = { id: 'bear', controller: 'p2', card: { name: 'Bear', type_line: 'Creature', colors: ['G'], oracle_text: '' } };
    const game = ctxWith([arms, bear]);
    queueRound67StateTriggers(game);
    expect(game.state.stack.some((item: any) => item.triggerType === 'color_rank')).toBe(true);
  });

  it('queues City in a Bottle for another Arabian Nights permanent', () => {
    const oracle = 'Whenever one or more other nontoken permanents with a name originally printed in the Arabian Nights expansion are on the battlefield, their controllers sacrifice them.';
    const city = perm('city', 'City in a Bottle', oracle, { card: { name: 'City in a Bottle', oracle_text: oracle, type_line: 'Artifact', colors: [] } });
    const library = perm('lib', 'Library of Alexandria', '', { card: { name: 'Library of Alexandria', oracle_text: '', type_line: 'Land', colors: [] } });
    const game = ctxWith([city, library]);
    queueRound67StateTriggers(game);
    expect(game.state.stack[0].triggerType).toBe('set_presence');
    expect(game.state.stack[0].effectData.sacrificePermanentIds).toEqual(['lib']);
  });
});
