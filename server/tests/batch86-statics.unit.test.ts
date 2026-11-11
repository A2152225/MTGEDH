import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { getCreatureTypesNow } from '../src/state/creatureTypeNow.js';
import { castRestrictionTailViolation } from '../src/state/modules/castRestrictionTailFamilies.js';
import { collectBatch65DamageReplacementSpecs } from '../src/state/modules/replacementBatch65DamageReplacements.js';
import { parseAttachedTypeSettingFromOracle } from '../src/state/modules/attachedTypeSettingStamp.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch86 statics', () => {
  it('Breath + Titan + Timber + Maskwood + Greymond + Spellbane', () => {
    const breath = P('Breath of Dreams', 'Green creatures have "Cumulative upkeep {1}."', 'Enchantment');
    expect(parseStaticEffectSpecsFromOraclePermanent(breath).some(
      (s) => s.condition?.kind === 'target_has_mana_color' && (s.grant.abilities || []).length > 0,
    )).toBe(true);

    const titan = P('Titan of Eternal Fire', 'Each Human creature you control has "{R}, {T}: This creature deals 1 damage to any target."');
    expect(parseStaticEffectSpecsFromOraclePermanent(titan).some(
      (s) => (s.scope as any)?.creatureType === 'Human' && (s.grant.abilities || []).length > 0,
    )).toBe(true);

    const timber = P('Timber Protector', 'Other Treefolk and Forests you control have indestructible.');
    const tSpecs = parseStaticEffectSpecsFromOraclePermanent(timber);
    expect(tSpecs.some((s) => (s.scope as any)?.creatureType === 'Treefolk' && (s.grant.abilities || []).includes('indestructible'))).toBe(true);
    expect(tSpecs.some((s) => s.scope.kind === 'lands_you_control')).toBe(true);

    const mask = P('Maskwood Nexus', 'Creatures you control are every creature type.', 'Artifact');
    const elf = { id: 'e', controller: 'p1', card: { name: 'Elf', type_line: 'Creature — Elf', power: '1', toughness: '1' } };
    const mState: any = { battlefield: [mask, elf], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(mState);
    expect([...getCreatureTypesNow(elf as any)]).toContain('*');

    const grey = P(
      "Greymond, Avacyn's Stalwart",
      'Humans you control have each of the chosen abilities.',
      'Creature',
      { chosenOptions: ['flying', 'vigilance'] },
    );
    const human = {
      id: 'h', controller: 'p1',
      card: { name: 'Human', type_line: 'Creature — Human', power: '1', toughness: '1' },
    };
    const gState: any = { battlefield: [grey, human], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(gState);
    const abs = getContinuousGrantedAbilitiesForPermanent(human as any, gState);
    expect(abs).toEqual(expect.arrayContaining(['flying', 'vigilance']));

    const spellbane = P(
      'Spellbane Centaur',
      "Creatures you control can't be the targets of blue spells or abilities from blue sources.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(spellbane).some(
      (s) => (s.grant.abilities || []).includes('protection from blue'),
    )).toBe(true);
  });

  it('Tromokratis + Elven Riders + Hooded Horror + Nature + Swift', () => {
    const tromo = P(
      'Tromokratis',
      "Tromokratis has hexproof unless it's attacking or blocking.\nTromokratis can't be blocked unless all creatures defending player controls block it.",
    );
    const tSpecs = parseStaticEffectSpecsFromOraclePermanent(tromo);
    expect(tSpecs.some((s) => s.conditionNegated && (s.grant.abilities || []).includes('hexproof'))).toBe(true);
    expect(tSpecs.some((s) => (s.grant.abilities || []).some((a) => /all creatures defending/i.test(a)))).toBe(true);

    const riders = P('Elven Riders', "This creature can't be blocked except by Walls and/or creatures with flying.");
    expect(parseStaticEffectSpecsFromOraclePermanent(riders).some(
      (s) => (s.grant.abilities || []).some((a) => /Walls and\/or creatures with flying/i.test(a)),
    )).toBe(true);

    const horror = P(
      'Hooded Horror',
      "This creature can't be blocked as long as defending player controls the most creatures or is tied for the most.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(horror).some(
      (s) => s.condition?.kind === 'defending_player_controls_most_creatures',
    )).toBe(true);

    const host = {
      id: 'h', controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest' },
    };
    const embrace = P(
      "Nature's Embrace",
      'As long as enchanted permanent is a land, it has "{T}: Add two mana of any one color."',
      'Enchantment — Aura',
      { attachedTo: 'h' },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(embrace).some(
      (s) => s.condition?.kind === 'target_has_type' && String(s.sourcePermanentId) === 'h',
    )).toBe(true);

    const swiftOracle = 'Enchanted permanent is a Vehicle artifact with crew 5 and it loses all other card types.';
    const setting = parseAttachedTypeSettingFromOracle(swiftOracle);
    expect(setting?.cardTypes.map((c) => c.toLowerCase())).toEqual(expect.arrayContaining(['artifact']));
    expect(setting?.subtypes.map((c) => c.toLowerCase())).toEqual(expect.arrayContaining(['vehicle']));
    const swift = P('Swift Reconfiguration', swiftOracle, 'Enchantment — Aura', { attachedTo: 'h' });
    expect(parseStaticEffectSpecsFromOraclePermanent(swift).some(
      (s) => (s.grant.abilities || []).includes('crew 5'),
    )).toBe(true);
  });

  it('Gaddock + CDAs + damage doubles + Rite', () => {
    const teeg = P(
      'Gaddock Teeg',
      "Noncreature spells with mana value 4 or greater can't be cast.\nNoncreature spells with {X} in their mana costs can't be cast.",
    );
    const state: any = { battlefield: [teeg], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' };
    expect(castRestrictionTailViolation(state, 'p2', { name: 'Wrath', type_line: 'Sorcery', cmc: 4 }, 'hand')).toBeTruthy();
    expect(castRestrictionTailViolation(state, 'p2', { name: 'Bolt', type_line: 'Instant', cmc: 1 }, 'hand')).toBeNull();
    expect(castRestrictionTailViolation(
      state, 'p2', { name: 'Fireball', type_line: 'Sorcery', cmc: 1, mana_cost: '{X}{R}' }, 'hand',
    )).toBeTruthy();

    const exdeath = calculateVariablePT(
      {
        name: 'Neo Exdeath, Dimension\'s End',
        power: '*',
        toughness: '4',
        oracle_text: "Neo Exdeath's power is equal to the number of permanent cards in your graveyard.",
        controller: 'p1',
      },
      {
        battlefield: [],
        zones: { p1: { graveyard: [{ type_line: 'Artifact' }, { type_line: 'Creature' }, { type_line: 'Instant' }] } },
      },
    );
    expect(exdeath?.power).toBe(2);

    const chameleon = calculateVariablePT(
      {
        name: 'Chameleon Spirit',
        power: '*',
        toughness: '*',
        oracle_text: "Chameleon Spirit's power and toughness are each equal to the number of permanents of the chosen color your opponents control.",
        controller: 'p1',
        id: 'src',
      },
      {
        battlefield: [
          { id: 'src', controller: 'p1', chosenColor: 'U', card: { name: 'Chameleon Spirit', power: '*', toughness: '*', oracle_text: "Chameleon Spirit's power and toughness are each equal to the number of permanents of the chosen color your opponents control." } },
          { id: 'o1', controller: 'p2', card: { type_line: 'Creature', colors: ['U'] } },
          { id: 'o2', controller: 'p2', card: { type_line: 'Artifact', colors: ['U'] } },
          { id: 'o3', controller: 'p2', card: { type_line: 'Creature', colors: ['R'] } },
        ],
        zones: { p1: {}, p2: {} },
      },
    );
    expect(chameleon).toEqual({ power: 2, toughness: 2 });

    const wolf = collectBatch65DamageReplacementSpecs(
      'Double all damage Wolverine would deal.',
      { sourcePermanentId: 'w', sourceController: 'p1', sourceName: 'Wolverine, Best There Is' },
    );
    expect(wolf.some((s) => s.match?.damageSourceIsSource === true && s.instead?.modify === 'double')).toBe(true);

    const inferno = collectBatch65DamageReplacementSpecs(
      'Double all damage that sources you control of the chosen type would deal.',
      { sourcePermanentId: 'i', sourceController: 'p1', sourceName: 'Collective Inferno', chosenCreatureType: 'Dragon' },
    );
    expect(inferno.some((s) => s.match?.damageSourceHasCreatureType === 'dragon')).toBe(true);

    const rite = P(
      'Rite of the Raging Storm',
      "Creatures named Lightning Rager can't attack you or planeswalkers you control.",
      'Enchantment',
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(rite).some(
      (s) => s.condition?.kind === 'target_has_name',
    )).toBe(true);
  });

  it('classifiers cover B86 families', () => {
    const lines: Array<[string, string]> = [
      ['Green creatures have "Cumulative upkeep {1}."', 'Breath of Dreams'],
      ['Each Human creature you control has "{R}, {T}: This creature deals 1 damage to any target."', 'Titan of Eternal Fire'],
      ['Other Treefolk and Forests you control have indestructible.', 'Timber Protector'],
      ['Creatures you control are every creature type.', 'Maskwood Nexus'],
      ["This creature can't be blocked except by Walls and/or creatures with flying.", 'Elven Riders'],
      ["Tromokratis has hexproof unless it's attacking or blocking.", 'Tromokratis'],
      ["Tromokratis can't be blocked unless all creatures defending player controls block it.", 'Tromokratis'],
      ['Humans you control have each of the chosen abilities.', "Greymond, Avacyn's Stalwart"],
      ['As long as enchanted permanent is a land, it has "{T}: Add two mana of any one color."', "Nature's Embrace"],
      ['Enchanted permanent is a Vehicle artifact with crew 5 and it loses all other card types.', 'Swift Reconfiguration'],
      ["Creatures you control can't be the targets of blue spells or abilities from blue sources.", 'Spellbane Centaur'],
      ["This creature can't be blocked as long as defending player controls the most creatures or is tied for the most.", 'Hooded Horror'],
      ["Noncreature spells with mana value 4 or greater can't be cast.", 'Gaddock Teeg'],
      ["Noncreature spells with {X} in their mana costs can't be cast.", 'Gaddock Teeg'],
      ["Neo Exdeath's power is equal to the number of permanent cards in your graveyard.", "Neo Exdeath, Dimension's End"],
      ["Chameleon Spirit's power and toughness are each equal to the number of permanents of the chosen color your opponents control.", 'Chameleon Spirit'],
      ['Double all damage Wolverine would deal.', 'Wolverine, Best There Is'],
      ['Double all damage that sources you control of the chosen type would deal.', 'Collective Inferno'],
      ["Creatures named Lightning Rager can't attack you or planeswalkers you control.", 'Rite of the Raging Storm'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
