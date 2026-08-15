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
    expect(info).toBeTruthy();
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
