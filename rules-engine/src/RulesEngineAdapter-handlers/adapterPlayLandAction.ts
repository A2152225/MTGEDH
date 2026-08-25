// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: playLandAction.
// Public entry symbols: playLandAction.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import {
  consumePlayableFromExileForCard,
  stripPlayableFromExileTags,
} from '../playableFromExile';
import {
  consumePlayableFromGraveyardForCard,
  stripPlayableFromGraveyardTags,
} from '../playableFromGraveyard';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterPlayLandActionHost = any;

  /**
   * Play a land (special action). Supports playing from hand, exile, graveyard, and library.
   */
export function playLandAction(this: AdapterPlayLandActionHost, gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const playerId = String(action.playerId || '');
    const cardId = String(action.cardId || '');
    const fromZone = String(action.fromZone || 'hand').toLowerCase();
    if (!playerId || !cardId) {
      return { next: state, log: ['Missing playerId or cardId'] };
    }

    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (playerIndex < 0) {
      return { next: state, log: ['Player not found'] };
    }

    const player: any = state.players[playerIndex] as any;
    const hand: any[] = Array.isArray(player.hand) ? [...player.hand] : [];
    const exile: any[] = Array.isArray(player.exile) ? [...player.exile] : [];
    const graveyard: any[] = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const library: any[] = Array.isArray(player.library) ? [...player.library] : [];

    let card: any | null = null;
    if (fromZone === 'hand') {
      const idx = hand.findIndex(c => String(c?.id || c?.cardId || '') === cardId);
      if (idx >= 0) {
        card = hand[idx];
        hand.splice(idx, 1);
      }
    } else if (fromZone === 'exile') {
      const idx = exile.findIndex(c => String(c?.id || c?.cardId || '') === cardId);
      if (idx >= 0) {
        card = exile[idx];
        exile.splice(idx, 1);
      }
    } else if (fromZone === 'graveyard') {
      const idx = graveyard.findIndex(c => String(c?.id || c?.cardId || '') === cardId);
      if (idx >= 0) {
        card = graveyard[idx];
        graveyard.splice(idx, 1);
      }
    } else if (fromZone === 'library') {
      if (library.length > 0 && String(library[0]?.id || library[0]?.cardId || '') === cardId) {
        card = library[0];
        library.shift();
      }
    }

    if (!card) {
      return { next: state, log: ['Card not found in origin zone'] };
    }

    const typeLineLower = String(card?.type_line || '').toLowerCase();
    if (!typeLineLower.includes('land')) {
      return { next: state, log: ['Card is not a land'] };
    }

    // Strip temporary play-permission markers when the card leaves a non-hand zone.
    const restCard =
      fromZone === 'graveyard'
        ? stripPlayableFromGraveyardTags(card)
        : fromZone === 'exile'
          ? stripPlayableFromExileTags(card)
          : card;
    const battlefieldPermanent: any = {
      id: cardId,
      controller: playerId,
      owner: playerId,
      tapped: false,
      enteredFromZone: fromZone,
      card: { ...(restCard as any), id: cardId, zone: 'battlefield', enteredFromZone: fromZone },
    };

    const updatedPlayers = state.players.map(p => {
      if (p.id !== playerId) return p;
      return {
        ...(p as any),
        hand,
        library,
        exile,
        graveyard,
      } as any;
    });

    const stateAny: any = { ...state, players: updatedPlayers, battlefield: [...(state.battlefield || []), battlefieldPermanent] };

    // Increment land plays this turn.
    const existingLandsPlayed: any = stateAny.landsPlayedThisTurn || {};
    const prev = Number(existingLandsPlayed[playerId] ?? 0) || 0;
    stateAny.landsPlayedThisTurn = { ...(existingLandsPlayed as any), [playerId]: prev + 1 };

    // Consume any playable-from-exile marker if we played from exile.
    if (fromZone === 'exile') {
      const consumed = consumePlayableFromExileForCard(stateAny as any, playerId, cardId) as any;
      stateAny.playableFromExile = (consumed as any).playableFromExile;
    } else if (fromZone === 'graveyard') {
      const consumed = consumePlayableFromGraveyardForCard(stateAny as any, playerId, cardId) as any;
      stateAny.playableFromGraveyard = (consumed as any).playableFromGraveyard;
    }

    // Emit a generic ETB/zone-change style event.
    this.emit({
      type: RulesEngineEvent.CARD_PUT_ONTO_BATTLEFIELD,
      timestamp: Date.now(),
      gameId,
      data: { playerId, cardId, fromZone },
    });

    return {
      next: stateAny as any,
      log: [`${playerId} played a land`],
    };
  }
