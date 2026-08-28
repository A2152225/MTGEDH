import { afterEach, describe, expect, it } from 'vitest';
import type { GameContext } from '../src/state/context';
import { resolvePlayerDamage } from '../src/state/modules/combat-damage-processing.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { detectDealtDamageTriggers } from '../src/state/modules/triggered-abilities.js';
import {
  getDamageReceivedTrigger,
  processDamageReceivedTriggers,
} from '../src/state/modules/triggers/damage-received.js';

function makeCtx(battlefield: any[], extraState: Record<string, unknown> = {}) {
  const state: any = {
    seq: 1,
    stack: [],
    battlefield,
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    life: { p1: 40, p2: 40 },
    ...extraState,
  };
  return {
    state,
    gameId: 'damage_received_watcher_emission',
    bumpSeq() {
      state.seq = Number(state.seq || 0) + 1;
    },
    isReplaying: false,
  } as unknown as GameContext;
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

describe('damage-received watcher emission', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  it('detects source-deals-damage-to-this-creature self templates', () => {
    const permanent = perm('archfiend_1', 'p1', {
      name: 'Sample Archfiend',
      type_line: 'Creature — Demon',
      oracle_text:
        "Whenever a source an opponent controls deals damage to this creature, that source's controller loses that much life unless they sacrifice that many permanents of their choice.",
    });
    expect(detectDealtDamageTriggers(permanent.card, permanent).some((trigger) => trigger.triggerType === 'dealt_damage')).toBe(true);
    const info = getDamageReceivedTrigger(permanent, { battlefield: [permanent] });
    expect(info).toBeNull();
    const ctx = makeCtx([permanent]);
    processDamageReceivedTriggers(ctx, permanent, 2, () => {});
    expect((ctx as any).state.stack.some((item: any) => (
      item.permanentId === permanent.id
      && item.triggerType === 'dealt_damage'
      && /loses that much life/i.test(String(item.effect || ''))
    ))).toBe(true);
  });

  it('queues Apex Altisaur Enrage as a fight trigger instead of a that-much-damage redirect', () => {
    const apex = perm('apex_1', 'p1', {
      name: 'Apex Altisaur',
      type_line: 'Creature — Dinosaur',
      power: '10',
      toughness: '10',
      oracle_text:
        "When this creature enters, it fights up to one target creature you don't control.\nEnrage — Whenever this creature is dealt damage, it fights up to one target creature you don't control.",
    });
    expect(getDamageReceivedTrigger(apex, { battlefield: [apex] })).toBeNull();
    const ctx = makeCtx([apex]);
    const redirects: any[] = [];
    processDamageReceivedTriggers(ctx, apex, 1, (trigger) => {
      redirects.push(trigger);
    });
    expect(redirects).toEqual([]);
    expect((ctx as any).state.stack.some((item: any) => (
      item.permanentId === apex.id
      && item.triggerType === 'dealt_damage'
      && /fights up to one target creature you don't control/i.test(String(item.effect || ''))
    ))).toBe(true);
  });

  it('applies Apex Altisaur fight damage to both creatures via Oracle IR', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const apex = perm('apex_1', 'p1', {
      name: 'Apex Altisaur',
      type_line: 'Creature — Dinosaur',
      power: '10',
      toughness: '10',
      oracle_text:
        "When this creature enters, it fights up to one target creature you don't control.\nEnrage — Whenever this creature is dealt damage, it fights up to one target creature you don't control.",
    }, { type_line: 'Creature — Dinosaur', power: 10, toughness: 10 });
    const bear = perm('bear_1', 'p2', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      power: '2',
      toughness: '2',
      oracle_text: '',
    }, { type_line: 'Creature — Bear', power: 2, toughness: 2 });
    const ctx = makeCtx([apex, bear]);
    processDamageReceivedTriggers(ctx, apex, 1, () => {});
    const trigger = (ctx as any).state.stack.find((item: any) => (
      item.permanentId === apex.id && /fights/i.test(String(item.effect || ''))
    ));
    expect(trigger).toBeTruthy();
    trigger.targets = [bear.id];
    executeTriggerEffect(ctx, 'p1', 'Apex Altisaur', String(trigger.effect), trigger);
    const resolvedApex = (ctx as any).state.battlefield.find((permanent: any) => permanent.id === apex.id);
    const resolvedBear = (ctx as any).state.battlefield.find((permanent: any) => permanent.id === bear.id);
    expect(Number(resolvedApex?.damageMarked || 0)).toBe(2);
    if (resolvedBear) {
      expect(Number(resolvedBear.damageMarked || 0)).toBe(10);
    }
  });

  it('queues a creature-you-control watcher when another creature you control is damaged', () => {
    const watcher = perm('rite_1', 'p1', {
      name: 'Sample Rite',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature you control is dealt damage, put a +1/+1 counter on it.',
    });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    const ctx = makeCtx([watcher, bear]);
    processDamageReceivedTriggers(ctx, bear, 3, () => {});
    expect((ctx as any).state.stack.some((item: any) => (
      item.permanentId === watcher.id
      && item.triggerType === 'dealt_damage'
      && /put a \+1\/\+1 counter on it/i.test(String(item.effect || ''))
    ))).toBe(true);
  });

  it('does not queue a creature-you-control watcher when an opponent creature is damaged', () => {
    const watcher = perm('rite_1', 'p1', {
      name: 'Sample Rite',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature you control is dealt damage, put a +1/+1 counter on it.',
    });
    const bear = perm('bear_1', 'p2', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    const ctx = makeCtx([watcher, bear]);
    processDamageReceivedTriggers(ctx, bear, 3, () => {});
    expect((ctx as any).state.stack.some((item: any) => item.permanentId === watcher.id)).toBe(false);
  });

  it('binds the damaged creature for watcher effects that refer to it', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const watcher = perm('rite_1', 'p1', {
      name: 'Sample Rite',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature you control is dealt damage, put a +1/+1 counter on it.',
    });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    const ctx = makeCtx([watcher, bear]);
    processDamageReceivedTriggers(ctx, bear, 3, () => {});

    const trigger = (ctx as any).state.stack.find((item: any) => item.permanentId === watcher.id);
    expect(trigger).toBeTruthy();
    executeTriggerEffect(ctx, 'p1', 'Sample Rite', String(trigger.effect), trigger);

    const resolvedBear = (ctx as any).state.battlefield.find((permanent: any) => permanent.id === bear.id);
    const resolvedWatcher = (ctx as any).state.battlefield.find((permanent: any) => permanent.id === watcher.id);
    expect(resolvedBear.counters['+1/+1']).toBe(1);
    expect(resolvedWatcher.counters['+1/+1'] || 0).toBe(0);
  });

  it('fires a typed Dragon watcher as a that-much redirect when another Dragon is damaged', () => {
    const watcher = perm('wrath_1', 'p1', {
      name: 'Sample Wrathful Dragon',
      type_line: 'Creature — Dragon',
      oracle_text: "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon.",
    });
    const dragon = perm('dragon_1', 'p1', {
      name: 'Sample Dragon',
      type_line: 'Creature — Dragon',
      oracle_text: 'Flying',
    });
    const ctx = makeCtx([watcher, dragon]);
    const hits: any[] = [];
    processDamageReceivedTriggers(ctx, dragon, 4, (trigger) => {
      hits.push(trigger);
    });
    expect(hits.some((trigger) => (
      trigger.sourceId === dragon.id
      && trigger.controller === 'p1'
      && trigger.targetType === 'any_non_dragon'
      && trigger.damageAmount === 4
    ))).toBe(true);
  });

  it('fires a typed Goblin watcher as a that-much redirect excluding Goblins, not only Dragons', () => {
    const watcher = perm('wrath_1', 'p1', {
      name: 'Sample Wrathful Goblin',
      type_line: 'Creature — Goblin',
      oracle_text: "Whenever a Goblin you control is dealt damage, it deals that much damage to any target that isn't a Goblin.",
    });
    const goblin = perm('goblin_1', 'p1', {
      name: 'Sample Goblin',
      type_line: 'Creature — Goblin',
      oracle_text: 'Haste',
    });
    const ctx = makeCtx([watcher, goblin]);
    const hits: any[] = [];
    processDamageReceivedTriggers(ctx, goblin, 4, (trigger) => {
      hits.push(trigger);
    });
    expect(hits.some((trigger) => (
      trigger.sourceId === goblin.id
      && trigger.controller === 'p1'
      && trigger.targetType === 'any_non_goblin'
      && trigger.damageAmount === 4
    ))).toBe(true);
  });

  it('queues an enchanted-creature sacrifice watcher from an attached aura', () => {
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
    }, { attachments: ['aura_1'] });
    const aura = perm('aura_1', 'p1', {
      name: 'Sample Sleep Magic',
      type_line: 'Enchantment — Aura',
      oracle_text: 'Enchant creature\nWhen enchanted creature is dealt damage, sacrifice this Aura.',
    }, { attachedTo: 'bear_1' });
    const ctx = makeCtx([bear, aura]);
    processDamageReceivedTriggers(ctx, bear, 2, () => {});
    expect((ctx as any).state.stack.some((item: any) => (
      item.permanentId === aura.id
      && /sacrifice this aura/i.test(String(item.effect || ''))
    ))).toBe(true);
  });

  it('queues an opponent-is-dealt-damage watcher from resolvePlayerDamage', () => {
    const watcher = perm('war_1', 'p1', {
      name: 'Sample War Elemental',
      type_line: 'Creature — Elemental',
      oracle_text: 'Whenever an opponent is dealt damage, put that many +1/+1 counters on this creature.',
    });
    const source = perm('bolt_src', 'p1', {
      name: 'Sample Bolt',
      type_line: 'Creature — Wizard',
      oracle_text: '',
    });
    const ctx = makeCtx([watcher, source]);
    resolvePlayerDamage(ctx, {
      targetPlayerId: 'p2',
      amount: 3,
      sourcePermanent: source,
    });
    expect((ctx as any).state.stack.some((item: any) => (
      item.permanentId === watcher.id
      && item.triggerType === 'dealt_damage'
      && /put that many \+1\/\+1 counters/i.test(String(item.effect || ''))
    ))).toBe(true);
  });

  it('uses damage amount as the Oracle IR reference for player-damage watchers', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const watcher = perm('war_1', 'p1', {
      name: 'Sample War Elemental',
      type_line: 'Creature — Elemental',
      oracle_text: 'Whenever an opponent is dealt damage, put that many +1/+1 counters on this creature.',
    });
    const source = perm('bolt_src', 'p1', {
      name: 'Sample Bolt',
      type_line: 'Creature — Wizard',
      oracle_text: '',
    });
    const ctx = makeCtx([watcher, source]);
    resolvePlayerDamage(ctx, {
      targetPlayerId: 'p2',
      amount: 3,
      sourcePermanent: source,
    });

    const trigger = (ctx as any).state.stack.find((item: any) => item.permanentId === watcher.id);
    expect(trigger).toBeTruthy();
    executeTriggerEffect(ctx, 'p1', 'Sample War Elemental', String(trigger.effect), trigger);

    const resolvedWatcher = (ctx as any).state.battlefield.find((permanent: any) => permanent.id === watcher.id);
    expect(resolvedWatcher.counters['+1/+1']).toBe(3);
  });

  it('does not queue an opponent-is-dealt-damage watcher when you are damaged', () => {
    const watcher = perm('war_1', 'p1', {
      name: 'Sample War Elemental',
      type_line: 'Creature — Elemental',
      oracle_text: 'Whenever an opponent is dealt damage, put that many +1/+1 counters on this creature.',
    });
    const source = perm('bolt_src', 'p2', {
      name: 'Sample Bolt',
      type_line: 'Creature — Wizard',
      oracle_text: '',
    });
    const ctx = makeCtx([watcher, source]);
    resolvePlayerDamage(ctx, {
      targetPlayerId: 'p1',
      amount: 3,
      sourcePermanent: source,
    });
    expect((ctx as any).state.stack.some((item: any) => item.permanentId === watcher.id)).toBe(false);
  });
});
