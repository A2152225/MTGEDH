import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function ctxOf(battlefield: any[]) {
  const state: any = {
    seq: 1, stack: [], battlefield,
    players: [{ id: 'p1' }, { id: 'p2' }], commandZone: {},
    turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, phase: 'combat', step: 'combat_damage',
    zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } },
  };
  return { state, gameId: 'r59', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: id + '_c', ...card }, ...extra,
});
const sourceId = (x: any) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || '');
const fromW = (list: any[]) => list.filter((x) => sourceId(x) === 'w');

describe('legacy-r1: promoted Round-16 families fire via IR once', () => {
  it('equipped attacks, first-time attacks, attacks a player, enchanted player attacked', () => {
    const eq = cond('Whenever an equipped creature you control attacks, draw a card.');
    expect(eq?.event).toBe('attacks');
    expect(eq?.legacyRuntimeOnly).toBeFalsy();
    expect(eq?.requireEquippedAttacker).toBe(true);
    expect(triggerConditionMatches(eq, { id: 'a1', controllerId: 'p1', typeLine: 'Creature', equipped: true } as any, src(), { attackerEquipped: true } as any)).toBe(true);
    expect(triggerConditionMatches(eq, { id: 'a1', controllerId: 'p1', typeLine: 'Creature' } as any, src(), {} as any)).toBe(false);

    const first = cond('Whenever this creature attacks for the first time each turn, draw a card.');
    expect(first?.onceEachTurn).toBe(true);
    expect(first?.legacyRuntimeOnly).toBeFalsy();

    expect(cond('Whenever this creature attacks a player, draw a card.')?.attackedPlayer).toBe('any');
    const curse = cond('Whenever enchanted player is attacked, draw a card.');
    expect(curse?.event).toBe('attacks');
    expect(curse?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(curse, { id: 'a1', controllerId: 'p2', typeLine: 'Creature' } as any, src(), { attackedPlayerId: 'p3', enchantedPlayerId: 'p3' } as any)).toBe(true);
    expect(triggerConditionMatches(curse, { id: 'a1', controllerId: 'p2', typeLine: 'Creature' } as any, src(), { attackedPlayerId: 'p1', enchantedPlayerId: 'p3' } as any)).toBe(false);
  });

  it('blocks with flying, dies during combat, dealt-damage dies, multi die', () => {
    const blk = cond('Whenever this creature blocks a creature with flying, this creature gets +2/+0 until end of turn.');
    expect(blk?.event).toBe('blocks');
    expect(blk?.legacyRuntimeOnly).toBeFalsy();
    expect(blk?.blockPartner?.keywordsWith).toContain('flying');

    const dies = cond('When this creature dies during combat, it deals 6 damage to each creature it blocked this combat.');
    expect(dies?.event).toBe('dies');
    expect(dies?.duringCombat).toBe(true);
    expect(dies?.legacyRuntimeOnly).toBeFalsy();

    const ddd = cond('Whenever a creature dealt damage by this creature this turn dies, create a token.');
    expect(ddd?.dealtDamageBySource).toBe(true);
    expect(ddd?.legacyRuntimeOnly).toBeFalsy();

    const multi = cond('Whenever one or more other creatures you control die, draw a card.');
    expect(multi?.event).toBe('dies');
    expect(multi?.quantity).toBe('one_or_more');
    expect(multi?.legacyRuntimeOnly).toBeFalsy();
  });

  it('spell cast / exile / life / draw / chosen type / token gy / bare combat damage', () => {
    expect(cond("Whenever you cast a spell you don't own, create a Treasure.")?.spellNotOwned).toBe(true);
    const x = cond('Whenever you cast a spell with {X} in its mana cost, draw a card.');
    expect(x?.hasXInCost).toBe(true);
    expect(x?.legacyRuntimeOnly).toBeFalsy();
    expect(cond('Whenever you play a land from exile or cast a spell from exile, draw a card.')?.castFromZone).toBe('exile');
    expect(cond('Whenever you lose life for the first time each turn, draw a card.')?.onceEachTurn).toBe(true);
    expect(cond('When you draw your third card in a turn, transform this.')?.ordinal).toBe('third');
    expect(cond('Whenever a permanent you control of the chosen type enters, draw a card.')?.alternatives?.[0]?.subject?.chosenType).toBe(true);
    expect(cond('When this token is put into a graveyard, draw a card.')?.requireToken).toBe(true);
    const bare = cond('Whenever this creature deals combat damage, sacrifice it.');
    expect(bare?.event).toBe('deals_combat_damage');
    expect(bare?.legacyRuntimeOnly).toBeFalsy();
  });

  it('fires once: equipped-attacks and dies-during-combat (no double fire)', () => {
    const attackText = 'Whenever an equipped creature you control attacks, draw a card.';
    const attacker = perm('a1', 'p1', { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2', isEquipped: true, equipped: true, attachedEquipment: ['eq1'] });
    const watcher = perm('w', 'p1', { name: 'Watcher', type_line: 'Enchantment', oracle_text: attackText });
    const n = fromW(getAttackTriggersForCreatures(ctxOf([watcher, attacker]), [attacker], 'p1', 'p2') as any[]).length;
    expect(n).toBe(1);

    const deathText = 'When this creature dies during combat, it deals 6 damage to each creature it blocked this combat.';
    const dying = perm('d1', 'p1', { name: 'Membrane', type_line: 'Creature', oracle_text: deathText });
    const fromD = (getDeathTriggers(ctxOf([dying]), dying, 'p1') as any[]).filter((x) => sourceId(x) === 'd1');
    expect(fromD.length).toBe(1);
  });

  it('fires once: multi-die watcher and attacks-a-player', () => {
    const multiText = 'Whenever one or more other creatures you control die, draw a card.';
    const dying = perm('d2', 'p1', { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' });
    const watcher = perm('w', 'p1', { name: 'Watcher', type_line: 'Enchantment', oracle_text: multiText });
    expect(fromW(getDeathTriggers(ctxOf([watcher, dying]), dying, 'p1') as any[]).length).toBe(1);

    const attackText = 'Whenever a creature you control attacks a player, draw a card.';
    const attacker = perm('a1', 'p1', { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2' });
    const w2 = perm('w', 'p1', { name: 'Watcher', type_line: 'Enchantment', oracle_text: attackText });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([w2, attacker]), [attacker], 'p1', 'p2') as any[]).length).toBe(1);
  });
});

describe('legacy-r1 census', () => {
  it('promoted families are IR-emitted (no legacyRuntimeOnly) with expected events', () => {
    const samples: Array<[string, string]> = [
      ['Whenever an equipped creature you control attacks, draw a card.', 'attacks'],
      ['Whenever this creature attacks for the first time each turn, draw a card.', 'attacks'],
      ['Whenever this creature attacks a player, draw a card.', 'attacks'],
      ['Whenever enchanted player is attacked, draw a card.', 'attacks'],
      ['Whenever this creature blocks a creature with flying, this creature gets +2/+0 until end of turn.', 'blocks'],
      ['When this creature dies during combat, it deals 6 damage.', 'dies'],
      ['Whenever a creature dealt damage by this creature this turn dies, create a token.', 'dies'],
      ['Whenever one or more other creatures you control die, draw a card.', 'dies'],
      ["Whenever you cast a spell you don't own, create a Treasure.", 'spell_cast'],
      ['Whenever you cast a spell with {X} in its mana cost, draw a card.', 'spell_cast'],
      ['Whenever you play a land from exile or cast a spell from exile, draw a card.', 'plays_land'],
      ['Whenever you lose life for the first time each turn, draw a card.', 'loses_life'],
      ['When you draw your third card in a turn, transform this.', 'draws_card'],
      ['Whenever a permanent you control of the chosen type enters, draw a card.', 'enters'],
      ['When this token is put into a graveyard, draw a card.', 'dies'],
      ['Whenever this creature deals combat damage, sacrifice it.', 'deals_combat_damage'],
      ['Whenever equipped creature deals combat damage to a player, draw a card.', 'deals_combat_damage_to_player'],
    ];
    for (const [text, event] of samples) {
      const c = cond(text);
      expect(c?.event, text).toBe(event);
      expect(c?.legacyRuntimeOnly, text).toBeFalsy();
    }
  });
});
