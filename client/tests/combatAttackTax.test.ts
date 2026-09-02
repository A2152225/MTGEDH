import { describe, expect, it } from 'vitest';
import type { BattlefieldPermanent } from '../../shared/src';
import {
  collectAttackYouTaxPreviewForDefender,
  formatAttackYouTaxForCount,
  formatAttackYouTaxPerCreature,
  formatSelectedAttackersTax,
} from '../src/utils/combatAttackTax';
import { collectAttackerSelfAttackTax } from '../../shared/src/combatAttackerSelfTax';

const NORNS_ANNEX =
  "({W/P} can be paid with either {W} or 2 life.)\nCreatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.";
const GHOSTLY_PRISON =
  "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.";
const BAIRD =
  "Vigilance\nCreatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.";
const SPHERE =
  "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.";
const COLLECTIVE =
  "Domain — Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.";
const WAR_TAX =
  "{X}{U}: This turn, creatures can't attack unless their controller pays {X} for each attacking creature they control.";
const WHIPGRASS =
  '{1}{W}: Until end of turn, target creature gains "This creature can\'t attack or block unless its controller pays {1} for each Cleric on the battlefield."';
const NILS =
  "At the beginning of your end step, for each player, put a +1/+1 counter on up to one target creature that player controls.\nEach creature with one or more counters on it can't attack you or planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature.";
const ARCHANGEL =
  "Flying\nAs long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.\nAs long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.";

function perm(opts: {
  id: string;
  controller: string;
  name: string;
  oracle: string;
  type?: string;
  tapped?: boolean;
  counters?: Record<string, number>;
  temporaryEffects?: Array<{ description: string }>;
}): BattlefieldPermanent {
  return {
    id: opts.id,
    controller: opts.controller,
    tapped: Boolean(opts.tapped),
    counters: opts.counters,
    temporaryEffects: opts.temporaryEffects,
    card: {
      name: opts.name,
      oracle_text: opts.oracle,
      type_line: opts.type || 'Enchantment',
    },
  } as BattlefieldPermanent;
}

