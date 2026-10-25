/**
 * permanentKeywordAbilities.ts
 *
 * One source of truth for "does this permanent CURRENTLY have keyword X?"
 * (flying, reach, menace, trample, first/double strike, deathtouch, lifelink,
 * indestructible, vigilance, defender, haste, hexproof, shadow, ...).
 *
 * Reads the permanent's actual keywords instead of substring-searching its full
 * oracle text, so "Destroy target creature with flying" or "Creatures you control
 * have flying" never make the card itself a flyer:
 *  - keyword-only oracle lines ("Flying, vigilance", reminder text stripped) and
 *    static "this creature has X" sentences;
 *  - Scryfall `keywords` (ignored when the oracle only grants/references the word);
 *  - grantedAbilities / keywords / temporaryAbilities on the permanent;
 *  - keyword counters (flying counter, first strike counter, ...);
 *  - attached Equipment/Auras ("Equipped creature has flying");
 *  - lord/anthem statics on the battlefield ("Creatures you control have flying",
 *    "Other Elves you control have ...", "White creatures you control have ...");
 *  - removals ("loses flying", "lose all abilities") from the permanent itself,
 *    attachments and battlefield statics. Layer 6 timestamp order (CR 613.7): a removal beats every grant
 *    with an earlier (or unknown) timestamp; a grant stamped after the removal survives
 *    (abilityEffectTimestamps.ts), e.g. flying granted after Humility.
 *
 * Public entry symbols: permanentHasKeywordAbility, permanentLosesKeyword,
 * battlefieldGrantsKeywordTo, attachmentGrantsKeywordTo, permanentHasSelfCantBlock,
 * KEYWORD_COUNTER_NAMES.
 */

import {
  grantedAbilityIsOwnKeyword,
  oracleTextGrantsKeywordOnlyToOthers,
  isConditionalStaticLine,
  oracleTextHasOwnKeyword,
} from './oracleOwnKeywordText.js';
import { readAttachmentTimestamp, readPermanentTimestamp, TIMESTAMP_BASE } from './permanentTimestamps.js';
import { GRANT_LIST_FIELDS, readAbilityGrantTimestamp, readAbilityLossTimestamp } from './abilityEffectTimestamps.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const KEYWORD_COUNTER_NAMES: readonly string[] = [
  'flying', 'first strike', 'double strike', 'deathtouch', 'decayed', 'exalted',
  'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach', 'shadow',
  'trample', 'vigilance',
];

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function lower(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function cardOf(perm: any): any {
  return perm?.card || {};
}

function ownOracle(perm: any): string {
  const card = cardOf(perm);
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const faceIndex = typeof perm?.currentFace === 'number' ? perm.currentFace
    : typeof perm?.activeFace === 'number' ? perm.activeFace : -1;
  if (!card?.oracle_text && faceIndex >= 0 && faces[faceIndex]?.oracle_text) {
    return String(faces[faceIndex].oracle_text || '');
  }
  return String(card?.oracle_text || perm?.oracle_text || '');
}

function typeLineOf(perm: any): string {
  return lower(cardOf(perm)?.type_line || perm?.type_line || '');
}

function stripReminders(text: string): string {
  return String(text || '').replace(/\([^)]*\)/g, ' ');
}

function stripQuoted(text: string): string {
  return String(text || '').replace(/"[^"]*"/g, ' ').replace(/\u201c[^\u201d]*\u201d/g, ' ');
}

function stringEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry);
    else if (entry && typeof entry === 'object') {
      const e: any = entry;
      const text = e.ability ?? e.keyword ?? e.name ?? e.text ?? e.type ?? '';
      if (text) out.push(String(text));
    }
  }
  return out;
}

function counterHasKeyword(perm: any, kw: string): boolean {
  if (!KEYWORD_COUNTER_NAMES.includes(kw)) return false;
  const counters = perm?.counters;
  if (!counters || typeof counters !== 'object') return false;
  for (const [key, value] of Object.entries(counters)) {
    const name = lower(key).replace(/[_-]+/g, ' ').replace(/\s*counters?$/, '').trim();
    if (name === kw && Number(value) > 0) return true;
  }
  return false;
}

