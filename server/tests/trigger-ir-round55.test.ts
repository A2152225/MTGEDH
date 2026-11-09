import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

describe('round 55 one-offs and remaining families', () => {
  it('cumulative upkeep, prevented damage, total-power attack, natural N, no lands', () => {
    expect(cond("When a player doesn't pay this enchantment's cumulative upkeep, draw a card.")?.cumulativeUpkeepUnpaid).toBe(true);
    const prev = cond('Whenever damage that would be dealt to you is prevented, draw a card.');
    expect(prev?.event).toBe('dealt_damage');
    expect(prev?.damagePrevented).toBe(true);
    expect(triggerConditionMatches(prev, { id: 'p1', controllerId: 'p1', typeLine: 'Creature' } as any, src(), { damagePrevented: true, subjectIsPlayer: true } as any)).toBe(true);
    expect(triggerConditionMatches(prev, { id: 'p1', controllerId: 'p1', typeLine: 'Creature' } as any, src(), { damagePrevented: false, subjectIsPlayer: true } as any)).toBe(false);

    const power = cond('Whenever you attack with creatures with total power 6 or greater for the first time each turn, draw a card.');
    expect(power?.event).toBe('attacks');
    expect(power?.minTotalPower).toBe(6);
    expect(power?.onceEachTurn).toBe(true);
    const atk = { id: 'c1', controllerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(power, atk, src(), { totalAttackerPower: 6, attackerCount: 2 } as any)).toBe(true);
    expect(triggerConditionMatches(power, atk, src(), { totalAttackerPower: 5, attackerCount: 2 } as any)).toBe(false);

    const nat = cond('When you roll a natural 20, draw a card.');
    expect(nat?.naturalRoll).toBe(20);
    expect(triggerConditionMatches(nat, atk, src(), { naturalRoll: 20 } as any)).toBe(true);
    expect(triggerConditionMatches(nat, atk, src(), { naturalRoll: 19 } as any)).toBe(false);

    expect(cond('When there are no lands on the battlefield, draw a card.')?.event).toBe('controls_none');
  });

  it('bounce, exiled-with play, Chalice, Ichneumon, golem target, fifth draw', () => {
    expect(cond('Whenever this creature or another creature is returned to your hand from the battlefield, draw a card.')?.event).toBe('returned_to_hand');
    expect(cond('Whenever a player plays a card exiled with ~, draw a card.', 'Prowl, Stoic Strategist')?.exiledWithSource).toBe(true);
    const chalice = cond('Whenever a player casts a spell with mana value equal to the number of charge counters on this artifact, counter it.');
    expect(chalice?.manaValueEqualsChargeCounters).toBe(true);
    expect(triggerConditionMatches(chalice, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), { spellManaValue: 2, chargeCountersOnSource: 2 } as any)).toBe(true);
    expect(triggerConditionMatches(chalice, { id: 'sp', controllerId: 'p2', typeLine: 'Instant' } as any, src(), { spellManaValue: 3, chargeCountersOnSource: 2 } as any)).toBe(false);

    expect(cond('Whenever an opponent casts an instant spell other than the first instant spell that player casts each turn, draw a card.')?.excludeFirstSpellEachTurn).toBe(true);
    expect(cond('Whenever a player casts an instant or sorcery spell that targets only a single golem, copy it.')?.targetsOnlySubtype).toBe('golem');
    expect(cond('Whenever you draw your fifth card each turn, create a token.')?.ordinal).toBe('fifth');
  });

  it('unblocked attack you, source N damage, stickers, waterbend, loses game, counters', () => {
    expect(cond("Whenever one or more creatures an opponent controls attack you and aren't blocked, draw a card.")?.event).toBe('attacks_unblocked');
    const dmg = cond('Whenever a source you control deals 4 or more damage to a player, draw a card.');
    expect(dmg?.minDamageAmount).toBe(4);
    expect(cond('Whenever you put an art sticker on a creature, draw a card.')?.action).toBe('place_art_sticker');
    expect(cond('Whenever you waterbend, draw a card.')?.action).toBe('waterbend');
    expect(cond('When the chosen player loses the game, draw a card.')?.losesGame).toBe('chosen_player');
    expect(cond('When this artifact has twenty or more charge counters on it, you win the game.')?.chargeCounterMinimum).toBe(20);
    expect(cond('When Garruk has two or fewer loyalty counters on him, transform him.', 'Garruk Relentless')?.loyaltyMaximum).toBe(2);
    expect(cond('When the twelfth hour counter is put on this artifact, draw a card.')?.counterOrdinal).toBe(12);
    expect(cond('When the last ore counter is removed from this aura, draw a card.')?.event).toBe('last_counter_removed');
  });

  it('kai winn, talion, redwing, surrak, end step next, primal mana', () => {
    expect(cond('Whenever an opponent casts a spell with the chosen name or activates an ability of a source with the chosen name, draw a card.')?.chosenName).toBe(true);
    expect(cond('Whenever an opponent casts a spell with mana value 2, draw a card.')?.spellManaValue).toBe(2);
    const red = cond('Whenever Redwing attacks, draw a card.', 'Falcon, Winged Wonder');
    expect(red?.requireAttackerName).toBe('redwing');
    expect(cond('Whenever a creature you control or a creature spell you control becomes the target of a spell or ability an opponent controls, draw a card.')?.orSpellSubject).toBe(true);
    expect(cond("At the beginning of the end step of that player's next turn, draw a card.")?.delayedNextTurn).toBe(true);
    expect(cond('When that mana is spent to cast an instant or sorcery spell, draw a card.')?.requiresSourceMana).toBe(true);
  });
});
