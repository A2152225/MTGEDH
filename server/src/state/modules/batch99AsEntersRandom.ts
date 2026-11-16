// server/src/state/modules/batch99AsEntersRandom.ts
// "As ~ enters, choose 2, 3, or 4 at random." (Haktos and similar).
// Applies automatically on entry and stores chosenNumber on the permanent.
// Public: parseAsEntersChooseNumberAtRandom, applyAsEntersRandomNumberChoice.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

/** Numbers listed in an as-enters "choose N, M, or K at random" sentence. */
export function parseAsEntersChooseNumberAtRandom(oracle: string): number[] | null {
  const text = normalize(oracle);
  const match = text.match(
    /as (?:this (?:creature|permanent|land|artifact|enchantment)|[^.]+?) enters(?: the battlefield)?, choose ((?:\d+,\s*)*\d+),?\s*or (\d+) at random/i,
  );
  if (!match) return null;
  const head = String(match[1] || '');
  const last = Number(match[2]);
  const numbers = [
    ...head.split(/,/).map((part) => Number(String(part).trim())).filter((n) => Number.isFinite(n)),
    ...(Number.isFinite(last) ? [last] : []),
  ];
  return numbers.length >= 2 ? numbers : null;
}

export function applyAsEntersRandomNumberChoice(
  permanent: any,
  rng: () => number = Math.random,
): number | null {
  if (!permanent) return null;
  if (permanent.chosenNumber != null && Number.isFinite(Number(permanent.chosenNumber))) {
    return Number(permanent.chosenNumber);
  }
  const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
  const numbers = parseAsEntersChooseNumberAtRandom(oracle);
  if (!numbers || numbers.length === 0) return null;
  const roll = rng();
  const index = Math.min(numbers.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * numbers.length)));
  const chosen = numbers[index];
  permanent.chosenNumber = chosen;
  if (permanent.card) permanent.card.chosenNumber = chosen;
  return chosen;
}
