/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: commander color-identity scoring, library/deck load for pregame,
 * and autoSelectAICommander (findBestCommanders, ensureAIPreGameDeckLoaded, and
 * the helpers they close over).
 *
 * Public entry symbols: autoSelectAICommander, ensureAIPreGameDeckLoaded,
 * getAILibraryCards, persistAIPlayerDeckSource, resolveAIDeckEntries.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import { getDeck } from "../../db/decks.js";
import { resolveDeckList } from "../../services/deckImport.js";
import { parseDecklist } from "../../services/scryfall.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util.js";
import {
  COLOR_IDENTITY_MAP,
  INITIAL_HAND_SIZE,
  MAX_LIBRARY_SEARCH_LIMIT,
} from "./aiConstants.js";
import { getPersistedAIPlayerRuntimeData } from "./aiPlayerRuntimeData.js";

/**
 * Extract color identity from a card's mana cost and oracle text
 */
function extractColorIdentity(card: any): string[] {
  const colors = new Set<string>();

  // Extract from mana cost
  const manaCost = card.mana_cost || '';
  for (const colorSymbol of Object.keys(COLOR_IDENTITY_MAP)) {
    if (manaCost.includes(colorSymbol)) {
      colors.add(colorSymbol);
    }
  }

  // Extract from color_identity if available (Scryfall provides this)
  if (Array.isArray(card.color_identity)) {
    for (const c of card.color_identity) {
      colors.add(c);
    }
  }

  // Extract from oracle text (for hybrid mana and ability costs)
  const oracleText = card.oracle_text || '';
  for (const colorSymbol of Object.keys(COLOR_IDENTITY_MAP)) {
    if (oracleText.includes(`{${colorSymbol}}`)) {
      colors.add(colorSymbol);
    }
  }

  return Array.from(colors);
}

/**
 * Check if a card is a valid commander
 * Valid commanders include:
 * - Legendary creatures
 * - Planeswalkers (or other cards) that explicitly say "can be your commander"
 */
function isValidCommander(card: any): boolean {
  if (!card) return false;
  const typeLine = String(card.type_line || '').toLowerCase();
  const oracleText = String(card.oracle_text || '').toLowerCase();

  const isLegendary = typeLine.includes('legendary');
  const isCreature = typeLine.includes('creature');
  const isPlaneswalker = typeLine.includes('planeswalker');
  const isBackgroundCard = typeLine.includes('background');

  if (isLegendary && isCreature) return true;

  // Some planeswalkers and special cards are commanders via explicit text.
  if ((isPlaneswalker || !isBackgroundCard) && oracleText.includes('can be your commander')) {
    return true;
  }

  return false;
}

/**
 * Check if a commander has Partner (or Partner With).
 */
function hasPartner(card: any): boolean {
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  return oracleText.includes('partner');
}

/**
 * Check if a commander has "Choose a Background".
 */
function hasBackground(card: any): boolean {
  const oracleText = String(card?.oracle_text || '').toLowerCase();
  return oracleText.includes('choose a background');
}

/**
 * Calculate the deck's overall color identity based on all cards.
 */
function calculateDeckColorIdentity(cards: any[]): Set<string> {
  const deckColors = new Set<string>();
  for (const card of cards) {
    for (const color of extractColorIdentity(card)) {
      deckColors.add(color);
    }
  }
  return deckColors;
}

/**
 * Calculate how well commanders match the deck's color identity
 * Returns a score based on:
 * - How many deck colors are covered by commanders
 * - How many commander colors are NOT in the deck (penalty)
 * Higher score is better
 */
