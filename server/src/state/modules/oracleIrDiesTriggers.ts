// Dies triggers for permanents an Oracle IR step moved from the battlefield to a graveyard.
// The IR executor moves destroyed/sacrificed permanents itself, so the death bookkeeping and
// "when/whenever ... dies" triggers that movePermanentToGraveyard runs were never queued
// (Veteran Explorer destroyed by Damn: no land search). Leaves-the-battlefield abilities look
// back in time (rule 603.10a), so the pre-removal permanent snapshot is the dying object.
// Public entry symbols: queueDiesTriggersForOracleIrRemovals.

import type { GameContext } from '../context.js';
import { debugWarn } from '../../utils/debug.js';
import { getDeathTriggers } from './triggered-abilities.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import { isOneOrMoreBatchDuplicate } from './triggers/simultaneousEntryBatch.js';
import { pushDeathTriggerOntoStack } from './counters_tokens-handlers/countersTokensDeathTriggerStack.js';
import { getKeywordDeathTriggersForPermanent, mergeDeathTriggers } from './counters_tokens-handlers/countersTokensDeathTriggerKeywords.js';

function graveyardIds(state: any): Set<string> {
  const ids = new Set<string>();
  const add = (cards: any) => { for (const c of Array.isArray(cards) ? cards : []) { const id = String(c?.id || '').trim(); if (id) ids.add(id); } };
  for (const player of Array.isArray(state?.players) ? state.players : []) add(player?.graveyard);
  for (const zone of Object.values(state?.zones || {})) add((zone as any)?.graveyard);
  return ids;
}

function recordCreatureDeath(state: any, perm: any): void {
  const id = String(perm?.id || '').trim();
  if (!id) return;
  state.creaturesDiedThisTurnIds = Array.isArray(state.creaturesDiedThisTurnIds) ? state.creaturesDiedThisTurnIds : [];
  if (!state.creaturesDiedThisTurnIds.includes(id)) state.creaturesDiedThisTurnIds.push(id);
}

export function queueDiesTriggersForOracleIrRemovals(
  ctx: GameContext,
  state: any,
  removedBefore: ReadonlyArray<{ permanent: any; graveyardIdsBefore: ReadonlySet<string> }>,
  options: { tokenDeathKinds: boolean },
): number {
  if ((ctx as any)?.isReplaying || removedBefore.length === 0) return 0;
  let queued = 0;
  try {
    const afterGy = graveyardIds(state);
    for (const { permanent: perm, graveyardIdsBefore } of removedBefore) {
      const cardId = String(perm?.card?.id || '').trim();
      const isToken = perm?.isToken === true || perm?.card?.isToken === true;
      const wentToGraveyard = cardId ? afterGy.has(cardId) && !graveyardIdsBefore.has(cardId) : false;
      // A token dies too, even though it then ceases to exist (rule 700.4 / 111.7).
      if (!wentToGraveyard && !(isToken && options.tokenDeathKinds)) continue;
      const controller = String(perm?.controller || perm?.owner || '').trim();
      if (/\bcreature\b/i.test(String(perm?.card?.type_line || ''))) recordCreatureDeath(state, perm);
      const triggers = mergeDeathTriggers(
        getDeathTriggers(ctx, perm, controller),
        getKeywordDeathTriggersForPermanent(perm, controller),
      ).filter((trigger: any) => {
        const sourceId = String(trigger?.source?.permanentId || '');
        const sourcePerm = (state.battlefield || []).find((p: any) => String(p?.id || '') === sourceId)
          || (sourceId === String(perm.id) ? perm : null);
        return !isOneOrMoreBatchDuplicate('dies', sourceId, String(trigger?.effect || ''), String(sourcePerm?.card?.oracle_text || ''));
      });
      if (triggers.length === 0) continue;
      const ordered = orderTriggersByAPNAP(ctx, triggers.map((t: any) => ({ ...t, controllerId: String(t?.source?.controllerId || '') })));
      state.stack = state.stack || [];
      for (const trigger of ordered as any[]) {
        const sourcePerm = trigger?.source?.permanentId === perm.id
          ? perm
          : (state.battlefield || []).find((p: any) => p?.id === trigger?.source?.permanentId);
        let text = String(trigger.effect || '').trim();
        if (text && !/^(?:when|whenever|at)\b/i.test(text)) text = `Whenever a creature dies, ${text}`;
        const refs = controller && /\bthat player\b/i.test(text)
          ? { thatPlayerId: controller, referencedPlayerId: controller, theirPlayerId: controller }
          : undefined;
        if (isInterveningIfSatisfied(ctx as any, String(trigger.source.controllerId), text, sourcePerm, refs) === false) continue;
        pushDeathTriggerOntoStack(ctx, trigger, perm);
        queued += 1;
      }
    }
  } catch (err) {
    debugWarn(1, '[oracleIrDiesTriggers] Failed to queue dies triggers for IR removals:', err);
  }
  return queued;
}