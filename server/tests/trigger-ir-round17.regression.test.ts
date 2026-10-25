import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';

const cond = (text: string, name?: string) => (parseTriggerClause(text, name) as any)?.condition;
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', ...card }, ...extra });
const bear = (id: string, c: string, type = 'Creature - Elf Warrior', attacking?: string) => perm(id, c, { name: 'Bear ' + id, type_line: type, oracle_text: '' }, { attacking: attacking || (c === 'p1' ? 'p2' : 'p1') });

function fire(oracle: string, attackers: any[], active: string, extra: any[] = []) {
  const w = perm('w', 'p1', { name: 'Watcher', type_line: 'Enchantment', oracle_text: oracle });
  const state: any = { battlefield: [w, ...attackers, ...extra], players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], turnPlayer: active, turnNumber: 3, zones: {} };
  const t = getAttackTriggersForCreatures({ state, gameId: 'g', bumpSeq() {}, isReplaying: false } as any, attackers, active, active === 'p1' ? 'p2' : 'p1');
  return t.filter((x: any) => x.permanentId === 'w');
}

describe('round 17: player-level attack wordings are IR, batched once per declaration', () => {
  it('parses without legacyRuntimeOnly', () => {
    for (const s of ['Whenever a player attacks you, draw a card.', 'Whenever an opponent attacks you, draw a card.', 'Whenever one or more creatures attack you, draw a card.', 'Whenever a player attacks, draw a card.', 'Whenever an opponent attacks with creatures, draw a card.', 'Whenever you attack with one or more Elves, draw a card.', 'Whenever you attack with one or more Goblins and/or Orcs, draw a card.']) {
      const c = cond(s);
      expect(c, s).toMatchObject({ event: 'attacks', quantity: 'one_or_more' });
      expect(c.legacyRuntimeOnly, s).toBeUndefined();
    }
    expect(cond('Whenever a player attacks enchanted player, draw a card.').legacyRuntimeOnly).toBe(true);
  });
  it('fires once for two attackers; per-creature wording fires per attacker', () => {
    const opp = [bear('b1', 'p2'), bear('b2', 'p2')];
    expect(fire('Whenever a player attacks you, draw a card.', opp, 'p2')).toHaveLength(1);
    expect(fire('Whenever one or more creatures attack you, draw a card.', opp, 'p2')).toHaveLength(1);
    expect(fire('Whenever an opponent attacks with creatures, draw a card.', opp, 'p2')).toHaveLength(1);
    expect(fire('Whenever a player attacks, draw a card.', opp, 'p2')).toHaveLength(1);
    expect(fire('Whenever a creature attacks you, draw a card.', opp, 'p2')).toHaveLength(2);
    const mine = [bear('a1', 'p1'), bear('a2', 'p1', 'Creature - Bear')];
    expect(fire('Whenever you attack with one or more Elves, draw a card.', mine, 'p1')).toHaveLength(1);
    expect(fire('Whenever you attack with one or more Elves, draw a card.', [bear('a3', 'p1', 'Creature - Bear')], 'p1')).toHaveLength(0);
    expect(fire('Whenever a player attacks you, draw a card.', mine, 'p1')).toHaveLength(0);
  });
  it('attacking only a planeswalker you control is not attacking you', () => {
    const pw = perm('pw', 'p1', { name: 'Walker', type_line: 'Legendary Planeswalker - Jace', oracle_text: '' });
    expect(fire('Whenever a player attacks you, draw a card.', [bear('b1', 'p2', 'Creature - Bear', 'pw')], 'p2', [pw])).toHaveLength(0);
  });
});

describe('round 17: cast or cycle self', () => {
  it('matches the normalized self name (legacy spell-cast detector owns it)', () => {
    expect(cond('When you cast or cycle Warped Tusker, create a 0/1 colorless Eldrazi Spawn creature token.', 'Warped Tusker')).toMatchObject({ legacyRuntimeOnly: true });
  });
});
