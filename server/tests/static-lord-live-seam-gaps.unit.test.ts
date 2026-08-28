import { describe, expect, it } from 'vitest';

import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  getContinuousPTBonusForPermanent,
} from '../src/state/modules/staticEffectSpec.js';

/** Oracle from mtg_data.db (is_token = 0). */
const REGISAUR_ALPHA =
  'Other Dinosaurs you control have haste.\nWhen this creature enters, create a 3/3 green Dinosaur creature token with trample.';
const GOBLIN_CHIEFTAIN =
  'Haste (This creature can attack and {T} as soon as it comes under your control.)\nOther Goblin creatures you control get +1/+1 and have haste.';
const SPIDER_PUNK =
  "Riot (This creature enters with your choice of a +1/+1 counter or haste.)\nOther Spiders you control have riot.\nSpells and abilities can't be countered.\nDamage can't be prevented.";
const SUBLIME_ARCHANGEL =
  'Flying\nExalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)\nOther creatures you control have exalted. (If a creature has multiple instances of exalted, each triggers separately.)';
const RHYTHM_OF_THE_WILD =
  "Creature spells you control can't be countered.\nNontoken creatures you control have riot. (They enter with your choice of a +1/+1 counter or haste.)";
const CHIEF_OF_THE_FOUNDRY =
  'Other artifact creatures you control get +1/+1.';
const THOPTER_ENGINEER =
  'When this creature enters, create a 1/1 colorless Thopter artifact creature token with flying.\nArtifact creatures you control have haste. (They can attack and {T} as soon as they come under your control.)';
const TEMPERED_STEEL =
  'Artifact creatures you control get +2/+2.';
const HELLSPUR_POSSE_BOSS =
  'Other outlaws you control have haste. (Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws.)\nWhen this creature enters, create two 1/1 red Mercenary creature tokens with "{T}: Target creature you control gets +1/+0 until end of turn. Activate only as a sorcery."';

function battlefieldPerm(
  id: string,
  name: string,
  typeLine: string,
  oracleText: string,
) {
  return {
    id,
    controller: 'p1',
    card: {
      name,
      type_line: typeLine,
      oracle_text: oracleText,
    },
  };
}

