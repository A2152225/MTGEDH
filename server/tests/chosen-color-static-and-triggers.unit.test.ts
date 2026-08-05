import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { applyDeclarativeStaticSpecs, recomputeContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { computeContinuousEffects } from '../src/rules-engine/staticEffects.js';
import { detectSpellCastTriggers, getSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { parseProtections } from '../src/state/modules/combat-mechanics.js';
import {
  applyOracleTextRewriteOverlays,
  collectOracleTextRewriteOverlays,
  getEffectiveOracleText,
} from '../src/state/modules/effectiveOracleText.js';
import { getEffectiveColors } from '../src/state/modules/effectiveColors.js';

describe('chosen-color static effects', () => {
  it('parses Voice of All style protection from the chosen color', () => {
    const perm = {
      id: 'voice_1',
      controller: 'p1',
      chosenColor: 'red',
      card: {
        name: 'Voice of All',
        type_line: 'Creature — Angel',
        oracle_text: 'Flying\nAs this creature enters, choose a color.\nThis creature has protection from the chosen color.',
        colors: ['W'],
      },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm as any);
    expect(specs.some((s) => s.grant.abilities?.some((a) => a.includes('protection from red')))).toBe(true);
    expect(parseProtections(perm.card, perm)).toContain('red');
  });

  it('parses Gauntlet global chosen-color anthem', () => {
    const perm = {
      id: 'gauntlet_1',
      controller: 'p1',
      chosenColor: 'green',
      card: {
        name: 'Gauntlet of Power',
        type_line: 'Artifact',
        oracle_text:
          'As this artifact enters, choose a color.\nCreatures of the chosen color get +1/+1.\nWhenever a basic land is tapped for mana of the chosen color, its controller adds an additional one mana of that color.',
      },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm as any);
    const anthem = specs.find((s) => s.id.includes('chosen-color-global-anthem'));
    expect(anthem?.scope.kind).toBe('all_creatures');
    expect(anthem?.condition).toEqual({ kind: 'target_has_mana_color', color: 'green' });
  });

  it('adds chosen color to Alloy Golem / Painter Servant via colorAdditions', () => {
    const alloy = {
      id: 'alloy_1',
      controller: 'p1',
      chosenColor: 'blue',
      card: {
        name: 'Alloy Golem',
        type_line: 'Artifact Creature — Golem',
        oracle_text: 'As this creature enters, choose a color.\nThis creature is the chosen color.',
        colors: [],
      },
    };
    const painter = {
      id: 'painter_1',
      controller: 'p1',
      chosenColor: 'blue',
      card: {
        name: "Painter's Servant",
        type_line: 'Artifact Creature — Scarecrow',
        oracle_text:
          "As this creature enters, choose a color.\nAll cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors.",
        colors: [],
      },
    };
    const redCreature = {
      id: 'red_1',
      controller: 'p2',
      card: {
        name: 'Goblin',
        type_line: 'Creature — Goblin',
        colors: ['R'],
        oracle_text: '',
      },
    };

    const state = { battlefield: [alloy, painter, redCreature] };
    const derived = recomputeContinuousEffects(state as any);
    expect(derived.colorAdditions.get('alloy_1')).toEqual(expect.arrayContaining(['U']));
    expect(derived.colorAdditions.get('red_1')).toEqual(expect.arrayContaining(['U']));
    expect(getEffectiveColors({ ...redCreature, colorAdditions: derived.colorAdditions.get('red_1') })).toEqual(
      expect.arrayContaining(['R', 'U']),
    );
  });
});

describe('chosen-color cast triggers', () => {
  it('detects Prism Ring / Diamond Mare style triggers', () => {
    const card = {
      name: 'Prism Ring',
      oracle_text:
        'As this artifact enters, choose a color.\nWhenever you cast a spell of the chosen color, you gain 1 life.',
    };
    const triggers = detectSpellCastTriggers(card, { id: 'ring_1', chosenColor: 'red', card });
    expect(triggers.some((t) => t.spellCondition === 'chosen_color')).toBe(true);
  });

  it('fires when cast spell matches stored chosen color', () => {
    const ring = {
      id: 'ring_1',
      controller: 'p1',
      chosenColor: 'red',
      card: {
        name: 'Diamond Mare',
        oracle_text:
          'As this creature enters, choose a color.\nWhenever you cast a spell of the chosen color, you gain 1 life.',
        type_line: 'Artifact Creature — Horse',
      },
    };
    const ctx = { state: { battlefield: [ring] } } as any;
    const hits = getSpellCastTriggers(ctx, 'p1', {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      colors: ['R'],
    });
    expect(hits.some((t) => t.spellCondition === 'chosen_color')).toBe(true);
  });

  it('Painter Servant makes off-color spells match chosen-color cast triggers', () => {
    const ring = {
      id: 'ring_1',
      controller: 'p1',
      chosenColor: 'blue',
      card: {
        name: 'Prism Ring',
        oracle_text:
          'As this artifact enters, choose a color.\nWhenever you cast a spell of the chosen color, you gain 1 life.',
        type_line: 'Artifact',
      },
    };
    const painter = {
      id: 'painter_1',
      controller: 'p1',
      chosenColor: 'blue',
      card: {
        name: "Painter's Servant",
        type_line: 'Artifact Creature — Scarecrow',
        oracle_text:
          "As this creature enters, choose a color.\nAll cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors.",
      },
    };
    const ctx = { state: { battlefield: [ring, painter] } } as any;
    const hits = getSpellCastTriggers(ctx, 'p1', {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      colors: ['R'],
    });
    expect(hits.some((t) => t.spellCondition === 'chosen_color')).toBe(true);
  });
});

describe('color-word oracle rewrites', () => {
  it('rewrites color words for Swirl the Mists', () => {
    const swirl = {
      id: 'swirl_1',
      controller: 'p1',
      chosenColor: 'red',
      chosenColorWord: 'red',
      card: {
        name: 'Swirl the Mists',
        oracle_text:
          'As this enchantment enters, choose a color word.\nAll instances of color words in the text of spells and permanents are changed to the chosen color word.',
      },
    };
    const state = { battlefield: [swirl] };
    const overlays = collectOracleTextRewriteOverlays(state);
    expect(overlays[0]?.replaceAllColorWordsWith).toBe('red');
    const rewritten = applyOracleTextRewriteOverlays('White creatures get +1/+1.', overlays);
    expect(rewritten.toLowerCase()).toContain('red creatures');
    expect(getEffectiveOracleText({ oracle_text: 'White creatures get +1/+1.' }, state).toLowerCase()).toContain(
      'red creatures',
    );
  });

  it('applies Swirl rewrite when collecting static anthem specs', () => {
    const swirl = {
      id: 'swirl_1',
      controller: 'p1',
      chosenColorWord: 'red',
      card: {
        name: 'Swirl the Mists',
        oracle_text:
          'As this enchantment enters, choose a color word.\nAll instances of color words in the text of spells and permanents are changed to the chosen color word.',
      },
    };
    const anthem = {
      id: 'anthem_1',
      controller: 'p1',
      card: {
        name: 'Crusade',
        type_line: 'Enchantment',
        oracle_text: 'White creatures get +1/+1.',
      },
    };
    const state = { battlefield: [swirl, anthem] };
    const specs = parseStaticEffectSpecsFromOraclePermanent({
      ...anthem,
      card: {
        ...anthem.card,
        oracle_text: getEffectiveOracleText(anthem, state),
      },
    } as any);
    const redAnthem = specs.find((s) => String(s.id || '').includes('red-creatures-anthem'));
    expect(redAnthem?.condition).toEqual({ kind: 'target_has_mana_color', color: 'red' });
  });
});
