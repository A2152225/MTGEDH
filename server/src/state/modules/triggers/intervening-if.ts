import type { GameContext } from "../context.js";
import {
  UNMATCHED_INTERVENING_IF,
  FALLBACK_INTERVENING_IF,
  attachInterveningIfRefs,
} from "./intervening-if-eval-support.js";
import type {
  InterveningIfInternalResult,
  InterveningIfEvaluation,
  InterveningIfRefs,
} from "./intervening-if-eval-support.js";
export type { InterveningIfEvaluation, InterveningIfRefs };
import { tryEvaluateInterveningIfEarlyClauses } from "./intervening-if-eval-early-clauses.js";
import { tryEvaluateInterveningIfItAndLifeClauses } from "./intervening-if-eval-it-and-life-clauses.js";
import { tryEvaluateInterveningIfControlZoneClauses } from "./intervening-if-eval-control-zone-clauses.js";
import { tryEvaluateInterveningIfCombatRevoltClauses } from "./intervening-if-eval-combat-revolt-clauses.js";
import { tryEvaluateInterveningIfKickerManaClauses } from "./intervening-if-eval-kicker-mana-clauses.js";
import { tryEvaluateInterveningIfStatusDungeonClauses } from "./intervening-if-eval-status-dungeon-clauses.js";
import { tryEvaluateInterveningIfMechanicPoisonHandClauses } from "./intervening-if-eval-mechanic-poison-hand-clauses.js";
import { tryEvaluateInterveningIfMechanicHandColorClauses } from "./intervening-if-eval-mechanic-hand-color-clauses.js";
import { tryEvaluateInterveningIfMechanicTailClauses } from "./intervening-if-eval-mechanic-tail-clauses.js";
import { tryEvaluateInterveningIfThatRefEarlyClauses } from "./intervening-if-eval-that-ref-early-clauses.js";
import { tryEvaluateInterveningIfThatRefSelfClauses } from "./intervening-if-eval-that-ref-self-clauses.js";
import { tryEvaluateInterveningIfThatRefKeywordClauses } from "./intervening-if-eval-that-ref-keyword-clauses.js";
import { tryEvaluateInterveningIfUniquenessCastClauses } from "./intervening-if-eval-uniqueness-cast-clauses.js";
import { tryEvaluateInterveningIfFallbackBurnDownClauses } from "./intervening-if-eval-fallback-burndown-clauses.js";
import { tryEvaluateInterveningIfTargetedLastFallbackClauses } from "./intervening-if-eval-targeted-last-fallback-clauses.js";
import { tryEvaluateInterveningIfOwnControlNamedClauses } from "./intervening-if-eval-own-control-named-clauses.js";
import { tryEvaluateInterveningIfKeywordShareShorthandClauses } from "./intervening-if-eval-keyword-share-shorthand-clauses.js";

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[’]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLower(text: string): string {
  return normalizeText(text).toLowerCase();
}



/**
 * Extract an intervening-if clause (the leading "if ...") from a triggered ability's
 * description/effect text.
 *
 * Examples:
 * - "If you control seven or more Plains, you may ..." => "if you control seven or more plains"
 */
export function extractLeadingInterveningIfClause(text: string): string | null {
  const normalized = normalizeText(text);
  if (!/^if\s+/i.test(normalized)) return null;

  // Capture up to the first comma (most oracle templates use a comma after the condition).
  const m = normalized.match(/^if\s+(.+?)(?:,|$)/i);
  if (!m) return null;
  return `if ${m[1]}`;
}

/**
 * Extract an intervening-if clause from a triggered ability description.
 *
 * Supports both common oracle templates:
 * - "If <cond>, ..." (leading)
 * - "When/Whenever/At <event>, if <cond>, ..." (comma-delimited)
 *
 * Returns the normalized leading clause (e.g. "if you control another knight").
 */
export function extractInterveningIfClause(text: string): string | null {
  const normalized = normalizeText(text);

  // Leading "If ..."
  const leading = extractLeadingInterveningIfClause(normalized);
  if (leading) return leading;

  // Multi-ability oracle often prefixes static text before the trigger clause
  // (e.g. "First strike\nWhen this creature enters, if ...").
  const triggerAnywhereMatch = normalized.match(
    /\b(?:when|whenever|at)\b[^,]+,\s*(if\s+.+?)(?:,|$)/i,
  );
  if (triggerAnywhereMatch) {
    const clause = normalizeText(triggerAnywhereMatch[1]).replace(/[.\s]+$/, "").trim();
    if (clause) return clause;
  }

  const playerWhoMore = normalized.match(
    /\b(?:a |that |defending )?player(?:,)? who (controls more (?:lands|creatures) than you)\b/i,
  );
  if (playerWhoMore) {
    return `if that player ${playerWhoMore[1]}`;
  }

  // Only treat comma-delimited ", if ..." as intervening-if when the text looks like a trigger template.
  // This avoids false positives for effect text like "... . If you do, ...".
  if (!/^(when|whenever|at)\b/i.test(normalized)) return null;

  const m = normalized.match(/,\s*(if\s+.+?)(?:,|$)/i);
  if (!m) return null;

  // Normalize to a leading-if clause and trim trailing punctuation.
  const clause = normalizeText(m[1]).replace(/[.\s]+$/, "").trim();
  return clause;
}