/** The permanent's own sources: printed text, Scryfall keywords, grants, temporaries, counters. */
function ownSourcesHaveKeyword(perm: any, kw: string): boolean {
  const oracle = ownOracle(perm);
  if (oracleTextHasOwnKeyword(oracle, kw)) return true;

  const scryfall = Array.isArray(cardOf(perm)?.keywords) ? cardOf(perm).keywords.map(lower) : [];
  if (scryfall.includes(kw)) {
    // Scryfall lists every keyword the card mentions; trust it only when the oracle
    // does not merely reference/grant the keyword to something else.
    const mentions = new RegExp(String.raw`\b${escapeRegExp(kw)}\b`, 'i').test(stripReminders(oracle));
    if (!mentions) return true;
  }

  // Stamped keyword lists can come from a naive scan of a lord's own grant
  // ("Other Dinosaurs you control have haste"); ignore them for that keyword.
  const otherOnlyGrant = oracleTextGrantsKeywordOnlyToOthers(oracle, kw);
  const permKeywords = [
    ...(otherOnlyGrant ? [] : stringEntries(perm?.keywords)),
    ...(otherOnlyGrant ? [] : stringEntries(perm?.grantedKeywords)),
    ...(otherOnlyGrant ? [] : stringEntries(perm?.grantedAbilities)),
    ...stringEntries(perm?.tempAbilities),
    ...stringEntries(perm?.temporaryAbilities),
    ...stringEntries(perm?.gainedAbilities),
    // Server-evaluated continuous grants whose conditions currently hold.
    ...stringEntries(perm?.continuousAbilities),
  ];
  if (permKeywords.some((entry) => grantedAbilityIsOwnKeyword(entry, kw))) return true;

  if (Array.isArray(perm?.abilities)) {
    for (const ability of perm.abilities) {
      if (!ability || typeof ability !== 'object') continue;
      if (lower((ability as any).type) === kw || lower((ability as any).name) === kw) return true;
    }
  }

  if (Array.isArray(perm?.modifiers)) {
    for (const mod of perm.modifiers) {
      const type = lower((mod as any)?.type);
      if ((type === 'abilitygrant' || type === 'ability_grant') && grantedAbilityIsOwnKeyword((mod as any)?.ability, kw)) {
        return true;
      }
    }
  }

  return counterHasKeyword(perm, kw);
}

function attachmentsOf(perm: any, battlefield: readonly any[] | undefined): any[] {
  if (!Array.isArray(battlefield) || battlefield.length === 0) return [];
  const id = String(perm?.id || '');
  const attachedIds = new Set<string>(
    Array.isArray(perm?.attachedEquipment) ? perm.attachedEquipment.map((x: unknown) => String(x)) : [],
  );
  for (const x of Array.isArray(perm?.attachments) ? perm.attachments : []) attachedIds.add(String(x));
  return battlefield.filter((candidate: any) => {
    if (!candidate || !candidate.card) return false;
    const cid = String(candidate.id || '');
    if (!cid || cid === id) return false;
    return attachedIds.has(cid) || (id !== '' && String(candidate.attachedTo || '') === id);
  });
}

function isStaticTextLine(line: string): boolean {
  if (/^\s*(?:when|whenever|at the beginning)\b/i.test(line)) return false;
  return !line.includes(':');
}

/** "Equipped creature has flying" / "Enchanted creature gets +1/+1 and has flying". */
export function attachmentGrantsKeywordTo(perm: any, kw: string, battlefield?: readonly any[]): boolean {
  const re = new RegExp(
    String.raw`\b(?:equipped|enchanted) (?:creature|permanent)\b[^.\n]*?\b(?:has|have|gains?)\b(?:[^.\n]*?[\s,])?${escapeRegExp(kw)}\b`,
    'i',
  );
  for (const attachment of attachmentsOf(perm, battlefield)) {
    const text = stripQuoted(stripReminders(ownOracle(attachment)));
    if (!/\b(?:equipped|enchanted) (?:creature|permanent)\b/i.test(text)) continue;
    for (const line of text.split(/\n+/)) {
      if (isStaticTextLine(line) && re.test(line)) return true;
    }
  }
  return false;
}