describe('static lord live-seam gaps', () => {
  it('parses riot/exalted have lords that previously produced 0 specs', () => {
    const spiderPunk = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('punk_1', 'Spider-Punk', 'Legendary Creature — Spider Human Hero', SPIDER_PUNK) as any,
    );
    const spiderGrant = spiderPunk.find((spec) => spec.grant.abilities?.includes('riot'));
    expect(spiderGrant).toMatchObject({
      scope: { kind: 'other_creatures_you_control', creatureType: 'spider' },
      grant: { abilities: expect.arrayContaining(['riot']) },
    });

    const archangel = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('sublime_1', 'Sublime Archangel', 'Creature — Angel', SUBLIME_ARCHANGEL) as any,
    );
    expect(archangel.some((spec) => (
      spec.scope.kind === 'other_creatures_you_control'
      && spec.grant.abilities?.includes('exalted')
    ))).toBe(true);

    const rhythm = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('rhythm_1', 'Rhythm of the Wild', 'Enchantment', RHYTHM_OF_THE_WILD) as any,
    );
    expect(rhythm).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'creatures_you_control' },
        grant: { abilities: ['riot'] },
        condition: { kind: 'target_is_not_token' },
      }),
    ]));
  });

  it('parses artifact-creature lords with target_has_type, not subtype artifact', () => {
    const foundry = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('foundry_1', 'Chief of the Foundry', 'Artifact Creature — Construct', CHIEF_OF_THE_FOUNDRY) as any,
    );
    expect(foundry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control' },
        grant: expect.objectContaining({ power: 1, toughness: 1 }),
        condition: { kind: 'target_has_type', cardType: 'artifact' },
      }),
    ]));
    expect(foundry.some((spec) => spec.scope.creatureType === 'artifact')).toBe(false);

    const engineer = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('engineer_1', 'Thopter Engineer', 'Creature — Human Artificer', THOPTER_ENGINEER) as any,
    );
    expect(engineer).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'creatures_you_control' },
        grant: { abilities: ['haste'] },
        condition: { kind: 'target_has_type', cardType: 'artifact' },
      }),
    ]));

    const steel = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('steel_1', 'Tempered Steel', 'Enchantment', TEMPERED_STEEL) as any,
    );
    expect(steel.some((spec) => spec.id.endsWith(':creatures-anthem'))).toBe(false);
    expect(steel).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'creatures_you_control' },
        grant: expect.objectContaining({ power: 2, toughness: 2 }),
        condition: { kind: 'target_has_type', cardType: 'artifact' },
      }),
    ]));

    const state = {
      battlefield: [
        battlefieldPerm('foundry_1', 'Chief of the Foundry', 'Artifact Creature — Construct', CHIEF_OF_THE_FOUNDRY),
        battlefieldPerm('thopter_1', 'Thopter Token', 'Artifact Creature — Thopter', ''),
        battlefieldPerm('bear_1', 'Grizzly Bears', 'Creature — Bear', ''),
      ],
    };
    expect(getContinuousPTBonusForPermanent(state.battlefield[1] as any, state)).toEqual({ power: 1, toughness: 1 });
    expect(getContinuousPTBonusForPermanent(state.battlefield[0] as any, state)).toEqual({ power: 0, toughness: 0 });
    expect(getContinuousPTBonusForPermanent(state.battlefield[2] as any, state)).toEqual({ power: 0, toughness: 0 });
  });

  it('parses outlaw designation lords (not a creature type)', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'boss_1',
        'Hellspur Posse Boss',
        'Creature — Lizard Rogue',
        HELLSPUR_POSSE_BOSS,
      ) as any,
    );
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control' },
        grant: { abilities: ['haste'] },
        condition: { kind: 'target_is_outlaw' },
      }),
    ]));
    expect(specs.some((spec) => spec.scope.creatureType === 'outlaw')).toBe(false);

    const state = {
      battlefield: [
        battlefieldPerm('boss_1', 'Hellspur Posse Boss', 'Creature — Lizard Rogue', HELLSPUR_POSSE_BOSS),
        battlefieldPerm('rogue_1', 'Changeling Outlaw', 'Creature — Shapeshifter Rogue', ''),
        battlefieldPerm('bear_1', 'Grizzly Bears', 'Creature — Bear', ''),
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state)).toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0] as any, state)).not.toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[2] as any, state)).not.toContain('haste');
  });

  it('still parses Regisaur Alpha and Goblin Chieftain', () => {
    const regisaur = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('regisaur_1', 'Regisaur Alpha', 'Creature — Dinosaur', REGISAUR_ALPHA) as any,
    );
    expect(regisaur).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control', creatureType: 'dinosaur' },
        grant: { abilities: ['haste'] },
      }),
    ]));

    const chieftain = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm('chieftain_1', 'Goblin Chieftain', 'Creature — Goblin', GOBLIN_CHIEFTAIN) as any,
    );
    expect(chieftain).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control', creatureType: 'goblin' },
        grant: expect.objectContaining({
          power: 1,
          toughness: 1,
          abilities: expect.arrayContaining(['haste']),
        }),
      }),
    ]));

    const dinoState = {
      battlefield: [
        battlefieldPerm('regisaur_1', 'Regisaur Alpha', 'Creature — Dinosaur', REGISAUR_ALPHA),
        battlefieldPerm('dino_1', 'Earthshaker Dreadmaw', 'Creature — Dinosaur', ''),
        battlefieldPerm('bear_1', 'Grizzly Bears', 'Creature — Bear', ''),
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(dinoState.battlefield[1] as any, dinoState)).toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(dinoState.battlefield[0] as any, dinoState)).not.toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(dinoState.battlefield[2] as any, dinoState)).not.toContain('haste');
  });

  it('parses color paragons, irregular plurals, permanents, and keyword grants', () => {
    const paragon = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'paragon_1',
        'Paragon of Fierce Defiance',
        'Creature — Human Warrior',
        'Other red creatures you control get +1/+1.',
      ) as any,
    );
    expect(paragon).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'other_creatures_you_control' },
        grant: expect.objectContaining({ power: 1, toughness: 1 }),
        condition: { kind: 'target_has_mana_color', color: 'red' },
      }),
    ]));

    const magda = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'magda_1',
        'Magda, Brazen Outlaw',
        'Legendary Creature — Dwarf Berserker',
        'Other Dwarves you control get +1/+0.',
      ) as any,
    );
    expect(magda.some((spec) => spec.scope.creatureType === 'dwarf' && spec.grant.power === 1)).toBe(true);

    const sokka = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'sokka_1',
        'Sokka, Tenacious Tactician',
        'Legendary Creature — Human Warrior Ally',
        'Other Allies you control have menace and prowess.',
      ) as any,
    );
    expect(sokka.some((spec) => (
      spec.scope.creatureType === 'ally'
      && spec.grant.abilities?.includes('menace')
      && spec.grant.abilities?.includes('prowess')
    ))).toBe(true);

    const villain = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'doc_1',
        'Doctor Octopus, Master Planner',
        'Legendary Creature — Human Scientist Villain',
        'Other Villains you control get +2/+2.',
      ) as any,
    );
    expect(villain.some((spec) => spec.scope.creatureType === 'villain' && spec.grant.power === 2)).toBe(true);

    const avacyn = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'avacyn_1',
        'Avacyn, Angel of Hope',
        'Legendary Creature — Angel',
        'Flying, vigilance, indestructible\nOther permanents you control have indestructible.',
      ) as any,
    );
    expect(avacyn).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'other_permanents_you_control' },
        grant: { abilities: ['indestructible'] },
      }),
    ]));

    const marchesa = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'marchesa_1',
        'Marchesa, the Black Rose',
        'Legendary Creature — Human Wizard',
        'Other creatures you control have dethrone.',
      ) as any,
    );
    expect(marchesa.some((spec) => spec.grant.abilities?.includes('dethrone'))).toBe(true);

    const dalakos = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'dalakos_1',
        'Dalakos, Crafter of Wonders',
        'Legendary Creature — Merfolk Artificer',
        'Equipped creatures you control have flying and haste.',
      ) as any,
    );
    expect(dalakos).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: { kind: 'creatures_you_control' },
        grant: { abilities: expect.arrayContaining(['flying', 'haste']) },
        condition: { kind: 'target_is_equipped' },
      }),
    ]));
  });

  it('parses numeric keyword grants (afflict / toxic / fabricate / outlast)', () => {
    const cyberman = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'cyber_1',
        'Cyberman Patrol',
        'Artifact Creature — Cyberman',
        'Artifact creatures you control have afflict 3. (Whenever a creature with afflict 3 becomes blocked, defending player loses 3 life.)',
      ) as any,
    );
    expect(cyberman.some((spec) => spec.grant.abilities?.includes('afflict 3'))).toBe(true);

    const karumonix = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'karu_1',
        'Karumonix, the Rat King',
        'Legendary Creature — Phyrexian Rat',
        'Toxic 1\nOther Rats you control have toxic 1.',
      ) as any,
    );
    expect(karumonix.some((spec) => (
      spec.scope.creatureType === 'rat'
      && spec.grant.abilities?.includes('toxic 1')
    ))).toBe(true);

    const cayth = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'cayth_1',
        'Cayth, Famed Mechanist',
        'Legendary Creature — Dwarf Artificer',
        'Fabricate 1\nOther nontoken creatures you control have fabricate 1.',
      ) as any,
    );
    expect(cayth.some((spec) => (
      spec.condition?.kind === 'target_is_not_token'
      && spec.grant.abilities?.includes('fabricate 1')
    ))).toBe(true);

    const enduring = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'enduring_1',
        'Enduring Sliver',
        'Creature — Sliver',
        'Outlast {2}\nOther Sliver creatures you control have outlast {2}.',
      ) as any,
    );
    expect(enduring.some((spec) => spec.grant.abilities?.some((ability) => /outlast \{2\}/i.test(ability)))).toBe(true);
  });

  it('parses quoted activated and triggered have-grants', () => {
    const phenax = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'phenax_1',
        'Phenax, God of Deception',
        'Legendary Enchantment Creature — God',
        'Creatures you control have "{T}: Target player mills X cards, where X is this creature\'s toughness."',
      ) as any,
    );
    expect(phenax.some((spec) => spec.grant.abilities?.some((ability) => /\{t\}:.*mills/i.test(ability)))).toBe(true);

    const monument = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'monument_1',
        'Forgotten Monument',
        'Land — Cave',
        'Other Caves you control have "{T}, Pay 1 life: Add one mana of any color."',
      ) as any,
    );
    expect(monument.some((spec) => (
      spec.scope.kind === 'other_permanents_you_control'
      && spec.condition?.kind === 'target_has_type'
      && spec.grant.abilities?.some((ability) => /tap_for_any_color|pay 1 life/i.test(ability))
    ))).toBe(true);

    const grothama = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'grothama_1',
        'Grothama, All-Devouring',
        'Legendary Creature — Wurm',
        'Other creatures have "Whenever this creature attacks, you may have it fight Grothama, All-Devouring."',
      ) as any,
    );
    expect(grothama.some((spec) => (
      spec.scope.kind === 'other_all_creatures'
      && spec.grant.abilities?.some((ability) => /whenever this creature attacks/i.test(ability))
    ))).toBe(true);
  });

  it('parses city\'s blessing, historic-during-turn, and base P/T setters', () => {
    const wanderglyph = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'glyph_1',
        'Illustrious Wanderglyph',
        'Artifact Creature — Golem',
        'Other artifact creatures you control get +2/+2 as long as you have the city\'s blessing.',
      ) as any,
    );
    expect(wanderglyph.some((spec) => (
      spec.grant.power === 2
      && spec.condition?.kind === 'target_has_type'
      && spec.conditions?.some((condition) => condition.kind === 'source_controller_has_citys_blessing')
    ))).toBe(true);

    const bayek = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'bayek_1',
        'Bayek of Siwa',
        'Legendary Creature — Human Assassin',
        'During your turn, other historic creatures you control have double strike.',
      ) as any,
    );
    expect(bayek.some((spec) => (
      spec.grant.abilities?.includes('double strike')
      && spec.condition?.kind === 'target_is_historic_during_source_controller_turn'
    ))).toBe(true);

    const kudo = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'kudo_1',
        'Kudo, King Among Bears',
        'Legendary Creature — Bear',
        'Other creatures have base power and toughness 2/2 and are Bears in addition to their other types.',
      ) as any,
    );
    expect(kudo.some((spec) => spec.grant.setPower === 2 && spec.grant.setToughness === 2)).toBe(true);
    expect(kudo.some((spec) => spec.grant.typeAdditions?.includes('bear'))).toBe(true);

    const steward = parseStaticEffectSpecsFromOraclePermanent(
      battlefieldPerm(
        'steward_1',
        'Steward of the Harvest',
        'Creature — Human Druid',
        'When this creature enters, exile up to three target land cards from your graveyard.\nCreatures you control have all activated abilities of all land cards exiled with this creature.',
      ) as any,
    );
    expect(steward.some((spec) => spec.grant.copyActivatedFromExiledWithCardType === 'land')).toBe(true);
  });
});

