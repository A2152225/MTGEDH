/**
 * Round 12 trigger wordings mapped onto existing events:
 * "X deals combat damage, E" (deals_combat_damage, no recipient), "X attacks while you control
 * Y, E" (attacks + intervening-if), "the Nth <kind> counter is put on ~" and "a <kind> counter is
 * removed from ~ (while it's exiled)", "a spell or ability an opponent controls causes you to
 * discard this card", and "when you next cast an instant or sorcery spell this turn".
 * Origin parent: parseSelfAndPlayerEvents.ts parseSelfAndPlayerTriggerSentence.
 * Public: parseRound12TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

const SELF = '(?:this (?:creature|permanent|card|artifact|enchantment|land|saga)|~|it)';
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

export function parseRound12TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const noRecipient = /^(whenever|when)\s+(.+?)\s+deals? combat damage,\s*(.+)$/.exec(text);
  if (noRecipient) {
    return withFields(reparse(noRecipient[1] + ' ' + noRecipient[2] + ' deals combat damage to a player, ' + noRecipient[3]), { event: 'deals_combat_damage' });
  }

  const attacksWhile = /^(whenever|when)\s+(.+?)\s+attacks while you control (.+?),\s*(.+)$/.exec(text);
  if (attacksWhile) {
    return reparse(attacksWhile[1] + ' ' + attacksWhile[2] + ' attacks, if you control ' + attacksWhile[3] + ', ' + attacksWhile[4]);
  }

  const nthCounter = new RegExp('^when the (first|second|third|fourth|fifth|sixth|seventh) ([a-z-]+) counter is put on (' + SELF + '),\\s*(.+)$').exec(text);
  if (nthCounter) {
    return withFields(reparse('whenever a counter is put on ' + nthCounter[3] + ', ' + nthCounter[4]), {
      placedCounter: nthCounter[2], counterOrdinal: ORDINALS[nthCounter[1]], legacyRuntimeOnly: true,
    });
  }

  const kindRemoved = new RegExp('^(whenever|when)\\s+an? ([a-z-]+) counter is removed from (' + SELF + ')(,? while it\'?s exiled)?,\\s*(.+)$').exec(text);
  if (kindRemoved && kindRemoved[2] !== 'counter') {
    const exiled = Boolean(kindRemoved[4]);
    return withFields(reparse('whenever a counter is removed from this permanent, ' + kindRemoved[5]), {
      placedCounter: kindRemoved[2], ...(exiled ? { whileExiled: true, legacyRuntimeOnly: true } : {}),
    });
  }

  const oppDiscard = /^when a spell or ability an opponent controls causes you to discard (?:this card|~),\s*(.+)$/.exec(text);
  if (oppDiscard) {
    return withFields(reparse('whenever you discard a card, ' + oppDiscard[1]), { causedByOpponent: true, legacyRuntimeOnly: true });
  }

  const nextSpell = /^when you next cast (.+?) spells? this turn,\s*(.+)$/.exec(text);
  if (nextSpell) {
    return withFields(reparse('whenever you cast ' + nextSpell[1] + ' spell, ' + nextSpell[2]), { nextSpellThisTurn: true, legacyRuntimeOnly: true });
  }
  return null;
}
