import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers.js';
import { queueNoncombatDealsDamageTriggers } from '../src/state/modules/triggers/noncombat-deals-damage.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function ctxOf(battlefield: any[], extra: Record<string, unknown> = {}) {
  const state: any = {
    seq: 1, stack: [], battlefield,
    players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 30 }, { id: 'p3', life: 15 }],
    commandZone: {},
    turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, phase: 'combat', step: 'declare_attackers',
    zones: {
      p1: { hand: [], graveyard: [], exile: [], library: [] },
      p2: { hand: [], graveyard: [], exile: [], library: [] },
      p3: { hand: [], graveyard: [], exile: [], library: [] },
    },
    spellsCastThisTurn: [],
    monarch: 'p2',
    ...extra,
  };
  return { state, gameId: 'r5', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: id + '_c', ...card }, ...extra,
});
const sourceId = (x: any) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || x?.source || '');
const fromW = (list: any[]) => list.filter((x) => sourceId(x) === 'w');

describe('legacy-r5: parse promotions', () => {
  it('when/whenever you or a player attacks with N creatures', () => {
    const when3 = cond('When you attack with three or more creatures, transform this.');
    expect(when3?.event).toBe('attacks');
    expect(when3?.legacyRuntimeOnly).toBeFalsy();
    expect(when3?.minOtherAttackers).toBe(2);

    const exact = cond('When you attack with exactly two creatures, transform this creature.');
    expect(exact?.event).toBe('attacks');
    expect(exact?.exactAttackers).toBe(2);
    expect(exact?.legacyRuntimeOnly).toBeFalsy();

    const player5 = cond('Whenever a player attacks with five or more creatures, you gain 3 life.');
    expect(player5?.event).toBe('attacks');
    expect(player5?.minAttackers).toBe(5);
    expect(player5?.legacyRuntimeOnly).toBeFalsy();

    const flying = cond('Whenever you attack with two or more creatures with flying, draw a card.');
    expect(flying?.event).toBe('attacks');
    expect(flying?.alternatives?.[0]?.subject?.keywordsWith).toContain('flying');
  });

  it('two-or-more creatures attack, most life, monarch, more life, alone', () => {
    const two = cond('Whenever two or more creatures attack, put an oil counter on this artifact.');
    expect(two?.event).toBe('attacks');
    expect(two?.minAttackers).toBe(2);
    expect(two?.legacyRuntimeOnly).toBeFalsy();

    const youCtrl = cond('Whenever two or more creatures you control attack a player, draw a card.');
    expect(youCtrl?.event).toBe('attacks');
    expect(youCtrl?.minAttackers).toBe(2);
    expect(youCtrl?.attackedPlayer).toBe('any');

    const most = cond('Whenever this creature attacks the player with the most life or tied for most life, create a token.');
    expect(most?.event).toBe('attacks');
    expect(most?.attackedPlayer).toBe('most_life');
    expect(most?.legacyRuntimeOnly).toBeFalsy();

    const monarch = cond('Whenever equipped creature attacks the monarch, destroy a permanent.');
    expect(monarch?.attackedPlayer).toBe('monarch');

    const more = cond('Whenever this creature attacks a player who has more life than you, other creatures get +2/+0.');
    expect(more?.attackedPlayer).toBe('more_life_than_you');

    const alone = cond('Whenever a creature you control attacks a player alone, it gains double strike.');
    expect(alone?.attacksPlayerAlone).toBe(true);
    expect(alone?.legacyRuntimeOnly).toBeFalsy();
  });

  it('combat damage, spell-cast, death, and ETB leftovers', () => {
    const spellDmg = cond('Whenever an instant or sorcery spell you control deals damage, create two tokens.');
    expect(spellDmg?.event).toBe('deals_damage');
    expect(spellDmg?.legacyRuntimeOnly).toBeFalsy();

    const another = cond('Whenever a source you control deals damage to another player, put a counter on this.');
    expect(another?.event).toBe('deals_damage');
    expect(another?.damageRecipient).toBe('opponent');

    const pirates = cond('Whenever one or more Pirates you control deal damage to a player, Francisco explores.');
    expect(pirates?.quantity).toBe('one_or_more');
    expect(pirates?.legacyRuntimeOnly).toBeFalsy();

    const mimic = cond('Whenever you cast a spell that\'s both red and white, this creature gets +2/+0.');
    expect(mimic?.event).toBe('spell_cast');
    expect(mimic?.alternatives?.[0]?.subject?.colorsAll).toEqual(['r', 'w']);
    expect(mimic?.legacyRuntimeOnly).toBeFalsy();

    const bolas = cond('Whenever you cast a Bolas planeswalker spell, sacrifice this creature.');
    expect(bolas?.event).toBe('spell_cast');
    expect(bolas?.alternatives?.[0]?.subject?.subtypeGroups?.[0]).toContain('bolas');

    const cmd = cond('When you cast your commander, return this card from your graveyard to the battlefield.');
    expect(cmd?.event).toBe('spell_cast');
    expect(cmd?.alternatives?.[0]?.subject?.commander).toBe(true);

    const delayedCast = cond('Whenever you cast a creature spell this turn, draw a card.');
    expect(delayedCast?.event).toBe('spell_cast');
    expect(delayedCast?.delayedRider).toBe(true);

    const notHand = cond('Whenever you play a land or cast a spell from anywhere other than your hand, deal 1 damage.');
    expect(notHand?.event).toBe('plays_land');
    expect(notHand?.pairedEvent).toBe('spell_cast');
    expect(notHand?.legacyRuntimeOnly).toBeFalsy();

    const dies = cond('When this creature dies or is put into exile while its power is 4 or greater, destroy a permanent.');
    expect(dies?.event).toBe('dies');
    expect(dies?.pairedEvent).toBe('exiled');
    expect(dies?.alternatives?.[0]?.subject?.stats?.[0]).toEqual({ stat: 'power', op: 'gte', value: 4 });
    expect(dies?.legacyRuntimeOnly).toBeFalsy();

    const faceUp = cond('Whenever this creature or another creature you control is turned face up, put counters on it.');
    expect(faceUp?.event).toBe('turned_face_up');
    expect(faceUp?.legacyRuntimeOnly).toBeFalsy();
    expect((faceUp?.alternatives || []).length).toBeGreaterThan(1);
  });
});

