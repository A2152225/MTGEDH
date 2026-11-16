import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { evaluateTokenCreationReplacementEvent } from '../src/state/modules/replacement-effects.js';
import { getManaMultiplier } from '../src/state/modules/mana-abilities.js';
import { tryCalculateManaProductionBonusesAndTotal } from '../src/socket/util-handlers/tryCalculateManaProductionBonusesAndTotal.js';
import { parseBatch90ManaProductionSentence } from '../src/state/modules/replacementBatch90ManaProductionReplacements.js';
import { parseBatch90ExtraDifferentTypeTokenSentence, parseBatch90TokenIdentitySubstitution } from '../src/state/modules/replacementBatch90ExtraDifferentTypeTokens.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: extra.id || 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

function land(id: string, typeLine: string, controller = 'p1') {
  return { id, controller, owner: controller, card: { name: typeLine.includes('Island') ? 'Island' : 'Land', type_line: typeLine } };
}

describe('batch90 mana, extra tokens, and count-basis pumps', () => {
  it('mana production: Reflection doubles, Nyxbloom triples, both stack, no double-apply, Virtue is basic-only', () => {
    const reflectionOracle = 'If you tap a permanent for mana, it produces twice as much of that mana instead.';
    const nyxbloomOracle = 'If you tap a permanent for mana, it produces three times as much of that mana instead.';
    const virtueOracle = 'If you tap a basic land for mana, it produces three times as much of that mana instead.';

    expect(parseBatch90ManaProductionSentence(reflectionOracle)).toEqual([
      { multiplier: 2, affects: 'permanents' },
    ]);
    expect(parseBatch90ManaProductionSentence(nyxbloomOracle)).toEqual([
      { multiplier: 3, affects: 'permanents' },
    ]);

    const island = land('i1', 'Basic Land \u2014 Island');
    const shock = land('sh', 'Land \u2014 Island Mountain');
    const reflection = P('Mana Reflection', reflectionOracle, 'Enchantment');
    const nyxbloom = P('Nyxbloom Ancient', nyxbloomOracle, 'Creature \u2014 Elemental');
    const virtue = P('Virtue of Strength', virtueOracle, 'Enchantment', { id: 'vos' });
    const unnamed = P('Unnamed Bloom', reflectionOracle, 'Enchantment', { id: 'unnamed' });

    const reflState: any = { battlefield: [reflection, island], players: [{ id: 'p1' }] };
    expect(getManaMultiplier(reflState, island, 'p1')).toBe(2);
    // Name-table + oracle must not stack to 4.
    expect(getManaMultiplier(reflState, island, 'p1')).toBe(2);

    const nyxState: any = { battlefield: [nyxbloom, island], players: [{ id: 'p1' }] };
    expect(getManaMultiplier(nyxState, island, 'p1')).toBe(3);

    const bothState: any = { battlefield: [reflection, nyxbloom, island], players: [{ id: 'p1' }] };
    expect(getManaMultiplier(bothState, island, 'p1')).toBe(6);

    const virtState: any = { battlefield: [virtue, island, shock], players: [{ id: 'p1' }] };
    expect(getManaMultiplier(virtState, island, 'p1')).toBe(3);
    expect(getManaMultiplier(virtState, shock, 'p1')).toBe(1);

    const unnamedState: any = { battlefield: [unnamed, island], players: [{ id: 'p1' }] };
    expect(getManaMultiplier(unnamedState, island, 'p1')).toBe(2);

    expect(collectReplacementEffectSpecsFromState(reflState).some((s) => s.event === 'mana-production' && s.metadata?.manaMultiplier === 2)).toBe(true);

    // Preview path must use the same hook, not name-match on top of it.
    const preview = tryCalculateManaProductionBonusesAndTotal({
      result: { baseAmount: 1, multiplier: 1, colors: ['U'], bonusMana: [], totalAmount: 1 } as any,
      battlefield: reflState.battlefield,
      playerId: 'p1',
      permanent: island,
      typeLine: 'Basic Land \u2014 Island',
      card: island.card,
    });
    expect(preview?.multiplier).toBe(2);
    expect(preview?.totalAmount).toBe(2);
  });

  it('extra different-type tokens layer on doubling; identity substitution; type filters', () => {
    const tookOracle = 'If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead.';
    const caseOracle = 'If one or more tokens would be created under your control, those tokens plus a Clue token are created instead.';
    const allenalOracle = 'If one or more creature tokens would be created under your control, those tokens plus a 1/1 white Soldier creature token are created instead.';
    const strideOracle = 'If one or more artifact tokens would be created under your control, those tokens plus an additional 1/1 colorless Thopter artifact creature token with flying are created instead.';
    const helmOracle = 'If you would create one or more artifact tokens, instead create those tokens plus an additional Map token.';
    const tippyOracle = 'If you would create one or more tokens, instead create those tokens plus an additional Food token.';
    const processionOracle = 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.';
    const visitationOracle = 'If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.';

    expect(parseBatch90ExtraDifferentTypeTokenSentence(tookOracle)[0]?.token.name).toBe('Food');
    expect(parseBatch90ExtraDifferentTypeTokenSentence(allenalOracle)[0]).toMatchObject({
      filter: 'creature',
      token: { name: 'Soldier', power: 1, toughness: 1, colors: ['W'] },
    });
    expect(parseBatch90ExtraDifferentTypeTokenSentence(strideOracle)[0]).toMatchObject({
      filter: 'artifact',
      token: { name: 'Thopter', power: 1, toughness: 1, abilities: ['flying'] },
    });
    expect(parseBatch90TokenIdentitySubstitution(visitationOracle)).toMatchObject({
      name: 'Angel', power: 4, toughness: 4, colors: ['W'], abilities: ['flying', 'vigilance'],
    });

    const took = P('Peregrin Took', tookOracle, 'Creature \u2014 Halfling Citizen', { id: 'took' });
    const procession = P('Anointed Procession', processionOracle, 'Enchantment', { id: 'ap' });
    const allenal = P('Queen Allenal of Ruadach', allenalOracle, 'Creature \u2014 Elf Knight', { id: 'qa' });
    const stride = P('Stridehangar Automaton', strideOracle, 'Artifact Creature \u2014 Construct', { id: 'sa' });
    const helm = P('Worldwalker Helm', helmOracle, 'Artifact', { id: 'wh' });
    const tippy = P('Tippy-Toe, Terrific Partner', tippyOracle, 'Creature', { id: 'tt' });
    const proof = P('Case of the Pilfered Proof', caseOracle, 'Enchantment \u2014 Case', { id: 'cpp' });
    const vis = P('Divine Visitation', visitationOracle, 'Enchantment', { id: 'dv' });

    // Sane order: different-type extras are part of the replaced event, then doublers apply
    // (1 Soldier + Took + Procession => 2 Soldiers + 2 Foods).
    const doubled = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [took, procession] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Soldier',
      tokenTypeLine: 'Creature \u2014 Soldier',
    });
    expect(doubled.applied).toBe(true);
    expect(doubled.replacementAmount).toBe(2);
    const extraFoods = (doubled.metadata as any)?.additionalTokens as any[];
    expect(extraFoods).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Food', count: 2 }),
    ]));
    // Food must not be folded into the original Soldier count (would be 4).
    expect(doubled.replacementAmount).not.toBe(4);

    const clueOnly = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [proof] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Soldier',
      tokenTypeLine: 'Creature \u2014 Soldier',
    });
    expect(clueOnly.replacementAmount).toBe(1);
    expect((clueOnly.metadata as any)?.additionalTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Clue', count: 1 }),
    ]));

    const creatureExtra = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [allenal] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Beast',
      tokenTypeLine: 'Creature \u2014 Beast',
    });
    expect((creatureExtra.metadata as any)?.additionalTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Soldier', power: 1, toughness: 1 }),
    ]));
    const treasureNotCreature = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [allenal] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Treasure',
      tokenTypeLine: 'Artifact \u2014 Treasure',
    });
    expect(treasureNotCreature.applied).toBe(false);

    const artifactExtra = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [stride, helm] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Treasure',
      tokenTypeLine: 'Artifact \u2014 Treasure',
    });
    const extras = (artifactExtra.metadata as any)?.additionalTokens as any[];
    expect(extras.some((t) => t.name === 'Thopter' && (t.abilities || []).includes('flying'))).toBe(true);
    expect(extras.some((t) => t.name === 'Map')).toBe(true);
    const creatureNotArtifact = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [stride] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Soldier',
      tokenTypeLine: 'Creature \u2014 Soldier',
    });
    expect(creatureNotArtifact.applied).toBe(false);

    const tippyEv = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [tippy] },
      controllerId: 'p1',
      count: 2,
      tokenName: 'Beast',
      tokenTypeLine: 'Creature \u2014 Beast',
    });
    expect((tippyEv.metadata as any)?.additionalTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Food', count: 1 }),
    ]));

    const angels = evaluateTokenCreationReplacementEvent({
      state: { battlefield: [vis, procession] },
      controllerId: 'p1',
      count: 1,
      tokenName: 'Soldier',
      tokenTypeLine: 'Creature \u2014 Soldier',
    });
    expect(angels.replacementAmount).toBe(2);
    expect((angels.metadata as any)?.replaceCreatedToken).toMatchObject({
      name: 'Angel', power: 4, toughness: 4,
    });
  });

  it('count-basis pumps: Umbris, Greven, Gornog, Hancock, Tangleweave', () => {
    const umbris = P(
      'Umbris, Fear Manifest',
      'Umbris, Fear Manifest gets +1/+1 for each card your opponents own in exile.',
      'Creature \u2014 Nightmare Illusion',
      {},
      { power: '1', toughness: '1' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(umbris).some((s) => s.grant.countBasis === 'opponents_owned_cards_in_exile')).toBe(true);
    const uState: any = {
      battlefield: [umbris],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: { exile: [] },
        p2: { exile: [{ name: 'Bolt', owner: 'p2' }, { name: 'Shock', owner: 'p2' }] },
      },
    };
    syncDerivedContinuousEffects(uState);
    expect(getCurrentPowerToughness(umbris as any, uState)?.power).toBe(3);

    const greven = P(
      'Greven, Predator Captain',
      "Greven, Predator Captain gets +X/+0, where X is the amount of life you've lost this turn.",
      'Creature \u2014 Phyrexian Human Warrior',
      {},
      { power: '5', toughness: '5' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(greven).some((s) => s.grant.countBasis === 'controller_life_lost_this_turn')).toBe(true);
    const gState: any = {
      battlefield: [greven],
      players: [{ id: 'p1' }],
      lifeLostThisTurn: { p1: 4 },
    };
    syncDerivedContinuousEffects(gState);
    expect(getCurrentPowerToughness(greven as any, gState)?.power).toBe(9);
    expect(getCurrentPowerToughness(greven as any, gState)?.toughness).toBe(5);

    const gornog = P(
      'Gornog, the Red Reaper',
      'Attacking Warriors you control get +X/+0, where X is the number of Cowards your opponents control.',
      'Creature \u2014 Minotaur Warrior',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(gornog).some(
      (s) => s.grant.countBasis === 'controller_permanents_of_type' && s.grant.countWho === 'opponents' && (s.condition?.kind === 'target_is_attacking' || s.conditions?.some((c) => c.kind === 'target_is_attacking')),
    )).toBe(true);
    const warrior = {
      id: 'war', controller: 'p1', attacking: 'p2',
      card: { name: 'Raider', type_line: 'Creature \u2014 Human Warrior', power: '2', toughness: '2' },
    };
    const coward = {
      id: 'cow', controller: 'p2',
      card: { name: 'Fleeing', type_line: 'Creature \u2014 Coward', power: '1', toughness: '1' },
    };
    const goState: any = { battlefield: [gornog, warrior, coward], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(goState);
    expect(getCurrentPowerToughness(warrior as any, goState)?.power).toBe(3);

    const hancock = P(
      'Hancock, Ghoulish Mayor',
      "Each other creature you control that's a Zombie or Mutant gets +X/+X, where X is the number of counters on Hancock, Ghoulish Mayor.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(hancock).some(
      (s) => s.grant.countBasis === 'source_counters' && s.condition?.kind === 'target_has_any_creature_type',
    )).toBe(true);
    const zombie = {
      id: 'z1', controller: 'p1',
      card: { name: 'Walker', type_line: 'Creature \u2014 Zombie', power: '2', toughness: '2' },
    };
    const bear = {
      id: 'b1', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2' },
    };
    const hReady = { ...hancock, counters: { 'p1p1': 2 } };
    const hState: any = { battlefield: [hReady, zombie, bear], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(hState);
    expect(getCurrentPowerToughness(zombie as any, hState)?.power).toBe(4);
    expect(getCurrentPowerToughness(bear as any, hState)?.power).toBe(2);

    const weave = P(
      'Tangleweave Armor',
      'Equipped creature gets +X/+X, where X is the greatest mana value among your commanders.',
      'Artifact \u2014 Equipment',
      { id: 'eq', attachedTo: 'host' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(weave).some((s) => s.grant.countBasis === 'greatest_mana_value_among_controller_commanders')).toBe(true);
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Bearer', type_line: 'Creature \u2014 Human', power: '2', toughness: '2' },
    };
    const wState: any = {
      battlefield: [weave, host],
      players: [{ id: 'p1' }],
      commandZone: { p1: { commanders: [{ name: 'Big', cmc: 6 }, { name: 'Small', cmc: 3 }] } },
    };
    syncDerivedContinuousEffects(wState);
    expect(getCurrentPowerToughness(host as any, wState)?.power).toBe(8);
    expect(getCurrentPowerToughness(host as any, wState)?.toughness).toBe(8);
  });

  it('classifiers cover B90 families', () => {
    const lines: Array<[string, string]> = [
      ['If you tap a permanent for mana, it produces twice as much of that mana instead.', 'Mana Reflection'],
      ['If you tap a permanent for mana, it produces three times as much of that mana instead.', 'Nyxbloom Ancient'],
      ['If you tap a basic land for mana, it produces three times as much of that mana instead.', 'Virtue of Strength'],
      ['If you would create one or more tokens, instead create those tokens plus an additional Food token.', 'Tippy-Toe, Terrific Partner'],
      ['If one or more creature tokens would be created under your control, those tokens plus a 1/1 white Soldier creature token are created instead.', 'Queen Allenal of Ruadach'],
      ['If one or more artifact tokens would be created under your control, those tokens plus an additional 1/1 colorless Thopter artifact creature token with flying are created instead.', 'Stridehangar Automaton'],
      ['If you would create one or more artifact tokens, instead create those tokens plus an additional Map token.', 'Worldwalker Helm'],
      ['If one or more tokens would be created under your control, those tokens plus a Clue token are created instead.', 'Case of the Pilfered Proof'],
      ['If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.', 'Divine Visitation'],
      ['Umbris, Fear Manifest gets +1/+1 for each card your opponents own in exile.', 'Umbris, Fear Manifest'],
      ["Greven, Predator Captain gets +X/+0, where X is the amount of life you've lost this turn.", 'Greven, Predator Captain'],
      ['Attacking Warriors you control get +X/+0, where X is the number of Cowards your opponents control.', 'Gornog, the Red Reaper'],
      ["Each other creature you control that's a Zombie or Mutant gets +X/+X, where X is the number of counters on Hancock, Ghoulish Mayor.", 'Hancock, Ghoulish Mayor'],
      ['Equipped creature gets +X/+X, where X is the greatest mana value among your commanders.', 'Tangleweave Armor'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
