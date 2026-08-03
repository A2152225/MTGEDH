/**
 * Would-enter replacement effects (lands + stack permanents).
 */

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepStatus, ResolutionStepType } from '../resolution/index.js';
import { debug } from '../../utils/debug.js';
import { sacrificePermanent } from './upkeep-triggers.js';
import { finishPlayLandBattlefieldEntry, type PlayLandEntryOptions } from './stackPlayLandUtils.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';

export const WOULD_ENTER_DISCARD_LAND_DECLINE_ID = 'decline_mox_diamond';

export interface LandWouldEnterSacrificeReplacement {
  sacrificeCount: number;
  requireUntapped: boolean;
}

export function parseLandWouldEnterSacrificeReplacement(oracleText: string): LandWouldEnterSacrificeReplacement | null {
  const match = String(oracleText || '').match(
    /if this land would enter(?: the battlefield)?,?\s*sacrifice\s+(two|three|four|\d+|a|an)\s+(untapped\s+)?lands?\s+instead/i,
  );
  if (!match) return null;

  const countWord = String(match[1] || '').toLowerCase();
  const sacrificeCount =
    countWord === 'two' ? 2
      : countWord === 'three' ? 3
        : countWord === 'four' ? 4
          : countWord === 'a' || countWord === 'an' ? 1
            : Math.max(1, parseInt(countWord, 10) || 1);

  return {
    sacrificeCount,
    requireUntapped: /\buntapped\b/i.test(String(match[0] || '')),
  };
}

export function parseLandWouldEnterNamedSacrificeReplacement(oracleText: string): boolean {
  return /if this land would enter,?\s*instead sacrifice each other permanent named .+? you control,?\s*then put this land onto the battlefield/i
    .test(String(oracleText || ''));
}

function normalizeCardNameForMatch(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function listOtherBattlefieldPermanentsNamed(
  state: any,
  playerId: string,
  cardName: string,
): string[] {
  const targetName = normalizeCardNameForMatch(cardName);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield
    .filter((perm: any) => {
      if (!perm || String(perm.controller || '') !== String(playerId)) return false;
      return normalizeCardNameForMatch(perm.card?.name) === targetName;
    })
    .map((perm: any) => String(perm.id));
}

export function getPendingLandWouldEnterStateKey(playerId: string): string {
  return `pendingLandWouldEnter_${String(playerId || '').trim()}`;
}

export function readPendingLandWouldEnter(
  state: unknown,
  playerId: string,
): {
  card: any;
  replacement: LandWouldEnterSacrificeReplacement;
  playedFromExile: boolean;
  playedFromGraveyard: boolean;
} | null {
  const pending = (state as any)?.[getPendingLandWouldEnterStateKey(playerId)];
  if (!pending?.card || !pending?.replacement) return null;
  return pending;
}

export function clearPendingLandWouldEnter(state: unknown, playerId: string): void {
  delete (state as any)?.[getPendingLandWouldEnterStateKey(playerId)];
}

function listEligibleSacrificeLands(
  state: any,
  playerId: string,
  replacement: LandWouldEnterSacrificeReplacement,
): Array<{ id: string; label: string }> {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield
    .filter((perm: any) => {
      if (!perm || String(perm.controller || '') !== String(playerId)) return false;
      const typeLine = String(perm.card?.type_line || '').toLowerCase();
      if (!/\bland\b/.test(typeLine)) return false;
      if (replacement.requireUntapped && perm.tapped) return false;
      return true;
    })
    .map((perm: any) => ({
      id: String(perm.id),
      label: `Sacrifice ${String(perm.card?.name || 'Land')}`,
    }));
}

/**
 * Defer land battlefield entry while the controller pays the would-enter sacrifice cost.
 */
export function tryDeferPlayLandForWouldEnterReplacement(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  opts: PlayLandEntryOptions = {},
): boolean {
  const replacement = parseLandWouldEnterSacrificeReplacement(String(card?.oracle_text || ''));
  if (!replacement) return false;

  const gameId = String(ctx.gameId || (ctx.state as any)?.id || '').trim();
  if (!gameId) return false;

  const landOptions = listEligibleSacrificeLands(ctx.state, playerId, replacement);
  const cardName = String(card?.name || 'Land');

  (ctx.state as any)[getPendingLandWouldEnterStateKey(playerId)] = {
    playerId,
    card: { ...card },
    replacement,
    playedFromExile: Boolean(opts.playedFromExile),
    playedFromGraveyard: Boolean(opts.playedFromGraveyard),
  };

  ctx.state.landsPlayedThisTurn = ctx.state.landsPlayedThisTurn || {};
  ctx.state.landsPlayedThisTurn[playerId] = (ctx.state.landsPlayedThisTurn[playerId] ?? 0) + 1;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    description:
      `${cardName} — sacrifice ${replacement.sacrificeCount}${replacement.requireUntapped ? ' untapped' : ''} land${replacement.sacrificeCount === 1 ? '' : 's'} to put it onto the battlefield, or put it into your graveyard`,
    mandatory: true,
    minSelections: 1,
    maxSelections: replacement.sacrificeCount,
    landWouldEnterSacrificeChoice: true,
    sacrificeCount: replacement.sacrificeCount,
    sourceName: cardName,
    sourceId: String(card?.id || ''),
    options: [
      ...landOptions,
      { id: 'decline_land_would_enter', label: `Put ${cardName} into your graveyard` },
    ],
  } as any);

  debug(2, `[landWouldEnter] Queued sacrifice choice for ${cardName} (${landOptions.length} eligible land(s))`);
  return true;
}

