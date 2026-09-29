/**
 * Origin: "instead" conditionals folded by oracleIRParserPostprocessInsteadReplacementSteps.ts.
 * Cluster: conditions that decide whether a folded replacement ("... instead") applies:
 *   - "this spell was bargained" / "it was bargained" / "it's bargained" (Stonesplitter Bolt, Torch the Tower)
 *   - "X is 6 or more" (Shatterskull Smashing)
 *   - "that creature has flying" and other keyword checks on the referenced creature (Cut Propulsion)
 * Public: tryEvaluateConditionalSpellCastFlagOrKeyword
 * Returns undefined when the clause is not one of these, so the caller keeps looking.
 */
import type { GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveReferencedObject } from './oracleIRExecutorReferenceUtils';
import { getPermanentTextFragments } from './permanentText';

const KEYWORD_CLAUSE =
  /^(?:that|target|the) (?:creature|permanent)(?: you control| an opponent controls)? has (flying|reach|trample|first strike|double strike|deathtouch|lifelink|vigilance|haste|menace|hexproof|indestructible|defender|toxic|infect|wither)$/;

function stripReminderText(text: string): string {
  return text.replace(/\([^)]*\)/g, ' ');
}

/**
 * True when the object's current keyword list, granted abilities or printed keyword lines include the
 * keyword. Only whole keyword entries count, so "destroy target creature with flying" is not a hit.
 */
export function objectCurrentlyHasKeyword(object: any, keyword: string): boolean {
  const needle = String(keyword || '').trim().toLowerCase();
  if (!needle || !object) return false;
  const entries: string[] = [];
  for (const list of [object?.keywords, object?.card?.keywords, object?.grantedKeywords]) {
    if (Array.isArray(list)) entries.push(...list.map((value: unknown) => String(value || '')));
  }
  for (const fragment of getPermanentTextFragments(object)) {
    for (const line of fragment.split('\n')) {
      entries.push(...stripReminderText(line).split(/[,;]/));
    }
  }
  return entries.some((entry) => {
    const normalized = entry.trim().toLowerCase().replace(/\.$/, '');
    return normalized === needle || normalized.startsWith(`${needle} `) && needle === 'toxic';
  });
}

function readBargained(nextState: GameState, ctx: OracleIRExecutionContext): boolean | null {
  if (typeof ctx.wasBargained === 'boolean') return ctx.wasBargained;
  const selectorFlag = (ctx.selectorContext as any)?.wasBargained;
  if (typeof selectorFlag === 'boolean') return selectorFlag;
  const stack = Array.isArray((nextState as any)?.stack) ? (nextState as any).stack : [];
  const item = stack.find((entry: any) => String(entry?.id || '').trim() === String(ctx.sourceId || '').trim());
  const fromItem = item?.wasBargained ?? item?.card?.wasBargained;
  return typeof fromItem === 'boolean' ? fromItem : null;
}

export function tryEvaluateConditionalSpellCastFlagOrKeyword(params: {
  readonly nextState: GameState;
  readonly ctx: OracleIRExecutionContext;
  readonly normalizedRaw: string;
}): boolean | null | undefined {
  const { nextState, ctx, normalizedRaw } = params;

  if (/^(?:this spell was|it was|it's|this spell is) bargained$/.test(normalizedRaw)) {
    const bargained = readBargained(nextState, ctx);
    // Untracked cast metadata keeps the previous best-effort answer instead of silently dropping the upgrade.
    return bargained === null ? undefined : bargained;
  }

  if (/^(?:this spell was|it was) kicked$/.test(normalizedRaw)) {
    // A resolving spell is not on the battlefield, so the cast-time flag on the context is the only source.
    if (ctx.wasKicked === true) return true;
    if (ctx.sourceObjectType === 'spell' && typeof ctx.wasKicked !== 'boolean') return false;
    return undefined;
  }

  const xThreshold = normalizedRaw.match(/^x is (\d+) or (more|less|fewer)$/);
  if (xThreshold) {
    const xValue = Number(ctx.xValue);
    if (!Number.isFinite(xValue)) return null;
    const threshold = Number(xThreshold[1]);
    return xThreshold[2] === 'more' ? xValue >= threshold : xValue <= threshold;
  }

  const keywordClause = normalizedRaw.match(KEYWORD_CLAUSE);
  if (keywordClause) {
    const referenced = resolveReferencedObject(nextState, ctx);
    if (!referenced) return null;
    return objectCurrentlyHasKeyword(referenced, keywordClause[1]!);
  }

  return undefined;
}