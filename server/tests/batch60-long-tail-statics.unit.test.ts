import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { oracleGrantsGraveyardEncore, getGrantedEncoreCost, cardHasPrintedEncore } from '../src/state/modules/graveyardEncoreGrants.js';
import { oracleGrantsHandCycling, getGrantedCyclingCost, cardHasPrintedCycling } from '../src/state/modules/handCyclingGrants.js';
import { permanentRejectsWallOnlyTargets, sourceCanTargetOnlyWalls } from '../src/rules-engine/wallOnlyTargetRestriction.js';
import { oracleHasOffBattlefieldCreatureCda, applyOffBattlefieldCdaOverlay } from '../src/state/modules/offBattlefieldCda.js';

const P = (name: string, oracle: string, type = 'Creature \u2014 Test') => ({
  id: 'src', controller: 'p1', owner: 'p1',
  card: { name, oracle_text: oracle, type_line: type },
}) as any;

describe('batch60 long-tail statics', () => {
  it('Sliver Gravemother grants encore {X}=CMC to Sliver creature cards in GY', () => {
    const grant = 'Each Sliver creature card in your graveyard has encore {X}, where X is its mana value.';
    expect(oracleGrantsGraveyardEncore(grant)?.creatureType).toBe('Sliver');
    const state: any = { battlefield: [{ id: 'g', controller: 'p1', card: { name: 'Sliver Gravemother', oracle_text: grant } }] };
    const sliver = { name: 'Muscle Sliver', type_line: 'Creature \u2014 Sliver', cmc: 2, mana_cost: '{1}{G}' };
    expect(getGrantedEncoreCost(state, 'p1', sliver)).toBe('{2}');
    expect(getGrantedEncoreCost(state, 'p1', { name: 'Bear', type_line: 'Creature \u2014 Bear', cmc: 2 })).toBeUndefined();
    expect(cardHasPrintedEncore({ oracle_text: 'Encore {5}' })).toBe(true);
  });

  it('Tectonic Reformation grants cycling {R} to land cards in hand', () => {
    const grant = 'Each land card in your hand has cycling {R}.\nCycling {2}';
    expect(oracleGrantsHandCycling(grant)?.cost).toBe('{R}');
    const state: any = { battlefield: [{ id: 't', controller: 'p1', card: { name: 'Tectonic Reformation', oracle_text: grant } }] };
    expect(getGrantedCyclingCost(state, 'p1', { name: 'Mountain', type_line: 'Basic Land \u2014 Mountain' })).toBe('{R}');
    expect(getGrantedCyclingCost(state, 'p1', { name: 'Shock', type_line: 'Instant', mana_cost: '{R}' })).toBeNull();
    expect(cardHasPrintedCycling({ oracle_text: 'Cycling {2}' })).toBe(true);
  });

  it('Wall of Shadows rejects wall-only targeting sources', () => {
    const wall = { card: { name: 'Wall of Shadows', oracle_text: "Defender\nThis creature can't be the target of spells that can target only Walls or of abilities that can target only Walls." } };
    expect(permanentRejectsWallOnlyTargets(wall)).toBe(true);
    expect(sourceCanTargetOnlyWalls({ oracle_text: 'Destroy target Wall.' })).toBe(true);
    expect(sourceCanTargetOnlyWalls({ oracle_text: 'Destroy target creature.' })).toBe(false);
    expect(sourceCanTargetOnlyWalls({ oracle_text: 'Destroy target Wall or target creature.' })).toBe(false);
  });

  it('Grist off-battlefield CDA overlays Insect creature types', () => {
    const oracle = "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.";
    expect(oracleHasOffBattlefieldCreatureCda(oracle)?.creatureType).toBe('Insect');
    const card = { name: 'Grist, the Hunger Tide', type_line: 'Legendary Planeswalker \u2014 Grist', oracle_text: oracle };
    const overlay = applyOffBattlefieldCdaOverlay(card, 'command');
    expect(/\bcreature\b/i.test(overlay.type_line)).toBe(true);
    expect(/\binsect\b/i.test(overlay.type_line)).toBe(true);
    expect(overlay.power).toBe('1');
    expect(applyOffBattlefieldCdaOverlay(card, 'battlefield')).toBe(card);
  });

  it('Essence Channeler / Gloom Stalker / Swordsworn use new conditions', () => {
    const essence = parseStaticEffectSpecsFromOraclePermanent(P(
      'Essence Channeler',
      "As long as you've lost life this turn, this creature has flying and vigilance.",
      'Creature \u2014 Bat Cleric',
    ));
    expect(essence.some((s) => (s.condition as any)?.kind === 'controller_lost_life_this_turn'
      && (s.grant?.abilities || []).includes('flying'))).toBe(true);

    const gloom = parseStaticEffectSpecsFromOraclePermanent(P(
      'Gloom Stalker',
      "As long as you've completed a dungeon, this creature has double strike.",
      'Creature \u2014 Dwarf Ranger',
    ));
    expect(gloom.some((s) => (s.condition as any)?.kind === 'controller_completed_dungeon'
      && (s.grant?.abilities || []).includes('double strike'))).toBe(true);

    const cavalier = parseStaticEffectSpecsFromOraclePermanent(P(
      'Swordsworn Cavalier',
      'This creature has first strike as long as another Knight entered the battlefield under your control this turn.',
      'Creature \u2014 Human Knight',
    ));
    expect(cavalier.some((s) => (s.condition as any)?.kind === 'controller_creature_type_entered_this_turn'
      && String((s.condition as any)?.creatureType || '').toLowerCase() === 'knight'
      && (s.grant?.abilities || []).includes('first strike'))).toBe(true);
  });

  it('Rushblade Commander grants haste to Warriors via team→you control', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Rushblade Commander',
      'Warriors your team controls have haste.',
      'Creature \u2014 Azra Warrior',
    ));
    expect(specs.some((s) => {
      const type = String((s.scope as any)?.creatureType || '').toLowerCase();
      return type === 'warrior' && (s.grant?.abilities || []).includes('haste');
    })).toBe(true);
  });

  it('Archon of the Wild Rose sets base P/T on Aura-enchanted creatures', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(P(
      'Archon of the Wild Rose',
      'Flying\nOther creatures you control that are enchanted by Auras you control have base power and toughness 4/4 and have flying.',
      'Creature \u2014 Archon',
    ));
    expect(specs.some((s) => Number(s.grant?.setPower) === 4
      && Number(s.grant?.setToughness) === 4
      && (s.condition as any)?.kind === 'target_enchanted_by_aura_you_control'
      && (s.grant?.abilities || []).includes('flying'))).toBe(true);
  });

  it('classifies B60 OTHER families', () => {
    expect(classifyStaticCensusLine(
      'Each Sliver creature card in your graveyard has encore {X}, where X is its mana value.',
      'Sliver Gravemother',
    )?.system).toMatch(/encore/i);
    expect(classifyStaticCensusLine(
      'Each land card in your hand has cycling {R}.',
      'Tectonic Reformation',
    )?.system).toMatch(/cycling/i);
    expect(classifyStaticCensusLine(
      "~ can't be the target of spells that can target only Walls or of abilities that can target only Walls.",
      'Wall of Shadows',
    )?.system).toMatch(/wall-only|wallOnly/i);
    expect(classifyStaticCensusLine(
      "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.",
      'Grist, the Hunger Tide',
    )?.system).toMatch(/off-battlefield|offBattlefield|CDA/i);
    expect(classifyStaticCensusLine(
      'This creature has echo {X}, where X is your life total.',
      'Volcano Hellion',
    )?.system).toMatch(/echo/i);
  });
});
