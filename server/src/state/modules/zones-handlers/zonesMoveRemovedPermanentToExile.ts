// server/src/state/modules/zones-handlers/zonesMoveRemovedPermanentToExile.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: moveRemovedPermanentToExile.
// Public entry symbols: moveRemovedPermanentToExile.

import type { KnownCardRef, PlayerID } from "../../../../../shared/src/types.js";
import { buildZoneObjectWithRetainedCounters } from "../../../../../shared/src/zoneRetainedCounters.js";
import type { GameContext } from "../../context.js";
import { debug } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import { processLinkedExileReturns } from "../triggers/linked-exile.js";
import { queueExiledFromBattlefieldTriggers } from "../triggers/zone-change.js";
import { repairCardIdAwayFromZones } from "../stackReplayUtils.js";

export function moveRemovedPermanentToExile(
  ctx: GameContext,
  permanent: any,
  removedPermanentId?: string,
  options?: {
    exiledWithSourceId?: string;
    exiledWithOracleId?: string;
    exiledWithSourceName?: string;
  },
): boolean {
  const { state, bumpSeq, commandZone } = ctx;
  const zones = state.zones = state.zones || {};
  const normalizedRemovedPermanentId = String(removedPermanentId || permanent?.id || '').trim();
  const owner = ((permanent as any)?.owner || (permanent as any)?.controller) as PlayerID;
  const zoneCard = ((permanent as any)?.isFaceDown === true && (permanent as any)?.faceUpCard)
    ? (permanent as any).faceUpCard
    : (permanent as any)?.card;
  const exileTag = {
    ...(String(options?.exiledWithSourceId || (permanent as any)?.leaveBattlefieldReplacementSourceId || '').trim()
      ? { exiledWithSourceId: String(options?.exiledWithSourceId || (permanent as any)?.leaveBattlefieldReplacementSourceId).trim() }
      : {}),
    ...(String(options?.exiledWithOracleId || (permanent as any)?.leaveBattlefieldReplacementOracleId || '').trim()
      ? { exiledWithOracleId: String(options?.exiledWithOracleId || (permanent as any)?.leaveBattlefieldReplacementOracleId).trim() }
      : {}),
    ...(String(options?.exiledWithSourceName || (permanent as any)?.leaveBattlefieldReplacementSourceName || '').trim()
      ? { exiledWithSourceName: String(options?.exiledWithSourceName || (permanent as any)?.leaveBattlefieldReplacementSourceName).trim() }
      : {}),
  };

  if (!owner) {
    if (normalizedRemovedPermanentId) {
      processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
    }
    bumpSeq();
    return true;
  }

  if ((permanent as any)?.isToken === true) {
    const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] } as any);
    z.exile = z.exile || [];
    if (zoneCard) {
      z.exile.push({
        id: zoneCard.id,
        name: zoneCard.name,
        type_line: zoneCard.type_line,
        oracle_text: zoneCard.oracle_text,
        image_uris: zoneCard.image_uris,
        mana_cost: zoneCard.mana_cost,
        power: zoneCard.power,
        toughness: zoneCard.toughness,
        isToken: true,
        zone: 'exile',
        ...exileTag,
      });
    }
    if (normalizedRemovedPermanentId) {
      processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
    }
    queueExiledFromBattlefieldTriggers(ctx, permanent);
    bumpSeq();
    return true;
  }

  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (zoneCard?.id && commanderIds.includes(zoneCard.id)) || (permanent as any)?.isCommander === true;

  if (isCommander && zoneCard) {
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: permanent.id,
      sourceName: zoneCard.name,
      sourceImage: zoneCard.image_uris?.small || zoneCard.image_uris?.normal,
      description: `Your commander ${zoneCard.name} would be put into exile. Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      commanderZoneFromBattlefield: true,
      commanderZoneOriginalPermanent: {
        id: permanent.id,
        controller: (permanent as any)?.controller || owner,
        owner,
        tapped: (permanent as any)?.tapped === true,
        counters: (permanent as any)?.counters && typeof (permanent as any).counters === 'object'
          ? { ...((permanent as any).counters as any) }
          : undefined,
        card: zoneCard ? {
          id: zoneCard.id,
          name: zoneCard.name,
          type_line: zoneCard.type_line,
          oracle_text: zoneCard.oracle_text,
          image_uris: zoneCard.image_uris,
          mana_cost: zoneCard.mana_cost,
          power: zoneCard.power,
          toughness: zoneCard.toughness,
        } : undefined,
      },
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: 'Let it be exiled' },
      ],
      commanderId: zoneCard.id,
      commanderName: zoneCard.name,
      fromZone: 'exile',
      exileTag,
      card: {
        id: zoneCard.id,
        name: zoneCard.name,
        type_line: zoneCard.type_line,
        oracle_text: zoneCard.oracle_text,
        image_uris: zoneCard.image_uris,
        mana_cost: zoneCard.mana_cost,
        power: zoneCard.power,
        toughness: zoneCard.toughness,
        ...(buildZoneObjectWithRetainedCounters(zoneCard, permanent, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(zoneCard, permanent, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[moveRemovedPermanentToExile] Commander ${zoneCard.name} would go to exile - queued commander zone choice step`);
    if (normalizedRemovedPermanentId) {
      processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
    }
    bumpSeq();
    return true;
  }

  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] } as any);
  const exiledCard = {
    id: zoneCard?.id,
    name: zoneCard?.name,
    type_line: zoneCard?.type_line,
    oracle_text: zoneCard?.oracle_text,
    image_uris: zoneCard?.image_uris,
    mana_cost: zoneCard?.mana_cost,
    power: zoneCard?.power,
    toughness: zoneCard?.toughness,
    ...exileTag,
    ...buildZoneObjectWithRetainedCounters(zoneCard, permanent, 'exile'),
  };
  z.exile = z.exile || [];
  z.exile.push(exiledCard);
  const exiledCardId = String(zoneCard?.id || exiledCard?.id || '').trim();
  if (exiledCardId && owner) {
    repairCardIdAwayFromZones(ctx, String(owner), exiledCardId, ['hand', 'graveyard', 'library']);
  }
  if (normalizedRemovedPermanentId) {
    processLinkedExileReturns(ctx, normalizedRemovedPermanentId);
  }
  queueExiledFromBattlefieldTriggers(ctx, permanent);
  bumpSeq();
  return true;
}
