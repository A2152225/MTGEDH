// client/src/utils/combatBatch33Restrictions.ts
// UI34: client mirror of server combat-handlers/combatBatch33AttackRestrictions.ts for the combat picker.
// Public entry symbols: batch33AttackGateReason, moreCreaturesBlockReason.
import { permanentHasCreatureType } from '../../../shared/src/creatureTypes';

const NON_TYPE_RE = /(?:^|\n)non-([a-z]+) creatures you control can't attack\b/;
const ANOTHER_RE = /can't attack unless you control another (artifact|creature|enchantment|land|planeswalker)\b/;
const MORE_ATTACK_RE = /can't attack unless you control more creatures than defending player\b/;
const MORE_BLOCK_RE = /can't block unless you control more creatures than attacking player\b/;

const text = (p: any) => String(p?.card?.oracle_text || p?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
const isType = (p: any, t: string) => new RegExp('\\b' + t + '\\b').test(String(p?.card?.type_line || p?.type_line || '').toLowerCase());
const count = (bf: readonly any[], c: string) => bf.filter((p: any) => String(p?.controller || '') === c && isType(p, 'creature')).length;

/** Reason the creature can't attack any opponent right now, else null. */
export function batch33AttackGateReason(creature: any, battlefield: readonly any[] | undefined, opponentIds: readonly string[]): string | null {
  const bf = Array.isArray(battlefield) ? battlefield : [];
  const controller = String(creature?.controller || '');
  for (const perm of bf) {
    if (String(perm?.controller || '') !== controller) continue;
    const m = text(perm).match(NON_TYPE_RE);
    if (m && !permanentHasCreatureType(creature, m[1])) return `Non-${m[1]} creatures can't attack`;
  }
  const own = text(creature);
  const another = own.match(ANOTHER_RE);
  if (another && !bf.some((p: any) => String(p?.id) !== String(creature?.id) && String(p?.controller || '') === controller && isType(p, another[1]))) {
    return `Needs another ${another[1]} to attack`;
  }
  if (MORE_ATTACK_RE.test(own) && opponentIds.length > 0 && opponentIds.every((d) => count(bf, controller) <= count(bf, String(d)))) {
    return 'Needs more creatures than the defender';
  }
  return null;
}

export function moreCreaturesBlockReason(blocker: any, attacker: any, battlefield: readonly any[] | undefined): string | null {
  if (!MORE_BLOCK_RE.test(text(blocker))) return null;
  const bf = Array.isArray(battlefield) ? battlefield : [];
  return count(bf, String(blocker?.controller || '')) > count(bf, String(attacker?.controller || '')) ? null : 'Needs more creatures than the attacker to block';
}
