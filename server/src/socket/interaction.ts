import type { Server, Socket } from "socket.io";
import { ensureGame, appendGameEvent, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { games } from "./socket";
import { 
  permanentHasCreatureType,
  findPermanentsWithCreatureType 
} from "../../../shared/src/creatureTypes";

// Simple unique ID generator for this module
let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Find all untapped permanents controlled by a player that have a specific creature type.
 * This is used for abilities like "Tap four untapped Merfolk you control".
 * Uses the shared implementation that handles Tribal, Kindred, and Changelings.
 */
function findUntappedPermanentsWithCreatureType(
  battlefield: any[],
  playerId: string,
  creatureType: string
): any[] {
  return findPermanentsWithCreatureType(battlefield, playerId, creatureType, true);
}

/**
 * Parse an ability cost to detect tap requirements.
 * Returns info about what needs to be tapped.
 * Examples:
 * - "Tap four untapped Merfolk you control" -> { count: 4, creatureType: "merfolk", tapSelf: false }
 * - "{T}, Sacrifice ~" -> { tapSelf: true }
 */
function parseAbilityCost(oracleText: string): {
  tapSelf?: boolean;
  tapCount?: number;
  tapCreatureType?: string;
  sacrificeSelf?: boolean;
  payLife?: number;
  payMana?: string;
} {
  const text = oracleText.toLowerCase();
  const result: any = {};
  
  // Check for tap self
  if (text.includes("{t}") || text.includes("{t},") || text.includes("{t}:")) {
    result.tapSelf = true;
  }
  
  // Check for sacrifice self
  if (text.includes("sacrifice ~") || text.includes("sacrifice this")) {
    result.sacrificeSelf = true;
  }
  
  // Check for pay life
  const lifeMatch = text.match(/pay (\d+) life/);
  if (lifeMatch) {
    result.payLife = parseInt(lifeMatch[1], 10);
  }
  
  // Check for tapping multiple creatures of a type
  // Pattern: "Tap X untapped [Type] you control"
  // Use \w+ instead of [a-z]+ to properly capture creature types
  const tapCreaturesMatch = text.match(/tap (\w+|\d+) untapped (\w+)(?:s)? you control/i);
  if (tapCreaturesMatch) {
    const countStr = tapCreaturesMatch[1].toLowerCase();
    const countMap: Record<string, number> = {
      "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
      "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
    };
    result.tapCount = countMap[countStr] || parseInt(countStr, 10) || 1;
    result.tapCreatureType = tapCreaturesMatch[2];
  }
  
  // Check for mana cost
  const manaMatch = text.match(/\{([wubrgc0-9]+)\}/gi);
  if (manaMatch && manaMatch.length > 0) {
    // Filter out {T} which is tap symbol
    const manaCosts = manaMatch.filter(m => m.toLowerCase() !== "{t}");
    if (manaCosts.length > 0) {
      result.payMana = manaCosts.join("");
    }
  }
  
  return result;
}

/**
 * Check if a spell's oracle text indicates it's a tutor (search library) effect
 */
function detectTutorEffect(oracleText: string): { isTutor: boolean; searchCriteria?: string; destination?: string } {
  if (!oracleText) return { isTutor: false };
  
  const text = oracleText.toLowerCase();
  
  // Common tutor patterns
  if (text.includes('search your library')) {
    let searchCriteria = '';
    let destination = 'hand';
    
    // Detect what type of card to search for
    const forMatch = text.match(/search your library for (?:a|an|up to \w+) ([^,\.]+)/i);
    if (forMatch) {
      searchCriteria = forMatch[1].trim();
    }
    
    // Detect destination
    if (text.includes('put it into your hand') || text.includes('put that card into your hand')) {
      destination = 'hand';
    } else if (text.includes('put it onto the battlefield') || text.includes('put that card onto the battlefield')) {
      destination = 'battlefield';
    } else if (text.includes('put it on top of your library') || text.includes('put that card on top')) {
      destination = 'top';
    } else if (text.includes('put it into your graveyard')) {
      destination = 'graveyard';
    }
    
    return { isTutor: true, searchCriteria, destination };
  }
  
  return { isTutor: false };
}

/**
 * Parse search criteria to create a filter object
 */
function parseSearchCriteria(criteria: string): { types?: string[]; subtypes?: string[] } {
  const result: { types?: string[]; subtypes?: string[] } = {};
  const text = criteria.toLowerCase();
  
  // Card types
  const types: string[] = [];
  if (text.includes('creature')) types.push('creature');
  if (text.includes('planeswalker')) types.push('planeswalker');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('land')) types.push('land');
  
  // Land subtypes (for fetch lands)
  const subtypes: string[] = [];
  if (text.includes('forest')) subtypes.push('forest');
  if (text.includes('plains')) subtypes.push('plains');
  if (text.includes('island')) subtypes.push('island');
  if (text.includes('swamp')) subtypes.push('swamp');
  if (text.includes('mountain')) subtypes.push('mountain');
  if (text.includes('basic')) subtypes.push('basic');
  
  if (types.length > 0) result.types = types;
  if (subtypes.length > 0) result.subtypes = subtypes;
  
  return result;
}

