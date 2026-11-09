import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { oracleDevotionIncreaseAmount } from '../src/state/modules/devotionBonusStatic.js';
import { countDevotionAmongPermanents } from '../../shared/src/devotionCount.js';
import { landPlaySameNameAsNontokenViolation } from '../src/state/modules/landPlaySameNameRestriction.js';
import {
  oracleRequiresTapCreatureAttackBlockCost,
  permanentRequiresTapCreatureAttackBlockCost,
  eligibleTapCreaturesForAttackBlockCost,
} from '../src/state/modules/attackBlockTapCost.js';
import {
  oracleHasGyTopCreatureTextCopy,
  applyGyTopTextCopyOverlay,
} from '../src/state/modules/gyTopTextCopyStatic.js';
import { parseOracleLandTypeSetting } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeSettingOracle.js';

const P = (name: string, oracle: string, type = 'Creature \u2014 Test') => ({
  id: 'src', controller: 'p1', owner: 'p1',
  card: { name, oracle_text: oracle, type_line: type },
}) as any;

describe('batch61 long-tail statics', () => {
  it('Knight of New Alara grants +1/+1 per recipient color to other multicolored creatures', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Knight of New Alara',
      'Each other multicolored creature you control gets +1/+1 for each of its colors.',
      'Creature \u2014 Human Knight',
    ));
    expect(specs.some((s) => (s.condition as any)?.kind === 'target_is_multicolored'
      && s.scope.kind === 'other_creatures_you_control'
      && Number(s.grant?.power) === 1
      && Number(s.grant?.toughness) === 1
      && s.grant?.countBasis === 'host_color_count')).toBe(true);
  });

  it('Cornered Market land line is OTHER; cast line stays castRestrictionTail', () => {
    expect(classifyStaticCensusLine(
      "Players can't play nonbasic lands with the same name as a nontoken permanent.",
      'Cornered Market',
    )?.system).toMatch(/landPlaySameName|same-name nonbasic/i);
    expect(classifyStaticCensusLine(
      "Players can't cast spells with the same name as a nontoken permanent.",
      'Cornered Market',
    )?.system).toMatch(/castRestrictionTail/i);
    const board = [
      { id: 'm', controller: 'p1', card: { name: 'Cornered Market', oracle_text: "Players can't play nonbasic lands with the same name as a nontoken permanent." } },
      { id: 'f', controller: 'p2', isToken: false, card: { name: 'Exotic Orchard', type_line: 'Land' } },
    ];
    expect(landPlaySameNameAsNontokenViolation(board, { name: 'Exotic Orchard', type_line: 'Land' })).toMatch(/Cornered Market/);
    expect(landPlaySameNameAsNontokenViolation(board, { name: 'Forest', type_line: 'Basic Land \u2014 Forest' })).toBeNull();
  });

  it('Illusionary Terrain land-type setting parses with chosenLandTypes', () => {
    expect(classifyStaticCensusLine(
      'Basic lands of the first chosen type are the second chosen type.',
      'Illusionary Terrain',
    )?.system).toMatch(/land type setting|manaAbilityLandTypeSetting/i);
    const mod = parseOracleLandTypeSetting(
      'basic lands of the first chosen type are the second chosen type.',
      { chosenLandTypes: ['Island', 'Mountain'] },
    );
    expect(mod?.fromLandType).toBe('island');
    expect(mod?.landTypes).toEqual(['mountain']);
  });

  it('Altar of the Pantheon increases devotion by one', () => {
    const line = 'Your devotion to each color and each combination of colors is increased by one.';
    expect(oracleDevotionIncreaseAmount(line)).toBe(1);
    expect(classifyStaticCensusLine(line, 'Altar of the Pantheon')?.system).toMatch(/devotion/i);
    const permanents = [
      { controller: 'p1', card: { name: 'Altar of the Pantheon', oracle_text: line, mana_cost: '' } },
      { controller: 'p1', card: { name: 'Bear', oracle_text: '', mana_cost: '{G}' } },
    ];
    expect(countDevotionAmongPermanents(permanents, 'p1', ['G'])).toBe(2);
  });

  it('Escaped Shapeshifter mirrors opponent keywords', () => {
    const oracle = 'As long as an opponent controls a creature with flying not named Escaped Shapeshifter, this creature has flying. The same is true for first strike, trample, and protection from any color.';
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Escaped Shapeshifter',
      oracle,
      'Creature \u2014 Shapeshifter',
    ));
    const abilities = specs.flatMap((s) => s.grant?.abilities || []);
    expect(abilities).toEqual(expect.arrayContaining(['flying', 'first strike', 'trample', 'protection from any color']));
    expect(specs.every((s) => (s.condition as any)?.kind === 'opponent_controls_creature_with_keyword_excluding_name')).toBe(true);
    expect(classifyStaticCensusLine(
      'The same is true for first strike, trample, and protection from any color.',
      'Escaped Shapeshifter',
    )?.system).toMatch(/same-is-true|opponentKeywordMirror/i);
  });

  it('Hollow Warrior requires tap-creature attack/block cost', () => {
    const oracle = "This creature can't attack or block unless you tap an untapped creature you control not declared as an attacking or blocking creature this combat.";
    expect(oracleRequiresTapCreatureAttackBlockCost(oracle)).toBe(true);
    const perm = P('Hollow Warrior', oracle, 'Artifact Creature \u2014 Golem Warrior');
    expect(permanentRequiresTapCreatureAttackBlockCost(perm)).toBe(true);
    const board = [
      perm,
      { id: 'a', controller: 'p1', tapped: false, card: { name: 'Bear', type_line: 'Creature \u2014 Bear' } },
      { id: 'b', controller: 'p1', tapped: true, card: { name: 'Tap', type_line: 'Creature \u2014 Bear' } },
      { id: 'c', controller: 'p1', attacking: 'p2', card: { name: 'Atk', type_line: 'Creature \u2014 Bear' } },
    ];
    expect(eligibleTapCreaturesForAttackBlockCost(board, 'p1', 'src').map((p: any) => p.id)).toEqual(['a']);
    expect(classifyStaticCensusLine(
      "~ can't attack or block unless you tap an untapped creature you control not declared as an attacking or blocking creature this combat.",
      'Hollow Warrior',
    )?.system).toMatch(/attackBlockTapCost|tap-creature/i);
  });

  it("Volrath's Shapeshifter copies top GY creature text", () => {
    const oracle = 'As long as the top card of your graveyard is a creature card, this creature has the full text of that card and has the text "{2}: Discard a card."';
    expect(oracleHasGyTopCreatureTextCopy(oracle)).toBe(true);
    expect(classifyStaticCensusLine(
      'As long as the top card of your graveyard is a creature card, ~ has the full text of that card and has the text "{2}: Discard a card."',
      "Volrath's Shapeshifter",
    )?.system).toMatch(/gyTopTextCopy|graveyard-top/i);
    const state = {
      zones: { p1: { graveyard: [{ name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: 'Just a bear.', power: '2', toughness: '2', mana_cost: '{1}{G}', colors: ['G'] }] } },
    };
    const perm = P("Volrath's Shapeshifter", oracle, 'Creature \u2014 Phyrexian Shapeshifter');
    const overlay = applyGyTopTextCopyOverlay(perm, state);
    expect(overlay.name).toBe('Grizzly Bears');
    expect(overlay.oracle_text).toContain('Just a bear.');
    expect(overlay.oracle_text).toContain('{2}: Discard a card.');
    expect(overlay.power).toBe('2');
  });
});
