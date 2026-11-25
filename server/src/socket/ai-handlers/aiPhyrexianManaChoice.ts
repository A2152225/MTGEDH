/**
 * socket/ai-handlers/aiPhyrexianManaChoice.ts
 *
 * AI answer for a MANA_PAYMENT_CHOICE step with `phyrexianManaChoice: true` (activated abilities
 * with {B/P}-style costs). The step handler expects `selections` to be an array of
 * `{ index, payWithLife }`, one per entry of `step.phyrexianCosts`, and validates the result
 * against the mana pool (parsedCost colours + generic + each symbol paid with mana) and life.
 * Mirrors that validation: pay a symbol with its colour while the pool still covers the cost,
 * otherwise with life while that is not lethal.
 */

import { calculateTotalAvailableMana, getOrInitManaPool, validateManaPayment } from "../util.js";
import type { ResolutionStepResponse } from "../../state/resolution/index.js";

export type AIPhyrexianManaChoice = { index: number; payWithLife: boolean };

export function chooseAIPhyrexianManaChoiceSelections(game: any, playerId: string, step: any): AIPhyrexianManaChoice[] {
  const phyrexianCosts: any[] = Array.isArray(step?.phyrexianCosts) ? step.phyrexianCosts : [];
  const parsedCost = step?.parsedCost || {};
  const colors: Record<string, number> = { ...(parsedCost.colors || {}) };
  const generic = Number(parsedCost.generic || 0) || 0;
  let available: Record<string, number> = {};
  try {
    available = calculateTotalAvailableMana(getOrInitManaPool(game.state, playerId as any) as any, undefined);
  } catch {
    available = {};
  }
  const life = Number(game?.state?.life?.[playerId] ?? 40);
  let lifeSpent = 0;

  return phyrexianCosts.map((options: any, index: number) => {
    const entries: string[] = Array.isArray(options) ? options.filter((o: any) => typeof o === 'string') : [];
    const color = entries.find((o) => !o.startsWith('LIFE:') && !o.startsWith('GENERIC:'));
    const lifeOption = entries.find((o) => o.startsWith('LIFE:'));
    const lifeCost = lifeOption ? Number(lifeOption.split(':')[1] || 2) || 2 : 2;
    if (color) {
      const trial = { ...colors, [color]: Number(colors[color] || 0) + 1 };
      if (!validateManaPayment(available, trial, generic)) {
        colors[color] = trial[color];
        return { index, payWithLife: false };
      }
    }
    if (life - lifeSpent - lifeCost > 0) {
      lifeSpent += lifeCost;
      return { index, payWithLife: true };
    }
    if (color) colors[color] = Number(colors[color] || 0) + 1;
    return { index, payWithLife: false };
  });
}

/** Full AI response for a Phyrexian activation payment step (handleAIResolutionStep), or null when the step is not one. */
export function buildAIPhyrexianManaChoiceResponse(game: any, step: any): ResolutionStepResponse | null {
  if (step?.phyrexianManaChoice !== true) return null;
  return {
    stepId: step.id,
    playerId: step.playerId,
    selections: chooseAIPhyrexianManaChoiceSelections(game, String(step.playerId), step) as any,
    cancelled: false,
    timestamp: Date.now(),
  };
}