function permanentColors(perm: any): string[] {
  const raw = [
    ...(Array.isArray(perm?.colors) ? perm.colors : []),
    ...(Array.isArray(cardOf(perm)?.colors) ? cardOf(perm).colors : []),
  ];
  return raw.map((c: unknown) => String(c || '').toUpperCase());
}

function hasCreatureType(perm: any, word: string): boolean {
  const raw = lower(word).trim();
  if (!raw) return false;
  const candidates = new Set<string>([raw, raw.replace(/s$/, ''), raw.replace(/ies$/, 'y'), raw.replace(/ves$/, 'f')]);
  if (raw === 'elves') candidates.add('elf');
  const typeLine = typeLineOf(perm);
  const granted = [...stringEntries(perm?.grantedTypes), ...stringEntries(perm?.addedTypes)].map(lower);
  for (const type of candidates) {
    if (!type) continue;
    if (new RegExp(String.raw`\b${escapeRegExp(type)}\b`, 'i').test(typeLine)) return true;
    if (granted.includes(type)) return true;
  }
  return /\ball creature types\b|\bchangeling\b/i.test(ownOracle(perm));
}

/** Does the qualifier word list ("white", "elf", "nontoken", "legendary") describe `perm`? */
/** False only when nothing on the permanent suggests it is (or became) a creature. */
function mayBeCreature(perm: any): boolean {
  const typeLine = typeLineOf(perm);
  if (!typeLine || typeLine.includes('creature') || perm?.isCreature === true) return true;
  // Any type, animation, modifier or effect field (effectiveTypes, layer4AddedTypes, modifiers, temporaryEffects ...).
  return Object.keys(perm || {}).some((key) => key !== 'card' && /type|anim|modifier|effect/i.test(key)
    && perm[key] != null && /creature/i.test(typeof perm[key] === 'string' ? perm[key] : safeJson(perm[key])));
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? ''; } catch { return 'creature'; }
}

function qualifierMatches(perm: any, qualifier: string): boolean {
  const words = lower(qualifier).trim().split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (word === 'creature' || word === 'creatures' || word === 'permanents' || word === 'permanent') continue;
    if (COLOR_WORDS[word]) {
      if (!permanentColors(perm).includes(COLOR_WORDS[word])) return false;
      continue;
    }
    if (word === 'token' || word === 'tokens') { if (perm?.isToken !== true) return false; continue; }
    if (word === 'nontoken') { if (perm?.isToken === true) return false; continue; }
    if (word === 'legendary') { if (!typeLineOf(perm).includes('legendary')) return false; continue; }
    if (word === 'nonlegendary') { if (typeLineOf(perm).includes('legendary')) return false; continue; }
    if (/^(?:artifact|enchantment)s?$/.test(word)) {
      if (!typeLineOf(perm).includes(word.replace(/s$/, ''))) return false;
      continue;
    }
    if (word === 'attacking') { if (!perm?.attacking) return false; continue; }
    if (word === 'blocking') {
      if (!perm?.blocking || (Array.isArray(perm.blocking) && perm.blocking.length === 0)) return false;
      continue;
    }
    if (!hasCreatureType(perm, word)) return false;
  }
  return true;
}

interface StaticGrant {
  other: boolean;
  qualifier: string;
  scope: 'you' | 'opponents' | 'all';
  abilities: string;
  /** "Creatures you control with flying have ..." - the recipient must have this keyword. */
  withKeyword?: string;
}

const STATIC_GRANT_RE =
  /(?:^|[.;]\s*|,\s*)(other\s+|each other\s+)?(all\s+)?((?:[a-z-]+\s+){0,3}?)([a-z-]+)(\s+you control|\s+your opponents control)?(?:\s+with\s+([a-z ]+?))?\s+(?:get\s+[+-][\dx]+\/[+-][\dx]+\s+and\s+)?(have|lose)\s+([^.\n]+)/gi;

