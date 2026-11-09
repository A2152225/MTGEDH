import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

describe('round 56 ability-resolves, choice, this-way, bounce, OR, counters', () => {
  it('ability resolves: Tyvar mana ability and Gimli Nth resolve', () => {
    const tyvar = cond('Whenever a mana ability of this creature resolves, put a +1/+1 counter on it.');
    expect(tyvar?.event).toBe('performs');
    expect(tyvar?.abilityResolves).toBe(true);
    expect(tyvar?.action).toBe('mana_ability_resolve');

    const gimli = cond('When this ability resolves for the third time this turn, Gimli fights up to one target creature.');
    expect(gimli?.abilityResolves).toBe(true);
    expect(gimli?.resolveOrdinal).toBe(3);
    const subj = { id: 'c1', controllerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(gimli, subj, src(), { abilityResolveCount: 3 } as any)).toBe(true);
    expect(triggerConditionMatches(gimli, subj, src(), { abilityResolveCount: 2 } as any)).toBe(false);
  });

  it('choice-gated: chosen player, name, mana value, color', () => {
    const sewer = cond('Whenever the chosen player casts a spell, put a +1/+1 counter on this creature.');
    expect(sewer?.chosenPlayer).toBe(true);
    expect(triggerConditionMatches(sewer, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), { chosenPlayerId: 'p2' } as any)).toBe(true);
    expect(triggerConditionMatches(sewer, { id: 'sp', controllerId: 'p3', typeLine: 'Instant', anyObject: true } as any, src(), { chosenPlayerId: 'p2' } as any)).toBe(false);

    const silencer = cond('Whenever an opponent casts a spell with the chosen name, they lose 3 life.');
    expect(silencer?.chosenName || silencer?.requiresChosenName).toBe(true);
    expect(silencer?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(silencer, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src({ chosenCardName: 'Shock' }), { spellName: 'Shock', chosenCardName: 'Shock' } as any)).toBe(true);
    expect(triggerConditionMatches(silencer, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src({ chosenCardName: 'Shock' }), { spellName: 'Bolt', chosenCardName: 'Shock' } as any)).toBe(false);

    const nyota = cond('Whenever an opponent casts a spell with mana value equal to the chosen number, draw a card.');
    expect(nyota?.chosenManaValue).toBe(true);
    expect(nyota?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(nyota, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), { spellManaValue: 3, chosenManaValue: 3 } as any)).toBe(true);
    expect(triggerConditionMatches(nyota, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), { spellManaValue: 2, chosenManaValue: 3 } as any)).toBe(false);

    const mangara = cond('Whenever a creature of the chosen color deals damage to you or a white creature you control, destroy that creature.');
    expect(mangara?.alternatives?.[0]?.subject?.chosenColor).toBe(true);
    expect(triggerConditionMatches(mangara, { id: 'c1', controllerId: 'p2', typeLine: 'Creature', colors: ['r'] } as any, src({ chosenColor: 'red' }), { damageRecipientPlayerId: 'p1' } as any)).toBe(true);
  });

  it('this-way reflexive, typed bounce, untap-or-lose-control, Dark Depths', () => {
    const pb = cond('Whenever you reveal a card with mana value less than the result this way, you may exile it.');
    expect(pb?.manaValueLessThanResult).toBe(true);
    expect(triggerConditionMatches(pb, { id: 'sp', controllerId: 'p1', typeLine: 'Instant', anyObject: true } as any, src(), { revealedManaValue: 2, rollResult: 5 } as any)).toBe(true);
    expect(triggerConditionMatches(pb, { id: 'sp', controllerId: 'p1', typeLine: 'Instant', anyObject: true } as any, src(), { revealedManaValue: 6, rollResult: 5 } as any)).toBe(false);

    const inferno = cond('When its power becomes 20 this way, it deals 20 damage to any target.');
    expect(inferno?.powerBecomes).toBe(20);
    expect(triggerConditionMatches(inferno, { id: 'c1', controllerId: 'p1', typeLine: 'Creature' } as any, src(), { subjectPower: 20, abilityResolveCount: 1 } as any)).toBe(true);
    expect(triggerConditionMatches(inferno, { id: 'c1', controllerId: 'p1', typeLine: 'Creature' } as any, src(), { subjectPower: 19 } as any)).toBe(false);

    expect(cond('Whenever one or more noncreature permanents are returned to hand, draw a card.')?.event).toBe('returned_to_hand');

    const coffin = cond('When this creature becomes untapped or you lose control of this creature, exile that creature.');
    expect(coffin?.event).toBe('becomes_untapped');
    expect(coffin?.pairedEvent).toBe('loses_control');

    const depths = cond('When ~ has no ice counters on it, sacrifice it.', 'Dark Depths');
    expect(depths?.event).toBe('controls_none');
    expect(depths?.noCounters).toBe('ice');
  });

  it('owner damage, lesser-power block, player|permanent target, activates, excess', () => {
    expect(cond('Whenever a creature deals combat damage to its owner, exile that creature.')?.damageRecipientOwner).toBe(true);
    const nq = cond('Whenever a creature becomes blocked by a creature with lesser power, destroy both.');
    expect(nq?.blockPartnerLesserPower).toBe(true);
    expect(triggerConditionMatches(nq, { id: 'a', controllerId: 'p1', typeLine: 'Creature', power: 5 } as any, src(), { blockPartner: { id: 'b', controllerId: 'p2', typeLine: 'Creature', power: 2 } } as any)).toBe(true);
    expect(triggerConditionMatches(nq, { id: 'a', controllerId: 'p1', typeLine: 'Creature', power: 5 } as any, src(), { blockPartner: { id: 'b', controllerId: 'p2', typeLine: 'Creature', power: 6 } } as any)).toBe(false);

    expect(cond('Whenever a player or permanent becomes the target of an ability you control, draw a card.')?.orPlayerSubject).toBe(true);
    expect(cond('When it deals excess damage this way, destroy target artifact.')?.requiresExcess).toBe(true);
    expect(cond('Whenever you activate an ability of an artifact, copy it.')?.action).toBe('activate_artifact');
    expect(cond('Whenever you activate a ninjutsu ability, draw a card.')?.action).toBe('activate_ninjutsu');
    expect(cond('Whenever this creature is dealt 3 or more damage, draw a card.')?.minDamageAmount).toBe(3);
  });
});
