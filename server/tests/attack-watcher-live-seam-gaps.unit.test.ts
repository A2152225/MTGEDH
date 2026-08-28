import { describe, expect, it } from 'vitest';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import {
  detectAttackTriggers,
  detectDeathTriggers,
  detectETBTriggers,
} from '../src/state/modules/triggered-abilities.js';
import {
  isAttackWatcherTriggerType,
  planAttackWatcherQueue,
} from '../src/state/modules/triggers/attack-watcher-queue.js';

const WINOTA_ORACLE =
  'Whenever a non-Human creature you control attacks, look at the top six cards of your library. You may put a Human creature card from among them onto the battlefield tapped and attacking. It gains indestructible until end of turn. Put the rest of the cards on the bottom of your library in a random order.';
const NORN_ORACLE =
  'Flying, first strike\nWhenever a commander you control enters or attacks, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)';
const DREADHORDE_ORACLE =
  "At the beginning of your upkeep, you lose 1 life and amass Zombies 1. (Put a +1/+1 counter on an Army you control. It's also a Zombie. If you don't control an Army, create a 0/0 black Zombie Army creature token first.)\nWhenever a Zombie token you control with power 6 or greater attacks, it gains lifelink until end of turn.";
const RHUK_ORACLE =
  'Trample, haste\nWhenever an equipped creature you control other than Rhuk attacks or dies, you may attach all Equipment attached to that creature to Rhuk.';

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

function plan(
  trigger: any,
  source: any,
  attackers: any[],
  battlefield: any[] = attackers,
) {
  return planAttackWatcherQueue(
    trigger,
    source,
    attackers,
    'p1',
    ['p2'],
    battlefield,
    (attacker) => String(attacker?.attacking || 'p2'),
  );
}

