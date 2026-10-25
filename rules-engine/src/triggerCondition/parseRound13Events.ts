/**
 * Round 13 trigger wordings mapped onto existing events: self "enters or is put into a graveyard
 * from the battlefield" / "enters or leaves the battlefield" / "enters or is turned face up" and
 * "enchanted creature attacks or blocks" (pairedEvent), Sojourner "when you cycle this card and
 * when this creature dies" (dies + pairedEvent cycles), and legacy-runtime wordings (Adversary
 * "when you pay this cost one or more times", delayed "that turn's end step", reflexive
 * "when you discard a card this way", curse "enchanted player is attacked").
 * Origin parent: parseSelfAndPlayerEvents.ts parseSelfAndPlayerTriggerSentence.
 * Public: parseRound13TriggerSentence.
 */

import type { TriggerConditionEvent, TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

const SELF = '(this (?:creature|permanent|artifact|enchantment|land|vehicle)|~)';

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

const ENTERS_OR: ReadonlyArray<[RegExp, TriggerConditionEvent, Record<string, unknown>?]> = [
  [/^or is put into a graveyard from the battlefield$/, 'put_into_graveyard', { pairedFromZone: 'battlefield' }],
  [/^or leaves the battlefield$/, 'leaves_battlefield'],
  [/^or is turned face up$/, 'turned_face_up'],
];

export function parseRound13TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const entersOr = new RegExp('^(whenever|when)\\s+' + SELF + '\\s+enters(?: the battlefield)? (or [^,]+),\\s*(.+)$').exec(text);
  if (entersOr) {
    const hit = ENTERS_OR.find(([re]) => re.test(entersOr[3]));
    if (hit) return withFields(reparse(entersOr[1] + ' ' + entersOr[2] + ' enters, ' + entersOr[4]), { pairedEvent: hit[1], ...(hit[2] || {}) });
  }

  const sojourner = /^when you cycle (?:this card|~) and when (this creature|~) dies,\s*(.+)$/.exec(text);
  if (sojourner) return withFields(reparse('when ' + sojourner[1] + ' dies, ' + sojourner[2]), { pairedEvent: 'cycles' });

  const auraAttackBlock = /^whenever enchanted creature attacks or blocks,\s*(.+)$/.exec(text);
  if (auraAttackBlock) return withFields(reparse('whenever enchanted creature attacks, ' + auraAttackBlock[1]), { pairedEvent: 'blocks' });

  const adversary = /^when you pay this cost one or more times,\s*(.+)$/.exec(text);
  if (adversary) return withFields(reparse('when this creature enters, ' + adversary[1]), { legacyRuntimeOnly: true });

  const thatTurnEnd = /^at the beginning of that turn's end step,\s*(.+)$/.exec(text);
  if (thatTurnEnd) return withFields(reparse('at the beginning of the end step, ' + thatTurnEnd[1]), { legacyRuntimeOnly: true });

  const discardThisWay = /^when(?:ever)? you discard (?:a|one or more)(?: nonland| land| creature)? cards? this way,\s*(.+)$/.exec(text);
  if (discardThisWay) return withFields(reparse('whenever you discard a card, ' + discardThisWay[1]), { legacyRuntimeOnly: true });

  const curseAttacked = /^whenever enchanted player is attacked,\s*(.+)$/.exec(text);
  if (curseAttacked) {
    return withFields(reparse('whenever a creature attacks you or a planeswalker you control, ' + curseAttacked[1]), { attackedPlayer: undefined, legacyRuntimeOnly: true });
  }
  return null;
}
