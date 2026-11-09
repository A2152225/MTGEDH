import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectStaticEffectSpecsFromState, getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { collectOraclePatternCounterReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecCounterOracleTemplates.js';
import { collectBatch17DamagePreventionRules } from '../src/state/modules/replacementBatch17DamagePrevention.js';
import { permanentHasMustAttackFromTextExtras } from '../../rules-engine/src/attackRequirementTextExtras.js';
import { permanentHasMustAttackRequirement } from '../../rules-engine/src/attackRestrictionText.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { creatureHasHaste } from '../src/socket/game-actions-handlers/gameActionsPermanentKeywordGrants.js';

const P = (name: string, oracle: string, type = 'Creature \u2014 Test') => ({
  id: 'src', controller: 'p1', owner: 'p1',
  card: { name, oracle_text: oracle, type_line: type },
}) as any;

describe('batch58 long-tail statics and replacements', () => {
  it('Spider-Ham Animal May-Ham subtype-list lord parses', () => {
    const ham = P(
      'Spider-Ham, Peter Porker',
      'When Spider-Ham enters, create a Food token.\nAnimal May-Ham \u2014 Other Spiders, Boars, Bats, Bears, Birds, Cats, Dogs, Frogs, Jackals, Lizards, Mice, Otters, Rabbits, Raccoons, Rats, Squirrels, Turtles, and Wolves you control get +1/+1.',
      'Legendary Creature \u2014 Spider Hero',
    );
    const specs = parseStaticEffectSpecsFromOraclePermanent(ham);
    const lords = specs.filter((s) => Number(s.grant?.power || 0) === 1);
    expect(lords.length).toBeGreaterThanOrEqual(5);
    const types = new Set(lords.map((s) => String(s.scope?.creatureType || '').toLowerCase()).filter(Boolean));
    expect(types.has('spider')).toBe(true);
    expect(types.has('boar')).toBe(true);
    expect(types.has('wolf')).toBe(true);
  });

  it('Reckless Cohort must-attack unless another Ally', () => {
    const cohort = {
      id: 'rc', controller: 'p1',
      card: {
        name: 'Reckless Cohort',
        type_line: 'Creature \u2014 Human Warrior Ally',
        oracle_text: 'This creature attacks each combat if able unless you control another Ally.',
      },
    };
    expect(permanentHasMustAttackFromTextExtras(cohort, [cohort])).toBe(true);
    expect(permanentHasMustAttackRequirement(cohort, [cohort])).toBe(true);
    const ally = {
      id: 'al', controller: 'p1',
      card: { name: 'Ally Token', type_line: 'Creature \u2014 Ally', oracle_text: '' },
    };
    expect(permanentHasMustAttackFromTextExtras(cohort, [cohort, ally])).toBe(false);
    expect(permanentHasMustAttackRequirement(cohort, [cohort, ally])).toBe(false);
    expect(classifyStaticCensusLine('This creature attacks each combat if able unless you control another Ally.', 'Reckless Cohort')?.system).toMatch(/attackRequirementTextExtras|Ally/i);
  });

  it('Akawalli Descend permanent-card thresholds', () => {
    const aka = P(
      'Akawalli, the Seething Tower',
      'Descend 4 \u2014 As long as there are four or more permanent cards in your graveyard, Akawalli gets +2/+2 and has trample.\nDescend 8 \u2014 As long as there are eight or more permanent cards in your graveyard, Akawalli gets an additional +2/+2 and can\'t be blocked by more than one creature.',
      'Legendary Creature \u2014 Fungus',
    );
    const specs = parseStaticEffectSpecsFromOraclePermanent(aka);
    const self = specs.filter((s) => s.scope?.kind === 'self');
    expect(self.length).toBeGreaterThanOrEqual(2);
    expect(self.some((s) => Number(s.grant?.power || 0) === 2 && (s.grant?.abilities || []).includes('trample'))).toBe(true);
    expect(self.some((s) => (s.grant?.abilities || []).some((a) => /blocked by more than one/i.test(a)))).toBe(true);
    expect(self.every((s) => {
      const k = String((s.condition as any)?.kind || '');
      return k.includes('graveyard') || (k === 'zone_count' && (s.condition as any)?.zone === 'graveyard');
    })).toBe(true);
  });

  it('Don Andres don\'t-own lord + Pirate type', () => {
    const don = P(
      'Don Andres, the Renegade',
      "Each creature you control but don't own gets +2/+2, has menace and deathtouch, and is a Pirate in addition to its other types.",
      'Legendary Creature \u2014 Vampire Pirate',
    );
    const specs = parseStaticEffectSpecsFromOraclePermanent(don);
    const lord = specs.find((s) => String((s.condition as any)?.kind || '') === 'target_not_owned_by_source_controller');
    expect(lord).toBeTruthy();
    expect(lord?.grant?.power).toBe(2);
    expect(lord?.grant?.abilities || []).toEqual(expect.arrayContaining(['menace', 'deathtouch']));
    expect(lord?.grant?.typeAdditions || []).toEqual(expect.arrayContaining(['Pirate']));
  });

  it('Tam grants hexproof from each of a creature\'s colors', () => {
    const tam = P(
      'Tam, Mindful First-Year',
      'Each other creature you control has hexproof from each of its colors.\n{T}: Target creature you control becomes all colors until end of turn.',
      'Legendary Creature \u2014 Human Wizard',
    );
    const ally = {
      id: 'ally', controller: 'p1', owner: 'p1',
      card: {
        name: 'Blue Bear', type_line: 'Creature \u2014 Bear', oracle_text: '',
        colors: ['U'],
      },
      colors: ['U'],
    };
    const state: any = { battlefield: [tam, ally], players: [{ id: 'p1' }, { id: 'p2' }] };
    collectStaticEffectSpecsFromState(state);
    const abilities = getContinuousGrantedAbilitiesForPermanent(ally, state);
    expect(abilities.some((a) => /hexproof from blue/i.test(a))).toBe(true);
  });

  it('Loading Zone doubles counters on your creatures', () => {
    const zone = {
      id: 'lz', controller: 'p1',
      card: {
        name: 'Loading Zone',
        type_line: 'Enchantment',
        oracle_text: 'If one or more counters would be put on a creature, Spacecraft, or Planet you control, twice that many of each of those kinds of counters are put on it instead.\nWarp {G}',
      },
    };
    const specs = collectOraclePatternCounterReplacementSpecsFromState({ battlefield: [zone] });
    expect(specs.some((s) => String(s.effectId || '').includes('loading-zone'))).toBe(true);
  });

  it('Immortal Coil Batch17 prevent + exile GY', () => {
    const coil = {
      id: 'ic', controller: 'p1',
      card: {
        name: 'Immortal Coil',
        type_line: 'Artifact',
        oracle_text: '{T}, Exile two cards from your graveyard: Draw a card.\nIf damage would be dealt to you, prevent that damage. Exile a card from your graveyard for each 1 damage prevented this way.\nWhen there are no cards in your graveyard, you lose the game.',
      },
    };
    const rules = collectBatch17DamagePreventionRules({ battlefield: [coil] });
    expect(rules.some((r) => r.kind === 'player-prevent-exile-gy')).toBe(true);
  });

  it('Eluge first-spell cost reduction classified as cost modification', () => {
    const line = 'The first instant or sorcery spell you cast each turn costs {U} (or {1}) less to cast for each land you control with a flood counter on it.';
    const cls = classifyStaticCensusLine(line, 'Eluge, the Shoreless Sea');
    expect(cls?.system).toMatch(/cost modification/i);
  });

  it('Chaos Lord as-though haste when not entered this turn', () => {
    const lord = {
      id: 'cl', controller: 'p1', enteredThisTurn: false, summoningSickness: true,
      card: {
        name: 'Chaos Lord',
        type_line: 'Creature \u2014 Human',
        oracle_text: 'First strike\nThis creature can attack as though it had haste unless it entered this turn.',
      },
    };
    expect(creatureHasHaste(lord, [lord], 'p1')).toBe(true);
    lord.enteredThisTurn = true;
    expect(creatureHasHaste(lord, [lord], 'p1')).toBe(false);
  });
});