/**
 * Automatic would-enter replacement: sacrifice each other permanent with the same name, then enter.
 * Sheltered Valley pattern — no player choice.
 */
export function tryApplyLandWouldEnterNamedSacrificeReplacement(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  opts: PlayLandEntryOptions = {},
): boolean {
  if (!parseLandWouldEnterNamedSacrificeReplacement(String(card?.oracle_text || ''))) {
    return false;
  }

  const cardName = String(card?.name || '').trim();
  if (!cardName) return false;

  const sacrificeIds = listOtherBattlefieldPermanentsNamed(ctx.state, playerId, cardName);
  for (const permanentId of sacrificeIds) {
    sacrificePermanent(ctx, permanentId, playerId);
  }

  finishPlayLandBattlefieldEntry(ctx, playerId, card, {
    playedFromExile: opts.playedFromExile,
    playedFromGraveyard: opts.playedFromGraveyard,
  });

  debug(2, `[landWouldEnter] Applied named-sacrifice replacement for ${cardName} (sacrificed ${sacrificeIds.length})`);
  return true;
}

export function putPendingLandIntoGraveyard(ctx: GameContext, playerId: PlayerID, card: any): void {
  const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
  zones[playerId] = zones[playerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 };
  const playerZones = zones[playerId] as any;
  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
  playerZones.graveyard.push({ ...card, zone: 'graveyard' });
  playerZones.graveyardCount = playerZones.graveyard.length;
}

export function resolveLandWouldEnterSacrificeChoice(
  ctx: GameContext,
  playerId: PlayerID,
  selectionIds: string[],
  cancelled: boolean,
): boolean {
  const pending = readPendingLandWouldEnter(ctx.state, playerId);
  if (!pending) return false;

  const { card, replacement, playedFromExile, playedFromGraveyard } = pending;
  clearPendingLandWouldEnter(ctx.state, playerId);

  const declined = cancelled || selectionIds.includes('decline_land_would_enter');

  if (declined) {
    putPendingLandIntoGraveyard(ctx, playerId, card);
    ctx.bumpSeq();
    return true;
  }

  const uniqueSelections = Array.from(new Set(selectionIds.filter((id) => id !== 'decline_land_would_enter')));
  if (uniqueSelections.length !== replacement.sacrificeCount) {
    return false;
  }

  for (const permanentId of uniqueSelections) {
    sacrificePermanent(ctx, permanentId, playerId);
  }

  finishPlayLandBattlefieldEntry(ctx, playerId, card, {
    playedFromExile,
    playedFromGraveyard,
    skipLandPlayCountIncrement: true,
  });
  return true;
}

// --- Stack permanent: discard a land from hand instead (Mox Diamond pattern) ---

