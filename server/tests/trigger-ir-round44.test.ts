import { describe, expect, it } from 'vitest';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

function ctxOf(battlefield: any[]) {
  const state: any = { seq: 1, stack: [], battlefield, players: [{ id: 'p1' }, { id: 'p2' }], commandZone: {}, turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } } };
  return { state, gameId: 'r44', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', ...card }, ...extra });
const watcher = (text: string) => perm('w', 'p1', { name: 'Watcher', type_line: 'Enchantment', oracle_text: text });
const guy = (id: string, type_line: string, extra: any = {}) => perm(id, 'p1', { name: 'Guy ' + id, type_line, oracle_text: '', power: '2', toughness: '2' }, extra);
const fromW = (list: any[]) => list.filter((x) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || '') === 'w');
const dies = (text: string, dying: any) => fromW(getDeathTriggers(ctxOf([watcher(text)]), dying, 'p1')).length;

describe('round 44: Case self-name, non-X or Y, combat role LKI', () => {
  it('"When this Case enters" parses with the Case card name', () => {
    const r: any = parseTriggerClause('When this Case enters, investigate.', 'Case of the Filched Falcon');
    expect(r?.condition.event).toBe('enters');
    expect(r.condition.alternatives[0].source).toBe('self');
    expect(r.effect).toBe('investigate');
  });
  it('two-word personal name short form', () => {
    expect((parseTriggerClause('Whenever Dáin attacks, draw a card.', 'Dáin Ironfoot') as any)?.condition.alternatives[0].source).toBe('self');
    expect(parseTriggerClause('Whenever a Goblin attacks, draw a card.', 'Goblin Guide')?.condition.alternatives[0].source).not.toBe('self');
  });
  it('non-X or Y in dies / enters / attacks', () => {
    for (const verb of ['dies', 'enters', 'attacks']) expect(parseTriggerClause(`Whenever a nonhuman or Zombie creature you control ${verb}, draw a card.`)?.condition.event).toBe(verb);
    const text = 'Whenever a nonhuman or Zombie creature you control dies, draw a card.';
    expect(dies(text, guy('e', 'Creature - Elf'))).toBe(1);
    expect(dies(text, guy('z', 'Creature - Human Zombie'))).toBe(1);
    expect(dies(text, guy('h', 'Creature - Human Soldier'))).toBe(0);
  });
  it('an attacking / blocking creature you control dies uses the last known combat status, once', () => {
    const text = 'Whenever an attacking creature you control dies, draw a card.';
    expect(dies(text, guy('a', 'Creature - Elf', { attacking: 'p2' }))).toBe(1);
    expect(dies(text, guy('b', 'Creature - Elf', { blocking: ['x'] }))).toBe(0);
    expect(dies(text, guy('c', 'Creature - Elf'))).toBe(0);
    const block = 'Whenever a blocking creature you control dies, draw a card.';
    expect(dies(block, guy('b2', 'Creature - Elf', { blocking: ['x'] }))).toBe(1);
    expect(dies(block, guy('a2', 'Creature - Elf', { attacking: 'p2' }))).toBe(0);
    const c: any = parseTriggerClause('Whenever an attacking creature you control dies, draw a card.')?.condition;
    expect(c.alternatives[0].subject.combatRole).toBe('attacking');
    expect(triggerConditionMatches(c, { typeLine: 'Creature', controllerId: 'p1', attacking: true } as any, { controllerId: 'p1' } as any)).toBe(true);
  });
  it('non-X or Y attack fires once per attacker', () => {
    const text = 'Whenever a nonhuman or Zombie creature you control attacks, draw a card.';
    const ctx = ctxOf([watcher(text), guy('e', 'Creature - Elf', { attacking: 'p2' }), guy('h', 'Creature - Human', { attacking: 'p2' })]);
    const list = getAttackTriggersForCreatures(ctx, ctx.state.battlefield.slice(1), 'p1');
    expect(fromW(list).length).toBe(1);
  });
});
