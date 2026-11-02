/**
 * Printed self-reference by card name ("When Toluz enters", "Whenever Wasp attacks").
 * The card's full name, each face name and its short legendary name (before the comma)
 * become "this permanent" (source: self, any object), which the subject parser reads.
 * Case-sensitive on purpose: card names are capitalized in oracle text.
 */

import { isCreatureTypeWord } from '../../../shared/src/creatureTypes.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shortened names printed in oracle text beyond the comma rule (CR 201.5):
 * a rank plus surname ("Dr. Leonard \"Bones\" McCoy" -> "Dr. McCoy", "Captain James T. Kirk" -> "Captain Kirk")
 * and the head of an "X of the Y" name ("Loran of the Third Path" -> "Loran") unless that head is a creature type.
 */
const RANK = /^(Dr\.|Doctor|Captain|Commander|Ensign|Lieutenant|Lt\.|Admiral|Chancellor|General|Counselor|Major|Colonel|Chief)\s+/;
function titledShortNames(short: string): string[] {
  const out: string[] = [];
  const rank = RANK.exec(short);
  const words = short.split(/\s+/);
  if (rank && words.length > 2) out.push(rank[1] + ' ' + words[words.length - 1]);
  const ofThe = /^([A-Z][A-Za-z'-]{2,}) of the /.exec(short);
  if (ofThe && !isCreatureTypeWord(ofThe[1])) out.push(ofThe[1]);
  return out;
}

export function selfNameVariants(cardName: string | undefined): string[] {
  const full = String(cardName || '').trim();
  if (!full) return [];
  const variants = new Set<string>();
  const faces = full.split(/\s*\/\/\s*/);
  // "SP//dr, Piloted by Peni" is one name containing "//": keep the whole name and its short form.
  if (faces.length > 1) {
    variants.add(full);
    const shortFull = full.split(',')[0].trim();
    if (shortFull.length >= 3 && shortFull !== full) variants.add(shortFull);
  }
  for (const face of faces) {
    const name = face.trim();
    // Split-card faces may be two letters; single names keep the 3-letter floor.
    if (name.length < (faces.length > 1 ? 2 : 3)) continue;
    variants.add(name);
    const short = name.split(',')[0].trim();
    // A one-letter legendary short name ("Q, Stacking the Deck" -> "Q") is still capitalized and unambiguous.
    if ((short.length >= 3 || /^[A-Z]$/.test(short)) && short !== name) variants.add(short);
    for (const extra of titledShortNames(short)) variants.add(extra);
  }
  // Longest first so "Greta, Sweettooth Scourge" wins over "Greta".
  return [...variants].sort((a, b) => b.length - a.length);
}

/**
 * Only the trigger condition (text before the first comma) is rewritten: the effect keeps the
 * printed name so effect-text dedupe against legacy-queued triggers still matches.
 */
export function normalizeSelfNameInTriggerSentence(sentence: string, cardName: string | undefined): string {
  let full = String(sentence || '');
  // A name with a comma ("Malik, Grim Manipulator") must not split the condition at its own comma.
  for (const name of selfNameVariants(cardName)) {
    if (!name.includes(',')) continue;
    const at = full.indexOf(name);
    const first = full.indexOf(',');
    if (at >= 0 && at < first && at + name.length > first) {
      full = full.slice(0, at) + 'this permanent' + full.slice(at + name.length);
    }
  }
  const comma = full.indexOf(',');
  const effect = comma >= 0 ? full.slice(comma) : '';
  let text = comma >= 0 ? full.slice(0, comma) : full;
  for (const name of selfNameVariants(cardName)) {
    text = text.replace(new RegExp(`(?<![A-Za-z'])${escapeRegex(name)}(?![A-Za-z'])`, 'g'), 'this permanent');
  }
  // Plural names ("Mikey & Mona enter") and the census tilde use the plural verb.
  text = text.replace(/(^|\s)~(?=\s)/g, '$1this permanent');
  text = text.replace(/\bthis permanent (enter|attack|die|block|leave)(?![a-z])/g, 'this permanent $1s');
  text = text.replace(/\bthis permanent ([a-z]+s) or (enter|attack|die|block|leave)(?![a-z])/g, 'this permanent $1 or $2s');
  return text + effect;
}