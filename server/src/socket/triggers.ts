/**
 * server/src/socket/triggers.ts
 * 
 * Socket handlers for triggered abilities and ETB effects.
 * Handles shock land choices, triggered ability prompts, etc.
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer, getOrInitManaPool, calculateTotalAvailableMana, consumeManaFromPool } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";

/**
 * List of shock lands and similar "pay life or enter tapped" lands
 */
const SHOCK_LANDS = new Set([
  "blood crypt",
  "breeding pool",
  "godless shrine",
  "hallowed fountain",
  "overgrown tomb",
  "sacred foundry",
  "steam vents",
  "stomping ground",
  "temple garden",
  "watery grave",
]);

/**
 * Card name for Mox Diamond (ETB replacement effect card)
 * This constant is used for matching the card when resolving its replacement effect.
 */
const MOX_DIAMOND_NAME = "mox diamond";

/**
 * Check if a card is Mox Diamond
 */
function isMoxDiamond(cardName: string): boolean {
  return (cardName || "").toLowerCase().trim() === MOX_DIAMOND_NAME;
}

/**
 * Check if a card is a shock land or similar
 */
function isShockLand(cardName: string): boolean {
  return SHOCK_LANDS.has((cardName || "").toLowerCase().trim());
}

/**
 * Register trigger and ETB socket handlers
 */
