import type { Server, Socket } from "socket.io";
import { ensureGame, appendGameEvent, broadcastGame, getPlayerName, emitToPlayer } from "./util";
import { appendEvent } from "../db";
import { games } from "./socket";
import { 
  permanentHasCreatureType,
  findPermanentsWithCreatureType 
} from "../../../shared/src/creatureTypes";
import { getDeathTriggers, getPlayersWhoMustSacrifice } from "../state/modules/triggered-abilities";

// ============================================================================
// Library Search Restriction Handling (Aven Mindcensor, Stranglehold, etc.)
// ============================================================================

/** Known cards that prevent or restrict library searching */
const SEARCH_PREVENTION_CARDS: Record<string, { affectsOpponents: boolean; affectsSelf: boolean }> = {
  "stranglehold": { affectsOpponents: true, affectsSelf: false },
  "ashiok, dream render": { affectsOpponents: true, affectsSelf: false },
  "mindlock orb": { affectsOpponents: true, affectsSelf: true },
  "shadow of doubt": { affectsOpponents: true, affectsSelf: true },
  "leonin arbiter": { affectsOpponents: true, affectsSelf: true }, // Can pay {2}
};

/** Known cards that limit library searching to top N cards */
const SEARCH_LIMIT_CARDS: Record<string, { limit: number; affectsOpponents: boolean }> = {
  "aven mindcensor": { limit: 4, affectsOpponents: true },
};

/** Known cards that trigger when opponents search */
const SEARCH_TRIGGER_CARDS: Record<string, { effect: string; affectsOpponents: boolean }> = {
  "ob nixilis, unshackled": { effect: "Sacrifice a creature and lose 10 life", affectsOpponents: true },
};

/** Known cards that give control during opponent's search */
const SEARCH_CONTROL_CARDS = new Set(["opposition agent"]);

/**
 * Check for search restrictions affecting a player
 */
function checkLibrarySearchRestrictions(
  game: any,
  searchingPlayerId: string
): {
  canSearch: boolean;
  limitToTop?: number;
  triggerEffects: { cardName: string; effect: string; controllerId: string }[];
  controlledBy?: string;
  reason?: string;
  paymentRequired?: { cardName: string; amount: string };
} {
  const battlefield = game.state?.battlefield || [];
  const triggerEffects: { cardName: string; effect: string; controllerId: string }[] = [];
  let canSearch = true;
  let limitToTop: number | undefined;
  let controlledBy: string | undefined;
  let reason: string | undefined;
  let paymentRequired: { cardName: string; amount: string } | undefined;
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const cardName = (perm.card.name || "").toLowerCase();
    const controllerId = perm.controller;
    const isOpponent = controllerId !== searchingPlayerId;
    
    // Check prevention cards
    for (const [name, info] of Object.entries(SEARCH_PREVENTION_CARDS)) {
      if (cardName.includes(name)) {
        const applies = (isOpponent && info.affectsOpponents) || (!isOpponent && info.affectsSelf);
        if (applies) {
          // Special case: Leonin Arbiter allows payment
          if (name === "leonin arbiter") {
            paymentRequired = { cardName: perm.card.name, amount: "{2}" };
          } else {
            canSearch = false;
            reason = `${perm.card.name} prevents library searching`;
          }
        }
      }
    }
    
    // Check limit cards (Aven Mindcensor)
    for (const [name, info] of Object.entries(SEARCH_LIMIT_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          if (limitToTop === undefined || info.limit < limitToTop) {
            limitToTop = info.limit;
          }
        }
      }
    }
    
    // Check trigger cards (Ob Nixilis)
    for (const [name, info] of Object.entries(SEARCH_TRIGGER_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          triggerEffects.push({
            cardName: perm.card.name,
            effect: info.effect,
            controllerId,
          });
        }
      }
    }
    
    // Check control cards (Opposition Agent)
    if (SEARCH_CONTROL_CARDS.has(cardName)) {
      if (isOpponent) {
        controlledBy = controllerId;
      }
    }
  }
  
  return {
    canSearch,
    limitToTop,
    triggerEffects,
    controlledBy,
    reason,
    paymentRequired,
  };
}

/**
 * Get searchable library cards considering Aven Mindcensor effect
 */
function getSearchableLibraryCards(library: any[], limitToTop?: number): any[] {
  if (limitToTop !== undefined && limitToTop > 0) {
    return library.slice(0, limitToTop);
  }
  return library;
}

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
 * Tutor effect detection result
 */
interface TutorInfo {
  isTutor: boolean;
  searchCriteria?: string;
  destination?: string;
  maxSelections?: number;
  /** For split-destination effects like Kodama's Reach/Cultivate */
  splitDestination?: boolean;
  /** Number of cards to put on battlefield for split effects */
  toBattlefield?: number;
  /** Number of cards to put in hand for split effects */
  toHand?: number;
  /** Whether cards enter battlefield tapped */
  entersTapped?: boolean;
}

