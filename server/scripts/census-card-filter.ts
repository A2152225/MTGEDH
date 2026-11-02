/**
 * Card selection shared by the census scripts. Default: Commander-legal cards only.
 * --include-upcoming also counts paper cards from a set releasing today or later that are not
 * Commander-legal yet (Scryfall marks pre-release sets not_legal), skipping Art Series, tokens,
 * emblems and Alchemy/digital-only cards. Upcoming runs write *-upcoming.json and leave docs/ alone.
 */
export const INCLUDE_UPCOMING = process.argv.includes('--include-upcoming');

export type CensusSelectableCard = {
  name?: string; set?: string; set_type?: string; layout?: string; released_at?: string;
  digital?: boolean; games?: string[]; legalities?: Record<string, string>;
};

const EXCLUDED_LAYOUTS = new Set(['art_series', 'token', 'double_faced_token', 'emblem']);
const EXCLUDED_SET_TYPES = new Set(['token', 'memorabilia', 'alchemy', 'minigame']);

/** Local calendar date as YYYY-MM-DD (release dates are calendar days, not UTC instants). */
export function localTodayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isUpcomingCensusCard(card: CensusSelectableCard, today: string = localTodayIso()): boolean {
  const legality = card.legalities?.commander;
  if (legality === 'legal' || legality === 'banned' || legality === 'restricted') return false;
  const released = String(card.released_at || '');
  if (!released || released < today) return false;
  if (card.digital) return false;
  if (Array.isArray(card.games) && card.games.length && !card.games.includes('paper')) return false;
  if (EXCLUDED_LAYOUTS.has(String(card.layout || ''))) return false;
  if (EXCLUDED_SET_TYPES.has(String(card.set_type || ''))) return false;
  if (/^A-/.test(String(card.name || ''))) return false;
  return true;
}

export function includeCardInCensus(card: CensusSelectableCard, includeUpcoming: boolean = INCLUDE_UPCOMING): boolean {
  if (card.legalities?.commander === 'legal') return true;
  return includeUpcoming && isUpcomingCensusCard(card);
}
