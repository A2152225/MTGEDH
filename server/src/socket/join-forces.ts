/**
 * join-forces.ts
 * 
 * Socket handlers for Join Forces and Tempting Offer cards.
 * These are multiplayer effects where each player can contribute mana
 * or choose to participate in an effect.
 * 
 * Join Forces examples: Collective Voyage, Minds Aglow
 * Tempting Offer examples: Tempt with Discovery, Tempt with Vengeance
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { isAIPlayer } from "./ai.js";
import { triggerETBEffectsForToken } from "../state/modules/stack.js";

/**
 * Pending Join Forces effect waiting for player contributions
 */
interface PendingJoinForces {
  id: string;
  gameId: string;
  initiator: string;
  cardName: string;
  effectDescription: string;
  contributions: Record<string, number>; // playerId -> mana contributed
  responded: Set<string>; // playerIds who have responded
  players: string[]; // all player IDs who can contribute
  timeout?: NodeJS.Timeout;
  createdAt: number;
}

/**
 * Pending Tempting Offer effect waiting for player responses
 */
interface PendingTemptingOffer {
  id: string;
  gameId: string;
  initiator: string;
  cardName: string;
  effectDescription: string;
  acceptedBy: Set<string>;
  responded: Set<string>;
  opponents: string[];
  timeout?: NodeJS.Timeout;
  createdAt: number;
}

// Store pending Join Forces effects by ID
const pendingJoinForces = new Map<string, PendingJoinForces>();

// Store pending Tempting Offer effects by ID (module-level for proper tracking)
const pendingTemptingOffers = new Map<string, PendingTemptingOffer>();

// Timeout for contributions (60 seconds)
const CONTRIBUTION_TIMEOUT_MS = 60000;

// AI response delay (1-3 seconds for natural feel)
const AI_RESPONSE_MIN_MS = 1000;
const AI_RESPONSE_MAX_MS = 3000;

/**
 * Generate unique ID for a Join Forces effect
 */