export function parseWouldEnterDiscardLandFromHandReplacement(oracleText: string): boolean {
  const oracle = String(oracleText || '').toLowerCase();
  if (!/\bdiscard a land card instead\b/.test(oracle)) return false;
  if (/\b(this artifact|this permanent)\s+would enter\b/.test(oracle)) return true;
  if (/\bwould enter(?: the battlefield)?\b/.test(oracle) && /\bartifact\b/.test(oracle)) return true;
  return /\bmox diamond\b/.test(oracle) && /\bwould enter\b/.test(oracle);
}

export function hasWouldEnterDiscardLandReplacement(card: any): boolean {
  return parseWouldEnterDiscardLandFromHandReplacement(String(card?.oracle_text || ''));
}

export function isLandCardForWouldEnterDiscard(card: any): boolean {
  if (!card) return false;
  const typeLine = String(card.type_line || '').toLowerCase();
  return /\bland\b/.test(typeLine);
}

export function buildWouldEnterDiscardLandHandOptions(
  hand: any[],
): Array<{ id: string; label: string; imageUrl?: string }> {
  return (Array.isArray(hand) ? hand : [])
    .filter((card: any) => isLandCardForWouldEnterDiscard(card))
    .map((card: any) => ({
      id: String(card.id),
      label: `Discard ${card.name || 'Land'}`,
      imageUrl: card.image_uris?.small || card.image_uris?.normal,
    }));
}

function findUnresolvedWouldEnterDiscardLandStep(gameId: string, stackItemId: string): any | undefined {
  const queue = ResolutionQueueManager.getQueue(gameId);
  return (queue?.steps || []).find((step: any) => {
    if (!step) return false;
    if (step.status !== ResolutionStepStatus.PENDING && step.status !== ResolutionStepStatus.ACTIVE) {
      return false;
    }
    if (step.moxDiamondChoice !== true) return false;
    return String(step.stackItemId || step.sourceId || '') === stackItemId;
  });
}

/**
 * Queue discard-land replacement while the spell remains on the stack.
 * Returns true when ETB should be deferred.
 */
export function queueWouldEnterDiscardLandChoiceForStackItem(ctx: GameContext, stackItem: any): boolean {
  const card = stackItem?.card;
  const controller = stackItem?.controller as PlayerID | undefined;
  const stackItemId = String(stackItem?.id || '').trim();

  if (!card || !controller || !stackItemId || !hasWouldEnterDiscardLandReplacement(card)) {
    return false;
  }

  const gameId = String(ctx.gameId || (ctx.state as any)?.id || '').trim();
  if (!gameId) return false;

  // Mark deferred even when a choice is already queued so later auto-pass / stack
  // resolve attempts treat the spell as waiting on the replacement, not unresolved.
  (stackItem as any).wouldEnterDiscardLandDeferred = true;

  // Dedup must see ACTIVE steps too — getStepsForPlayer only returns PENDING.
  if (findUnresolvedWouldEnterDiscardLandStep(gameId, stackItemId)) {
    return true;
  }

  const zones = (ctx.state as any)?.zones?.[controller];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  const landOptions = buildWouldEnterDiscardLandHandOptions(hand);
  const cardName = String(card.name || 'Permanent');

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller,
    description: `${cardName} — Discard a land to put it onto the battlefield, or decline to put it into the graveyard`,
    mandatory: true,
    sourceId: stackItemId,
    sourceName: cardName,
    options: [
      ...landOptions,
      {
        id: WOULD_ENTER_DISCARD_LAND_DECLINE_ID,
        label: `Don't discard (put ${cardName} into graveyard)`,
      },
    ],
    minSelections: 1,
    maxSelections: 1,
    moxDiamondChoice: true,
    stackItemId,
  } as any);

  debug(2, `[wouldEnter] Queued discard-land choice for ${cardName} (${landOptions.length} land option(s))`);
  return true;
}

export function tryQueueWouldEnterDiscardLandBeforeStackResolve(game: any): boolean {
  const stack = game?.state?.stack;
  if (!Array.isArray(stack) || stack.length === 0) return false;

  const topItem = stack[stack.length - 1];
  if (!topItem?.card || !topItem?.controller) return false;

  // Already deferred waiting on a discard-land choice — do not re-resolve.
  if ((topItem as any).wouldEnterDiscardLandDeferred === true) {
    const gameId = String(game.gameId || game.id || (game.state as any)?.id || '').trim();
    if (gameId && findUnresolvedWouldEnterDiscardLandStep(gameId, String(topItem.id || ''))) {
      return true;
    }
  }

  const ctx: GameContext = {
    gameId: String(game.gameId || game.id || (game.state as any)?.id || ''),
    state: game.state,
    bumpSeq: () => {
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
    },
  } as GameContext;

  return queueWouldEnterDiscardLandChoiceForStackItem(ctx, topItem);
}