describe('attack-watcher live-seam gaps', () => {
  it('detects hyphenated non-Human typed creature attacks (Winota)', () => {
    const source = perm('winota_1', 'p1', {
      name: 'Winota, Joiner of Forces',
      type_line: 'Legendary Creature — Human Warrior',
      oracle_text: WINOTA_ORACLE,
    });
    const triggers = detectAttackTriggers(source.card, source);
    const found = triggers.find((trigger) => trigger.triggerType === 'typed_creature_attacks');
    expect(found).toBeDefined();
    expect(isAttackWatcherTriggerType(found?.triggerType)).toBe(true);
    expect(String((found as any)?.requiredTypePhrase || '')).toMatch(/non-?human/i);
  });

  it('queues typed_creature_attacks for non-Human attackers, not Humans', () => {
    const source = perm('winota_1', 'p1', {
      name: 'Winota, Joiner of Forces',
      type_line: 'Legendary Creature — Human Warrior',
      oracle_text: WINOTA_ORACLE,
    });
    const trigger = detectAttackTriggers(source.card, source).find(
      (entry) => entry.triggerType === 'typed_creature_attacks',
    );
    expect(trigger).toBeDefined();

    const angel = perm('angel_1', 'p1', {
      name: 'Serra Angel',
      type_line: 'Creature — Angel',
      oracle_text: 'Flying, vigilance',
      power: '4',
      toughness: '4',
    }, { attacking: 'p2' });
    const soldier = perm('soldier_1', 'p1', {
      name: 'Savannah Lions',
      type_line: 'Creature — Human Soldier',
      oracle_text: '',
      power: '2',
      toughness: '1',
    }, { attacking: 'p2' });

    const angelPlan = plan(trigger, source, [angel]);
    expect(angelPlan.kind).toBe('per_attacker');
    expect(angelPlan.kind === 'per_attacker' ? angelPlan.attackers.map((a) => a.id) : []).toEqual(['angel_1']);

    const humanPlan = plan(trigger, source, [soldier]);
    expect(humanPlan.kind === 'per_attacker' ? humanPlan.attackers : []).toEqual([]);

    const unhyphenated = {
      ...trigger,
      requiredTypePhrase: 'nonhuman',
    };
    const unhyphenatedPlan = plan(unhyphenated, source, [angel, soldier]);
    expect(unhyphenatedPlan.kind).toBe('per_attacker');
    expect(unhyphenatedPlan.kind === 'per_attacker' ? unhyphenatedPlan.attackers.map((a) => a.id) : []).toEqual(['angel_1']);
  });

  it('detects commander you control enters or attacks on both ETB and attack', () => {
    const source = perm('norn_1', 'p1', {
      name: "Norn's Choirmaster",
      type_line: 'Creature — Phyrexian Angel',
      oracle_text: NORN_ORACLE,
    });
    const attack = detectAttackTriggers(source.card, source);
    const etb = detectETBTriggers(source.card, source);
    expect(attack.some((trigger) => trigger.triggerType === 'commander_you_control_etb_or_attack')).toBe(true);
    expect(etb.some((trigger) => trigger.triggerType === 'commander_you_control_etb_or_attack')).toBe(true);
    expect(isAttackWatcherTriggerType('commander_you_control_etb_or_attack')).toBe(true);
  });

  it('queues commander_you_control_etb_or_attack for attacking commanders you control', () => {
    const source = perm('norn_1', 'p1', {
      name: "Norn's Choirmaster",
      type_line: 'Creature — Phyrexian Angel',
      oracle_text: NORN_ORACLE,
    });
    const trigger = detectAttackTriggers(source.card, source).find(
      (entry) => entry.triggerType === 'commander_you_control_etb_or_attack',
    );
    expect(trigger).toBeDefined();

    const commander = perm('cmd_1', 'p1', {
      name: 'Atraxa, Praetors\' Voice',
      type_line: 'Legendary Creature — Phyrexian Angel Horror',
      oracle_text: 'Flying, vigilance, deathtouch, lifelink',
      power: '4',
      toughness: '4',
      isCommander: true,
    }, { isCommander: true, attacking: 'p2' });
    const bear = perm('bear_1', 'p1', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { attacking: 'p2' });

    const queued = plan(trigger, source, [commander, bear]);
    expect(queued.kind).toBe('per_attacker');
    expect(queued.kind === 'per_attacker' ? queued.attackers.map((a) => a.id) : []).toEqual(['cmd_1']);
  });

  it('queues commander_you_control_etb_or_attack when a commander you control enters', () => {
    const norn = perm('norn_1', 'p1', {
      name: "Norn's Choirmaster",
      type_line: 'Creature — Phyrexian Angel',
      oracle_text: NORN_ORACLE,
    });
    const commander = perm('cmd_1', 'p1', {
      name: "Atraxa, Praetors' Voice",
      type_line: 'Legendary Creature — Phyrexian Angel Horror',
      oracle_text: 'Flying, vigilance, deathtouch, lifelink',
      isCommander: true,
    }, { isCommander: true });
    const bear = perm('bear_1', 'p1', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    const ctx = {
      gameId: 'unknown',
      isReplaying: false,
      state: {
        battlefield: [norn, commander],
        stack: [],
        zones: { p1: { hand: [], graveyard: [], exile: [], library: [] } },
      },
    } as any;
    triggerETBEffectsForPermanent(ctx, commander, 'p1');
    expect(ctx.state.stack.some((item: any) => item.triggerType === 'commander_you_control_etb_or_attack')).toBe(true);

    ctx.state.stack = [];
    ctx.state.battlefield = [norn, bear];
    triggerETBEffectsForPermanent(ctx, bear, 'p1');
    expect(ctx.state.stack.some((item: any) => item.triggerType === 'commander_you_control_etb_or_attack')).toBe(false);
  });

  it('detects typed token power-or-greater attack watchers (Dreadhorde)', () => {
    const source = perm('dread_1', 'p1', {
      name: 'Dreadhorde Invasion',
      type_line: 'Enchantment',
      oracle_text: DREADHORDE_ORACLE,
    });
    const triggers = detectAttackTriggers(source.card, source);
    const found = triggers.find((trigger) => trigger.triggerType === 'typed_token_power_or_greater_attacks');
    expect(found).toBeDefined();
    expect(isAttackWatcherTriggerType(found?.triggerType)).toBe(true);
    expect(String((found as any)?.requiredTypePhrase || '')).toMatch(/zombie/i);
    expect(Number((found as any)?.minPower)).toBe(6);
  });

  it('queues typed token power-or-greater only for matching tokens', () => {
    const source = perm('dread_1', 'p1', {
      name: 'Dreadhorde Invasion',
      type_line: 'Enchantment',
      oracle_text: DREADHORDE_ORACLE,
    });
    const trigger = detectAttackTriggers(source.card, source).find(
      (entry) => entry.triggerType === 'typed_token_power_or_greater_attacks',
    );
    expect(trigger).toBeDefined();

    const army = perm('army_1', 'p1', {
      name: 'Zombie Army',
      type_line: 'Token Creature — Zombie Army',
      oracle_text: '',
      power: '6',
      toughness: '6',
    }, { isToken: true, attacking: 'p2' });
    const smallArmy = perm('army_2', 'p1', {
      name: 'Zombie Army',
      type_line: 'Token Creature — Zombie Army',
      oracle_text: '',
      power: '5',
      toughness: '5',
    }, { isToken: true, attacking: 'p2' });
    const zombieCard = perm('ghoul_1', 'p1', {
      name: 'Walking Corpse',
      type_line: 'Creature — Zombie',
      oracle_text: '',
      power: '8',
      toughness: '8',
    }, { attacking: 'p2' });
    const soldierToken = perm('soldier_t', 'p1', {
      name: 'Soldier',
      type_line: 'Token Creature — Soldier',
      oracle_text: '',
      power: '6',
      toughness: '6',
    }, { isToken: true, attacking: 'p2' });

    const queued = plan(trigger, source, [army, smallArmy, zombieCard, soldierToken]);
    expect(queued.kind).toBe('per_attacker');
    expect(queued.kind === 'per_attacker' ? queued.attackers.map((a) => a.id) : []).toEqual(['army_1']);
  });

  it('detects equipped creature other than self attacks or dies on both attack and death', () => {
    const source = perm('rhuk_1', 'p1', {
      name: 'Rhuk, Hexgold Nabber',
      type_line: 'Legendary Creature — Goblin Berserker',
      oracle_text: RHUK_ORACLE,
    });
    const attack = detectAttackTriggers(source.card, source);
    const death = detectDeathTriggers(source.card, source);
    expect(attack.some((trigger) => trigger.triggerType === 'equipped_creature_other_than_self_attacks_or_dies')).toBe(true);
    expect(death.some((trigger) => trigger.triggerType === 'equipped_creature_other_than_self_attacks_or_dies')).toBe(true);
    expect(isAttackWatcherTriggerType('equipped_creature_other_than_self_attacks_or_dies')).toBe(true);
  });

  it('queues equipped other-than-self attacks only for equipped creatures you control besides the source', () => {
    const source = perm('rhuk_1', 'p1', {
      name: 'Rhuk, Hexgold Nabber',
      type_line: 'Legendary Creature — Goblin Berserker',
      oracle_text: RHUK_ORACLE,
    }, { isEquipped: true });
    const trigger = detectAttackTriggers(source.card, source).find(
      (entry) => entry.triggerType === 'equipped_creature_other_than_self_attacks_or_dies',
    );
    expect(trigger).toBeDefined();

    const equipped = perm('bear_1', 'p1', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    }, { isEquipped: true, attacking: 'p2' });
    const unequipped = perm('cat_1', 'p1', {
      name: 'Savannah Lions',
      type_line: 'Creature — Cat',
      oracle_text: '',
      power: '2',
      toughness: '1',
    }, { attacking: 'p2' });

    const queued = plan(trigger, source, [source, equipped, unequipped], [source, equipped, unequipped]);
    expect(queued.kind).toBe('per_attacker');
    expect(queued.kind === 'per_attacker' ? queued.attackers.map((a) => a.id) : []).toEqual(['bear_1']);
  });

  it('detects any-controller Warrior attacks (Najeela)', () => {
    const source = perm('najeela_1', 'p1', {
      name: 'Najeela, the Blade-Blossom',
      type_line: 'Legendary Creature — Human Warrior',
      oracle_text:
        "Whenever a Warrior attacks, you may have its controller create a 1/1 white Warrior creature token that's tapped and attacking.",
    });
    const triggers = detectAttackTriggers(source.card, source);
    const found = triggers.find((trigger) => trigger.triggerType === 'typed_subtype_attacks_any');
    expect(found).toBeDefined();
    expect(isAttackWatcherTriggerType(found?.triggerType)).toBe(true);
    expect(triggers.some((trigger) => trigger.triggerType === 'attacks')).toBe(false);

    const warrior = perm('war_1', 'p2', {
      name: 'Borderland Marauder',
      type_line: 'Creature — Human Warrior',
      oracle_text: '',
    }, { attacking: 'p1' });
    const queued = plan(found, source, [warrior], [source, warrior]);
    expect(queued.kind === 'per_attacker' ? queued.attackers.map((a) => a.id) : []).toEqual(['war_1']);
  });

  it('detects mana-ability creature attacks (Raggadragga)', () => {
    const source = perm('ragga_1', 'p1', {
      name: 'Raggadragga, Goreguts Boss',
      type_line: 'Legendary Creature — Human Boar',
      oracle_text:
        'Each creature you control with a mana ability gets +2/+2.\nWhenever a creature you control with a mana ability attacks, untap it.',
    });
    const triggers = detectAttackTriggers(source.card, source);
    const found = triggers.find((trigger) => trigger.triggerType === 'mana_ability_creature_attacks');
    expect(found).toBeDefined();
    expect(isAttackWatcherTriggerType(found?.triggerType)).toBe(true);

    const dork = perm('elf_1', 'p1', {
      name: 'Llanowar Elves',
      type_line: 'Creature — Elf Druid',
      oracle_text: '{T}: Add {G}.',
    }, { attacking: 'p2' });
    const bear = perm('bear_1', 'p1', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
    }, { attacking: 'p2' });
    const queued = plan(found, source, [dork, bear], [source, dork, bear]);
    expect(queued.kind === 'per_attacker' ? queued.attackers.map((a) => a.id) : []).toEqual(['elf_1']);
  });
});
