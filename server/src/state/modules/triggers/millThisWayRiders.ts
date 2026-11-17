/**
 * Reflexive "when one or more cards are milled this way" riders.
 * Origin parent: mill.ts getMillTriggers (permanent mill scan skips delayedRider).
 * Public: queueSourceMillThisWayRiders.
 *
 * The IR matcher refuses delayedRider, so a parent resolution that actually milled
 * cards queues the printed rider itself. Unrelated mills do not.
 */
import type { GameContext } from '../../context.js';
import { parseTriggerClause } from '../../../../../rules-engine/src/triggerCondition/index.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';

const ABILITY_WORD = /^\s*[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;

function triggerSentences(oracleText: string): string[] {
  return String(oracleText || '')
    .replace(/\([^)]*\)/g, '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i))
    .map((sentence) => sentence.replace(ABILITY_WORD, '').trim())
    .filter((sentence) => /^(?:when|whenever|at)\b/i.test(sentence));
}

export function queueSourceMillThisWayRiders(
  ctx: GameContext,
  sourcePermanentId: string,
  milledCards: readonly any[],
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const sourceId = String(sourcePermanentId || '').trim();
  const cards = (Array.isArray(milledCards) ? milledCards : []).filter((card) => card && String(card?.id || '').trim());
  if (!sourceId || cards.length === 0) return [];
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const source = battlefield.find((permanent: any) => String(permanent?.id || '') === sourceId);
  if (!source?.card) return [];
  if (!permanentHasTriggeredAbilities(source, state, { event: 'other' })) return [];
  const name = String(source.card.name || 'Unknown');
  const queued: any[] = [];
  for (const sentence of triggerSentences(String(source.card.oracle_text || ''))) {
    const parsed = parseTriggerClause(sentence, name);
    if (!parsed?.effect || parsed.condition?.event !== 'mills' || parsed.condition.thisWay !== true) continue;
    if (parsed.condition.legacyRuntimeOnly) continue;
    const item = queueGenericTriggeredAbility(ctx, {
      permanentId: sourceId,
      controllerId: String(source.controller || ''),
      cardName: name,
      effect: parsed.effect,
      description: parsed.effect,
      mandatory: !/^you may\b/i.test(parsed.effect),
    }, 'mills_this_way', {
      thisWay: true,
      milledCardsCount: cards.length,
      milledCardIds: cards.map((card) => String(card?.id || '')).filter(Boolean),
    });
    if (item) queued.push(item);
  }
  return queued;
}
