// server/src/socket/combat-handlers/combatBatch36Restrictions.ts
// Batch 36:
// - "~ can't attack unless you control an artifact." (Desperate Castaways) and the enchantment/planeswalker forms.
//   Origin parent: combatDeclareAttackersSupport.ts (getOwnerAttackRestrictionReason).
// - "Creatures with flying can block only creatures with flying." (Dense Canopy, Chaosphere), a global blocker gate.
//   Origin parent: combatLegalityGates.ts (canBlockAttacker).
// Public entry symbols: controlTypeAttackRestrictionReason, globalFlyingBlockOnlyFlyingReason.
import { permanentHasKeywordAbility } from "../../../../rules-engine/src/permanentKeywordAbilities.js";

const CONTROL_TYPE_RE = /can't attack unless you control an? (artifact|enchantment|planeswalker)(?=[.\n]|$)/;
const FLY_ONLY_FLY_RE = /(?:^|\n)creatures with flying can block only creatures with flying\b/;

function lowerText(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
}
function isType(perm: any, type: string): boolean {
  return new RegExp('\\b' + type + '\\b').test(String(perm?.card?.type_line || perm?.type_line || '').toLowerCase());
}

export function controlTypeAttackRestrictionReason(creature: any, battlefield: readonly any[] | undefined): string | null {
  const m = lowerText(creature).match(CONTROL_TYPE_RE);
  if (!m) return null;
  const controller = String(creature?.controller || '');
  const bf = Array.isArray(battlefield) ? battlefield : [];
  if (bf.some((p: any) => p && !p.phasedOut && String(p?.controller || '') === controller && isType(p, m[1]))) return null;
  return `can't attack unless you control ${m[1] === 'artifact' || m[1] === 'enchantment' ? 'an' : 'a'} ${m[1]}`;
}

export function globalFlyingBlockOnlyFlyingReason(blocker: any, attacker: any, battlefield: readonly any[] | undefined): string | null {
  const bf = Array.isArray(battlefield) ? battlefield : [];
  const source = bf.find((p: any) => p && !p.phasedOut && FLY_ONLY_FLY_RE.test(lowerText(p)));
  if (!source) return null;
  if (!permanentHasKeywordAbility(blocker, 'flying', bf as any[])) return null;
  if (permanentHasKeywordAbility(attacker, 'flying', bf as any[])) return null;
  return `Creatures with flying can block only creatures with flying (${String(source?.card?.name || 'a permanent')})`;
}
