// server/src/socket/combat-handlers/combatColorBlockRestriction.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// Self evasion by blocker color: "This creature can't be blocked by black creatures."
// / "can't be blocked by white or red creatures" (oracle text or a granted/temporary text).
// Public entry symbols: getColorBlockRestrictionReason, parseColorBlockRestrictionColors.

const COLOR_LETTER: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

const SELF_COLOR_BLOCK_RE =
  /(?:^|[\n.]\s*)(?:this creature|it|~)?\s*can(?:'t|not) be blocked by ((?:(?:white|blue|black|red|green)(?:,? (?:or )?)?)+) creatures\b/gi;

/** Returns the color letters a self "can't be blocked by <color> creatures" clause names. */
export function parseColorBlockRestrictionColors(texts: readonly string[]): string[] {
  const colors = new Set<string>();
  for (const raw of texts) {
    const text = String(raw || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase();
    for (const match of text.matchAll(SELF_COLOR_BLOCK_RE)) {
      for (const word of String(match[1] || '').matchAll(/white|blue|black|red|green/g)) {
        colors.add(COLOR_LETTER[word[0]]);
      }
    }
  }
  return [...colors];
}

function blockerColorLetters(blocker: any): string[] {
  const raw = Array.isArray(blocker?.colors) ? blocker.colors
    : Array.isArray(blocker?.card?.colors) ? blocker.card.colors : [];
  return raw.map((entry: unknown) => String(entry || '').trim().toUpperCase().slice(0, 1));
}

export function getColorBlockRestrictionReason(
  attacker: any,
  blocker: any,
  attackerTexts: readonly string[],
): string | null {
  const colors = parseColorBlockRestrictionColors([
    String(attacker?.card?.oracle_text || ''),
    String(attacker?.oracle_text || ''),
    ...attackerTexts,
  ]);
  if (colors.length === 0) return null;
  const blockerColors = blockerColorLetters(blocker);
  const hit = colors.find((letter) => blockerColors.includes(letter));
  return hit ? `Attacker can't be blocked by ${Object.keys(COLOR_LETTER).find((k) => COLOR_LETTER[k] === hit)} creatures` : null;
}
