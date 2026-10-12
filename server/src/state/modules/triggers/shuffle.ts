import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from './triggerConditionFamilyMatch.js';

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

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'shuffles_library',
      subjectPermanent: { id: '', controller: playerId },
      subjectControllerId: playerId,
      sourcePermanent: permanent,
      libraryOwnerId: playerId,
    })) {
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates(existing.effect || '', line)
      ))) continue;
      const controller = line.condition?.alternatives[0]?.controller;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        triggerType: 'library_shuffle',
        subject: controller === 'you' ? 'you' : controller === 'not_you' ? 'opponent' : 'player',
        oracleClause: line.effect,
        effect: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
      });
    }
  }

  return triggers;
}

function findBattlefieldPermanentById(ctx: GameContext, permanentId: string): any | undefined {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return undefined;
  return battlefield.find((permanent: any) => String(permanent?.id || '') === normalizedPermanentId);
}

function snapshotPermanentForLibraryShuffleTrigger(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;

  return {
    id: String(permanent?.id || ''),
    controller: String(permanent?.controller || ''),
    owner: String(permanent?.owner || permanent?.controller || ''),
    tapped: permanent?.tapped === true,
    counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
    card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
  };
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
    const sourcePermanentSnapshot = snapshotPermanentForLibraryShuffleTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
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
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: playerId,
      targetPlayer: playerId,
      effectData: {
        shuffledPlayerId: playerId,
        causeSourceId: String(cause.sourceId || '').trim(),
        causeSourceName: String(cause.sourceName || '').trim(),
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPlayer: playerId,
          targetPlayer: playerId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[shuffleTrigger] Failed to persist generic shuffle trigger:', err);
      }
    }
  }

  return queued;
}