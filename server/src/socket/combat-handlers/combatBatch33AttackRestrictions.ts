// server/src/socket/combat-handlers/combatBatch33AttackRestrictions.ts
// Batch 33: "Non-Eye creatures you control can't attack." and any "Non-<subtype> creatures you control can't attack."
// Origin parent: combatDeclareAttackersSupport.ts (getOwnerAttackRestrictionReason).
// Public entry symbols: nonTypeCreaturesCantAttackReason.
import { permanentHasCreatureType } from "../../../../shared/src/creatureTypes.js";

const NON_TYPE_RE = /(?:^|\n)non-([a-z]+) creatures you control can't attack\b/;

export function nonTypeCreaturesCantAttackReason(creature: any, battlefield: readonly any[] | undefined): string | null {
  const controller = String(creature?.controller || '');
  for (const perm of Array.isArray(battlefield) ? battlefield : []) {
    if (String(perm?.controller || '') !== controller) continue;
    const text = String(perm?.card?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
    const m = text.match(NON_TYPE_RE);
    if (!m) continue;
    if (permanentHasCreatureType(creature, m[1])) continue;
    return `non-${m[1]} creatures can't attack (${String(perm?.card?.name || 'a permanent')})`;
  }
  return null;
}

// "~ can't attack unless you control another artifact." (Steelclad Serpent, Mouser Mark III) and
// "~ can't attack unless you control more creatures than defending player." (Mogg Toady, Goblin Goon).
const ANOTHER_RE = /can't attack unless you control another (artifact|creature|enchantment|land|planeswalker)\b/;
const MORE_ATTACK_RE = /can't attack unless you control more creatures than defending player\b/;
const MORE_BLOCK_RE = /can't block unless you control more creatures than attacking player\b/;

function lowerText(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
}
function isType(perm: any, type: string): boolean {
  return new RegExp('\\b' + type + '\\b').test(String(perm?.card?.type_line || perm?.type_line || '').toLowerCase());
}
function creatureCount(battlefield: readonly any[], controller: string): number {
  return battlefield.filter((p: any) => String(p?.controller || '') === controller && isType(p, 'creature')).length;
}

export function controlCountAttackRestrictionReason(creature: any, defendingPlayerId: string | undefined, battlefield: readonly any[] | undefined): string | null {
  const text = lowerText(creature);
  const bf = Array.isArray(battlefield) ? battlefield : [];
  const controller = String(creature?.controller || '');
  const another = text.match(ANOTHER_RE);
  if (another && !bf.some((p: any) => p !== creature && String(p?.id) !== String(creature?.id) && String(p?.controller || '') === controller && isType(p, another[1]))) {
    return `can't attack unless you control another ${another[1]}`;
  }
  if (MORE_ATTACK_RE.test(text) && defendingPlayerId && creatureCount(bf, controller) <= creatureCount(bf, String(defendingPlayerId))) {
    return "can't attack unless you control more creatures than defending player";
  }
  return null;
}

export function moreCreaturesBlockRestrictionReason(blocker: any, attacker: any, battlefield: readonly any[] | undefined): string | null {
  if (!MORE_BLOCK_RE.test(lowerText(blocker))) return null;
  const bf = Array.isArray(battlefield) ? battlefield : [];
  return creatureCount(bf, String(blocker?.controller || '')) > creatureCount(bf, String(attacker?.controller || ''))
    ? null
    : "can't block unless you control more creatures than attacking player";
}