function parseStaticGrants(text: string, verb: 'have' | 'lose'): StaticGrant[] {
  const out: StaticGrant[] = [];
  const source = stripQuoted(stripReminders(text));
  for (const line of source.split(/\n+/)) {
    if (!isStaticTextLine(line)) continue;
    // Conditional lords ("As long as ..., creatures you control have X") are evaluated by the
    // server's continuous-effects engine and arrive via continuousAbilities.
    if (isConditionalStaticLine(line)) continue;
    STATIC_GRANT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STATIC_GRANT_RE.exec(line)) !== null) {
      if (lower(match[7]) !== verb) continue;
      const control = lower(match[5]);
      const hasAll = Boolean(match[2]);
      // "Other Merfolk get +1/+1 and have islandwalk" (Lord of Atlantis) is global like "All ...".
      if (!control && !hasAll && !match[1]) continue;
      const noun = lower(match[4]);
      if (/^(?:you|it|they|that|this)$/.test(noun)) continue;
      const qualifierWords = lower(match[3]).trim();
      if (/\b(?:with|without|that|which|the|target|each|those|enchanted|equipped|have|has)\b/.test(qualifierWords)) continue;
      const withKeyword = lower(match[6]).trim();
      if (withKeyword && withKeyword.split(/\s+/).length > 2) continue;
      const scope: StaticGrant['scope'] = /opponent/.test(control) ? 'opponents' : control ? 'you' : 'all';
      const qualifier = noun === 'creatures' ? qualifierWords : `${qualifierWords} ${noun}`.trim();
      out.push({
        other: Boolean(match[1]),
        qualifier,
        scope,
        abilities: lower(match[8]),
        ...(withKeyword ? { withKeyword } : {}),
      });
    }
  }
  return out;
}

function grantListIncludes(abilities: string, kw: string): boolean {
  return new RegExp(String.raw`(?:^|[\s,])${escapeRegExp(kw)}\b`, 'i').test(abilities);
}

const withKeywordDepth = { value: 0 };

/**
 * Lord self-inclusion (CR 613 / 109.4): a source that matches its own description gets its own
 * grant ("Creatures you control have flying", "Elves you control get +1/+1" on an Elf). Only
 * "other" / "each other" excludes it.
 */
function grantApplies(grant: StaticGrant, source: any, perm: any, battlefield?: readonly any[]): boolean {
  // "All creatures lose all abilities" (Humility) never reaches a non-creature such as Opalescence itself.
  if (!/\b(?:permanents?|artifacts?|enchantments?|lands?)\b/.test(grant.qualifier) && !mayBeCreature(perm)) return false;
  if (grant.other && String(source?.id || '') === String(perm?.id || '')) return false;
  if (grant.withKeyword) {
    if (withKeywordDepth.value > 2) return false;
    withKeywordDepth.value += 1;
    try {
      if (!permanentHasKeywordAbility(perm, grant.withKeyword, battlefield)) return false;
    } finally {
      withKeywordDepth.value -= 1;
    }
  }
  const sameController = String(source?.controller || '') === String(perm?.controller || '');
  if (grant.scope === 'you' && !sameController) return false;
  if (grant.scope === 'opponents' && sameController) return false;
  return qualifierMatches(perm, grant.qualifier);
}

/** Lord/anthem statics on the battlefield that give `perm` the keyword. */
export function battlefieldGrantsKeywordTo(perm: any, kw: string, battlefield?: readonly any[], includeSelf = true): boolean {
  const kwRe = new RegExp(String.raw`\b${escapeRegExp(kw)}\b`, 'i');
  // The permanent's own lord text applies to itself when it matches, even if the caller passed
  // no battlefield (or a battlefield snapshot without it).
  const sources: any[] = Array.isArray(battlefield) ? [...battlefield] : [];
  const permId = String(perm?.id || '');
  if (includeSelf && perm?.card && !sources.some((s: any) => s === perm || (permId && String(s?.id || '') === permId))) sources.push(perm);
  for (const source of sources) {
    if (!source || !source.card || source.phasedOut) continue;
    const text = ownOracle(source);
    if (!text || !kwRe.test(text)) continue;
    if (staticSourceAbilitiesRemoved(source, battlefield)) continue;
    for (const grant of parseStaticGrants(text, 'have')) {
      // "all abilities of your choice among ..." (Greymond) / "all activated abilities of ..."
      // are choice/copy grants owned by dedicated paths, not a plain keyword list.
      if (/^\s*all\b|\bof your choice\b/.test(grant.abilities)) continue;
      if (!grantListIncludes(grant.abilities, kw)) continue;
      if (grantApplies(grant, source, perm, battlefield)) return true;
    }
  }
  return false;
}