function generateJoinForcesId(): string {
  return `jf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Calculate AI contribution for Join Forces
 * AI will contribute based on strategy and available mana
 */
/**
 * Calculate AI contribution for Join Forces effects.
 * Uses game-state reasoning to make intelligent decisions:
 * - Minds Aglow: Consider hand size, cards needed to fill hand
 * - Collective Voyage: Consider land count vs opponents, ramp value
 * - Alliance of Arms: Token value based on board state
 * - Shared Trauma: Mill value based on graveyard strategies
 */
function calculateAIJoinForcesContribution(game: any, aiPlayerId: string, cardName: string): number {
  const battlefield = game.state?.battlefield || [];
  const zones = game.state?.zones || {};
  const players = game.state?.players || [];
  
  // Get AI's available mana (count untapped lands)
  const aiLands = battlefield.filter((p: any) => 
    p.controller === aiPlayerId && 
    !p.tapped &&
    (p.card?.type_line || '').toLowerCase().includes('land')
  );
  const availableMana = aiLands.length;
  
  // If no mana available, can't contribute
  if (availableMana === 0) {
    console.log(`[AI JoinForces] ${aiPlayerId} has no untapped lands, contributing 0`);
    return 0;
  }
  
  // Get AI's game state
  const aiZones = zones[aiPlayerId] || {};
  const aiHandSize = aiZones.handCount || (aiZones.hand?.length || 0);
  const aiTotalLands = battlefield.filter((p: any) => 
    p.controller === aiPlayerId && 
    (p.card?.type_line || '').toLowerCase().includes('land')
  ).length;
  const aiLibrarySize = aiZones.libraryCount || 0;
  const aiGraveyardSize = aiZones.graveyardCount || (aiZones.graveyard?.length || 0);
  
  // Get opponent info for comparison
  const opponents = players.filter((p: any) => p.id !== aiPlayerId && !p.hasLost);
  const avgOpponentLands = opponents.length > 0 
    ? battlefield.filter((p: any) => 
        opponents.some((o: any) => o.id === p.controller) && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      ).length / opponents.length
    : 0;
  
  const lowerCardName = cardName.toLowerCase();
  let desiredContribution = 0;
  let reasoning = '';
  
  // ===== MINDS AGLOW - Draw cards =====
  // Consider: hand size, max hand size (7), cards needed
  if (lowerCardName.includes('minds aglow') || lowerCardName.includes('draw')) {
    const maxHandSize = 7;
    const cardsNeeded = Math.max(0, maxHandSize - aiHandSize);
    
    if (aiHandSize >= maxHandSize) {
      // Hand is full, no need to draw more
      desiredContribution = 0;
      reasoning = `hand full (${aiHandSize}/${maxHandSize})`;
    } else if (cardsNeeded >= 3) {
      // Really need cards, contribute more
      desiredContribution = Math.min(cardsNeeded, Math.ceil(availableMana * 0.6));
      reasoning = `needs cards (${aiHandSize}/${maxHandSize})`;
    } else {
      // Could use a few cards
      desiredContribution = Math.min(cardsNeeded, Math.ceil(availableMana * 0.4));
      reasoning = `could use cards (${aiHandSize}/${maxHandSize})`;
    }
  }
  
  // ===== COLLECTIVE VOYAGE - Ramp/Lands =====
  // Consider: land count vs opponents, stage of game
  else if (lowerCardName.includes('collective voyage') || lowerCardName.includes('voyage')) {
    const landDeficit = avgOpponentLands - aiTotalLands;
    
    if (aiTotalLands < 4) {
      // Early game, ramp is very valuable
      desiredContribution = Math.ceil(availableMana * 0.7);
      reasoning = `early game ramp (${aiTotalLands} lands)`;
    } else if (landDeficit > 2) {
      // Behind on lands, catch up
      desiredContribution = Math.ceil(availableMana * 0.6);
      reasoning = `behind on lands (${aiTotalLands} vs avg ${avgOpponentLands.toFixed(1)})`;
    } else if (aiTotalLands >= 8) {
      // Has plenty of lands, less valuable
      desiredContribution = Math.floor(availableMana * 0.2);
      reasoning = `land-rich (${aiTotalLands} lands)`;
    } else {
      // Average situation
      desiredContribution = Math.ceil(availableMana * 0.4);
      reasoning = `moderate ramp value`;
    }
  }
  
  // ===== ALLIANCE OF ARMS - Create tokens =====
  // Consider: board presence, creature count
  else if (lowerCardName.includes('alliance of arms') || lowerCardName.includes('soldier')) {
    const aiCreatures = battlefield.filter((p: any) => 
      p.controller === aiPlayerId && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    
    if (aiCreatures < 3) {
      // Need board presence
      desiredContribution = Math.ceil(availableMana * 0.5);
      reasoning = `needs creatures (${aiCreatures} on board)`;
    } else if (aiCreatures >= 6) {
      // Already has board presence
      desiredContribution = Math.floor(availableMana * 0.2);
      reasoning = `has board presence (${aiCreatures} creatures)`;
    } else {
      desiredContribution = Math.ceil(availableMana * 0.35);
      reasoning = `moderate token value`;
    }
  }
  
  // ===== SHARED TRAUMA - Mill =====
  // Consider: graveyard synergies, library size
  else if (lowerCardName.includes('shared trauma') || lowerCardName.includes('mill')) {
    // Check if AI has graveyard synergies (reanimation, flashback, etc.)
    const hasGraveyardSynergy = battlefield.some((p: any) => {
      const oracle = (p.card?.oracle_text || '').toLowerCase();
      return p.controller === aiPlayerId && (
        oracle.includes('from your graveyard') ||
        oracle.includes('flashback') ||
        oracle.includes('escape') ||
        oracle.includes('unearth')
      );
    });
    
    if (hasGraveyardSynergy) {
      // Mill helps us
      desiredContribution = Math.ceil(availableMana * 0.5);
      reasoning = `has graveyard synergy`;
    } else if (aiLibrarySize < 20) {
      // Don't want to mill ourselves too much
      desiredContribution = 0;
      reasoning = `library too small (${aiLibrarySize})`;
    } else {
      // Neutral on mill
      desiredContribution = Math.floor(availableMana * 0.15);
      reasoning = `neutral on mill`;
    }
  }
  
  // ===== DEFAULT - Unknown Join Forces =====
  else {
    desiredContribution = Math.ceil(availableMana * 0.3);
    reasoning = 'default contribution';
  }
  
  // Ensure we don't exceed available mana
  const finalContribution = Math.min(desiredContribution, availableMana);
  
  console.log(`[AI JoinForces] ${aiPlayerId} for ${cardName}: contributing ${finalContribution}/${availableMana} (${reasoning})`);
  
  return finalContribution;
}

/**
 * Calculate AI decision for Tempting Offer effects.
 * Uses game-state reasoning to decide whether to accept.
 * 
 * All 7 Tempting Offer cards:
 * - Tempt with Bunnies: Create rabbit tokens
 * - Tempt with Discovery: Land search value
 * - Tempt with Glory: +1/+1 counters value
 * - Tempt with Immortality: Reanimation value
 * - Tempt with Mayhem: Deal damage / goad value
 * - Tempt with Reflections: Clone value
 * - Tempt with Vengeance: Elemental token value
 */
function shouldAIAcceptTemptingOffer(game: any, aiPlayerId: string, cardName: string): boolean {
  const battlefield = game.state?.battlefield || [];
  const zones = game.state?.zones || {};
  const lowerCardName = cardName.toLowerCase();
  
  // Get AI's game state
  const aiZones = zones[aiPlayerId] || {};
  const aiTotalLands = battlefield.filter((p: any) => 
    p.controller === aiPlayerId && 
    (p.card?.type_line || '').toLowerCase().includes('land')
  ).length;
  const aiCreatures = battlefield.filter((p: any) => 
    p.controller === aiPlayerId && 
    (p.card?.type_line || '').toLowerCase().includes('creature')
  );
  const aiGraveyard = aiZones.graveyard || [];
  const aiGraveyardCreatures = aiGraveyard.filter((c: any) => 
    (c.type_line || '').toLowerCase().includes('creature')
  );
  
  let shouldAccept = false;
  let reasoning = '';
  
  // ===== TEMPT WITH DISCOVERY - Search for land =====
  if (lowerCardName.includes('discovery')) {
    if (aiTotalLands < 5) {
      // Early/mid game, land is valuable
      shouldAccept = true;
      reasoning = `needs lands (${aiTotalLands})`;
    } else if (aiTotalLands < 8) {
      // Moderate value
      shouldAccept = Math.random() < 0.6;
      reasoning = `moderate land value`;
    } else {
      // Late game, less valuable
      shouldAccept = Math.random() < 0.3;
      reasoning = `has enough lands`;
    }
  }
  
  // ===== TEMPT WITH VENGEANCE - Create tokens =====
  else if (lowerCardName.includes('vengeance')) {
    // Tokens with haste are always useful for aggression
    if (aiCreatures.length < 4) {
      shouldAccept = true;
      reasoning = `needs board presence`;
    } else {
      shouldAccept = Math.random() < 0.5;
      reasoning = `moderate token value`;
    }
  }
  
  // ===== TEMPT WITH REFLECTIONS - Clone a creature =====
  else if (lowerCardName.includes('reflection')) {
    // Check if we have a good creature to clone
    const hasPowerfulCreature = aiCreatures.some((c: any) => {
      const power = parseInt(c.card?.power || '0', 10);
      return power >= 4 || (c.card?.oracle_text || '').length > 100; // Complex abilities
    });
    
    if (hasPowerfulCreature) {
      shouldAccept = true;
      reasoning = `has powerful creature to clone`;
    } else if (aiCreatures.length > 0) {
      shouldAccept = Math.random() < 0.4;
      reasoning = `has creatures but none special`;
    } else {
      shouldAccept = false;
      reasoning = `no creatures to clone`;
    }
  }
  
  // ===== TEMPT WITH IMMORTALITY - Reanimate =====
  else if (lowerCardName.includes('immortality')) {
    // Check graveyard for good targets
    const hasPowerfulGraveyardCreature = aiGraveyardCreatures.some((c: any) => {
      const power = parseInt(c.power || '0', 10);
      return power >= 4;
    });
    
    if (hasPowerfulGraveyardCreature) {
      shouldAccept = true;
      reasoning = `has powerful creature in graveyard`;
    } else if (aiGraveyardCreatures.length > 0) {
      shouldAccept = Math.random() < 0.5;
      reasoning = `has creatures in graveyard`;
    } else {
      shouldAccept = false;
      reasoning = `no creatures in graveyard`;
    }
  }
  
  // ===== TEMPT WITH GLORY - +1/+1 counters =====
  else if (lowerCardName.includes('glory')) {
    if (aiCreatures.length >= 3) {
      shouldAccept = true;
      reasoning = `has many creatures to buff`;
    } else if (aiCreatures.length > 0) {
      shouldAccept = Math.random() < 0.5;
      reasoning = `has some creatures`;
    } else {
      shouldAccept = false;
      reasoning = `no creatures to buff`;
    }
  }
  
  // ===== TEMPT WITH BUNNIES - Create rabbit tokens =====
  else if (lowerCardName.includes('bunnies')) {
    // Bunnies are cute 1/1 tokens - similar logic to vengeance but less aggressive
    if (aiCreatures.length < 3) {
      shouldAccept = true;
      reasoning = `needs board presence (${aiCreatures.length} creatures)`;
    } else if (aiCreatures.length < 6) {
      shouldAccept = Math.random() < 0.6;
      reasoning = `could use more creatures`;
    } else {
      // Already has good board
      shouldAccept = Math.random() < 0.3;
      reasoning = `has enough creatures`;
    }
  }
  
  // ===== TEMPT WITH MAYHEM - Deal damage / goad =====
  else if (lowerCardName.includes('mayhem')) {
    // Mayhem goads creatures and deals damage - good for aggressive strategies
    // Get opponent creature count to see if goad is valuable
    const players = game.state?.players || [];
    const opponents = players.filter((p: any) => p.id !== aiPlayerId && !p.hasLost);
    const opponentCreatures = battlefield.filter((p: any) => 
      opponents.some((o: any) => o.id === p.controller) && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    );
    
    if (opponentCreatures.length >= 3) {
      // Lots of opponent creatures to goad - very valuable
      shouldAccept = true;
      reasoning = `opponents have ${opponentCreatures.length} creatures to goad`;
    } else if (opponentCreatures.length > 0) {
      shouldAccept = Math.random() < 0.5;
      reasoning = `some opponent creatures to affect`;
    } else {
      // No creatures to goad, less valuable
      shouldAccept = Math.random() < 0.3;
      reasoning = `no opponent creatures to goad`;
    }
  }
  
  // ===== DEFAULT - Unknown Tempting Offer =====
  else {
    // Default to 40% acceptance
    shouldAccept = Math.random() < 0.4;
    reasoning = 'default decision';
  }
  
  console.log(`[AI TemptingOffer] ${aiPlayerId} for ${cardName}: ${shouldAccept ? 'ACCEPTS' : 'DECLINES'} (${reasoning})`);
  
  return shouldAccept;
}

/**
 * Process AI responses for a Join Forces effect
 */
function processAIJoinForcesResponses(
  io: Server, 
  pending: PendingJoinForces, 
  game: any
): void {
  let aiPlayerCount = 0;
  
  for (const playerId of pending.players) {
    // Skip if already responded or not an AI
    if (pending.responded.has(playerId)) continue;
    if (!isAIPlayer(pending.gameId, playerId)) continue;
    
    aiPlayerCount++;
    
    // Calculate AI contribution
    const contribution = calculateAIJoinForcesContribution(game, playerId, pending.cardName);
    
    // Delay AI response for natural feel
    const delay = AI_RESPONSE_MIN_MS + Math.random() * (AI_RESPONSE_MAX_MS - AI_RESPONSE_MIN_MS);
    
    console.log(`[joinForces] AI player ${playerId} will respond in ${Math.round(delay)}ms with contribution ${contribution}`);
    
    setTimeout(() => {
      // Check if effect still pending
      const currentPending = pendingJoinForces.get(pending.id);
      if (!currentPending) {
        console.log(`[joinForces] AI ${playerId} response skipped - effect no longer pending`);
        return;
      }
      if (currentPending.responded.has(playerId)) {
        console.log(`[joinForces] AI ${playerId} response skipped - already responded`);
        return;
      }
      
      // Record AI contribution
      currentPending.contributions[playerId] = contribution;
      currentPending.responded.add(playerId);
      
      console.log(`[joinForces] AI ${playerId} contributed ${contribution} mana. Responded: ${currentPending.responded.size}/${currentPending.players.length}`);
      
      // Notify all players
      io.to(pending.gameId).emit("joinForcesUpdate", {
        id: pending.id,
        gameId: pending.gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        contribution,
        responded: Array.from(currentPending.responded),
        contributions: currentPending.contributions,
        totalContributions: Object.values(currentPending.contributions).reduce((sum, n) => sum + n, 0),
      });
      
      io.to(pending.gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId: pending.gameId,
        from: "system",
        message: `🤖 ${getPlayerName(game, playerId)} (AI) contributes ${contribution} mana to ${pending.cardName}.`,
        ts: Date.now(),
      });
      
      // Check if all players have responded
      if (allPlayersResponded(currentPending)) {
        console.log(`[joinForces] All players responded - completing effect`);
        completeJoinForces(io, currentPending);
      }
    }, delay);
  }
  
  console.log(`[joinForces] Scheduled ${aiPlayerCount} AI responses for effect ${pending.id}`);
}

/**
 * Process AI responses for a Tempting Offer effect
 */
function processAITemptingOfferResponses(
  io: Server, 
  pending: any, // PendingTemptingOffer but defined later
  game: any,
  pendingMap: Map<string, any>
): void {
  for (const playerId of pending.opponents) {
    // Skip if already responded or not an AI
    if (pending.responded.has(playerId)) continue;
    if (!isAIPlayer(pending.gameId, playerId)) continue;
    
    // Decide if AI accepts
    const accept = shouldAIAcceptTemptingOffer(game, playerId, pending.cardName);
    
    // Delay AI response for natural feel
    const delay = AI_RESPONSE_MIN_MS + Math.random() * (AI_RESPONSE_MAX_MS - AI_RESPONSE_MIN_MS);
    
    setTimeout(() => {
      // Check if effect still pending
      const currentPending = pendingMap.get(pending.id);
      if (!currentPending || currentPending.responded.has(playerId)) return;
      
      // Record AI response
      currentPending.responded.add(playerId);
      if (accept) {
        currentPending.acceptedBy.add(playerId);
      }
      
      // Notify all players
      io.to(pending.gameId).emit("temptingOfferUpdate", {
        id: pending.id,
        gameId: pending.gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        accepted: accept,
        responded: Array.from(currentPending.responded),
        acceptedBy: Array.from(currentPending.acceptedBy),
      });
      
      io.to(pending.gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId: pending.gameId,
        from: "system",
        message: accept 
          ? `🤖 ${getPlayerName(game, playerId)} (AI) accepts the tempting offer from ${pending.cardName}!`
          : `🤖 ${getPlayerName(game, playerId)} (AI) declines the tempting offer.`,
        ts: Date.now(),
      });
      
      // Check if all opponents have responded
      if (currentPending.opponents.every((pid: string) => currentPending.responded.has(pid))) {
        console.log(`[temptingOffer] All opponents responded - completing effect`);
        completeTemptingOffer(io, currentPending);
      }
    }, delay);
  }
}

/**
 * Check if all players have responded
 */
function allPlayersResponded(pending: PendingJoinForces): boolean {
  return pending.players.every(pid => pending.responded.has(pid));
}

/**
 * Calculate total contributions
 */
function calculateTotalContributions(pending: PendingJoinForces): number {
  return Object.values(pending.contributions).reduce((sum, n) => sum + n, 0);
}

/**
 * Complete a Join Forces effect after all players have responded
 */
function completeJoinForces(io: Server, pending: PendingJoinForces): void {
  const total = calculateTotalContributions(pending);
  
  // Clear timeout
  if (pending.timeout) {
    clearTimeout(pending.timeout);
  }
  
  // Apply the Join Forces effect based on the card
  try {
    const game = ensureGame(pending.gameId);
    if (game && total > 0) {
      const cardNameLower = pending.cardName.toLowerCase();
      
      // Minds Aglow: Each player draws X cards where X is the total mana paid
      if (cardNameLower.includes('minds aglow')) {
        for (const playerId of pending.players) {
          // Draw cards for each player - all players draw total amount
          const totalDraw = total;
          
          if (typeof (game as any).drawCards === 'function') {
            (game as any).drawCards(playerId, totalDraw);
          } else {
            // Fallback: manually draw cards from library
            const lib = (game as any).libraries?.get(playerId) || [];
            const zones = (game.state as any).zones || {};
            const z = zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            z.hand = z.hand || [];
            
            for (let i = 0; i < totalDraw && lib.length > 0; i++) {
              const drawn = lib.shift();
              if (drawn) {
                (z.hand as any[]).push({ ...drawn, zone: 'hand' });
              }
            }
            z.handCount = (z.hand as any[]).length;
            z.libraryCount = lib.length;
          }
          
          console.log(`[joinForces] Minds Aglow: ${playerId} draws ${totalDraw} cards`);
        }
        
        io.to(pending.gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId: pending.gameId,
          from: "system",
          message: `📚 Minds Aglow: Each player draws ${total} cards!`,
          ts: Date.now(),
        });
      }
      // Collective Voyage: Search for X basic lands where X is total mana paid
      else if (cardNameLower.includes('collective voyage')) {
        // Set up pending library search for each player
        for (const playerId of pending.players) {
          (game.state as any).pendingLibrarySearch = (game.state as any).pendingLibrarySearch || {};
          (game.state as any).pendingLibrarySearch[playerId] = {
            type: 'join-forces-search',
            searchFor: `up to ${total} basic land card(s)`,
            destination: 'battlefield',
            tapped: true,
            optional: true,
            source: 'Collective Voyage',
            shuffleAfter: true,
            maxSelections: total,
            filter: { types: ['land'], subtypes: ['basic'] },
          };
        }
        
        io.to(pending.gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId: pending.gameId,
          from: "system",
          message: `🌲 Collective Voyage: Each player may search for up to ${total} basic land cards!`,
          ts: Date.now(),
        });
      }
      // Alliance of Arms: Create X 1/1 Soldier tokens where X is total mana paid
      else if (cardNameLower.includes('alliance of arms')) {
        for (const playerId of pending.players) {
          // Create soldier tokens for each player
          const battlefield = game.state.battlefield = game.state.battlefield || [];
          for (let i = 0; i < total; i++) {
            const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
            battlefield.push({
              id: tokenId,
              controller: playerId,
              owner: playerId,
              tapped: false,
              counters: {},
              isToken: true,
              card: {
                id: tokenId,
                name: 'Soldier Token',
                type_line: 'Token Creature — Soldier',
                power: '1',
                toughness: '1',
                colors: ['W'],
              },
            });
          }
          console.log(`[joinForces] Alliance of Arms: ${playerId} creates ${total} Soldier tokens`);
        }
        
        io.to(pending.gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId: pending.gameId,
          from: "system",
          message: `⚔️ Alliance of Arms: Each player creates ${total} 1/1 white Soldier tokens!`,
          ts: Date.now(),
        });
      }
      // Shared Trauma: Each player mills X cards where X is total mana paid
      else if (cardNameLower.includes('shared trauma')) {
        for (const playerId of pending.players) {
          const lib = (game as any).libraries?.get(playerId) || [];
          const zones = (game.state as any).zones || {};
          const z = zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          z.graveyard = z.graveyard || [];
          
          for (let i = 0; i < total && lib.length > 0; i++) {
            const milledCard = lib.shift();
            if (milledCard) {
              milledCard.zone = 'graveyard';
              (z.graveyard as any[]).push(milledCard);
            }
          }
          z.libraryCount = lib.length;
          z.graveyardCount = (z.graveyard as any[]).length;
          
          console.log(`[joinForces] Shared Trauma: ${playerId} mills ${total} cards`);
        }
        
        io.to(pending.gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId: pending.gameId,
          from: "system",
          message: `💀 Shared Trauma: Each player mills ${total} cards!`,
          ts: Date.now(),
        });
      }
      
      // Bump sequence after applying effects
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      
      // Broadcast updated game state
      broadcastGame(io, game, pending.gameId);
    }
  } catch (err) {
    console.error(`[joinForces] Error applying effect for ${pending.cardName}:`, err);
  }
  
  // Notify all players of the result
  io.to(pending.gameId).emit("joinForcesComplete", {
    id: pending.id,
    gameId: pending.gameId,
    cardName: pending.cardName,
    contributions: pending.contributions,
    totalContributions: total,
    initiator: pending.initiator,
  });
  
  // Chat message
  io.to(pending.gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId: pending.gameId,
    from: "system",
    message: `🤝 ${pending.cardName} resolved with ${total} total mana contributed!`,
    ts: Date.now(),
  });
  
  // Clean up
  pendingJoinForces.delete(pending.id);
  
  // Persist the event
  try {
    const game = ensureGame(pending.gameId);
    if (game) {
      appendEvent(pending.gameId, (game as any).seq ?? 0, "joinForcesComplete", {
        id: pending.id,
        cardName: pending.cardName,
        contributions: pending.contributions,
        totalContributions: total,
      });
    }
  } catch (e) {
    console.warn("appendEvent(joinForcesComplete) failed:", e);
  }
}

/**
 * Register and process a Join Forces effect from stack resolution.
 * This is called from handlePendingJoinForces in util.ts.
 * 
 * It properly registers the pending effect and triggers AI responses.
 */
export function registerPendingJoinForces(
  io: Server,
  gameId: string,
  effectId: string,
  initiator: string,
  cardName: string,
  effectDescription: string,
  players: string[],
  cardImageUrl?: string
): void {
  try {
    const game = ensureGame(gameId);
    if (!game) return;
    
    const pending: PendingJoinForces = {
      id: effectId,
      gameId,
      initiator,
      cardName,
      effectDescription,
      contributions: {},
      responded: new Set(),
      players,
      createdAt: Date.now(),
    };
    
    // Initialize contributions to 0
    for (const pid of players) {
      pending.contributions[pid] = 0;
    }
    
    // Set timeout for auto-completion
    pending.timeout = setTimeout(() => {
      console.log(`[joinForces] Timeout for ${effectId} - completing with partial responses`);
      const currentPending = pendingJoinForces.get(effectId);
      if (currentPending) {
        completeJoinForces(io, currentPending);
      }
    }, CONTRIBUTION_TIMEOUT_MS);
    
    // Register the pending effect
    pendingJoinForces.set(effectId, pending);
    
    console.log(`[joinForces] Registered pending Join Forces ${effectId} for ${cardName}`);
    
    // Emit to all players
    io.to(gameId).emit("joinForcesRequest", {
      id: effectId,
      gameId,
      initiator,
      initiatorName: getPlayerName(game, initiator),
      cardName,
      effectDescription,
      cardImageUrl,
      players,
      timeoutMs: CONTRIBUTION_TIMEOUT_MS,
    });
    
    // Process AI player responses automatically
    processAIJoinForcesResponses(io, pending, game);
    
  } catch (err) {
    console.error(`[joinForces] Error registering pending effect:`, err);
  }
}

/**
 * Register and process a Tempting Offer effect from stack resolution.
 * This is called from handlePendingTemptingOffer in util.ts.
 * Uses module-level pendingTemptingOffers map for proper tracking.
 */
export function registerPendingTemptingOffer(
  io: Server,
  gameId: string,
  effectId: string,
  initiator: string,
  cardName: string,
  effectDescription: string,
  opponents: string[],
  cardImageUrl?: string
): void {
  try {
    const game = ensureGame(gameId);
    if (!game) return;
    
    // If no opponents, complete immediately with initiator getting effect once
    if (opponents.length === 0) {
      io.to(gameId).emit("temptingOfferComplete", {
        gameId,
        id: effectId,
        cardName,
        acceptedBy: [],
        initiator,
        initiatorBonusCount: 1,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🎁 ${cardName} resolved - ${getPlayerName(game, initiator)} gets the effect once (no opponents).`,
        ts: Date.now(),
      });
      return;
    }
    
    const pending: PendingTemptingOffer = {
      id: effectId,
      gameId,
      initiator,
      cardName,
      effectDescription,
      acceptedBy: new Set<string>(),
      responded: new Set<string>(),
      opponents,
      createdAt: Date.now(),
    };
    
    // Set timeout for auto-completion
    pending.timeout = setTimeout(() => {
      console.log(`[temptingOffer] Timeout for ${effectId} - completing with partial responses`);
      const currentPending = pendingTemptingOffers.get(effectId);
      if (currentPending) {
        completeTemptingOffer(io, currentPending);
      }
    }, CONTRIBUTION_TIMEOUT_MS);
    
    // Store in module-level map for proper tracking
    pendingTemptingOffers.set(effectId, pending);
    
    console.log(`[temptingOffer] Registered pending Tempting Offer ${effectId} for ${cardName}, opponents: ${opponents.join(', ')}`);
    
    // Emit to all players
    io.to(gameId).emit("temptingOfferRequest", {
      id: effectId,
      gameId,
      initiator,
      initiatorName: getPlayerName(game, initiator),
      cardName,
      effectDescription,
      cardImageUrl,
      opponents,
      timeoutMs: CONTRIBUTION_TIMEOUT_MS,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🎁 ${getPlayerName(game, initiator)} casts ${cardName} - each opponent may accept the offer!`,
      ts: Date.now(),
    });
    
    // Process AI responses using the module-level map
    processAITemptingOfferResponses(io, pending, game, pendingTemptingOffers);
    
  } catch (err) {
    console.error(`[temptingOffer] Error registering pending effect:`, err);
  }
}

/**
 * Apply the actual game effect of a Tempting Offer card.
 * 
 * Tempting Offer cards:
 * - Tempt with Discovery: Search for a land (initiator gets N lands, each accepting opponent gets 1)
 * - Tempt with Glory: Put +1/+1 counters on creatures (initiator gets N counters per creature, opponents get 1)
 * - Tempt with Immortality: Reanimate a creature (initiator returns N creatures, opponents return 1)
 * - Tempt with Reflections: Clone a creature (initiator gets N copies, opponents get 1)
 * - Tempt with Vengeance: Create hasty elemental tokens (initiator gets N*X tokens, opponents get X)
 * - Tempt with Bunnies: Create rabbit tokens (initiator gets N rabbits, opponents get 1)
 * - Tempt with Mayhem: Deal damage and goad (initiator deals N*3 damage, opponents deal 3 each)
 */
function applyTemptingOfferEffect(
  io: Server, 
  game: any, 
  pending: PendingTemptingOffer, 
  acceptedBy: string[], 
  initiatorBonusCount: number
): void {
  const cardNameLower = pending.cardName.toLowerCase();
  const initiator = pending.initiator;
  const battlefield = game.state.battlefield = game.state.battlefield || [];
  
  // Tempt with Discovery: Search for lands
  if (cardNameLower.includes('discovery')) {
    // Set up library search for initiator (searches N times)
    (game.state as any).pendingLibrarySearch = (game.state as any).pendingLibrarySearch || {};
    (game.state as any).pendingLibrarySearch[initiator] = {
      type: 'tempting-offer-search',
      searchFor: `up to ${initiatorBonusCount} land card(s)`,
      destination: 'battlefield',
      tapped: false,
      optional: true,
      source: 'Tempt with Discovery',
      shuffleAfter: true,
      maxSelections: initiatorBonusCount,
      filter: { types: ['land'] },
    };
    
    // Each accepting opponent also gets to search for 1 land
    for (const opponentId of acceptedBy) {
      (game.state as any).pendingLibrarySearch[opponentId] = {
        type: 'tempting-offer-search',
        searchFor: 'a land card',
        destination: 'battlefield',
        tapped: false,
        optional: true,
        source: 'Tempt with Discovery',
        shuffleAfter: true,
        maxSelections: 1,
        filter: { types: ['land'] },
      };
    }
    
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `🌲 Tempt with Discovery: ${getPlayerName(game, initiator)} searches for up to ${initiatorBonusCount} land(s). ${acceptedBy.length > 0 ? `${acceptedBy.length} opponent(s) also search.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Vengeance: Create hasty elemental tokens
  else if (cardNameLower.includes('vengeance')) {
    // Note: The actual X value is determined by mana spent on the spell
    // For now, we'll create tokens based on a default X=3
    const xValue = 3; // This should ideally come from the spell resolution context
    
    // Create tokens for initiator
    const initiatorTokenCount = xValue * initiatorBonusCount;
    for (let i = 0; i < initiatorTokenCount; i++) {
      const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
      battlefield.push({
        id: tokenId,
        controller: initiator,
        owner: initiator,
        tapped: false,
        counters: {},
        isToken: true,
        summoningSickness: false, // Haste
        card: {
          id: tokenId,
          name: 'Elemental Token',
          type_line: 'Token Creature — Elemental',
          power: '1',
          toughness: '1',
          colors: ['R'],
          oracle_text: 'Haste',
        },
      });
    }
    
    // Create tokens for each accepting opponent
    for (const opponentId of acceptedBy) {
      for (let i = 0; i < xValue; i++) {
        const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_opp_${i}`;
        battlefield.push({
          id: tokenId,
          controller: opponentId,
          owner: opponentId,
          tapped: false,
          counters: {},
          isToken: true,
          summoningSickness: false, // Haste
          card: {
            id: tokenId,
            name: 'Elemental Token',
            type_line: 'Token Creature — Elemental',
            power: '1',
            toughness: '1',
            colors: ['R'],
            oracle_text: 'Haste',
          },
        });
      }
    }
    
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `🔥 Tempt with Vengeance: ${getPlayerName(game, initiator)} creates ${initiatorTokenCount} hasty 1/1 Elemental tokens!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) each get ${xValue} tokens.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Reflections: Clone a creature
  else if (cardNameLower.includes('reflections')) {
    // Note: This effect requires targeting a creature to clone
    // For simplicity, we'll skip the actual cloning and just note it was attempted
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `🪞 Tempt with Reflections: ${getPlayerName(game, initiator)} may create ${initiatorBonusCount} token cop${initiatorBonusCount === 1 ? 'y' : 'ies'} of a creature.${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) may also create a copy.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Immortality: Reanimate creatures from graveyard
  else if (cardNameLower.includes('immortality')) {
    // Note: This effect requires choosing creatures from graveyards
    // Set up pending reanimate for each player
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `💀 Tempt with Immortality: ${getPlayerName(game, initiator)} may return ${initiatorBonusCount} creature(s) from graveyard to battlefield.${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) may also reanimate a creature.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Glory: Put +1/+1 counters on creatures
  else if (cardNameLower.includes('glory')) {
    // Get initiator's creatures and add counters
    const initiatorCreatures = battlefield.filter((p: any) => 
      p.controller === initiator && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    );
    
    for (const creature of initiatorCreatures) {
      creature.counters = creature.counters || {};
      creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + initiatorBonusCount;
    }
    
    // Add counters to each accepting opponent's creatures
    for (const opponentId of acceptedBy) {
      const opponentCreatures = battlefield.filter((p: any) => 
        p.controller === opponentId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      for (const creature of opponentCreatures) {
        creature.counters = creature.counters || {};
        creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + 1;
      }
    }
    
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `✨ Tempt with Glory: ${getPlayerName(game, initiator)}'s creatures each get ${initiatorBonusCount} +1/+1 counter(s)!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s)' creatures each get 1 counter.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Bunnies: Create rabbit tokens
  else if (cardNameLower.includes('bunnies')) {
    // Create rabbit tokens for initiator
    for (let i = 0; i < initiatorBonusCount; i++) {
      const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_bunny_${i}`;
      battlefield.push({
        id: tokenId,
        controller: initiator,
        owner: initiator,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: tokenId,
          name: 'Rabbit Token',
          type_line: 'Token Creature — Rabbit',
          power: '1',
          toughness: '1',
          colors: ['W'],
        },
      });
    }
    
    // Create tokens for each accepting opponent
    for (const opponentId of acceptedBy) {
      const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_bunny_opp`;
      battlefield.push({
        id: tokenId,
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: tokenId,
          name: 'Rabbit Token',
          type_line: 'Token Creature — Rabbit',
          power: '1',
          toughness: '1',
          colors: ['W'],
        },
      });
    }
    
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `🐰 Tempt with Bunnies: ${getPlayerName(game, initiator)} creates ${initiatorBonusCount} 1/1 Rabbit token(s)!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) each get 1 token.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Mayhem: Deal damage and goad
  else if (cardNameLower.includes('mayhem')) {
    const damagePerPlayer = 3;
    const initiatorDamage = damagePerPlayer * initiatorBonusCount;
    
    // Get all opponents
    const allOpponents = pending.opponents;
    
    // Initiator deals damage to opponents (this is a simplification - actual card targets)
    // In a full implementation, this would require target selection
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `💥 Tempt with Mayhem: ${getPlayerName(game, initiator)} may deal ${initiatorDamage} damage and goad creatures!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) may also deal ${damagePerPlayer} damage each.` : ''}`,
      ts: Date.now(),
    });
  }
  
  // Bump sequence after applying effects
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
  
  // Broadcast updated game state
  broadcastGame(io, game, pending.gameId);
}