function evaluateInterveningIfClauseInternal(
  ctx: GameContext,
  controllerId: string,
  clauseText: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): InterveningIfInternalResult {
  sourcePermanent = attachInterveningIfRefs(sourcePermanent, refs);
  let clause = toLower(clauseText);
  // Parser stores intervening-if text without the leading "if" (e.g. "a creature died this turn").
  if (clause && !clause.startsWith('if ')) {
    clause = `if ${clause}`;
  }

  {
    const r = tryEvaluateInterveningIfEarlyClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }

  {
    const r = tryEvaluateInterveningIfItAndLifeClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfControlZoneClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfCombatRevoltClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }

  {
    const r = tryEvaluateInterveningIfKickerManaClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfStatusDungeonClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }

  {
    const r = tryEvaluateInterveningIfMechanicPoisonHandClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfMechanicHandColorClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfMechanicTailClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }

  {
    const r = tryEvaluateInterveningIfThatRefEarlyClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }

  {
    const r = tryEvaluateInterveningIfThatRefSelfClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfThatRefKeywordClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfUniquenessCastClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfFallbackBurnDownClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfTargetedLastFallbackClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfOwnControlNamedClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }
  {
    const r = tryEvaluateInterveningIfKeywordShareShorthandClauses({
      ctx,
      controllerId,
      clause,
      sourcePermanent,
      refs,
      evaluateRest: evaluateInterveningIfClauseInternal,
    });
    if (r !== undefined) return r;
  }

  // Generic fallback:
  // Many intervening-if templates exist in Oracle text, but the engine may not track the required state yet.
  // To keep trigger handling conservative (don't miss triggers), treat any remaining leading "if ..." clause
  // as recognized-but-unknown.
  if (clause.startsWith('if ')) return FALLBACK_INTERVENING_IF;

  return UNMATCHED_INTERVENING_IF;
}

export function evaluateInterveningIfClause(
  ctx: GameContext,
  controllerId: string,
  clauseText: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): boolean | null;
export function evaluateInterveningIfClause(
  clauseText: string,
  ctx: GameContext,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): boolean | null;
export function evaluateInterveningIfClause(
  a: GameContext | string,
  b: string | GameContext,
  c: string | any,
  d?: any,
  e?: InterveningIfRefs
): boolean | null {
  // Support legacy/test convenience signature: (clauseText, ctx, sourcePermanent?, refs?)
  if (typeof a === 'string' && b && typeof b === 'object') {
    const clauseText = a;
    const ctx = b as GameContext;
    const sourcePermanent = c;
    const refs = d as InterveningIfRefs | undefined;
    const controllerId = String((sourcePermanent as any)?.controllerId ?? (sourcePermanent as any)?.controller ?? '').trim();
    if (!controllerId) return null;
    const v = evaluateInterveningIfClauseInternal(ctx, controllerId, clauseText, sourcePermanent, refs);
    if (v === UNMATCHED_INTERVENING_IF) return null;
    if (v === FALLBACK_INTERVENING_IF) return null;
    return v;
  }

  const ctx = a as GameContext;
  const controllerId = b as string;
  const clauseText = c as string;
  const sourcePermanent = d;
  const refs = e;
  const v = evaluateInterveningIfClauseInternal(ctx, controllerId, clauseText, sourcePermanent, refs);
  if (v === UNMATCHED_INTERVENING_IF) return null;
  if (v === FALLBACK_INTERVENING_IF) return null;
  return v;
}

export function evaluateInterveningIfClauseDetailed(
  ctx: GameContext,
  controllerId: string,
  clauseText: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): InterveningIfEvaluation {
  const v = evaluateInterveningIfClauseInternal(ctx, controllerId, clauseText, sourcePermanent, refs);
  if (v === UNMATCHED_INTERVENING_IF) return { matched: false, value: null };
  if (v === FALLBACK_INTERVENING_IF) return { matched: true, value: null, fallback: true };
  return { matched: true, value: v };
}

/**
 * Convenience: parse and evaluate the leading intervening-if from a description.
 */
export function isInterveningIfSatisfied(
  ctx: GameContext,
  controllerId: string,
  descriptionOrEffect: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): boolean | null {
  const clause = extractInterveningIfClause(descriptionOrEffect);
  if (!clause) return null;
  return evaluateInterveningIfClause(ctx, controllerId, clause, sourcePermanent, refs);
}
