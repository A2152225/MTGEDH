import { describe, expect, it } from 'vitest';
import {
  detectAttackTriggers,
  getAttackTriggersForCreatures,
} from '../src/state/modules/triggers/combat.js';

function makeCtx(battlefield: any[], extraState: Record<string, unknown> = {}) {
  const state = {
    seq: 1,
    stack: [],
    battlefield,
    players: [{ id: 'p1' }, { id: 'p2' }],
    commandZone: {},
    ...extraState,
  };
  return {
    state,
    gameId: 'attack_emitter_parity',
    bumpSeq() {
      state.seq = Number(state.seq || 0) + 1;
    },
    isReplaying: false,
  } as any;
}

function perm(id: string, controller: string, card: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: { id: `${id}_card`, ...card },
    ...extra,
  };
}

function collect(
  battlefield: any[],
  attackers: any[],
  attackingPlayer = 'p1',
  defendingPlayer = 'p2',
) {
  return getAttackTriggersForCreatures(
    makeCtx(battlefield),
    attackers,
    attackingPlayer,
    defendingPlayer,
  );
}

describe('attack emitter — detector watchers fire for generic attack templates', () => {
  it('detects a typed subtype attack watcher', () => {
    const triggers = detectAttackTriggers({
      name: 'Sample Hellkite',
      type_line: 'Creature — Dragon',
      oracle_text: 'Whenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.',
    }, { id: 'hellkite_1', controller: 'p1' });
    const found = triggers.find((trigger) => trigger.triggerType === 'typed_subtype_attacks');
    expect(found).toBeDefined();
    expect(String(found?.requiredTypePhrase || '')).toMatch(/dragon/i);
  });

  it('queues a typed Dragon watcher when a Dragon you control attacks', () => {
    const watcher = perm('hellkite_1', 'p1', {
      name: 'Sample Hellkite',
      type_line: 'Creature — Dragon',
      oracle_text: 'Whenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.',
    });
    const dragon = perm('dragon_1', 'p1', {
      name: 'Sample Dragon',
      type_line: 'Creature — Dragon',
      oracle_text: 'Flying',
      power: '4',
      toughness: '4',
    }, { attacking: 'p2' });
    const triggers = collect([watcher, dragon], [dragon]);
    expect(triggers.some((trigger) => (
      trigger.permanentId === watcher.id
      && trigger.triggerType === 'typed_subtype_attacks'
      && /dragon creature token/i.test(String(trigger.effect || trigger.description || ''))
    ))).toBe(true);
  });

  it('does not queue a typed Dragon watcher when a Bear attacks', () => {
    const watcher = perm('hellkite_1', 'p1', {
      name: 'Sample Hellkite',
      type_line: 'Creature — Dragon',
      oracle_text: 'Whenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.',
    });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });
    const triggers = collect([watcher, bear], [bear]);
    expect(triggers.some((trigger) => trigger.permanentId === watcher.id)).toBe(false);
  });

  it('queues another-creature watchers for other attackers, not the source', () => {
    const watcher = perm('chieftain_1', 'p1', {
      name: 'Sample Chieftain',
      type_line: 'Creature — Minotaur',
      oracle_text: 'Whenever another creature you control attacks, it gains trample and indestructible until end of turn.',
      power: '8',
      toughness: '8',
    }, { attacking: 'p2' });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });
    const triggers = collect([watcher, bear], [watcher, bear]);
    const queued = triggers.filter((trigger) => (
      trigger.permanentId === watcher.id && trigger.triggerType === 'another_creature_attacks'
    ));
    expect(queued).toHaveLength(1);
    expect((queued[0] as any).value?.attackingCreatureId).toBe(bear.id);
  });

  it('queues any-creature attack watchers when an opponent attacks', () => {
    const watcher = perm('cause_1', 'p1', {
      name: 'Sample Cause',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature attacks, you gain 1 life.',
    });
    const bear = perm('bear_1', 'p2', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p1' });
    const triggers = collect([watcher, bear], [bear], 'p2', 'p1');
    expect(triggers.some((trigger) => (
      trigger.permanentId === watcher.id
      && trigger.triggerType === 'any_creature_attacks'
    ))).toBe(true);
  });

  it('queues opponent-creature watchers only when an opponent attacks', () => {
    const watcher = perm('sentry_1', 'p1', {
      name: 'Sample Sentry',
      type_line: 'Creature — Human Soldier',
      oracle_text: 'Whenever a creature an opponent controls attacks, tap that creature.',
    });
    const enemy = perm('bear_1', 'p2', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p1' });
    const friend = perm('bear_2', 'p1', {
      name: 'Sample Ally',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });

    const whenOpponentAttacks = collect([watcher, enemy], [enemy], 'p2', 'p1');
    expect(whenOpponentAttacks.some((trigger) => trigger.triggerType === 'opponent_creature_attacks')).toBe(true);

    const whenYouAttack = collect([watcher, friend], [friend], 'p1', 'p2');
    expect(whenYouAttack.some((trigger) => trigger.triggerType === 'opponent_creature_attacks')).toBe(false);
  });

  it('queues creature-attacks-alone only when exactly one creature attacks', () => {
    const watcher = perm('banner_1', 'p1', {
      name: 'Sample Banner',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature you control attacks alone, it gets +1/+1 until end of turn.',
    });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });
    const extra = perm('bear_2', 'p1', {
      name: 'Sample Ally',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });

    expect(collect([watcher, bear], [bear]).some((trigger) => trigger.triggerType === 'creature_attacks_alone')).toBe(true);
    expect(collect([watcher, bear, extra], [bear, extra]).some((trigger) => trigger.triggerType === 'creature_attacks_alone')).toBe(false);
  });

  it('queues +1/+1-counter attack watchers only for creatures with those counters', () => {
    const watcher = perm('inkcaster_1', 'p1', {
      name: 'Sample Inkcaster',
      type_line: 'Creature — Horror',
      oracle_text: 'Whenever a creature you control with a +1/+1 counter on it attacks, each opponent loses 1 life and you gain 1 life.',
    });
    const pumped = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2', counters: { '+1/+1': 1 } });
    const plain = perm('bear_2', 'p1', {
      name: 'Sample Ally',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });

    const withCounter = collect([watcher, pumped], [pumped]);
    expect(withCounter.some((trigger) => trigger.triggerType === 'counter_creature_attacks')).toBe(true);

    const withoutCounter = collect([watcher, plain], [plain]);
    expect(withoutCounter.some((trigger) => trigger.triggerType === 'counter_creature_attacks')).toBe(false);
  });

  it('queues modified-creature attack watchers for equipped attackers', () => {
    const watcher = perm('captain_1', 'p1', {
      name: 'Sample Captain',
      type_line: 'Creature — Human Knight',
      oracle_text: 'Whenever a modified creature you control attacks, double the number of each kind of counter on it.',
    });
    const attacker = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });
    const sword = perm('sword_1', 'p1', {
      name: 'Sample Sword',
      type_line: 'Artifact — Equipment',
      oracle_text: 'Equipped creature gets +2/+2.',
    }, { attachedTo: 'bear_1' });

    const triggers = collect([watcher, attacker, sword], [attacker]);
    expect(triggers.some((trigger) => trigger.triggerType === 'modified_creature_attacks')).toBe(true);
  });

  it('queues low-power attack watchers only when power is at or below the printed threshold', () => {
    const watcher = perm('marshal_1', 'p1', {
      name: 'Sample Marshal',
      type_line: 'Creature — Human Soldier',
      oracle_text: 'Whenever a creature you control with power 2 or less attacks, you gain 1 life.',
    });
    const small = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2', basePower: 2, baseToughness: 2 });
    const large = perm('ogre_1', 'p1', {
      name: 'Sample Ogre',
      type_line: 'Creature — Ogre',
      oracle_text: '',
      power: '5',
      toughness: '5',
    }, { attacking: 'p2', basePower: 5, baseToughness: 5 });

    expect(collect([watcher, small], [small]).some((trigger) => trigger.triggerType === 'low_power_creature_attacks')).toBe(true);
    expect(collect([watcher, large], [large]).some((trigger) => trigger.triggerType === 'low_power_creature_attacks')).toBe(false);
  });

  it('queues curse attack watchers when the enchanted player is attacked', () => {
    const curse = perm('curse_1', 'p1', {
      name: 'Sample Curse',
      type_line: 'Enchantment — Aura Curse',
      oracle_text: 'Enchant player\nWhenever a player attacks enchanted player with one or more creatures, that attacking player may tap or untap target permanent.',
    }, { attachedTo: 'p2' });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });
    const triggers = collect([curse, bear], [bear]);
    expect(triggers.some((trigger) => trigger.triggerType === 'curse_attack')).toBe(true);
  });

  it('queues two-or-more opponent-creature attack watchers once', () => {
    const watcher = perm('warden_1', 'p1', {
      name: 'Sample Warden',
      type_line: 'Creature — Human Soldier',
      oracle_text: 'Whenever two or more creatures your opponents control attack, draw a card.',
    });
    const a = perm('bear_1', 'p2', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p1' });
    const b = perm('bear_2', 'p2', {
      name: 'Sample Ally',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p1' });

    const two = collect([watcher, a, b], [a, b], 'p2', 'p1').filter((trigger) => (
      trigger.triggerType === 'opponents_two_or_more_creatures_attack'
    ));
    expect(two).toHaveLength(1);

    const one = collect([watcher, a], [a], 'p2', 'p1');
    expect(one.some((trigger) => trigger.triggerType === 'opponents_two_or_more_creatures_attack')).toBe(false);
  });

  it('detects self attacks-or-blocks without collapsing it to a generic attacks trigger', () => {
    const triggers = detectAttackTriggers({
      name: 'Sample Giant',
      type_line: 'Creature — Giant',
      oracle_text: 'Whenever this creature attacks or blocks, mill a card.',
    }, { id: 'giant_1', controller: 'p1' });
    expect(triggers.some((trigger) => trigger.triggerType === 'attacks_or_blocks')).toBe(true);
    expect(triggers.some((trigger) => trigger.triggerType === 'attacks')).toBe(false);
  });

  it('queues chosen-type enters-or-attacks watchers for the chosen creature type', () => {
    const watcher = perm('kindred_1', 'p1', {
      name: 'Sample Discovery',
      type_line: 'Enchantment',
      oracle_text: 'As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.',
    }, { chosenCreatureType: 'Merfolk' });
    const merfolk = perm('merfolk_1', 'p1', {
      name: 'Sample Looter',
      type_line: 'Creature — Merfolk',
      oracle_text: '',
      power: '1',
      toughness: '1',
    }, { attacking: 'p2' });
    const human = perm('human_1', 'p1', {
      name: 'Sample Soldier',
      type_line: 'Creature — Human Soldier',
      oracle_text: '',
      power: '1',
      toughness: '1',
    }, { attacking: 'p2' });

    const triggers = collect([watcher, merfolk, human], [merfolk, human]);
    const queued = triggers.filter((trigger) => trigger.triggerType === 'chosen_type_creature_etb_or_attack');
    expect(queued).toHaveLength(1);
    expect((queued[0] as any).value?.attackingCreatureId).toBe(merfolk.id);
  });

  it('grants quoted commander attack abilities without a card-name check', () => {
    const commander = perm('commander_1', 'p1', {
      name: 'Sample Commander',
      type_line: 'Legendary Creature — Elf Shaman',
      oracle_text: 'Choose a Background',
      power: '2',
      toughness: '5',
    }, { isCommander: true, attacking: 'p2' });
    const background = perm('background_1', 'p1', {
      name: 'Sample Background',
      type_line: 'Legendary Enchantment — Background',
      oracle_text: 'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature."',
    });
    const triggers = collect([commander, background], [commander]);
    expect(triggers.some((trigger) => (
      trigger.permanentId === commander.id
      && trigger.triggerType === 'attacks'
      && /put a \+1\/\+1 counter/i.test(String(trigger.description || ''))
    ))).toBe(true);
  });

  it('still queues "whenever a creature you control attacks" once per attacker', () => {
    const watcher = perm('general_1', 'p1', {
      name: 'Sample General',
      type_line: 'Creature — Human Soldier',
      oracle_text: 'Whenever a creature you control attacks, you gain 1 life.',
    });
    const a = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });
    const b = perm('bear_2', 'p1', {
      name: 'Sample Ally',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });
    const queued = collect([watcher, a, b], [a, b]).filter((trigger) => trigger.triggerType === 'creature_attacks');
    expect(queued).toHaveLength(2);
  });
});
