/**
 * "Whenever you / an opponent / a player commits a crime" (event commits_crime).
 * A player commits a crime when they cast a spell, activate an ability, or put a
 * triggered ability on the stack that targets an opponent, something an opponent
 * controls (permanent, spell, ability), or a card in an opponent's graveyard.
 * Emitted once per stack object after it (and its cast / activate event) is on the
 * stack, so replay rebuilds the triggers from their pushTriggeredAbility events in
 * order. Copies are not cast or activated, so they never commit a crime.
 * Public: stackItemCrimeVictim, queueCrimeTriggersForStackItem.
 */
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { recordCommittedCrimeThisTurn } from '../turn-tracking.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { collectMatchingParsedEventLines } from './triggerConditionFamilyMatch.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

function isCopyStackItem(item: any): boolean {
  return Boolean(item?.isCopy || item?.copyOf || item?.copiedFrom || item?.card?.isCopy || item?.spell?.isCopy);
}

function graveyardOwnerOf(state: any, cardId: string): string {
  for (const player of Array.isArray(state?.players) ? state.players : []) {
    const playerId = String(player?.id || '');
    const yard = (Array.isArray(player?.graveyard) && player.graveyard.length > 0)
      ? player.graveyard
      : (state?.zones?.[playerId]?.graveyard || []);
    if (Array.isArray(yard) && yard.some((card: any) => String(card?.id || card || '') === cardId)) return playerId;
  }
  return '';
}

/** First opponent the targets wrong (player, their permanent / spell / ability / graveyard card), or ''. */
export function stackItemCrimeVictim(state: any, criminal: string, targets: readonly any[]): string {
  const playerIds = new Set((Array.isArray(state?.players) ? state.players : []).map((p: any) => String(p?.id || '')).filter(Boolean));
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  for (const target of targets) {
    const id = String(typeof target === 'string' ? target : (target?.id ?? '')).trim();
    if (!id) continue;
    let victim = '';
    if (playerIds.has(id)) victim = id;
    else if (target && typeof target === 'object' && target.controllerId) victim = String(target.controllerId);
    else {
      const perm = battlefield.find((entry: any) => String(entry?.id || '') === id);
      const onStack = perm ? undefined : stack.find((entry: any) => String(entry?.id || '') === id);
      victim = String(perm?.controller || onStack?.controller || '') || graveyardOwnerOf(state, id);
    }
    if (victim && victim !== criminal) return victim;
  }
  return '';
}

/** Queue commits_crime triggers for one stack object. Idempotent once the object has targets. */
export function queueCrimeTriggersForStackItem(ctx: any, stackItemId: string | undefined, extraTargetIds?: readonly string[], gameIdOverride?: string): any[] {
  if (!ctx || ctx.isReplaying) return [];
  const state = ctx.state;
  const itemId = String(stackItemId || '').trim();
  if (!state || !itemId) return [];
  const stack = Array.isArray(state.stack) ? state.stack : [];
  const item = stack.find((entry: any) => String(entry?.id || '') === itemId);
  if (!item || item.crimeChecked || isCopyStackItem(item)) return [];
  const targets = [...(Array.isArray(item.targets) ? item.targets : []), ...(extraTargetIds || [])];
  if (targets.length === 0) return [];
  item.crimeChecked = true;
  const criminal = String(item.controller || '').trim();
  if (!criminal) return [];
  const victim = stackItemCrimeVictim(state, criminal, targets);
  if (!victim) return [];
  recordCommittedCrimeThisTurn(state, criminal, [{ type: 'player', id: victim }]);

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const detected: Array<{ permanentId: string; cardName: string; controllerId: string; effect: string; mandatory: boolean }> = [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'commits_crime',
      subjectPermanent: { id: `crime:${itemId}`, controller: criminal, owner: criminal, card: { name: 'crime', type_line: '' } },
      subjectControllerId: criminal,
      sourcePermanent: permanent,
      thatPlayerId: criminal,
    })) {
      detected.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        effect: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
      });
    }
  }
  if (detected.length === 0) return [];

  const gameId = String(gameIdOverride || ctx.gameId || ctx.id || '').trim();
  const queued: any[] = [];
  for (const trigger of orderTriggersByAPNAP(ctx, detected)) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;
    const triggerId = uid('trigger');
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === trigger.permanentId);
    const effectData = { triggeringStackItemId: itemId, criminalPlayerId: criminal, crimeVictimPlayerId: victim };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanent?.card ? { card: { ...sourcePermanent.card } } : null),
      triggerType: 'commits_crime',
      mandatory: trigger.mandatory,
      triggeringPlayer: criminal,
      triggeringStackItemId: itemId,
      effectData,
    };
    state.stack.push(stackItem);
    queued.push(stackItem);
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number(ctx.seq?.value ?? ctx.seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: 'commits_crime',
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory,
          triggeringPlayer: criminal,
          triggeringStackItemId: itemId,
          ...(sourcePermanent?.card ? { card: { ...sourcePermanent.card } } : null),
          effectData,
        });
      } catch (err) {
        debugWarn(1, '[crime] appendEvent(pushTriggeredAbility) failed:', err);
      }
    }
  }
  return queued;
}
