import { describe, expect, it } from 'vitest';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { parseBatch63DamagePreventionSentence } from '../src/state/modules/replacementBatch63DamageReplacements.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { parseCopyEntryExceptions } from '../src/state/modules/copyEntryExceptions.js';
import { getGrantedCascadeCountForCast } from '../src/state/modules/cascadeCastGrants.js';
import { countPowerOnlyPhrase } from '../src/state/utils-handlers/variablePowerOnlyCalculator.js';
import { oracleHasGyLoseAllAbilities } from '../src/state/modules/gyLoseAllAbilitiesStatic.js';
import { batch19DrawSources } from '../src/state/modules/replacementBatch19DrawInstead.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type },
}) as any;

function specsFor(oracle: string, name = 'Test', type = 'Creature') {
  return collectReplacementEffectSpecsFromState({ battlefield: [P(name, oracle, type)] });
}

describe('batch63 replacements and statics', () => {
  it('Thunderstaff prevent N creature combat damage while untapped', () => {
    const line = 'As long as this artifact is untapped, if a creature would deal combat damage to you, prevent 1 of that damage.';
    const parsed = parseBatch63DamagePreventionSentence(line.toLowerCase().replace(/this artifact/g, '~').replace(/\.$/, ''));
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].instead).toMatchObject({ modify: 'add_flat', value: -1 });
    const specs = specsFor(line, 'Thunderstaff', 'Artifact');
    expect(specs.some((s) => s.event === 'damage' && s.instead?.modify === 'add_flat')).toBe(true);
    expect(classifyStaticCensusLine(line, 'Thunderstaff')?.system).toMatch(/prevent N creature combat|replacementBatch63/i);
  });

  it('Weeping Angel prevent combat damage and shuffle', () => {
    const line = 'If this creature would deal combat damage to a creature, prevent that damage and that creature\'s owner shuffles it into their library.';
    const specs = specsFor(line, 'Weeping Angel', 'Artifact Creature \u2014 Alien Angel');
    expect(specs.some((s) => String(s.effectId || '').includes('shuffle') || (s.metadata as any)?.shuffleDamagedCreatureIntoOwnerLibrary)).toBe(true);
    expect(classifyStaticCensusLine(line, 'Weeping Angel')?.system).toMatch(/shuffle|replacementBatch63/i);
  });

  it('Donatello mutagen token replacement', () => {
    const line = 'If one or more tokens would be created under your control, those tokens plus a Mutagen token are created instead.';
    const specs = specsFor(line, 'Donatello, the Brains');
    expect(specs.some((s) => s.event === 'token-creation' && String(s.effectId || '').includes('mutagen'))).toBe(true);
    expect(classifyStaticCensusLine(line, 'Donatello')?.system).toMatch(/mutagen/i);
  });

  it('Asmodeus draw exile face down', () => {
    const line = 'If you would draw a card, exile the top card of your library face down instead.';
    const specs = specsFor(line, 'Asmodeus the Archfiend');
    expect(specs.some((s) => s.event === 'card-draw' && (s.metadata as any)?.exileLibraryTopFaceDown)).toBe(true);
    const sources = batch19DrawSources({ battlefield: [P('Asmodeus the Archfiend', line)] });
    expect(sources.some((s) => s.kind === 'exile_face_down')).toBe(true);
    expect(classifyStaticCensusLine(line, 'Asmodeus')?.system).toMatch(/face down|DrawInstead/i);
  });

  it('Chameleon keep printed name copy exception', () => {
    const line = 'You may have Chameleon enter as a copy of a creature you control, except his name is Chameleon, Master of Disguise.';
    const ex = parseCopyEntryExceptions(line);
    expect(ex?.keepPrintedName).toMatch(/Chameleon/);
    expect(classifyStaticCensusLine(line, 'Chameleon, Master of Disguise')?.system).toMatch(/copy|except name/i);
  });

  it('Flamekin Herald grants cascade to commander spells', () => {
    const state = {
      battlefield: [P('Flamekin Herald', 'Commander spells you cast have cascade.')],
    };
    expect(getGrantedCascadeCountForCast(state, 'p1', { isCommander: true }, { isCommander: true })).toBe(1);
    expect(getGrantedCascadeCountForCast(state, 'p1', { isCommander: false }, {})).toBe(0);
    expect(classifyStaticCensusLine('Commander spells you cast have cascade.', 'Flamekin Herald')?.system).toMatch(/cascade/i);
  });

  it('Triarch / Grand Master / Yixlid / Uchuulon / Octomancer / ED-E', () => {
    const triarch = parseStaticEffectSpecsFromOraclePermanent(P(
      'Triarch Stalker',
      'Creatures attacking the last chosen player have menace.',
      'Artifact Creature \u2014 Necron',
    ));
    expect(triarch.some((s) => (s.condition as any)?.kind === 'target_is_attacking_last_chosen_player_on_source')).toBe(true);

    const gm = parseStaticEffectSpecsFromOraclePermanent(P(
      'Grand Master of Flowers',
      'As long as Grand Master of Flowers has seven or more loyalty counters on him, he\'s a 7/7 Dragon God creature with flying and indestructible.',
      'Legendary Planeswalker \u2014 Bahamut',
    ));
    expect(gm.some((s) => (s.condition as any)?.kind === 'source_counter_at_least'
      && (s.condition as any)?.counterType === 'loyalty'
      && s.grant.setPower === 7)).toBe(true);

    expect(oracleHasGyLoseAllAbilities('Cards in graveyards lose all abilities.')).toBe(true);
    const yix = parseStaticEffectSpecsFromOraclePermanent(P('Yixlid Jailer', 'Cards in graveyards lose all abilities.'));
    expect(yix.some((s) => String(s.id).includes('gy-lose-all-abilities'))).toBe(true);

    const board = [
      { controller: 'p1', card: { type_line: 'Creature \u2014 Crab' } },
      { controller: 'p1', card: { type_line: 'Creature \u2014 Horror' } },
      { controller: 'p1', card: { type_line: 'Creature \u2014 Elf' } },
    ];
    expect(countPowerOnlyPhrase('crabs, oozes, and/or horrors you control', board, {}, 'p1')).toBe(2);

    expect(classifyStaticCensusLine('Gift an Octopus (You may promise an opponent a gift as you cast this spell.', 'Octomancer')?.system).toMatch(/gift/i);
    expect(classifyStaticCensusLine(
      'ED-E My Love \u2014 Whenever you attack, if the number of attacking creatures is greater than the number of quest counters on ED-E, put a quest counter on it.',
      'ED-E, Lonesome Eyebot',
    )?.system).toMatch(/trigger|quest/i);
  });
});
