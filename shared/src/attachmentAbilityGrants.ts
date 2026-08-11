/**
 * Quoted ability grants from Equipment / Auras / Backgrounds:
 * Equipped creature has "{T}: …"
 * Enchanted creature has "…"
 * Commander creatures you own have "…"
 */

import { iterAttachments } from './attachmentKeywordGrants.js';

/** Extract ability texts inside "…" / “…” quotes. */
export function extractQuotedAbilityTexts(text: string): string[] {
  const raw = String(text || '');
  if (!raw) return [];
  const out: string[] = [];
  const quoteRe = /["\u201C]([^"\u201D]+)["\u201D]/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRe.exec(raw)) !== null) {
    const ability = String(match[1] || '').trim();
    if (ability) out.push(ability);
  }
  return out;
}

/**
 * Quoted abilities granted by a single attachment/background oracle string.
 * Returns the inner ability text (without surrounding quotes).
 */
export function parseAttachmentGrantedAbilityTextsFromOracle(oracleText: string): string[] {
  const oracle = String(oracleText || '');
  if (!oracle) return [];
  const granted: string[] = [];
  const patterns = [
    /(?:equipped|enchanted)\s+creature\s+has\s+["\u201C]([^"\u201D]+)["\u201D]/gi,
    /(?:equipped|enchanted)\s+creature\s+gains?\s+["\u201C]([^"\u201D]+)["\u201D]/gi,
    /commander\s+creatures?\s+you\s+own\s+have\s+["\u201C]([^"\u201D]+)["\u201D]/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(oracle)) !== null) {
      const ability = String(match[1] || '').trim();
      if (ability) granted.push(ability);
    }
  }

  return granted;
}

/** True when the granted ability text looks like an activated ability (cost: effect). */
export function isGrantedActivatedAbilityText(abilityText: string): boolean {
  const text = String(abilityText || '').trim();
  if (!text || !text.includes(':')) return false;
  if (/^(when|whenever|at)\b/i.test(text)) return false;
  if (/^(if|as long as)\b/i.test(text) && !/^[^{]*\{[^}]+\}/.test(text)) return false;
  return (
    /\{[TQ0-9WUBRGCXYZ/]+\}/i.test(text)
    || /^(Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)\b/i.test(text)
  );
}

/** Activated ability lines granted by attachments on a host. */
export function getAttachmentGrantedActivatedAbilityTexts(
  permanent: any,
  battlefield: any[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const attachment of iterAttachments(permanent, battlefield)) {
    for (const ability of parseAttachmentGrantedAbilityTextsFromOracle(attachment?.card?.oracle_text || '')) {
      if (!isGrantedActivatedAbilityText(ability)) continue;
      const key = ability.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ability);
    }
  }
  return out;
}

/** All quoted ability grants from attachments (activated + triggered + static text). */
export function getAttachmentGrantedAbilityTexts(
  permanent: any,
  battlefield: any[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const attachment of iterAttachments(permanent, battlefield)) {
    for (const ability of parseAttachmentGrantedAbilityTextsFromOracle(attachment?.card?.oracle_text || '')) {
      const key = ability.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ability);
    }
  }
  return out;
}

/**
 * Merge persisted grantedAbilities with live attachment quotes for UI / activation.
 * Persisted entries may be keywords or full ability lines.
 */
export function collectEffectiveGrantedAbilityTexts(
  permanent: any,
  battlefield?: any[] | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  for (const entry of Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []) {
    push(String(entry || ''));
  }

  if (Array.isArray(battlefield)) {
    for (const ability of getAttachmentGrantedAbilityTexts(permanent, battlefield)) {
      push(ability);
    }
  }

  return out;
}
