import { describe, expect, it } from 'vitest';

import {
  parseEquipAbilitiesFromOracle,
  permanentMatchesEquipQualifier,
} from '../../shared/src/equipAbilities.js';
import {
  attachmentOracleGrantsKeyword,
  getAttachmentGrantedKeywords,
  parseAttachmentGrantedKeywordsFromOracle,
} from '../../shared/src/attachmentKeywordGrants.js';
import {
  getAttachmentGrantedActivatedAbilityTexts,
  parseAttachmentGrantedAbilityTextsFromOracle,
} from '../../shared/src/attachmentAbilityGrants.js';
import { detectSpellCastTriggers, getDeathTriggers } from '../src/state/modules/triggered-abilities.js';
import { transformPermanentToFace } from '../src/state/modules/day-night.js';
import {
  applyTriggerDoublers,
  detectTriggerDoublers,
  playerHasDungeonRoomAbilityDoubler,
  pushTriggerDoublerCopies,
} from '../src/state/modules/triggers/combat.js';

const WIZARDS_STAFF_ORACLE = `Equipped creature has prowess. (Whenever its controller casts a noncreature spell, that creature gets +1/+1 until end of turn.)
If a triggered ability of equipped creature triggers, that ability triggers an additional time.
Equip Wizard {1}
Equip {3}`;

