import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', name: 'Pirated Copy', cardName: 'Pirated Copy', ...extra } as any);

describe('round 54 generics + one-card specials', () => {
  it('same-name, zone-OR exile, self-exclusion attack batches', () => {
    const same = cond('Whenever this creature or another creature with the same name deals combat damage to a player, draw a card.');
    expect(same?.event).toBe('deals_combat_damage_to_player');
    expect(same?.sameNameAsSource).toBe(true);
    const twin = { id: 'c2', controllerId: 'p1', typeLine: 'Creature', name: 'Pirated Copy' } as any;
    const other = { id: 'c3', controllerId: 'p1', typeLine: 'Creature', name: 'Bear' } as any;
    expect(triggerConditionMatches(same, twin, src())).toBe(true);
    expect(triggerConditionMatches(same, other, src())).toBe(false);

    const exile = cond('Whenever one or more creatures you control and/or creature cards in your graveyard are put into exile, draw a card.');
    expect(exile?.event).toBe('exiled');
    expect(exile?.fromZone).toBe('battlefield_or_graveyard');
    const cre = { id: 'c1', controllerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(exile, cre, src(), { fromZone: 'battlefield' } as any)).toBe(true);
    expect(triggerConditionMatches(exile, cre, src(), { fromZone: 'graveyard' } as any)).toBe(true);
    expect(triggerConditionMatches(exile, cre, src(), { fromZone: 'hand' } as any)).toBe(false);

    const gideon = cond('Whenever you attack with two or more non-Gideon creatures, draw a card.', 'Gideon, the Oathsworn');
    expect(gideon?.event).toBe('attacks');
    expect(gideon?.excludeSourceFromAttackers).toBe(true);
  });

  it('combat-history gates, fought-this-way, ownership state', () => {
    const blocked = cond('Whenever a creature attacking one of your opponents becomes blocked by two or more creatures, draw a card.');
    expect(blocked?.event).toBe('becomes_blocked');
    expect(blocked?.minBlockers).toBe(2);
    const atk = { id: 'a1', controllerId: 'p2', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(blocked, atk, src(), { blockerCount: 2, attackedPlayerId: 'p2' } as any)).toBe(true);
    expect(triggerConditionMatches(blocked, atk, src(), { blockerCount: 1, attackedPlayerId: 'p2' } as any)).toBe(false);

    const shark = cond('Whenever this creature blocks or becomes blocked by a creature that has been dealt damage this turn, draw a card.');
    expect(shark?.event).toBe('blocks');
    expect(shark?.blockPartnerDealtDamageThisTurn).toBe(true);
    expect(shark?.pairedEvent).toBe('becomes_blocked');

    const fought = cond('Whenever a creature that fought this way dies this turn, draw a card.');
    expect(fought?.event).toBe('dies');
    expect(fought?.foughtThisWay).toBe(true);
    expect(triggerConditionMatches(fought, atk, src(), { foughtThisWay: true } as any)).toBe(true);
    expect(triggerConditionMatches(fought, atk, src(), { foughtThisWay: false } as any)).toBe(false);

    const owner = cond("When a player other than this creature's owner controls it, sacrifice it.");
    expect(owner?.event).toBe('controls_none');
    expect(owner?.controllerNotOwner).toBe(true);
    const stolen = { id: 'w', controllerId: 'p2', ownerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(owner, stolen, src())).toBe(true);
    expect(triggerConditionMatches(owner, { ...stolen, controllerId: 'p1' }, src())).toBe(false);
  });

  it('subtype batches Scout/Rabbit + Enkira/deathtouch', () => {
    const scouts = cond('Whenever one or more Scouts, Pirates, and/or Rogues you control deal combat damage to a player, draw a card.');
    expect(scouts?.event).toBe('deals_combat_damage_to_player');
    expect(scouts?.alternatives?.[0]?.subject?.subtypeGroups).toEqual([['scout'], ['pirate'], ['rogue']]);
    const scout = { id: 's1', controllerId: 'p1', typeLine: 'Creature — Scout' } as any;
    expect(triggerConditionMatches(scouts, scout, src())).toBe(true);

    const rabbits = cond('Whenever one or more other Rabbits, Bats, Birds, and/or Mice you control enter, scry 1.');
    expect(rabbits?.event).toBe('enters');
    expect(rabbits?.alternatives?.[0]?.subject?.subtypeGroups).toEqual([['rabbit'], ['bat'], ['bird'], ['mouse']]);

    const enkira = cond('Whenever Enkira and at least two Zombies attack, draw a card.', 'Enkira, Hostile Scavenger');
    expect(enkira?.event).toBe('attacks');
    expect(enkira?.minOtherAttackers).toBe(2);

    const dt = cond('Whenever a creature with deathtouch blocks or becomes blocked by this creature, destroy that creature.');
    expect(dt?.event).toBe('blocks');
    expect(dt?.pairedEvent).toBe('becomes_blocked');
  });

  it('one-card specials: wedding, jumblebones, zone/cast extras', () => {
    expect(cond('Whenever an opponent who controls an artifact named Wedding Ring draws a card during their turn, draw a card.')?.requiresOpponentControlsNamed).toBe('wedding ring');
    expect(cond('When Jumblebones leaves the battlefield, return Ozox.')?.event).toBe('leaves_battlefield');
    expect(cond('Whenever a creature other than Captain Marvel is exiled from the battlefield, gain life.', 'Captain Marvel, Shooting Star')?.event).toBe('exiled');
    expect(cond('Whenever you attack with this creature and/or your commander, create tokens.')?.event).toBe('attacks');
    expect(cond('Whenever an opponent sacrifices a nontoken permanent or discards a permanent card, draw a card.')?.pairedEvent).toBe('discards');
    expect(cond('When you lose the flip, deal damage.')?.action).toBe('lose_coin_flip');
    expect(cond("When you don't control a legendary Vampire, exile this creature.")?.event).toBe('controls_none');
    expect(cond('Whenever the first noncreature spell of a turn is cast, counter it.')?.event).toBe('spell_cast');
    expect(cond('Whenever another player casts a spell from anywhere other than their hand, draw a card.')?.castFromZone).toBe('not_hand');
    expect(cond('Whenever you cast an instant or sorcery spell that has the same name as a card in your graveyard, draw a card.')?.sameNameAsGraveyard).toBe(true);
  });
});