export function registerInteractionHandlers(io: Server, socket: Socket) {
  // Scry: Peek and reorder library cards
  socket.on("beginScry", ({ gameId, count }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const numCards = Math.max(1, Math.min(10, count));
    const cards = game.peekTopN(pid, numCards);

    socket.emit("scryPeek", { gameId, cards });
  });

  socket.on("confirmScry", ({ gameId, keepTopOrder, bottomOrder }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const peekedCards = game.peekTopN(pid, (keepTopOrder?.length || 0) + (bottomOrder?.length || 0));
    const allSelected = [...(keepTopOrder || []), ...(bottomOrder || [])].map(c => c.id);

    // Validate consistency between client and game state
    if (
      peekedCards.length !== allSelected.length ||
      !peekedCards.every(card => allSelected.includes(card.id))
    ) {
      socket.emit("error", {
        code: "SCRY",
        message: "Scry selection does not match current library state.",
      });
      return;
    }

    game.applyEvent({
      type: "scryResolve",
      playerId: pid,
      keepTopOrder: keepTopOrder || [],
      bottomOrder: bottomOrder || [],
    });
    appendEvent(gameId, game.seq, "scryResolve", { playerId: pid, keepTopOrder, bottomOrder });

    broadcastGame(io, game, gameId);
  });

  // Surveil: Peek, send cards to graveyard, or reorder
  socket.on("beginSurveil", ({ gameId, count }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const numCards = Math.max(1, Math.min(10, count));
    const cards = game.peekTopN(pid, numCards);

    socket.emit("surveilPeek", { gameId, cards });
  });

  socket.on("confirmSurveil", ({ gameId, toGraveyard, keepTopOrder }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const peekedCards = game.peekTopN(pid, (toGraveyard?.length || 0) + (keepTopOrder?.length || 0));
    const allSelected = [...(toGraveyard || []), ...(keepTopOrder || [])].map(c => c.id);

    // Validate consistency between client and game state
    if (
      peekedCards.length !== allSelected.length ||
      !peekedCards.every(card => allSelected.includes(card.id))
    ) {
      socket.emit("error", {
        code: "SURVEIL",
        message: "Surveil selection does not match current library state.",
      });
      return;
    }

    game.applyEvent({
      type: "surveilResolve",
      playerId: pid,
      toGraveyard: toGraveyard || [],
      keepTopOrder: keepTopOrder || [],
    });
    appendEvent(gameId, game.seq, "surveilResolve", { playerId: pid, toGraveyard, keepTopOrder });

    broadcastGame(io, game, gameId);
  });

  // Library search: Query and select cards
  socket.on("searchLibrary", ({ gameId, query, limit }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const results = game.searchLibrary(pid, query || "", Math.max(1, Math.min(100, limit || 20)));

    socket.emit("searchResults", { gameId, cards: results, total: results.length });
  });

  socket.on("selectFromSearch", ({ gameId, cardIds, moveTo, reveal }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const movedCards = game.selectFromLibrary(pid, cardIds || [], moveTo);

    appendEvent(gameId, game.seq, "selectFromLibrary", {
      playerId: pid,
      cardIds: cardIds || [],
      moveTo,
      reveal,
    });

    if (movedCards.length) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} moved ${movedCards.join(", ")} to ${moveTo}`,
        ts: Date.now(),
      });
    }

    broadcastGame(io, game, gameId);
  });

  // Request full library for searching (tutor effect)
  socket.on("requestLibrarySearch", ({ gameId, title, description, filter, maxSelections, moveTo, shuffleAfter }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Get full library contents for the player (no limit for tutor effects)
    const library = game.searchLibrary(pid, "", 1000);
    
    socket.emit("librarySearchRequest", {
      gameId,
      cards: library,
      title: title || "Search Library",
      description,
      filter,
      maxSelections: maxSelections || 1,
      moveTo: moveTo || "hand",
      shuffleAfter: shuffleAfter !== false,
    });
  });

  // Handle graveyard ability activation
  socket.on("activateGraveyardAbility", ({ gameId, cardId, abilityId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const zones = (game.state as any)?.zones?.[pid];
    
    if (!zones || !Array.isArray(zones.graveyard)) {
      socket.emit("error", {
        code: "GRAVEYARD_NOT_FOUND",
        message: "Graveyard not found",
      });
      return;
    }
    
    // Find the card in graveyard
    const cardIndex = zones.graveyard.findIndex((c: any) => c?.id === cardId);
    if (cardIndex === -1) {
      socket.emit("error", {
        code: "CARD_NOT_IN_GRAVEYARD",
        message: "Card not found in graveyard",
      });
      return;
    }
    
    const card = zones.graveyard[cardIndex];
    const cardName = card?.name || "Unknown";
    
    // Handle different graveyard abilities
    if (abilityId === "flashback" || abilityId === "jump-start" || abilityId === "retrace" || abilityId === "escape") {
      // Cast from graveyard - move to stack
      // Remove from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Add to stack
      const stackItem = {
        id: generateId("stack"),
        controller: pid,
        card: { ...card, zone: "stack", castWithAbility: abilityId },
        targets: [],
      };
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} cast ${cardName} using ${abilityId}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "unearth") {
      // Return to battlefield
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Add to battlefield
      game.state.battlefield = game.state.battlefield || [];
      game.state.battlefield.push({
        id: generateId("perm"),
        controller: pid,
        owner: pid,
        tapped: false,
        counters: {},
        card: { ...card, zone: "battlefield", unearth: true },
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} unearthed ${cardName}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "embalm" || abilityId === "eternalize") {
      // Create token copy (simplified - doesn't track token properties properly)
      // Exile original from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      
      // Create token on battlefield
      const tokenName = abilityId === "eternalize" ? `${cardName} (4/4 Zombie)` : `${cardName} (Zombie)`;
      game.state.battlefield = game.state.battlefield || [];
      game.state.battlefield.push({
        id: generateId("token"),
        controller: pid,
        owner: pid,
        tapped: false,
        counters: {},
        isToken: true,
        card: { 
          ...card, 
          name: tokenName,
          zone: "battlefield", 
          type_line: card.type_line?.includes("Zombie") ? card.type_line : `Zombie ${card.type_line}`,
        },
        basePower: abilityId === "eternalize" ? 4 : undefined,
        baseToughness: abilityId === "eternalize" ? 4 : undefined,
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} created a token copy of ${cardName} using ${abilityId}.`,
        ts: Date.now(),
      });
    } else if (abilityId === "return-from-graveyard" || abilityId === "graveyard-activated") {
      // Generic return from graveyard ability (like Summon the School)
      // Parse the oracle text to determine the destination
      const oracleText = (card.oracle_text || "").toLowerCase();
      
      // Check for search library effects in the ability
      const tutorInfo = detectTutorEffect(card.oracle_text || "");
      
      if (tutorInfo.isTutor) {
        // This ability involves searching the library
        // Don't remove from graveyard yet - the search needs to resolve first
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
          playerId: pid,
          cardId,
          abilityId,
          isTutor: true,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
          ts: Date.now(),
        });
        
        // Parse search criteria and send library search request
        const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
        const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
        
        socket.emit("librarySearchRequest", {
          gameId,
          cards: library,
          title: `${cardName}`,
          description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
          filter,
          maxSelections: 1,
          moveTo: tutorInfo.destination || "hand",
          shuffleAfter: true,
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
      
      // Check destination from oracle text
      let destination = "hand"; // default
      if (oracleText.includes("to the battlefield") || oracleText.includes("onto the battlefield")) {
        destination = "battlefield";
      } else if (oracleText.includes("to your hand") || oracleText.includes("into your hand")) {
        destination = "hand";
      }
      
      // Remove from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      if (destination === "battlefield") {
        // Move to battlefield
        game.state.battlefield = game.state.battlefield || [];
        game.state.battlefield.push({
          id: generateId("perm"),
          controller: pid,
          owner: pid,
          tapped: false,
          counters: {},
          card: { ...card, zone: "battlefield" },
        } as any);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} returned ${cardName} from graveyard to the battlefield.`,
          ts: Date.now(),
        });
      } else {
        // Move to hand (default)
        zones.hand = zones.hand || [];
        zones.hand.push({ ...card, zone: "hand" });
        zones.handCount = zones.hand.length;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} returned ${cardName} from graveyard to hand.`,
          ts: Date.now(),
        });
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
        destination,
      });
    } else if (abilityId === "scavenge") {
      // Scavenge - exile from graveyard (player needs to manually target creature for counters)
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      // Calculate P/T for +1/+1 counters
      const power = parseInt(card.power || "0", 10) || 0;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} scavenged ${cardName}. Add ${power} +1/+1 counters to target creature.`,
        ts: Date.now(),
      });
    } else if (abilityId === "encore") {
      // Encore - exile from graveyard (creates tokens)
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Move to exile
      zones.exile = zones.exile || [];
      zones.exile.push({ ...card, zone: "exile" });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} used encore on ${cardName}. Create a token copy for each opponent.`,
        ts: Date.now(),
      });
    } else if (abilityId === "disturb") {
      // Disturb - cast transformed from graveyard
      zones.graveyard.splice(cardIndex, 1);
      zones.graveyardCount = zones.graveyard.length;
      
      // Add to stack (transformed)
      const stackItem = {
        id: generateId("stack"),
        controller: pid,
        card: { ...card, zone: "stack", castWithAbility: "disturb", transformed: true },
        targets: [],
      };
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} cast ${cardName} using disturb (transformed).`,
        ts: Date.now(),
      });
    } else {
      // Unknown or generic graveyard ability
      // Check for tutor/search effects in the oracle text
      const tutorInfo = detectTutorEffect(card.oracle_text || "");
      
      if (tutorInfo.isTutor) {
        // This ability involves searching the library
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
          playerId: pid,
          cardId,
          abilityId,
          isTutor: true,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
          ts: Date.now(),
        });
        
        // Parse search criteria and send library search request
        const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
        const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
        
        socket.emit("librarySearchRequest", {
          gameId,
          cards: library,
          title: `${cardName}`,
          description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
          filter,
          maxSelections: 1,
          moveTo: tutorInfo.destination || "hand",
          shuffleAfter: true,
        });
        
        broadcastGame(io, game, gameId);
        return;
      }
      
      // If no specific handler, log it and notify
      console.log(`[activateGraveyardAbility] Unhandled ability ${abilityId} for ${cardName}`);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated an ability on ${cardName} from graveyard.`,
        ts: Date.now(),
      });
    }
    
    broadcastGame(io, game, gameId);
  });

  // Get graveyard contents for viewing
  socket.on("requestGraveyardView", ({ gameId, targetPlayerId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid) return;

    const game = ensureGame(gameId);
    const targetPid = targetPlayerId || pid;
    const zones = (game.state as any)?.zones?.[targetPid];
    
    if (!zones) {
      socket.emit("graveyardView", { gameId, playerId: targetPid, cards: [] });
      return;
    }
    
    const graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
    
    socket.emit("graveyardView", {
      gameId,
      playerId: targetPid,
      cards: graveyard,
    });
  });

  // Tap a permanent on the battlefield
  socket.on("tapPermanent", ({ gameId, permanentId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = game.state?.battlefield || [];
    
    const permanent = battlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
    if (!permanent) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    if ((permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: "Permanent is already tapped",
      });
      return;
    }
    
    (permanent as any).tapped = true;
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "tapPermanent", { playerId: pid, permanentId });
    
    broadcastGame(io, game, gameId);
  });

  // Untap a permanent on the battlefield
  socket.on("untapPermanent", ({ gameId, permanentId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = game.state?.battlefield || [];
    
    const permanent = battlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
    if (!permanent) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    if (!(permanent as any).tapped) {
      socket.emit("error", {
        code: "NOT_TAPPED",
        message: "Permanent is not tapped",
      });
      return;
    }
    
    (permanent as any).tapped = false;
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "untapPermanent", { playerId: pid, permanentId });
    
    broadcastGame(io, game, gameId);
  });

  // Sacrifice a permanent on the battlefield
  socket.on("sacrificePermanent", ({ gameId, permanentId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = game.state?.battlefield || [];
    
    const permIndex = battlefield.findIndex((p: any) => p?.id === permanentId && p?.controller === pid);
    if (permIndex === -1) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    const oracleText = (card?.oracle_text || "").toLowerCase();
    
    // Check if this is a fetch land or similar with search effect
    const isFetchLand = oracleText.includes("sacrifice") && oracleText.includes("search your library");
    
    // Remove from battlefield
    battlefield.splice(permIndex, 1);
    
    // Move to graveyard
    const zones = (game.state as any)?.zones?.[pid];
    if (zones) {
      zones.graveyard = zones.graveyard || [];
      zones.graveyard.push({ ...card, zone: "graveyard" });
      zones.graveyardCount = zones.graveyard.length;
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "sacrificePermanent", { playerId: pid, permanentId });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${cardName}.`,
      ts: Date.now(),
    });
    
    // If this was a fetch land, trigger library search
    if (isFetchLand) {
      // Check if it's a true fetch (pay 1 life) - note life was not paid since this is manual sacrifice
      const isTrueFetch = oracleText.includes("pay 1 life");
      
      if (isTrueFetch) {
        // Notify that the player should have paid life
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Note: ${cardName} requires paying 1 life to search (use Fetch Land ability for automatic life payment).`,
          ts: Date.now(),
        });
      }
      
      // Parse what land types this fetch can find
      const filter = parseSearchCriteria(oracleText);
      
      // Build description for the search prompt
      let searchDescription = "Search your library for a land card";
      if (filter.subtypes && filter.subtypes.length > 0) {
        const landTypes = filter.subtypes.filter(s => !s.includes("basic")).map(s => s.charAt(0).toUpperCase() + s.slice(1));
        if (landTypes.length > 0) {
          searchDescription = `Search for a ${landTypes.join(" or ")} card`;
        }
        if (filter.subtypes.includes("basic")) {
          searchDescription = `Search for a basic ${landTypes.join(" or ")} card`;
        }
      }
      
      // Get full library for search
      const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
      
      // Send library search request to the player
      socket.emit("librarySearchRequest", {
        gameId,
        cards: library,
        title: `${cardName}`,
        description: searchDescription,
        filter,
        maxSelections: 1,
        moveTo: "battlefield",
        shuffleAfter: true,
      });
    }
    
    broadcastGame(io, game, gameId);
  });

  // Activate a battlefield ability (fetch lands, mana abilities, etc.)
  socket.on("activateBattlefieldAbility", ({ gameId, permanentId, abilityId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const battlefield = game.state?.battlefield || [];
    
    const permIndex = battlefield.findIndex((p: any) => p?.id === permanentId && p?.controller === pid);
    if (permIndex === -1) {
      socket.emit("error", {
        code: "PERMANENT_NOT_FOUND",
        message: "Permanent not found or not controlled by you",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
    const card = (permanent as any).card;
    const cardName = card?.name || "Unknown";
    const oracleText = (card?.oracle_text || "").toLowerCase();
    const typeLine = (card?.type_line || "").toLowerCase();
    
    // Handle fetch land ability
    if (abilityId === "fetch-land") {
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      // Check if it's a true fetch (pay 1 life)
      const isTrueFetch = oracleText.includes("pay 1 life");
      
      // Pay life cost if required
      if (isTrueFetch) {
        const life = (game.state as any)?.life?.[pid];
        if (typeof life === "number") {
          (game.state as any).life[pid] = life - 1;
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} paid 1 life (${life} → ${life - 1}).`,
            ts: Date.now(),
          });
        }
      }
      
      // Tap the permanent (part of cost)
      (permanent as any).tapped = true;
      
      // Remove from battlefield (sacrifice)
      battlefield.splice(permIndex, 1);
      
      // Move to graveyard
      const zones = (game.state as any)?.zones?.[pid];
      if (zones) {
        zones.graveyard = zones.graveyard || [];
        zones.graveyard.push({ ...card, zone: "graveyard" });
        zones.graveyardCount = zones.graveyard.length;
      }
      
      // Parse what land types this fetch can find
      const filter = parseSearchCriteria(oracleText);
      
      // Build description for the search prompt
      let searchDescription = "Search your library for a land card";
      if (filter.subtypes && filter.subtypes.length > 0) {
        const landTypes = filter.subtypes.filter(s => !s.includes("basic")).map(s => s.charAt(0).toUpperCase() + s.slice(1));
        if (landTypes.length > 0) {
          searchDescription = `Search for a ${landTypes.join(" or ")} card`;
        }
        if (filter.subtypes.includes("basic")) {
          searchDescription = `Search for a basic ${landTypes.join(" or ")} card`;
        }
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateFetchland", { playerId: pid, permanentId, abilityId, cardName });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}${isTrueFetch ? " (paid 1 life)" : ""} and sacrificed it.`,
        ts: Date.now(),
      });
      
      // Get full library for search
      const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
      
      // Send library search request to the player
      socket.emit("librarySearchRequest", {
        gameId,
        cards: library,
        title: `${cardName}`,
        description: searchDescription,
        filter,
        maxSelections: 1,
        moveTo: "battlefield",
        shuffleAfter: true,
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle mana abilities (tap-mana-*)
    if (abilityId.startsWith("tap-mana")) {
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return;
      }
      
      // Check for Metalcraft requirement (Mox Opal)
      // Rule 702.80 - Metalcraft abilities only work if you control 3+ artifacts
      if (oracleText.includes('metalcraft')) {
        const artifactCount = battlefield.filter((p: any) => {
          if (p.controller !== pid) return false;
          const permTypeLine = (p.card?.type_line || '').toLowerCase();
          return permTypeLine.includes('artifact');
        }).length;
        
        if (artifactCount < 3) {
          socket.emit("error", {
            code: "METALCRAFT_NOT_ACTIVE",
            message: `Metalcraft is not active. You control ${artifactCount} artifacts (need 3 or more).`,
          });
          return;
        }
      }
      
      // Tap the permanent
      (permanent as any).tapped = true;
      
      // Determine mana color from ability ID
      let manaColor = "colorless";
      const manaColorMap: Record<string, string> = {
        "tap-mana-w": "white",
        "tap-mana-u": "blue",
        "tap-mana-b": "black",
        "tap-mana-r": "red",
        "tap-mana-g": "green",
        "tap-mana-any": "any", // Will need to prompt for color choice
        "tap-mana": "colorless",
      };
      manaColor = manaColorMap[abilityId] || "colorless";
      
      // Add mana to pool
      game.state.manaPool = game.state.manaPool || {};
      game.state.manaPool[pid] = game.state.manaPool[pid] || {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };
      
      if (manaColor === "any") {
        // For "any color" mana, add colorless for now (ideally prompt user)
        // TODO: Implement color choice prompt
        game.state.manaPool[pid].colorless++;
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} tapped ${cardName} for mana.`,
          ts: Date.now(),
        });
      } else {
        (game.state.manaPool[pid] as Record<string, number>)[manaColor]++;
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} tapped ${cardName} for ${manaColor} mana.`,
          ts: Date.now(),
        });
      }
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateManaAbility", { playerId: pid, permanentId, abilityId, manaColor });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle planeswalker abilities (pw-ability-N)
    if (abilityId.startsWith("pw-ability-")) {
      // Parse ability index
      const abilityIndex = parseInt(abilityId.replace("pw-ability-", ""), 10);
      
      // Parse the planeswalker ability from oracle text
      const pwAbilityPattern = /\[([+−\-]?\d+)\]:\s*([^[\]]+?)(?=\n|\[|$)/gi;
      const abilities: { loyaltyCost: number; text: string }[] = [];
      let pwMatch;
      while ((pwMatch = pwAbilityPattern.exec(oracleText)) !== null) {
        const costStr = pwMatch[1].replace('−', '-');
        const cost = parseInt(costStr, 10);
        abilities.push({ loyaltyCost: cost, text: pwMatch[2].trim() });
      }
      
      if (abilityIndex < 0 || abilityIndex >= abilities.length) {
        socket.emit("error", {
          code: "INVALID_ABILITY",
          message: `Ability index ${abilityIndex} not found on ${cardName}`,
        });
        return;
      }
      
      const ability = abilities[abilityIndex];
      
      // Get current loyalty
      const currentLoyalty = (permanent as any).counters?.loyalty || 0;
      const loyaltyCost = ability.loyaltyCost;
      
      // Check if we can pay the cost
      // For minus abilities, check we have enough loyalty
      if (loyaltyCost < 0 && currentLoyalty + loyaltyCost < 0) {
        socket.emit("error", {
          code: "INSUFFICIENT_LOYALTY",
          message: `${cardName} has ${currentLoyalty} loyalty, need at least ${Math.abs(loyaltyCost)} to activate this ability`,
        });
        return;
      }
      
      // Check if planeswalker has already activated an ability this turn
      // (Rule 606.3: Only one loyalty ability per turn per planeswalker)
      if ((permanent as any).loyaltyActivatedThisTurn) {
        socket.emit("error", {
          code: "LOYALTY_ALREADY_USED",
          message: `${cardName} has already activated a loyalty ability this turn`,
        });
        return;
      }
      
      // Apply loyalty cost
      const newLoyalty = currentLoyalty + loyaltyCost;
      (permanent as any).counters = (permanent as any).counters || {};
      (permanent as any).counters.loyalty = newLoyalty;
      (permanent as any).loyaltyActivatedThisTurn = true;
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activatePlaneswalkerAbility", { 
        playerId: pid, 
        permanentId, 
        abilityIndex, 
        loyaltyCost,
        newLoyalty,
      });
      
      const costSign = loyaltyCost >= 0 ? "+" : "";
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}'s [${costSign}${loyaltyCost}] ability. (Loyalty: ${currentLoyalty} → ${newLoyalty})`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle other activated abilities (planeswalker abilities, etc.)
    // For now, log and emit a generic message
    console.log(`[activateBattlefieldAbility] Unknown ability ${abilityId} on ${cardName}`);
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated an ability on ${cardName}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });
}