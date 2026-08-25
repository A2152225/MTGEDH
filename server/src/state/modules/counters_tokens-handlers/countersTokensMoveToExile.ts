// server/src/state/modules/counters_tokens-handlers/countersTokensMoveToExile.ts
// Origin parent: server/src/state/modules/counters_tokens.ts
// Cluster moved: movePermanentToExile.
// Public entry symbols: movePermanentToExile.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { buildZoneObjectWithRetainedCounters } from "../../../../../shared/src/zoneRetainedCounters.js";
import type { GameContext } from "../../context.js";
import { applyStateBasedActions } from "../../../rules-engine/index.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import { processLinkedExileReturns } from "../triggered-abilities.js";
import { queueExiledFromBattlefieldTriggers } from "../triggers/zone-change.js";
import { processLTBTriggers } from "../triggerEmissionFamilyUtils.js";
import { registerLinkedExile } from "../triggers/linked-exile.js";
import { inferCommanderExileFollowup } from "../commanderExileFollowup.js";
import {
  buildWarpedExileCardMarkers,
  permanentShouldExileAsWarped,
} from "../warpDelayedEffects.js";
import { getCountersTokensHandlerDeps } from "./countersTokensHandlerDeps.js";

function clearPreparedStateOnBattlefieldExit(state: any, permanent: any): void {
  getCountersTokensHandlerDeps().clearPreparedStateOnBattlefieldExit(state, permanent);
}

