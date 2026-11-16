// server/src/state/modules/batch106CraftGrantedActivated.ts
// Engine side of craft-granted activated abilities (Locus of Enlightenment family):
// the crafted permanent has each activated ability of the exiled cards used to craft it,
// and may activate each of those abilities only once each turn when the host says so.
// Public: listCraftGrantedActivatedAbilityLines, mergeCraftGrantedActivatedAbilityLines,
// craftPermanentGrantsExiledActivatedKeywords.

import { isGrantedActivatedAbilityText } from '../../../../shared/src/attachmentAbilityGrants.js';
import { gatherCraftedMaterialCards } from './batch102CraftLinkage.js';
import {
  parseHasEachActivatedAbilityOfCraftExiledCards,
  parseActivateThoseAbilitiesOnlyOnceEachTurn,
  parseHasFlyingEtcAsLongAsCraftExiledCardHasKeyword,
} from './batch106Parsers.js';

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '');
}

function extractActivatedAbilityTexts(oracle: string): string[] {
  return String(oracle || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+/))
    .map((part) => String(part || '').trim().replace(/\.$/, ''))
    .filter((part) => isGrantedActivatedAbilityText(part));
}

const CRAFT_KEYWORD_WORDS = [
  'flying', 'first strike', 'double strike', 'deathtouch', 'haste', 'hexproof',
  'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance',
] as const;

function materialOracle(card: any): string {
  const face = card?.card && typeof card.card === 'object' ? card.card : card;
  return String(face?.oracle_text || card?.oracle_text || '');
}

function materialKeywords(card: any): string[] {
  const face = card?.card && typeof card.card === 'object' ? card.card : card;
  const printed = Array.isArray(face?.keywords) ? face.keywords.map((k: any) => String(k).toLowerCase()) : [];
  const text = materialOracle(card).toLowerCase();
  const out = new Set<string>(printed);
  for (const kw of CRAFT_KEYWORD_WORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(text)) out.add(kw);
  }
  return [...out];
}

export function listCraftGrantedActivatedAbilityLines(permanent: any, state: any): string[] {
  if (!parseHasEachActivatedAbilityOfCraftExiledCards(oracleOf(permanent))) return [];
  const once = parseActivateThoseAbilitiesOnlyOnceEachTurn(oracleOf(permanent));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of gatherCraftedMaterialCards(state, permanent)) {
    for (const ability of extractActivatedAbilityTexts(materialOracle(card))) {
      const key = ability.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(once && !/activate only once each turn/i.test(ability)
        ? `${ability}. Activate only once each turn.`
        : ability);
    }
  }
  return out;
}

export function mergeCraftGrantedActivatedAbilityLines(permanent: any, state: any, existing: string[]): string[] {
  const granted = listCraftGrantedActivatedAbilityLines(permanent, state);
  if (!granted.length) return existing;
  const seen = new Set(existing.map((line) => String(line || '').toLowerCase().trim()));
  const out = [...existing];
  for (const line of granted) {
    const key = line.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function craftPermanentGrantsExiledKeyword(permanent: any, state: any, keyword: string): boolean {
  if (!parseHasFlyingEtcAsLongAsCraftExiledCardHasKeyword(oracleOf(permanent))) return false;
  const want = String(keyword || '').toLowerCase();
  if (!want) return false;
  return gatherCraftedMaterialCards(state, permanent).some((card) => materialKeywords(card).includes(want));
}
