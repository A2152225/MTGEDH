/**
 * Printed self-reference by card name ("When Toluz enters", "Whenever Wasp attacks").
 * The card's full name, each face name and its short legendary name (before the comma)
 * become "this permanent" (source: self, any object), which the subject parser reads.
 * Case-sensitive on purpose: card names are capitalized in oracle text.
 */

import { isCreatureTypeWord } from '../../../shared/src/creatureTypes.js';

/** Land, artifact, enchantment, spell, and card-type words that are typal in oracle text, not a short personal name. */
const TYPAL_TYPE_WORDS = new Set([
  'plains', 'island', 'swamp', 'mountain', 'forest', 'gate', 'desert', 'lair', 'locus', 'mine', 'tower', 'sphere', 'cave', 'cloud', 'town', 'planet', "urza's", 'power-plant',
  'equipment', 'vehicle', 'contraption', 'fortification', 'clue', 'food', 'gold', 'treasure', 'blood', 'powerstone', 'incubator', 'map', 'lander',
  'aura', 'cartouche', 'curse', 'saga', 'shrine', 'case', 'class', 'room', 'role', 'background', 'shard', 'cage',
  'adventure', 'arcane', 'lesson', 'trap', 'chorus',
  'artifact', 'creature', 'enchantment', 'land', 'instant', 'sorcery', 'planeswalker', 'battle', 'kindred', 'tribal',
  'legendary', 'basic', 'snow', 'world', 'ongoing',
].map((w) => w.toLowerCase()));

function isTypalTypeWord(word: string): boolean {
  const raw = String(word || '').trim();
  if (!raw) return false;
  if (isCreatureTypeWord(raw)) return true;
  return TYPAL_TYPE_WORDS.has(raw.toLowerCase());
}

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
  if (ofThe && !isTypalTypeWord(ofThe[1])) out.push(ofThe[1]);
  // "Phage the Untouchable", "Acererak the Archlich", "Samwise the Stouthearted"
  const theName = /^(\p{Lu}[\p{L}'-]{2,}) the \p{Lu}/u.exec(short);
  if (theName && !isTypalTypeWord(theName[1])) out.push(theName[1]);
  // "Kiora of Fire and Ashes", "Tivadar of Thorn", "Rosie Cotton of South Lane"
  const ofName = /^((?:\p{Lu}[\p{L}'.-]*\s+){0,1}\p{Lu}[\p{L}'.-]*) of(?: the)? /u.exec(short);
  if (ofName) {
    const head = ofName[1].trim();
    const words = head.split(/\s+/);
    if (head && head !== short && !isTypalTypeWord(words[words.length - 1])) out.push(head);
  }
  // Two-word personal names ("Dáin Ironfoot" -> "Dáin", "Elesh Norn" -> "Elesh"); not a creature type.
  const twoWord = /^(\p{Lu}[\p{L}'-]{2,}) \p{Lu}[\p{L}'-]+$/u.exec(short);
  if (twoWord && !isTypalTypeWord(twoWord[1])) out.push(twoWord[1]);
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
    const words = short.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      const first = words[0];
      if (first.length >= 3 && !isTypalTypeWord(first) && !/^(?:the|a|an)$/i.test(first)) variants.add(first);
    }
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
  // "When this Case enters" on "Case of the ...": the name variant replaced the noun after "this".
  text = text.replace(/\b(?:this|the) this permanent\b/gi, 'this permanent');
  // Plural names ("Mikey & Mona enter") and the census tilde use the plural verb.
  text = text.replace(/(^|\s)~(?=\s)/g, '$1this permanent');
  text = text.replace(/\bthis permanent (enter|attack|die|block|leave)(?![a-z])/g, 'this permanent $1s');
  text = text.replace(/\bthis permanent ([a-z]+s) or (enter|attack|die|block|leave)(?![a-z])/g, 'this permanent $1 or $2s');
  return text + effect;
}