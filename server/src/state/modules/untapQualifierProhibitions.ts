// server/src/state/modules/untapQualifierProhibitions.ts
// Batch 35: "Creatures with flying don't untap during their controllers' untap steps." (Energy Storm, Blizzard)
// and "Creatures with power N or greater don't untap during their controllers' untap steps." (Meekstone, Marble Titan).
// Origin parent: untapPermanentsForPlayer (turn-handlers/turnUntapPermanents.ts).
// detectDoesntUntapEffects (turn-phases.ts) only reads unqualified subjects, so these sources are handled here.
// Public entry symbol: qualifiedUntapProhibitionSource.
import { permanentHasKeywordAbility } from "../../../../rules-engine/src/permanentKeywordAbilities.js";
import { getEffectivePower } from "../../socket/util-handlers/getEffectivePowerToughness.js";

const QUAL_RE = /\bcreatures with (?:(flying|reach|defender|horsemanship|shadow|haste|trample)|power (\d+) or (greater|less)) don't untap during their controllers' untap steps/;
// B36: "Nonbasic lands don't untap during their controllers' untap steps." (Back to Basics)
const NONBASIC_RE = /\bnonbasic lands don't untap during their controllers' untap steps/;

function oracleText(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

export function qualifiedUntapProhibitionSource(battlefield: readonly any[] | undefined, permanent: any): string | null {
  const list = Array.isArray(battlefield) ? battlefield : [];
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '');
  if (/\bland\b/i.test(typeLine) && !/\bbasic\b/i.test(typeLine)) {
    const nb = list.find((src: any) => src && !src.phasedOut && NONBASIC_RE.test(oracleText(src)));
    if (nb) return String(nb?.card?.name || 'A permanent');
  }
  if (!/\bcreature\b/i.test(typeLine)) return null;
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
