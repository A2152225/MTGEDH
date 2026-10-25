/**
 * Round 11 trigger wordings, each mapped onto an existing event:
 * "deals combat damage to a player or planeswalker / a player or battle" (player recipient),
 * "you attack a player" (you attack), "you gain life for the first time each turn"
 * (onceEachTurn), "this land enters untapped" (requiresUntapped), and
 * "this creature dies or is put into exile from the battlefield" (dies + paired exiled).
 * Origin parent: parseSelfAndPlayerEvents.ts parseSelfAndPlayerTriggerSentence.
 * Public: parseRound11TriggerSentence.
 *
 * Planeswalker recipients fire through orPlaneswalkerRecipient (combat recipient-variant pass).
 */

import type { TriggerConditionIR } from './types.js';

export interface Round11TriggerSentence {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

type Reparse = (sentence: string) => { condition: TriggerConditionIR; effect: string } | null;

const SELF = '(?:this (?:creature|permanent|card|artifact|enchantment|land)|~|it)';

export function parseRound11TriggerSentence(text: string, reparse: Reparse): Round11TriggerSentence | null {
  const pwDamage = /^(whenever|when)\s+(.+?)\s+deals? combat damage to a player or (?:a )?(?:planeswalker|battle),\s*(.+)$/.exec(text);
  if (pwDamage) {
    const base = reparse(`${pwDamage[1]} ${pwDamage[2]} deals combat damage to a player, ${pwDamage[3]}`);
    return base ? { ...base, condition: { ...base.condition, orPlaneswalkerRecipient: true } } : null;
  }

  const attackPlayer = /^(whenever|when)\s+you attack a player,\s*(.+)$/.exec(text);
  if (attackPlayer) return reparse(`${attackPlayer[1]} you attack, ${attackPlayer[2]}`);

  const firstLife = /^(whenever|when)\s+(you|an opponent|a player)\s+gains? life for the first time each turn,\s*(.+)$/.exec(text);
  if (firstLife) {
    const base = reparse(`whenever ${firstLife[2]} gain${firstLife[2] === 'you' ? '' : 's'} life, ${firstLife[3]}`);
    return base ? { ...base, condition: { ...base.condition, onceEachTurn: true } } : null;
  }

  const untapped = /^(?:whenever|when)\s+this land enters untapped,\s*(.+)$/.exec(text);
  if (untapped) {
    const base = reparse(`when this land enters, ${untapped[1]}`);
    return base ? { ...base, condition: { ...base.condition, requiresUntapped: true } } : null;
  }

  const diesOrExiled = new RegExp('^(?:whenever|when)\\s+(' + SELF + ')\\s+dies or is put into exile from the battlefield,\\s*(.+)$').exec(text);
  if (diesOrExiled) {
    const base = reparse(`when ${diesOrExiled[1]} dies, ${diesOrExiled[2]}`);
    return base ? { ...base, condition: { ...base.condition, pairedEvent: 'exiled' } } : null;
  }
  return null;
}
