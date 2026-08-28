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
      oracle_text: 'Vigilance\nThis creature attacks or blocks each combat if able.',
    }, { exileEmission: true }).some((gap) => gap.seam === 'compound_attacks_or_blocks')).toBe(false);
  });
});
