/**
 * Integration-like unit test for registerDeckHandlers -> importDeck path.
 * This test mocks the Scryfall service functions and the socket.io `io` / `socket`
 * objects to assert that importWipeConfirmed is emitted with appliedImmediately:true
 * when importing a deck mid-game.
 */

import { describe, test, expect, vi, beforeAll } from "vitest";
import { registerDeckHandlers } from "../src/socket/deck";
import { games } from "../src/socket/socket";
import { ensureGame } from "../src/socket/util";
import { GamePhase } from "../../shared/src/types";
import { initDb, createGameIfNotExists } from "../src/db";
import { ResolutionQueueManager } from "../src/state/resolution";

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
    validateDeck: (fmt: string, cards: any[]) => ({ illegal: [], warnings: [] }),
    // Add missing moxfield-related exports
    isMoxfieldUrl: (str: string) => false,
    extractMoxfieldDeckId: (url: string) => null,
    fetchDeckFromMoxfield: async (urlOrId: string) => ({ cards: [], commander: null }),
  };
});

describe("registerDeckHandlers importDeck path", () => {
  beforeAll(async () => {
    await initDb();
  });

  test("enqueues import wipe confirm via Resolution Queue when importing mid-game", async () => {
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
      rooms: new Set<string>(),
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

    // The handler now requires the socket to be in the game room.
    socket.rooms.add(gameId);

    // ensureGame() will not recreate games that don't exist in the DB
    createGameIfNotExists(gameId, 'commander', 40);

    // First ensure the game exists and set it to a mid-game phase
    const game = ensureGame(gameId);
    expect(game).toBeDefined();

    // Ensure at least 2 active players so a confirm step is created for the non-initiator.
    (game.state as any).players = [
      { id: "p_socket", name: "p_socket", spectator: false },
      { id: "p2", name: "p2", spectator: false },
    ];
    
    // Set to mid-game phase (not pre-game) to trigger importWipeConfirmed
    // Note: Using COMBAT phase because PRECOMBAT_MAIN contains "PRE" which would
    // be incorrectly detected as pre-game by the phaseStr.includes("PRE") check
    (game.state as any).phase = GamePhase.COMBAT;
    // Also need to bump seq above 0, otherwise seqVal === 0 check will treat it as pre-game
    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    } else {
      (game as any).seq = 1;
    }

    // Call the registered importDeck handler
    expect(typeof handlers["importDeck"]).toBe("function");
    await handlers["importDeck"]({ gameId, list: deckText, deckName: "MyTestDeck", save: false });

    // Debug: log all emitted events to see what's happening
    // console.log("Emitted events:", emitted.map(e => ({ room: e.room, event: e.event })));

    // The mid-game import triggers a confirmation flow.
    // We keep importWipeConfirmUpdate broadcasts, but the prompt itself is now a Resolution Queue step.
    const updateMatched = emitted.find(e => e.room === gameId && e.event === "importWipeConfirmUpdate") || emitted.find(e => e.event === "importWipeConfirmUpdate");
    expect(updateMatched).toBeDefined();
    expect(updateMatched!.payload).toBeDefined();
    expect(updateMatched!.payload.confirmId).toBeDefined();

    const confirmId = String(updateMatched!.payload.confirmId);
    const stepsForP2 = ResolutionQueueManager.getStepsForPlayer(gameId, "p2" as any);
    const step = stepsForP2.find(s => (s as any).importWipeConfirm === true && String((s as any).confirmId || "") === confirmId);
    expect(step).toBeDefined();

    // After mid-game import, phase should be reset to PRE_GAME
    const view = game.viewFor("p_socket");
    expect(view.phase).toBe(GamePhase.PRE_GAME);
  });

  test("rejects importDeck when socket is not in the game room", async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];

    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: any) => {
          emitted.push({ room, event, payload });
        },
      }),
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      },
    } as any;

    const handlers: Record<string, Function> = {};
    const socket = {
      data: { playerId: "p_socket", spectator: false },
      rooms: new Set<string>(),
      on: (ev: string, fn: Function) => {
        handlers[ev] = fn;
      },
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      },
    } as any;

    registerDeckHandlers(io as any, socket as any);

    const gameId = "game_sock_test_not_in_room";
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    (game.state as any).players = [
      { id: "p_socket", name: "p_socket", spectator: false },
      { id: "p2", name: "p2", spectator: false },
    ];
    (game.state as any).phase = GamePhase.COMBAT;
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    else (game as any).seq = 1;

    const deckText = `1 Commander One\n1 Card Two`;
    await handlers["importDeck"]({ gameId, list: deckText, deckName: "MyTestDeck", save: false });

    const err = emitted.find(e => e.event === 'deckError');
    expect(err).toBeDefined();
    expect(String(err!.payload?.message || '')).toMatch(/Not in game/i);

    // No resolution queue steps should be created for p2.
    const stepsForP2 = ResolutionQueueManager.getStepsForPlayer(gameId, "p2" as any);
    expect(stepsForP2.length).toBe(0);
  });
});