/**
 * "When you have N or less/more life, [if <cond>,] <effect>" state triggers (CR 603.8): Opal Avenger,
 * Transcendence. Triggers while the life total satisfies the threshold and not again while the same
 * ability is still on the stack. The intervening-if (CR 603.4) is checked here and kept in the stack
 * item's description so resolution rechecks it.
 * Public: parseLifeThresholdTriggers, queueLifeThresholdStateTriggers.
 */
import type { GameContext } from '../../context.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';

export interface LifeThresholdTrigger {
  threshold: number;
  comparison: 'at_most' | 'at_least';
  interveningIf: string;
  effect: string;
  clause: string;
}

const LIFE_THRESHOLD = /\bwhen you have (\d+) or (less|fewer|more) life,\s*(if [^,]+,\s*)?([^.]+)\./gi;

export function parseLifeThresholdTriggers(oracleText: string): LifeThresholdTrigger[] {
  const out: LifeThresholdTrigger[] = [];
  const text = String(oracleText || '').replace(/\([^)]*\)/g, '');
  for (const m of text.matchAll(LIFE_THRESHOLD)) {
    const effect = String(m[4] || '').trim();
    if (!effect) continue;
    out.push({
      threshold: Number(m[1]),
      comparison: /more/i.test(m[2]) ? 'at_least' : 'at_most',
      interveningIf: String(m[3] || '').trim().replace(/,$/, ''),
      effect,
      clause: String(m[0] || '').trim(),
    });
  }
  return out;
}

function lifeOf(state: any, playerId: string): number | null {
  const fromMap = state?.life?.[playerId];
  if (typeof fromMap === 'number') return fromMap;
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id) === playerId);
  return typeof player?.life === 'number' ? player.life : null;
}

/** "if <this card> is a(n) <type>" plus the shared intervening-if evaluator (self name read as this permanent). */
function interveningIfHolds(ctx: GameContext, controllerId: string, clause: string, cardName: string, source: any): boolean | null {
  const selfClause = cardName ? clause.split(cardName).join('this permanent') : clause;
  const typed = /^if (?:this permanent|it) is an? ([a-z]+)$/i.exec(selfClause.trim());
  if (typed) return new RegExp('\\b' + typed[1] + '\\b', 'i').test(String(source?.card?.type_line || ''));
  return isInterveningIfSatisfied(ctx, controllerId, selfClause + ', x', source);
}

/** Resolution recheck (CR 603.4): true when the stored intervening-if no longer holds. */
export function lifeThresholdInterveningIfFails(ctx: GameContext, item: any): boolean {
  const clause = String(item?.lifeThresholdInterveningIf || '').trim();
  if (!clause) return false;
  const id = String(item?.sourcePermanentId || item?.permanentId || item?.source || '');
  const source = ((ctx as any).state?.battlefield || []).find((p: any) => String(p?.id || '') === id);
  if (!source) return false;
  return interveningIfHolds(ctx, String(item?.controller || source.controller || ''), clause, String(source.card?.name || item?.sourceName || ''), source) === false;
}

export function queueLifeThresholdStateTriggers(ctx: GameContext): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const queued: any[] = [];
  for (const source of battlefield) {
    const oracle = String(source?.card?.oracle_text || '');
    if (!/\bwhen you have \d+ or (?:less|fewer|more) life\b/i.test(oracle)) continue;
    if (!permanentHasTriggeredAbilities(source, state, { event: 'other' })) continue;
    const controllerId = String(source.controller || '');
    const life = lifeOf(state, controllerId);
    if (life === null) continue;
    const sourceId = String(source.id || '');
    const cardName = String(source.card?.name || 'Unknown');
    for (const t of parseLifeThresholdTriggers(oracle)) {
      if (t.comparison === 'at_most' ? life > t.threshold : life < t.threshold) continue;
      const stack = Array.isArray(state?.stack) ? state.stack : [];
      if (stack.some((item: any) => String(item?.permanentId || item?.source || '') === sourceId
        && String(item?.triggerType || '') === 'life_threshold'
        && String(item?.effect || '') === t.effect)) continue;
      if (t.interveningIf && interveningIfHolds(ctx, controllerId, t.interveningIf, cardName, source) === false) continue;
      const item = queueGenericTriggeredAbility(ctx, {
        permanentId: sourceId,
        controllerId,
        cardName,
        effect: t.effect,
        description: t.effect,
        mandatory: !/^you may\b/i.test(t.effect),
      }, 'life_threshold', { sourcePermanentId: sourceId, lifeThreshold: t.threshold, lifeComparison: t.comparison });
      if (!item) continue;
      if (t.interveningIf) { item.description = t.clause; item.lifeThresholdInterveningIf = t.interveningIf; }
      queued.push(item);
    }
  }
  return queued;
}
