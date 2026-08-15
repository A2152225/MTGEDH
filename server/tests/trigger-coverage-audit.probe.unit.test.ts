import { describe, expect, it } from 'vitest';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  buildAuditProbePermanent,
  serverDetectsTrigger,
} from '../scripts/trigger-coverage-audit.ts';

const DOOR_ORACLE =
  'As Door of Destinies enters the battlefield, choose a creature type.\n' +
  'Whenever you cast a spell of the chosen type, put a charge counter on Door of Destinies.\n' +
  'Creatures you control of the chosen type get +1/+1 for each charge counter on Door of Destinies.';

describe('trigger coverage audit probe permanent', () => {
  it('buildAuditProbePermanent sets chosenCreatureType when oracle chooses a creature type', () => {
    const probe = buildAuditProbePermanent(DOOR_ORACLE);
    expect(probe.chosenCreatureType).toBe('Human');
  });

  it('serverDetectsTrigger recognizes Door of Destinies chosen-type spell cast trigger', () => {
    const card = {
      name: 'Door of Destinies',
      type_line: 'Artifact',
      oracle_text: DOOR_ORACLE,
    };
    const parsed = parseTriggeredAbilitiesFromText(DOOR_ORACLE, 'AUDIT_SRC', 'P1', card.name);
    const castTrigger = parsed.find((trigger) => String(trigger.event).includes('spell_cast'));
    expect(castTrigger).toBeTruthy();
    expect(serverDetectsTrigger(card, castTrigger!)).toBe(true);
  });

  it('serverDetectsTrigger recognizes support ETB triggers', () => {
    const oracle = 'Flying\nWhen Expedition Raptor enters, support 2.';
    const card = { name: 'Expedition Raptor', type_line: 'Creature — Bird', oracle_text: oracle };
    const parsed = parseTriggeredAbilitiesFromText(oracle, 'AUDIT_SRC', 'P1', card.name);
    const etbTrigger = parsed.find((trigger) => String(trigger.event).includes('enters'));
    expect(etbTrigger?.effect?.toLowerCase()).toContain('support 2');
    expect(serverDetectsTrigger(card, etbTrigger!)).toBe(true);
  });

  it('serverDetectsTrigger recognizes tribal deals-damage and explore-clash ETB triggers', () => {
    const mikaeus = {
      name: 'Mikaeus, the Unhallowed',
      type_line: 'Legendary Creature — Zombie Cleric',
      oracle_text:
        'Whenever a Human deals damage to you, destroy it.\n'
        + 'Other non-Human creatures you control get +1/+1 and have undying.',
    };
    const mikaeusParsed = parseTriggeredAbilitiesFromText(mikaeus.oracle_text, 'SRC', 'P1', mikaeus.name);
    const damageTrigger = mikaeusParsed.find((t) => String(t.event) === 'deals_damage');
    expect(damageTrigger).toBeTruthy();
    expect(serverDetectsTrigger(mikaeus, damageTrigger!)).toBe(true);

    const merfolk = {
      name: 'Merfolk Surveyor',
      type_line: 'Creature — Merfolk Wizard',
      oracle_text:
        'When Merfolk Surveyor enters the battlefield, explore-clash. If you win the explore-clash, gain 3 life.',
    };
    const merfolkParsed = parseTriggeredAbilitiesFromText(merfolk.oracle_text, 'SRC', 'P1', merfolk.name);
    const etbTrigger = merfolkParsed.find((t) => String(t.event).includes('enters'));
    expect(etbTrigger?.effect?.toLowerCase()).toContain('explore-clash');
    expect(serverDetectsTrigger(merfolk, etbTrigger!)).toBe(true);
  });

  it('serverDetectsTrigger recognizes Fabricate as an ETB keyword detection', () => {
    const oracle = 'Fabricate 2';
    const card = {
      name: 'Glint-Sleeve Artisan',
      type_line: 'Creature — Dwarf Artificer',
      oracle_text: oracle,
    };
    const parsed = parseTriggeredAbilitiesFromText(oracle, 'AUDIT_SRC', 'P1', card.name);
    const etbTrigger = parsed.find((trigger) => String(trigger.event).includes('enters'));
    expect(etbTrigger).toBeTruthy();
    expect(serverDetectsTrigger(card, etbTrigger!)).toBe(true);
  });

  it('serverDetectsTrigger covers remaining detector-grammar misses', () => {
    const cases: Array<{ name: string; type_line: string; oracle_text: string; eventIncludes: string }> = [
      {
        name: 'Dawn-Blessed Pennant',
        type_line: 'Artifact',
        oracle_text:
          'As this artifact enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\n'
          + 'Whenever a permanent you control of the chosen type enters, you gain 1 life.',
        eventIncludes: 'enters',
      },
      {
        name: 'Rimefire Torque',
        type_line: 'Artifact',
        oracle_text:
          'As this artifact enters, choose a creature type.\n'
          + 'Whenever a permanent you control of the chosen type enters, put a charge counter on this artifact.',
        eventIncludes: 'enters',
      },
      {
        name: 'Soulblade Corrupter',
        type_line: 'Creature — Human Warrior',
        oracle_text:
          'Whenever a creature with a +1/+1 counter on it attacks one of your opponents, that creature gains deathtouch until end of turn.',
        eventIncludes: 'attacks',
      },
      {
        name: 'Firion, Wild Rose Warrior',
        type_line: 'Legendary Creature — Human Rebel Warrior',
        oracle_text:
          'Whenever a nontoken Equipment you control enters, create a token that\'s a copy of it.',
        eventIncludes: 'enters',
      },
      {
        name: 'Flavor Disaster',
        type_line: 'Creature — Elemental',
        oracle_text:
          'When Flavor Disaster enters the battlefield or when it\'s turned face up, target creature gets +X/+X until end of turn, where X is Flavor Disaster\'s power.',
        eventIncludes: 'enters',
      },
      {
        name: 'Brine Comber',
        type_line: 'Creature — Spirit',
        oracle_text:
          'Whenever this creature enters or becomes the target of an Aura spell, create a 1/1 white Spirit creature token with flying.',
        eventIncludes: 'enters',
      },
      {
        name: 'Jerren, Corrupted Bishop',
        type_line: 'Legendary Creature — Human Cleric',
        oracle_text:
          'Whenever Jerren enters or another nontoken Human you control dies, you lose 1 life and create a 1/1 white Human creature token.',
        eventIncludes: 'enters',
      },
      {
        name: 'Truss, Chief Engineer',
        type_line: 'Legendary Creature — Human Artificer',
        oracle_text:
          'Whenever Truss, Chief Engineer enters or another creature dies, put a hack counter on Truss.',
        eventIncludes: 'enters',
      },
      {
        name: 'Slimefoot, Thallid Transplant',
        type_line: 'Legendary Creature — Fungus',
        oracle_text: 'Whenever a Swamp or Forest enters under your control, draft a card from Slimefoot, Thallid Transplant\'s spellbook.',
        eventIncludes: 'enters',
      },
      {
        name: 'Tireless Angler',
        type_line: 'Creature — Human Child',
        oracle_text: 'Whenever an Island or Swamp enters the battlefield under your control, draft a card from this creature\'s spellbook.',
        eventIncludes: 'enters',
      },
      {
        name: 'High and Dry Black Market',
        type_line: 'Phenomenon',
        oracle_text: 'Whenever you planeswalk here, starting with you, each player chooses up to 5 ♦ worth of modes.',
        eventIncludes: 'ability',
      },
      {
        name: 'Masterpiece Vault',
        type_line: 'Artifact',
        oracle_text:
          'When this artifact is put into a graveyard from the battlefield, draft a card from Masterpiece Vault\'s spellbook and put it onto the battlefield. When an Equipment enters this way, attach it to up to one target creature you control.',
        eventIncludes: 'enters',
      },
    ];

    for (const sample of cases) {
      const parsed = parseTriggeredAbilitiesFromText(sample.oracle_text, 'AUDIT_SRC', 'P1', sample.name);
      const trigger = parsed.find((t) => String(t.event).includes(sample.eventIncludes));
      expect(trigger, sample.name).toBeTruthy();
      expect(serverDetectsTrigger(sample, trigger!), sample.name).toBe(true);
    }
  });
});
