// server/src/socket/util-handlers/calculateManaProduction.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: calculateManaProduction dispatcher - setup locals then
//   tryCalculateX families (first defined result wins).
// Public entry symbols: calculateManaProduction.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { ManaProductionInfo } from "./manaProductionTypes.js";
import { parseSpelledOutAmount } from "./manaProductionAmountParse.js";
import {
  resolveActivatedAbilityLineById,
  resolveLegacyManaAbilityById,
} from "./manaAbilityLineResolvers.js";
import { tryCalculateManaProductionLandBasic } from "./tryCalculateManaProductionLandBasic.js";
import { tryCalculateManaProductionDynamic } from "./tryCalculateManaProductionDynamic.js";
import { tryCalculateManaProductionCreaturePower } from "./tryCalculateManaProductionCreaturePower.js";
import { tryCalculateManaProductionStorageBattery } from "./tryCalculateManaProductionStorageBattery.js";
import { tryCalculateManaProductionBonusesAndTotal } from "./tryCalculateManaProductionBonusesAndTotal.js";
import { getContinuousGrantedAbilitiesForPermanent } from "../../state/modules/staticEffectSpec.js";

/**
 * 
 * This considers:
 * - Fixed multi-mana (Sol Ring: {C}{C})
 * - Dynamic mana (Gaea's Cradle: {G} per creature)
 * - Land enchantments (Wild Growth, Utopia Sprawl, Overgrowth)
 * - Global effects (Caged Sun, Mana Reflection, Mirari's Wake, Nyxbloom Ancient)
 * 
 * @param gameState - Current game state
 * @param permanent - The permanent being tapped for mana
 * @param playerId - Controller of the permanent
 * @param chosenColor - For "any color" abilities, which color was chosen
 * @returns ManaProductionInfo with calculated mana amounts
 */
export function calculateManaProduction(
  gameState: any,
  permanent: any,
  playerId: string,
  chosenColor?: string,
  abilityId?: string | null,
): ManaProductionInfo {
  const card = permanent?.card || {};
  const oracleText = (card.oracle_text || '').replace(/\([^)]*\)/g, '').toLowerCase();
  const selectedAbilityLine = resolveActivatedAbilityLineById(permanent, abilityId);
  const selectedLegacyManaAbility = resolveLegacyManaAbilityById(gameState, permanent, playerId, abilityId);
  const selectedAbilityLineText = String(selectedAbilityLine?.lineText || '').toLowerCase();
  const selectedAbilityEffectText = String(selectedAbilityLine?.effectText || '').toLowerCase();
  const selectedAbilityCostText = String(selectedAbilityLine?.costText || '').trim();
  const manaOracleText = selectedAbilityLineText || oracleText;
  const typeLine = (card.type_line || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  const battlefield = gameState?.battlefield || [];
  const stampedGrantedAbilities = Array.isArray(permanent?.grantedAbilities)
    ? permanent.grantedAbilities.map((ability: any) => String(ability || '').toLowerCase())
    : [];
  const continuousGrantedAbilities = getContinuousGrantedAbilitiesForPermanent(permanent, gameState)
    .map((ability) => String(ability || '').toLowerCase());
  const grantedAbilities = [...new Set([...stampedGrantedAbilities, ...continuousGrantedAbilities])];
  const normalizedChosenColor = ['W', 'U', 'B', 'R', 'G', 'C'].includes(String(chosenColor || '').toUpperCase())
    ? String(chosenColor).toUpperCase()
    : undefined;
  const selectedLegacyManaColors: string[] = Array.isArray(selectedLegacyManaAbility?.produces)
    ? Array.from(new Set(
      selectedLegacyManaAbility.produces
        .map((color: any) => String(color || '').trim().toUpperCase())
        .filter((color: string): color is string => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color))
    ))
    : [];
  const hasSelectedLegacyManaAbility = !!selectedLegacyManaAbility;
  const spelledAnyColorAmount = (() => {
    const match = manaOracleText.match(/\badd\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana of any(?: one)? color\b/i);
    return match ? parseSpelledOutAmount(String(match[1] || '')) : undefined;
  })();
  
  const result: ManaProductionInfo = {
    colors: [],
    baseAmount: 1,
    isDynamic: false,
    bonusMana: [],
    multiplier: 1,
    totalAmount: 1,
  };

  if (selectedAbilityCostText) {
    result.activationCost = selectedAbilityCostText;
  } else if (selectedLegacyManaAbility?.cost) {
    result.activationCost = String(selectedLegacyManaAbility.cost);
  }
  
  const landBasic = tryCalculateManaProductionLandBasic({
    result,
    card,
    typeLine,
    manaOracleText,
    grantedAbilities,
    spelledAnyColorAmount,
    normalizedChosenColor,
    cardName,
    oracleText,
    permanent,
    gameState,
    playerId,
    chosenColor,
    selectedLegacyManaAbility,
    selectedLegacyManaColors,
    hasSelectedLegacyManaAbility,
  });
  if (landBasic !== undefined) return landBasic;

  
  const dynamic = tryCalculateManaProductionDynamic({
    result,
    cardName,
    oracleText,
    manaOracleText,
    typeLine,
    battlefield,
    playerId,
    permanent,
    chosenColor,
    selectedAbilityLine,
    selectedAbilityEffectText,
    abilityId,
    selectedLegacyManaAbility,
  });
  const creaturePower = tryCalculateManaProductionCreaturePower({
    result,
    cardName,
    oracleText,
    manaOracleText,
    battlefield,
    playerId,
    permanent,
    card,
    gameState,
    chosenColor,
    typeLine,
  });
  if (creaturePower !== undefined) return creaturePower;

  const storageBattery = tryCalculateManaProductionStorageBattery({
    result,
    cardName,
    oracleText,
    permanent,
    chosenColor,
    selectedAbilityCostText,
    hasSelectedLegacyManaAbility,
  });
  if (storageBattery !== undefined) return storageBattery;


  const bonuses = tryCalculateManaProductionBonusesAndTotal({
    result,
    battlefield,
    playerId,
    permanent,
    chosenColor,
    typeLine,
    card,
  });
  if (bonuses !== undefined) return bonuses;
  return result;

}
