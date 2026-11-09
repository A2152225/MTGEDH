import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

describe('round 57 ordinary leftovers and this-way riders', () => {
  it('life thresholds, flying, ring tempts, suspected, another land, gain-from-you', () => {
    const life = cond('When an opponent has 10 or less life, transform it.');
    expect(life?.lifeMaximum).toBe(10);
    expect(triggerConditionMatches(life, { id: 'p2', controllerId: 'p2', typeLine: 'Creature', anyObject: true } as any, src(), { playerLife: 10, subjectIsPlayer: true } as any)).toBe(true);
    expect(triggerConditionMatches(life, { id: 'p2', controllerId: 'p2', typeLine: 'Creature', anyObject: true } as any, src(), { playerLife: 11, subjectIsPlayer: true } as any)).toBe(false);

    expect(cond('When this creature has flying, sacrifice it.')?.hasKeyword).toBe('flying');
    expect(cond('When the Ring tempts you, return this card from your graveyard to your hand.')?.action).toBe('ring_tempts');
    expect(cond('Whenever one or more suspected creatures you control attack, surveil 1.')?.alternatives?.[0]?.subject?.suspected).toBe(true);
    expect(cond('When you play another land, sacrifice this land.')?.excludeSource).toBe(true);
    expect(cond('Whenever an opponent gains control of a permanent from you, create a Treasure.')?.fromYou).toBe(true);
  });

  it('tapped batch, exile from BF, token attack, loses game, multi discard/sac, different players', () => {
    expect(cond('Whenever one or more creatures you control become tapped, draw a card.')?.event).toBe('becomes_tapped');
    expect(cond('When ~ is put into exile from the battlefield, you may pay {2}.', "Urza's Sylex")?.fromZone).toBe('battlefield');
    expect(cond('Whenever this token and at least one other creature token attack, put a counter on it.')?.minOtherAttackers).toBe(1);
    expect(cond('Whenever another player loses the game, you gain life.')?.losesGame).toBe('not_you');
    expect(cond('Whenever one or more players discard one or more cards, investigate.')?.event).toBe('discards');
    expect(cond('Whenever one or more players sacrifice one or more creatures, create a Treasure.')?.event).toBe('sacrifices');
    const canal = cond("Whenever this creature and another creature attack different players, this creature can't be blocked.");
    expect(canal?.attackDifferentPlayers).toBe(true);
    const self = { id: 'w', controllerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(canal, self, self, { attackedPlayerIds: ['p2', 'p3'], attackerCount: 2 } as any)).toBe(true);
    expect(triggerConditionMatches(canal, self, self, { attackedPlayerIds: ['p2'], attackerCount: 2 } as any)).toBe(false);
  });

  it('lore saga, other-than-basic, DFC, named dies, next attack, Gonti, Ketramose, kicks', () => {
    expect(cond('Whenever you put a lore counter on a Saga you control, put a +1/+1 counter on a creature.')?.sagaSubject).toBe(true);
    expect(cond('Whenever a permanent other than a basic land enters, destroy all other permanents with that name.')?.alternatives?.[0]?.subject?.excludeBasicLand).toBe(true);
    expect(cond('Whenever Tetzin or another double-faced artifact you control enters, mill three cards.', 'Tetzin, Gnome Champion')?.alternatives?.[0]?.subject?.doubleFaced).toBe(true);
    const smaug = cond('When Smaug dies, create fourteen Treasure tokens.');
    expect(smaug?.requireSubjectName).toBe('smaug');
    expect(triggerConditionMatches(smaug, { id: 's', name: 'Smaug', controllerId: 'p2', typeLine: 'Creature' } as any, src(), {} as any)).toBe(true);
    expect(cond('When you next attack this turn, untap each creature you control.')?.delayedNextAttack).toBe(true);
    const gonti = cond("Whenever a player casts a spell they don't own, that player creates a Treasure token.");
    expect(gonti?.spellNotOwned).toBe(true);
    expect(triggerConditionMatches(gonti, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), { spellOwnerId: 'p1', controllerId: 'p2' } as any)).toBe(true);
    expect(triggerConditionMatches(gonti, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), { spellOwnerId: 'p2', controllerId: 'p2' } as any)).toBe(false);
    expect(cond('Whenever one or more cards are put into exile from graveyards and/or the battlefield during your turn, draw a card.')?.fromZone).toBe('battlefield_or_graveyard');
    expect(cond('Whenever a player kicks a spell, create a Saproling.')?.kickedSpell).toBe(true);
  });

  it('attack batches, War Doctor, Goggles, this-way riders, Shipwreck', () => {
    const harbin = cond('Whenever you attack with five or more Soldiers, creatures you control get +1/+1.');
    expect(harbin?.minAttackers).toBe(5);
    expect(triggerConditionMatches(harbin, { id: 'c1', controllerId: 'p1', typeLine: 'Creature — Soldier' } as any, src(), { attackerCount: 5 } as any)).toBe(true);
    expect(triggerConditionMatches(harbin, { id: 'c1', controllerId: 'p1', typeLine: 'Creature — Soldier' } as any, src(), { attackerCount: 4 } as any)).toBe(false);
    expect(cond('Whenever you attack with two or more Spiders, put a counter on it.')?.minAttackers).toBe(2);
    expect(cond('Whenever you attack with at least two creatures that have first strike, double strike, vigilance, and/or haste, transform it.')?.minAttackers).toBe(2);
    expect(cond('Whenever one or more other permanents phase out and whenever one or more other cards are put into exile from anywhere, put a time counter.')?.pairedEvent).toBe('exiled');
    const goggles = cond('When that mana is spent to cast a red instant or sorcery spell, copy that spell.');
    expect(goggles?.requiresSourceMana).toBe(true);
    expect(goggles?.legacyRuntimeOnly).toBeFalsy();
    expect(goggles?.alternatives?.[0]?.subject?.colors).toEqual(['r']);
    expect(cond('When you exile a nonland card this way, deal damage.')?.thisWay).toBe(true);
    expect(cond('Whenever you reveal a basic land card this way, draw a card.')?.thisWay).toBe(true);
    expect(cond('Whenever a card is drawn this way, deal 5 damage.')?.thisWay).toBe(true);
    expect(cond('Whenever you discard a Spirit card or a card with disturb, put a counter on it.')?.orHasKeyword).toBe('disturb');
  });
});
