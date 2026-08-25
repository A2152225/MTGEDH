// Origin parent: server/src/state/modules/game-state-effects-handlers/gameStateEffectsWinLose.ts
// Cluster moved: WIN_CONDITIONS card-name table → generic oracle-pattern
//   "you win the game" scanner (upkeep / end-step intervening-if, devotion-
//   library ETB). State-trigger / then-if / compound clauses live in
//   gameStateEffectsWinConditionStateTriggerThenIf.ts.
//   Empty-library-draw wins stay on ReplacementEffectSpec.
// Public entry symbols: collectOraclePatternWinConditions,
//   oracleTextHasDevotionLibraryWin, isAlchemyAlternateWinSource,
//   sourcePermanentHasDevotionLibraryWin.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { isInterveningIfSatisfied } from "../triggers/intervening-if.js";
import {
  getActiveControlledPermanents,
  calculateDevotion,
} from "./gameStateEffectsBattlefieldQueries.js";
import {
  classifyStateTriggerWinAbility,
  evaluateExtendedWinIfFallbacks,
  extractWinGatingIfText,
  oracleTextHasOptionalIfYouDoWin,
  splitCompoundWinIfClauses,
} from "./gameStateEffectsWinConditionStateTriggerThenIf.js";

export type OraclePatternWinTiming = 'upkeep' | 'etb' | 'end_step' | 'immediate';

export type OraclePatternWinCondition = {
  permanentId: string;
  cardName: string;
  type: OraclePatternWinTiming;
  checkFunction: (ctx: GameContext, playerId: string) => boolean;
  description: string;
};

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

const DEVOTION_COLOR: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

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

function readOracleFromCard(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  const record = card as { oracle_text?: unknown; oracleText?: unknown; text?: unknown };
  return String(record.oracle_text || record.oracleText || record.text || '').trim();
}

function readPermanentName(permanent: { card?: { name?: unknown }; name?: unknown }): string {
  return String(permanent.card?.name || permanent.name || '').trim();
}

/**
 * Alchemy-only alternate-win cards (A- prefixed names, conjure/perpetual templates).
 * Commander-legal paper cards are not skipped.
 */
export function isAlchemyAlternateWinSource(card: { name?: unknown; oracle_text?: unknown; oracleText?: unknown; type_line?: unknown } | undefined): boolean {
  const name = String(card?.name || '').trim();
  if (/^A-/i.test(name)) return true;
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (typeLine.includes('alchemy')) return true;
  return false;
}

export function oracleTextHasDevotionLibraryWin(oracleText: string): boolean {
  const oracle = normalizeOracle(oracleText);
  if (!oracle.includes('you win the game')) return false;
  if (!/if x is greater than or equal to the number of cards in your library/.test(oracle)) return false;
  return /devotion to/.test(oracle);
}

function oracleTextHasEmptyLibraryDrawWin(oracleText: string): boolean {
  const oracle = normalizeOracle(oracleText);
  return (
    oracle.includes('if you would draw a card while your library has no cards in it')
    && oracle.includes('you win the game instead')
  );
}

function isActivatedOrLoyaltyAbility(ability: string): boolean {
  const trimmed = String(ability || '').trim();
  if (/^\[[+\u2212\-]\d+\]:/.test(trimmed)) return true;
  return /^(?:\{[^}]+\}|tap)[^:]*:/i.test(trimmed);
}

function classifyWinAbility(ability: string): OraclePatternWinTiming | null {
  const text = String(ability || '').trim();
  if (!text) return null;
  const lower = normalizeOracle(text);
  if (!lower.includes('you win the game')) return null;
  if (oracleTextHasEmptyLibraryDrawWin(text)) return null;
  if (isActivatedOrLoyaltyAbility(text)) return null;
  if (oracleTextHasOptionalIfYouDoWin(text)) return null;
  if (oracleTextHasDevotionLibraryWin(text)) return 'etb';
  if (/at the beginning of (?:each of )?your (?:next )?upkeeps?/.test(lower)) return 'upkeep';
  if (/at the beginning of (?:the |your |each )?end step/.test(lower)) return 'end_step';
  return classifyStateTriggerWinAbility(text);
}

function splitOracleAbilities(oracleText: string): string[] {
  return String(oracleText || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
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

function readHandCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as { zones?: Record<string, { handCount?: number; hand?: unknown[] }> }).zones?.[playerId]
    || (ctx.state as { zones?: Record<string, { handCount?: number; hand?: unknown[] }> } | undefined)?.zones?.[playerId];
  if (typeof zones?.handCount === 'number') return zones.handCount;
  if (Array.isArray(zones?.hand)) return zones.hand.length;
  return 0;
}

function readLibraryCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as { zones?: Record<string, { libraryCount?: number; library?: unknown[] }> }).zones?.[playerId]
    || (ctx.state as { zones?: Record<string, { libraryCount?: number; library?: unknown[] }> } | undefined)?.zones?.[playerId];
  if (typeof zones?.libraryCount === 'number') return zones.libraryCount;
  if (Array.isArray(zones?.library)) return zones.library.length;
  const library = (ctx as { libraries?: { get?: (id: string) => unknown } }).libraries?.get?.(playerId);
  if (Array.isArray(library)) return library.length;
  const player = (ctx.state?.players || []).find((entry: { id?: string; library?: unknown }) =>
    String(entry?.id || '') === String(playerId),
  );
  if (Array.isArray((player as { library?: unknown })?.library)) {
    return ((player as { library: unknown[] }).library).length;
  }
  return 0;
}

