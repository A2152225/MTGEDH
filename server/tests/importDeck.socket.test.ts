/**
 * Integration-like unit test for registerDeckHandlers -> importDeck path.
 * This test mocks the Scryfall service functions and the socket.io `io` / `socket`
 * objects to assert that importWipeConfirmed is emitted with appliedImmediately:true
 * when importing a deck mid-game.
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
  test("emits importWipeConfirmed with appliedImmediately when importing mid-game", async () => {
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
    const gameId = "game_sock_test_midgame";
    const deckText = `1 Commander One
1 Card Two`;

    // First ensure the game exists and set it to a mid-game phase
    const game = ensureGame(gameId);
    expect(game).toBeDefined();
    
    // Set to mid-game phase (not pre-game) to trigger importWipeConfirmed
    (game.state as any).phase = GamePhase.PRECOMBAT_MAIN;

    // Call the registered importDeck handler
    expect(typeof handlers["importDeck"]).toBe("function");
    await handlers["importDeck"]({ gameId, list: deckText, deckName: "MyTestDeck", save: false });

    // Look for an importWipeConfirmed emit (mid-game behavior)
    const matched = emitted.find(e => e.room === gameId && e.event === "importWipeConfirmed") || emitted.find(e => e.event === "importWipeConfirmed");
    expect(matched).toBeDefined();
    expect(matched!.payload).toBeDefined();
    expect(matched!.payload.appliedImmediately).toBe(true);

    // After mid-game import, phase should be reset to PRE_GAME
    const view = game.viewFor("p_socket");
    expect(view.phase).toBe(GamePhase.PRE_GAME);
  });
});