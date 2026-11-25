/**
 * oracleIRExecutorBoundTargetLooseFilter.ts
 *
 * Generic last-resort binding for single "target ..." phrases whose filter no dedicated
 * resolver understands ("target land or nonblack creature", "target monocolored permanent",
 * "target player or planeswalker"). Targets were already chosen and validated when the
 * spell or ability was put on the stack (CR 601.2c / 602.2b), so at resolution we only need
 * to re-bind the chosen object and re-check the filter loosely (CR 608.2b): known
 * qualifiers (card types, colors, controller, tapped, basic, token, power / mana value
 * thresholds) are enforced; qualifiers this module does not understand are trusted.
 *
 * Public entries: resolveLooseBoundTargetPermanents, resolveLooseBoundTargetRecipients.
 */

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { readCurrentPowerFromHook, readCurrentToughnessFromHook } from './currentPowerToughnessHook';

const CARD_TYPES = ['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle', 'permanent'];
const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const NON_BATTLEFIELD_RE = /\b(?:spell|spells|card|cards|graveyard|hand|library|stack|ability|abilities)\b/i;

type ControllerFilter = 'you' | 'not_you' | null;

function idOf(value: unknown): string {
  return String((value as any)?.id ?? value ?? '').trim();
}

/** Ids the resolving object explicitly targeted (not antecedent / last-moved bookkeeping). */
export function collectExplicitBoundTargetIds(ctx: OracleIRExecutionContext): string[] {
  const sel: any = ctx.selectorContext || {};
  const raw: unknown[] = [
    ctx.targetPermanentId,
    ctx.targetCreatureId,
    sel.targetPermanentId,
    sel.targetCreatureId,
    ...(Array.isArray(sel.chosenObjectIds) ? sel.chosenObjectIds : []),
    ...(Array.isArray((ctx as any).chosenObjectIds) ? (ctx as any).chosenObjectIds : []),
    ...(Array.isArray((ctx as any).targets) ? (ctx as any).targets : []),
    ...(Array.isArray((ctx as any).targetIds) ? (ctx as any).targetIds : []),
    ctx.targetPlayerId,
    sel.targetPlayerId,
    sel.targetOpponentId,
  ];
  return Array.from(new Set(raw.map(idOf).filter(Boolean)));
}

