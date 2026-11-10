import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { castRestrictionTailViolation } from '../src/state/modules/castRestrictionTailFamilies.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch82 statics', () => {
  it('CDA power/toughness phrases + Skycat flying count + Winter GY', () => {
    const sq = calculateVariablePT(
      {
        name: 'Squawkroaster',
        power: '*',
        toughness: '4',
        oracle_text: "Vivid — Squawkroaster's power is equal to the number of colors among permanents you control.",
        colors: ['R'],
        controller: 'p1',
      },
      {
        battlefield: [
          { controller: 'p1', card: { type_line: 'Creature', colors: ['R'] } },
          { controller: 'p1', card: { type_line: 'Creature', colors: ['U'] } },
        ],
        zones: { p1: {} },
      },
    );
    expect(sq?.power).toBeGreaterThanOrEqual(2);

    const wood = calculateVariablePT(
      {
        name: 'Coiling Woodworm',
        power: '*',
        toughness: '1',
        oracle_text: "Coiling Woodworm's power is equal to the number of Forests on the battlefield.",
        controller: 'p1',
      },
      {
        battlefield: [
          { controller: 'p1', card: { type_line: 'Basic Land — Forest' } },
          { controller: 'p2', card: { type_line: 'Basic Land — Forest' } },
        ],
        zones: { p1: {} },
      },
    );
    expect(wood?.power).toBe(2);

    const havva = calculateVariablePT(
      {
        name: 'An-Havva Constable',
        power: '2',
        toughness: '*',
        oracle_text: "An-Havva Constable's toughness is equal to 1 plus the number of green creatures on the battlefield.",
        controller: 'p1',
      },
      {
        battlefield: [
          { controller: 'p1', card: { type_line: 'Creature — Elf', colors: ['G'] } },
          { controller: 'p2', card: { type_line: 'Creature — Beast', colors: ['G'] } },
        ],
        zones: { p1: {} },
      },
    );
    expect(havva?.toughness).toBe(3);

    const skycat = P(
      'Skycat Sovereign',
      'This creature gets +1/+1 for each other creature you control with flying.',
      'Creature',
      {},
      { power: '1', toughness: '1' },
    );
    const flyer = {
      id: 'f', controller: 'p1',
      card: { name: 'Bird', type_line: 'Creature — Bird', oracle_text: 'Flying', power: '1', toughness: '1', keywords: ['flying'] },
    };
    const sState: any = { battlefield: [skycat, flyer], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(sState);
    expect(getCurrentPowerToughness(skycat as any, sState)?.power).toBe(2);

    const winter = P(
      'Winter, Tormented Loner',
      'Winter gets +1/+0 for each creature and planeswalker card in your graveyard.',
      'Creature',
      {},
      { power: '2', toughness: '2' },
    );
    const wState: any = {
      battlefield: [winter],
      players: [{ id: 'p1' }],
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Creature — Bear' },
            { type_line: 'Legendary Planeswalker — Jace' },
            { type_line: 'Instant' },
          ],
        },
      },
    };
    syncDerivedContinuousEffects(wState);
    expect(getCurrentPowerToughness(winter as any, wState)?.power).toBe(4);
  });

  it('Cloud equipped + Arcades + Death Approach + Bonehoard + share-type + Thrun', () => {
    const cloud = P(
      "Cloud, Planet's Champion",
      'During your turn, as long as Cloud is equipped, it has double strike and indestructible.',
    );
    const eq = {
      id: 'e', controller: 'p1', attachedTo: 'src',
      card: { name: 'FakeEquip', type_line: 'Artifact — Equipment', oracle_text: '' },
    };
    const cState: any = { battlefield: [cloud, eq], players: [{ id: 'p1' }], turnPlayer: 'p1' };
    syncDerivedContinuousEffects(cState);
    expect(getContinuousGrantedAbilitiesForPermanent(cloud as any, cState)).toEqual(
      expect.arrayContaining(['double strike', 'indestructible']),
    );

    const arcades = P(
      'Arcades Sabboth',
      "Each untapped creature you control gets +0/+2 as long as it's not attacking.",
    );
    const wall = {
      id: 'w', controller: 'p1', tapped: false,
      card: { name: 'Wall', type_line: 'Creature — Wall', power: '0', toughness: '4' },
    };
    const aState: any = { battlefield: [arcades, wall], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(aState);
    expect(getCurrentPowerToughness(wall as any, aState)?.toughness).toBe(6);

    const death = P(
      "Death's Approach",
      "Enchanted creature gets -X/-X, where X is the number of creature cards in its controller's graveyard.",
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    const host = {
      id: 'h', controller: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '5', toughness: '5' },
    };
    const dState: any = {
      battlefield: [death, host],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: { p2: { graveyard: [{ type_line: 'Creature — Elf' }, { type_line: 'Creature — Orc' }] } },
    };
    syncDerivedContinuousEffects(dState);
    expect(getCurrentPowerToughness(host as any, dState)?.power).toBe(3);

    const bone = P(
      'Bonehoard',
      'Equipped creature gets +X/+X, where X is the number of creature cards in all graveyards.',
      'Artifact — Equipment',
      { attachedTo: 'h2' },
    );
    const host2 = {
      id: 'h2', controller: 'p1',
      card: { name: 'Soldier', type_line: 'Creature — Soldier', power: '1', toughness: '1' },
    };
    const bState: any = {
      battlefield: [bone, host2],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: { graveyard: [{ type_line: 'Creature — Bear' }] },
        p2: { graveyard: [{ type_line: 'Creature — Elf' }] },
      },
    };
    syncDerivedContinuousEffects(bState);
    expect(getCurrentPowerToughness(host2 as any, bState)?.power).toBe(3);

    const alpha = P(
      'Alpha Status',
      'Enchanted creature gets +2/+2 for each other creature on the battlefield that shares a creature type with it.',
      'Enchantment — Aura',
      { attachedTo: 'h3' },
    );
    const wolf = {
      id: 'h3', controller: 'p1',
      card: { name: 'Wolf A', type_line: 'Creature — Wolf', power: '2', toughness: '2' },
    };
    const wolf2 = {
      id: 'w2', controller: 'p2',
      card: { name: 'Wolf B', type_line: 'Creature — Wolf', power: '2', toughness: '2' },
    };
    const alState: any = { battlefield: [alpha, wolf, wolf2], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(alState);
    expect(getCurrentPowerToughness(wolf as any, alState)?.power).toBe(4);

    const thrun = P(
      'Thrun, Breaker of Silence',
      "Thrun can't be the target of nongreen spells your opponents control or abilities from nongreen sources your opponents control.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(thrun).some(
      (s) => (s.grant.abilities || []).some((a) => /nongreen/i.test(String(a))),
    )).toBe(true);
  });

  it('Faithbound + Pestilent + Nacatl + Cavalry + Tribal + Dune + Phoenix + casting locks + classifiers', () => {
    const faith = P(
      'Faithbound Judge',
      "As long as this creature has three or more judgment counters on it, it can attack as though it didn't have defender.",
      'Creature',
      { counters: { judgment: 3 } },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(faith).some(
      (s) => (s.grant.asThoughNoAbilities || []).includes('defender'),
    )).toBe(true);

    const pest = P('Pestilent Spirit', 'Instant and sorcery spells you control have deathtouch.');
    expect(parseStaticEffectSpecsFromOraclePermanent(pest).some(
      (s) => (s.grant.abilities || []).some((a) => /deathtouch/i.test(String(a))),
    )).toBe(true);

    const nacatl = P('Nacatl War-Pride', 'This creature must be blocked by exactly one creature if able.');
    expect(parseStaticEffectSpecsFromOraclePermanent(nacatl).some(
      (s) => (s.grant.abilities || []).includes('must_be_blocked_by_exactly_1'),
    )).toBe(true);

    const cavalry = P('Cavalry Master', 'Other creatures you control with flanking have flanking.');
    const flanker = {
      id: 'f', controller: 'p1',
      card: { name: 'Knight', type_line: 'Creature — Knight', oracle_text: 'Flanking', keywords: ['flanking'], power: '2', toughness: '2' },
    };
    const cavState: any = { battlefield: [cavalry, flanker], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(cavState);
    expect(getContinuousGrantedAbilitiesForPermanent(flanker as any, cavState)).toContain('flanking');

    const golem = P(
      'Tribal Golem',
      'This creature has trample as long as you control a Beast, haste as long as you control a Goblin.',
    );
    const beast = {
      id: 'b', controller: 'p1',
      card: { name: 'Beast', type_line: 'Creature — Beast', power: '3', toughness: '3' },
    };
    const gState: any = { battlefield: [golem, beast], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(gState);
    expect(getContinuousGrantedAbilitiesForPermanent(golem as any, gState)).toContain('trample');

    const dune = P(
      'Dune Chanter',
      "Lands you control and land cards you own that aren't on the battlefield are Deserts in addition to their other types.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(dune).some(
      (s) => (s.grant.typeAdditions || []).includes('Desert'),
    )).toBe(true);

    const fleet = P(
      'Phoenix Fleet Airship',
      'As long as you control eight or more permanents named Phoenix Fleet Airship, this Vehicle is an artifact creature.',
      'Artifact — Vehicle',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(fleet).some(
      (s) => s.condition?.kind === 'controller_controls_named_at_least',
    )).toBe(true);

    const dosan = {
      id: 'd', controller: 'p1',
      card: { name: 'Dosan the Falling Leaf', oracle_text: 'Players can cast spells only during their own turns.', type_line: 'Creature' },
    };
    const state: any = { battlefield: [dosan], turnPlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }] };
    expect(castRestrictionTailViolation(state, 'p2', { name: 'Bolt', type_line: 'Instant', cmc: 1 }, 'hand')).toBeTruthy();
    expect(castRestrictionTailViolation(state, 'p1', { name: 'Bolt', type_line: 'Instant', cmc: 1 }, 'hand')).toBeNull();

    const lines: Array<[string, string]> = [
      ["Squawkroaster's power is equal to the number of colors among permanents you control.", 'Squawkroaster'],
      ["Coiling Woodworm's power is equal to the number of Forests on the battlefield.", 'Coiling Woodworm'],
      ["An-Havva Constable's toughness is equal to 1 plus the number of green creatures on the battlefield.", 'An-Havva Constable'],
      ["This creature's power is equal to the number of noncreature, nonland cards in your graveyard.", 'Dragonfly Swarm'],
      ['This creature gets +1/+1 for each other creature you control with flying.', 'Skycat Sovereign'],
      ['Winter gets +1/+0 for each creature and planeswalker card in your graveyard.', 'Winter, Tormented Loner'],
      ["Enchanted creature gets -X/-X, where X is the number of creature cards in its controller's graveyard.", "Death's Approach"],
      ['Equipped creature gets +X/+X, where X is the number of creature cards in all graveyards.', 'Bonehoard'],
      ['Equipped creature gets +1/+1 for each creature you control with base power or toughness 1.', 'Sword of the Squeak'],
      ['During your turn, as long as Cloud is equipped, it has double strike and indestructible.', "Cloud, Planet's Champion"],
      ["Each untapped creature you control gets +0/+2 as long as it's not attacking.", 'Arcades Sabboth'],
      ['Enchanted creature gets +2/+2 for each other creature on the battlefield that shares a creature type with it.', 'Alpha Status'],
      ['Equipped creature gets +1/+1 for each other creature you control that shares a creature type with it.', 'Stoneforge Masterwork'],
      ["Thrun can't be the target of nongreen spells your opponents control or abilities from nongreen sources your opponents control.", 'Thrun, Breaker of Silence'],
      ["As long as this creature has three or more judgment counters on it, it can attack as though it didn't have defender.", 'Faithbound Judge'],
      ['Instant and sorcery spells you control have deathtouch.', 'Pestilent Spirit'],
      ['This creature must be blocked by exactly one creature if able.', 'Nacatl War-Pride'],
      ['Other creatures you control with flanking have flanking.', 'Cavalry Master'],
      ['This creature has trample as long as you control a Beast, haste as long as you control a Goblin.', 'Tribal Golem'],
      ["Lands you control and land cards you own that aren't on the battlefield are Deserts in addition to their other types.", 'Dune Chanter'],
      ['As long as you control eight or more permanents named Phoenix Fleet Airship, this Vehicle is an artifact creature.', 'Phoenix Fleet Airship'],
      ['Players can cast spells only during their own turns.', 'Dosan the Falling Leaf'],
      ["Your opponents can't cast spells with even mana values.", 'Void Winnower'],
      ["Your opponents can't block with creatures with even mana values.", 'Void Winnower'],
      ["Players can't cast noncreature spells from graveyards or exile.", 'Soulless Jailer'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
