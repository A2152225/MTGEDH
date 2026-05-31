import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface LibrarySearchTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'opponent_searches_library' | 'player_searches_library' | 'you_search_library';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  requiresOwnLibrary: boolean;
}

export interface LibrarySearchTriggerSource {
  sourceId?: string;
  sourceName?: string;
  searchedLibraryOwnerId?: string;
}

export function detectLibrarySearchTriggers(card: any, permanent: any): LibrarySearchTrigger[] {
  const triggers: LibrarySearchTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const patterns: Array<{ regex: RegExp; triggerType: LibrarySearchTrigger['triggerType']; requiresOwnLibrary: boolean }> = [
    {
      regex: /whenever an opponent searches their library,\s*([^.]+)/gi,
      triggerType: 'opponent_searches_library',
      requiresOwnLibrary: true,
    },
    {
      regex: /whenever a player searches their library,\s*([^.]+)/gi,
      triggerType: 'player_searches_library',
      requiresOwnLibrary: true,
    },
    {
      regex: /whenever you search your library,\s*([^.]+)/gi,
      triggerType: 'you_search_library',
      requiresOwnLibrary: true,
    },
  ];

  for (const pattern of patterns) {
    for (const match of oracleText.matchAll(pattern.regex)) {
      const effect = String(match[1] || '').trim();
      if (!effect) continue;

      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: pattern.triggerType,
        oracleClause: String(match[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        requiresOwnLibrary: pattern.requiresOwnLibrary,
      });
    }
  }

  return triggers;
}

export function getLibrarySearchTriggers(
  ctx: GameContext,
  searchingPlayerId: string,
  searchedLibraryOwnerId = searchingPlayerId,
): LibrarySearchTrigger[] {
  const triggers: LibrarySearchTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permanentController = String(permanent.controller || '');
    const permanentTriggers = detectLibrarySearchTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      if (trigger.requiresOwnLibrary && String(searchingPlayerId) !== String(searchedLibraryOwnerId)) {
        continue;
      }

      const interveningText = String(trigger.oracleClause || trigger.effect || '').trim();
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanentController,
        interveningText,
        permanent,
        {
          thatPlayerId: searchingPlayerId,
          referencedPlayerId: searchingPlayerId,
          theirPlayerId: searchingPlayerId,
        },
      );
      if (ok === false) continue;

      switch (trigger.triggerType) {
        case 'opponent_searches_library':
          if (searchingPlayerId !== permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
        case 'player_searches_library':
          triggers.push({ ...trigger, controllerId: permanentController });
          break;
        case 'you_search_library':
          if (searchingPlayerId === permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
      }
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

function snapshotPermanentForLibrarySearchTrigger(permanent: any): any | undefined {
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

export function queueLibrarySearchTriggers(
  ctx: GameContext,
  searchingPlayerId: string,
  source?: LibrarySearchTriggerSource,
): any[] {
  if (!searchingPlayerId) {
    return [];
  }
  if ((ctx as any)?.isReplaying) return [];

  const searchedLibraryOwnerId = String(source?.searchedLibraryOwnerId || searchingPlayerId);
  const triggers = orderTriggersByAPNAP(ctx, getLibrarySearchTriggers(ctx, searchingPlayerId, searchedLibraryOwnerId));
  if (triggers.length === 0) {
    return [];
  }

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      continue;
    }

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = snapshotPermanentForLibrarySearchTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
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
      triggeringPlayer: searchingPlayerId,
      targetPlayer: searchingPlayerId,
      effectData: {
        searchingPlayerId,
        searchedLibraryOwnerId,
        ...(source?.sourceId ? { searchSourceId: source.sourceId } : null),
        ...(source?.sourceName ? { searchSourceName: source.sourceName } : null),
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
          targetPlayer: searchingPlayerId,
          triggeringPlayer: searchingPlayerId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[librarySearchTrigger] Failed to persist generic library-search trigger:', err);
      }
    }
  }

  return queued;
}