export function registerTriggerHandlers(io: Server, socket: Socket): void {
  /**
   * Handle shock land ETB choice - pay 2 life for untapped or enter tapped
   */
  socket.on("shockLandChoice", async ({
    gameId,
    permanentId,
    payLife,
  }: {
    gameId: string;
    permanentId: string;
    payLife: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "SHOCK_LAND_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Find the permanent
      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) => 
        p.id === permanentId && p.controller === playerId
      );
      
      if (!permanent) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Permanent not found on battlefield",
        });
        return;
      }

      const cardName = (permanent as any).card?.name || "Land";

      if (payLife) {
        // Pay 2 life to enter untapped
        // Ensure life object exists before accessing
        if (!(game.state as any).life) {
          (game.state as any).life = {};
        }
        const currentLife = (game.state as any).life[playerId] ?? 
                           (game as any).life?.[playerId] ?? 40;
        const newLife = currentLife - 2;
        
        // Update life total in all locations
        (game.state as any).life[playerId] = newLife;
        if ((game as any).life) {
          (game as any).life[playerId] = newLife;
        }
        
        // Also update the player object in game.state.players
        // This is critical for the UI to display the updated life total
        const players = game.state?.players || [];
        const player = players.find((p: any) => p.id === playerId);
        if (player) {
          (player as any).life = newLife;
        }
        
        // Ensure permanent is untapped
        (permanent as any).tapped = false;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} pays 2 life for ${cardName} to enter untapped. (${currentLife} → ${newLife})`,
          ts: Date.now(),
        });
      } else {
        // Enter tapped
        (permanent as any).tapped = true;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)}'s ${cardName} enters the battlefield tapped.`,
          ts: Date.now(),
        });
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "shockLandChoice", {
          playerId,
          permanentId,
          payLife,
          cardName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist shockLandChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      console.log(`[triggers] ${payLife ? "Paid life for" : "Tapped"} ${cardName} for player ${playerId} in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[triggers] shockLandChoice error:`, err);
      socket.emit("error", {
        code: "SHOCK_LAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle Mox Diamond ETB replacement effect
   * "If Mox Diamond would enter the battlefield, you may discard a land card instead.
   * If you do, put Mox Diamond onto the battlefield. If you don't, put it into its owner's graveyard."
   */
  socket.on("moxDiamondChoice", async ({
    gameId,
    stackItemId,
    discardLandId,
  }: {
    gameId: string;
    stackItemId: string;
    discardLandId: string | null; // null means put Mox Diamond in graveyard
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "MOX_DIAMOND_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Ensure game state exists
      game.state = (game.state || {}) as any;
      game.state.battlefield = game.state.battlefield || [];
      game.state.stack = game.state.stack || [];
      
      // Find the Mox Diamond on the stack (waiting to resolve)
      const stack = game.state.stack;
      const moxDiamondIndex = stack.findIndex((item: any) => 
        item.id === stackItemId && 
        item.controller === playerId &&
        isMoxDiamond(item.card?.name)
      );
      
      if (moxDiamondIndex === -1) {
        socket.emit("error", {
          code: "MOX_DIAMOND_NOT_FOUND",
          message: "Mox Diamond not found on stack",
        });
        return;
      }
      
      const moxDiamondItem = stack[moxDiamondIndex];
      const moxCard = moxDiamondItem.card;
      
      // Remove Mox Diamond from the stack (it's about to resolve or be put in graveyard)
      stack.splice(moxDiamondIndex, 1);
      
      // Get zones for player
      const zones = game.state.zones = game.state.zones || {};
      zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;
      const playerZones = zones[playerId] as any;
      playerZones.hand = playerZones.hand || [];
      playerZones.graveyard = playerZones.graveyard || [];
      
      const cardName = moxCard?.name || 'Mox Diamond';
      const cardImageUrl = moxCard?.image_uris?.normal || moxCard?.image_uris?.small;
      
      if (discardLandId) {
        // Player chose to discard a land - find it in hand
        const hand = playerZones.hand;
        const landIndex = hand.findIndex((c: any) => c?.id === discardLandId);
        
        if (landIndex === -1) {
          socket.emit("error", {
            code: "LAND_NOT_IN_HAND",
            message: "Selected land card not found in hand",
          });
          // Put Mox Diamond back on stack since we can't complete the action
          stack.push(moxDiamondItem);
          return;
        }
        
        // Verify it's actually a land
        const landCard = hand[landIndex];
        const landTypeLine = (landCard?.type_line || '').toLowerCase();
        if (!landTypeLine.includes('land')) {
          socket.emit("error", {
            code: "NOT_A_LAND",
            message: "Selected card is not a land",
          });
          stack.push(moxDiamondItem);
          return;
        }
        
        const landName = landCard?.name || 'land';
        
        // Remove land from hand and put it in graveyard
        const [discardedLand] = hand.splice(landIndex, 1);
        playerZones.handCount = hand.length;
        playerZones.graveyard.push({ ...discardedLand, zone: 'graveyard' });
        playerZones.graveyardCount = playerZones.graveyard.length;
        
        // Put Mox Diamond onto the battlefield
        const permId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newPermanent = {
          id: permId,
          controller: playerId,
          owner: playerId,
          tapped: false,
          counters: {},
          card: { ...moxCard, zone: 'battlefield' },
        } as any;
        game.state.battlefield.push(newPermanent);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} discards ${landName} to put ${cardName} onto the battlefield.`,
          ts: Date.now(),
        });
        
        console.log(`[triggers] Mox Diamond: ${playerId} discarded ${landName}, Mox Diamond enters battlefield`);
        
      } else {
        // Player chose not to discard - put Mox Diamond in graveyard
        playerZones.graveyard.push({ ...moxCard, zone: 'graveyard' });
        playerZones.graveyardCount = playerZones.graveyard.length;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} doesn't discard a land. ${cardName} is put into the graveyard.`,
          ts: Date.now(),
        });
        
        console.log(`[triggers] Mox Diamond: ${playerId} didn't discard, Mox Diamond goes to graveyard`);
      }
      
      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "moxDiamondChoice", {
          playerId,
          stackItemId,
          discardLandId,
          cardName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist moxDiamondChoice event:", e);
      }
      
      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }
      
      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[triggers] moxDiamondChoice error:`, err);
      socket.emit("error", {
        code: "MOX_DIAMOND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle bounce land ETB choice - player selects which land to return to hand
   */
  socket.on("bounceLandChoice", async ({
    gameId,
    bounceLandId,
    returnPermanentId,
  }: {
    gameId: string;
    bounceLandId: string;
    returnPermanentId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "BOUNCE_LAND_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Ensure game state and battlefield exist
      game.state = (game.state || {}) as any;
      game.state.battlefield = game.state.battlefield || [];
      
      // Find the bounce land permanent
      const battlefield = game.state.battlefield;
      const bounceLand = battlefield.find((p: any) => 
        p.id === bounceLandId && p.controller === playerId
      );
      
      if (!bounceLand) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Bounce land not found on battlefield",
        });
        return;
      }

      // Find the land to return
      const landToReturn = battlefield.find((p: any) => 
        p.id === returnPermanentId && p.controller === playerId
      );
      
      if (!landToReturn) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Land to return not found on battlefield",
        });
        return;
      }

      const bounceLandName = (bounceLand as any).card?.name || "Bounce Land";
      const returnedLandName = (landToReturn as any).card?.name || "Land";

      // Remove the land from battlefield
      const idx = battlefield.indexOf(landToReturn);
      if (idx !== -1) {
        battlefield.splice(idx, 1);
      }

      // Add the land to player's hand
      const zones = game.state?.zones?.[playerId];
      if (zones) {
        zones.hand = zones.hand || [];
        const returnedCard = { ...(landToReturn as any).card, zone: 'hand' };
        (zones.hand as any[]).push(returnedCard);
        zones.handCount = (zones.hand as any[]).length;
      }

      // Send chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)}'s ${bounceLandName} returns ${returnedLandName} to hand.`,
        ts: Date.now(),
      });

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "bounceLandChoice", {
          playerId,
          bounceLandId,
          returnPermanentId,
          bounceLandName,
          returnedLandName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist bounceLandChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      console.log(`[triggers] ${bounceLandName} returned ${returnedLandName} to hand for player ${playerId} in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[triggers] bounceLandChoice error:`, err);
      socket.emit("error", {
        code: "BOUNCE_LAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle triggered ability resolution
   */
  socket.on("resolveTrigger", async ({
    gameId,
    triggerId,
    choice,
  }: {
    gameId: string;
    triggerId: string;
    choice: any;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      // Find the trigger in the trigger queue
      const triggerQueue = (game.state as any)?.triggerQueue || [];
      const triggerIndex = triggerQueue.findIndex((t: any) => t.id === triggerId);
      
      if (triggerIndex === -1) {
        socket.emit("error", {
          code: "TRIGGER_NOT_FOUND",
          message: "Trigger not found",
        });
        return;
      }

      const trigger = triggerQueue[triggerIndex];
      
      // Handle based on choice
      if (choice.accepted === false) {
        // Player declined "may" trigger - remove it
        triggerQueue.splice(triggerIndex, 1);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} declines ${trigger.sourceName}'s triggered ability.`,
          ts: Date.now(),
        });
      } else {
        // Execute the trigger effect
        // For now, just put it on the stack
        const stackItem = {
          id: `stack_trigger_${Date.now()}`,
          type: 'ability',
          controller: playerId,
          card: {
            id: trigger.sourceId,
            name: `${trigger.sourceName} (trigger)`,
            type_line: 'Triggered Ability',
            oracle_text: trigger.effect,
          },
          targets: choice.targets || trigger.targets || [],
        };
        
        game.state.stack = game.state.stack || [];
        game.state.stack.push(stackItem as any);
        
        // Remove from trigger queue
        triggerQueue.splice(triggerIndex, 1);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${trigger.sourceName}'s triggered ability goes on the stack.`,
          ts: Date.now(),
        });
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "resolveTrigger", {
          playerId,
          triggerId,
          choice,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist resolveTrigger event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[triggers] resolveTrigger error:`, err);
      socket.emit("error", {
        code: "RESOLVE_TRIGGER_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Skip a triggered ability (for "may" triggers)
   */
  socket.on("skipTrigger", async ({
    gameId,
    triggerId,
  }: {
    gameId: string;
    triggerId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      const triggerQueue = (game.state as any)?.triggerQueue || [];
      const triggerIndex = triggerQueue.findIndex((t: any) => t.id === triggerId);
      
      if (triggerIndex !== -1) {
        const trigger = triggerQueue[triggerIndex];
        triggerQueue.splice(triggerIndex, 1);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} skips ${trigger.sourceName}'s triggered ability.`,
          ts: Date.now(),
        });
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[triggers] skipTrigger error:`, err);
    }
  });

  /**
   * Handle ordering multiple simultaneous triggers
   * When a player controls multiple triggers that trigger at the same time,
   * they choose the order in which they go on the stack.
   * The first trigger in the array goes on the stack first (resolves last).
   */
  socket.on("orderTriggers", async ({
    gameId,
    orderedTriggerIds,
  }: {
    gameId: string;
    orderedTriggerIds: string[];
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      const triggerQueue = (game.state as any)?.triggerQueue || [];
      
      // Find and remove the triggers from the queue
      const triggersToStack: any[] = [];
      for (const triggerId of orderedTriggerIds) {
        const triggerIndex = triggerQueue.findIndex((t: any) => t.id === triggerId);
        if (triggerIndex !== -1) {
          const trigger = triggerQueue.splice(triggerIndex, 1)[0];
          triggersToStack.push(trigger);
        }
      }
      
      if (triggersToStack.length === 0) {
        socket.emit("error", {
          code: "TRIGGERS_NOT_FOUND",
          message: "No valid triggers found to order",
        });
        return;
      }

      // Put triggers on the stack in the specified order
      // First in orderedTriggerIds goes on stack first (resolves last)
      game.state.stack = game.state.stack || [];
      
      for (const trigger of triggersToStack) {
        const stackItem = {
          id: `stack_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'ability',
          controller: playerId,
          card: {
            id: trigger.sourceId,
            name: `${trigger.sourceName} (trigger)`,
            type_line: 'Triggered Ability',
            oracle_text: trigger.effect,
            image_uris: trigger.imageUrl ? { small: trigger.imageUrl, normal: trigger.imageUrl } : undefined,
          },
          targets: trigger.targets || [],
        };
        
        game.state.stack.push(stackItem as any);
      }
      
      // Clear the pending trigger ordering flag for this player
      // This is CRITICAL to prevent the infinite loop where the AI keeps trying to advance
      // but is blocked by the (now-resolved) pending trigger ordering check
      if ((game.state as any).pendingTriggerOrdering) {
        delete (game.state as any).pendingTriggerOrdering[playerId];
        // If no more players have pending triggers, remove the entire object
        if (Object.keys((game.state as any).pendingTriggerOrdering).length === 0) {
          delete (game.state as any).pendingTriggerOrdering;
        }
      }
      
      // Also clear the prompt tracking set since triggers have been ordered
      if ((game.state as any)._triggerOrderingPromptedPlayers) {
        delete (game.state as any)._triggerOrderingPromptedPlayers;
      }
      
      // Send chat message about the triggers being put on the stack
      const triggerNames = triggersToStack.map((t: any) => t.sourceName).join(', ');
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} puts ${triggersToStack.length} triggered abilities on the stack: ${triggerNames}`,
        ts: Date.now(),
      });

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "orderTriggers", {
          playerId,
          orderedTriggerIds,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist orderTriggers event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      console.log(`[triggers] ${playerId} ordered ${triggersToStack.length} triggers onto stack in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[triggers] orderTriggers error:`, err);
      socket.emit("error", {
        code: "ORDER_TRIGGERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle "sacrifice unless you pay" ETB choice (Transguild Promenade, Gateway Plaza, Rupture Spire)
   * Player can either pay the mana cost or sacrifice the permanent
   */
  socket.on("sacrificeUnlessPayChoice", async ({
    gameId,
    permanentId,
    payMana,
  }: {
    gameId: string;
    permanentId: string;
    payMana: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "SACRIFICE_UNLESS_PAY_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Ensure game state exists
      game.state = (game.state || {}) as any;
      game.state.battlefield = game.state.battlefield || [];
      
      // Find the permanent
      const battlefield = game.state.battlefield;
      const permIndex = battlefield.findIndex((p: any) => 
        p.id === permanentId && p.controller === playerId
      );
      
      if (permIndex === -1) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Permanent not found on battlefield",
        });
        return;
      }

      const permanent = battlefield[permIndex];
      const cardName = (permanent as any).card?.name || "Permanent";

      if (payMana) {
        // Player chose to pay {1} - use proper mana consumption
        const manaPool = getOrInitManaPool(game.state, playerId);
        const totalAvailableByColor = calculateTotalAvailableMana(manaPool, []);
        const totalMana = Object.values(totalAvailableByColor).reduce((sum, val) => sum + val, 0);
        
        if (totalMana < 1) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay {1} for ${cardName} - insufficient mana available`,
          });
          return;
        }
        
        // Consume {1} generic mana from pool
        consumeManaFromPool(manaPool, {}, 1, `[sacrificeUnlessPayChoice:${cardName}]`);
        
        // Permanent stays on battlefield
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} pays {1} for ${cardName}.`,
          ts: Date.now(),
        });
      } else {
        // Player chose not to pay - sacrifice the permanent
        const card = (permanent as any).card;
        
        // Remove from battlefield
        battlefield.splice(permIndex, 1);
        
        // Move to graveyard
        const zones = game.state?.zones?.[playerId];
        if (zones) {
          zones.graveyard = zones.graveyard || [];
          (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
          zones.graveyardCount = (zones.graveyard as any[]).length;
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} sacrifices ${cardName} (didn't pay {1}).`,
          ts: Date.now(),
        });
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "sacrificeUnlessPayChoice", {
          playerId,
          permanentId,
          payMana,
          cardName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist sacrificeUnlessPayChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      console.log(`[triggers] ${payMana ? "Paid for" : "Sacrificed"} ${cardName} for player ${playerId} in game ${gameId}`);
      
    } catch (err: any) {
      console.error(`[triggers] sacrificeUnlessPayChoice error:`, err);
      socket.emit("error", {
        code: "SACRIFICE_UNLESS_PAY_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle reveal land ETB choice (Furycalm Snarl, etc.)
   * Player can reveal a matching card from hand to have the land enter untapped
   */
  socket.on("revealLandChoice", async ({
    gameId,
    permanentId,
    revealCardId,
  }: {
    gameId: string;
    permanentId: string;
    revealCardId: string | null; // null means don't reveal, land enters tapped
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "REVEAL_LAND_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Ensure game state exists
      game.state = (game.state || {}) as any;
      game.state.battlefield = game.state.battlefield || [];
      
      // Find the permanent
      const battlefield = game.state.battlefield;
      const permanent = battlefield.find((p: any) => 
        p.id === permanentId && p.controller === playerId
      );
      
      if (!permanent) {
        socket.emit("error", {
          code: "PERMANENT_NOT_FOUND",
          message: "Land not found on battlefield",
        });
        return;
      }

      const cardName = (permanent as any).card?.name || "Land";

      if (revealCardId) {
        // Player chose to reveal - find the card in hand
        const zones = game.state?.zones?.[playerId];
        if (!zones || !Array.isArray(zones.hand)) {
          socket.emit("error", {
            code: "NO_HAND",
            message: "Hand not found",
          });
          return;
        }
        
        const revealedCard = (zones.hand as any[]).find((c: any) => c?.id === revealCardId);
        if (!revealedCard) {
          socket.emit("error", {
            code: "CARD_NOT_IN_HAND",
            message: "Card to reveal not found in hand",
          });
          return;
        }
        
        const revealedName = revealedCard.name || "card";
        
        // Land enters untapped
        (permanent as any).tapped = false;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} reveals ${revealedName}. ${cardName} enters untapped.`,
          ts: Date.now(),
        });
        
        console.log(`[triggers] ${playerId} revealed ${revealedName} for ${cardName} to enter untapped`);
        
      } else {
        // Player chose not to reveal - land enters tapped
        (permanent as any).tapped = true;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)}'s ${cardName} enters tapped (didn't reveal a card).`,
          ts: Date.now(),
        });
        
        console.log(`[triggers] ${cardName} enters tapped for ${playerId} (no reveal)`);
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "revealLandChoice", {
          playerId,
          permanentId,
          revealCardId,
          cardName,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist revealLandChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[triggers] revealLandChoice error:`, err);
      socket.emit("error", {
        code: "REVEAL_LAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle Kynaios and Tiro of Meletis style choice
   * Players choose to either play a land from hand or (for opponents) draw a card
   */
  socket.on("kynaiosChoiceResponse", async ({
    gameId,
    sourceController,
    choice,
    landCardId,
  }: {
    gameId: string;
    sourceController: string;
    choice: 'play_land' | 'draw_card' | 'decline';
    landCardId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "KYNAIOS_CHOICE_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Ensure game state exists
      game.state = (game.state || {}) as any;
      
      const pendingKynaiosChoice = (game.state as any).pendingKynaiosChoice;
      if (!pendingKynaiosChoice || !pendingKynaiosChoice[sourceController]) {
        socket.emit("error", {
          code: "NO_PENDING_CHOICE",
          message: "No pending Kynaios choice found",
        });
        return;
      }
      
      const choiceData = pendingKynaiosChoice[sourceController];
      
      // Verify this player is allowed to make a choice
      if (!choiceData.playersWhoMayPlayLand?.includes(playerId)) {
        socket.emit("error", {
          code: "NOT_YOUR_CHOICE",
          message: "You are not eligible to make this choice",
        });
        return;
      }
      
      // Initialize tracking arrays if needed
      choiceData.playersWhoPlayedLand = choiceData.playersWhoPlayedLand || [];
      choiceData.playersWhoDeclined = choiceData.playersWhoDeclined || [];
      
      // Check if already made choice
      if (choiceData.playersWhoPlayedLand.includes(playerId) || 
          choiceData.playersWhoDeclined.includes(playerId)) {
        socket.emit("error", {
          code: "ALREADY_CHOSE",
          message: "You have already made your choice",
        });
        return;
      }
      
      const isController = playerId === sourceController;
      
      if (choice === 'play_land' && landCardId) {
        // Player chose to play a land
        const zones = (game.state as any).zones?.[playerId];
        if (!zones || !Array.isArray(zones.hand)) {
          socket.emit("error", {
            code: "NO_HAND",
            message: "Hand not found",
          });
          return;
        }
        
        const cardIndex = zones.hand.findIndex((c: any) => c?.id === landCardId);
        if (cardIndex === -1) {
          socket.emit("error", {
            code: "CARD_NOT_IN_HAND",
            message: "Land card not found in hand",
          });
          return;
        }
        
        const card = zones.hand[cardIndex];
        const cardName = card.name || "Land";
        
        // Check if it's actually a land
        if (!(card.type_line || '').toLowerCase().includes('land')) {
          socket.emit("error", {
            code: "NOT_A_LAND",
            message: "Selected card is not a land",
          });
          return;
        }
        
        // Remove from hand
        zones.hand.splice(cardIndex, 1);
        zones.handCount = zones.hand.length;
        
        // Put onto battlefield
        game.state.battlefield = game.state.battlefield || [];
        const permanentId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        
        // Check if land enters tapped
        const oracleText = (card.oracle_text || '').toLowerCase();
        const entersTapped = oracleText.includes('enters tapped') || 
                            oracleText.includes('enters the battlefield tapped');
        
        const permanent = {
          id: permanentId,
          card,
          owner: playerId,
          controller: playerId,
          tapped: entersTapped,
          summoningSickness: false,
          zone: 'battlefield',
        };
        
        game.state.battlefield.push(permanent as any);
        
        // Track that this player played a land
        choiceData.playersWhoPlayedLand.push(playerId);
        
        // Chat message
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} puts ${cardName} onto the battlefield (${choiceData.sourceName || 'Kynaios and Tiro'}).`,
          ts: Date.now(),
        });
        
        console.log(`[triggers] ${playerId} played land ${cardName} via Kynaios choice`);
        
      } else if (choice === 'draw_card' && !isController) {
        // Opponent chose to draw instead of playing a land
        // They will draw when all choices are resolved
        choiceData.playersWhoDeclined.push(playerId);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} chooses to draw a card instead of playing a land (${choiceData.sourceName || 'Kynaios and Tiro'}).`,
          ts: Date.now(),
        });
        
        console.log(`[triggers] ${playerId} chose to draw via Kynaios choice`);
        
      } else if (choice === 'decline') {
        // Controller declined to play a land, or opponent declined (will draw)
        choiceData.playersWhoDeclined.push(playerId);
        
        if (isController) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, playerId)} declines to play a land (${choiceData.sourceName || 'Kynaios and Tiro'}).`,
            ts: Date.now(),
          });
        }
        
        console.log(`[triggers] ${playerId} declined Kynaios land play option`);
      }
      
      // Persist event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "kynaiosChoice", {
          playerId,
          sourceController,
          choice,
          landCardId,
        });
      } catch (e) {
        console.warn("[triggers] Failed to persist kynaiosChoice event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[triggers] kynaiosChoiceResponse error:`, err);
      socket.emit("error", {
        code: "KYNAIOS_CHOICE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
}

/**
 * Emit shock land prompt to a player
 */
export function emitShockLandPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  imageUrl?: string,
  currentLife?: number
): void {
  emitToPlayer(io, playerId, "shockLandPrompt", {
    gameId,
    permanentId,
    cardName,
    imageUrl,
    currentLife,
  });
}

/**
 * Emit triggered ability prompt to a player
 */
export function emitTriggerPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  trigger: {
    id: string;
    sourceId: string;
    sourceName: string;
    effect: string;
    type: 'may' | 'target' | 'order' | 'choice';
    options?: string[];
    targets?: { id: string; name: string; type: string }[];
    imageUrl?: string;
  }
): void {
  emitToPlayer(io, playerId, "triggerPrompt", {
    gameId,
    trigger,
  });
}

/**
 * Emit "sacrifice unless you pay" prompt to a player
 * Used for cards like Transguild Promenade, Gateway Plaza, Rupture Spire
 */
export function emitSacrificeUnlessPayPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  manaCost: string,
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "sacrificeUnlessPayPrompt", {
    gameId,
    permanentId,
    cardName,
    manaCost,
    imageUrl,
  });
}

