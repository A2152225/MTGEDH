/**
 * Round 40: batched "one or more <plural subject> <qualifier> <plural verb>" wordings that the main
 * parser misses because of a qualifier ("with mana value 3 or less", "with +1/+1 counters on them",
 * "each with ...") or a plural recipient ("to one or more players"). Rewritten to the singular
 * sentence, reparsed, and marked quantity one_or_more (batched once per event by the server's
 * enters / attacks / combat-damage queues). Verbs whose runtime does not batch (become tapped/blocked)
 * are intentionally not handled.
 * Origin parent: parseFamilies.ts parseTriggerClause (last-resort fallback).
 * Public: parseRound40BatchedTriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

const VERBS: ReadonlyArray<[RegExp, string]> = [
  [/^enter(?: the battlefield)?$/, 'enters'],
  [/^attack$/, 'attacks'],
  [/^attack (?:a player|one or more players)$/, 'attacks a player'],
  [/^attack (?:an opponent|one of your opponents|one or more of your opponents)$/, 'attacks an opponent'],
  [/^deals? combat damage to (?:a player|one or more players)$/, 'deals combat damage to a player'],
  [/^deals? combat damage to (?:an opponent|one of your opponents|one or more of your opponents)$/, 'deals combat damage to an opponent'],
];

function singularNoun(noun: string): string | null {
  if (/ies$/.test(noun)) return noun.replace(/ies$/, 'y');
  if (/(?:ches|shes|sses|xes)$/.test(noun)) return noun.replace(/es$/, '');
  if (/s$/.test(noun)) return noun.replace(/s$/, '');
  return null;
}

export function parseRound40BatchedTriggerSentence(sentence: string, reparse: Reparse): Parsed | null {
  const text = String(sentence || '').toLowerCase().replace(/\.+$/, '').trim();
  // Round 41: singular "<subject> attacks a player / an opponent" (attack must target a player).
  const attacksPlayer = /^(whenever|when) ((?:a|an|another) [^,]+?) attacks (a player|an opponent),\s*(.+)$/.exec(text);
  if (attacksPlayer) {
    const r = reparse(attacksPlayer[1] + ' ' + attacksPlayer[2] + ' attacks, ' + attacksPlayer[4]);
    if (r) return { ...r, condition: { ...r.condition, attackedTargetType: 'player', ...(attacksPlayer[3] === 'an opponent' ? { attackedPlayer: 'opponent' } : {}) } as TriggerConditionIR };
  }
  // Plural recipient only: the batched subject itself already parses.
  const plural = /^(whenever|when) (one or more .+?) deal combat damage to one or more players,\s*(.+)$/.exec(text);
  if (plural) {
    const r = reparse(plural[1] + ' ' + plural[2] + ' deal combat damage to a player, ' + plural[3]);
    if (r) return r;
  }
  const m = /^(whenever|when) one or more ((?:other |nontoken |attacking |tapped |untapped )*)([a-z-]+) ((?:you control|your opponents control|an opponent controls)(?: [^,]*?)?) (enter(?: the battlefield)?|attack(?: a player| one or more players| an opponent| one of your opponents| one or more of your opponents)?|deals? combat damage to (?:a player|one or more players)),\s*(.+)$/.exec(text);
  if (!m) return null;
  const noun = singularNoun(m[3]);
  if (!noun) return null;
  const verb = VERBS.find(([re]) => re.test(m[5]));
  if (!verb) return null;
  const qualifier = m[4].replace(/\beach with\b/g, 'with').replace(/\bon them\b/g, 'on it').replace(/\bwith ([+-]\d+\/[+-]\d+|[a-z]+) counters on it\b/g, 'with a $1 counter on it').replace(/\bthat entered\b/g, 'that entered').trim();
  const r = parseRound40BatchedTriggerSentence(m[1] + ' a ' + m[2] + noun + ' ' + qualifier + ' ' + verb[1] + ', ' + m[6], reparse)
    ?? reparse(m[1] + ' a ' + m[2] + noun + ' ' + qualifier + ' ' + verb[1] + ', ' + m[6]);
  if (!r) return null;
  return { ...r, condition: { ...r.condition, quantity: 'one_or_more' } as TriggerConditionIR };
}