function readCounterCount(permanent: { counters?: Record<string, unknown> } | undefined, kind: string): number {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  const wanted = kind.toLowerCase();
  for (const [key, value] of Object.entries(counters)) {
    if (String(key || '').toLowerCase() === wanted) {
      return typeof value === 'number' ? value : 0;
    }
  }
  return 0;
}

function evaluateLocalWinFallbacks(
  ctx: GameContext,
  playerId: string,
  clause: string,
  sourcePermanent: { id?: string; counters?: Record<string, unknown> } | undefined,
): boolean | null {
  const text = normalizeOracle(clause);

  const lifeMatch = text.match(/^if you have (\d+|[a-z]+) or more life$/);
  if (lifeMatch) {
    const n = parseCountToken(lifeMatch[1]);
    if (n === null) return null;
    return readPlayerLife(ctx, playerId) >= n;
  }

  const barrenMatch = text.match(
    /^if you control no (?:other )?permanents(?: other than this (?:enchantment|permanent|creature|artifact))? and have no cards in hand$/,
  );
  if (barrenMatch) {
    const others = getActiveControlledPermanents(ctx, playerId).filter((perm: { id?: string }) =>
      String(perm?.id || '') !== String(sourcePermanent?.id || ''),
    );
    return others.length === 0 && readHandCount(ctx, playerId) === 0;
  }

  const namedCreatures = text.match(/^if you control (\d+|[a-z]+) or more creatures named (.+)$/);
  if (namedCreatures) {
    const n = parseCountToken(namedCreatures[1]);
    if (n === null) return null;
    const wanted = namedCreatures[2].trim().toLowerCase();
    const count = getActiveControlledPermanents(ctx, playerId).filter((perm: { card?: { name?: string; type_line?: string } }) => {
      const name = String(perm.card?.name || '').toLowerCase();
      const typeLine = String(perm.card?.type_line || '').toLowerCase();
      return name === wanted && typeLine.includes('creature');
    }).length;
    return count >= n;
  }

  const thisCounters = text.match(
    /^if this (?:enchantment|artifact|creature|permanent) has (\d+|[a-z]+) or more ((?:\+1\/\+1|[a-z][a-z0-9' -]*)) counters on it$/,
  );
  if (thisCounters) {
    const n = parseCountToken(thisCounters[1]);
    if (n === null) return null;
    return readCounterCount(sourcePermanent, thisCounters[2].trim()) >= n;
  }

  const thereCounters = text.match(
    /^if there are (\d+|[a-z]+) or more ((?:\+1\/\+1|[a-z][a-z0-9' -]*)) counters on this (?:enchantment|artifact|creature|permanent)$/,
  );
  if (thereCounters) {
    const n = parseCountToken(thereCounters[1]);
    if (n === null) return null;
    return readCounterCount(sourcePermanent, thereCounters[2].trim()) >= n;
  }

  return null;
}

function clauseFromAbility(ability: string): string {
  const normalized = String(ability || '').replace(/\s+/g, ' ').trim();
  const triggerIf = normalized.match(/\b(?:when|whenever|at)\b[^,]+,\s*(if\s+.+?)(?:,|$)/i);
  if (triggerIf) return triggerIf[1].replace(/[.\s]+$/, '').trim();
  const leading = normalized.match(/^(if\s+.+?)(?:,|$)/i);
  return leading ? leading[1].replace(/[.\s]+$/, '').trim() : normalized;
}

function evaluateAtomicWinIf(
  ctx: GameContext,
  playerId: string,
  clause: string,
  sourcePermanent: unknown,
): boolean | null {
  const fallback = evaluateLocalWinFallbacks(
    ctx,
    playerId,
    clause,
    sourcePermanent as { id?: string; counters?: Record<string, unknown> },
  );
  if (fallback !== null) return fallback;

  const extended = evaluateExtendedWinIfFallbacks(ctx, playerId, clause);
  if (extended !== null) return extended;

  return isInterveningIfSatisfied(ctx, playerId, clause, sourcePermanent);
}

function evaluateWinAbility(
  ctx: GameContext,
  playerId: string,
  ability: string,
  sourcePermanent: unknown,
): boolean {
  const clause = extractWinGatingIfText(ability) || clauseFromAbility(ability);
  const parts = clause.includes(',') ? splitCompoundWinIfClauses(clause) : [clause];
  return parts.every((part) => evaluateAtomicWinIf(ctx, playerId, part, sourcePermanent) === true);
}

function evaluateDevotionLibraryWin(
  ctx: GameContext,
  playerId: string,
  ability: string,
): boolean {
  const colorMatch = normalizeOracle(ability).match(/devotion to (white|blue|black|red|green)/);
  const color = DEVOTION_COLOR[colorMatch?.[1] || ''] || 'U';
  return calculateDevotion(ctx, playerId, color) >= readLibraryCount(ctx, playerId);
}

function descriptionForAbility(type: OraclePatternWinTiming, ability: string): string {
  const clause = extractWinGatingIfText(ability) || clauseFromAbility(ability);
  if (type === 'etb') {
    return 'Win if devotion is greater than or equal to cards in library';
  }
  if (type === 'end_step') {
    return `Win at end step ${clause}`;
  }
  if (type === 'immediate') {
    return `Win when ${clause}`;
  }
  return `Win at upkeep ${clause}`;
}

function pushWinFromAbility(
  conditions: OraclePatternWinCondition[],
  source: { id: string; name: string; permanent: unknown },
  ability: string,
): void {
  const type = classifyWinAbility(ability);
  if (!type) return;
  conditions.push({
    permanentId: source.id,
    cardName: source.name,
    type,
    description: descriptionForAbility(type, ability),
    checkFunction: (ctx, playerId) => {
      if (type === 'etb') return evaluateDevotionLibraryWin(ctx, playerId, ability);
      return evaluateWinAbility(ctx, playerId, ability, source.permanent);
    },
  });
}

function collectEmblemSources(ctx: GameContext, playerId: string): Array<{ id: string; name: string; oracle: string; permanent: unknown }> {
  const state = (ctx as { state?: { emblems?: unknown[]; players?: Array<{ id?: string; emblems?: unknown[] }> } }).state;
  const seen = new Set<string>();
  const sources: Array<{ id: string; name: string; oracle: string; permanent: unknown }> = [];

  const push = (emblem: unknown) => {
    if (!emblem || typeof emblem !== 'object') return;
    const record = emblem as {
      id?: string;
      controller?: string;
      owner?: string;
      sourceName?: string;
      name?: string;
      effect?: string;
      oracle_text?: string;
      oracleText?: string;
      abilities?: unknown;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    const controller = String(record.controller || record.owner || '').trim();
    if (controller && controller !== playerId) return;
    const id = String(record.id || '').trim();
    if (!id || seen.has(id)) return;
    const abilityText = Array.isArray(record.abilities)
      ? record.abilities.map((entry) => String(entry || '').trim()).filter(Boolean).join('\n')
      : '';
    const oracle = String(
      record.effect || record.oracle_text || record.oracleText || abilityText || readOracleFromCard(record.card) || '',
    ).trim();
    if (!oracle) return;
    seen.add(id);
    const name = String(record.sourceName || record.name || record.card?.name || 'Emblem').trim() || 'Emblem';
    sources.push({
      id,
      name,
      oracle,
      permanent: {
        id,
        controller: playerId,
        card: { name, oracle_text: oracle },
      },
    });
  };

  for (const emblem of Array.isArray(state?.emblems) ? state.emblems : []) push(emblem);
  for (const player of Array.isArray(state?.players) ? state.players : []) {
    if (String(player?.id || '') !== playerId) continue;
    for (const emblem of Array.isArray(player.emblems) ? player.emblems : []) push(emblem);
  }
  return sources;
}

/**
 * Scan controlled permanents (and emblems) for commander-legal "you win the game"
 * upkeep / end-step / devotion-library ETB patterns. No card-name table.
 */
export function collectOraclePatternWinConditions(ctx: GameContext, playerId: string): OraclePatternWinCondition[] {
  const conditions: OraclePatternWinCondition[] = [];
  const permanents = getActiveControlledPermanents(ctx, playerId);

  for (const perm of permanents) {
    const card = perm?.card;
    if (!card || isAlchemyAlternateWinSource(card)) continue;
    const oracle = readOracleFromCard(card);
    if (!oracle.toLowerCase().includes('you win the game')) continue;
    const name = readPermanentName(perm) || 'Permanent';
    for (const ability of splitOracleAbilities(oracle)) {
      pushWinFromAbility(conditions, { id: String(perm.id || ''), name, permanent: perm }, ability);
    }
  }

  for (const emblem of collectEmblemSources(ctx, playerId)) {
    if (!emblem.oracle.toLowerCase().includes('you win the game')) continue;
    for (const ability of splitOracleAbilities(emblem.oracle)) {
      pushWinFromAbility(conditions, { id: emblem.id, name: emblem.name, permanent: emblem.permanent }, ability);
    }
  }

  return conditions;
}

export function sourcePermanentHasDevotionLibraryWin(
  ctx: GameContext,
  playerId: string,
  sourceName?: string,
): boolean {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  const wanted = String(sourceName || '').trim().toLowerCase();
  if (wanted) {
    const named = permanents.find((perm) => readPermanentName(perm).toLowerCase() === wanted);
    if (!named) return false;
    if (isAlchemyAlternateWinSource(named.card)) return false;
    return oracleTextHasDevotionLibraryWin(readOracleFromCard(named.card));
  }
  return permanents.some((perm) => {
    if (isAlchemyAlternateWinSource(perm.card)) return false;
    return oracleTextHasDevotionLibraryWin(readOracleFromCard(perm.card));
  });
}
