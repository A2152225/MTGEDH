// server/src/state/modules/intrinsicAlsoCreatureTypes.ts
// CR 604.3 / 205.3: characteristic-defining "<this> is also a Cleric, Rogue, Warrior, and Wizard"
// (Stonework Packbeast and similar) adds creature types in every zone, unconditionally.
// Public: parseIntrinsicAlsoCreatureTypes, addIntrinsicAlsoCreatureTypes.

import { isCreatureTypeWord } from '../../../../shared/src/creatureTypes.js';

const LINE_RE = /^(?:this creature|this permanent|this card|~|(.+?)) is also an? ([a-z ,'-]+?)\.?$/i;

/** Creature types added by a self "is also a ..." line; [] when none or any listed word is not a creature type. */
export function parseIntrinsicAlsoCreatureTypes(oracle: unknown, name?: unknown): string[] {
  const cardName = String(name || '').trim().toLowerCase();
  for (const raw of String(oracle || '').split(/\n+/)) {
    const line = raw.trim();
    const m = LINE_RE.exec(line);
    if (!m) continue;
    if (m[1] && cardName && m[1].trim().toLowerCase() !== cardName) continue;
    if (m[1] && !cardName) continue;
    const words = m[2].split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/).map((w) => w.trim()).filter(Boolean);
    if (words.length === 0 || !words.every((w) => isCreatureTypeWord(w))) continue;
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return [];
}

/** Merge intrinsic "is also a" types into the per-pass typeAdditions map (case-insensitive dedupe). */
export function addIntrinsicAlsoCreatureTypes(
  battlefield: readonly any[],
  typeAdditions: Map<string, string[]>,
): void {
  for (const perm of battlefield) {
    const id = String(perm?.id || '');
    if (!id) continue;
    const adds = parseIntrinsicAlsoCreatureTypes(perm?.card?.oracle_text, perm?.card?.name);
    if (adds.length === 0) continue;
    const merged = [...(typeAdditions.get(id) || [])];
    for (const t of adds) if (!merged.some((e) => e.toLowerCase() === t.toLowerCase())) merged.push(t);
    typeAdditions.set(id, merged);
  }
}
