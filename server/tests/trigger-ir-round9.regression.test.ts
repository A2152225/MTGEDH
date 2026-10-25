import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { queueControlsNoneStateTriggers, queueClassLevelTriggers } from '../src/state/modules/triggerStateAndLevelEmitters.js';

const perm = (id: string, controller: string, name: string, oracle: string, type: string, extra: any = {}) =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, damage: 0, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle } });
const ctxOf = (battlefield: any[]) => ({
  gameId: 'unknown', isReplaying: false,
  state: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 }, activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 3, battlefield, stack: [] },
}) as any;
const trig = (ctx: any) => ctx.state.stack.filter((s: any) => s.type === 'triggered_ability');

describe('round 9 parses', () => {
  it.each([
    ['Whenever you sacrifice a Clue, draw a card.', 'sacrifices'],
    ['Whenever you sacrifice a Food, you gain 1 life.', 'sacrifices'],
    ['When a Cartouche you control enters, draw a card.', 'enters'],
    ['Whenever another Shrine you control enters, draw a card.', 'enters'],
    ['At the beginning of each of your upkeeps, draw a card.', 'beginning_of_upkeep'],
  ])('%s', (text, event) => {
    expect(parseTriggerClause(text)?.condition.event).toBe(event);
  });
  it('plural card names use the plural verb', () => {
    expect(parseTriggerClause('When Mikey & Mona enter, draw a card.', 'Mikey & Mona')?.condition.alternatives[0].source).toBe('self');
    expect(parseTriggerClause('Whenever Mikey & Mona attack, draw a card.', 'Mikey & Mona')?.condition.event).toBe('attacks');
  });
  it('class level matching needs the same level', () => {
    const c = parseTriggerClause('When this Class becomes level 2, draw a card.')!.condition;
    const src = { id: 'c1', controllerId: 'p1' } as any;
    const subj = { id: 'c1', typeLine: 'Enchantment - Class', controllerId: 'p1' } as any;
    expect(triggerConditionMatches(c, subj, src, { classLevel: 2 } as any)).toBe(true);
    expect(triggerConditionMatches(c, subj, src, { classLevel: 3 } as any)).toBe(false);
  });
});

describe('round 9 controls_none state trigger', () => {
  const oracle = 'When you control no Islands, sacrifice this creature.';
  it('fires once when no Islands, not again while on the stack', () => {
    const ctx = ctxOf([perm('s1', 'p1', 'Sea Thing', oracle, 'Creature - Serpent')]);
    queueControlsNoneStateTriggers(ctx);
    queueControlsNoneStateTriggers(ctx);
    expect(trig(ctx).length).toBe(1);
  });
  it('does not fire with an Island', () => {
    const ctx = ctxOf([perm('s1', 'p1', 'Sea Thing', oracle, 'Creature - Serpent'), perm('i1', 'p1', 'Island', '', 'Basic Land - Island')]);
    queueControlsNoneStateTriggers(ctx);
    expect(trig(ctx).length).toBe(0);
  });
});
