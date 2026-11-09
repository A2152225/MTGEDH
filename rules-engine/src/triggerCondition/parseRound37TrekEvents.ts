/**
 * Round 37 trigger wordings from the Star Trek sets (trk/trc): face a dilemma, attack-while-total-power,
 * "this Spacecraft" self references, and the long tail whose runtime lives in dedicated server modules
 * or the legacy handlers (marked legacyRuntimeOnly so the IR never double-fires).
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound37TrekTriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

const LEGACY_ONLY: readonly RegExp[] = [
  /^whenever a commander you control enters or attacks,\s*(.+)$/,
  /^whenever (?:~|this (?:creature|permanent|spacecraft)) enters or deals combat damage to a player,\s*(.+)$/,
  /^whenever an opponent draws a card during your turn,\s*(.+)$/,
  /^when (?:~|this creature) dies during your turn,\s*(.+)$/,
  /^when it dies this turn,\s*(.+)$/,
  /^whenever it deals combat damage to a player this turn,\s*(.+)$/,
  // promoted R54: fought this way
  /^whenever a creature you control enters this turn,\s*(.+)$/,
  /^whenever one or more [a-z]+ counters are put on (?:~|this [a-z]+) for the first time each turn,\s*(.+)$/,
  /^whenever you tap a permanent for \{c\},\s*(.+)$/,
  /^when [^,]+ enters and at the beginning of your first main phase,\s*(.+)$/,
  /^at the beginning of combat on each player's turn,\s*(.+)$/,
  /^whenever a creature you control with a counter on it deals combat damage to a player,\s*(.+)$/,
];

export function parseRound37TrekTriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // "You face a dilemma as you choose one or more modes" (server trekPlayerEventTriggers.ts fires these).
  const dilemma = /^whenever you face a dilemma,\s*(.+)$/.exec(text);
  if (dilemma) return withFields(reparse('when this creature enters, ' + dilemma[1]), { legacyRuntimeOnly: true, facesDilemma: true });
  const foughtThisWayDies = /^whenever a creature that fought this way dies this turn,\s*(.+)$/.exec(text);
  if (foughtThisWayDies) {
    return withFields(reparse('whenever a creature dies, ' + foughtThisWayDies[1]), { foughtThisWay: true, onceEachTurn: false } as any);
  }
  // Checked once as attackers are declared (server attack-watcher-queue gates on minTotalPower).
  const power = /^whenever you attack while creatures you control have total power (\d+) or greater,\s*(.+)$/.exec(text);
  if (power) return withFields(reparse('whenever you attack with creatures with total power ' + power[1] + ' or greater, ' + power[2]), { minTotalPower: Number(power[1]) } as any);
  // "this Spacecraft" is a self reference (Borg Cube, K't'inga-Class Battle Cruiser).
  const craft = /^(whenever|when) this spacecraft (.+)$/.exec(text);
  if (craft) { const r = reparse(craft[1] + ' this permanent ' + craft[2]); if (r) return r; }
  for (const re of LEGACY_ONLY) {
    const hit = re.exec(text);
    if (hit) return withFields(reparse('when this creature enters, ' + hit[1]), { legacyRuntimeOnly: true });
  }
  return null;
}
