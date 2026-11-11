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
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { computeStaticMaxHandSize } from '../src/state/modules/handSizeStaticModifiers.js';
import { parseOracleLandTypeSetting } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeSettingOracle.js';
import { applyPoisonCountersToPlayer } from '../src/state/modules/combat-damage-processing.js';
import { equipmentRequiresLegendaryHost } from '../src/state/modules/equipmentAttachPowerGate.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch88 statics', () => {
  it('Circle + Ixidor + Steel + Departed + Razorkin', () => {
    const circle = P(
      'Circle of the Moon Druid',
      'During your turn, this creature is a Bear with base power and toughness 4/2.',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(circle).some(
      (s) => s.condition?.kind === 'during_source_controller_turn' && (s.grant as any).setPower === 4,
    )).toBe(true);

    const ixidor = P('Ixidor, Reality Sculptor', 'Face-down creatures get +1/+1.');
    const faceDown = {
      id: 'fd', controller: 'p2', faceDown: true,
      card: { name: 'Morph', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const iState: any = { battlefield: [ixidor, faceDown], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(iState);
    expect(getCurrentPowerToughness(faceDown as any, iState)?.power).toBe(3);

    const steel = P(
      'Steel of the Godhead',
      "As long as enchanted creature is blue, it gets +1/+1 and can't be blocked.",
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Host', type_line: 'Creature', power: '2', toughness: '2', colors: ['U'] },
    };
    const sState: any = { battlefield: [steel, host], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(sState);
    expect(getCurrentPowerToughness(host as any, sState)?.power).toBe(3);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, sState)).toContain("can't be blocked");

    const deckhand = P('Departed Deckhand', "This creature can't be blocked except by Spirits.");
    expect(parseStaticEffectSpecsFromOraclePermanent(deckhand).some(
      (s) => (s.grant.abilities || []).some((a) => /except by Spirits/i.test(a)),
    )).toBe(true);

    const razor = P('Razorkin Needlehead', 'This creature has first strike during your turn.');
    expect(parseStaticEffectSpecsFromOraclePermanent(razor).some(
      (s) => s.condition?.kind === 'during_source_controller_turn'
        && (s.grant.abilities || []).includes('first strike'),
    )).toBe(true);
  });

  it('Bladeback + Mephidross + Melira + Gorm + Maulhorn + Cid', () => {
    const blade = P(
      'Bladeback Sliver',
      'Hellbent — As long as you have no cards in hand, Sliver creatures you control have "{T}: This creature deals 1 damage to target player or planeswalker."',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(blade).some(
      (s) => s.condition?.kind === 'zone_count' && (s.grant.abilities || []).some((a) => /\{t\}/i.test(a)),
    )).toBe(true);

    const mephi = P(
      'Mephidross Vampire',
      'Each creature you control is a Vampire in addition to its other creature types and has "Whenever this creature deals damage to a creature, put a +1/+1 counter on this creature."',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(mephi).some(
      (s) => (s.grant.typeAdditions || []).includes('Vampire'),
    )).toBe(true);

    const melira = P('Melira, Sylvok Outcast', "You can't get poison counters.");
    expect(parseStaticEffectSpecsFromOraclePermanent(melira).some(
      (s) => s.scope.kind === 'player_you' && (s.grant.abilities || []).includes("can't get poison counters"),
    )).toBe(true);
    const poisonCtx: any = { state: { battlefield: [melira], players: [{ id: 'p1' }], poisonCounters: {} } };
    applyPoisonCountersToPlayer(poisonCtx, 'p1', 3);
    expect(poisonCtx.state.poisonCounters?.p1 || 0).toBe(0);

    const gorm = P(
      'Gorm the Great',
      'Gorm must be blocked if able, and Gorm must be blocked by two or more creatures if able.',
    );
    const gSpecs = parseStaticEffectSpecsFromOraclePermanent(gorm);
    expect(gSpecs.some((s) => (s.grant.abilities || []).includes('must_be_blocked_if_able'))).toBe(true);
    expect(gSpecs.some((s) => (s.grant.abilities || []).includes('must_be_blocked_by_at_least_2'))).toBe(true);

    const maul = P(
      'Marauding Maulhorn',
      'This creature attacks each combat if able unless you control a creature named Advocate of the Beast.',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(maul).some(
      (s) => s.conditionNegated && s.condition?.kind === 'controller_controls_named_at_least',
    )).toBe(true);

    const cid = P(
      'Cid, Timeless Artificer',
      'Artifact creatures and Heroes you control get +1/+1 for each Artificer you control and each Artificer card in your graveyard.',
    );
    const hero = {
      id: 'h1', controller: 'p1',
      card: { name: 'Hero', type_line: 'Creature — Hero', power: '1', toughness: '1' },
    };
    const art = {
      id: 'a1', controller: 'p1',
      card: { name: 'Artificer', type_line: 'Creature — Artificer', power: '1', toughness: '1' },
    };
    const cState: any = {
      battlefield: [cid, hero, art],
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      zones: { p1: { graveyard: [{ type_line: 'Creature — Artificer', name: 'Gy Art' }] } },
    };
    syncDerivedContinuousEffects(cState);
    // 2 Artificers (BF+GY) → Hero gets +2/+2
    expect(getCurrentPowerToughness(hero as any, cState)?.power).toBe(3);
  });

  it('Hamsphere + Copperhoof + Strata + Cecily + Wild-Magic + Omnath + Archpriest + Ashes + Zhao + Konda', () => {
    const ham = P(
      'Rolling Hamsphere',
      'This Vehicle gets +1/+1 for each Hamster you control.',
      'Artifact — Vehicle',
    );
    const hamster = {
      id: 'hm', controller: 'p1',
      card: { name: 'Ham', type_line: 'Creature — Hamster', power: '1', toughness: '1' },
    };
    const hState: any = { battlefield: [ham, hamster], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(hState);
    expect(getCurrentPowerToughness(ham as any, hState)?.power).toBe(3);

    const copper = P(
      'Copperhoof Vorrac',
      'This creature gets +1/+1 for each untapped permanent your opponents control.',
    );
    const oppLand = {
      id: 'ol', controller: 'p2', tapped: false,
      card: { name: 'Forest', type_line: 'Basic Land — Forest' },
    };
    const cState: any = { battlefield: [copper, oppLand], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(cState);
    expect(getCurrentPowerToughness(copper as any, cState)?.power).toBe(3);

    const strata = P(
      'Strata Scythe',
      'Equipped creature gets +1/+1 for each land on the battlefield with the same name as the exiled card.',
      'Artifact — Equipment',
      { attachedTo: 'eqh', exiledCards: [{ name: 'Forest', type_line: 'Basic Land — Forest' }] },
    );
    const eqHost = {
      id: 'eqh', controller: 'p1',
      card: { name: 'Bearer', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const forest = {
      id: 'f1', controller: 'p2',
      card: { name: 'Forest', type_line: 'Basic Land — Forest' },
    };
    const stState: any = { battlefield: [strata, eqHost, forest], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(stState);
    expect(getCurrentPowerToughness(eqHost as any, stState)?.power).toBe(3);

    const cecily = P('Cecily, Haunted Mage', 'Your maximum hand size is eleven.');
    expect(computeStaticMaxHandSize([cecily], 'p1')).toBe(11);

    const wild = P('Wild-Magic Sorcerer', 'The first spell you cast from exile each turn has cascade.');
    expect(getGrantedCascadeCountForCast(
      { battlefield: [wild] }, 'p1', { type_line: 'Instant' },
      { castSourceZone: 'exile', isFirstSpellCastFromExileThisTurn: true },
    )).toBeGreaterThan(0);

    const omnath = P('Omnath, Locus of Mana', 'Omnath gets +1/+1 for each unspent green mana you have.');
    const oState: any = {
      battlefield: [omnath],
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      manaPool: { p1: { G: 3, R: 2 } },
    };
    syncDerivedContinuousEffects(oState);
    expect(getCurrentPowerToughness(omnath as any, oState)?.power).toBe(5);

    const arch = P(
      'Archpriest of Iona',
      "Archpriest of Iona's power is equal to the number of creatures in your party.",
      'Creature',
      {},
      { power: '*', toughness: '2' },
    );
    const cda = calculateVariablePT({ ...arch.card, controller: 'p1', id: 'src', name: arch.card.name }, {
      battlefield: [
        arch,
        { id: 'c1', controller: 'p1', card: { type_line: 'Creature — Cleric', name: 'Cleric' } },
        { id: 'r1', controller: 'p1', card: { type_line: 'Creature — Rogue', name: 'Rogue' } },
      ],
      zones: { p1: {} },
    });
    expect(cda?.power).toBe(2);

    const ashes = P(
      'Ashes of the Abhorrent',
      "Players can't cast spells from graveyards or activate abilities of cards in graveyards.",
      'Enchantment',
    );
    expect(castRestrictionTailViolation(
      { battlefield: [ashes], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' },
      'p2', { name: 'Bolt', type_line: 'Instant', cmc: 1 }, 'graveyard',
    )).toBeTruthy();

    const zhao = P(
      'Zhao, the Moon Slayer',
      'As long as Zhao has a conqueror counter on him, nonbasic lands are Mountains.',
      'Creature',
      { counters: { conqueror: 1 } },
    );
    const mod = parseOracleLandTypeSetting(
      String(zhao.card.oracle_text).toLowerCase(),
      zhao,
    );
    expect(mod?.affects).toBe('nonbasic_lands');
    expect(mod?.landTypes).toContain('mountain');

    const konda = P(
      "Konda's Banner",
      "Konda's Banner can be attached only to a legendary creature.",
      'Artifact — Equipment',
    );
    expect(equipmentRequiresLegendaryHost(konda)).toBe(true);
  });

  it('classifiers cover B88 families', () => {
    const lines: Array<[string, string]> = [
      ['During your turn, this creature is a Bear with base power and toughness 4/2.', 'Circle of the Moon Druid'],
      ['Face-down creatures get +1/+1.', 'Ixidor, Reality Sculptor'],
      ["As long as enchanted creature is blue, it gets +1/+1 and can't be blocked.", 'Steel of the Godhead'],
      ['Artifact creatures and Heroes you control get +1/+1 for each Artificer you control and each Artificer card in your graveyard.', 'Cid, Timeless Artificer'],
      ["This creature can't be blocked except by Spirits.", 'Departed Deckhand'],
      ['Hellbent — As long as you have no cards in hand, Sliver creatures you control have "{T}: This creature deals 1 damage to target player or planeswalker."', 'Bladeback Sliver'],
      ['Each creature you control is a Vampire in addition to its other creature types and has "Whenever this creature deals damage to a creature, put a +1/+1 counter on this creature."', 'Mephidross Vampire'],
      ['This Vehicle gets +1/+1 for each Hamster you control.', 'Rolling Hamsphere'],
      ["You can't get poison counters.", 'Melira, Sylvok Outcast'],
      ['Gorm must be blocked if able, and Gorm must be blocked by two or more creatures if able.', 'Gorm the Great'],
      ['Your maximum hand size is eleven.', 'Cecily, Haunted Mage'],
      ["Players can't cast spells from graveyards or activate abilities of cards in graveyards.", 'Ashes of the Abhorrent'],
      ['This creature has first strike during your turn.', 'Razorkin Needlehead'],
      ["Archpriest of Iona's power is equal to the number of creatures in your party.", 'Archpriest of Iona'],
      ['This creature gets +1/+1 for each untapped permanent your opponents control.', 'Copperhoof Vorrac'],
      ['Equipped creature gets +1/+1 for each land on the battlefield with the same name as the exiled card.', 'Strata Scythe'],
      ['This creature attacks each combat if able unless you control a creature named Advocate of the Beast.', 'Marauding Maulhorn'],
      ['The first spell you cast from exile each turn has cascade.', 'Wild-Magic Sorcerer'],
      ['Omnath gets +1/+1 for each unspent green mana you have.', 'Omnath, Locus of Mana'],
      ['As long as Zhao has a conqueror counter on him, nonbasic lands are Mountains.', 'Zhao, the Moon Slayer'],
      ["Konda's Banner can be attached only to a legendary creature.", "Konda's Banner"],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
