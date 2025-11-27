import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import { uid, parsePT } from "../utils.js";
import { recalculatePlayerEffects } from "./game-state-effects.js";

/**
 * Stack / resolution helpers (extracted).
 *
 * Exports:
 * - pushStack
 * - resolveTopOfStack
 * - playLand
 * - castSpell
 * - exileEntireStack
 *
 * exileEntireStack moves all items from the stack into controller exile zones
 * (ctx.state.zones[controller].exile). It returns the number of items exiled and bumps seq.
 * It is conservative and defensive about shapes so it won't throw on unexpected input.
 */

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();
  
  // Check for creature types after "—" or "-"
  const dashIndex = lower.indexOf("—") !== -1 ? lower.indexOf("—") : lower.indexOf("-");
  if (dashIndex !== -1) {
    const subtypes = lower.slice(dashIndex + 1).trim().split(/\s+/);
    types.push(...subtypes.filter(t => t.length > 0));
  }
  
  return types;
}

/**
 * Check if a creature entering the battlefield would have haste
 * from effects already on the battlefield.
 * 
 * This is used when determining if a creature should have summoning sickness.
 * Rule 702.10: Haste allows a creature to attack and use tap abilities immediately.
 */
function creatureWillHaveHaste(
  card: any,
  controller: string,
  battlefield: any[]
): boolean {
  try {
    const cardTypeLine = (card?.type_line || "").toLowerCase();
    const cardOracleText = (card?.oracle_text || "").toLowerCase();
    
    // 1. Check if the creature itself has haste
    if (cardOracleText.includes('haste')) {
      return true;
    }
    
    // 2. Check battlefield for permanents that grant haste
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      
      // Check for "creatures you control have haste" effects
      if (grantorController === controller) {
        if (grantorOracle.includes('creatures you control have haste') ||
            grantorOracle.includes('other creatures you control have haste')) {
          return true;
        }
        
        // Check for tribal haste grants (e.g., "Goblin creatures you control have haste")
        const creatureTypes = extractCreatureTypes(cardTypeLine);
        for (const creatureType of creatureTypes) {
          const pattern = new RegExp(`${creatureType}[^.]*have haste`, 'i');
          if (pattern.test(grantorOracle)) {
            return true;
          }
        }
      }
      
      // Check for effects that grant haste to all creatures
      if (grantorOracle.includes('all creatures have haste') ||
          grantorOracle.includes('each creature has haste')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn('[creatureWillHaveHaste] Error checking haste:', err);
    return false;
  }
}

/* Push an item onto the stack */
export function pushStack(
  ctx: GameContext,
  item: {
    id: string;
    controller: PlayerID;
    card: any;
    targets?: string[];
  }
) {
  const { state } = ctx;
  state.stack = state.stack || [];
  state.stack.push(item as any);
  ctx.bumpSeq();
}

/* Pop and return the top stack item (internal helper) */
function popStackItem(ctx: GameContext) {
  const s = ctx.state;
  if (!s.stack || s.stack.length === 0) return null;
  return s.stack.pop()!;
}

/**
 * Check if a card type line represents a permanent (not instant/sorcery)
 */
function isPermanentTypeLine(typeLine?: string): boolean {
  if (!typeLine) return false;
  const tl = typeLine.toLowerCase();
  // Instants and sorceries are not permanents
  if (/\binstant\b/.test(tl) || /\bsorcery\b/.test(tl)) return false;
  // Everything else that can be cast is a permanent (creature, artifact, enchantment, planeswalker, battle)
  return /\b(creature|artifact|enchantment|planeswalker|battle)\b/.test(tl);
}

/* Resolve the top item - moves permanent spells to battlefield */
export function resolveTopOfStack(ctx: GameContext) {
  const item = popStackItem(ctx);
  if (!item) return;
  
  const { state, bumpSeq } = ctx;
  const card = item.card;
  const controller = item.controller as PlayerID;
  
  if (card && isPermanentTypeLine(card.type_line)) {
    // Permanent spell resolves - move to battlefield
    const tl = (card.type_line || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(tl);
    const baseP = isCreature ? parsePT((card as any).power) : undefined;
    const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
    
    // Check if the creature has haste from any source (own text or battlefield effects)
    // Rule 702.10: Haste allows ignoring summoning sickness
    const battlefield = state.battlefield || [];
    const hasHaste = isCreature && creatureWillHaveHaste(card, controller, battlefield);
    
    // Creatures have summoning sickness when they enter (unless they have haste)
    // Rule 302.6: A creature's activated ability with tap/untap symbol can't be
    // activated unless the creature has been under controller's control since 
    // their most recent turn began.
    const hasSummoningSickness = isCreature && !hasHaste;
    
    state.battlefield = state.battlefield || [];
    state.battlefield.push({
      id: uid("perm"),
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower: baseP,
      baseToughness: baseT,
      summoningSickness: hasSummoningSickness,
      card: { ...card, zone: "battlefield" },
    } as any);
    
    // Build a readable status message for logging
    let statusNote = '';
    if (hasSummoningSickness) {
      statusNote = ' (summoning sickness)';
    } else if (hasHaste) {
      statusNote = ' (haste)';
    }
    console.log(`[resolveTopOfStack] Permanent ${card.name || 'unnamed'} entered battlefield under ${controller}${statusNote}`);
    
    // Recalculate player effects when permanents ETB (for Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      console.warn('[resolveTopOfStack] Failed to recalculate player effects:', err);
    }
  } else if (card) {
    // Non-permanent spell (instant/sorcery) - goes to graveyard after resolution
    const zones = ctx.state.zones || {};
    const z = zones[controller];
    if (z) {
      z.graveyard = z.graveyard || [];
      (z.graveyard as any[]).push({ ...card, zone: "graveyard" });
      z.graveyardCount = (z.graveyard as any[]).length;
      console.log(`[resolveTopOfStack] Spell ${card.name || 'unnamed'} moved to graveyard for ${controller}`);
    }
  }
  
  bumpSeq();
}

/* Place a land onto the battlefield for a player (simplified) */
export function playLand(ctx: GameContext, playerId: PlayerID, cardOrId: any) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the battlefield (idempotency for replay)
  if (cardId && Array.isArray(state.battlefield)) {
    const alreadyOnBattlefield = state.battlefield.some(
      (p: any) => p?.card?.id === cardId && p?.controller === playerId
    );
    if (alreadyOnBattlefield) {
      console.info(`playLand: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
      return;
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      console.warn(`playLand: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      console.warn(`playLand: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c.id === cardOrId);
    if (idx === -1) {
      // During replay, card might not be in hand anymore - this is okay
      console.info(`playLand: card ${cardOrId} not found in hand for player ${playerId} (may be replay)`);
      return;
    }
    // Remove card from hand
    card = handCards.splice(idx, 1)[0];
    z.handCount = handCards.length;
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      console.warn(`playLand: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }
  }
  
  const tl = (card.type_line || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isLand = /\bland\b/.test(tl);
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  
  // Check if the permanent has haste from any source (own text or battlefield effects)
  // Rule 702.10: Haste allows ignoring summoning sickness
  const battlefield = state.battlefield || [];
  const hasHaste = isCreature && creatureWillHaveHaste(card, playerId, battlefield);
  
  // Rule 302.6: Summoning sickness applies to CREATURES (including creature lands like Dryad Arbor)
  // - A pure land (not a creature) does NOT have summoning sickness
  // - A "Land Creature" like Dryad Arbor DOES have summoning sickness because it's a creature
  // - If a land becomes a creature later (via animation), it would need to be checked at that time
  const hasSummoningSickness = isCreature && !hasHaste;
  
  state.battlefield = state.battlefield || [];
  state.battlefield.push({
    id: uid("perm"),
    controller: playerId,
    owner: playerId,
    tapped: false,
    counters: {},
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: { ...card, zone: "battlefield" },
  } as any);
  state.landsPlayedThisTurn = state.landsPlayedThisTurn || {};
  state.landsPlayedThisTurn[playerId] = (state.landsPlayedThisTurn[playerId] ?? 0) + 1;
  
  // Recalculate player effects when lands ETB (some lands might have effects)
  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    console.warn('[playLand] Failed to recalculate player effects:', err);
  }
  
  bumpSeq();
}

/**
 * Cast a spell from hand onto the stack.
 * 
 * @param ctx - Game context
 * @param playerId - Player casting the spell
 * @param cardOrId - Either a card ID string or a card object
 * @param targets - Optional array of target IDs
 */
export function castSpell(
  ctx: GameContext, 
  playerId: PlayerID, 
  cardOrId: any,
  targets?: any[]
) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the stack or battlefield (idempotency for replay)
  if (cardId) {
    if (Array.isArray(state.stack)) {
      const alreadyOnStack = state.stack.some(
        (s: any) => s?.card?.id === cardId && s?.controller === playerId
      );
      if (alreadyOnStack) {
        console.info(`castSpell: card ${cardId} already on stack for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
    if (Array.isArray(state.battlefield)) {
      const alreadyOnBattlefield = state.battlefield.some(
        (p: any) => p?.card?.id === cardId && p?.controller === playerId
      );
      if (alreadyOnBattlefield) {
        console.info(`castSpell: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      console.warn(`castSpell: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      console.warn(`castSpell: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c.id === cardOrId);
    if (idx === -1) {
      // During replay, card might not be in hand anymore - this is okay
      console.info(`castSpell: card ${cardOrId} not found in hand for player ${playerId} (may be replay)`);
      return;
    }
    // Remove card from hand
    card = handCards.splice(idx, 1)[0];
    z.handCount = handCards.length;
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      console.warn(`castSpell: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c && c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }
  }
  
  // Add to stack
  const stackItem = {
    id: uid("stack"),
    controller: playerId,
    card: { ...card, zone: "stack" },
    targets: targets || [],
  };
  
  state.stack = state.stack || [];
  state.stack.push(stackItem as any);
  bumpSeq();
}

/**
 * Exile the entire stack to players' exile zones.
 *
 * Behavior:
 * - Moves all items from state.stack into each item's controller exile array under ctx.state.zones[controller].exile.
 * - Ensures ctx.state.zones[controller] exists and has exile array.
 * - Returns the number of items exiled.
 * - Bumps seq on success.
 *
 * Notes:
 * - This is intended for effects like Sundial of the Infinite. Caller should ensure correct timing/permissions.
 * - If no stack present it returns 0.
 */
export function exileEntireStack(ctx: GameContext, invokedBy?: PlayerID): number {
  const s = ctx.state;
  if (!s || !Array.isArray(s.stack) || s.stack.length === 0) return 0;

  try {
    const zones = s.zones = s.zones || {};
    const moved = s.stack.splice(0, s.stack.length);
    let count = 0;
    for (const item of moved) {
      const controller = (item && (item.controller as PlayerID)) || invokedBy || "unknown";
      // Ensure zones shape exists
      (zones[controller] as any) = (zones[controller] as any) || {
        hand: [],
        handCount: 0,
        libraryCount: ctx.libraries.get(controller)?.length ?? 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      };
      const z = (zones[controller] as any);
      z.exile = z.exile || [];
      // Normalize card record pushed to exile
      if (item.card && typeof item.card === "object") {
        const cardObj = { ...(item.card as any), zone: "exile" };
        z.exile.push(cardObj);
      } else {
        z.exile.push({ id: item.id || uid("ex"), name: item.card?.name || "exiled_effect", zone: "exile" });
      }
      count++;
    }

    // Update counts for all affected players
    for (const pid of Object.keys(zones)) {
      const z = (zones as any)[pid];
      if (z) {
        z.graveyardCount = (z.graveyard || []).length;
        z.libraryCount = (ctx.libraries.get(pid) || []).length;
      }
    }

    ctx.bumpSeq();
    return count;
  } catch (err) {
    console.warn("exileEntireStack failed:", err);
    return 0;
  }
}