/**
 * Check if a spell's oracle text indicates it's a tutor (search library) effect
 * and parse the intended destination for the searched card.
 * 
 * Common tutor destination patterns:
 * - "put it into your hand" -> hand (Demonic Tutor, Vampiric Tutor final)
 * - "put it onto the battlefield" -> battlefield (Green Sun's Zenith, Eladamri's Call)
 * - "put it on top of your library" -> top (Vampiric Tutor, Mystical Tutor, Worldly Tutor)
 * - "put it into your graveyard" -> graveyard (Entomb, Buried Alive)
 * - "reveal it" (then hand) -> hand (most white/blue tutors)
 * 
 * Special patterns:
 * - Kodama's Reach/Cultivate: "put one onto the battlefield tapped and the other into your hand"
 */
function detectTutorEffect(oracleText: string): TutorInfo {
  if (!oracleText) return { isTutor: false };
  
  const text = oracleText.toLowerCase();
  
  // Common tutor patterns
  if (text.includes('search your library')) {
    let searchCriteria = '';
    let destination = 'hand'; // Default destination
    let maxSelections = 1;
    
    // Detect what type of card to search for
    const forMatch = text.match(/search your library for (?:a|an|up to (\w+)) ([^,\.]+)/i);
    if (forMatch) {
      // Check for "up to N" pattern
      if (forMatch[1]) {
        const num = forMatch[1].toLowerCase();
        if (num === 'two') maxSelections = 2;
        else if (num === 'three') maxSelections = 3;
        else if (num === 'four') maxSelections = 4;
        else {
          const parsed = parseInt(num, 10);
          if (!isNaN(parsed)) maxSelections = parsed;
        }
      }
      searchCriteria = forMatch[2].trim();
    }
    
    // SPECIAL CASE: Kodama's Reach / Cultivate pattern
    // "put one onto the battlefield tapped and the other into your hand"
    if (text.includes('put one onto the battlefield') && text.includes('the other into your hand')) {
      const entersTapped = text.includes('battlefield tapped');
      return {
        isTutor: true,
        searchCriteria,
        destination: 'split', // Special destination type
        maxSelections: 2,
        splitDestination: true,
        toBattlefield: 1,
        toHand: 1,
        entersTapped,
      };
    }
    
    // SPECIAL CASE: Three Visits / Nature's Lore pattern  
    // "put that card onto the battlefield tapped"
    if (text.includes('forest card') && text.includes('put that card onto the battlefield')) {
      const entersTapped = text.includes('battlefield tapped');
      return {
        isTutor: true,
        searchCriteria: 'forest card',
        destination: 'battlefield',
        maxSelections: 1,
        entersTapped,
      };
    }
    
    // Detect destination - order matters! More specific patterns first
    
    // Top of library patterns (Vampiric Tutor, Mystical Tutor, Worldly Tutor, Enlightened Tutor)
    if (text.includes('put it on top of your library') || 
        text.includes('put that card on top of your library') ||
        text.includes('put it on top') ||
        text.includes('put that card on top')) {
      destination = 'top';
    }
    // Battlefield patterns (Green Sun's Zenith, Chord of Calling, Natural Order)
    else if (text.includes('put it onto the battlefield') || 
             text.includes('put that card onto the battlefield') ||
             text.includes('put onto the battlefield') ||
             text.includes('enters the battlefield')) {
      destination = 'battlefield';
    }
    // Graveyard patterns (Entomb, Buried Alive)
    else if (text.includes('put it into your graveyard') || 
             text.includes('put that card into your graveyard') ||
             text.includes('put into your graveyard')) {
      destination = 'graveyard';
    }
    // Hand patterns (Demonic Tutor, Diabolic Tutor, Grim Tutor)
    else if (text.includes('put it into your hand') || 
             text.includes('put that card into your hand') ||
             text.includes('add it to your hand') ||
             text.includes('reveal it') || // Most reveal tutors put to hand
             text.includes('reveal that card')) {
      destination = 'hand';
    }
    
    return { isTutor: true, searchCriteria, destination, maxSelections };
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
    
    // Check for search restrictions (Aven Mindcensor, Stranglehold, etc.)
    const searchCheck = checkLibrarySearchRestrictions(game, pid);
    
    // If search is completely prevented
    if (!searchCheck.canSearch) {
      socket.emit("error", {
        code: "SEARCH_PREVENTED",
        message: searchCheck.reason || "Library search is prevented",
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)}'s library search was prevented${searchCheck.reason ? ': ' + searchCheck.reason : ''}.`,
        ts: Date.now(),
      });
      return;
    }
    
    // Get library contents (may be limited by Aven Mindcensor)
    const fullLibrary = game.searchLibrary(pid, "", 1000);
    const searchableCards = getSearchableLibraryCards(fullLibrary, searchCheck.limitToTop);
    
    // If there are trigger effects (Ob Nixilis), notify
    if (searchCheck.triggerEffects.length > 0) {
      for (const trigger of searchCheck.triggerEffects) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${trigger.cardName} triggers: ${trigger.effect}`,
          ts: Date.now(),
        });
        
        // Note: Trigger resolution (e.g., Ob Nixilis forcing sacrifice/life loss)
        // would require pushing to the stack and resolving. For now, we notify
        // the players via chat. Full implementation would use the stack system.
      }
    }
    
    // Build description with restriction info
    let finalDescription = description || "";
    if (searchCheck.limitToTop) {
      finalDescription = `${finalDescription ? finalDescription + " " : ""}(Searching top ${searchCheck.limitToTop} cards only - Aven Mindcensor)`;
    }
    if (searchCheck.paymentRequired) {
      finalDescription = `${finalDescription ? finalDescription + " " : ""}(Must pay ${searchCheck.paymentRequired.amount} to ${searchCheck.paymentRequired.cardName})`;
    }
    
    socket.emit("librarySearchRequest", {
      gameId,
      cards: searchableCards,
      title: title || "Search Library",
      description: finalDescription || undefined,
      filter,
      maxSelections: maxSelections || 1,
      moveTo: moveTo || "hand",
      shuffleAfter: shuffleAfter !== false,
      searchRestrictions: {
        limitedToTop: searchCheck.limitToTop,
        paymentRequired: searchCheck.paymentRequired,
        triggerEffects: searchCheck.triggerEffects,
        controlledBy: searchCheck.controlledBy,
      },
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
        
        // Handle split-destination effects (Kodama's Reach, Cultivate)
        if (tutorInfo.splitDestination) {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 2,
            moveTo: "split",
            splitDestination: true,
            toBattlefield: tutorInfo.toBattlefield || 1,
            toHand: tutorInfo.toHand || 1,
            entersTapped: tutorInfo.entersTapped,
            shuffleAfter: true,
          });
        } else {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 1,
            moveTo: tutorInfo.destination || "hand",
            shuffleAfter: true,
          });
        }
        
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
        
        // Handle split-destination effects (Kodama's Reach, Cultivate)
        if (tutorInfo.splitDestination) {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 2,
            moveTo: "split",
            splitDestination: true,
            toBattlefield: tutorInfo.toBattlefield || 1,
            toHand: tutorInfo.toHand || 1,
            entersTapped: tutorInfo.entersTapped,
            shuffleAfter: true,
          });
        } else {
          socket.emit("librarySearchRequest", {
            gameId,
            cards: library,
            title: `${cardName}`,
            description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : "Search your library",
            filter,
            maxSelections: tutorInfo.maxSelections || 1,
            moveTo: tutorInfo.destination || "hand",
            shuffleAfter: true,
          });
        }
        
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
    const typeLine = (card?.type_line || "").toLowerCase();
    const isCreature = typeLine.includes("creature");
    
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
    
    // Check for death triggers (Grave Pact, Blood Artist, etc.) if this was a creature
    if (isCreature) {
      try {
        const deathTriggers = getDeathTriggers(game as any, permanent, pid);
        
        for (const trigger of deathTriggers) {
          // Emit a chat message about the trigger
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}_${trigger.source.permanentId}`,
            gameId,
            from: "system",
            message: `⚡ ${trigger.source.cardName} triggers: ${trigger.effect}`,
            ts: Date.now(),
          });
          
          // If this trigger requires sacrifice selection (Grave Pact, Dictate of Erebos, etc.)
          if (trigger.requiresSacrificeSelection) {
            const playersToSacrifice = getPlayersWhoMustSacrifice(game as any, trigger.source.controllerId);
            
            for (const targetPlayerId of playersToSacrifice) {
              // Get creatures controlled by this player
              const creatures = battlefield.filter((p: any) => 
                p?.controller === targetPlayerId && 
                (p?.card?.type_line || "").toLowerCase().includes("creature")
              );
              
              if (creatures.length > 0) {
                // Emit sacrifice selection request to the player
                emitToPlayer(io, targetPlayerId, "sacrificeSelectionRequest", {
                  gameId,
                  triggerId: `sac_${Date.now()}_${trigger.source.permanentId}`,
                  sourceName: trigger.source.cardName,
                  sourceController: trigger.source.controllerId,
                  reason: trigger.effect,
                  creatures: creatures.map((c: any) => ({
                    id: c.id,
                    name: c.card?.name || "Unknown",
                    imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
                    typeLine: c.card?.type_line,
                  })),
                });
                
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}_sac_${targetPlayerId}`,
                  gameId,
                  from: "system",
                  message: `${getPlayerName(game, targetPlayerId)} must sacrifice a creature.`,
                  ts: Date.now(),
                });
              } else {
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}_nosac_${targetPlayerId}`,
                  gameId,
                  from: "system",
                  message: `${getPlayerName(game, targetPlayerId)} has no creatures to sacrifice.`,
                  ts: Date.now(),
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn("[sacrificePermanent] Error processing death triggers:", err);
      }
    }
    
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
      
      // Pay life cost if required (costs are paid immediately when activating)
      if (isTrueFetch) {
        // Ensure life object exists
        if (!(game.state as any).life) {
          (game.state as any).life = {};
        }
        const life = (game.state as any).life[pid] ?? (game as any).life?.[pid] ?? 40;
        const newLife = life - 1;
        
        // Update life in all locations
        (game.state as any).life[pid] = newLife;
        if ((game as any).life) {
          (game as any).life[pid] = newLife;
        }
        
        // Also update player object for UI sync
        const players = game.state?.players || [];
        const player = players.find((p: any) => p.id === pid);
        if (player) {
          (player as any).life = newLife;
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} paid 1 life (${life} → ${newLife}).`,
          ts: Date.now(),
        });
      }
      
      // Tap the permanent (part of cost - paid immediately)
      (permanent as any).tapped = true;
      
      // Remove from battlefield (sacrifice - part of cost, paid immediately)
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
      
      // Build description for the ability
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
      
      // Put the fetch land ability on the stack (per MTG rules, activated abilities use the stack)
      game.state.stack = game.state.stack || [];
      const abilityStackId = `ability_fetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      game.state.stack.push({
        id: abilityStackId,
        type: 'ability',
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: `${searchDescription}, put it onto the battlefield, then shuffle`,
        abilityType: 'fetch-land',
        // Store search parameters for when the ability resolves
        searchParams: {
          filter,
          searchDescription,
          isTrueFetch,
          cardImageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        },
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateFetchland", { 
        playerId: pid, 
        permanentId, 
        abilityId, 
        cardName,
        stackId: abilityStackId,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}${isTrueFetch ? " (paid 1 life)" : ""}, sacrificed it. Ability on the stack.`,
        ts: Date.now(),
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
        (game.state.manaPool[pid] as any)[manaColor]++;
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} tapped ${manaColor} mana.`,
          ts: Date.now(),
        });
      }
      
      // ===== FORBIDDEN ORCHARD TRIGGER =====
      // "When you tap Forbidden Orchard for mana, target opponent creates a 1/1 colorless Spirit creature token."
      const lowerCardName = cardName.toLowerCase();
      if (lowerCardName === 'forbidden orchard') {
        // Get opponents from game.state.players
        const players = game.state?.players || [];
        const opponents = players.filter((p: any) => p?.id != null && p.id !== pid);
        
        if (opponents.length > 0) {
          // TODO: In a real implementation, controller should choose the target opponent
          // For now, give token to first opponent
          const targetOpponent = opponents[0];
          const opponentId = targetOpponent.id;
          
          // Create 1/1 colorless Spirit token for opponent
          const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          game.state.battlefield = game.state.battlefield || [];
          game.state.battlefield.push({
            id: tokenId,
            controller: opponentId,
            owner: opponentId,
            tapped: false,
            summoningSickness: true,
            counters: {},
            card: {
              id: tokenId,
              name: 'Spirit',
              type_line: 'Token Creature — Spirit',
              oracle_text: '',
              mana_cost: '',
              cmc: 0,
              colors: [],
            },
            basePower: 1,
            baseToughness: 1,
            isToken: true,
          });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Forbidden Orchard: ${getPlayerName(game, opponentId)} creates a 1/1 colorless Spirit token.`,
            ts: Date.now(),
          });
        }
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
      
      // Put the loyalty ability on the stack
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: ability.text,
      } as any;
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      
      // Emit stack update
      io.to(gameId).emit("stackUpdate", {
        gameId,
        stack: (game.state.stack || []).map((s: any) => ({
          id: s.id,
          type: s.type,
          name: s.sourceName || s.card?.name || 'Ability',
          controller: s.controller,
          targets: s.targets,
          source: s.source,
          sourceName: s.sourceName,
          description: s.description,
        })),
      });
      
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
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s [${costSign}${loyaltyCost}] ability. (Loyalty: ${currentLoyalty} → ${newLoyalty})`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Handle other activated abilities - put them on the stack
    console.log(`[activateBattlefieldAbility] Processing ability ${abilityId} on ${cardName}`);
    
    // Parse the ability from oracle text if possible
    const abilityParts = abilityId.split('_');
    const abilityIndex = abilityParts.length > 1 ? parseInt(abilityParts[1], 10) : 0;
    
    // Extract ability text by parsing oracle text for activated abilities
    let abilityText = "";
    let requiresTap = false;
    let manaCost = "";
    
    // Parse activated abilities: look for "cost: effect" patterns
    const abilityPattern = /([^:]+):\s*([^.]+\.?)/gi;
    const abilities: { cost: string; effect: string }[] = [];
    let match;
    while ((match = abilityPattern.exec(oracleText)) !== null) {
      const cost = match[1].trim();
      const effect = match[2].trim();
      // Filter out keyword abilities and keep only activated abilities
      if (cost.includes('{') || cost.toLowerCase().includes('tap') || cost.toLowerCase().includes('sacrifice')) {
        abilities.push({ cost, effect });
      }
    }
    
    if (abilityIndex < abilities.length) {
      const ability = abilities[abilityIndex];
      abilityText = ability.effect;
      requiresTap = ability.cost.toLowerCase().includes('{t}') || ability.cost.toLowerCase().includes('tap');
      manaCost = ability.cost;
    } else {
      abilityText = `Activated ability on ${cardName}`;
    }
    
    // Tap the permanent if required
    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
    }
    
    // Check if this is a mana ability (doesn't use the stack)
    // Mana abilities are abilities that produce mana and don't target
    const isManaAbility = /add\s*(\{[wubrgc]\}|mana|one mana|two mana|three mana)/i.test(oracleText);
    
    if (!isManaAbility) {
      // Put the ability on the stack
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: abilityText,
      } as any;
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      
      // Emit stack update
      io.to(gameId).emit("stackUpdate", {
        gameId,
        stack: (game.state.stack || []).map((s: any) => ({
          id: s.id,
          type: s.type,
          name: s.sourceName || s.card?.name || 'Ability',
          controller: s.controller,
          targets: s.targets,
          source: s.source,
          sourceName: s.sourceName,
          description: s.description,
        })),
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability: ${abilityText}`,
        ts: Date.now(),
      });
    } else {
      // Mana ability - handle immediately without stack
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName} for mana.`,
        ts: Date.now(),
      });
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateBattlefieldAbility", { 
      playerId: pid, 
      permanentId, 
      abilityId,
      cardName,
      abilityText,
    });
    
    broadcastGame(io, game, gameId);
  });

  // Library search selection (response to librarySearchRequest from tutors)
  socket.on("librarySearchSelect", ({ gameId, selectedCardIds, moveTo, targetPlayerId }: { 
    gameId: string; 
    selectedCardIds: string[]; 
    moveTo: string;
    targetPlayerId?: string; // For searching opponent's library (Gitaxian Probe, etc.)
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Determine whose library we're searching
    const libraryOwner = targetPlayerId || pid;
    
    const zones = game.state?.zones?.[libraryOwner];
    if (!zones) {
      socket.emit("error", {
        code: "ZONES_NOT_FOUND",
        message: "Player zones not found",
      });
      return;
    }
    
    const movedCardNames: string[] = [];
    
    // Use the game's selectFromLibrary function for supported destinations
    // This properly accesses the internal libraries Map
    if (moveTo === 'hand' || moveTo === 'graveyard' || moveTo === 'exile') {
      // selectFromLibrary handles hand, graveyard, exile
      if (typeof game.selectFromLibrary === 'function') {
        const moved = game.selectFromLibrary(libraryOwner, selectedCardIds, moveTo as any);
        for (const card of moved) {
          movedCardNames.push((card as any).name || "Unknown");
        }
      } else {
        console.error('[librarySearchSelect] game.selectFromLibrary not available');
        socket.emit("error", {
          code: "INTERNAL_ERROR",
          message: "Library selection not available",
        });
        return;
      }
    } else if (moveTo === 'battlefield' || moveTo === 'top') {
      // For 'battlefield' and 'top', we need special handling:
      // - battlefield: selectFromLibrary returns minimal objects, need to get full card data first
      // - top: use applyScry to reorder library and put cards on top
      
      // Get current library for card data lookup (BEFORE modifying)
      const libraryData = typeof game.searchLibrary === 'function' 
        ? game.searchLibrary(libraryOwner, "", 1000) 
        : [];
      
      // Create a map of card data by ID for full card info
      const cardDataById = new Map<string, any>();
      for (const card of libraryData) {
        cardDataById.set(card.id, card);
      }
      
      if (moveTo === 'battlefield') {
        // Use selectFromLibrary to remove from library, then add to battlefield
        if (typeof game.selectFromLibrary === 'function') {
          const moved = game.selectFromLibrary(libraryOwner, selectedCardIds, 'battlefield' as any);
          
          game.state.battlefield = game.state.battlefield || [];
          
          for (const minimalCard of moved) {
            const cardId = (minimalCard as any).id;
            // Get full card data from our lookup or use what we have
            const fullCard = cardDataById.get(cardId) || minimalCard;
            
            movedCardNames.push((fullCard as any).name || (minimalCard as any).name || "Unknown");
            
            const cardName = ((fullCard as any).name || "").toLowerCase();
            
            // Check if this is a shock land that needs a prompt
            const SHOCK_LANDS = new Set([
              "blood crypt", "breeding pool", "godless shrine", "hallowed fountain",
              "overgrown tomb", "sacred foundry", "steam vents", "stomping ground",
              "temple garden", "watery grave"
            ]);
            
            const isShockLand = SHOCK_LANDS.has(cardName);
            
            // Check if this land enters tapped based on oracle text
            const oracleText = ((fullCard as any).oracle_text || "").toLowerCase();
            
            // Lands that always enter tapped (shock lands enter tapped by default, prompt for paying 2 life)
            const entersTapped = 
              isShockLand ||
              (oracleText.includes('enters the battlefield tapped') && 
               !oracleText.includes('unless') && 
               !oracleText.includes('you may pay'));
            
            const permanentId = generateId("perm");
            
            game.state.battlefield.push({
              id: permanentId,
              card: { ...fullCard, zone: 'battlefield' },
              controller: pid,
              owner: libraryOwner,
              tapped: entersTapped,
              counters: {},
            } as any);
            
            // If it's a shock land, emit prompt to player to optionally pay life to untap
            if (isShockLand) {
              const currentLife = (game.state as any)?.life?.[pid] || 40;
              const cardImageUrl = (fullCard as any).image_uris?.small || (fullCard as any).image_uris?.normal;
              
              socket.emit("shockLandPrompt", {
                gameId,
                permanentId,
                cardName: (fullCard as any).name,
                imageUrl: cardImageUrl,
                currentLife,
              });
            }
          }
        } else {
          console.error('[librarySearchSelect] game.selectFromLibrary not available');
        }
      } else {
        // moveTo === 'top': For tutors that put card on top of library (e.g., Vampiric Tutor)
        // Correct sequence: remove card → shuffle library → put card on top
        // This ensures the rest of the library is properly randomized and hidden info is protected
        
        // Get full card data before any operations
        const cardsToTop: any[] = [];
        for (const cardId of selectedCardIds) {
          const card = cardDataById.get(cardId);
          if (card) {
            movedCardNames.push((card as any).name || "Unknown");
            cardsToTop.push({ ...card });
          }
        }
        
        if (typeof game.selectFromLibrary === 'function' && 
            typeof game.shuffleLibrary === 'function' &&
            typeof game.putCardsOnTopOfLibrary === 'function') {
          // Step 1: Remove the selected cards from library
          // Using 'battlefield' as destination just removes them without placing anywhere
          game.selectFromLibrary(libraryOwner, selectedCardIds, 'battlefield' as any);
          
          // Step 2: Shuffle the remaining library (this randomizes the order, protecting hidden info)
          game.shuffleLibrary(libraryOwner);
          
          // Step 3: Put the saved cards on top of the library
          game.putCardsOnTopOfLibrary(libraryOwner, cardsToTop);
          
          console.info('[librarySearchSelect] Cards put on top of library after shuffle:', 
            cardsToTop.map(c => c.name).join(', '));
        } else {
          console.warn('[librarySearchSelect] Required functions not available for top destination');
        }
      }
    }
    
    // Shuffle library after search (standard for tutors)
    // EXCEPTION: Don't shuffle if moveTo === 'top' since shuffling is handled specially above
    if (moveTo !== 'top' && typeof game.shuffleLibrary === "function") {
      game.shuffleLibrary(libraryOwner);
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "librarySearchSelect", {
      playerId: pid,
      libraryOwner,
      selectedCardIds,
      moveTo,
    });
    
    const ownerName = libraryOwner === pid ? "their" : `${getPlayerName(game, libraryOwner)}'s`;
    const destName = moveTo === 'hand' ? 'hand' : moveTo === 'battlefield' ? 'the battlefield' : moveTo === 'top' ? 'the top of their library' : 'graveyard';
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} searched ${ownerName} library and put ${movedCardNames.join(", ")} to ${destName}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  /**
   * Split-destination library search selection (for Kodama's Reach, Cultivate, etc.)
   * 
   * Player selects cards from library, then assigns each to either battlefield or hand.
   */
  socket.on("librarySearchSplitSelect", ({ gameId, battlefieldCardIds, handCardIds, entersTapped }: { 
    gameId: string; 
    battlefieldCardIds: string[];
    handCardIds: string[];
    entersTapped?: boolean;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    const zones = game.state?.zones?.[pid];
    if (!zones) {
      socket.emit("error", {
        code: "ZONES_NOT_FOUND",
        message: "Player zones not found",
      });
      return;
    }
    
    const movedToBattlefield: string[] = [];
    const movedToHand: string[] = [];
    
    // Get current library for card data lookup (BEFORE modifying)
    const libraryData = typeof game.searchLibrary === 'function' 
      ? game.searchLibrary(pid, "", 1000) 
      : [];
    
    // Create a map of card data by ID for full card info
    const cardDataById = new Map<string, any>();
    for (const card of libraryData) {
      cardDataById.set(card.id, card);
    }
    
    // Combine all card IDs for removal from library
    const allSelectedIds = [...battlefieldCardIds, ...handCardIds];
    
    if (typeof game.selectFromLibrary === 'function') {
      // First, put cards that go to hand
      if (handCardIds.length > 0) {
        const movedHand = game.selectFromLibrary(pid, handCardIds, 'hand' as any);
        for (const card of movedHand) {
          movedToHand.push((card as any).name || "Unknown");
        }
      }
      
      // Then, put cards on battlefield (need special handling for tapped state)
      if (battlefieldCardIds.length > 0) {
        // Get full card data before removal
        const battlefieldCards = battlefieldCardIds.map(id => cardDataById.get(id)).filter(Boolean);
        
        // Remove from library by moving to a temp location
        game.selectFromLibrary(pid, battlefieldCardIds, 'battlefield' as any);
        
        game.state.battlefield = game.state.battlefield || [];
        
        for (const fullCard of battlefieldCards) {
          movedToBattlefield.push((fullCard as any).name || "Unknown");
          
          const permanentId = generateId("perm");
          
          // For Kodama's Reach/Cultivate, the land enters tapped
          const shouldEnterTapped = entersTapped ?? true;
          
          game.state.battlefield.push({
            id: permanentId,
            card: { ...fullCard, zone: 'battlefield' },
            controller: pid,
            owner: pid,
            tapped: shouldEnterTapped,
            counters: {},
          } as any);
        }
      }
    } else {
      console.error('[librarySearchSplitSelect] game.selectFromLibrary not available');
      socket.emit("error", {
        code: "INTERNAL_ERROR",
        message: "Library selection not available",
      });
      return;
    }
    
    // Shuffle library after search
    if (typeof game.shuffleLibrary === "function") {
      game.shuffleLibrary(pid);
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "librarySearchSplitSelect", {
      playerId: pid,
      battlefieldCardIds,
      handCardIds,
      entersTapped,
    });
    
    // Build chat message
    const messages: string[] = [];
    if (movedToBattlefield.length > 0) {
      messages.push(`${movedToBattlefield.join(", ")} to the battlefield${entersTapped ? ' tapped' : ''}`);
    }
    if (movedToHand.length > 0) {
      messages.push(`${movedToHand.join(", ")} to their hand`);
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} searched their library and put ${messages.join(" and ")}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  /**
   * Entrapment Maneuver sacrifice selection
   * When target player chooses which attacking creature to sacrifice
   */
  socket.on("entrapmentManeuverSelect", ({ gameId, creatureId }: {
    gameId: string;
    creatureId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Check if there's a pending Entrapment Maneuver for this player
    const pending = (game.state as any)?.pendingEntrapmentManeuver?.[pid];
    if (!pending) {
      socket.emit("error", {
        code: "NO_PENDING_MANEUVER",
        message: "No Entrapment Maneuver pending for you",
      });
      return;
    }
    
    // Find the creature on battlefield
    const battlefield = game.state?.battlefield || [];
    const creature = battlefield.find((p: any) => p?.id === creatureId && p?.controller === pid);
    
    if (!creature) {
      socket.emit("error", {
        code: "CREATURE_NOT_FOUND",
        message: "Creature not found or not controlled by you",
      });
      return;
    }
    
    // Verify the creature is attacking
    if (!creature.attacking) {
      socket.emit("error", {
        code: "NOT_ATTACKING",
        message: "That creature is not attacking",
      });
      return;
    }
    
    const creatureCard = (creature as any).card || {};
    const creatureName = (creatureCard as any).name || "Unknown Creature";
    
    // Get the creature's toughness for token creation
    // Handle variable toughness values like '*' or 'X' by treating them as 0
    const toughnessStr = String((creature as any).baseToughness ?? (creatureCard as any).toughness ?? "0");
    let toughness: number;
    if (toughnessStr === '*' || toughnessStr.toLowerCase() === 'x') {
      // Variable toughness - use any counters or modifiers to determine value
      const plusCounters = ((creature as any).counters?.['+1/+1']) || 0;
      const minusCounters = ((creature as any).counters?.['-1/-1']) || 0;
      toughness = plusCounters - minusCounters;
    } else {
      toughness = parseInt(toughnessStr.replace(/\D.*$/, ''), 10) || 0;
    }
    
    // Apply any toughness modifiers
    if ((creature as any).tempToughnessMod) {
      toughness += (creature as any).tempToughnessMod;
    }
    
    // Ensure toughness is at least 0 for token creation
    toughness = Math.max(0, toughness);
    
    // Get the caster of Entrapment Maneuver (who gets the tokens)
    const caster = pending.caster as string;
    
    // Sacrifice the creature (move to graveyard)
    const idx = battlefield.findIndex((p: any) => p.id === creatureId);
    if (idx >= 0) {
      battlefield.splice(idx, 1);
      
      // Move to owner's graveyard
      const owner = creature.owner || creature.controller;
      const zones = (game.state as any).zones = (game.state as any).zones || {};
      const ownerZone = zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 };
      ownerZone.graveyard = ownerZone.graveyard || [];
      ownerZone.graveyard.push({ ...creatureCard, zone: "graveyard" });
      ownerZone.graveyardCount = ownerZone.graveyard.length;
    }
    
    // Create Soldier tokens for the caster equal to the sacrificed creature's toughness
    if (toughness > 0) {
      game.state.battlefield = game.state.battlefield || [];
      
      for (let i = 0; i < toughness; i++) {
        const tokenId = generateId("tok");
        game.state.battlefield.push({
          id: tokenId,
          controller: caster,
          owner: caster,
          tapped: false,
          counters: {},
          isToken: true,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: tokenId,
            name: "Soldier",
            type_line: "Token Creature — Soldier",
            power: "1",
            toughness: "1",
            zone: "battlefield",
          },
        } as any);
      }
      
      console.log(`[entrapmentManeuverSelect] Created ${toughness} Soldier token(s) for ${caster}`);
    }
    
    // Clear the pending Entrapment Maneuver
    delete (game.state as any).pendingEntrapmentManeuver[pid];
    if (Object.keys((game.state as any).pendingEntrapmentManeuver).length === 0) {
      delete (game.state as any).pendingEntrapmentManeuver;
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "entrapmentManeuverSelect", {
      playerId: pid,
      caster,
      sacrificedCreatureId: creatureId,
      sacrificedCreatureName: creatureName,
      tokensCreated: toughness,
    });
    
    // Emit chat messages
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${creatureName} (toughness ${toughness}).`,
      ts: Date.now(),
    });
    
    if (toughness > 0) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}_tokens`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, caster)} created ${toughness} 1/1 white Soldier creature token${toughness !== 1 ? 's' : ''}.`,
        ts: Date.now(),
      });
    }
    
    broadcastGame(io, game, gameId);
  });

  // Library search cancel
  socket.on("librarySearchCancel", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Just shuffle library (most tutor effects require shuffle even if not finding)
    if (typeof game.shuffleLibrary === "function") {
      game.shuffleLibrary(pid);
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} finished searching their library.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  // Target selection confirmation
  socket.on("targetSelectionConfirm", ({ gameId, effectId, selectedTargetIds }: {
    gameId: string;
    effectId?: string;
    selectedTargetIds: string[];
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Store targets for the pending effect/spell
    // This will be used when the spell/ability resolves
    game.state.pendingTargets = game.state.pendingTargets || {};
    game.state.pendingTargets[effectId || 'default'] = {
      playerId: pid,
      targetIds: selectedTargetIds,
    };
    
    // Check if this is a spell cast that was waiting for targets
    // effectId format is "cast_${cardId}_${timestamp}"
    if (effectId && effectId.startsWith('cast_')) {
      const parts = effectId.split('_');
      if (parts.length >= 2) {
        // cardId can contain underscores, so we join all parts except first and last
        const cardId = parts.slice(1, -1).join('_');
        
        console.log(`[targetSelectionConfirm] Spell cast with targets: cardId=${cardId}, targets=${selectedTargetIds.join(',')}`);
        
        // Now cast the spell with the selected targets
        if (typeof game.applyEvent === 'function') {
          game.applyEvent({ type: "castSpell", playerId: pid, cardId, targets: selectedTargetIds });
          console.log(`[targetSelectionConfirm] Spell ${cardId} cast with targets via applyEvent`);
        }
      }
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "targetSelectionConfirm", {
      playerId: pid,
      effectId,
      selectedTargetIds,
    });
    
    console.log(`[targetSelectionConfirm] Player ${pid} selected targets:`, selectedTargetIds);
    
    broadcastGame(io, game, gameId);
  });

  // Target selection cancel
  socket.on("targetSelectionCancel", ({ gameId, effectId }: {
    gameId: string;
    effectId?: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    
    // Cancel the spell/effect if targets are required but not provided
    // For now, just log and broadcast
    console.log(`[targetSelectionCancel] Player ${pid} cancelled target selection for effect ${effectId}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} cancelled target selection.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });

  // ============================================================================
  // Sacrifice Selection (for Grave Pact, Dictate of Erebos, etc.)
  // ============================================================================

  /**
   * Handle sacrifice selection response from a player
   * This is used when a Grave Pact-style effect requires opponents to sacrifice
   */
  socket.on("sacrificeSelected", ({ 
    gameId, 
    triggerId, 
    permanentId 
  }: { 
    gameId: string; 
    triggerId: string; 
    permanentId: string;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", {
        code: "GAME_NOT_FOUND",
        message: "Game not found",
      });
      return;
    }

    const battlefield = game.state?.battlefield || [];
    
    // Find the permanent to sacrifice
    const permIndex = battlefield.findIndex((p: any) => 
      p?.id === permanentId && p?.controller === pid
    );
    
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
    
    appendEvent(gameId, (game as any).seq ?? 0, "sacrificeSelected", { 
      playerId: pid, 
      permanentId,
      triggerId,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${cardName} to the triggered ability.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  });
}