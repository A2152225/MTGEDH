// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster: per-recipient write of declarative ability / color grants.
//   Quoted activated and triggered abilities granted by statics ("have \"{T}: ...\"",
//   "have \"Whenever ...\"") respect "loses all abilities" (Humility, Turn to Frog) in
//   timestamp order (CR 613.7): a grant applies only when its source is newer than the loss.
// Public: grantedAbilitiesSurvivingAbilityLoss, recordDeclarativeColorAdditions.

import { permanentKeywordLossTimestamp } from '../../../../rules-engine/src/permanentKeywordAbilities.js';
import { readAttachmentTimestamp, readPermanentTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

/** Activated ("cost: effect") or triggered (when / whenever / at) ability text, not a keyword. */
export function isQuotedAbilityGrantText(text: string): boolean {
  return /:|^(?:when|whenever|at)\b/i.test(String(text || '').trim());
}

const lossScanCache = new WeakMap<readonly unknown[], { signature: string; mayLose: boolean }>();

function ownText(perm: any): string {
  return String(perm?.card?.oracle_text || '');
}

/** Cheap per-battlefield gate so boards with no ability loss never pay for timestamp scans. */
export function battlefieldMayRemoveAbilities(battlefield: readonly any[]): boolean {
  const signature = `${battlefield.length}|${String(battlefield[battlefield.length - 1]?.id || '')}`;
  const cached = lossScanCache.get(battlefield);
  if (cached && cached.signature === signature) return cached.mayLose;
  const mayLose = battlefield.some((p: any) => p?.losesAllAbilities === true || p?.lostAllAbilities === true
    || (Array.isArray(p?.temporaryEffects) && p.temporaryEffects.length > 0)
    || ['removedAbilities', 'lostAbilities', 'removedKeywords', 'lostKeywords'].some((k) => Array.isArray(p?.[k]) && p[k].length > 0)
    || /\blos(?:e|es)\b/i.test(ownText(p)));
  lossScanCache.set(battlefield, { signature, mayLose });
  return mayLose;
}

function grantSourceTimestamp(source: any, recipient: any): number | undefined {
  if (!source) return undefined;
  if (source.attachedTo && String(source.attachedTo) === String(recipient?.id || '')) {
    return readAttachmentTimestamp(source) ?? readPermanentTimestamp(source);
  }
  return readPermanentTimestamp(source);
}

/**
 * Normalized (trimmed, lowercased) ability grants for one recipient. Quoted ability grants are
 * dropped when the recipient loses all abilities from an effect at least as new as the grant source.
 */
export function grantedAbilitiesSurvivingAbilityLoss(
  spec: { sourcePermanentId?: string; effectSourcePermanentId?: string },
  recipient: any,
  abilities: readonly unknown[],
  battlefield: readonly any[],
): string[] {
  const normalized = abilities.map((a) => String(a || '').trim().toLowerCase()).filter(Boolean);
  if (!normalized.some(isQuotedAbilityGrantText)) return normalized;
  if (!Array.isArray(battlefield) || battlefield.length === 0 || !battlefieldMayRemoveAbilities(battlefield)) return normalized;
  let lossTs = permanentKeywordLossTimestamp(recipient, 'all abilities', battlefield);
  if (lossTs === undefined) return normalized;
  const sourceId = String(spec.effectSourcePermanentId || spec.sourcePermanentId || '');
  const source = battlefield.find((p: any) => String(p?.id || '') === sourceId);
  // One effect that both removes and grants (Imprisoned in the Moon: "loses all other abilities" and has
  // "{T}: Add {C}") keeps its own grant; only other loss effects are compared, each by its own timestamp
  // (the latest of them decides, since the grant must follow every removal).
  if (source && source !== recipient) {
    lossTs = permanentKeywordLossTimestamp(recipient, 'all abilities', battlefield.filter((p: any) => p !== source));
    if (lossTs === undefined) return normalized;
  }
  const grantTs = grantSourceTimestamp(source, recipient);
  const grantIsNewer = Number.isFinite(lossTs) && grantTs !== undefined && grantTs > lossTs;
  return grantIsNewer ? normalized : normalized.filter((a) => !isQuotedAbilityGrantText(a));
}

/** Layer 5 color additions ("is all colors", "are black"). */
export function recordDeclarativeColorAdditions(
  result: { colorAdditions: Map<string, string[]> },
  permanentId: string,
  colors: readonly string[] | undefined,
): void {
  const adds = Array.isArray(colors) ? colors : [];
  if (adds.length === 0) return;
  const merged = [...(result.colorAdditions.get(permanentId) || [])];
  for (const color of adds) {
    const symbol = String(color || '').trim().toUpperCase();
    if (symbol && !merged.includes(symbol)) merged.push(symbol);
  }
  result.colorAdditions.set(permanentId, merged);
}