function textRemovesKeyword(rawText: string, kw: string): boolean {
  // Blood Sun: "lose all abilities except mana abilities" keeps mana abilities, so it is not total loss.
  const text = String(rawText || '').replace(/\ball abilities except mana abilities\b/gi, 'all nonmana abilities');
  // "loses all other card types and abilities" (Imprisoned in the Moon) removes every keyword the text does not name.
  if (kw !== 'all abilities' && /\b(?:loses?|lose)\b[^.\n]*?\ball other [a-z ,]*?\babilities\b/i.test(String(text || ''))
    && !new RegExp(String.raw`\b${escapeRegExp(kw)}\b`, 'i').test(String(text || ''))) return true;
  return new RegExp(
    // "loses all other abilities" (Darksteel Mutation) only counts as total loss, not as losing a kept keyword.
    String.raw`\b(?:loses?|lose)\b[^.\n]*?(?:\ball abilities\b|${kw === 'all abilities' ? String.raw`\ball other [a-z ,]*?\babilities\b|` : ''}(?:^|[\s,])${escapeRegExp(kw)}\b)`,
    'i',
  ).test(String(text || ''));
}

const abilitylessGateDepth = { value: 0 };
const loseTextScans = new WeakMap<object, { signature: string; hasLoseText: boolean }>();
/** Cached per battlefield array: does any permanent's text say "lose(s)"? Keeps mass-token boards O(n). */
function boardHasLoseText(battlefield?: readonly any[]): boolean {
  if (!Array.isArray(battlefield) || battlefield.length === 0) return false;
  const signature = `${battlefield.length}|${String(battlefield[battlefield.length - 1]?.id || '')}`;
  const cached = loseTextScans.get(battlefield);
  if (cached && cached.signature === signature) return cached.hasLoseText;
  const hasLoseText = battlefield.some((p: any) => /\blos(?:e|es)\b/i.test(ownOracle(p)));
  loseTextScans.set(battlefield, { signature, hasLoseText });
  return hasLoseText;
}
function hasOwnAbilityLossData(perm: any): boolean {
  return perm?.losesAllAbilities === true || perm?.lostAllAbilities === true
    || ['removedKeywords', 'lostKeywords', 'lostAbilities', 'removedAbilities', 'temporaryEffects']
      .some((field) => Array.isArray(perm?.[field]) && perm[field].length > 0);
}
/**
 * CR 613.1f / 613.6: a static source that lost all its abilities (Humility on a lord, Turn to Frog) grants
 * nothing to others. Sources whose own text removes abilities (Humility under Opalescence) are exempt:
 * an effect that began applying in an earlier layer keeps applying.
 */
export function staticSourceAbilitiesRemoved(source: any, battlefield?: readonly any[]): boolean {
  if (!source || abilitylessGateDepth.value > 0) return false;
  if (!hasOwnAbilityLossData(source) && !boardHasLoseText(battlefield)) return false;
  if (/\blose all abilities\b|\bloses all abilities\b/i.test(ownOracle(source))) return false;
  abilitylessGateDepth.value += 1;
  try {
    return permanentLosesAllAbilities(source, battlefield);
  } finally {
    abilitylessGateDepth.value -= 1;
  }
}

/** Humility / Turn to Frog style "loses all abilities" (CR 613.1f, layer 6). */
export function permanentLosesAllAbilities(perm: any, battlefield?: readonly any[]): boolean {
  return permanentLosesKeyword(perm, 'all abilities', battlefield);
}

/** "Loses flying" / "loses all abilities" from the permanent, its attachments or battlefield statics. */
export function permanentLosesKeyword(perm: any, keyword: string, battlefield?: readonly any[]): boolean {
  return permanentKeywordLossTimestamp(perm, keyword, battlefield) !== undefined;
}

/**
 * Latest timestamp of an effect removing `keyword` (or all abilities) from `perm`; Infinity when a removal has
 * no known timestamp (nothing can be granted after it), undefined when nothing removes it.
 */