describe('combatAttackTax', () => {
  it("detects Norn's Annex {W/P} and formats current-selection cost", () => {
    const battlefield = [
      perm({
        id: 'annex',
        controller: 'def',
        name: "Norn's Annex",
        oracle: NORNS_ANNEX,
        type: 'Artifact',
      }),
    ];
    const tax = collectAttackYouTaxPreviewForDefender(battlefield, 'def');
    expect(tax).toEqual({ generic: 0, phyrexian: [{ symbol: 'W', life: 2 }], countersOnAttacker: false });
    expect(formatAttackYouTaxPerCreature(tax)).toBe('{W/P}/attacker');
    expect(formatAttackYouTaxForCount(tax, 3)).toBe('3×{W/P}');
    expect(formatSelectedAttackersTax(
      [['a', 'def'], ['b', 'def'], ['c', 'def']],
      { def: { attackTaxPerCreature: 0, attackTaxPhyrexianPerCreature: tax.phyrexian } },
    )).toBe('3×{W/P} ({W} or 2 life each)');
  });

  it('still detects Ghostly Prison {2} and Baird {1} without name routing', () => {
    expect(collectAttackYouTaxPreviewForDefender([
      perm({ id: 'gp', controller: 'def', name: 'Ghostly Prison', oracle: GHOSTLY_PRISON }),
    ], 'def').generic).toBe(2);

    expect(collectAttackYouTaxPreviewForDefender([
      perm({
        id: 'baird',
        controller: 'def',
        name: 'Baird, Steward of Argive',
        oracle: BAIRD,
        type: 'Legendary Creature — Human Soldier',
      }),
    ], 'def').generic).toBe(1);
  });

  it('sums stacked Annexes and mixes with generic tax', () => {
    const battlefield = [
      perm({ id: 'a1', controller: 'def', name: "Norn's Annex", oracle: NORNS_ANNEX, type: 'Artifact' }),
      perm({ id: 'a2', controller: 'def', name: "Norn's Annex", oracle: NORNS_ANNEX, type: 'Artifact' }),
      perm({ id: 'gp', controller: 'def', name: 'Ghostly Prison', oracle: GHOSTLY_PRISON }),
    ];
    const tax = collectAttackYouTaxPreviewForDefender(battlefield, 'def');
    expect(tax.generic).toBe(2);
    expect(tax.phyrexian).toHaveLength(2);
    expect(formatAttackYouTaxPerCreature(tax)).toBe('{2} + {W/P} + {W/P}/attacker');
    expect(formatAttackYouTaxForCount(tax, 2)).toBe('{4} + 4×{W/P}');
  });

  it('resolves Sphere of Safety {X} from enchantment count', () => {
    const battlefield = [
      perm({ id: 'sphere', controller: 'def', name: 'Sphere of Safety', oracle: SPHERE }),
      perm({
        id: 'other',
        controller: 'def',
        name: 'Pacifism',
        oracle: 'Enchanted creature cannot attack or block.',
      }),
    ];
    expect(collectAttackYouTaxPreviewForDefender(battlefield, 'def').generic).toBe(2);
  });

  it('resolves Collective Restraint {X} from domain', () => {
    const battlefield = [
      perm({ id: 'cr', controller: 'def', name: 'Collective Restraint', oracle: COLLECTIVE }),
      perm({
        id: 'island',
        controller: 'def',
        name: 'Island',
        oracle: '',
        type: 'Basic Land — Island',
      }),
      perm({
        id: 'mountain',
        controller: 'def',
        name: 'Mountain',
        oracle: '',
        type: 'Basic Land — Mountain',
      }),
    ];
    expect(collectAttackYouTaxPreviewForDefender(battlefield, 'def').generic).toBe(2);
  });

  it('does not tax idle War Tax; uses lastingEffects after activation', () => {
    const battlefield = [
      perm({ id: 'wt', controller: 'def', name: 'War Tax', oracle: WAR_TAX }),
    ];
    expect(collectAttackYouTaxPreviewForDefender(battlefield, 'def').generic).toBe(0);
    const stamped = collectAttackYouTaxPreviewForDefender(battlefield, 'anyone', [{
      type: 'attackTaxGeneric',
      amount: 3,
      global: true,
      source: 'War Tax',
    }]);
    expect(stamped.generic).toBe(3);
  });

  it("does not treat idle Whipgrass Entangler as defender tax", () => {
    expect(collectAttackYouTaxPreviewForDefender([
      perm({
        id: 'whip',
        controller: 'def',
        name: 'Whipgrass Entangler',
        oracle: WHIPGRASS,
        type: 'Creature — Human Cleric',
      }),
    ], 'def').generic).toBe(0);
  });

  it('adds Whipgrass granted {1} per Cleric to current-selection cost', () => {
    const battlefield = [
      perm({
        id: 'bear',
        controller: 'atk',
        name: 'Grizzly Bears',
        oracle: '',
        type: 'Creature — Bear',
        temporaryEffects: [{
          description: "This creature can't attack or block unless its controller pays {1} for each Cleric on the battlefield.",
        }],
      }),
      perm({
        id: 'whip',
        controller: 'def',
        name: 'Whipgrass Entangler',
        oracle: WHIPGRASS,
        type: 'Creature — Human Cleric',
      }),
      perm({
        id: 'cleric2',
        controller: 'atk',
        name: 'Soul Warden',
        oracle: '',
        type: 'Creature — Human Cleric',
      }),
    ];
    expect(formatSelectedAttackersTax(
      [['bear', 'def']],
      { def: { attackTaxPerCreature: 0 } },
      { battlefield },
    )).toBe('{2}');
  });

  it('charges Nils {X} from counters on the selected attacker', () => {
    const battlefield = [
      perm({
        id: 'nils',
        controller: 'def',
        name: 'Nils, Discipline Enforcer',
        oracle: NILS,
        type: 'Legendary Creature — Human Cleric',
      }),
      perm({
        id: 'bear',
        controller: 'atk',
        name: 'Grizzly Bears',
        oracle: '',
        type: 'Creature — Bear',
        counters: { '+1/+1': 3 },
      }),
    ];
    const tax = collectAttackYouTaxPreviewForDefender(battlefield, 'def');
    expect(tax.countersOnAttacker).toBe(true);
    expect(formatAttackYouTaxPerCreature(tax)).toBe('{X} (counters)/attacker');
    expect(formatSelectedAttackersTax(
      [['bear', 'def']],
      { def: { attackTaxPerCreature: 0, attackTaxCountersOnAttacker: true } },
      { battlefield },
    )).toBe('{3}');
  });

  it('skips Archangel of Tithes tax while it is tapped', () => {
    const untapped = collectAttackYouTaxPreviewForDefender([
      perm({
        id: 'angel',
        controller: 'def',
        name: 'Archangel of Tithes',
        oracle: ARCHANGEL,
        type: 'Creature — Angel',
      }),
    ], 'def');
    const tapped = collectAttackYouTaxPreviewForDefender([
      perm({
        id: 'angel',
        controller: 'def',
        name: 'Archangel of Tithes',
        oracle: ARCHANGEL,
        type: 'Creature — Angel',
        tapped: true,
      }),
    ], 'def');
    expect(untapped.generic).toBe(1);
    expect(tapped.generic).toBe(0);
  });

  it('charges Cowed by Wisdom from the attached aura using the aura controller hand', () => {
    const battlefield = [
      perm({
        id: 'bear',
        controller: 'atk',
        name: 'Grizzly Bears',
        oracle: '',
        type: 'Creature — Bear',
      }),
      {
        ...perm({
          id: 'cowed',
          controller: 'def',
          name: 'Cowed by Wisdom',
          oracle: "Enchant creature\nEnchanted creature can't attack or block unless its controller pays {1} for each card in your hand.",
          type: 'Enchantment — Aura',
        }),
        attachedTo: 'bear',
      } as BattlefieldPermanent,
    ];
    const tax = collectAttackerSelfAttackTax(battlefield[0], battlefield, {
      players: [{ id: 'def', hand: [{}, {}, {}] }],
    });
    expect(tax.cost).toBe(3);
    expect(tax.sources).toContain('Cowed by Wisdom');
  });

  it('ignores pillowfort permanents controlled by other players', () => {
    const tax = collectAttackYouTaxPreviewForDefender([
      perm({
        id: 'annex',
        controller: 'other',
        name: "Norn's Annex",
        oracle: NORNS_ANNEX,
        type: 'Artifact',
      }),
    ], 'def');
    expect(tax).toEqual({ generic: 0, phyrexian: [], countersOnAttacker: false });
  });
});
