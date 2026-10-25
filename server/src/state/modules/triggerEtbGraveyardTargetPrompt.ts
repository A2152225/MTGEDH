/**
 * Extracted from triggerEtbEntryEffects.ts: self-ETB graveyard target prompt.
 * Public: queueSelfEtbGraveyardTargetPrompt
 *
 * When a just-pushed ETB trigger needs a graveyard target, queue
 * GRAVEYARD_SELECTION so the player can pick before the trigger resolves.
 * Cast-from-graveyard ("you may cast target …") is left to resolve-time
 * `tryDeferTriggeredAbilityTargetSelection` so only one prompt is queued.
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { matchesGraveyardCardTargetType } from '../../rules-engine/targeting.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { cardManaValue } from '../utils.js';
import { graveyardCardsAreUntargetable } from './graveyardTargetingRestriction.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';

function buildTriggeredAbilityGraveyardValidTargets(
  ctx: GameContext,
  controllerId: string,
  metadata: ReturnType<typeof inferTriggeredAbilityTargetMetadata>,
): Array<{ id: string; name: string; typeLine: string; manaCost?: string; imageUrl?: string; zoneOwnerId: string }> {
  const state = (ctx as any).state || {};
  const zones = (state.zones || {}) as Record<string, any>;
  const graveyardScope = String((metadata as any).targetGraveyardScope || 'your').toLowerCase();
  const owners = graveyardScope === 'any'
    ? Object.keys(zones).filter((pid) => Array.isArray(zones[pid]?.graveyard))
    : graveyardScope === 'opponent'
      ? Object.keys(zones).filter((pid) => String(pid) !== String(controllerId) && Array.isArray(zones[pid]?.graveyard))
      : [String(controllerId)];

  const filterTypes = Array.isArray(metadata.targetFilterTypes) ? metadata.targetFilterTypes : [];
  const excludeTypes = Array.isArray(metadata.targetFilterExcludeTypes) ? metadata.targetFilterExcludeTypes : [];
  const requiredTypeWords = Array.isArray((metadata as any).targetFilterRequiredTypeWords) ? (metadata as any).targetFilterRequiredTypeWords : [];
  let baseToken: string;
  if (excludeTypes.length === 1 && filterTypes.length === 1) {
    baseToken = `graveyard_non-${String(excludeTypes[0]).toLowerCase()}_${String(filterTypes[0]).toLowerCase()}_card`;
  } else if (excludeTypes.length === 1 && filterTypes.length === 0) {
    baseToken = `graveyard_non-${String(excludeTypes[0]).toLowerCase()}_card`;
  } else if (filterTypes.length === 1) {
    baseToken = `graveyard_${String(filterTypes[0]).toLowerCase()}_card`;
  } else if ((metadata as any).targetFilterPermanentOnly === true) {
    baseToken = 'graveyard_permanent_card';
  } else {
    baseToken = 'graveyard_card';
  }

  const typeTokens = filterTypes.length > 1
    ? filterTypes.map((typeName) => `graveyard_${String(typeName).toLowerCase()}_card`)
    : [baseToken];

  const exactMV = typeof (metadata as any).targetFilterExactManaValue === 'number' ? Number((metadata as any).targetFilterExactManaValue) : undefined;
  const minMV = typeof (metadata as any).targetFilterMinManaValue === 'number' ? Number((metadata as any).targetFilterMinManaValue) : undefined;
  const maxMV = typeof metadata.targetFilterMaxManaValue === 'number' ? Number(metadata.targetFilterMaxManaValue) : undefined;

  const results: Array<{ id: string; name: string; typeLine: string; manaCost?: string; imageUrl?: string; zoneOwnerId: string }> = [];
  for (const ownerId of owners) {
    const graveyard = graveyardCardsAreUntargetable(state, String(controllerId), String(ownerId)) ? [] : (Array.isArray(zones[ownerId]?.graveyard) ? zones[ownerId].graveyard : []);
    for (const card of graveyard) {
      if (!typeTokens.some((token) => matchesGraveyardCardTargetType(card, token))) continue;
      if (requiredTypeWords.length > 0) {
        const typeLine = String(card?.type_line || '').toLowerCase();
        if (!requiredTypeWords.every((word: string) => typeLine.includes(String(word).toLowerCase()))) continue;
      }
      const mv = cardManaValue(card);
      if (typeof exactMV === 'number' && Number.isFinite(exactMV) && mv !== exactMV) continue;
      if (typeof minMV === 'number' && Number.isFinite(minMV) && mv < minMV) continue;
      if (typeof maxMV === 'number' && Number.isFinite(maxMV) && mv > maxMV) continue;
      results.push({
        id: String(card?.id || ''),
        name: String(card?.name || card?.id || 'Card'),
        typeLine: String(card?.type_line || ''),
        manaCost: String(card?.mana_cost || ''),
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        zoneOwnerId: String(ownerId),
      });
    }
  }
  return results.filter((entry) => Boolean(entry.id));
}

export function queueSelfEtbGraveyardTargetPrompt(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    triggerId: string;
    permanentId: string;
    sourceName: string;
    effectText: string;
    mandatory: boolean;
    requiresTarget: boolean;
    enrichedMetadata: ReturnType<typeof inferTriggeredAbilityTargetMetadata>;
  },
): void {
  try {
    const gameIdLocal = String((ctx as any).gameId || '').trim();
    const isReplayingLocal = !!(ctx as any).isReplaying;
    const requiresGraveyardTarget =
      gameIdLocal && gameIdLocal !== 'unknown' && !isReplayingLocal &&
      options.requiresTarget === true &&
      String((options.enrichedMetadata as any).targetZone || '').toLowerCase() === 'graveyard';
    if (!requiresGraveyardTarget) return;

    const validTargets = buildTriggeredAbilityGraveyardValidTargets(
      ctx,
      String(options.controller),
      options.enrichedMetadata,
    );
    if (validTargets.length === 0) return;

    const graveyardScope = String((options.enrichedMetadata as any).targetGraveyardScope || 'your').toLowerCase();
    const targetPlayerId = graveyardScope === 'your' ? String(options.controller) : '';
    const minTargets = typeof options.enrichedMetadata.minTargets === 'number' ? options.enrichedMetadata.minTargets : 1;
    const maxTargets = typeof options.enrichedMetadata.maxTargets === 'number' ? options.enrichedMetadata.maxTargets : 1;
    const targetAction = String((options.enrichedMetadata as any).targetAction || '').toLowerCase();
    // Cast-from-graveyard targets are chosen as the trigger resolves
    // (`tryDeferTriggeredAbilityTargetSelection`). Queuing here as well
    // leaves a second GRAVEYARD_SELECTION after the player picks.
    if (targetAction === 'cast') return;

    const targetDestination = String((options.enrichedMetadata as any).targetDestination || '').toLowerCase();
    const destination = targetDestination
      || (/\bexiles?\s+(?:up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?target\b/i.test(options.effectText)
        ? 'exile'
        : 'battlefield');
    const queueStep = ResolutionQueueManager.addStep(gameIdLocal, {
      type: ResolutionStepType.GRAVEYARD_SELECTION,
      playerId: options.controller as any,
      sourceId: options.triggerId,
      sourceName: options.sourceName,
      description: `${options.sourceName}: choose target card from a graveyard.`,
      mandatory: options.mandatory !== false,
      validTargets,
      minTargets,
      maxTargets,
      targetPlayerId,
      destination,
      destinationUsesSelectedCardOwner: options.enrichedMetadata.destinationUsesSelectedCardOwner === true,
      ...(options.enrichedMetadata.battlefieldControllerMode
        ? { battlefieldControllerMode: options.enrichedMetadata.battlefieldControllerMode }
        : null),
      ...(options.enrichedMetadata.battlefieldCounters
        ? { battlefieldCounters: options.enrichedMetadata.battlefieldCounters }
        : null),
      triggeredAbilityGraveyardChoice: true,
      triggerStackItemId: options.triggerId,
      triggeredAbilityEffectText: options.effectText,
      triggeredAbilitySourcePermanentId: options.permanentId,
      triggerSourcePermanentId: options.permanentId,
    } as any);
    appendQueuedResolutionPromptEvent(ctx, {
      playerId: String(options.controller),
      sourceId: options.triggerId,
      queuedResolutionStep: queueStep,
    });
    debug(2, `[queueSelfETBTriggersForPermanent] queued GRAVEYARD_SELECTION for ETB trigger ${options.sourceName} (${validTargets.length} valid targets)`);
  } catch (err) {
    debugWarn(1, '[queueSelfETBTriggersForPermanent] graveyard target selection wiring failed:', err);
  }
}
