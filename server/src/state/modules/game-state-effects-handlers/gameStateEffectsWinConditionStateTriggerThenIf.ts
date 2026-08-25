// Origin parent: server/src/state/modules/game-state-effects-handlers/gameStateEffectsWinConditionOraclePatterns.ts
// Cluster: state-trigger "when this has N counters" wins, then-if / "you win if"
//   extraction, compound intervening-if split, and extra win predicates
//   (same-name / different-names / card-type union / starting-life floor).
// Public entry symbols: extractWinGatingIfText, splitCompoundWinIfClauses,
//   classifyStateTriggerWinAbility, evaluateExtendedWinIfFallbacks,
//   oracleTextHasOptionalIfYouDoWin.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { getActiveControlledPermanents } from "./gameStateEffectsBattlefieldQueries.js";

const WORD_COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
};

const CARD_TYPES = [
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'kindred',
  'land',
  'planeswalker',
  'sorcery',
] as const;

function normalizeOracle(value: unknown): string {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseCountToken(token: string | undefined): number | null {
  const raw = String(token || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return WORD_COUNTS[raw] ?? null;
}

function readStartingLife(ctx: GameContext): number {
  const v = (ctx.state as { startingLife?: unknown } | undefined)?.startingLife;
  return typeof v === 'number' ? v : 40;
}

function readPlayerLife(ctx: GameContext, playerId: string): number {
  const lifeMap = (ctx.state as { life?: Record<string, unknown> } | undefined)?.life;
  const fromMap = lifeMap?.[playerId];
  if (typeof fromMap === 'number') return fromMap;
  const players = ctx.state?.players || [];
  const player = players.find((entry: { id?: string; playerId?: string }) =>
    entry?.id === playerId || entry?.playerId === playerId,
  );
  const life = (player as { life?: unknown } | undefined)?.life;
  return typeof life === 'number' ? life : 40;
}

function readGraveyardCards(ctx: GameContext, playerId: string): unknown[] {
  const zones = (ctx as { zones?: Record<string, { graveyard?: unknown[] }> }).zones?.[playerId]
    || (ctx.state as { zones?: Record<string, { graveyard?: unknown[] }> } | undefined)?.zones?.[playerId];
  return Array.isArray(zones?.graveyard) ? zones.graveyard : [];
}

function collectCardTypesFromTypeLine(typeLine: string, into: Set<string>): void {
  const lower = String(typeLine || '').toLowerCase();
  for (const type of CARD_TYPES) {
    if (lower.includes(type)) into.add(type);
  }
  if (lower.includes('tribal')) into.add('kindred');
}

function typeLineOf(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const record = entry as { type_line?: unknown; card?: { type_line?: unknown } };
  return String(record.type_line || record.card?.type_line || '');
}

function nameOf(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const record = entry as { name?: unknown; card?: { name?: unknown } };
  return String(record.card?.name || record.name || '').trim().toLowerCase();
}

function permanentsMatchingNoun(
  permanents: Array<{ card?: { type_line?: string } }>,
  noun: string,
): Array<{ card?: { type_line?: string; name?: string }; name?: string }> {
  const raw = String(noun || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return [];
  if (raw === 'permanents' || raw === 'permanent') return permanents;
  const singular = raw.endsWith('s') ? raw.slice(0, -1) : raw;
  return permanents.filter((perm) => {
    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    return typeLine.includes(singular);
  });
}

function maxSameNameCount(entries: unknown[]): number {
  const counts = new Map<string, number>();
  let max = 0;
  for (const entry of entries) {
    const name = nameOf(entry);
    if (!name) continue;
    const next = (counts.get(name) || 0) + 1;
    counts.set(name, next);
    if (next > max) max = next;
  }
  return max;
}

function uniqueNameCount(entries: unknown[]): number {
  const names = new Set<string>();
  for (const entry of entries) {
    const name = nameOf(entry);
    if (name) names.add(name);
  }
  return names.size;
}

/**
 * Optional "you may ... If you do, you win" is a choice family, not an
 * automatic battlefield scan (Hedron Alignment reveal).
 */
export function oracleTextHasOptionalIfYouDoWin(oracleText: string): boolean {
  const oracle = normalizeOracle(oracleText);
  return oracle.includes('you may') && oracle.includes('if you do') && oracle.includes('you win the game');
}

export function classifyStateTriggerWinAbility(ability: string): 'immediate' | null {
  const lower = normalizeOracle(ability);
  if (!lower.includes('you win the game')) return null;
  if (oracleTextHasOptionalIfYouDoWin(ability)) return null;
  if (/when this (?:artifact|enchantment|creature|permanent) has (?:\d+|[a-z]+) or more .+ counters on it/.test(lower)) {
    return 'immediate';
  }
  if (/when there are (?:\d+|[a-z]+) or more .+ counters on this/.test(lower)) {
    return 'immediate';
  }
  return null;
}

/**
 * Prefer the if-clause that actually gates "you win the game" (then-if /
 * "you win if"), not the first intervening-if on a multi-effect upkeep line.
 */
export function extractWinGatingIfText(ability: string): string {
  const normalized = String(ability || '').replace(/\s+/g, ' ').trim();
  const afterWin = normalized.match(/\byou win the game if\s+(.+?)(?:\.|$)/i);
  if (afterWin) {
    return `if ${afterWin[1].replace(/[.\s]+$/, '').trim()}`;
  }

  const whenThis = normalized.match(
    /\bwhen\s+(this\s+(?:artifact|enchantment|creature|permanent)\s+has\s+.+?),\s*you win the game/i,
  );
  if (whenThis) {
    return `if ${whenThis[1].trim()}`;
  }

  const ifBeforeWin = normalized.match(/\bif\s+(.+?),\s*you win the game/i);
  if (ifBeforeWin) {
    return `if ${ifBeforeWin[1].trim()}`;
  }

  const triggerIf = normalized.match(/\b(?:when|whenever|at)\b[^,]+,\s*(if\s+.+?)(?:,|$)/i);
  if (triggerIf) return triggerIf[1].replace(/[.\s]+$/, '').trim();
  const leading = normalized.match(/^(if\s+.+?)(?:,|$)/i);
  return leading ? leading[1].replace(/[.\s]+$/, '').trim() : normalized;
}

/**
 * Split Happily Ever After-style "if A, B, and C" into atomic leading-if clauses.
 * Does not split "and/or" unions.
 */
export function splitCompoundWinIfClauses(ifText: string): string[] {
  const body = String(ifText || '').replace(/^if\s+/i, '').trim();
  if (!body.includes(',')) return [`if ${body}`.replace(/^if if\s+/i, 'if ')];
  const parts = body
    .split(/,\s*(?:and\s+)?/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [`if ${body}`];
  return parts.map((part) => (/^if\s+/i.test(part) ? part : `if ${part}`));
}

export function evaluateExtendedWinIfFallbacks(
  ctx: GameContext,
  playerId: string,
  clause: string,
): boolean | null {
  const text = normalizeOracle(clause);

  if (/^if your life total is greater than or equal to your starting life total$/.test(text)) {
    return readPlayerLife(ctx, playerId) >= readStartingLife(ctx);
  }

  const cardTypes = text.match(
    /^if there are (\d+|[a-z]+) or more card types among permanents you control and\/or cards in your graveyard$/,
  );
  if (cardTypes) {
    const n = parseCountToken(cardTypes[1]);
    if (n === null) return null;
    const types = new Set<string>();
    for (const perm of getActiveControlledPermanents(ctx, playerId)) {
      collectCardTypesFromTypeLine(typeLineOf(perm), types);
    }
    for (const card of readGraveyardCards(ctx, playerId)) {
      collectCardTypesFromTypeLine(typeLineOf(card), types);
    }
    return types.size >= n;
  }

  const sameNameAnother = text.match(
    /^if you control (\d+|[a-z]+) or more ([a-z][a-z0-9' -]*?) with the same name as one another$/,
  );
  if (sameNameAnother) {
    const n = parseCountToken(sameNameAnother[1]);
    if (n === null) return null;
    const matched = permanentsMatchingNoun(getActiveControlledPermanents(ctx, playerId), sameNameAnother[2]);
    return maxSameNameCount(matched) >= n;
  }

  const sameName = text.match(
    /^if you control (\d+|[a-z]+) or more ([a-z][a-z0-9' -]*?) with the same name$/,
  );
  if (sameName) {
    const n = parseCountToken(sameName[1]);
    if (n === null) return null;
    const matched = permanentsMatchingNoun(getActiveControlledPermanents(ctx, playerId), sameName[2]);
    return maxSameNameCount(matched) >= n;
  }

  const differentNames = text.match(
    /^if you control (\d+|[a-z]+) or more ([a-z][a-z0-9' -]*?) with different names$/,
  );
  if (differentNames) {
    const n = parseCountToken(differentNames[1]);
    if (n === null) return null;
    const matched = permanentsMatchingNoun(getActiveControlledPermanents(ctx, playerId), differentNames[2]);
    return uniqueNameCount(matched) >= n;
  }

  return null;
}
