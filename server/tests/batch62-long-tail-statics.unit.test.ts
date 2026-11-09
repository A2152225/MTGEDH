import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { evalCountersPutThisTurnCondition } from '../src/state/modules/countersPutThisTurnCondition.js';
import { getGrantedEquipmentEquipCost, oracleGrantsEquipmentEquipCost } from '../src/state/modules/equipmentEquipCostGrants.js';
import { resolveSetBasePtGrantValues } from '../src/state/modules/setBasePtGrantValues.js';
import { specMatchesStaticCondition } from '../src/state/modules/staticEffectSpecConditionEval.js';

const P = (name: string, oracle: string, type = 'Creature \u2014 Test', extra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1',
  ...extra,
  card: { name, oracle_text: oracle, type_line: type },
}) as any;

describe('batch62 long-tail statics', () => {
  it('Beast gains flying after +1/+1 counters put this turn', () => {
    const oracle = "As long as you've put one or more +1/+1 counters on Beast this turn, he has flying.";
    const specs = parseStaticEffectSpecsFromOraclePermanent(P('Beast, Erudite Aerialist', oracle, 'Legendary Creature \u2014 Mutant'));
    expect(specs.some((s) => (s.condition as any)?.kind === 'target_had_counters_put_this_turn'
      && (s.grant.abilities || []).includes('flying'))).toBe(true);
    expect(classifyStaticCensusLine(oracle, 'Beast, Erudite Aerialist')?.system).toMatch(/counters put this turn/i);
    expect(evalCountersPutThisTurnCondition(
      { counterType: '+1/+1', amount: 1 },
      { id: 'beast' },
      { plusOneCountersPutThisTurnByPermanentId: { beast: 1 } },
    )).toBe(true);
  });

  it('Kid Loki grants hexproof to creatures with counters put this turn', () => {
    const oracle = "Each creature you control that you've put one or more +1/+1 counters on this turn has hexproof.";
    const specs = parseStaticEffectSpecsFromOraclePermanent(P('Kid Loki', oracle, 'Legendary Creature \u2014 God'));
    const hit = specs.find((s) => s.scope.kind === 'creatures_you_control'
      && (s.condition as any)?.kind === 'target_had_counters_put_this_turn');
    expect(hit?.grant.abilities).toEqual(expect.arrayContaining(['hexproof']));
    expect(classifyStaticCensusLine(oracle, 'Kid Loki')?.system).toMatch(/counters put this turn/i);
  });

  it('Astor grants Equipment equip {1} (skips Puresteel metalcraft line)', () => {
    expect(oracleGrantsEquipmentEquipCost('Equipment you control have equip {1}.')).toBe('{1}');
    expect(oracleGrantsEquipmentEquipCost('Metalcraft \u2014 Equipment you control have equip {0}.')).toBeNull();
    const state = {
      battlefield: [
        P('Astor, Bearer of Blades', 'Equipment you control have equip {1}.\nVehicles you control have crew 1.'),
        { id: 'eq', controller: 'p1', card: { name: 'Sword', type_line: 'Artifact \u2014 Equipment', oracle_text: 'Equip {3}' } },
      ],
    };
    expect(getGrantedEquipmentEquipCost(state, 'p1')).toBe('{1}');
    expect(classifyStaticCensusLine('Equipment you control have equip {1}.', 'Astor')?.system).toMatch(/equip cost|equipmentEquipCost/i);
    expect(classifyStaticCensusLine('Vehicles you control have crew 1.', 'Astor')?.system).toMatch(/crew/i);
  });

  it('Aettir sets equipped base P/T from controller life', () => {
    const oracle = 'Equipped creature has base power and toughness X/X, where X is your life total.\nEquip {5}';
    const equip = P('Aettir and Priwen', oracle, 'Legendary Artifact \u2014 Equipment', { attachedTo: 'host1' });
    const specs = parseStaticEffectSpecsFromOraclePermanent(equip);
    const hit = specs.find((s) => (s.grant as any).setPowerFromControllerLife && (s.grant as any).setToughnessFromControllerLife);
    expect(hit?.sourcePermanentId).toBe('host1');
    expect(resolveSetBasePtGrantValues(hit!.grant as any, { life: { p1: 37 } }, 'p1')).toEqual({ power: 37, toughness: 37 });
    expect(classifyStaticCensusLine(
      'Equipped creature has base power and toughness X/X, where X is your life total.',
      'Aettir and Priwen',
    )?.system).toMatch(/base P\/T equal life|life total/i);
  });

  it('Archangel of Strife war/peace anthems key off playerModeChoices', () => {
    const oracle = 'Flying\nAs this creature enters, each player chooses war or peace.\nCreatures controlled by players who chose war get +3/+0.\nCreatures controlled by players who chose peace get +0/+3.';
    const specs = parseStaticEffectSpecsFromOraclePermanent(P('Archangel of Strife', oracle, 'Creature \u2014 Angel'));
    const war = specs.find((s) => (s.condition as any)?.kind === 'target_controller_chose_option_on_source' && (s.condition as any)?.option === 'war');
    const peace = specs.find((s) => (s.condition as any)?.kind === 'target_controller_chose_option_on_source' && (s.condition as any)?.option === 'peace');
    expect(war?.grant).toMatchObject({ power: 3, toughness: 0 });
    expect(peace?.grant).toMatchObject({ power: 0, toughness: 3 });
    const source = { playerModeChoices: { p1: 'war', p2: 'peace' } };
    expect(specMatchesStaticCondition(
      { id: 'c1', controller: 'p1', card: { type_line: 'Creature' } } as any,
      { ...war!, sourcePermanentId: 'src', sourceController: 'p1' } as any,
      { battlefield: [{ id: 'src', controller: 'p1', playerModeChoices: source.playerModeChoices, card: { name: 'Archangel of Strife' } }] } as any,
    )).toBe(true);
    expect(classifyStaticCensusLine('Creatures controlled by players who chose war get +3/+0.', 'Archangel of Strife')?.system).toMatch(/war|peace/i);
  });

  it('Brenard pumps Food or Golem creatures without double-dip', () => {
    const oracle = "Each creature you control that's a Food or a Golem gets +2/+2 and has trample.";
    const specs = parseStaticEffectSpecsFromOraclePermanent(P('Brenard, Ginger Sculptor', oracle));
    const hit = specs.find((s) => (s.condition as any)?.kind === 'target_has_any_subtype');
    expect(hit?.grant).toMatchObject({ power: 2, toughness: 2 });
    expect(hit?.grant.abilities).toEqual(expect.arrayContaining(['trample']));
    expect((hit?.condition as any).subtypes).toEqual(expect.arrayContaining(['food', 'golem']));
    expect(classifyStaticCensusLine(oracle, 'Brenard')?.system).toMatch(/food or golem/i);
  });

  it('Viridian / Miriam / Encroaching / Earth Rumble classify and parse', () => {
    const viridian = 'This creature has infect as long as an opponent is poisoned.';
    const vSpecs = parseStaticEffectSpecsFromOraclePermanent(P('Viridian Betrayers', viridian));
    expect(vSpecs.some((s) => (s.condition as any)?.kind === 'opponent_poison_at_least' && (s.grant.abilities || []).includes('infect'))).toBe(true);

    const miriam = 'During your turn, Mounts and Vehicles you control have hexproof.';
    const mSpecs = parseStaticEffectSpecsFromOraclePermanent(P('Miriam, Herd Whisperer', miriam));
    expect(mSpecs.some((s) => (s.condition as any)?.kind === 'during_source_controller_turn'
      && (s.conditions || []).some((c: any) => c.kind === 'target_has_any_subtype'))).toBe(true);

    const enc = 'Nonland permanents you control are artifacts in addition to their other types.';
    const eSpecs = parseStaticEffectSpecsFromOraclePermanent(P('Encroaching Mycosynth', enc, 'Artifact'));
    expect(eSpecs.some((s) => (s.grant.typeAdditions || []).includes('Artifact')
      && (s.condition as any)?.kind === 'target_lacks_type')).toBe(true);

    const rumble = 'This creature gets +1/+0 and has trample as long as you control a land creature or a land entered the battlefield under your control this turn.';
    const rSpecs = parseStaticEffectSpecsFromOraclePermanent(P('Earth Rumble Wrestlers', rumble));
    expect(rSpecs.some((s) => (s.condition as any)?.kind === 'controller_land_creature_or_land_entered_this_turn'
      && Number(s.grant.power) === 1 && (s.grant.abilities || []).includes('trample'))).toBe(true);

    expect(classifyStaticCensusLine(viridian, 'Viridian Betrayers')?.system).toMatch(/poisoned|infect/i);
    expect(classifyStaticCensusLine(miriam, 'Miriam')?.system).toMatch(/mounts and vehicles/i);
    expect(classifyStaticCensusLine(enc, 'Encroaching Mycosynth')?.system).toMatch(/nonland permanents/i);
    expect(classifyStaticCensusLine(rumble, 'Earth Rumble Wrestlers')?.system).toMatch(/land creature or land entered/i);
  });
});
