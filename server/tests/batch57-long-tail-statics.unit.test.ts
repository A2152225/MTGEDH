import { describe, expect, it } from 'vitest';
import { collectAttackPermanentCosts } from '../src/socket/combat-handlers/attackCostPermanentPayment.js';
import { collectBatch17DamagePreventionRules, applyBatch17DamagePrevention } from '../src/state/modules/replacementBatch17DamagePrevention.js';
import { getPermanentProtections, protectionPreventsSource } from '../src/state/modules/combat-mechanics.js';
import { getNoAbilitiesBlockRestrictionReason, permanentHasAbilities } from '../../shared/src/combatNoAbilitiesBlockRestriction.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

describe('batch57 long-tail statics and replacements', () => {
  it('Floodtide / Flooded Woodlands collect non-mana attack permanent costs', () => {
    const serpent = {
      id: 'fs', controller: 'p1',
      card: {
        name: 'Floodtide Serpent',
        type_line: 'Creature \u2014 Serpent',
        oracle_text: "This creature can't attack unless you return an enchantment you control to its owner's hand.",
      },
    };
    const flooded = {
      id: 'fw', controller: 'p2',
      card: {
        name: 'Flooded Woodlands',
        type_line: 'Enchantment',
        oracle_text: "Green creatures can't attack unless their controller sacrifices a land of their choice for each green creature they control that's attacking.",
      },
    };
    const green = {
      id: 'bear', controller: 'p1', colors: ['G'],
      card: { name: 'Bear', type_line: 'Creature \u2014 Bear', oracle_text: '', colors: ['G'] },
    };
    const state: any = { battlefield: [serpent, flooded, green], players: [{ id: 'p1' }, { id: 'p2' }] };
    const self = collectAttackPermanentCosts(state, 'p1', [{ creatureId: 'fs' }]);
    expect(self.some((r) => r.kind === 'return_to_hand' && r.permanentType === 'enchantment')).toBe(true);
    const color = collectAttackPermanentCosts(state, 'p1', [{ creatureId: 'bear' }]);
    expect(color.some((r) => r.kind === 'sacrifice' && r.permanentType === 'land' && r.count >= 1)).toBe(true);
  });

  it('Angel of Suffering prevents damage to you and mills twice that many', () => {
    const angel = {
      id: 'aos', controller: 'p1',
      card: {
        name: 'Angel of Suffering',
        type_line: 'Creature \u2014 Angel',
        oracle_text: 'Flying\nIf damage would be dealt to you, prevent that damage and mill twice that many cards.',
      },
    };
    const state: any = {
      battlefield: [angel],
      players: [{ id: 'p1' }],
      zones: { p1: { library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }], graveyard: [], libraryCount: 4, graveyardCount: 0 } },
    };
    const rules = collectBatch17DamagePreventionRules(state);
    expect(rules.some((r) => r.kind === 'player-prevent-mill' && (r as any).millMultiplier === 2)).toBe(true);
    const ctx = { state, libraries: new Map([['p1', [...state.zones.p1.library]]]) };
    const result = applyBatch17DamagePrevention(ctx, 2, 'p1', undefined);
    expect(result?.amount).toBe(0);
    expect(result?.modifiers.join(' ')).toMatch(/milled/i);
    expect(state.zones.p1.graveyard.length).toBe(4);
  });

  it('True-Name Nemesis has protection from the chosen player', () => {
    const nemesis = {
      id: 'tnn', controller: 'p1', chosenPlayer: 'p2',
      card: {
        name: 'True-Name Nemesis',
        type_line: 'Creature \u2014 Merfolk Rogue',
        oracle_text: 'As this creature enters, choose a player.\nThis creature has protection from the chosen player.',
        chosenPlayer: 'p2',
      },
    };
    const enemy = {
      id: 'src', controller: 'p2',
      card: { name: 'Bolt', type_line: 'Creature \u2014 Elemental', oracle_text: '', colors: ['R'] },
      colors: ['R'],
    };
    const friend = {
      id: 'ally', controller: 'p1',
      card: { name: 'Ally', type_line: 'Creature \u2014 Bear', oracle_text: '', colors: ['G'] },
      colors: ['G'],
    };
    const prots = getPermanentProtections(nemesis);
    expect(prots.some((p) => p === 'player:p2')).toBe(true);
    expect(protectionPreventsSource(nemesis, enemy)).toBe(true);
    expect(protectionPreventsSource(nemesis, friend)).toBe(false);
  });

  it('Jasmine no-abilities lord blocks ability-having blockers', () => {
    const jasmine = {
      id: 'jb', controller: 'p1',
      card: {
        name: 'Jasmine Boreal of the Seven',
        oracle_text: "{T}: Add {G}{W}. Spend this mana only to cast creature spells with no abilities.\nCreatures you control with no abilities can't be blocked by creatures with abilities.",
      },
    };
    const vanilla = {
      id: 'v', controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '' },
    };
    const flyer = {
      id: 'f', controller: 'p2',
      card: { name: 'Skyknight', type_line: 'Creature \u2014 Human Knight', oracle_text: 'Flying' },
    };
    const bf = [jasmine, vanilla, flyer];
    expect(permanentHasAbilities(vanilla)).toBe(false);
    expect(permanentHasAbilities(flyer)).toBe(true);
    expect(getNoAbilitiesBlockRestrictionReason(vanilla, flyer, bf)).toMatch(/abilities/i);
    expect(getNoAbilitiesBlockRestrictionReason(vanilla, { id: 'v2', controller: 'p2', card: { name: 'Bear2', oracle_text: '' } }, bf)).toBeUndefined();
  });

  it('classifier marks gift / attack permanent costs / planeswalk / jasmine / true-name', () => {
    expect(classifyStaticCensusLine('Gift a card (You may promise an opponent a gift as you cast this spell. If you do, when it enters, they draw a card.)', 'Scrapshooter')?.system).toMatch(/gift/i);
    expect(classifyStaticCensusLine(
      "Green creatures can't attack unless their controller sacrifices a land of their choice for each green creature they control that's attacking.",
      'Flooded Woodlands',
    )?.system).toMatch(/attackCostPermanent|sacrifices a land/i);
    expect(classifyStaticCensusLine(
      "This creature can't attack unless you return an enchantment you control to its owner's hand.",
      'Floodtide Serpent',
    )?.system).toMatch(/attackCostPermanent|return/i);
    expect(classifyStaticCensusLine(
      'If you would planeswalk, instead look at the top two cards of your planar deck, put one on the bottom of your planar deck and the other on top, then planeswalk.',
      'Susan Foreman',
    )?.system).toMatch(/planeswalk|planechase/i);
    expect(classifyStaticCensusLine(
      "Creatures you control with no abilities can't be blocked by creatures with abilities.",
      'Jasmine Boreal of the Seven',
    )?.system).toMatch(/no abilities|combatNoAbilities/i);
    expect(classifyStaticCensusLine(
      'This creature has protection from the chosen player.',
      'True-Name Nemesis',
    )?.system).toMatch(/chosen player|getPermanentProtections/i);
  });
});
