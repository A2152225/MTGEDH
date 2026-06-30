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
});
