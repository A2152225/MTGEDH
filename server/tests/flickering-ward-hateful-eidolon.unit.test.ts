import { describe, expect, it } from 'vitest';

import { applyCreatureDamageFromSource } from '../src/state/modules/combat-damage-processing.js';
import { getPermanentProtections } from '../src/state/modules/combat-mechanics.js';
import { runSBA } from '../src/state/modules/counters_tokens.js';
import { getDeathTriggers } from '../src/state/modules/triggered-abilities.js';

const HATEFUL_EIDOLON_ORACLE =
  'Lifelink\nWhenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it.';

const FLICKERING_WARD_ORACLE =
  "Enchant creature\nAs Flickering Ward enters, choose a color.\nEnchanted creature has protection from the chosen color. This effect doesn't remove Flickering Ward.";

function eidolonPermanent() {
  return {
    id: 'eidolon_1',
    controller: 'p1',
    owner: 'p1',
    markedDamage: 0,
    attachments: ['ward_1'],
    card: {
      id: 'eidolon_card',
      name: 'Hateful Eidolon',
      type_line: 'Enchantment Creature — Spirit',
      oracle_text: HATEFUL_EIDOLON_ORACLE,
      power: '1',
      toughness: '2',
      colors: ['B'],
    },
  };
}

function wardPermanent() {
  return {
    id: 'ward_1',
    controller: 'p1',
    owner: 'p1',
    attachedTo: 'eidolon_1',
    chosenColor: 'green',
    card: {
      id: 'ward_card',
      name: 'Flickering Ward',
      type_line: 'Enchantment — Aura',
      oracle_text: FLICKERING_WARD_ORACLE,
      colors: ['W'],
    },
  };
}

function elfPermanent() {
  return {
    id: 'elf_1',
    controller: 'p2',
    owner: 'p2',
    markedDamage: 0,
    card: {
      id: 'elf_card',
      name: 'Llanowar Elves',
      type_line: 'Creature — Elf Druid',
      oracle_text: '{T}: Add {G}.',
      power: '3',
      toughness: '3',
      colors: ['G'],
    },
  };
}

function makeCtx(battlefield: any[]) {
  return {
    state: {
      battlefield,
      stack: [],
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      zones: {
        p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
        p2: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      },
      life: { p1: 40, p2: 40 },
      commandZone: {},
      emblems: [],
      conspiracies: [],
      manaPool: {},
    },
    bumpSeq: () => {},
  } as any;
}

describe('Flickering Ward protection and Hateful Eidolon death trigger', () => {
  it('reads protection from green granted by Flickering Ward onto the enchanted creature', () => {
    const eidolon = eidolonPermanent();
    const ward = wardPermanent();
    const state = { battlefield: [eidolon, ward] };
    expect(getPermanentProtections(eidolon, state)).toContain('green');
    expect(getPermanentProtections(ward, state)).not.toContain('green');
  });

  it('prevents combat damage from a green creature to the warded Hateful Eidolon', () => {
    const eidolon = eidolonPermanent();
    const ward = wardPermanent();
    const elf = elfPermanent();
    const ctx = makeCtx([eidolon, ward, elf]);

    const result = applyCreatureDamageFromSource(ctx, elf, eidolon, 3, 'markedDamage');
    expect(result.prevented).toBe(true);
    expect(result.appliedAmount).toBe(0);
    expect(Number(eidolon.markedDamage || 0)).toBe(0);
  });

  it('puts Flickering Ward into the graveyard when its host dies to lethal damage', () => {
    const eidolon = eidolonPermanent();
    eidolon.markedDamage = 3;
    const ward = wardPermanent();
    const ctx = makeCtx([eidolon, ward]);

    runSBA(ctx);

    expect(ctx.state.battlefield.map((perm: any) => perm.id)).not.toContain('eidolon_1');
    expect(ctx.state.battlefield.map((perm: any) => perm.id)).not.toContain('ward_1');
    expect(ctx.state.zones.p1.graveyard.some((card: any) => card?.name === 'Hateful Eidolon')).toBe(true);
    expect(ctx.state.zones.p1.graveyard.some((card: any) => card?.name === 'Flickering Ward')).toBe(true);
  });

  it('queues Hateful Eidolon draw for each Aura that was attached when it dies', () => {
    const eidolon = eidolonPermanent();
    const ward = wardPermanent();
    const ctx = makeCtx([ward]);

    const triggers = getDeathTriggers(ctx, eidolon, 'p1');
    const found = triggers.find((trigger) =>
      String(trigger.source.cardName || '').includes('Hateful Eidolon')
      && /draw a card for each aura/i.test(String(trigger.effect || '')),
    );
    expect(found).toBeDefined();
    expect(found?.referenceAmount).toBe(1);
  });
});
