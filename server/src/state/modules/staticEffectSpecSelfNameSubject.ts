// server/src/state/modules/staticEffectSpecSelfNameSubject.ts
// R36: printed self-name subjects at the start of a static line ("Tuvasa gets +1/+1 for each ...",
// "Oketra can't attack or block unless ...", "Nick Valentine can't be blocked except by ...") become
// "This creature" so every self-scoped static parser sees one subject form. Covers the full name, the
// comma short name, "X the Y" / "X of the Y" heads and two-word personal names (not creature types).
// Only creature (or Vehicle) permanents; only line-leading subjects followed by a static verb.
// Public entry symbols: normalizeStaticSelfNameSubjects.

import { selfNameVariants } from '../../../../rules-engine/src/triggerCondition/selfNameNormalize.js';
import { isCreatureTypeWord } from '../../../../shared/src/creatureTypes.js';

const VERBS = "(?:can't|cannot|can|gets|get|has|have|is|attacks|blocks|must|doesn't|does)";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
}

function nameVariants(name: string): string[] {
  const out = new Set(selfNameVariants(name));
  for (const face of name.split(/\s*\/\/\s*/)) {
    const short = face.split(',')[0].trim();
    const the = /^([A-Z][A-Za-z'-]{2,}) the [A-Z]/.exec(short);
    if (the && !isCreatureTypeWord(the[1])) out.add(the[1]);
  }
  return [...out].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length);
}

export function normalizeStaticSelfNameSubjects(oracleText: string, perm: any): string {
  const text = String(oracleText || '');
  const name = String(perm?.card?.name || perm?.name || '').trim();
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  if (!name || !/\b(?:creature|vehicle)\b/.test(typeLine)) return text;
  const variants = nameVariants(name);
  if (!variants.length) return text;
  const alt = variants.map(escapeRe).join('|');
  const re = new RegExp('(^|\\n|\u2014 |\u2013 )(?:' + alt + ')(?= ' + VERBS + '\\b)', 'g');
  return text.replace(re, (_m: string, lead: string) => lead + 'This creature');
}
