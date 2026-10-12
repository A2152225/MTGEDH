/**
 * classLevelText.ts - Class enchantment level gating (CR 716).
 *
 * A Class's oracle is split into sections by its level abilities ("{W}: Level 2",
 * "{3}{W}: Level 3"). Only the level-1 section plus sections for levels <= the current
 * class level are active (716.2a/b), and only the NEXT level ability can do anything
 * (716.2c: Level N may be activated only at level N-1).
 *
 * The server keeps the printed text in card.classFullOracleText and writes the gated text
 * to card.oracle_text on the battlefield, so every reader (static/anthem parsing, trigger
 * detection, activated abilities for client + AI, P/T breakdown) sees only active abilities.
 * Public entry symbols: isClassLevelOracleText, gateClassOracleTextForLevel,
 * getPermanentClassLevel, applyClassLevelGatingToPermanent, restoreClassFullOracleText,
 * splitClassLevelSections.
 */

const LEVEL_HEADER_RE = /^\s*((?:\{[^}]*\}\s*)+):\s*level\s+(\d+)\s*$/i;

export function isClassLevelOracleText(text: unknown): boolean {
  return String(text || '').split(/\r?\n/).some((line) => LEVEL_HEADER_RE.test(line));
}

/** Oracle text with only the abilities active at `level` (plus the next level-up ability). */
export function gateClassOracleTextForLevel(fullText: string, level: number): string {
  const current = Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
  const out: string[] = [];
  let sectionLevel = 1;
  for (const line of String(fullText || '').split(/\r?\n/)) {
    const header = line.match(LEVEL_HEADER_RE);
    if (header) {
      sectionLevel = Number(header[2]);
      if (sectionLevel === current + 1) out.push(line);
      continue;
    }
    if (sectionLevel <= current) out.push(line);
  }
  return out.join('\n').trim();
}

export function getPermanentClassLevel(perm: any): number {
  const raw = Number(perm?.level ?? perm?.classLevel);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function isClassCard(card: any): boolean {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return /\bclass\b/.test(typeLine);
}

/** Write the gated oracle onto a battlefield Class permanent. Returns true when changed. */
export function applyClassLevelGatingToPermanent(perm: any): boolean {
  const card = perm?.card;
  if (!card || typeof card !== 'object' || !isClassCard(card)) return false;
  const full = String(card.classFullOracleText || card.oracle_text || '');
  if (!isClassLevelOracleText(full)) return false;
  const level = getPermanentClassLevel(perm);
  const gated = gateClassOracleTextForLevel(full, level);
  if (card.classFullOracleText === full && card.oracle_text === gated && card.classLevel === level) return false;
  // classLevel on the card lets card-only views (hover preview) show the current level.
  perm.card = { ...card, classFullOracleText: full, oracle_text: gated, classLevel: level };
  return true;
}

/** A Class card off the battlefield shows its full printed text again. */
export function restoreClassFullOracleText(card: any): boolean {
  if (!card || typeof card !== 'object') return false;
  const full = card.classFullOracleText;
  if (typeof full !== 'string' || !full) return false;
  if (card.oracle_text === full && card.classLevel === undefined) return false;
  card.oracle_text = full;
  delete card.classLevel;
  return true;
}

export interface ClassLevelSection {
  /** 1 for the printed level-1 abilities, N for the "Level N" section. */
  level: number;
  /** The level-up line ("{1}{W}: Level 2"), absent for level 1. */
  header?: string;
  text: string;
  active: boolean;
}

/** Split a Class's printed oracle into level sections, marking which are active at `level`. */
export function splitClassLevelSections(fullText: string, level: number): ClassLevelSection[] {
  const current = Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
  const sections: ClassLevelSection[] = [];
  let section: ClassLevelSection = { level: 1, text: '', active: true };
  for (const line of String(fullText || '').split(/\r?\n/)) {
    const header = line.match(LEVEL_HEADER_RE);
    if (header) {
      sections.push(section);
      const n = Number(header[2]);
      section = { level: n, header: line.trim(), text: '', active: n <= current };
      continue;
    }
    section.text = section.text ? `${section.text}\n${line}` : line;
  }
  sections.push(section);
  return sections
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text || s.header);
}