/** Cancel leftover duplicate discard-land prompts for the same stack object. */
export function cancelSiblingWouldEnterDiscardLandSteps(
  gameId: string,
  stackItemId: string,
  exceptStepId?: string,
): void {
  const normalizedGameId = String(gameId || '').trim();
  const normalizedStackId = String(stackItemId || '').trim();
  if (!normalizedGameId || !normalizedStackId) return;

  const exceptId = String(exceptStepId || '').trim();
  const queue = ResolutionQueueManager.getQueue(normalizedGameId);
  const siblingIds = (queue?.steps || [])
    .filter((step: any) => {
      if (!step || step.moxDiamondChoice !== true) return false;
      if (exceptId && String(step.id || '') === exceptId) return false;
      return String(step.stackItemId || step.sourceId || '') === normalizedStackId;
    })
    .map((step: any) => String(step.id || ''))
    .filter(Boolean);

  for (const stepId of siblingIds) {
    ResolutionQueueManager.cancelStep(normalizedGameId, stepId);
  }
}

export type WouldEnterDiscardLandResolveResult =
  | { ok: true; discardedLandName: string | null; discardLandId: string | null; cardName: string }
  | { ok: false; errorCode: 'STACK_ITEM_NOT_FOUND' | 'LAND_NOT_IN_HAND' };

export function resolveWouldEnterDiscardLandChoice(
  ctx: GameContext,
  playerId: PlayerID,
  stackItemId: string,
  choiceId: string | null,
  cancelled: boolean,
): WouldEnterDiscardLandResolveResult {
  const stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
  const stackIndex = stack.findIndex(
    (item: any) => item && String(item.id) === String(stackItemId) && String(item.controller) === String(playerId),
  );
  if (stackIndex === -1) {
    return { ok: false, errorCode: 'STACK_ITEM_NOT_FOUND' };
  }

  const [stackItem] = stack.splice(stackIndex, 1);
  const spellCard = stackItem?.card;
  const cardName = String(spellCard?.name || 'Permanent');

  const normalized = String(choiceId || '').toLowerCase();
  const discardLandId = !cancelled && choiceId && normalized !== WOULD_ENTER_DISCARD_LAND_DECLINE_ID
    ? String(choiceId)
    : null;

  const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
  zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
  const playerZones = zones[playerId] as any;
  playerZones.hand = playerZones.hand || [];
  playerZones.graveyard = playerZones.graveyard || [];

  let discardedLandName: string | null = null;

  if (discardLandId) {
    const handIndex = (playerZones.hand as any[]).findIndex((card: any) => card && String(card.id) === String(discardLandId));
    const handCard = handIndex >= 0 ? (playerZones.hand as any[])[handIndex] : null;

    if (!handCard || !isLandCardForWouldEnterDiscard(handCard)) {
      return { ok: false, errorCode: 'LAND_NOT_IN_HAND' };
    }

    (playerZones.hand as any[]).splice(handIndex, 1);
    playerZones.handCount = (playerZones.hand as any[]).length;
    pushCardToPlayerGraveyardWithReplacements(ctx, String(playerId), handCard, playerZones.graveyard);
    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
    discardedLandName = String(handCard?.name || 'a land');

    ctx.state.battlefield = ctx.state.battlefield || [];
    ctx.state.battlefield.push({
      id: stackItemId,
      controller: playerId,
      owner: playerId,
      card: spellCard,
      tapped: false,
    } as any);
  }

  if (!discardedLandName) {
    pushCardToPlayerGraveyardWithReplacements(ctx, String(playerId), spellCard || {}, playerZones.graveyard);
    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
  }

  return {
    ok: true,
    discardedLandName,
    discardLandId: discardedLandName ? discardLandId : null,
    cardName,
  };
}
