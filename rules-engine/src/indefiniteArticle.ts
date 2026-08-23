/**
 * English indefinite article helpers for display paraphrases.
 * Gameplay matching should use oracle_text / IR / typed filters -- not these strings.
 */

/** "a" vs "an" from the first alphabetic letter of the next word. */
export function indefiniteArticle(nextWord: string): 'a' | 'an' {
  const letter = String(nextWord || '').trim().match(/[A-Za-z]/)?.[0];
  if (!letter) return 'a';
  return /[aeiou]/i.test(letter) ? 'an' : 'a';
}

/** e.g. "artifact" -> "an artifact". */
export function withIndefiniteArticle(nextWord: string): string {
  const word = String(nextWord || '').trim();
  if (!word) return 'a';
  return `${indefiniteArticle(word)} ${word}`;
}

/**
 * Build "a spell" / "an artifact spell" / "a Merfolk spell" for cast paraphrases.
 * Empty / "any" / "spell" => untyped "a spell".
 */
export function aOrAnSpellType(spellType: string | null | undefined): string {
  const t = String(spellType || '').trim();
  if (!t || /^any$/i.test(t) || /^spell$/i.test(t)) {
    return 'a spell';
  }
  return `${withIndefiniteArticle(t)} spell`;
}
