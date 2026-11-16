import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { firstDrawRevealSources } from '../src/state/modules/firstDrawRevealStatic.js';
import { parseDieRollNudge } from '../src/state/modules/dieRollNudgePrompt.js';
import { hasUsedPowerUpAbility, markPowerUpAbilityUsed } from '../src/state/modules/marvelMechanicsHelpers.js';
import {
  batch113ApplyTransformCopy,
  batch113AssistDraws,
  batch113ColoredXLimit,
  batch113ManaValueProtection,
  batch113PowerUpLimit,
  batch113SpellHasAssist,
  batch113SwampSacrificeCount,
  batch113TargetLifeTax,
  batch113VillainousExtra,
} from '../src/state/modules/batch113Remaining.js';

function perm(id: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    card: { name, oracle_text: oracle, type_line: 'Creature — Bear', power: '2', toughness: '2' },
    ...extra,
  };
}

function kinds(oracle: string): string[] {
  return parseStaticEffectSpecsFromOraclePermanent(perm('x', 'Card', oracle) as any).flatMap((spec: any) => spec.grant?.abilities || []);
}

describe('batch 113 leftover lines', () => {
  it('parses a static spec for each leftover static sentence', () => {
    expect(kinds('Each power-up ability of permanents you control can be activated an additional time.')).toContain('power_up_extra');
    expect(kinds('This creature has protection from each mana value of the chosen quality.')).toContain('mv_quality_protection');
    expect(kinds('The first spell you cast during each of your turns has assist.')).toContain('assist_grant');
    expect(kinds('Spells cost an additional "Sacrifice a Swamp" to cast for each black mana symbol in their mana costs.')).toContain('sacrifice_swamp_spell');
    expect(kinds('Activated abilities cost an additional "Sacrifice a Swamp" to activate for each black mana symbol in their activation costs.')).toContain('sacrifice_swamp_ability');
    expect(kinds('Spells your opponents cast that target this creature cost an additional 3 life to cast.')).toContain('target_life_tax');
    expect(kinds('Spend only colored mana on X. No more than one mana of each color may be spent this way.')).toContain('colored_x');
    expect(kinds("As this creature transforms into Olag, Ludevic's Hubris, it becomes a copy of a creature card exiled with it, except its name is Olag, Ludevic's Hubris, it's 4/4, and it's a legendary blue and black Zombie in addition to its other types.")).toContain('transform_copy');
    expect(kinds('You may reveal the first card you draw each turn as you draw it.')).toContain('optional_first_draw_reveal');
    expect(kinds('Once each turn, you may pay {1} to reroll one or more dice you rolled.')).toContain('reroll_dice');
    expect(kinds('As Saskia the Unyielding enters, choose a player.')).toContain('choose_player');
  });

  it('lets a power-up ability be used a second time and protects the chosen mana-value parity', () => {
    const wonder = perm('w', 'Wonder Man', 'Each power-up ability of permanents you control can be activated an additional time.');
    const state = { battlefield: [wonder] };
    const hero = { id: 'hero', powerUpAbilityUseCount: {} };
    expect(batch113PowerUpLimit(state, 'p1')).toBe(2);
    expect(hasUsedPowerUpAbility(hero, 0, 2)).toBe(false);
    markPowerUpAbilityUsed(hero, 0);
    expect(hasUsedPowerUpAbility(hero, 0, 2)).toBe(false);
    markPowerUpAbilityUsed(hero, 0);
    expect(hasUsedPowerUpAbility(hero, 0, 2)).toBe(true);

    const lavabrink = perm('l', 'Lavabrink Venturer', 'This creature has protection from each mana value of the chosen quality.', { chosenOddEven: 'odd' });
    expect(batch113ManaValueProtection(lavabrink, 3)).toBe(true);
    expect(batch113ManaValueProtection(lavabrink, 4)).toBe(false);
  });

  it('grants assist to the first spell, counts swamp pips, and taxes a targeted creature', () => {
    const yume = perm('y', 'Yume', 'The first spell you cast during each of your turns has assist. When you cast that spell, if another player spent mana to cast it, you and that player each draw a card.');
    const state = { battlefield: [yume], spellsCastThisTurn: [] as any[] };
    expect(batch113SpellHasAssist(state, 'p1', { id: 'bolt' })).toBe(true);
    state.spellsCastThisTurn.push({ casterId: 'p1', cardId: 'other' });
    expect(batch113SpellHasAssist(state, 'p1', { id: 'bolt' })).toBe(false);
    expect(batch113AssistDraws(state, 'p1')).toBe(true);

    const drought = perm('d', 'Drought', 'Spells cost an additional "Sacrifice a Swamp" to cast for each black mana symbol in their mana costs. Activated abilities cost an additional "Sacrifice a Swamp" to activate for each black mana symbol in their activation costs.');
    const board = { battlefield: [drought] };
    expect(batch113SwampSacrificeCount(board, 'p1', '{B}{B}{R}', 'spell')).toBe(2);
    expect(batch113SwampSacrificeCount(board, 'p1', '{T}: Add {B}', 'ability')).toBe(1);

    const terror = perm('t', 'Terror of the Peaks', 'Spells your opponents cast that target this creature cost an additional 3 life to cast.', { controller: 'p2' });
    expect(batch113TargetLifeTax({ battlefield: [terror] }, 'p1', ['t'])).toBe(3);
    expect(batch113TargetLifeTax({ battlefield: [terror] }, 'p2', ['t'])).toBe(0);
  });

  it('caps colored X, copies the exiled creature on transform, and repeats a villainous choice', () => {
    expect(batch113ColoredXLimit({ oracle_text: 'Spend only colored mana on X. No more than one mana of each color may be spent this way.' })).toBe(5);
    expect(batch113ColoredXLimit({ oracle_text: 'Fireball deals X damage.' })).toBeNull();

    const olag = perm('o', 'Olag', "As this creature transforms into Olag, Ludevic's Hubris, it becomes a copy of a creature card exiled with it, except its name is Olag, Ludevic's Hubris, it's 4/4, and it's a legendary blue and black Zombie in addition to its other types.", {
      exiledCards: [{ name: 'Bear', type_line: 'Creature — Bear', oracle_text: 'Bears have trample.', colors: ['G'], power: '2', toughness: '2' }],
    });
    batch113ApplyTransformCopy(olag);
    expect(olag.card.power).toBe('4');
    expect(olag.card.toughness).toBe('4');
    expect(olag.card.type_line).toMatch(/Legendary/);
    expect(olag.card.type_line).toMatch(/Zombie/);
    expect(olag.card.colors).toEqual(expect.arrayContaining(['G', 'U', 'B']));
    expect(olag.card.oracle_text).toMatch(/Bears have trample/);

    const valeyard = perm('v', 'The Valeyard', 'If an opponent would face a villainous choice, they face that choice an additional time.');
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [valeyard] } as any);
    expect(specs.some((spec: any) => spec.reason === 'villainous_extra')).toBe(true);
    expect(batch113VillainousExtra({ battlefield: [valeyard] }, 'p1', 'an opponent faces a villainous choice')).toBe(true);
  });

  it('asks for a player as Saskia enters, keeps an optional reveal off the mandatory path, and offers a paid reroll', () => {
    const reqs = getAsEntersChoiceRequirements({ name: 'Saskia the Unyielding', oracle_text: 'As Saskia the Unyielding enters, choose a player.' });
    expect(reqs.some((req) => req.kind === 'player')).toBe(true);
    const eisenhorn = perm('e', 'Inquisitor Eisenhorn', 'You may reveal the first card you draw each turn as you draw it.');
    expect(firstDrawRevealSources({ battlefield: [eisenhorn] }, 'p1')).toEqual([]);
    expect(parseDieRollNudge('Once each turn, you may pay {1} to reroll one or more dice you rolled.')).toEqual({ kind: 'reroll', oncePerTurn: true });
  });
});
