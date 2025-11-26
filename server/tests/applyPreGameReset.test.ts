import { describe, test, expect } from 'vitest';
import { createContext } from "../src/state/context";
import {
  importDeckResolved,
  applyPreGameReset,
} from "../src/state/modules/zones";
import { GamePhase } from "../../shared/src/types";

describe("applyPreGameReset (zones)", () => {
  test("wipes battlefield, clears hand/graveyard/exile, resets life/counters and sets phase PRE_GAME", () => {
    const ctx = createContext("test-game-1");

    const playerId = "p_test";

    // populate a sample library via importDeckResolved (simulating resolved cards)
    const resolved = [
      { id: "c1", name: "Card One", type_line: "Creature", oracle_text: "" },
      { id: "c2", name: "Card Two", type_line: "Creature", oracle_text: "" },
    ];
    importDeckResolved(ctx as any, playerId, resolved);

    // Add battlefield permanent(s) controlled by this player
    ctx.state.battlefield.push({
      id: "perm1",
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: { id: "c1", name: "Card One" } as any,
    } as any);

    // Populate zones for player: hand with one card, graveyard has one
    ctx.state.zones = ctx.state.zones || {};
    ctx.state.zones[playerId] = {
      hand: [{ id: "h1", name: "InHand" } as any],
      handCount: 1,
      libraryCount: ctx.libraries.get(playerId)?.length ?? 0,
      graveyard: [{ id: "g1", name: "InGrave" } as any],
      graveyardCount: 1,
      exile: [{ id: "e1", name: "InExile" } as any],
    } as any;

    // Set life and counters to non-defaults
    ctx.life[playerId] = 7;
    ctx.poison[playerId] = 2;
    ctx.experience[playerId] = 3;

    // Ensure preconditions
    expect(ctx.state.battlefield.some((p) => p.controller === playerId)).toBeTruthy();
    expect((ctx.state.zones[playerId] as any).handCount).toBe(1);
    expect(ctx.life[playerId]).toBe(7);

    // Apply the pre-game reset
    applyPreGameReset(ctx as any, playerId);

    // Phase should be PRE_GAME
    expect(ctx.state.phase).toBe(GamePhase.PRE_GAME);

    // Life & counters reset to startingLife / 0 / 0
    const expectedStarting = ctx.state.startingLife ?? 40;
    expect(ctx.life[playerId]).toBe(expectedStarting);
    expect(ctx.poison[playerId]).toBe(0);
    expect(ctx.experience[playerId]).toBe(0);

    // Zones: hand/graveyard/exile cleared
    const z = ctx.state.zones[playerId];
    expect(z).toBeDefined();
    expect((z as any).handCount).toBe(0);
    expect((z as any).graveyardCount).toBe(0);
    expect(Array.isArray((z as any).exile)).toBeTruthy();
    // Library should still contain the imported cards
    expect((ctx.libraries.get(playerId) || []).length).toBe(resolved.length);

    // Battlefield should not contain permanents controlled by playerId
    expect(ctx.state.battlefield.some((p) => p.controller === playerId)).toBeFalsy();
  });
});