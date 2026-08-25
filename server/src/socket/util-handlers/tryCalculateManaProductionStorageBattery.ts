// server/src/socket/util-handlers/tryCalculateManaProductionStorageBattery.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: calculateManaProduction storage/charge/battery counter family
//   plus the generic self-remove-counter gate.
// Public entry symbols: tryCalculateManaProductionStorageBattery.
// Undefined falls through to aura/global bonus steps.

import type { ManaProductionInfo } from "./manaProductionTypes.js";
import type { ParsedRemoveCounterActivationCost } from "./manaRemoveCounterCostParse.js";
import {
  parseRemoveCounterActivationCost,
  getPermanentCounterAmount,
  resolveRemoveCounterCostFromActivation,
} from "./manaRemoveCounterCostParse.js";

export type CalculateManaProductionStorageBatteryArgs = {
  result: ManaProductionInfo;
  cardName: string;
  oracleText: string;
  permanent: any;
  chosenColor?: string;
  selectedAbilityCostText: string;
  hasSelectedLegacyManaAbility: boolean;
};

export function tryCalculateManaProductionStorageBattery(
  args: CalculateManaProductionStorageBatteryArgs,
): ManaProductionInfo | undefined {
  const {
    result,
    cardName,
    oracleText,
    permanent,
    chosenColor,
    selectedAbilityCostText,
    hasSelectedLegacyManaAbility,
  } = args;

  
  // ===== STORAGE COUNTER BASED MANA ABILITIES =====
  
  // Mage-Ring Network, Rushwood Grove, etc. - Storage lands
  // "Remove any number of storage counters from ~: Add {C} for each storage counter removed this way"
  if (oracleText.includes('storage counter') && oracleText.includes('remove')) {
    const storageCounters = permanent?.counters?.storage || permanent?.counters?.['storage'] || 0;
    result.isDynamic = true;
    result.baseAmount = storageCounters;
    result.dynamicDescription = `{C} for each storage counter removed (${storageCounters} available)`;
    result.colors = ['C'];
    // If the card produces colored mana, detect it
    if (oracleText.includes('add {g}') || cardName.includes('rushwood grove')) {
      result.colors = ['G'];
    } else if (oracleText.includes('add {w}') || cardName.includes('saprazzan cove')) {
      result.colors = ['W'];
    } else if (oracleText.includes('add {u}') || cardName.includes('fountain of cho')) {
      result.colors = ['U'];
    } else if (oracleText.includes('add {b}') || cardName.includes('subterranean hangar')) {
      result.colors = ['B'];
    } else if (oracleText.includes('add {r}') || cardName.includes('mercadian bazaar')) {
      result.colors = ['R'];
    }
  }
  
  // Kyren Toy - "Remove X charge counters: Add X mana plus one"
  if (cardName.includes('kyren toy')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters + 1; // X plus one
    result.dynamicDescription = `{C} = charge counters + 1 (${chargeCounters + 1})`;
    result.colors = ['C'];
  }
  
  // Gemstone Caverns - Has a luck counter when starting in hand
  if (cardName.includes('gemstone caverns')) {
    const hasLuckCounter = (permanent?.counters?.luck || 0) > 0;
    if (hasLuckCounter) {
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.colors = ['C'];
    }
    result.baseAmount = 1;
  }
  
  // Crystalline Crawler - Uses +1/+1 counters for mana
  // "Remove a +1/+1 counter from Crystalline Crawler: Add one mana of any color"
  if (cardName.includes('crystalline crawler')) {
    const p1p1Counters = (permanent?.counters?.['+1/+1'] || 0) + (permanent?.counters?.p1p1 || 0);
    if (p1p1Counters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1; // Removes one at a time
      result.dynamicDescription = `Any color mana (${p1p1Counters} +1/+1 counters available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Gemstone Array - Based on charge counters
  // "Remove a charge counter from this artifact: Add one mana of any color"
  if (cardName.includes('gemstone array')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      // Generic "any color" matching above can otherwise claim 1 mana with 0 counters.
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Coalition Relic - Uses charge counters for mana
  if (cardName.includes('coalition relic')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    // At the beginning of precombat main phase, remove all charge counters and add that much mana
    result.baseAmount = 1 + chargeCounters;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.dynamicDescription = `Any color + charge counters (${chargeCounters})`;
    }
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Mana Bloom - Uses charge counters
  if (cardName.includes('mana bloom')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters remain)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Pentad Prism - Sunburst with charge counters
  // "Remove a charge counter: Add one mana of any color"
  if (cardName.includes('pentad prism')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Sphere of the Suns - Uses charge counters
  if (cardName.includes('sphere of the suns')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters remain)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }

  // Generic gate: selected ability cost requires removing counters the permanent lacks
  // (or removing from another permanent — not usable as a self mana source).
  // When no ability is selected, also gate cards whose only mana abilities spend self counters.
  const removeCounterCost = resolveRemoveCounterCostFromActivation(
    String(result.activationCost || selectedAbilityCostText || ''),
    String(permanent?.card?.name || ''),
  );
  if (
    removeCounterCost &&
    (
      !removeCounterCost.refersToSource
      || getPermanentCounterAmount(permanent, removeCounterCost.counterType) < removeCounterCost.count
    )
  ) {
    result.baseAmount = 0;
    result.colors = [];
    result.bonusMana = [];
    result.requiresColorChoice = false;
  } else if (!removeCounterCost && !selectedAbilityCostText && !hasSelectedLegacyManaAbility) {
    const selfRemoveManaCosts: ParsedRemoveCounterActivationCost[] = [];
    let hasIndependentManaAbility = false;
    for (const line of String(permanent?.card?.oracle_text || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.includes(':')) continue;
      const costPart = trimmed.split(':')[0] || '';
      const effectPart = trimmed.split(':').slice(1).join(':');
      if (!/\badd\b/i.test(effectPart)) continue;
      if (!(/\bmana\b/i.test(effectPart) || /\{[wubrgc]\}/i.test(effectPart))) continue;
      const removeCost = parseRemoveCounterActivationCost(costPart, String(permanent?.card?.name || ''));
      if (removeCost?.refersToSource) {
        selfRemoveManaCosts.push(removeCost);
      } else {
        hasIndependentManaAbility = true;
      }
    }

    const canPayAnyRemove = selfRemoveManaCosts.some(
      (cost) => getPermanentCounterAmount(permanent, cost.counterType) >= cost.count,
    );
    if (selfRemoveManaCosts.length > 0 && !hasIndependentManaAbility && !canPayAnyRemove) {
      result.baseAmount = 0;
      result.colors = [];
      result.bonusMana = [];
      result.requiresColorChoice = false;
    }
  }
  return undefined;
}
