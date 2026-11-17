import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../src/triggerCondition/index';

const src = { id: 'src', controllerId: 'p1' };
const perm = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  typeLine: 'Creature - Bear',
  controllerId: 'p1',
  ...over,
});

describe('trigger IR round 67 leftovers', () => {
  it('parses a life threshold without taking over the life emitter', () => {
    const parsed = parseTriggerClause(
      'When you have 10 or less life, if this permanent is an enchantment, it becomes a 3/5 Soldier creature.',
      'Opal Avenger',
    );
    expect(parsed?.condition.event).toBe('life_threshold');
    expect(parsed?.condition.lifeAtMost).toBe(10);
    expect(parsed?.interveningIf).toMatch(/enchantment/i);
  });

  it('parses counter thresholds on this permanent', () => {
    const tome = parseTriggerClause(
      'When there are four or more page counters on this artifact, exile it.',
      'Mazemind Tome',
    );
    expect(tome?.condition.event).toBe('source_counter_threshold');
    expect(tome?.condition.sourceCounterKind).toBe('page');
    expect(tome?.condition.sourceCounterAtLeast).toBe(4);

    const calendar = parseTriggerClause(
      'When there are 1,000 or more time counters on The Millennium Calendar, sacrifice it and each opponent loses 1,000 life.',
      'The Millennium Calendar',
    );
    expect(calendar?.condition.event).toBe('source_counter_threshold');
    expect(calendar?.condition.sourceCounterKind).toBe('time');
    expect(calendar?.condition.sourceCounterAtLeast).toBe(1000);
    expect(calendar?.effect).toMatch(/sacrifice it/i);
  });

  it('parses a vehicle crewed by this permanent', () => {
    const parsed = parseTriggerClause(
      "Whenever a Vehicle crewed by Balthier and Fran this turn attacks, if it's the first combat phase of the turn, you may pay {1}{R}{G}.",
      'Balthier and Fran',
    );
    expect(parsed?.condition.event).toBe('attacks');
    expect(parsed?.condition.crewedBySourceThisTurn).toBe(true);
    expect(parsed?.interveningIf).toMatch(/first combat phase/i);
    const vehicle = perm({ id: 'veh', typeLine: 'Artifact — Vehicle', controllerId: 'p1' });
    expect(triggerConditionMatches(parsed!.condition, vehicle, src, { crewedByPermanentIds: ['src'] })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, vehicle, src, { crewedByPermanentIds: ['other'] })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, vehicle, src, {})).toBe(false);
  });

  it('parses damage from an opponent source and from a single-target spell', () => {
    const arch = parseTriggerClause(
      "Whenever a source an opponent controls deals damage to this creature, that source's controller loses that much life.",
      'Archfiend of Spite',
    );
    expect(arch?.condition.event).toBe('deals_damage');
    expect(arch?.condition.damageRecipient).toBe('source');
    expect(arch?.condition.alternatives[0].controller).toBe('not_you');
    const bolt = perm({ id: 'src2', controllerId: 'p2' });
    expect(triggerConditionMatches(arch!.condition, bolt, src, { damageRecipientIsSource: true })).toBe(true);
    expect(triggerConditionMatches(arch!.condition, perm({ id: 'src2', controllerId: 'p1' }), src, { damageRecipientIsSource: true })).toBe(false);

    const imodane = parseTriggerClause(
      'Whenever an instant or sorcery spell you control that targets only a single creature deals damage to that creature, Imodane deals that much damage to each opponent.',
      'Imodane, the Pyrohammer',
    );
    expect(imodane?.condition.spellTargetsSingleCreature).toBe(true);
    expect(imodane?.condition.damageSourceIsSpell).toBe(true);
    const spell = perm({ id: 'bolt', typeLine: 'Instant', controllerId: 'p1' });
    expect(triggerConditionMatches(imodane!.condition, spell, src, {
      damageSourceIsSpell: true,
      damageRecipientIsCreature: true,
      singleCreatureTargetId: 'bear',
      damagedPermanentId: 'bear',
    })).toBe(true);
    expect(triggerConditionMatches(imodane!.condition, spell, src, {
      damageSourceIsSpell: true,
      damageRecipientIsCreature: true,
      singleCreatureTargetId: 'bear',
      damagedPermanentId: 'wall',
    })).toBe(false);
  });

  it('parses linked leaves, stolen equipment, and this-combat attackers', () => {
    const zenos = parseTriggerClause(
      'When the chosen creature leaves the battlefield, transform Zenos yae Galvus.',
      'Zenos yae Galvus',
    );
    expect(zenos?.condition.chosenCreatureLeaves).toBe(true);
    const chosen = perm({ id: 'chosen' });
    expect(triggerConditionMatches(zenos!.condition, chosen, { ...src, chosenCreatureId: 'chosen' } as any)).toBe(true);
    expect(triggerConditionMatches(zenos!.condition, chosen, src)).toBe(false);

    const mystery = parseTriggerClause(
      'When the creature put onto the battlefield with Havengul Mystery leaves the battlefield, transform Havengul Mystery.',
      'Havengul Mystery',
    );
    expect(mystery?.condition.putOntoBattlefieldWithSource).toBe(true);
    expect(triggerConditionMatches(mystery!.condition, perm({ id: 'back' }), src, { enteredBySourceId: 'src' })).toBe(true);
    expect(triggerConditionMatches(mystery!.condition, perm({ id: 'back' }), src, { enteredBySourceId: 'other' })).toBe(false);

    const ogre = parseTriggerClause(
      'When you lose control of that Equipment, unattach it.',
      'Ogre Geargrabber',
    );
    expect(ogre?.condition.event).toBe('loses_control');
    expect(ogre?.condition.linkedEquipment).toBe(true);
    const equip = perm({ id: 'eq', typeLine: 'Artifact — Equipment', controllerId: 'p1' });
    expect(triggerConditionMatches(ogre!.condition, equip, { ...src, linkedEquipmentId: 'eq' } as any)).toBe(true);
    expect(triggerConditionMatches(ogre!.condition, equip, src)).toBe(false);

    const love = parseTriggerClause(
      'Whenever either of those creatures deals combat damage to a player this combat, put a +1/+1 counter on it.',
      'Love on the Battlefield',
    );
    expect(love?.condition.eitherOfLinkedAttackers).toBe(true);
    const attacker = perm({ id: 'a1' });
    expect(triggerConditionMatches(love!.condition, attacker, src, { linkedAttackerIds: ['a1', 'a2'] })).toBe(true);
    expect(triggerConditionMatches(love!.condition, perm({ id: 'a3' }), src, { linkedAttackerIds: ['a1', 'a2'] })).toBe(false);
  });

  it('parses a chosen-color block, target choice, caused abilities, color rank, and Arabian Nights', () => {
    const boa = parseTriggerClause(
      'Whenever this creature becomes blocked by a creature of that color this turn, destroy that creature.',
      'Zombie Boa',
    );
    expect(boa?.condition.blockedByChosenColor).toBe(true);
    const self = perm({ id: 'src' });
    const armed = { ...src, chosenColor: 'black', blockColorWatchTurn: 3 } as any;
    expect(triggerConditionMatches(boa!.condition, self, armed, {
      turnNumber: 3,
      blockPartner: perm({ id: 'blk', colors: ['B'] }) as any,
    })).toBe(true);
    expect(triggerConditionMatches(boa!.condition, self, armed, {
      turnNumber: 3,
      blockPartner: perm({ id: 'blk', colors: ['W'] }) as any,
    })).toBe(false);
    expect(triggerConditionMatches(boa!.condition, self, { ...src, chosenColor: 'black' }, {
      turnNumber: 3,
      blockPartner: perm({ colors: ['B'] }) as any,
    })).toBe(false);

    const battle = parseTriggerClause(
      'Whenever a player chooses one or more targets, each player reveals the top card of their library.',
      'Psychic Battle',
    );
    expect(battle?.condition.event).toBe('chooses_targets');

    const proctor = parseTriggerClause(
      'Whenever a permanent entering causes a triggered ability to trigger, counter that ability unless its controller pays {2}.',
      'Strict Proctor',
    );
    expect(proctor?.condition.causedKind).toBe('etb');
    expect(triggerConditionMatches(proctor!.condition, perm(), src, { causedKind: 'etb' })).toBe(true);
    expect(triggerConditionMatches(proctor!.condition, perm(), src, { causedKind: 'attack_own_creature' })).toBe(false);

    const spawn = parseTriggerClause(
      "Whenever a creature entering under an opponent's control causes a triggered ability of that creature to trigger, you may copy that ability.",
      'Aboleth Spawn',
    );
    expect(spawn?.condition.causedKind).toBe('etb_opponent_creature');
    expect(triggerConditionMatches(spawn!.condition, perm(), src, {
      causedKind: 'etb_opponent_creature',
      causedSourceIsCreature: true,
      causedSourceControllerId: 'p2',
      causedSourceId: 'opp',
      causedAbilitySourceId: 'opp',
    })).toBe(true);
    expect(triggerConditionMatches(spawn!.condition, perm(), src, {
      causedKind: 'etb_opponent_creature',
      causedSourceIsCreature: true,
      causedSourceControllerId: 'p1',
      causedSourceId: 'mine',
      causedAbilitySourceId: 'mine',
    })).toBe(false);

    const fire = parseTriggerClause(
      'Whenever a creature you control attacking causes a triggered ability of that creature to trigger, put a quest counter on this enchantment.',
      'Firebender Ascension',
    );
    expect(fire?.condition.causedKind).toBe('attack_own_creature');
    expect(triggerConditionMatches(fire!.condition, perm(), src, {
      causedKind: 'attack_own_creature',
      causedSourceIsCreature: true,
      causedSourceControllerId: 'p1',
      causedSourceId: 'atk',
      causedAbilitySourceId: 'atk',
    })).toBe(true);

    const arms = parseTriggerClause(
      "When the chosen color isn't the most common color among nontoken permanents the chosen player controls or is tied for most common, sacrifice this enchantment.",
      'Call to Arms',
    );
    expect(arms?.condition.event).toBe('color_rank');
    expect(arms?.condition.chosenColorNotStrictlyMostCommon).toBe(true);

    const city = parseTriggerClause(
      'Whenever one or more other nontoken permanents with a name originally printed in the Arabian Nights expansion are on the battlefield, their controllers sacrifice them.',
      'City in a Bottle',
    );
    expect(city?.condition.event).toBe('set_presence');
    expect(city?.condition.originallyPrintedInSet).toBe('arn');
  });

  it('parses a milled-this-way rider as a mill event, not a legacy enters stub', () => {
    const parsed = parseTriggerClause(
      'When one or more cards are milled this way, exile target enchantment, instant, or sorcery card with equal or lesser mana value than that spell from among the milled cards. You may cast that card without paying its mana cost.',
      'Saruman of Many Colors',
    );
    expect(parsed?.condition.event).toBe('mills');
    expect(parsed?.condition.thisWay).toBe(true);
    expect(parsed?.condition.delayedRider).toBe(true);
    expect(parsed?.condition.legacyRuntimeOnly).toBeUndefined();
    expect(parsed?.condition.quantity).toBe('one_or_more');
    expect(parsed?.effect).toMatch(/exile target enchantment, instant, or sorcery card/i);
    expect(parsed?.effect).toMatch(/you may cast that card/i);
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Instant' }), src, { thisWay: true })).toBe(false);
  });
});
