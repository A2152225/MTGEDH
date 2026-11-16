/** Line classification + family keys for static-replacement-census.ts. */
import { parseCopyEntryExceptions } from '../src/state/modules/copyEntryExceptions.js';
import { detectTriggerDoublers } from '../src/state/modules/triggers/trigger-doublers.js';
import { parseGenericCountCDA } from '../src/state/utils-handlers/variablePTGenericCountCDA.js';
import { parseBorrowedActivatedClause } from '../src/state/modules/staticEffectSpecBorrowedActivated.js';
import { stripStationThresholdPrefix } from './static-replacement-census-classify-trek.js';
import { OTHER_SYSTEMS } from './static-replacement-census-classify-other-systems.js';

/** R27: a trigger-doubling line counts as handled when trigger-doublers parses it to a supported doubler. */
function triggerDoublerHandles(line: string, cardName: string): boolean {
  const perm = { id: 'census-doubler', controller: 'census', card: { name: cardName, oracle_text: line } };
  const found = detectTriggerDoublers([perm], 'census');
  return found.length > 0 && found.every((d: any) => !d.unsupportedReason);
}

const ABILITY_WORD = /^\s*(?:[\d,]+\s+)?[A-Za-z][A-Za-z0-9' -]{0,40}?\s+(?:\u2014|--?)\s+/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceSelfName(line: string, cardName: string): string {
  let s = line;
  const names = new Set<string>();
  for (const face of cardName.split(/\s*\/\/\s*/)) {
    if (face.length >= 3) names.add(face);
    const short = face.split(',')[0].trim();
    if (short.length >= 3) names.add(short);
  }
  for (const n of [...names].sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(escapeRegex(n), 'g'), '~');
  return s;
}


export interface StaticCensusLineClass { scope: 'static' | 'replacement'; system?: string }

export function classifyStaticCensusLine(rawLine: string, cardName: string): StaticCensusLineClass | null {
  const line = String(rawLine || '').trim();
  if (!line || !/[.)"\u201d]$/.test(line)) return null; // keyword lines have no period
  // Batch 19: saga/chapter lines are chapter triggers (CR 714.2b), and keyword lines with reminder text ("Enchant creature (Target ...)") are keywords, not statics.
  if (/^(?:i|ii|iii|iv|v|vi|vii)(?:\s*,\s*(?:i|ii|iii|iv|v|vi|vii))*\s*(?:\u2014|--?)\s+/i.test(line)) return null;
  if (/^enchant [a-z ,]+\(/i.test(line)) return null;
  // B67/B68: ability-word prefixes are stripped below; classify Visit / Companion / Descend / Case / bang-triggers first.
  if (/^visit\s*[\u2014\u2013-]/i.test(line)) return { scope: 'static', system: 'Visit ability word (Attraction visit trigger)' };
  if (/^companion\s*[\u2014\u2013-]/i.test(line)) return { scope: 'static', system: 'Companion deck restriction (companion)' };
  if (/^descend \d+\s*[\u2014\u2013-]\s*(?:when|whenever|at)\b/i.test(line)) {
    return { scope: 'static', system: 'Descend ability word trigger (not as-long-as static)' };
  }
  if (/^to solve\s*[\u2014\u2013-]/i.test(line)) return { scope: 'static', system: 'Case to-solve condition (caseSolve)' };
  // "Tunnel Snakes Rule! — Whenever …" — bang ability words are not stripped by ABILITY_WORD.
  if (/!.{0,3}[\u2014\u2013-]\s*(?:when|whenever|at)\b/i.test(line)) {
    return { scope: 'static', system: 'ability-word bang trigger (when/whenever/at)' };
  }
  const body = stripStationThresholdPrefix(line).replace(ABILITY_WORD, '');
  // Activated ability: a cost before a colon outside quotes (incl. loyalty +1:).
  const unquoted = body.replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, '""');
  if (/^[^.]*?:/.test(unquoted) && !/^(?:choose|as long as)/i.test(unquoted)) return null;
  if (/^\([^)]*\)$/.test(body)) return null;
  const replacement = /\binstead\b|\bif .{0,80} would\b|\bskip\b|\bas though\b|\bprevent\b/i.test(body);
  const scope: 'static' | 'replacement' = replacement ? 'replacement' : 'static';
  const lower = replaceSelfName(body, cardName).replace(/this (?:creature|artifact|enchantment|land|permanent|vehicle)/gi, '~').replace(/\.$/, '');
  // Batch 20: trailing reminder text ("... and is goaded. (It attacks each combat ...)") must not defeat anchored entries.
  const core = lower.replace(/\s*\([^()]*\)$/, '').replace(/\.$/, '');
  // R21: copy-entry exceptions are part of the layer-1 copy effect (copyEntryExceptions).
  if (/\benter as a copy of\b[^"]*, except\b/i.test(body) && parseCopyEntryExceptions(body)) return { scope, system: 'copy entry exceptions (copyEntryExceptions)' };
  // R21: CR 122.1 counter placement restriction (counterPlacementRestrictions, applied in updateCounters).
  if (/^~ can't have counters put on it$/i.test(core)) return { scope, system: 'counter placement restriction (counterPlacementRestrictions)' };
  if (/\btriggers? an additional time\b/i.test(core) && triggerDoublerHandles(body, cardName)) return { scope, system: 'trigger doubling (trigger-doublers)' };
  for (const [system, re] of OTHER_SYSTEMS) if (re.test(lower) || (core !== lower && re.test(core))) return { scope, system };
  if (/^(?:when|whenever|at)\b/i.test(body)) return null;
  { const cda = /^~'s power and toughness are each equal to (.+?)\.?$/.exec(core); if (cda && parseGenericCountCDA(cda[1])) return { scope, system: 'generic count CDA (variablePTGenericCountCDA)' }; }
  { const ba = /^(?:as long as [^,]+ is on the battlefield, )?(?:~|it) has all activated abilities of (.+?)\.?$/i.exec(core); if (ba && parseBorrowedActivatedClause(ba[1])) return { scope, system: 'borrowed activated abilities (staticEffectSpecBorrowedActivated)' }; }
  return { scope };
}

const COLORS = /\b(white|blue|black|red|green|colorless|multicolored|monocolored)\b/g;

export function staticFamilyKey(rawLine: string, cardName: string): string {
  let s = replaceSelfName(String(rawLine || '').trim().replace(ABILITY_WORD, ''), cardName).toLowerCase();
  s = s
    .replace(/this (?:creature|artifact|enchantment|land|permanent|vehicle|planeswalker|equipment|aura)/g, '~')
    .replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, '"…"')
    .replace(/[+-]?\d+\/[+-]?\d+/g, '±N/±N')
    .replace(/[+-]x\/[+-]x/g, '±N/±N')
    .replace(/\{[^}]+\}/g, '{M}')
    .replace(/\b\d+\b|\b(?:one|two|three|four|five|six|seven)\b/g, 'N')
    .replace(COLORS, 'COLOR');
  // First clause of the ability is the family.
  const cut = s.search(/[.;]/);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/\s+/g, ' ').trim().slice(0, 110);
}