/**
 * Emit Mimic Vat trigger prompt to a player
 * When a nontoken creature dies, the Mimic Vat controller can exile it
 */
export function emitMimicVatPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  mimicVatId: string,
  mimicVatName: string,
  dyingCreatureId: string,
  dyingCreatureName: string,
  dyingCreatureCard: any,
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "mimicVatTrigger", {
    gameId,
    mimicVatId,
    mimicVatName,
    dyingCreatureId,
    dyingCreatureName,
    dyingCreatureCard,
    imageUrl: dyingCreatureCard?.image_uris?.small || dyingCreatureCard?.image_uris?.normal || imageUrl,
    description: `${dyingCreatureName} died. You may exile it imprinted on ${mimicVatName}.`,
  });
}

/**
 * Emit Kroxa-style auto-sacrifice prompt
 * When a creature enters without its alternate cost (Escape), it sacrifices itself
 */
export function emitAutoSacrificeTrigger(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  reason: string,
  timing: 'immediate' | 'end_step',
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "autoSacrificeTrigger", {
    gameId,
    permanentId,
    cardName,
    reason,
    timing,
    imageUrl,
  });
}

/**
 * Emit devotion mana prompt
 * For cards like Karametra's Acolyte that add mana based on devotion
 */
export function emitDevotionManaPrompt(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
  cardName: string,
  devotionCount: number,
  manaColor: string,
  imageUrl?: string
): void {
  emitToPlayer(io, playerId, "devotionManaActivated", {
    gameId,
    permanentId,
    cardName,
    devotionCount,
    manaColor,
    manaAdded: devotionCount,
    imageUrl,
    message: `${cardName} adds ${devotionCount} ${manaColor} mana (devotion)`,
  });
}
