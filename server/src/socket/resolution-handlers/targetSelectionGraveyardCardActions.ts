/**
 * socket/resolution-handlers/targetSelectionGraveyardCardActions.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the graveyard half of the `step.action` immediate-action chain -
 * move_graveyard_card_to_hand, move_graveyard_card_to_battlefield (creature/planeswalker entry with
 * summoning sickness and loyalty), and exile_graveyard_card (searches every player's graveyard).
 * Public entry symbols: tryHandleTargetSelectionGraveyardCardAction.
 *
 * Every branch in the original chain returned, so the dispatcher returns true when it matched an
 * action and the caller must stop.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { recordCardLeftGraveyardThisTurn } from "../../state/modules/turn-tracking.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { parsePT, uid } from "../../state/utils.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { broadcastGame, getPlayerName } from "../util.js";

/** Immediate graveyard-card actions for a TARGET_SELECTION step; true when the action was handled. */
export function tryHandleTargetSelectionGraveyardCardAction(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): boolean {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const action = (step as any).action;

  if (action === 'move_graveyard_card_to_hand') {
    const selectedCardId = selections[0];
    const fromPlayerId = String((step as any).fromPlayerId || pid);
    const zones = game.state?.zones || (game.state.zones = {});
    zones[fromPlayerId] = zones[fromPlayerId] || {};
    zones[fromPlayerId].graveyard = zones[fromPlayerId].graveyard || [];
    zones[fromPlayerId].hand = zones[fromPlayerId].hand || [];

    if (!selectedCardId) {
      // "up to one" selection
      debug(2, `[Resolution] move_graveyard_card_to_hand: no selection`);
      return true;
    }

    const gy: any[] = zones[fromPlayerId].graveyard;
    const idx = gy.findIndex((c: any) => c?.id === selectedCardId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] move_graveyard_card_to_hand: card not found in graveyard: ${selectedCardId}`);
      return true;
    }

    const [card] = gy.splice(idx, 1);
    recordCardLeftGraveyardThisTurn({ state: game.state } as any, fromPlayerId, card);
    zones[fromPlayerId].hand.push({ ...card, zone: 'hand' });

    zones[fromPlayerId].graveyardCount = zones[fromPlayerId].graveyard.length;
    zones[fromPlayerId].handCount = zones[fromPlayerId].hand.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, fromPlayerId)} returns ${card?.name || 'a card'} from their graveyard to their hand (${step.sourceName || 'Effect'}).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (action === 'move_graveyard_card_to_battlefield') {
    const selectedCardId = selections[0];
    const fromPlayerId = String((step as any).fromPlayerId || pid);
    const zones = game.state?.zones || (game.state.zones = {});
    zones[fromPlayerId] = zones[fromPlayerId] || {};
    zones[fromPlayerId].graveyard = zones[fromPlayerId].graveyard || [];

    if (!selectedCardId) {
      debugWarn(1, `[Resolution] move_graveyard_card_to_battlefield: missing selection`);
      return true;
    }

    const gy: any[] = zones[fromPlayerId].graveyard;
    const idx = gy.findIndex((c: any) => c?.id === selectedCardId);
    if (idx === -1) {
      debugWarn(1, `[Resolution] move_graveyard_card_to_battlefield: card not found in graveyard: ${selectedCardId}`);
      return true;
    }

    const [card] = gy.splice(idx, 1);
    zones[fromPlayerId].graveyardCount = zones[fromPlayerId].graveyard.length;

    const battlefield = (game.state.battlefield = game.state.battlefield || []);
    const tl = String(card?.type_line || '').toLowerCase();
    const isCreature = tl.includes('creature');
    const isPlaneswalker = tl.includes('planeswalker');

    const hasHaste =
      String(card?.oracle_text || '').toLowerCase().includes('haste') ||
      (Array.isArray(card?.keywords) && card.keywords.some((k: any) => String(k || '').toLowerCase() === 'haste'));

    const newPermanent: any = {
      id: uid('perm'),
      controller: pid,
      owner: fromPlayerId,
      tapped: false,
      counters: {},
      basePower: isCreature ? parsePT(card?.power) : undefined,
      baseToughness: isCreature ? parsePT(card?.toughness) : undefined,
      summoningSickness: isCreature && !hasHaste,
      card: { ...card, zone: 'battlefield' },
    };

    if (isPlaneswalker && card?.loyalty) {
      const loyaltyValue = parseInt(String(card.loyalty), 10);
      if (!Number.isNaN(loyaltyValue)) {
        newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
        newPermanent.loyalty = loyaltyValue;
        newPermanent.baseLoyalty = loyaltyValue;
      }
    }

    battlefield.push(newPermanent);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} returns ${card?.name || 'a card'} from their graveyard to the battlefield (${step.sourceName || 'Effect'}).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (action === 'exile_graveyard_card') {
    const selectedCardId = selections[0];
    const zones = game.state?.zones || (game.state.zones = {});

    if (!selectedCardId) {
      debugWarn(1, `[Resolution] exile_graveyard_card: missing selection`);
      return true;
    }

    let foundOwner: string | null = null;
    let foundCard: any = null;

    for (const playerId of Object.keys(zones)) {
      const gy: any[] = zones[playerId]?.graveyard || [];
      const idx = gy.findIndex((c: any) => c?.id === selectedCardId);
      if (idx !== -1) {
        foundOwner = playerId;
        foundCard = gy.splice(idx, 1)[0];
        zones[playerId].graveyardCount = zones[playerId].graveyard.length;
        break;
      }
    }

    if (!foundOwner || !foundCard) {
      debugWarn(1, `[Resolution] exile_graveyard_card: card not found in any graveyard: ${selectedCardId}`);
      return true;
    }

    zones[foundOwner].exile = zones[foundOwner].exile || [];
    zones[foundOwner].exile.push({ ...foundCard, zone: 'exile' });
    zones[foundOwner].exileCount = zones[foundOwner].exile.length;

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} exiles ${foundCard?.name || 'a card'} from ${getPlayerName(game, foundOwner)}'s graveyard (${step.sourceName || 'Effect'}).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  return false;
}
