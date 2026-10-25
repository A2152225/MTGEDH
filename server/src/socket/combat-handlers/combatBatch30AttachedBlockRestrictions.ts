// server/src/socket/combat-handlers/combatBatch30AttachedBlockRestrictions.ts
// Batch 30: attached block restriction "Enchanted creature can block only creatures with flying."
// (Air Bladder, Stratus Walk; equipment wording too).
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// Public entry symbols: attachedBlockOnlyFlyingReason.

import { permanentHasKeywordAbility } from "../../../../rules-engine/src/permanentKeywordAbilities.js";

const ONLY_FLYING_RE = /(?:enchanted|equipped) creature can block only creatures with flying/;

export function attachedBlockOnlyFlyingReason(blocker: any, attacker: any, battlefield: readonly any[]): string | null {
  const id = String(blocker?.id || '');
  if (!id) return null;
  const attachmentIds = new Set((Array.isArray(blocker?.attachments) ? blocker.attachments : []).map((a: any) => String(a?.id || a || '')));
  const restricted = (battlefield || []).some((perm: any) => {
    if (!perm || perm === blocker) return false;
    if (String(perm.attachedTo || '') !== id && !attachmentIds.has(String(perm.id || ''))) return false;
    const text = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
    return ONLY_FLYING_RE.test(text);
  });
  if (!restricted) return null;
  if (permanentHasKeywordAbility(attacker, 'flying', battlefield as any[])) return null;
  return 'Blocker can block only creatures with flying';
}
