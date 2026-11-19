/**
 * Origin parent: aiAddOpponentToGame.ts, aiPregameHandlers.ts, aiRegisterHandlers.ts.
 *
 * Cluster: AI deck-text import. Planes, phenomena and schemes in the resolved list are stripped
 * from the library and seeded through the same helper the human import uses. A deck that matches
 * a catalog precon also loads that precon's stored planes and schemes.
 *
 * Public: importAIResolvedDeck.
 */
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import {
  commitImportedVariantDecks,
  splitResolvedDeckVariants,
} from '../../state/modules/variantDeckImportCommit.js';
import { resolveMatchedPreconVariantCards } from '../deck-handlers/deckImportVariantCards.js';

export type AIResolvedDeckImport = {
  /** Cards that went into the library (planes and schemes excluded). */
  libraryCount: number;
  /** Planar cards plus schemes that were handed to seeding (including ones the rules then ignored). */
  variantCount: number;
  messages: string[];
};

function emitVariantMessages(io: any, gameId: string, messages: string[]): void {
  if (!io || typeof io.to !== 'function' || messages.length === 0) return;
  const ts = Date.now();
  for (const message of messages) {
    try {
      io.to(gameId).emit('chat', {
        id: `m_${ts}_${Math.random().toString(36).slice(2, 8)}`,
        gameId,
        from: 'system',
        message,
        ts,
      });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Put the playable cards in the library and seed any planar / scheme cards.
 * `deckImportResolved` stores only the library cards. `importVariantDecks` stores the variant snapshot.
 */
export async function importAIResolvedDeck(args: {
  game: any;
  gameId: string;
  playerId: string;
  resolvedCards: any[];
  deckName?: string;
  logLabel: string;
  io?: any;
}): Promise<AIResolvedDeckImport> {
  const split = splitResolvedDeckVariants(args.resolvedCards);
  if (split.planar.length === 0 && split.schemes.length === 0) {
    try {
      const matched = await resolveMatchedPreconVariantCards(args.io, undefined, args.game, {
        gameId: args.gameId,
        playerId: args.playerId as any,
        deckName: args.deckName,
        cardNames: (args.resolvedCards || []).map((card: any) => String(card?.name || '')).filter(Boolean),
      });
      split.planar.push(...matched.planar);
      split.schemes.push(...matched.schemes);
    } catch (err) {
      debugWarn(1, `${args.logLabel} precon variant lookup failed`, err);
    }
  }
  const playable = split.playable;
  const game = args.game;
  const playerId = args.playerId;

  if (playable.length > 0) {
    if (typeof game?.importDeckResolved === 'function') {
      game.importDeckResolved(playerId, playable);
      try {
        await appendEvent(args.gameId, game.seq || 0, 'deckImportResolved', {
          playerId,
          cards: playable,
        });
        debug(1, `${args.logLabel} persisted deckImportResolved`, {
          playerId,
          cardCount: playable.length,
        });
      } catch (err) {
        debugWarn(1, `${args.logLabel} Failed to persist deckImportResolved event:`, err);
      }
    } else {
      debugWarn(2, `${args.logLabel} importDeckResolved not available, using fallback zone initialization`);
      game.state = game.state || {};
      game.state.zones = game.state.zones || {};
      game.state.zones[playerId] = {
        hand: [],
        handCount: 0,
        libraryCount: playable.length,
        graveyard: [],
        graveyardCount: 0,
      };
    }
  }

  let messages: string[] = [];
  if (split.planar.length > 0 || split.schemes.length > 0) {
    try {
      const committed = commitImportedVariantDecks(
        game,
        playerId,
        { planar: split.planar, schemes: split.schemes },
        { gameId: args.gameId },
      );
      messages = committed.messages;
      emitVariantMessages(args.io, args.gameId, messages);
      if (messages.length > 0) debug(1, `${args.logLabel} variant decks`, messages);
    } catch (err) {
      debugWarn(1, `${args.logLabel} seedVariantDecks failed`, err);
    }
  }

  return {
    libraryCount: playable.length,
    variantCount: split.planar.length + split.schemes.length,
    messages,
  };
}
