import { describe, expect, it } from 'vitest';
import {
  evaluateLiveSeams,
  suspendTickEmitsExileTimeCounter,
} from '../scripts/oracle-ir-live-seam-audit.ts';

const REGISAUR =
  'Other Dinosaurs you control have haste.\nWhen this creature enters, create a 3/3 green Dinosaur creature token with trample.';
const SPACESHIP =
  "Vigilance, trample\nOther Dinosaurs you control get +1/+1 and have vigilance and trample.\nSuspend 4—{3}{R}{W}\nWhenever a time counter is removed from this card while it's exiled, create a 2/2 red and white Dinosaur creature token with flying and haste.";
const ANCESTOR =
  'Flying\nWhenever this creature enters or attacks, goad target creature. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)\nWhenever a goaded creature attacks, it deals 1 damage to its controller.';
const CHIEFTAIN =
  'Haste\nOther Goblins you control get +1/+1 and have haste.';
const ALWAYS_WATCHING =
  'Nontoken creatures you control get +1/+1 and have vigilance.';
const SOUL_WARDEN =
  'Whenever another creature enters, you gain 1 life.';
const BLOOD_ARTIST =
  'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.';
const GRAVE_PACT =
  'Whenever a creature you control dies, each opponent sacrifices a creature.';
const ANGER =
  'Haste\nAs long as this card is in your graveyard and you control a Mountain, creatures you control have haste.';
const SELF_ATTACK =
  'Whenever this creature attacks, it gets +1/+1 until end of turn.';
const WIDGET_LORD = 'Other Widgets you control have banding.';