export function permanentKeywordLossTimestamp(perm: any, keyword: string, battlefield?: readonly any[]): number | undefined {
  const kw = lower(keyword).replace(/_/g, ' ').trim();
  if (!kw || !perm) return undefined;
  let latest: number | undefined;
  const note = (ts: number | undefined) => { const v = ts ?? Infinity; latest = latest === undefined ? v : Math.max(latest, v); };
  if (perm.losesAllAbilities === true || perm.lostAllAbilities === true) note(readAbilityLossTimestamp(perm, 'all abilities'));
  const removed = [
    ...stringEntries(perm.removedKeywords),
    ...stringEntries(perm.lostKeywords),
    ...stringEntries(perm.lostAbilities),
    ...stringEntries(perm.removedAbilities),
  ].map(lower);
  if (removed.includes(kw)) note(readAbilityLossTimestamp(perm, kw));
  if (removed.includes('all abilities') || removed.includes('all')) note(readAbilityLossTimestamp(perm, 'all abilities'));
  for (const effect of Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []) {
    const text = typeof effect === 'string' ? effect : `${effect?.effect || ''} ${effect?.description || ''}`;
    const effectTs = typeof effect === 'object' && effect ? finiteStamp(effect.ceTimestamp) : undefined;
    if (textRemovesKeyword(text, kw) || stringEntries(effect?.removedKeywords).map(lower).includes(kw)) note(effectTs);
  }
  for (const attachment of attachmentsOf(perm, battlefield)) {
    const text = stripQuoted(stripReminders(ownOracle(attachment)));
    const sentence = text.match(/\b(?:equipped|enchanted) (?:creature|permanent)\b[^.\n]*\bloses?\b[^.\n]*/i)?.[0] || '';
    if (sentence && textRemovesKeyword(sentence, kw)) note(readAttachmentTimestamp(attachment) ?? readPermanentTimestamp(attachment));
  }
  if (Array.isArray(battlefield)) {
    for (const source of battlefield) {
      if (!source?.card || source.phasedOut) continue;
      const text = ownOracle(source);
      if (!/\blose\b/i.test(text)) continue;
      for (const grant of parseStaticGrants(text, 'lose')) {
        // Blood Sun: "all abilities except mana abilities" removes keywords (never mana) but is not total loss.
        if (/^\s*all abilities except mana abilities\b/i.test(grant.abilities)) { if (kw === 'all abilities') continue; }
        else if (!grantListIncludes(grant.abilities, kw) && !/^\s*all abilities\b/.test(grant.abilities)) continue;
        if (grantApplies(grant, source, perm, battlefield)) { note(readPermanentTimestamp(source)); break; }
      }
    }
  }
  return latest;
}

function finiteStamp(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > TIMESTAMP_BASE ? n : undefined;
}

/** Timestamp of the effect source as seen by `perm`: attachment stamp for its own Auras/Equipment, else entry stamp. */
function sourceTimestampFor(source: any, perm: any): number | undefined {
  if (source?.attachedTo && String(source.attachedTo) === String(perm?.id || '')) return readAttachmentTimestamp(source);
  return readPermanentTimestamp(source);
}

/** Grants of `kw` to `perm` whose timestamp is later than `lossTs` (they apply after the removal in layer 6). */
function keywordGrantedAfter(perm: any, kw: string, lossTs: number, battlefield?: readonly any[]): boolean {
  if (!Number.isFinite(lossTs)) return false;
  for (const field of GRANT_LIST_FIELDS) {
    for (const entry of stringEntries(perm?.[field])) {
      if (grantedAbilityIsOwnKeyword(entry, kw) && (readAbilityGrantTimestamp(perm, entry) ?? 0) > lossTs) return true;
    }
  }
  for (const mod of Array.isArray(perm?.modifiers) ? perm.modifiers : []) {
    const type = lower((mod as any)?.type);
    if ((type === 'abilitygrant' || type === 'ability_grant') && grantedAbilityIsOwnKeyword((mod as any)?.ability, kw)
      && (finiteStamp((mod as any)?.timestamp) ?? 0) > lossTs) return true;
  }
  if (!Array.isArray(battlefield)) return false;
  const later = battlefield.filter((source: any) => source && source !== perm
    && String(source.id || '') !== String(perm?.id || '') && (sourceTimestampFor(source, perm) ?? 0) > lossTs);
  if (later.length === 0) return false;
  return attachmentGrantsKeywordTo(perm, kw, later) || battlefieldGrantsKeywordTo(perm, kw, later, false);
}

