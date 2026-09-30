/**
 * socket/resolutionPutCardOntoBattlefieldUtils.ts
 *
 * Shared helper for putting a searched/selected card onto the battlefield
 * (fetchlands, Cultivate splits, dungeon rooms, etc.). Extracted from resolution.ts.
 */

import type { Server } from "socket.io";
import { debug } from "../utils/debug.js";
import { isShockLand } from "./land-helpers.js";
import { ResolutionQueueManager } from "../state/resolution/index.js";
import { queueShockLandPaymentStep } from "./optional-payment-prompts.js";
import { queueTributeChoiceOnEntry } from "../state/modules/triggerTributeChoiceUtils.js";
import { queueSelfETBTriggersForPermanent } from "../state/modules/triggerEtbEntryEffects.js";
import { stampPermanentEntryTimestamp, stampAttachmentTimestamp } from '../../../rules-engine/src/permanentTimestamps.js';
import { applyGraveyardTypeEntryCounterGrants } from "../state/modules/graveyardTypeEntryCounterBonus.js";

/**
 * Helper function to put a card onto the battlefield
 * Handles creatures, planeswalkers, and triggers
 */
export async function putCardOntoBattlefield(
  card: any,
  controller: string,
  entersTapped: boolean,
  state: any,
  battlefield: any[],
  uid: any,
  parsePT: any,
  cardManaValue: any,
  applyCounterModifications: any,
  getETBTriggersForPermanent: any,
  triggerETBEffectsForPermanent: any,
  detectEntersWithCounters: any,
  creatureWillHaveHaste: any,
  checkPermanentEntersTapped: any,
  game: any,
  io?: Server,
  gameId?: string
): Promise<string> {
  const tl = (card.type_line || '').toLowerCase();
  const isCreature = tl.includes('creature');
  const isPlaneswalker = tl.includes('planeswalker');
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  const hasHaste = isCreature && creatureWillHaveHaste(card, controller, battlefield);
  const hasSummoningSickness = isCreature && !hasHaste;
  let shouldEnterTapped = entersTapped;
  if (!entersTapped) {
    shouldEnterTapped = checkPermanentEntersTapped(battlefield, controller, card);
  }
  
  const initialCounters: Record<string, number> = {};
  if (isPlaneswalker && card.loyalty) {
    const startingLoyalty = typeof card.loyalty === 'number' ? card.loyalty : parseInt(card.loyalty, 10);
    if (!isNaN(startingLoyalty)) {
      initialCounters.loyalty = startingLoyalty;
    }
  }
  const etbCounters = detectEntersWithCounters(card);
  // Object.entries returns [string, unknown][] even for Record<string, number>, so we need the type assertion
  for (const [counterType, count] of Object.entries(etbCounters)) {
    initialCounters[counterType] = (initialCounters[counterType] || 0) + (count as number);
  }
  
  const tempId = uid("perm");
  const tempPerm = { id: tempId, controller, counters: {} };
  battlefield.push(tempPerm as any);
  const modifiedCounters = applyCounterModifications(state, tempId, initialCounters);
  battlefield.pop();
  
  const newPermanent = {
    id: tempId,
    controller,
    owner: controller,
    tapped: shouldEnterTapped,
    counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : undefined,
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    ...(isCreature ? { enteredThisTurn: true } : {}),
    card: { ...card, zone: "battlefield" },
  } as any;
  
  battlefield.push(newPermanent);
  stampPermanentEntryTimestamp(state, newPermanent);
  applyGraveyardTypeEntryCounterGrants(state, newPermanent, String(controller));
  
  // ====================================================================================
  // Shock Land Handling: Emit prompt for "pay 2 life or enter tapped" lands
  // This handles shock lands when they enter from library (fetchlands), graveyard, etc.
  // Pattern: "As ~ enters the battlefield, you may pay 2 life. If you don't, it enters tapped."
  // ====================================================================================
  const isLand = tl.includes('land');
  const cardName = card.name || "Unknown";
  if (isLand && isShockLand(cardName, String(card?.oracle_text || '')) && io && gameId) {
    // Shock land detected - queue choice to player
    const currentLife = (game.state as any)?.life?.[controller] || 
                       (game as any)?.life?.[controller] || 40;
    
    // Get card image URL
    const imageUrl = card.image_uris?.small || card.image_uris?.normal;

    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, controller as any)
      .find((s: any) => (s as any)?.shockLandChoice === true && String((s as any)?.permanentId || '') === String(newPermanent.id));
    if (!existing) {
      queueShockLandPaymentStep(io, game, gameId, String(controller), newPermanent, cardName, imageUrl);
    }

    debug(2, `[putCardOntoBattlefield] Shock land ${cardName} entering - queued choice for ${controller}`);
  }
  const ctx = { 
    state, 
    gameId: String((game as any).gameId || gameId || '').trim(),
    inactive: new Set(), 
    libraries: (game as any).libraries, 
    players: state.players 
  };

  const tributeChoiceDeferred = queueTributeChoiceOnEntry(ctx as any, newPermanent, controller as any);
  if (!tributeChoiceDeferred) {
    queueSelfETBTriggersForPermanent(ctx as any, newPermanent, controller as any);
    triggerETBEffectsForPermanent(ctx as any, newPermanent, controller, false);
  } else {
    debug(2, `[putCardOntoBattlefield] ${cardName} tribute choice queued before ETB triggers are created`);
  }

  return String(newPermanent.id);
}
