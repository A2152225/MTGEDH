import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface LibraryShuffleTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'library_shuffle';
  subject: 'player' | 'opponent' | 'you';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
}

function normalizeOracleText(text: string): string {
  return String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

function normalizeSubject(subject: string): LibraryShuffleTrigger['subject'] {
  const normalized = String(subject || '').toLowerCase();
  if (normalized.includes('opponent')) return 'opponent';
  if (normalized === 'you') return 'you';
  return 'player';
}

export function detectLibraryShuffleTriggers(card: any, permanent: any): LibraryShuffleTrigger[] {
  const triggers: LibraryShuffleTrigger[] = [];
  const oracleText = normalizeOracleText(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const patterns = [
    /whenever\s+(?:a spell or ability causes\s+)?(a player|an opponent|you)\s+to\s+shuffle\s+(?:their|his or her|your)\s+library,?\s*([^.]+)/gi,
    /whenever\s+(a player|an opponent|you)\s+shuffles\s+(?:their|his or her|your)\s+library,?\s*([^.]+)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of oracleText.matchAll(pattern)) {
      const effect = String(match[2] || '').trim();
      if (!effect) continue;

      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'library_shuffle',
        subject: normalizeSubject(match[1] || ''),
        oracleClause: String(match[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
      });
    }
  }

  return triggers;
}

export function getLibraryShuffleTriggers(
  ctx: GameContext,
  shuffledPlayerId: string,
): LibraryShuffleTrigger[] {
  const stateAny = ctx.state as any;
  const battlefield = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];
  const triggers: LibraryShuffleTrigger[] = [];
  const playerId = String(shuffledPlayerId || '').trim();
  if (!playerId) return triggers;

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const controllerId = String(permanent.controller || '').trim();
    if (!controllerId) continue;

    for (const trigger of detectLibraryShuffleTriggers(permanent.card, permanent)) {
      if (trigger.subject === 'you' && controllerId !== playerId) continue;
      if (trigger.subject === 'opponent' && controllerId === playerId) continue;
      triggers.push(trigger);
    }
  }

  return triggers;
}

export function queueLibraryShuffleTriggers(
  ctx: GameContext,
  shuffledPlayerId: string,
  cause: { sourceId?: string; sourceName?: string } = {},
): any[] {
  const playerId = String(shuffledPlayerId || '').trim();
  if (!playerId) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getLibraryShuffleTriggers(ctx, playerId));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || (ctx as any).id || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      continue;
    }

    const triggerId = uid('trigger');
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: playerId,
      targetPlayer: playerId,
      effectData: {
        shuffledPlayerId: playerId,
        causeSourceId: String(cause.sourceId || '').trim(),
        causeSourceName: String(cause.sourceName || '').trim(),
      },
      card: Array.isArray(stateAny.battlefield)
        ? stateAny.battlefield.find((permanent: any) => String(permanent?.id || '') === trigger.permanentId)?.card
        : undefined,
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPlayer: playerId,
          targetPlayer: playerId,
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[shuffleTrigger] Failed to persist generic shuffle trigger:', err);
      }
    }
  }

  return queued;
}