/**
 * Origin parent: oracleIRExecutorMoveZoneGuardsDiceBracketIt.ts /
 *   oracleIRExecutorMoveZoneGuardsTypedCardsRevealedThisWay.ts /
 *   oracleIRExecutorMoveZoneGuardsThatCardReference.ts
 * Cluster: interactive Warp World / Glimpse-family player choices that dry-run
 * auto-resolves (commander 903.9a, APNAP Aura-host announce, remainder any-order).
 * Public entries: trySkipCommanderLibraryChoice, trySkipEnchantmentWaveAuraAttach,
 * trySkipRevealedThisWayRestAnyOrder, collectRemainderCardSnapshots,
 * orderRestIdsForLibraryBottom,
 * preferredAuraAttachIdFromContext, parseWarpWorldSelectorMaps,
 * WARP_WORLD_CHOICE_COMMANDER / AURA / REMAINDER.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { StepSkipResult } from './oracleIRExecutorMoveZoneStepTypes';
import {
  findLegalAuraBattlefieldHostIds,
  findLegalAuraPlayerIds,
  isAuraCard,
  isPlayerEnchantingAura,
  readBoundZoneCard,
} from './oracleIRExecutorAuraEnterAttachment';
import {
  findBoundCardZoneLocation,
  ownerIdFromMovedCardSnapshots,
  readPlayerOrZoneCards,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { readPlayerZoneCards } from './oracleIRExecutorPlayerZoneAccess';
import { resolveRevealedThisWayCardPile } from './oracleIRLedgerCardAccess';
import { shuffleCardArray } from './oracleIRExecutorMoveZoneStepResultBuilders';

export const WARP_WORLD_CHOICE_COMMANDER = 'commander_library';
export const WARP_WORLD_CHOICE_AURA = 'aura_attach';
export const WARP_WORLD_CHOICE_REMAINDER = 'remainder_any_order';

export type CommanderLibraryChoice = 'command' | 'library';

export type WarpWorldCommanderPending = {
  readonly permanentId: string;
  readonly ownerId: string;
  readonly name: string;
};

export type WarpWorldAuraAttachPending = {
  readonly cardId: string;
  readonly ownerId: string;
  readonly chooserId: string;
  readonly name: string;
  readonly legalAttachIds: readonly string[];
  readonly isPlayerEnchanting: boolean;
};

export type WarpWorldRemainderPending = {
  readonly playerId: string;
  readonly cardIds: readonly string[];
};

function trimId(value: unknown): string {
  return String(value || '').trim();
}

export function parseStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = trimId(key);
    const mapped = trimId(value);
    if (!id || !mapped) continue;
    out[id] = mapped;
  }
  return out;
}

export function parseStringArrayRecord(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = trimId(key);
    if (!id || !Array.isArray(value)) continue;
    const ids = value.map((entry) => trimId(entry)).filter(Boolean);
    if (ids.length === 0) continue;
    out[id] = ids;
  }
  return out;
}

export function parseJsonRecord(raw: unknown): Record<string, string> {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseStringRecord(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return parseStringRecord(raw);
}

export function parseJsonArrayRecord(raw: unknown): Record<string, string[]> {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseStringArrayRecord(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return parseStringArrayRecord(raw);
}

export function parseWarpWorldSelectorMaps(ctx: OracleIRExecutionContext | undefined): {
  commanderLibraryChoices: Record<string, CommanderLibraryChoice>;
  auraAttachByCardId: Record<string, string>;
  libraryBottomOrderByPlayer: Record<string, string[]>;
} {
  const sel = ctx?.selectorContext;
  const commanderRaw = parseStringRecord(sel?.commanderLibraryChoices);
  const commanderLibraryChoices: Record<string, CommanderLibraryChoice> = {};
  for (const [id, value] of Object.entries(commanderRaw)) {
    if (value === 'library' || value === 'stay') commanderLibraryChoices[id] = 'library';
    else commanderLibraryChoices[id] = 'command';
  }
  return {
    commanderLibraryChoices,
    auraAttachByCardId: parseStringRecord(sel?.auraAttachByCardId),
    libraryBottomOrderByPlayer: parseStringArrayRecord(sel?.libraryBottomOrderByPlayer),
  };
}

export function resolveApnapPlayerIds(state: GameState, fallbackControllerId: string): string[] {
  const players = (state.players || [])
    .map((player: any) => trimId(player?.id))
    .filter(Boolean);
  const turnOrder = (
    Array.isArray((state as any).turnOrder) && (state as any).turnOrder.length > 0
      ? (state as any).turnOrder
      : players
  )
    .map((id: unknown) => trimId(id))
    .filter(Boolean);
  if (turnOrder.length === 0) {
    const fallback = trimId(fallbackControllerId);
    return fallback ? [fallback] : [];
  }
  const activeIndexRaw = Number((state as any).activePlayerIndex);
  const fallbackIndex = turnOrder.indexOf(trimId(fallbackControllerId));
  const start =
    Number.isFinite(activeIndexRaw) && activeIndexRaw >= 0 && activeIndexRaw < turnOrder.length
      ? Math.floor(activeIndexRaw)
      : fallbackIndex >= 0
        ? fallbackIndex
        : 0;
  return [...turnOrder.slice(start), ...turnOrder.slice(0, start)];
}

function apnapRank(order: readonly string[], playerId: string): number {
  const index = order.indexOf(playerId);
  return index >= 0 ? index : order.length;
}

export function isInteractivePlayerChoices(ctx: OracleIRExecutionContext | undefined): boolean {
  return ctx?.interactivePlayerChoices === true;
}

export function isOwnedCommanderPermanent(state: GameState, perm: any): boolean {
  if ((perm as any)?.isToken === true) return false;
  if ((perm as any)?.isCommander === true || (perm as any)?.card?.isCommander === true) return true;
  const ownerId = trimId((perm as any)?.owner || (perm as any)?.ownerId);
  const cardId = trimId((perm as any)?.card?.id);
  if (!ownerId || !cardId) return false;
  const info = (state as any)?.commandZone?.[ownerId];
  const ids = Array.isArray(info?.commanderIds) ? info.commanderIds : [];
  return ids.includes(cardId);
}

export function collectOwnedCommanderPermanents(
  state: GameState,
  playerIds: readonly string[],
): WarpWorldCommanderPending[] {
  const wantedOwners = new Set(playerIds.map((id) => trimId(id)).filter(Boolean));
  const found: WarpWorldCommanderPending[] = [];
  for (const perm of ((state.battlefield || []) as any[])) {
    const ownerId = trimId((perm as any)?.owner || (perm as any)?.ownerId);
    if (!wantedOwners.has(ownerId)) continue;
    if (!isOwnedCommanderPermanent(state, perm)) continue;
    const permanentId = trimId((perm as any)?.id);
    if (!permanentId) continue;
    found.push({
      permanentId,
      ownerId,
      name: String((perm as any)?.card?.name || (perm as any)?.name || 'Commander'),
    });
  }
  return found;
}

export function findPendingCommanderLibraryChoice(
  state: GameState,
  playerIds: readonly string[],
  choices: Readonly<Record<string, CommanderLibraryChoice>>,
  controllerId: string,
): WarpWorldCommanderPending | null {
  const apnap = resolveApnapPlayerIds(state, controllerId);
  const pending = collectOwnedCommanderPermanents(state, playerIds).filter(
    (entry) => !choices[entry.permanentId],
  );
  pending.sort((a, b) => {
    const ownerDiff = apnapRank(apnap, a.ownerId) - apnapRank(apnap, b.ownerId);
    if (ownerDiff !== 0) return ownerDiff;
    return a.permanentId.localeCompare(b.permanentId);
  });
  return pending[0] || null;
}

export function findPendingEnchantmentWaveAuraAttach(params: {
  readonly state: GameState;
  readonly matchingIds: readonly string[];
  readonly hostSnapshot: readonly any[];
  readonly controllerId: PlayerID;
  readonly ownerControlsMovedCards: boolean;
  readonly auraAttachByCardId: Readonly<Record<string, string>>;
}): WarpWorldAuraAttachPending | null {
  const {
    state,
    matchingIds,
    hostSnapshot,
    controllerId,
    ownerControlsMovedCards,
    auraAttachByCardId,
  } = params;
  const apnap = resolveApnapPlayerIds(state, String(controllerId));
  const pending: WarpWorldAuraAttachPending[] = [];
  for (const cardId of matchingIds) {
    if (auraAttachByCardId[cardId]) continue;
    const location = findBoundCardZoneLocation(state, cardId);
    if (!location) continue;
    const card = readBoundZoneCard(state, location.playerId, location.zone, cardId);
    if (!isAuraCard(card)) continue;
    const chooserId = ownerControlsMovedCards ? location.playerId : String(controllerId);
    const legalAttachIds = isPlayerEnchantingAura(card)
      ? findLegalAuraPlayerIds(state, card, chooserId as PlayerID)
      : findLegalAuraBattlefieldHostIds(state, card, chooserId as PlayerID, hostSnapshot);
    if (legalAttachIds.length <= 1) continue;
    pending.push({
      cardId,
      ownerId: location.playerId,
      chooserId,
      name: String(card?.name || card?.card?.name || 'Aura'),
      legalAttachIds,
      isPlayerEnchanting: isPlayerEnchantingAura(card),
    });
  }
  pending.sort((a, b) => {
    const ownerDiff = apnapRank(apnap, a.chooserId) - apnapRank(apnap, b.chooserId);
    if (ownerDiff !== 0) return ownerDiff;
    return a.cardId.localeCompare(b.cardId);
  });
  return pending[0] || null;
}

export function preferredAuraAttachIdFromContext(
  ctx: OracleIRExecutionContext | undefined,
  cardId: string,
): string | undefined {
  const mapped = trimId(parseWarpWorldSelectorMaps(ctx).auraAttachByCardId[cardId]);
  return mapped || undefined;
}

export function snapshotRemainderPromptCard(card: any, cardId: string): Record<string, unknown> {
  const wanted = trimId(cardId);
  const nested = card?.card && typeof card.card === 'object' ? card.card : null;
  return {
    id: wanted,
    name: String(card?.name || nested?.name || ''),
    type_line: card?.type_line || nested?.type_line,
    oracle_text: card?.oracle_text || nested?.oracle_text,
    image_uris: card?.image_uris || nested?.image_uris,
    imageUrl: card?.imageUrl || nested?.imageUrl,
    mana_cost: card?.mana_cost || nested?.mana_cost,
  };
}

function takeOwnerHint(ownerHints: any[] | undefined, cardId: string): string | undefined {
  const wanted = trimId(cardId);
  if (!wanted || !Array.isArray(ownerHints) || ownerHints.length === 0) {
    return ownerIdFromMovedCardSnapshots(ownerHints, wanted);
  }
  const hintIdx = ownerHints.findIndex((card) => trimId(card?.id) === wanted);
  if (hintIdx < 0) return ownerIdFromMovedCardSnapshots(ownerHints, wanted);
  const hint = ownerHints.splice(hintIdx, 1)[0];
  return trimId(hint?.owner || hint?.ownerId) || undefined;
}

export function collectRemainderCardSnapshots(
  state: GameState,
  cardIds: readonly string[],
  ownerHints?: readonly any[],
): Record<string, unknown>[] {
  const remainingHints = Array.isArray(ownerHints) ? [...ownerHints] : undefined;
  const snapshots: Record<string, unknown>[] = [];
  for (const cardId of cardIds) {
    const wanted = trimId(cardId);
    if (!wanted) continue;
    const location = findBoundCardZoneLocation(state, wanted, takeOwnerHint(remainingHints, wanted));
    let card: any;
    if (location) {
      const player = (state.players || []).find((entry: any) => trimId(entry?.id) === location.playerId) as any;
      const pile = readPlayerOrZoneCards(state, player, location.playerId as PlayerID, location.zone);
      card = pile.find((entry: any) => trimId(entry?.id) === wanted);
      if (!card && location.zone === 'library' && player) {
        card = readPlayerZoneCards(state, location.playerId as PlayerID, player, 'library')
          .find((entry: any) => trimId(entry?.id) === wanted);
      }
    }
    snapshots.push(card ? snapshotRemainderPromptCard(card, wanted) : { id: wanted });
  }
  return snapshots;
}

export function groupRestIdsByOwner(
  state: GameState,
  restIds: readonly string[],
  ownerHints?: readonly any[],
): { playerId: string; cardIds: string[] }[] {
  const remainingHints = Array.isArray(ownerHints) ? [...ownerHints] : undefined;
  const byOwner = new Map<string, string[]>();
  const ownerOrder: string[] = [];
  for (const cardId of restIds) {
    const location = findBoundCardZoneLocation(state, cardId, takeOwnerHint(remainingHints, cardId));
    if (!location || location.zone === 'hand') continue;
    const ownerId = trimId(location.playerId);
    if (!ownerId) continue;
    if (!byOwner.has(ownerId)) {
      byOwner.set(ownerId, []);
      ownerOrder.push(ownerId);
    }
    byOwner.get(ownerId)!.push(cardId);
  }
  return ownerOrder.map((playerId) => ({ playerId, cardIds: byOwner.get(playerId) || [] }));
}

export function findPendingRemainderAnyOrder(
  state: GameState,
  restIds: readonly string[],
  orderByPlayer: Readonly<Record<string, readonly string[]>>,
  controllerId: string,
  ownerHints?: readonly any[],
): WarpWorldRemainderPending | null {
  const apnap = resolveApnapPlayerIds(state, controllerId);
  const grouped = groupRestIdsByOwner(state, restIds, ownerHints)
    .filter((entry) => entry.cardIds.length > 1 && !orderByPlayer[entry.playerId])
    .sort((a, b) => apnapRank(apnap, a.playerId) - apnapRank(apnap, b.playerId));
  const first = grouped[0];
  return first ? { playerId: first.playerId, cardIds: first.cardIds } : null;
}

export function orderRestIdsForLibraryBottom(
  state: GameState,
  restIds: readonly string[],
  orderByPlayer: Readonly<Record<string, readonly string[]>>,
  stepOrder: 'random' | 'any' | undefined,
  ownerHints?: readonly any[],
): string[] {
  const grouped = groupRestIdsByOwner(state, restIds, ownerHints);
  const ordered: string[] = [];
  for (const group of grouped) {
    const supplied = (orderByPlayer[group.playerId] || [])
      .map((id) => trimId(id))
      .filter((id) => group.cardIds.includes(id));
    const remaining = group.cardIds.filter((id) => !supplied.includes(id));
    let playerOrder = [...supplied, ...remaining];
    if (stepOrder === 'random' && playerOrder.length > 1) {
      playerOrder = shuffleCardArray(playerOrder);
    }
    ordered.push(...playerOrder);
  }
  return ordered;
}

export function buildWarpWorldPlayerChoiceSkip(
  message: string,
  metadata: Record<string, string | number | boolean | null | readonly string[]>,
): StepSkipResult {
  return {
    applied: false,
    message,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      metadata,
    },
  };
}

export function trySkipCommanderLibraryChoice(params: {
  readonly state: GameState;
  readonly ctx: OracleIRExecutionContext;
  readonly playerIds: readonly string[];
  readonly stepRaw: string;
}): StepSkipResult | undefined {
  if (!isInteractivePlayerChoices(params.ctx)) return undefined;
  const maps = parseWarpWorldSelectorMaps(params.ctx);
  const pending = findPendingCommanderLibraryChoice(
    params.state,
    params.playerIds,
    maps.commanderLibraryChoices,
    String(params.ctx.controllerId || ''),
  );
  if (!pending) return undefined;
  return buildWarpWorldPlayerChoiceSkip(
    `Skipped owned-permanents shuffle (commander zone choice): ${params.stepRaw}`,
    {
      warpWorldChoice: WARP_WORLD_CHOICE_COMMANDER,
      pendingCommanderPermanentId: pending.permanentId,
      pendingCommanderPlayerId: pending.ownerId,
      pendingCommanderName: pending.name,
      commanderLibraryChoicesJson: JSON.stringify(maps.commanderLibraryChoices),
    },
  );
}

export function trySkipEnchantmentWaveAuraAttach(params: {
  readonly state: GameState;
  readonly ctx: OracleIRExecutionContext;
  readonly matchingIds: readonly string[];
  readonly hostSnapshot: readonly any[];
  readonly ownerControlsMovedCards: boolean;
  readonly stepRaw: string;
}): StepSkipResult | undefined {
  if (!isInteractivePlayerChoices(params.ctx)) return undefined;
  const maps = parseWarpWorldSelectorMaps(params.ctx);
  const pending = findPendingEnchantmentWaveAuraAttach({
    state: params.state,
    matchingIds: params.matchingIds,
    hostSnapshot: params.hostSnapshot,
    controllerId: params.ctx.controllerId,
    ownerControlsMovedCards: params.ownerControlsMovedCards,
    auraAttachByCardId: maps.auraAttachByCardId,
  });
  if (!pending) return undefined;
  return buildWarpWorldPlayerChoiceSkip(
    `Skipped enchantment wave (Aura attach announce): ${params.stepRaw}`,
    {
      warpWorldChoice: WARP_WORLD_CHOICE_AURA,
      pendingAuraCardId: pending.cardId,
      pendingAuraChooserId: pending.chooserId,
      pendingAuraName: pending.name,
      pendingAuraIsPlayerEnchanting: pending.isPlayerEnchanting,
      legalAttachIds: pending.legalAttachIds,
      auraAttachByCardIdJson: JSON.stringify(maps.auraAttachByCardId),
    },
  );
}

export function trySkipRevealedThisWayRestAnyOrder(params: {
  readonly state: GameState;
  readonly ctx: OracleIRExecutionContext;
  readonly restIds: readonly string[];
  readonly stepOrder: 'random' | 'any' | undefined;
  readonly stepRaw: string;
}): StepSkipResult | undefined {
  if (!isInteractivePlayerChoices(params.ctx)) return undefined;
  if (params.stepOrder === 'random') return undefined;
  const maps = parseWarpWorldSelectorMaps(params.ctx);
  const ownerHints = resolveRevealedThisWayCardPile(params.ctx);
  const pending = findPendingRemainderAnyOrder(
    params.state,
    params.restIds,
    maps.libraryBottomOrderByPlayer,
    String(params.ctx.controllerId || ''),
    ownerHints,
  );
  if (!pending) return undefined;
  const remainderCardsJson = JSON.stringify(
    collectRemainderCardSnapshots(params.state, pending.cardIds, ownerHints),
  );
  const allRemainderCardsJson = JSON.stringify(
    collectRemainderCardSnapshots(params.state, params.restIds, ownerHints),
  );
  return buildWarpWorldPlayerChoiceSkip(
    `Skipped revealed-this-way remainder (library bottom order): ${params.stepRaw}`,
    {
      warpWorldChoice: WARP_WORLD_CHOICE_REMAINDER,
      pendingRemainderPlayerId: pending.playerId,
      remainderCardIds: pending.cardIds,
      remainderCardsJson,
      allRemainderCardIds: params.restIds,
      allRemainderCardsJson,
      libraryBottomOrderByPlayerJson: JSON.stringify(maps.libraryBottomOrderByPlayer),
    },
  );
}
