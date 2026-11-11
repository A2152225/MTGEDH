import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { getCreatureTypesNow } from '../src/state/creatureTypeNow.js';
import { castRestrictionTailViolation } from '../src/state/modules/castRestrictionTailFamilies.js';
import { getGrantedCascadeCountForCast } from '../src/state/modules/cascadeCastGrants.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch85 statics', () => {
  it('Innkeeper + Spiritual Asylum + Runadi + Furtive', () => {
    const talent = P("Innkeeper's Talent", 'Permanents you control with counters on them have ward {1}.', 'Enchantment');
    expect(parseStaticEffectSpecsFromOraclePermanent(talent).some(
      (s) => (s.grant.abilities || []).some((a) => /^ward/i.test(a)) && (s.scope as any)?.qualifier?.anyCounter === true,
    )).toBe(true);

    const asylum = P('Spiritual Asylum', 'Creatures and lands you control have shroud.', 'Enchantment');
    const specs = parseStaticEffectSpecsFromOraclePermanent(asylum);
    expect(specs.some((s) => s.scope.kind === 'creatures_you_control' && (s.grant.abilities || []).includes('shroud'))).toBe(true);
    expect(specs.some((s) => s.scope.kind === 'lands_you_control' && (s.grant.abilities || []).includes('shroud'))).toBe(true);

    const runadi = P('Runadi, Behemoth Caller', 'Creatures you control with three or more +1/+1 counters on them have haste.');
    expect(parseStaticEffectSpecsFromOraclePermanent(runadi).some(
      (s) => s.condition?.kind === 'target_has_counter_at_least' && (s.grant.abilities || []).includes('haste'),
    )).toBe(true);

    const courier = P('Furtive Courier', "This creature can't be blocked as long as you've sacrificed an artifact this turn.");
    const cSpecs = parseStaticEffectSpecsFromOraclePermanent(courier);
    expect(cSpecs.some((s) => s.condition?.kind === 'source_controller_sacrificed_artifact_this_turn')).toBe(true);
    const state: any = {
      battlefield: [courier],
      players: [{ id: 'p1' }],
      artifactsSacrificedThisTurn: { p1: 1 },
    };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(courier, state)).toContain("can't be blocked");
  });

  it('Earthen Ally + Trash-Bot countedPT + Moraug anthem', () => {
    const ally = P('Earthen Ally', 'This creature gets +1/+0 for each color among Allies you control.');
    const other = {
      id: 'a2', controller: 'p1',
      card: { name: 'Ally', type_line: 'Creature — Ally', power: '1', toughness: '1', colors: ['W', 'U'] },
    };
    const aState: any = { battlefield: [ally, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(aState);
    expect(getCurrentPowerToughness(ally, aState)?.power).toBe(4);

    const bot = P('Runaway Trash-Bot', 'This creature gets +1/+0 for each artifact and/or enchantment card in your graveyard.');
    const bState: any = {
      battlefield: [bot],
      players: [{ id: 'p1' }],
      zones: { p1: { graveyard: [{ type_line: 'Artifact' }, { type_line: 'Enchantment' }, { type_line: 'Creature' }] } },
    };
    syncDerivedContinuousEffects(bState);
    expect(getCurrentPowerToughness(bot, bState)?.power).toBe(4);

    const moraug = P('Moraug, Fury of Akoum', 'Each creature you control gets +1/+0 for each time it has attacked this turn.');
    const c1 = {
      id: 'c1', controller: 'p1', timesAttackedThisTurn: 2,
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const mState: any = { battlefield: [moraug, c1], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(mState);
    expect(getCurrentPowerToughness(c1 as any, mState)?.power).toBe(4);
  });

  it('Brand + First Sliver cascade + Criminal Past + Mari + Zombie Master + Ygra + Rukarumel', () => {
    const host = {
      id: 'h', controller: 'p2',
      card: { name: 'Host', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const brand = P(
      'Brand of Ill Omen',
      "Enchanted creature's controller can't cast creature spells.",
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const brandState: any = { battlefield: [brand, host], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' };
    expect(castRestrictionTailViolation(brandState, 'p2', { name: 'Bear', type_line: 'Creature', cmc: 2 }, 'hand')).toBeTruthy();
    expect(castRestrictionTailViolation(brandState, 'p1', { name: 'Bear', type_line: 'Creature', cmc: 2 }, 'hand')).toBeNull();

    const sliver = P('The First Sliver', 'Sliver spells you cast have cascade.');
    expect(getGrantedCascadeCountForCast(
      { battlefield: [sliver] },
      'p1',
      { type_line: 'Creature — Sliver' },
      {},
    )).toBe(1);
    expect(getGrantedCascadeCountForCast(
      { battlefield: [sliver] },
      'p1',
      { type_line: 'Creature — Bear' },
      {},
    )).toBe(0);

    const past = P(
      'Criminal Past',
      'Commander creatures you own have menace and "This creature gets +X/+0, where X is the number of creature cards in your graveyard."',
      'Enchantment — Background',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(past).some(
      (s) => (s.grant.abilities || []).includes('menace') && Array.isArray(s.conditions),
    )).toBe(true);

    const mari = P('Mari, the Killing Quill', 'Assassins, Mercenaries, and Rogues you control have deathtouch.');
    expect(parseStaticEffectSpecsFromOraclePermanent(mari).some(
      (s) => s.condition?.kind === 'target_has_any_subtype' && (s.grant.abilities || []).includes('deathtouch'),
    )).toBe(true);

    const zm = P('Zombie Master', 'Other Zombies have "{B}: Regenerate this permanent."');
    expect(parseStaticEffectSpecsFromOraclePermanent(zm).some(
      (s) => s.scope.kind === 'other_all_creatures_of_type',
    )).toBe(true);

    const ygra = P(
      'Ygra, Eater of All',
      'Other creatures are Food artifacts in addition to their other types and have "{2}, {T}, Sacrifice this permanent: You gain 3 life."',
    );
    const prey = {
      id: 'prey', controller: 'p2',
      card: { name: 'Prey', type_line: 'Creature — Elk', power: '2', toughness: '2' },
    };
    const yState: any = { battlefield: [ygra, prey], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(yState);
    expect((prey as any).continuousTypeAdditions || []).toEqual(expect.arrayContaining(['Food', 'Artifact']));

    const ruka = P(
      'Rukarumel, Biologist',
      'Slivers you control and nontoken creatures you control are the chosen type in addition to their other creature types.',
      'Creature',
      { chosenCreatureType: 'Wizard' },
    );
    const elf = {
      id: 'e', controller: 'p1',
      card: { name: 'Elf', type_line: 'Creature — Elf', power: '1', toughness: '1' },
    };
    const rState: any = { battlefield: [ruka, elf], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(rState);
    expect([...getCreatureTypesNow(elf as any)].map((t) => t.toLowerCase())).toContain('wizard');
  });

  it('CDAs: Sutured Ghoul + Shapeshifter', () => {
    const ghoul = calculateVariablePT(
      {
        name: 'Sutured Ghoul',
        power: '*',
        toughness: '*',
        oracle_text: "Sutured Ghoul's power is equal to the total power of the exiled cards and its toughness is equal to their total toughness.",
        controller: 'p1',
        id: 'src',
      },
      {
        battlefield: [{
          id: 'src', controller: 'p1',
          exiledCards: [{ power: '2', toughness: '2' }, { power: '3', toughness: '1' }],
          card: {
            name: 'Sutured Ghoul', power: '*', toughness: '*',
            oracle_text: "Sutured Ghoul's power is equal to the total power of the exiled cards and its toughness is equal to their total toughness.",
          },
        }],
        zones: { p1: { exile: [] } },
      },
    );
    expect(ghoul).toEqual({ power: 5, toughness: 3 });

    const shape = calculateVariablePT(
      {
        name: 'Shapeshifter',
        power: '*',
        toughness: '*',
        oracle_text: "Shapeshifter's power is equal to the last chosen number and its toughness is equal to 7 minus that number.",
        controller: 'p1',
        id: 'src',
      },
      {
        battlefield: [{
          id: 'src', controller: 'p1', chosenNumber: 3,
          card: {
            name: 'Shapeshifter', power: '*', toughness: '*',
            oracle_text: "Shapeshifter's power is equal to the last chosen number and its toughness is equal to 7 minus that number.",
          },
        }],
        zones: { p1: {} },
      },
    );
    expect(shape).toEqual({ power: 3, toughness: 4 });
  });

  it('classifiers cover B85 families', () => {
    const lines: Array<[string, string]> = [
      ['Permanents you control with counters on them have ward {1}.', "Innkeeper's Talent"],
      ['Creatures and lands you control have shroud.', 'Spiritual Asylum'],
      ['Creatures you control with three or more +1/+1 counters on them have haste.', 'Runadi, Behemoth Caller'],
      ["This creature can't be blocked as long as you've sacrificed an artifact this turn.", 'Furtive Courier'],
      ['This creature gets +1/+0 for each color among Allies you control.', 'Earthen Ally'],
      ['This creature gets +1/+0 for each artifact and/or enchantment card in your graveyard.', 'Runaway Trash-Bot'],
      ['Each creature you control gets +1/+0 for each time it has attacked this turn.', 'Moraug, Fury of Akoum'],
      ['Sliver spells you cast have cascade.', 'The First Sliver'],
      ['Commander creatures you own have menace and "This creature gets +X/+0, where X is the number of creature cards in your graveyard."', 'Criminal Past'],
      ['Assassins, Mercenaries, and Rogues you control have deathtouch.', 'Mari, the Killing Quill'],
      ['Other Zombies have "{B}: Regenerate this permanent."', 'Zombie Master'],
      ['Other creatures are Food artifacts in addition to their other types and have "{2}, {T}, Sacrifice this permanent: You gain 3 life."', 'Ygra, Eater of All'],
      ['Slivers you control and nontoken creatures you control are the chosen type in addition to their other creature types.', 'Rukarumel, Biologist'],
      ["Enchanted creature's controller can't cast creature spells.", 'Brand of Ill Omen'],
      ["Sutured Ghoul's power is equal to the total power of the exiled cards and its toughness is equal to their total toughness.", 'Sutured Ghoul'],
      ["Shapeshifter's power is equal to the last chosen number and its toughness is equal to 7 minus that number.", 'Shapeshifter'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
