/**
 * socket/resolution-handlers/tapCostAnyCombinationManaOffStack.ts
 *
 * "{T}, Tap X untapped tokens you control: Add X mana in any combination of colors." (Hazel of the
 * Rootbloom) and other "Add N mana in any combination of colors" abilities whose cost is paid
 * through the tap-other-permanents prompt. Mana abilities never use the stack (CR 605.3a): once
 * the tap cost is paid, ask for the color distribution right away instead of pushing an ability.
 * Public entry symbol: tryResolveTapCostAnyCombinationManaOffStack.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { getManaMultiplier } from "../../state/modules/mana-abilities.js";
import { buildAnyCombinationManaSelectionFields } from "../../state/modules/manaColorSelectionStepUtils.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { getPlayerName } from "../util.js";

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const ANY_COMBINATION_EFFECT_RE = /^\s*add\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+mana\s+in\s+any\s+combination\s+of\s+colors\s*\.?\s*$/i;

/** Mana amount of an "Add N mana in any combination of colors" effect, or null for any other text. */
export function parseAnyCombinationManaEffectAmount(effectText: string): number | null {
  const match = String(effectText || '').match(ANY_COMBINATION_EFFECT_RE);
  if (!match) return null;
  const raw = String(match[1] || '').toLowerCase();
  const amount = WORD_NUMBERS[raw] ?? parseInt(raw, 10);
  return Number.isFinite(amount) ? Math.max(0, amount) : null;
}

export function tryResolveTapCostAnyCombinationManaOffStack(args: {
  io: Server;
  game: any;
  gameId: string;
  controllerId: string;
  permanentId: string;
  abilityId: string;
  cardName: string;
  abilityText: string;
  activatedAbilityText: string;
  sourcePerm: any;
  tappedPermanentsForCost: string[];
  resolvedStepId?: string;
  lifePaidForCost?: number;
}): boolean {
  const baseAmount = parseAnyCombinationManaEffectAmount(args.abilityText);
  if (baseAmount === null) return false;
  const { io, game, gameId, controllerId, permanentId, cardName } = args;

  const multiplier = Number(getManaMultiplier(game.state, args.sourcePerm, controllerId));
  const totalAmount = baseAmount * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
  const playerName = getPlayerName(game, controllerId as any);
  if (totalAmount <= 0) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`, gameId, from: 'system', ts: Date.now(),
      message: `${playerName} activated ${cardName}'s mana ability but added no mana.`,
    });
    return true;
  }

  const fields = buildAnyCombinationManaSelectionFields({ totalAmount, cardName });
  const queuedStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.MANA_COLOR_SELECTION,
    playerId: controllerId,
    sourceId: permanentId,
    sourceName: cardName,
    sourceImage: args.sourcePerm?.card?.image_uris?.small || args.sourcePerm?.card?.image_uris?.normal,
    mandatory: true,
    ...fields,
    permanentId,
    abilityId: args.abilityId || undefined,
    cardName,
    abilityText: args.abilityText,
    activatedAbilityText: args.activatedAbilityText || undefined,
    tappedPermanentsForCost: [...args.tappedPermanentsForCost],
  } as any);

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
      playerId: controllerId,
      resolvedStepId: args.resolvedStepId || undefined,
      permanentId,
      abilityId: args.abilityId || undefined,
      cardName,
      abilityText: args.abilityText,
      activatedAbilityText: args.activatedAbilityText || undefined,
      tappedPermanents: [...args.tappedPermanentsForCost],
      lifePaidForCost: args.lifePaidForCost && args.lifePaidForCost > 0 ? args.lifePaidForCost : undefined,
      queuedResolutionStep: queuedStep,
    });
  } catch (err) {
    debugWarn(1, '[tapCostAnyCombinationMana] appendEvent failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`, gameId, from: 'system', ts: Date.now(),
    message: `\u26a1 ${playerName} activated ${cardName}'s mana ability: add ${totalAmount} mana in any combination of colors.`,
  });
  return true;
}
