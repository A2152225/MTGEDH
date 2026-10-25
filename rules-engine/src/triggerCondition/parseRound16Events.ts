/**
 * Round 16 trigger wordings: "a source deals damage to this creature", "blocks or becomes blocked",
 * and the long tail of wordings whose runtime lives only in the legacy
 * handlers (marked legacyRuntimeOnly so the IR never double-fires).
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound16TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

const SELF = '(?:~|this creature|this permanent)';
const CAST = '(?:you cast|a player casts|an opponent casts)';

const LEGACY_ONLY: readonly RegExp[] = [
  /^whenever you roll a \d+,\s*(.+)$/,
  /^when it regenerates this way,\s*(.+)$/,
  /^when it connives this way,\s*(.+)$/,
  /^whenever you put one or more [+-]\d+\/[+-]\d+ counters on [^,]+,\s*(.+)$/,
  /^whenever you tap an untapped creature an opponent controls,\s*(.+)$/,
  /^when [^,]+ enters during the declare attackers step,\s*(.+)$/,
  /^whenever one or more (?:nonland )?cards are milled,\s*(.+)$/,
  new RegExp('^whenever ' + CAST + ' (?:a|an|your first) [^,]*?spell (?:of the chosen (?:color|type)|with \\{x\\} in its mana cost(?: each turn)?|you don\'t own|that has an adventure|using mana produced by ~),\\s*(.+)$'),
  new RegExp('^whenever ' + CAST + ' an adventure spell,\\s*(.+)$'),
  new RegExp('^whenever ' + CAST + ' an? (?:white|blue|black|red|green) or (?:white|blue|black|red|green) spell,\\s*(.+)$'),
  /^when you spend this mana to cast [^,]+,\s*(.+)$/,
  /^whenever an equipped creature you control attacks,\s*(.+)$/,
  /^whenever one or more (?:other |nontoken )*creatures(?: you control)? die,\s*(.+)$/,
  /^when there are no creatures on the battlefield,\s*(.+)$/,
  /^when [^,]+ enters and at the beginning of your upkeep,\s*(.+)$/,
  /^whenever this creature (?:crews a vehicle|saddles a mount or crews a vehicle[^,]*),\s*(.+)$/,
  /^when enchanted (?:artifact|creature|permanent|land) is put into a graveyard,\s*(.+)$/,
  /^whenever you lose life for the first time each turn,\s*(.+)$/,
  /^when [^,]+ enters from a graveyard,\s*(.+)$/,
  /^whenever an opponent is dealt (?:noncombat )?damage,\s*(.+)$/,
  /^whenever you play a (?:land|card) from exile(?: or cast a spell from exile)?,\s*(.+)$/,
  /^whenever you activate a loyalty ability[^,]*,\s*(.+)$/,
  /^whenever a modified creature you control [^,]+,\s*(.+)$/,
  /^whenever a source (?:you control|an opponent controls) deals damage to you,\s*(.+)$/,
  /^when you cast or cycle (?:~|this (?:permanent|card|creature|spell)),\s*(.+)$/,
  /^whenever [^,]+ attacks for the first time each turn,\s*(.+)$/,
  /^whenever [^,]+ blocks a creature with [a-z ]+,\s*(.+)$/,
  /^whenever another creature you control enters while [^,]+,\s*(.+)$/,
  /^whenever an opponent activates an ability of [^,]+,\s*(.+)$/,
  /^whenever a player loses the game,\s*(.+)$/,
  /^whenever an ability of equipped creature is activated,\s*(.+)$/,
  /^when you draw your (?:second|third|fourth|fifth) card in a turn,\s*(.+)$/,
  /^whenever you attack this turn,\s*(.+)$/,
  /^when you discard this card,\s*(.+)$/,
  /^whenever a permanent you control of the chosen type enters,\s*(.+)$/,
  /^when this token is put into a graveyard,\s*(.+)$/,
  new RegExp('^whenever a creature dealt damage by ' + SELF + ' this turn dies,\\s*(.+)$'),
];

export function parseRound16TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const damaged = new RegExp('^whenever a source deals damage to ' + SELF + ',\\s*(.+)$').exec(text);
  if (damaged) return reparse('whenever this creature is dealt damage, ' + damaged[1]);

  const blocksOrBlocked = /^whenever (enchanted creature|equipped creature|this creature|~) blocks or becomes blocked,\s*(.+)$/.exec(text);
  if (blocksOrBlocked) {
    return withFields(reparse('whenever ' + blocksOrBlocked[1] + ' blocks, ' + blocksOrBlocked[2]), { pairedEvent: 'becomes_blocked' });
  }

  const diesInCombat = /^when [^,]+ dies during combat,\s*(.+)$/.exec(text);
  // "a spell that's white, blue, or red" / "a white, blue, or red spell": any of the listed colors.
  const C = '(?:white|blue|black|red|green)';
  const colorList = new RegExp('^whenever you cast an? (?:spell that\'s (' + C + '(?:, ' + C + ')*,? (?:or|and/or) ' + C + '|' + C + ')|(' + C + '(?:, ' + C + ')*,? or ' + C + ') spell),\\s*(.+)$').exec(text);
  if (colorList) {
    const base: any = reparse('whenever you cast a spell, ' + colorList[3]);
    const letters: Record<string, string> = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' };
    const colors = String(colorList[1] || colorList[2]).match(/white|blue|black|red|green/g)!.map((c) => letters[c]);
    const subject = base?.condition?.alternatives?.[0]?.subject;
    if (subject) return { ...base, condition: { ...base.condition, alternatives: [{ ...base.condition.alternatives[0], subject: { ...subject, anyObject: true, colors } }] } } as any;
  }
  if (diesInCombat) return withFields(reparse('when this creature dies, ' + diesInCombat[1]), { legacyRuntimeOnly: true, duringCombat: true });

  const attackBatch = parseAttackBatch(text, reparse);
  if (attackBatch) return attackBatch;

  for (const re of LEGACY_ONLY) {
    const hit = re.exec(text);
    if (hit) return withFields(reparse('when this creature enters, ' + hit[1]), { legacyRuntimeOnly: true });
  }
  return null;
}

/** Player-level attack wordings as one-per-declaration IR attack conditions (quantity one_or_more). */
function parseAttackBatch(text: string, reparse: Reparse): Parsed | null {
  const once = (base: Parsed | null): Parsed | null => withFields(base, { quantity: 'one_or_more' });
  const youAttacked = /^whenever (?:a player|an opponent) attacks you(?: with one or more creatures)?,\s*(.+)$/.exec(text);
  if (youAttacked) return once(reparse('whenever a creature attacks you, ' + youAttacked[1]));
  const oppAttacks = /^whenever an opponent attacks with (?:one or more )?creatures,\s*(.+)$/.exec(text);
  if (oppAttacks) return once(reparse('whenever a creature an opponent controls attacks, ' + oppAttacks[1]));
  const anyAttacks = /^whenever a player attacks,\s*(.+)$/.exec(text);
  if (anyAttacks) return once(reparse('whenever a creature attacks, ' + anyAttacks[1]));
  const youWith = /^whenever you attack with one or more ([^,]+?),\s*(.+)$/.exec(text);
  if (youWith) {
    const subject = youWith[1].replace(/\band\/or\b/g, 'or');
    const withPhrase = /^(.+?) (with .+)$/.exec(subject);
    const phrase = withPhrase ? withPhrase[1] + ' you control ' + withPhrase[2] : subject + ' you control';
    return reparse('whenever one or more ' + phrase + ' attack, ' + youWith[2]);
  }
  return null;
}
