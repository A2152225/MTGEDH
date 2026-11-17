/**
 * Round 67 leftover trigger promotions.
 * Origin parent: parseRound66Events.ts parseRound66TriggerSentence (final null).
 * Public: parseRound67TriggerSentence.
 *
 * The last census leftovers: life and counter thresholds, a crewed vehicle,
 * linked creatures and equipment, damage from an opponent or a single-target
 * spell, and abilities that trigger because another ability triggered.
 */
import { compose65, stampSubject65 as stampSubject, type Parsed65 as Parsed } from './parseRound65Helpers.js';

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function amountOf(raw: string): number {
  const text = String(raw || '').replace(/,/g, '').trim().toLowerCase();
  if (WORDS[text]) return WORDS[text];
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function creatureSubject(): Record<string, unknown> {
  return {
    anyObject: false,
    typeGroups: [['creature']],
    groups: [{ types: ['creature'], subtypes: [] }],
  };
}

export function parseRound67TriggerSentence(text: string): Parsed | null {
  const life = /^(when|whenever) you have (\d+) or (less|fewer|more) life,\s*(.+)$/.exec(text);
  if (life) {
    const n = amountOf(life[2]);
    const atMost = life[3] !== 'more';
    return compose65('life_threshold', life[4], atMost ? { lifeAtMost: n } : { lifeAtLeast: n });
  }

  const counters = /^(when|whenever) there are ([\d,]+|one|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z]+) counters on [^,]+,\s*(.+)$/.exec(text);
  if (counters) {
    return compose65('source_counter_threshold', counters[4], {
      sourceCounterKind: counters[3],
      sourceCounterAtLeast: amountOf(counters[2]),
    });
  }

  const colorRank = /^(when|whenever) the chosen colou?r isn't the most common colou?r among nontoken permanents the chosen player controls or is tied for most common,\s*(.+)$/.exec(text);
  if (colorRank) {
    return compose65('color_rank', colorRank[2], { chosenColorNotStrictlyMostCommon: true });
  }

  const printedSet = /^(whenever|when) one or more other nontoken permanents with a name originally printed in the ([a-z ]+) expansion are on the battlefield,\s*(.+)$/.exec(text);
  if (printedSet) {
    const code = /arabian nights/.test(printedSet[2]) ? 'arn' : printedSet[2].replace(/\s+/g, '_');
    return compose65('set_presence', printedSet[3], { originallyPrintedInSet: code, quantity: 'one_or_more' });
  }

  const crewed = /^(whenever|when) a vehicle crewed by this permanent this turn attacks,\s*(.+)$/.exec(text);
  if (crewed) {
    return stampSubject(compose65('attacks', crewed[2], {
      controller: 'any',
      crewedBySourceThisTurn: true,
    }), {
      anyObject: false,
      typeGroups: [['vehicle']],
      groups: [{ types: ['artifact'], subtypes: ['vehicle'] }],
    });
  }

  const either = /^(whenever|when) either of those creatures deals combat damage to a player this combat,\s*(.+)$/.exec(text);
  if (either) {
    return stampSubject(compose65('deals_combat_damage_to_player', either[2], {
      eitherOfLinkedAttackers: true,
    }), creatureSubject());
  }

  const oppSource = /^(whenever|when) a source an opponent controls deals damage to this creature,\s*(.+)$/.exec(text);
  if (oppSource) {
    return compose65('deals_damage', oppSource[2], {
      controller: 'not_you',
      damageRecipient: 'source',
    });
  }

  const singleTarget = /^(whenever|when) an instant or sorcery spell you control that targets only a single creature deals damage to that creature,\s*(.+)$/.exec(text);
  if (singleTarget) {
    return compose65('deals_damage', singleTarget[2], {
      damageSourceIsSpell: true,
      spellTargetsSingleCreature: true,
      damageRecipient: 'creature',
    });
  }

  const chooses = /^(whenever|when) a player chooses one or more targets,\s*(.+)$/.exec(text);
  if (chooses) {
    return compose65('chooses_targets', chooses[2], { controller: 'any', quantity: 'one_or_more' });
  }

  const attackCauses = /^(whenever|when) a creature you control attacking causes a triggered ability of that creature to trigger,\s*(.+)$/.exec(text);
  if (attackCauses) {
    return compose65('caused_trigger', attackCauses[2], { causedKind: 'attack_own_creature', controller: 'any' });
  }

  const etbCauses = /^(whenever|when) a permanent entering causes a triggered ability to trigger,\s*(.+)$/.exec(text);
  if (etbCauses) {
    return compose65('caused_trigger', etbCauses[2], { causedKind: 'etb', controller: 'any' });
  }

  const oppEtbCauses = /^(whenever|when) a creature entering under an opponent's control causes a triggered ability of that creature to trigger,\s*(.+)$/.exec(text);
  if (oppEtbCauses) {
    return compose65('caused_trigger', oppEtbCauses[2], { causedKind: 'etb_opponent_creature', controller: 'any' });
  }

  const chosenLeaves = /^(when|whenever) the chosen creature leaves the battlefield,\s*(.+)$/.exec(text);
  if (chosenLeaves) {
    return stampSubject(compose65('leaves_battlefield', chosenLeaves[2], {
      controller: 'any',
      chosenCreatureLeaves: true,
    }), creatureSubject());
  }

  const putLeaves = /^(when|whenever) the creature put onto the battlefield with this permanent leaves the battlefield,\s*(.+)$/.exec(text);
  if (putLeaves) {
    return stampSubject(compose65('leaves_battlefield', putLeaves[2], {
      controller: 'any',
      putOntoBattlefieldWithSource: true,
    }), creatureSubject());
  }

  const loseEquipment = /^(when|whenever) you lose control of that equipment,\s*(.+)$/.exec(text);
  if (loseEquipment) {
    return stampSubject(compose65('loses_control', loseEquipment[2], { linkedEquipment: true }), {
      anyObject: false,
      typeGroups: [['equipment']],
      groups: [{ types: ['artifact'], subtypes: ['equipment'] }],
    });
  }

  const blockedColor = /^(whenever|when) this creature becomes blocked by a creature of that colou?r this turn,\s*(.+)$/.exec(text);
  if (blockedColor) {
    return compose65('becomes_blocked', blockedColor[2], {
      source: 'self',
      controller: 'any',
      blockedByChosenColor: true,
    });
  }

  // "When one or more cards are milled this way" reparses to this sentence, then the
  // this-way wrapper stamps thisWay + delayedRider. A permanent mill detector must not fire it.
  const millBatch = /^(whenever|when) one or more cards are milled,\s*(.+)$/.exec(text);
  if (millBatch) {
    return compose65('mills', millBatch[2], { quantity: 'one_or_more', controller: 'any' });
  }

  return null;
}
