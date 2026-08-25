/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: additional costs a cast can carry on top of its mana cost -
 * harmonize options, the effective detected additional cost, squad (recorded
 * times paid and the resulting cost), and the cards a reveal additional cost
 * can be satisfied with.
 *
 * Public entry symbols: calculateHarmonizeOptions, getEffectiveAdditionalCost,
 * the squad helpers, getRevealAdditionalCostCards.
 */
import { debugError } from "../../utils/debug.js";
import { detectAdditionalCost, type AdditionalCostResult } from "../land-helpers";
import { getEffectivePower } from "../util";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { repeatManaCost } from "./gameActionsModalCastModeCosts.js";

export function calculateHarmonizeOptions(
  game: any,
  playerId: string,
  card: any,
): {
  availableCreatures: Array<{
    id: string;
    name: string;
    power: number;
    imageUrl?: string;
  }>;
  messages: string[];
} {
  const options = {
    availableCreatures: [] as Array<{
      id: string;
      name: string;
      power: number;
      imageUrl?: string;
    }>,
    messages: [] as string[],
  };

  try {
    if (String((card as any)?.castWithAbility || '').trim().toLowerCase() !== 'harmonize') {
      return options;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent || String(permanent.controller || '') !== String(playerId || '')) continue;
      if ((permanent as any).tapped === true) continue;
      if (!String(permanent?.card?.type_line || '').toLowerCase().includes('creature')) continue;

      options.availableCreatures.push({
        id: String(permanent.id || ''),
        name: String(permanent?.card?.name || 'Creature'),
        power: Math.max(0, Number(getEffectivePower(permanent) || 0)),
        imageUrl: permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal,
      });
    }

    if (options.availableCreatures.length > 0) {
      options.messages.push(`Harmonize available: ${options.availableCreatures.length} untapped creature(s)`);
    }
  } catch (error) {
    debugError(1, '[calculateHarmonizeOptions] Error:', error);
  }

  return options;
}

export function getEffectiveAdditionalCost(card: any, oracleText: string): AdditionalCostResult | null {
  const sourceGrantedAdditionalCost = (card as any)?.sourceGrantedAdditionalCost;
  if (sourceGrantedAdditionalCost && typeof sourceGrantedAdditionalCost === 'object') {
    const type = String((sourceGrantedAdditionalCost as any).type || '').trim().toLowerCase();
    const amount = Number((sourceGrantedAdditionalCost as any).amount || 0);
    const filter = String((sourceGrantedAdditionalCost as any).filter || '').trim().toLowerCase();
    if ((type === 'discard' || type === 'sacrifice') && amount > 0) {
      return {
        type: type as 'discard' | 'sacrifice',
        amount,
        ...(filter ? { filter } : {}),
      };
    }

    if (type === 'remove_counters' && amount > 0) {
      const counterType = String((sourceGrantedAdditionalCost as any).counterType || '').trim();
      return {
        type: 'remove_counters',
        amount,
        filter: filter || 'creature',
        distributed: true,
        ...(counterType ? { counterType } : {}),
      };
    }
  }

  return detectAdditionalCost(oracleText);
}

export function getRecordedSquadTimesPaid(card: any): number {
  const n = Number(card?.squadTimesPaid);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function getPendingSquadTimesPaidFields(card: any): { squadTimesPaid: number } | Record<string, never> {
  if (!Number.isFinite(Number(card?.squadTimesPaid))) return {};
  return { squadTimesPaid: getRecordedSquadTimesPaid(card) };
}

export function getSquadDisplayedCost(oracleText: string, fallback?: string): string | undefined {
  const additional = detectAdditionalCost(oracleText);
  if (additional?.type === 'squad' && additional.cost) return String(additional.cost);
  return fallback;
}

export function getSquadAdditionalManaCost(oracleText: string, timesPaid: number): string | undefined {
  if (timesPaid <= 0) return undefined;
  const additional = detectAdditionalCost(oracleText);
  if (additional?.type !== 'squad' || !additional.cost) return undefined;
  return repeatManaCost(String(additional.cost).replace(/\s+/g, ''), timesPaid);
}

export function getRevealAdditionalCostCards(hand: any[], castSourceZone: SpellCastSourceZone, cardId: string, additionalCost: AdditionalCostResult): any[] {
  const filter = String(additionalCost.filter || '').trim().toLowerCase();
  return (Array.isArray(hand) ? hand : [])
    .filter((card: any) => card && (castSourceZone === 'hand' ? String(card.id || '') !== String(cardId || '') : true))
    .filter((card: any) => {
      if (!filter) return true;
      const typeLine = String(card?.type_line || '').toLowerCase();
      const name = String(card?.name || '').toLowerCase();
      return typeLine.includes(filter) || name.includes(filter);
    });
}
