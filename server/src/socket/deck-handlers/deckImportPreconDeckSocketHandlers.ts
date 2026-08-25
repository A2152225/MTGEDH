/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: the importPreconDeck socket handler inside registerDeckHandlers.
 *
 * Public entry symbols: registerImportPreconDeckHandler.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src";
import { COMMANDER_PRECONS } from "../../../../shared/src/precons";
import { getPreconWizardsAnnouncementUrl } from "../../data/preconWizardsUrls.js";
import { getPreconDecklistLines } from "../../services/bundledPreconDecklists.js";
import { resolveDeckList } from "../../services/deckImport.js";
import { fetchDeckFromMoxfield } from "../../services/scryfall";
import { fetchWizardsPreconDecklist } from "../../services/wizardsPreconDecklists.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util";
import { applyConfirmedImport } from "./deckApplyConfirmedImport.js";
import {
  addPendingInitialDrawFlag,
  cancelConfirmation,
  clearPlayerTransientZonesForImport,
} from "./deckImportConfirmHelpers.js";
import {
  isSocketInGameRoom,
  makeImportConfirmId,
  pendingImportConfirmations,
  type PendingConfirm,
} from "./deckImportConfirmState.js";
import {
  createDeckResolutionStatusReporter,
  MIN_PRECON_DECK_SIZE,
} from "./deckImportResolutionSupport.js";

