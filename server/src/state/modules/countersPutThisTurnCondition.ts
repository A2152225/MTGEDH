// server/src/state/modules/countersPutThisTurnCondition.ts
// B62: generic "you've put one or more [+1/+1] counters on it this turn" static gate
// (Beast, Erudite Aerialist; Kid Loki). Reads plusOneCountersPutThisTurnByPermanentId /
// countersPutThisTurnByPermanentId stamped by counters_tokens.
// Public: parseCountersPutThisTurnCondition, evalCountersPutThisTurnCondition.

import type { StaticEffectCondition } from './staticEffectSpecTypes.js';

const SELF_RE =
  /you've put (?:one or more|a|an|\d+)(?: or more)?(?: \+1\/\+1)? counters? on (?:it|this creature|~|[a-z' ,-]+?) this turn/i;
const PLUS_ONE_MARK = /\+1\/\+1/;

export function parseCountersPutThisTurnCondition(raw: string): StaticEffectCondition | null {
  const text = String(raw || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/[.,]+$/, '');
  if (!SELF_RE.test(text) && !/^you've put .+ counters? on .+ this turn$/.test(text)) return null;
  const plusOne = PLUS_ONE_MARK.test(text);
  return {
    kind: 'target_had_counters_put_this_turn',
    ...(plusOne ? { counterType: '+1/+1' } : {}),
    amount: 1,
  } as StaticEffectCondition;
}

export function evalCountersPutThisTurnCondition(
  condition: { counterType?: string; amount?: number },
  permanent: { id?: string } | null | undefined,
  state: any,
): boolean {
  const id = String(permanent?.id || '').trim();
  if (!id || !state) return false;
  const min = Math.max(1, Number(condition.amount || 1));
  const plusOneOnly = String(condition.counterType || '').includes('+1');
  const map = plusOneOnly
    ? (state.plusOneCountersPutThisTurnByPermanentId || {})
    : (state.countersPutThisTurnByPermanentId || state.plusOneCountersPutThisTurnByPermanentId || {});
  return Number(map[id] || 0) >= min;
}
