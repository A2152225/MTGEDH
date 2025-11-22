/**
 * Test for viewFor opponent hand visibility logic.
 * Ensures that opponent hands are populated with card objects but marked as unknown,
 * while the viewer's own hand is marked as known.
 */

import { createContext } from "../src/state/context";
import { viewFor } from "../src/state/view";
import { importDeckResolved, drawCards } from "../src/state/modules/zones";

describe("viewFor opponent hand visibility", () => {
  test("viewer sees own hand as known, opponent hand as unknown", () => {
    const ctx = createContext("test-game-view");
    
    const viewer = "player1";
    const opponent = "player2";
    
    // Import decks for both players
    const viewerCards = [
      { id: "c1", name: "Lightning Bolt", type_line: "Instant", oracle_text: "Deal 3 damage", image_uris: { small: "url1" } },
      { id: "c2", name: "Forest", type_line: "Land", oracle_text: "", image_uris: { small: "url2" } },
    ];
    const opponentCards = [
      { id: "c3", name: "Dark Ritual", type_line: "Instant", oracle_text: "Add BBB", image_uris: { small: "url3" } },
      { id: "c4", name: "Swamp", type_line: "Land", oracle_text: "", image_uris: { small: "url4" } },
      { id: "c5", name: "Fatal Push", type_line: "Instant", oracle_text: "Destroy target", image_uris: { small: "url5" } },
    ];
    
    importDeckResolved(ctx as any, viewer, viewerCards);
    importDeckResolved(ctx as any, opponent, opponentCards);
    
    // Draw cards for both players
    drawCards(ctx as any, viewer, 2);
    drawCards(ctx as any, opponent, 3);
    
    // Generate view for viewer
    const view = viewFor(ctx as any, viewer, false);
    
    // Verify viewer's own hand
    expect(view.zones?.[viewer]).toBeDefined();
    const viewerHand = view.zones![viewer].hand as any[];
    expect(viewerHand).toHaveLength(2);
    expect(viewerHand[0].known).toBe(true);
    expect(viewerHand[0].name).toBe("Lightning Bolt");
    expect(viewerHand[1].known).toBe(true);
    expect(viewerHand[1].name).toBe("Forest");
    
    // Verify opponent's hand
    expect(view.zones?.[opponent]).toBeDefined();
    const opponentHand = view.zones![opponent].hand as any[];
    expect(opponentHand).toHaveLength(3);
    
    // Opponent cards should not be known
    expect(opponentHand[0].known).toBe(false);
    expect(opponentHand[0].faceDown).toBe(true);
    expect(opponentHand[0].name).toBeUndefined();
    expect(opponentHand[0].id).toBeDefined(); // ID should still be present
    
    expect(opponentHand[1].known).toBe(false);
    expect(opponentHand[1].faceDown).toBe(true);
    expect(opponentHand[1].name).toBeUndefined();
    
    expect(opponentHand[2].known).toBe(false);
    expect(opponentHand[2].faceDown).toBe(true);
    expect(opponentHand[2].name).toBeUndefined();
    
    // Verify hand counts are correct
    expect(view.zones![viewer].handCount).toBe(2);
    expect(view.zones![opponent].handCount).toBe(3);
  });
  
  test("cards with knownTo array are visible to specified viewer", () => {
    const ctx = createContext("test-game-telepathy");
    
    const viewer = "player1";
    const opponent = "player2";
    
    // Import decks
    const viewerCards = [
      { id: "c1", name: "Lightning Bolt", type_line: "Instant", oracle_text: "", image_uris: { small: "url1" } },
    ];
    const opponentCards = [
      { id: "c2", name: "Dark Ritual", type_line: "Instant", oracle_text: "", image_uris: { small: "url2" }, knownTo: [viewer] },
      { id: "c3", name: "Swamp", type_line: "Land", oracle_text: "", image_uris: { small: "url3" } },
    ];
    
    importDeckResolved(ctx as any, viewer, viewerCards);
    importDeckResolved(ctx as any, opponent, opponentCards);
    
    // Draw cards
    drawCards(ctx as any, viewer, 1);
    drawCards(ctx as any, opponent, 2);
    
    // Generate view for viewer
    const view = viewFor(ctx as any, viewer, false);
    
    const opponentHand = view.zones![opponent].hand as any[];
    expect(opponentHand).toHaveLength(2);
    
    // First card has knownTo with viewer, so should be visible
    expect(opponentHand[0].known).toBe(true);
    expect(opponentHand[0].faceDown).toBe(false);
    expect(opponentHand[0].name).toBe("Dark Ritual");
    expect(opponentHand[0].image_uris).toBeDefined();
    
    // Second card is not known to viewer
    expect(opponentHand[1].known).toBe(false);
    expect(opponentHand[1].faceDown).toBe(true);
    expect(opponentHand[1].name).toBeUndefined();
  });
});
