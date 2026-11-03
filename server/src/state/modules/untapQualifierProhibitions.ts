// server/src/state/modules/untapQualifierProhibitions.ts
// Batch 35: "Creatures with flying don't untap during their controllers' untap steps." (Energy Storm, Blizzard)
// and "Creatures with power N or greater don't untap during their controllers' untap steps." (Meekstone, Marble Titan).
// Origin parent: untapPermanentsForPlayer (turn-handlers/turnUntapPermanents.ts).
// detectDoesntUntapEffects (turn-phases.ts) only reads unqualified subjects, so these sources are handled here.
// Public entry symbol: qualifiedUntapProhibitionSource.
import { permanentHasKeywordAbility } from "../../../../rules-engine/src/permanentKeywordAbilities.js";
import { getEffectivePower } from "../../socket/util-handlers/getEffectivePowerToughness.js";
import { untapTypeChoiceSource } from "./untapTypeChoiceRestriction.js"; // B48

const QUAL_RE = /\bcreatures with (?:(flying|reach|defender|horsemanship|shadow|haste|trample)|power (\d+) or (greater|less)) don't untap during their controllers' untap steps/;
// B36: "Nonbasic lands don't untap during their controllers' untap steps." (Back to Basics)
const NONBASIC_RE = /\bnonbasic lands don't untap during their controllers' untap steps/;
// B47: "Legendary creatures" (Arena of the Ancients), "Creatures with ice counters on them" (Rimescale Dragon),
// and a creature-subtype plural (Root Cage: "Mercenaries").
const LEGENDARY_RE = /\blegendary creatures don't untap during their controllers' untap steps/;
const COUNTER_RE = /\bcreatures with (?:an? )?([a-z0-9+\/-]+) counters? on (?:them|it) don't untap during their controllers' untap steps/;
const SUBTYPE_RE = /(?:^|[.\n]\s*)([a-z]+) don't untap during their controllers' untap steps/g;
const NON_SUBTYPE = new Set(['creatures', 'lands', 'artifacts', 'permanents', 'enchantments', 'planeswalkers', 'plains', 'islands', 'swamps', 'mountains', 'forests']);

function singular(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(?:ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

function b47UntapSource(list: readonly any[], permanent: any, typeLine: string): string | null {
  const subtypes = (typeLine.split(/[\u2014-]/)[1] || '').toLowerCase().split(/\s+/).filter(Boolean);
  const counters = permanent?.counters || {};
  for (const src of list) {
    if (!src || src.phasedOut) continue;
    const text = oracleText(src);
    if (!text.includes("don't untap")) continue;
    const name = String(src?.card?.name || 'A permanent');
    if (LEGENDARY_RE.test(text) && /\blegendary\b/i.test(typeLine)) return name;
    const cm = text.match(COUNTER_RE);
    if (cm && Number(counters[cm[1]] || 0) > 0) return name;
    SUBTYPE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SUBTYPE_RE.exec(text))) {
      if (NON_SUBTYPE.has(m[1])) continue;
      if (subtypes.includes(singular(m[1])) || subtypes.includes(m[1])) return name;
    }
  }
  return null;
}

function oracleText(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

export function qualifiedUntapProhibitionSource(battlefield: readonly any[] | undefined, permanent: any, state?: any): string | null {
  const list = Array.isArray(battlefield) ? battlefield : [];
  const b48Matrix = untapTypeChoiceSource(list, permanent, state); // B48
  if (b48Matrix) return b48Matrix;
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '');
  if (/\bland\b/i.test(typeLine) && !/\bbasic\b/i.test(typeLine)) {
    const nb = list.find((src: any) => src && !src.phasedOut && NONBASIC_RE.test(oracleText(src)));
    if (nb) return String(nb?.card?.name || 'A permanent');
  }
  if (!/\bcreature\b/i.test(typeLine)) return null;
  const b47 = b47UntapSource(list, permanent, typeLine);
  if (b47) return b47;
  for (const src of list) {
    if (!src || src.phasedOut) continue;
    const m = oracleText(src).match(QUAL_RE);
    if (!m) continue;
    if (m[1]) {
      if (permanentHasKeywordAbility(permanent, m[1], list as any[])) return String(src?.card?.name || 'A permanent');
      continue;
    }
    const power = Number(getEffectivePower(permanent)) || 0;
    const n = Number(m[2]);
    if (m[3] === 'greater' ? power >= n : power <= n) return String(src?.card?.name || 'A permanent');
  }
  return null;
}
