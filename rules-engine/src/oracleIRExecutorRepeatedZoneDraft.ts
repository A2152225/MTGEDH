/**
 * Origin parent: oracleIRExecutorMainLoopLateSteps.ts
 * Cluster: repeated_zone_draft auto-resolution (Thieves' Auction style) plus
 * legal-to-return filtering for Auras that currently have no host.
 * Public entries: applyRepeatedZoneDraftStep, findExiledDraftCard,
 * isRepeatedZoneDraftPickLegal, filterLegalRepeatedZoneDraftCardIds,
 * resolveRepeatedZoneDraftAuraAttachId, findNextRepeatedZoneDraftChooserIndex,
 * buildRepeatedZoneDraftCardChoiceInfo, repeatedZoneDraftNeedsExplicitAttachId.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  auraEnterAttachmentId,
  findLegalAuraBattlefieldHostIds,
  findLegalAuraPlayerIds,
  isAuraCard,
  resolveAuraEnterAttachment,
} from './oracleIRExecutorAuraEnterAttachment';
import { moveTargetedCardFromExile } from './oracleIRExecutorZoneOps';

export type RepeatedZoneDraftApplyResult =
  | {
      readonly kind: 'applied';
      readonly state: GameState;
      readonly log: readonly string[];
      readonly lastMovedBattlefieldPermanentIds: readonly string[];
    }
  | {
      readonly kind: 'skipped';
      readonly message: string;
      readonly reason: 'player_choice_required';
      readonly options: {
        readonly classification: 'player_choice';
        readonly metadata: {
          readonly remainingCardIds: readonly string[];
          readonly chooserOrder: readonly string[];
          readonly entersTapped: boolean;
          readonly destination: string;
        };
      };
    };

export function isRepeatedZoneDraftAuraCard(card: any): boolean {
  return isAuraCard(card);
}

export function findExiledDraftCard(
  state: any,
  cardId: string,
): { card: any; ownerId: string } | null {
  const wanted = String(cardId || '').trim();
  if (!wanted) return null;

  for (const player of (Array.isArray(state?.players) ? state.players : []) as any[]) {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    const card = exile.find((entry: any) => String(entry?.id || '').trim() === wanted);
    if (card) {
      const ownerId = String(player?.id || '').trim();
      if (ownerId) return { card, ownerId };
    }
  }

  const zones = state?.zones;
  if (zones && typeof zones === 'object') {
    for (const [playerId, zone] of Object.entries(zones as Record<string, any>)) {
      const exile = Array.isArray(zone?.exile) ? zone.exile : [];
      const card = exile.find((entry: any) => String(entry?.id || '').trim() === wanted);
      if (card) {
        const ownerId = String(playerId || '').trim();
        if (ownerId) return { card, ownerId };
      }
    }
  }

  return null;
}

export function findLegalRepeatedZoneDraftAuraHostIds(
  state: any,
  card: any,
  chooserId: string,
): string[] {
  return findLegalAuraBattlefieldHostIds(state as GameState, card, chooserId as PlayerID);
}

export function isRepeatedZoneDraftPickLegal(
  state: any,
  cardId: string,
  chooserId: string,
): boolean {
  const found = findExiledDraftCard(state, cardId);
  if (!found) return false;
  if (!isRepeatedZoneDraftAuraCard(found.card)) return true;
  const attachment = resolveAuraEnterAttachment(state as GameState, found.card, chooserId as PlayerID);
  return attachment.kind !== 'illegal';
}

export function filterLegalRepeatedZoneDraftCardIds(
  state: any,
  cardIds: readonly string[],
  chooserId: string,
): string[] {
  return cardIds
    .map((id) => String(id || '').trim())
    .filter((id) => id && isRepeatedZoneDraftPickLegal(state, id, chooserId));
}

export function resolveRepeatedZoneDraftAuraAttachId(
  state: any,
  card: any,
  chooserId: string,
  preferredAttachId?: string,
): string | undefined {
  const attachment = resolveAuraEnterAttachment(state as GameState, card, chooserId as PlayerID, {
    preferredAttachId,
  });
  return auraEnterAttachmentId(attachment);
}

export function repeatedZoneDraftNeedsExplicitAttachId(
  state: any,
  cardId: string,
  chooserId: string,
): boolean {
  const info = buildRepeatedZoneDraftCardChoiceInfo(state, cardId, chooserId);
  return Boolean(info && info.attachOptions.length > 1);
}

export function buildRepeatedZoneDraftCardChoiceInfo(
  state: any,
  cardId: string,
  chooserId: string,
): {
  readonly id: string;
  readonly name: string;
  readonly imageUrl?: string;
  readonly legalHostIds: readonly string[];
  readonly legalPlayerIds: readonly string[];
  readonly attachOptions: readonly { id: string; name: string; imageUrl?: string }[];
} | null {
  const found = findExiledDraftCard(state, cardId);
  if (!found) return null;
  const card = found.card;
  const legalHostIds = findLegalAuraBattlefieldHostIds(state as GameState, card, chooserId as PlayerID);
  const legalPlayerIds = findLegalAuraPlayerIds(state as GameState, card, chooserId as PlayerID);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const hostOptions = legalHostIds.map((hostId) => {
    const host = battlefield.find((perm: any) => String(perm?.id || '').trim() === hostId);
    return {
      id: hostId,
      name: String(host?.card?.name || host?.name || hostId),
      imageUrl:
        typeof host?.card?.imageUrl === 'string'
          ? host.card.imageUrl
          : typeof host?.card?.image_uris?.normal === 'string'
            ? host.card.image_uris.normal
            : undefined,
    };
  });
  const playerOptions = legalPlayerIds.map((playerId) => {
    const player = ((state?.players || []) as any[]).find((entry: any) => String(entry?.id || '').trim() === playerId);
    return {
      id: playerId,
      name: String(player?.name || playerId),
    };
  });
  const imageUrl =
    typeof card?.imageUrl === 'string'
      ? card.imageUrl
      : typeof card?.image_uris?.normal === 'string'
        ? card.image_uris.normal
        : undefined;
  return {
    id: String(cardId || '').trim(),
    name: String(card?.name || 'Unknown card').trim() || 'Unknown card',
    ...(imageUrl ? { imageUrl } : {}),
    legalHostIds,
    legalPlayerIds,
    attachOptions: [...hostOptions, ...playerOptions],
  };
}

/** First chooser index at or after startIndex who has a legal pick, or null. */
export function findNextRepeatedZoneDraftChooserIndex(
  state: any,
  remainingCardIds: readonly string[],
  chooserOrder: readonly string[],
  startIndex: number,
): number | null {
  const order = chooserOrder.map((id) => String(id || '').trim()).filter(Boolean);
  if (order.length === 0) return null;
  const start = ((startIndex % order.length) + order.length) % order.length;
  for (let offset = 0; offset < order.length; offset += 1) {
    const index = (start + offset) % order.length;
    if (filterLegalRepeatedZoneDraftCardIds(state, remainingCardIds, order[index]).length > 0) {
      return index;
    }
  }
  return null;
}

export function applyRepeatedZoneDraftStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'repeated_zone_draft' }>,
  ctx: OracleIRExecutionContext,
  lastExiledCards: readonly any[] | undefined,
): RepeatedZoneDraftApplyResult {
  const draftPoolCards: any[] = Array.isArray(lastExiledCards) && lastExiledCards.length > 0
    ? [...lastExiledCards]
    : Array.isArray((ctx as any).lastMovedCards)
      ? [...(ctx as any).lastMovedCards]
      : [];

  const remainingCardIds = draftPoolCards
    .map((card) => String(card?.id || '').trim())
    .filter((id) => Boolean(id) && findExiledDraftCard(state, id) !== null);

  if (remainingCardIds.length === 0) {
    return {
      kind: 'applied',
      state,
      log: [`No cards remain to draft: ${step.raw}`],
      lastMovedBattlefieldPermanentIds: [],
    };
  }

  const controllerId = String(ctx.controllerId || '').trim();
  const startingPlayerId =
    step.whoStarts?.kind === 'you' ? controllerId : controllerId;
  const turnOrderIds = (Array.isArray((state as any).turnOrder) && (state as any).turnOrder.length > 0
    ? (state as any).turnOrder
    : (state.players || []).map((player: any) => player?.id)
  )
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean);
  const startIndex = Math.max(0, turnOrderIds.indexOf(startingPlayerId));
  const chooserOrder = turnOrderIds.length > 0
    ? [...turnOrderIds.slice(startIndex), ...turnOrderIds.slice(0, startIndex)]
    : [startingPlayerId];
  const entersTapped = step.entersTapped === true;

  if (ctx.interactivePlayerChoices === true) {
    const anyoneCanPick = chooserOrder.some((chooserId) =>
      filterLegalRepeatedZoneDraftCardIds(state, remainingCardIds, chooserId).length > 0
    );
    if (!anyoneCanPick) {
      return {
        kind: 'applied',
        state,
        log: [`No legally returnable cards remain to draft: ${step.raw}`],
        lastMovedBattlefieldPermanentIds: [],
      };
    }
    return {
      kind: 'skipped',
      message: `Skipped repeated zone draft (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          remainingCardIds,
          chooserOrder,
          entersTapped,
          destination: step.destination,
        },
      },
    };
  }

  let workingState = state;
  let remainingPool = [...remainingCardIds];
  let chooserIndex = 0;
  let consecutivePasses = 0;
  const draftLog: string[] = [];
  const draftedBattlefieldIds: string[] = [];
  const chooserCount = Math.max(1, chooserOrder.length);
  while (remainingPool.length > 0) {
    const chooserId = chooserOrder[chooserIndex % chooserCount] as PlayerID;
    chooserIndex += 1;
    const legalIds = filterLegalRepeatedZoneDraftCardIds(workingState, remainingPool, chooserId);
    if (legalIds.length === 0) {
      consecutivePasses += 1;
      if (consecutivePasses >= chooserCount) break;
      continue;
    }
    consecutivePasses = 0;

    const cardId = legalIds[0];
    remainingPool = remainingPool.filter((id) => id !== cardId);
    const found = findExiledDraftCard(workingState, cardId);
    if (!found) continue;
    const attachId = resolveRepeatedZoneDraftAuraAttachId(workingState, found.card, chooserId);
    const result = moveTargetedCardFromExile(
      workingState,
      found.ownerId as PlayerID,
      cardId,
      'any',
      'battlefield',
      chooserId,
      entersTapped,
      undefined,
      undefined,
      attachId,
    );
    if (result.kind !== 'applied') continue;
    workingState = result.state;
    draftLog.push(...(result.log || []));
    if (Array.isArray((result as any).movedPermanentIds)) {
      draftedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
    }
  }

  return {
    kind: 'applied',
    state: workingState,
    log:
      draftLog.length > 0
        ? draftLog
        : [`Drafted ${remainingCardIds.length} card(s) onto the battlefield: ${step.raw}`],
    lastMovedBattlefieldPermanentIds: draftedBattlefieldIds,
  };
}
