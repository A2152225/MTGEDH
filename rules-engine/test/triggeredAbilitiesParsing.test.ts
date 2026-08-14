import { describe, expect, it } from 'vitest';
import { parseTriggeredAbilitiesFromText } from '../src/triggeredAbilitiesParsing';
import { TriggerEvent } from '../src/triggeredAbilitiesTypes';

describe('triggered ability parsing', () => {
  it('does not treat bare "at" in "Look at" as a trigger keyword', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      'Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.',
      'SRC',
      'P1',
      'Ponder',
    );
    expect(abilities).toHaveLength(0);
  });

  it('parses upkeep triggers with "at the beginning of"', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      'At the beginning of your upkeep, draw a card.',
      'SRC',
      'P1',
      'Phyrexian Arena',
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.event).toBe(TriggerEvent.BEGINNING_OF_UPKEEP);
  });

  it('parses epic-style each-of-your-upkeeps triggers', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      'Epic\nAt the beginning of each of your upkeeps, copy this spell except for its epic ability.',
      'SRC',
      'P1',
      'Neverending Torment',
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.event).toBe(TriggerEvent.BEGINNING_OF_UPKEEP);
  });

  it('classifies when-you-do and face-up triggers instead of unknown_trigger_pattern', () => {
    const exert = parseTriggeredAbilitiesFromText(
      'You may exert this creature as it attacks. When you do, it gets +1/+2 until end of turn.',
      'SRC',
      'P1',
      'Nef-Crop Entangler',
    );
    expect(exert.some((a) => a.event === TriggerEvent.ATTACKS && a.triggerFilter === 'you do')).toBe(true);
    expect(exert.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);

    const morph = parseTriggeredAbilitiesFromText(
      'When this creature is turned face up, draw a card.',
      'SRC',
      'P1',
      'Test Morph',
    );
    expect(morph.some((a) => a.event === TriggerEvent.ENTERS_BATTLEFIELD)).toBe(true);
    expect(morph.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);
  });

  it('skips bogus mana-spent and next-cast riders', () => {
    const pathAbilities = parseTriggeredAbilitiesFromText(
      'This land enters tapped.\n{T}: Add one mana of any color in your commander\'s color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.',
      'SRC',
      'P1',
      'Path of Ancestry',
    );
    expect(pathAbilities.filter((a) => /\bcast\b/i.test(String(a.condition || a.triggerFilter || '')))).toHaveLength(0);

    const sloppityAbilities = parseTriggeredAbilitiesFromText(
      'Jolly Gutpipes — {2}, {T}, Sacrifice a creature: The next creature spell you cast this turn has cascade. (When you next cast a creature spell, exile cards from the top of your library until you exile a nonland card that costs less.)',
      'SRC',
      'P1',
      'Sloppity Bilepiper',
    );
    expect(sloppityAbilities.filter((a) => /\bcast\b/i.test(String(a.condition || a.triggerFilter || '')))).toHaveLength(0);
  });

  it('parses opponent discard triggers', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      'Whenever an opponent discards a card, create a Treasure token.',
      'SRC',
      'P1',
      'Waste Not',
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.event).toBe(TriggerEvent.DISCARDED);
  });

  it('parses Elder Brain attack trigger without cast-this-way bogus trigger', () => {
    const oracle =
      "Whenever this creature attacks a player, exile all cards from that player's hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.";
    const abilities = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', 'Elder Brain');
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.event).toBe(TriggerEvent.ATTACKS);
    expect(abilities.some((a) => a.event === TriggerEvent.SPELL_CAST)).toBe(false);
  });

  it('does not parse granted ability triggers from inside quotation marks', () => {
    const oracle =
      '{T}: Draw a card, then exile a card from your hand and put a number of time counters on it equal to its mana value. It gains "When the last time counter is removed from this card, if it\'s exiled, you may cast it without paying its mana cost. If you cast a creature spell this way, it gains haste until end of turn." Then remove a time counter from each other card you own in exile.';
    const abilities = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', 'Alaundo the Seer');
    expect(abilities).toHaveLength(0);
  });

  it('does not parse loyalty-line nested attack triggers as standalone triggers', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      '+1: Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.\n-2: Draw a card.',
      'SRC',
      'P1',
      'Jace, Architect of Thought',
    );
    expect(abilities).toHaveLength(0);
  });

  it('skips fight aftermath excess-damage triggers on one-shot spells', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      "Target creature you control fights target creature an opponent controls. When excess damage is dealt to the creature an opponent controls this way, destroy up to one target artifact.",
      'SRC',
      'P1',
      "Rhino's Rampage",
    );
    expect(abilities.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);
  });

  it('classifies equipped-creature transform and compound enters-or-attacks triggers', () => {
    const equipment = parseTriggeredAbilitiesFromText(
      'When equipped creature transforms, transform this Equipment.',
      'SRC',
      'P1',
      'Neglected Heirloom // Ashmouth Blade',
    );
    expect(equipment.some((a) => a.event === TriggerEvent.TRANSFORMED)).toBe(true);
    expect(equipment.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);

    const kindred = parseTriggeredAbilitiesFromText(
      'Whenever a creature you control of the chosen type enters or attacks, draw a card.',
      'SRC',
      'P1',
      'Kindred Discovery',
    );
    const attackTrigger = kindred.find((a) => a.event === TriggerEvent.ATTACKS);
    expect(attackTrigger?.triggerFilter).toMatch(/attacks/);
  });

  it('classifies noncombat damage and transform triggers instead of unknown_trigger_pattern', () => {
    const damage = parseTriggeredAbilitiesFromText(
      'Whenever a source you control deals noncombat damage to an opponent, create a Treasure token.',
      'SRC',
      'P1',
      'Fear of Burning Alive',
    );
    expect(damage.some((a) => a.event === TriggerEvent.DEALS_DAMAGE)).toBe(true);
    expect(damage.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);

    const transform = parseTriggeredAbilitiesFromText(
      'When this creature transforms into this permanent, draw a card.',
      'SRC',
      'P1',
      'Ulrich of the Krallenhorde',
    );
    expect(transform.some((a) => a.event === TriggerEvent.TRANSFORMED)).toBe(true);
    expect(transform.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);
  });

  it('classifies player-casts-color and cycle-a-card triggers instead of unknown_trigger_pattern', () => {
    const megrim = parseTriggeredAbilitiesFromText(
      'Whenever a player casts a black spell, that player loses 2 life.',
      'SRC',
      'P1',
      'Megrim',
    );
    expect(megrim.some((a) => a.event === TriggerEvent.SPELL_CAST)).toBe(true);
    expect(megrim.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);

    const cycle = parseTriggeredAbilitiesFromText(
      'Whenever you cycle a card, when you do, put a +1/+1 counter on target creature you control.',
      'SRC',
      'P1',
      'Savai Thundermane',
    );
    expect(cycle.some((a) => a.event === TriggerEvent.SPELL_CAST)).toBe(true);
    expect(cycle.some((a) => a.triggerFilter === 'unknown_trigger_pattern')).toBe(false);
  });

  it('still parses real dies trigger when effect contains quoted granted text', () => {
    const oracle =
      'When Ozox dies, create Jumblebones, a legendary 2/1 black Skeleton creature token with "Jumblebones can\'t block" and "When Jumblebones leaves the battlefield, return target card named Ozox, the Clattering King from your graveyard to your hand."';
    const abilities = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', 'Ozox, the Clattering King');
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.event).toBe(TriggerEvent.DIES);
  });

  it('stops trigger effect before waterbend activated line', () => {
    const oracle =
      "Whenever a creature you control deals combat damage to a player, put a quest counter on this enchantment. Then if it has four or more quest counters on it, draw a card.\nWaterbend {4}: Target creature can't be blocked this turn.";
    const abilities = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', 'Waterbender Ascension');
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.effect?.toLowerCase()).toContain('quest counter');
    expect(abilities[0]?.effect?.toLowerCase()).not.toContain('waterbend');
    expect(abilities[0]?.effect?.toLowerCase()).not.toContain("can't be blocked");
  });

  it('preserves "an enchantment you control enters" instead of treating it as self-ETB', () => {
    const oracle =
      'Whenever an enchantment you control enters, tap up to one target creature and goad it.\nWhenever one or more creatures that are enchanted by an Aura you control attack, draw a card.';
    const abilities = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', 'Killian, Decisive Mentor');
    const etb = abilities.find((a) => a.event === TriggerEvent.ENTERS_BATTLEFIELD);
    expect(etb).toBeDefined();
    expect(String(etb?.triggerFilter || '').toLowerCase()).toBe('an enchantment you control enters');
  });
});
