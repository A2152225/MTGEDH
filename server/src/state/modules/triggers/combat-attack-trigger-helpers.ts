/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: mergeCombatTriggerValue + extractCommanderOwnedGrantedAbilityTexts
 * Public: mergeCombatTriggerValue, extractCommanderOwnedGrantedAbilityTexts
 */

import { parseAttachmentGrantedAbilityTextsFromOracle } from "../../../../../shared/src/attachmentAbilityGrants.js";

export function mergeCombatTriggerValue(existing: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>), ...extra };
  }
  if (typeof existing === 'number') {
    return { amount: existing, ...extra };
  }
  return extra;
}

export function extractCommanderOwnedGrantedAbilityTexts(oracleText: string): string[] {
  const granted = parseAttachmentGrantedAbilityTextsFromOracle(oracleText);
  if (!/commander\s+creatures?\s+you\s+own\s+have/i.test(String(oracleText || ''))) {
    return [];
  }
  return granted.filter((text) => /whenever\s+(?:this creature|~)\s+attacks/i.test(text));
}
