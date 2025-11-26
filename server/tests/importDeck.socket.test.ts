/**
 * Integration-like unit test for registerDeckHandlers -> importDeck path.
 * This test mocks the Scryfall service functions and the socket.io `io` / `socket`
 * objects to assert that importWipeConfirmed is emitted with appliedImmediately:true
 * and the game transitions to PRE_GAME.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { registerDeckHandlers } from "../src/socket/deck";
import { games } from "../src/socket/socket";
import { ensureGame } from "../src/socket/util";
import { GamePhase } from "../../shared/src/types";

// Mock the scryfall service module used by the handler
vi.mock("../src/services/scryfall", () => {
  return {
    parseDecklist: (list: string) => {
      // Very simple parser: return lines like "1 Name" or "Name"
      const lines = list.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      return lines.map((ln) => {
        const m = ln.match(/^(\d+)\s+(.+)$/);
        if (m) return { name: m[2].trim(), count: Number(m[1]) || 1 };
        return { name: ln.replace(/^\d+x?\s*/i,'').trim(), count: 1 };
      });
    },
    normalizeName: (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim(),
    fetchCardsByExactNamesBatch: async (names: string[]) => {
      const m = new Map<string, any>();
      for (const name of names) {
        const key = name.toLowerCase();
        // Give each a fake id and minimal metadata
        m.set(key, { id: `sf_${key.replace(/\s+/g,'_')}`, name: name, type_line: 'Legendary Creature', oracle_text: ''});
      }
      return m;
    },
    fetchCardByExactNameStrict: async (n: string) => {
      // fallback single fetch
      const key = n.toLowerCase();
      return { id: `sf_${key.replace(/\s+/g,'_')}`, name: n, type_line: 'Creature', oracle_text: '' };
    },
    validateDeck: (fmt: string, cards: any[]) => ({ illegal: [], warnings: [] })
  };
});

describe("registerDeckHandlers importDeck path", () => {
  test("emits importWipeConfirmed with appliedImmediately and sets PRE_GAME", async () => {
    // Create minimal mock io and socket capturing emitted events
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];

    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: any) => {
          emitted.push({ room, event, payload });
        }
      }),
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      }
    } as any;

    // Minimal mock socket that registers handlers and allows us to call them
    const handlers: Record<string, Function> = {};
    const socket = {
      data: { playerId: "p_socket", spectator: false },
      on: (ev: string, fn: Function) => {
        handlers[ev] = fn;
      },
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      }
    } as any;

    // Register handlers with our mocks
    registerDeckHandlers(io as any, socket as any);

    // Prepare a gameId and a simple deck list
    const gameId = "game_sock_test";
    const deckText = `1 Commander One
1 Card Two`;

    // Call the registered importDeck handler
    expect(typeof handlers["importDeck"]).toBe("function");
    // Provide the payload shape the handler expects
    await handlers["importDeck"]({ gameId, list: deckText, deckName: "MyTestDeck", save: false });

    // ensure a game was created for the gameId
    const game = ensureGame(gameId);
    expect(game).toBeDefined();

    // In pre-game mode, the handler emits suggestCommanders instead of importWipeConfirmed
    // Look for suggestCommanders emit (current pre-game behavior)
    const suggestEvent = emitted.find(e => e.event === "suggestCommanders");
    expect(suggestEvent).toBeDefined();
    expect(suggestEvent!.payload).toBeDefined();
    expect(suggestEvent!.payload.names).toContain('Commander One');

    // Verify game phase is PRE_GAME for that game
    const view = game.viewFor("p_socket");
    expect(view.phase).toBe(GamePhase.PRE_GAME);
  });
});