export function registerImportPreconDeckHandler(io: Server, socket: Socket) {
  // importPreconDeck - import a preconstructed Commander deck
  socket.on(
    "importPreconDeck",
    async (payload?: {
      gameId?: string;
      commanders?: string[];
      deckName?: string;
      setName?: string;
      year?: number;
      cacheCards?: boolean;
      setCode?: string;
      colorIdentity?: string;
    }) => {
      const gameId = payload?.gameId;
      const commanders = payload?.commanders;
      const deckName = payload?.deckName;
      const setName = payload?.setName;
      const year = payload?.year;
      const cacheCards = payload?.cacheCards;
      const setCode = payload?.setCode;
      const colorIdentity = payload?.colorIdentity;
      try {
        debug(1, "[deck] importPreconDeck called", {
          gameId,
          deckName,
          setName,
          setCode,
          year,
          commanders,
          colorIdentity,
          playerId: socket.data.playerId,
        });

        if (!gameId || typeof gameId !== "string") {
          socket.emit("deckError", { gameId, message: "GameId required." });
          return;
        }

        if (!Array.isArray(commanders) || commanders.length === 0 || commanders.some((c) => typeof c !== "string" || !c.trim())) {
          socket.emit("deckError", { gameId, message: "Commander names required." });
          return;
        }

        if (!deckName || typeof deckName !== "string" || !deckName.trim()) {
          socket.emit("deckError", { gameId, message: "Deck name required." });
          return;
        }

        if (!setName || typeof setName !== "string" || !setName.trim()) {
          socket.emit("deckError", { gameId, message: "Set name required." });
          return;
        }

        if (typeof year !== "number" || !Number.isFinite(year)) {
          socket.emit("deckError", { gameId, message: "Year required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
          socket.emit("deckError", { gameId, message: "Not in game." });
          return;
        }

        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", {
            gameId,
            message: "Spectators cannot import decks.",
          });
          return;
        }

        const game = ensureGame(gameId);
        if (!game) {
          socket.emit("deckError", { gameId, message: "Game not found." });
          return;
        }

        const players = (game.state as any)?.players;
        const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
        if (!seated || seated.spectator || seated.isSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        // Find the precon data from our database
        let preconSetCode = setCode;
        let preconColorIdentity = colorIdentity;
        let preconDecklistUrl: string | undefined;
        
        // Look up the precon in our data to get decklistUrl and other info
        for (const yearData of COMMANDER_PRECONS) {
          if (yearData.year === year) {
            for (const set of yearData.sets) {
              if (set.name === setName || set.code === setCode) {
                if (!preconSetCode) preconSetCode = set.code;
                const deck = set.decks.find(d => d.name === deckName);
                if (deck) {
                  if (!preconColorIdentity) preconColorIdentity = deck.colorIdentity;
                  preconDecklistUrl = deck.decklistUrl;
                }
                break;
              }
            }
          }
        }

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `🔍 Fetching precon deck: "${deckName}" from ${setName} (${year})...`,
          ts: Date.now(),
        });

        // Resolve commanders (local lookup first, then Scryfall)
        const commanderResolution = await resolveDeckList(
          commanders.map((commanderName) => ({ name: commanderName, count: 1 })),
          {
            uniqueInstanceIds: true,
            onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "importPreconDeck.commanders", {
              playerId: pid,
              slowFallbackNotice: "room",
            }),
          },
        );
        const resolvedCommanders = commanderResolution.resolvedCards;

        if (resolvedCommanders.length === 0) {
          socket.emit("deckError", {
            gameId,
            message: `Could not find commanders for "${deckName}". Please import the deck manually.`,
          });
          return;
        }

        // Resolve mainboard: local precon SQLite first, optional live Wizards/Moxfield fallback.
        let resolvedCards: any[] = [...resolvedCommanders];
        let fetchedFullDeck = false;
        const allowLivePreconFetch = process.env.PRECON_ALLOW_LIVE_FETCH === '1';
        const commanderNamesSet = new Set(
          resolvedCommanders.map((card) => String(card?.name || '').trim().toLowerCase()).filter(Boolean),
        );

        const applyPreconMainboardLines = async (
          lines: Array<{ name: string; count?: number }>,
          sourceLabel: string,
          statusKey: string,
        ) => {
          const entries = lines
            .filter((line) => !commanderNamesSet.has(String(line.name || '').trim().toLowerCase()))
            .map((line) => ({ name: line.name, count: line.count || 1 }));
          if (entries.length === 0) return false;

          const resolution = await resolveDeckList(entries, {
            uniqueInstanceIds: true,
            onStatus: createDeckResolutionStatusReporter(io, socket, gameId, statusKey, {
              playerId: pid,
              slowFallbackNotice: "room",
            }),
          });

          resolvedCards = [...resolvedCommanders, ...resolution.resolvedCards];
          fetchedFullDeck = resolvedCards.length >= MIN_PRECON_DECK_SIZE;
          debug(1, `[deck] importPreconDeck loaded mainboard from ${sourceLabel}`, {
            gameId,
            deckName,
            cardCount: resolvedCards.length,
            missing: resolution.missing?.length ?? 0,
            fetchedFullDeck,
          });
          return fetchedFullDeck;
        };

        if (preconSetCode) {
          const localLines = getPreconDecklistLines(preconSetCode, deckName);
          if (localLines && localLines.length > 0) {
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `📦 Loading precon decklist for "${deckName}" (${preconSetCode}) from local database...`,
              ts: Date.now(),
            });
            await applyPreconMainboardLines(localLines, 'local precon database', 'importPreconDeck.local');
          }
        }

        if (!fetchedFullDeck && allowLivePreconFetch && preconSetCode) {
          const wizardsUrl = getPreconWizardsAnnouncementUrl(preconSetCode);
          if (wizardsUrl) {
            try {
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `📦 Fetching official decklist from Wizards...`,
                ts: Date.now(),
              });
              const wizardsLines = await fetchWizardsPreconDecklist(preconSetCode, deckName, wizardsUrl);
              if (wizardsLines && wizardsLines.length > 0) {
                await applyPreconMainboardLines(wizardsLines, 'Wizards announcement', 'importPreconDeck.wizards');
              }
            } catch (e) {
              debugWarn(1, "importPreconDeck: failed to fetch from Wizards, trying Moxfield next", e);
            }
          }
        }

        if (!fetchedFullDeck && allowLivePreconFetch && preconDecklistUrl) {
          try {
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `📦 Fetching decklist from Moxfield...`,
              ts: Date.now(),
            });

            const moxfieldDeck = await fetchDeckFromMoxfield(preconDecklistUrl);

            if (moxfieldDeck && moxfieldDeck.cards && moxfieldDeck.cards.length > 0) {
              await applyPreconMainboardLines(
                moxfieldDeck.cards,
                'Moxfield',
                'importPreconDeck.moxfield',
              );
              debug(1, "[deck] importPreconDeck fetched cards from Moxfield", {
                gameId,
                deckName,
                moxfieldUrl: preconDecklistUrl,
                cardCount: resolvedCards.length,
              });
            }
          } catch (e) {
            debugWarn(1, "importPreconDeck: failed to fetch from Moxfield", e);
          }
        }

        // Note: We no longer use fetchCardsFromSetByColorIdentity as a fallback because
        // it returns ALL cards from the set matching the color identity, not the actual
        // precon deck cards. This resulted in importing wrong cards from other precons.
        // If Moxfield fetch fails, users should import manually.

        // Truncate to 100 cards if we have more (Commander format deck size limit)
        const MAX_COMMANDER_DECK_SIZE = 100;
        if (resolvedCards.length > MAX_COMMANDER_DECK_SIZE) {
          const originalCount = resolvedCards.length;
          resolvedCards = resolvedCards.slice(0, MAX_COMMANDER_DECK_SIZE);
          debug(1, "[deck] importPreconDeck truncated deck from", originalCount, "to", resolvedCards.length, "cards");
        }

        // Emit status message
        const commanderNames = resolvedCommanders.map(c => c.name).join(', ');
        if (fetchedFullDeck) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `✅ Imported ${resolvedCards.length} cards for "${deckName}" (Commanders: ${commanderNames})`,
            ts: Date.now(),
          });
        } else {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `✅ Found commanders: ${commanderNames}. Full decklist not in local precon database (${preconSetCode || 'unknown set'}). Run \`npm run precon:bake\` on the server, or paste the decklist manually.`,
            ts: Date.now(),
          });
        }

        // Store the imported deck
        try {
          (game as any)._lastImportedDecks =
            (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
          (game as any)._lastImportedDecks.set(pid, resolvedCards);
        } catch (e) {
          debugWarn(2, "importPreconDeck: could not set _lastImportedDecks", e);
        }

        // If we got a full deck, apply it like a normal import
        if (fetchedFullDeck && resolvedCards.length >= MIN_PRECON_DECK_SIZE) {
          const rawPhase = (game.state && (game.state as any).phase) ?? "";
          const phaseStr = String(rawPhase).toUpperCase().trim();
          const seqVal =
            typeof (game as any).seq === "number" ? (game as any).seq : null;
          const isPreGame =
            phaseStr === "" ||
            phaseStr.includes("PRE") ||
            phaseStr.includes("BEGIN") ||
            seqVal === 0 ||
            seqVal === null;

          if (isPreGame) {
            const confirmId = makeImportConfirmId(gameId);
            const pending: PendingConfirm = {
              gameId,
              initiator: pid,
              resolvedCards,
              parsedCount: resolvedCards.length,
              deckName: `${deckName} (${setName} ${year})`,
              save: false,
              responses: { [pid]: "yes" },
              timeout: null,
              snapshotZones:
                game.state &&
                (game.state as any).zones &&
                (game.state as any).zones[pid]
                  ? JSON.parse(
                      JSON.stringify((game.state as any).zones[pid])
                    )
                  : null,
              snapshotCommandZone:
                game.state &&
                (game.state as any).commandZone &&
                (game.state as any).commandZone[pid]
                  ? JSON.parse(
                      JSON.stringify(
                        (game.state as any).commandZone[pid]
                      )
                    )
                  : null,
              snapshotPhase:
                game.state && (game.state as any).phase !== undefined
                  ? (game.state as any).phase
                  : null,
              applyImporterOnly: true,
            };
            pendingImportConfirmations.set(confirmId, pending);

            try {
              clearPlayerTransientZonesForImport(game, pid);
              addPendingInitialDrawFlag(game, pid);
              try {
                broadcastGame(io, game, gameId);
              } catch {
                /* best-effort */
              }
            } catch (e) {
              debugWarn(1, 
                "importPreconDeck (pre-game): clearing transient zones/flags failed",
                e
              );
            }

            // Emit suggest commanders to the player
            socket.emit("suggestCommanders", {
              gameId,
              names: commanders,
            });

            setTimeout(() => {
              applyConfirmedImport(io, confirmId, socket).catch((err) => {
                debugError(1, "importPreconDeck applyConfirmedImport failed:", err);
                cancelConfirmation(io, confirmId, "apply_failed");
              });
            }, 200);
            
            return;
          }
        }

        if (!fetchedFullDeck || resolvedCards.length < MIN_PRECON_DECK_SIZE) {
          socket.emit("deckError", {
            gameId,
            message: `Could not load the full "${deckName}" deck automatically. Open Deck Manager → Local and paste a decklist, or try Import from URL.`,
          });
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `⚠️ "${deckName}" did not fully import (only ${resolvedCards.length} card(s) resolved). Paste the decklist manually to continue.`,
            ts: Date.now(),
          });
          return;
        }

        // Emit suggest commanders to the player
        socket.emit("suggestCommanders", {
          gameId,
          names: commanders,
        });

        // Emit the resolved cards as deck candidates
        socket.emit("importedDeckCandidates", {
          gameId,
          candidates: resolvedCards,
        });

        // Also emit info about where to get the full decklist
        socket.emit("preconDeckInfo", {
          gameId,
          deckName,
          setName,
          year,
          commanders: resolvedCommanders,
          cardCount: resolvedCards.length,
          fetchedFullDeck,
          message: fetchedFullDeck 
            ? `Imported ${resolvedCards.length} cards for "${deckName}".`
            : `To import the full "${deckName}" deck, visit Moxfield or EDHREC and paste the decklist in the Local tab.`,
          urls: {
            moxfield: `https://www.moxfield.com/search?q=${encodeURIComponent(deckName + ' ' + setName)}`,
            edhrec: `https://edhrec.com/precon/${encodeURIComponent(deckName.toLowerCase().replace(/\s+/g, '-'))}`,
          }
        });

      } catch (err) {
        debugError(1, "importPreconDeck handler failed:", err);
        socket.emit("deckError", {
          gameId,
          message: "Failed to import precon deck.",
        });
      }
    }
  );
}