/**
 * True when `perm` currently has keyword ability `keyword`.
 * Pass the battlefield so equipment/aura/lord grants and removals are honored.
 */
export function permanentHasKeywordAbility(
  perm: any,
  keyword: string,
  battlefield?: readonly any[],
): boolean {
  const kw = lower(keyword).replace(/_/g, ' ').trim();
  if (!kw || !perm) return false;
  const lossTs = permanentKeywordLossTimestamp(perm, kw, battlefield);
  if (lossTs !== undefined) return keywordGrantedAfter(perm, kw, lossTs, battlefield);
  if (ownSourcesHaveKeyword(perm, kw)) return true;
  if (attachmentGrantsKeywordTo(perm, kw, battlefield)) return true;
  return battlefieldGrantsKeywordTo(perm, kw, battlefield);
}

const SELF_CANT_BLOCK_TAIL = String.raw`can(?:'|\u2019)?t (?:attack or )?block\b(?!\s+(?:creatures|except|unless|alone|an?\b|this\b(?!\s+turn)|that\b|those\b))`;

/**
 * True when `perm` itself can't block: printed static "This creature can't block"
 * (or "<name>/it can't block", "can't attack or block"), a granted/temporary
 * "can't block" effect on it, or a battlefield static ("Creatures your opponents
 * control can't block"). An activated/triggered "target creature can't block"
 * on the card does NOT stop the card itself from blocking.
 */
export function permanentHasSelfCantBlock(perm: any, battlefield?: readonly any[]): boolean {
  if (!perm) return false;
  const tail = new RegExp(String.raw`\b${SELF_CANT_BLOCK_TAIL}`, 'i');
  const external = [
    ...stringEntries(perm?.grantedAbilities),
    ...stringEntries(perm?.tempAbilities),
    ...stringEntries(perm?.temporaryAbilities),
    ...(Array.isArray(perm?.temporaryEffects)
      ? perm.temporaryEffects.map((e: any) => String(typeof e === 'string' ? e : (e?.description || e?.effect || '')))
      : []),
  ];
  for (const entry of external) {
    const text = stripQuoted(String(entry || ''));
    if (/\btarget\b/i.test(text)) continue;
    if (tail.test(text)) return true;
  }

  const name = escapeRegExp(lower(cardOf(perm)?.name || '').trim());
  const subject = String.raw`(?:this creature|this permanent|~|it${name ? `|${name}` : ''})`;
  const selfRe = new RegExp(String.raw`(?:^|[.;,]\s*)${subject}\s+${SELF_CANT_BLOCK_TAIL}`, 'i');
  for (const line of stripQuoted(stripReminders(ownOracle(perm))).toLowerCase().split(/\n+/)) {
    if (isStaticTextLine(line) && selfRe.test(line.trim())) return true;
  }

  if (Array.isArray(battlefield)) {
    const blanketRe = new RegExp(
      String.raw`(?:^|[.;,]\s*)(other\s+)?(?:all\s+)?((?:[a-z-]+\s+){0,3}?)creatures(\s+you control|\s+your opponents control)?\s+${SELF_CANT_BLOCK_TAIL}`,
      'i',
    );
    for (const source of battlefield) {
      if (!source?.card || source.phasedOut) continue;
      const text = stripQuoted(stripReminders(ownOracle(source))).toLowerCase();
      if (!text.includes('block')) continue;
      for (const line of text.split(/\n+/)) {
        if (!isStaticTextLine(line)) continue;
        const match = line.match(blanketRe);
        if (!match) continue;
        if (/\b(?:with|without|that|target|each|those)\b/.test(match[2] || '')) continue;
        const control = lower(match[3]);
        const grant: StaticGrant = {
          other: Boolean(match[1]),
          qualifier: lower(match[2]).trim(),
          scope: /opponent/.test(control) ? 'opponents' : control ? 'you' : 'all',
          abilities: '',
        };
        if (grantApplies(grant, source, perm, battlefield)) return true;
      }
    }
  }
  return false;
}