function stripReminder(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "target X" with exactly one target word and a battlefield/player recipient. */
export function parseSingleTargetPhrase(targetText: string): string | null {
  const text = stripReminder(targetText).toLowerCase().replace(/[.;]+$/, '');
  const match = text.match(/^target\s+(.+)$/);
  if (!match) return null;
  const rest = String(match[1] || '').trim();
  if (!rest || /\btarget\b/.test(rest)) return null;
  if (NON_BATTLEFIELD_RE.test(rest)) return null;
  return rest;
}

function extractControllerFilter(rest: string): { body: string; controller: ControllerFilter } {
  const patterns: Array<[RegExp, ControllerFilter]> = [
    [/\s+(?:you control|you own)$/, 'you'],
    [/\s+(?:you don't control|you do not control|an opponent controls|your opponents control|you don't own)$/, 'not_you'],
  ];
  for (const [re, controller] of patterns) {
    if (re.test(rest)) return { body: rest.replace(re, () => '').trim(), controller };
  }
  return { body: rest, controller: null };
}

function splitDisjuncts(body: string): string[] {
  const guarded = body.replace(/\b(\d+|x) or (greater|less|more|fewer)\b/g, (_m, n, cmp) => `${n} _or_ ${cmp}`);
  return guarded
    .split(/\s*,\s*(?:and\/or\s+|or\s+)?|\s+and\/or\s+|\s+or\s+/)
    .map((part) => part.replace(/_or_/g, () => 'or').trim())
    .filter(Boolean);
}

function singular(word: string): string {
  if (/(?:ss|us)$/.test(word)) return word;
  if (/ies$/.test(word)) return word.replace(/ies$/, () => 'y');
  return word.replace(/s$/, () => '');
}

function permanentColors(perm: any): string[] {
  const colors = Array.isArray(perm?.colors) ? perm.colors : Array.isArray(perm?.card?.colors) ? perm.card.colors : [];
  return colors.map((c: unknown) => String(c || '').toUpperCase()).filter(Boolean);
}

function readStat(perm: any, stat: string): number | null {
  if (stat === 'mana value') {
    const mv = Number(perm?.card?.cmc ?? perm?.card?.mana_value ?? perm?.cmc);
    return Number.isFinite(mv) ? mv : null;
  }
  const pseudo = { battlefield: [perm] };
  const hooked = stat === 'power' ? readCurrentPowerFromHook(pseudo, perm) : readCurrentToughnessFromHook(pseudo, perm);
  if (hooked !== null && hooked !== undefined) return hooked;
  const printed = Number(perm?.[stat] ?? perm?.card?.[stat]);
  if (!Number.isFinite(printed)) return null;
  const counters = perm?.counters || {};
  return printed + Number(counters['+1/+1'] || 0) - Number(counters['-1/-1'] || 0);
}

/** True when `perm` satisfies one disjunct; unknown qualifiers are trusted. */
function permanentMatchesDisjunct(perm: any, disjunct: string): boolean {
  let text = disjunct.trim();
  const withMatch = text.match(/^(.*?)\s+with\s+(.+)$/);
  let withClause = '';
  if (withMatch) {
    text = String(withMatch[1] || '').trim();
    withClause = String(withMatch[2] || '').trim();
  }
  const typeLine = getExecutorTypeLineLower(perm);
  const colors = permanentColors(perm);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const noun = singular(words[words.length - 1]);
  if (noun === 'player' || noun === 'opponent') return false;
  if (noun !== 'permanent' && !new RegExp(`\\b${noun.replace(/[^a-z0-9'-]/g, '')}s?\\b`).test(typeLine)) return false;

  for (const rawWord of words.slice(0, -1)) {
    const word = rawWord.replace(/[^a-z-]/g, '');
    const negated = /^non-?/.test(word);
    const base = word.replace(/^non-?/, '');
    let holds: boolean | null = null;
    if (COLOR_WORDS[base]) holds = colors.includes(COLOR_WORDS[base]);
    else if (base === 'monocolored') holds = colors.length === 1;
    else if (base === 'multicolored') holds = colors.length > 1;
    else if (base === 'colorless') holds = colors.length === 0;
    else if (base === 'tapped') holds = Boolean(perm?.tapped);
    else if (base === 'untapped') holds = !perm?.tapped;
    else if (base === 'token') holds = Boolean(perm?.isToken);
    else if (base === 'basic' || base === 'legendary' || base === 'snow' || CARD_TYPES.includes(base)) {
      holds = new RegExp(`\\b${base}\\b`).test(typeLine);
    } else if (negated && base) {
      holds = new RegExp(`\\b${base}s?\\b`).test(typeLine);
    }
    if (holds === null) continue;
    if (negated ? holds : !holds) return false;
  }

  const statMatch = withClause.match(/^(power|toughness|mana value) (\d+) or (greater|less|more|fewer)$/);
  if (statMatch) {
    const value = readStat(perm, String(statMatch[1]));
    if (value !== null) {
      const threshold = Number(statMatch[2]);
      const atLeast = /greater|more/.test(String(statMatch[3]));
      if (atLeast ? value < threshold : value > threshold) return false;
    }
  }
  return true;
}

function matchesController(controllerId: string, ownerOrController: string, filter: ControllerFilter): boolean {
  if (!filter || !controllerId) return true;
  return filter === 'you' ? ownerOrController === controllerId : ownerOrController !== controllerId;
}

/**
 * Battlefield permanents bound to a single unparsed "target ..." phrase.
 * Returns null when the phrase is not a single battlefield target, nothing was bound,
 * or no bound object passes the loose filter (callers keep their own fallback/skip).
 */
export function resolveLooseBoundTargetPermanents(
  battlefield: readonly BattlefieldPermanent[],
  targetText: string,
  ctx: OracleIRExecutionContext,
): BattlefieldPermanent[] | null {
  const rest = parseSingleTargetPhrase(targetText);
  if (!rest) return null;
  const { body, controller } = extractControllerFilter(rest);
  const disjuncts = splitDisjuncts(body);
  if (disjuncts.length === 0) return null;
  const controllerId = String(ctx.controllerId || '').trim();
  const byId = new Map(battlefield.map((perm: any) => [String(perm?.id || '').trim(), perm]));
  for (const id of collectExplicitBoundTargetIds(ctx)) {
    const perm: any = byId.get(id);
    if (!perm) continue;
    if (!matchesController(controllerId, String(perm?.controller || '').trim(), controller)) continue;
    if (disjuncts.some((d) => permanentMatchesDisjunct(perm, d))) return [perm];
  }
  return null;
}

export type LooseBoundRecipient = { readonly id: string; readonly isPlayer: boolean };

/**
 * Bound recipients (players and/or permanents) for damage-style phrases:
 * "target player or planeswalker", "target creature or player", "any target",
 * "one or two targets", "each of one or two targets", "one, two, or three targets",
 * "any number of targets". Returns null when the phrase is not one of these templates.
 */
export function resolveLooseBoundTargetRecipients(
  state: { readonly players?: readonly any[]; readonly battlefield?: readonly any[] },
  targetText: string,
  ctx: OracleIRExecutionContext,
): { readonly recipients: LooseBoundRecipient[]; readonly maxTargets: number } | null {
  const text = stripReminder(targetText).toLowerCase().replace(/[.;]+$/, '');
  const players = (state.players || []).map((p: any) => String(p?.id || '').trim()).filter(Boolean);
  const battlefield = (state.battlefield || []) as any[];
  const byId = new Map(battlefield.map((perm: any) => [String(perm?.id || '').trim(), perm]));
  const controllerId = String(ctx.controllerId || '').trim();
  const bound = collectExplicitBoundTargetIds(ctx).filter((id) => players.includes(id) || byId.has(id));

  const countMatch = text.match(/^(?:each of\s+)?(one or two|one, two, or three|one or more|any number of|up to (?:one|two|three)) (?:other )?targets?$/);
  if (countMatch || /^any (?:other )?target$/.test(text)) {
    const phrase = countMatch ? String(countMatch[1]) : 'one';
    const maxTargets = /three/.test(phrase) ? 3 : /two/.test(phrase) ? 2 : /any number|more/.test(phrase) ? 99 : 1;
    return {
      recipients: bound.slice(0, maxTargets).map((id) => ({ id, isPlayer: players.includes(id) })),
      maxTargets,
    };
  }

  // Typed counted phrases: "any number of target creatures" (Fire Covenant), "one or two target
  // creatures and/or planeswalkers", "up to three target creatures your opponents control".
  const typedCountMatch = text.match(
    /^(?:each of\s+)?(one or two|one, two, or three|one or more|any number of|up to (?:one|two|three|four|five|\d+)) (?:other )?target (.+)$/
  );
  if (typedCountMatch) {
    const phrase = String(typedCountMatch[1]);
    const numeric = phrase.match(/\d+/);
    const maxTargets = numeric ? Number(numeric[0])
      : /five/.test(phrase) ? 5 : /four/.test(phrase) ? 4 : /three/.test(phrase) ? 3
      : /two/.test(phrase) ? 2 : /any number|more/.test(phrase) ? 99 : 1;
    const typed = extractControllerFilter(String(typedCountMatch[2]).replace(/\band\/or\b/g, 'or'));
    const typedDisjuncts = splitDisjuncts(typed.body);
    if (typedDisjuncts.length === 0) return null;
    const typedAllowsPlayer = typedDisjuncts.some((d) => /^(?:player|opponent)s?$/.test(d));
    const recipients: LooseBoundRecipient[] = [];
    for (const id of bound) {
      if (recipients.length >= maxTargets) break;
      if (players.includes(id)) {
        if (typedAllowsPlayer) recipients.push({ id, isPlayer: true });
        continue;
      }
      const perm = byId.get(id);
      if (!perm) continue;
      if (!matchesController(controllerId, String(perm?.controller || '').trim(), typed.controller)) continue;
      if (typedDisjuncts.some((d) => permanentMatchesDisjunct(perm, d))) recipients.push({ id, isPlayer: false });
    }
    return { recipients, maxTargets };
  }

  const rest = parseSingleTargetPhrase(text);
  if (!rest) return null;
  const { body, controller } = extractControllerFilter(rest);
  const disjuncts = splitDisjuncts(body);
  if (disjuncts.length === 0) return null;
  const allowsPlayer = disjuncts.some((d) => /^(?:player|opponent)s?$/.test(d));
  const opponentOnly = disjuncts.some((d) => /^opponents?$/.test(d)) && !disjuncts.some((d) => /^players?$/.test(d));
  for (const id of bound) {
    if (players.includes(id)) {
      if (!allowsPlayer) continue;
      if (opponentOnly && id === controllerId) continue;
      return { recipients: [{ id, isPlayer: true }], maxTargets: 1 };
    }
    const perm = byId.get(id);
    if (!perm) continue;
    if (!matchesController(controllerId, String(perm?.controller || '').trim(), controller)) continue;
    if (disjuncts.some((d) => permanentMatchesDisjunct(perm, d))) {
      return { recipients: [{ id, isPlayer: false }], maxTargets: 1 };
    }
  }
  return { recipients: [], maxTargets: 1 };
}