function calculateColorMatchScore(commanders: any[], deckColors: Set<string>): { score: number; coverage: number; extraColors: number } {
  const commanderColors = new Set<string>();
  for (const commander of commanders) {
    const colors = extractColorIdentity(commander);
    for (const color of colors) {
      commanderColors.add(color);
    }
  }

  // Count how many deck colors are covered
  let coverage = 0;
  for (const color of deckColors) {
    if (commanderColors.has(color)) {
      coverage++;
    }
  }

  // Count how many extra colors the commander has (not in deck)
  let extraColors = 0;
  for (const color of commanderColors) {
    if (!deckColors.has(color)) {
      extraColors++;
    }
  }

  // Score: prioritize coverage, penalize extra colors
  // Perfect match: coverage = deckColors.size, extraColors = 0
  const score = (coverage * 10) - (extraColors * 5);

  return { score, coverage, extraColors };
}

/**
 * Check if commanders' combined color identity exactly matches the deck's color identity
 * In Commander/EDH, the deck can only contain cards within the commander's color identity
 * Returns true if the identities match exactly, false otherwise
 */
function commanderIdentityMatchesDeck(commanders: any[], deckColors: Set<string>): boolean {
  const commanderColors = new Set<string>();
  for (const commander of commanders) {
    const colors = extractColorIdentity(commander);
    for (const color of colors) {
      commanderColors.add(color);
    }
  }
  
  // Check if sizes match first
  if (commanderColors.size !== deckColors.size) {
    return false;
  }
  
  // Check if all deck colors are in commander identity
  for (const color of deckColors) {
    if (!commanderColors.has(color)) {
      return false;
    }
  }
  
  // Check if all commander colors are in deck identity (no extra colors)
  for (const color of commanderColors) {
    if (!deckColors.has(color)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Find the best commander(s) from a deck's card list
 * Returns 1 or 2 commanders based on partner/background rules
 * 
 * Priority order:
 * 1. Check first 1-2 cards in decklist (commanders are typically listed first)
 *    - Validate that they exactly match the deck's color identity
 * 2. Look for partner pairs that exactly match deck colors
 * 3. Look for commander+background pairs that exactly match
 * 4. Fall back to first valid commander candidate (with mismatch warning)
 * 
 * Also calculates combined color identity of the selected commander(s)
 */
function findBestCommanders(cards: any[]): { commanders: any[]; colorIdentity: string[]; exactMatch: boolean } {
  // Find all valid commander candidates
  const candidates = cards.filter(isValidCommander);
  
  if (candidates.length === 0) {
    debugWarn(2, '[AI] No valid commander candidates found in deck');
    return { commanders: [], colorIdentity: [], exactMatch: false };
  }
  
  // Calculate the deck's overall color identity
  const deckColors = calculateDeckColorIdentity(cards);
  debug(1, '[AI] Deck color identity:', Array.from(deckColors).join(''));
  
  // Find partner candidates and background candidates
  const partnerCandidates = candidates.filter(hasPartner);
  const backgroundCandidates = cards.filter(c => (c.type_line || '').toLowerCase().includes('background'));
  const chooseBackgroundCandidates = candidates.filter(hasBackground);
  
  let selectedCommanders: any[] = [];
  
  // Priority 1: Check first 2 cards - commanders are often at the start of decklists
  const firstTwoCards = cards.slice(0, 2);
  const firstTwoCandidates = firstTwoCards.filter(isValidCommander);
  
  if (firstTwoCandidates.length > 0) {
    // Check if first two cards are both partners
    if (firstTwoCandidates.length === 2 && 
        hasPartner(firstTwoCandidates[0]) && hasPartner(firstTwoCandidates[1])) {
      // Validate that these partners' identity exactly matches the deck's color identity
      const identityMatches = commanderIdentityMatchesDeck(firstTwoCandidates, deckColors);
      if (identityMatches) {
        // Perfect match - use these commanders
        selectedCommanders = firstTwoCandidates;
        debug(1, '[AI] Selected partner commanders from first 2 cards (exact identity match):', selectedCommanders.map(c => c.name));
      } else {
        // Partners' identity doesn't match deck - look for better options
        const commanderColors = new Set<string>();
        firstTwoCandidates.forEach(c => extractColorIdentity(c).forEach(col => commanderColors.add(col)));
        debugWarn(1, '[AI] First 2 partner commanders identity', Array.from(commanderColors).join(''), 'does not match deck identity', Array.from(deckColors).join(''));
        // Fall through to Priority 2 to find better partners
      }
    }
    // Check if first two cards are commander + background pair
    else if (firstTwoCandidates.length >= 1 && selectedCommanders.length === 0) {
      const firstCard = firstTwoCandidates[0];
      const secondCard = firstTwoCards[1];
      
      if (hasBackground(firstCard) && secondCard && 
          (secondCard.type_line || '').toLowerCase().includes('background')) {
        // Check if this background pair matches deck identity
        const identityMatches = commanderIdentityMatchesDeck([firstCard, secondCard], deckColors);
        if (identityMatches) {
          selectedCommanders = [firstCard, secondCard];
          debug(1, '[AI] Selected commander + background from first 2 cards (exact identity match):', selectedCommanders.map(c => c.name));
        } else {
          debugWarn(2, '[AI] First 2 cards (commander + background) identity does not match deck identity');
        }
      } else if (secondCard && isValidCommander(secondCard) &&
                 (secondCard.type_line || '').toLowerCase().includes('background') && 
                 hasBackground(firstCard)) {
        // Check if this background pair matches deck identity
        const identityMatches = commanderIdentityMatchesDeck([firstCard, secondCard], deckColors);
        if (identityMatches) {
          selectedCommanders = [firstCard, secondCard];
          debug(1, '[AI] Selected commander + background from first 2 cards (exact identity match):', selectedCommanders.map(c => c.name));
        } else {
          debugWarn(2, '[AI] First 2 cards (background + commander) identity does not match deck identity');
        }
      } else {
        // Validate that the first card's identity exactly matches the deck's color identity
        // Safe to access firstCard since we checked length >= 1 above
        const identityMatches = commanderIdentityMatchesDeck([firstCard], deckColors);
        if (identityMatches) {
          // First card's identity matches deck - use it
          selectedCommanders = [firstCard];
          debug(1, `[AI] Selected single commander from first card (exact identity match): ${firstCard.name}`);
        } else {
          // First card's identity doesn't match deck
          // Continue searching for better options: partner pairs OR single commanders with exact match
          const firstCardColors = extractColorIdentity(firstCard);
          debugWarn(1, `[AI] First commander identity [${firstCardColors.join('')}] does not match deck identity [${Array.from(deckColors).join('')}] - searching for better options`);
          // Fall through to Priority 2 (partners), Priority 3 (backgrounds), or Priority 4 (single with exact match)
        }
      }
    }
  }
  
  // Priority 2: If no commanders found, find partner pair with exact identity match
  if (selectedCommanders.length === 0 && partnerCandidates.length >= 2) {
    // Find the partner pair whose identity exactly matches the deck
    let exactMatchPair: any[] = [];
    let bestPair: any[] = [];
    let bestCoverage = 0;
    
    for (let i = 0; i < partnerCandidates.length; i++) {
      for (let j = i + 1; j < partnerCandidates.length; j++) {
        const pair = [partnerCandidates[i], partnerCandidates[j]];
        
        // Check for exact identity match first
        if (commanderIdentityMatchesDeck(pair, deckColors)) {
          exactMatchPair = pair;
          break; // Found exact match, no need to continue
        }
        
        // Track best match score as fallback
        const matchInfo = calculateColorMatchScore(pair, deckColors);
        if (matchInfo.score > bestCoverage) {
          bestCoverage = matchInfo.score;
          bestPair = pair;
        }
      }
      if (exactMatchPair.length === 2) {
        break; // Found exact match, stop searching
      }
    }
    
    if (exactMatchPair.length === 2) {
      selectedCommanders = exactMatchPair;
      debug(1, `[AI] Selected partner commanders with exact identity match:`, selectedCommanders.map(c => c.name));
    } else if (bestPair.length === 2) {
      // Use best match even if not exact (in case of 1 wrong card in deck)
      selectedCommanders = bestPair;
      const matchInfo = calculateColorMatchScore(bestPair, deckColors);
      const pairColors = new Set<string>();
      bestPair.forEach(c => extractColorIdentity(c).forEach(col => pairColors.add(col)));
      debugWarn(1, `[AI] Selected partner commanders with closest match (score: ${matchInfo.score}, coverage: ${matchInfo.coverage}/${deckColors.size}, extra colors: ${matchInfo.extraColors}):`, selectedCommanders.map(c => c.name), `- Commander identity [${Array.from(pairColors).join('')}] vs Deck identity [${Array.from(deckColors).join('')}]`);
    } else {
      debugWarn(1, `[AI] No partner pair found for deck colors [${Array.from(deckColors).join('')}]`);
    }
  }
  
  // Priority 3: Check for background pair (exact match preferred, or closest match)
  if (selectedCommanders.length === 0 && 
      chooseBackgroundCandidates.length > 0 && backgroundCandidates.length > 0) {
    // Try each background combination to find best match
    let exactMatchPair: any[] = [];
    let bestPair: any[] = [];
    let bestScore = -Infinity;
    
    for (const cmdWithBackground of chooseBackgroundCandidates) {
      for (const background of backgroundCandidates) {
        const pair = [cmdWithBackground, background];
        
        if (commanderIdentityMatchesDeck(pair, deckColors)) {
          exactMatchPair = pair;
          break;
        }
        
        const matchInfo = calculateColorMatchScore(pair, deckColors);
        if (matchInfo.score > bestScore) {
          bestScore = matchInfo.score;
          bestPair = pair;
        }
      }
      if (exactMatchPair.length === 2) break;
    }
    
    if (exactMatchPair.length === 2) {
      selectedCommanders = exactMatchPair;
      debug(1, '[AI] Selected commander + background with exact identity match:', selectedCommanders.map(c => c.name));
    } else if (bestPair.length === 2) {
      selectedCommanders = bestPair;
      const matchInfo = calculateColorMatchScore(bestPair, deckColors);
      const pairColors = new Set<string>();
      bestPair.forEach(c => extractColorIdentity(c).forEach(col => pairColors.add(col)));
      debugWarn(1, `[AI] Selected commander + background with closest match (score: ${matchInfo.score}, coverage: ${matchInfo.coverage}/${deckColors.size}, extra colors: ${matchInfo.extraColors}):`, selectedCommanders.map(c => c.name), `- Identity [${Array.from(pairColors).join('')}] vs Deck [${Array.from(deckColors).join('')}]`);
    } else {
      debugWarn(1, `[AI] No background pair found for deck colors [${Array.from(deckColors).join('')}]`);
    }
  }
  
  // Priority 4: Find single commander (exact match preferred, or closest match)
  // This includes commanders with full color identity (e.g., 4-color commanders like Atraxa, Omnath)
  if (selectedCommanders.length === 0) {
    let exactMatchCommander: any = null;
    let bestCommander: any = null;
    let bestScore = -Infinity;
    
    for (const candidate of candidates) {
      // Check for exact identity match
      if (commanderIdentityMatchesDeck([candidate], deckColors)) {
        exactMatchCommander = candidate;
        break; // Found exact match, stop searching
      }
      
      // Track best match score
      const matchInfo = calculateColorMatchScore([candidate], deckColors);
      if (matchInfo.score > bestScore) {
        bestScore = matchInfo.score;
        bestCommander = candidate;
      }
    }
    
    if (exactMatchCommander) {
      selectedCommanders = [exactMatchCommander];
      const commanderColors = extractColorIdentity(exactMatchCommander);
      debug(1, `[AI] Selected single commander with exact identity match [${commanderColors.join('')}]: ${exactMatchCommander.name}`);
    } else if (bestCommander) {
      selectedCommanders = [bestCommander];
      const matchInfo = calculateColorMatchScore([bestCommander], deckColors);
      const commanderColors = extractColorIdentity(bestCommander);
      debugWarn(1, `[AI] Selected single commander with closest match (score: ${matchInfo.score}, coverage: ${matchInfo.coverage}/${deckColors.size}, extra colors: ${matchInfo.extraColors}) [${commanderColors.join('')}]: ${bestCommander.name} - Deck identity [${Array.from(deckColors).join('')}]`);
    } else {
      // Ultimate fallback - shouldn't happen if there are any candidates
      if (candidates.length > 0) {
        selectedCommanders = [candidates[0]];
        const fallbackColors = extractColorIdentity(candidates[0]);
        debugError(1, `[AI] Using fallback commander (no valid candidates) [${fallbackColors.join('')}]: ${candidates[0]?.name} - Deck identity [${Array.from(deckColors).join('')}]`);
      }
    }
  }
  
  // Check if we found an exact match
  const exactMatch = selectedCommanders.length > 0 && commanderIdentityMatchesDeck(selectedCommanders, deckColors);
  
  // Calculate combined color identity
  const colorIdentity = new Set<string>();
  for (const commander of selectedCommanders) {
    for (const color of extractColorIdentity(commander)) {
      colorIdentity.add(color);
    }
  }
  
  return {
    commanders: selectedCommanders,
    colorIdentity: Array.from(colorIdentity),
    exactMatch,
  };
}

export function getAILibraryCards(game: any, playerId: PlayerID): any[] {
  if (!game || !game.state) return [];

  try {
    if (typeof (game as any).searchLibrary === 'function') {
      const cards = (game as any).searchLibrary(playerId, '', MAX_LIBRARY_SEARCH_LIMIT) || [];
      if (Array.isArray(cards) && cards.length > 0) {
        return cards;
      }
    }
  } catch {
    // Fall through to direct storage checks.
  }

  try {
    const libraries = (game as any).libraries;
    if (libraries && typeof libraries.get === 'function') {
      const cards = libraries.get(playerId);
      if (Array.isArray(cards) && cards.length > 0) {
        return cards;
      }
    }
  } catch {
    // Fall through to zone fallback.
  }

  const zones = game.state?.zones?.[playerId] as any;
  return Array.isArray(zones?.library) ? zones.library : [];
}

export function persistAIPlayerDeckSource(
  playerInState: any,
  options: {
    deckName?: string;
    deckId?: string | null;
    deckText?: string;
  },
): void {
  if (!playerInState) return;

  if (typeof options.deckName === 'string' && options.deckName.trim()) {
    playerInState.deckName = options.deckName;
  }

  if (typeof options.deckId === 'string' && options.deckId.trim()) {
    playerInState.deckId = options.deckId;
  }

  if (typeof options.deckText === 'string' && options.deckText.trim()) {
    playerInState.deckText = options.deckText;
  }
}

export async function resolveAIDeckEntries(
  deckEntries: Array<{ name: string; count: number }>,
  context: {
    gameId: string;
    playerId: PlayerID;
    deckName?: string;
    logPrefix: string;
  },
): Promise<Awaited<ReturnType<typeof resolveDeckList>>> {
  let lastStatusMessage = '';
  const resolution = await resolveDeckList(deckEntries, {
    uniqueInstanceIds: true,
    onStatus: (status) => {
      if (!status.message || status.message === lastStatusMessage) return;
      debug(1, `${context.logPrefix} Deck resolution`, {
        gameId: context.gameId,
        playerId: context.playerId,
        deckName: context.deckName,
        phase: status.phase,
        source: status.source,
        completed: status.completed,
        total: status.total,
        message: status.message,
      });
      lastStatusMessage = status.message;
    },
  });

  debug(1, `${context.logPrefix} Deck resolution summary`, {
    gameId: context.gameId,
    playerId: context.playerId,
    deckName: context.deckName,
    resolvedCount: resolution.resolvedCards.length,
    missingCount: resolution.missing.length,
    usedLocalFallback: resolution.usedLocalFallback,
    sourcesUsed: resolution.sourcesUsed,
    scryfallTimedOut: resolution.scryfallTimedOut,
  });

  return resolution;
}

export async function ensureAIPreGameDeckLoaded(gameId: string, playerId: PlayerID): Promise<boolean> {
  const runtime = getPersistedAIPlayerRuntimeData(gameId, playerId);
  if (!runtime?.game?.state) {
    return false;
  }

  const existingLibrary = getAILibraryCards(runtime.game, playerId);
  if (existingLibrary.length > 0) {
    return true;
  }

  const playerInState = runtime.playerInState as any;
  const rawDeckText = typeof playerInState?.deckText === 'string' ? playerInState.deckText.trim() : '';
  const rawDeckId = typeof playerInState?.deckId === 'string' ? playerInState.deckId.trim() : '';
  const deckName = typeof playerInState?.deckName === 'string' ? playerInState.deckName : undefined;

  let deckEntries: Array<{ name: string; count: number }> = [];
  if (rawDeckText) {
    try {
      deckEntries = parseDecklist(rawDeckText);
      debug(1, '[AI] Restoring AI deck from persisted deck text:', {
        gameId,
        playerId,
        deckName,
        entryCount: deckEntries.length,
      });
    } catch (err) {
      debugWarn(1, '[AI] Failed to parse persisted AI deck text during pre-game recovery:', {
        gameId,
        playerId,
        deckName,
      }, err);
      return false;
    }
  } else if (rawDeckId) {
    try {
      const deck = getDeck(rawDeckId);
      if (!deck?.entries?.length) {
        debugWarn(1, '[AI] Persisted AI deck id could not be loaded during pre-game recovery:', {
          gameId,
          playerId,
          deckId: rawDeckId,
        });
        return false;
      }

      deckEntries = deck.entries;
      debug(1, '[AI] Restoring AI deck from saved deck id:', {
        gameId,
        playerId,
        deckId: rawDeckId,
        deckName: deck.name,
        entryCount: deckEntries.length,
      });
    } catch (err) {
      debugWarn(1, '[AI] Failed to load persisted AI deck during pre-game recovery:', {
        gameId,
        playerId,
        deckId: rawDeckId,
      }, err);
      return false;
    }
  } else {
    debugWarn(1, '[AI] No persisted deck source available for AI pre-game recovery:', {
      gameId,
      playerId,
      deckName,
    });
    return false;
  }

  if (deckEntries.length === 0) {
    return false;
  }

  let resolution: Awaited<ReturnType<typeof resolveDeckList>>;
  try {
    resolution = await resolveAIDeckEntries(deckEntries, {
      gameId,
      playerId,
      deckName,
      logPrefix: '[AI] Restoring persisted AI deck',
    });
  } catch (err) {
    debugWarn(1, '[AI] Failed to resolve persisted AI deck cards during pre-game recovery:', {
      gameId,
      playerId,
      deckName,
    }, err);
    return false;
  }

  const resolvedCards = resolution.resolvedCards;
  const missing = resolution.missing;

  if (resolvedCards.length === 0) {
    debugWarn(1, '[AI] Persisted AI deck recovery resolved zero cards:', {
      gameId,
      playerId,
      deckName,
      missingCount: missing.length,
    });
    return false;
  }

  if (typeof (runtime.game as any).importDeckResolved === 'function') {
    (runtime.game as any).importDeckResolved(playerId, resolvedCards);
  } else {
    runtime.game.state.zones = runtime.game.state.zones || {};
    (runtime.game.state.zones as any)[playerId] = {
      hand: [],
      handCount: 0,
      libraryCount: resolvedCards.length,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    };
  }

  playerInState.deckName = deckName;
  if (rawDeckId) playerInState.deckId = rawDeckId;
  if (rawDeckText) playerInState.deckText = rawDeckText;

  try {
    await appendEvent(gameId, (runtime.game as any).seq || 0, 'deckImportResolved', {
      playerId,
      cards: resolvedCards,
    });
  } catch (err) {
    debugWarn(1, '[AI] Failed to persist recovered AI deck import event:', {
      gameId,
      playerId,
      deckName,
    }, err);
  }

  debug(1, '[AI] Restored AI deck during pre-game recovery:', {
    gameId,
    playerId,
    deckName,
    resolvedCount: resolvedCards.length,
    missingCount: missing.length,
  });

  return true;
}

/**
 * Auto-select and set commander for an AI player based on their deck
 * This is called after deck loading to ensure the AI can start the game
 */
export async function autoSelectAICommander(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<boolean> {
  try {
    const game = ensureGame(gameId);
    if (!game || !game.state) {
      debugWarn(2, '[AI] autoSelectAICommander: game not found', { gameId, playerId });
      return false;
    }
    
    // Check if player already has a commander - if so, don't select again
    const commanderInfo = game.state.commandZone?.[playerId];
    const hasCommander = commanderInfo?.commanderIds?.length > 0;
    if (hasCommander) {
      debug(1, '[AI] autoSelectAICommander: player already has commander, skipping', { 
        gameId, 
        playerId,
        commanderIds: commanderInfo?.commanderIds 
      });
      return true; // Return true since commander is already set
    }
    
    // Get the AI player's library (deck)
    // The library is stored in ctx.libraries Map via importDeckResolved.
    // Use searchLibrary with empty query to get all cards (up to limit).
    const library = getAILibraryCards(game, playerId);
    
    if (library.length === 0) {
      debugWarn(2, '[AI] autoSelectAICommander: no cards in library', { gameId, playerId });
      return false;
    }
    
    // Validate that library cards have required data (name, type_line, etc.)
    const cardsForSelection = library.filter((c: any) => c && c.name && c.type_line);
    if (cardsForSelection.length === 0) {
      debugError(1, '[AI] autoSelectAICommander: library has cards but they lack required data', {
        gameId,
        playerId,
        totalCards: library.length,
      });
      return false;
    }

    const { commanders, colorIdentity, exactMatch } = findBestCommanders(cardsForSelection);
    if (!commanders || commanders.length === 0) {
      debugWarn(1, '[AI] autoSelectAICommander: no commander selected', { gameId, playerId });
      return false;
    }

    // Emit a warning if the commander identity doesn't exactly match the deck identity.
    // This should be rare; it usually indicates malformed/incorrect deck data.
    if (!exactMatch) {
      const deckColors = calculateDeckColorIdentity(cardsForSelection);
      const deckIdentityStr = Array.from(deckColors).join('');

      const commanderColors = new Set<string>();
      for (const commander of commanders) {
        for (const color of extractColorIdentity(commander)) {
          commanderColors.add(color);
        }
      }
      const commanderIdentityStr = Array.from(commanderColors).join('');

      const commanderNamesForMessage = commanders.map((c: any) => c.name).join(', ');

      io.to(gameId).emit('warning', {
        code: 'COMMANDER_IDENTITY_MISMATCH',
        message: `AI commander identity [${commanderIdentityStr}] does not exactly match deck identity [${deckIdentityStr}]`,
        details: {
          commanders: commanderNamesForMessage,
          commanderIdentity: commanderIdentityStr,
          deckIdentity: deckIdentityStr,
        },
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚠️ AI commander ${commanderNamesForMessage} [${commanderIdentityStr}] does not match deck identity [${deckIdentityStr}]. This may indicate deck construction errors.`,
        ts: Date.now(),
      });
    }
    
    // Set commander using the game's setCommander function
    const commanderNames = commanders.map((c: any) => c.name);
    const commanderIds = commanders.map((c: any) => c.id);
    
    debug(1, '[AI] Auto-selecting commander for AI:', {
      gameId,
      playerId,
      commanderNames,
      commanderIds,
      colorIdentity,
    });
    
    // Flag for pending opening draw (shuffle + draw 7)
    if (typeof (game as any).flagPendingOpeningDraw === 'function') {
      (game as any).flagPendingOpeningDraw(playerId);
    } else if ((game as any).pendingInitialDraw) {
      (game as any).pendingInitialDraw.add(playerId);
    }
    
    // Check if we'll do the opening draw (hand empty and pending flag set)
    // This mirrors the logic in commander.ts socket handler
    const pendingSet = (game as any).pendingInitialDraw as Set<string> | undefined;
    const willDoOpeningDraw = pendingSet && pendingSet.has(playerId);
    const zonesBefore = game.state?.zones?.[playerId];
    const handCountBefore = zonesBefore
      ? (typeof zonesBefore.handCount === "number" ? zonesBefore.handCount : (Array.isArray(zonesBefore.hand) ? zonesBefore.hand.length : 0))
      : 0;
    const doingOpeningDraw = willDoOpeningDraw && handCountBefore === 0;
    
    // Call setCommander to set up the commander and trigger opening draw
    if (typeof (game as any).setCommander === 'function') {
      (game as any).setCommander(playerId, commanderNames, commanderIds, colorIdentity);
      
      // Verify the opening draw happened
      const zonesAfter = game.state.zones?.[playerId];
      const handCount = zonesAfter?.handCount ?? (Array.isArray(zonesAfter?.hand) ? zonesAfter.hand.length : 0);
      
      debug(1, '[AI] After setCommander - hand count:', handCount);
      
      // If hand is empty, manually trigger shuffle and draw
      // (This is a fallback if the pendingInitialDraw didn't work)
      let didManualDraw = false;
      if (handCount === 0) {
        debug(1, '[AI] Hand is empty after setCommander, manually triggering shuffle and draw');
        didManualDraw = true;
        
        // Shuffle the library
        if (typeof (game as any).shuffleLibrary === 'function') {
          (game as any).shuffleLibrary(playerId);
          debug(1, '[AI] Library shuffled');
        }
        
        // Draw initial hand
        if (typeof (game as any).drawCards === 'function') {
          const drawn = (game as any).drawCards(playerId, INITIAL_HAND_SIZE);
          debug(1, '[AI] Drew', drawn?.length || 0, 'cards');
        }
      }
      
      // Persist the events - this is critical for undo/replay to work correctly
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'setCommander', {
          playerId,
          commanderNames,
          commanderIds,
          colorIdentity,
          isAI: true,
        });
        
        // Persist shuffle and draw events if opening draw happened
        // This ensures undo/replay produces the same hand contents
        if (doingOpeningDraw || didManualDraw) {
          await appendEvent(gameId, (game as any).seq || 0, 'shuffleLibrary', { playerId });
          debug(1, '[AI] Persisted opening draw events (shuffle + draw) for player', playerId);
        }
      } catch (e) {
        debugWarn(1, '[AI] Failed to persist setCommander event:', e);
      }
      
      // Broadcast updated state to all players
      broadcastGame(io, game, gameId);
      
      debug(1, '[AI] Commander set for AI player:', {
        gameId,
        playerId,
        commanderNames,
        finalHandCount: game.state.zones?.[playerId]?.handCount,
      });
      
      return true;
    } else {
      debugError(1, '[AI] game.setCommander not available');
      return false;
    }
    
  } catch (error) {
    debugError(1, '[AI] Error auto-selecting commander:', error);
    return false;
  }
}
