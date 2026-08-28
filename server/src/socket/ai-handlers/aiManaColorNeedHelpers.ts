/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: AI mana-color need weights for choose-a-color abilities
 * (Three Tree City / Nykthos invest lines) and the paid-scaling vs `{T}: Add {C}`
 * break-even gate.
 *
 * Public entry symbols: collectAIManaColorNeedWeights,
 * pickAIManaColorByNeedWeights, shouldAIPreferPaidScalingManaOverColorlessTap.
 */

import { parseManaCost } from "../../state/modules/mana-check.js";
import { AI_MANA_COLOR_PRIORITY, COLOR_IDENTITY_MAP } from "./aiConstants.js";

const COLOR_CODES = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

function emptyNeedWeights(): Record<string, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function addParsedCostNeeds(
  weights: Record<string, number>,
  manaCostText: string,
  pool: Record<string, number>,
  scale: number,
): void {
  const parsed = parseManaCost(String(manaCostText || '').trim());
  if (!parsed) return;

  for (const code of COLOR_CODES) {
    if (code === 'C') continue;
    const required = Number((parsed.colors as any)?.[code] || 0);
    if (required <= 0) continue;
    const poolKey = COLOR_IDENTITY_MAP[code] || 'colorless';
    const deficit = Math.max(0, required - Number(pool[poolKey] || 0));
    if (deficit > 0) weights[code] += deficit * scale;
  }

  const colorlessAvailable = Number(pool.colorless || 0);
  const requiredColorlessPips = Number((parsed.colors as any)?.C || 0);
  const colorlessPipDeficit = Math.max(0, requiredColorlessPips - colorlessAvailable);
  if (colorlessPipDeficit > 0) weights.C += colorlessPipDeficit * scale;
  const remainingColorless = Math.max(0, colorlessAvailable - requiredColorlessPips);
  const generic = Number(parsed.generic || 0);
  const genericDeficit = Math.max(0, generic - remainingColorless);
  if (genericDeficit > 0) weights.C += genericDeficit * scale;
}

function getCommandZoneCards(game: any, playerId: string): any[] {
  const commandZone = game?.state?.commandZone?.[playerId];
  if (!commandZone) return [];
  if (Array.isArray(commandZone)) return commandZone;

  const cards = Array.isArray(commandZone.commanderCards) ? commandZone.commanderCards : [];
  if (Array.isArray(commandZone.inCommandZone)) {
    const inZone = new Set(commandZone.inCommandZone.map((id: any) => String(id || '')).filter(Boolean));
    if (inZone.size === 0) return [];
    return cards.filter((card: any) => inZone.has(String(card?.id || '')));
  }
  return cards;
}

function getHandCards(game: any, playerId: string): any[] {
  const hand = game?.state?.zones?.[playerId]?.hand;
  return Array.isArray(hand) ? hand : [];
}

function getManaPoolCounts(game: any, playerId: string): Record<string, number> {
  const pool = (game?.state?.manaPool || {})[playerId] || {};
  return {
    white: Number(pool.white || 0),
    blue: Number(pool.blue || 0),
    black: Number(pool.black || 0),
    red: Number(pool.red || 0),
    green: Number(pool.green || 0),
    colorless: Number(pool.colorless || 0),
  };
}

/** Weighted color deficits from pending casts, commander, and hand. */
export function collectAIManaColorNeedWeights(game: any, playerId: string): Record<string, number> {
  const weights = emptyNeedWeights();
  const pool = getManaPoolCounts(game, playerId);

  const pendingCasts = Object.values(((game?.state as any)?.pendingSpellCasts || {}) as Record<string, any>)
    .filter((entry) => String(entry?.playerId || '') === String(playerId || ''));
  for (const pending of pendingCasts) {
    const costText = String(pending?.manaCost || pending?.card?.mana_cost || '').trim();
    addParsedCostNeeds(weights, costText, pool, 100);
  }

  for (const commander of getCommandZoneCards(game, playerId)) {
    const costText = String(commander?.mana_cost || commander?.card?.mana_cost || '').trim();
    addParsedCostNeeds(weights, costText, pool, 40);
  }

  for (const card of getHandCards(game, playerId)) {
    const costText = String(card?.mana_cost || card?.card?.mana_cost || '').trim();
    addParsedCostNeeds(weights, costText, pool, 8);
  }

  return weights;
}

export function pickAIManaColorByNeedWeights(
  producedColors: string[],
  needWeights: Record<string, number>,
  pool: Record<string, number>,
): string {
  const codes = [...new Set(
    producedColors
      .map((color) => String(color || '').toUpperCase())
      .filter((color) => COLOR_CODES.includes(color as typeof COLOR_CODES[number])),
  )];
  if (codes.length === 0) return 'C';

  const colored = codes.filter((color) => color !== 'C');
  const neededAmongProduced = codes.filter((color) => Number(needWeights[color] || 0) > 0);
  const coloredNeeds = colored.filter((color) => Number(needWeights[color] || 0) > 0);

  let search = codes;
  if (coloredNeeds.length > 0) {
    search = coloredNeeds;
  } else if (neededAmongProduced.length > 0) {
    search = neededAmongProduced;
  } else if (Number(needWeights.C || 0) > 0 && codes.includes('C') && coloredNeeds.length === 0) {
    search = ['C'];
  } else if (colored.length > 0) {
    search = colored;
  }

  const sorted = [...search].sort((left, right) => {
    const leftNeed = Number(needWeights[left] || 0);
    const rightNeed = Number(needWeights[right] || 0);
    if (leftNeed !== rightNeed) return rightNeed - leftNeed;

    const leftKey = COLOR_IDENTITY_MAP[left] || 'colorless';
    const rightKey = COLOR_IDENTITY_MAP[right] || 'colorless';
    const leftCount = Number((pool as any)[leftKey] || 0);
    const rightCount = Number((pool as any)[rightKey] || 0);
    if (leftCount !== rightCount) return leftCount - rightCount;

    return AI_MANA_COLOR_PRIORITY.indexOf(left) - AI_MANA_COLOR_PRIORITY.indexOf(right);
  });

  return sorted[0] || 'C';
}

/**
 * `{2}, {T}` plus losing `{T}: Add {C}` needs 3 mana of the chosen type to break even.
 * Two creatures of the type pays the {2} but still loses the colorless tap — a net −1.
 * Color-fixing does not change that; only a real surplus recoups the extra tap.
 */
export function shouldAIPreferPaidScalingManaOverColorlessTap(args: {
  producedAmount: number;
  activationGenericCost?: number;
  neededColor?: string | null;
}): boolean {
  const produced = Number(args.producedAmount || 0);
  const paid = Math.max(0, Number(args.activationGenericCost || 0));
  if (produced <= 0) return false;
  if (paid <= 0) return produced > 0;

  return produced >= paid + 1;
}