describe('equip abilities + attachment grants', () => {
  it('parses Equip Wizard / Equip {cost} / Equip legendary creature', () => {
    const staff = parseEquipAbilitiesFromOracle(WIZARDS_STAFF_ORACLE);
    expect(staff).toEqual([
      expect.objectContaining({
        index: 0,
        cost: '{1}',
        qualifier: expect.objectContaining({ kind: 'creature_types', creatureTypes: ['wizard'] }),
      }),
      expect.objectContaining({
        index: 1,
        cost: '{3}',
        qualifier: expect.objectContaining({ kind: 'any' }),
      }),
    ]);

    const blackblade = parseEquipAbilitiesFromOracle(
      'Equipped creature gets +1/+1 for each land you control.\nEquip legendary creature {3}\nEquip {7}',
    );
    expect(blackblade.map((e) => ({ cost: e.cost, kind: e.qualifier.kind }))).toEqual([
      { cost: '{3}', kind: 'legendary' },
      { cost: '{7}', kind: 'any' },
    ]);
  });

  it('parses compound creature-type and semantic Equip qualifiers', () => {
    const robe = parseEquipAbilitiesFromOracle(
      'Equipped creature has ward {4}\nEquip Shaman, Warlock, or Wizard {2}\nEquip {4}',
    );
    expect(robe[0]?.qualifier).toEqual({
      kind: 'creature_types',
      creatureTypes: ['shaman', 'warlock', 'wizard'],
      raw: 'Shaman, Warlock, or Wizard',
    });

    const luxior = parseEquipAbilitiesFromOracle(
      'Equipped creature or planeswalker gets +1/+1\nEquip creature or planeswalker {3}\nEquip {6}',
    );
    expect(luxior[0]?.qualifier.kind).toBe('creature_or_planeswalker');

    const plate = parseEquipAbilitiesFromOracle(
      "Equipped creature gets protection\nEquip commander {2}\nEquip {4}",
    );
    expect(plate[0]?.qualifier.kind).toBe('commander');

    // Do not treat "Equip ability costs …" as an Equip activation
    const ghostfire = parseEquipAbilitiesFromOracle(
      'Equipped creature gets +2/+2.\nEquip {3}\nEquip ability costs {1} less to activate for each color among permanents you control.',
    );
    expect(ghostfire.map((e) => e.cost)).toEqual(['{3}']);
  });

  it('matches Equip targets by qualifier', () => {
    const wizard = {
      id: 'w1',
      controller: 'p1',
      isCommander: false,
      card: { name: 'Snapcaster Mage', type_line: 'Creature — Human Wizard', oracle_text: '' },
    };
    const cat = {
      id: 'c1',
      controller: 'p1',
      card: { name: 'Lion', type_line: 'Creature — Cat', oracle_text: '' },
    };
    const legend = {
      id: 'l1',
      controller: 'p1',
      isCommander: true,
      card: { name: 'Atraxa', type_line: 'Legendary Creature — Phyrexian Angel Horror', oracle_text: '' },
    };
    const token = {
      id: 't1',
      controller: 'p1',
      isToken: true,
      card: { name: 'Soldier', type_line: 'Creature — Soldier', oracle_text: '' },
    };
    const walker = {
      id: 'pw1',
      controller: 'p1',
      card: { name: 'Jace', type_line: 'Legendary Planeswalker — Jace', oracle_text: '' },
    };

    const wizardEquip = parseEquipAbilitiesFromOracle('Equip Wizard {1}')[0]!;
    expect(permanentMatchesEquipQualifier(wizard, wizardEquip.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(cat, wizardEquip.qualifier)).toBe(false);

    const legendaryEquip = parseEquipAbilitiesFromOracle('Equip legendary creature {3}')[0]!;
    expect(permanentMatchesEquipQualifier(legend, legendaryEquip.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(cat, legendaryEquip.qualifier)).toBe(false);

    const commanderEquip = parseEquipAbilitiesFromOracle('Equip commander {2}')[0]!;
    expect(permanentMatchesEquipQualifier(legend, commanderEquip.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(wizard, commanderEquip.qualifier)).toBe(false);

    const tokenEquip = parseEquipAbilitiesFromOracle('Equip creature token {1}')[0]!;
    expect(permanentMatchesEquipQualifier(token, tokenEquip.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(wizard, tokenEquip.qualifier)).toBe(false);

    const pwEquip = parseEquipAbilitiesFromOracle('Equip planeswalker {3}')[0]!;
    expect(permanentMatchesEquipQualifier(walker, pwEquip.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(wizard, pwEquip.qualifier)).toBe(false);

    const either = parseEquipAbilitiesFromOracle('Equip creature or planeswalker {3}')[0]!;
    expect(permanentMatchesEquipQualifier(wizard, either.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(walker, either.qualifier)).toBe(true);

    const crewedVehicle = {
      id: 'talon_1',
      controller: 'p1',
      crewed: true,
      grantedTypes: ['Creature'],
      card: {
        name: 'Royal Talon Fighter Jet',
        type_line: 'Artifact � Vehicle',
        oracle_text: 'Flying, vigilance\nCrew 2',
      },
    };
    const uncrewedVehicle = {
      id: 'talon_2',
      controller: 'p1',
      crewed: false,
      card: {
        name: 'Royal Talon Fighter Jet',
        type_line: 'Artifact � Vehicle',
        oracle_text: 'Flying, vigilance\nCrew 2',
      },
    };
    const anyEquip = parseEquipAbilitiesFromOracle('Equip {2}')[0]!;
    expect(permanentMatchesEquipQualifier(crewedVehicle, anyEquip.qualifier)).toBe(true);
    expect(permanentMatchesEquipQualifier(uncrewedVehicle, anyEquip.qualifier)).toBe(false);
  });

  it('parses equipment keyword grants including prowess', () => {
    expect(parseAttachmentGrantedKeywordsFromOracle(WIZARDS_STAFF_ORACLE)).toEqual(['prowess']);
    expect(attachmentOracleGrantsKeyword(WIZARDS_STAFF_ORACLE, 'prowess')).toBe(true);
    expect(
      parseAttachmentGrantedKeywordsFromOracle('Equipped creature has first strike and haste.'),
    ).toEqual(expect.arrayContaining(['first strike', 'haste']));
    expect(
      parseAttachmentGrantedKeywordsFromOracle('Equipped creature has hexproof and haste.\nEquip {1}'),
    ).toEqual(expect.arrayContaining(['hexproof', 'haste']));
  });

  it('grants prowess spell-cast trigger to the equipped creature, not the equipment', () => {
    const staff = {
      id: 'staff1',
      controller: 'p1',
      attachedTo: 'wiz1',
      card: {
        name: "Wizard's Staff",
        type_line: 'Artifact — Equipment',
        oracle_text: WIZARDS_STAFF_ORACLE,
      },
    };
    const wizard = {
      id: 'wiz1',
      controller: 'p1',
      card: {
        name: 'Snapcaster Mage',
        type_line: 'Creature — Human Wizard',
        oracle_text: 'Flash',
      },
    };
    const state = { battlefield: [staff, wizard] };

    expect(detectSpellCastTriggers(staff.card, staff, state)).toEqual([]);
    expect(getAttachmentGrantedKeywords(wizard, state.battlefield)).toEqual(['prowess']);

    const wizardTriggers = detectSpellCastTriggers(wizard.card, wizard, state);
    expect(wizardTriggers.some((t) => t.spellCondition === 'noncreature' && /prowess|gets \+1\/\+1/i.test(t.description))).toBe(true);
  });

  it('categorizes all paper "triggers an additional time" corpus templates', () => {
    const samples: Array<{ name: string; oracle_text: string; chosenCreatureType?: string }> = [
      { name: 'Ancient Greenwarden', oracle_text: 'If a land entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Annie Joins Up', oracle_text: 'If a triggered ability of a legendary creature you control triggers, that ability triggers an additional time.' },
      { name: 'Clara Oswald', oracle_text: 'If a triggered ability of a Doctor you control triggers, that ability triggers an additional time.' },
      { name: 'Cloud, Midgar Mercenary', oracle_text: 'As long as Cloud is equipped, if a triggered ability of Cloud or an Equipment attached to it triggers, that ability triggers an additional time.' },
      { name: 'Delney, Streetwise Lookout', oracle_text: 'If a triggered ability of a creature you control with power 2 or less triggers, that ability triggers an additional time.' },
      { name: 'Echoes of Eternity', oracle_text: 'If a triggered ability of a colorless spell you control or another colorless permanent you control triggers, that ability triggers an additional time.' },
      { name: 'Felix Five-Boots', oracle_text: 'If a creature you control dealing combat damage to a player causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Gandalf the White', oracle_text: 'If a legendary permanent or an artifact entering or leaving the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Harmonic Prodigy', oracle_text: 'If a triggered ability of a Shaman or another Wizard you control triggers, that ability triggers an additional time.' },
      { name: 'Katara, the Fearless', oracle_text: 'If a triggered ability of an Ally you control triggers, that ability triggers an additional time.' },
      { name: 'Krang, the All-Powerful', oracle_text: 'If a player drawing a card causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Naban, Dean of Iteration', oracle_text: 'If a Wizard you control entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Panoptic Projektor', oracle_text: 'If turning a face-down permanent face up causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Sanctum of All', oracle_text: 'If a triggered ability of another Shrine you control triggers while you control six or more Shrines, that ability triggers an additional time.' },
      { name: 'Splinter, Radical Rat', oracle_text: 'If a triggered ability of a Ninja creature you control triggers, that ability triggers an additional time.' },
      { name: 'Traveling Chocobo', oracle_text: 'If a land or Bird you control entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Twinflame Travelers', oracle_text: 'If a triggered ability of another Elemental you control triggers, it triggers an additional time.' },
      { name: 'Veyran, Voice of Duality', oracle_text: 'If you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Wayta, Trainer Prodigy', oracle_text: 'If a creature you control being dealt damage causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Wizard from Beyond', oracle_text: 'As long as you have a full party, if an ability of a creature you control triggers, that ability triggers an additional time.' },
      { name: 'Wulfgar of Icewind Dale', oracle_text: 'If a creature you control attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' },
      { name: 'Roaming Throne', oracle_text: 'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.', chosenCreatureType: 'Eldrazi' },
    ];

    for (const sample of samples) {
      const perm = {
        id: 'src',
        controller: 'p1',
        chosenCreatureType: sample.chosenCreatureType,
        card: { name: sample.name, oracle_text: sample.oracle_text, type_line: 'Creature' },
      };
      const found = detectTriggerDoublers([perm], 'p1');
      expect(found.length, sample.name).toBeGreaterThan(0);
      expect(found[0]?.unsupportedReason === 'unparsed_additional_time_template', sample.name).toBe(false);
    }
  });

  it('detects Echoes of Eternity colorless-source doubler and stacks with Staff/Throne', () => {
    const echoesOracle =
      'If a triggered ability of a colorless spell you control or another colorless permanent you control triggers, that ability triggers an additional time.\nWhenever you cast a colorless spell, copy it. You may choose new targets for the copy.';
    const staffOracle =
      'If a triggered ability of equipped creature triggers, that ability triggers an additional time.';
    const throneOracle =
      'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.';

    const crusher = {
      id: 'crusher',
      controller: 'p1',
      card: {
        name: "Ulamog's Crusher",
        type_line: 'Creature — Eldrazi',
        oracle_text: 'Annihilator 2',
        colors: [],
        mana_cost: '{8}',
      },
    };
    const colored = {
      id: 'bear',
      controller: 'p1',
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: 'Whenever this creature attacks, draw a card.',
        colors: ['G'],
        mana_cost: '{1}{G}',
      },
    };
    const battlefield = [
      crusher,
      colored,
      {
        id: 'echoes',
        controller: 'p1',
        card: {
          name: 'Echoes of Eternity',
          type_line: 'Kindred Enchantment — Eldrazi',
          oracle_text: echoesOracle,
          colors: [],
        },
      },
      {
        id: 'staff',
        controller: 'p1',
        attachedTo: 'crusher',
        card: {
          name: "Wizard's Staff",
          type_line: 'Artifact — Equipment',
          oracle_text: staffOracle,
          colors: [],
        },
      },
      {
        id: 'throne',
        controller: 'p1',
        chosenCreatureType: 'Eldrazi',
        card: {
          name: 'Roaming Throne',
          type_line: 'Artifact Creature — Golem',
          oracle_text: throneOracle,
          colors: [],
        },
      },
    ];

    const doublers = detectTriggerDoublers(battlefield, 'p1');
    expect(doublers.some((d) => d.cardName === 'Echoes of Eternity' && d.colorlessSourceOnly)).toBe(true);
    expect(doublers).toHaveLength(3);

    const base = [{
      permanentId: 'crusher',
      cardName: "Ulamog's Crusher",
      controllerId: 'p1',
      description: 'Defending player sacrifices 2 permanents',
      effect: 'Defending player sacrifices 2 permanents',
      mandatory: true,
    }];
    expect(applyTriggerDoublers(base as any, doublers, 'attack', crusher, battlefield)).toHaveLength(4);

    const coloredTrig = [{
      permanentId: 'bear',
      cardName: 'Grizzly Bears',
      controllerId: 'p1',
      description: 'draw a card',
      effect: 'draw a card',
      mandatory: true,
    }];
    // Echoes should not apply; Staff not attached; Throne type filter fails → only original
    expect(applyTriggerDoublers(coloredTrig as any, doublers, 'attack', colored, battlefield)).toHaveLength(1);
  });

  it('parses quoted activated grants from Equipment onto the host', () => {
    const longbowOracle =
      'Equipped creature has "{T}: This creature deals 1 damage to any target."\nEquip {3}';
    const mantleOracle =
      'Equipped creature has "{3}, {Q}: This creature gets +2/+2 until end of turn."\nEquip {0}';

    expect(parseAttachmentGrantedAbilityTextsFromOracle(longbowOracle)).toEqual([
      '{T}: This creature deals 1 damage to any target.',
    ]);
    expect(parseAttachmentGrantedAbilityTextsFromOracle(mantleOracle)).toEqual([
      '{3}, {Q}: This creature gets +2/+2 until end of turn.',
    ]);

    const host = {
      id: 'host1',
      controller: 'p1',
      card: { id: 'host-card', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const longbow = {
      id: 'bow1',
      controller: 'p1',
      attachedTo: 'host1',
      card: {
        name: 'Viridian Longbow',
        type_line: 'Artifact — Equipment',
        oracle_text: longbowOracle,
      },
    };
    const battlefield = [host, longbow];
    expect(getAttachmentGrantedActivatedAbilityTexts(host, battlefield)).toEqual([
      '{T}: This creature deals 1 damage to any target.',
    ]);
  });

  it('detects Masamune death doubler on the equipped creature and owned emblems', () => {
    const masamuneOracle =
      'As long as equipped creature is attacking, it has first strike and must be blocked if able.\n' +
      'Equipped creature has "If a creature dying causes a triggered ability of this creature or an emblem you own to trigger, that ability triggers an additional time."\n' +
      'Equip {2}';
    const masamune = {
      id: 'masa1',
      controller: 'p1',
      attachedTo: 'host1',
      card: {
        name: 'The Masamune',
        type_line: 'Legendary Artifact — Equipment',
        oracle_text: masamuneOracle,
      },
    };
    const host = {
      id: 'host1',
      controller: 'p1',
      card: {
        name: 'Teysa',
        type_line: 'Legendary Creature — Human Advisor',
        oracle_text: 'Whenever a creature dies, create a 1/1 white Spirit.',
      },
    };
    const battlefield = [masamune, host];
    const doublers = detectTriggerDoublers(battlefield, 'p1');
    expect(doublers).toEqual([
      expect.objectContaining({
        permanentId: 'masa1',
        equippedCreatureOnly: true,
        ownedEmblemAlso: true,
        triggerTypeFilter: 'death',
        causeFilters: ['death'],
      }),
    ]);
    expect(doublers[0]?.unsupportedReason).toBeUndefined();

    const trig = [{
      permanentId: 'host1',
      cardName: 'Teysa',
      controllerId: 'p1',
      description: 'create a Spirit',
      effect: 'create a Spirit',
      mandatory: true,
    }];
    expect(applyTriggerDoublers(trig as any, doublers, 'death', host, battlefield, { cause: 'death' })).toHaveLength(2);

    const emblemSource = {
      id: 'emblem1',
      controller: 'p1',
      isEmblem: true,
      card: {
        name: 'Sephiroth, One-Winged Angel Emblem',
        type_line: 'Emblem',
        oracle_text: 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.',
      },
    };
    const emblemTrig = [{
      permanentId: 'emblem1',
      cardName: 'Sephiroth, One-Winged Angel Emblem',
      controllerId: 'p1',
      description: 'target opponent loses 1 life and you gain 1 life',
      effect: 'target opponent loses 1 life and you gain 1 life',
      mandatory: true,
    }];
    expect(applyTriggerDoublers(emblemTrig as any, doublers, 'death', emblemSource, battlefield, { cause: 'death' })).toHaveLength(2);

    // Opponent-owned emblem is not doubled
    const foeEmblem = { ...emblemSource, id: 'emblem2', controller: 'p2' };
    const foeTrig = [{ ...emblemTrig[0], permanentId: 'emblem2', controllerId: 'p2' }];
    expect(applyTriggerDoublers(foeTrig as any, doublers, 'death', foeEmblem, battlefield, { cause: 'death' })).toHaveLength(1);

    const state = {
      battlefield,
      emblems: [{
        id: 'emblem1',
        controller: 'p1',
        sourceName: 'Sephiroth, One-Winged Angel',
        effect: 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.',
      }],
      stack: [{
        id: 't1',
        controller: 'p1',
        source: 'emblem1',
        permanentId: 'emblem1',
        sourceName: 'Sephiroth, One-Winged Angel Emblem',
        description: 'target opponent loses 1 life and you gain 1 life',
        effect: 'target opponent loses 1 life and you gain 1 life',
        triggerType: 'creature_dies',
        isEmblemSource: true,
      }],
    };
    pushTriggerDoublerCopies(state, state.stack[0]);
    expect(state.stack).toHaveLength(2);
  });

  it('creates Super Nova emblem when transforming into the back face', () => {
    const permanent = {
      id: 'seph1',
      controller: 'p1',
      transformed: false,
      card: {
        name: 'Sephiroth, Fabled SOLDIER',
        layout: 'transform',
        type_line: 'Legendary Creature — Human Avatar Soldier // Legendary Creature — Angel Nightmare Avatar',
        oracle_text: 'Whenever another creature dies, target opponent loses 1 life and you gain 1 life.',
        card_faces: [
          {
            name: 'Sephiroth, Fabled SOLDIER',
            type_line: 'Legendary Creature — Human Avatar Soldier',
            oracle_text: 'Whenever another creature dies, target opponent loses 1 life and you gain 1 life.',
            power: '3',
            toughness: '3',
          },
          {
            name: 'Sephiroth, One-Winged Angel',
            type_line: 'Legendary Creature — Angel Nightmare Avatar',
            oracle_text:
              'Flying\nSuper Nova — As this creature transforms into Sephiroth, One-Winged Angel, you get an emblem with "Whenever a creature dies, target opponent loses 1 life and you gain 1 life."\nWhenever Sephiroth attacks, you may sacrifice any number of other creatures. If you do, draw that many cards.',
            power: '5',
            toughness: '5',
          },
        ],
      },
    };
    const ctx = { state: { battlefield: [permanent], emblems: [] } };
    transformPermanentToFace(permanent, 1, ctx as any);
    expect(permanent.transformed).toBe(true);
    expect(ctx.state.emblems).toEqual([
      expect.objectContaining({
        controller: 'p1',
        sourceName: 'Sephiroth, One-Winged Angel',
        effect: 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.',
      }),
    ]);
  });

  it('emits death triggers from owned emblems (Sephiroth Super Nova)', () => {
    const dying = {
      id: 'chump',
      controller: 'p2',
      card: { name: 'Soldier', type_line: 'Creature — Soldier', oracle_text: '' },
    };
    const ctx = {
      state: {
        battlefield: [dying],
        emblems: [{
          id: 'emblem1',
          controller: 'p1',
          sourceName: 'Sephiroth, One-Winged Angel',
          effect: 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.',
        }],
      },
    };
    const triggers = getDeathTriggers(ctx as any, dying, 'p2');
    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({
          permanentId: 'emblem1',
          controllerId: 'p1',
          isEmblem: true,
        }),
        effect: expect.stringMatching(/target opponent loses 1 life and you gain 1 life/i),
      }),
    ]));
  });

  it('detects dungeon room and Fish Brewer doublers', () => {
    const hama = {
      id: 'hama',
      controller: 'p1',
      card: {
        name: 'Hama Pashar, Ruin Seeker',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text: 'Room abilities of dungeons you own trigger an additional time.',
      },
    };
    const delver = {
      id: 'delver',
      controller: 'p1',
      card: {
        name: 'Dungeon Delver',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: 'Commander creatures you own have "Room abilities of dungeons you own trigger an additional time."',
      },
    };
    const fishBrewer = {
      id: 'brewer',
      controller: 'p1',
      card: {
        name: 'The Fish Brewer',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text:
          'When The Fish Brewer enters the battlefield or attacks, create a 1/1 Fish creature token that\'s all colors.\n' +
          'If another permanent entering the battlefield causes a triggered ability of a permanent you control to trigger, tap any number of Fish you control. That ability triggers an additional time for each Fish tapped this way.',
      },
    };

    const hamaDoublers = detectTriggerDoublers([hama], 'p1');
    expect(hamaDoublers).toEqual([
      expect.objectContaining({ dungeonRoomAbilities: true }),
    ]);
    expect(hamaDoublers[0]?.unsupportedReason).toBeUndefined();
    const delverDoublers = detectTriggerDoublers([delver], 'p1');
    expect(delverDoublers).toEqual([
      expect.objectContaining({ dungeonRoomAbilities: true }),
    ]);
    expect(delverDoublers[0]?.unsupportedReason).toBeUndefined();
    expect(playerHasDungeonRoomAbilityDoubler({ battlefield: [hama] }, 'p1')).toBe(true);
    // Background grants only while controlled on the battlefield — not from command zone.
    expect(playerHasDungeonRoomAbilityDoubler({
      battlefield: [],
      commandZone: { p1: { commanderCards: [delver.card] } },
    }, 'p1')).toBe(false);
    expect(playerHasDungeonRoomAbilityDoubler({ battlefield: [delver] }, 'p1')).toBe(true);

    const fish1 = {
      id: 'f1',
      controller: 'p1',
      tapped: false,
      card: { name: 'Fish', type_line: 'Creature — Fish', oracle_text: '' },
    };
    const fish2 = {
      id: 'f2',
      controller: 'p1',
      tapped: false,
      card: { name: 'Fish', type_line: 'Creature — Fish', oracle_text: '' },
    };
    const land = {
      id: 'land1',
      controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    };
    const watcher = {
      id: 'watch',
      controller: 'p1',
      card: {
        name: 'Watcher',
        type_line: 'Creature — Elemental',
        oracle_text: 'Whenever a land enters, draw a card.',
      },
    };
    const battlefield = [fishBrewer, fish1, fish2, land, watcher];
    const doublers = detectTriggerDoublers(battlefield, 'p1');
    expect(doublers).toEqual([
      expect.objectContaining({
        permanentId: 'brewer',
        additionalCopiesPerUntappedCreatureType: 'fish',
        causeEnteringMustNotBeSelf: true,
      }),
    ]);

    const trig = [{
      permanentId: 'watch',
      cardName: 'Watcher',
      controllerId: 'p1',
      description: 'draw a card',
      effect: 'draw a card',
      mandatory: true,
    }];
    expect(applyTriggerDoublers(trig as any, doublers, 'etb', watcher, battlefield, {
      cause: 'land_etb',
      enteringPermanent: land,
    })).toHaveLength(3);

    const state = {
      battlefield,
      stack: [{
        id: 't1',
        controller: 'p1',
        permanentId: 'watch',
        description: 'draw a card',
        effect: 'draw a card',
        triggerType: 'etb',
        interveningIfSubjectSnapshot: land,
      }],
    };
    pushTriggerDoublerCopies(state, state.stack[0]);
    expect(state.stack).toHaveLength(3);
    expect(fish1.tapped).toBe(true);
    expect(fish2.tapped).toBe(true);
  });

  it('doubles triggers of the equipped creature only', () => {
    const staff = {
      id: 'staff1',
      controller: 'p1',
      attachedTo: 'wiz1',
      card: {
        name: "Wizard's Staff",
        type_line: 'Artifact — Equipment',
        oracle_text: WIZARDS_STAFF_ORACLE,
      },
    };
    const wizard = {
      id: 'wiz1',
      controller: 'p1',
      card: {
        name: 'Snapcaster Mage',
        type_line: 'Creature — Human Wizard',
        oracle_text: 'When Snapcaster Mage enters, draw a card.',
      },
    };
    const other = {
      id: 'other1',
      controller: 'p1',
      card: {
        name: 'Other Mage',
        type_line: 'Creature — Human Wizard',
        oracle_text: 'When Other Mage enters, draw a card.',
      },
    };
    const battlefield = [staff, wizard, other];
    const doublers = detectTriggerDoublers(battlefield, 'p1');
    expect(doublers).toEqual([
      expect.objectContaining({
        permanentId: 'staff1',
        equippedCreatureOnly: true,
        triggerTypeFilter: 'any',
      }),
    ]);

    const wizardTrig = [{
      permanentId: 'wiz1',
      cardName: 'Snapcaster Mage',
      controllerId: 'p1',
      description: 'draw a card',
      effect: 'draw a card',
      mandatory: true,
    }];
    const otherTrig = [{
      permanentId: 'other1',
      cardName: 'Other Mage',
      controllerId: 'p1',
      description: 'draw a card',
      effect: 'draw a card',
      mandatory: true,
    }];

    expect(applyTriggerDoublers(wizardTrig as any, doublers, 'etb', wizard, battlefield)).toHaveLength(2);
    expect(applyTriggerDoublers(otherTrig as any, doublers, 'etb', other, battlefield)).toHaveLength(1);
  });
});
