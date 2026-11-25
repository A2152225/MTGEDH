/**
 * socket/interaction-handlers/activationCostExtras.ts
 *
 * Activation-cost text helpers for outcome-sweep family #4 (real costs reported as UNSUPPORTED_COST):
 * - Ability words and flavor names in front of a cost ("Cohort — {T}, Tap an untapped Ally...",
 *   "Blow Up — {2}, Sacrifice this creature", "Nosh — ...") leaked into the cost string. Strip
 *   them; keep the two conditional prefixes the engine tracks (Max speed: speed 4; Solved: case
 *   solved) as activation gates.
 * - "Discard a card at random": the cards are picked at random and offered as the only choice.
 *
 * Public entry symbols: stripActivationCostPrefix, isRandomDiscardCost, pickRandomCostDiscards.
 */

export type ActivationCostPrefixResult = { cost: string; prefix?: string; blockedReason?: string };

const PREFIX_RE = /^\s*([A-Za-z][A-Za-z0-9'!,.\- ]{1,40}?)\s*[—–]\s*(\S[\s\S]*)$/;
/** Keyword costs that use an em dash themselves ("Equip—Pay 3 life", "Cycling—...") stay intact. */
const KEYWORD_COST_RE = /^(?:equip|fortify|reconfigure|cycling|\w+cycling|ninjutsu|channel|boast|exhaust|outlast|level up|transmute|unearth|embalm|eternalize|encore|scavenge|renew|craft|forecast|transfigure|reinforce|bloodrush|auto|crew|station)\b/i;

export function stripActivationCostPrefix(
  cost: string,
  state: any,
  playerId: string,
  permanent: any,
): ActivationCostPrefixResult {
  const text = String(cost || '');
  const match = text.match(PREFIX_RE);
  if (!match) return { cost: text };
  const prefix = match[1].trim();
  if (/[{}]/.test(prefix) || KEYWORD_COST_RE.test(prefix)) return { cost: text };
  const lower = prefix.toLowerCase();
  if (lower === 'max speed') {
    const speed = Number(state?.speed?.[playerId] ?? state?.playerSpeed?.[playerId] ?? 0);
    if (!(speed >= 4)) return { cost: match[2], prefix, blockedReason: 'Max speed: your speed must be 4.' };
  } else if (lower === 'solved') {
    if (permanent?.solved !== true) return { cost: match[2], prefix, blockedReason: 'This Case is not solved yet.' };
  }
  return { cost: match[2], prefix };
}

export function isRandomDiscardCost(costText: string): boolean {
  return /\bdiscard\s+[^,]*?\bcards?\s+at\s+random\b/i.test(String(costText || ''));
}

/** Pick `count` cards uniformly at random (game rng when present) for an "at random" discard cost. */
export function pickRandomCostDiscards<T>(game: any, cards: readonly T[], count: number): T[] {
  const pool = [...cards];
  const rng: () => number = typeof game?.rng === 'function' ? game.rng : Math.random;
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const roll = Number(rng());
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : Math.random()) * pool.length)));
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}