/**
 * Complete a Tempting Offer effect and clean up
 */
function completeTemptingOffer(io: Server, pending: PendingTemptingOffer): void {
  // Clear timeout if exists
  if (pending.timeout) {
    clearTimeout(pending.timeout);
  }
  
  const acceptedByArray = Array.from(pending.acceptedBy);
  const initiatorBonusCount = 1 + acceptedByArray.length; // Initiator gets effect once plus for each acceptor
  
  console.log(`[temptingOffer] Completing ${pending.id}: ${acceptedByArray.length} accepted, initiator gets ${initiatorBonusCount}x`);
  
  // Apply the Tempting Offer effect
  const game = ensureGame(pending.gameId);
  if (game) {
    try {
      applyTemptingOfferEffect(io, game, pending, acceptedByArray, initiatorBonusCount);
    } catch (err) {
      console.error(`[temptingOffer] Error applying effect for ${pending.cardName}:`, err);
    }
  }
  
  // Notify all players
  io.to(pending.gameId).emit("temptingOfferComplete", {
    gameId: pending.gameId,
    id: pending.id,
    cardName: pending.cardName,
    acceptedBy: acceptedByArray,
    initiator: pending.initiator,
    initiatorBonusCount,
  });
  
  io.to(pending.gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId: pending.gameId,
    from: "system",
    message: acceptedByArray.length > 0
      ? `🎁 ${pending.cardName} resolved - ${acceptedByArray.length} opponent(s) accepted. ${getPlayerName(game, pending.initiator)} gets the effect ${initiatorBonusCount} time(s)!`
      : `🎁 ${pending.cardName} resolved - no opponents accepted. ${getPlayerName(game, pending.initiator)} gets the effect once.`,
    ts: Date.now(),
  });
  
  // Clean up
  pendingTemptingOffers.delete(pending.id);
}

