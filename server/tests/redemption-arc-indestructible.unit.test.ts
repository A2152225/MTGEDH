import { describe, expect, it } from 'vitest';

import { parseAttachmentGrantedKeywordsFromOracle } from '../../shared/src/attachmentKeywordGrants.js';
import { applyStateBasedActions, permanentHasIndestructible } from '../src/rules-engine/index.js';
import {
  applyCreatureDamageFromSource,
  creatureDiesFromCombatDamage,
} from '../src/state/modules/combat-damage-processing.js';
import { runSBA } from '../src/state/modules/counters_tokens.js';

// Scryfall oracle: Redemption Arc (MKC / SOC).
const REDEMPTION_ARC_ORACLE =
  'Enchant creature\nEnchanted creature has indestructible and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\n{1}{W}: Exile enchanted creature.';

const DARKSTEEL_PLATE_ORACLE =
  'Equipped creature has indestructible.\nEquip {2}';

function hostPermanent() {
  return {
    id: 'host_1',
    controller: 'p1',
    owner: 'p1',
    markedDamage: 0,
    card: {
      id: 'host_card',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };
}

function redemptionArcPermanent() {
  return {
    id: 'arc_1',
    controller: 'p1',
    owner: 'p1',
    attachedTo: 'host_1',
    card: {
      id: 'arc_card',
      name: 'Redemption Arc',
      type_line: 'Enchantment — Aura',
      oracle_text: REDEMPTION_ARC_ORACLE,
      colors: ['W'],
    },
  };
}

function darksteelPlatePermanent() {
  return {
    id: 'plate_1',
    controller: 'p1',
    owner: 'p1',
    attachedTo: 'host_1',
    card: {
      id: 'plate_card',
      name: 'Darksteel Plate',
      type_line: 'Artifact — Equipment',
      oracle_text: DARKSTEEL_PLATE_ORACLE,
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

describe('Redemption Arc aura-granted indestructible', () => {
  it('parses indestructible from Enchanted creature has indestructible and is goaded', () => {
    expect(parseAttachmentGrantedKeywordsFromOracle(REDEMPTION_ARC_ORACLE)).toContain('indestructible');
  });

  it('grants indestructible to the enchanted creature, not the Aura itself', () => {
    const host = hostPermanent();
    const arc = redemptionArcPermanent();
    const state = { battlefield: [host, arc] } as any;

    expect(permanentHasIndestructible(state, host)).toBe(true);
    expect(permanentHasIndestructible(state, arc)).toBe(false);
  });

  it('applies combat damage but does not destroy the enchanted creature', () => {
    const host = hostPermanent();
    const arc = redemptionArcPermanent();
    const elf = elfPermanent();
    const ctx = makeCtx([host, arc, elf]);

    const result = applyCreatureDamageFromSource(ctx, elf, host, 3, 'markedDamage');
    expect(result.prevented).toBe(false);
    expect(result.appliedAmount).toBe(3);
    expect(Number(host.markedDamage || 0)).toBe(3);
    expect(Number(host.damageMarked || 0)).toBe(3);

    expect(creatureDiesFromCombatDamage(ctx, host, host.markedDamage, false, false, 2)).toBe(false);

    runSBA(ctx);

    expect(ctx.state.battlefield.map((perm: any) => perm.id)).toContain('host_1');
    expect(ctx.state.battlefield.map((perm: any) => perm.id)).toContain('arc_1');
    expect(Number(host.markedDamage || 0)).toBe(3);
  });

  it('still destroys the creature from lethal damage without the Aura', () => {
    const host = hostPermanent();
    host.markedDamage = 3;
    const ctx = makeCtx([host]);

    runSBA(ctx);

    expect(ctx.state.battlefield.map((perm: any) => perm.id)).not.toContain('host_1');
    expect(ctx.state.zones.p1.graveyard.some((card: any) => card?.name === 'Grizzly Bears')).toBe(true);
  });

  it('does not list the enchanted creature in SBA destroys for lethal damage', () => {
    const host = hostPermanent();
    host.markedDamage = 3;
    const arc = redemptionArcPermanent();
    const result = applyStateBasedActions({
      battlefield: [host, arc],
      players: [{ id: 'p1', life: 40 }],
      zones: { p1: { hand: [], graveyard: [], exile: [], library: [] } },
      life: { p1: 40 },
    } as any);

    expect(result.destroys).not.toContain('host_1');
    expect(result.destroys).not.toContain('arc_1');
  });

  it('still honors Equipment that grants indestructible', () => {
    const host = hostPermanent();
    host.markedDamage = 3;
    const plate = darksteelPlatePermanent();
    const result = applyStateBasedActions({
      battlefield: [host, plate],
      players: [{ id: 'p1', life: 40 }],
      zones: { p1: { hand: [], graveyard: [], exile: [], library: [] } },
      life: { p1: 40 },
    } as any);

    expect(permanentHasIndestructible({ battlefield: [host, plate] } as any, host)).toBe(true);
    expect(result.destroys).not.toContain('host_1');
  });

  it('still puts a 0-toughness enchanted creature into the graveyard', () => {
    const host = hostPermanent();
    host.counters = { '-1/-1': 2 };
    const arc = redemptionArcPermanent();
    const ctx = makeCtx([host, arc]);

    runSBA(ctx);

    expect(ctx.state.battlefield.map((perm: any) => perm.id)).not.toContain('host_1');
    expect(ctx.state.battlefield.map((perm: any) => perm.id)).not.toContain('arc_1');
  });
});