describe('legacy-r5: fires exactly once', () => {
  it('when you attack with three or more fires once at 3 and not at 2', () => {
    const text = 'When you attack with three or more creatures, transform this.';
    const watcher = perm('w', 'p1', { name: "Legion's Landing", type_line: 'Legendary Enchantment', oracle_text: text });
    const a1 = perm('a1', 'p1', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2' });
    const a2 = perm('a2', 'p1', { name: 'Cat', type_line: 'Creature - Cat', oracle_text: '', power: '1', toughness: '1' }, { attacking: 'p2' });
    const a3 = perm('a3', 'p1', { name: 'Ox', type_line: 'Creature - Ox', oracle_text: '', power: '2', toughness: '4' }, { attacking: 'p2' });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([watcher, a1, a2]), [a1, a2], 'p1', 'p2') as any[]).length).toBe(0);
    expect(fromW(getAttackTriggersForCreatures(ctxOf([watcher, a1, a2, a3]), [a1, a2, a3], 'p1', 'p2') as any[]).length).toBe(1);
  });

  it('two or more creatures attack, and most-life / monarch each fire once', () => {
    const twoText = 'Whenever two or more creatures attack, put an oil counter on this artifact.';
    const two = perm('w', 'p1', { name: 'Argent Dais', type_line: 'Artifact', oracle_text: twoText });
    const a1 = perm('a1', 'p2', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p1' });
    const a2 = perm('a2', 'p2', { name: 'Cat', type_line: 'Creature - Cat', oracle_text: '', power: '1', toughness: '1' }, { attacking: 'p1' });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([two, a1]), [a1], 'p2', 'p1') as any[]).length).toBe(0);
    expect(fromW(getAttackTriggersForCreatures(ctxOf([two, a1, a2]), [a1, a2], 'p2', 'p1') as any[]).length).toBe(1);

    const mostText = 'Whenever this creature attacks the player with the most life or tied for most life, create a token.';
    const preacher = perm('w', 'p1', { name: 'Preacher of the Schism', type_line: 'Creature - Vampire Cleric', oracle_text: mostText, power: '2', toughness: '4' }, { attacking: 'p2' });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([preacher]), [preacher], 'p1', 'p2') as any[]).length).toBe(1);
    const low = { ...preacher, attacking: 'p3' };
    expect(fromW(getAttackTriggersForCreatures(ctxOf([low]), [low], 'p1', 'p3') as any[]).length).toBe(0);

    const monText = 'Whenever equipped creature attacks the monarch, destroy a permanent.';
    const sword = perm('w', 'p1', { name: 'The Spear of Bashenga', type_line: 'Artifact - Equipment', oracle_text: monText }, { attachedTo: 'e1' });
    const eq = perm('e1', 'p1', { name: 'Soldier', type_line: 'Creature - Soldier', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2', isEquipped: true });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([sword, eq]), [eq], 'p1', 'p2') as any[]).length).toBe(1);
    const notMon = { ...eq, attacking: 'p3' };
    expect(fromW(getAttackTriggersForCreatures(ctxOf([sword, notMon]), [notMon], 'p1', 'p3') as any[]).length).toBe(0);
  });

  it('mimic both-colors and Bolas planeswalker each fire once on a match only', () => {
    const mimic = perm('w', 'p1', { name: 'Battlegate Mimic', type_line: 'Creature - Shapeshifter', oracle_text: 'Whenever you cast a spell that\'s both red and white, this creature gets +2/+0 until end of turn.' });
    const rw = { id: 's1', name: 'Boros Charm', type_line: 'Instant', oracle_text: '', mana_cost: '{R}{W}', colors: ['R', 'W'] };
    const r = { id: 's2', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', mana_cost: '{R}', colors: ['R'] };
    const g = ctxOf([mimic], { phase: 'main1', step: 'main' });
    expect(fromW(getSpellCastTriggers(g, 'p1', rw) as any[]).length).toBe(1);
    expect(fromW(getSpellCastTriggers(g, 'p1', r) as any[]).length).toBe(0);

    const wasp = perm('w', 'p1', { name: 'Wasp of the Bitter End', type_line: 'Creature - Insect Nightmare', oracle_text: 'Whenever you cast a Bolas planeswalker spell, you may sacrifice this creature.' });
    const nicol = { id: 'pw', name: 'Nicol Bolas, God-Pharaoh', type_line: 'Legendary Planeswalker - Bolas', oracle_text: '', mana_cost: '{4}{U}{B}{R}', colors: ['U', 'B', 'R'], isCommander: false };
    const jace = { id: 'pw2', name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker - Jace', oracle_text: '', mana_cost: '{2}{U}{U}', colors: ['U'] };
    const g2 = ctxOf([wasp], { phase: 'main1', step: 'main' });
    expect(fromW(getSpellCastTriggers(g2, 'p1', nicol) as any[]).length).toBe(1);
    expect(fromW(getSpellCastTriggers(g2, 'p1', jace) as any[]).length).toBe(0);
  });

  it('instant or sorcery you control deals damage fires once via noncombat IR', () => {
    const text = 'Whenever an instant or sorcery spell you control deals damage, create two 1/1 red and white Soldier creature tokens with haste.';
    const watcher = perm('w', 'p1', { name: 'Blaze Commando', type_line: 'Creature - Human Soldier', oracle_text: text, power: '5', toughness: '3' });
    const bolt = perm('s1', 'p1', { name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}', colors: ['R'] });
    const g = ctxOf([watcher, bolt], { phase: 'main1', step: 'main' });
    const hits = queueNoncombatDealsDamageTriggers(g, 's1', { playerIds: ['p2'], permanentIds: [], amount: 3 });
    expect(fromW(hits as any[]).length).toBe(1);
  });

  it('delayed this-turn spell-cast rider is IR fail-closed as a permanent trigger', () => {
    const text = 'Whenever you cast a creature spell this turn, draw a card.';
    const c = cond(text);
    expect(c?.delayedRider).toBe(true);
    expect(triggerConditionMatches(c, { id: 's', controllerId: 'p1', typeLine: 'Creature - Bear' } as any, src(), {} as any)).toBe(false);
    const watcher = perm('w', 'p1', { name: 'Glimpse of Nature', type_line: 'Sorcery', oracle_text: text });
    const bear = { id: 'b', name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', mana_cost: '{1}{G}', colors: ['G'] };
    const hits = fromW(getSpellCastTriggers(ctxOf([watcher], { phase: 'main1', step: 'main' }), 'p1', bear) as any[]);
    expect(hits.filter((h: any) => String(h.triggerType || '') === 'parsed_spell_cast' || String(h.triggerType || '').includes('parsed')).length).toBe(0);
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});

describe('legacy-r5 census samples', () => {
  it('promoted leftover families are IR without legacyRuntimeOnly', () => {
    const samples: Array<[string, string]> = [
      ['When you attack with three or more creatures, transform this.', 'attacks'],
      ['Whenever a player attacks with five or more creatures, you gain 3 life.', 'attacks'],
      ['Whenever two or more creatures attack, put a counter on this artifact.', 'attacks'],
      ['Whenever this creature attacks the player with the most life or tied for most life, create a token.', 'attacks'],
      ['Whenever equipped creature attacks the monarch, destroy a permanent.', 'attacks'],
      ['Whenever an instant or sorcery spell you control deals damage, create two tokens.', 'deals_damage'],
      ['Whenever a source you control deals damage to another player, put a counter on this.', 'deals_damage'],
      ['Whenever you cast a spell that\'s both red and white, this creature gets +2/+0.', 'spell_cast'],
      ['Whenever you cast a Bolas planeswalker spell, sacrifice this creature.', 'spell_cast'],
      ['When you cast your commander, return this card.', 'spell_cast'],
      ['When this creature dies or is put into exile while its power is 4 or greater, destroy a permanent.', 'dies'],
      ['Whenever this creature or another creature you control is turned face up, put counters on it.', 'turned_face_up'],
    ];
    for (const [text, event] of samples) {
      const c = cond(text);
      expect(c?.event, text).toBe(event);
      expect(c?.legacyRuntimeOnly, text).toBeFalsy();
    }
  });
});
