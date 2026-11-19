/**
 * Planechase / Archenemy cards that ship with a precon (e.g. the Doctor Who Commander decks:
 * 9 planes + 1 phenomenon each; Duskmourn Commander: 10 schemes).
 *
 * Origin parent: deckImportPreconDeckSocketHandlers.ts (importPreconDeck).
 * Cluster: resolve a precon's stored planar / scheme card names (preconDeckVariantCardStore) into
 * full card objects so `applyConfirmedImport` can seed the planar / scheme decks.
 *
 * Public entry symbols: resolvePreconVariantCards, resolveMatchedPreconVariantCards.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src";
import { resolveDeckList } from "../../services/deckImport.js";
import { matchCatalogPrecon } from "../../services/preconVariantDeckMatch.js";
import { getPreconVariantCards } from "../../services/preconDeckVariantCardStore.js";
import { partitionVariantCards } from "../../state/modules/variantDeckSeeding.js";
import { debugWarn } from "../../utils/debug.js";
import { createDeckResolutionStatusReporter } from "./deckImportResolutionSupport.js";

function roomNote(io: Server | undefined, gameId: string, message: string): void {
  if (!io || typeof io.to !== "function") return;
  io.to(gameId).emit("chat", { id: `m_${Date.now()}`, gameId, from: "system", message, ts: Date.now() });
}

/**
 * Resolves the precon's planes/phenomena (only when Planechase is on) and schemes (only when
 * Archenemy is on). When a mode is off the cards are skipped with a one-line room note instead of
 * being resolved, so a normal Commander game never pays for the extra lookups.
 */
export async function resolvePreconVariantCards(
  io: Server | undefined,
  socket: Socket | undefined,
  game: { state?: any },
  options: { gameId: string; playerId: PlayerID; setCode?: string; deckName: string },
): Promise<{ planar: any[]; schemes: any[] }> {
  const empty = { planar: [] as any[], schemes: [] as any[] };
  const { gameId, playerId, setCode, deckName } = options;
  if (!setCode) return empty;

  try {
    const stored = getPreconVariantCards(setCode, deckName);
    if (stored.planar.length === 0 && stored.schemes.length === 0) return empty;

    const rules = (game?.state as any)?.houseRules || {};
    const wanted: Array<{ name: string; count: number }> = [];

    if (stored.planar.length > 0) {
      if (rules.enablePlanechase === true) {
        wanted.push(...stored.planar.map((card) => ({ name: card.name, count: card.count })));
      } else {
        roomNote(
          io,
          gameId,
          `"${deckName}" includes ${stored.planar.length} planar card(s). Enable Planechase to use them.`,
        );
      }
    }
    if (stored.schemes.length > 0) {
      if (rules.enableArchenemy === true) {
        wanted.push(...stored.schemes.map((card) => ({ name: card.name, count: card.count })));
      } else {
        roomNote(
          io,
          gameId,
          `"${deckName}" includes ${stored.schemes.length} scheme card(s). Enable Archenemy to use them.`,
        );
      }
    }
    if (wanted.length === 0) return empty;

    const resolution = await resolveDeckList(wanted, {
      uniqueInstanceIds: true,
      ...(io
        ? {
            onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "importPreconDeck.variantCards", {
              playerId,
              slowFallbackNotice: "none",
            }),
          }
        : {}),
    });
    if (resolution.missing?.length) {
      roomNote(
        io,
        gameId,
        `Could not find ${resolution.missing.length} planar/scheme card(s): ${resolution.missing.join(", ")}.`,
      );
    }

    // Only variant cards survive; a stray playable card from a name collision is dropped.
    const { planar, schemes } = partitionVariantCards(resolution.resolvedCards);
    return { planar, schemes };
  } catch (err) {
    debugWarn(1, "resolvePreconVariantCards failed", err);
    return empty;
  }
}

/**
 * Planes and schemes that ship with a precon but are not in the 100-card list.
 * Used when a saved deck, pasted list, or AI deck matches a catalog precon and
 * the import did not already attach variant cards.
 */
export async function resolveMatchedPreconVariantCards(
  io: Server | undefined,
  socket: Socket | undefined,
  game: { state?: any },
  options: { gameId: string; playerId: PlayerID; deckName?: string; cardNames?: readonly string[]; setCode?: string },
): Promise<{ planar: any[]; schemes: any[] }> {
  const empty = { planar: [] as any[], schemes: [] as any[] };
  const explicitSet = String(options.setCode || '').trim();
  const explicitName = String(options.deckName || '').trim();
  const matched = explicitSet && explicitName
    ? { setCode: explicitSet, deckName: explicitName }
    : matchCatalogPrecon({ deckName: options.deckName, cardNames: options.cardNames });
  if (!matched) return empty;
  return resolvePreconVariantCards(io, socket, game, {
    gameId: options.gameId,
    playerId: options.playerId,
    setCode: matched.setCode,
    deckName: matched.deckName,
  });
}