export function registerJoinForcesHandlers(io: Server, socket: Socket) {
  /**
   * Initiate a Join Forces effect
   */
  socket.on("initiateJoinForces", ({ 
    gameId, 
    cardName, 
    effectDescription,
    cardImageUrl,
  }: { 
    gameId: string; 
    cardName: string; 
    effectDescription: string;
    cardImageUrl?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Get all non-spectator players
      const players = (game.state?.players || [])
        .filter((p: any) => p && !p.spectator)
        .map((p: any) => p.id);
      
      if (players.length === 0) {
        socket.emit("error", {
          code: "JOIN_FORCES_NO_PLAYERS",
          message: "No players available for Join Forces effect.",
        });
        return;
      }

      const id = generateJoinForcesId();
      
      const pending: PendingJoinForces = {
        id,
        gameId,
        initiator: playerId,
        cardName,
        effectDescription,
        contributions: {},
        responded: new Set(),
        players,
        createdAt: Date.now(),
      };
      
      // Initialize contributions to 0
      for (const pid of players) {
        pending.contributions[pid] = 0;
      }
      
      // Set timeout
      pending.timeout = setTimeout(() => {
        // Auto-complete with whatever contributions we have
        console.log(`[joinForces] Timeout for ${id} - completing with partial responses`);
        completeJoinForces(io, pending);
      }, CONTRIBUTION_TIMEOUT_MS);
      
      pendingJoinForces.set(id, pending);
      
      // Notify all players
      io.to(gameId).emit("joinForcesRequest", {
        id,
        gameId,
        initiator: playerId,
        initiatorName: getPlayerName(game, playerId),
        cardName,
        effectDescription,
        cardImageUrl,
        players,
        timeoutMs: CONTRIBUTION_TIMEOUT_MS,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🤝 ${getPlayerName(game, playerId)} casts ${cardName} - all players may contribute mana!`,
        ts: Date.now(),
      });
      
      // Process AI player responses automatically
      processAIJoinForcesResponses(io, pending, game);
      
      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "joinForcesInitiated", {
          id,
          cardName,
          initiator: playerId,
          players,
        });
      } catch (e) {
        console.warn("appendEvent(joinForcesInitiated) failed:", e);
      }
    } catch (err: any) {
      console.error(`initiateJoinForces error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "JOIN_FORCES_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Submit a contribution to a Join Forces effect
   */
  socket.on("contributeJoinForces", ({ 
    gameId, 
    joinForcesId, 
    amount,
  }: { 
    gameId: string; 
    joinForcesId: string; 
    amount: number;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const pending = pendingJoinForces.get(joinForcesId);
      if (!pending || pending.gameId !== gameId) {
        socket.emit("error", {
          code: "JOIN_FORCES_NOT_FOUND",
          message: "Join Forces effect not found or expired.",
        });
        return;
      }
      
      if (pending.responded.has(playerId)) {
        socket.emit("error", {
          code: "JOIN_FORCES_ALREADY_RESPONDED",
          message: "You have already contributed to this effect.",
        });
        return;
      }
      
      if (!pending.players.includes(playerId)) {
        socket.emit("error", {
          code: "JOIN_FORCES_NOT_PLAYER",
          message: "You are not a participant in this effect.",
        });
        return;
      }
      
      // Record the contribution
      // Note: Mana payment validation is handled client-side via availableMana prop.
      // The server accepts any non-negative amount because Join Forces effects
      // may also allow tapping creatures/artifacts for mana, using mana abilities,
      // or other complex mana sources that the server cannot easily validate.
      const contribution = Math.max(0, Math.floor(amount));
      pending.contributions[playerId] = contribution;
      pending.responded.add(playerId);
      
      // Notify all players of the update
      io.to(gameId).emit("joinForcesUpdate", {
        id: joinForcesId,
        gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        contribution,
        responded: Array.from(pending.responded),
        contributions: pending.contributions,
        totalContributions: calculateTotalContributions(pending),
      });
      
      // Check if all players have responded
      if (allPlayersResponded(pending)) {
        completeJoinForces(io, pending);
      }
    } catch (err: any) {
      console.error(`contributeJoinForces error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CONTRIBUTE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // ===== TEMPTING OFFER HANDLERS =====
  
  /**
   * Pending Tempting Offer effect waiting for player responses
   */
  interface PendingTemptingOffer {
    id: string;
    gameId: string;
    initiator: string;
    cardName: string;
    effectDescription: string;
    acceptedBy: Set<string>;
    responded: Set<string>;
    opponents: string[];
    timeout?: NodeJS.Timeout;
    createdAt: number;
  }
  
  // Store pending Tempting Offers by ID
  const pendingTemptingOffers = new Map<string, PendingTemptingOffer>();
  
  /**
   * Initiate a Tempting Offer effect
   */
  socket.on("initiateTemptingOffer", ({
    gameId,
    cardName,
    effectDescription,
    cardImageUrl,
  }: {
    gameId: string;
    cardName: string;
    effectDescription: string;
    cardImageUrl?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Get all opponents (non-spectator players that are not the initiator)
      const opponents = (game.state?.players || [])
        .filter((p: any) => p && !p.spectator && p.id !== playerId)
        .map((p: any) => p.id);
      
      if (opponents.length === 0) {
        // No opponents - initiator just gets the effect once
        io.to(gameId).emit("temptingOfferComplete", {
          gameId,
          id: `tempt_${Date.now()}`,
          cardName,
          acceptedBy: [],
          initiator: playerId,
          initiatorBonusCount: 1,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `🎁 ${cardName} resolved - ${getPlayerName(game, playerId)} gets the effect once (no opponents).`,
          ts: Date.now(),
        });
        return;
      }

      const id = `tempt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      
      const pending: PendingTemptingOffer = {
        id,
        gameId,
        initiator: playerId,
        cardName,
        effectDescription,
        acceptedBy: new Set(),
        responded: new Set(),
        opponents,
        createdAt: Date.now(),
      };
      
      // Set timeout (60 seconds)
      pending.timeout = setTimeout(() => {
        console.log(`[temptingOffer] Timeout for ${id} - completing with partial responses`);
        completeTemptingOffer(io, pending, game);
      }, 60000);
      
      pendingTemptingOffers.set(id, pending);
      
      // Notify all players
      io.to(gameId).emit("temptingOfferRequest", {
        id,
        gameId,
        initiator: playerId,
        initiatorName: getPlayerName(game, playerId),
        cardName,
        effectDescription,
        cardImageUrl,
        opponents,
        timeoutMs: 60000,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🎁 ${getPlayerName(game, playerId)} casts ${cardName} - opponents may accept the tempting offer!`,
        ts: Date.now(),
      });
      
      // Process AI opponent responses automatically
      processAITemptingOfferResponses(io, pending, game, pendingTemptingOffers);
      
      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "temptingOfferInitiated", {
          id,
          cardName,
          initiator: playerId,
          opponents,
        });
      } catch (e) {
        console.warn("appendEvent(temptingOfferInitiated) failed:", e);
      }
    } catch (err: any) {
      console.error(`initiateTemptingOffer error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "TEMPTING_OFFER_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
  
  // Internal event for completing tempting offer when all AI have responded
  socket.on("_temptingOfferAllResponded", ({ id }: { id: string }) => {
    const pending = pendingTemptingOffers.get(id);
    if (!pending) return;
    const game = ensureGame(pending.gameId);
    if (!game) return;
    completeTemptingOffer(io, pending, game);
  });

  /**
   * Respond to a Tempting Offer
   */
  socket.on("respondTemptingOffer", ({
    gameId,
    temptingOfferId,
    accept,
  }: {
    gameId: string;
    temptingOfferId: string;
    accept: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const pending = pendingTemptingOffers.get(temptingOfferId);
      if (!pending || pending.gameId !== gameId) {
        socket.emit("error", {
          code: "TEMPTING_OFFER_NOT_FOUND",
          message: "Tempting Offer not found or expired.",
        });
        return;
      }
      
      if (pending.responded.has(playerId)) {
        socket.emit("error", {
          code: "TEMPTING_OFFER_ALREADY_RESPONDED",
          message: "You have already responded to this offer.",
        });
        return;
      }
      
      if (!pending.opponents.includes(playerId)) {
        socket.emit("error", {
          code: "TEMPTING_OFFER_NOT_OPPONENT",
          message: "You are not an opponent in this effect.",
        });
        return;
      }
      
      // Record the response
      pending.responded.add(playerId);
      if (accept) {
        pending.acceptedBy.add(playerId);
      }
      
      // Notify all players of the update
      io.to(gameId).emit("temptingOfferUpdate", {
        id: temptingOfferId,
        gameId,
        playerId,
        playerName: getPlayerName(game, playerId),
        accepted: accept,
        responded: Array.from(pending.responded),
        acceptedBy: Array.from(pending.acceptedBy),
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: accept 
          ? `✅ ${getPlayerName(game, playerId)} accepts the tempting offer from ${pending.cardName}!`
          : `❌ ${getPlayerName(game, playerId)} declines the tempting offer.`,
        ts: Date.now(),
      });
      
      // Check if all opponents have responded
      if (pending.opponents.every(pid => pending.responded.has(pid))) {
        completeTemptingOffer(io, pending, game);
      }
    } catch (err: any) {
      console.error(`respondTemptingOffer error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "RESPOND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
  
  /**
   * Complete a Tempting Offer effect
   */
  function completeTemptingOffer(io: Server, pending: PendingTemptingOffer, game: any): void {
    const acceptedCount = pending.acceptedBy.size;
    const acceptedByArray = Array.from(pending.acceptedBy);
    const initiatorBonusCount = 1 + acceptedCount; // Initiator gets effect once + once for each opponent who accepted
    
    // Clear timeout
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    
    // Apply the Tempting Offer effect
    if (game) {
      try {
        applyTemptingOfferEffect(io, game, pending, acceptedByArray, initiatorBonusCount);
      } catch (err) {
        console.error(`[temptingOffer] Error applying effect for ${pending.cardName}:`, err);
      }
    }
    
    // Notify all players of the result
    io.to(pending.gameId).emit("temptingOfferComplete", {
      id: pending.id,
      gameId: pending.gameId,
      cardName: pending.cardName,
      acceptedBy: acceptedByArray,
      initiator: pending.initiator,
      initiatorBonusCount,
    });
    
    // Chat message
    io.to(pending.gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId: pending.gameId,
      from: "system",
      message: `🎁 ${pending.cardName} resolved! ${getPlayerName(game, pending.initiator)} gets the effect ${initiatorBonusCount} time${initiatorBonusCount !== 1 ? 's' : ''}.${acceptedCount > 0 ? ` ${acceptedCount} opponent${acceptedCount !== 1 ? 's' : ''} also get the effect.` : ''}`,
      ts: Date.now(),
    });
    
    // Clean up
    pendingTemptingOffers.delete(pending.id);
    
    // Persist the event
    try {
      appendEvent(pending.gameId, (game as any).seq ?? 0, "temptingOfferComplete", {
        id: pending.id,
        cardName: pending.cardName,
        acceptedBy: acceptedByArray,
        initiatorBonusCount,
      });
    } catch (e) {
      console.warn("appendEvent(temptingOfferComplete) failed:", e);
    }
  }
}

export default registerJoinForcesHandlers;
