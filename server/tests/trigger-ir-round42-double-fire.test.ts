import { describe, expect, it } from 'vitest';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { processLTBTriggers } from '../src/state/modules/triggerEmissionFamilyUtils.js';

// Round 42: sentences that became parseable in rounds 41-42 must queue exactly once per
// event (legacy family detector and parsed IR emitter dedupe on the effect text).
function ctxOf(battlefield: any[]) {
  const state: any = { seq: 1, stack: [], battlefield, players: [{ id: 'p1' }, { id: 'p2' }], commandZone: {}, turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } } };
  return { state, gameId: 'r42', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', ...card }, ...extra });
const watcher = (text: string) => perm('w', 'p1', { name: 'Watcher', type_line: 'Enchantment', oracle_text: text });
const bear = (id: string, modified: boolean, extra: any = {}) => perm(id, 'p1', { name: 'Bear ' + id, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' }, { counters: modified ? { '+1/+1': 1 } : {}, power: modified ? 3 : 2, basePower: 2, ...extra });
const fromW = (list: any[]) => list.filter((x) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || '') === 'w');

function attackCount(text: string, modified: boolean): number {
  const a1 = bear('a1', modified, { attacking: 'p2' });
  const a2 = bear('a2', modified, { attacking: 'p2' });
  return fromW(getAttackTriggersForCreatures(ctxOf([watcher(text), a1, a2]), [a1, a2], 'p1', 'p2') as any[]).length;
}

describe('round 42 double-fire guard: attacks (two attackers)', () => {
  const cases: Array<[string, number]> = [
    ['Whenever one or more modified creatures you control attack, draw a card.', 1],
    ['Whenever a modified creature you control attacks, draw a card.', 2],
    ['Whenever one or more creatures you control with +1/+1 counters on them attack, draw a card.', 1],
    ['Whenever a creature you control with a +1/+1 counter on it attacks, draw a card.', 2],
    ['Whenever one or more creatures you control attack a player, draw a card.', 1],
    ['Whenever a creature you control attacks a player, draw a card.', 2],
    ['Whenever one or more creatures you control attack an opponent, draw a card.', 1],
    ['Whenever a creature you control attacks an opponent, draw a card.', 2],
    ['Whenever a creature you control with power greater than its base power attacks, draw a card.', 2],
  // Round 43: plural base-power form.
  ['Whenever one or more creatures you control with power greater than their base power attack, draw a card.', 1],
  ];
  for (const [text, n] of cases) {
    it(text, () => {
      expect(attackCount(text, true)).toBe(n);
    });
  }
  it('unmodified attackers do not fire the modified / counter / power forms', () => {
    for (const [text] of cases.filter(([t]) => /modified|counter|base power/.test(t))) expect(attackCount(text, false)).toBe(0);
  });
});

describe('round 42 double-fire guard: singular modified dies / leaves', () => {
  it('a modified creature you control dies fires once, unmodified never', () => {
    const text = 'Whenever a modified creature you control dies, draw a card.';
    const dying = bear('d', true);
    expect(fromW(getDeathTriggers(ctxOf([watcher(text)]), dying, 'p1')).length).toBe(1);
    expect(fromW(getDeathTriggers(ctxOf([watcher(text)]), bear('d2', false), 'p1')).length).toBe(0);
  });
  it('a modified creature you control leaves the battlefield fires once', () => {
    const text = 'Whenever a modified creature you control leaves the battlefield, draw a card.';
    const ctx = ctxOf([watcher(text)]);
    processLTBTriggers(ctx, bear('l', true));
    expect(fromW(ctx.state.stack).length).toBe(1);
    const ctx2 = ctxOf([watcher(text)]);
    processLTBTriggers(ctx2, bear('l2', false));
    expect(fromW(ctx2.state.stack).length).toBe(0);
  });
});
