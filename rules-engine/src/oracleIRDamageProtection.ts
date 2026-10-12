/**
 * Protection as a damage-prevention effect (rule 702.16e): damage that would be dealt by a source
 * with a quality the permanent has protection from is prevented. Used by previewPreventedDamage so
 * every Oracle IR damage path (single target, "each creature", sweepers from spells, activated and
 * triggered abilities) honours printed, granted and attachment-granted protection.
 *
 * Public entry symbols: collectPermanentProtectionQualities, protectionPreventsDamageToPermanent.
 */
import type { GameState } from '../../shared/src';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function singular(word: string): string {
  const w = word.toLowerCase();
  if (w === 'sorceries') return 'sorcery';
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('es') && /(?:ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** "protection from black and from red", "protection from white, from blue, and from black". */
export function parseProtectionQualities(text: string): string[] {
  const out: string[] = [];
  const src = String(text || '');
  for (const match of src.matchAll(/protection from ([^.\n;()]+)/gi)) {
    const list = String(match[1] || '').trim();
    for (const rawPart of list.split(/\s*,\s*(?:and\s+)?(?:from\s+)?|\s+and\s+from\s+|\s+and\s+/i)) {
      const part = rawPart.replace(/^from\s+/i, '').replace(/^(?:all|each)\s+/i, '').trim().toLowerCase();
      if (!part) continue;
      // Conditional qualities ("creatures with power 4 or greater") are not modelled here.
      if (/\b(?:with|that|without|of your choice|the chosen)\b/.test(part)) continue;
      if (part === 'everything' || part === 'all') { out.push('everything'); continue; }
      if (COLOR_WORDS[part]) { out.push(COLOR_WORDS[part]); continue; }
      if (/^(?:colored|multicolored|monocolored|colorless)\b/.test(part)) { out.push(part.split(/\s+/)[0]); continue; }
      // card types / subtypes: "creatures", "artifacts", "Dragons", "instants"
      const word = part.split(/\s+/)[0];
      if (/^[a-z-]+$/.test(word)) out.push(`type:${singular(word)}`);
    }
  }
  return out;
}

function stripHostGrants(oracleText: string): string {
  // Grants to other objects are not this permanent's own protection.
  return String(oracleText || '')
    .replace(/(?:enchanted|equipped|fortified) (?:creature|permanent|land)s? (?:has|have|gets?[^.]*and has) protection from [^.\n]+/gi, ' ')
    .replace(/(?:other )?(?:creatures|permanents)[^.\n]*? have protection from [^.\n]+/gi, ' ')
    .replace(/(?:target|each|another|up to \w+ target) [^.\n]*?gains? protection from [^.\n]+/gi, ' ')
    .replace(/you have protection from [^.\n]+/gi, ' ');
}

function abilityText(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const e = entry as any;
    return String(e.ability || e.text || e.keyword || e.name || '');
  }
  return '';
}

export function collectPermanentProtectionQualities(state: GameState, permanent: any): string[] {
  if (!permanent) return [];
  const texts: string[] = [stripHostGrants(String(permanent?.card?.oracle_text || permanent?.oracle_text || ''))];
  for (const list of [
    permanent?.grantedAbilities, permanent?.tempAbilities, permanent?.temporaryAbilities,
    permanent?.grantedKeywords, permanent?.keywords, permanent?.card?.keywords,
  ]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const text = abilityText(entry);
      if (/protection from/i.test(text)) texts.push(text);
    }
  }
  const chosen = String(permanent?.chosenColor || permanent?.card?.chosenColor || '').toLowerCase();
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const permanentId = String(permanent?.id || '');
  for (const other of battlefield) {
    if (!other || String(other.id || '') === permanentId) continue;
    const attachedTo = String(other.attachedTo || other.enchanting || other.equipping || '');
    if (attachedTo !== permanentId) continue;
    const oracle = String(other?.card?.oracle_text || '');
    for (const m of oracle.matchAll(/(?:enchanted|equipped|fortified) (?:creature|permanent|land) (?:has|gets [^.]*? and has) (protection from [^.\n]+)/gi)) {
      texts.push(m[1]);
    }
  }
  const qualities = new Set<string>();
  for (const text of texts) {
    let normalized = text;
    if (chosen && COLOR_WORDS[chosen]) normalized = normalized.replace(/the chosen colou?r/gi, chosen);
    for (const q of parseProtectionQualities(normalized)) qualities.add(q);
  }
  return [...qualities];
}

function sourceTypeWords(source: any): string[] {
  const typeLine = String(source?.card?.type_line || source?.type_line || source?.spell?.type_line || '').toLowerCase();
  return typeLine.split(/[\s\u2014\-\/]+/).map((w) => w.trim()).filter(Boolean).map(singular);
}

/** True when the target permanent's protection prevents damage from this source. */
export function protectionPreventsDamageToPermanent(state: GameState, source: any, targetPermanent: any): boolean {
  if (!source || !targetPermanent) return false;
  const qualities = collectPermanentProtectionQualities(state, targetPermanent);
  if (qualities.length === 0) return false;
  const colors = getColorsFromObject(source).map((c) => String(c).toUpperCase());
  const types = sourceTypeWords(source);
  for (const q of qualities) {
    if (q === 'everything') return true;
    if (q.length === 1 && colors.includes(q)) return true;
    if (q === 'colored' && colors.length > 0) return true;
    if (q === 'multicolored' && colors.length > 1) return true;
    if (q === 'monocolored' && colors.length === 1) return true;
    if (q === 'colorless' && colors.length === 0 && types.length > 0) return true;
    if (q.startsWith('type:') && types.includes(q.slice(5))) return true;
  }
  return false;
}