describe('oracle IR live-seam audit', () => {
  it('treats wired other-type lords as covered and nonsense types as gaps', () => {
    expect(evaluateLiveSeams({
      name: 'Regisaur Alpha',
      type_line: 'Creature — Dinosaur',
      oracle_text: REGISAUR,
    }, { exileEmission: true }).filter((gap) => gap.seam.startsWith('static_'))).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Goblin Chieftain',
      type_line: 'Creature — Goblin',
      oracle_text: CHIEFTAIN,
    }, { exileEmission: true }).some((gap) => gap.seam === 'static_other_type_lord')).toBe(false);

    expect(evaluateLiveSeams({
      name: 'Fake Widget Lord',
      type_line: 'Creature — Widget',
      oracle_text: WIDGET_LORD,
    }, { exileEmission: true }).some((gap) => gap.seam === 'static_other_type_lord')).toBe(true);
  });

  it('requires both ETB and attack detectors for enters or attacks, plus goaded watchers', () => {
    const gaps = evaluateLiveSeams({
      name: 'Vengeful Ancestor',
      type_line: 'Creature — Spirit Dragon',
      oracle_text: ANCESTOR,
    }, { exileEmission: true });
    expect(gaps.filter((gap) => gap.seam === 'compound_enters_or_attacks')).toEqual([]);
    expect(gaps.filter((gap) => gap.seam === 'attack_watcher')).toEqual([]);
  });

  it('does not treat self-only attack triggers as watchers', () => {
    const gaps = evaluateLiveSeams({
      name: 'Self Attacker',
      type_line: 'Creature — Human',
      oracle_text: SELF_ATTACK,
    }, { exileEmission: true });
    expect(gaps.some((gap) => gap.seam === 'attack_watcher')).toBe(false);
  });

  it('detects another-creature ETB and creature-dies watchers', () => {
    expect(evaluateLiveSeams({
      name: 'Soul Warden',
      type_line: 'Creature — Human Cleric',
      oracle_text: SOUL_WARDEN,
    }, { exileEmission: true }).some((gap) => gap.seam === 'etb_watcher')).toBe(false);

    expect(evaluateLiveSeams({
      name: 'Grave Pact',
      type_line: 'Enchantment',
      oracle_text: GRAVE_PACT,
    }, { exileEmission: true }).some((gap) => gap.seam === 'death_watcher')).toBe(false);

    expect(evaluateLiveSeams({
      name: 'Blood Artist',
      type_line: 'Creature — Vampire',
      oracle_text: BLOOD_ARTIST,
    }, { exileEmission: true }).some((gap) => gap.seam === 'death_watcher')).toBe(false);
  });

  it('flags suspend exile-time-counter emission separately from detection', () => {
    const detected = evaluateLiveSeams({
      name: 'Dinosaurs on a Spaceship',
      type_line: 'Creature — Dinosaur',
      oracle_text: SPACESHIP,
    }, { exileEmission: true });
    expect(detected.some((gap) => gap.seam === 'exile_time_counter')).toBe(false);
    expect(detected.some((gap) => gap.seam === 'static_other_type_lord')).toBe(false);

    const missingEmit = evaluateLiveSeams({
      name: 'Dinosaurs on a Spaceship',
      type_line: 'Creature — Dinosaur',
      oracle_text: SPACESHIP,
    }, { exileEmission: false });
    expect(missingEmit.some((gap) => gap.seam === 'exile_time_counter_emission')).toBe(true);
  });

  it('keeps battlefield lords out of the graveyard and still finds Anger-style GY statics', () => {
    expect(evaluateLiveSeams({
      name: 'Always Watching',
      type_line: 'Enchantment',
      oracle_text: ALWAYS_WATCHING,
    }, { exileEmission: true }).some((gap) => gap.seam === 'static_gy_leak')).toBe(false);

    expect(evaluateLiveSeams({
      name: 'Anger',
      type_line: 'Creature — Incarnation',
      oracle_text: ANGER,
    }, { exileEmission: true }).some((gap) => gap.seam === 'gy_static_missing')).toBe(false);
  });

  it('reads suspend upkeep source for exile-time-counter emission', () => {
    expect(suspendTickEmitsExileTimeCounter('card.timeCounters--;')).toBe(false);
    expect(suspendTickEmitsExileTimeCounter('queueCounterRemovedTriggers(ctx, card, id, { time: 1 });')).toBe(true);
  });

  it('does not treat attacks-or-blocks-if-able statics as compound triggers', () => {
    expect(evaluateLiveSeams({
      name: 'Iron Golem',
      type_line: 'Artifact Creature — Golem',
      oracle_text: 'This creature attacks or blocks each combat if able.',
    }, { exileEmission: true }).some((gap) => gap.seam === 'compound_attacks_or_blocks')).toBe(false);
  });

  it('requires granted quoted ETB/attack/combat-damage/dealt-damage on a blank recipient', () => {
    expect(evaluateLiveSeams({
      name: 'Lavabelly Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'Sliver creatures you control have "When this creature enters, it deals 1 damage to target player or planeswalker and you gain 1 life."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Thorncaster Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'Sliver creatures you control have "Whenever this creature attacks, it deals 1 damage to any target."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Tempered Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'Sliver creatures you control have "Whenever this creature deals combat damage to a player, put a +1/+1 counter on it."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Spiteful Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'Sliver creatures you control have "Whenever this creature is dealt damage, it deals that much damage to target player or planeswalker."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Phenax, God of Deception',
      type_line: 'Legendary Enchantment Creature — God',
      oracle_text: 'Creatures you control have "{T}: Target player mills X cards, where X is this creature\'s toughness."',
    }, { exileEmission: true }).some((gap) => gap.seam === 'granted_quoted_trigger')).toBe(false);

    expect(evaluateLiveSeams({
      name: 'Harmonic Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'All Slivers have "When this permanent enters, destroy target artifact or enchantment."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Clash of Realities',
      type_line: 'Enchantment',
      oracle_text: 'All Spirits have "When this permanent enters, you may have it deal 3 damage to target non-Spirit creature."\nNon-Spirit creatures have "When this creature enters, you may have it deal 3 damage to target Spirit creature."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Noble Heritage',
      type_line: 'Legendary Enchantment — Background',
      oracle_text: 'Commander creatures you own have "When this creature enters and at the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. For each opponent who does, you gain protection from that player until your next turn."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Kira, Great Glass-Spinner',
      type_line: 'Legendary Creature — Spirit',
      oracle_text: 'Flying\nCreatures you control have "Whenever this creature becomes the target of a spell or ability for the first time each turn, counter that spell or ability."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Danny Pink',
      type_line: 'Legendary Creature — Human Soldier Advisor',
      oracle_text: 'Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)\nCreatures you control have "Whenever one or more counters are put on this creature for the first time each turn, draw a card."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Tale of Katara and Toph',
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control have "Whenever this creature becomes tapped for the first time during each of your turns, put a +1/+1 counter on it."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Dionus, Elvish Archdruid',
      type_line: 'Legendary Creature — Elf Druid',
      oracle_text: 'Elves you control have "Whenever this creature becomes tapped during your turn, untap it and put a +1/+1 counter on it. This ability triggers only once each turn."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Cursed Wombat',
      type_line: 'Creature — Nightmare Wombat',
      oracle_text: '{2}{B}{G}: Adapt 2. (If this creature has no +1/+1 counters on it, put two +1/+1 counters on it.)\nPermanents you control have "Whenever one or more +1/+1 counters are put on this permanent, put an additional +1/+1 counter on it. This ability triggers only once each turn."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Folk Hero',
      type_line: 'Legendary Enchantment — Background',
      oracle_text: 'Commander creatures you own have "Whenever you cast a spell that shares a creature type with this creature, draw a card. This ability triggers only once each turn."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Passionate Archaeologist',
      type_line: 'Legendary Enchantment — Background',
      oracle_text: 'Commander creatures you own have "Whenever you cast a spell from exile, this creature deals damage equal to that spell\'s mana value to target opponent."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Retaliation',
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control have "Whenever this creature becomes blocked by a creature, this creature gets +1/+1 until end of turn."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Candlekeep Sage',
      type_line: 'Legendary Enchantment — Background',
      oracle_text: 'Commander creatures you own have "When this creature enters or leaves the battlefield, draw a card."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Tavern Brawler',
      type_line: 'Legendary Enchantment — Background',
      oracle_text: 'Commander creatures you own have "At the beginning of your upkeep, exile the top card of your library. This creature gets +X/+0 until end of turn, where X is that card\'s mana value. You may play that card this turn."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Agent of the Iron Throne',
      type_line: 'Legendary Enchantment — Background',
      oracle_text: 'Commander creatures you own have "Whenever an artifact or creature you control is put into a graveyard from the battlefield, each opponent loses 1 life."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Vampiric Sliver',
      type_line: 'Creature — Sliver',
      oracle_text: 'All Sliver creatures have "Whenever a creature dealt damage by this creature this turn dies, put a +1/+1 counter on this creature."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'The Tabernacle at Pendrell Vale',
      type_line: 'Legendary Land',
      oracle_text: 'All creatures have "At the beginning of your upkeep, destroy this creature unless you pay {1}."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Energy Flux',
      type_line: 'Enchantment',
      oracle_text: 'All artifacts have "At the beginning of your upkeep, sacrifice this artifact unless you pay {2}."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Aura Flux',
      type_line: 'Enchantment',
      oracle_text: 'Other enchantments have "At the beginning of your upkeep, sacrifice this enchantment unless you pay {2}."',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);

    expect(evaluateLiveSeams({
      name: 'Musician',
      type_line: 'Creature — Human Wizard',
      oracle_text: 'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\n{T}: Put a music counter on target creature. If it doesn\'t have "At the beginning of your upkeep, destroy this creature unless you pay {1} for each music counter on it," it gains that ability.',
    }, { exileEmission: true }).filter((gap) => gap.seam === 'granted_quoted_trigger')).toEqual([]);
  });
});
