import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { castRestrictionTailViolation } from '../src/state/modules/castRestrictionTailFamilies.js';
import { getGrantedCascadeCountForCast } from '../src/state/modules/cascadeCastGrants.js';
import { collectBatch65DamageReplacementSpecs } from '../src/state/modules/replacementBatch65DamageReplacements.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch87 statics', () => {
  it('Gruul + Paladin + Coppercoat + Blacksmith + Divine threshold', () => {
    const gruul = P('Gruul Spellbreaker', 'During your turn, you and this creature have hexproof.');
    const gSpecs = parseStaticEffectSpecsFromOraclePermanent(gruul);
    expect(gSpecs.some((s) => s.scope.kind === 'self' && (s.grant.abilities || []).includes('hexproof'))).toBe(true);
    expect(gSpecs.some((s) => s.scope.kind === 'player_you')).toBe(true);

    const paladin = P('Inspiring Paladin', 'During your turn, creatures you control with +1/+1 counters on them have first strike.');
    expect(parseStaticEffectSpecsFromOraclePermanent(paladin).some(
      (s) => Array.isArray(s.conditions) && (s.grant.abilities || []).includes('first strike'),
    )).toBe(true);

    const copper = P('Coppercoat Vanguard', 'Each other Human you control gets +1/+0 and has ward {1}.');
    const human = {
      id: 'h', controller: 'p1',
      card: { name: 'Human', type_line: 'Creature — Human', power: '1', toughness: '1' },
    };
    const cState: any = { battlefield: [copper, human], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(cState);
    expect(getCurrentPowerToughness(human as any, cState)?.power).toBe(2);
    expect(getContinuousGrantedAbilitiesForPermanent(human as any, cState).some((a) => /^ward/i.test(a))).toBe(true);

    const talent = P("Blacksmith's Talent", 'During your turn, equipped creatures you control have double strike and haste.', 'Enchantment');
    expect(parseStaticEffectSpecsFromOraclePermanent(talent).some(
      (s) => Array.isArray(s.conditions) && (s.grant.abilities || []).includes('double strike'),
    )).toBe(true);

    const divine = P(
      'Divine Sacrament',
      'White creatures get +1/+1.\nThreshold — White creatures get an additional +1/+1 as long as there are seven or more cards in your graveyard.',
      'Enchantment',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(divine).some(
      (s) => Array.isArray(s.conditions) && s.conditions.some((c) => c.kind === 'source_controller_has_threshold'),
    )).toBe(true);
  });

  it('combat locks + Ratonh + Doctor + Gimli + Hundred-Battle + Haktos + Futurist', () => {
    const goblin = P('Bloodcrazed Goblin', "This creature can't attack unless an opponent has been dealt damage this turn.");
    expect(parseStaticEffectSpecsFromOraclePermanent(goblin).some(
      (s) => s.conditionNegated && s.condition?.kind === 'opponent_dealt_damage_this_turn',
    )).toBe(true);

    const knot = P('Flowering Lumberknot', "This creature can't attack or block unless it's paired with a creature with soulbond.");
    expect(parseStaticEffectSpecsFromOraclePermanent(knot).some(
      (s) => s.conditionNegated && s.condition?.kind === 'target_is_paired_with_soulbond',
    )).toBe(true);

    const raton = P(
      'Ratonhnhaké꞉ton',
      "As long as Ratonhnhaké꞉ton hasn't dealt damage yet, it has hexproof and can't be blocked.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(raton).some(
      (s) => s.condition?.kind === 'target_has_not_dealt_damage' && (s.grant.abilities || []).includes('hexproof'),
    )).toBe(true);

    const doom = P('Doctor Doom', 'As long as you control an artifact creature or a Plan, Doctor Doom has indestructible.');
    expect(parseStaticEffectSpecsFromOraclePermanent(doom).some(
      (s) => s.condition?.kind === 'source_controller_controls_artifact_creature_or_subtype',
    )).toBe(true);

    const gimli = P('Gimli, Mournful Avenger', 'Gimli has indestructible as long as two or more creatures died under your control this turn.');
    expect(parseStaticEffectSpecsFromOraclePermanent(gimli).some(
      (s) => s.condition?.kind === 'source_controller_creatures_died_this_turn_at_least',
    )).toBe(true);

    const veteran = P(
      'Hundred-Battle Veteran',
      'As long as there are three or more different kinds of counters among creatures you control, this creature gets +2/+4.',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(veteran).some(
      (s) => s.condition?.kind === 'controller_creatures_distinct_counter_kinds_at_least',
    )).toBe(true);

    const haktos = P(
      'Haktos the Unscarred',
      'Haktos has protection from each mana value other than the chosen number.',
      'Creature',
      { chosenNumber: 3 },
    );
    const hSpecs = parseStaticEffectSpecsFromOraclePermanent(haktos);
    expect(hSpecs.some((s) => (s.grant.abilities || []).includes('protection from mana value 2'))).toBe(true);
    expect(hSpecs.some((s) => (s.grant.abilities || []).includes('protection from mana value 3'))).toBe(false);

    const futurist = P(
      'Futurist Operative',
      "As long as this creature is tapped, it's a Human Citizen with base power and toughness 1/1 and can't be blocked.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(futurist).some(
      (s) => s.condition?.kind === 'target_is_tapped' && s.grant.setPower === 1,
    )).toBe(true);
  });

  it('countedPT + cascade + damage + cast locks + Artifact Ward', () => {
    const upriser = P('Upriser Renegade', 'This creature gets +2/+0 for each other modified creature you control.');
    const other = {
      id: 'o', controller: 'p1', counters: { '+1/+1': 1 },
      card: { name: 'Mod', type_line: 'Creature — Human', power: '1', toughness: '1' },
    };
    const uState: any = { battlefield: [upriser, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(uState);
    expect(getCurrentPowerToughness(upriser, uState)?.power).toBe(4);

    const frog = P('Rampant Frogantua', 'This creature gets +10/+10 for each player who has lost the game.');
    const fState: any = {
      battlefield: [frog],
      players: [{ id: 'p1' }, { id: 'p2', hasLost: true }, { id: 'p3', hasLost: true }],
    };
    syncDerivedContinuousEffects(fState);
    expect(getCurrentPowerToughness(frog, fState)?.power).toBe(22);

    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const bracers = P(
      'Opaline Bracers',
      'Equipped creature gets +X/+X, where X is the number of charge counters on this Equipment.',
      'Artifact — Equipment',
      { attachedTo: 'h', counters: { charge: 3 } },
    );
    const bState: any = { battlefield: [bracers, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(bState);
    expect(getCurrentPowerToughness(host as any, bState)?.power).toBe(5);

    const axe = P(
      'Bearded Axe',
      'Equipped creature gets +1/+1 for each Dwarf, Equipment, and/or Vehicle you control.',
      'Artifact — Equipment',
      { attachedTo: 'h' },
    );
    const dwarf = {
      id: 'd', controller: 'p1',
      card: { name: 'Dwarf', type_line: 'Creature — Dwarf', power: '1', toughness: '1' },
    };
    const aState: any = { battlefield: [axe, host, dwarf], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(aState);
    // axe (Equipment) + dwarf = 2 → base 2 + 2
    expect(getCurrentPowerToughness(host as any, aState)?.power).toBe(4);

    const wildsear = P('Wildsear, Scouring Maw', 'Enchantment spells you cast from your hand have cascade.');
    expect(getGrantedCascadeCountForCast(
      { battlefield: [wildsear] }, 'p1', { type_line: 'Enchantment — Aura' }, { castSourceZone: 'hand' },
    )).toBe(1);

    const absorbing = collectBatch65DamageReplacementSpecs(
      'Double all damage that creature sources you control would deal.',
      { sourcePermanentId: 'a', sourceController: 'p1', sourceName: 'Absorbing Man and Titania' },
    );
    expect(absorbing.some((s) => s.match?.damageSourceIsCreature === true)).toBe(true);

    const proft = {
      name: 'Proft, Sinister Mastermind',
      type_line: 'Creature',
      oracle_text: "Threshold — You can't cast this spell unless there are seven or more cards in your graveyard.",
      mana_cost: '{1}{U}',
      cmc: 2,
    };
    expect(castRestrictionTailViolation(
      { battlefield: [], players: [{ id: 'p1' }], zones: { p1: { graveyard: [] } }, turnPlayer: 'p1' },
      'p1', proft, 'hand',
    )).toBeTruthy();
    expect(castRestrictionTailViolation(
      { battlefield: [], players: [{ id: 'p1' }], zones: { p1: { graveyard: new Array(7).fill({ type_line: 'Instant' }) } }, turnPlayer: 'p1' },
      'p1', proft, 'hand',
    )).toBeNull();

    const ward = P(
      'Artifact Ward',
      "Enchanted creature can't be the target of abilities from artifact sources.",
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(ward).some(
      (s) => String(s.sourcePermanentId) === 'h',
    )).toBe(true);
  });

  it('classifiers cover B87 families', () => {
    const lines: Array<[string, string]> = [
      ['During your turn, you and this creature have hexproof.', 'Gruul Spellbreaker'],
      ['During your turn, creatures you control with +1/+1 counters on them have first strike.', 'Inspiring Paladin'],
      ['Each other Human you control gets +1/+0 and has ward {1}.', 'Coppercoat Vanguard'],
      ['During your turn, equipped creatures you control have double strike and haste.', "Blacksmith's Talent"],
      ['White creatures get an additional +1/+1 as long as there are seven or more cards in your graveyard.', 'Divine Sacrament'],
      ["Enchanted creature can't be the target of abilities from artifact sources.", 'Artifact Ward'],
      ['As long as you control an artifact creature or a Plan, Doctor Doom has indestructible.', 'Doctor Doom'],
      ['As long as there are three or more different kinds of counters among creatures you control, this creature gets +2/+4.', 'Hundred-Battle Veteran'],
      ['Gimli has indestructible as long as two or more creatures died under your control this turn.', 'Gimli, Mournful Avenger'],
      ['Haktos has protection from each mana value other than the chosen number.', 'Haktos the Unscarred'],
      ['All Walls able to block this creature do so.', 'Marble Priest'],
      ["As long as this creature is tapped, it's a Human Citizen with base power and toughness 1/1 and can't be blocked.", 'Futurist Operative'],
      ["This creature can't attack unless an opponent has been dealt damage this turn.", 'Bloodcrazed Goblin'],
      ["This creature can't attack or block unless it's paired with a creature with soulbond.", 'Flowering Lumberknot'],
      ["As long as Ratonhnhaké꞉ton hasn't dealt damage yet, it has hexproof and can't be blocked.", 'Ratonhnhaké꞉ton'],
      ['Enchantment spells you cast from your hand have cascade.', 'Wildsear, Scouring Maw'],
      ['Double all damage that creature sources you control would deal.', 'Absorbing Man and Titania'],
      ['This creature gets +2/+0 for each other modified creature you control.', 'Upriser Renegade'],
      ['This creature gets +10/+10 for each player who has lost the game.', 'Rampant Frogantua'],
      ['Equipped creature gets +1/+1 for each Dwarf, Equipment, and/or Vehicle you control.', 'Bearded Axe'],
      ['Equipped creature gets +X/+X, where X is the number of charge counters on this Equipment.', 'Opaline Bracers'],
      ["You can't cast this spell unless there are seven or more cards in your graveyard.", 'Proft, Sinister Mastermind'],
      ["You can't spend mana to cast this spell.", 'Hogaak, Arisen Necropolis'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