export function movePermanentToExile(
  ctx: GameContext,
  permanentId: string,
  options?: {
    exiledWithSourceId?: string;
    exiledWithOracleId?: string;
    exiledWithSourceName?: string;
    linkedExileData?: {
      exilingPermanentId: string;
      exilingPermanentName: string;
      originalOwner: string;
      originalController: string;
    };
    flickerReturnData?: {
      ownerId: string;
      cardId: string;
      returnAt: 'immediate' | 'next_end_step' | 'owners_next_end_step' | 'end_of_combat';
      sourceName?: string;
    };
  }
) {
  const { state, bumpSeq, commandZone } = ctx;
  const zones = state.zones = state.zones || {};
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx < 0) return;
  const perm = state.battlefield.splice(idx,1)[0];
  const removedPermanentId = String((perm as any)?.id || permanentId || '').trim();
  const owner = ((perm as any).owner || (perm as any).controller) as PlayerID;
  const controller = ((perm as any).controller || owner) as PlayerID;
  const card = perm.card as any;

  clearPreparedStateOnBattlefieldExit(state, perm);

  // Per-turn tracking for revolt-style conditions (a permanent left the battlefield)
  try {
    if (controller) {
      (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
      (state as any).permanentLeftBattlefieldThisTurn[String(controller)] = true;
    }
  } catch {
    // best-effort tracking only
  }

  // LTB triggers must fire for exile leaves too (self-LTB text, "whenever a permanent
  // leaves", and Oblivion Ring–style cards that get exiled themselves). Fire before
  // linked-exile returns so watchers see the leave without the returned permanent yet.
  try {
    processLTBTriggers(ctx, perm, { cause: 'exile' });
  } catch (err) {
    debugWarn(1, '[movePermanentToExile] processLTBTriggers failed:', err);
  }

  // Defensive: If we can't determine an owner/controller, don't write to zones[undefined].
  if (!owner) {
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    bumpSeq();
    return;
  }
  
  // Rule 111.7: A token that's in a zone other than the battlefield ceases to exist.
  // In this engine, we still record the token in exile for UI/test visibility.
  const isToken = (perm as any).isToken === true;
  if (isToken) {
    const z =
      zones[owner] ||
      (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] } as any);
    (z as any).exile = (z as any).exile || [];
    if (card) {
      (z as any).exile.push({
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
        isToken: true,
        zone: "exile",
      });
    }
    queueExiledFromBattlefieldTriggers(ctx, perm);
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    bumpSeq();
    return;
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into exile from anywhere, its owner may put it into
  // the command zone instead.
  // IMPORTANT: We must defer the zone change until the player chooses!
  const commanderInfo = commandZone?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  // Check if this is a commander - check both the card ID and the permanent's isCommander flag
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    const exileTag = {
      ...(options?.exiledWithSourceId ? { exiledWithSourceId: options.exiledWithSourceId } : {}),
      ...(options?.exiledWithOracleId ? { exiledWithOracleId: options.exiledWithOracleId } : {}),
      ...(options?.exiledWithSourceName ? { exiledWithSourceName: options.exiledWithSourceName } : {}),
    };

    const inferredFollowup = (!options?.linkedExileData && !options?.flickerReturnData)
      ? inferCommanderExileFollowup({
          state,
          destPermanent: perm,
          sourceId: options?.exiledWithSourceId,
          sourceName: options?.exiledWithSourceName,
        })
      : {};
    const linkedExileData = options?.linkedExileData || inferredFollowup.linkedExileData;
    const flickerReturnData = options?.flickerReturnData || inferredFollowup.flickerReturnData;
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: perm.id,
      sourceName: card.name,
      sourceImage: card.image_uris?.small || card.image_uris?.normal,
      description: `Your commander ${card.name} would be put into exile. Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: 'Let it be exiled' },
      ],
      commanderId: card.id,
      commanderName: card.name,
      fromZone: 'exile',
      exileTag,
      ...(linkedExileData ? { linkedExileData } : null),
      ...(flickerReturnData ? { flickerReturnData } : null),
      card: {
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
        ...(buildZoneObjectWithRetainedCounters(card, perm, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(card, perm, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[movePermanentToExile] Commander ${card.name} would go to exile - queued commander zone choice step`);

    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    
    bumpSeq();
    return; // Zone change deferred for commander - don't add to exile yet
  }
  
  // Move to exile zone (non-commander cards)
  const z = zones[owner] || (zones[owner] = { hand:[], handCount:0, libraryCount:0, graveyard:[], graveyardCount:0, exile:[] } as any);
  const exiledOnTurn = Number((state as any)?.turnNumber ?? (state as any)?.turn ?? 0) || 0;
  const warpedExileMarkers = permanentShouldExileAsWarped(perm)
    ? buildWarpedExileCardMarkers(String(owner), exiledOnTurn)
    : {};
  if (permanentShouldExileAsWarped(perm)) {
    (perm as any).exiledBecauseWarped = true;
    if ((perm as any).card && typeof (perm as any).card === 'object') {
      (perm as any).card.exiledBecauseWarped = true;
    }
  }
  const kc = {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    power: card.power,
    toughness: card.toughness,
    ...(options?.exiledWithSourceId ? { exiledWithSourceId: options.exiledWithSourceId } : {}),
    ...(options?.exiledWithOracleId ? { exiledWithOracleId: options.exiledWithOracleId } : {}),
    ...(options?.exiledWithSourceName ? { exiledWithSourceName: options.exiledWithSourceName } : {}),
    ...buildZoneObjectWithRetainedCounters(card, perm, 'exile'),
    ...warpedExileMarkers,
  };
  (z as any).exile = (z as any).exile || [];
  (z as any).exile.push(kc);
  queueExiledFromBattlefieldTriggers(ctx, perm);
  if (options?.linkedExileData?.exilingPermanentId && card) {
    registerLinkedExile(
      ctx,
      String(options.linkedExileData.exilingPermanentId),
      String(options.linkedExileData.exilingPermanentName || ''),
      card,
      String(options.linkedExileData.originalOwner || owner || ''),
      String(options.linkedExileData.originalController || controller || ''),
    );
  }
  if (removedPermanentId) {
    processLinkedExileReturns(ctx, removedPermanentId);
  }
  bumpSeq();
}
