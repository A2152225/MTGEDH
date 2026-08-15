import { describe, expect, it } from 'vitest';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { detectDeathTriggers, getDeathTriggers } from '../src/state/modules/triggered-abilities.js';

function makeCtx(battlefield: any[], extraState: Record<string, unknown> = {}) {
  const state = {
    seq: 1,
    stack: [],
    battlefield,
    players: [{ id: 'p1' }, { id: 'p2' }],
    zones: {
      p1: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      p2: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    },
    ...extraState,
  };
  return {
    state,
    gameId: 'death_emitter_parity',
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

describe('death emitter — detector watchers fire for noncreature leaves', () => {
  it('detects enchantment-to-graveyard watchers', () => {
    const triggers = detectDeathTriggers({
      name: 'Sample Enchantress',
      type_line: 'Creature — Human Druid',
      oracle_text: 'Whenever an enchantment is put into a graveyard from the battlefield, draw a card.',
    }, { id: 'enchantress_1', controller: 'p1' });
    expect(triggers.some((trigger) => trigger.triggerType === 'put_into_graveyard_from_battlefield' || trigger.triggerType === 'any_enchantment_graveyard')).toBe(true);
  });

  it('queues an enchantment-GY watcher when an enchantment dies', () => {
    const watcher = perm('enchantress_1', 'p1', {
      name: 'Sample Enchantress',
      type_line: 'Creature — Human Druid',
      oracle_text: 'Whenever an enchantment is put into a graveyard from the battlefield, draw a card.',
    });
    const aura = perm('aura_1', 'p1', {
      name: 'Sample Aura',
      type_line: 'Enchantment — Aura',
      oracle_text: 'Enchant creature',
    });
    const triggers = getDeathTriggers(makeCtx([watcher]), aura, 'p1');
    expect(triggers.some((trigger) => (
      trigger.source.permanentId === watcher.id
      && /draw a card/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });

  it('does not queue an enchantment-GY watcher when a creature dies', () => {
    const watcher = perm('enchantress_1', 'p1', {
      name: 'Sample Enchantress',
      type_line: 'Creature — Human Druid',
      oracle_text: 'Whenever an enchantment is put into a graveyard from the battlefield, draw a card.',
    });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    const triggers = getDeathTriggers(makeCtx([watcher]), bear, 'p1');
    expect(triggers.some((trigger) => trigger.source.permanentId === watcher.id)).toBe(false);
  });

  it('queues a land-GY watcher when a land dies', () => {
    const watcher = perm('egg_1', 'p1', {
      name: 'Sample Egg',
      type_line: 'Artifact',
      oracle_text: "Whenever a land is put into a graveyard from the battlefield, this artifact deals 2 damage to that land's controller.",
    });
    const forest = perm('forest_1', 'p1', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '({T}: Add {G}.)',
    });
    const triggers = getDeathTriggers(makeCtx([watcher]), forest, 'p1');
    expect(triggers.some((trigger) => (
      trigger.source.permanentId === watcher.id
      && /deals 2 damage/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });

  it('queues another-artifact-or-creature GY watcher when an artifact you control dies', () => {
    const watcher = perm('vat_1', 'p1', {
      name: 'Sample Vat',
      type_line: 'Artifact',
      oracle_text: 'Whenever another artifact or creature you control is put into a graveyard from the battlefield, put an oil counter on this artifact.',
    });
    const solRing = perm('sol_1', 'p1', {
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
    });
    const triggers = getDeathTriggers(makeCtx([watcher]), solRing, 'p1');
    expect(triggers.some((trigger) => (
      trigger.source.permanentId === watcher.id
      && /oil counter/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });

  it('does not queue an another-artifact watcher when the source itself dies', () => {
    const watcher = perm('vat_1', 'p1', {
      name: 'Sample Vat',
      type_line: 'Artifact',
      oracle_text: 'Whenever another artifact or creature you control is put into a graveyard from the battlefield, put an oil counter on this artifact.',
    });
    const triggers = getDeathTriggers(makeCtx([]), watcher, 'p1');
    expect(triggers.some((trigger) => /oil counter/i.test(String(trigger.effect || '')))).toBe(false);
  });

  it('still queues a creature-dies watcher when a creature you control dies', () => {
    const watcher = perm('pact_1', 'p1', {
      name: 'Sample Pact',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature you control dies, each other player sacrifices a creature.',
    });
    const bear = perm('bear_1', 'p1', {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    const triggers = getDeathTriggers(makeCtx([watcher]), bear, 'p1');
    expect(triggers.some((trigger) => (
      trigger.source.permanentId === watcher.id
      && /sacrifices a creature/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });

  it('queues enchanted-creature death returns from the attached aura', () => {
    const traveler = perm('enchanted_1', 'p1', {
      name: 'Sample Soldier',
      type_line: 'Creature — Human Soldier',
      oracle_text: '',
    });
    const vigor = perm('vigor_1', 'p1', {
      name: 'Sample Vigor',
      type_line: 'Enchantment — Aura',
      oracle_text: "Enchant creature\nWhen enchanted creature dies, return that card to its owner's hand.",
    }, { attachedTo: 'enchanted_1' });
    const ctx = makeCtx([traveler, vigor]);
    const collected = getDeathTriggers(ctx, traveler, 'p1');
    expect(collected.filter((trigger) => trigger.source.permanentId === vigor.id)).toHaveLength(1);
    expect(String(collected.find((trigger) => trigger.source.permanentId === vigor.id)?.effect || '')).toMatch(
      /return that card to its owner's hand/i,
    );
  });

  it('stacks the enchantment-GY watcher from movePermanentToGraveyard', () => {
    const watcher = perm('enchantress_1', 'p1', {
      name: 'Sample Enchantress',
      type_line: 'Creature — Human Druid',
      oracle_text: 'Whenever an enchantment is put into a graveyard from the battlefield, draw a card.',
    });
    const aura = perm('aura_1', 'p1', {
      name: 'Sample Aura',
      type_line: 'Enchantment — Aura',
      oracle_text: 'Enchant creature',
    });
    const ctx = makeCtx([watcher, aura]);
    movePermanentToGraveyard(ctx, aura.id, true);
    expect((ctx.state.stack || []).some((entry: any) => (
      entry?.type === 'triggered_ability'
      && entry?.source === watcher.id
      && /draw a card/i.test(String(entry?.effect || ''))
    ))).toBe(true);
  });
});
