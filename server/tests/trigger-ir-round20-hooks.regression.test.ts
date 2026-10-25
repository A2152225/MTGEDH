import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { queuePlayLandOrCastLandTriggers, queueFreshDieRollTriggers, matchDieRollTrigger } from '../src/state/modules/triggers/playLandSaddleDieRollHooks.js';
import { applyPermanentKeywordEvents } from '../src/state/modules/apply-event-handlers/applyEventPermanentKeywordEvents.js';
import { discardedCardMatchesTypeFilter, anyDiscardedCardMatchesTypeFilter } from '../src/state/modules/reflexiveDiscardTypeFilter.js';
import { playLand } from '../src/state/modules/stackPlayLandUtils.js';

const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', ...card }, ...extra });
function game() {
  const g: any = createInitialGameState('t20h_' + Math.random());
  g.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' });
  g.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' });
  g.state.turnPlayer = 'p1'; g.state.phase = 'main1'; g.state.step = 'main';
  return g;
}
const stackText = (g: any) => (g.state.stack || []).map((s: any) => String(s?.description || s?.effect || '')).join(' | ');

describe('round 19 hooks', () => {
  it('play a land or cast a spell: land half queues, exile-only variant needs exile', () => {
    const g = game();
    g.state.battlefield.push(
      perm('a', 'p1', { name: 'Any Land Watcher', type_line: 'Creature - Elf', oracle_text: 'Whenever you play a land or cast a spell, you gain 1 life.' }),
      perm('b', 'p1', { name: 'Exile Watcher', type_line: 'Creature - Elf', oracle_text: 'Whenever you play a land from exile or cast a spell from exile, draw a card.' }),
      perm('c', 'p2', { name: 'Opp Watcher', type_line: 'Creature - Elf', oracle_text: 'Whenever you play a land or cast a spell, you gain 1 life.' }),
    );
    const q1 = queuePlayLandOrCastLandTriggers(g, 'p1', 'land1', false);
    expect(q1.map((i: any) => i.cardName || i.sourceName)).toEqual(['Any Land Watcher']);
    const q2 = queuePlayLandOrCastLandTriggers(g, 'p1', 'land2', true);
    expect(q2.length).toBe(2);
    expect(q2[0].triggeringLandId).toBe('land2');
  });

  it('play a land through playLand queues the land half', () => {
    const g = game();
    g.state.battlefield.push(perm('a', 'p1', { name: 'Any Land Watcher', type_line: 'Creature - Elf', oracle_text: 'Whenever you play a land or cast a spell, you gain 1 life.' }));
    const land = { id: 'forest1', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '({T}: Add {G}.)' };
    const zones = g.state.zones?.p1;
    if (zones) { zones.hand = [land]; zones.handCount = 1; }
    try { playLand(g, 'p1', land); } catch { /* engine-specific bookkeeping */ }
    expect(stackText(g)).toMatch(/gain 1 life/i);
  });

  it('saddle half queues only for the saddler, main-phase restriction honoured', () => {
    const g = game();
    g.state.battlefield.push(
      perm('s1', 'p1', { name: 'Saddler', type_line: 'Creature - Human', power: '2', toughness: '2', oracle_text: 'Whenever this creature saddles a Mount or crews a Vehicle during your main phase, draw a card.' }),
      perm('m1', 'p1', { name: 'Mount', type_line: 'Creature - Horse Mount', power: '4', toughness: '4', oracle_text: 'Saddle 1' }),
    );
    applyPermanentKeywordEvents(g, { type: 'saddleMount', playerId: 'p1', mountId: 'm1', crewerIds: ['s1'] } as any);
    expect(stackText(g)).toMatch(/draw a card/i);
    const g2 = game();
    g2.state.step = 'beginCombat'; g2.state.phase = 'combat';
    g2.state.battlefield.push(
      perm('s1', 'p1', { name: 'Saddler', type_line: 'Creature - Human', power: '2', toughness: '2', oracle_text: 'Whenever this creature saddles a Mount or crews a Vehicle during your main phase, draw a card.' }),
      perm('m1', 'p1', { name: 'Mount', type_line: 'Creature - Horse Mount', power: '4', toughness: '4', oracle_text: 'Saddle 1' }),
    );
    applyPermanentKeywordEvents(g2, { type: 'saddleMount', playerId: 'p1', mountId: 'm1', crewerIds: ['s1'] } as any);
    expect(stackText(g2)).not.toMatch(/draw a card/i);
  });

  it('die-roll result triggers queue once per roll record', () => {
    expect(matchDieRollTrigger('whenever you roll a 1 or 2, draw a card.')?.accepts(2, 1)).toBe(true);
    expect(matchDieRollTrigger('whenever you roll a 5 or higher, draw a card.')?.accepts(4, 1)).toBe(false);
    expect(matchDieRollTrigger('whenever you roll your third die each turn, draw a card.')?.accepts(1, 3)).toBe(true);
    const g = game();
    g.state.battlefield.push(perm('d1', 'p1', { name: 'Dicer', type_line: 'Creature - Goblin', oracle_text: 'Whenever you roll a 6, create a Treasure token.' }));
    g.state.lastDieRollByPlayer = { p1: { results: [6], sides: 6 } };
    g.state.dieRollsThisTurn = { p1: [{ results: [6], count: 1 }] };
    expect(queueFreshDieRollTriggers(g).length).toBe(1);
    expect(queueFreshDieRollTriggers(g).length).toBe(0);
    g.state.lastDieRollByPlayer = { p1: { results: [3], sides: 6 } };
    expect(queueFreshDieRollTriggers(g).length).toBe(0);
  });

  it('discard type filter', () => {
    const land = { type_line: 'Basic Land - Forest' };
    const bolt = { type_line: 'Instant' };
    const bear = { type_line: 'Creature - Bear' };
    expect(discardedCardMatchesTypeFilter(land, 'nonland')).toBe(false);
    expect(discardedCardMatchesTypeFilter(bolt, 'instant or sorcery')).toBe(true);
    expect(discardedCardMatchesTypeFilter(bear, 'instant or sorcery')).toBe(false);
    expect(anyDiscardedCardMatchesTypeFilter([land, bear], 'creature')).toBe(true);
    expect(anyDiscardedCardMatchesTypeFilter([land], 'creature')).toBe(false);
    expect(anyDiscardedCardMatchesTypeFilter([], undefined)).toBe(true);
  });
});
